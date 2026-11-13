// Aşama 0 teşhis (backtest/diag.js): ileri getiri / MFE / MAE, plasebo seçimi (belirlenimci, geleceğe bakmaz), yarı-yarı
// aritmetiği, piyasa eşi, stop sonrası ölçüm, maliyet farkının işareti, karar kuralları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardOf, sampleK, seedOf, placeboACandidates, atrSeries, blockCi, d1Cell, d1Verdict, halfHalfR, marketPlanOf, postStopOf, tp1BeforeStop, costOf, stopBucket, quantiles, splitDir, DAY } from '../backtest/diag.js';
import { mulberry32 } from '../backtest/report.js';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';
import { randomWalk } from './helpers.js';

const H4 = 4 * 3600e3;
const bar = (k, o, h, l, c) => ({ time: k * H4, open: o, high: h, low: l, close: c });
const S = [bar(0, 100, 103, 99, 102), bar(1, 102, 104, 101, 101), bar(2, 101, 102, 97, 98)];

test('forwardOf: elle kurulmuş seride getiri / MFE / MAE (ATR), long ve short; ufuk dolmazsa null', () => {
  assert.deepEqual(forwardOf(S, 0, 1, 2, 2), { ret: 0.5, mfe: 2, mae: 0.5 });
  assert.deepEqual(forwardOf(S, 0, 1, 2, 3), { ret: -1, mfe: 2, mae: 1.5 });
  assert.deepEqual(forwardOf(S, 0, -1, 2, 3), { ret: 1, mfe: 1.5, mae: 2 });
  assert.equal(forwardOf(S, 0, 1, 2, 4), null); // 4. mum yok
  assert.equal(forwardOf(S, 1, 1, 2, 3), null);
  assert.equal(forwardOf(S, 0, 1, 0, 2), null); // ATR yok
});

test('plasebo: seçim belirlenimci, yalnız zamana bağlı; ATR(14) geleceğe bakmaz; ufku dolmayan çekiliş atılır', () => {
  const cs = randomWalk(600, { seed: 3, tfMs: H4 });
  const i = 300;
  const cand = placeboACandidates(cs, i, { days: 30 });
  assert.ok(!cand.includes(i));
  assert.ok(cand.every((j) => Math.abs(cs[j].time - cs[i].time) <= 30 * DAY));
  assert.equal(cand.length, 2 * 180); // 4H: 30 gün = 180 mum, iki yan
  const a = sampleK(cand, 20, mulberry32(seedOf('X|1|A'))), b = sampleK(cand, 20, mulberry32(seedOf('X|1|A')));
  assert.deepEqual(a, b); assert.equal(new Set(a).size, 20);
  assert.notDeepEqual(a, sampleK(cand, 20, mulberry32(seedOf('X|1|B'))));
  // Fiyatlar değişse de seçim aynı (sinyalin / plasebonun sonucuna bakmaz)
  const cs2 = cs.map((c, k) => (k > i ? { ...c, open: c.open * 2, high: c.high * 2, low: c.low * 2, close: c.close * 2 } : c));
  assert.deepEqual(placeboACandidates(cs2, i, { days: 30 }), cand);
  // ATR(14) j'de yalnız 0..j mumlarından
  const A1 = atrSeries(cs), A2 = atrSeries(cs2);
  for (let j = 0; j <= i; j++) assert.equal(A1[j], A2[j]);
  // Çekilişin ölçümü yalnız j+1..j+N mumlarını kullanır: sonrası değişse de aynı
  const j = 250, N = 12, cs3 = cs.map((c, k) => (k > j + N ? { ...c, high: c.high + 50, low: c.low - 50 } : c));
  assert.deepEqual(forwardOf(cs, j + 1, 1, A1[j], N), forwardOf(cs3, j + 1, 1, A1[j], N));
  // Seri sonuna yakın çekiliş: ufuk dolmaz → null (atılır)
  assert.equal(forwardOf(cs, cs.length - 5, 1, A1[cs.length - 6], 6), null);
  // ok filtresi (ör. karar anı hafta içi)
  assert.ok(placeboACandidates(cs, i, { days: 30, ok: (k) => k % 2 === 0 }).every((k) => k % 2 === 0));
});

