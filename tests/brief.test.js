// Sabah piyasa özeti (bot/brief): seviye seçimi + birleştirme, yön, "bu bölge" ↔ aralık, İzle takibi, Berlin saati ve çift
// gönderim koruması, altın kapalı günler, mesaj uzunluğu, Türkçe biçim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, pickLevels, niceStep, roundCands, directionOf, zoneOrRange, watchOf, evalWatch, levelOutcome, diverges,
  weekdaysOnly, weeklyOf, swingPoints, dailyCands, analyze,
} from '../bot/brief/core.js';
import { fpx, fpct, fdelta, dateLoc, prevLine, zoneLine, dailyText, weeklyText, visibleLen, berlinParts, reviewLine } from '../bot/brief/format.js';
import { planRun, goldOpen } from '../bot/brief/schedule.js';
import { prevOf, buildAsset } from '../bot/brief/run.mjs';

const T0 = Date.UTC(2025, 0, 6); // Pazartesi
/** Günlük mumlar: f(i) → kapanış; açılış önceki kapanış, fitil ±w. */
function series(n, f, { w = 1, t0 = T0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = f(i), o = i ? f(i - 1) : c;
    out.push({ time: t0 + i * DAY, open: o, high: Math.max(o, c) + w, low: Math.min(o, c) - w, close: c });
  }
  return out;
}

test('seviye: taraflar ayrı, yakın adaylar tek bölgede birleşir, en yakın 2 + 2, nedenler öncelik sırasıyla', () => {
  const c = [
    { price: 101, kind: 'high', label: 'dünün tepesi', prio: 1, time: 1 },
    { price: 101.2, kind: 'round', label: 'yuvarlak sayı', prio: 9 },
    { price: 104, kind: 'high', label: '30 Ekim tepesi', prio: 4, time: 2 },
    { price: 110, kind: 'high', label: 'Ekim tepesi', prio: 3, time: 3 },
    { price: 99, kind: 'low', label: 'dünün dibi', prio: 1, time: 4 },
    { price: 98.9, kind: 'low', label: 'geçen haftanın dibi', prio: 2, time: 4 }, // aynı mum → tek ad
    { price: 95, kind: 'low', label: 'Ekim dibi', prio: 3, time: 5 },
    { price: 90, kind: 'low', label: 'eski dip', prio: 4, time: 6 },
  ];
  const { res, sup } = pickLevels(c, 100, 2); // tol 0,5
  assert.equal(res.length, 2); assert.equal(sup.length, 2);
  assert.deepEqual([res[0].lo, res[0].hi], [101, 101.2]);
  assert.deepEqual(res[0].reasons, ['dünün tepesi', 'yuvarlak sayı']);
  assert.equal(res[1].mid, 104);
  assert.deepEqual([sup[0].lo, sup[0].hi], [98.9, 99]);
  assert.deepEqual(sup[0].reasons, ['dünün dibi']);
  assert.equal(sup[1].mid, 95);
  // bölge fiyatı hiç içine almaz: fiyatın iki yanındaki yakın adaylar ayrı tarafta kalır
  const p = pickLevels([{ price: 99.9, kind: 'low', label: 'a', prio: 1 }, { price: 100.1, kind: 'high', label: 'b', prio: 1 }], 100, 2);
  assert.equal(p.res[0].mid, 100.1); assert.equal(p.sup[0].mid, 99.9);
  // bölge genişliği ≤ 2·tol: zincir uzamaz
  const chain = pickLevels([101, 101.4, 101.8, 102.2].map((x) => ({ price: x, kind: 'high', label: String(x), prio: 4, time: x })), 100, 2);
  assert.ok(chain.res[0].hi - chain.res[0].lo <= 1 + 1e-9);
});

test('yuvarlak sayı adımı ≈ 2 ATR\'yi geçmeyen güzel sayı', () => {
  assert.equal(niceStep(5500), 5000); assert.equal(niceStep(120), 100); assert.equal(niceStep(300), 250);
  const r = roundCands(96400, 2750).map((x) => x.price).sort((a, b) => a - b);
  assert.deepEqual(r, [90000, 95000, 100000, 105000]);
});

test('dönüş noktası: belirgin tepe / dip bulunur, son k mum aday değildir', () => {
  const cs = series(40, (i) => 100 + 10 * Math.sin(i / 3));
  const sw = swingPoints(cs, { k: 3, prom: 5 });
  assert.ok(sw.some((s) => s.kind === 'high') && sw.some((s) => s.kind === 'low'));
  assert.ok(sw.every((s) => s.i <= cs.length - 4));
});

