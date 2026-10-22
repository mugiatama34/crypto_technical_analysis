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
export function horizonTrend(candles, { emaLen = 50, slopeBars = 10, adxMin = 20 } = {}) {
  if (!candles || candles.length < emaLen + slopeBars + 15) return null;
  const closes = candles.map((c) => c.close);
  const e = ema(closes, emaLen), n = candles.length - 1;
  const a = adx(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  if (e[n] == null || e[n - slopeBars] == null || a.adx[n] == null) return null;
  const side = closes[n] > e[n] ? 1 : -1;
  const slope = e[n] > e[n - slopeBars] ? 1 : e[n] < e[n - slopeBars] ? -1 : 0;
  const di = a.pdi[n] > a.mdi[n] ? 1 : a.pdi[n] < a.mdi[n] ? -1 : 0;
  const strong = a.adx[n] >= adxMin;
  const dir = side === slope && slope === di && strong ? side : 0;
  return { dir: dir === 1 ? 'up' : dir === -1 ? 'down' : 'flat', side, slope, di, adx: +a.adx[n].toFixed(1), close: closes[n], ema: +e[n].toPrecision(8) };
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
