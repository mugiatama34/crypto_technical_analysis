import test from 'node:test';
import assert from 'node:assert/strict';
import { friendSummary, friendRows, friendLabel } from '../src/ui/friend-lib.js';

const items = [
  { id: 'a', coin: 'A', status: 'open', openTime: 100, entry: 100, stop: 105, tp: 90 },
  { id: 'b', coin: 'B', status: 'open', openTime: 200, src: 'r50-4h', entry: 10, stop: 11, tp: 8 },
  { id: 'c', coin: 'C', status: 'closed', openTime: 50, closeTime: 300, r: 1.5, src: 'r50-4h' },
  { id: 'd', coin: 'D', status: 'closed', openTime: 60, closeTime: 250, r: -1 },
  { id: 'e', coin: 'E', status: 'closed', openTime: 70, closeTime: 260 },
  { id: 'f', coin: 'F', status: 'gone', openTime: 400 },
];

test('özet: karışık durumlar', () => {
  const s = friendSummary(items);
  assert.equal(s.open, 2); assert.equal(s.closed, 3); assert.equal(s.gone, 1);
  assert.equal(s.wins, 1); assert.equal(s.sumR, 0.5); assert.equal(s.avgR, 0.25);
  assert.deepEqual(s.bySrc['r50-4h'], { open: 1, closed: 1, wins: 1, sumR: 1.5 });
  assert.equal(s.bySrc['4h'].closed, 2);
});

test('özet: boş / bozuk', () => {
  assert.equal(friendSummary([]).avgR, null);
  assert.equal(friendSummary(null).closed, 0);
  assert.equal(friendSummary([null, 3, { status: 'closed', r: 'x' }]).sumR, 0);
});

test('sıralama: açıklar, kapananlar, gone', () => {
  assert.deepEqual(friendRows(items).map((x) => x.id), ['b', 'a', 'c', 'e', 'd', 'f']);
});

test('türetilmiş alanlar', () => {
  const r = friendRows(items).find((x) => x.id === 'a');
  assert.equal(r.stopPct, 5); assert.equal(r.tpPct, 10); assert.equal(r.planR, 2);
  assert.equal(r.src, '4h'); assert.equal(r.srcLabel, friendLabel('4h'));
  assert.equal(friendRows(items).find((x) => x.id === 'b').srcLabel, 'Elliott dalga 4H · ilk 50 coin');
});

test('bozuk girdide null', () => {
  const [r] = friendRows([{ status: 'open', entry: 'x', stop: 5 }]);
  assert.equal(r.stopPct, null); assert.equal(r.tpPct, null); assert.equal(r.planR, null);
  assert.deepEqual(friendRows(undefined), []);
});
