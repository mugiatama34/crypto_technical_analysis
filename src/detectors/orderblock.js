// Order block: yapı kırılımına (BOS/CHoCH) ya da bir FVG'li yer değiştirmeye yol açan hareketten hemen önceki
// son TERS mum. Yükseliş OB = yukarı hareketten önceki son düşüş mumu (gövde + fitil aralığı).
// Mitigation: fiyat sonradan bölgeye döndü mü; breaker: bölge kapanışla geçildi (ters yönde direnç/destek).
import { signal } from '../core/signal.js';
import { structureEvents } from './structure.js';
import { findFvgs } from './fvg.js';

export const OB_DEFAULTS = {
  lookback: 8, // hareket başlangıcından geriye en fazla bu kadar mumda ters mum aranır
  maxAge: 150,
  keep: 3,
  minMoveAtr: 1.5, // OB'den sonraki hareket en az bu × ATR olmalı (yer değiştirme)
};

/** Hareket başlangıç indeksinden geriye son ters mum. */
function lastOpposite(ctx, start, dir, lookback) {
  for (let j = start; j >= Math.max(0, start - lookback); j--) {
    const bear = ctx.closes[j] < ctx.opens[j], bull = ctx.closes[j] > ctx.opens[j];
    if (dir === 1 && bear) return j;
    if (dir === -1 && bull) return j;
  }
  return -1;
}

export function findOrderBlocks(ctx, o = OB_DEFAULTS) {
  const { highs, lows, closes, last, atr } = ctx;
  const seeds = []; // { dir, start } hareket başlangıç adayları
  // 1) Yapı kırılımları: kırılım mumundan geriye, kırılımı başlatan pivotun (ters uç) civarı
  const { events } = structureEvents(ctx.candles, ctx.swings);
  for (const e of events) {
    if (last - e.i > o.maxAge) continue;
    // Hareket, kırılan pivottan sonraki ters pivotta başlar: swing listesinde pivot'tan sonraki ilk ters pivot
    const sw = ctx.swings;
    const k = sw.findIndex((p) => p.i === e.pivot.i);
    const origin = k >= 0 && sw[k + 1] ? sw[k + 1] : null;
    if (origin) seeds.push({ dir: e.dir, start: origin.i, via: e.kind, at: e.i });
  }
  // 2) FVG'li yer değiştirmeler: boşluğun ilk mumundan geriye
  for (const f of findFvgs(ctx, { minAtr: 0.3, maxAge: o.maxAge, keep: 99 })) {
    seeds.push({ dir: f.dir, start: f.i - 2, via: 'FVG', at: f.i });
  }
  const out = [];
  const seen = new Set();
  for (const s of seeds) {
    const j = lastOpposite(ctx, s.start, s.dir, o.lookback);
    if (j < 0 || seen.has(`${s.dir}|${j}`)) continue;
    seen.add(`${s.dir}|${j}`);
    const lo = lows[j], hi = highs[j];
    // Yer değiştirme: OB'den sonraki 10 mumda hareket
    const after = ctx.candles.slice(j + 1, j + 11);
    if (!after.length) continue;
    const move = s.dir === 1 ? Math.max(...after.map((c) => c.high)) - hi : lo - Math.min(...after.map((c) => c.low));
    if (move < o.minMoveAtr * atr[j]) continue;
    const ob = { i: j, dir: s.dir, lo, hi, via: s.via, move, status: 'fresh', mitigatedAt: null, brokenAt: null };
    // Durum: mitigation / breaker (OB'den sonraki hareket bittikten sonra, yani s.at'tan sonra)
    for (let k = Math.max(j + 1, s.at + 1); k <= last; k++) {
      if (s.dir === 1) {
        if (closes[k] < lo) { ob.status = 'breaker'; ob.brokenAt = k; break; }
        if (ob.mitigatedAt == null && lows[k] <= hi) { ob.mitigatedAt = k; ob.status = 'mitigated'; }
      } else {
        if (closes[k] > hi) { ob.status = 'breaker'; ob.brokenAt = k; break; }
        if (ob.mitigatedAt == null && highs[k] >= lo) { ob.mitigatedAt = k; ob.status = 'mitigated'; }
      }
    }
    out.push(ob);
  }
  return out.sort((a, b) => a.i - b.i);
}

export function detect(ctx) {
  const o = { ...OB_DEFAULTS, ...ctx.opts.orderblock };
  const obs = findOrderBlocks(ctx, o);
  const out = [];
  const price = ctx.price;
  for (const dir of [1, -1]) {
    const live = obs.filter((b) => b.dir === dir && b.status !== 'breaker').slice(-o.keep);
    for (const b of live) {
      const age = ctx.last - b.i;
      const inside = price >= b.lo && price <= b.hi;
      const dist = (dir === 1 ? price - b.hi : b.lo - price) / ctx.atrNow;
      const strength = Math.min(1, 0.4 + (b.status === 'fresh' ? 0.2 : 0.05) + (b.via !== 'FVG' ? 0.1 : 0) + Math.min(0.15, b.move / ctx.atr[b.i] / 20) + (inside ? 0.2 : dist >= 0 && dist < 2 ? 0.1 : 0)) * Math.max(0.5, 1 - age / (2 * o.maxAge));
      out.push(signal({
        id: `ob|${dir === 1 ? 'bull' : 'bear'}|${b.i}`,
        type: 'orderblock', group: 'smc',
        name: dir === 1 ? 'Order Block ↑' : 'Order Block ↓',
        direction: dir === 1 ? 'long' : 'short',
        strength,
        zone: [b.lo, b.hi],
        index: b.i,
        status: inside ? 'triggered' : b.status === 'mitigated' ? 'mitigated' : 'active',
        invalidation: dir === 1 ? b.lo : b.hi,
        entry: dir === 1 ? b.hi : b.lo,
        stop: dir === 1 ? b.lo - 0.1 * ctx.atrNow : b.hi + 0.1 * ctx.atrNow,
        note: `${dir === 1 ? 'Yükseliş' : 'Düşüş'} OB (${b.via} öncesi son ${dir === 1 ? 'düşüş' : 'yükseliş'} mumu), ${b.status === 'fresh' ? 'dokunulmamış' : 'dokunulmuş'}; sonraki hareket ${(b.move / ctx.atr[b.i]).toFixed(1)}×ATR.`,
        draw: [{ kind: 'box', from: b.i, to: ctx.last, lo: b.lo, hi: b.hi, color: dir === 1 ? '#199e70' : '#e66767', label: 'OB' }],
        meta: { via: b.via, status: b.status, age, moveAtr: b.move / ctx.atr[b.i] },
      }));
    }
    const breakers = obs.filter((b) => b.dir === dir && b.status === 'breaker' && ctx.last - b.brokenAt <= 30).slice(-1);
    for (const b of breakers) {
      out.push(signal({
        id: `ob|breaker|${b.i}`,
        type: 'orderblock', group: 'smc',
        name: dir === 1 ? 'Breaker ↓' : 'Breaker ↑',
        direction: dir === 1 ? 'short' : 'long',
        strength: 0.45,
        zone: [b.lo, b.hi],
        index: b.brokenAt,
        status: 'active',
        note: `Kırılmış ${dir === 1 ? 'yükseliş' : 'düşüş'} OB → breaker block (${dir === 1 ? 'direnç' : 'destek'} adayı).`,
        draw: [{ kind: 'box', from: b.i, to: ctx.last, lo: b.lo, hi: b.hi, color: '#9085e9', label: 'Breaker' }],
        meta: { brokenAt: b.brokenAt },
      }));
    }
  }
  return out;
}
