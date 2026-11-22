// ⭐ Takip bildirimi (bot/watch/notify.js): olay çıkarma, çift bildirim engeli, kapalı kayıt, bayrak, yazma / gönderim hataları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWatchNotify, stepDoc, milestonesOf, formatNotes } from '../bot/watch/notify.js';
import { mergeDocs } from '../src/sync/cloud.js';
import { watchGroups, applyWatchCandles } from '../src/watch/refresh.js';

const M = 15 * 60e3, T0 = Date.UTC(2026, 10, 22, 8, 0);
const c = (t, low, high) => ({ time: t, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 });
const item = (id, o = {}) => ({ id, key: id, coin: 'X', instId: 'X-USDT-SWAP', tf: '15m', direction: 'long', d: 1, entry: 100, stop: 98, tp1: 103, tp2: 105, sentAt: T0, addedAt: T0, status: 'waiting', activeAt: null, signals: [], note: '', updatedAt: T0, lastPrice: 101, ...o });
const ENV = { WATCH_NOTIFY: '1', WATCH_REPO: 'gizli/depo', WATCH_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' };
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

// Sahte GitHub contents API: tek dosya, sha kilidi; putPlan: her PUT için 'ok' | 'conflict' | 500 | 'lost' (yazılır ama yanıt kaybolur)
function fakeGitHub(doc, putPlan = []) {
  const s = { content: doc ? b64(doc) : null, sha: doc ? 's0' : null, n: 0, gets: 0, puts: 0, beforePut: null };
  const f = async (u, o = {}) => {
    if (!o.method) { s.gets++; if (!s.content) return { status: 404, ok: false }; return { status: 200, ok: true, json: async () => ({ content: s.content, sha: s.sha }) }; }
    s.puts++;
    if (s.beforePut) { const fn = s.beforePut; s.beforePut = null; fn(s); }
    const mode = putPlan.shift() || 'ok', body = JSON.parse(o.body);
    if (mode === 500) return { status: 500, ok: false };
    if (mode === 403) return { status: 403, ok: false };
    if (mode === 'conflict' || (s.sha && body.sha !== s.sha)) return { status: 409, ok: false };
    s.content = body.content; s.sha = `s${++s.n}`;
    if (mode === 'lost') throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    return { status: 200, ok: true, json: async () => ({ content: { sha: s.sha } }) };
  };
  return { f, s, doc: () => (s.content ? unb64(s.content) : null) };
}
const deps = (gh, o = {}) => {
  const sent = [], logs = [], calls = [];
  return {
    sent, logs, calls,
    d: {
      fetchImpl: gh.f, log: (l) => logs.push(l), now: () => o.now ?? T0 + 2 * M, run: o.run,
      candles: async (instId, tf, need) => { calls.push(instId); const cs = o.candles?.[instId]; if (!cs) throw new Error('OKX yok'); return { candles: cs, live: null }; },
      send: async (text) => { sent.push(text); return o.sendRes ?? { ok: true, status: 200 }; },
    },
  };
};
const seeded = (items, sent = {}) => ({ items, deleted: [], meta: { watchNotify: { v: 1, at: T0, run: 'eski', sent } }, updatedAt: T0 });

test('bayrak kapalı: hiçbir ağ çağrısı yok, 0 ile çıkar', async () => {
  const gh = fakeGitHub(seeded([item('a')]));
  const x = deps(gh);
  const r = await runWatchNotify({ ...ENV, WATCH_NOTIFY: '' }, x.d);
  assert.equal(r.code, 0); assert.equal(gh.s.gets, 0); assert.equal(x.logs.length, 0); assert.equal(x.sent.length, 0);
});

test('ayar eksik: hata 1, ağ yok', async () => {
  const gh = fakeGitHub(seeded([item('a')]));
  const r = await runWatchNotify({ WATCH_NOTIFY: '1' }, deps(gh).d);
  assert.equal(r.code, 1); assert.equal(gh.s.gets, 0);
});

test('ilk koşu: mevcut durum deftere sessizce yazılır, mesaj yok', async () => {
  const gh = fakeGitHub({ items: [item('a', { status: 'active', activeAt: T0 + M })], deleted: [] });
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 100.5, 101)] } });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 0); assert.equal(x.sent.length, 0);
  assert.deepEqual(gh.doc().meta.watchNotify.sent.a, ['active']);
});

test('olay: bekliyor → girildi tek mesaj; aynı mumlarla ikinci koşu ne yazar ne gönderir', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }));
  const o = { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] } };
  const x = deps(gh, o);
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 0); assert.equal(x.sent.length, 1);
  assert.match(x.sent[0], /^⭐ <b>Takip<\/b> · X 15m LONG — Girildi$/);
  const d1 = gh.doc(); assert.equal(d1.items[0].status, 'active'); assert.equal(d1.items[0].updatedAt, T0 + 1, 'en küçük artış: telefondaki düzenleme kazanır');
  const puts = gh.s.puts, y = deps(gh, { ...o, now: T0 + 3 * M });
  await runWatchNotify(ENV, y.d);
  assert.equal(y.sent.length, 0); assert.equal(gh.s.puts, puts, 'olay yok → yazma yok');
});

