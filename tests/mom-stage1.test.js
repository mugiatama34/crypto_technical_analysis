// Momentum aşama M1 (backtest/mom-stage1.js): HM2 ağırlıkları, HM3 sıralama penceresi (son 7 gün hariç), T = M0d hedgedWeekly,
// lock 0'da kasa alanı yok, lock 0 / 1 geliştirme sonuçları aynı, geçme mantığı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invVolWeights, dailyStd, rowReport, rowDefs, passOf, runStage1, splitWeeklyW, eqRiskWeight } from '../backtest/mom-stage1.js';
import { variantReport, prepSeries, splitWeekly, lockedLeaks, DEV_START, LOCK_START, DAY } from '../backtest/mom-diag.js';
import { momentumAt, runXsMom, XS_DEFAULTS } from '../backtest/lab/xsmom.js';
import { mulberry32 } from '../backtest/report.js';

function synth(t0, days, nCoins = 20, seed = 7) {
  const rnd = mulberry32(seed), out = [];
  for (let k = 0; k <= nCoins; k++) {
    const coin = k === 0 ? 'BTC' : `S${k}`; let p = 10 + k; const cs = [];
    const drift = (rnd() - 0.5) * 0.01, vol = 0.02 + 0.06 * rnd();
    for (let t = 0; t < days; t++) { const o = p; p = p * (1 + drift + (rnd() - 0.5) * vol); cs.push({ time: t0 + t * DAY, open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p, volume: 1, quoteVol: 1e6 * (1 + rnd()) * (nCoins - k + 1) }); }
    out.push({ coin, candles: cs });
  }
  return out;
}

test('HM2 ağırlıkları: toplam = seçim sayısı (toplam nominal korunur), yüksek oynaklık → küçük nominal, σ yoksa ortalama', () => {
  const w = invVolWeights([{ coin: 'A', sigma: 0.02 }, { coin: 'B', sigma: 0.04 }, { coin: 'C', sigma: 0.08 }]);
  assert.ok(Math.abs([...w.values()].reduce((a, b) => a + b, 0) - 3) < 1e-12);
  assert.ok(w.get('A') > w.get('B') && w.get('B') > w.get('C'));
  assert.ok(Math.abs(w.get('A') / w.get('C') - 4) < 1e-12);
  const w2 = invVolWeights([{ coin: 'A', sigma: 0.02 }, { coin: 'B', sigma: null }]);
  assert.ok(Math.abs(w2.get('A') - 1) < 1e-12 && Math.abs(w2.get('B') - 1) < 1e-12);
  // σ yalnız ≤ i mumlarından: 28 getiri
  const c = Array.from({ length: 40 }, (_, k) => ({ close: k % 2 ? 1.1 : 1 }));
  assert.ok(dailyStd(c, 28) > 0); assert.equal(dailyStd(c, 27), null);
  // Ağırlıklı haftalık: ağırlık 2 → katkılar iki kat
  const S = prepSeries(synth(DEV_START, 120, 3)), by = new Map(S.map((s) => [s.coin, s]));
  const tr = runXsMom(synth(DEV_START, 120, 3), {}, { startMs: DEV_START }, { lookback: 28, k: 1, side: 'short', rank: 'rel' }).slice(0, 3);
  const o = { slots: 1, fee: 0.0005, slip: 0.0005, dataEnd: DEV_START + 119 * DAY, hedge: true };
  const a = splitWeeklyW(tr, by, o), b = splitWeeklyW(tr, by, { ...o, weightOf: () => 2 });
  for (const [w, x] of a.weeks) { assert.ok(Math.abs(b.weeks.get(w).ret - 2 * x.ret) < 1e-12); assert.ok(Math.abs(b.weeks.get(w).hedged - 2 * x.hedged) < 1e-12); }
  // Canlı eşit risk: risk %20 → 0,5; risk %5 → üst sınır 1
  assert.ok(Math.abs(eqRiskWeight({ entry: 10, stop: 12 }) - 0.5) < 1e-12); assert.equal(eqRiskWeight({ entry: 10, stop: 10.5 }), 1);
});

