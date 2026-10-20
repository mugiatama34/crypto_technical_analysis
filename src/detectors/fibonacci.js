// Fibonacci: son anlamlı bacağın geri çekilme seviyeleri, uzantı hedefleri, seviye çakışmaları (confluence).
// Seviyeler TradingView ile aynı olsun diye doğrusal ölçek.
import { signal } from '../core/signal.js';

export const FIB_DEFAULTS = {
  retr: [0.382, 0.5, 0.618, 0.705, 0.786, 0.886],
  ext: [1.272, 1.414, 1.618, 2.0, 2.618],
  nearAtr: 0.35, // fiyat seviyeye bu × ATR içinde ise "seviyede"
  legs: 2, // kaç bacak geriye bakılır (son ve bir önceki)
  minLegAtr: 3, // bacak boyu en az bu × ATR
};

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
  const legs = recentLegs(ctx, o.legs, o.minLegAtr);
  if (!legs.length) return out;
  const price = ctx.price, tol = o.nearAtr * ctx.atrNow;
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
