// Bilgi taraması (backtest/screen.js; ön kayıt docs/arastirma/on-kayit-tarama.md): olay tanımları, göreli getiri penceresi, plasebo
// belirlenimci ve aynı günden, K4 yaş grubu, K6 beşte birlik, K3 A-mom yönü, verdict mantığı, sentetik "bilgi yok" ↔ güçlü etki.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, fwdRet, eventsOn, dedupEvents, placeboDay, cellOf, verdictOf, verdictK3, ageDays, vol28, quintileMap, aMomCandidates, momAt, atrRet, runK1, runK4, runK6, runScreen, daysBetween, sundays, k3Signals, SCREEN_DEFAULTS, VERDICT, HALF_A_START, HALF_B_START, DAY } from '../backtest/screen.js';
import { simulateSeries, BT_DEFAULTS } from '../backtest/engine.js';
import { fixtureProvider } from '../src/data/fixture.js';
import { mulberry32 } from '../backtest/report.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
/** Kapanış dizisi → mumlar (açılış = önceki kapanış, ±%1 fitil). */
const mkCandles = (closes, { t0 = HALF_A_START - 100 * DAY, vols = null, opens = null } = {}) => closes.map((c, k) => {
  const o = opens?.[k] ?? (k ? closes[k - 1] : c);
  return { time: t0 + k * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1, quoteVol: vols ? vols[k] : 1e6 };
});
const flat = (n, p = 10) => Array.from({ length: n }, () => p);

/**
 * Sentetik evren: nCoins coin + BTC, günlük rastgele yürüyüş (sd), A yarısından 100 gün önce başlar. pumpProb: coin-gün başına +%30
 * kapanış ve 5 × hacim; effect: pump sonrası 3 gün her gün bu getiri (yoksa normal yürüyüş).
 */
function synth({ nCoins = 30, sd = 0.03, pumpProb = 0, effect = null, highVol = 0, hvDrift = 0, seed = 7, end = Date.UTC(2026, 9, 1) } = {}) {
  const rnd = mulberry32(seed), t0 = HALF_A_START - 100 * DAY, n = Math.round((end - t0) / DAY);
  const out = [];
  for (let c = 0; c <= nCoins; c++) {
    const coin = c === nCoins ? 'BTC' : `C${c}`, hv = c < highVol;
    let p = 10, after = 0;
    const closes = [], vols = [];
    for (let k = 0; k < n; k++) {
      let r = (hv ? sd * 3 : sd) * (rnd() - 0.5) * Math.sqrt(12) + (hv ? hvDrift : 0);
      let v = (1 + 0.2 * rnd()) * 1e6 * (c + 1);
      if (after > 0) { if (effect != null) r = effect; after--; } else if (coin !== 'BTC' && k > 70 && rnd() < pumpProb) { r = 0.3; v *= 5; after = 3; }
      p *= 1 + r; closes.push(p); vols.push(v);
    }
    out.push({ coin, candles: mkCandles(closes, { t0, vols }) });
  }
  return out;
}

test('K1 / K2 olay: eşik + hacim koşulu; hacim medyanı olay gününü içermiyor', () => {
  const n = 120, ev = 100;
  const cl = flat(n), vol = Array.from({ length: n }, () => 1e6);
  cl[ev] = 12.5; for (let k = ev + 1; k < n; k++) cl[k] = 12.5; // +%25 tam eşik
  vol[ev] = 3e6; // tam 3 × medyan
  const dump = flat(n); dump[ev] = 7.99; for (let k = ev + 1; k < n; k++) dump[k] = 7.99; // −%20,1 (8/10 − 1 kayan noktada −0,1999…)
  const weak = flat(n); weak[ev] = 12.4; for (let k = ev + 1; k < n; k++) weak[k] = 12.4; // +%24
  const lowV = [...vol]; lowV[ev] = 2.9e6;
  const t0 = HALF_A_START - 50 * DAY, T = t0 + ev * DAY;
  const ctx = makeCtx([
    { coin: 'P', candles: mkCandles(cl, { t0, vols: vol }) }, { coin: 'D', candles: mkCandles(dump, { t0, vols: vol }) },
    { coin: 'W', candles: mkCandles(weak, { t0, vols: vol }) }, { coin: 'L', candles: mkCandles(cl, { t0, vols: lowV }) },
    { coin: 'BTC', candles: mkCandles(cl, { t0, vols: vol }) }, // BTC olay adayı değil
  ]);
  const o1 = SCREEN_DEFAULTS.k1, o2 = SCREEN_DEFAULTS.k2;
  assert.deepEqual(eventsOn(ctx, T, o1).map((e) => e.coin), ['P']);
  assert.deepEqual(eventsOn(ctx, T, o2).map((e) => e.coin), ['D']);
  // medyan olay gününü içermiyor: önceki 30 günde hacim 1e6, olay günü 3e6 → oran tam 3 (olay günü dahil olsaydı medyan değişmez ama
  // önceki günler 2e6 olunca dahil etmek eşiği düşürürdü) — önceki 15 günü 1,5e6 yap: medyan 1,25e6 → 3e6 < 3,75e6 → olay yok
  const v2 = [...vol]; for (let k = ev - 15; k < ev; k++) v2[k] = 1.5e6;
  const ctx2 = makeCtx([{ coin: 'P', candles: mkCandles(cl, { t0, vols: v2 }) }, { coin: 'X', candles: mkCandles(flat(n), { t0 }) }]);
  assert.equal(eventsOn(ctx2, T, o1).length, 0);
  const e = eventsOn(ctx, T, o1)[0];
  close(e.volRatio, 3);
});