test('HM3 sıralama penceresi: close[t−7] / close[t−28] − 1; son 7 gün değişse de sıralama aynı', () => {
  const cs = Array.from({ length: 60 }, (_, k) => ({ close: 100 + k, high: 101 + k, low: 99 + k }));
  const atr = cs.map(() => 1), p = { ...XS_DEFAULTS, lookback: 28, skip: 7 };
  assert.equal(momentumAt('X', cs, 55, atr, p, 1).r, (100 + 48) / (100 + 27) - 1);
  const cs2 = cs.map((c, k) => (k > 48 ? { ...c, close: c.close * 3 } : c));
  assert.equal(momentumAt('X', cs2, 55, atr, p, 1).r, momentumAt('X', cs, 55, atr, p, 1).r);
  assert.notEqual(momentumAt('X', cs2, 55, atr, { ...p, skip: 0 }, 1).r, momentumAt('X', cs, 55, atr, { ...p, skip: 0 }, 1).r);
  assert.equal(momentumAt('X', cs, 55, atr, { ...XS_DEFAULTS }, 1).r, (100 + 55) / (100 + 27) - 1); // varsayılan değişmedi
  assert.equal(momentumAt('X', cs, 55, atr, { ...XS_DEFAULTS, lookback: 14, skip: 7 }, 1).r, (100 + 48) / (100 + 41) - 1); // L 14: t−14 → t−7
});

test('T = M0d variantReport hedgedWeekly (aynı sentetik veri, birebir); ağırlık 1 = splitWeekly', () => {
  const series = synth(DEV_START, 300);
  const dataEnd = DEV_START + 299 * DAY, split = DEV_START + (300 * DAY * 2) / 3;
  const T = rowReport(series, rowDefs(28).T, { startMs: DEV_START, dataEnd, split, pitN: 50, ci: { reps: 200 } });
  const tr = runXsMom(series, { feePct: 0.05, slipPct: 0.05, fundingPct8h: 0.01 }, { btcDaily: series[0].candles, startMs: DEV_START, pitN: 50 }, { lookback: 28, k: 5, side: 'short', rank: 'rel' });
  const S = prepSeries(series), by = new Map(S.map((s) => [s.coin, s]));
  const M = variantReport(tr, by, { slots: 5, fee: 0.0005, slip: 0.0005, dataEnd, split, hedge: true, ci: { reps: 200 } });
  for (const sp of ['train', 'valid', 'all']) {
    const { worstWeekPct, trades, avgR, worstTradePct, worstTradeHedgedPct, legs, ...w } = T[sp];
    assert.deepEqual(w, M[sp].hedgedWeekly, sp);
    assert.equal(trades, M[sp].hedgedTrades.n); assert.equal(avgR, M[sp].hedgedTrades.avgR);
  }
  const a = splitWeekly(tr, by, { slots: 5, fee: 0.0005, slip: 0.0005, dataEnd, hedge: true }), b = splitWeeklyW(tr, by, { slots: 5, fee: 0.0005, slip: 0.0005, dataEnd, hedge: true });
  assert.deepEqual([...a.weeks.entries()], [...b.weeks.entries()]);
  // HM2: aynı işlemler, haftalık short nominali toplamı T ile aynı → ağırlıklar ortalamada 1
  const H = rowReport(series, rowDefs(28).HM2, { startMs: DEV_START, dataEnd, split, pitN: 50, ci: { reps: 200 } });
  assert.equal(H.trades, T.trades); assert.notEqual(H.all.meanPct, T.all.meanPct);
});

