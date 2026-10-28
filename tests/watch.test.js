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
