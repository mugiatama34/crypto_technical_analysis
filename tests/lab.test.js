import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';
import { engineWide4hLong, meanrev4hLong, donchian, donchian4hLong, donchian4hLongHtf, dailyTrendAt, meanrev, meanrevLong, sweepReclaim, engineWide, STRATEGIES } from '../backtest/lab/strategies.js';
import { runStrategy, report } from '../backtest/lab/run.mjs';

const c = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0 };

/** Dalgalı taban + güçlü trend: trend izleme sinyalleri üretir. */
function trendSeries(n = 400, dir = 1, start = 100) {
  const out = []; let p = start;
  for (let i = 0; i < n; i++) {
    const drift = i < 150 ? 0 : dir * 0.6; // ilk 150 mum yatay, sonra trend
    const w = Math.sin(i * 0.9) * 0.8;
    const open = p, close = p + drift + w; p = close;
    out.push(c(i * 3600e3, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close));
  }
  return out;
}

test('trail_only şeması: hedef yok, stop girişten itibaren ATR ile izler, kâr kilitlenir', () => {
  const plan = { d: 1, direction: 'long', entry: 100, stop: 96, tp1: null, tp2: null, inZone: true, atr: 2, price: 100 };
  const cs = [c(1, 100, 101, 99, 100), c(2, 100, 105, 99.5, 104), c(3, 104, 110, 103, 109), c(4, 109, 109.5, 104, 104.5)];
  const r = simulateTrade(plan, cs, 0, '1H', { ...o, tpScheme: 'trail_only', trailAtr: 2 });
  // mum3 kapanış 109 → stop 105; mum4 düşük 104 ≤ 105 → stop 105'ten çıkış: (105−100)/4 = 1.25R
  assert.equal(r.outcome, 'stopped');
  assert.ok(Math.abs(r.R - 1.25) < 1e-9, `R ${r.R}`);
});

test('donchian: yükselen trendde long sinyal verir, yatay seride vermez', () => {
  const up = trendSeries(400, 1);
  const trades = runStrategy(donchian, { coin: 'T', tf: '1H', candles: up }, o);
  assert.ok(trades.length >= 1, 'sinyal bekleniyordu');
  assert.ok(trades.every((t) => t.direction === 'long'));
  assert.ok(trades.some((t) => t.R > 0), 'trendde en az bir kârlı işlem bekleniyordu');
  const flat = trendSeries(400, 0);
  assert.equal(runStrategy(donchian, { coin: 'T', tf: '1H', candles: flat }, o).length, 0);
});

test('meanrev: EMA200 üstünde EMA20\'den derin sapma → long, hedef EMA20', () => {
  const cs = trendSeries(400, 1);
  // 350. mumda sert düşüş ve toparlanma
  for (let i = 350; i < 356; i++) { const d = (i - 349) * 3; cs[i] = c(cs[i].time, cs[i].open - d, cs[i].high - d, cs[i].low - d - 1, cs[i].close - d - 1); }
  for (let i = 356; i < 400; i++) { const k = cs[i - 1].close + 1.5; cs[i] = c(cs[i].time, cs[i - 1].close, k + 0.5, cs[i - 1].close - 0.5, k); }
  const trades = runStrategy(meanrev, { coin: 'T', tf: '4H', candles: cs }, o);
  assert.ok(trades.length >= 1);
  assert.equal(trades[0].direction, 'long');
  assert.ok(trades[0].tp2 > trades[0].entry, 'hedef EMA20 girişin üstünde');
});

test('sweep_reclaim: eşit dipler süpürülüp geri alınınca long; stop fitil altı; TP ≥ 2R', () => {
  const cs = [];
  let t = 0;
  const push = (o_, h, l, cl) => cs.push(c(t++ * 900e3, o_, h, l, cl));
  for (let k = 0; k < 6; k++) { // 6 kez aynı dip (100) ve toparlanma
    for (let i = 0; i < 8; i++) push(104 - i * 0.5, 104.3 - i * 0.5, 103.5 - i * 0.5, 103.5 - i * 0.5);
    push(100.4, 100.6, 100.0, 100.3);
    for (let i = 0; i < 8; i++) push(100.5 + i * 0.5, 101 + i * 0.5, 100.2 + i * 0.5, 101 + i * 0.5);
  }
  push(104, 104.2, 103.4, 103.5); push(103.5, 103.6, 102.5, 102.6); push(102.6, 102.7, 101.5, 101.6); push(101.6, 101.7, 100.6, 100.7);
  push(100.7, 100.9, 99.3, 100.6); // süpürme: fitil 100'ün altına, kapanış üstünde
  for (let i = 0; i < 30; i++) push(100.6 + i * 0.4, 101.2 + i * 0.4, 100.3 + i * 0.4, 101 + i * 0.4);
  const trades = runStrategy(sweepReclaim, { coin: 'T', tf: '15m', candles: cs }, o);
  assert.ok(trades.length >= 1, 'süpürme sinyali bekleniyordu');
  const tr = trades.find((x) => x.direction === 'long');
  assert.ok(tr, 'long bekleniyordu');
  assert.ok(tr.stop < 99.3);
  assert.ok((tr.tp1 - tr.entry) / (tr.entry - tr.stop) >= 1.99);
});

test('engine_wide: motor planından 2 ATR stop ile sinyal üretir ya da sessiz kalır (hata yok)', () => {
  const trades = runStrategy(engineWide, { coin: 'T', tf: '1H', candles: trendSeries(450, 1) }, o);
  for (const t of trades) assert.ok(Math.abs(t.entry - t.stop) > 0 && t.tp1 == null);
});

