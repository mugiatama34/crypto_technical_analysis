// Mum formasyonları: son 3 mumda (canlı mum hariç) engulfing, pin bar / hammer / shooting star, doji, inside bar,
// morning / evening star, three white soldiers / black crows. Swing noktasına yakınsa güç artar.
import { signal } from '../core/signal.js';

export const CANDLE_DEFAULTS = { lookback: 3 };

function shape(c) {
  const body = Math.abs(c.close - c.open), range = c.high - c.low || 1e-12;
  const upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
  return { body, range, upper, lower, bull: c.close > c.open, bear: c.close < c.open, bodyPct: body / range };
}

/** Tek bir indeksteki formasyonlar. */
export function patternsAt(candles, i, atrAt) {
  const out = [];
  const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
  if (!c || !p) return out;
  const s = shape(c), sp = shape(p);
  const big = s.range >= 0.8 * atrAt; // anlamlı boyut
  // Engulfing
  if (s.bull && sp.bear && c.close > p.open && c.open <= p.close && s.body > sp.body && big) out.push({ name: 'Bullish engulfing', dir: 1, w: 0.6 });
  if (s.bear && sp.bull && c.close < p.open && c.open >= p.close && s.body > sp.body && big) out.push({ name: 'Bearish engulfing', dir: -1, w: 0.6 });
  // Pin bar / hammer / shooting star
  if (s.lower >= 2 * s.body && s.upper <= 0.3 * s.range && big) out.push({ name: s.bull ? 'Hammer' : 'Pin bar ↑', dir: 1, w: 0.5 });
  if (s.upper >= 2 * s.body && s.lower <= 0.3 * s.range && big) out.push({ name: s.bear ? 'Shooting star' : 'Pin bar ↓', dir: -1, w: 0.5 });
  // Doji
  if (s.bodyPct <= 0.1 && big) out.push({ name: 'Doji', dir: 0, w: 0.25 });
  // Inside bar
  if (c.high < p.high && c.low > p.low) out.push({ name: 'Inside bar', dir: 0, w: 0.2 });
  if (pp) {
    const spp = shape(pp);
    // Morning / evening star
    if (spp.bear && sp.bodyPct < 0.3 && s.bull && c.close > (pp.open + pp.close) / 2 && spp.range >= 0.8 * atrAt) out.push({ name: 'Morning star', dir: 1, w: 0.65 });
    if (spp.bull && sp.bodyPct < 0.3 && s.bear && c.close < (pp.open + pp.close) / 2 && spp.range >= 0.8 * atrAt) out.push({ name: 'Evening star', dir: -1, w: 0.65 });
    // Three soldiers / crows
    if (spp.bull && sp.bull && s.bull && p.close > pp.close && c.close > p.close && spp.bodyPct > 0.5 && sp.bodyPct > 0.5 && s.bodyPct > 0.5) out.push({ name: 'Three white soldiers', dir: 1, w: 0.55 });
    if (spp.bear && sp.bear && s.bear && p.close < pp.close && c.close < p.close && spp.bodyPct > 0.5 && sp.bodyPct > 0.5 && s.bodyPct > 0.5) out.push({ name: 'Three black crows', dir: -1, w: 0.55 });
  }
  return out;
}

export function detect(ctx) {
  const o = { ...CANDLE_DEFAULTS, ...ctx.opts.candlesticks };
  const out = [];
  const { candles, last } = ctx;
  if (candles.length < 5) return out;
  const nearSwing = (i) => ctx.swings.some((p) => Math.abs(p.i - i) <= 2) || (ctx.pivots(ctx.opts.swingK).tentative && Math.abs(ctx.pivots(ctx.opts.swingK).tentative.i - i) <= 2);
  for (let i = last; i >= Math.max(2, last - o.lookback + 1); i--) {
    for (const p of patternsAt(candles, i, ctx.atr[i])) {
      const age = last - i;
      const ctxBonus = nearSwing(i) ? 0.2 : 0;
      const c = candles[i];
      out.push(signal({
        id: `candle|${p.name}|${i}`, type: 'candlesticks', group: 'candle',
        name: p.name, direction: p.dir === 1 ? 'long' : p.dir === -1 ? 'short' : 'neutral',
        strength: Math.min(1, (p.w + ctxBonus) * (1 - age * 0.15)),
        zone: [c.low, c.high], index: i, status: 'active',
        invalidation: p.dir === 1 ? c.low : p.dir === -1 ? c.high : undefined,
        note: `${p.name} (${age === 0 ? 'son kapanan mum' : `${age} mum önce`})${ctxBonus ? ', swing noktasında' : ''}.`,
        draw: [{ kind: 'marker', i, price: p.dir === -1 ? c.high : c.low, position: p.dir === -1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: '#c98500', text: p.name }],
        meta: { age },
      }));
    }
  }
  return out;
}
