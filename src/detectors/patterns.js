// Klasik grafik formasyonları (pivot geometrisi): double/triple top-bottom, omuz-baş-omuz (+ters),
// simetrik / genişleyen üçgen, rising / falling wedge, dikdörtgen, bayrak / flama, fincan-kulp.
// Yükselen / alçalan üçgenler scan/triangle.js'ten gelir (triangles detector).
import { signal } from '../core/signal.js';
import { findTriangles, pickTriangles, TRI_DEFAULTS } from '../scan/triangle.js';

export const PATTERN_DEFAULTS = {
  tolAtr: 0.6, // "eşit" sayılan tepe/dip farkı (× ATR)
  maxAge: 25, // formasyonun son pivotu bu kadar mumdan eski olmamalı
  minPivots: 5,
};

const eq = (a, b, tol) => Math.abs(a - b) <= tol;

/** Doğru uydurma (en küçük kareler): {slope, intercept} (x = mum indeksi). */
function fit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { sx += p.i; sy += p.price; sxx += p.i * p.i; sxy += p.i * p.price; }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n, at: (i) => slope * i + (sy - slope * sx) / n };
}

function breakState(ctx, level, dir, from) {
  // dir 1: seviyenin üstüne kapanış aranıyor
  for (let i = from; i <= ctx.last; i++) {
    if (dir === 1 ? ctx.closes[i] > level : ctx.closes[i] < level) return { broken: true, at: i };
  }
  return { broken: false, at: -1 };
}

