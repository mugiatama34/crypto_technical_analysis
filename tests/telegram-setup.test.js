import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSetup } from '../bot/telegram.js';

const plan = { coin: 'BTC', tf: '4H', direction: 'long', score: 58, price: 100, signals: [], mtf: null, entry: 99.5, inZone: false, early: 100.7 };
const dec = { trade: 'take', confidence: 'orta', entry_low: 99, entry_high: 100, entry: 99.5, stop: 98, tp1: 102, tp2: 104, rr1: 1.5, rr: 2, reason: 'r', invalidation: 'i' };

test('formatSetup: beş seviye ayrı satırda, tek sayı <code> içinde', () => {
  const L = formatSetup(plan, dec, null).split('\n');
  for (const [k, v] of [['📍 Giriş', '99.5000'], ['🛑 Stop', '98.0000'], ['⚡ Erken', '100.70'], ['🎯 TP1', '102.00'], ['🏁 TP2', '104.00']]) {
    const l = L.find((x) => x.startsWith(k));
    assert.ok(l && l.includes(`<code>${v}</code>`), k);
  }
});
test('formatSetup: seviye bloğu Puan satırından önce', () => {
  const L = formatSetup(plan, dec, null).split('\n');
  const pi = L.findIndex((x) => x.startsWith('Puan')), ti = L.findIndex((x) => x.startsWith('🏁 TP2'));
  assert.ok(ti > 0 && ti < pi);
  assert.equal(L[1], ''); assert.equal(L[pi - 1], '');
});
test('formatSetup: plan.early yokken Erken satırı yok', () => {
  assert.ok(!formatSetup({ ...plan, early: undefined }, dec, null).includes('⚡ Erken'));
});
test('formatSetup: earlyPortion 0.5 → %50 kapat; yoksa kısmi kapat', () => {
  assert.match(formatSetup({ ...plan, earlyPortion: 0.5 }, dec, null), /%50 kapat, stop girişe/);
  assert.match(formatSetup(plan, dec, null), /kısmi kapat, stop girişe/);
});
test('formatSetup: coin adı HTML kaçışlı', () => {
  const m = formatSetup({ ...plan, coin: 'A<B' }, dec, null);
  assert.ok(m.includes('<b>A&lt;B</b>') && !m.includes('<b>A<B</b>'));
});
