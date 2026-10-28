import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';
import { stats } from '../backtest/report.js';
import { regimeUp, engineWide4hLongBtc, donchian4hLongBtc, engineWide4hLong, meanrev4hLong, donchian, donchian4hLong, donchian4hLongHtf, dailyTrendAt, meanrev, meanrevLong, sweepReclaim, engineWide, STRATEGIES } from '../backtest/lab/strategies.js';
import { runStrategy, report, robustStats, acceptance, btcBeta, attachBtc } from '../backtest/lab/run.mjs';
import { fibClusterC, fibClusterCStrict } from '../backtest/lab/corrections.js';
import { sweepMssFvg, sweepMssFvgHtf, sweepMssFvg1r, prevDayLevels, fvgInLeg } from '../backtest/lab/smc.js';
import { build } from './helpers.js';

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
  const sum = (m) => Object.values(m).reduce((a, x) => a + x.all.n, 0);
  assert.equal(sum(rep.bySession), rep.all.n); assert.equal(sum(rep.byWeekpart), rep.all.n);
  assert.equal(STRATEGIES.length, 49);
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

test('sağlamlık: en iyi ay atılınca ort. R düşer; sıkı kabul eğitim + sağlamlık ister; rejim filtresi', () => {
  const M = 31 * 86400e3; // ay sınırlarını kesin aş
  const mk_ = (m, R) => ({ time: m * M + 1, outcome: 'stopped', R });
  const valid = [mk_(0, -1), mk_(0, -1), mk_(1, 3), mk_(1, 3), mk_(2, -0.5), mk_(2, 0.5)];
  const rb = robustStats(valid);
  assert.equal(rb.droppedMonth, new Date(1 * M + 1).toISOString().slice(0, 7));
  assert.ok(rb.avgR < 0 && stats(valid).avgR > 0);
  const good = { n: 150, avgR: 0.2, profitFactor: 1.5 };
  assert.deepEqual(acceptance({ train: { avgR: 0.1 }, valid: good, robust: { avgR: 0.05 } }), { candidate: true, weak: false });
  assert.deepEqual(acceptance({ train: { avgR: -0.1 }, valid: good, robust: { avgR: 0.05 } }), { candidate: false, weak: true }); // eğitimde kenar yok
  assert.deepEqual(acceptance({ train: { avgR: 0.1 }, valid: good, robust: { avgR: -0.05 } }), { candidate: false, weak: true }); // tek aya bağlı
  // rejim: BTC günlük 60 gün, ilk 55 düşüş → up=false; rejim yokken sinyal yok
  const btc = Array.from({ length: 60 }, (_, i) => c(i * 86400e3, 0, 0, 0, i < 55 ? 200 - i : 150 + (i - 55) * 2));
  assert.equal(regimeUp(btc, 59 * 86400e3 + 3600e3), false);
  assert.equal(regimeUp(null, 1), false);
  const up = trendSeries(400, 1).map((c_) => ({ ...c_, time: c_.time * 4 }));
  assert.equal(runStrategy(donchian4hLongBtc, { coin: 'T', tf: '4H', candles: up, extra: { btcDaily: null } }, o).length, 0);
  const btcUp = Array.from({ length: 120 }, (_, i) => c(i * 86400e3, 0, 0, 0, 100 + i));
  assert.ok(runStrategy(donchian4hLongBtc, { coin: 'T', tf: '4H', candles: up, extra: { btcDaily: btcUp } }, o).length >= 1);
  assert.ok(engineWide4hLongBtc.needs.includes('BTC1D'));
});

