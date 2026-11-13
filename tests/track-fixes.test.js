// Canlı takip düzeltmeleri (13.11.2026): dolum öncesi mumların yeniden işlenmesi (A1), teyitli girişte erken hedef (A2),
// geçmişten geri alınan planda filledAt'siz geri dönüş, finalR işareti ve tek kaynak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPlan, filledBarsOf, orphansOf } from '../bot/plan.js';
import { finalR as frUi } from '../src/ui/signals-lib.js';
import { finalR as frBot } from '../bot/review/metrics.js';

const H = 4 * 3600e3, M15 = 15 * 60e3, t0 = Date.UTC(2026, 10, 2, 0);
const c = (i, o, h, l, cl) => ({ time: t0 + i * H, open: o, high: h, low: l, close: cl, volume: 1 });
// long: giriş 100, stop 97, erken 101,2, TP1 104,5, TP2 107,5 — fiyat girişe yukarıdan (erken hedefin üstünden) iner
const L = { coin: 'X', key: 'X|4H|long|1', d: 1, direction: 'long', tf: '4H', entry: 100, stop: 97, tp1: 104.5, tp2: 107.5, early: 101.2, earlyPortion: 0.8, atr: 3, sentAt: t0 + 60e3, status: 'waiting' };
const LC = [c(1, 103, 103.5, 102, 102.5), c(2, 102.5, 102.8, 101.5, 101.6), c(3, 101.6, 101.7, 100.4, 100.6), c(4, 100.6, 100.8, 99.6, 100.1), c(5, 100.1, 100.5, 99.2, 99.5)];
// short ayna: giriş 100, stop 103, erken 98,8
const S = { ...L, key: 'X|4H|short|1', d: -1, direction: 'short', stop: 103, tp1: 95.5, tp2: 92.5, early: 98.8 };
const SC = LC.map((x) => ({ ...x, open: 200 - x.open, high: 200 - x.low, low: 200 - x.high, close: 200 - x.close }));
const next = (p, r) => ({ ...p, ...r.patch, status: r.status });

test('A1 long: dolmuş plan sonraki turda dolum öncesi (erken hedef üstü) mumları işlemez; sonra erken hedef sayılır', () => {
  const r1 = trackPlan(L, LC.slice(0, 4), t0 + 5 * H + 60e3);
  assert.deepEqual(r1.events, ['active']); assert.equal(r1.patch.filledAt, t0 + 4 * H);
  const r2 = trackPlan(next(L, r1), LC, t0 + 6 * H + 60e3);
  assert.equal(r2.status, 'active'); assert.deepEqual(r2.events, []); // eski: ['early', 'be']
  // dolumdan SONRA erken hedef → early, earlyAt o mum
  const r3 = trackPlan(next(L, r1), [...LC, c(6, 99.5, 101.4, 99.4, 101)], t0 + 7 * H + 60e3);
  assert.deepEqual(r3.events, ['early']); assert.equal(r3.patch.earlyAt, t0 + 6 * H);
});

test('A1 short: ayna senaryo', () => {
  const r1 = trackPlan(S, SC.slice(0, 4), t0 + 5 * H + 60e3);
  assert.deepEqual(r1.events, ['active']);
  const r2 = trackPlan(next(S, r1), SC, t0 + 6 * H + 60e3);
  assert.equal(r2.status, 'active'); assert.deepEqual(r2.events, []);
  const r3 = trackPlan(next(S, r1), [...SC, c(6, 100.5, 100.6, 98.6, 99)], t0 + 7 * H + 60e3);
  assert.deepEqual(r3.events, ['early']);
});

test('A1 erken hedefsiz yol ve tp1 durumu: dolum öncesi mumlar stop/hedef üretmez; dolum sonrası çalışır', () => {
  const N = { ...L, early: undefined, earlyPortion: undefined };
  const r1 = trackPlan(N, LC.slice(0, 4), t0 + 5 * H + 60e3);
  const p = next(N, r1);
  assert.equal(trackPlan(p, LC, t0 + 6 * H + 60e3).status, 'active');
  // tp1 durumuyla başlayan tur: dolum öncesi mumlar atlanır, sonra stop → stopped (TP1 sonrası)
  const t = { ...p, status: 'tp1', tp1At: t0 + 6 * H };
  const r = trackPlan(t, [...LC, c(6, 99.5, 104.6, 99.4, 104), c(7, 104, 104.2, 96.5, 97)], t0 + 9 * H);
  assert.deepEqual(r.events, ['stopped']); assert.equal(r.patch.closedBar, t0 + 7 * H);
});

