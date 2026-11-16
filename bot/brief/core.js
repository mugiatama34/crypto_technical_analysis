// Sabah piyasa özeti (harita, tahmin değil): yön, beklenen oynama, en yakın destek / direnç bölgeleri, "bu bölge" ↔ aralık
// kararı, "İzle" koşulları ve bir önceki mesajın koşullarının takibi. Saf fonksiyonlar (ağ yok); bot/brief/run.mjs kullanır.
// Seviyeler yalnız fiyat verisinden: önceki gün / hafta / ay tepe-dipleri, tarihli belirgin dönüş noktaları, yuvarlak sayılar.
// Gösterge türevi seviye (EMA, pivot S1–S4, fib) yok. Yön tanımı src/scan/regime.js horizonTrend ile aynı kural.
import { atr } from '../../src/data/indicators.js';
import { horizonSeries, horizonTrendAt } from '../../src/scan/regime.js';

export const DAY = 86400e3;
export const WEEK = 7 * DAY;

// ---------------------------------------------------------------- seri yardımcıları

/** Yalnız hafta içi (UTC Pzt–Cum) günlük mumlar: altında hafta sonu spot piyasa kapalı, OKX vadelisinin hafta sonu oynaması atılır. */
export const weekdaysOnly = (cs) => cs.filter((c) => { const w = new Date(c.time).getUTCDay(); return w >= 1 && w <= 5; });

/** Mumun ait olduğu haftanın başı (Pazartesi 00:00 UTC). */
export function weekStart(t) {
  const d = new Date(t), dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY;
}

/** Günlük mumlardan haftalık mumlar (Pzt başlangıçlı, UTC). nowMs'e göre bitmemiş hafta `live` olarak ayrılır. */
export function weeklyOf(daily, nowMs) {
  const map = new Map();
  for (const c of daily) {
    const w = weekStart(c.time), b = map.get(w);
    if (!b) map.set(w, { time: w, open: c.open, high: c.high, low: c.low, close: c.close });
    else { b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low); b.close = c.close; }
  }
  const all = [...map.values()].sort((a, b) => a.time - b.time);
  const candles = all.filter((b) => b.time + WEEK <= nowMs), live = all.find((b) => b.time + WEEK > nowMs) || null;
  return { candles, live };
}

/** Son ATR14 (Wilder). */
export function atrLast(cs, period = 14) {
  if (!cs || cs.length < period + 1) return null;
  const a = atr(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), period);
  return a[a.length - 1];
}

/** Kapanış değişimi (oran): son kapanmış mum vs ondan `back` ms önceki (ya da daha eski) son mum. */
export function changeOver(closed, backMs) {
  if (closed.length < 2) return null;
  const last = closed[closed.length - 1];
  for (let i = closed.length - 2; i >= 0; i--) if (closed[i].time <= last.time - backMs) return last.close / closed[i].close - 1;
  return null;
}

// ---------------------------------------------------------------- yön

/**
 * Yön (betimleme): src/scan/regime.js horizonTrend kuralı — kapanış EMA50'nin üstünde, EMA50 son 10 mumda yükselmiş ve
 * ADX ≥ 20 ile +DI > −DI → 'up'; üçü de tersi → 'down'; aksi 'flat'. streak = aynı yönün sürdüğü kapanmış mum sayısı.
 */
export function directionOf(closed) {
  if (!closed || closed.length < 80) return null;
  const hs = horizonSeries(closed), n = closed.length - 1, d = horizonTrendAt(hs, n);
  if (!d) return null;
  let streak = 0;
  for (let k = n; k >= 0; k--) { const x = horizonTrendAt(hs, k); if (x?.dir === d.dir) streak++; else break; }
  return { dir: d.dir, streak };
}

// ---------------------------------------------------------------- seviye adayları

/** "Güzel" yuvarlak adım: {1; 2,5; 5} × 10^k içinden ≤ maxStep olan en büyüğü. */
export function niceStep(maxStep) {
  if (!(maxStep > 0)) return null;
  const mag = 10 ** Math.floor(Math.log10(maxStep));
  for (const m of [5, 2.5, 1]) if (m * mag <= maxStep) return m * mag;
  return mag / 2;
}

