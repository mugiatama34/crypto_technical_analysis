// ★ Takip listesi: erken hedef (canlı botun 3 kademeli çıkışı) — src/watch/watch.js (20.11)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWatch, makeManualWatch, updateWatch, watchR, watchEarlyOf, watchStatusText, watchEventText, watchEarlyR, WATCH_EARLY, WATCH_LABEL, mergeImport } from '../src/watch/watch.js';
import { runScan } from '../src/scan/scanner.js';
import { fixtureProvider } from '../src/data/fixture.js';

const H = 3600e3;
const c = (t, low, high) => ({ time: t, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
// Eski (erkensiz) kayıt ve aynı kurulumun erken hedefli hali: giriş 100, stop 98 (risk 2), TP1 103 (1,5R), TP2 105 (2,5R)
const old = { id: 'X|1H|long|1|0', key: 'X|1H|long|1', coin: 'X', instId: 'X-USDT-SWAP', tf: '1H', direction: 'long', d: 1, entry: 100, stop: 98, tp1: 103, tp2: 105, rr1: 1.5, rr: 2.5, sentAt: 0, addedAt: 0, status: 'waiting', signals: [], note: '' };
const ew = { ...old, ...watchEarlyOf(old) }; // erken 101,2 → 0,6R
const run = (w, bars, now) => updateWatch(w, bars, now);

test('watchEarlyOf: botla aynı fiyat (%1,2) ve paylar; long + short; TP1 erken hedefin içindeyse yok', () => {
  assert.deepEqual(watchEarlyOf(old), { early: 101.2, earlyPortion: 0.5, midPortion: 0.25, midStop: 'early' });
  assert.deepEqual(WATCH_EARLY, { pct: 1.2, portion: 0.5, mid: 0.25, midStop: 'early' });
  const s = watchEarlyOf({ tf: '4H', d: -1, entry: 50, tp1: 48, tp2: 46 });
  assert.equal(s.early, 49.4);
  assert.deepEqual(watchEarlyOf({ tf: '4H', d: 1, entry: 100, tp1: 101, tp2: 104 }), {}, 'TP1 %1 → erken hedef TP1 ötesinde');
  assert.deepEqual(watchEarlyOf({ tf: '15m', d: -1, entry: 100, tp1: 99.2, tp2: 98 }), {});
  assert.deepEqual(watchEarlyOf({ tf: '1H', d: 1, entry: 100, tp1: 101.2, tp2: 104 }), {}, 'TP1 = erken hedef → yok');
});

test('makeWatch: taramadaki satıra erken hedef alanları (kural tutarsa), yön ve TP1 sırası doğru', async () => {
  const res = await runScan({ timeframes: ['1H', '4H'], topN: 10 }, { provider: fixtureProvider });
  let n = 0;
  for (const row of res.rows.filter((r) => r.best && r.direction)) {
    const w = makeWatch(row, 1000);
    if (w.error) continue;
    n++;
    const want = watchEarlyOf(w);
    if (want.early) {
      assert.equal(w.early, want.early); assert.equal(w.earlyPortion, 0.5); assert.equal(w.midPortion, 0.25); assert.equal(w.midStop, 'early');
      near(w.early, +(w.entry * (1 + w.d * 0.012)).toPrecision(8));
      assert.ok(w.d * (w.early - w.entry) > 0 && w.d * (w.tp1 - w.early) > 0);
    } else assert.equal('early' in w, false, 'kural tutmayınca alan yok');
  }
  assert.ok(n > 0);
});

test('makeManualWatch: isteğe bağlı erken hedef; boş = eski düzen; giriş ile TP1 arasında olmalı (short dahil)', () => {
  const f = { coin: 'WLD', tf: '1H', direction: 'long', entry: '100', stop: '98', tp1: '103', tp2: '105' };
  const w0 = makeManualWatch(f, 5000);
  assert.equal('early' in w0, false);
  const w = makeManualWatch({ ...f, early: '101,5' }, 5000);
  assert.equal(w.early, 101.5); assert.equal(w.earlyPortion, 0.5); assert.equal(w.midPortion, 0.25); assert.equal(w.midStop, 'early');
  assert.match(makeManualWatch({ ...f, early: '103' }).error, /Erken/);
  assert.match(makeManualWatch({ ...f, early: '99' }).error, /Erken/);
  assert.match(makeManualWatch({ ...f, early: 'abc' }).error, /Erken/);
  const s = makeManualWatch({ coin: 'WLD', direction: 'short', entry: 1, stop: 1.05, tp1: 0.9, tp2: 0.85, early: 0.97 }, 5000);
  assert.equal(s.early, 0.97);
  assert.match(makeManualWatch({ coin: 'WLD', direction: 'short', entry: 1, stop: 1.05, tp1: 0.9, early: 1.01 }).error, /Erken/);
});

test('3 kademe: erken → başa baş (kalan %50 girişte) = 0,5 × 0,6R', () => {
  let r = run(ew, [c(H, 99.5, 101)], 2 * H);
  assert.equal(r.item.status, 'active');
  r = run(r.item, [c(H, 99.5, 101), c(2 * H, 100.5, 101.5)], 3 * H);
  assert.equal(r.item.status, 'early'); assert.deepEqual(r.events, ['early']); assert.equal(r.item.earlyAt, 2 * H);
  assert.equal(r.item.closedAt, undefined, 'erken hedef kapanış değil');
  near(watchR(r.item), 0.5 * 0.6 + 0.5 * 0.5); // son kapanış 101 → 0,5R × kalan %50
  assert.equal(watchStatusText(r.item), WATCH_LABEL.early); assert.match(watchEventText('early', r.item), /%50 kapat, stop girişe/);
  r = run(r.item, [c(H, 99.5, 101), c(2 * H, 100.5, 101.5), c(3 * H, 99.8, 100.6)], 4 * H);
  assert.equal(r.item.status, 'be'); assert.equal(r.item.closedAt, 3 * H);
  near(watchR(r.item), 0.3); assert.equal(watchStatusText(r.item), 'Erken hedef sonrası başa baş');
  near(watchEarlyR(ew), 0.6);
});

test('3 kademe: erken → TP1 (%25) → stop erken hedefe → orada kapanış', () => {
  const bars = [c(H, 99.5, 101), c(2 * H, 100.5, 101.5), c(3 * H, 101.5, 103.2)];
  let r = run(ew, bars, 4 * H);
  assert.deepEqual(r.events, ['active', 'early', 'mid']); assert.equal(r.item.status, 'early');
  assert.equal(r.item.midAt, 3 * H); assert.equal(r.item.tp1At, 3 * H); assert.equal(r.item.earlyAt, 2 * H);
  near(watchR(r.item), 0.5 * 0.6 + 0.25 * 1.5 + 0.25 * ((102.35 - 100) / 2));
  assert.equal(watchStatusText(r.item), 'TP1 görüldü (erken hedef sonrası)'); assert.match(watchEventText('mid', r.item), /%25 daha kapat, stop erken hedefe/);
  r = run(r.item, [...bars, c(4 * H, 101.6, 102.5)], 5 * H);
  assert.equal(r.item.status, 'early', 'erken hedefin üstünde kalır');
  r = run(r.item, [...bars, c(4 * H, 101.6, 102.5), c(5 * H, 101, 102)], 6 * H);
  assert.equal(r.item.status, 'be'); assert.deepEqual(r.events, ['be']);
  near(watchR(r.item), 0.5 * 0.6 + 0.25 * 1.5 + 0.25 * 0.6);
  assert.equal(watchStatusText(r.item), 'TP1 sonrası erken hedefte stop');
});

test('3 kademe: erken → TP1 → TP2 = 0,5·0,6 + 0,25·1,5 + 0,25·2,5; tek mumda erken+TP1+TP2 de aynı', () => {
  const r = run(ew, [c(H, 99.5, 101), c(2 * H, 100.5, 101.5), c(3 * H, 101.5, 103.2), c(4 * H, 104, 105.5)], 5 * H);
  assert.equal(r.item.status, 'done'); assert.equal(r.item.closedAt, 4 * H);
  near(watchR(r.item), 0.3 + 0.375 + 0.625);
  const one = run(ew, [c(H, 99.5, 101), c(2 * H, 100.5, 105.5)], 3 * H);
  assert.equal(one.item.status, 'done'); assert.equal(one.item.midAt, 2 * H); assert.equal(one.item.tp1At, 2 * H);
  near(watchR(one.item), 1.3);
});

test('erken hedefli kayıt doğrudan stop: −1R; tek hedefte (TP2 = TP1) erken + TP2 iki kademe', () => {
  const r = run(ew, [c(H, 99.5, 101), c(2 * H, 97.5, 100.5)], 3 * H);
  assert.equal(r.item.status, 'stopped'); assert.equal(watchR(r.item), -1); assert.equal(watchStatusText(r.item), WATCH_LABEL.stopped);
  const single = { ...old, tp2: 103, rr: 1.5, ...watchEarlyOf({ ...old, tp2: 103 }) };
  const s = run(single, [c(H, 99.5, 101), c(2 * H, 100.5, 101.5), c(3 * H, 101.5, 103.2)], 4 * H);
  assert.equal(s.item.status, 'done'); assert.equal(s.item.midAt, undefined);
  near(watchR(s.item), 0.5 * 0.6 + 0.5 * 1.5);
});

test('geriye uyum: erkensiz eski kayıt aynı mumlarla eski kuralla (TP1 yarı + başa baş), alan eklenmez', () => {
  const bars = [c(H, 99.5, 101), c(2 * H, 100.5, 101.5), c(3 * H, 101.5, 103.2), c(4 * H, 104, 105.5)];
  const r = run(old, bars, 5 * H);
  assert.equal(r.item.status, 'done'); assert.deepEqual(r.events, ['active', 'tp1', 'done']);
  assert.equal(watchR(r.item), 0.5 * 1.5 + 0.5 * 2.5);
  for (const k of ['early', 'earlyAt', 'midAt', 'earlyPortion', 'midPortion']) assert.equal(k in r.item, false, k);
  const st = run(old, [c(H, 99.5, 101), c(2 * H, 101, 103.2), c(3 * H, 97, 100)], 4 * H).item;
  assert.equal(st.status, 'stopped'); assert.equal(watchR(st), 0.75); assert.equal(watchStatusText(st), 'TP1 sonrası başa baş');
  assert.equal(watchEventText('tp1', st), WATCH_LABEL.tp1); assert.equal(watchEventText('stopped', st), WATCH_LABEL.stopped);
  // içe aktarma alanları korur (erkenli ve erkensiz)
  const m = mergeImport([], JSON.stringify([old, { ...ew, id: 'E' }]));
  assert.equal(m.length, 2); assert.equal(m[1].early, 101.2); assert.equal('early' in m[0], false);
});
