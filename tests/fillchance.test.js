import test from 'node:test';
import assert from 'node:assert/strict';
import { fillChance, fillChanceClass } from '../src/scan/fillchance.js';

test('dolma şansı: TP1 uzaklığı ÷ toplam uzaklık; long ve short simetrik; uçlar ve eksik veri', () => {
  // short: giriş yukarıda (101), TP1 aşağıda (97); fiyat 98 → girişe 3, TP1'e 1 → 0,25
  assert.equal(fillChance(-1, 98, 101, 97), 0.25);
  // long: giriş aşağıda (99), TP1 yukarıda (103); fiyat 102 → 0,25
  assert.equal(fillChance(1, 102, 99, 103), 0.25);
  assert.equal(fillChance(-1, 100, 101, 97), 0.75);
  assert.equal(fillChance(-1, 101.5, 101, 97), 1); // fiyat girişte / ötesinde
  assert.equal(fillChance(-1, 96.5, 101, 97), 0); // TP1 zaten görülmüş
  assert.equal(fillChance(-1, null, 101, 97), null); assert.equal(fillChance(0, 98, 101, 97), null); assert.equal(fillChance(1, NaN, 99, 103), null);
  assert.deepEqual([0.1, 0.3, 0.49, 0.5, 0.9, null].map(fillChanceClass), ['low', 'mid', 'mid', 'ok', 'ok', '']);
});
