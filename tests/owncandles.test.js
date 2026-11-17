import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOwnCandles } from '../bot/plan.js';

const D = 864e5;
test('needsOwnCandles: evrenden düşen coinde bekleyen plan da ayrıca izlenir', () => {
  assert.equal(needsOwnCandles({ hasRow: false, tfOff: false, ageMs: 0.9 * D, status: 'waiting' }), true);
  assert.equal(needsOwnCandles({ hasRow: false, tfOff: false, ageMs: 0.1 * D, status: 'active' }), true);
});
test('needsOwnCandles: satır var ama hatalı (geçici) → genç planda beklenir, 2 günden eskiyse izlenir', () => {
  assert.equal(needsOwnCandles({ hasRow: true, tfOff: false, ageMs: 1 * D, status: 'active' }), false);
  assert.equal(needsOwnCandles({ hasRow: true, tfOff: false, ageMs: 2 * D, status: 'tp1' }), true);
});
test('needsOwnCandles: TF kapalıysa izlenir; kapalı planlar izlenmez', () => {
  assert.equal(needsOwnCandles({ hasRow: true, tfOff: true, ageMs: 0, status: 'confirming' }), true);
  for (const s of ['stopped', 'done', 'expired', 'be', 'missed']) assert.equal(needsOwnCandles({ hasRow: false, tfOff: true, ageMs: 5 * D, status: s }), false);
});