test('yön: düzenli yükseliş YUKARI, düşüş AŞAĞI; gün sayısı ardışık aynı yön', () => {
  const up = directionOf(series(150, (i) => 100 + i));
  assert.equal(up.dir, 'up'); assert.ok(up.streak > 30);
  const turn = directionOf(series(160, (i) => (i < 120 ? 100 + i : 220 - 4 * (i - 120))));
  assert.notEqual(turn.dir, 'up'); assert.ok(turn.streak < 40);
  assert.equal(directionOf(series(50, (i) => i + 1)), null); // veri yetersiz
});

test('"bu bölge" ↔ aralık: sıkışık seri salınım, uzun süre görülmeyen fiyat bölge satırı, hiç görülmeyen "never"', () => {
  const flat = series(60, (i) => 100 + (i % 4)); // kapanış 100–103, fitil 99–104
  const r = zoneOrRange(flat, 101, 2);
  assert.equal(r.kind, 'range'); assert.ok(r.N >= 10); assert.equal(r.lo, 99); assert.equal(r.hi, 104);
  // 100'den 199'a çık, sonra günde 3 in (112'ye) → 115 en son yükseliş sırasında (~114 gün önce) görüldü
  const trip = series(130, (i) => (i < 100 ? 100 + i : 199 - 3 * (i - 100)));
  const z = zoneOrRange(trip, 115, 4);
  assert.equal(z.kind, 'zone'); assert.ok(z.ago >= 20); assert.ok(z.bar.low <= 115 && z.bar.high >= 115);
  assert.ok(z.fwd > 0); // o günden 7 gün sonra fiyat daha yukarıdaydı
  const ath = zoneOrRange(series(40, (i) => 100 + 5 * i), 400, 3);
  assert.equal(ath.kind, 'zone'); assert.equal(ath.never, true);
  // yakın zamanda görülmüş ama sıkışık değil → pencere satırı
  const zig = series(40, (i) => 100 + (i % 2 ? 20 : -20));
  assert.equal(zoneOrRange(zig, 100, 40, { spanK: 0.5 }).kind, 'window');
});

test('İzle ve "dün" takibi: kapanışla kırılma GELDİ, fitil dokunup kapanış geçmezse gelmedi', () => {
  const watch = watchOf({ sup: [{ lo: 95, hi: 95.3 }, { lo: 93, hi: 93 }], res: [{ lo: 97.8, hi: 97.8 }] });
  assert.equal(watch.length, 2); assert.equal(watch[0].level, 95); assert.equal(watch[1].next, null);
  const ev = evalWatch(watch, [{ time: 0, open: 96, high: 98.2, low: 94.5, close: 97 }]);
  assert.equal(ev[0].hit, false); assert.equal(ev[0].touched, true);
  assert.equal(ev[1].hit, false); assert.equal(ev[1].touched, true);
  const ev2 = evalWatch(watch, [{ time: 0, open: 96, high: 96.5, low: 94, close: 94.2 }]);
  assert.equal(ev2[0].hit, true); assert.equal(ev2[1].touched, false);
  const line = prevLine(ev2, 'Dün');
  assert.match(line, /^↩️ Dün: "95,00 altı" GELDİ \(kapanış 94,20\) · "97,80 üstü" gelmedi \(tepe 96,50\)\.$/);
  assert.equal(evalWatch(watch, []), null);
  // önceki mesajın mumundan sonraki kapanmış mumlar; eski (> 8 gün) durum yok sayılır
  const cs = series(10, (i) => 100 + i);
  const st = { barTime: cs[8].time, watch };
  assert.equal(prevOf(st, cs, cs[9].time + DAY).bars.length, 2);
  assert.equal(prevOf(st, cs, cs[8].time + 10 * DAY), null);
  assert.equal(prevOf(null, cs, cs[9].time), null);
});

test('haftalık özet: direnç kırıldı / tuttu / uğranmadı', () => {
  const z = { lo: 100, hi: 101 };
  assert.equal(levelOutcome(z, 'res', { high: 103, low: 95, close: 102 }), 'kırıldı');
  assert.equal(levelOutcome(z, 'res', { high: 100.5, low: 95, close: 99 }), 'tuttu');
  assert.equal(levelOutcome(z, 'res', { high: 99, low: 95, close: 98 }), null);
  assert.equal(levelOutcome(z, 'sup', { high: 105, low: 99, close: 99.5 }), 'kırıldı');
  const line = reviewLine({ bar: { low: 95, high: 103, close: 102 }, items: [{ z, side: 'res', out: 'kırıldı' }, { z: { lo: 96, hi: 96 }, side: 'sup', out: 'tuttu' }] });
  assert.match(line, /tutan: 96,00 destek · kırılan: 100,0–101,0 direnç\.$/);
});

