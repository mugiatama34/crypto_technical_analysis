import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyRescore, finalR } from '../src/ui/signals-lib.js';

const overlay = { items: { A: { status: 'stopped', R: -1, reason: 'neden', at: '2026-11-13' } } };
const mk = () => [{ id: 'A', status: 'be', early: 101.2, entry: 100, stop: 99, earlyPortion: 0.8 }, { id: 'B', status: 'done' }];

test('applyRescore: eşleşen kayıt güncellenir, eşleşmeyen aynı referans, girdi değişmez', () => {
  const items = mk(), before = JSON.parse(JSON.stringify(items));
  const out = applyRescore(items, overlay);
  assert.notEqual(out, items);
  assert.equal(out[0].status, 'stopped');
  assert.deepEqual(out[0].rescored, { R: -1, from: 'be', reason: 'neden', at: '2026-11-13' });
  assert.equal(out[1], items[1]);
  assert.deepEqual(items, before);
  assert.equal(items[0].rescored, undefined);
});

test('applyRescore: overlay null/bozuk → aynı içerik', () => {
  const items = mk();
  for (const o of [null, undefined, {}, { items: null }, 'x']) assert.deepEqual(applyRescore(items, o), items);
});

test('finalR: rescored.R öncelikli, yoksa eski davranış', () => {
  assert.equal(finalR({ status: 'be', rescored: { R: -1 } }), -1);
  assert.equal(finalR({ status: 'be', rescored: { R: 0.971 } }), 0.971);
  assert.equal(finalR({ status: 'stopped' }), -1);
  const be = { status: 'be', early: 101.2, entry: 100, stop: 99, earlyPortion: 0.8 };
  const a = finalR(be), b = finalR({ ...be, rescored: { R: -1 } });
  assert.notEqual(a, b);
  assert.equal(b, -1);
});

test('gerçek dosyalar: rescored.json anahtarları history.json id\'leriyle eşleşir', () => {
  const r = JSON.parse(fs.readFileSync(new URL('../docs/signals/rescored.json', import.meta.url), 'utf8'));
  const h = JSON.parse(fs.readFileSync(new URL('../docs/signals/history.json', import.meta.url), 'utf8'));
  const ids = new Set(h.items.map((s) => s.id));
  for (const [k, v] of Object.entries(r.items)) {
    assert.ok(ids.has(k), `history'de yok: ${k}`);
    assert.equal(typeof v.status, 'string', k);
    assert.equal(typeof v.R, 'number', k);
  }
});