test('kesitsel momentum: güçlü coinler long, zayıflar ls short; geleceğe bakmaz; kıyas hesaplanır', async () => {
  const { runXsMom, portfolioOf, benchmarks, XS_STRATEGIES } = await import('../backtest/lab/xsmom.js');
  const DAY = 86400e3, T0 = Date.UTC(2025, 0, 5); // pazar
  const mkCoin = (coin, drift, n = 200) => {
    const out = []; let p = 100;
    for (let i = 0; i < n; i++) { const w = Math.sin(i * 0.7 + drift * 900) * 0.01; const open = p; p = p * (1 + drift + w); out.push(c(T0 + i * DAY, open, Math.max(open, p) * 1.005, Math.min(open, p) * 0.995, p)); }
    return { coin, candles: out };
  };
  const coins = Array.from({ length: 12 }, (_, i) => mkCoin(i === 11 ? 'BTC' : `C${i}`, (i - 5) * 0.002));
  const oo = { feePct: 0.05, slipPct: 0.05 };
  const tr = runXsMom(coins, oo, {}, { lookback: 28, k: 3 });
  assert.ok(tr.length > 0 && tr.every((t) => t.direction === 'long'));
  const held = new Set(tr.map((t) => t.coin));
  assert.ok(held.has('BTC') || held.has('C10'), 'en güçlü coinler tutulmalı');
  assert.ok(!held.has('C0') && !held.has('C1'), 'düşen coinler long alınmaz (mutlak momentum)');
  for (const t of tr) assert.ok(t.entryTime > t.time, 'giriş sinyalden sonraki gün açılışında');
  const ls = runXsMom(coins, oo, {}, { lookback: 28, k: 3, side: 'ls' });
  assert.ok(ls.some((t) => t.direction === 'short' && ['C0', 'C1', 'C2'].includes(t.coin)));
  // Geleceğe bakmama: son 40 günü bozunca, kesimden 8+ gün önce açılan işlemlerin girişleri değişmez
  const cut = T0 + 150 * DAY;
  const broken = coins.map((s) => ({ coin: s.coin, candles: s.candles.map((x) => (x.time > cut ? { ...x, open: x.open * 3, high: x.high * 3, low: x.low * 3, close: x.close * 3 } : x)) }));
  const tr2 = runXsMom(broken, oo, {}, { lookback: 28, k: 3 });
  const key = (t) => `${t.coin}|${t.entryTime}|${t.entry}`;
  const early = (arr) => arr.filter((t) => t.entryTime < cut - 8 * DAY).map(key).sort();
  assert.deepEqual(early(tr2), early(tr));
  // BTC rejimi kapalıysa (veri yok) long yok
  assert.equal(runXsMom(coins, oo, { btcDaily: null }, { lookback: 28, k: 3, btcRegime: true }).length, 0);
  const pf = portfolioOf(tr, 3, T0 + 120 * DAY);
  assert.ok(Math.abs(pf.trainPct + pf.validPct - pf.totalPct) < 0.2);
  const bm = benchmarks(coins, T0 + 30 * DAY, T0 + 120 * DAY, T0 + 199 * DAY);
  assert.ok(bm.btc.total > 0 && bm.ew.total != null);
  assert.equal(XS_STRATEGIES.length, 7);
});

test('dönem evreni: o tarihte hacmi düşük coin sıralamaya girmez; eğitim sağlamlığı kabulü etkiler', async () => {
  const { runXsMom } = await import('../backtest/lab/xsmom.js');
  const DAY = 86400e3, T0 = Date.UTC(2025, 0, 5);
  const mkCoin = (coin, drift, volFn) => {
    const out = []; let p = 100;
    for (let i = 0; i < 200; i++) { const open = p; p = p * (1 + drift + Math.sin(i * 0.7) * 0.004); out.push({ time: T0 + i * DAY, open, high: Math.max(open, p) * 1.003, low: Math.min(open, p) * 0.997, close: p, volume: 1, quoteVol: volFn(i) }); }
    return { coin, candles: out };
  };
  // ROCKET en güçlü ama ilk 120 gün hacmi çok düşük (o dönemde küçük coin), sonra büyüyor
  const coins = [mkCoin('ROCKET', 0.012, (i) => (i < 120 ? 1 : 1e9)), ...Array.from({ length: 9 }, (_, j) => mkCoin(`C${j}`, 0.001 * j, () => 1e6 + j))];
  const oo = { feePct: 0, slipPct: 0 };
  const today = runXsMom(coins, oo, {}, { lookback: 28, k: 2 });
  const pitRun = runXsMom(coins, oo, { pitN: 5 }, { lookback: 28, k: 2 });
  const early = (arr) => arr.filter((t) => t.coin === 'ROCKET' && t.time < T0 + 120 * DAY).length;
  assert.ok(early(today) > 0, 'bugünün evreninde erken dönemde ROCKET alınır (yanlılık)');
  assert.equal(early(pitRun), 0, 'dönem evreninde o tarihte küçük olan coin alınmaz');
  assert.ok(pitRun.some((t) => t.coin === 'ROCKET' && t.time >= T0 + 120 * DAY), 'hacmi büyüyünce evrene girer');
  const good = { n: 150, avgR: 0.2, profitFactor: 1.5 };
  assert.equal(acceptance({ train: { avgR: 0.1 }, valid: good, robust: { avgR: 0.05 }, robustTrain: { avgR: -0.1 } }).candidate, false);
  assert.equal(acceptance({ train: { avgR: 0.1 }, valid: good, robust: { avgR: 0.05 }, robustTrain: { avgR: 0.02 } }).candidate, true);
});