test('evren: t günü hacmi sıralamaya girmez (önceki 30 gün); ≥ 60 günlük geçmiş', () => {
  const n = 120, t0 = HALF_A_START - 50 * DAY, T = t0 + 100 * DAY;
  const big = Array.from({ length: n }, (_, k) => (k === 100 ? 1e12 : 1e3));
  const S = [{ coin: 'BIG', candles: mkCandles(flat(n), { t0, vols: big }) }, ...[1, 2, 3].map((k) => ({ coin: `N${k}`, candles: mkCandles(flat(n), { t0, vols: Array(n).fill(1e6 * k) }) }))];
  const young = { coin: 'Y', candles: mkCandles(flat(59), { t0: T - 58 * DAY, vols: Array(59).fill(1e15) }) };
  const ctx = makeCtx([...S, young], { ...SCREEN_DEFAULTS, universeN: 3 });
  assert.deepEqual(ctx.universe(T).map((x) => x.s.coin), ['N3', 'N2', 'N1']); // BIG'in t günü hacmi dışarıda; Y genç
  assert.ok(ctx.universe(T + DAY).map((x) => x.s.coin).includes('BIG')); // ertesi gün önceki 30 güne girdi
});

test('göreli getiri penceresi: açılış[t+1] → kapanış[t+N] (elle örnek); evren ortalaması çıkarılır; ufku dolmayan null', () => {
  const t0 = HALF_A_START - 70 * DAY, i = 70, T = t0 + i * DAY;
  const a = flat(80, 10); a[i + 1] = 11; a[i + 2] = 12; a[i + 3] = 9;
  const opens = flat(80, 10); opens[i + 1] = 10.5; // açılış[t+1] boşluklu
  const b = flat(80, 10); b[i + 3] = 11;
  const ctx = makeCtx([{ coin: 'A', candles: mkCandles(a, { t0, opens }) }, { coin: 'B', candles: mkCandles(b, { t0 }) }]);
  const sA = ctx.byCoin.get('A'), sB = ctx.byCoin.get('B');
  close(fwdRet(sA, T, 3), 9 / 10.5 - 1);
  close(fwdRet(sA, T, 1), 11 / 10.5 - 1);
  close(fwdRet(sB, T, 3), 0.1);
  close(ctx.rel(sA, T, 3), (9 / 10.5 - 1) - ((9 / 10.5 - 1) + 0.1) / 2);
  assert.equal(fwdRet(sA, t0 + 78 * DAY, 3), null);
});

test('plasebo belirlenimci ve aynı günden çekiyor; olay günü çekilişleri o günün havuzundan', () => {
  const S = synth({ nCoins: 12, seed: 3, end: HALF_A_START + 60 * DAY });
  const ctx = makeCtx(S);
  const T = HALF_A_START + 10 * DAY, N = 3, o = { key: 'k1', draws: 300, seed: 1 };
  const a = placeboDay(ctx, T, N, 1, o), b = placeboDay(ctx, T, N, 1, o), c = placeboDay(ctx, T + DAY, N, 1, o);
  assert.deepEqual([...a.sums], [...b.sums]);
  assert.notDeepEqual([...a.sums], [...c.sums]);
  const pool = new Set(ctx.cands(T).map((x) => ctx.rel(x.s, T, N) * 100));
  for (const v of a.sums) assert.ok(pool.has(v)); // k = 1: her çekiliş aynı günün bir adayı
  assert.ok(!ctx.cands(T).some((x) => x.s.coin === 'BTC'));
});

