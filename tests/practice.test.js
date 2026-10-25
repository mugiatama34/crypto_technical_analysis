import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, COINS, PLAN } from '../bot/practice/snapshot.mjs';

test('pratik anlık görüntüsü: kısa mum biçimi ve kapsam', () => {
  const c = [{ time: 1, open: 2, high: 3, low: 1.5, close: 2.5, quoteVol: 1234.6 }, { time: 2, open: 2.5, high: 2.6, low: 2, close: 2.1, quoteVol: NaN }];
  assert.deepEqual(compact(c), [[1, 2, 3, 1.5, 2.5, 1235], [2, 2.5, 2.6, 2, 2.1, null]]);
  assert.deepEqual(COINS, ['BTC', 'ETH']);
  assert.ok(PLAN['1D'] >= 200 && PLAN['4H'] >= 200);
});
