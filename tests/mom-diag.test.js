// Momentum aşama M0 teşhis (backtest/mom-diag.js): beşte birlik ayırma ve sonraki hafta getirisi (geleceğe bakmaz), plasebo
// belirlenimci, fonlama normalleştirme ve işaret (short), canlı ↔ backtest işlem eşleştirme, haftalık parçalama, kasa sızıntısı yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepSeries, universeAt, quintilesOf, fwdReturn, m0bWeek, m0bSlice, parseFundingRows, fundingIntervalH, to8h, fundingCost, positionFunding, m0cSummary, matchTrades, liveLegs, splitWeekly, lockedLeaks, lockedAvailability, runAll, decisionDayOf, DEV_START, DAY, weekOf } from '../backtest/mom-diag.js';
import { XS_DEFAULTS, selectAt, runXsMom } from '../backtest/lab/xsmom.js';
import { mulberry32 } from '../backtest/report.js';

const P = { ...XS_DEFAULTS, lookback: 28, k: 2, side: 'short', rank: 'rel' };
// Sabit günlük büyüme g: kapanış p0·g^t, açılış önceki kapanış, ±%1 fitil (ATR > 0)
const geo = (g, n = 80, p0 = 10, t0 = DEV_START) => Array.from({ length: n }, (_, t) => { const c = p0 * g ** t, o = t ? p0 * g ** (t - 1) : c; return { time: t0 + t * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1000, quoteVol: 1e6 }; });
const firstSundayAfter = (t) => { let T = t; while (new Date(T).getUTCDay() !== 0) T += DAY; return T; };
const T = firstSundayAfter(DEV_START + 50 * DAY);
const G = [0.97, 0.98, 0.99, 0.995, 1.0, 1.003, 1.006, 1.01, 1.02, 1.03];
const mk = () => [{ coin: 'BTC', candles: geo(1.001) }, ...G.map((g, k) => ({ coin: `C${k}`, candles: geo(g) }))];