test('geçme mantığı: elle kurulmuş sayılar', () => {
  const sl = (meanPct, sharpe, lo = 0.1) => ({ meanPct, sharpe, ci90: [lo, 1] });
  const row = (tr, va) => ({ L28: { train: tr, valid: va, all: tr } });
  const dev = { T: row(sl(1, 1), sl(1, 1.5)), HM1: row(sl(0.5, 1.2), sl(0.4, 1.6)), HM2: row(sl(0.5, 0.9), sl(0.4, 2)), HM3: row(sl(-0.1, 2), sl(0.4, 2)) };
  const raw = { T: { L14: [1], L56: [-1, 0.5] }, HM1: { L14: [0.2], L56: [0.1] }, HM2: { L14: [1], L56: [1] }, HM3: { L14: [1], L56: [1] } };
  const p0 = passOf(dev, null, raw, null, 0);
  assert.equal(p0.HM1.devPass, true); assert.equal(p0.HM2.devPass, false); assert.equal(p0.HM3.devPass, false);
  assert.equal(p0.HM1.pass, null); assert.equal(p0.T.pass, null); assert.equal(p0.T.plateauPositive, false);
  const kasa = { T: { L28: { all: sl(0.2, 0.6, 0.01) } }, HM1: { L28: { all: sl(0.3, 0.7, 0.02) } }, HM2: { L28: { all: sl(0.3, 0.5, 0.02) } }, HM3: { L28: { all: sl(0.3, 0.9, -0.1) } } };
  const rawK = { T: { L14: [0], L56: [0] }, HM1: { L14: [-0.1], L56: [-5] }, HM2: { L14: [0], L56: [0] }, HM3: { L14: [0], L56: [0] } };
  const p1 = passOf(dev, kasa, raw, rawK, 1);
  assert.equal(p1.T.kasaPass, true); assert.equal(p1.T.pass, true);
  assert.equal(p1.HM1.kasaPass, true); assert.equal(p1.HM1.plateauPositive, false); assert.equal(p1.HM1.pass, false); // L56 kasa ile negatif
  assert.equal(p1.HM2.kasaPass, false); // Sharpe ≤ T
  assert.equal(p1.HM3.kasaPass, false); // alt uç ≤ 0
  assert.equal(passOf(dev, { ...kasa, T: { L28: { all: sl(0.2, 0.4) } } }, raw, rawK, 1).T.pass, false); // Sharpe < 0,5
});

test('uçtan uca: lock 0 kasa alanı yok, sızıntı yok; lock 1 kasa dahil; geliştirme sonuçları aynı', () => {
  const dev = synth(DEV_START, 260), kasa = synth(LOCK_START - 100 * DAY, 100 + 731, 20, 11);
  const lockedTimes = new Map(kasa.map((s) => [s.coin, s.candles.map((c) => c.time)]));
  const now = DEV_START + 260 * DAY, ci = { reps: 100 };
  const o0 = runStage1({ devSeries: dev, lockedTimes, now, lock: 0, ci });
  const o1 = runStage1({ devSeries: dev, kasaSeries: kasa, lockedTimes, now, lock: 1, ci });
  assert.ok(!('kasa' in o0) && !('kasaInfo' in o0));
  assert.deepEqual(lockedLeaks(o0), []);
  assert.ok(o0.pass.HM1.kasaPass === null && o0.pass.T.pass === null);
  assert.ok(o1.kasa.T.L28.all && o1.kasa.T.L28.all.weeks > 90);
  assert.ok(lockedLeaks(o1).length > 0); // kasa sonuçları gerçekten kasa döneminde
  assert.deepEqual(o0.dev, o1.dev); assert.deepEqual(o0.info, o1.info);
  for (const id of ['HM1', 'HM2', 'HM3']) assert.equal(o0.pass[id].devPass, o1.pass[id].devPass);
  assert.equal(o0.sanity.available, false);
  assert.ok(o0.meta.lockedAvailability.rebalances > 100);
  assert.throws(() => runStage1({ devSeries: dev, kasaSeries: kasa, now, lock: 0 }), /lock 0/);
  assert.throws(() => runStage1({ devSeries: kasa, now, lock: 0 }), /kasa/);
});
