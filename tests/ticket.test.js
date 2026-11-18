import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketOf, latestPlan, formatTicket, RISK_DEFAULT } from '../tools/trades/ticket.mjs';

const inst = { coin: 'NEAR', symbol: 'NEARUSDT', mult: 1, tick: '0.0010', qtyStep: '0.1', minQty: 0.1, minNotional: 5, maxLev: 75 };
const plan = { id: 'NEAR|4H|short|82|1', coin: 'NEAR', tf: '4H', direction: 'short', d: -1, entry: 3.299, stop: 3.397, tp1: 3.154, tp2: 2.865, early: 3.26, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early', score: 82, sentAt: 1e12, status: 'waiting' };
const now = 1e12 + 3600e3;

test('ticketOf: short için varsayılan risk 0,5 $, miktar aşağı yuvarlı, üç kademe', () => {
  const t = ticketOf(plan, inst, { now });
  assert.equal(t.ok, true);
  assert.equal(t.riskUsd, RISK_DEFAULT.short);
  assert.equal(t.qty, 5.1); // 0,5 ÷ 0,098 = 5,102 → 5,1
  assert.ok(t.riskReal <= 0.5 + 1e-9);
  assert.deepEqual(t.legs.map((l) => [l.tag, l.price, l.qty]), [['T1', 3.26, 2.5], ['T2', 3.154, 1.2], ['T3', 2.865, 1.4]]);
  assert.ok(Math.abs(t.legs.reduce((a, l) => a + l.qty, 0) - t.qty) < 1e-9);
  assert.deepEqual(t.stopMoves, [{ after: 'T1', to: 3.299 }, { after: 'T2', to: 3.26 }]);
  assert.equal(t.lev, 20);
  assert.equal(t.warns.some((w) => w.includes('plan')), false);
});

test('ticketOf: long varsayılan 1 $, --risk önceliklidir', () => {
  const long = { ...plan, direction: 'long', d: 1, entry: 3.0, stop: 2.9, early: 3.036, tp1: 3.15, tp2: 3.3 };
  assert.equal(ticketOf(long, inst, { now }).riskUsd, 1);
  assert.equal(ticketOf(long, inst, { now, riskUsd: 2 }).qty, 20);
});

test('ticketOf: uyarılar (kapanmış plan, stop < %1, fiyat girişi geçmiş, küçük kademe)', () => {
  assert.ok(ticketOf({ ...plan, status: 'be' }, inst, { now }).warns.some((w) => w.includes('kapanmış')));
  assert.ok(ticketOf({ ...plan, status: 'active' }, inst, { now }).warns.some((w) => w.includes('beklemiyor')));
  assert.ok(ticketOf({ ...plan, stop: 3.32 }, inst, { now }).warns.some((w) => w.includes('< %1')));
  assert.ok(ticketOf(plan, inst, { now, last: 3.31 }).warns.some((w) => w.includes('hemen dolar')));
  assert.ok(ticketOf(plan, inst, { now, last: 3.2 }).warns.some((w) => w.includes('kaçmış')));
  assert.ok(ticketOf(plan, inst, { now }).warns.some((w) => w.includes('T2') && w.includes('en az')));
  assert.ok(ticketOf(plan, inst, { now: now + 72 * 3600e3 }).warns.some((w) => w.includes('saat önce')));
});

test('ticketOf: en küçük emrin altında → ok:false ve en küçük emirle risk', () => {
  const eth = { coin: 'ETH', symbol: 'ETHUSDT', mult: 1, tick: '0.01', qtyStep: '0.01', minQty: 0.01, minNotional: 5, maxLev: 100 };
  const t = ticketOf({ ...plan, coin: 'ETH', entry: 1898.59, stop: 1992.82, early: 1875.8, tp1: 1757.25, tp2: 1709.08 }, eth, { now });
  assert.equal(t.ok, false);
  assert.match(t.reason, /risk 0\.94 \$ olur/);
  assert.equal(ticketOf(null, inst).ok, false);
  assert.equal(ticketOf(plan, null).ok, false);
});

test('latestPlan + formatTicket: en yeni plan, çarpanlı sembol, düğme adları', () => {
  const items = [{ ...plan, sentAt: 1 }, { ...plan, sentAt: 5, id: 'yeni' }, { ...plan, coin: 'XRP', sentAt: 9 }, { ...plan, tf: '1H', sentAt: 8 }];
  assert.equal(latestPlan(items, 'near').id, 'yeni');
  assert.equal(latestPlan(items, 'NEARUSDT', { dir: 'long' }), null);
  const txt = formatTicket(ticketOf(plan, inst, { now }));
  assert.match(txt, /A\) GİRİŞ .*→ Short/);
  assert.match(txt, /Price 3\.2990 · Qty 5\.1 · TP\/SL: Take Profit 2\.8650 · Stop Loss 3\.3970/);
  assert.match(txt, /Reduce-Only işaretli\) → Long/);
  const pepe = ticketOf({ ...plan, coin: 'PEPE', direction: 'long', d: 1, entry: 0.000005268, stop: 0.000005072, early: 0.000005331, tp1: 0.0000055, tp2: 0.000005815 }, { coin: 'PEPE', symbol: '1000PEPEUSDT', mult: 1000, tick: '0.0000001', qtyStep: '100', minQty: 100, minNotional: 5, maxLev: 50 }, { now });
  assert.equal(pepe.ok, true);
  assert.match(formatTicket(pepe), /×1000/);
});
