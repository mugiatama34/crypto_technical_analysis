// Arkadaşın SMC kuralı (laboratuvar): HTF likidite süpürmesi → alt yapıda ters yöne MSS (kapanışla son minör dip/tepe
// kırılır) → MSS bacağında FVG → FVG'nin %50'sine LİMİT → stop süpürme fitilinin ötesi → hedef karşı likidite (≥ 2R
// yoksa işlem yok). Üst dilim yönüne ters işlemde 0,5R (sizeMult). Likidite: swing pivot tepe/dipleri (süpürülmemiş),
// eşit tepe/dipler, önceki günün tepe/dibi (PDH/PDL). Tüm hesaplar i anına kadar kapanmış mumlarla (geleceğe bakmaz).
import * as I from '../../src/data/indicators.js';
import { zigzag, fillAtr, pivotsAsOf } from '../../src/core/zigzag.js';
import { equalLevels } from '../../src/detectors/liquidity.js';
import { horizonSeries, htfTrendAt, dailyTrendAt } from '../../src/scan/regime.js';
import { TIMEFRAMES } from '../../src/data/okx.js';

export const SMC_DEFAULTS = {
  minorK: 1, swingK: 2, eqTolAtr: 0.2, lookback: 150, fvgMinAtr: 0.2, stopPadAtr: 0.1, minRR: 2, maxRR: 6, closeTolAtr: 0.1,
  maxBars: { '15m': 24, '1H': 12, '4H': 6 }, // süpürmeden MSS'e en fazla mum
  levels: ['pivot', 'equal', 'pdhl'], htf: 'size', btc: null, // htf: 'size' (ters yönde 0,5R) | 'with' (yalnız yönde); btc: null | 'with'
  tp1R: null, // null: TP1 = karşı likidite; sayı: TP1 = entry ± tp1R × risk (likidite TP2'ye)
};

const r8 = (x) => +Number(x).toPrecision(8);

/** Önceki UTC günün tepe/dibi, her mum için (o günün mumları hariç). */
export function prevDayLevels(candles) {
  const pdh = new Array(candles.length).fill(null), pdl = new Array(candles.length).fill(null);
  let day = null, hi = -Infinity, lo = Infinity, prevHi = null, prevLo = null;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.floor(candles[i].time / 86400e3);
    if (d !== day) { if (day != null) { prevHi = hi; prevLo = lo; } day = d; hi = -Infinity; lo = Infinity; }
    pdh[i] = prevHi; pdl[i] = prevLo;
    hi = Math.max(hi, candles[i].high); lo = Math.min(lo, candles[i].low);
  }
  return { pdh, pdl };
}

/** i−1'e kadar onaylı likidite seviyeleri: { type:'H'|'L', level, src, i } (süpürülmüş pivotlar elenir). */
export function liquidityLevels(p, candles, i, o) {
  const out = [];
  const { pivots } = pivotsAsOf(p.zzSwing, candles, i - 1);
  const recent = pivots.filter((x) => i - 1 - x.i <= o.lookback);
  if (o.levels.includes('pivot')) {
    for (const x of recent) {
      let swept = false;
      for (let j = x.i + 1; j <= i - 1 && !swept; j++) if (x.type === 'H' ? candles[j].high > x.price : candles[j].low < x.price) swept = true;
      if (!swept) out.push({ type: x.type, level: x.price, src: 'pivot', i: x.i });
    }
  }
  if (o.levels.includes('equal')) for (const e of equalLevels(recent, p.atr, o.eqTolAtr)) out.push({ type: e.type, level: e.level, src: 'equal', i: e.to });
  if (o.levels.includes('pdhl')) { if (p.pdh[i] != null) out.push({ type: 'H', level: p.pdh[i], src: 'pdh', i }); if (p.pdl[i] != null) out.push({ type: 'L', level: p.pdl[i], src: 'pdl', i }); }
  return out;
}

/** Süpürmeden (sweepI) i'ye kadar olan bacakta d yönünde en son FVG: short için ayı FVG (high[j] < low[j−2]). */
export function fvgInLeg(candles, sweepI, i, d, minSize) {
  let best = null;
  for (let j = Math.max(2, sweepI + 1); j <= i; j++) {
    const a = candles[j - 2], b = candles[j];
    if (d === -1 && b.high < a.low && a.low - b.high >= minSize) best = { lo: b.high, hi: a.low, i: j };
    if (d === 1 && b.low > a.high && b.low - a.high >= minSize) best = { lo: a.high, hi: b.low, i: j };
  }
  return best;
}