test('momentum: fonlama R\'yi düşürür; yalnız-short varyantı; selectAt ortak kural', async () => {
  const { runXsMom, selectAt } = await import('../backtest/lab/xsmom.js');
  const DAY = 86400e3, T0 = Date.UTC(2025, 0, 5);
  const mkCoin = (coin, drift) => { const out = []; let p = 100; for (let i = 0; i < 200; i++) { const open = p; p = p * (1 + drift + Math.sin(i * 0.7 + drift * 900) * 0.01); out.push(c(T0 + i * DAY, open, Math.max(open, p) * 1.005, Math.min(open, p) * 0.995, p)); } return { coin, candles: out }; };
  const coins = Array.from({ length: 12 }, (_, i) => mkCoin(`C${i}`, (i - 5) * 0.002));
  const sum = (tr) => tr.reduce((a, t) => a + t.R, 0);
  const a = runXsMom(coins, { feePct: 0, slipPct: 0 }, {}, { lookback: 28, k: 3, fundingPct8h: 0 });
  const b = runXsMom(coins, { feePct: 0, slipPct: 0 }, {}, { lookback: 28, k: 3, fundingPct8h: 0.05 });
  assert.equal(a.length, b.length); assert.ok(sum(b) < sum(a));
  const sh = runXsMom(coins, { feePct: 0, slipPct: 0 }, {}, { lookback: 28, k: 3, side: 'short' });
  assert.ok(sh.length > 0 && sh.every((t) => t.direction === 'short'));
  const ranks = [['A', 0.5, 10], ['B', 0.2, 9], ['C', -0.1, 8], ['D', -0.4, 1], ['E', 0.1, 7], ['F', -0.2, 6]].map(([coin, r, vol]) => ({ coin, r, vol }));
  const p = { k: 2, side: 'ls', btcRegime: false };
  assert.deepEqual(selectAt(ranks, p), { longs: ['A', 'B'], shorts: ['F', 'D'] });
  assert.deepEqual(selectAt(ranks, p, { pitN: 4 }), { longs: ['A', 'B'], shorts: ['C'] }); // D hacimde dışarıda; F en zayıf ilk 4'te değil
  assert.equal(selectAt(ranks, p, { pitN: 3 }), null);
  assert.deepEqual(selectAt(ranks, { ...p, btcRegime: true }, { regimeOk: false }).longs, []);
});