test('aynı koşuda birden çok olay / kayıt tek mesajda; mum alınamayan coin diğerini durdurmaz', async () => {
  const gh = fakeGitHub(seeded([item('a'), item('b', { coin: 'Y', instId: 'Y-USDT-SWAP' }), item('z', { coin: 'Z', instId: 'Z-USDT-SWAP' })], { a: [], b: [], z: [] }));
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101), c(T0 + 2 * M, 97, 99)], 'Y-USDT-SWAP': [c(T0 + M, 99.5, 101)] } });
  await runWatchNotify(ENV, x.d);
  assert.equal(x.sent.length, 1);
  const lines = x.sent[0].split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines.find((l) => l.includes(' X ')), /Girildi · Stop oldu/);
  assert.equal(gh.doc().items.find((w) => w.id === 'z').status, 'waiting');
});

test('kapalı kayıt atlanır: mum istenmez, değişmez', async () => {
  const gh = fakeGitHub(seeded([item('a', { status: 'done', closedAt: T0 })], { a: ['close'] }));
  const x = deps(gh, { candles: {} });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 0); assert.equal(x.calls.length, 0); assert.equal(gh.s.puts, 0); assert.equal(x.sent.length, 0);
});

test('sayfanın ilerlettiği durum da bildirilir (taze); eski taş sessiz', () => {
  const now = T0 + 2 * M;
  const doc = seeded([item('a', { status: 'active', activeAt: T0 + M }), item('b', { status: 'active', activeAt: T0 - 20 * 3600e3, sentAt: T0 - 21 * 3600e3 })], { a: [], b: [] });
  const st = stepDoc(doc, new Map(), now);
  assert.deepEqual(st.notes.map((n) => n.id), ['a']);
  assert.deepEqual(st.doc.meta.watchNotify.sent.b, ['active']);
});

test('defterde olmayan yeni kayıt: eklenmeden önceki geçmiş bildirilmez, botun gördüğü geçiş bildirilir', () => {
  const doc = seeded([item('old', { status: 'active', activeAt: T0 + M }), item('neu')], {});
  const st = stepDoc(doc, new Map([['X-USDT-SWAP|15m', [c(T0 + M, 99.5, 101)]]]), T0 + 2 * M);
  assert.deepEqual(st.notes.map((n) => n.id), ['neu']);
});

test('silinen kayıt geri gelmez, defterden düşer', () => {
  const doc = { ...seeded([item('a'), item('b')], { a: [], b: [], c: [] }), deleted: ['b'] };
  const st = stepDoc(doc, new Map([['X-USDT-SWAP|15m', [c(T0 + M, 99.5, 101)]]]), T0 + 2 * M);
  assert.deepEqual(st.doc.items.map((w) => w.id), ['a']); assert.deepEqual(Object.keys(st.doc.meta.watchNotify.sent), ['a']);
  assert.deepEqual(st.doc.deleted, ['b']);
});

test('yazma çakışması: telefon araya not yazdı → yeniden oku-birleştir, not korunur, tek mesaj', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }));
  gh.s.beforePut = (s) => { const d = unb64(s.content); d.items[0] = { ...d.items[0], note: 'Bybit açtım', updatedAt: T0 + 5 }; s.content = b64(d); s.sha = 'tel'; };
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] } });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 0); assert.equal(x.sent.length, 1);
  const w = gh.doc().items[0]; assert.equal(w.note, 'Bybit açtım'); assert.equal(w.status, 'active'); assert.equal(w.updatedAt, T0 + 6);
});

test('telefon sonradan birleştirince botun durumu ve defteri ezilmez; telefondaki yeni düzenleme kazanır', () => {
  const st = stepDoc(seeded([item('a')], { a: [] }), new Map([['X-USDT-SWAP|15m', [c(T0 + M, 99.5, 101)]]]), T0 + 2 * M);
  const phoneStale = { items: [item('a')], deleted: [] }; // telefon eski kopya (aynı updatedAt)
  const m1 = mergeDocs(phoneStale, st.doc);
  assert.equal(m1.items[0].status, 'active'); assert.ok(m1.meta.watchNotify.sent.a.includes('active'));
  const phoneEdit = { items: [item('a', { note: 'x', updatedAt: T0 + 10 * M })], deleted: [] };
  const m2 = mergeDocs(phoneEdit, st.doc);
  assert.equal(m2.items[0].note, 'x'); assert.ok(m2.meta.watchNotify.sent.a.includes('active'), 'defter korunur → durum gerilese de ikinci mesaj yok');
  const again = stepDoc({ ...m2 }, new Map([['X-USDT-SWAP|15m', [c(T0 + M, 99.5, 101)]]]), T0 + 11 * M);
  assert.equal(again.notes.length, 0); assert.equal(again.doc.items[0].status, 'active'); assert.equal(again.doc.items[0].note, 'x');
});