/** Fiyatın her iki yanında en yakın `n` yuvarlak sayı (adım ≈ 2 ATR'yi geçmeyen güzel sayı). */
export function roundCands(price, atrNow, n = 2) {
  const step = niceStep(2 * atrNow); if (!step) return [];
  const out = [], up0 = Math.ceil(price / step) * step, dn0 = Math.floor(price / step) * step;
  for (let k = 0; k < n; k++) {
    const u = up0 + k * step, d = dn0 - k * step;
    if (u !== price) out.push({ price: u, kind: 'round', label: 'yuvarlak sayı', prio: 9 });
    if (d !== price && d > 0) out.push({ price: d, kind: 'round', label: 'yuvarlak sayı', prio: 9 });
  }
  return out;
}

/**
 * Belirgin dönüş noktaları: tepe = önceki k mumdan yüksek ve sonraki k mumdan düşük olmayan; çevresindeki karşı uçtan en az
 * `prom` uzak (belirginlik). → [{ i, time, price, kind: 'high'|'low' }]
 */
export function swingPoints(cs, { k = 5, prom = 0, from = 0 } = {}) {
  const out = [];
  for (let i = Math.max(k, from); i < cs.length - k; i++) {
    let hi = true, lo = true, minL = Infinity, maxH = -Infinity;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const c = cs[j];
      if (j < i ? c.high >= cs[i].high : c.high > cs[i].high) hi = false;
      if (j < i ? c.low <= cs[i].low : c.low < cs[i].low) lo = false;
      minL = Math.min(minL, c.low); maxH = Math.max(maxH, c.high);
    }
    if (hi && cs[i].high - minL >= prom) out.push({ i, time: cs[i].time, price: cs[i].high, kind: 'high' });
    if (lo && maxH - cs[i].low >= prom) out.push({ i, time: cs[i].time, price: cs[i].low, kind: 'low' });
  }
  return out;
}

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const ofKind = (kind) => (kind === 'high' ? 'tepesi' : 'dibi');