test('BTC betası: R işaretli BTC getirisini izliyorsa beta ≈ 1; attachBtc tutma süresindeki BTC getirisini yazar; rel sıralama', async () => {
  const mk = (dir, btcPct, R) => ({ direction: dir, btcPct, R, outcome: 'stopped', time: 0 });
  const tr = [];
  for (let i = -10; i <= 10; i++) { tr.push(mk('long', i, i / 1)); tr.push(mk('short', i, -i)); } // R = işaretli BTC%
  const b = btcBeta(tr);
  assert.ok(Math.abs(b.beta - 1) < 1e-9 && Math.abs(b.corr - 1) < 1e-9);
  assert.equal(btcBeta(tr.slice(0, 5)).beta, null);
  const H = 3600e3;
  const btc = Array.from({ length: 50 }, (_, i) => ({ time: i * H, close: 100 + i }));
  const closeAt = (tf, t) => { let v = null; for (const c of btc) if (c.time <= t) v = c.close; return v; };
  const t = [{ tf: '1H', time: 10 * H, waitBars: 1, bars: 4, direction: 'long', R: 1, outcome: 'tp2' }, { tf: '1H', time: 10 * H, waitBars: 6, bars: 4, direction: 'long', R: 1, outcome: 'tp2', entry: 100, stop: 98 }];
  attachBtc(t, closeAt, 0);
  assert.ok(Math.abs(t[0].btcPct - ((115 / 111) - 1) * 100) < 0.01); // dolum 11. saat (sinyal + 1 mum), çıkış 15. saat
  assert.ok(Math.abs(t[1].btcPct - ((120 / 116) - 1) * 100) < 0.01); // limit: 6 mum bekleme → giriş 16. saat, çıkış 20.; bekleme hedge'e girmez
  assert.ok(Math.abs(t[1].hedgedR - (1 - (120 / 116 - 1) / 0.02)) < 0.01);
  const { runXsMom } = await import('../backtest/lab/xsmom.js');
  const DAY = 86400e3, T0 = Date.UTC(2025, 0, 5);
  const mkCoin = (coin, drift) => { const out = []; let p = 100; for (let i = 0; i < 200; i++) { const open = p; p = p * (1 + drift + Math.sin(i * 0.7 + drift * 900) * 0.01); out.push(c(T0 + i * DAY, open, Math.max(open, p) * 1.005, Math.min(open, p) * 0.995, p)); } return { coin, candles: out }; };
  // Herkes yükseliyor (BTC %0,8/gün); mutlak sıralamada short yok, rel sıralamada BTC'den yavaş yükselenler short
  const coins = [mkCoin('BTC', 0.008), ...Array.from({ length: 10 }, (_, i) => mkCoin(`C${i}`, 0.002 + i * 0.001))];
  const abs = runXsMom(coins, { feePct: 0, slipPct: 0 }, {}, { lookback: 28, k: 3, side: 'short' });
  const rel = runXsMom(coins, { feePct: 0, slipPct: 0 }, {}, { lookback: 28, k: 3, side: 'short', rank: 'rel' });
  assert.ok(abs.length < rel.length / 3, `mutlak ${abs.length} vs rel ${rel.length}`); assert.ok(rel.length > 0 && rel.every((x) => x.direction === 'short' && x.coin !== 'BTC'));
  assert.ok(rel.some((x) => ['C0', 'C1', 'C2'].includes(x.coin)));
});

test('hedge\'li R: eşit nominal ters BTC; long BTC +2% stop %4 → R − 0,5 − komisyon; short ayna; veri yoksa null', async () => {
  const { attachBtc, hedgedReport } = await import('../backtest/lab/run.mjs');
  const H = 3600e3;
  const btc = [{ time: 0, close: 100 }, { time: 10 * H, close: 100 }, { time: 15 * H, close: 102 }];
  const closeAt = (tf, t) => { if (t > 16 * H) return null; let v = null; for (const c of btc) if (c.time <= t) v = c.close; return v; }; // seri dışı: veri yok
  const mk = (direction, R) => ({ tf: '1H', time: 10 * H, waitBars: 1, bars: 4, direction, R, outcome: 'stopped', entry: 50, stop: direction === 'long' ? 48 : 52 });
  const t = [mk('long', 1), mk('short', -1), { ...mk('long', 0.5), tf: '4H', time: 999 * H }];
  attachBtc(t, closeAt, 0.05);
  const fee = 2 * 0.0005 / 0.04; // hedge komisyonu, R cinsinden
  assert.ok(Math.abs(t[0].hedgedR - (1 - 0.02 / 0.04 - fee)) < 0.002, `${t[0].hedgedR}`);
  assert.ok(Math.abs(t[1].hedgedR - (-1 + 0.02 / 0.04 - fee)) < 0.002, `${t[1].hedgedR}`);
  assert.equal(t[2].btcPct, null); assert.equal(t[2].hedgedR, null);
  const rep = hedgedReport(t, 12 * H);
  assert.equal(rep.all.n, 2); assert.equal(rep.train.n, 2); assert.equal(rep.valid.n, 0);
  assert.equal(rep.candidate, false);
});

test('btc_tsmom: düşen trendde short, yatay seride sessiz; yalnız BTC/ETH', async () => {
  const { btcTsmom1h, btcTsmom4h } = await import('../backtest/lab/strategies.js');
  assert.deepEqual(btcTsmom4h.coins, ['BTC', 'ETH']);
  const down = trendSeries(400, -1, 400);
  const tr = runStrategy(btcTsmom1h, { coin: 'BTC', tf: '1H', candles: down }, o);
  assert.ok(tr.length >= 1 && tr.every((t) => t.direction === 'short'));
  assert.equal(runStrategy(btcTsmom4h, { coin: 'BTC', tf: '4H', candles: trendSeries(400, 0) }, o).length, 0);
});

