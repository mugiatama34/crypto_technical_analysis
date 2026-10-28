// Klasik (dönüş) uyumsuzluk ailesi (laboratuvar): son iki onaylı swing dibi/tepesi arasında fiyat yeni uç yapar, RSI
// (ve isteğe bağlı MACD histogramı) yapmaz. Tetik: 'pivot' = ikinci uç ZigZag ile onaylandığı mumun kapanışı;
// 'mss' = ikinci uçtan önceki son minör tepe/dip kapanışla kırılınca. Stop ikinci ucun 0,2 ATR ötesi; TP1 1,5R,
// TP2 boyun (iki uç arasındaki tepe/dip) ≥ 2,5R ise boyun, değilse 3R. Tüm hesaplar i anına kadar kapanmış mumlarla.
import * as I from '../../src/data/indicators.js';
import { zigzag, fillAtr, pivotsAsOf } from '../../src/core/zigzag.js';
import { dailyTrendAt } from '../../src/scan/regime.js';

export const DIV_LAB_DEFAULTS = {
  swingK: 2, minorK: 1, minSpan: 5, maxSpan: 60, minRsiDiff: 2, trigger: 'mss', maxWait: 20,
  macd: false, // true: MACD histogramı da aynı yönde uyumsuz olmalı
  ext: false, // true: ilk uçta RSI ≤ 35 (short ≥ 65) ve ikinci uç son 100 mumun en uç değeri
  btc: null, // 'with': yalnız BTC günlük rejimi işlem yönündeyken
  stopPadAtr: 0.2, minRiskAtr: 0.3, maxRiskAtr: 4,
};

const r8 = (x) => +Number(x).toPrecision(8);

/** Pivot civarındaki (±2 mum, en fazla `upto`) gösterge uç değeri. */
export function indAt(arr, i, type, upto) {
  let best = null;
  for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2, upto); j++) {
    const v = arr[j];
    if (v == null) continue;
    if (best == null || (type === 'H' ? v > best : v < best)) best = v;
  }
  return best;
}

/**
 * Son iki aynı tip pivotta klasik uyumsuzluk. d = 1: dipler (fiyat LL, gösterge HL); d = −1: tepeler (fiyat HH, gösterge LH).
 * → { p1, p2, neck, v1, v2 } | null. pivots: onaylı pivot listesi (eskiden yeniye).
 */
export function regularDiv(pivots, ind, d, upto, o = DIV_LAB_DEFAULTS) {
  const type = d === 1 ? 'L' : 'H';
  const same = pivots.filter((p) => p.type === type);
  if (same.length < 2) return null;
  const p2 = same[same.length - 1], p1 = same[same.length - 2];
  const span = p2.i - p1.i;
  if (span < o.minSpan || span > o.maxSpan) return null;
  const v1 = indAt(ind, p1.i, type, upto), v2 = indAt(ind, p2.i, type, upto);
  if (v1 == null || v2 == null) return null;
  const priceNew = d === 1 ? p2.price < p1.price : p2.price > p1.price;
  const indNot = d === 1 ? v2 > v1 + (o.minRsiDiff ?? 0) : v2 < v1 - (o.minRsiDiff ?? 0);
  if (!priceNew || !indNot) return null;
  const between = pivots.filter((p) => p.type !== type && p.i > p1.i && p.i < p2.i);
  const neck = between.length ? (d === 1 ? Math.max(...between.map((p) => p.price)) : Math.min(...between.map((p) => p.price))) : null;
  return { p1, p2, neck, v1, v2 };
}