/** Tarih adı: son 6 gün içindeyse gün adı ("Perşembe"), değilse "30 Ekim" (başka yılsa "30 Ekim 2025"). */
export function dayName(t, nowMs) {
  const d = new Date(t), today = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  const ago = Math.round((today - t) / DAY);
  if (ago === 1) return 'dün';
  if (ago >= 2 && ago <= 6) return DAYS[d.getUTCDay()];
  const y = d.getUTCFullYear() !== new Date(nowMs).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y}`;
}

/** Önceki takvim ayının (UTC) tepe / dibi → { name, high, low, highT, lowT } ya da null. */
export function prevMonthHL(closed, nowMs) {
  const n = new Date(nowMs), m0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1), m1 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1);
  const cs = closed.filter((c) => c.time >= m1 && c.time < m0);
  if (cs.length < 10) return null;
  let h = cs[0], l = cs[0];
  for (const c of cs) { if (c.high > h.high) h = c; if (c.low < l.low) l = c; }
  return { name: MONTHS[new Date(m1).getUTCMonth()], high: h.high, low: l.low, highT: h.time, lowT: l.time };
}

/**
 * Günlük mesajın aday seviyeleri. closed: kapanmış günlük mumlar; price: şimdiki fiyat; nowMs: şimdi.
 * Öncelik (küçük = önce yazılır): önceki gün 1 · geçen hafta 2 · geçen ay 3 · dönüş noktası 4 · yuvarlak sayı 9.
 */
export function dailyCands(closed, price, atrNow, nowMs, { swingDays = 180, k = 5 } = {}) {
  const out = [], last = closed[closed.length - 1];
  if (!last) return out;
  const dn = dayName(last.time, nowMs), dl = dn === 'dün' ? 'dünün' : dn;
  out.push({ price: last.high, kind: 'high', label: `${dl} tepesi`, prio: 1, time: last.time });
  out.push({ price: last.low, kind: 'low', label: `${dl} dibi`, prio: 1, time: last.time });
  const wk = weeklyOf(closed, weekStart(nowMs)).candles, pw = wk[wk.length - 1];
  if (pw && pw.time === weekStart(nowMs) - WEEK) {
    const days = closed.filter((c) => c.time >= pw.time && c.time < pw.time + WEEK);
    const h = days.reduce((a, c) => (c.high > a.high ? c : a)), l = days.reduce((a, c) => (c.low < a.low ? c : a));
    out.push({ price: pw.high, kind: 'high', label: 'geçen haftanın tepesi', prio: 2, time: h.time });
    out.push({ price: pw.low, kind: 'low', label: 'geçen haftanın dibi', prio: 2, time: l.time });
  }
  const pm = prevMonthHL(closed, nowMs);
  if (pm) {
    out.push({ price: pm.high, kind: 'high', label: `${pm.name} tepesi`, prio: 3, time: pm.highT });
    out.push({ price: pm.low, kind: 'low', label: `${pm.name} dibi`, prio: 3, time: pm.lowT });
  }
  const from = Math.max(0, closed.length - swingDays);
  for (const s of swingPoints(closed, { k, prom: atrNow, from })) out.push({ price: s.price, kind: s.kind, label: `${dayName(s.time, nowMs)} ${ofKind(s.kind)}`, prio: 4, time: s.time });
  out.push(...roundCands(price, atrNow));
  return out;
}

/** Haftalık mesajın aday seviyeleri: geçen hafta 1 · geçen ay 2 · haftalık dönüş noktası (2 yıl) 4 · yuvarlak sayı 9. */
export function weeklyCands(wClosed, dClosed, price, atrW, nowMs, { swingWeeks = 104, k = 3 } = {}) {
  const out = [], pw = wClosed[wClosed.length - 1];
  if (pw) {
    out.push({ price: pw.high, kind: 'high', label: 'geçen haftanın tepesi', prio: 1, time: pw.time, week: true });
    out.push({ price: pw.low, kind: 'low', label: 'geçen haftanın dibi', prio: 1, time: pw.time, week: true });
  }
  const pm = prevMonthHL(dClosed, nowMs);
  if (pm) {
    out.push({ price: pm.high, kind: 'high', label: `${pm.name} tepesi`, prio: 2, time: pm.highT });
    out.push({ price: pm.low, kind: 'low', label: `${pm.name} dibi`, prio: 2, time: pm.lowT });
  }
  const from = Math.max(0, wClosed.length - swingWeeks), yNow = new Date(nowMs).getUTCFullYear();
  for (const s of swingPoints(wClosed, { k, prom: atrW, from })) {
    // haftanın içinde uç değerin görüldüğü gün (etiket "12 Mart 2026 tepesi")
    const day = dClosed.find((c) => c.time >= s.time && c.time < s.time + WEEK && (s.kind === 'high' ? c.high === s.price : c.low === s.price));
    const d = new Date(day ? day.time : s.time), y = d.getUTCFullYear() !== yNow ? ` ${d.getUTCFullYear()}` : '';
    out.push({ price: s.price, kind: s.kind, label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y} ${ofKind(s.kind)}`, prio: 4, time: day ? day.time : s.time });
  }
  out.push(...roundCands(price, atrW));
  return out;
}

// ---------------------------------------------------------------- birleştirme ve seçim

/**
 * Adayları tarafa ayırır (fiyatın üstü direnç, altı destek), her tarafta fiyattan uzağa doğru birleştirir (komşu adaylar
 * arası ≤ tol, bölge genişliği ≤ 2·tol; tol = 0,25 ATR) ve fiyata en yakın `n` direnç ile `n` desteği seçer. Bölge nedenleri öncelik sırasıyla, en fazla 2 ve tekrarsız.
 * → { res: Zone[], sup: Zone[] }, Zone = { lo, hi, mid, reasons: string[] }
 */
export function pickLevels(cands, price, atrNow, { n = 2, tolK = 0.25 } = {}) {
  const tol = tolK * atrNow, ok = cands.filter((c) => Number.isFinite(c.price) && c.price > 0 && c.price !== price);
  // önce taraf (fiyatın üstü direnç, altı destek), sonra her tarafta birleştir → bölge fiyatı hiç içine almaz
  const side = (arr, asc) => {
    const cs = [...arr].sort((a, b) => (asc ? a.price - b.price : b.price - a.price)), zones = [];
    for (const c of cs) {
      const z = zones[zones.length - 1], d = (p) => Math.abs(c.price - p);
      if (z && d(z.far) <= tol && d(z.near) <= 2 * tol) { z.far = c.price; z.items.push(c); } else zones.push({ near: c.price, far: c.price, items: [c] });
    }
    return zones.slice(0, n).map((z) => {
      const seen = new Set(), reasons = [];
      for (const it of [...z.items].sort((a, b) => a.prio - b.prio)) {
        const key = it.time != null ? `${it.kind}:${it.time}` : it.label; // aynı mumun uç değeri iki adla gelmesin
        if (seen.has(key) || reasons.includes(it.label)) continue;
        seen.add(key); reasons.push(it.label);
      }
      const lo = Math.min(z.near, z.far), hi = Math.max(z.near, z.far);
      return { lo, hi, mid: (lo + hi) / 2, reasons: reasons.slice(0, 2) };
    });
  };
  return { res: side(ok.filter((c) => c.price > price), true), sup: side(ok.filter((c) => c.price < price), false) };
}

