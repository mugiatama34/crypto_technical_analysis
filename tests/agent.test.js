import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, liqPrice, clampOpen, openPosition, updatePositions, closeManual, adjustPosition, endOfRun, markToMarket, statsOf } from '../bot/agent/account.js';
import { PROFILES } from '../bot/agent/profiles.js';
import { clampParams, decidePrompt, DECIDE_SCHEMA } from '../bot/agent/manager.js';

const P = PROFILES.temkinli;
const c = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const req = (over = {}) => ({ coin: 'BTC', tf: '1H', direction: 'long', margin: 50, leverage: 5, order: 'market', price: 100, stop: 97, tp1: 104, tp2: 108, rationale: 't', ...over });

test('liqPrice: 5x long ≈ %19,5 aşağı; short ayna', () => {
  assert.ok(Math.abs(liqPrice(100, 5, 'long') - 80.5) < 1e-9);
  assert.ok(Math.abs(liqPrice(100, 5, 'short') - 119.5) < 1e-9);
});

test('clampOpen: kaldıraç/marjin kırpma, pozisyon sayısı, stop tarafı', () => {
  const a = newAccount(P, 1000);
  const ok = clampOpen(a, req({ leverage: 25, margin: 200 }), P.guards, 1000);
  assert.ok(ok.ok); assert.equal(ok.leverage, 10); assert.equal(ok.margin, 120); // %40 × 300
  assert.ok(ok.notes.length === 2);
  assert.equal(clampOpen(a, req({ stop: 101 }), P.guards, 1000).ok, false);
  assert.equal(clampOpen(a, req({ margin: 5 }), P.guards, 1000).ok, false);
  a.positions = [{ coin: 'X' }, { coin: 'Y' }, { coin: 'Z' }];
  assert.equal(clampOpen(a, req(), P.guards, 1000).ok, false);
  a.positions = []; a.day.halted = true;
  assert.equal(clampOpen(a, req(), P.guards, 1000).ok, false);
});

test('openPosition + updatePositions: TP1 yarı, başabaş, TP2; komisyonlar', () => {
  const a = newAccount(P, 1000);
  const r = openPosition(a, req(), 1000, P.guards);
  assert.ok(r.ok);
  const pos = r.position;
  assert.ok(Math.abs(pos.entry - 100.05) < 1e-9); // kayma %0,05
  assert.ok(a.cash < 250 && a.cash > 249.5, `cash ${a.cash}`); // 300 − 50 − komisyon 0,125
  const ev1 = updatePositions(a, { BTC: [c(2000, 101, 104.5, 100.5, 104)] }, 2000);
  assert.deepEqual(ev1.map((e) => e.type), ['tp1']);
  assert.ok(pos.tp1Done && Math.abs(pos.stop - pos.entry) < 1e-9);
  const ev2 = updatePositions(a, { BTC: [c(3000, 104, 108.5, 103, 108)] }, 3000);
  assert.deepEqual(ev2.map((e) => e.type), ['tp2']);
  assert.equal(a.positions.length, 0); assert.equal(a.trades.length, 1);
  const t = a.trades[0];
  assert.equal(t.outcome, 'tp2'); assert.ok(t.pnl > 0 && t.R > 1, `pnl ${t.pnl} R ${t.R}`);
  markToMarket(a, {}); assert.ok(a.equity > 300, `equity ${a.equity}`);
});

test('likidasyon: marjin tamamen gider; stop likidasyon içine çekilir', () => {
  const a = newAccount(P, 1000);
  const r = openPosition(a, req({ leverage: 10, stop: 85 }), 1000, P.guards); // 10x liq ≈ 90.5 → stop kırpılır
  assert.ok(r.ok && r.notes.some((n) => /likidasyon/.test(n)));
  const a2 = newAccount(P, 1000);
  const r2 = openPosition(a2, req({ leverage: 10, stop: 95 }), 1000, P.guards);
  const pos = r2.position; pos.stop = pos.liq - 1; // test: stop'u geçersizleştir, likidasyon önce
  const ev = updatePositions(a2, { BTC: [c(2000, 100, 100, 80, 85)] }, 2000);
  assert.equal(ev[0].type, 'liq');
  assert.equal(a2.trades[0].outcome, 'liq');
  assert.ok(Math.abs(a2.trades[0].pnl + 50) < 1e-6, `pnl ${a2.trades[0].pnl}`);
  assert.equal(a2.stats.liquidations, 1);
});

