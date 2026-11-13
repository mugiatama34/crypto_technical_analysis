// Ajan hesabı: kapanmamış (canlı) 15m mum. Canlı mum her turda kısmi haliyle işlenir ama lastTime yalnız kapanmış mumla
// ilerler; mumun turdan sonraki kalanı (stop / hedef / tasfiye / limit dolumu) mum kapanınca görülür, aynı olay iki kez sayılmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, openPosition, updatePositions, anchorToLive } from '../bot/agent/account.js';
import { PROFILES } from '../bot/agent/profiles.js';

const P = PROFILES.temkinli, M = 900e3, T = 120e3; // 15m mum, tur mum açılışından 2 dk sonra
const k = (i, open, high, low, close) => ({ time: i * M, open, high, low, close, volume: 1 });
const req = (over = {}) => ({ coin: 'BTC', tf: '1H', direction: 'long', margin: 50, leverage: 5, order: 'market', price: 100, stop: 98, tp1: 104, tp2: 108, rationale: 't', ...over });

test('canlı mum: long — turda görülmeyen fitil (97,5) mum kapanınca 98 stopunu tetikler', () => {
  const a = newAccount(P, 0);
  openPosition(a, req(), 0, P.guards);
  let ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 100.5, 99, 99.5)] }, M + T); // canlı: 99'a indi
  assert.equal(ev.length, 0); assert.equal(a.positions.length, 1);
  assert.equal(a.positions[0].lastTime, 0, 'lastTime canlı muma ilerlememeli');
  ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 100.5, 97.5, 99), k(2, 99, 99.2, 98.8, 99)] }, 2 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['stop']); assert.equal(a.positions.length, 0);
  assert.ok(a.trades[0].R < -0.9, `R ${a.trades[0].R}`);
});

test('canlı mum: short — mumun kalanındaki tepe (102,5) 102 stopunu tetikler', () => {
  const a = newAccount(P, 0);
  openPosition(a, req({ direction: 'short', stop: 102, tp1: 96, tp2: 92 }), 0, P.guards);
  updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 101, 99.5, 100.5)] }, M + T);
  assert.equal(a.positions.length, 1);
  const ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 102.5, 99.5, 101), k(2, 101, 101.2, 100.8, 101)] }, 2 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['stop']); assert.equal(a.positions.length, 0);
});

test('canlı mum: aynı mum birkaç turda görülse de kapanmış hali bir kez işlenir; tasfiye kalanında yakalanır', () => {
  const a = newAccount(P, 0);
  openPosition(a, req({ leverage: 10, stop: 91, tp1: 110, tp2: 120 }), 0, P.guards); // 10x lik. ≈ 90,5 → stop içeri çekilir
  const liq = a.positions[0].liq;
  updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 100.2, 99, 99.5)] }, M + T);
  updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 100.2, 98, 98.5)] }, M + 6 * T); // aynı mum, ikinci tur
  assert.equal(a.positions.length, 1);
  const ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 100.2, liq - 0.5, 92), k(2, 92, 92.5, 91.8, 92)] }, 2 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['liq']); assert.equal(a.positions.length, 0); // aynı mumda tasfiye stoptan önce
  assert.equal(a.trades.length, 1);
});

test('çift sayım yok: canlı mumda TP1 yarı kapanır; mum kapanınca TP1 yeniden uygulanmaz, özsermaye bir kez değişir', () => {
  const a = newAccount(P, 0);
  openPosition(a, req(), 0, P.guards);
  const pos = a.positions[0], q0 = pos.qty0;
  // canlı: önce 99,6'ya indi, sonra TP1 (104) → yarı kapanış, stop girişe
  let ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 104.2, 99.6, 103.8)] }, M + T);
  assert.deepEqual(ev.map((e) => e.type), ['tp1']);
  const cash1 = a.cash;
  // kapanmış hali: aynı dip (99,6 < giriş) mumun turdan önceki kısmında kaldı → yeni stop (giriş) tetiklenmez, TP1 tekrar yok
  ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 104.3, 99.6, 103), k(2, 103, 103.4, 102.6, 103.2)] }, 2 * M + T);
  assert.equal(ev.length, 0); assert.equal(a.cash, cash1);
  assert.equal(a.positions.length, 1); assert.ok(Math.abs(pos.qty - q0 / 2) / q0 < 1e-6);
  assert.equal(pos.lastTime, M);
  // kalan başabaş stopu ancak mumun kalanında yeni dip gelirse
  ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 104.3, 99.6, 103), k(2, 103, 103.4, 99.8, 100.2), k(3, 100.2, 100.3, 100.1, 100.2)] }, 3 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['tp1_stop']); assert.equal(a.positions.length, 0);
  assert.equal(a.trades.length, 1);
});

