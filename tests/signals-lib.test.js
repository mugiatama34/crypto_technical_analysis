import test from 'node:test';
import assert from 'node:assert/strict';
import { finalR, dailyR, monthGrid, closedTrades, liveInfo, isOpen } from '../src/ui/signals-lib.js';

const D = (s) => Date.parse(s + 'T12:00:00Z');
test('finalR: stop, TP1 sonrası stop, erken kâr + başabaş', () => {
  assert.equal(finalR({ status: 'stopped' }), -1);
  assert.equal(finalR({ status: 'stopped', tp1At: 1, rr1: 1.5 }), 0.75);
  const e = { status: 'be', early: 101.2, entry: 100, stop: 99, earlyPortion: 0.8 };
  assert.ok(Math.abs(finalR(e) - 0.96) < 1e-9);
  assert.equal(finalR({ status: 'active' }), null);
});
test('dailyR: kapanış gününe toplar, açık/kaçanları saymaz', () => {
  const items = [
    { status: 'stopped', closedAt: D('2026-11-10') },
    { status: 'done', closedAt: D('2026-11-10'), rr1: 1.5, rr: 2.5 },
    { status: 'missed', closedAt: D('2026-11-10') },
    { status: 'active', sentAt: D('2026-11-10') },
  ];
  const m = dailyR(items);
  assert.deepEqual(Object.keys(m), ['2026-11-10']);
  assert.equal(m['2026-11-10'].n, 2); assert.equal(m['2026-11-10'].R, 1); assert.equal(m['2026-11-10'].win, 1);
  assert.equal(closedTrades(items).length, 2); assert.equal(items.filter(isOpen).length, 1);
});
test('monthGrid: Kasım 2026 Pazar başlar → Pazartesi ızgarasında 6 boş, 6 hafta', () => {
  const w = monthGrid(2026, 10);
  assert.equal(w[0].filter((x) => x === null).length, 6); assert.equal(w[0][6].day, 1);
  assert.equal(w.flat().filter(Boolean).length, 30); assert.equal(w.length, 6);
});
test('liveInfo: short için kâr tarafı ve gerçekleşmemiş R', () => {
  const i = liveInfo({ direction: 'short', entry: 100, stop: 102 }, 99);
  assert.equal(i.uR, 0.5); assert.ok(i.toEntryPct > 0);
});