test('A1 early durumuyla başlayan tur: earlyAt öncesi atlanır; earlyAt yoksa mumlardan bulunur (dolum mumunda girişe dokunuş be değil)', () => {
  const cs = [...LC, c(6, 99.5, 101.4, 99.4, 101), c(7, 101, 101.8, 100.6, 101.5)];
  const e = { ...L, status: 'early', filledAt: t0 + 4 * H, earlyAt: t0 + 6 * H, activeAt: t0 + 4 * H + 5 * M15, tp1At: t0 + 6 * H + 5 * M15 };
  assert.deepEqual(trackPlan(e, cs, t0 + 8 * H + 60e3).events, []);
  const { earlyAt, ...noEarlyAt } = e;
  assert.deepEqual(filledBarsOf(noEarlyAt, cs), { fillAt: t0 + 4 * H, earlyAt: t0 + 6 * H });
  const r = trackPlan(noEarlyAt, cs, t0 + 8 * H + 60e3);
  assert.equal(r.status, 'early'); assert.deepEqual(r.events, []); // eski: dolum mumunda low ≤ giriş → 'be'
  // sonra girişe dönüş → be
  assert.deepEqual(trackPlan(noEarlyAt, [...cs, c(8, 101.5, 101.6, 99.9, 100.2)], t0 + 9 * H + 60e3).events, ['be']);
});

test('filledAt yoksa geri dönüş: activeAt (duvar saati) mumuna kadar girişe ilk dokunan mum; bölge içi gönderimde atlama yok', () => {
  const p = { ...L, status: 'active', activeAt: t0 + 4 * H + 3 * M15 }; // geçmişten geri alınan kayıt (filledAt yok)
  assert.equal(filledBarsOf(p, LC).fillAt, t0 + 4 * H);
  assert.equal(trackPlan(p, LC, t0 + 6 * H + 60e3).status, 'active');
  // geçmiş kaydından orphansOf → aynı sonuç
  const [o] = orphansOf([{ id: `${p.key}|${p.sentAt}`, ...p }], []);
  assert.equal(trackPlan(o, LC, t0 + 6 * H + 60e3).status, 'active');
  // bölge içinde gönderildi (activeAt = sentAt): sonraki tüm mumlar dolum sonrası
  const z = { ...L, status: 'active', activeAt: L.sentAt };
  assert.equal(filledBarsOf(z, LC).fillAt, null);
  assert.deepEqual(trackPlan(z, LC, t0 + 6 * H + 60e3).events, ['early', 'be']); // dolum gönderimde: ilk mumun tepesi erken hedef
});

test('dolum mumunda alt TF sırası (fillRes) korunur: tp → early, none → bu mumda hedef yok', () => {
  const plan = { ...L, sentAt: 0, entry: 100, stop: 96, tp1: 104, tp2: 110 };
  const bar = { time: H, open: 102, high: 103, low: 99.8, close: 102.5 };
  const q = (k, o, h, l, cl) => ({ time: H + k * M15, open: o, high: h, low: l, close: cl });
  const fillFirst = [q(0, 102, 102.1, 99.8, 100.3), q(1, 100.3, 103, 100.2, 102.8)];
  const upFirst = [q(0, 102, 103, 101.9, 102.8), q(1, 102.8, 102.9, 99.8, 100.2)];
  assert.deepEqual(trackPlan(plan, [bar], 3 * H, { lower: fillFirst }).events, ['active', 'early']);
  const r = trackPlan(plan, [bar], 3 * H, { lower: upFirst });
  assert.deepEqual(r.events, ['active']); assert.equal(r.patch.fillRes, 'none');
  // sonraki tur: dolum mumu kaydedilmiş sıra ile; sonra erken hedef
  const p2 = next(plan, r);
  assert.equal(trackPlan(p2, [bar], 4 * H).status, 'active');
  assert.deepEqual(trackPlan(p2, [bar, { time: 2 * H, open: 102, high: 101.5, low: 100.5, close: 101 }], 4 * H).events, ['early']);
});

test('A2 teyitli giriş: erken hedef yeni girişe göre taşınır (aynı % uzaklık), girişin doğru tarafında', () => {
  // long, giriş 100 (bölge 99–100), stop 95, erken 101,2; hızlı yaklaşma → confirming; teyit kapanışı 102 (> erken 101,2)
  const plan = { ...L, entry: 100, stop: 95, tp1: 106, tp2: 110, early: 101.2, zone: [99, 100], sentAt: 0, atr: 1 };
  const cs = [{ time: H, open: 104, high: 104, low: 99.5, close: 99.8 }, { time: 2 * H, open: 99.8, high: 102.2, low: 99.6, close: 102 }, { time: 3 * H, open: 102, high: 102.5, low: 101.6, close: 102.2 }];
  const r = trackPlan(plan, cs, 10 * H, { knifeGuard: 1 });
  assert.deepEqual(r.events, ['confirming', 'active']);
  assert.equal(r.patch.entry, 102); assert.equal(r.patch.entryPlanned, 100); assert.equal(r.patch.earlyPlanned, 101.2);
  assert.equal(r.patch.early, 103.224); assert.ok(r.patch.early > r.patch.entry);
  assert.equal(r.status, 'active'); // 3. mumun tepesi 102,5 < 103,224 → erken yok (eski: hemen 'early')
  // sonraki tur: aynı sonuç, sonra yeni erken hedefte early
  const p2 = next(plan, r);
  assert.deepEqual(trackPlan(p2, [...cs, { time: 4 * H, open: 102.2, high: 103.4, low: 102, close: 103 }], 10 * H, { knifeGuard: 1 }).events, ['early']);
});