test('K4 yaş grubu ve K6 beşte birlik', () => {
  const T = HALF_A_START + 200 * DAY;
  const s = { first: T - 45 * DAY };
  close(ageDays(s, T), 45);
  const n = 200;
  const mk = (sd, seed) => { const r = mulberry32(seed); let p = 10; return mkCandles(Array.from({ length: n }, () => (p *= 1 + sd * (r() - 0.5))), { t0: T - 150 * DAY }); };
  const ctx = makeCtx([...[0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10].map((sd, k) => ({ coin: `V${k}`, candles: mk(sd, k + 1) })), { coin: 'BTC', candles: mk(0.01, 99) }]);
  const xs = ctx.cands(T).map((x) => ({ s: x.s, val: vol28(x.s, x.i) }));
  const q = quintileMap(xs);
  assert.deepEqual(['V0', 'V1', 'V8', 'V9'].map((c) => q.get(c)), [0, 0, 4, 4]);
  assert.equal(q.has('BTC'), false);
  // vol28 elle: 28 getirinin örneklem sd'si
  const sv = ctx.byCoin.get('V3'), i = sv.idx.get(T), r = [];
  for (let k = i - 27; k <= i; k++) r.push(sv.c[k].close / sv.c[k - 1].close - 1);
  const m = r.reduce((a, x) => a + x, 0) / 28;
  close(vol28(sv, i), Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / 27));
  // K4: 30–120 gün grubunda yalnız o yaştakiler (evren ≥ 60 gün geçmiş ister → etkin 60–120)
  const W = sundays(HALF_A_START, HALF_A_START + 400 * DAY);
  const S2 = synth({ nCoins: 6, seed: 5, end: HALF_A_START + 400 * DAY });
  const youngStart = HALF_A_START + 100 * DAY;
  S2.push({ coin: 'NEW', candles: S2[0].candles.filter((c) => c.time >= youngStart) });
  const r4 = runK4(makeCtx(S2, { ...SCREEN_DEFAULTS, draws: 50, reps: 100 }), W, makeCtx(S2, { ...SCREEN_DEFAULTS, minHistory: 30, draws: 50, reps: 100 }));
  // grup dolu haftalar: herhangi bir coinin (NEW ya da sentetiklerin, ilk mum HALF_A_START − 100 g) yaşı [eşik, 120]
  const firsts = [youngStart, HALF_A_START - 100 * DAY];
  const weeksIn = (lo) => W.filter((T2) => firsts.some((f) => { const a = ageDays({ first: f }, T2); return a >= lo && a <= 120; })).length;
  assert.equal(r4.A.n + r4.B.n, weeksIn(60)); // evren ≥ 60 gün geçmiş ister → 30–60 boş
  assert.equal(r4.wide.group.A.n + r4.wide.group.B.n, weeksIn(30));
  assert.ok(weeksIn(30) > weeksIn(60));
  assert.ok(r4.wide.buckets['30-60'].A.n > 0 && r4.buckets['30-60'].A.n === 0);
});

test('K3 A-mom plasebosu: yön plasebo gününün KENDİ 28 günlük getirisinden; sinyal yönü geçmişe taşınmaz', () => {
  // 150 gün yükseliş, sonra 150 gün düşüş
  const cl = Array.from({ length: 300 }, (_, k) => (k < 150 ? 10 * 1.01 ** k : 10 * 1.01 ** 150 * 0.99 ** (k - 150)));
  const ctx = makeCtx([{ coin: 'X', candles: mkCandles(cl) }]);
  const s = ctx.byCoin.get('X'), i = 160, N = 7;
  for (const d of [1, -1]) {
    const got = aMomCandidates(s, i, d, N, { windowDays: 90, momDays: 28 });
    const exp = [];
    for (let j = i - 90; j <= i + 90; j++) { if (j === i) continue; const m = momAt(s, j, 28); if (m == null || !(d === 1 ? m > 0 : m < 0)) continue; const v = atrRet(s, j, N, d); if (v != null) exp.push(v); }
    assert.deepEqual(got, exp);
    assert.ok(got.length > 20);
  }
  // long adayları yükseliş bölgesinde (j ≤ ~177), short adayları düşüşte: aynı gün (i) sinyali yönü fark etmeksizin aday kümesi farklı
  assert.notEqual(aMomCandidates(s, i, 1, N).length, aMomCandidates(s, i, -1, N).length);
});

