// tools/trades/fetch.mjs: saf dönüştürücüler (ağ ve anahtar zinciri yok). Bybit'e yalnız iki okuma yolu çağrılabilir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pnlRow, orderRow, slRow, windows, sign, toCsv, ALLOWED, PNL_HEAD, ORD_HEAD } from '../tools/trades/fetch.mjs';

const T = Date.parse('2026-11-17T18:12:30Z');
const entry = { symbol: 'NEARUSDT', qty: '5.3', price: '3.299', avgPrice: '3.299', triggerPrice: '', cumExecQty: '5.3', cumExecFee: '0.0035', side: 'Sell', orderType: 'Limit', orderStatus: 'Filled', orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeedb3a9524', createdTime: String(T), timeInForce: 'GTC', stopOrderType: '', reduceOnly: false, stopLoss: '3.396' };

test('fetch: yalnız okuma yolları; kaynakta emir / iptal yolu yok', () => {
  assert.deepEqual(ALLOWED, ['/v5/position/closed-pnl', '/v5/order/history']);
  const src = fs.readFileSync(new URL('../tools/trades/fetch.mjs', import.meta.url), 'utf8');
  assert.equal(/order\/create|order\/cancel|order\/amend|method:\s*'POST'/i.test(src), false);
  assert.equal(/console\.log\([^)]*(secret|cred)/i.test(src), false); // anahtar loglanmaz
});

test('fetch: kapanış satırı rtable sütunlarında; zaman = updatedTime (UTC); tasfiye etiketi', () => {
  const r = pnlRow({ symbol: 'NEARUSDT', closedSize: '2.6', avgEntryPrice: '3.299', avgExitPrice: '3.154', openFee: '0.0017', closeFee: '0.0045', closedPnl: '0.37', execType: 'Trade', createdTime: String(T - 3600e3), updatedTime: String(T) });
  assert.equal(r.length, PNL_HEAD.split(',').length);
  assert.deepEqual([r[0], r[1], r[2], r[3], r[9], r[10], r[11]], ['NEARUSDT', '2.6', '3.299', '3.154', 'Trade', '0.37', '18:12 2026-11-17']);
  assert.equal(pnlRow({ execType: 'BustTrade', updatedTime: String(T) })[9], 'Liquidation');
});

test('fetch: emir satırı dışa aktarım düzeninde; kimlik son 8 karakter; yön Buy → Long', () => {
  const r = orderRow(entry);
  assert.equal(r.length, ORD_HEAD.split(',').length);
  assert.deepEqual([r[0], r[3], r[4], r[7], r[8], r[9], r[10], r[11], r[13]], ['NEARUSDT', '3.299', '', 'Short', 'Limit', 'Filled', ' db3a9524', '18:12 2026-11-17', '18:12 2026-11-17']);
  assert.equal(orderRow({ ...entry, side: 'Buy', avgPrice: '0', triggerPrice: '3.153' })[7], 'Long');
  assert.equal(orderRow({ ...entry, triggerPrice: '3.153' })[4], '3.153');
  const csv = toCsv(ORD_HEAD, [r]); assert.equal(csv.split('\n').length, 3); assert.ok(csv.includes('"{""USDT"":""0.0035""}"')); // ücret alanı tırnaklı
});

test('fetch: ekli stop yapay satırı — ters yön, tetik = stop; kapanış / dolmamış / stopsuz emirde yok', () => {
  const r = slRow(entry);
  assert.deepEqual([r[0], r[4], r[7], r[9], r[10], r[13]], ['NEARUSDT', '3.396', 'Long', 'Deactivated', ' sl:db3a9524', '18:12 2026-11-17']);
  assert.equal(slRow({ ...entry, side: 'Buy' })[7], 'Short');
  assert.equal(slRow({ ...entry, reduceOnly: true }), null);
  assert.equal(slRow({ ...entry, stopOrderType: 'StopLoss' }), null);
  assert.equal(slRow({ ...entry, cumExecQty: '0' }), null);
  assert.equal(slRow({ ...entry, stopLoss: '' }), null);
});

test('fetch: 7 günlük pencereler aralığı boşluksuz ve örtüşmesiz kaplar; imza belirlenimli', () => {
  const D = 86400e3, w = windows(0, 20 * D);
  assert.equal(w.length, 3); assert.deepEqual(w[0], [0, 7 * D - 1]); assert.equal(w[1][0], 7 * D); assert.equal(w[2][1], 20 * D - 1);
  assert.equal(sign('s', 1, 'k', 5000, 'a=1'), sign('s', 1, 'k', 5000, 'a=1')); assert.notEqual(sign('s', 1, 'k', 5000, 'a=1'), sign('s', 2, 'k', 5000, 'a=1')); assert.match(sign('s', 1, 'k', 5000, ''), /^[0-9a-f]{64}$/);
});