test('finalR işaretli ve tek kaynak: erken hedef girişin yanlış tarafındaysa kâr sayılmaz', () => {
  assert.equal(frUi, frBot);
  const ok = { d: 1, direction: 'long', entry: 100, stop: 97, early: 101.2, earlyPortion: 0.8, tp1: 104.5, tp2: 107.5, rr1: 1.5, rr: 2.5, status: 'be' };
  assert.ok(Math.abs(frUi(ok) - 0.8 * 0.4) < 1e-9);
  assert.ok(Math.abs(frUi({ ...ok, d: -1, direction: 'short', stop: 103, early: 98.8 }) - 0.8 * 0.4) < 1e-9);
  // TIA 4H long 29.10 (history.json): giriş 0,5492, erken 0,5338128, stop 0,512487 → eskiden +0,34R
  const tia = { d: 1, direction: 'long', entry: 0.5492, early: 0.5338128, stop: 0.512487, earlyPortion: 0.8, status: 'be' };
  assert.ok(frUi(tia) < 0); assert.ok(Math.abs(frUi(tia) - 0.8 * (0.5338128 - 0.5492) / (0.5492 - 0.512487)) < 1e-9);
  // d alanı yoksa yön direction'dan
  const { d, ...noD } = tia; assert.equal(frUi(noD), frUi(tia));
});