test('d1Cell / blockCi / d1Verdict: fark = sinyal − kendi plasebo ortalaması; aralık belirlenimci; kural iki dilim + bir ufuk', () => {
  const rows = Array.from({ length: 120 }, (_, k) => ({ day: k % 40, sig: { ret: 1, mfe: 2, mae: 1 }, pla: [{ ret: 0, mfe: 1, mae: 1 }, { ret: 0.5, mfe: 1, mae: 1 }] }));
  const c = d1Cell(rows);
  assert.equal(c.n, 120); assert.equal(c.draws, 240); assert.equal(c.inconclusive, false);
  assert.equal(c.diff.ret, 0.75); assert.equal(c.signal.eRatio, 2); assert.equal(c.placebo.eRatio, 1);
  assert.deepEqual(c.diff.retCi90, [0.75, 0.75]);
  const items = Array.from({ length: 200 }, (_, k) => ({ day: k % 50, v: (k % 7) - 3 }));
  assert.deepEqual(blockCi(items), blockCi(items));
  const ci = blockCi(items); assert.ok(ci[0] <= ci[1]);
  assert.equal(blockCi([{ day: 1, v: 1 }]), null);
  const cell = (lo) => ({ diff: { retCi90: [lo, lo + 1] }, inconclusive: false });
  assert.equal(d1Verdict({ 6: cell(0.1), 12: cell(-1), 24: cell(-1) }, { 6: cell(0.05), 12: cell(-1), 24: cell(-1) }).verdict, 'bilgi var');
  assert.equal(d1Verdict({ 6: cell(0.1), 12: cell(-1), 24: cell(-1) }, { 6: cell(-0.01), 12: cell(0.2), 24: cell(-1) }).verdict, 'yön bilgisi yok'); // farklı ufuklar
  assert.equal(d1Verdict({ 6: cell(0), 12: cell(0), 24: cell(0) }, { 6: cell(1), 12: cell(1), 24: cell(1) }).verdict, 'yön bilgisi yok'); // alt uç > 0 şart
});

test('halfHalfR: iki yarım pozisyon, payda 1R; dolmayan limit yarısı 0R', () => {
  assert.equal(halfHalfR(1, 2, true), 1.5);
  assert.equal(halfHalfR(1, 2, false), 0.5);
  assert.equal(halfHalfR(-1, -1, true), -1);
  assert.equal(halfHalfR(-1.1, 0, false), -0.55);
});

test('marketPlanOf: piyasa girişi, erken hedef yeni girişe aynı % uzaklıkta; ara kademe geçilirse yok', () => {
  const p = { d: 1, entry: 100, stop: 95, tp1: 101.2, missTp: 107.5, tpMid: 107.5, tp2: 112.5, inZone: false };
  const m = marketPlanOf(p, 104, 0.05);
  const e = 104 * 1.0005;
  assert.equal(m.inZone, true); assert.ok(Math.abs(m.tp1 - e * 1.012) < 1e-4); assert.equal(m.tpMid, 107.5); assert.equal(m.stop, 95);
  assert.equal(marketPlanOf(p, 107, 0.05).tpMid, null); // 107 × 1,012 > 107,5
  const s = marketPlanOf({ ...p, d: -1, entry: 100, stop: 105, tp1: 98.8, tpMid: 92.5, tp2: 87.5 }, 98, 0.05);
  assert.ok(Math.abs(s.tp1 - 98 * 0.9995 * 0.988) < 1e-4);
  // Motorla aynı giriş: piyasa yolunun dolum fiyatı = açılış × (1 + kayma)
  const cs = [bar(0, 104, 105, 103, 104), bar(1, 104, 110, 103, 109), bar(2, 109, 113, 108, 112)];
  const sim = simulateTrade(m, cs, 0, '4H', { ...BT_DEFAULTS, tp1Portion: 0.5, midPortion: 0.25 });
  assert.equal(sim.entryFill, +e.toPrecision(6));
});

test('postStopOf / tp1BeforeStop: stop mumundan sonra TP1 / girişe dönüş, stop ötesi aşım (R); ufuk dolmazsa null', () => {
  // long: giriş 100, stop 98, TP1 104; 1. mum stop (dip 97 → aşım 0,5R), sonra 2 mumda 101 ve 105
  const cs = [bar(0, 100, 100.5, 99, 99.5), bar(1, 99.5, 99.6, 97, 98.5), bar(2, 98.5, 101, 98.2, 100.8), bar(3, 100.8, 105, 100, 104.5)];
  const lv = { tp1: 104, entry: 100, stop: 98 };
  assert.deepEqual(postStopOf(cs, 1, 1, lv, 1), { tp1Hit: false, entryHit: true, overshootR: 0.5 });
  assert.deepEqual(postStopOf(cs, 1, 1, lv, 2), { tp1Hit: true, entryHit: true, overshootR: 0.5 });
  assert.equal(postStopOf(cs, 1, 1, lv, 3), null);
  // taban: dolum 0. mumda (piyasa) → 1. mumda stop önce
  assert.equal(tp1BeforeStop(cs, 0, 1, {}, lv, 4, { market: true }), false);
  assert.equal(tp1BeforeStop(cs, 2, 1, {}, lv, 2, { market: true }), true);
  assert.equal(tp1BeforeStop(cs, 2, 1, {}, lv, 1, { market: true }), false); // N içinde olay yok, ufuk dolu
  assert.equal(tp1BeforeStop(cs, 3, 1, {}, { ...lv, tp1: 200 }, 3, { market: true }), null); // ufuk dolmadı
});

