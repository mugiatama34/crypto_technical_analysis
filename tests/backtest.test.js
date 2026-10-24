import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, simulateSeries, BT_DEFAULTS } from '../backtest/engine.js';
import { stats, buildReport, sessionOf, weekpartOf, entryTimeOf } from '../backtest/report.js';
import { build, randomWalk } from './helpers.js';

const plan = { d: 1, direction: 'long', entry: 100, stop: 98, tp1: 103, tp2: 106, inZone: false, price: 101 };
const c = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0 };

test('simulateTrade: limit dolum → TP1 → TP2 (yarı yarıya)', () => {
  const cs = [c(1, 101, 101, 99.5, 100.5), c(2, 100.5, 103.5, 100, 103), c(3, 103, 106.5, 102.5, 106)];
  const r = simulateTrade(plan, cs, 0, '1H', o);
  assert.equal(r.outcome, 'tp2');
  assert.ok(Math.abs(r.R - (0.5 * 1.5 + 0.5 * 3)) < 1e-9, `R ${r.R}`); // TP1 1.5R, TP2 3R
});

test('simulateTrade: stop −1R; TP1 sonrası başabaş stop ≈ +0,75R; süre dolumu; kaçan', () => {
  assert.equal(simulateTrade(plan, [c(1, 101, 101, 99, 100), c(2, 100, 100.5, 97.9, 98)], 0, '1H', o).outcome, 'stopped');
  assert.ok(Math.abs(simulateTrade(plan, [c(1, 101, 101, 99, 100), c(2, 100, 100.5, 97.9, 98)], 0, '1H', o).R + 1) < 1e-9);
  const be = simulateTrade(plan, [c(1, 101, 101, 99, 100), c(2, 100, 103.5, 100, 103), c(3, 103, 104, 99.9, 100)], 0, '1H', o);
  assert.equal(be.outcome, 'tp1_be'); assert.ok(Math.abs(be.R - 0.75) < 1e-9, `R ${be.R}`);
  // 24 saat (1H → 24 mum) dolum yok
  const far = Array.from({ length: 30 }, (_, i) => c(i + 1, 101, 101.5, 100.6, 101));
  assert.equal(simulateTrade(plan, far, 0, '1H', o).outcome, 'expired');
  assert.equal(simulateTrade(plan, [c(1, 101, 103.5, 100.6, 103)], 0, '1H', o).outcome, 'missed');
});

test('simulateTrade: komisyon ve kayma R\'yi düşürür; piyasa giriş açılıştan', () => {
  const cs = [c(1, 101, 101, 99.5, 100.5), c(2, 100.5, 103.5, 100, 103), c(3, 103, 106.5, 102.5, 106)];
  const a = simulateTrade(plan, cs, 0, '1H', o).R, b = simulateTrade(plan, cs, 0, '1H', { ...o, feePct: 0.05, slipPct: 0.05 }).R;
  assert.ok(b < a);
  const mkt = simulateTrade({ ...plan, inZone: true }, cs, 0, '1H', { ...o, slipPct: 0.1 });
  assert.ok(Math.abs(mkt.entryFill - 101 * 1.001) < 1e-6);
});

