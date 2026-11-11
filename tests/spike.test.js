import test from 'node:test';
import assert from 'node:assert/strict';
import { atr, aggregate, findEvents, simTrade } from '../tools/spike/spike.js';

const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const flat = (n) => Array.from({ length: n }, (_, i) => bar(i * 9e5, 100, 100.5, 99.5, 100));
test('spike olayı bulunur ve aynı yönde tekrarı atlanır', () => {
  const c = flat(20); c.push(bar(20 * 9e5, 100, 104, 100, 104)); c.push(bar(21 * 9e5, 104, 108, 104, 108));
  const ev = findEvents(c, atr(c), 3);
  assert.equal(ev.length, 1); assert.equal(ev[0].d, 1); assert.equal(ev[0].i, 20);
});
test('fade işlemi: stop olay tepesinin ötesinde, hedef 1R, aynı mumda stop önce', () => {
  const c = flat(20); c.push(bar(20 * 9e5, 100, 104, 100, 103)); // olay, a = 1
  c.push(bar(21 * 9e5, 103, 103.2, 101.9, 102)); // hedef: giriş 103, stop 104.1, risk 1.1 → tp 101.9
  const e = { i: 20, d: 1, a: 1, body: 3 };
  const r = simTrade(c, e, { mode: 'fade', w: 0, m: 1, T: 4, cost: 0 });
  assert.equal(r.how, 'tp'); assert.ok(Math.abs(r.R - 1) < 1e-9);
  c[21] = bar(21 * 9e5, 103, 104.5, 101, 102); // aynı mumda ikisi → stop
  assert.equal(simTrade(c, e, { mode: 'fade', w: 0, m: 1, T: 4, cost: 0 }).how, 'stop');
});
test('15m → 1H birleştirme', () => {
  const c = [bar(0, 1, 2, 0.5, 1.5), bar(9e5, 1.5, 3, 1, 2), bar(18e5, 2, 2.5, 0.1, 2.2), bar(27e5, 2.2, 2.4, 2, 2.3), bar(36e5, 2.3, 2.3, 2.3, 2.3)];
  const h = aggregate(c, 4);
  assert.equal(h.length, 2); assert.deepEqual([h[0].o, h[0].h, h[0].l, h[0].c], [1, 3, 0.1, 2.3]);
});
