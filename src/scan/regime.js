// Piyasa rejimi: BTC günlük kapanışı günlük EMA50'nin üstünde mi (yükseliş) / altında mı (düşüş).
// Yalnız verilen zamana kadar KAPANMIŞ günlere bakar (geleceğe bakmaz). Laboratuvar ve canlı bot ortak kullanır.
import { ema, adx } from '../data/indicators.js';

const DAY = 86400e3;

/** time anına kadar kapanmış son günün kapanışı ve EMA50'si; veri yetmezse null. */
export function dailyTrendAt(daily, time) {
  if (!daily || !daily.length) return null;
  if (!daily._e50) Object.defineProperty(daily, '_e50', { value: ema(daily.map((c) => c.close), 50), enumerable: false });
  let k = -1;
  for (let j = 0; j < daily.length; j++) { if (daily[j].time + DAY <= time) k = j; else break; }
  if (k < 0 || daily._e50[k] == null) return null;
  return { close: daily[k].close, ema50: daily._e50[k], up: daily[k].close > daily._e50[k], time: daily[k].time };
}

/** true: yükseliş rejimi; veri yoksa false. */
export const regimeUp = (daily, time) => dailyTrendAt(daily, time)?.up === true;

/** Canlı: 'up' | 'down' | null (veri yok). */
export function regimeNow(daily, now = Date.now()) {
  const t = dailyTrendAt(daily, now);
  return t ? (t.up ? 'up' : 'down') : null;
}

/**
 * Tek ufukta eğilim (kapanmış mumlar): kapanış vs EMA50, EMA50 eğimi (son slopeBars), ADX ≥ adxMin ve DI yönü.
 * Üçü aynı yöndeyse 'up'/'down'; eğim ile DI çelişirse ya da ADX zayıfsa 'flat'; veri yetersizse null.
 */
/** horizonTrendAt için ön-hesap: kapanışlar, EMA ve ADX bir kez (seri uzunsa her indeks için yeniden hesaplamamak için). */
export function horizonSeries(candles, { emaLen = 50 } = {}) {
  const closes = candles.map((c) => c.close);
  return { candles, closes, ema: ema(closes, emaLen), adx: adx(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14) };
}

/** Ön-hesaplı seride n indeksinde (o mum kapanmış sayılır) eğilim; horizonTrend ile aynı kural. */
export function horizonTrendAt(hs, n, { emaLen = 50, slopeBars = 10, adxMin = 20 } = {}) {
  if (!hs || n == null || n < emaLen + slopeBars + 14 || n >= hs.closes.length) return null;
  const { closes, ema: e, adx: a } = hs;
  if (e[n] == null || e[n - slopeBars] == null || a.adx[n] == null) return null;
  const side = closes[n] > e[n] ? 1 : -1;
  const slope = e[n] > e[n - slopeBars] ? 1 : e[n] < e[n - slopeBars] ? -1 : 0;
  const di = a.pdi[n] > a.mdi[n] ? 1 : a.pdi[n] < a.mdi[n] ? -1 : 0;
  const strong = a.adx[n] >= adxMin;
  const dir = side === slope && slope === di && strong ? side : 0;
  return { dir: dir === 1 ? 'up' : dir === -1 ? 'down' : 'flat', side, slope, di, adx: +a.adx[n].toFixed(1), close: closes[n], ema: +e[n].toPrecision(8) };
}

export function horizonTrend(candles, opts = {}) {
  const { emaLen = 50, slopeBars = 10 } = opts;
  if (!candles || candles.length < emaLen + slopeBars + 15) return null;
  return horizonTrendAt(horizonSeries(candles, opts), candles.length - 1, opts);
}

/** Üst zaman dilimi eşlemesi (coin'in kendi üst TF eğilimi için). */
export const UP_TF = { '5m': '15m', '15m': '1H', '1H': '4H', '4H': '1D' };

/**
 * Üst TF eğilimi, karar anında (decidedMs) kapanmış son üst TF mumuna göre; geleceğe bakmaz.
 * hs: horizonSeries(üst TF mumları); upMs: üst TF mum süresi. → 'up'|'down'|'flat'|null
 */
export function htfTrendAt(hs, upMs, decidedMs, opts) {
  if (!hs || !hs.candles.length) return null;
  const cs = hs.candles, limit = decidedMs - upMs; // mum kapanışı ≤ karar anı
  let lo = 0, hi = cs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time <= limit) { k = m; lo = m + 1; } else hi = m - 1; }
  const t = k >= 0 ? horizonTrendAt(hs, k, opts) : null;
  return t ? t.dir : null;
}

/** Filtre kuralı: 'with' → üst TF yönü işlem yönüyle aynı; 'notAgainst' → ters değil (yatay/bilinmiyor geçer). */
export function htfOk(mode, dir, d) {
  if (!mode) return true;
  const want = d === 1 ? 'up' : 'down', against = d === 1 ? 'down' : 'up';
  return mode === 'with' ? dir === want : dir !== against;
}

const retPct = (candles, bars) => { const n = candles.length - 1; return n - bars >= 0 ? +((candles[n].close / candles[n - bars].close - 1) * 100).toFixed(2) : null; };

/**
 * Çok ufuklu BTC piyasa okuması. daily/h4/h1: kapanmış mumlar (canlı mum hariç).
 * → { daily, h4, h1: 'up'|'down'|'flat'|null, ret4h, ret24h, adx4h, adx1h, summary }
 */
export function marketRead({ daily, h4, h1, now = Date.now() } = {}) {
  const d = dailyTrendAt(daily, now);
  const t4 = horizonTrend(h4), t1 = horizonTrend(h1);
  const read = {
    daily: d ? (d.up ? 'up' : 'down') : null,
    h4: t4 ? t4.dir : null, h1: t1 ? t1.dir : null,
    adx4h: t4 ? t4.adx : null, adx1h: t1 ? t1.adx : null,
    ret4h: h1?.length ? retPct(h1, 4) : (h4?.length ? retPct(h4, 1) : null),
    ret24h: h1?.length ? retPct(h1, 24) : (h4?.length ? retPct(h4, 6) : null),
  };
  const tr = (x) => (x === 'up' ? 'yükseliş' : x === 'down' ? 'düşüş' : x === 'flat' ? 'yatay' : 'bilinmiyor');
  read.summary = `BTC: günlük ${tr(read.daily)} · 4H ${tr(read.h4)}${read.adx4h != null ? ` (ADX ${read.adx4h})` : ''} · 1H ${tr(read.h1)}${read.ret4h != null ? ` · 4s ${read.ret4h > 0 ? '+' : ''}${read.ret4h}%` : ''}${read.ret24h != null ? ` · 24s ${read.ret24h > 0 ? '+' : ''}${read.ret24h}%` : ''}`;
  return read;
}

/** Bir sinyal TF'si için geçerli rejim: 15m/1H → 4H eğilimi (yatay/bilinmiyorsa null), 4H ve üstü → günlük. */
export function regimeFor(tf, read) {
  if (!read) return null;
  const x = tf === '4H' || tf === '1D' ? read.daily : read.h4;
  return x === 'up' || x === 'down' ? x : null;
}
