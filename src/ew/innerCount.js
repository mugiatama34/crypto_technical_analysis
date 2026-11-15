// Fib kesişimi iç dalga sayımı (ön kayıt docs/arastirma/on-kayit-fib-dalga.md, "Etiket" bölümü — tanım kilitli).
// Bir bacağın (itki P0→P1 ya da A bacağı P1→A) iki ucu arasındaki mumlarda aynı ZigZag algoritması (src/core/zigzag.js),
// eşik = kurulumu bulan dış eşiğin yarısı × ATR (k / 2 × ATR; ATR = dedektörün sinyal anında kullandığı TEK değer, mum başına
// değil). İç pivot dizisi bacağın başıyla başlar, ucuyla biter; iç bacak sayısı m (tek sayı) → sınıf.
// Saf fonksiyon: tarayıcı (src/detectors/fibonacci.js) ve lab (backtest/lab/fibwave.mjs) aynı fonksiyonu kullanır.
// Yalnız BİLGİ etiketi: puan / plan / sinyal üretimi bu sonuca bakmaz.
import { zigzag } from '../core/zigzag.js';

/** Sınıf kimlikleri → Türkçe etiket (ön kayıttaki adlar). */
export const WAVE_CLASSES = { one: 'tek parça', three: "3'lü", five_ok: "5'li ✓", five_bad: "5'li ✗", seven: '7+' };

/**
 * Bacağın iç pivotları. a, b: { i, price } (a.i < b.i); thr: dönüş eşiği (fiyat birimi, sabit).
 * → [{ i, price, type }] (ilk = a, son = b; tipler sırayla değişir) ya da null.
 */
export function legPivots(candles, a, b, thr) {
  if (!candles?.length || !a || !b || !(b.i > a.i) || !(thr > 0) || b.i >= candles.length || a.i < 0) return null;
  const up = b.price > a.price;
  const startType = up ? 'L' : 'H', endType = up ? 'H' : 'L';
  const seg = candles.slice(a.i, b.i + 1);
  const { pivots } = zigzag(seg, new Array(seg.length).fill(thr), 1, { from: 0, to: seg.length - 1, start: { i: 0, type: startType } });
  const pts = pivots.map((p) => ({ i: p.i + a.i, price: p.price, type: p.type }));
  pts[0] = { i: a.i, price: a.price, type: startType }; // başlangıç tam olarak dış pivot
  // Son onaylı iç pivot bacak ucuyla aynı tipteyse onun yerini uç alır (aradaki eşik altı geri çekilme sayılmaz)
  if (pts.length > 1 && pts[pts.length - 1].type === endType) pts.pop();
  pts.push({ i: b.i, price: b.price, type: endType });
  return pts;
}

/**
 * İç pivot dizisinden sınıf. m = 1 tek parça · 3 · 5 (iki Elliott kuralı: 3. dalga 1/3/5 içinde en kısa değil; 4. dalga
 * 1. dalganın ucunu aşmıyor) · ≥ 7.
 */
export function classifyPivots(pts) {
  if (!pts || pts.length < 2) return null;
  const m = pts.length - 1;
  if (m === 1) return { cls: 'one', label: WAVE_CLASSES.one, m, rules: null };
  if (m === 3) return { cls: 'three', label: WAVE_CLASSES.three, m, rules: null };
  if (m >= 7) return { cls: 'seven', label: WAVE_CLASSES.seven, m, rules: null };
  if (m !== 5) return null; // çift m alternasyon gereği oluşmaz
  const d = pts[1].price > pts[0].price ? 1 : -1;
  const w = (j) => Math.abs(pts[j].price - pts[j - 1].price);
  const w1 = w(1), w3 = w(3), w5 = w(5);
  // "En kısa değil": 3. dalga hem 1'den hem 5'ten kısaysa bozuk (eşitlik en kısa sayılmaz)
  const w3NotShortest = !(w3 < w1 && w3 < w5);
  // "Aşmıyor": 4. dalganın ucu 1. dalganın ucuna değebilir, öteye geçemez
  const w4NoOverlap = d * (pts[4].price - pts[1].price) >= 0;
  const ok = w3NotShortest && w4NoOverlap;
  return { cls: ok ? 'five_ok' : 'five_bad', label: ok ? WAVE_CLASSES.five_ok : WAVE_CLASSES.five_bad, m, rules: { w3NotShortest, w4NoOverlap } };
}

/** Bir bacağın sınıfı: { cls, label, m, rules, pivots } ya da null. */
export function legClass(candles, a, b, thr) {
  const pts = legPivots(candles, a, b, thr);
  const c = classifyPivots(pts);
  return c ? { ...c, pivots: pts.map((p) => ({ i: p.i, price: p.price })) } : null;
}

/**
 * Kesişim kurulumunun iç sayımı. pts: [P0, P1, A, B] ({ i, price }); atr: sinyal anındaki ATR; k: kurulumu bulan dış ZigZag eşiği.
 * → { k, kIn, thr, imp, a, text } ya da null (ör. ATR yok).
 */
export function fibWaveOf(candles, pts, atr, k) {
  if (!pts || pts.length < 3 || !(atr > 0) || !(k > 0)) return null;
  const kIn = k / 2, thr = kIn * atr;
  const imp = legClass(candles, pts[0], pts[1], thr);
  const a = legClass(candles, pts[1], pts[2], thr);
  if (!imp || !a) return null;
  return { k, kIn, thr: +thr.toPrecision(6), imp, a, text: waveText(imp.cls, a.cls) };
}

/** Kısa etiket metni: "İtki: 5'li ✓ · A: 3'lü". */
export const waveText = (impCls, aCls) => `İtki: ${WAVE_CLASSES[impCls] ?? '?'} · A: ${WAVE_CLASSES[aCls] ?? '?'}`;