test('simulateSeries + buildReport: fixture serisinde planlar ve rapor', () => {
  const BULL = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119], [90, 140], [100, 128]];
  const candles = [...build([[0, 120], [400, 120]], { tfMs: 3600e3 }), ...build(BULL.map(([b, p]) => [b + 400, p]), { tfMs: 3600e3 }), ...randomWalk(200, { seed: 5 }).map((x, i) => ({ ...x, time: (500 + i) * 3600e3, open: x.open + 28, high: x.high + 28, low: x.low + 28, close: x.close + 28 }))];
  const trades = simulateSeries({ coin: 'T', instId: 'T', tf: '1H', candles }, { ...o, plan: { minScore: 30, minRR: 2, maxRiskPct: 50 } });
  assert.ok(trades.length > 0, 'plan üretilmeli');
  for (const t of trades) { assert.ok(t.time >= candles[399].time); assert.ok(['expired', 'missed', 'stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'invalid'].includes(t.outcome)); assert.ok(t.plan.signals.length); }
  const rep = buildReport(trades.map(({ plan: _p, ...t }) => t), { test: true });
  assert.equal(rep.overall.signals, trades.length);
  assert.ok(rep.byTf['1H']);
  assert.ok(Array.isArray(rep.curve));
  const s = stats([{ outcome: 'tp2', R: 2, time: 1 }, { outcome: 'stopped', R: -1, time: 2 }, { outcome: 'expired', R: 0, time: 3 }]);
  assert.equal(s.n, 2); assert.equal(s.winRate, 0.5); assert.equal(s.avgR, 0.5); assert.equal(s.profitFactor, 2); assert.equal(s.maxDD, 1);
});

test('simulateTrade: çıkış şemaları (half_nobe, single, trail)', () => {
  const cs = [c(1, 101, 101, 99.5, 100.5), c(2, 100.5, 103.5, 100, 103), c(3, 103, 104, 101.9, 102), c(4, 102, 106.5, 101.5, 106)];
  const nobe = simulateTrade(plan, cs, 0, '1H', { ...o, tpScheme: 'half_nobe' });
  assert.equal(nobe.outcome, 'tp2'); // stop yerinde (98) kaldı, 101.9 dibi stop etmedi
  const be = simulateTrade(plan, cs, 0, '1H', { ...o, tpScheme: 'half_be' });
  assert.equal(be.outcome, 'tp2'); // başabaş 100; dip 101.9 > 100
  const single = simulateTrade(plan, cs, 0, '1H', { ...o, tpScheme: 'single' });
  assert.equal(single.outcome, 'tp2'); assert.ok(Math.abs(single.R - 3) < 1e-9);
  const trail = simulateTrade({ ...plan, atr: 1 }, cs, 0, '1H', { ...o, tpScheme: 'trail', trailAtr: 1 });
  // TP1 103'te yarı (1.5R); izleyen stop = 103 − 1 = 102 → 3. mumda dip 101.9 stop (1R)
  assert.equal(trail.outcome, "tp1_be"); assert.ok(Math.abs(trail.R - 1.25) < 1e-9, `R ${trail.R}`); // yarı 1.5R + yarı 1R (stop 102)
});

// Düşen bıçak: bölgeye sert yaklaşma (son 3 mumda > 2 ATR) → teyit mumu kapanışından giriş ya da iptal
const kplan = { d: 1, direction: 'long', entry: 100, stop: 97, tp1: 104, tp2: 108, zone: [99.5, 100], atr: 1, inZone: false, price: 102.5 };
const kGuard = { ...o, knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 } };
const drop = [c(1, 102.5, 102.8, 102.2, 102.5), c(2, 102.5, 102.5, 100.5, 100.6), c(3, 100.6, 100.6, 99.2, 99.4)];

test('simulateTrade: yaklaşma hızı ölçülür; yavaş yaklaşmada koruma normal dolum yapar', () => {
  const slow = [c(1, 100.6, 100.8, 100.4, 100.6), c(2, 100.5, 100.7, 100.3, 100.5), c(3, 100.4, 100.5, 99.9, 100.2), c(4, 100.2, 104.5, 100.1, 104.2), c(5, 104, 108.5, 103.8, 108)];
  const a = simulateTrade(kplan, slow, 0, '1H', o), b = simulateTrade(kplan, slow, 0, '1H', kGuard);
  assert.equal(a.approachAtr, 0.9); assert.equal(a.fillBarAtr, 0.6);
  assert.deepEqual([b.outcome, b.R, b.entryFill], [a.outcome, a.R, 100]);
  assert.equal(simulateTrade({ ...kplan, inZone: true }, slow, 0, '1H', o).approachAtr, null);
});