test('ETH ayrışması: yön farklı ya da günlük getiri farkı ≥ 2 puan', () => {
  assert.equal(diverges({ dir: 'down', ret1: -0.012 }, { dir: 'down', ret1: -0.015 }), false);
  assert.equal(diverges({ dir: 'down', ret1: -0.012 }, { dir: 'up', ret1: -0.015 }), true);
  assert.equal(diverges({ dir: 'down', ret1: -0.01 }, { dir: 'down', ret1: -0.035 }), true);
});

test('Berlin saati: kış (UTC+1) 05:00 UTC, yaz (UTC+2) 04:00 UTC gönderir; gecikmeye dayanıklı, günde bir kez', () => {
  // kış: 16.11.2026 Pazartesi
  const w4 = Date.UTC(2026, 10, 16, 4, 3), w5 = Date.UTC(2026, 10, 16, 5, 2), w5late = Date.UTC(2026, 10, 16, 5, 48);
  assert.equal(berlinParts(w5).hour, 6);
  assert.deepEqual([planRun({ nowMs: w4, flag: true }).daily, planRun({ nowMs: w5, flag: true }).daily], [false, true]);
  assert.equal(planRun({ nowMs: w5, flag: true }).weekly, true); // Pazartesi → haftalık da
  const sent = { daily: { lastDate: '2026-11-16' }, weekly: { lastDate: '2026-11-16' } };
  assert.equal(planRun({ nowMs: w5late, state: sent, flag: true }).daily, false); // aynı gün ikinci kez yok
  // kışın 04:00 tetiklemesi 60+ dk gecikirse o gönderir, 05:00 koşusu atlar
  const late4 = Date.UTC(2026, 10, 17, 5, 1);
  assert.equal(planRun({ nowMs: late4, state: sent, flag: true }).daily, true);
  assert.equal(planRun({ nowMs: late4, state: sent, flag: true }).weekly, false); // Salı
  // yaz: 6.7.2026 Pazartesi
  const s4 = Date.UTC(2026, 6, 6, 4, 10), s5 = Date.UTC(2026, 6, 6, 5, 5);
  assert.equal(berlinParts(s4).hour, 6);
  assert.equal(planRun({ nowMs: s4, flag: true }).daily, true);
  assert.equal(planRun({ nowMs: s5, state: { daily: { lastDate: '2026-07-06' }, weekly: { lastDate: '2026-07-06' } }, flag: true }).daily, false);
  // yaz saatine geçiş günü (29.3.2026, 01:00 UTC'de): 04:00 UTC = 06:00 Berlin
  assert.equal(planRun({ nowMs: Date.UTC(2026, 2, 29, 4, 0), flag: true }).daily, true);
  // bayrak kapalı → yok; öğleden sonra → yok; force → bayrak / saat / tarih fark etmez
  assert.equal(planRun({ nowMs: w5, flag: false }).daily, false);
  assert.equal(planRun({ nowMs: Date.UTC(2026, 10, 16, 12, 0), flag: true }).daily, false);
  const f = planRun({ nowMs: Date.UTC(2026, 10, 18, 15, 0), state: sent, flag: false, force: true });
  assert.deepEqual([f.daily, f.weekly, f.forced], [true, false, true]);
  const wk = planRun({ nowMs: Date.UTC(2026, 10, 18, 15, 0), weekly: true });
  assert.deepEqual([wk.daily, wk.weekly], [false, true]);
});

test('altın: hafta sonu, 25 Aralık / 1 Ocak ve bayat veride gönderilmez', () => {
  const sat = Date.UTC(2026, 10, 14, 5, 0), mon = Date.UTC(2026, 10, 16, 5, 0);
  assert.equal(goldOpen(sat, sat - 3600e3).open, false);
  assert.equal(goldOpen(Date.UTC(2026, 10, 15, 5, 0), Date.UTC(2026, 10, 15, 4, 0)).open, false);
  assert.equal(goldOpen(mon, mon - 3600e3).open, true);
  assert.equal(goldOpen(mon, mon - 10 * 3600e3).open, false);
  assert.equal(goldOpen(Date.UTC(2026, 11, 25, 5, 0), Date.UTC(2026, 11, 25, 4, 0)).open, false);
  assert.equal(goldOpen(Date.UTC(2027, 0, 1, 5, 0), Date.UTC(2027, 0, 1, 4, 0)).open, false);
});