export function findClassic(ctx, o) {
  const out = [];
  const { last, atrNow, price } = ctx;
  const P = ctx.swings.filter((p) => last - p.i <= 200);
  const tent = ctx.pivots(ctx.opts.swingK).tentative;
  const tol = o.tolAtr * atrNow;
  const pts = tent ? [...P, tent] : P;
  const recentOk = (p) => last - p.i <= o.maxAge;

  // --- Double / triple top-bottom ve H&S: aynı tipten son 2–3 pivot
  for (const type of ['H', 'L']) {
    const d = type === 'H' ? -1 : 1; // formasyonun ima ettiği yön
    const same = pts.filter((p) => p.type === type);
    const opp = pts.filter((p) => p.type !== type);
    if (same.length >= 2) {
      const b = same[same.length - 1], a = same[same.length - 2];
      const mid = opp.find((p) => p.i > a.i && p.i < b.i);
      if (mid && recentOk(b) && b.i - a.i >= 6) {
        const height = Math.abs(((a.price + b.price) / 2) - mid.price);
        if (eq(a.price, b.price, tol) && height >= 1.5 * atrNow) {
          // Triple?
          const c = same[same.length - 3];
          const mid2 = c ? opp.find((p) => p.i > c.i && p.i < a.i) : null;
          const triple = c && mid2 && eq(c.price, a.price, tol) && eq(mid2.price, mid.price, 1.5 * tol);
          const neck = triple ? (type === 'H' ? Math.min(mid.price, mid2.price) : Math.max(mid.price, mid2.price)) : mid.price;
          const br = breakState(ctx, neck, d, b.i + 1);
          const name = `${triple ? 'Üçlü' : 'İkili'} ${type === 'H' ? 'tepe' : 'dip'}`;
          out.push({
            kind: 'double', name, dir: d, pivots: triple ? [c, mid2, a, mid, b] : [a, mid, b], neck, height,
            status: br.broken ? 'confirmed' : 'forming', brokenAt: br.at, target: neck + d * height, invalidation: type === 'H' ? Math.max(a.price, b.price) : Math.min(a.price, b.price),
          });
        }
        // H&S: a = sol omuz? Üç aynı tip pivot: omuz-baş-omuz (baş ortada en uç)
        const c = same[same.length - 3];
        if (c) {
          const head = a, ls = c, rs = b; // c-a-b: sol omuz, baş, sağ omuz
          const headExtreme = type === 'H' ? head.price > ls.price + 0.5 * atrNow && head.price > rs.price + 0.5 * atrNow : head.price < ls.price - 0.5 * atrNow && head.price < rs.price - 0.5 * atrNow;
          const shouldersEq = eq(ls.price, rs.price, 2 * tol);
          const n1 = opp.find((p) => p.i > ls.i && p.i < head.i), n2 = opp.find((p) => p.i > head.i && p.i < rs.i);
          if (headExtreme && shouldersEq && n1 && n2 && recentOk(rs)) {
            const line = fit([n1, n2]);
            const neckNow = line.at(last);
            const height = Math.abs(head.price - line.at(head.i));
            const br = breakState(ctx, neckNow, d, rs.i + 1);
            out.push({
              kind: 'hs', name: type === 'H' ? 'Omuz-baş-omuz' : 'Ters omuz-baş-omuz', dir: d,
              pivots: [ls, n1, head, n2, rs], neck: neckNow, neckLine: line, height,
              status: br.broken ? 'confirmed' : 'forming', brokenAt: br.at, target: neckNow + d * height, invalidation: head.price,
            });
          }
        }
      }
    }
  }

  // --- Üçgen / wedge / dikdörtgen / genişleyen: son 5–6 pivot, üst ve alt çizgi
  if (pts.length >= o.minPivots) {
    const win = pts.slice(-6);
    const hs = win.filter((p) => p.type === 'H'), ls = win.filter((p) => p.type === 'L');
    if (hs.length >= 2 && ls.length >= 2 && recentOk(win[win.length - 1])) {
      const up = fit(hs), lo = fit(ls);
      const span = win[win.length - 1].i - win[0].i;
      const su = (up.slope * span) / atrNow, sl = (lo.slope * span) / atrNow; // pencere boyunca ATR cinsinden eğim
      const flat = 0.8;
      const widthStart = up.at(win[0].i) - lo.at(win[0].i), widthEnd = up.at(last) - lo.at(last);
      const converging = widthEnd < 0.7 * widthStart, diverging = widthEnd > 1.3 * widthStart;
      // Çizgilere uyum: tüm tepeler üst çizgiye, dipler alt çizgiye tol içinde
      const fitOk = hs.every((p) => Math.abs(p.price - up.at(p.i)) <= 1.2 * tol) && ls.every((p) => Math.abs(p.price - lo.at(p.i)) <= 1.2 * tol);
      if (fitOk && widthStart > 2 * atrNow) {
        let kind = null, name = '', dir = 0, bias = '';
        if (Math.abs(su) <= flat && Math.abs(sl) <= flat) { kind = 'rect'; name = 'Dikdörtgen (yatay kanal)'; dir = 0; }
        else if (converging && su < -flat && sl > flat) { kind = 'symtri'; name = 'Simetrik üçgen'; dir = 0; }
        else if (converging && su > flat && sl > flat) { kind = 'rwedge'; name = 'Rising wedge'; dir = -1; }
        else if (converging && su < -flat && sl < -flat) { kind = 'fwedge'; name = 'Falling wedge'; dir = 1; }
        else if (diverging && su > flat && sl < -flat) { kind = 'expand'; name = 'Genişleyen üçgen'; dir = 0; }
        else if (!converging && !diverging && su > flat && sl > flat) { kind = 'chan'; name = 'Yükselen kanal'; dir = 0; bias = 'up'; }
        else if (!converging && !diverging && su < -flat && sl < -flat) { kind = 'chan'; name = 'Alçalan kanal'; dir = 0; bias = 'down'; }
        if (kind) {
          const upNow = up.at(last), loNow = lo.at(last);
          const brUp = breakState(ctx, upNow, 1, win[win.length - 1].i + 1), brDn = breakState(ctx, loNow, -1, win[win.length - 1].i + 1);
          const status = brUp.broken ? 'broken-up' : brDn.broken ? 'broken-down' : 'forming';
          const height = Math.max(widthStart, widthEnd);
          out.push({ kind, name, dir: status === 'broken-up' ? 1 : status === 'broken-down' ? -1 : dir, bias, pivots: win, upper: up, lower: lo, upNow, loNow, status, brokenAt: brUp.at >= 0 ? brUp.at : brDn.at, height, target: status === 'broken-up' ? upNow + height : status === 'broken-down' ? loNow - height : null, invalidation: null });
        }
      }
    }
  }

  // --- Bayrak / flama: güçlü itki (≥ 4 ATR, ≤ 15 mum) + küçük geri çekilme kanalı (≤ %50, 4–20 mum)
  if (pts.length >= 3) {
    const [a, b] = pts.slice(-3, -1);
    const impulse = Math.abs(b.price - a.price), dirI = b.price > a.price ? 1 : -1;
    const bars = b.i - a.i;
    const sinceB = last - b.i;
    if (impulse >= 4 * atrNow && bars <= 15 && sinceB >= 4 && sinceB <= 20) {
      const after = ctx.candles.slice(b.i + 1);
      const retr = dirI === 1 ? (b.price - Math.min(...after.map((c) => c.low))) / impulse : (Math.max(...after.map((c) => c.high)) - b.price) / impulse;
      if (retr <= 0.5 && retr >= 0.05) {
        const pole = { from: a, to: b };
        const level = dirI === 1 ? Math.max(...after.slice(-5).map((c) => c.high)) : Math.min(...after.slice(-5).map((c) => c.low));
        out.push({ kind: 'flag', name: dirI === 1 ? 'Boğa bayrağı' : 'Ayı bayrağı', dir: dirI, pivots: [a, b], pole, retr, status: 'forming', target: (dirI === 1 ? price : price) + dirI * impulse, invalidation: dirI === 1 ? b.price - 0.62 * impulse : b.price + 0.62 * impulse, level });
      }
    }
  }

  // --- Fincan-kulp (yükseliş): H_a ≈ H_b (rim), arada derin L, sonra sığ L_h (kulp ≤ 1/3 derinlik), fiyat rim yakınında
  const hsAll = pts.filter((p) => p.type === 'H'), lsAll = pts.filter((p) => p.type === 'L');
  if (hsAll.length >= 2 && lsAll.length >= 2) {
    const hb = hsAll[hsAll.length - 1], ha = hsAll[hsAll.length - 2];
    const cupLow = lsAll.filter((p) => p.i > ha.i && p.i < hb.i).sort((x, y) => x.price - y.price)[0];
    const handle = lsAll.find((p) => p.i > hb.i);
    if (cupLow && handle && eq(ha.price, hb.price, 2 * tol) && hb.i - ha.i >= 15) {
      const depth = ha.price - cupLow.price;
      const hd = hb.price - handle.price;
      if (depth >= 3 * atrNow && hd > 0 && hd <= depth / 3 && recentOk(handle)) {
        const rim = Math.max(ha.price, hb.price);
        const br = breakState(ctx, rim, 1, handle.i + 1);
        out.push({ kind: 'cup', name: 'Fincan-kulp', dir: 1, pivots: [ha, cupLow, hb, handle], neck: rim, height: depth, status: br.broken ? 'confirmed' : 'forming', brokenAt: br.at, target: rim + depth, invalidation: handle.price });
      }
    }
  }
  return out;
}

