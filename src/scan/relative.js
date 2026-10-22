// BTC'ye göre göreli güç (ALT/BTC): coin kapanışı / BTC kapanışı oranı, zaman hizalı.
//   rs      : oranın son `lookback` bardaki % değişimi (+ → coin BTC'den hızlı yükseldi / yavaş düştü)
//   rsSide  : oran > EMA(emaLen)(oran) ? 1 : −1 (orta vadeli göreli eğilim)
//   rsSlope : oran EMA20'sinin son 5 bardaki % eğimi
// BTC satırının kendisi için null döner. Bar sayısı yetersizse null.
import { ema } from '../data/indicators.js';

export const RS_DEFAULTS = { lookback: 20, emaLen: 50 };

export function relativeStrength(candles, btcCandles, o = RS_DEFAULTS) {
  const p = { ...RS_DEFAULTS, ...o };
  if (!candles?.length || !btcCandles?.length) return null;
  const btc = new Map(btcCandles.map((c) => [c.time, c.close]));
  const ratio = [];
  for (const c of candles) { const b = btc.get(c.time); if (b > 0 && c.close > 0) ratio.push(c.close / b); }
  const n = ratio.length;
  if (n < p.lookback + 1) return null;
  const rs = +((ratio[n - 1] / ratio[n - 1 - p.lookback] - 1) * 100).toFixed(2);
  const e = n >= p.emaLen ? ema(ratio, p.emaLen) : null;
  const rsSide = e && e[n - 1] != null ? (ratio[n - 1] > e[n - 1] ? 1 : -1) : null;
  const e20 = n >= 25 ? ema(ratio, 20) : null;
  const rsSlope = e20 && e20[n - 1] != null && e20[n - 6] != null ? +((e20[n - 1] / e20[n - 6] - 1) * 100).toFixed(2) : null;
  return { rs, rsSide, rsSlope, bars: n };
}

/** Tarama satırlarına göreli gücü yazar (aynı TF'deki BTC satırından). rows yerinde değişir. */
export function attachRelativeStrength(rows, o = RS_DEFAULTS) {
  const btcByTf = new Map();
  for (const r of rows) if (r.coin === 'BTC' && !r.error && r.candles?.length) btcByTf.set(r.tf, r.live ? [...r.candles, r.live] : r.candles);
  for (const r of rows) {
    if (r.error) continue;
    r.trend = r.trend || {};
    if (r.coin === 'BTC') { r.trend.rsBtc = null; r.trend.rsSide = null; continue; }
    const btc = btcByTf.get(r.tf);
    const x = btc ? relativeStrength(r.live ? [...r.candles, r.live] : r.candles, btc, o) : null;
    r.trend.rsBtc = x ? x.rs : null; r.trend.rsSide = x ? x.rsSide : null; r.trend.rsSlope = x ? x.rsSlope : null;
  }
  return rows;
}