test('report: eğitim/doğrulama bölünmesi, kırılımlar ve eğri; aday ölçütü', () => {
  const trades = runStrategy(donchian, { coin: 'T', tf: '1H', candles: trendSeries(400, 1) }, o);
  const rep = report(trades, 200 * 3600e3);
  assert.equal(rep.train.n + rep.valid.n, rep.all.n);
  assert.ok(rep.byTf['1H'].train && rep.byTf['1H'].valid && rep.byDirection.long.all && rep.byTfDir['1H long']);
  assert.equal(rep.byTf['1H'].train.n + rep.byTf['1H'].valid.n, rep.byTf['1H'].all.n);
  assert.equal(rep.curve.length, rep.all.n);
  assert.equal(STRATEGIES.length, 13);
});

test('donchian_4h_long: yükselen trendde long verir, düşen trendde sessiz; günlük filtre geleceğe bakmaz', () => {
  const up = trendSeries(400, 1).map((c_) => ({ ...c_, time: c_.time * 4 }));
  assert.ok(runStrategy(donchian4hLong, { coin: 'T', tf: '4H', candles: up }, o).length >= 1);
  const down = trendSeries(400, -1, 400).map((c_) => ({ ...c_, time: c_.time * 4 }));
  assert.equal(runStrategy(donchian4hLong, { coin: 'T', tf: '4H', candles: down }, o).length, 0);
  assert.equal(runStrategy(meanrevLong, { coin: 'T', tf: '4H', candles: down }, o).filter((t) => t.direction === 'short').length, 0);
  assert.equal(runStrategy(meanrev4hLong, { coin: 'T', tf: '4H', candles: down }, o).filter((t) => t.direction === 'short').length, 0);
  assert.equal(runStrategy(engineWide4hLong, { coin: 'T', tf: '4H', candles: trendSeries(450, -1, 400) }, o).filter((t) => t.direction === 'short').length, 0);
  // günlük: 60 gün, ilk 55 gün düşüş, sonra yükseliş → EMA50 altı; up=false
  const daily = Array.from({ length: 60 }, (_, i) => c(i * 86400e3, 0, 0, 0, i < 55 ? 200 - i : 150 + (i - 55) * 2));
  assert.equal(dailyTrendAt(daily, 59 * 86400e3 + 3600e3).up, false);
  assert.equal(dailyTrendAt(daily, 10 * 86400e3), null); // EMA50 henüz yok
  assert.equal(dailyTrendAt(daily, 55 * 86400e3 + 7200e3).close, 200 - 54); // o güne kadar KAPANMIŞ son gün
  assert.equal(runStrategy(donchian4hLongHtf, { coin: 'T', tf: '4H', candles: up, extra: { daily: null } }, o).length, 0);
});

test('diyagonal: kural motoru geçerliliği, bitiş planı (throw-over → short, TP1 ≥ 2R), başlangıç planı (%61,8 limit)', async () => {
  const { validDiagonal, endingPlan, leadingPlan, endingDiagonal, leadingDiagonal } = await import('../backtest/lab/diagonal.js');
  const pts = [[0, 100], [10, 104], [14, 101.5], [24, 105], [28, 103.2], [36, 106]].map(([i, price]) => ({ i, price }));
  assert.ok(validDiagonal(pts, 'ending') && validDiagonal(pts, 'leading'));
  assert.equal(validDiagonal([[0, 100], [10, 104], [14, 101], [24, 105.6], [28, 103.2], [36, 106.6]].map(([i, price]) => ({ i, price })), 'ending'), null); // 3 > 1: kama değil
  const cOver = { i: 36, open: 105.3, high: 106, low: 104.9, close: 105.0 }; // fitil 1-3 çizgisi üstünde, gövde içeride
  const e = endingPlan(pts, cOver, 0.6, 15);
  assert.equal(e.direction, 'short'); assert.equal(e.tp1, 100); assert.ok(e.stop > 106 && e.rr1 >= 2);
  assert.equal(endingPlan(pts, { ...cOver, close: 105.9 }, 0.6, 15), null); // gövde dışarıda kapandı: gerçek kırılım, tuzak değil
  const { endingDiagonalWide } = await import('../backtest/lab/diagonal.js');
  const w = endingPlan(pts, cOver, 0.6, 15, endingDiagonalWide.o);
  assert.ok(w && Math.abs(w.stop - (106 + 0.6)) < 1e-6 && w.rr1 >= 2); // stop uç + 1 ATR
  assert.equal(endingDiagonalWide.prepare([], '4H').o.bufferAtr, 1.0);
  assert.equal(endingPlan(pts, cOver, 0.6, 2), null); // önceki trend küçük: trend sonu değil
  const l = leadingPlan(pts, 0.6, true);
  assert.equal(l.direction, 'long'); assert.ok(Math.abs(l.entry - (106 - 0.618 * 6)) < 1e-6); assert.ok(l.stop < 100 && l.tp1 === 106 && l.tp2 > 110);
  assert.equal(leadingPlan(pts, 0.6, false), null); // 0 noktası önceki trendin ucu değil
  // Tam akış: rastgele seride hata vermez
  const { randomWalk } = await import('./helpers.js');
  const cs = randomWalk(500, 7);
  for (const st of [endingDiagonal, leadingDiagonal]) for (const t of runStrategy(st, { coin: 'T', tf: '4H', candles: cs }, o)) assert.ok(t.kind && Math.abs(t.entry - t.stop) > 0);
});
