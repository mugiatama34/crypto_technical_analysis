// Fair Value Gap (FVG / imbalance): üç mumlu boşluk. Yükseliş FVG: low[i] > high[i−2]; düşüş FVG: high[i] < low[i−2].
// Boşluğun sonraki mumlarla dolma durumu izlenir; tamamen geçilen (kapanış ters tarafta) FVG 'inversion' (iFVG) olur.
import { signal } from '../core/signal.js';

export const FVG_DEFAULTS = {
  minAtr: 0.15, // boşluk ≥ bu × ATR
  maxAge: 120, // bu kadar mumdan eski boşluklar taranmaz
  keep: 4, // yön başına döndürülecek en fazla açık FVG
};

/**
 * Tüm FVG'leri bulur ve durumlarını hesaplar.
 * @returns {{i, dir:1|-1, lo, hi, size, filled:0..1, status:'open'|'partial'|'filled'|'inverted', mitigatedAt}[]}
 */
export function findFvgs(ctx, o = FVG_DEFAULTS) {
  const { highs, lows, closes, atr, last } = ctx;
  const out = [];
  const from = Math.max(2, last - o.maxAge);
  for (let i = from; i <= last; i++) {
    let dir = 0, lo, hi;
    if (lows[i] > highs[i - 2]) { dir = 1; lo = highs[i - 2]; hi = lows[i]; }
    else if (highs[i] < lows[i - 2]) { dir = -1; lo = highs[i]; hi = lows[i - 2]; }
    else continue;
    const size = hi - lo;
    if (size < o.minAtr * atr[i]) continue;
    // Yer değiştirme (displacement): orta mumun gövdesi
    const body = Math.abs(closes[i - 1] - ctx.opens[i - 1]);
    const f = { i, dir, lo, hi, size, body, filled: 0, status: 'open', mitigatedAt: null, invertedAt: null };
    // Dolum: sonraki mumlar
    let deepest = dir === 1 ? hi : lo;
    for (let j = i + 1; j <= last; j++) {
      if (dir === 1) {
        if (lows[j] < deepest) deepest = lows[j];
        if (f.mitigatedAt == null && lows[j] <= hi) f.mitigatedAt = j;
        if (closes[j] < lo) { f.status = 'inverted'; f.invertedAt = j; f.filled = 1; break; }
      } else {
        if (highs[j] > deepest) deepest = highs[j];
        if (f.mitigatedAt == null && highs[j] >= lo) f.mitigatedAt = j;
        if (closes[j] > hi) { f.status = 'inverted'; f.invertedAt = j; f.filled = 1; break; }
      }
    }
    if (f.status !== 'inverted') {
      f.filled = Math.max(0, Math.min(1, dir === 1 ? (hi - deepest) / size : (deepest - lo) / size));
      f.status = f.filled >= 0.999 ? 'filled' : f.filled > 0 ? 'partial' : 'open';
    }
    // Canlı mum da dolumu ilerletebilir
    if (ctx.live && f.status !== 'inverted') {
      const l = ctx.live;
      const d2 = dir === 1 ? Math.max(0, Math.min(1, (hi - l.low) / size)) : Math.max(0, Math.min(1, (l.high - lo) / size));
      if (d2 > f.filled) { f.filled = d2; f.status = d2 >= 0.999 ? 'filled' : 'partial'; }
    }
    out.push(f);
  }
  return out;
}

export function detect(ctx) {
  const o = { ...FVG_DEFAULTS, ...ctx.opts.fvg };
  const fvgs = findFvgs(ctx, o);
  const out = [];
  const price = ctx.price;
  for (const dir of [1, -1]) {
    const open = fvgs.filter((f) => f.dir === dir && (f.status === 'open' || f.status === 'partial')).slice(-o.keep);
    for (const f of open) {
      const age = ctx.last - f.i;
      const dist = dir === 1 ? (price - f.hi) / ctx.atrNow : (f.lo - price) / ctx.atrNow; // fiyat bölgeye ne kadar uzak (ATR)
      const inside = price >= f.lo && price <= f.hi;
      const sizeAtr = f.size / ctx.atr[f.i];
      const strength = Math.min(1, 0.35 + 0.15 * Math.min(2, sizeAtr) + (f.status === 'open' ? 0.15 : 0) + (inside ? 0.2 : dist >= 0 && dist < 1.5 ? 0.1 : 0)) * Math.max(0.5, 1 - age / (2 * o.maxAge));
      out.push(signal({
        id: `fvg|${dir === 1 ? 'bull' : 'bear'}|${f.i}`,
        type: 'fvg', group: 'smc',
        name: dir === 1 ? 'FVG ↑' : 'FVG ↓',
        direction: dir === 1 ? 'long' : 'short',
        strength,
        zone: [f.lo, f.hi],
        index: f.i,
        status: inside ? 'triggered' : 'active',
        invalidation: dir === 1 ? f.lo : f.hi,
        note: `${dir === 1 ? 'Yükseliş' : 'Düşüş'} FVG (${sizeAtr.toFixed(2)}×ATR), ${f.status === 'open' ? 'hiç dolmadı' : `%${Math.round(f.filled * 100)} doldu`}; ${age} mum önce oluştu${inside ? ', fiyat içinde' : ''}.`,
        draw: [{ kind: 'box', from: f.i - 2, to: ctx.last, lo: f.lo, hi: f.hi, color: dir === 1 ? '#3987e5' : '#d95926', label: 'FVG' }],
        meta: { filled: f.filled, sizeAtr, age, status: f.status },
      }));
    }
    // Inversion FVG: yeni ters kırılmış boşluklar ters yönde destek/direnç olur
    const inv = fvgs.filter((f) => f.dir === dir && f.status === 'inverted' && ctx.last - f.invertedAt <= 20).slice(-2);
    for (const f of inv) {
      out.push(signal({
        id: `fvg|inv|${f.i}`,
        type: 'fvg', group: 'smc',
        name: dir === 1 ? 'iFVG ↓' : 'iFVG ↑',
        direction: dir === 1 ? 'short' : 'long',
        strength: 0.4,
        zone: [f.lo, f.hi],
        index: f.invertedAt,
        status: 'active',
        note: `Ters kırılmış ${dir === 1 ? 'yükseliş' : 'düşüş'} FVG: artık ${dir === 1 ? 'direnç' : 'destek'} adayı.`,
        draw: [{ kind: 'box', from: f.i - 2, to: ctx.last, lo: f.lo, hi: f.hi, color: '#9085e9', label: 'iFVG' }],
        meta: { invertedAt: f.invertedAt },
      }));
    }
  }
  return out;
}
