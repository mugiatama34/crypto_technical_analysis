import { test } from 'node:test';
import assert from 'node:assert/strict';
import { donchianLong, stepPosition, RD_DEFAULTS } from '../bot/regime/donchian.js';

const c = (i, o, h, l, cl) => ({ time: i * 36e5, open: o, high: h, low: l, close: cl, volume: 1 });

test('rejim-Donchian: yatay sonrası güçlü kırılımda long sinyal, yatayda yok', () => {
  const cs = []; let p = 100;
  for (let i = 0; i < 80; i++) { const w = Math.sin(i * 0.7) * 0.5; cs.push(c(i, p, p + w + 0.6, p + w - 0.6, p + w)); }
  assert.equal(donchianLong(cs), null);
  for (let i = 80; i < 95; i++) { p += 1.2; cs.push(c(i, p - 1.2, p + 0.3, p - 1.4, p)); }
  const s = donchianLong(cs);
  assert.ok(s && s.entry > s.stop, 'kırılımda long bekleniyordu');
});

test('rejim-Donchian: izleyen stop yükselir, düşüşte stop olur', () => {
  const p = { entry: 100, stop: 96, stop0: 96, atr: 2, lastTime: 0, bars: 0 };
  const r1 = stepPosition(p, [c(1, 100, 106, 100, 105)], RD_DEFAULTS);
  assert.equal(r1, null); assert.equal(p.stop, 101); // 105 − 2×2
  const r2 = stepPosition(p, [c(2, 105, 105, 100.5, 101)], RD_DEFAULTS);
  assert.equal(r2.outcome, 'stopped'); assert.equal(r2.exit, 101);
});