test('Ders 2: zigzag ve genişleyen flat planları dersin örnek seviyelerini verir; aynası short; geri kapanış yoksa sinyal yok', async () => {
  const { zigzagPlan, flatPlan } = await import('../backtest/lab/corrections.js');
  const P = (i, price) => ({ i, price });
  // Zigzag 2. dalga: (1) 100→110, A 105,5, B 107,8, C 103,3 (C = A, 0,618–0,786 bölgesi)
  const z = zigzagPlan([P(0, 100), P(20, 110), P(30, 105.5), P(36, 107.8), P(46, 103.3)], { i: 47, open: 103.4, high: 103.9, low: 103.35, close: 103.8 }, { high: 103.7, low: 103.3 }, 0.5);
  assert.equal(z.direction, 'long'); assert.equal(z.tp1, 110); assert.ok(z.stop < 102.2 && z.stop > 100 && z.rr1 >= 2 && Math.abs(z.tp2 - 119.48) < 0.01);
  const m = (x) => 200 - x; // ayna
  const zs = zigzagPlan([P(0, m(100)), P(20, m(110)), P(30, m(105.5)), P(36, m(107.8)), P(46, m(103.3))], { i: 47, open: m(103.4), high: m(103.35), low: m(103.9), close: m(103.8) }, { high: m(103.3), low: m(103.7) }, 0.5);
  assert.equal(zs.direction, 'short'); assert.equal(zs.tp1, m(110));
  // dönüş mumu yoksa (kapanış önceki tepenin altında) sinyal yok
  assert.equal(zigzagPlan([P(0, 100), P(20, 110), P(30, 105.5), P(36, 107.8), P(46, 103.3)], { i: 47, open: 103.4, high: 103.6, low: 103.35, close: 103.5 }, { high: 103.7, low: 103.3 }, 0.5), null);
  // Genişleyen flat 4. dalga: (3) 94→104, A 99, B 105,5, C 97,4; mum A dibinin üstüne geri kapanır
  const f = flatPlan([P(0, 94), P(20, 104), P(26, 99), P(32, 105.5), P(42, 97.4)], { i: 42, open: 98, high: 99.6, low: 97.4, close: 99.2 }, 0.6);
  assert.equal(f.direction, 'long'); assert.equal(f.tp1, 105.5); assert.ok(f.stop < 97.4 && f.rr1 >= 2 && f.tp2 > f.tp1);
  // kapanış A dibinin altında kalırsa (gerçek kırılım) sinyal yok
  assert.equal(flatPlan([P(0, 94), P(20, 104), P(26, 99), P(32, 105.5), P(42, 97.4)], { i: 42, open: 98, high: 98.6, low: 97.4, close: 98.2 }, 0.6), null);
  // B (3)'ün ucunu geçmediyse (genişleyen değil) sinyal yok
  assert.equal(flatPlan([P(0, 94), P(20, 104), P(26, 99), P(32, 103.5), P(42, 97.4)], { i: 42, open: 98, high: 99.6, low: 97.4, close: 99.2 }, 0.6), null);
});

test('pivotsAsOf: tüm seri ZigZag\'ının i anındaki kesiti, o ana kadarki mumlarla hesaplanan ZigZag ile aynı onaylı pivotlar', async () => {
  const { zigzag, fillAtr, pivotsAsOf } = await import('../src/core/zigzag.js');
  const I = await import('../src/data/indicators.js');
  const { randomWalk } = await import('./helpers.js');
  const cs = randomWalk(500, { seed: 11, step: 0.8 });
  const atr = fillAtr(I.atr(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), 14));
  const full = zigzag(cs, atr, 2);
  for (const i of [120, 250, 333, 499]) {
    const part = zigzag(cs.slice(0, i + 1), atr.slice(0, i + 1), 2);
    const v = pivotsAsOf(full, cs, i);
    assert.deepEqual(v.pivots.map((p) => [p.i, p.type]), part.pivots.map((p) => [p.i, p.type]), `i=${i}`);
    assert.equal(v.tentative?.i, part.tentative?.i, `tentative i=${i}`);
  }
});

