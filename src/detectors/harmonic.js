// Harmonik formasyonlar: XABCD (Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, Cypher) ve ABCD.
// Oranlar pivotlar üzerinden; D oluşmuşsa 'complete', C onaylı D henüz yoksa PRZ (olası dönüş bölgesi) projekte edilir.
import { signal } from '../core/signal.js';

export const HARM_DEFAULTS = { tol: 0.06, maxAge: 40, minLegAtr: 1.5 };

const R = (lo, hi) => ({ lo, hi });
// Oranlar: ab = |AB|/|XA|, bc = |BC|/|AB|, ad = |AD|/|XA| (XA'nın geri çekilmesi/uzantısı), cd = |CD|/|BC|
export const PATTERNS = [
  { id: 'gartley', name: 'Gartley', ab: R(0.58, 0.66), bc: R(0.382, 0.886), ad: R(0.74, 0.83), cd: R(1.13, 1.618) },
  { id: 'bat', name: 'Bat', ab: R(0.382, 0.5), bc: R(0.382, 0.886), ad: R(0.85, 0.92), cd: R(1.618, 2.618) },
  { id: 'butterfly', name: 'Butterfly', ab: R(0.74, 0.83), bc: R(0.382, 0.886), ad: R(1.2, 1.65), cd: R(1.618, 2.618) },
  { id: 'crab', name: 'Crab', ab: R(0.382, 0.618), bc: R(0.382, 0.886), ad: R(1.55, 1.7), cd: R(2.24, 3.618) },
  { id: 'deepcrab', name: 'Deep Crab', ab: R(0.84, 0.93), bc: R(0.382, 0.886), ad: R(1.55, 1.7), cd: R(2.0, 3.618) },
  // Shark / Cypher: C, A'yı aşar (bc > 1). ad burada D'nin XA'ya oranı değil XC'ye göre ölçülür (xc alanı).
  { id: 'shark', name: 'Shark', ab: R(0.3, 0.7), bc: R(1.13, 1.618), xc: R(0.86, 1.15), cd: null },
  { id: 'cypher', name: 'Cypher', ab: R(0.382, 0.618), bc: R(1.13, 1.414), xc: R(0.74, 0.83), cd: null },
];

const within = (x, r, tol) => r && x >= r.lo * (1 - tol) && x <= r.hi * (1 + tol);
const score = (x, r) => (r ? Math.max(0, 1 - Math.abs(x - (r.lo + r.hi) / 2) / ((r.hi - r.lo) / 2 + 1e-9)) : 1);

/** X,A,B,C (+D) pivotlarından kalıp eşleşmeleri. */
export function matchXabcd(X, A, B, C, D, o) {
  const xa = Math.abs(A.price - X.price), ab = Math.abs(B.price - A.price), bc = Math.abs(C.price - B.price);
  if (!xa || !ab || !bc) return [];
  const rAB = ab / xa, rBC = bc / ab;
  const out = [];
  const bull = X.type === 'L'; // X dip → bullish (D'de alım)
  const s = bull ? 1 : -1;
  for (const p of PATTERNS) {
    if (!within(rAB, p.ab, o.tol) || !within(rBC, p.bc, o.tol)) continue;
    // D projeksiyonu: XA'ya göre (ad) ya da XC'ye göre (xc)
    let dLo, dHi;
    if (p.ad) { dLo = A.price - s * p.ad.hi * xa; dHi = A.price - s * p.ad.lo * xa; }
    else { const xc = Math.abs(C.price - X.price); dLo = C.price - s * p.xc.hi * xc; dHi = C.price - s * p.xc.lo * xc; }
    const prz = [Math.min(dLo, dHi), Math.max(dLo, dHi)];
    let complete = false, rAD = null, rCD = null, q = (score(rAB, p.ab) + score(rBC, p.bc)) / 2;
    if (D) {
      const ad = Math.abs(D.price - A.price), cd = Math.abs(D.price - C.price);
      rAD = p.ad ? ad / xa : Math.abs(D.price - C.price) / Math.abs(C.price - X.price);
      rCD = cd / bc;
      const ok = p.ad ? within(rAD, p.ad, o.tol) : within(rAD, p.xc, o.tol);
      if (!ok) continue;
      if (p.cd && !within(rCD, p.cd, o.tol * 2)) continue;
      // D, X'i aşmalı mı? Gartley/Bat/Cypher/Shark: D, X'i geçmez; Butterfly/Crab: geçer. Oran bandı bunu zaten taşır.
      complete = true;
      q = (q * 2 + score(rAD, p.ad || p.xc)) / 3;
    }
    out.push({ pattern: p, bull, prz, complete, ratios: { ab: rAB, bc: rBC, ad: rAD, cd: rCD }, quality: q });
  }
  return out;
}

/** ABCD: BC = 0.618/0.786 AB, CD = 1.272/1.618 BC. */
export function matchAbcd(A, B, C, D, o) {
  const ab = Math.abs(B.price - A.price), bc = Math.abs(C.price - B.price);
  if (!ab || !bc) return null;
  const rBC = bc / ab;
  if (!within(rBC, R(0.6, 0.8), o.tol)) return null;
  const bull = A.type === 'H'; // A tepe, B dip, C tepe, D dip → alım
  const s = bull ? 1 : -1;
  const prz = [C.price - s * 1.618 * bc, C.price - s * 1.272 * bc].sort((x, y) => x - y);
  let complete = false, rCD = null;
  if (D) {
    rCD = Math.abs(D.price - C.price) / bc;
    if (!within(rCD, R(1.2, 1.7), o.tol)) return null;
    complete = true;
  }
  return { pattern: { id: 'abcd', name: 'AB=CD' }, bull, prz, complete, ratios: { bc: rBC, cd: rCD }, quality: score(rBC, R(0.6, 0.8)) };
}

