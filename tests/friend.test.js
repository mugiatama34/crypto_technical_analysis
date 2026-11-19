import test from 'node:test';
import assert from 'node:assert/strict';
import { FRIEND_URL, friendCoin, friendId, syncFriend, formatFriendOpen, formatFriendClose } from '../bot/friend.js';

const NOW = Date.parse('2026-11-14T22:00:00Z');
const pos = (o = {}) => ({
  symbol: 'XRP/USDT:USDT', side: 'SELL', entry: 0.9252, tp: 0.8764, sl: 1.0753,
  open_time: '2026-11-14T21:07:23+00:00', last_price: 0.93, unrealized_r: -0.03, breakeven_done: false, partial_tp_done: false, ...o,
});
const st = (positions = [], history = []) => ({ history, open_positions: Object.fromEntries(positions.map((p) => [p.symbol, p])) });
const base = () => syncFriend(null, st(), { now: NOW }).next;

test('FRIEND_URL', () => assert.match(FRIEND_URL, /Hasanwavebot\/main\/data\/4h\/account_state\.json$/));

test('friendCoin', () => {
  assert.equal(friendCoin('XRP/USDT:USDT'), 'XRP');
  assert.equal(friendCoin('1000pepe/USDT:USDT'), '1000PEPE');
  assert.equal(friendCoin('XRPUSDT'), null);
  assert.equal(friendCoin(null), null);
});

test('friendId', () => assert.equal(friendId(pos()), `XRP|${Date.parse('2026-11-14T21:07:23+00:00')}`));

test('K1 geçersiz state prev döner', () => {
  const prev = base();
  for (const bad of [null, 'x', {}, { open_positions: [] }, { open_positions: 5 }]) {
    const r = syncFriend(prev, bad, { now: NOW });
    assert.equal(r.next, prev);
    assert.deepEqual([r.opened, r.closed], [[], []]);
  }
  assert.equal(syncFriend(null, null, { now: NOW }).next.version, 1);
});

test('K2 ilk çalıştırmada bildirim yok, hepsi seen', () => {
  const r = syncFriend(null, st([pos()]), { now: NOW });
  assert.equal(r.opened.length, 0);
  assert.equal(r.next.startedAt, NOW);
  assert.ok(r.next.seen[friendId(pos())]);
  assert.equal(r.next.items.length, 0);
});

test('K3 yeni taze SHORT bildirilir; ikinci çağrıda boş', () => {
  const s = st([pos()]);
  const r1 = syncFriend(base(), s, { now: NOW });
  assert.equal(r1.opened.length, 1);
  const r2 = syncFriend(r1.next, s, { now: NOW + 1000 });
  assert.equal(r2.opened.length, 0);
  assert.equal(r2.next.items.length, 1);
});

test('K3 eski SHORT yalnız seen; BUY hiç bildirilmez; geçersiz sıra elenir', () => {
  const old = pos({ open_time: '2026-11-14T10:00:00+00:00' });
  const buy = pos({ symbol: 'ETH/USDT:USDT', side: 'BUY', entry: 100, sl: 90, tp: 120 });
  const bad = pos({ symbol: 'SOL/USDT:USDT', sl: 0.5 });
  const r = syncFriend(base(), st([old, buy, bad]), { now: NOW });
  assert.equal(r.opened.length, 0);
  assert.equal(r.next.items.length, 0);
  assert.ok(r.next.seen[friendId(old)] && r.next.seen[friendId(buy)]);
});

test('K4 item biçimi', () => {
  const [it] = syncFriend(base(), st([pos()]), { now: NOW }).opened;
  assert.deepEqual(it, {
    id: friendId(pos()), coin: 'XRP', symbol: 'XRP/USDT:USDT', direction: 'short', source: 'hasanwave', tf: '4H',
    entry: 0.9252, stop: 1.0753, tp: 0.8764, openTime: Date.parse('2026-11-14T21:07:23+00:00'), seenAt: NOW, lastPrice: 0.93, status: 'open',
  });
});