test('verdict: iki yarı, %99 aralık, plasebo yüzdeliği, n eşiği (elle sayılar)', () => {
  const c = (meanPct, ci99, percentile, n = 150) => ({ n, meanPct, ci99, percentile, inconclusive: n < 100 });
  assert.equal(verdictOf('neg', c(-1, [-2, -0.5], 0.5), c(-0.8, [-1.5, -0.1], 1)).verdict, VERDICT.pass);
  assert.equal(verdictOf('neg', c(-1, [-2, 0.1], 0.5), c(-0.8, [-1.5, -0.1], 1)).verdict, VERDICT.fail); // aralık sıfırı içeriyor
  assert.equal(verdictOf('neg', c(-1, [-2, -0.5], 1.2), c(-0.8, [-1.5, -0.1], 1)).verdict, VERDICT.fail); // yüzdelik > %1
  assert.equal(verdictOf('neg', c(-1, [-2, -0.5], 0.5, 99), c(-0.8, [-1.5, -0.1], 1)).verdict, VERDICT.inconclusive);
  assert.equal(verdictOf('neg', c(1, [0.5, 2], 99.9), c(1, [0.5, 2], 99.9)).verdict, VERDICT.fail); // ters yön
  assert.equal(verdictOf('two', c(1, [0.5, 2], 99.6), c(0.8, [0.1, 1.5], 99.9)).verdict, VERDICT.pass);
  assert.equal(verdictOf('two', c(-1, [-2, -0.5], 0.4), c(-0.8, [-1.5, -0.1], 0.1)).verdict, VERDICT.pass);
  assert.equal(verdictOf('two', c(1, [0.5, 2], 99.6), c(-0.8, [-1.5, -0.1], 0.1)).verdict, VERDICT.fail); // işaret farklı
  assert.equal(verdictOf('two', c(1, [0.5, 2], 99.4), c(0.8, [0.1, 1.5], 99.9)).verdict, VERDICT.fail);
  // weekly eşiği (60) hücrenin inconclusive alanından gelir
  assert.equal(verdictOf('neg', { ...c(-1, [-2, -0.5], 0.5, 61), inconclusive: false }, { ...c(-1, [-2, -0.5], 0.5, 61), inconclusive: false }).verdict, VERDICT.pass);
  const k = (meanAtr, ci99, dB, dA, n = 200) => ({ n, meanAtr, ci99, vsB: { diffCi99: dB }, vsA: { diffCi99: dA }, inconclusive: n < 100 });
  assert.equal(verdictK3(k(0.2, [0.05, 0.3], [0.01, 0.2], [0.02, 0.3]), k(0.1, [0.01, 0.2], [0.01, 0.2], [0.01, 0.2])).verdict, VERDICT.pass);
  assert.equal(verdictK3(k(0.2, [0.05, 0.3], [0.01, 0.2], [-0.02, 0.3]), k(0.1, [0.01, 0.2], [0.01, 0.2], [0.01, 0.2])).verdict, VERDICT.fail); // A-mom'a karşı değil
  assert.equal(verdictK3(k(0.2, [0.05, 0.3], [0.01, 0.2], [0.02, 0.3], 50), k(0.1, [0.01, 0.2], [0.01, 0.2], [0.01, 0.2])).verdict, VERDICT.inconclusive);
  // cellOf: yüzdelik = çekilişlerin ≤ gerçek payı
  const items = [{ t: 1, v: -5 }, { t: 2, v: -3 }];
  const pd = [{ t: 1, k: 1, sums: Float64Array.from([0, -10, 1, 2]) }, { t: 2, k: 1, sums: Float64Array.from([0, -10, 1, 2]) }];
  const cell = cellOf(items, pd, { reps: 100, seed: 1, minN: 100 });
  assert.equal(cell.meanPct, -4);
  assert.equal(cell.percentile, 25); // dağılım [0, −10, 1, 2]: −4'ten küçük ya da eşit 1/4
  assert.equal(cell.inconclusive, true);
});