export function detect(ctx) {
  const o = { ...HARM_DEFAULTS, ...ctx.opts.harmonic };
  const out = [];
  if (ctx.n < 60) return out;
  const seen = new Set();
  for (const k of [ctx.opts.minorK, ctx.opts.swingK]) {
    const { pivots, tentative } = ctx.pivots(k);
    const pts = tentative ? [...pivots, tentative] : pivots;
    if (pts.length < 4) continue;
    const cands = [];
    // Pencereler: oluşan uçla biten ve son onaylı pivotla biten
    const bases = tentative ? [pts, pivots] : [pts];
    for (const base of bases) {
      const last5 = base.slice(-5), last4 = base.slice(-4);
      // Tamamlanmış XABCD (son 5 pivot, D = son nokta)
      if (last5.length === 5) for (const m of matchXabcd(...last5, o)) cands.push({ m, pts: last5 });
      // Oluşan: X A B C onaylı, D bekleniyor
      if (last4.length === 4) for (const m of matchXabcd(...last4, null, o)) cands.push({ m, pts: last4 });
      const abcd5 = last5.length === 5 ? matchAbcd(last5[1], last5[2], last5[3], last5[4], o) : null;
      if (abcd5) cands.push({ m: abcd5, pts: last5.slice(1) });
      const abcd4 = last4.length === 4 ? matchAbcd(last4[0], last4[1], last4[2], last4[3], o) : null;
      if (abcd4) cands.push({ m: abcd4, pts: last4 });
      const abcd3 = last4.length === 4 ? matchAbcd(last4[1], last4[2], last4[3], null, o) : null;
      if (abcd3) cands.push({ m: abcd3, pts: last4.slice(1) });
    }
    for (const { m, pts: P } of cands) {
      const lastP = P[P.length - 1];
      const key = `${m.pattern.id}|${m.complete ? 'c' : 'f'}|${lastP.i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const age = ctx.last - lastP.i;
      if (age > o.maxAge) continue;
      const dir = m.bull ? 'long' : 'short';
      const distPrz = m.complete ? 0 : Math.min(Math.abs(ctx.price - m.prz[0]), Math.abs(ctx.price - m.prz[1])) / ctx.atrNow;
      const inPrz = ctx.price >= m.prz[0] - 0.2 * ctx.atrNow && ctx.price <= m.prz[1] + 0.2 * ctx.atrNow;
      if (!m.complete && distPrz > 6) continue;
      const labels = P.length === 5 ? ['X', 'A', 'B', 'C', 'D'] : P.length === 4 && m.pattern.id !== 'abcd' ? ['X', 'A', 'B', 'C'] : m.pattern.id === 'abcd' && P.length === 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C'];
      const A = P[labels.indexOf('A')], Cc = P[labels.indexOf('C')];
      const target1 = Cc ? (m.bull ? Math.max(A?.price ?? Cc.price, Cc.price) : Math.min(A?.price ?? Cc.price, Cc.price)) : null;
      out.push(signal({
        id: `harm|${key}`, type: 'harmonic', group: 'harmonic',
        name: `${m.bull ? 'Bullish' : 'Bearish'} ${m.pattern.name}${m.complete ? '' : ' (PRZ)'}`,
        direction: dir,
        strength: Math.min(1, (0.45 + 0.35 * m.quality) * (m.complete ? 1 : inPrz ? 0.9 : 0.6) * Math.max(0.5, 1 - age / (2 * o.maxAge))),
        zone: m.prz, index: lastP.i, status: m.complete ? 'active' : inPrz ? 'triggered' : 'forming',
        invalidation: m.bull ? m.prz[0] - 0.5 * ctx.atrNow : m.prz[1] + 0.5 * ctx.atrNow,
        target: target1 ?? undefined,
        note: `${m.pattern.name}: AB/XA ${m.ratios.ab?.toFixed(3) ?? '–'}, BC/AB ${m.ratios.bc?.toFixed(3) ?? '–'}${m.ratios.ad ? `, D ${m.ratios.ad.toFixed(3)}` : ''}; ${m.complete ? 'D tamamlandı' : `PRZ ${m.prz[0].toPrecision(5)}–${m.prz[1].toPrecision(5)}`}.`,
        draw: [
          { kind: 'line', points: P.map((p) => ({ i: p.i, price: p.price })), color: '#d55181', label: m.pattern.name },
          ...P.map((p, k2) => ({ kind: 'marker', i: p.i, price: p.price, position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: 'circle', color: '#d55181', text: labels[k2] })),
          { kind: 'box', from: Cc ? Cc.i : lastP.i, to: ctx.last, lo: m.prz[0], hi: m.prz[1], color: '#d55181', label: 'PRZ' },
        ],
        meta: { pattern: m.pattern.id, complete: m.complete, ratios: m.ratios, quality: m.quality, sensitivity: k },
      }));
    }
  }
  return out;
}