export function detect(ctx) {
  const o = { ...PATTERN_DEFAULTS, ...ctx.opts.patterns };
  const out = [];
  if (ctx.n < 60) return out;
  for (const p of findClassic(ctx, o)) {
    const lastP = p.pivots[p.pivots.length - 1];
    const age = ctx.last - lastP.i;
    const confirmed = p.status === 'confirmed' || p.status === 'broken-up' || p.status === 'broken-down';
    const dir = p.dir === 1 ? 'long' : p.dir === -1 ? 'short' : 'neutral';
    const base = { double: 0.55, hs: 0.65, symtri: 0.4, rwedge: 0.5, fwedge: 0.5, rect: 0.35, expand: 0.3, chan: 0.3, flag: 0.5, cup: 0.55 }[p.kind] ?? 0.4;
    const draw = [];
    if (p.kind === 'double' || p.kind === 'hs' || p.kind === 'cup') {
      draw.push({ kind: 'line', points: p.pivots.map((q) => ({ i: q.i, price: q.price })), color: '#9085e9', label: p.name });
      draw.push({ kind: 'hline', price: p.neck, color: '#9085e9', label: 'Boyun', style: 'dashed' });
    } else if (p.kind === 'flag') {
      draw.push({ kind: 'line', points: [{ i: p.pole.from.i, price: p.pole.from.price }, { i: p.pole.to.i, price: p.pole.to.price }], color: '#9085e9', label: 'Direk' });
    } else {
      const f = p.pivots[0].i;
      draw.push({ kind: 'line', points: [{ i: f, price: p.upper.at(f) }, { i: ctx.last, price: p.upNow }], color: '#9085e9', label: p.name });
      draw.push({ kind: 'line', points: [{ i: f, price: p.lower.at(f) }, { i: ctx.last, price: p.loNow }], color: '#9085e9', label: '' });
    }
    if (p.target != null) draw.push({ kind: 'hline', price: p.target, color: '#7cc4a8', label: 'Hedef', style: 'dotted' });
    const zone = p.kind === 'double' || p.kind === 'hs' || p.kind === 'cup' ? [p.neck - 0.3 * ctx.atrNow, p.neck + 0.3 * ctx.atrNow]
      : p.kind === 'flag' ? [Math.min(p.level, ctx.price), Math.max(p.level, ctx.price)] : [p.loNow, p.upNow];
    out.push(signal({
      id: `pattern|${p.kind}|${p.pivots[0].i}|${lastP.i}`, type: 'patterns', group: 'pattern',
      name: `${p.name}${confirmed ? ' ✓' : ''}`, direction: dir,
      strength: Math.min(1, base * (confirmed ? 1.25 : 1) * Math.max(0.5, 1 - age / 60)),
      zone, index: confirmed ? p.brokenAt : lastP.i, status: confirmed ? 'triggered' : 'forming',
      invalidation: p.invalidation ?? undefined, target: p.target ?? undefined,
      note: `${p.name} ${confirmed ? 'kırılımla onaylandı' : 'oluşuyor'}${p.bias ? ` (${p.bias === 'up' ? 'yükselen' : 'alçalan'})` : ''}${p.retr != null ? `, geri çekilme %${Math.round(p.retr * 100)}` : ''}.`,
      draw, meta: { kind: p.kind, status: p.status, age },
    }));
  }
  return out;
}