test('simulateTrade: hızlı yaklaşma + teyit mumu → teyit kapanışından giriş; teyitsiz stop → knife (R 0); skip', () => {
  const up = [c(4, 99.4, 99.8, 98.9, 99.6), c(5, 99.6, 100.4, 99.5, 100.3), c(6, 100.3, 104.5, 100.2, 104.2), c(7, 104, 108.5, 103.8, 108)];
  const plain = simulateTrade(kplan, [...drop, ...up], 0, '1H', o);
  assert.equal(plain.entryFill, 100); assert.equal(plain.approachAtr, 3.6);
  const g = simulateTrade(kplan, [...drop, ...up], 0, '1H', kGuard);
  assert.equal(g.outcome, 'tp2'); assert.equal(g.entryFill, 100.3); assert.equal(g.confirmed, true);
  const risk = 100.3 - 97;
  assert.ok(Math.abs(g.R - (0.5 * (104 - 100.3) / risk + 0.5 * (108 - 100.3) / risk)) < 1e-3, `R ${g.R}`);
  const knife = simulateTrade(kplan, [...drop, c(4, 99.4, 99.5, 96.8, 97), ...up], 0, '1H', kGuard);
  assert.deepEqual([knife.outcome, knife.R], ['knife', 0]);
  assert.equal(simulateTrade(kplan, [...drop, ...up], 0, '1H', { ...o, knifeGuard: { ...kGuard.knifeGuard, skip: true } }).outcome, 'knife');
  // teyit gelmezse (3 mum) süre dolar
  const flat = [c(4, 99.4, 99.6, 99, 99.3), c(5, 99.3, 99.6, 99, 99.3), c(6, 99.3, 99.6, 99, 99.3), ...up];
  assert.equal(simulateTrade(kplan, [...drop, ...flat], 0, '1H', kGuard).outcome, 'expired');
  assert.equal(stats([knife]).n, 0); // işlem sayılmaz
});

test('sessionOf / weekpartOf / entryTimeOf: UTC sınırları; buildReport seans kırılımı', () => {
  const at = (s) => Date.parse(s);
  assert.match(sessionOf(at('2026-10-21T06:59:00Z')), /^Asya/);
  assert.match(sessionOf(at('2026-10-21T07:00:00Z')), /^Avrupa/);
  assert.match(sessionOf(at('2026-10-21T13:00:00Z')), /^New York/);
  assert.match(sessionOf(at('2026-10-21T20:00:00Z')), /^gece/);
  assert.equal(weekpartOf(at('2026-10-24T10:00:00Z')), 'hafta sonu'); // Cumartesi
  assert.equal(weekpartOf(at('2026-10-23T23:59:00Z')), 'hafta içi'); // Cuma
  assert.equal(entryTimeOf({ time: at('2026-10-21T12:00:00Z'), tf: '1H', waitBars: 2 }), at('2026-10-21T14:00:00Z'));
  const tr = (time, R) => ({ time, tf: '1H', waitBars: 1, outcome: R > 0 ? 'tp2' : 'stopped', R, groups: [], detectors: [], names: [], coin: 'X', direction: 'long', score: 60, inZone: true });
  const rep = buildReport([tr(at('2026-10-21T02:00:00Z'), 1), tr(at('2026-10-21T15:00:00Z'), -1), tr(at('2026-10-24T15:00:00Z'), -1)]);
  assert.ok(rep.bySession.train || rep.bySession.valid);
  const all = { ...rep.bySession.train, ...rep.bySession.valid };
  assert.ok(Object.keys(all).some((k) => /^Asya/.test(k)));
  assert.ok(rep.byWeekpart.valid['hafta sonu']);
});

