// Elliott diyagonalleri (ders: "Diyagonaller"): kama şeklinde, örtüşen 5 dalga. İki kurulum:
//   ending_diagonal  — trend sonunda biten diyagonal; v. dalga 1-3 çizgisinin dışına taşar (throw-over/under) ve gövde
//                      kamanın içine kapanır → ters yönde piyasa girişi. Stop: 5. dalga ucu + tampon. TP1: diyagonalin
//                      başı (0 noktası). TP2: başın ötesi (yükseklik × 0,5). Oran (TP1) ≥ 2R şartı.
//   leading_diagonal — uzun düşüş/yükseliş sonrası başlangıç diyagonali (1. dalga) tamamlanınca 2. dalganın
//                      %61,8 geri çekilmesine limit emir. Stop: diyagonal başının ötesi. TP1: 1. dalga tepesi.
//                      TP2: (3) = giriş + 1,618 × (1). Oran (TP2) ≥ 2R şartı.
// Sayım geçerliliği mevcut kural motorundan (src/ew/engine/analyze.js, pattern 'diagonal'); geleceğe bakılmaz:
// her mumda yalnızca o ana kadarki mumların pivotları kullanılır. Dersin 15m PO3 tetiği modellenmemiştir
// (laboratuvar tek TF'de çalışır); throw-over mumunun kapanışı tetik sayılır.
import { makeContext } from '../../src/scan/context.js';
import { analyze } from '../../src/ew/engine/analyze.js';
import { barsFor } from '../../src/scan/scanner.js';
import * as I from '../../src/data/indicators.js';

export const DIA_DEFAULTS = { minScore: 55, ruleSet: 'course', sensitivities: [2, 3], bufferAtr: 0.2, minRR: 2, minPriorMove: 1.0, retrace: 0.618, maxWaitBars: 30 };

const r6 = (x) => +Number(x).toPrecision(8);
const lineAt = (pA, pB, i) => pA.price + ((pB.price - pA.price) * (i - pA.i)) / (pB.i - pA.i || 1);
const mk = (d, entry, stop, tp1, tp2, atr, inZone, extra) => ({ d, direction: d === 1 ? 'long' : 'short', entry: r6(entry), stop: r6(stop), tp1: r6(tp1), tp2: r6(tp2), inZone, atr: r6(atr), price: r6(entry), ...extra });

/** Kural motoru: 6 nokta geçerli diyagonal mi? kind: 'ending' | 'leading'. */
export function validDiagonal(pts, kind, o = DIA_DEFAULTS) {
  if (pts.length !== 6) return null;
  const res = analyze(pts.map((p) => ({ t: p.i, p: p.price })), { pattern: 'diagonal', diagonalKind: kind, ruleSet: o.ruleSet, logScale: true });
  if (!res.ok || !res.best || !res.best.valid || res.best.score < o.minScore) return null;
  return res.best;
}

/**
 * Bitiş diyagonali planı. pts: 0..5 (5 = henüz onaylanmamış uç, throw-over mumunda). c: mevcut mum.
 * d: diyagonalin yönü (+1 yukarı → short planı). priorMove: 0 noktasından önceki trend büyüklüğü (fiyat).
 */
export function endingPlan(pts, c, atr, priorMove, o = DIA_DEFAULTS) {
  const [p0, p1, , p3, , p5] = pts;
  const d = p1.price > p0.price ? 1 : -1;
  const H = Math.abs(p5.price - p0.price);
  if (!(H > 0) || priorMove < o.minPriorMove * H) return null; // trend sonu olmalı: önceki hareket diyagonalden büyük
  if (p5.i !== c.i) return null; // taşma bu mumda
  const l13 = lineAt(p1, p3, c.i);
  const wickOut = d === 1 ? c.high > l13 : c.low < l13;
  const bodyIn = d === 1 ? c.close < l13 : c.close > l13;
  if (!wickOut || !bodyIn) return null;
  if (!validDiagonal(pts, 'ending', o)) return null;
  const entry = c.close, stop = p5.price + d * o.bufferAtr * atr;
  const risk = Math.abs(stop - entry);
  const tp1 = p0.price, tp2 = p0.price - d * 0.5 * H;
  if (!(risk > 0) || Math.abs(tp1 - entry) / risk < o.minRR) return null;
  return mk(-d, entry, stop, tp1, tp2, atr, true, { kind: 'ending', rr1: +(Math.abs(tp1 - entry) / risk).toFixed(2) });
}

