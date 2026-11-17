// Bybit DEMO köprüsü (bot/exchange): imza, host kilidi, yuvarlama, çarpanlı sembol, karar fonksiyonunun dalları, uçtan uca senaryo.
// Ağ çağrısı yok: fetch ve istemci sahte.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BYBIT_DEMO_HOST, signOf, queryOf, demoUrl, createBybitDemo } from '../bot/exchange/bybit.js';
import { gatherDemo, linkOf, decimalsOf, roundStep, fmtStep, parseInstrument, symbolCandidates, levelsOf, sizeOf, legsOf, decideDemo, applyResult, errorNotice, runDemo, emptyDemoState } from '../bot/exchange/demo.js';

const H = 3600e3;

// ---------- İstemci
function fakeFetch(reply = { retCode: 0, retMsg: 'OK', result: {} }, status = 200) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, text: async () => (typeof reply === 'string' ? reply : JSON.stringify(reply)) }; };
  f.calls = calls; return f;
}

test('imza: bağımsız HMAC-SHA256 ile aynı; GET sorgu dizgisi / POST gövdesi imzalanır', async () => {
  const exp = crypto.createHmac('sha256', 'sek').update('1658384314791KEY5000category=option&symbol=BTC-29JUL22-25000-C').digest('hex');
  assert.equal(signOf('sek', { timestamp: 1658384314791, apiKey: 'KEY', recvWindow: 5000, payload: 'category=option&symbol=BTC-29JUL22-25000-C' }), exp);
  assert.match(exp, /^[0-9a-f]{64}$/);
  const f = fakeFetch();
  const c = createBybitDemo({ key: 'KEY', secret: 'sek', fetchImpl: f, now: () => 1700000000000 });
  await c.get('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
  const g = f.calls[0];
  assert.equal(g.url, `https://${BYBIT_DEMO_HOST}/v5/position/list?category=linear&settleCoin=USDT`);
  assert.equal(g.init.headers['X-BAPI-API-KEY'], 'KEY');
  assert.equal(g.init.headers['X-BAPI-TIMESTAMP'], '1700000000000');
  assert.equal(g.init.headers['X-BAPI-RECV-WINDOW'], '5000');
  assert.equal(g.init.headers['X-BAPI-SIGN'], crypto.createHmac('sha256', 'sek').update('1700000000000KEY5000category=linear&settleCoin=USDT').digest('hex'));
  await c.createOrder({ symbol: 'BTCUSDT', side: 'Buy' });
  const p = f.calls[1];
  assert.equal(p.init.method, 'POST');
  assert.equal(p.init.body, '{"category":"linear","symbol":"BTCUSDT","side":"Buy"}');
  assert.equal(p.init.headers['X-BAPI-SIGN'], crypto.createHmac('sha256', 'sek').update('1700000000000KEY5000' + p.init.body).digest('hex'));
  assert.equal(queryOf({ a: 1, b: null, c: '', d: 'x y' }), 'a=1&d=x%20y');
});

test('host kilidi: yalnız api-demo.bybit.com; kötü yol fetch\'e ulaşmaz; host parametresi yok sayılır', async () => {
  assert.equal(BYBIT_DEMO_HOST, 'api-demo.bybit.com');
  for (const bad of ['//api.bybit.com/v5/order/create', 'https://api.bybit.com/v5/order/create', '/v5/../x', '/v5/order/create?x=1', '/v5//x', '@api.bybit.com/v5/x', '/v5/x#y', '/v6/order', '', null]) {
    assert.throws(() => demoUrl(bad), /geçersiz|host/);
  }
  assert.equal(new URL(demoUrl('/v5/order/create')).hostname, 'api-demo.bybit.com');
  const f = fakeFetch();
  const c = createBybitDemo({ key: 'k', secret: 's', fetchImpl: f, host: 'api.bybit.com', baseUrl: 'https://api.bybit.com' });
  const r = await c.post('//api.bybit.com/v5/order/create', {});
  assert.equal(r.ok, false); assert.equal(f.calls.length, 0);
  await c.createOrder({ symbol: 'X' }); await c.positions(); await c.instrument('BTCUSDT'); await c.setTradingStop({ symbol: 'X', stopLoss: '1' }); await c.setLeverage('X', 5); await c.cancelOrder('X', 'l');
  assert.equal(f.calls.length, 6);
  for (const k of f.calls) assert.equal(new URL(k.url).hostname, 'api-demo.bybit.com');
  assert.ok(!('X-BAPI-SIGN' in f.calls[2].init.headers), 'genel uç imzasız');
  // kaynakta başka Bybit host'u yok
  const src = fs.readFileSync(new URL('../bot/exchange/bybit.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../bot/exchange/demo.js', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, ''); // yorum satırları hariç
  assert.deepEqual([...new Set(code.match(/[a-z-]+\.bybit\.com/g))], ['api-demo.bybit.com']);
});

test('istemci fırlatmaz: retCode ≠ 0, HTTP 403 (JSON değil), ağ hatası, anahtar yok', async () => {
  const c1 = createBybitDemo({ key: 'k', secret: 's', fetchImpl: fakeFetch({ retCode: 110072, retMsg: 'OrderLinkedID is duplicate', result: {} }) });
  const r1 = await c1.createOrder({});
  assert.deepEqual([r1.ok, r1.retCode, r1.error], [false, 110072, '110072 OrderLinkedID is duplicate']);
  const r2 = await createBybitDemo({ key: 'k', secret: 's', fetchImpl: fakeFetch('<html>403 Forbidden</html>', 403) }).positions();
  assert.equal(r2.ok, false); assert.equal(r2.retCode, null); assert.match(r2.error, /^HTTP 403/);
  const r3 = await createBybitDemo({ key: 'k', secret: 's', fetchImpl: async () => { throw new Error('ECONNRESET'); } }).positions();
  assert.equal(r3.ok, false); assert.match(r3.error, /ECONNRESET/);
  const f = fakeFetch();
  const r4 = await createBybitDemo({ fetchImpl: f }).positions();
  assert.equal(r4.error, 'anahtar yok'); assert.equal(f.calls.length, 0);
  const r5 = await createBybitDemo({ fetchImpl: fakeFetch({ retCode: 0, retMsg: 'OK', result: { list: [1] } }) }).instrument('BTCUSDT');
  assert.equal(r5.ok, true); assert.deepEqual(r5.result.list, [1]);
});

// ---------- Yuvarlama, sembol, seviyeler
const INST_RAW = {
  BTCUSDT: { symbol: 'BTCUSDT', status: 'Trading', priceFilter: { tickSize: '0.10' }, lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001', minNotionalValue: '5' }, leverageFilter: { maxLeverage: '100.00' } },
  '1000PEPEUSDT': { symbol: '1000PEPEUSDT', status: 'Trading', priceFilter: { tickSize: '0.0000010' }, lotSizeFilter: { qtyStep: '100', minOrderQty: '100', minNotionalValue: '5' }, leverageFilter: { maxLeverage: '75.00' } },
  SOLUSDT: { symbol: 'SOLUSDT', status: 'Trading', priceFilter: { tickSize: '0.01' }, lotSizeFilter: { qtyStep: '0.1', minOrderQty: '0.1', minNotionalValue: '5' }, leverageFilter: { maxLeverage: '50' } },
};
const inst = (sym, coin, mult = 1) => parseInstrument(INST_RAW[sym], coin, mult);

test('adım yuvarlama ve ondalık', () => {
  assert.equal(decimalsOf('0.0000010'), 7); assert.equal(decimalsOf('100'), 0); assert.equal(decimalsOf('1e-7'), 7); assert.equal(decimalsOf('0.10'), 2);
  assert.equal(roundStep(0.30000000000000004, '0.1', 'floor'), 0.3);
  assert.equal(roundStep(1.2345, '0.01', 'floor'), 1.23); assert.equal(roundStep(1.2345, '0.01', 'ceil'), 1.24); assert.equal(roundStep(1.235, '0.01'), 1.24);
  assert.equal(roundStep(1234.5, '100', 'floor'), 1200);
  assert.equal(fmtStep(0.0123, '0.0000010'), '0.0123000');
  assert.equal(roundStep(1, 0), null);
});

test('çarpanlı sembol: PEPE → 1000PEPEUSDT, fiyat ×1000, miktar ÷1000; bilinmeyen coin için 1000… adayı', () => {
  assert.deepEqual(symbolCandidates('PEPE'), [{ sym: '1000PEPEUSDT', mult: 1000 }]);
  assert.deepEqual(symbolCandidates('XYZ'), [{ sym: 'XYZUSDT', mult: 1 }, { sym: '1000XYZUSDT', mult: 1000 }]);
  const i = inst('1000PEPEUSDT', 'PEPE', 1000);
  const lv = levelsOf({ d: 1, entry: 0.0000123, stop: 0.0000120105, tp1: 0.0000131, tp2: 0.0000140, early: 0.0000124476 }, i);
  assert.equal(lv.entry, 0.0123); assert.equal(lv.stop, 0.01201); // 0.0120105 → aşağı (uzağa)
  assert.equal(lv.early, 0.012447); // hedef girişe doğru (aşağı)
  const sz = sizeOf(lv, i, 10);
  assert.ok(sz.ok); assert.equal(sz.qty, 34400); // 10 / 0.00029 = 34482 → 100'lük adım
  // OKX biriminde aynı risk: 34400 × 1000 adet PEPE × 0.00000029 ≈ 9,98 $
  assert.ok(Math.abs(sz.qty * 1000 * (0.0000123 - 0.00001201) - 9.976) < 0.001);
});

test('seviyeler: short\'ta stop yukarı, hedef yukarı (girişe doğru); risk sıfırsa null', () => {
  const i = inst('BTCUSDT', 'BTC');
  const lv = levelsOf({ direction: 'short', entry: 100000.04, stop: 101000.01, tp1: 98000.07, tp2: 97000.01 }, i);
  assert.deepEqual([lv.d, lv.entry, lv.stop, lv.tp1, lv.tp2, lv.early], [-1, 100000, 101000.1, 98000.1, 97000.1, null]);
  assert.equal(levelsOf({ d: 1, entry: 100.01, stop: 100.0, tp1: 101, tp2: 102 }, { ...i, tick: '1' }), null);
});

test('miktar: en az emir / en az değer altı → atla', () => {
  const i = inst('BTCUSDT', 'BTC');
  assert.match(sizeOf({ entry: 100000, stop: 90000 }, i, 5).reason, /en az emir/); // 0.0005 → 0
  assert.match(sizeOf({ entry: 10, stop: 9 }, { ...i, qtyStep: '0.1', minQty: 0.1, minNotional: 5 }, 0.2).reason, /değer/);
  assert.deepEqual(sizeOf({ entry: 100000, stop: 99000 }, i, 10), { ok: true, qty: 0.01 });
});

test('çıkış kademeleri: 3 kademe %50 / %25 / kalan; TP1 erken hedefin içindeyse 2 kademe; en az emir altı birleşir', () => {
  const i = inst('SOLUSDT', 'SOL');
  const lv = { d: 1, entry: 100, stop: 97, early: 101.2, tp1: 104, tp2: 107, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early' };
  assert.deepEqual(legsOf(lv, 3.3, i), [{ tag: 'T1', price: 101.2, qty: 1.6 }, { tag: 'T2', price: 104, qty: 0.8 }, { tag: 'T3', price: 107, qty: 0.9 }]);
  assert.deepEqual(legsOf({ ...lv, tp1: 101 }, 2, i).map((l) => [l.tag, l.qty]), [['T1', 1], ['T3', 1]]);
  assert.deepEqual(legsOf({ ...lv, early: null }, 2, i).map((l) => [l.tag, l.price, l.qty]), [['T1', 104, 1], ['T3', 107, 1]]);
  assert.deepEqual(legsOf(lv, 0.3, i).map((l) => [l.tag, l.qty]), [['T1', 0.1], ['T3', 0.2]]); // T2 0.07 → 0 → T3'e
  assert.deepEqual(legsOf(lv, 0.1, i).map((l) => [l.tag, l.qty]), [['T3', 0.1]]);
  const tot = (q) => legsOf(lv, q, i).reduce((a, l) => a + l.qty, 0);
  for (const q of [0.1, 0.4, 1.7, 3.3, 12.9]) assert.ok(Math.abs(tot(q) - q) < 1e-9, `toplam = pozisyon (${q})`);
});

test('orderLinkId deterministik, ≤ 36, izinli karakter', () => {
  const a = linkOf('SOL|4H|long|123|1763380800000', 'E');
  assert.equal(a, linkOf('SOL|4H|long|123|1763380800000', 'E'));
  assert.notEqual(a, linkOf('SOL|4H|long|123|1763380800001', 'E'));
  assert.match(a, /^[A-Za-z0-9_-]{1,36}$/); assert.ok(linkOf('x', 'X12').length <= 36);
});

// ---------- Karar fonksiyonu
const T0 = Date.UTC(2026, 10, 17, 8);
const plan = (o = {}) => ({ key: 'SOL|4H|long|50', coin: 'SOL', tf: '4H', direction: 'long', d: 1, entry: 100, stop: 97, tp1: 104, tp2: 107, early: 101.2, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early', rr1: 1.33, rr: 2.33, sentAt: T0, status: 'waiting', ...o });
const PID = (p) => `${p.key}|${p.sentAt}`;
const exOf = (o = {}) => ({ positions: {}, openOrders: [], byLink: {}, tickers: { SOLUSDT: 103 }, insts: { SOL: inst('SOLUSDT', 'SOL') }, closedPnl: {}, ...o });
const CFG = { riskUsd: 10 };

test('yeni 4H plan → kaldıraç + limit giriş (ekli Full stop); 1H / bekleme dışı planlar yok sayılır', () => {
  const p = plan();
  const { state, actions } = decideDemo({ state: null, plans: [p, plan({ key: 'X|1H', tf: '1H' }), plan({ key: 'Y', status: 'active' })], ex: exOf(), now: T0, cfg: CFG });
  assert.deepEqual(actions.map((a) => a.type), ['leverage', 'create']);
  assert.equal(actions[0].lev, 20); // ⌊100 / (3 × 1,5)⌋ = 22 → maxLeverage tavanı 20
  assert.deepEqual(actions[1].body, { symbol: 'SOLUSDT', side: 'Buy', orderType: 'Limit', qty: '3.3', price: '100.00', timeInForce: 'GTC', positionIdx: 0, orderLinkId: linkOf(PID(p), 'E'), stopLoss: '97.00', tpslMode: 'Full', slTriggerBy: 'LastPrice', slOrderType: 'Market' });
  const job = state.jobs[PID(p)];
  assert.equal(job.phase, 'pending'); assert.equal(job.qty, 3.3); assert.equal(job.riskUsd, 9.9);
  assert.equal(Object.keys(state.jobs).length, 1);
});

test('atlananlar nedenleriyle: Bybit\'te yok, en az emir altı, fiyat girişin ötesinde, aynı sembolde iş / yabancı pozisyon', () => {
  const p = plan();
  const reason = (ex, st = null, cfg = CFG) => { const r = decideDemo({ state: st, plans: [p], ex, now: T0, cfg }); return [r.state.jobs[PID(p)]?.phase, r.state.jobs[PID(p)]?.reason, r.actions.length]; };
  assert.deepEqual(reason(exOf({ insts: { SOL: null } })), ['skipped', 'Bybit\'te linear USDT sözleşmesi yok', 0]);
  assert.deepEqual(reason(exOf({ insts: {} })), [undefined, undefined, 0]); // enstrüman okunamadı → sonraki tur
  assert.match(reason(exOf(), null, { riskUsd: 0.2 })[1], /en az emir/);
  assert.match(reason(exOf({ tickers: { SOLUSDT: 99.5 } }))[1], /ötesinde/);
  assert.match(reason(exOf({ positions: { SOLUSDT: { side: 'Buy', size: 1 } } }))[1], /pozisyon var/);
  assert.match(reason(exOf({ openOrders: [{ symbol: 'SOLUSDT', orderLinkId: 'elle', orderStatus: 'New' }] }))[1], /bekleyen emir/);
  const st = emptyDemoState(T0); st.jobs.other = { id: 'other', phase: 'pending', symbol: 'SOLUSDT', orders: { E: { link: 'L', status: 'New' } }, createdAt: T0 };
  assert.deepEqual(reason(exOf({ openOrders: [] }), st).slice(0, 2), ['skipped', 'aynı sembolde açık demo işi var']);
});

// Yardımcı: kararı uygula (tüm eylemler başarılı)
const ok = { ok: true, retCode: 0 };
function step(state, plans, ex, now, results = {}) {
  const out = decideDemo({ state, plans, ex, now, cfg: CFG });
  for (const a of out.actions) applyResult(out.state, a, results[a.tag ?? a.type] ?? ok, now);
  return out;
}
const ord = (link, status, cum, avg, t = T0) => ({ orderLinkId: link, symbol: 'SOLUSDT', orderStatus: status, cumExecQty: String(cum), avgPrice: avg == null ? '' : String(avg), updatedTime: String(t) });

test('idempotentlik: gönderilmiş giriş tekrar gönderilmez; 110072 (yinelenen) gönderilmiş sayılır', () => {
  const p = plan();
  const s1 = step(null, [p], exOf(), T0, { E: { ok: false, retCode: 110072, error: '110072 dup' } });
  const job = s1.state.jobs[PID(p)];
  assert.equal(job.orders.E.link, linkOf(PID(p), 'E'));
  const L = job.orders.E.link;
  const s2 = decideDemo({ state: s1.state, plans: [p], ex: exOf({ openOrders: [ord(L, 'New', 0)] }), now: T0 + H, cfg: CFG });
  assert.deepEqual(s2.actions, []);
  // ağ hatası: giriş kaydedilmez, sonraki tur aynı orderLinkId ile yeniden
  const s3 = step(null, [p], exOf(), T0, { E: { ok: false, retCode: null, error: 'zaman aşımı' } });
  assert.equal(s3.state.jobs[PID(p)].orders.E, undefined);
  const s4 = decideDemo({ state: s3.state, plans: [p], ex: exOf(), now: T0 + 900e3, cfg: CFG });
  assert.equal(s4.actions.find((a) => a.type === 'create').body.orderLinkId, L);
  // borsa reddi (ör. bakiye): iş atlanır, tekrar denenmez
  const s5 = step(null, [p], exOf(), T0, { E: { ok: false, retCode: 110007, error: '110007 ab not enough' } });
  assert.equal(s5.state.jobs[PID(p)].phase, 'skipped'); assert.match(s5.state.jobs[PID(p)].reason, /reddedildi/);
  assert.deepEqual(decideDemo({ state: s5.state, plans: [p], ex: exOf(), now: T0 + H, cfg: CFG }).actions, []);
});

test('kâğıt kapandı (expired / knife / missed) ve giriş dolmadı → iptal; sonraki tur iş "cancelled"', () => {
  for (const st of ['expired', 'knife', 'missed']) {
    const p = plan();
    const s1 = step(null, [p], exOf(), T0);
    const L = s1.state.jobs[PID(p)].orders.E.link;
    const s2 = step(s1.state, [{ ...p, status: st }], exOf({ openOrders: [ord(L, 'New', 0)] }), T0 + 24 * H);
    assert.deepEqual(s2.actions.map((a) => [a.type, a.tag, a.link]), [['cancel', 'E', L]]);
    const s3 = step(s2.state, [{ ...p, status: st }], exOf({ byLink: { [L]: ord(L, 'Cancelled', 0) } }), T0 + 24.25 * H);
    assert.equal(s3.state.jobs[PID(p)].phase, 'cancelled'); assert.equal(s3.state.jobs[PID(p)].reason, `kâğıt ${st}`);
  }
  // plan durumdan düştü ya da 48 saat dolmadı → iptal
  const p = plan();
  const s1 = step(null, [p], exOf(), T0);
  const L = s1.state.jobs[PID(p)].orders.E.link;
  assert.equal(decideDemo({ state: s1.state, plans: [], ex: exOf({ openOrders: [ord(L, 'New', 0)] }), now: T0 + H, cfg: CFG }).actions[0].type, 'cancel');
  assert.equal(decideDemo({ state: s1.state, plans: [p], ex: exOf({ openOrders: [ord(L, 'New', 0)] }), now: T0 + 49 * H, cfg: CFG }).actions[0].type, 'cancel');
  // kâğıt doldu, borsa dolmadı → sapma (iptal yok)
  const s4 = step(s1.state, [{ ...p, status: 'active', filledAt: T0 + 4 * H }], exOf({ openOrders: [ord(L, 'New', 0)] }), T0 + 5 * H);
  assert.deepEqual(s4.actions, []);
  assert.equal(s4.state.jobs[PID(p)].deviations[0].kind, 'kagit_doldu_borsa_dolmadi');
});

test('dolum → reduce-only kademe emirleri; kâğıt bıçak/işlemsiz iken sapma yazılır, pozisyona dokunulmaz', () => {
  const p = plan();
  const s1 = step(null, [p], exOf(), T0);
  const L = s1.state.jobs[PID(p)].orders.E.link;
  const ex = exOf({ positions: { SOLUSDT: { side: 'Buy', size: 3.3, avgPrice: 100, stopLoss: 97 } }, byLink: { [L]: ord(L, 'Filled', 3.3, 100, T0 + 2 * H) } });
  const s2 = step(s1.state, [{ ...p, status: 'confirming', knifeAt: T0 + 2 * H }], ex, T0 + 2.25 * H);
  const creates = s2.actions.filter((a) => a.type === 'create');
  assert.deepEqual(creates.map((a) => [a.tag, a.body.side, a.body.price, a.body.qty, a.body.reduceOnly]), [['T1', 'Sell', '101.20', '1.6', true], ['T2', 'Sell', '104.00', '0.8', true], ['T3', 'Sell', '107.00', '0.9', true]]);
  assert.ok(creates.every((a) => !('stopLoss' in a.body)), 'reduce-only emre TP/SL eklenmez');
  const job = s2.state.jobs[PID(p)];
  assert.equal(job.phase, 'open'); assert.deepEqual([job.fill.price, job.fill.qty, job.fill.at], [100, 3.3, T0 + 2 * H]);
  assert.equal(job.deviations[0].kind, 'borsa_doldu_kagit_teyit');
  // sonraki tur: kâğıt 'knife' (işlem yok) → sapma; kademeler zaten gönderildi → eylem yok
  const open = ['T1', 'T2', 'T3'].map((t) => ord(job.orders[t].link, 'New', 0));
  const s3 = step(s2.state, [{ ...p, status: 'knife' }], { ...ex, openOrders: open, byLink: {} }, T0 + 3 * H);
  assert.deepEqual(s3.actions, []);
  assert.deepEqual(s3.state.jobs[PID(p)].deviations.map((d) => d.kind), ['borsa_doldu_kagit_teyit', 'borsa_doldu_kagit_islemsiz']);
});

test('kademe dolumu → stop taşıma: T1 → giriş, T2 → erken hedef; fiyat yeni stopun ötesindeyse piyasa ile kapat', () => {
  const p = plan();
  let s = step(null, [p], exOf(), T0);
  const L = s.state.jobs[PID(p)].orders.E.link;
  const pos = (size, sl) => ({ SOLUSDT: { side: 'Buy', size, avgPrice: 100, stopLoss: sl } });
  s = step(s.state, [p], exOf({ positions: pos(3.3, 97), byLink: { [L]: ord(L, 'Filled', 3.3, 100, T0 + H) } }), T0 + H);
  const lk = (t) => s.state.jobs[PID(p)].orders[t].link;
  const [l1, l2, l3] = ['T1', 'T2', 'T3'].map(lk);
  // T1 doldu
  let ex = exOf({ positions: pos(1.7, 97), openOrders: [ord(l2, 'New', 0), ord(l3, 'New', 0)], byLink: { [l1]: ord(l1, 'Filled', 1.6, 101.2) }, tickers: { SOLUSDT: 101.5 } });
  let out = step(s.state, [{ ...p, status: 'early' }], ex, T0 + 2 * H);
  assert.deepEqual(out.actions.map((a) => [a.type, a.price]), [['stop', '100.00']]);
  assert.deepEqual(out.state.jobs[PID(p)].stops.map((x) => x.price), [100]);
  // aynı durum, borsa stopu artık 100 → eylem yok (idempotent)
  ex = { ...ex, positions: pos(1.7, 100) };
  assert.deepEqual(decideDemo({ state: out.state, plans: [p], ex, now: T0 + 2.25 * H, cfg: CFG }).actions, []);
  // T2 doldu → stop erken hedefe (101.2)
  ex = exOf({ positions: pos(0.9, 100), openOrders: [ord(l3, 'New', 0)], byLink: { [l2]: ord(l2, 'Filled', 0.8, 104) }, tickers: { SOLUSDT: 104.2 } });
  const out2 = step(out.state, [p], ex, T0 + 3 * H);
  assert.deepEqual(out2.actions.map((a) => [a.type, a.price]), [['stop', '101.20']]);
  // aynı an fiyat 101'e düşmüşse stop taşınamaz → kalan piyasa emriyle (reduce-only) kapanır, sapma yazılır; ikinci tur tekrar göndermez
  const out3 = step(out.state, [p], { ...ex, tickers: { SOLUSDT: 101 } }, T0 + 3 * H);
  const x = out3.actions[0];
  assert.deepEqual([x.type, x.tag, x.body.orderType, x.body.reduceOnly, x.body.qty, x.body.side], ['create', 'X1', 'Market', true, '0.9', 'Sell']);
  assert.ok(out3.state.jobs[PID(p)].deviations.some((d) => d.kind === 'stop_tasinamadi_piyasa'));
  assert.deepEqual(decideDemo({ state: out3.state, plans: [p], ex: { ...ex, tickers: { SOLUSDT: 101 } }, now: T0 + 3.25 * H, cfg: CFG }).actions, []);
});

test('pozisyon sıfır → kapanış: kalan kademeler iptal, closed-pnl\'den R; kâğıt sonucu farklıysa sapma', () => {
  const p = plan();
  let s = step(null, [p], exOf(), T0);
  const L = s.state.jobs[PID(p)].orders.E.link;
  s = step(s.state, [p], exOf({ positions: { SOLUSDT: { side: 'Buy', size: 3.3, avgPrice: 100, stopLoss: 97 } }, byLink: { [L]: ord(L, 'Filled', 3.3, 100, T0 + H) } }), T0 + H);
  const j = s.state.jobs[PID(p)];
  const open = ['T1', 'T2', 'T3'].map((t) => ord(j.orders[t].link, 'New', 0));
  // stop oldu (hiç kademe dolmadan); kâğıt da 'stopped' ama kâğıt -1R, borsa -1,02R (ücret) → fark < 0,05 → sapma yok
  const pnl = { [PID(p)]: [{ symbol: 'SOLUSDT', closedPnl: '-10.1', updatedTime: String(T0 + 2 * H) }] };
  const out = step(s.state, [{ ...p, status: 'stopped', closedAt: T0 + 2 * H }], exOf({ openOrders: open, closedPnl: pnl }), T0 + 2 * H);
  assert.deepEqual(out.actions.map((a) => [a.type, a.tag]), [['cancel', 'T1'], ['cancel', 'T2'], ['cancel', 'T3']]);
  const c = out.state.jobs[PID(p)];
  assert.equal(c.phase, 'closed'); assert.equal(c.closed.R, -1.02); assert.equal(c.closed.exitBy, 'stop'); assert.equal(c.closed.pnlSrc, 'closed-pnl');
  assert.deepEqual(c.deviations.map((d) => d.kind), ['borsa_doldu_kagit_bekliyor']); assert.equal(c.paperDone, true);
  // kâğıt 'be' (+0,2R) iken borsa stop → sonuç farkı
  const out2 = step(s.state, [{ ...p, status: 'be', closedAt: T0 + 2 * H }], exOf({ openOrders: open, closedPnl: pnl }), T0 + 2 * H);
  const dv = out2.state.jobs[PID(p)].deviations.find((d) => d.kind === 'sonuc_farki');
  assert.equal(dv.paperR, 0.2); assert.equal(dv.exchangeR, -1.02);
  // closed-pnl yoksa dolumlardan tahmin: T1 101,2'de 1,6 + kalan 1,7 girişte (taşınmış stop) → +1,92 $
  const st2 = structuredClone(s.state); const jj = st2.jobs[PID(p)]; jj.stopLevel = 100;
  const out3 = step(st2, [p], exOf({ openOrders: [], byLink: { [jj.orders.T1.link]: ord(jj.orders.T1.link, 'Filled', 1.6, 101.2), [jj.orders.T2.link]: ord(jj.orders.T2.link, 'Cancelled', 0), [jj.orders.T3.link]: ord(jj.orders.T3.link, 'Cancelled', 0) } }), T0 + 3 * H);
  const c3 = out3.state.jobs[PID(p)].closed;
  assert.deepEqual([c3.pnlSrc, c3.pnl, c3.exitBy, c3.legs], ['tahmin', 1.92, 'taşınmış stop', ['T1']]);
  assert.equal(out3.state.jobs[PID(p)].paperDone, undefined, 'kâğıt açıkken iş izlenmeye devam eder');
});

test('hata bildirimi: aynı hata 24 saatte bir, farklı hata hemen, hatasız tur sıfırlar', () => {
  const st = emptyDemoState(T0);
  assert.match(errorNotice(st, ['SOLUSDT emir E reddedildi: 110007 ab not enough'], T0), /Bybit demo/);
  assert.equal(errorNotice(st, ['BTCUSDT emir E reddedildi: 110007 ab not enough'], T0 + H), null); // sembolsüz anahtar aynı
  assert.match(errorNotice(st, ['pozisyonlar okunamadı: HTTP 403'], T0 + 2 * H), /403/);
  assert.equal(errorNotice(st, ['pozisyonlar okunamadı: HTTP 403'], T0 + 3 * H), null);
  assert.match(errorNotice(st, ['pozisyonlar okunamadı: HTTP 403'], T0 + 27 * H), /403/);
  assert.equal(errorNotice(st, [], T0 + 28 * H), null); assert.equal(st.lastError, null);
});

// ---------- Uçtan uca: sahte borsa + runDemo (dosya, eylemler, turlar)
function fakeExchange() {
  let t = T0;
  const orders = new Map(), positions = {}, pnls = [], calls = [];
  const L = (list) => ({ ok: true, retCode: 0, result: { list, nextPageCursor: '' } });
  const OPEN = ['New', 'PartiallyFilled'];
  const reduce = (sym, qty, px) => { const p = positions[sym]; const q = Math.min(qty, p.size); pnls.push({ symbol: sym, closedPnl: String(+((p.side === 'Buy' ? 1 : -1) * (px - p.avg) * q).toFixed(4)), updatedTime: String(t) }); p.size = +(p.size - q).toFixed(8); if (p.size <= 0) { delete positions[sym]; for (const o of orders.values()) if (o.symbol === sym && OPEN.includes(o.orderStatus)) o.orderStatus = 'Cancelled'; } };
  const client = {
    calls,
    positions: async () => L(Object.entries(positions).map(([s, p]) => ({ symbol: s, side: p.side, size: String(p.size), avgPrice: String(p.avg), stopLoss: String(p.sl ?? 0) }))),
    openOrders: async () => L([...orders.values()].filter((o) => OPEN.includes(o.orderStatus))),
    orderByLink: async (l) => L(orders.has(l) ? [orders.get(l)] : []),
    orderHistoryByLink: async () => L([]),
    closedPnl: async (sym, start) => L(pnls.filter((x) => x.symbol === sym && (start == null || +x.updatedTime >= start))),
    instrument: async (sym) => L(INST_RAW[sym] ? [INST_RAW[sym]] : []),
    ticker: async (sym) => L([{ symbol: sym, lastPrice: String(client.price) }]),
    setLeverage: async (sym, lev) => { calls.push(['lev', sym, lev]); return { ok: false, retCode: 110043, error: '110043 not modified' }; },
    createOrder: async (b) => {
      calls.push(['create', b.orderLinkId.slice(-2), b.orderType, b.qty, b.price ?? null]);
      if (orders.has(b.orderLinkId)) return { ok: false, retCode: 110072, error: '110072 dup' };
      const o = { ...b, orderStatus: 'New', cumExecQty: '0', avgPrice: '', updatedTime: String(t) };
      orders.set(b.orderLinkId, o);
      if (b.orderType === 'Market') { o.orderStatus = 'Filled'; o.cumExecQty = b.qty; o.avgPrice = String(client.price); reduce(b.symbol, +b.qty, client.price); }
      return { ok: true, retCode: 0, result: { orderLinkId: b.orderLinkId } };
    },
    cancelOrder: async (sym, l) => { calls.push(['cancel', l.slice(-1)]); const o = orders.get(l); if (!o || !OPEN.includes(o.orderStatus)) return { ok: false, retCode: 110001, error: '110001' }; o.orderStatus = 'Cancelled'; return { ok: true, retCode: 0 }; },
    setTradingStop: async ({ symbol, stopLoss }) => { calls.push(['stop', stopLoss]); positions[symbol].sl = +stopLoss; return { ok: true, retCode: 0 }; },
    price: 103,
  };
  const fill = (tag, px) => { // borsada emir doldu
    const o = [...orders.values()].find((x) => x.orderLinkId.endsWith(`-${tag}`) && OPEN.includes(x.orderStatus));
    o.orderStatus = 'Filled'; o.cumExecQty = o.qty; o.avgPrice = String(px); o.updatedTime = String(t);
    if (tag === 'E') positions[o.symbol] = { side: o.side, size: +o.qty, avg: px, sl: +o.stopLoss }; else reduce(o.symbol, +o.qty, px);
  };
  const stopOut = (sym) => reduce(sym, positions[sym].size, positions[sym].sl);
  return { client, fill, stopOut, setT: (x) => { t = x; } };
}

test('uçtan uca (sahte borsa): giriş → dolum → kademeler → T1 → stop girişe → kalan girişte kapanır; dosya artımlı ve idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bybit-demo-'));
  const file = path.join(dir, 'demo.json');
  const fx = fakeExchange(); const c = fx.client;
  const notes = [], logs = [];
  const run = (plans, now) => { fx.setT(now); return runDemo({ client: c, plans, file, now, cfg: CFG, notify: async (m) => notes.push(m), log: (m) => logs.push(m) }); };
  const p = plan();
  await run([p], T0);
  assert.deepEqual(c.calls.map((x) => x.slice(0, 3)), [['lev', 'SOLUSDT', 20], ['create', '-E', 'Limit']]);
  assert.deepEqual(notes, [], '110043 (kaldıraç değişmedi) hata sayılmaz');
  await run([p], T0 + 900e3); // değişiklik yok → yeni emir yok
  assert.equal(c.calls.length, 2);
  fx.setT(T0 + 2 * H); fx.fill('E', 100); // borsada doldu, kâğıt hâlâ bekliyor
  await run([p], T0 + 2 * H);
  assert.deepEqual(c.calls.slice(2).map((x) => x.slice(0, 5)), [['create', 'T1', 'Limit', '1.6', '101.20'], ['create', 'T2', 'Limit', '0.8', '104.00'], ['create', 'T3', 'Limit', '0.9', '107.00']]);
  c.price = 101.5; fx.fill('T1', 101.2);
  await run([{ ...p, status: 'early', filledAt: T0 + 2.5 * H }], T0 + 3 * H);
  assert.deepEqual(c.calls.at(-1), ['stop', '100.00']);
  const n = c.calls.length;
  await run([{ ...p, status: 'early', filledAt: T0 + 2.5 * H }], T0 + 3.25 * H);
  assert.equal(c.calls.length, n, 'stop zaten taşındı');
  c.price = 99.9; fx.setT(T0 + 4 * H); fx.stopOut('SOLUSDT');
  const r = await run([{ ...p, status: 'be', filledAt: T0 + 2.5 * H, closedAt: T0 + 4 * H }], T0 + 4.25 * H);
  const job = r.state.jobs[PID(p)];
  assert.equal(job.phase, 'closed');
  assert.deepEqual([job.closed.pnl, job.closed.pnlSrc, job.closed.exitBy, job.closed.R], [1.92, 'closed-pnl', 'taşınmış stop', 0.194]);
  assert.deepEqual(job.deviations.map((d) => d.kind), ['borsa_doldu_kagit_bekliyor']); // kâğıt 'be' = 0,5 × 1,2 / 3 = 0,2R ≈ borsa 0,194R
  assert.deepEqual(job.fillLag, { exchangeAt: T0 + 2 * H, paperAt: T0 + 2.5 * H, minutes: 30 });
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.jobs[PID(p)].phase, 'closed');
  assert.deepEqual(disk.events.map((e) => e.ev), ['emir', 'dolum', 'stop', 'kapanış']);
  assert.deepEqual(notes, []);
  assert.ok(logs.every((l) => /Bybit demo: \d+ eylem/.test(l)));
  // okuma hatası: tur fırlatmaz, dosya korunur, ana sohbete tek satır (tekrarsız)
  const bad = { ...c, positions: async () => ({ ok: false, retCode: null, error: 'HTTP 403 Forbidden' }) };
  for (const k of [0, 1]) await runDemo({ client: bad, plans: [p], file, now: T0 + (5 + k) * H, cfg: CFG, notify: async (m) => notes.push(m), log: () => {} });
  assert.equal(notes.length, 1); assert.match(notes[0], /pozisyonlar okunamadı: HTTP 403/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).jobs[PID(p)].phase, 'closed');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Bot bağlantısı: test (fixture) modunda emir yok; bayrak kapalıyken demo adımı hiç çalışmaz
test('bot/run.mjs: BYBIT_DEMO=1 fixture/test modunda emir göndermez ve demo dosyası yazmaz; bayraksız koşu demo satırı içermez', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bybit-bot-'));
  const base = { ...process.env, FIXTURE: '1', AGENT: '0', MOMENTUM: '0', AUDIT: '0', FIB_ALERT: '0', SIGNAL_CHART: '0', DRY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', ANTHROPIC_API_KEY: '',
    STATE_FILE: path.join(dir, 'state.json'), HISTORY_FILE: path.join(dir, 'history.json'), AGENT_PUBLISH_DIR: path.join(dir, 'agent'), BYBIT_DEMO_FILE: path.join(dir, 'demo.json') };
  const on = execFileSync('node', ['bot/run.mjs'], { env: { ...base, BYBIT_DEMO: '1', BYBIT_DEMO_KEY: 'k', BYBIT_DEMO_SECRET: 's' }, encoding: 'utf8' });
  assert.match(on, /Bybit demo: kuru koşu \/ test → emir gönderilmez/);
  assert.ok(!fs.existsSync(path.join(dir, 'demo.json')));
  fs.rmSync(path.join(dir, 'state.json')); fs.rmSync(path.join(dir, 'history.json'));
  const off = execFileSync('node', ['bot/run.mjs'], { env: { ...base, BYBIT_DEMO: '' }, encoding: 'utf8' });
  assert.ok(!/Bybit demo/.test(off));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatherDemo: olmayan sembol (10001) → null (atlanır, önbelleğe girer); ağ hatası → tanımsız (sonraki tur)', async () => {
  const L = (list) => ({ ok: true, retCode: 0, result: { list } });
  const asked = [];
  const mk = (instr) => ({ positions: async () => L([]), openOrders: async () => L([]), ticker: async () => L([]), instrument: async (s) => { asked.push(s); return instr(s); } });
  const plans = [plan({ coin: 'NOPE', key: 'NOPE|4H' })];
  const st = emptyDemoState(T0);
  const ex = await gatherDemo(mk(() => ({ ok: false, retCode: 10001, error: '10001 params error: symbol invalid' })), { state: st, plans, now: T0 });
  assert.equal(ex.insts.NOPE, null); assert.deepEqual(asked, ['NOPEUSDT', '1000NOPEUSDT']);
  assert.equal(st.insts.NOPE.inst, null);
  const ex2 = await gatherDemo(mk(() => ({ ok: false, retCode: null, error: 'HTTP 403' })), { state: emptyDemoState(T0), plans, now: T0 });
  assert.equal(ex2.insts.NOPE, undefined);
  const ex3 = await gatherDemo(mk((s) => (s === '1000NOPEUSDT' ? L([{ ...INST_RAW.BTCUSDT, symbol: s }]) : { ok: false, retCode: 10001 })), { state: emptyDemoState(T0), plans, now: T0 });
  assert.deepEqual([ex3.insts.NOPE.symbol, ex3.insts.NOPE.mult], ['1000NOPEUSDT', 1000]);
  await assert.rejects(gatherDemo({ positions: async () => ({ ok: false, error: 'HTTP 403' }) }, { state: st, plans, now: T0 }), /pozisyonlar okunamadı/);
});