test('limit emir: dolum ve süre dolumu; elle kapanış; ayar', () => {
  const a = newAccount(P, 1000);
  const r = openPosition(a, req({ order: 'limit', limit_price: 98, stop: 95 }), 1000, P.guards);
  assert.ok(r.ok && r.order);
  updatePositions(a, { BTC: [c(2000, 100, 100.5, 99, 99.5)] }, 2000);
  assert.equal(a.positions.length, 0);
  const ev = updatePositions(a, { BTC: [c(3000, 99.5, 100, 97.5, 99)] }, 3000);
  assert.equal(ev[0].type, 'filled'); assert.equal(a.positions[0].entry, 98);
  const adj = adjustPosition(a, a.positions[0].id, { stop: 96.5, tp1: 101 });
  assert.ok(adj.ok && a.positions[0].stop === 96.5);
  assert.ok(!adjustPosition(a, a.positions[0].id, { stop: 120 }).notes[0].includes('stop 120'));
  const closed = closeManual(a, a.positions[0].id, 99, 4000, 'tez bozuldu');
  assert.equal(closed.type, 'manual'); assert.equal(a.trades.length, 1);
  const b = newAccount(P, 1000);
  openPosition(b, req({ order: 'limit', limit_price: 90, stop: 85 }), 1000, P.guards);
  const ev2 = updatePositions(b, { BTC: [] }, 1000 + 25 * 3600e3);
  assert.equal(ev2[0].type, 'expired'); assert.equal(b.orders.length, 0);
});

test('endOfRun: günlük kayıp sınırı ve eğri; statsOf', () => {
  const a = newAccount(P, 1000);
  a.cash = 240; endOfRun(a, {}, 2000, P.guards);
  assert.ok(a.day.halted, 'gün durdurulmalı (−%20)');
  assert.equal(a.curve.length, 2);
  const s = statsOf(a); assert.equal(s.returnPct, -20);
});

test('clampParams + decidePrompt + şema', () => {
  const p = clampParams({ riskAppetite: 'high', preferredLeverage: [30, 2], maxMarginPctPerTrade: 90, avoidTfs: [], avoidDetectors: [] }, P.guards);
  assert.deepEqual(p.preferredLeverage, [2, 10]); assert.equal(p.maxMarginPctPerTrade, 40);
  const a = newAccount(P, 1000);
  const txt = decidePrompt(a, P, [{ coin: 'ETH', tf: '1H', direction: 'long', score: 70, price: 10, atr: 0.1, zone: [9.8, 9.9], inZone: false, entry: 9.9, stop: 9.6, tp1: 10.3, tp2: 10.8, rr: 3, riskPct: 3, signals: [{ name: 'FVG ↑', group: 'smc', direction: 'long', strength: 0.6 }] }], statsOf(a));
  assert.ok(txt.includes('ETH') && txt.includes('guards'));
  assert.ok(DECIDE_SCHEMA.properties.actions.items.required.includes('rationale'));
});

test('işlem kaydı: açılış ve kapanış BTC fiyatı, btcPct', async () => {
  const { newAccount, openPosition, closeManual } = await import('../bot/agent/account.js');
  const { PROFILES } = await import('../bot/agent/profiles.js');
  const P = PROFILES.temkinli;
  const a = newAccount('temkinli', 1000);
  openPosition(a, { coin: 'X', tf: '1H', direction: 'long', margin: 30, leverage: 3, order: 'market', price: 100, stop: 95, tp1: 105, tp2: 110, rationale: 't', signals: [], btcPrice: 50000 }, 1000, P.guards);
  assert.equal(a.positions[0].btcAtOpen, 50000);
  Object.defineProperty(a, '_btcPrice', { value: 49000, enumerable: false, configurable: true, writable: true });
  closeManual(a, a.positions[0].id, 101, 2000, 'test');
  const t = a.trades[0];
  assert.equal(t.btcAtOpen, 50000); assert.equal(t.btcAtClose, 49000); assert.equal(t.btcPct, -2);
  assert.ok(!JSON.stringify(a).includes('_btcPrice'));
});
