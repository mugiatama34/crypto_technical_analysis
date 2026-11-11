import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocs, syncDoc, pull, validRepo } from '../src/sync/cloud.js';

test('mergeDocs: yeni updatedAt kazanır, silinen iki taraftan düşer', () => {
  const a = { items: [{ id: 'x', updatedAt: 2, note: 'yeni' }, { id: 'y', updatedAt: 1 }], deleted: ['z'] };
  const b = { items: [{ id: 'x', updatedAt: 1, note: 'eski' }, { id: 'z', updatedAt: 5 }, { id: 'w', updatedAt: 1 }], deleted: [] };
  const m = mergeDocs(a, b);
  assert.deepEqual(m.items.map((i) => i.id).sort(), ['w', 'x', 'y']);
  assert.equal(m.items.find((i) => i.id === 'x').note, 'yeni'); assert.deepEqual(m.deleted, ['z']);
});
test('validRepo', () => { assert.ok(validRepo('ferhat/veri')); assert.ok(!validRepo('veri')); assert.ok(!validRepo('a/b/c')); });

// Sahte GitHub: tek dosya, sha ile iyimser kilit
function fakeGitHub() {
  const store = { content: null, sha: null, n: 0 };
  const f = async (u, o = {}) => {
    if (!o.method) { if (!store.content) return { status: 404, ok: false }; return { status: 200, ok: true, json: async () => ({ content: store.content, sha: store.sha }) }; }
    const body = JSON.parse(o.body);
    if (store.sha && body.sha !== store.sha) return { status: 409, ok: false };
    store.content = body.content; store.sha = `s${++store.n}`; return { status: 200, ok: true, json: async () => ({ content: { sha: store.sha } }) };
  };
  return { f, store };
}
test('syncDoc: iki cihaz sırayla eşitler → ikisinin kayıtları da bulutta', async () => {
  const { f } = fakeGitHub(), cfg = { repo: 'u/r', token: 't' };
  await syncDoc(cfg, 'watch.json', { items: [{ id: 'tel', updatedAt: 1 }], deleted: [] }, f);
  const m = await syncDoc(cfg, 'watch.json', { items: [{ id: 'is', updatedAt: 1 }], deleted: [] }, f);
  assert.deepEqual(m.items.map((i) => i.id).sort(), ['is', 'tel']);
  const { doc } = await pull(cfg, 'watch.json', f);
  assert.deepEqual(doc.items.map((i) => i.id).sort(), ['is', 'tel']);
  // telefonda silinen kayıt iş bilgisayarının eski kopyasından geri gelmez
  await syncDoc(cfg, 'watch.json', { items: [{ id: 'is', updatedAt: 1 }], deleted: ['tel'] }, f);
  const m2 = await syncDoc(cfg, 'watch.json', { items: [{ id: 'tel', updatedAt: 1 }, { id: 'is', updatedAt: 1 }], deleted: [] }, f);
  assert.deepEqual(m2.items.map((i) => i.id), ['is']);
});
test('syncDoc: Türkçe karakterler bozulmaz', async () => {
  const { f } = fakeGitHub(), cfg = { repo: 'u/r', token: 't' };
  await syncDoc(cfg, 'w.json', { items: [{ id: 'a', updatedAt: 1, note: 'ğüşıöç ₺' }], deleted: [] }, f);
  assert.equal((await pull(cfg, 'w.json', f)).doc.items[0].note, 'ğüşıöç ₺');
});
