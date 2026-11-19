// Sinyal mumu penceresi (19.11): 4H mumun ortasında gönderilen planın, gönderimden sonraki 15m mumlarla (ilk 4H açılışına
// kadar) dolumu / kaçışı / stopu · aynı girişli açık plan varken yeni plan reddi (sameOpen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPlan, sameOpen, sameWaiting, sameEntry, signalWindowOf, signalWindowPending, CLOSED } from '../bot/plan.js';

const H4 = 4 * 3600e3, M15 = 15 * 60e3;
const T = (hhmm) => Date.parse(`2026-11-18T${hhmm}:00Z`);
const SENT = Date.parse('2026-11-18T17:45:29Z'); // JTO: 16:00–20:00 4H mumunun içinde

// JTO 4H short: giriş 0,259 (gönderimde fiyat altında), stop 0,265, TP1 0,250, TP2 0,240, erken hedef %1,2
const JTO = { key: 'JTO|4H|short', coin: 'JTO', tf: '4H', direction: 'short', d: -1, entry: 0.259, stop: 0.265, tp1: 0.25, tp2: 0.24,
  early: 0.255892, earlyPortion: 0.5, atr: 0.004, zone: [0.259, 0.2605], sentAt: SENT, status: 'waiting', activeAt: null };

const k = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
/** 12:00'dan itibaren 15m mumları: varsayılan sakin (0,2560–0,2570); over: { 'HH:MM': [h, l] } */
function lower15(until, over = {}) {
  const out = [];
  for (let t = T('12:00'); t <= until; t += M15) {
    const key = new Date(t).toISOString().slice(11, 16);
    const [h, l] = over[key] ?? [0.257, 0.256];
    out.push(k(t, (h + l) / 2, h, l, (h + l) / 2));
  }
  return out;
}
/** 15m mumlardan 4H mumlar (son mum o ana kadarki canlı hali). */
function bars4h(lw) {
  const m = new Map();
  for (const c of lw) {
    const b = Math.floor(c.time / H4) * H4, x = m.get(b);
    if (!x) m.set(b, { ...c, time: b }); else Object.assign(x, { high: Math.max(x.high, c.high), low: Math.min(x.low, c.low), close: c.close });
  }
  return [...m.values()];
}
/** run.mjs tur uygulaması: olay varsa patch + durum yazılır. */
function apply(p, r) { return r.events.length ? { ...p, ...r.patch, status: r.status } : p; }
const turn = (p, until, over, opts = {}) => {
  const lw = lower15(until, over);
  return trackPlan(p, bars4h(lw), until + M15 + 30e3, { knifeGuard: '1', ...opts, lower: 'lower' in opts ? opts.lower : lw });
};

test('pencere: JTO 18.11 — 17:45:29 gönderim, 18:45 15m mumu girişe değdi → dolum 18:45; sonraki turlarda çift olay yok', () => {
  const over = { '18:45': [0.2592, 0.2575] };
  const r1 = turn(JTO, T('18:45'), over); // 18:45 mumunun içindeki tur (canlı 15m mumu)
  assert.deepEqual(r1.events, ['active']);
  assert.equal(r1.status, 'active');
  assert.equal(r1.patch.filledAt, T('18:45')); // 15m mumu zamanı (4H mumu değil)
  assert.ok(r1.patch.approachAtr < 2 && r1.patch.fillBarAtr < 1.5); // bıçak değil
  const p1 = apply(JTO, r1);
  for (const until of [T('19:00'), T('19:45'), T('20:00'), T('20:30')]) {
    const r = turn(p1, until, over);
    assert.deepEqual(r.events, [], `tur ${new Date(until).toISOString()}`);
  }
  // alt TF bu tur gelmese de (bütçe) olay yok
  assert.deepEqual(turn(p1, T('20:30'), over, { lower: null }).events, []);
  // tur kaçtı: ilk kez 20:30'da işlenir → yine 18:45 dolumu
  const late = turn(JTO, T('20:30'), over);
  assert.deepEqual(late.events, ['active']); assert.equal(late.patch.filledAt, T('18:45'));
});

