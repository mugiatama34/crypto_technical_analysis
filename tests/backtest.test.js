import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, simulateSeries, BT_DEFAULTS } from '../backtest/engine.js';
import { stats, buildReport } from '../backtest/report.js';
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