test('maliyet: brüt (komisyon = kayma = 0) R > net R → costOf > 0; stop dilimleri', () => {
  const cs = [bar(0, 100, 100.5, 99.5, 100), bar(1, 100, 100.2, 96, 97)];
  const plan = { d: 1, entry: 100, stop: 98, tp1: 103, tp2: 105, atr: 1, inZone: true };
  const net = simulateTrade(plan, cs, 0, '4H', { ...BT_DEFAULTS, feePct: 0.05, slipPct: 0.05 });
  const gross = simulateTrade(plan, cs, 0, '4H', { ...BT_DEFAULTS, feePct: 0, slipPct: 0 });
  assert.equal(gross.R, -1); assert.ok(net.R < gross.R);
  assert.ok(costOf(gross.R, net.R) > 0);
  assert.equal(costOf(null, -1), null);
  assert.deepEqual([1.2, 1.5, 2.49, 2.5, 4, 7].map(stopBucket), ['a < %1,5', 'b %1,5–2,5', 'b %1,5–2,5', 'c %2,5–4', 'd > %4', 'd > %4']);
});

test('quantiles / splitDir: yüzdelik ve dilim × yön ayrımı', () => {
  assert.deepEqual(quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { p50: 6, p75: 8, p90: 10 });
  assert.deepEqual(quantiles([]), { p50: null, p75: null, p90: null });
  const items = [{ time: 1, d: 1 }, { time: 2, d: -1 }, { time: 5, d: 1 }];
  const r = splitDir(items, 3, (a) => a.length);
  assert.deepEqual(r, { train: { all: 2, long: 1, short: 1 }, valid: { all: 1, long: 1, short: 0 } });
});

test('plasebo A-eğilim: adaylar evren filtresiyle aynı üst TF kuralıyla süzülür (yön eşleşir; seri yoksa koşul yok)', async () => {
  const { trendMatch } = await import('../backtest/diag.js');
  const { horizonSeries, htfTrendAt, htfOk } = await import('../src/scan/regime.js');
  // 1D: 150 gün yükseliş, sonra 150 gün düşüş; 4H seri aynı dönemde
  const daily = Array.from({ length: 300 }, (_, k) => { const p = k < 150 ? 100 + k : 250 - (k - 150); return { time: k * DAY, open: p, high: p + 0.5, low: p - 0.5, close: p }; });
  const h = { hs: horizonSeries(daily), ms: DAY };
  const cs = Array.from({ length: 300 * 6 }, (_, k) => ({ time: k * H4, open: 100, high: 101, low: 99, close: 100 }));
  const i = 150 * 6; // dönüş noktası: ±30 günün yarısı yükseliş, yarısı düşüş
  const cand = placeboACandidates(cs, i, { days: 30 });
  const dirAt = (j) => htfTrendAt(h.hs, h.ms, cs[j].time + H4);
  const longC = cand.filter((j) => trendMatch(h, cs[j].time + H4, 1, 'with'));
  const shortC = cand.filter((j) => trendMatch(h, cs[j].time + H4, -1, 'with'));
  assert.ok(longC.length > 0 && longC.length < cand.length); assert.ok(shortC.length > 0 && shortC.length < cand.length);
  assert.ok(longC.every((j) => dirAt(j) === 'up')); assert.ok(shortC.every((j) => dirAt(j) === 'down'));
  assert.deepEqual(longC, cand.filter((j) => htfOk('with', dirAt(j), 1))); // passes ile aynı kural
  assert.ok(longC.some((j) => j < i) && shortC.some((j) => j > i)); // dönüşten önce yükseliş, sonra düşüş (eğilim gecikmeli)
  assert.equal(cand.filter((j) => trendMatch(null, cs[j].time + H4, 1)).length, cand.length); // seri yok → koşul yok
});