test('çift sayım yok: erken hedef (earlyTp) ve ajan çıkış planı canlı mumda bir kez', () => {
  const et = { earlyTp: { pct: 1.2, portion: 0.8, tfs: ['4H'] } };
  const a = newAccount(P, 0);
  openPosition(a, req({ tf: '4H' }), 0, P.guards);
  assert.deepEqual(updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 101.5, 99.9, 101.3)] }, M + T, et).map((e) => e.type), ['early']);
  const cash1 = a.cash;
  assert.equal(updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 101.6, 99.9, 101)] }, 2 * M + T - M + 5 * T, et).length, 0); // hâlâ canlı
  assert.equal(updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 101.6, 99.9, 101), k(2, 101, 101.2, 100.6, 101)] }, 2 * M + T, et).length, 0);
  assert.equal(a.cash, cash1); assert.equal(a.trades.length, 0);
  // AGENT_EXIT planı: erken %1 → %50, TP1'de %30
  const b = newAccount(P, 0);
  openPosition(b, req({ exit: { early_pct: 1, early_portion: 0.5, tp1_portion: 0.3 } }), 0, P.guards);
  const pb = b.positions[0];
  assert.deepEqual(updatePositions(b, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 104.1, 99.9, 103.9)] }, M + T).map((e) => e.type), ['early', 'tp1']);
  const cashB = b.cash, qtyB = pb.qty;
  assert.equal(updatePositions(b, { BTC: [k(0, 100, 100, 100, 100), k(1, 100, 104.2, 99.9, 103), k(2, 103, 103.2, 102.8, 103)] }, 2 * M + T).length, 0);
  assert.equal(b.cash, cashB); assert.equal(pb.qty, qtyB);
});

test('limit emir: oluşturulduğu canlı mumun kalanındaki dolum sonraki turda görülür (önceki kısım sayılmaz)', () => {
  const live = [k(0, 101, 101, 101, 101), k(1, 101, 101.5, 100.6, 101.2)]; // emir dakika 2'de konur; 100,6 öncesindeki dip
  const a = newAccount(P, M + T);
  const r = openPosition(a, req({ order: 'limit', limit_price: 100.5, stop: 98, tp1: 104, tp2: 108 }), M + T, P.guards);
  anchorToLive(r.order, live, M + T, M);
  // mumun kalanında 100,3'e indi → dolum
  const ev = updatePositions(a, { BTC: [k(0, 101, 101, 101, 101), k(1, 101, 101.5, 100.3, 100.8), k(2, 100.8, 101, 100.7, 100.9)] }, 2 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['filled']); assert.equal(a.positions[0].entry, 100.5);
  // emir canlı mumun turdan önceki kısmında dolacak gibi görünse de (100,4 dip emir öncesinde) dolmaz
  const b = newAccount(P, M + T);
  const rb = openPosition(b, req({ order: 'limit', limit_price: 100.5, stop: 98, tp1: 104, tp2: 108 }), M + T, P.guards);
  anchorToLive(rb.order, [k(0, 101, 101, 101, 101), k(1, 101, 101.5, 100.4, 101.2)], M + T, M);
  assert.equal(updatePositions(b, { BTC: [k(0, 101, 101, 101, 101), k(1, 101, 101.5, 100.4, 101), k(2, 101, 101.2, 100.8, 101)] }, 2 * M + T).length, 0);
  assert.equal(b.orders.length, 1);
});

test('piyasa pozisyonu: açıldığı canlı mumun kalanındaki stop görülür (anchorToLive)', () => {
  const a = newAccount(P, M + T);
  const r = openPosition(a, req({ price: 100 }), M + T, P.guards);
  anchorToLive(r.position, [k(0, 100, 100, 100, 100), k(1, 100.5, 100.8, 99.5, 100)], M + T, M); // açılmadan önce 99,5'e inmiş
  // kapanmış hali: kalanında 97,8 → stop (98)
  const ev = updatePositions(a, { BTC: [k(0, 100, 100, 100, 100), k(1, 100.5, 100.8, 97.8, 99), k(2, 99, 99.3, 98.9, 99)] }, 2 * M + T);
  assert.deepEqual(ev.map((e) => e.type), ['stop']);
});

test('eski durum (seen alanı yok) ve barMs bilinmeyen tek mum: önceki davranış korunur', () => {
  const a = newAccount(P, 1000);
  openPosition(a, req(), 1000, P.guards);
  updatePositions(a, { BTC: [k(0, 1, 1, 1, 1)] }, 2000); // hiç yeni mum yok
  assert.equal(a.positions[0].lastTime, 1000);
  const ev = updatePositions(a, { BTC: [{ time: 2000, open: 100, high: 100, low: 97, close: 97.5 }] }, 2000);
  assert.deepEqual(ev.map((e) => e.type), ['stop']);
});
