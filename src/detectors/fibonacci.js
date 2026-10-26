// Fibonacci: son anlamlı bacağın geri çekilme seviyeleri, uzantı hedefleri, seviye çakışmaları (confluence).
// Seviyeler TradingView ile aynı olsun diye doğrusal ölçek.
import { signal } from '../core/signal.js';

export const FIB_DEFAULTS = {
  retr: [0.382, 0.5, 0.618, 0.705, 0.786, 0.886],
  ext: [1.272, 1.414, 1.618, 2.0, 2.618],
  nearAtr: 0.35, // fiyat seviyeye bu × ATR içinde ise "seviyede"
  legs: 2, // kaç bacak geriye bakılır (son ve bir önceki)
  minLegAtr: 3, // bacak boyu en az bu × ATR
  // Fib kesişimi (ABC): itkinin geri çekilmesi × A'nın B'den uzantısı (C = e × A) aynı yerde
  clusterRetr: [0.5, 0.618, 0.786],
  clusterExt: [1.272, 1.382, 1.618],
  clusterTolAtr: 0.5, // iki seviye arasındaki fark en fazla bu × ATR
  minImpulseAtr: 3, // itki boyu en az bu × ATR
  bRetr: [0.382, 0.886], // B, A'yı bu aralıkta geri almalı
  only: null, // 'cluster' → yalnız Fib kesişimi sinyali (preset)
  clusterKs: null, // kesişim için denenecek ZigZag eşikleri (× ATR); null → yalnız swingK. Küçük TF'de [2,3,4] gürültüyü aşar
};

/**
 * Fib kesişimi (arkadaşın kuralı): P0→P1 itki, A itkiye ters, B A'yı kısmen geri alır; C'nin biteceği bölge =
 * itkinin r geri çekilmesi (P1 − dI·r·L) ile A'nın B'den e uzantısı (B + dA·e·|A|) çakışırsa (≤ tol).
 * points: [P0, P1, A, B] ({price}); atr: sayı. → { mid, retr, ext, diff, d, stop, tp1, tp2, invalid, L, lenA } | null
 */
export function fibClusterOf([P0, P1, A, B], atr, o = FIB_DEFAULTS) {
  if (!P0 || !P1 || !A || !B || !(atr > 0)) return null;
  const dI = P1.price > P0.price ? 1 : -1, L = Math.abs(P1.price - P0.price), lenA = Math.abs(A.price - P1.price);
  if (L < (o.minImpulseAtr ?? 3) * atr || !(lenA > 0)) return null;
  if (dI * (P1.price - A.price) <= 0) return null; // A itkiye ters olmalı
  const bRet = dI * (B.price - A.price) / lenA; // B'nin A'yı geri alma oranı (itki yönünde)
  const [bLo, bHi] = o.bRetr ?? [0.382, 0.886];
  if (bRet < bLo || bRet > bHi) return null;
  let best = null;
  for (const r of o.clusterRetr ?? [0.618]) for (const e of o.clusterExt ?? [1.272]) {
    const lr = P1.price - dI * r * L, le = B.price - dI * e * lenA; // uzantı A yönünde (= −dI)
    const diff = Math.abs(lr - le);
    if (diff > (o.clusterTolAtr ?? 0.5) * atr) continue;
    const score = diff / atr + (r === 0.618 && e === 1.272 ? 0 : 0.25); // 0,618×1,272 tercih edilir
    if (!best || score < best.score) best = { r, e, lr, le, diff, score };
  }
  if (!best) return null;
  const mid = (best.lr + best.le) / 2;
  if (dI * (A.price - mid) <= 0) return null; // bölge A'nın ötesinde olmalı (C, A'yı aşar)
  if (dI * (mid - P0.price) <= 0) return null; // itki başını aşmamalı
  const stop = P1.price - dI * 0.886 * L - dI * 0.2 * atr;
  return { lr: +best.lr.toPrecision(8), le: +best.le.toPrecision(8), mid: +mid.toPrecision(8), retr: best.r, ext: best.e, diff: +(best.diff / atr).toFixed(2), d: dI, stop: +stop.toPrecision(8), tp1: P1.price, tp2: +(P1.price + dI * 0.272 * L).toPrecision(8), invalid: P0.price, L, lenA, bRet: +bRet.toFixed(3) };
}