/** Yükselen / alçalan üçgen (scan/triangle.js) sarmalayıcısı. */
export function detectTriangles(ctx) {
  const o = { ...TRI_DEFAULTS, ...ctx.opts.triangles };
  const out = [];
  if (ctx.n < 60) return out;
  for (const t of pickTriangles(findTriangles(ctx.candles, o, ctx.live), o)) {
    const L = t.levels;
    out.push(signal({
      id: `tri|${t.type}|${t.first.i}|${t.endPivot.i}`, type: 'triangles', group: 'pattern',
      name: `${t.typeLabel} (${t.stateLabel})`, direction: t.direction,
      strength: Math.min(1, (t.score / 100) * (t.state === 'broken' ? 1.1 : t.state === 'near' ? 1 : 0.8)),
      zone: [L.entry - 0.4 * ctx.atrNow, L.entry + 0.4 * ctx.atrNow], index: t.breakIdx >= 0 ? t.breakIdx : t.endPivot.i,
      status: t.state === 'broken' ? 'triggered' : 'forming',
      entry: L.entry, stop: L.stop, target: L.main.price, invalidation: L.stop,
      note: `${t.typeLabel}, ${t.touches.flat} düz + ${t.touches.slope} eğik dokunuş, ${t.contextLabel}; R:R ${t.rr.toFixed(1)}.`,
      draw: [
        { kind: 'line', points: [{ i: t.first.i, price: t.level }, { i: ctx.last, price: t.level }], color: '#f0c75e', label: 'Düz kenar' },
        { kind: 'line', points: [{ i: t.slopeLine.i1, price: t.slopeLine.p1 }, { i: ctx.last, price: t.slopeLine.p1 + ((t.slopeLine.p2 - t.slopeLine.p1) * (ctx.last - t.slopeLine.i1)) / (t.slopeLine.i2 - t.slopeLine.i1) }], color: '#5299ec', label: 'Eğik kenar' },
        { kind: 'hline', price: L.stop, color: '#ef5350', label: 'Stop', style: 'dashed' },
        { kind: 'hline', price: L.main.price, color: '#7cc4a8', label: 'Hedef', style: 'dashed' },
      ],
      meta: { score: t.score, rr: t.rr, state: t.state, type: t.type },
    }));
  }
  return out;
}
