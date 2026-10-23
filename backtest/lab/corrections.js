// Elliott Ders 2 — zigzag ve genişleyen flat düzeltmelerinin sonunda işlem (laboratuvar aileleri).
//   zigzag_c        : (1) itkisinden sonra zigzag A-B-C; C ≈ A ve (1)'in 0,5–0,886 düzeltmesinde biter; dönüş mumuyla giriş.
//                     Stop 0,786 seviyesi ile C ucunun ötesi (hangisi uzaksa) + 0,2 ATR; TP1 (1) tepesi; TP2 C + 1,618 × (1).
//   expanded_flat_c : (3) sonrasında genişleyen flat; B (3)'ün ucunu geçer, C A ucunu kırar ve mum A ucunun bu tarafına geri
//                     kapanır (süpürme + geri kapanış). Stop C ucu + 0,2 ATR; TP1 B ucu; TP2 C + (3) boyu (≥ TP1).
// İki yön (long kuralı ve aynası). Sayım geçerliliği kural motorundan (analyze, pattern zigzag|flat). ZigZag seri başına bir
// kez hesaplanır; her mumda yalnız o ana kadar onaylanmış pivotlar kullanılır (pivotsAsOf; geleceğe bakmaz). Dersin 15m PO3
// tetiği modellenmez (tek TF; mum tetiği). "2R kuralı": TP1 en az 2R.
import * as I from '../../src/data/indicators.js';
import { zigzag, fillAtr, pivotsAsOf } from '../../src/core/zigzag.js';
import { analyze } from '../../src/ew/engine/analyze.js';

export const CORR_DEFAULTS = { ks: [2, 3], ruleSet: 'course', minScore: 50, bufferAtr: 0.2, minRR: 2, cRatio: [0.8, 1.7], retrace: [0.5, 0.886], minImpulse: 1.5, recentBars: 2 };

const r8 = (x) => +Number(x).toPrecision(8);
const mk = (d, entry, stop, tp1, tp2, atr, extra) => ({ d, direction: d === 1 ? 'long' : 'short', entry: r8(entry), stop: r8(stop), tp1: r8(tp1), tp2: r8(tp2), inZone: true, atr: r8(atr), price: r8(entry), ...extra });

/** Kural motoru: 4 nokta (0, A, B, C) verilen kalıp olarak geçerli mi? → aday ya da null. */
export function validCount(pts, pattern, o = CORR_DEFAULTS) {
  const res = analyze(pts.map((p) => ({ t: p.i, p: p.price })), { pattern, ruleSet: o.ruleSet, logScale: true });
  const b = res.ok ? res.best : null;
  return b && b.valid && b.score >= o.minScore ? b : null;
}

/**
 * Zigzag 2. dalga planı. S: (1)'in başı, P0: (1)'in sonu = zigzag başı, A, B onaylı; C: geçici uç (C'nin şu anki ucu).
 * c: tetik mumu (index i), prev: önceki mum. Long: (1) yukarı, zigzag aşağı. → plan ya da null.
 */
export function zigzagPlan([S, P0, A, B, C], c, prev, atr, o = CORR_DEFAULTS) {
  const d = P0.price > S.price ? 1 : -1; // (1)'in yönü = işlem yönü
  const L1 = Math.abs(P0.price - S.price), LA = Math.abs(A.price - P0.price), LC = Math.abs(C.price - B.price);
  if (!(L1 > 0 && LA > 0)) return null;
  if (d * (P0.price - A.price) <= 0 || d * (B.price - A.price) <= 0 || d * (B.price - C.price) <= 0) return null; // şekil
  const ratio = LC / LA;
  if (ratio < o.cRatio[0] || ratio > o.cRatio[1]) return null;
  const retr = Math.abs(P0.price - C.price) / L1;
  if (retr < o.retrace[0] || retr > o.retrace[1]) return null;
  if (c.i - C.i > o.recentBars) return null; // C ucu taze olmalı
  const turned = d === 1 ? c.close > prev.high : c.close < prev.low; // dönüş mumu
  if (!turned) return null;
  if (!validCount([P0, A, B, C], 'zigzag', o)) return null;
  const lvl786 = P0.price - d * 0.786 * L1;
  const stop = (d === 1 ? Math.min(lvl786, C.price) : Math.max(lvl786, C.price)) - d * o.bufferAtr * atr;
  if (d * (stop - S.price) <= 0) return null; // stop (1)'in başının ötesine taşıyorsa sayım zaten bozulmuş olur
  const entry = c.close, risk = d * (entry - stop);
  const tp1 = P0.price, tp2 = C.price + d * 1.618 * L1;
  if (!(risk > 0) || d * (tp1 - entry) / risk < o.minRR) return null;
  return mk(d, entry, stop, tp1, tp2, atr, { kind: 'zigzag', cRatio: +ratio.toFixed(2), retrace: +retr.toFixed(3), rr1: +(d * (tp1 - entry) / risk).toFixed(2) });
}

/**
 * Genişleyen flat 4. dalga planı. S: (3)'ün başı, P0: (3)'ün sonu = flat başı, A, B onaylı; C: geçici uç.
 * Tetik: mumun fitili A ucunun ötesinde, kapanışı A ucunun bu tarafında (süpürme + geri kapanış).
 */
