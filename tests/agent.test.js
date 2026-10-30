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

test('kısmi kapanış sonrası marjin tam iade: özsermaye = başlangıç + net kâr', () => {
  const a = newAccount(P, 1000);
  openPosition(a, req(), 1000, P.guards);
  updatePositions(a, { BTC: [c(2000, 101, 104.5, 100.5, 104)] }, 2000); // TP1 yarı
  updatePositions(a, { BTC: [c(3000, 104, 108.5, 103, 108)] }, 3000); // TP2 kalan
  markToMarket(a, {});
  assert.equal(a.positions.length, 0);
  assert.ok(Math.abs(a.equity - (300 + a.trades[0].pnl)) < 1e-4, `equity ${a.equity} vs 300 + ${a.trades[0].pnl}`);
  // TP1 sonrası stop (başabaş) için de aynı
  const b = newAccount(P, 1000);
  openPosition(b, req(), 1000, P.guards);
  updatePositions(b, { BTC: [c(2000, 101, 104.5, 100.5, 104)] }, 2000);
  updatePositions(b, { BTC: [c(3000, 104, 104, 99, 99.5)] }, 3000);
  markToMarket(b, {});
  assert.equal(b.trades[0].outcome, 'tp1_stop');
  assert.ok(Math.abs(b.equity - (300 + b.trades[0].pnl)) < 1e-4, `equity ${b.equity} vs 300 + ${b.trades[0].pnl}`);
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
  assert.ok(Math.abs(a2.trades[0].pnl + 50.25) < 1e-6, `pnl ${a2.trades[0].pnl}`); // marjin 50 + açılış komisyonu 0,25
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
  const a = newAccount(P, 1000);
  openPosition(a, { coin: 'X', tf: '1H', direction: 'long', margin: 30, leverage: 3, order: 'market', price: 100, stop: 95, tp1: 105, tp2: 110, rationale: 't', signals: [], btcPrice: 50000 }, 1000, P.guards);
  assert.equal(a.positions[0].btcAtOpen, 50000);
  Object.defineProperty(a, '_btcPrice', { value: 49000, enumerable: false, configurable: true, writable: true });
  closeManual(a, a.positions[0].id, 101, 2000, 'test');
  const t = a.trades[0];
  assert.equal(t.btcAtOpen, 50000); assert.equal(t.btcAtClose, 49000); assert.equal(t.btcPct, -2);
  assert.ok(!JSON.stringify(a).includes('_btcPrice'));
});

test('hedge: ters BTC bacağı aynı nominal; pozisyon sayısına girmez; ana kapanınca bacak kapanır; limit dolumunda bacak; marjin hedge dahil kırpılır', async () => {
  const { newAccount, openPosition, closeManual, updatePositions, openPendingHedges, closeOrphanHedges } = await import('../bot/agent/account.js');
  const { PROFILES } = await import('../bot/agent/profiles.js');
  const P = PROFILES.temkinli;
  const a = newAccount(P, 1000);
  const r = openPosition(a, { coin: 'ETH', tf: '4H', direction: 'long', margin: 30, leverage: 3, order: 'market', price: 100, stop: 95, tp1: 110, tp2: 120, hedge: true, rationale: 't', signals: [], btcPrice: 50000 }, 1000, P.guards);
  assert.ok(r.ok && r.hedgeLeg);
  const h = r.hedgeLeg;
  assert.equal(h.coin, 'BTC'); assert.equal(h.direction, 'short'); assert.equal(h.hedgeOf, r.position.id);
  assert.ok(Math.abs(h.notional - r.position.notional) < 1e-6); assert.equal(h.tp1, null);
  assert.ok(h.stop > h.entry && h.stop < h.liq);
  assert.equal(a.positions.length, 2);
  // pozisyon sayısı: maxPositions 3 → 2 ana daha açılabilir (hedge bacağı sayılmaz)
  assert.ok(openPosition(a, { coin: 'SOL', tf: '4H', direction: 'long', margin: 20, leverage: 2, order: 'market', price: 10, stop: 9, rationale: '', signals: [] }, 1000, P.guards).ok);
  assert.ok(openPosition(a, { coin: 'LINK', tf: '4H', direction: 'long', margin: 20, leverage: 2, order: 'market', price: 10, stop: 9, rationale: '', signals: [] }, 1000, P.guards).ok);
  assert.equal(openPosition(a, { coin: 'ADA', tf: '4H', direction: 'long', margin: 20, leverage: 2, order: 'market', price: 10, stop: 9, rationale: '', signals: [] }, 1000, P.guards).ok, false);
  // ana kapanınca bacak kapanır
  closeManual(a, r.position.id, 101, 2000, 'test');
  const ev = closeOrphanHedges(a, 49000, 2000);
  assert.equal(ev.length, 1); assert.ok(!a.positions.some((p) => p.hedgeOf));
  const ht = a.trades.find((t) => t.hedgeOf);
  assert.ok(ht && ht.pnl > 0, 'BTC düştü, short bacak kârlı');
  // limit dolumunda bacak
  const b = newAccount(P, 1000);
  const lim = openPosition(b, { coin: 'ETH', tf: '1H', direction: 'long', margin: 30, leverage: 3, order: 'limit', limit_price: 95, price: 100, stop: 90, hedge: true, rationale: '', signals: [], btcPrice: 50000 }, 1000, P.guards);
  assert.ok(lim.ok && lim.order.hedge);
  updatePositions(b, { ETH: [{ time: 2000, open: 100, high: 100, low: 94, close: 96 }] }, 2000);
  assert.ok(b.positions[0].pendingHedge);
  const legs = openPendingHedges(b, 51000, 2500);
  assert.equal(legs.length, 1); assert.equal(legs[0].direction, 'short'); assert.equal(b.positions.length, 2);
  // marjin: hedge dahil üst sınır (maxMarginPct 40 → 300 × 0,4 / 2 = 60)
  const c = newAccount(P, 1000);
  const big = openPosition(c, { coin: 'ETH', tf: '4H', direction: 'long', margin: 100, leverage: 2, order: 'market', price: 100, stop: 95, hedge: true, rationale: '', signals: [], btcPrice: 50000 }, 1000, P.guards);
  assert.ok(big.ok && Math.abs(big.position.margin - 60) < 1e-6 && Math.abs(big.hedgeLeg.margin - 60) < 1e-6);
});