test('beşte birlik: en zayıf (BTC\'ye göre) q 0; sonraki 7 gün getirisi elle hesapla aynı; evren ortalamasına göre fark', () => {
  const S = prepSeries(mk());
  const u = universeAt(S, T, P);
  assert.equal(u.universe.length, 10); // BTC rel'de dışarıda
  const q = quintilesOf(u.universe);
  assert.deepEqual(q.map((x) => x.coin), G.map((_, k) => `C${k}`)); // artan sıra
  assert.deepEqual(q.map((x) => x.q), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const r0 = 0.97 ** 28 - 1 - (1.001 ** 28 - 1);
  assert.ok(Math.abs(q[0].r - r0) < 1e-12);
  const s0 = S.find((s) => s.coin === 'C0');
  assert.ok(Math.abs(fwdReturn(s0, T) - (0.97 ** 7 - 1)) < 1e-12);
  const w = m0bWeek(S, T, P, { draws: 50 });
  const f = G.map((g) => g ** 7 - 1), m = f.reduce((a, b) => a + b, 0) / f.length;
  assert.ok(Math.abs(w.qDiff[0] - ((f[0] + f[1]) / 2 - m) * 100) < 1e-9);
  assert.ok(Math.abs(w.qDiff[4] - ((f[8] + f[9]) / 2 - m) * 100) < 1e-9);
  assert.deepEqual([...w.weak].sort(), ['C0', 'C1']); // selectAt short (k 2)
  assert.ok(w.weakDiff < 0);
  // ileri getirisi olmayan hafta (veri sonu) → null
  assert.equal(m0bWeek(S, T + 21 * DAY, P), null); // 80 mum: T + 28 yok
});

test('geleceğe bakmaz: T sonrası mumlar değişince evren / dilimler / seçim aynı, yalnız ileri getiri değişir', () => {
  const A = mk(), B = mk().map((s) => ({ ...s, candles: s.candles.map((c) => (c.time > T ? { ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * (s.coin === 'C0' ? 5 : 3), quoteVol: 1 } : c)) }));
  const SA = prepSeries(A), SB = prepSeries(B);
  const uA = universeAt(SA, T, P, 6), uB = universeAt(SB, T, P, 6);
  assert.deepEqual(uA.universe, uB.universe);
  assert.deepEqual(quintilesOf(uA.universe), quintilesOf(uB.universe));
  assert.deepEqual(selectAt(uA.ranks, P, { pitN: 6 }), selectAt(uB.ranks, P, { pitN: 6 }));
  assert.notEqual(m0bWeek(SA, T, P, { draws: 10 }).qDiff[0], m0bWeek(SB, T, P, { draws: 10 }).qDiff[0]);
});

test('plasebo belirlenimci: aynı hafta aynı çekilişler; farklı hafta farklı; dilim özeti yüzdelik ve kural', () => {
  const S = prepSeries(mk());
  const a = m0bWeek(S, T, P, { draws: 200 }), b = m0bWeek(S, T, P, { draws: 200 }), c = m0bWeek(S, T + 7 * DAY, P, { draws: 200 });
  assert.deepEqual([...a.placebo], [...b.placebo]);
  assert.notDeepEqual([...a.placebo], [...c.placebo]);
  const sl = m0bSlice([a, c], { reps: 200 });
  assert.equal(sl.weeks, 2);
  assert.equal(sl.monotonic, true); // sabit büyüme: dilimler sıralı
  assert.ok(sl.placebo.percentile <= 5); // en zayıflar her çekilişten zayıf
  assert.equal(sl.infoRule, true);
});

test('fonlama: ayrıştırma savunmacı, aralık ve 8 saate normalleştirme, short işareti (negatif oran = short öder)', () => {
  const H = 3600e3, t0 = DEV_START + 400 * DAY;
  const raw = [
    { instId: 'X-USDT-SWAP', fundingRate: '-0.0001', realizedRate: '', fundingTime: String(t0 + 4 * H) },
    { fundingRate: '0.5', realizedRate: '-0.0001', fundingTime: t0 + 8 * H },
    { fundingRate: 'abc', fundingTime: t0 + 12 * H }, null, { fundingRate: '-0.0001' },
    { fundingRate: '-0.0001', fundingTime: String(t0) },
  ];
  const rows = parseFundingRows(raw);
  assert.deepEqual(rows.map((x) => x.time), [t0, t0 + 4 * H, t0 + 8 * H]);
  assert.equal(rows[2].rate, -0.0001); // realizedRate öncelikli
  assert.deepEqual(parseFundingRows({ code: '51001' }), []);
  assert.equal(fundingIntervalH(rows), 4);
  assert.ok(Math.abs(to8h(-0.0001, 4) - -0.0002) < 1e-15);
  assert.equal(fundingCost(-1, -0.0002), 0.0002); // short, negatif oran → maliyet
  assert.equal(fundingCost(-1, 0.0002), -0.0002); // short, pozitif oran → gelir
  const pf = positionFunding({ d: -1, entryTime: t0 - H, exitTime: t0 + 8 * H }, rows);
  assert.equal(pf.events, 3); assert.ok(Math.abs(pf.cost - 0.0003) < 1e-15);
  // 4 saatlik coin, sürekli −%0,01 / 4s → short için %0,02 / 8s = varsayılanın 2 katı (eşik "2 kattan fazla")
  const long = Array.from({ length: 60 }, (_, k) => ({ fundingTime: t0 + k * 4 * H, fundingRate: '-0.0001' }));
  const fm = new Map([['X', parseFundingRows(long)]]);
  const tr = [{ coin: 'X', direction: 'short', entryTime: t0 + 2 * H, exitTime: t0 + 2 * H + 100 * H }];
  const s = m0cSummary(tr, fm);
  assert.ok(Math.abs(s.costPct8h - 0.02) < 1e-9); assert.equal(s.ratio, 2); assert.equal(s.intervalsH['4'], 1);
  assert.match(s.verdict, /korunur/);
  const fm3 = new Map([['X', parseFundingRows(long.map((x) => ({ ...x, fundingRate: '-0.00015' })))]]);
  assert.match(m0cSummary(tr, fm3).verdict, /yeniden kurulur/);
  assert.equal(m0cSummary(tr, new Map([['X', null]])).verdict, 'veri yok');
  assert.equal(m0cSummary([], new Map()).verdict, 'veri yok');
});

test('canlı ↔ backtest eşleştirme: aynı coin + giriş günü + yön; yalnız canlı / yalnız bt; karar günü', () => {
  const mon = Date.UTC(2026, 9, 26), mom = {
    updatedAt: mon + 5 * DAY,
    trades: [{ coin: 'AAA', direction: 'short', entryTime: mon + 49e3, exitTime: mon + 7 * DAY + 50e3, entry: 10.1, exit: 9, notional: 20, pnl: 2.1, pct: 10.5, R: 0.35, hedge: false, reason: 'rebalance', funding: 0.04, fee: 0.02 }],
    positions: [{ coin: 'BBB', direction: 'short', entryTime: mon + 49e3, entry: 2, price: 2.2, stop: 2.6, notional: 10, pnl: -1, pct: -10, funding: 0.01 }, { coin: 'BTC', hedge: true, direction: 'long', entryTime: mon + 60e3, entry: 100, price: 90, notional: 30, pnl: -3, pct: -10, funding: 0.02 }],
  };
  const bt = [{ coin: 'AAA', direction: 'short', time: mon - DAY, entryTime: mon, exitTime: mon + 7 * DAY, entry: 10, stop: 13, exit: 9.1, ret: 0.089, R: 0.3, outcome: 'timeout' }, { coin: 'CCC', direction: 'short', time: mon - DAY, entryTime: mon, exitTime: mon + 3 * DAY, entry: 5, stop: 6, exit: 6, ret: -0.2, R: -1, outcome: 'stopped' }, { coin: 'BBB', direction: 'long', time: mon - DAY, entryTime: mon, exitTime: mon + 3 * DAY, entry: 2, stop: 1.5, exit: 2.1, ret: 0.05, R: 0.2, outcome: 'timeout' }];
  const legs = liveLegs(mom);
  assert.equal(legs.filter((l) => l.hedge).length, 1);
  const m = matchTrades(legs, bt);
  assert.deepEqual(m.rows.map((r) => r.coin), ['AAA']);
  assert.equal(m.rows[0].diff.entryPct, 1); assert.equal(m.rows[0].bt.riskPct, 30); assert.equal(m.rows[0].live.riskPct, 30);
  assert.equal(m.rows[0].diff.sameExitDay, true);
  assert.deepEqual(m.onlyLive.map((x) => x.coin), ['BBB']); // yön farklı → eşleşmez; hedge bacağı hiç girmez
  assert.deepEqual(m.onlyBt.map((x) => x.coin).sort(), ['BBB', 'CCC']);
  assert.equal(decisionDayOf(mon + 49e3), mon - DAY); // pazartesi turu → pazar mumu
});

test('haftalık parçalama: bir işlemin parçaları toplamı = ret / slot; hedge bacağı ters BTC', () => {
  const S = prepSeries([{ coin: 'BTC', candles: geo(0.99, 60) }, { coin: 'X', candles: geo(0.98, 60) }]), by = new Map(S.map((s) => [s.coin, s]));
  const mon = firstSundayAfter(DEV_START + DAY) + DAY; // pazartesi
  const iE = by.get('X').idx.get(mon), iX = by.get('X').idx.get(mon + 14 * DAY);
  const entry = by.get('X').c[iE].open * 0.9995, exit = by.get('X').c[iX].open * 1.0005;
  const gross = -(exit - entry) / entry, fund = 14 * 3 * 0.0001, ret = +(gross - 0.001 - fund).toFixed(5);
  const t = { coin: 'X', direction: 'short', time: mon - DAY, entryTime: mon, exitTime: mon + 14 * DAY, entry, exit, stop: entry * 1.2, ret, R: ret / 0.2, outcome: 'timeout' };
  const sw = splitWeekly([t], by, { slots: 5, fee: 0.0005, slip: 0.0005, dataEnd: mon + 40 * DAY, hedge: true });
  assert.deepEqual([...sw.weeks.keys()], [weekOf(mon), weekOf(mon) + 1]);
  const sum = [...sw.weeks.values()].reduce((a, x) => a + x.ret, 0);
  assert.ok(Math.abs(sum - ret / 5) < 1e-12);
  const hs = [...sw.weeks.values()].reduce((a, x) => a + x.hedged, 0);
  assert.ok(Math.abs(hs - (ret + sw.trades[0].hedgeRet) / 5) < 1e-6);
  assert.ok(sw.trades[0].hedgeRet < 0); // BTC long düşüşte kaybeder
});

// Sentetik evren (geliştirme dilimi + kasa zaman damgaları)
function synth(nCoins = 24, days = 260, seed = 7) {
  const rnd = mulberry32(seed), out = [];
  for (let k = 0; k <= nCoins; k++) {
    const coin = k === 0 ? 'BTC' : `S${k}`; let p = 10 + k; const cs = [];
    const drift = (rnd() - 0.5) * 0.01;
    for (let t = 0; t < days; t++) { const o = p; p = p * (1 + drift + (rnd() - 0.5) * 0.06); cs.push({ time: DEV_START + t * DAY, open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p, volume: 1, quoteVol: 1e6 * (1 + rnd()) * (nCoins - k + 1) }); }
    out.push({ coin, candles: cs });
  }
  return out;
}

test('uçtan uca (sentetik): şema meta/m0a–m0d, canlı eşleşme, kasa alanı yalnız sayım, sızıntı yok', () => {
  const series = synth();
  const lockedTimes = new Map(series.map((s, k) => [s.coin, Array.from({ length: k < 5 ? 0 : 800 }, (_, j) => DEV_START - (800 - j) * DAY)]));
  // Canlı: bt'nin gerçekten girdiği bir pazartesi + coin (pool 80 = hepsi)
  const bt = runXsMom(series, { feePct: 0.05, slipPct: 0.05 }, { startMs: DEV_START, pitN: 50 }, { lookback: 28, k: 5, side: 'short', rank: 'rel' });
  const e = bt.find((t) => t.entryTime > DEV_START + 120 * DAY);
  const live = { params: { lookback: 28, k: 5, side: 'short', rank: 'rel', hedge: true, stopAtr: 3, feePct: 0.05, slipPct: 0.05, fundingPct8h: 0.01, riskPct: 2, pitN: 50, universe: 80 },
    start: e.entryTime + 30e3, updatedAt: e.entryTime + 5 * DAY, startEquity: 300, equity: 301, realized: 0, pnlPct: 0.33, btc: null,
    rebalances: [{ time: e.entryTime + 30e3, longs: [], shorts: [e.coin], equity: 300 }], trades: [],
    positions: [{ coin: e.coin, direction: 'short', entryTime: e.entryTime + 30e3, entry: e.entry, price: e.entry * 0.99, stop: e.stop, notional: 20, pnl: 1, pct: 5, funding: 0 }] };
  const out = runAll({ series, lockedTimes, live, now: DEV_START + 260 * DAY, draws: 50, ci: { reps: 100 } });
  for (const k of ['meta', 'm0a', 'm0b', 'm0c', 'm0d']) assert.ok(out[k], k);
  assert.equal(Object.keys(out.m0d.variants).length, 7);
  assert.ok(out.m0d.variants.xsmom_l28_k5_short_rel.valid.hedgedWeekly);
  assert.equal(out.m0a.available, true);
  assert.equal(out.m0a.trades.rows.length, 1);
  assert.equal(out.m0a.trades.rows[0].coin, e.coin);
  assert.ok(out.m0a.selections[0].bt.includes(e.coin));
  assert.equal(out.m0c.verdict, 'veri yok');
  assert.ok(['bilgi var', 'bilgi gösterilemedi'].includes(out.m0b.verdict));
  // Kasa: yalnız sayım alanları; çıktının geri kalanında kasa dönemine ait zaman yok
  const A = out.meta.lockedAvailability;
  assert.ok(A.rebalances > 100);
  for (const r of A.byDate) assert.deepEqual(Object.keys(r).sort(), ['date', 'eligible', 'withCandle']);
  assert.deepEqual(lockedLeaks(out), []);
  assert.ok(!/ret|pct|Pct|R"|close|price/.test(JSON.stringify(A)));
  // Sızıntı denetçisi çalışıyor; girdi kasa mumu içerirse runAll durur
  assert.deepEqual(lockedLeaks({ m0d: { x: { entryTime: DEV_START - DAY } }, a: { date: '2024-01-01' } }), ['m0d.x.entryTime', 'a.date']);
  assert.throws(() => runAll({ series: [{ coin: 'BTC', candles: [{ time: DEV_START - DAY, open: 1, high: 1, low: 1, close: 1 }] }], now: DEV_START }), /kasa/);
  // Sayım: 5 coinin kasa verisi yok → uygun coin sayısı en çok 24 − 4 (BTC sayılmaz)
  assert.equal(lockedAvailability(lockedTimes).eligibleMax, 20);
});