export function flatPlan([S, P0, A, B, C], c, atr, o = CORR_DEFAULTS) {
  const d = P0.price > S.price ? 1 : -1;
  const L3 = Math.abs(P0.price - S.price), LA = Math.abs(A.price - P0.price);
  if (!(L3 > 0 && LA > 0) || L3 < o.minImpulse * LA) return null;
  if (d * (B.price - P0.price) <= 0) return null; // B (3)'ün ucunu geçmeli (genişleyen)
  if (d * (A.price - C.price) <= 0) return null; // C, A ucunu kırmış olmalı
  if (d * (C.price - S.price) <= 0) return null; // C, (3)'ün başına inmemeli
  if (C.i !== c.i && c.i - C.i > 1) return null; // süpürme bu mumda ya da bir önceki mumda
  const wickOut = d === 1 ? c.low < A.price : c.high > A.price;
  const bodyIn = d === 1 ? c.close > A.price : c.close < A.price;
  if (!(wickOut || C.i === c.i - 1) || !bodyIn) return null;
  const cnt = validCount([P0, A, B, C], 'flat', o);
  if (!cnt) return null;
  if (!/expanded\)/.test(cnt.label)) return null; // kural motorunun alt tipi: genişleyen (expanded)
  const stop = C.price - d * o.bufferAtr * atr, entry = c.close, risk = d * (entry - stop);
  // TP2 = (5): ders (5) = (1) boyunu (4) dibinden ölçer; (1) bilinmediği için (3) boyu kullanılır, TP1'in ötesinde tutulur
  const tp1 = B.price;
  let tp2 = C.price + d * L3;
  if (d * (tp2 - tp1) <= 0) tp2 = tp1 + d * 0.618 * Math.abs(B.price - C.price);
  if (!(risk > 0) || d * (tp1 - entry) / risk < o.minRR) return null;
  return mk(d, entry, stop, tp1, tp2, atr, { kind: 'expanded_flat', rr1: +(d * (tp1 - entry) / risk).toFixed(2) });
}

function prepareBase(candles, o) {
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atr = I.atr(highs, lows, closes, 14);
  const filled = fillAtr(atr);
  const zz = o.ks.map((k) => zigzag(candles, filled, k));
  return { atr, zz, seen: new Set(), o };
}

/** i anındaki son 4 onaylı pivot + geçici uç (C) → [S, P0, A, B, C] ya da null. */
function windowAt(zz, candles, i) {
  const { pivots, tentative } = pivotsAsOf(zz, candles, i);
  if (!tentative || pivots.length < 4) return null;
  const w = pivots.slice(-4);
  return [...w, tentative];
}

const mkFamily = (id, label, planFn, exit) => ({
  id, label, tfs: ['1H', '4H'], exit, o: CORR_DEFAULTS,
  prepare(candles) { return prepareBase(candles, this.o); },
  signal(i, candles, p) {
    if (i < 60) return null;
    const a = p.atr[i]; if (!a) return null;
    const c = { ...candles[i], i };
    for (let z = 0; z < p.zz.length; z++) {
      const w = windowAt(p.zz[z], candles, i);
      if (!w) continue;
      const key = `${z}:${w.slice(0, 4).map((q) => q.i).join('-')}`;
      if (p.seen.has(key)) continue;
      const plan = planFn(w, c, candles[i - 1], a, p.o);
      if (plan) { p.seen.add(key); return plan; }
    }
    return null;
  },
});

export const zigzagC = mkFamily('zigzag_c', 'Zigzag 2. dalga: C ≈ A ve (1)\'in 0,5–0,886 düzeltmesi, dönüş mumu (TP1 = (1) ucu ≥ 2R)',
  (w, c, prev, a, o) => zigzagPlan(w, c, prev, a, o), { tpScheme: 'half_be', maxHoldBars: 120 });
export const expandedFlatC = mkFamily('expanded_flat_c', 'Genişleyen flat 4. dalga: C, A ucunu süpürüp geri kapanış (TP1 = B ucu ≥ 2R)',
  (w, c, prev, a, o) => flatPlan(w, c, a, o), { tpScheme: 'half_be', maxHoldBars: 120 });

// Varyantlar (ilk 24 ay koşusundan sonra): zigzag yalnız 1H short (tek tutarlı kesit; sonradan seçildi, ayrı test edilir) ve
// genişleyen flat geniş stop (C ucu ∓ 1 ATR; ikinci süpürmeye dayanıklı, TP1 ≥ 2R şartı aynı).
export const zigzagC1hShort = mkFamily('zigzag_c_1h_short', 'Zigzag 1H yalnız short: düşüş itkisinden sonra yukarı zigzag, C ≈ A (TP1 ≥ 2R)',
  (w, c, prev, a, o) => { const pl = zigzagPlan(w, c, prev, a, o); return pl && pl.d === -1 ? pl : null; }, { tpScheme: 'half_be', maxHoldBars: 120 });
zigzagC1hShort.tfs = ['1H'];
export const expandedFlatCWide = { ...mkFamily('expanded_flat_c_wide', 'Genişleyen flat 4. dalga, stop C ucu ∓ 1 ATR (TP1 = B ucu ≥ 2R)',
  (w, c, prev, a, o) => flatPlan(w, c, a, o), { tpScheme: 'half_be', maxHoldBars: 120 }), o: { ...CORR_DEFAULTS, bufferAtr: 1.0 } };