const trNum = (x, ref) => { const a = Math.abs(ref), d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(8, Math.ceil(-Math.log10(a)) + 3); return x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const fibTxt = (x) => String(x).replace('.', ',');
/**
 * Kesişimin "neden orada" çizimi: itki (P0→P1, gri), A bacağı (P1→A, mavi), iki seviye (oran gri noktalı, uzantı mavi noktalı),
 * noktalarda hangi oranın hangi fiyata düştüğünü yazan işaretler. pts: [P0,P1,A,B] ({i, price}); last: son mum indeksi.
 */
export function clusterDraw([P0, P1, A, B], c, last) {
  const up = c.d === 1, imp = '#9aa4b2', leg = '#5ea3f0';
  const pos = (isHigh) => (isHigh ? 'aboveBar' : 'belowBar');
  return [
    { kind: 'line', points: [{ i: P0.i, price: P0.price }, { i: P1.i, price: P1.price }], color: imp, style: 'solid' },
    { kind: 'line', points: [{ i: P1.i, price: P1.price }, { i: A.i, price: A.price }], color: leg, style: 'solid' },
    { kind: 'line', points: [{ i: P1.i, price: c.lr }, { i: last, price: c.lr }], color: imp, style: 'dotted' }, // itkinin oranı (ör. 0,618)
    { kind: 'line', points: [{ i: A.i, price: c.le }, { i: last, price: c.le }], color: leg, style: 'dotted' }, // B'den e×A uzantısı (ör. 1,272)
    { kind: 'marker', i: P0.i, position: pos(!up), shape: up ? 'arrowUp' : 'arrowDown', color: imp, text: 'İtki başı' },
    { kind: 'marker', i: P1.i, position: pos(up), shape: 'circle', color: imp, text: `İtki ucu · ${fibTxt(c.retr)} → ${trNum(c.lr, c.lr)}` },
    { kind: 'marker', i: A.i, position: pos(!up), shape: 'circle', color: leg, text: 'A' },
    { kind: 'marker', i: B.i, position: pos(up), shape: 'circle', color: leg, text: `B · ${fibTxt(c.ext)}×A → ${trNum(c.le, c.le)}` },
  ];
}

/** Pivot listesinden (onaylı + tentative) son [P0,P1,A,B] penceresi; C oluşuyorsa tentative hariç tutulur. */
export function clusterWindow(pivots, tentative) {
  const pts = tentative ? [...pivots, tentative] : pivots;
  if (pts.length < 4) return null;
  // Son nokta tentative ise iki aday: [.., A, B=tentative] (B oluşuyor) ya da [P0,P1,A,B] onaylı + C tentative
  return { withTent: pts.slice(-4), confirmed: pivots.length >= 4 ? pivots.slice(-4) : null };
}

/** Son `count` bacak: [{from, to, d}] (pivotlar + oluşan uç). */
export function recentLegs(ctx, count, minLegAtr) {
  const { pivots, tentative } = ctx.pivots(ctx.opts.swingK);
  const pts = tentative ? [...pivots, tentative] : pivots;
  const legs = [];
  for (let j = pts.length - 1; j >= 1 && legs.length < count; j--) {
    const from = pts[j - 1], to = pts[j];
    if (Math.abs(to.price - from.price) < minLegAtr * ctx.atr[to.i]) continue;
    legs.push({ from, to, d: to.price > from.price ? 1 : -1, len: Math.abs(to.price - from.price), tentative: j === pts.length - 1 && !!tentative });
  }
  return legs;
}

export function detect(ctx) {
  const o = { ...FIB_DEFAULTS, ...ctx.opts.fibonacci };
  const out = [];
  const price = ctx.price, tol = o.nearAtr * ctx.atrNow;
  // 0) Fib kesişimi (ABC): her iki pencere denenir, fiyata en yakın geçerli bölge alınır
  {
    const cands = [];
    for (const k of o.clusterKs?.length ? o.clusterKs : [ctx.opts.swingK]) {
      const { pivots, tentative } = ctx.pivots(k);
      const w = clusterWindow(pivots, tentative);
      for (const pts of [w?.confirmed, w?.withTent]) { if (!pts) continue; const c = fibClusterOf(pts, ctx.atrNow, o); if (c) cands.push({ c, pts, k }); }
    }
    const pick = cands.filter(({ c }) => c.d * (price - c.mid) >= -0.5 * ctx.atrNow && Math.abs(price - c.mid) <= 8 * ctx.atrNow).sort((a, b) => Math.abs(price - a.c.mid) - Math.abs(price - b.c.mid))[0];
    if (pick) {
      const { c, pts } = pick, dist = Math.abs(price - c.mid) / ctx.atrNow;
      const golden = c.retr === 0.618 && c.ext === 1.272;
      out.push(signal({
        id: `fib|cluster|${pts[0].i}|${pts[3].i}`, type: 'fibonacci', group: 'fib',
        name: `Fib kesişimi ${String(c.retr).replace('0.', '0,')}×${String(c.ext).replace('.', ',')}`, direction: c.d === 1 ? 'long' : 'short',
        strength: (golden ? 0.75 : 0.6) * (dist <= 1 ? 1 : 0.85),
        zone: [c.mid - 0.25 * ctx.atrNow, c.mid + 0.25 * ctx.atrNow], index: ctx.last, status: dist <= o.nearAtr ? 'active' : 'forming',
        entry: c.mid, stop: c.stop, target: c.tp1, invalidation: c.invalid,
        note: `İtki ${trNum(pts[0].price, c.mid)} → ${trNum(pts[1].price, c.mid)}: %${(c.retr * 100).toFixed(1).replace('.0', '').replace('.', ',')} geri çekilmesi ${trNum(c.lr, c.mid)}. A bacağı ${trNum(pts[1].price, c.mid)} → ${trNum(pts[2].price, c.mid)}, B ${trNum(pts[3].price, c.mid)}: C = B ${c.d === 1 ? '−' : '+'} ${fibTxt(c.ext)}×A → ${trNum(c.le, c.mid)}. İkisi aynı yerde (fark ${String(c.diff).replace('.', ',')}×ATR); yön itkinin yönü. Hedef itki ucu ${trNum(c.tp1, c.mid)}, sonra ${trNum(c.tp2, c.mid)}.`,
        draw: [{ kind: 'hline', price: c.mid, color: '#7cc4a8', label: `Giriş ${c.retr}×${c.ext}`, style: 'solid' }, { kind: 'hline', price: c.stop, color: '#ef7d7d', label: 'Stop', style: 'dashed' }, { kind: 'hline', price: c.tp1, color: '#4cc24c', label: 'H1 (itki ucu)', style: 'dotted' }, { kind: 'hline', price: c.tp2, color: '#4cc24c', label: 'H2', style: 'dotted' },
          ...clusterDraw(pts, c, ctx.last)],
        meta: { retr: c.retr, ext: c.ext, diffAtr: c.diff, target2: c.tp2, bRet: c.bRet, points: pts.map((p) => ({ i: p.i, price: p.price })) },
      }));
    }
  }
  if (o.only === 'cluster') return out;
  const legs = recentLegs(ctx, o.legs, o.minLegAtr);
  if (!legs.length) return out;
  const levelsAll = [];
  legs.forEach((leg, li) => {
    const { from, to, d, len } = leg;
    // Geri çekilme: bacağın ucundan geriye
    for (const r of o.retr) {
      const p = to.price - d * r * len;
      levelsAll.push({ leg: li, kind: 'retr', r, price: p, dir: d === 1 ? 'long' : 'short', label: `%${(r * 100).toFixed(1).replace('.0', '')}` });
    }
    // Uzantı: bacağın bitiminden sonraki düzeltmeden hedef — basitçe ucun ötesi
    for (const r of o.ext) {
      const p = from.price + d * r * len;
      levelsAll.push({ leg: li, kind: 'ext', r, price: p, dir: d === 1 ? 'long' : 'short', label: `${r}×` });
    }
  });
  // 1) Fiyatın şu an üstünde durduğu geri çekilme seviyeleri (son bacak öncelikli)
  const atLevel = levelsAll.filter((l) => l.kind === 'retr' && Math.abs(price - l.price) <= tol);
  for (const l of atLevel) {
    const leg = legs[l.leg];
    const golden = l.r === 0.618 || l.r === 0.705 || l.r === 0.786;
    out.push(signal({
      id: `fib|retr|${l.leg}|${l.r}`, type: 'fibonacci', group: 'fib',
      name: `Fib ${l.label}`, direction: l.dir,
      strength: (golden ? 0.55 : 0.4) * (l.leg === 0 ? 1 : 0.8),
      zone: [l.price - tol, l.price + tol], index: ctx.last, status: 'active',
      invalidation: leg.from.price,
      target: leg.to.price,
      note: `Fiyat son ${leg.d === 1 ? 'yükseliş' : 'düşüş'} bacağının ${l.label} geri çekilme seviyesinde${golden ? ' (altın bölge)' : ''}.`,
      draw: [{ kind: 'hline', price: l.price, color: '#7cc4a8', label: `Fib ${l.label}`, style: 'dashed' }],
      meta: { r: l.r, leg: l.leg, legFrom: leg.from.price, legTo: leg.to.price },
    }));
  }
  // 2) Çakışma: iki bacağın seviyeleri aynı fiyatta (≤ 0.5 ATR); fiyata en yakın 2 tanesi
  if (legs.length >= 2) {
    const a = levelsAll.filter((l) => l.leg === 0), b = levelsAll.filter((l) => l.leg === 1);
    const pairs = [];
    for (const x of a) for (const y of b) {
      if (Math.abs(x.price - y.price) > 0.5 * ctx.atrNow) continue;
      const mid = (x.price + y.price) / 2;
      const dist = Math.abs(price - mid) / ctx.atrNow;
      if (dist > 4) continue;
      pairs.push({ x, y, mid, dist });
    }
    pairs.sort((p, q) => p.dist - q.dist);
    for (const { x, y, mid, dist } of pairs.slice(0, 2)) {
      const dir = x.kind === 'retr' ? x.dir : y.kind === 'retr' ? y.dir : x.dir;
      out.push(signal({
        id: `fib|conf|${x.r}|${y.r}`, type: 'fibonacci', group: 'fib',
        name: 'Fib çakışması', direction: dir,
        strength: dist <= 1 ? 0.6 : 0.4,
        zone: [Math.min(x.price, y.price) - 0.1 * ctx.atrNow, Math.max(x.price, y.price) + 0.1 * ctx.atrNow],
        index: ctx.last, status: dist <= o.nearAtr ? 'active' : 'forming',
        note: `Son bacağın ${x.kind === 'retr' ? 'geri çekilme' : 'uzantı'} ${x.label} ile önceki bacağın ${y.kind === 'retr' ? 'geri çekilme' : 'uzantı'} ${y.label} seviyesi çakışıyor (fiyata ${dist.toFixed(1)}×ATR).`,
        draw: [{ kind: 'hline', price: mid, color: '#7cc4a8', label: `Fib ${x.label}≈${y.label}`, style: 'solid' }],
        meta: { a: x, b: y, dist },
      }));
    }
  }
  // 3) Uzantı hedefleri (bilgi, nötr-trend yönlü; en yakın 2)
  const leg = legs[0];
  const exts = levelsAll.filter((l) => l.leg === 0 && l.kind === 'ext' && leg.d * (l.price - price) > 0).slice(0, 2);
  for (const l of exts) {
    out.push(signal({
      id: `fib|ext|${l.r}`, type: 'fibonacci', group: 'fib',
      name: `Fib hedef ${l.label}`, direction: l.dir, strength: 0.15,
      zone: [l.price - 0.2 * ctx.atrNow, l.price + 0.2 * ctx.atrNow], index: ctx.last, status: 'forming',
      target: l.price,
      note: `Son bacağın ${l.label} uzantısı: olası hedef.`,
      draw: [{ kind: 'hline', price: l.price, color: '#7cc4a8', label: `Hedef ${l.label}`, style: 'dotted' }],
      meta: { r: l.r },
    }));
  }
  return out;
}