test('yazma kalıcı başarısız: mesaj gitmez, defter değişmez; yazma düzelince sonraki koşu gönderir', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }), [500, 500, 500, 500]);
  const o = { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] } };
  const x = deps(gh, o);
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 1); assert.equal(x.sent.length, 0); assert.deepEqual(gh.doc().meta.watchNotify.sent.a, []);
  const y = deps(gh, o);
  assert.equal((await runWatchNotify(ENV, y.d)).code, 0); assert.equal(y.sent.length, 1);
});

test('yetki hatası (403): tekrar denemeden çıkar, göndermez', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }), [403]);
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] } });
  assert.equal((await runWatchNotify(ENV, x.d)).code, 1); assert.equal(gh.s.puts, 1); assert.equal(x.sent.length, 0);
});

test('yazma yanıtı kayboldu ama yazılmış: belirteçle anlaşılır, tek mesaj gider', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }), ['lost']);
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] }, run: 'r1' });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 0); assert.equal(x.sent.length, 1); assert.equal(gh.s.puts, 1);
});

test('Telegram kesin başarısız: defter geri alınır, sonraki koşu yeniden gönderir', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }));
  const o = { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] } };
  const x = deps(gh, { ...o, sendRes: { ok: false, status: 502, error: 'HTTP 502' } });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 1); assert.equal(r.rolledBack, true); assert.deepEqual(gh.doc().meta.watchNotify.sent.a, []);
  const y = deps(gh, { ...o, now: T0 + 3 * M });
  await runWatchNotify(ENV, y.d);
  assert.equal(y.sent.length, 1); assert.match(y.sent[0], /Girildi/);
});

test('Telegram belirsiz (zaman aşımı): geri alınmaz (çift mesaj olmasın)', async () => {
  const gh = fakeGitHub(seeded([item('a')], { a: [] }));
  const x = deps(gh, { candles: { 'X-USDT-SWAP': [c(T0 + M, 99.5, 101)] }, sendRes: { ok: false, status: null, error: 'The operation was aborted' } });
  const r = await runWatchNotify(ENV, x.d);
  assert.equal(r.code, 1); assert.deepEqual(gh.doc().meta.watchNotify.sent.a, ['active']);
});

test('gizlilik: log coin, depo adı, not ya da mesaj metni içermez; DRY yazmaz / göndermez', async () => {
  const gh = fakeGitHub(seeded([item('a', { coin: 'GIZLICOIN', instId: 'GIZLICOIN-USDT-SWAP', note: 'özel not' })], { a: [] }), [500, 500, 500, 500]);
  const x = deps(gh, { candles: { 'GIZLICOIN-USDT-SWAP': [c(T0 + M, 99.5, 101)] } });
  await runWatchNotify(ENV, x.d);
  const z = deps(gh, { candles: { 'GIZLICOIN-USDT-SWAP': [c(T0 + M, 99.5, 101)] } });
  const r = await runWatchNotify({ ...ENV, DRY: '1' }, z.d);
  assert.equal(r.dry, true); assert.equal(z.sent.length, 0); assert.equal(r.notes.length, 1);
  const all = [...x.logs, ...z.logs].join('\n');
  assert.ok(all.length > 0);
  for (const bad of ['GIZLICOIN', 'gizli/depo', 'özel not', 'Girildi', '100']) assert.ok(!all.includes(bad), bad);
});

test('milestonesOf / formatNotes: erken hedefli kayıt metinleri, HTML kaçışı', () => {
  const w = item('a', { early: 101.2, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early', status: 'early', activeAt: T0, filledAt: T0, earlyAt: T0 + M, tp1At: T0 + 2 * M });
  assert.deepEqual(Object.keys(milestonesOf(w)), ['active', 'early', 'tp1']);
  const st = stepDoc(seeded([w], { a: ['active'] }), new Map(), T0 + 3 * M);
  assert.deepEqual(st.notes[0].texts, ['Erken hedef görüldü (%50 kapat, stop girişe)', 'TP1 görüldü (%25 daha kapat, stop erken hedefe)']);
  assert.equal(formatNotes([{ coin: 'A<B', tf: '5m', direction: 'short', texts: ['x&y'] }]), '⭐ <b>Takip</b> · A&lt;B 5m SHORT — x&amp;y');
});

test('refresh.js: sayfa ve bot aynı grup / mum sayısı ve güncellemeyi kullanır', () => {
  const list = [item('a'), item('b', { status: 'done' }), item('c', { tf: 'yok' })];
  const g = watchGroups(list, T0 + 2 * M);
  assert.deepEqual(g.map((x) => x.key), ['X-USDT-SWAP|15m']); assert.ok(g[0].need >= 300);
  const r = applyWatchCandles(list, g[0].key, [c(T0 + M, 99.5, 101)], T0 + 2 * M);
  assert.deepEqual(r.events.map((e) => [e.id, e.ev]), [['a', 'active']]); assert.equal(r.list[1], list[1]);
});