test('simulateTrade: zaman stopu — N mumda TP1 yoksa kapanıştan çık; TP1 sonrası etkilenmez; minMfeR şartı; tp1Bars', () => {
  const p = { d: 1, direction: 'long', entry: 100, stop: 98, tp1: 103, tp2: 106, inZone: false, price: 101 };
  const chop = [c(1, 101, 101, 99.5, 100.2), ...Array.from({ length: 10 }, (_, i) => c(i + 2, 100.2, 101.2, 99.4, 100.6)), c(12, 100.6, 100.6, 97.5, 97.8)];
  assert.equal(simulateTrade(p, chop, 0, '1H', o).outcome, 'stopped');
  const t = simulateTrade(p, chop, 0, '1H', { ...o, timeStop: { bars: 4 } });
  assert.equal(t.outcome, 'time_stop'); assert.equal(t.bars, 3); assert.ok(Math.abs(t.R - 0.3) < 1e-9, `R ${t.R}`); // (100.6−100)/2
  assert.equal(stats([t]).n, 1);
  // MFE 0,6R ≥ 0,5R → ilerleme stopu tetiklenmez
  assert.equal(simulateTrade(p, chop, 0, '1H', { ...o, timeStop: { bars: 4, minMfeR: 0.5 } }).outcome, 'stopped');
  // TP1 3. mumda: zaman stopu etkilemez; tp1Bars
  const win = [c(1, 101, 101, 99.5, 100.2), c(2, 100.2, 101, 99.8, 100.8), c(3, 100.8, 103.2, 100.5, 103), c(4, 103, 103.5, 102, 102.5), c(5, 102.5, 102.6, 101, 101.5), c(6, 101.5, 106.5, 101.4, 106)];
  const w = simulateTrade(p, win, 0, '1H', { ...o, timeStop: { bars: 2 } });
  assert.equal(w.outcome, 'time_stop'); // 2 mumda TP1 yok
  const w4 = simulateTrade(p, win, 0, '1H', { ...o, timeStop: { bars: 4 } });
  assert.equal(w4.outcome, 'tp2'); assert.equal(w4.tp1Bars, 3);
});

test('sweep rebuild: tp1Pct (fiyat %) ve keepTp2; erken %80 + başabaş', async () => {
  const { rebuild } = await import('../backtest/sweep.mjs');
  const p = { d: 1, direction: 'long', entry: 100, stop: 98, tp1: 103, tp2: 106, zone: [99.5, 100], atr: 1, inZone: false };
  const r = rebuild(p, { tp1Pct: 1.2, keepTp2: true });
  assert.ok(Math.abs(r.tp1 - 101.2) < 1e-9); assert.equal(r.tp2, 106); assert.equal(r.stop, 98);
  assert.ok(Math.abs(rebuild({ ...p, d: -1, direction: 'short', stop: 102, tp1: 97, tp2: 94 }, { tp1Pct: 1.2, keepTp2: true }).tp1 - 98.8) < 1e-9);
  assert.ok(Math.abs(rebuild(p, { tp1R: 0.5, keepTp2: true }).tp1 - 101) < 1e-9);
  // %80 erken (0,6R), kalan başabaşta kapanır: R = 0,8 × 0,6
  const cs = [c(1, 101, 101, 99.5, 100.5), c(2, 100.5, 101.5, 100.2, 101.3), c(3, 101.3, 101.4, 99.8, 100)];
  const s = simulateTrade(r, cs, 0, '1H', { ...o, tp1Portion: 0.8 });
  assert.equal(s.outcome, 'tp1_be'); assert.ok(Math.abs(s.R - 0.48) < 1e-9, `R ${s.R}`);
});

test('sweep hedgeOf: kısmi çıkışlı hedge — %80 TP1\'e kadar, %20 çıkışa kadar ters BTC', async () => {
  const { hedgeOf, closeAt } = await import('../backtest/sweep.mjs');
  const H = 3600e3;
  const btc = Array.from({ length: 10 }, (_, i) => ({ time: i * H, close: 100 + i })); // her saat +1
  assert.equal(closeAt(btc, 2.5 * H), 102); assert.equal(closeAt(btc, -1), null);
  // long; giriş t0 = 0 + 1×H → BTC 101; TP1 3. mumda (2 mum sonra → 103), çıkış 5 mum sonra (106); stop %2
  const t = { time: 0, tf: '1H', waitBars: 1, bars: 5, tp1Bars: 3, d: 1, entryFill: 100, stop: 98, R: 0.5 };
  const h = hedgeOf(t, btc, 0, 0.8);
  const early = (103 / 101 - 1) * 100, full = (106 / 101 - 1) * 100;
  assert.ok(Math.abs(h.hedgedR - (0.5 - (0.8 * early + 0.2 * full) / 100 / 0.02)) < 1e-3, `hedgedR ${h.hedgedR}`);
  assert.equal(hedgeOf({ ...t, tp1Bars: null }, btc, 0, 0.8).hedgedR, +(0.5 - full / 100 / 0.02).toFixed(3));
  assert.equal(hedgeOf(t, null, 0, 0.8).hedgedR, null);
});
