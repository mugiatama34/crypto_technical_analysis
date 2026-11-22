import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rebuild, dedupe, diag, netR, summarize, formatReport } from '../tools/watch/history-lib.mjs';

const it = (id, o = {}) => ({ id, coin: 'ARB', tf: '4H', direction: 'long', d: 1, entry: 100, stop: 98, tp1: 104, tp2: 108, atr: 2, priceAtAdd: 103, sentAt: 1000, addedAt: 1000, status: 'waiting', ...o });
const C = (time, low, high) => ({ time, open: low, high, low, close: high, volume: 1 });

test('rebuild: silinme, geri gelme, düz dizi, bozuk sürüm', () => {
  const r = rebuild([
    { time: 10, json: { items: [it('a'), it('b')] } },
    { time: 20, json: [it('a', { status: 'active' })] }, // düz dizi; b silindi
    { time: 30, json: null }, // bozuk
    { time: 40, json: { items: [it('a'), it('b')] } }, // b geri geldi
    { time: 50, json: { items: [it('b')] } }, // a silindi
  ]);
  const a = r.find((x) => x.last.id === 'a'), b = r.find((x) => x.last.id === 'b');
  assert.equal(a.firstSeen, 10); assert.equal(a.lastSeen, 40); assert.equal(a.gone, 50);
  assert.equal(a.last.status, 'waiting');
  assert.equal(b.gone, null); assert.equal(b.lastSeen, 50);
  const c = rebuild([{ time: 1, json: { items: [it('x')] } }, { time: 2, json: { items: [] } }]);
  assert.equal(c[0].gone, 2);
});

test('dedupe: aynı plan tek kayıt, farklı giriş ayrı', () => {
  const l = [it('1', { addedAt: 300 }), it('2', { addedAt: 100 }), it('3', { addedAt: 200 }), it('4', { entry: 101 })];
  const { list, dropped } = dedupe(l);
  assert.equal(dropped, 2); assert.equal(list.length, 2);
  assert.equal(list[0].addedAt, 100);
});

test('diag: long ve short işaretleri, pFill', () => {
  const d = diag(it('l'), null);
  assert.equal(d.distEntry, 3); assert.equal(d.distTp1, 1); assert.equal(d.pFill, 0.25);
  assert.equal(d.stopPct, 2); assert.equal(d.distEntryAtr, 1.5); assert.equal(d.distEntryR, 1.5); assert.equal(d.gapLeft, null);
  const s = diag(it('s', { direction: 'short', d: -1, entry: 100, stop: 102, tp1: 96, priceAtAdd: 97 }), null);
  assert.equal(s.distEntry, 3); assert.equal(s.distTp1, 1); assert.equal(s.pFill, 0.25);
  assert.equal(diag(it('z', { priceAtAdd: 100 }), null).pFill, 1); // bölgede eklendi
  assert.equal(diag(it('z', { priceAtAdd: 99 }), null).pFill, 1);
  assert.equal(diag(it('n', { priceAtAdd: null }), null).pFill, null);
  assert.equal(diag(it('t', { priceAtAdd: 105 }), null).pFill, 0); // TP1 zaten geçildi, giriş uzakta
});

test('diag: gapLeft', () => {
  const w = it('g', { closedBar: 3000, status: 'missed' });
  assert.equal(diag(w, [C(1000, 100, 104)]).gapLeft, 0);
  assert.equal(diag(w, [C(1000, 101.5, 104)]).gapLeft, 0.5);
  assert.equal(diag(w, [C(1000, 105, 106)]).gapLeft, 5 / 3);
  assert.equal(diag(w, [C(500, 90, 91)]).gapLeft, null); // sentAt öncesi mum yok
  const s = it('s', { direction: 'short', d: -1, entry: 100, stop: 102, tp1: 96, priceAtAdd: 97, closedBar: 3000 });
  assert.equal(diag(s, [C(1000, 96, 98.5)]).gapLeft, 0.5);
  assert.equal(diag(w, []).gapLeft, null);
  assert.equal(diag(it('c', { closedAt: 7200000, addedAt: 0 }), null).minsToEnd, 120);
});

test('netR', () => {
  assert.equal(netR(1, 2), 0.95); assert.equal(netR(null, 2), null);
});

const row = (id, status, R, o = {}) => { const w = it(id, { status, ...o }); return { w, R, diag: diag(w, null), replayed: false }; };

test('summarize ve formatReport', () => {
  const rows = [row('a', 'done', 2), row('b', 'stopped', -1), row('c', 'missed', null), row('d', 'expired', null), row('e', 'waiting', null, { tf: '1H' })];
  const s = summarize(rows);
  assert.equal(s.total, 5); assert.equal(s.filled, 2); assert.equal(s.missed, 1); assert.equal(s.expired, 1); assert.equal(s.waiting, 1);
  assert.equal(s.avgR, 0.5); assert.equal(s.sumR, 1); assert.equal(s.winPct, 50);
  assert.ok(Math.abs(s.avgNetR - 0.45) < 1e-9);
  assert.equal(s.expectedFills, 5 * 0.25); assert.equal(s.actualFills, 2);
  const tf4 = s.breakdowns['TF'].find((g) => g.key === '4H');
  assert.equal(tf4.n, 4); assert.equal(tf4.filled, 2); assert.equal(tf4.fillRate, 0.5); assert.equal(tf4.missed, 1); assert.equal(tf4.avgR, 0.5);
  assert.equal(s.breakdowns['Etiket'][0].key, 'etiketsiz');
  const txt = formatReport(s, rows);
  assert.match(txt, /n < 30: iddia yok \(yalnız kayıt\)/);
  assert.match(txt, /\+2,00/);
});

test('kaynaklarda sabit depo adı yok; klon argümanı değişkenden', () => {
  for (const f of ['tools/watch/history.mjs', 'tools/watch/history-lib.mjs']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /github\.com\//);
    assert.doesNotMatch(src, /[\w-]+\/trade/i);
  }
  const src = fs.readFileSync(new URL('../tools/watch/history.mjs', import.meta.url), 'utf8');
  assert.match(src, /'gh', \['repo', 'clone', repo,/);
});