test('Ders 2 varyantları: zigzag_c_1h_short yalnız short ve 1H; expanded_flat_c_wide stop C − 1 ATR, TP1 < 2R ise ret', async () => {
  const { zigzagC1hShort, expandedFlatCWide, flatPlan } = await import('../backtest/lab/corrections.js');
  assert.deepEqual(zigzagC1hShort.tfs, ['1H']);
  const P = (i, price) => ({ i, price });
  // long kurulumu (yükselen itki + aşağı zigzag) → short varyantı sinyal vermez; ayna → verir
  const longW = [P(0, 100), P(20, 110), P(30, 105.5), P(36, 107.8), P(46, 103.3)];
  const m = (x) => 200 - x, shortW = longW.map((q) => P(q.i, m(q.price)));
  const { zigzagPlan, zigzagC } = await import('../backtest/lab/corrections.js');
  // rastgele serilerde: temel aile iki yönü de üretebilir, short varyantı yalnız short üretir
  const { randomWalk } = await import('./helpers.js');
  let shorts = 0;
  for (const seed of [3, 5, 8, 13]) {
    const cs = randomWalk(1500, { seed, step: 0.7 });
    const tr = runStrategy(zigzagC1hShort, { coin: 'T', tf: '1H', candles: cs }, o);
    assert.ok(tr.every((t) => t.direction === 'short')); shorts += tr.length;
    assert.ok(runStrategy(zigzagC, { coin: 'T', tf: '1H', candles: cs }, o).filter((t) => t.direction === 'short').length >= tr.length);
  }
  assert.ok(shorts >= 0);
  assert.equal(zigzagPlan(longW, { i: 47, open: 103.4, high: 103.9, low: 103.35, close: 103.8 }, { high: 103.7, low: 103.3 }, 0.5).d, 1);
  assert.equal(zigzagPlan(shortW, { i: 47, open: m(103.4), high: m(103.35), low: m(103.9), close: m(103.8) }, { high: m(103.3), low: m(103.7) }, 0.5).d, -1);
  // geniş stop
  const fw = [P(0, 94), P(20, 104), P(26, 99), P(32, 105.5), P(42, 97.4)];
  const c = { i: 42, open: 98, high: 99.6, low: 97.4, close: 99.2 };
  const wide = flatPlan(fw, c, 0.6, expandedFlatCWide.o);
  assert.ok(Math.abs(wide.stop - (97.4 - 0.6)) < 1e-6 && wide.rr1 >= 2);
  assert.equal(flatPlan(fw, c, 2.0, expandedFlatCWide.o), null); // stop çok uzak → TP1 < 2R
  assert.equal(expandedFlatCWide.prepare([{ high: 1, low: 1, close: 1 }]).o.bufferAtr, 1.0);
});

test('fib_cluster_c: itki + ABC serisinde bölgeye limit plan (giriş 0,618×1,272, stop itki içinde, TP1 itki ucu); strict yalnız 0,618×1,272', () => {
  const cs = build([[0, 100], [60, 100], [72, 112], [80, 107], [86, 110.94], [90, 108.5]], { spread: 0.15 });
  const pre = fibClusterC.prepare(cs);
  let plan = null;
  for (let i = 80; i < cs.length && !plan; i++) plan = fibClusterC.signal(i, cs, pre);
  assert.ok(plan, 'plan yok');
  assert.equal(plan.direction, 'long'); assert.equal(plan.inZone, false); assert.equal(plan.kind, 'fib_cluster');
  assert.ok(Math.abs(plan.entry - 104.5) < 0.3); assert.ok(plan.stop > 100 && plan.stop < plan.entry); assert.ok(Math.abs(plan.tp1 - 112.15) < 0.2); assert.ok(plan.tp2 > plan.tp1);
  assert.ok(plan.rr1 >= 1.5);
  const pre2 = fibClusterCStrict.prepare(cs);
  let p2 = null; for (let i = 80; i < cs.length && !p2; i++) p2 = fibClusterCStrict.signal(i, cs, pre2);
  assert.ok(p2 && p2.retr === 0.618 && p2.ext === 1.272);
  assert.equal(fibClusterC.tfs.join(), '1H,4H');
});

