import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfgLabel, qualityOf, periodReport, weeklyReport, PERIODS } from '../bot/review/periods.js';

const D = 864e5, t0 = Date.UTC(2026, 10, 2, 6); // Pazartesi
const sig = (sentAt, status, extra = {}) => ({ coin: 'X', tf: '4H', direction: 'long', sentAt, status, rr1: 1, rr: 2, ...extra });

test('cfgLabel: canlı ayar etiketi P5 ile aynı', () => {
  const l = cfgLabel({ tfs: ['4H'], knife: true, limitOnly: true, skipWeekend: true, earlyTp: { pct: 1.2, portion: 0.8 }, htfTrend: 'with', timeStop: null });
  assert.equal(l, PERIODS.at(-1).cfg);
});

test('qualityOf: dolum, kazanma, ort. R', () => {
  const q = qualityOf([sig(0, 'stopped'), sig(0, 'done'), sig(0, 'missed'), sig(0, 'active')], 2);
  assert.equal(q.n, 4); assert.equal(q.perDay, 2); assert.equal(q.closed, 2); assert.equal(q.fillRate, 0.75);
  assert.equal(q.winRate, 0.5); assert.equal(q.avgR, 0.25); // (−1 + 1,5) / 2
});

test('periodReport: cfg etiketi değişince yeni dönem açılır', () => {
  const p5 = PERIODS.at(-1);
  const items = [sig(p5.from + D, 'stopped'), sig(p5.from + 2 * D, 'done', { cfg: p5.cfg }), sig(p5.from + 3 * D, 'done', { cfg: '4H+1H · bıçak' })];
  const r = periodReport(items, p5.from + 4 * D);
  assert.equal(r.length, 2); assert.equal(r[0].n, 2); assert.match(r[1].label, /4H\+1H/); assert.equal(r[1].n, 1);
});

test('weeklyReport: son 7 gün ve önceki hafta ayrılır', () => {
  const items = [sig(t0 - 2 * D, 'done'), sig(t0 - 3 * D, 'stopped', { direction: 'short' }), sig(t0 - 9 * D, 'stopped')];
  const w = weeklyReport(items, t0);
  assert.equal(w.week.n, 2); assert.equal(w.prev.n, 1); assert.equal(w.prev.avgR, -1);
  assert.match(w.text, /Haftalık sinyal raporu/); assert.match(w.text, /n &lt; 30/);
});
