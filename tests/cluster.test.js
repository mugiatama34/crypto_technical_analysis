// Ters gün yığılması tanısı (backtest/cluster.mjs): günlük toplama, düşüş, ters gün, sınır, Pazartesi farkı.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyOf, maxDrawdown, worstWindow, concentration, capRow, mondayDiff, mondayCi, analyze, closeTimeOf } from '../backtest/cluster.mjs';

const H4 = 4 * 3600e3, T0 = Date.parse('2026-06-01T00:00:00Z'); // Pazartesi
const tr = (o = {}) => ({ coin: 'X', tf: '4H', d: -1, score: 70, outcome: 'stopped', R: -1, entryFill: 100, waitBars: 1, bars: 0, time: T0, ...o, entryTime: (o.time ?? T0) + H4 });

test('günlük toplama, düşüş ve en kötü pencere', () => {
  const list = [tr({ R: 2, outcome: 'tp2' }), tr({ time: T0 + 24 * 3600e3 }), tr({ time: T0 + 24 * 3600e3 }), tr({ time: T0 + 72 * 3600e3, R: 0.5, outcome: 'tp1_be' }), tr({ outcome: 'missed', R: null, entryFill: null })];
  const d = dailyOf(list);
  assert.deepEqual(d.map((x) => [x.day, x.R, x.n, x.stopsShort]), [['2026-06-01', 2, 1, 0], ['2026-06-02', -2, 2, 2], ['2026-06-04', 0.5, 1, 0]]);
  assert.equal(maxDrawdown(list), 2);
  assert.equal(worstWindow(d, 7), 0); // 7 günlük toplam hiç eksiye düşmüyor (2 − 2 + 0,5)
  assert.equal(worstWindow(d, 1), -2);
  assert.equal(closeTimeOf(list[0]), T0 + 2 * H4);
});

test('ters gün: aynı yönde ≥ 5 stop; payı ve hariç ortalama', () => {
  const bad = Array.from({ length: 6 }, (_, i) => tr({ coin: `C${i}`, time: T0 + 48 * 3600e3 }));
  const good = Array.from({ length: 10 }, (_, i) => tr({ coin: `G${i}`, time: T0 + (i + 5) * 24 * 3600e3, R: 0.4, outcome: 'tp1_be' }));
  const c = concentration([...bad, ...good]);
  assert.equal(c.adverseDays, 1); assert.equal(c.adverseTrades, 6); assert.equal(c.adverseR, -6); assert.equal(c.adverseLossShare, 1);
  assert.equal(c.exAdverse.n, 10); assert.equal(c.exAdverse.avgR, 0.4); assert.equal(c.worstDaysLossShare, 1);
});

test('sınır: aynı anda açık 6 short → ≤ 3 yalnız üçünü alır', () => {
  const bad = Array.from({ length: 6 }, (_, i) => tr({ coin: `C${i}`, bars: 3, score: 70 + i }));
  assert.equal(capRow(bad, null).totalR, -6);
  const c = capRow(bad, 3); assert.equal(c.n, 3); assert.equal(c.totalR, -3); assert.equal(c.worstDay, -3);
});

test('Pazartesi farkı, aralık ve n < 100 → sonuçsuz', () => {
  const list = [];
  for (let w = 0; w < 12; w++) { list.push(tr({ time: T0 + w * 7 * 24 * 3600e3 - H4, R: -1 })); list.push(tr({ time: T0 + (w * 7 + 2) * 24 * 3600e3, R: 0.5, outcome: 'tp1_be' })); }
  const m = mondayDiff(list);
  assert.deepEqual([m.monN, m.monAvg, m.otherN, m.otherAvg, m.diff], [12, -1, 12, 0.5, 1.5]);
  assert.deepEqual(mondayCi(list, { iters: 200 }), [1.5, 1.5]);
  assert.equal(analyze({ trades: list, split: T0 + 40 * 24 * 3600e3 }).s3.verdict, 'sonuçsuz');
});