test('sweep_mss_fvg: eşit tepe/PDH fitille süpürülür → kapanışla minör dip kırılır (MSS) → bacaktaki FVG %50 limit short; stop fitil ötesi; TP1 karşı likidite ≥ 2R; sizeMult', () => {
  // Taban 100, eşit tepeler 110 (bar 70, 85), dip 104, süpürme fitili 111,5 (bar 99), sert düşüş (FVG 106,4–109,4), MSS bar 102 (kapanış 103,2 < 103,8)
  const path = [[0, 100], [60, 100], [70, 110], [78, 104], [85, 110], [92, 104], [99, 109.5], [100, 109.8], [101, 109.6], [102, 106.2], [103, 103.2], [106, 102.5], [110, 108.2], [130, 99]];
  const cs = build(path, { spread: 0.2 }); cs[99].high = 111.5; cs[99].close = 109.8;
  assert.deepEqual(fvgInLeg(cs, 99, 102, -1, 0.3), { lo: 106.4, hi: cs[100].low, i: 102 });
  const { pdh } = prevDayLevels(cs); assert.ok(pdh[30] != null && pdh[23] == null); // ilk gün PDH yok
  const pre = sweepMssFvg.prepare(cs, '1H', {});
  let plan = null, at = -1;
  for (let i = 90; i < 110 && !plan; i++) { plan = sweepMssFvg.signal(i, cs, pre); at = i; }
  assert.ok(plan, 'plan yok'); assert.equal(at, 102); assert.equal(plan.direction, 'short'); assert.equal(plan.inZone, false);
  assert.ok(Math.abs(plan.entry - 107.9) < 0.01); assert.ok(plan.stop > 111.5 && plan.stop < 111.8); assert.ok(Math.abs(plan.tp1 - 99.8) < 0.01); assert.ok(plan.rr1 >= 2); assert.equal(plan.sizeMult, 1);
  // Dolum: bar 106–110 geri çekilme 108,2'ye (FVG ortası 107,9 dolar), sonra 99'a → TP1
  const tr = runStrategy(sweepMssFvg, { coin: 'T', tf: '1H', candles: cs }, o);
  assert.equal(tr.length, 1); assert.ok(['tp1_be', 'tp2', 'tp1_timeout'].includes(tr[0].outcome), tr[0].outcome); assert.ok(tr[0].R > 0.5);
  // Üst TF düşüşte iken aynı seri: short üst dilim yönünde → sizeMult 1; üst TF yükselişte → 0,5; htf='with' → plan yok
  const up = Array.from({ length: 200 }, (_, i) => ({ time: (i - 200) * 4 * 3600e3 + cs[0].time, open: 50 + i * 0.3, high: 50.6 + i * 0.3, low: 49.6 + i * 0.3, close: 50.3 + i * 0.3 }));
  const pre2 = sweepMssFvg.prepare(cs, '1H', { upper: up }); let p2 = null;
  for (let i = 90; i < 110 && !p2; i++) p2 = sweepMssFvg.signal(i, cs, pre2);
  assert.equal(p2.htf, 'up'); assert.equal(p2.sizeMult, 0.5);
  const tr2 = runStrategy(sweepMssFvg, { coin: 'T', tf: '1H', candles: cs, extra: { upper: up } }, o);
  assert.ok(Math.abs(tr2[0].R - tr[0].R * 0.5) < 0.01); assert.equal(tr2[0].sizeMult, 0.5);
  const pre3 = sweepMssFvgHtf.prepare(cs, '1H', { upper: up }); let p3 = null;
  for (let i = 90; i < 110 && !p3; i++) p3 = sweepMssFvgHtf.signal(i, cs, pre3);
  assert.equal(p3, null);
  // 1R varyantı: TP1 = giriş − 1R, TP2 = likidite
  const pre4 = sweepMssFvg1r.prepare(cs, '1H', {}); let p4 = null;
  for (let i = 90; i < 110 && !p4; i++) p4 = sweepMssFvg1r.signal(i, cs, pre4);
  assert.ok(Math.abs(p4.tp1 - (107.9 - (p4.stop - 107.9))) < 0.01); assert.ok(Math.abs(p4.tp2 - 99.8) < 0.01);
  // MSS olmadan (düşüş 104'ün altına kapanmaz) plan yok
  const cs5 = build([[0, 100], [60, 100], [70, 110], [78, 104], [85, 110], [92, 104], [99, 109.5], [100, 109.8], [101, 109.6], [102, 106.2], [103, 104.5], [120, 105]], { spread: 0.2 }); cs5[99].high = 111.5; cs5[99].close = 109.8;
  const pre5 = sweepMssFvg.prepare(cs5, '1H', {}); let p5 = null;
  for (let i = 90; i < 118 && !p5; i++) p5 = sweepMssFvg.signal(i, cs5, pre5);
  assert.equal(p5, null);
});

