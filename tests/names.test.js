import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketName, mergeByName } from '../backtest/names.js';
import { bucketName as viaReport, buildReport } from '../backtest/report.js';

test('bucketName: ADX sınırları (alt dahil, üst hariç) ve ok yönü', () => {
  const c = { 'ADX 24 trend ↓': 'ADX <25 trend ↓', 'ADX 25 trend ↓': 'ADX 25–30 trend ↓', 'ADX 29 trend ↑': 'ADX 25–30 trend ↑',
    'ADX 30 trend ↓': 'ADX 30–40 trend ↓', 'ADX 39 trend ↑': 'ADX 30–40 trend ↑', 'ADX 40 trend ↓': 'ADX 40–50 trend ↓',
    'ADX 49 trend ↓': 'ADX 40–50 trend ↓', 'ADX 50 trend ↓': 'ADX 50+ trend ↓', 'ADX 57 trend ↑': 'ADX 50+ trend ↑' };
  for (const [k, v] of Object.entries(c)) assert.equal(bucketName(k), v);
});
test('bucketName: hacim sınırları', () => {
  const c = { 'Hacim ×1.9': 'Hacim ×<2', 'Hacim ×2.0': 'Hacim ×2–3', 'Hacim ×2.9': 'Hacim ×2–3', 'Hacim ×3.0': 'Hacim ×3–4',
    'Hacim ×3.4': 'Hacim ×3–4', 'Hacim ×4.0': 'Hacim ×4–6', 'Hacim ×5.9': 'Hacim ×4–6', 'Hacim ×6.0': 'Hacim ×6+', 'Hacim ×12.5': 'Hacim ×6+' };
  for (const [k, v] of Object.entries(c)) assert.equal(bucketName(k), v);
});
test('bucketName: diğer adlar aynen; report.js yeniden dışa aktarır', () => {
  for (const n of ['FVG', 'Order block ↑', 'ADX trend', 'Fib 0.618']) assert.equal(bucketName(n), n);
  assert.equal(viaReport, bucketName);
});
test('mergeByName: n / totalR / avgR toplanır, tek üyeli grup aynen kalır, sıralama ort. R azalan', () => {
  const mk = (n, totalR, winRate, pf) => ({ n, signals: n * 2, totalR, avgR: totalR / n, winRate, fillRate: 0.5, profitFactor: pf, maxDD: 3 });
  const single = mk(20, 4, 0.5, 1.2);
  const m = mergeByName({ 'ADX 57 trend ↓': mk(10, 3, 0.6, 1.5), 'ADX 56 trend ↓': mk(30, -1, 0.4, 0.9), 'ADX 44 trend ↓': mk(20, 2, 0.5, 1.1), 'FVG': single });
  const a = m['ADX 50+ trend ↓'];
  assert.equal(a.n, 40); assert.equal(a.totalR, 2); assert.equal(a.avgR, 0.05); assert.equal(a.signals, 80);
  assert.equal(a.winRate, 0.45); assert.equal(a.fillRate, 0.5); assert.equal(a.maxDD, null);
  assert.equal(m['ADX 40–50 trend ↓'].n, 20);
  assert.equal(m.FVG, single);
  const avg = Object.values(m).map((s) => s.avgR);
  assert.deepEqual(avg, [...avg].sort((x, y) => y - x));
});
test('buildReport: byName aralıklı adlarla, işlem bir kez sayılır', () => {
  const trades = Array.from({ length: 20 }, (_, i) => ({ time: i, outcome: 'tp2', R: 1, tf: '4H', direction: 'long', score: 60, inZone: true, coin: 'X', groups: ['g'], detectors: ['d'], names: ['ADX 41 trend ↓', 'ADX 45 trend ↓', 'Hacim ×3.1'] }));
  const r = buildReport(trades);
  assert.deepEqual(Object.keys(r.byName).sort(), ['ADX 40–50 trend ↓', 'Hacim ×3–4']);
  assert.equal(r.byName['ADX 40–50 trend ↓'].n, 20);
});