// ---------------------------------------------------------------- "bu bölge" ↔ aralık

/**
 * Hangi satır? (betimleme; ölçüt README'de)
 *  1) Salınım: son kapanmış mumlardan geriye doğru, kapanışların (bugünkü fiyat dahil) yayılımı ≤ spanK·ATR kaldığı sürece
 *     pencere büyür; uzunluk N ≥ minRange ise → { kind: 'range', N, lo, hi } (lo/hi = pencerenin fitil uçları).
 *  2) Yeni bölge: değilse (fiyat yakın zamanda sıkışık bir banttan çıkmış), pencerenin gerisinde aralığı (dip–tepe) bugünkü
 *     fiyatı içeren en yakın mum aranır. ≥ gapMin mum önceyse → { kind: 'zone', bar, ago, fwd } (fwd = o mumun kapanışından
 *     `fwdMs` sonraki kapanışa değişim; tek örnek). Veride hiç yoksa → { kind: 'zone', never: true, since }.
 *  3) İkisi de değilse → { kind: 'window', lo, hi, pos } (son `win` mumun aralığı ve fiyatın konumu).
 */
export function zoneOrRange(closed, price, atrNow, { minRange = 10, spanK = 3, gapMin = 20, fwdMs = 7 * DAY, win = 20 } = {}) {
  const n = closed.length;
  if (!n || !(atrNow > 0)) return null;
  let mn = price, mx = price, N = 0;
  for (let i = n - 1; i >= 0; i--) {
    const c = closed[i].close, a = Math.min(mn, c), b = Math.max(mx, c);
    if (b - a > spanK * atrNow) break;
    mn = a; mx = b; N++;
  }
  if (N >= minRange) {
    const w = closed.slice(n - N);
    return { kind: 'range', N, lo: Math.min(...w.map((c) => c.low)), hi: Math.max(...w.map((c) => c.high)) };
  }
  let found = -1;
  for (let i = n - 1 - N; i >= 0; i--) if (closed[i].low <= price && price <= closed[i].high) { found = i; break; }
  if (found < 0) return { kind: 'zone', never: true, since: closed[0].time };
  const ago = n - 1 - found;
  if (ago >= gapMin) {
    const bar = closed[found], later = closed.find((c) => c.time >= bar.time + fwdMs);
    return { kind: 'zone', bar, ago, fwd: later ? later.close / bar.close - 1 : null };
  }
  const w = closed.slice(-win), lo = Math.min(...w.map((c) => c.low)), hi = Math.max(...w.map((c) => c.high));
  return { kind: 'window', lo, hi, pos: hi > lo ? (price - lo) / (hi - lo) : 0.5, n: w.length };
}

// ---------------------------------------------------------------- İzle / takip

/** En yakın destek / direncin kapanışla kırılması koşulları (yön tahmini yok). → [{ side, level, next }] */
export function watchOf({ res, sup }) {
  const out = [];
  if (sup[0]) out.push({ side: 'down', level: sup[0].lo, next: sup[1] ? { lo: sup[1].lo, hi: sup[1].hi } : null });
  if (res[0]) out.push({ side: 'up', level: res[0].hi, next: res[1] ? { lo: res[1].lo, hi: res[1].hi } : null });
  return out;
}

/**
 * Önceki mesajın İzle koşulları gerçekleşti mi? bars: o mesajdan sonra kapanan mumlar (sırayla).
 * → [{ side, level, hit, close, ext (fitil uç), touched }] ; bars boşsa null.
 */