test('piyasa okuması ve yön istatistiği karara girer; BTC trend adayı source ile açılır', async () => {
  const { decidePrompt, dirStatsOf } = await import('../bot/agent/manager.js');
  const { newAccount, openPosition } = await import('../bot/agent/account.js');
  const { PROFILES } = await import('../bot/agent/profiles.js');
  const P = PROFILES.temkinli;
  const a = newAccount(P, 1000);
  a.trades.push({ direction: 'long', R: -1, pnl: -5, btcPct: -2 }, { direction: 'long', R: 2, pnl: 10, btcPct: 1.5 }, { direction: 'short', R: 0.5, pnl: 2, btcPct: -1 }, { direction: 'short', R: -1, pnl: -3, hedgeOf: 'x' });
  const ds = dirStatsOf(a);
  assert.equal(ds.long.n, 2); assert.equal(ds.short.n, 1); assert.equal(ds.longWhileBtcDown.n, 1); assert.equal(ds.longWhileBtcDown.avgR, -1);
  const read = { daily: 'up', h4: 'down', h1: 'down', adx4h: 27, adx1h: 22, ret4h: -1.2, ret24h: -2.7, summary: 'BTC: günlük yükseliş · 4H düşüş' };
  const prompt = decidePrompt(a, P, [{ coin: 'BTC', tf: '4H', direction: 'short', source: 'btc_trend', price: 80000, atr: 900, zone: [80000, 80000], inZone: true, entry: 80000, stop: 81800, tp1: null, tp2: null, rr: null, riskPct: 2.25, signals: [{ name: 'BTC 4H trend ↓', group: 'trend', direction: 'short', strength: 1 }] }], { trades: 0 }, { regime: 'up', btcPrice: 80000, read });
  assert.ok(prompt.includes('"h4": "down"') && prompt.includes('btc_trend') && prompt.includes('longWhileBtcDown'));
  const r = openPosition(a, { coin: 'BTC', tf: '4H', direction: 'short', margin: 30, leverage: 3, order: 'market', price: 80000, stop: 81800, rationale: 'BTC 4H düşüş', signals: [], source: 'btc_trend', btcPrice: 80000 }, 1000, P.guards);
  assert.ok(r.ok && !r.hedgeLeg); assert.equal(r.position.source, 'btc_trend');
});