export function makeDiv(id, label, over = {}) {
  const o = { ...DIV_LAB_DEFAULTS, ...over };
  return {
    id, label, tfs: ['1H', '4H', '1D'], exit: { tpScheme: 'half_be', maxHoldBars: 60 }, needs: o.btc ? ['BTC1D'] : [], o,
    prepare(candles, tf, extra = {}) {
      const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
      const atr = I.atr(highs, lows, closes, 14), filled = fillAtr(atr);
      return { tf, atr, rsi: I.rsi(closes, 14), hist: I.macd(closes).hist, zzSwing: zigzag(candles, filled, o.swingK), zzMinor: zigzag(candles, filled, o.minorK), btcDaily: extra.btcDaily || null, seen: new Set() };
    },
    signal(i, candles, p) {
      if (i < 60) return null;
      const a = p.atr[i]; if (!a) return null;
      const c = candles[i];
      const { pivots } = pivotsAsOf(p.zzSwing, candles, i);
      for (const d of [1, -1]) {
        const dv = regularDiv(pivots, p.rsi, d, i, o);
        if (!dv) continue;
        const { p2 } = dv;
        if (p.seen.has(`${d}:${p2.i}`)) continue;
        const at = p2.at ?? p2.i;
        if (i - at > o.maxWait) continue;
        if (o.macd) { const m1 = indAt(p.hist, dv.p1.i, p2.type, i), m2 = indAt(p.hist, p2.i, p2.type, i); if (m1 == null || m2 == null || !(d === 1 ? m2 > m1 : m2 < m1)) continue; }
        if (o.ext) {
          if (d === 1 ? dv.v1 > 35 : dv.v1 < 65) continue;
          const win = candles.slice(Math.max(0, p2.i - 100), p2.i + 1);
          if (d === 1 ? Math.min(...win.map((x) => x.low)) < p2.price : Math.max(...win.map((x) => x.high)) > p2.price) continue;
        }
        // Tetik
        if (o.trigger === 'pivot') { if (i !== at) continue; }
        else {
          const { pivots: minor } = pivotsAsOf(p.zzMinor, candles, i - 1);
          const ref = [...minor].reverse().find((x) => x.type === (d === 1 ? 'H' : 'L') && x.i < p2.i);
          if (!ref) continue;
          if (!(d === 1 ? c.close > ref.price : c.close < ref.price)) continue;
          // önceki mum zaten kırmışsa bu taze kırılım değil
          if (d === 1 ? candles[i - 1].close > ref.price : candles[i - 1].close < ref.price) { p.seen.add(`${d}:${p2.i}`); continue; }
        }
        // İkinci uç bu mumda aşıldıysa uyumsuzluk bozuldu
        if (d === 1 ? c.low < p2.price : c.high > p2.price) { p.seen.add(`${d}:${p2.i}`); continue; }
        if (o.btc === 'with' && p.btcDaily) { const bt = dailyTrendAt(p.btcDaily, c.time); if (!bt || (bt.up ? 1 : -1) !== d) continue; }
        const stop = p2.price - d * o.stopPadAtr * a, risk = d * (c.close - stop);
        if (!(risk >= o.minRiskAtr * a && risk <= o.maxRiskAtr * a)) { p.seen.add(`${d}:${p2.i}`); continue; }
        const tp1 = c.close + d * 1.5 * risk;
        const tp2 = dv.neck != null && d * (dv.neck - c.close) >= 2.5 * risk ? dv.neck : c.close + d * 3 * risk;
        p.seen.add(`${d}:${p2.i}`);
        return { d, direction: d === 1 ? 'long' : 'short', entry: r8(c.close), stop: r8(stop), tp1: r8(tp1), tp2: r8(tp2), inZone: true, atr: r8(a), price: c.close, kind: 'divergence', rsi1: +dv.v1.toFixed(1), rsi2: +dv.v2.toFixed(1) };
      }
      return null;
    },
  };
}

export const divRsiPivot = makeDiv('div_rsi_pivot', 'Klasik RSI uyumsuzluğu, ikinci uç onaylanınca giriş', { trigger: 'pivot' });
export const divRsiMss = makeDiv('div_rsi_mss', 'Klasik RSI uyumsuzluğu + son minör tepe/dip kırılımı (MSS) ile giriş');
export const divRsiMssExt = makeDiv('div_rsi_mss_ext', 'RSI uyumsuzluğu + MSS, ilk uç aşırı bölgede (≤35/≥65) ve ikinci uç 100 mumun ucu', { ext: true });
export const divRsiMacdMss = makeDiv('div_rsimacd_mss', 'RSI + MACD histogramı birlikte uyumsuz + MSS', { macd: true });
export const divRsiMssBtc = makeDiv('div_rsi_mss_btc', 'RSI uyumsuzluğu + MSS, yalnız BTC günlük rejimi yönünde', { btc: 'with' });
export const DIV_STRATEGIES = [divRsiPivot, divRsiMss, divRsiMssExt, divRsiMacdMss, divRsiMssBtc];
