// Range sapması (deviation) ailesi (laboratuvar) — kullanıcının arkadaşının PA yöntemi: yatay bant (son W mumun tepe/dibi,
// genişlik 1,5–6 ATR, fiyat bant ortasını ≥ 2 kez geçmiş) → kenarın fitille geçilip (≤ 1 ATR) kapanışın bant içine dönmesi
// → karşı kenara oyna. Long: dip süpürülür; short: tepe süpürülür. TP1 = bant ortası (0,5), TP2 = karşı kenar; stop süpürme
// ucunun 0,1 ATR ötesi. Giriş: 'close' = geri dönüş mumunun kapanışı (piyasa) · 'edge' = kenarın geri testi (limit).
// Seçenekler: htf ('with' = günlük trend yönünde), minRR (TP2 ≥ bu × risk). Tüm hesaplar i anına kadar kapanmış mumlarla.
import * as I from '../../src/data/indicators.js';
import { dailyTrendAt } from '../../src/scan/regime.js';

export const RANGE_DEFAULTS = { win: 36, lag: 3, minWidthAtr: 1.5, maxWidthAtr: 6, minCross: 2, maxDevAtr: 1, stopPadAtr: 0.1, entry: 'close', minRR: 1.5, htf: null };
const r8 = (x) => +Number(x).toPrecision(8);

/** i anında bant: [i−lag−win+1, i−lag] mumlarının tepe/dibi. Ölçütleri geçmezse null. */
export function rangeAt(candles, atr, i, o = RANGE_DEFAULTS) {
  const to = i - o.lag, from = to - o.win + 1;
  if (from < 0 || atr[i] == null) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = from; j <= to; j++) { if (candles[j].high > hi) hi = candles[j].high; if (candles[j].low < lo) lo = candles[j].low; }
  const w = hi - lo, a = atr[i];
  if (w < o.minWidthAtr * a || w > o.maxWidthAtr * a) return null;
  const mid = (hi + lo) / 2;
  let cross = 0;
  for (let j = from + 1; j <= to; j++) if ((candles[j - 1].close - mid) * (candles[j].close - mid) < 0) cross++;
  if (cross < o.minCross) return null;
  return { hi, lo, mid, from, to };
}

/** Son `lag` mumda kenar sapması + i mumunda bant içine kapanış → { d, ext } | null. */
export function deviationAt(candles, atr, i, rg, o = RANGE_DEFAULTS) {
  const c = candles[i], a = atr[i];
  let lowX = Infinity, highX = -Infinity;
  for (let j = rg.to + 1; j <= i; j++) { if (candles[j].low < lowX) lowX = candles[j].low; if (candles[j].high > highX) highX = candles[j].high; }
  const dnDev = lowX < rg.lo && rg.lo - lowX <= o.maxDevAtr * a, upDev = highX > rg.hi && highX - rg.hi <= o.maxDevAtr * a;
  if (dnDev && !upDev && c.close > rg.lo && c.close < rg.mid) return { d: 1, ext: lowX };
  if (upDev && !dnDev && c.close < rg.hi && c.close > rg.mid) return { d: -1, ext: highX };
  return null;
}

export function makeRange(id, label, over = {}) {
  const o = { ...RANGE_DEFAULTS, ...over };
  return {
    id, label, tfs: ['15m', '1H', '4H'], exit: { tpScheme: 'half_be', maxHoldBars: 3 * o.win }, needs: o.htf ? ['1D'] : [], o,
    prepare(candles, tf, extra = {}) {
      const atr = I.atr(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14);
      return { atr, daily: extra.daily || null, seen: new Set() };
    },
    signal(i, candles, p) {
      if (i < o.win + o.lag + 15) return null;
      const rg = rangeAt(candles, p.atr, i, o); if (!rg) return null;
      const dv = deviationAt(candles, p.atr, i, rg, o); if (!dv) return null;
      const key = `${dv.d}:${r8(rg.lo)}:${r8(rg.hi)}`; if (p.seen.has(key)) return null;
      if (o.htf === 'with') { const t = p.daily && dailyTrendAt(p.daily, candles[i].time); if (!t || (t.up ? 1 : -1) !== dv.d) return null; }
      const a = p.atr[i], d = dv.d, c = candles[i];
      const stop = dv.ext - d * o.stopPadAtr * a;
      const entry = o.entry === 'edge' ? (d === 1 ? rg.lo : rg.hi) : c.close;
      const tp2 = d === 1 ? rg.hi : rg.lo, risk = d * (entry - stop);
      if (risk <= 0 || d * (tp2 - entry) < o.minRR * risk) return null;
      p.seen.add(key);
      return { d, direction: d === 1 ? 'long' : 'short', entry: r8(entry), stop: r8(stop), tp1: r8(rg.mid), tp2: r8(tp2), inZone: o.entry !== 'edge', atr: r8(a), price: r8(c.close) };
    },
  };
}

export const RANGE_STRATEGIES = [
  makeRange('range_dev', 'Range sapması → karşı kenar (kapanışta giriş, TP1 orta, TP2 karşı kenar)'),
  makeRange('range_dev_edge', 'Range sapması → karşı kenar (kenarın geri testinde limit giriş)', { entry: 'edge' }),
  makeRange('range_dev_htf', 'Range sapması + günlük trend yönünde', { htf: 'with' }),
  makeRange('range_dev_wide', 'Range sapması, geniş bant (60 mum, 2–8 ATR)', { win: 60, minWidthAtr: 2, maxWidthAtr: 8 }),
];
