import test from 'node:test';
import assert from 'node:assert/strict';
import { bybitOf, bybitPx, setBybitOverrides } from '../src/data/bybit-symbols.js';
import { bybitLine, formatSetup } from '../bot/telegram.js';

test('bybitOf / bybitPx: çarpanlı sözleşme ve tam hassasiyet', () => {
  assert.deepEqual(bybitOf('PEPE'), { sym: '1000PEPEUSDT', mult: 1000 });
  assert.deepEqual(bybitOf('BTC'), { sym: 'BTCUSDT', mult: 1 });
  assert.equal(bybitPx('PEPE', 0.00000526786), 0.00526786); // OKX ham fiyatı ×1000, hane kaybı yok
  assert.equal(bybitPx('SHIB', 0.00000445286), 0.00445286);
  setBybitOverrides('{"FOO":{"sym":"1000FOOUSDT","mult":1000}}'); assert.equal(bybitOf('FOO').mult, 1000);
  setBybitOverrides('bozuk'); assert.equal(bybitOf('FOO').mult, 1);
});
test('bybitLine ve kurulum mesajı: PEPE için Bybit satırı, BTC için yok', () => {
  assert.equal(bybitLine('BTC', [['giriş', 70000]]), '');
  const l = bybitLine('PEPE', [['giriş', 0.00000526786], ['stop', 0.00000507246]], 1898300);
  assert.match(l, /1000PEPEUSDT/); assert.match(l, /0\.00526786/); assert.match(l, /0\.00507246/); assert.match(l, /adet 1898\.3/);
  const plan = { coin: 'PEPE', tf: '4H', direction: 'long', score: 66, price: 0.0000053, inZone: false, signals: [], early: 0.0000053311 };
  const dec = { trade: 'take', source: 'rules', confidence: 'orta', entry: 0.00000526786, entry_low: 0.00000526786, entry_high: 0.0000053, stop: 0.00000507246, tp1: 0.00000562, tp2: 0.0000058154, rr1: 1.8, rr: 2.8, reason: '', invalidation: '' };
  const msg = formatSetup(plan, dec, null);
  assert.match(msg, /Bybit 1000PEPEUSDT/); assert.match(msg, /erken <code>0\.0053311<\/code>/);
});