test('pencere: dokunuş yok → bekliyor; lower yokken eski davranış (pencere işlenmez)', () => {
  assert.deepEqual(turn(JTO, T('19:30'), {}).events, []);
  assert.equal(turn(JTO, T('19:30'), {}).status, 'waiting');
  const r = turn(JTO, T('18:45'), { '18:45': [0.2592, 0.2575] }, { lower: null });
  assert.deepEqual(r.events, []); assert.equal(r.status, 'waiting');
});

test('pencere: sinyali içeren (17:45) ve önceki 15m mumlardaki dokunuş dolum sayılmaz', () => {
  const r = turn(JTO, T('19:30'), { '17:30': [0.2595, 0.2565], '17:45': [0.2593, 0.2565] });
  assert.deepEqual(r.events, []); assert.equal(r.status, 'waiting');
});

test('pencere: girişe değmeden önce TP1 → kaçtı (missed)', () => {
  const r = turn(JTO, T('19:00'), { '18:15': [0.2565, 0.2495], '18:45': [0.2592, 0.2575] });
  assert.deepEqual(r.events, ['missed']); assert.equal(r.status, 'missed'); assert.equal(r.patch.closedBar, T('18:15'));
});

test('pencere: dolum + sonra stop aynı pencerede; dolum 15m mumunda stop da stop', () => {
  const r = turn(JTO, T('19:30'), { '18:45': [0.2592, 0.2575], '19:15': [0.2655, 0.259] });
  assert.deepEqual(r.events, ['active', 'stopped']); assert.equal(r.patch.closedBar, T('19:15'));
  // dolum turundan sonraki turda stop (çift 'active' yok)
  const p1 = apply(JTO, turn(JTO, T('18:45'), { '18:45': [0.2592, 0.2575] }));
  assert.deepEqual(turn(p1, T('19:30'), { '18:45': [0.2592, 0.2575], '19:15': [0.2655, 0.259] }).events, ['stopped']);
  // dolum mumu stopa da değdi (yavaş yaklaşım, geniş mum değil: önceki mumlar yüksek tutulur)
  const s = turn(JTO, T('18:45'), { '18:30': [0.2635, 0.2625], '18:45': [0.2652, 0.2632] }, { knifeGuard: null });
  assert.deepEqual(s.events, ['active', 'stopped']);
});

test('pencere: dolum 15m mumunda erken hedef sayılmaz; sonraki 15m mumda sayılır, tekrar işlenince çift olay yok', () => {
  const r0 = turn(JTO, T('18:45'), { '18:45': [0.2592, 0.2555] }, { knifeGuard: null }); // aynı 15m mumda giriş + erken hedef
  assert.deepEqual(r0.events, ['active']);
  const over = { '18:45': [0.2592, 0.2575], '19:30': [0.2575, 0.2555] };
  const r = turn(JTO, T('19:30'), over);
  assert.deepEqual(r.events, ['active', 'early']); assert.equal(r.patch.earlyAt, T('19:30'));
  const p = apply(JTO, r);
  assert.deepEqual(turn(p, T('19:45'), over).events, []);
  assert.deepEqual(turn(p, T('20:15'), over).events, []);
  // erken hedeften sonra girişe dönüş (pencere içinde) → be, bir kez
  const be = turn(p, T('19:45'), { ...over, '19:45': [0.2592, 0.2565] });
  assert.deepEqual(be.events, ['be']);
  assert.ok(CLOSED.has(be.status));
});

test('pencere: dolum sonrası sonraki 4H mumları ana döngüde işlenir (20:00 mumunda stop)', () => {
  const over = { '18:45': [0.2592, 0.2575], '20:30': [0.2655, 0.258] };
  const p1 = apply(JTO, turn(JTO, T('18:45'), over));
  const r = turn(p1, T('20:30'), over);
  assert.deepEqual(r.events, ['stopped']); assert.equal(r.patch.closedBar, T('20:00'));
});

