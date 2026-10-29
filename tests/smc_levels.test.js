import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structure, fvgs, liquidity, lastBos } from '../bot/practice/smc_levels.mjs';

const c = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });

test('smc_levels: structure LH/LL ve bozan seviyeler', () => {
  const piv = [{ i: 0, price: 110, type: 'H' }, { i: 5, price: 100, type: 'L' }, { i: 10, price: 107, type: 'H' }, { i: 15, price: 96, type: 'L' }];
  const s = structure(piv);
  assert.equal(s.label, 'LH/LL'); assert.equal(s.dir, 'down'); assert.equal(s.breakUp, 107); assert.equal(s.breakDown, 96);
});

test('smc_levels: FVG açık/dolu ve kapanışla BOS', () => {
  const cs = [c(0, 10, 11, 9, 10.5), c(1, 10.5, 13, 10.4, 12.8), c(2, 12.8, 14, 12, 13.5), c(3, 13.5, 13.8, 12.6, 13)];
  const z = fvgs(cs, 10);
  assert.equal(z.length, 1); assert.equal(z[0].dir, 'bull'); assert.equal(z[0].lo, 11); assert.equal(z[0].hi, 12); assert.equal(z[0].status, 'açık');
  const bos = lastBos(cs, [{ i: 0, price: 11, type: 'H', at: 0 }]);
  assert.equal(bos.dir, 'up'); assert.equal(bos.i, 1);
});

test('smc_levels: PDH/PDL, PWL ve Asya; alındı bayrakları', () => {
  const H = 36e5, D = 864e5, mon = Date.UTC(2026, 9, 26); // Pazartesi
  const cs = [];
  for (let t = mon - 7 * D; t < mon + 1 * D + 10 * H; t += H) { const base = t < mon ? 100 : 101; cs.push(c(t, base, base + 1, base - 1, base)); }
  cs.push(c(mon + 1 * D + 10 * H, 101, 103, 98, 102)); // Salı 10:00: PDH (102) ve PWL (99) geçildi
  const now = mon + 1 * D + 11 * H - 1;
  const lv = Object.fromEntries(liquidity(cs, now).map((l) => [l.name, l]));
  assert.equal(lv.PDH.level, 102); assert.equal(lv.PDH.taken, true);
  assert.equal(lv.PWL.level, 99); assert.equal(lv.PWL.taken, true);
  assert.equal(lv['Asya tepe'].level, 102); assert.equal(lv['Asya tepe'].taken, true);
});
