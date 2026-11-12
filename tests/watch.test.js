import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWatch, updateWatch, watchR, isOpen, mergeImport } from '../src/watch/watch.js';
import { runScan } from '../src/scan/scanner.js';
import { fixtureProvider } from '../src/data/fixture.js';

const H = 3600e3;
const c = (t, low, high) => ({ time: t, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 });
const base = { id: 'X|1H|long|1|0', key: 'X|1H|long|1', coin: 'X', instId: 'X-USDT-SWAP', tf: '1H', direction: 'long', d: 1, entry: 100, stop: 98, tp1: 103, tp2: 105, sentAt: 0, addedAt: 0, status: 'waiting', signals: [], note: '' };

test('takip: bekliyor → girildi (anlık R) → TP1 → tamam; stop; 24 saatte süre dolar', () => {
  let r = updateWatch(base, [c(H, 99.5, 101)], 2 * H);
  assert.equal(r.item.status, 'active'); assert.deepEqual(r.events, ['active']);
  assert.equal(watchR(r.item), 0.125); // son kapanış 100,25 → 0,25 / risk 2
  r = updateWatch(r.item, [c(H, 99.5, 101), c(2 * H, 101, 103.2)], 3 * H);
  assert.equal(r.item.status, 'tp1');
  r = updateWatch(r.item, [c(H, 99.5, 101), c(2 * H, 101, 103.2), c(3 * H, 104, 105.5)], 4 * H);
  assert.equal(r.item.status, 'done'); assert.equal(isOpen(r.item), false);
  assert.equal(watchR(r.item), 0.5 * 1.5 + 0.5 * 2.5);
  assert.equal(updateWatch(r.item, [c(4 * H, 90, 91)], 5 * H).item.status, 'done', 'kapalı kayıt değişmez');
  assert.equal(watchR(updateWatch(base, [c(H, 97.5, 101)], 2 * H).item), -1);
  assert.equal(updateWatch(base, [c(H, 101, 102)], 25 * H).item.status, 'expired');
});

test('takip: taramadaki satırdan plan dondurulur (buildPlan); içe aktarma tekrarları atlar', async () => {
  const res = await runScan({ timeframes: ['1H'], topN: 6 }, { provider: fixtureProvider });
  const row = res.rows.find((r) => r.best && r.direction);
  const w = makeWatch(row, 1000);
  if (!w.error) {
    assert.equal(w.coin, row.coin); assert.ok(w.d * (w.entry - w.stop) > 0); assert.ok(w.d * (w.tp1 - w.entry) > 0);
    assert.equal(w.addedAt, 1000); assert.ok(['waiting', 'active'].includes(w.status));
  }
  const merged = mergeImport([base], JSON.stringify([base, { ...base, id: 'Y' }, { bad: 1 }]));
  assert.equal(merged.length, 2);
  assert.throws(() => mergeImport([], '{}'));
});

import { diffWatch } from '../src/watch/watch.js';
test('diffWatch: silinen id ve not değişikliğinde updatedAt güncellenir', () => {
  const prev = [{ id: 'a', updatedAt: 1, note: '' }, { id: 'b', updatedAt: 1 }];
  const { list, removed } = diffWatch(prev, [{ id: 'a', updatedAt: 1, note: 'not' }], 99);
  assert.deepEqual(removed, ['b']); assert.equal(list[0].updatedAt, 99);
  assert.equal(diffWatch(prev, prev, 99).list[0].updatedAt, 1);
});

import { makeManualWatch } from '../src/watch/watch.js';
test('makeManualWatch: elle kayıt, virgüllü sayı, doğrulama, R:R', () => {
  const w = makeManualWatch({ coin: 'wldusdt', tf: '15m', direction: 'short', entry: '0,3153', stop: '0.3194', tp1: '0.3043', tp2: '', label: 'arkadaş', sentAt: 1000 }, 5000);
  assert.equal(w.coin, 'WLD'); assert.equal(w.instId, 'WLD-USDT-SWAP'); assert.equal(w.tp2, 0.3043); assert.equal(w.rr, 2.68); assert.equal(w.label, 'arkadaş'); assert.equal(w.sentAt, 1000);
  assert.match(makeManualWatch({ coin: 'WLD', direction: 'short', entry: 1, stop: 0.9, tp1: 0.8 }).error, /Stop/);
  assert.match(makeManualWatch({ coin: 'WLD', direction: 'long', entry: 1, stop: 0.9, tp1: 0.95 }).error, /Hedef/);
});
test('elle kayıt geçmiş mumlarla izlenir: dolum → hedef, kapanış zamanı gerçek mum', () => {
  const H = 3600e3, t0 = Date.UTC(2026, 10, 10, 8);
  const w = makeManualWatch({ coin: 'ICP', tf: '1H', direction: 'long', entry: 2.363, stop: 2.294, tp1: 2.456, tp2: 2.505, label: 'arkadaş', sentAt: t0 }, t0 + 30 * H);
  const c = (i, lo, hi) => ({ time: t0 + i * H, open: 2.4, high: hi, low: lo, close: 2.4 });
  const { item } = updateWatch(w, [c(1, 2.37, 2.40), c(2, 2.34, 2.39), c(3, 2.38, 2.47), c(4, 2.45, 2.52)], t0 + 30 * H);
  assert.equal(item.status, 'done'); assert.equal(item.closedAt, t0 + 4 * H); assert.ok(watchR(item) > 1.5);
});