// MR (13.11): 3 kademe + midStop 'early' — stop erken hedefe yalnız mid (TP1) mumundan SONRA çekilir. Eskiden midAt önceki
// turda yazıldıysa sonraki turda erken hedef seviyesi earlyAt–midAt arası mumlara da uygulanıyordu → sahte 'be'.
for (const [name, base, cs0, d] of [['long', L, LC, 1], ['short', S, SC, -1]]) {
  test(`MR ${name}: erken hedef → erken seviyenin altına sarkma (girişe değmeden) → TP1 → sonraki turda 'early'; mid sonrası erken seviyeye dönüş 'be'`, () => {
    const k = (i, o, h, l, cl) => (d === 1 ? c(i, o, h, l, cl) : c(i, 200 - o, 200 - l, 200 - h, 200 - cl)); // short: ayna (tepe ↔ dip)
    const cs = [...cs0, k(6, 99.5, 101.4, 99.4, 101), // erken hedef (dolum mumundan sonra)
      k(7, 101, 101.3, 100.5, 100.8), //            erken seviyenin altı, girişin üstü (stop hâlâ girişte)
      k(8, 100.8, 104.7, 100.7, 104.2), //          TP1 → mid; aynı mumda erken seviyenin altı da var (mid mumunda stop girişte)
      k(9, 104.2, 104.4, 103, 103.5)];
    const P = { ...base, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early', status: 'early', filledAt: t0 + 4 * H, earlyAt: t0 + 6 * H };
    const r1 = trackPlan(P, cs.slice(0, 9), t0 + 9 * H + 60e3);
    assert.deepEqual(r1.events, ['mid']); assert.equal(r1.status, 'early'); assert.equal(r1.patch.midAt, t0 + 8 * H);
    const p2 = next(P, r1);
    const r2 = trackPlan(p2, cs, t0 + 10 * H + 60e3);
    assert.equal(r2.status, 'early'); assert.deepEqual(r2.events, []); // eski: 7. mum erken seviyenin altı → 'be'
    // tek geçiş (dolumdan) aynı: early + mid, açık
    const single = trackPlan({ ...P, status: 'active', earlyAt: undefined }, cs, t0 + 10 * H + 60e3);
    assert.equal(single.status, 'early'); assert.deepEqual(single.events, ['early', 'mid']);
    // mid'den SONRA erken seviyeye dönüş (girişe değmeden) → be
    const r3 = trackPlan(p2, [...cs, k(10, 103.5, 103.6, 101, 101.1)], t0 + 11 * H + 60e3);
    assert.deepEqual(r3.events, ['be']); assert.equal(r3.patch.closedBar, t0 + 10 * H);
    // midStop 'entry' (stop girişte kalır): aynı dönüş be değil
    assert.deepEqual(trackPlan({ ...p2, midStop: 'entry' }, [...cs, k(10, 103.5, 103.6, 101, 101.1)], t0 + 11 * H + 60e3).events, []);
  });
}

// K2 (13.11): 15 dk'lık turda bıçak kapanmamış mumda tespit edilir; sonraki turlarda o mumun dokunmadan SONRAKİ kısmında stop
// görülürse teyitten önce stop = iptal ('knife'). Eskiden mum tümüyle atlanıyor, sonra teyitle giriliyordu. Teyit yalnız sonraki mumda.
test('K2: bıçak mumunun kalanında stop → knife; stop yoksa o mumda teyit aranmaz, sonraki kapanmış mumda aranır', () => {
  const plan = { ...L, entry: 100, stop: 97, tp1: 106, tp2: 110, early: undefined, zone: [99, 100], sentAt: 0, atr: 1 };
  const kb = { time: H, open: 104, high: 104, low: 99.5, close: 99.8 }; // bıçak mumu (yarım haliyle)
  const r1 = trackPlan(plan, [kb], H + 2 * M15, { knifeGuard: 1 });
  assert.deepEqual(r1.events, ['confirming']); assert.equal(r1.patch.knifeAt, H);
  const p = next(plan, r1);
  // aynı 4H mumun sonraki hali stopa iniyor → knife
  const r2 = trackPlan(p, [{ ...kb, low: 96.8, close: 97.5 }], H + 8 * M15, { knifeGuard: 1 });
  assert.deepEqual(r2.events, ['knife']); assert.equal(r2.status, 'knife');
  // stop yok, bıçak mumu kapanışı bölgenin üstünde (teyit gibi) → o mumda teyit yok; sonraki kapanmış mumda teyit
  const kc = { ...kb, close: 100.5, high: 104 };
  assert.deepEqual(trackPlan(p, [kc], 2 * H + 60e3, { knifeGuard: 1 }).events, []);
  const r3 = trackPlan(p, [kc, { time: 2 * H, open: 100.5, high: 101.5, low: 100.2, close: 101.2 }], 3 * H + 60e3, { knifeGuard: 1 });
  assert.deepEqual(r3.events, ['active']); assert.equal(r3.patch.entry, 101.2);
  // short ayna: bıçak mumunun kalanında stop (103 üstü) → knife
  const ps = next({ ...plan, d: -1, direction: 'short', stop: 103, tp1: 94, tp2: 90, zone: [100, 101] }, { status: 'confirming', patch: { knifeAt: H } });
  assert.deepEqual(trackPlan(ps, [{ time: H, open: 96, high: 103.2, low: 96, close: 102.5 }], H + 8 * M15, { knifeGuard: 1 }).events, ['knife']);
});

// EL (13.11): erken hedef kapanmamış mumda yazıldıysa sonraki turlar o mumun kalanında TP1 (ara kademe) ve TP2'yi görür;
// tek geçişin kuralı: erken hedef mumunda girişe dönüş sayılmaz. Dolum mumu = erken hedef mumu ise mum atlanır (tek geçiş gibi).
test('EL: erken hedef mumunun kalanında mid ve TP2 sayılır, girişe dönüş sayılmaz; dolum mumunda atlanır', () => {
  const P = { ...L, earlyPortion: 0.5, midPortion: 0.25, midStop: 'entry', status: 'early', filledAt: t0 + 4 * H, earlyAt: t0 + 6 * H };
  const cs = [...LC, c(6, 99.5, 104.7, 99.4, 104.2)]; // erken hedef mumu: tam haliyle TP1 (104,5) de var, dip girişin altında
  const r = trackPlan(P, cs, t0 + 6 * H + 12 * M15);
  assert.deepEqual(r.events, ['mid']); assert.equal(r.status, 'early'); assert.equal(r.patch.midAt, t0 + 6 * H); // eski: [] (mum atlanır)
  // aynı mumda TP2 de → done (mid de yazılır)
  const r2 = trackPlan(P, [...LC, c(6, 99.5, 107.6, 99.4, 107)], t0 + 7 * H + 60e3);
  assert.equal(r2.status, 'done'); assert.equal(r2.patch.midAt, t0 + 6 * H);
  // mid önceki turda yazıldıysa tekrar yazılmaz
  assert.deepEqual(trackPlan({ ...P, midAt: t0 + 6 * H }, cs, t0 + 7 * H + 60e3).events, []);
  // tek geçiş (dolumdan) aynı mumu aynı sayar
  assert.deepEqual(trackPlan({ ...P, status: 'active', earlyAt: undefined }, cs, t0 + 7 * H + 60e3).events, ['early', 'mid']);
  // dolum mumu = erken hedef mumu (alt TF sırası): atlanır
  assert.deepEqual(trackPlan({ ...P, filledAt: t0 + 6 * H, fillRes: 'tp' }, cs, t0 + 7 * H + 60e3).events, []);
});