test('K5 kapanış history ile eşleşir; yoksa gone', () => {
  const r1 = syncFriend(base(), st([pos()]), { now: NOW });
  const h = { symbol: 'XRP/USDT:USDT', side: 'SELL', exit: 0.8764, result: 'TP', pnl: 100, partial_taken: true, r_multiple: 0.33, open_time: '2026-11-14T21:07:23+00:00', close_time: '2026-11-15T03:00:00+00:00' };
  const r2 = syncFriend(r1.next, st([], [h]), { now: NOW + 3600e3 });
  assert.equal(r2.closed.length, 1);
  const c = r2.closed[0];
  assert.deepEqual([c.status, c.exit, c.result, c.r, c.pnl, c.partial, c.closeTime], ['closed', 0.8764, 'TP', 0.33, 100, true, Date.parse(h.close_time)]);
  const r3 = syncFriend(r1.next, st([], []), { now: NOW + 3600e3 });
  assert.equal(r3.closed.length, 0);
  assert.equal(r3.next.items[0].status, 'gone');
});

test('K6 açık item güncellenir, bildirim yok', () => {
  const r1 = syncFriend(base(), st([pos()]), { now: NOW });
  const r2 = syncFriend(r1.next, st([pos({ last_price: 0.9, unrealized_r: 0.2, breakeven_done: true, partial_tp_done: true })]), { now: NOW + 1000 });
  const it = r2.next.items[0];
  assert.deepEqual([it.lastPrice, it.unrealizedR, it.breakeven, it.partialDone, it.status], [0.9, 0.2, true, true, 'open']);
  assert.deepEqual([r2.opened, r2.closed], [[], []]);
});

test('K7 prev değişmez, 90 gün eski seen atılır, updatedAt', () => {
  const prev = { version: 1, startedAt: 1, seen: { 'OLD|1': NOW - 91 * 86400e3, 'NEW|2': NOW - 86400e3 }, items: [] };
  const snap = JSON.stringify(prev);
  const r = syncFriend(prev, st([pos()]), { now: NOW });
  assert.equal(JSON.stringify(prev), snap);
  assert.equal(r.next.seen['OLD|1'], undefined);
  assert.ok(r.next.seen['NEW|2']);
  assert.equal(r.next.updatedAt, NOW);
});

test('formatFriendOpen', () => {
  const [it] = syncFriend(base(), st([pos()]), { now: NOW }).opened;
  const t = formatFriendOpen(it, { price: 0.93 });
  assert.match(t, /<b>🌊 ARKADAŞ SİSTEMİ<\/b> \(Elliott dalga 4H\) — <b>XRP<\/b> 🔴 SHORT/);
  assert.match(t, /Giriş  <code>0\.9252<\/code>/);
  assert.match(t, /Stop  <code>1\.0753<\/code>  \(%16\.22\)/);
  assert.match(t, /Hedef  <code>0\.8764<\/code>  \(%5\.27 · 0\.33R\)/);
  assert.match(t, /Şu an <code>0\.9300<\/code> · açılış 14\.11 21:07 UTC/);
  assert.match(t, /Hasanwavebot kâğıt hesabı/);
  assert.doesNotMatch(formatFriendOpen({ ...it, lastPrice: null }), /Şu an/);
  assert.match(formatFriendOpen({ ...it, coin: 'A<B' }), /A&lt;B/);
});

test('formatFriendClose', () => {
  const it = { coin: 'XRP', result: 'TP', exit: 0.8764, r: 1.714 };
  assert.equal(formatFriendClose(it), '🌊 Arkadaş sistemi — <b>XRP</b> SHORT kapandı: TP · çıkış <code>0.8764</code> · +1.71R');
  assert.match(formatFriendClose({ ...it, result: 'SL', r: -1, partial: true }), /· -1\.00R · kısmi kâr alınmıştı$/);
});