export function evalWatch(watch, bars) {
  if (!watch?.length || !bars?.length) return null;
  const hiAll = Math.max(...bars.map((b) => b.high)), loAll = Math.min(...bars.map((b) => b.low)), close = bars[bars.length - 1].close;
  return watch.map((w) => {
    const hitBar = bars.find((b) => (w.side === 'down' ? b.close < w.level : b.close > w.level));
    const ext = w.side === 'down' ? loAll : hiAll;
    return { side: w.side, level: w.level, hit: !!hitBar, hitClose: hitBar?.close ?? null, close, ext, touched: w.side === 'down' ? loAll < w.level : hiAll > w.level };
  });
}

/**
 * Haftalık özet için seviyelerin geçen haftaki durumu: direnç 'kırıldı' (kapanış üstünde) / 'tuttu' (fitil bölgeye girdi,
 * kapanış altında) / null (uğranmadı); destek simetrik.
 */
export function levelOutcome(zone, side, bar) {
  if (side === 'res') return bar.close > zone.hi ? 'kırıldı' : bar.high >= zone.lo ? 'tuttu' : null;
  return bar.close < zone.lo ? 'kırıldı' : bar.low <= zone.hi ? 'tuttu' : null;
}

// ---------------------------------------------------------------- ETH ayrışması

/** ETH BTC'den ayrışıyor mu: günlük yön farklı ya da son günlük getiri farkı ≥ diffPp yüzde puan. */
export function diverges(btc, eth, { diffPp = 2 } = {}) {
  if (!btc || !eth) return false;
  if (btc.dir && eth.dir && btc.dir !== eth.dir) return true;
  return Number.isFinite(btc.ret1) && Number.isFinite(eth.ret1) && Math.abs(eth.ret1 - btc.ret1) * 100 >= diffPp;
}

// ---------------------------------------------------------------- tek varlık analizi

/**
 * Bir varlığın günlük ve haftalık haritası. daily: kapanmış günlük mumlar (altında yalnız hafta içi), live: bugünün mumu,
 * price: şimdiki fiyat, nowMs: şimdi.
 */
export function analyze({ daily, live, price, nowMs }) {
  const closed = daily, atrD = atrLast(closed);
  const wk = weeklyOf(live ? [...closed, live] : closed, nowMs), wClosed = wk.candles, atrW = atrLast(wClosed);
  const last = closed[closed.length - 1];
  const d = {
    price, atr: atrD, last,
    ret1: closed.length > 1 ? last.close / closed[closed.length - 2].close - 1 : null,
    ret7: changeOver(closed, 7 * DAY),
    dir: directionOf(closed), dirW: directionOf(wClosed),
  };
  d.levels = pickLevels(dailyCands(closed, price, atrD, nowMs), price, atrD);
  d.watch = watchOf(d.levels);
  d.zone = zoneOrRange(closed, price, atrD);
  const w = {
    price, atr: atrW, last: wClosed[wClosed.length - 1],
    ret1: wClosed.length > 1 ? wClosed[wClosed.length - 1].close / wClosed[wClosed.length - 2].close - 1 : null,
    ret4: wClosed.length > 4 ? wClosed[wClosed.length - 1].close / wClosed[wClosed.length - 5].close - 1 : null,
    dir: d.dirW, dirD: d.dir,
  };
  w.levels = atrW ? pickLevels(weeklyCands(wClosed, closed, price, atrW, nowMs), price, atrW) : { res: [], sup: [] };
  w.watch = watchOf(w.levels);
  w.zone = atrW ? zoneOrRange(wClosed, price, atrW, { minRange: 6, spanK: 2, gapMin: 12, fwdMs: 28 * DAY, win: 12 }) : null;
  // geçen haftanın özeti: geçen haftanın başında (aynı kuralla) çizilecek seviyeler, geçen haftanın mumuyla değerlendirilir
  const lw = w.last;
  if (lw && wClosed.length > 20) {
    const wPrev = wClosed.slice(0, -1), dPrev = closed.filter((c) => c.time < lw.time), aPrev = atrLast(wPrev);
    if (aPrev) {
      const lv = pickLevels(weeklyCands(wPrev, dPrev, lw.open, aPrev, lw.time), lw.open, aPrev);
      w.review = {
        bar: lw,
        items: [...lv.res.map((z) => ({ z, side: 'res' })), ...lv.sup.map((z) => ({ z, side: 'sup' }))].map((x) => ({ ...x, out: levelOutcome(x.z, x.side, lw) })),
      };
    }
  }
  return { d, w, closed, wClosed, live, wLive: wk.live };
}
