// Uyumsuzluk (divergence): fiyat pivotları ile RSI / MACD histogram / OBV değerlerinin karşılaştırması.
// Regular (dönüş): fiyat LL, gösterge HL → bullish; fiyat HH, gösterge LH → bearish.
// Hidden (devam): fiyat HL, gösterge LL → bullish; fiyat LH, gösterge HH → bearish.
import { signal } from '../core/signal.js';

export const DIV_DEFAULTS = {
  maxAge: 12, // son pivot bu kadar mumdan eski olmamalı
  maxSpan: 60, // iki pivot arası en fazla mum
  minSpan: 4,
};

/** Gösterge dizisinde pivot civarındaki (±2 mum) uç değer. */
function extremeNear(arr, i, type) {
  let best = null;
  for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) {
    const v = arr[j];
    if (v == null) continue;
    if (best == null || (type === 'H' ? v > best : v < best)) best = v;
  }
  return best;
}

export function findDivergences(ctx, o) {
  const out = [];
  const inds = [
    { id: 'RSI', arr: ctx.rsi },
    { id: 'MACD', arr: ctx.macd.hist },
    { id: 'OBV', arr: ctx.obv },
  ];
  const { pivots, tentative } = ctx.pivots(ctx.opts.minorK);
  const pts = tentative ? [...pivots, tentative] : pivots;
  for (const type of ['H', 'L']) {
    const same = pts.filter((p) => p.type === type);
    if (same.length < 2) continue;
    const b = same[same.length - 1], a = same[same.length - 2];
    if (ctx.last - b.i > o.maxAge || b.i - a.i > o.maxSpan || b.i - a.i < o.minSpan) continue;
    for (const ind of inds) {
      const va = extremeNear(ind.arr, a.i, type), vb = extremeNear(ind.arr, b.i, type);
      if (va == null || vb == null) continue;
      const priceUp = b.price > a.price, indUp = vb > va;
      if (type === 'L') {
        if (!priceUp && indUp) out.push({ ind: ind.id, kind: 'regular', dir: 1, a, b, va, vb });
        if (priceUp && !indUp) out.push({ ind: ind.id, kind: 'hidden', dir: 1, a, b, va, vb });
      } else {
        if (priceUp && !indUp) out.push({ ind: ind.id, kind: 'regular', dir: -1, a, b, va, vb });
        if (!priceUp && indUp) out.push({ ind: ind.id, kind: 'hidden', dir: -1, a, b, va, vb });
      }
    }
  }
  return out;
}

export function detect(ctx) {
  const o = { ...DIV_DEFAULTS, ...ctx.opts.divergence };
  if (ctx.candles.length < 40) return [];
  const out = [];
  const divs = findDivergences(ctx, o);
  // Aynı yön + tür için göstergeleri birleştir (RSI+MACD aynı anda → daha güçlü)
  const groups = new Map();
  for (const d of divs) {
    const key = `${d.kind}|${d.dir}|${d.b.i}`;
    if (!groups.has(key)) groups.set(key, { ...d, inds: [] });
    groups.get(key).inds.push(d.ind);
  }
  for (const g of groups.values()) {
    const age = ctx.last - g.b.i;
    const tentative = ctx.pivots(ctx.opts.minorK).tentative?.i === g.b.i;
    const kindTr = g.kind === 'regular' ? 'Uyumsuzluk' : 'Gizli uyumsuzluk';
    out.push(signal({
      id: `div|${g.kind}|${g.dir}|${g.b.i}`, type: 'divergence', group: 'divergence',
      name: `${kindTr} ${g.dir === 1 ? '↑' : '↓'} (${g.inds.join('+')})`,
      direction: g.dir === 1 ? 'long' : 'short',
      strength: Math.min(1, (0.4 + 0.15 * (g.inds.length - 1) + (g.kind === 'regular' ? 0.1 : 0)) * (tentative ? 0.8 : 1) * Math.max(0.5, 1 - age / (2 * o.maxAge))),
      zone: [Math.min(g.a.price, g.b.price) - 0.2 * ctx.atrNow, Math.max(g.a.price, g.b.price) + 0.2 * ctx.atrNow],
      index: g.b.i, status: tentative ? 'forming' : 'active',
      invalidation: g.b.price,
      note: `Fiyat ${g.b.price > g.a.price ? 'daha yüksek' : 'daha düşük'} ${g.b.type === 'H' ? 'tepe' : 'dip'} yaparken ${g.inds.join(', ')} ${g.vb > g.va ? 'yükseldi' : 'düştü'} (${g.kind === 'regular' ? 'dönüş' : 'devam'} sinyali).`,
      draw: [{ kind: 'line', points: [{ i: g.a.i, price: g.a.price }, { i: g.b.i, price: g.b.price }], color: '#199e70', label: `${g.inds.join('+')} div`, style: 'dashed' }],
      meta: { inds: g.inds, kind: g.kind, a: g.a, b: g.b, age },
    }));
  }
  return out;
}