test('hafta içi süzme ve haftalık mum (Pzt başlangıçlı; bitmemiş hafta canlı)', () => {
  const cs = series(21, (i) => 100 + i); // 6.1.2025 Pzt'den 3 hafta
  assert.equal(weekdaysOnly(cs).length, 15);
  const wk = weeklyOf(cs, T0 + 17 * DAY);
  assert.equal(wk.candles.length, 2); assert.equal(wk.candles[0].open, 100); assert.equal(wk.candles[0].close, 106);
  assert.equal(wk.live.time, T0 + 14 * DAY);
});

test('Türkçe biçim: binlik nokta, ondalık virgül, eksi işareti, ay ekleri', () => {
  assert.equal(fpx(96400.4), '96.400'); assert.equal(fpx(185.26), '185,3'); assert.equal(fpx(0.5), '0,50');
  assert.equal(fpct(-0.012), '−%1,2'); assert.equal(fpct(0.045), '+%4,5'); assert.equal(fpct(-0.0001), '+%0,0');
  assert.equal(fdelta(43.7), '44'); assert.equal(fdelta(2755.2), '2.755');
  const now = Date.UTC(2026, 10, 16);
  assert.equal(dateLoc(Date.UTC(2026, 9, 4), now), "4 Ekim'de");
  assert.equal(dateLoc(Date.UTC(2026, 2, 12), now), "12 Mart'ta");
  assert.equal(dateLoc(Date.UTC(2026, 8, 1), now), "1 Eylül'de");
  assert.equal(dateLoc(Date.UTC(2025, 9, 3), now), "3 Ekim 2025'te");
  assert.match(zoneLine({ kind: 'range', N: 23, lo: 94000, hi: 99000 }, now), /3 haftadır 94\.000–99\.000/);
  assert.match(zoneLine({ kind: 'range', N: 8, lo: 1, hi: 2 }, now, { unit: 'hafta' }), /8 haftadır/);
});

test('mesaj: gerçekçi seride günlük + haftalık metin, alt yazı sınırında (≤ 1000 görünür karakter), "dün" satırı', () => {
  const now = T0 + 400 * DAY + 5 * 3600e3;
  const mk = (amp, base) => series(400, (i) => base * (1 + 0.25 * Math.sin(i / 23) + 0.05 * Math.sin(i / 3.1) + i / 4000), { w: base * 0.01 });
  const build = (base) => { const cs = mk(0, base); return analyze({ daily: cs, live: { time: T0 + 400 * DAY, open: cs.at(-1).close, high: cs.at(-1).close * 1.01, low: cs.at(-1).close * 0.99, close: cs.at(-1).close * 1.002 }, price: cs.at(-1).close * 1.002, nowMs: now }); };
  const btc = build(90000), eth = build(3000), xau = build(3900);
  const prev = { bars: [btc.closed.at(-1)], watch: btc.d.watch.map((w) => ({ ...w, level: w.level })) };
  const p = buildAsset('BTC', btc, now, { prev, eth, weekly: true });
  const g = buildAsset('XAU', xau, now, { weekly: true });
  for (const t of [p.daily.text, p.weekly.text, g.daily.text, g.weekly.text]) {
    assert.ok(visibleLen(t) <= 1000, `uzun: ${visibleLen(t)}`);
    assert.match(t, /🔺 Direnç: .*\n🔻 Destek: /);
    assert.match(t, /👀 İzle: /);
    assert.doesNotMatch(t, /undefined|NaN/);
  }
  assert.match(p.daily.text, /↩️ Dün: /);
  assert.match(p.daily.text, /ETH|Ξ ETH/);
  assert.doesNotMatch(g.daily.text, /ETH/);
  assert.match(p.weekly.text, /📋 Geçen hafta: /);
  assert.match(p.daily.svg, /^<svg/); assert.match(p.weekly.svg, /Direnç/);
  // seviye adayları gösterge türevi içermez: yalnız tarih / dönem / yuvarlak sayı nedenleri
  const reasons = dailyCands(btc.closed, btc.d.price, btc.d.atr, now).map((c) => c.label).join('|');
  assert.doesNotMatch(reasons, /EMA|pivot|fib/i);
});