test('pencere: hızlı geliş (bıçak) → teyit bekliyor, knifeAt = sinyal 4H mumu; pencerede stop → knife; teyit sonraki 4H mumda', () => {
  const fast = { '18:15': [0.2585, 0.2565], '18:30': [0.2645, 0.2585] }; // tek 15m mumda 0,2585 → 0,2645 (4H mumu 2,1 ATR)
  const r = turn(JTO, T('18:30'), fast);
  assert.deepEqual(r.events, ['confirming']); assert.equal(r.patch.knifeAt, T('16:00')); assert.ok(r.patch.approachAtr > 2);
  const p = apply(JTO, r);
  assert.equal(signalWindowPending(p, T('19:00')), true);
  assert.deepEqual(turn(p, T('19:00'), fast).events, []);
  assert.deepEqual(turn(p, T('19:00'), { ...fast, '19:00': [0.2652, 0.263] }).events, ['knife']);
  // aynı turda bıçak + stop → doğrudan knife (ana döngü kuralı)
  assert.deepEqual(turn(JTO, T('18:30'), { ...fast, '18:30': [0.2652, 0.26] }).events, ['knife']);
  // stop görülmeden 20:00 mumu kapanışı bölge altında → teyitli giriş (ana döngü)
  const conf = { ...fast, '20:00': [0.2600, 0.2570], '20:15': [0.2580, 0.2570], '20:30': [0.2580, 0.2570], '20:45': [0.2580, 0.2570], '21:00': [0.258, 0.257], '21:15': [0.258, 0.257], '21:30': [0.258, 0.257], '21:45': [0.258, 0.257] };
  const c = turn(p, T('23:45'), conf);
  assert.deepEqual(c.events, ['active']); assert.equal(c.patch.confirmedAt, T('20:00'));
});

test('signalWindowOf / signalWindowPending: pencere sınırı ve alt TF bütçesi', () => {
  assert.deepEqual(signalWindowOf(JTO), { barT: T('16:00'), winEnd: T('20:00'), ms: H4 });
  assert.equal(signalWindowOf({ ...JTO, tf: '15m' }), null);
  const filled = { ...JTO, status: 'early', filledAt: T('18:45') };
  assert.equal(signalWindowPending(filled, T('21:00')), true);
  assert.equal(signalWindowPending(filled, T('20:00') + 2 * H4), false); // pencere kapanalı 2 mum geçti
  assert.equal(signalWindowPending({ ...filled, filledAt: T('20:00') }, T('21:00')), false); // 4H mumunda dolum (pencere değil)
  assert.equal(signalWindowPending({ ...filled, status: 'stopped' }, T('21:00')), false);
  assert.equal(signalWindowPending({ ...JTO, status: 'confirming', knifeAt: T('20:00') }, T('21:00')), false);
});

test('sameOpen: aynı girişli active / confirming plan yeni planı engeller; early / tp1 / kapanmış / farklı coin-yön-TF / uzak giriş engellemez', () => {
  const p = { coin: 'BNB', direction: 'short', tf: '4H', entry: 593.314 };
  const old = { coin: 'BNB', direction: 'short', tf: '4H', entry: 593.282, status: 'active' };
  assert.equal(sameOpen(p, [old]), true);
  assert.equal(sameOpen(p, [{ ...old, status: 'confirming' }]), true);
  for (const status of ['early', 'tp1', 'stopped', 'done', 'be', 'missed', 'expired', 'knife', 'waiting']) assert.equal(sameOpen(p, [{ ...old, status }]), false, status);
  assert.equal(sameOpen(p, [{ ...old, coin: 'ETH' }]), false);
  assert.equal(sameOpen(p, [{ ...old, direction: 'long' }]), false);
  assert.equal(sameOpen(p, [{ ...old, tf: '1H' }]), false);
  assert.equal(sameOpen({ ...p, entry: 600 }, [old]), false); // %1,1 uzak
  assert.equal(sameOpen({ ...p, entry: 600 }, [old], 2), true); // tolerans
  assert.equal(sameOpen({ ...p, entry: 0 }, [old]), false);
  // eski ad aynı kalır: yalnız waiting
  assert.equal(sameWaiting(p, [old]), false);
  assert.equal(sameWaiting(p, [{ ...old, status: 'waiting' }]), true);
  assert.equal(sameEntry(p, [old], 0.1, ['active']), true);
});
