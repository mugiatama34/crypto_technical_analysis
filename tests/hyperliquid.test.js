import test from 'node:test';
import assert from 'node:assert/strict';
import { episodes } from '../tools/hyperliquid/episodes.js';

const F = (o) => ({ coin: 'BTC', crossed: false, fee: '0', closedPnl: '0', ...o });
test('düz→düz pozisyon, ekleme, ücret ve yön değişimi', () => {
  const eps = episodes([
    F({ px: '100', sz: '1', side: 'B', time: 1, startPosition: '0', dir: 'Open Long', fee: '0.1' }),
    F({ px: '90', sz: '1', side: 'B', time: 2, startPosition: '1', dir: 'Open Long', fee: '0.1' }),
    F({ px: '110', sz: '2', side: 'A', time: 3, startPosition: '2', dir: 'Close Long', closedPnl: '30', fee: '0.2' }),
    F({ px: '110', sz: '2', side: 'A', time: 4, startPosition: '0', dir: 'Open Short' }),
    F({ px: '100', sz: '3', side: 'B', time: 5, startPosition: '-2', dir: 'Short > Long', closedPnl: '20', fee: '0.3' }),
    F({ coin: '@107', px: '1', sz: '1', side: 'B', time: 6, startPosition: '0', dir: 'Buy' }),
  ]);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].d, 1); assert.equal(eps[0].adds, 1); assert.equal(eps[0].entry, 95);
  assert.ok(Math.abs(eps[0].net - 29.6) < 1e-9);
  assert.equal(eps[1].d, -1); assert.ok(Math.abs(eps[1].net - (20 - 0.2)) < 1e-9); // ücretin 2/3'ü kapanan kısma
});
test('pencere öncesi açık pozisyon atlanır', () => {
  const eps = episodes([F({ px: '1', sz: '1', side: 'A', time: 1, startPosition: '1', dir: 'Close Long', closedPnl: '5' })]);
  assert.equal(eps.length, 0);
});