test('uyumsuzluk: regularDiv klasik boğa/ayı uyumsuzluğunu bulur, gösterge de yeni uç yapınca bulmaz', async () => {
  const { regularDiv } = await import('../backtest/lab/divergence.js');
  const rsi = new Array(60).fill(50);
  rsi[10] = 25; rsi[30] = 35; // dipler: fiyat LL, RSI HL
  const piv = [{ i: 5, price: 110, type: 'H' }, { i: 10, price: 100, type: 'L' }, { i: 20, price: 108, type: 'H' }, { i: 30, price: 97, type: 'L' }];
  const r = regularDiv(piv, rsi, 1, 59);
  assert.ok(r && r.p2.i === 30 && r.neck === 108, 'boğa uyumsuzluğu bekleniyordu');
  rsi[30] = 20; // gösterge de dipte → uyumsuzluk yok
  assert.equal(regularDiv(piv, rsi, 1, 59), null);
  const rsiH = new Array(60).fill(50); rsiH[10] = 75; rsiH[30] = 65;
  const pivH = [{ i: 5, price: 90, type: 'L' }, { i: 10, price: 100, type: 'H' }, { i: 20, price: 94, type: 'L' }, { i: 30, price: 103, type: 'H' }];
  assert.equal(regularDiv(pivH, rsiH, -1, 59)?.neck, 94);
});

test('uyumsuzluk stratejisi: sentetik seride geleceğe bakmadan çalışır, planlar tutarlı', async () => {
  const { divRsiMss, divRsiPivot } = await import('../backtest/lab/divergence.js');
  const cs = []; let p = 100;
  for (let i = 0; i < 600; i++) { const w = Math.sin(i / 9) * 3 + Math.sin(i / 2.3) * 0.8 - (i % 200) * 0.02; const open = p; const close = 100 + w; p = close; cs.push(c(i * 3600e3, open, Math.max(open, close) + 0.4, Math.min(open, close) - 0.4, close)); }
  for (const st of [divRsiMss, divRsiPivot]) {
    const trades = runStrategy(st, { coin: 'T', tf: '1H', candles: cs }, o);
    for (const t of trades) assert.ok(Number.isFinite(t.R));
  }
});

test('lab w3_zone: dalga 2 sürerken bölgeye limit plan (yakın kenar), etiketler; kurulum bir kez; SMT BTC referansıyla', async () => {
  const { W3_STRATEGIES } = await import('../backtest/lab/wave3.js');
  const { build } = await import('./helpers.js');
  const pre = [[0, 140]]; for (let b = 10; b <= 150; b += 10) pre.push([b, b % 20 ? 135 : 140]);
  const path = [...pre, [170, 120], [190, 100], [210, 130], [222, 115], [230, 122], [240, 110], [246, 119], [260, 140]];
  const cs = build(path);
  const btc = build(path.map(([b, p]) => [b, p * 10 + (b >= 236 && b <= 242 ? 120 : 0)])); // BTC C dibinde A'yı süpürmüyor
  const st = W3_STRATEGIES.find((s) => s.id === 'w3_zone');
  const p = st.prepare(cs, '4H', { btc });
  const plans = [];
  for (let i = 150; i < cs.length - 1; i++) { const x = st.signal(i, cs, p); if (x) plans.push({ i, ...x }); }
  assert.ok(plans.length >= 1, 'en az bir limit plan');
  const x = plans[0];
  assert.equal(x.inZone, false); assert.equal(x.direction, 'long');
  assert.ok(x.stop < x.entry && x.tp1 > x.entry);
  assert.ok(x.tags && 'smt' in x.tags && x.tags.tb != null);
  assert.equal(new Set(plans.map((q) => `${q.entry}|${q.stop}`)).size, plans.length, 'aynı kurulum iki kez işlenmez');
});