test('limit emir: düşen bıçak koruması — hızlı dolumda bekler, teyit kapanışından dolar; stop geçilirse iptal', () => {
  const M = 900e3;
  const k = (i, open, high, low, close) => c(i * M, open, high, low, close);
  const calm = Array.from({ length: 6 }, (_, i) => k(i + 1, 102.5, 102.65, 102.35, 102.5));
  const drop = [...calm, k(7, 102.5, 102.5, 100.5, 100.6), k(8, 100.6, 100.6, 98.8, 99.4)];
  const a = newAccount(P, 0);
  openPosition(a, req({ order: 'limit', limit_price: 100, stop: 96, tp1: 106, tp2: 110 }), 0, P.guards);
  let ev = updatePositions(a, { BTC: drop }, 8.5 * M, { knifeGuard: true });
  assert.deepEqual(ev.map((e) => e.type), ['confirming']);
  assert.equal(a.orders.length, 1); assert.equal(a.positions.length, 0);
  ev = updatePositions(a, { BTC: [...drop, k(9, 99.4, 100.4, 99.3, 100.3), k(10, 100.3, 100.5, 100.1, 100.4)] }, 11 * M, { knifeGuard: true });
  assert.equal(ev[0].type, 'filled'); assert.equal(ev[0].confirmed, true);
  assert.ok(Math.abs(a.positions[0].entry - 100.3) < 0.2, `giriş ${a.positions[0].entry}`);
  // Teyitten önce stop
  const b = newAccount(P, 0);
  openPosition(b, req({ order: 'limit', limit_price: 100, stop: 96, tp1: 106, tp2: 110 }), 0, P.guards);
  ev = updatePositions(b, { BTC: [...drop, k(9, 99.4, 99.5, 95.8, 96)] }, 10 * M, { knifeGuard: true });
  assert.deepEqual(ev.map((e) => e.type), ['confirming', 'knife']);
  assert.equal(b.orders.length, 0); assert.equal(b.positions.length, 0);
  // Koruma kapalı: hemen dolar
  const z = newAccount(P, 0);
  openPosition(z, req({ order: 'limit', limit_price: 100, stop: 96, tp1: 106, tp2: 110 }), 0, P.guards);
  assert.equal(updatePositions(z, { BTC: drop }, 8.5 * M)[0].type, 'filled');
});

test('zaman stopu: ajan pozisyonu kendi TF\'sinde N mum içinde TP1 görmezse kapanıştan kapanır', () => {
  const M = 900e3;
  const a = newAccount(P, 0);
  openPosition(a, req({ tf: '1H', price: 100, stop: 97, tp1: 104, tp2: 108 }), 0, P.guards);
  const cs = Array.from({ length: 12 }, (_, i) => c((i + 1) * M, 100, 100.8, 99.4, 100.3)); // 3 saat salınım
  assert.equal(updatePositions(a, { BTC: cs.slice(0, 6) }, 7 * M, { timeStop: 2 }).length, 0); // 1,75 saat: henüz değil
  const ev = updatePositions(a, { BTC: cs }, 13 * M, { timeStop: 2 });
  assert.equal(ev[0].type, 'time'); assert.equal(a.positions.length, 0);
  assert.equal(a.trades.length, 1);
});

test('erken kâr al: ajan pozisyonu (4H) erken hedefte %80 kapanır, stop girişe; kalan başabaşta kapanır', () => {
  const a = newAccount(P, 0);
  openPosition(a, req({ tf: '4H', price: 100, stop: 97, tp1: 104, tp2: 108 }), 0, P.guards);
  const pos = a.positions[0];
  const ev = updatePositions(a, { BTC: [c(1000, 100, 101.6, 99.9, 101.4), c(2000, 101.4, 101.5, 99.5, 99.8)] }, 3000, { earlyTp: { pct: 1.2 } });
  assert.deepEqual(ev.map((e) => e.type), ['early', 'tp1_stop']);
  assert.ok(Math.abs(ev[0].qty - pos.qty0 * 0.8) / pos.qty0 < 0.01);
  assert.equal(a.positions.length, 0);
  // 1H pozisyon: listede değil → erken çıkış yok
  const b = newAccount(P, 0);
  openPosition(b, req({ tf: '1H', price: 100, stop: 97, tp1: 104, tp2: 108 }), 0, P.guards);
  assert.equal(updatePositions(b, { BTC: [c(1000, 100, 101.6, 99.9, 101.4)] }, 2000, { earlyTp: { pct: 1.2 } }).length, 0);
});

test('ajan çağrısı: Haiku modelinde yedek model (fallbacks) gönderilmez, Opus\'ta gönderilir', async () => {
  const { call } = await import('../bot/agent/manager.js');
  const seen = [];
  const fetchImpl = async (_u, req) => { seen.push({ h: req.headers, b: JSON.parse(req.body) }); return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }], usage: {} }) }; };
  await call({ apiKey: 'k', model: 'claude-haiku-5-5', system: 's', user: 'u', schema: {}, fetchImpl });
  await call({ apiKey: 'k', model: 'claude-opus-5-5', system: 's', user: 'u', schema: {}, fetchImpl });
  assert.equal(seen[0].b.fallbacks, undefined); assert.equal(seen[0].h['anthropic-beta'], undefined);
  assert.equal(seen[1].b.fallbacks, 'default');
});
