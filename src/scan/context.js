// Tarama bağlamı: bir sembol + zaman dilimi için ortak ön hesaplar (tembel, memoize).
// Detektörler yalnızca bu nesneyi alır; aynı ATR/ZigZag/EMA her detektör için yeniden hesaplanmaz.
import { zigzag, fillAtr } from '../core/zigzag.js';
import * as I from '../data/indicators.js';
import { TIMEFRAMES } from '../data/okx.js';

export const CTX_DEFAULTS = {
  swingK: 2, // ana swing eşiği (× ATR)
  minorK: 1, // iç yapı / likidite için ince eşik
  majorK: 4, // ana trend için kaba eşik
};

const memo = (obj, key, fn) => {
  const store = obj.__memo || (obj.__memo = new Map());
  if (!store.has(key)) store.set(key, fn());
  return store.get(key);
};

/**
 * @param {{candles: object[], live?: object|null, tf: string, symbol?: string, opts?: object}} input
 */
export function makeContext({ candles, live = null, tf = '1H', symbol = '', opts = {} }) {
  const o = { ...CTX_DEFAULTS, ...opts };
  const n = candles.length;
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close), opens = candles.map((c) => c.open);
  const volumes = candles.map((c) => c.volume ?? 0);
  const atr = fillAtr(I.atr(highs, lows, closes, 14));
  const all = live ? [...candles, live] : candles;
  const last = n - 1;
  const ctx = {
    candles, live, all, tf, tfInfo: TIMEFRAMES[tf] || { id: tf, ms: 3600e3, rank: 3 }, symbol, opts: o,
    n, last, price: live?.close ?? closes[last],
    highs, lows, closes, opens, volumes, atr, atrNow: atr[last] || 0,
    /** ZigZag pivotları (k × ATR). */
    pivots(k = o.swingK) { return memo(ctx, `zz${k}`, () => zigzag(candles, atr, k)); },
    get swings() { return ctx.pivots(o.swingK).pivots; },
    get minor() { return ctx.pivots(o.minorK).pivots; },
    get major() { return ctx.pivots(o.majorK).pivots; },
    ema(p) { return memo(ctx, `ema${p}`, () => I.ema(closes, p)); },
    sma(p) { return memo(ctx, `sma${p}`, () => I.sma(closes, p)); },
    get rsi() { return memo(ctx, 'rsi', () => I.rsi(closes, 14)); },
    get macd() { return memo(ctx, 'macd', () => I.macd(closes)); },
    get bb() { return memo(ctx, 'bb', () => I.bollinger(closes, 20, 2)); },
    get keltner() { return memo(ctx, 'kc', () => I.keltner(highs, lows, closes, 20, 1.5)); },
    get donchian() { return memo(ctx, 'dc', () => I.donchian(highs, lows, 20)); },
    get obv() { return memo(ctx, 'obv', () => I.obv(closes, volumes)); },
    get adx() { return memo(ctx, 'adx', () => I.adx(highs, lows, closes, 14)); },
    get stoch() { return memo(ctx, 'stoch', () => I.stoch(highs, lows, closes)); },
    get stochRsi() { return memo(ctx, 'srsi', () => I.stochRsi(closes)); },
    get supertrend() { return memo(ctx, 'st', () => I.supertrend(highs, lows, closes, 10, 3)); },
    get ichimoku() { return memo(ctx, 'ichi', () => I.ichimoku(highs, lows)); },
    get vwap() { return memo(ctx, 'vwap', () => I.vwap(candles, ctx.tfInfo.ms < 86400e3 ? dayKey : null)); },
    get volumeProfile() { return memo(ctx, 'vp', () => I.volumeProfile(candles.slice(-Math.min(n, 300)), 40)); },
    get avgVolume() { return memo(ctx, 'avgvol', () => I.sma(volumes, 20)); },
    /** Son `bars` mumun gün anahtarına göre gruplanmış H/L. */
    get days() { return memo(ctx, 'days', () => groupBy(candles, dayKey)); },
    get weeks() { return memo(ctx, 'weeks', () => groupBy(candles, weekKey)); },
  };
  return ctx;
}

export const dayKey = (ms) => Math.floor(ms / 86400e3);
export const weekKey = (ms) => Math.floor((ms + 3 * 86400e3) / (7 * 86400e3)); // Pazartesi başlangıç

function groupBy(candles, keyOf) {
  const out = [];
  let cur = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], k = keyOf(c.time);
    if (!cur || cur.key !== k) { cur = { key: k, from: i, to: i, high: c.high, low: c.low, open: c.open, close: c.close }; out.push(cur); }
    else { cur.to = i; cur.close = c.close; if (c.high > cur.high) cur.high = c.high; if (c.low < cur.low) cur.low = c.low; }
  }
  return out;
}