/** Başlangıç diyagonali planı: pts 0..5 onaylı; isLowest: 0 noktası önceki trendin ucu mu. */
export function leadingPlan(pts, atr, isExtreme, o = DIA_DEFAULTS) {
  const [p0, p1, , , , p5] = pts;
  const d = p1.price > p0.price ? 1 : -1;
  const H = Math.abs(p5.price - p0.price);
  if (!(H > 0) || !isExtreme) return null;
  if (!validDiagonal(pts, 'leading', o)) return null;
  const entry = p5.price - d * o.retrace * H;
  const stop = p0.price - d * o.bufferAtr * atr;
  const risk = Math.abs(entry - stop);
  const tp1 = p5.price, tp2 = entry + d * 1.618 * H;
  if (!(risk > 0) || Math.abs(tp2 - entry) / risk < o.minRR) return null;
  return mk(d, entry, stop, tp1, tp2, atr, false, { kind: 'leading', rr1: +(Math.abs(tp1 - entry) / risk).toFixed(2) });
}

function basics(candles) {
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  return { highs, lows, closes, atr: I.atr(highs, lows, closes, 14) };
}

/** Bitiş diyagonali: 4H/1H; throw-over mumunda ters yönde piyasa girişi. */
export const endingDiagonal = {
  id: 'ending_diagonal', label: 'Bitiş diyagonali: throw-over/under + kamaya kapanış → ters yön (TP1 ≥ 2R)', tfs: ['4H', '1H'],
  exit: { tpScheme: 'half_be', maxHoldBars: 80 },
  prepare(candles, tf) { return { ...basics(candles), tf, W: barsFor(tf), seen: new Set(), o: DIA_DEFAULTS }; },
  signal(i, candles, p) {
    if (i < 100) return null;
    const a = p.atr[i]; if (a == null) return null;
    const win = candles.slice(Math.max(0, i - p.W + 1), i + 1);
    const off = i - (win.length - 1);
    const ctx = makeContext({ candles: win, live: null, tf: p.tf });
    const c = { ...candles[i], i };
    for (const k of p.o.sensitivities) {
      const { pivots, tentative } = ctx.pivots(k);
      if (!tentative || pivots.length < 5) continue;
      const pts = [...pivots.slice(-5), tentative].map((q) => ({ ...q, i: q.i + off }));
      const key = `${k}:${pts.slice(0, 5).map((q) => q.i).join('-')}`;
      if (p.seen.has(key)) continue;
      const d = pts[1].price > pts[0].price ? 1 : -1;
      const before = candles.slice(Math.max(0, pts[0].i - p.W), pts[0].i);
      if (before.length < 20) continue;
      const priorMove = d === 1 ? pts[0].price - Math.min(...before.map((x) => x.low)) : Math.max(...before.map((x) => x.high)) - pts[0].price;
      const plan = endingPlan(pts, c, a, priorMove, p.o);
      if (plan) { p.seen.add(key); return plan; }
    }
    return null;
  },
};

/** Başlangıç diyagonali: 4H/1H; tamamlanınca 2. dalganın %61,8'ine limit. */
export const leadingDiagonal = {
  id: 'leading_diagonal', label: 'Başlangıç diyagonali: 2. dalga %61,8 limit, hedef (3) = 1,618 × (1) (TP2 ≥ 2R)', tfs: ['4H', '1H'],
  exit: { tpScheme: 'half_be', maxHoldBars: 120, expireHours: 24 * 5 },
  prepare(candles, tf) { return { ...basics(candles), tf, W: barsFor(tf), seen: new Set(), o: DIA_DEFAULTS }; },
  signal(i, candles, p) {
    if (i < 100) return null;
    const a = p.atr[i]; if (a == null) return null;
    const win = candles.slice(Math.max(0, i - p.W + 1), i + 1);
    const off = i - (win.length - 1);
    const ctx = makeContext({ candles: win, live: null, tf: p.tf });
    for (const k of p.o.sensitivities) {
      const { pivots } = ctx.pivots(k);
      if (pivots.length < 6) continue;
      const pts = pivots.slice(-6).map((q) => ({ ...q, i: q.i + off }));
      if (i - pts[5].i > p.o.maxWaitBars) continue; // diyagonal yeni bitmiş olmalı
      const key = `${k}:${pts.map((q) => q.i).join('-')}`;
      if (p.seen.has(key)) continue;
      const d = pts[1].price > pts[0].price ? 1 : -1;
      const before = candles.slice(Math.max(0, pts[0].i - p.W), pts[0].i);
      if (before.length < 20) continue;
      const isExtreme = d === 1 ? pts[0].price <= Math.min(...before.map((x) => x.low)) : pts[0].price >= Math.max(...before.map((x) => x.high));
      const plan = leadingPlan(pts, a, isExtreme, p.o);
      if (plan) { p.seen.add(key); return plan; }
    }
    return null;
  },
};