test('sentetik: bilgi yok → K1 geçmedi; yerleştirilmiş güçlü etki → geçer; coin başına 7 gün süzgeci', () => {
  const P = { ...SCREEN_DEFAULTS, draws: 200, reps: 500 };
  const days = (S) => daysBetween(HALF_A_START, Math.max(...S.map((s) => s.candles.at(-1).time)));
  const S0 = synth({ nCoins: 30, pumpProb: 0.008, seed: 11 });
  const r0 = runK1(makeCtx(S0, P), days(S0));
  assert.ok(r0.A.n >= 100 && r0.B.n >= 100, `n ${r0.A.n}/${r0.B.n}`);
  assert.equal(r0.verdict, VERDICT.fail);
  const S1 = synth({ nCoins: 30, pumpProb: 0.008, effect: -0.05, seed: 11 });
  const r1 = runK1(makeCtx(S1, P), days(S1));
  assert.equal(r1.verdict, VERDICT.pass, JSON.stringify(r1.checks));
  assert.ok(r1.A.percentile <= 1 && r1.B.ci99[1] < 0);
  assert.ok(r1.squeeze.A.n > 0 && r1.squeeze.A.p50 != null);
  const all = [{ coin: 'a', t: 0 }, { coin: 'a', t: 3 * DAY }, { coin: 'a', t: 7 * DAY }, { coin: 'b', t: 3 * DAY }];
  assert.deepEqual(dedupEvents(all, 7).map((e) => `${e.coin}${e.t / DAY}`), ['a0', 'b3', 'a7']);
});

test('sentetik: K6 yerleştirilmiş etki (yüksek oynaklık + aşağı kayma) geçer; bilgi yokta geçmez', () => {
  const P = { ...SCREEN_DEFAULTS, draws: 200, reps: 500 };
  const run = (S) => runK6(makeCtx(S, P), sundays(HALF_A_START, Math.max(...S.map((s) => s.candles.at(-1).time))));
  assert.equal(run(synth({ nCoins: 25, highVol: 5, hvDrift: -0.01, seed: 4 })).verdict, VERDICT.pass);
  assert.equal(run(synth({ nCoins: 25, seed: 4 })).verdict, VERDICT.fail);
});

test('uçtan uca: runScreen şeması (meta, k1 … k6); K3 sinyal verilmezse uygulanamadı; K5 veri yok', () => {
  const S = synth({ nCoins: 10, seed: 2, end: HALF_B_START + 120 * DAY, pumpProb: 0.01 });
  const sig = [{ coin: 'C1', t: HALF_A_START + 30 * DAY, d: 1 }, { coin: 'C2', t: HALF_B_START + 30 * DAY, d: -1 }];
  const o = runScreen({ series: S, k3: { signals: sig }, now: 0, p: { draws: 50, reps: 100 } });
  assert.deepEqual(Object.keys(o), ['meta', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  assert.ok(o.meta.universe.perDay.min > 0 && o.meta.halves.A && o.meta.seed);
  for (const k of ['k1', 'k2', 'k4', 'k6']) { assert.ok('A' in o[k] && 'B' in o[k] && o[k].verdict, k); }
  assert.equal(o.k3.available, true); assert.equal(o.k3.A.n, 1); assert.equal(o.k3.verdict, VERDICT.inconclusive);
  assert.equal(o.k5.reason, 'veri yok'); assert.equal(o.k5.verdict, undefined);
  const u = runScreen({ series: S, k3: { unavailable: 'deneme' }, now: 0, p: { draws: 20, reps: 50 } });
  assert.match(u.k3.reason, /uygulanamadı: deneme/);
  assert.doesNotThrow(() => JSON.stringify(o));
});

test('K3 sinyalleri: engine.simulateSeries (1D) ile aynı gün ve yön; fromMs öncesi atlanır', async () => {
  const { candles } = await fixtureProvider.candles('SOL-USDT-SWAP', '1D', 640);
  const sim = simulateSeries({ coin: 'SOL', instId: 'SOL-USDT-SWAP', tf: '1D', candles }, BT_DEFAULTS);
  const sg = k3Signals({ coin: 'SOL', instId: 'SOL-USDT-SWAP', candles }, { fromMs: 0 });
  assert.ok(sim.length > 0);
  assert.deepEqual(sg.map((x) => [x.t, x.d]), sim.map((t) => [t.time, t.direction === 'long' ? 1 : -1]));
  const cut = candles[620].time;
  assert.deepEqual(k3Signals({ coin: 'SOL', instId: 'SOL-USDT-SWAP', candles }, { fromMs: cut }).map((x) => x.t), sg.filter((x) => x.t >= cut).map((x) => x.t));
});