export function makeSmc(id, label, over = {}) {
  const o = { ...SMC_DEFAULTS, ...over };
  return {
    id, label, tfs: ['15m', '1H', '4H'], exit: { tpScheme: 'half_be', maxHoldBars: 120 }, needs: ['upper', 'BTC1D', '1D'], o,
    prepare(candles, tf, extra = {}) {
      const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
      const atr = I.atr(highs, lows, closes, 14), filled = fillAtr(atr);
      const upper = extra.upper || (tf === '4H' ? extra.daily : null);
      return { tf, atr, zzMinor: zigzag(candles, filled, o.minorK), zzSwing: zigzag(candles, filled, o.swingK), ...prevDayLevels(candles), hs: upper && upper.length > 80 ? horizonSeries(upper) : null, upMs: TIMEFRAMES[{ '15m': '1H', '1H': '4H', '4H': '1D' }[tf]]?.ms || 0, btcDaily: extra.btcDaily || null, pending: null, seen: new Set() };
    },
    signal(i, candles, p) {
      if (i < 80) return null;
      const a = p.atr[i]; if (!a) return null;
      const c = candles[i];
      const maxBars = o.maxBars[p.tf] ?? 12;
      const levels = liquidityLevels(p, candles, i, o);
      // 1) Bu mumda süpürme var mı? (en yeni süpürme bekleyeni yeniler)
      // Süpürme = fitil seviyeyi geçer, kapanış seviyenin bu tarafında kalır (küçük pay); kapanışla geçiş kırılımdır, süpürme değil
      for (const lv of levels) {
        if (lv.type === 'H' && c.high > lv.level && c.close <= lv.level + o.closeTolAtr * a) p.pending = { d: -1, sweepI: i, wick: c.high, level: lv.level, src: lv.src };
        if (lv.type === 'L' && c.low < lv.level && c.close >= lv.level - o.closeTolAtr * a) p.pending = { d: 1, sweepI: i, wick: c.low, level: lv.level, src: lv.src };
      }
      const s = p.pending;
      if (!s || i === s.sweepI) return null;
      if (i - s.sweepI > maxBars) { p.pending = null; return null; }
      if (s.d === -1 && c.high > s.wick) { s.wick = c.high; } // süpürme fitili uzadı
      if (s.d === 1 && c.low < s.wick) { s.wick = c.low; }
      // 2) MSS: kapanış, son onaylı minör dip/tepeyi (i−1'e kadar) geçti mi?
      const { pivots: minor } = pivotsAsOf(p.zzMinor, candles, i - 1);
      const ref = [...minor].reverse().find((x) => x.type === (s.d === -1 ? 'L' : 'H') && x.i < i && i - x.i <= maxBars + 40);
      if (!ref) return null;
      const mss = s.d === -1 ? c.close < ref.price : c.close > ref.price;
      if (!mss) return null;
      // 3) Bacakta FVG → %50'si giriş
      const f = fvgInLeg(candles, s.sweepI, i, s.d, o.fvgMinAtr * a);
      if (!f) { p.pending = null; return null; }
      const entry = (f.lo + f.hi) / 2;
      const toZone = -s.d * (entry - c.close); // > 0: bölge fiyatın işlem yönünün ters tarafında (short için üstte) → limit konabilir
      if (toZone <= 0) { p.pending = null; return null; } // fiyat bölgeyi zaten geçmiş
      const stop = s.wick + (s.d === -1 ? 1 : -1) * o.stopPadAtr * a, risk = s.d * (entry - stop);
      if (!(risk > 0)) { p.pending = null; return null; }
      // 4) Hedef: karşı likidite ≥ minRR (≤ maxRR), yoksa işlem yok
      const rrOf = (lv) => (s.d * (lv.level - entry)) / risk; // işlem yönünde uzaklık (R)
      const opp = levels.filter((lv) => lv.type === (s.d === -1 ? 'L' : 'H') && rrOf(lv) >= o.minRR && rrOf(lv) <= o.maxRR).sort((x, y) => rrOf(x) - rrOf(y));
      if (!opp.length) { p.pending = null; return null; }
      const liq1 = opp[0].level, liq2 = opp[1]?.level ?? (entry + s.d * 4 * risk);
      const tp1 = o.tp1R ? entry + s.d * o.tp1R * risk : liq1, tp2 = o.tp1R ? liq1 : liq2;
      // 5) Yön bağlamı: üst dilim eğilimi (karar anı) ve BTC günlük rejimi
      const decided = c.time + (TIMEFRAMES[p.tf]?.ms || 0);
      const htf = p.hs ? htfTrendAt(p.hs, p.upMs, decided) : null;
      const want = s.d === 1 ? 'up' : 'down', against = s.d === 1 ? 'down' : 'up';
      if (o.htf === 'with' && htf !== want) { p.pending = null; return null; }
      const bt = p.btcDaily ? dailyTrendAt(p.btcDaily, c.time) : null;
      const btc = bt ? (bt.up ? 'up' : 'down') : null;
      if (o.btc === 'with' && btc !== want) { p.pending = null; return null; }
      const key = `${s.sweepI}`; if (p.seen.has(key)) return null; p.seen.add(key); p.pending = null;
      return { d: s.d, direction: s.d === 1 ? 'long' : 'short', entry: r8(entry), stop: r8(stop), tp1: r8(tp1), tp2: r8(tp2), inZone: false, atr: r8(a), price: c.close, zone: [r8(f.lo), r8(f.hi)], kind: 'sweep_mss_fvg', sweep: s.src, sizeMult: o.htf === 'size' && htf === against ? 0.5 : 1, htf, btc, rr1: +((s.d * (tp1 - entry)) / risk).toFixed(2) };
    },
  };
}

export const sweepMssFvg = makeSmc('sweep_mss_fvg', 'SMC: likidite süpürmesi → MSS → FVG %50 limit → karşı likidite (≥2R); üst dilime ters 0,5R');
export const sweepMssFvgHtf = makeSmc('sweep_mss_fvg_htf', 'SMC: yalnız üst dilim eğilimi yönünde', { htf: 'with' });
export const sweepMssFvgBtc = makeSmc('sweep_mss_fvg_btc', 'SMC: yalnız BTC günlük rejimi yönünde', { btc: 'with' });
export const sweepMssFvg1r = makeSmc('sweep_mss_fvg_1r', 'SMC: 1R\'de yarı + başabaş, kalan karşı likiditeye', { tp1R: 1 });
export const SMC_STRATEGIES = [sweepMssFvg, sweepMssFvgHtf, sweepMssFvgBtc, sweepMssFvg1r];
