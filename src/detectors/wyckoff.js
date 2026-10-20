// Wyckoff (basitleştirilmiş): yatay birikim/dağıtım aralığı içinde spring (aralık altını süpürüp geri dönüş),
// upthrust (üstünü süpürüp dönüş), SOS (hacimli kapanış aralık üstünde), SOW (hacimli kapanış aralık altında).
import { signal } from '../core/signal.js';

export const WYCKOFF_DEFAULTS = { rangeBars: 60, maxWidthAtr: 8, recent: 6, minTouches: 2 };

/** Son `rangeBars` mumda (son `recent` hariç) yatay aralık: H/L ve kenarlara dokunuş sayısı. */
export function tradingRange(ctx, o) {
  const to = ctx.last - o.recent, from = Math.max(0, to - o.rangeBars);
  if (to - from < 20) return null;
  const seg = ctx.candles.slice(from, to + 1);
  const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low));
  if (hi - lo > o.maxWidthAtr * ctx.atrNow) return null;
  const tol = 0.5 * ctx.atrNow;
  const touchesHi = seg.filter((c) => c.high >= hi - tol).length, touchesLo = seg.filter((c) => c.low <= lo + tol).length;
  if (touchesHi < o.minTouches || touchesLo < o.minTouches) return null;
  // Trend bağlamı: aralıktan önceki 40 mum
  const pre = ctx.candles.slice(Math.max(0, from - 40), from);
  const preMove = pre.length ? pre[pre.length - 1].close - pre[0].close : 0;
  const phase = preMove < -2 * ctx.atrNow ? 'accumulation' : preMove > 2 * ctx.atrNow ? 'distribution' : 'range';
  return { from, to, hi, lo, touchesHi, touchesLo, phase };
}

export function detect(ctx) {
  const o = { ...WYCKOFF_DEFAULTS, ...ctx.opts.wyckoff };
  const out = [];
  if (ctx.n < 80) return out;
  const tr = tradingRange(ctx, o);
  if (!tr) return out;
  const av = ctx.avgVolume;
  const phaseTr = { accumulation: 'birikim', distribution: 'dağıtım', range: 'yatay' }[tr.phase];
  for (let i = tr.to + 1; i <= ctx.last; i++) {
    const c = ctx.candles[i];
    const volHi = av[i] && c.volume >= 1.5 * av[i];
    const add = (id, name, dir, strength, note) => out.push(signal({
      id: `wy|${id}|${i}`, type: 'wyckoff', group: 'wyckoff', name, direction: dir, strength, index: i, status: 'active',
      zone: dir === 'long' ? [tr.lo - 0.3 * ctx.atrNow, tr.lo + 0.3 * ctx.atrNow] : [tr.hi - 0.3 * ctx.atrNow, tr.hi + 0.3 * ctx.atrNow],
      invalidation: dir === 'long' ? c.low : c.high,
      note: `${note} (${phaseTr} aralığı ${tr.lo.toPrecision(5)}–${tr.hi.toPrecision(5)}).`,
      draw: [{ kind: 'box', from: tr.from, to: ctx.last, lo: tr.lo, hi: tr.hi, color: '#e66767', label: 'TR' }],
      meta: { range: [tr.lo, tr.hi], phase: tr.phase, volHi },
    }));
    if (c.low < tr.lo && c.close > tr.lo) add('spring', 'Wyckoff spring', 'long', volHi ? 0.65 : 0.5, 'Aralık altı süpürüldü, kapanış içeri döndü' + (volHi ? ', hacim yüksek' : ''));
    if (c.high > tr.hi && c.close < tr.hi) add('ut', 'Wyckoff upthrust', 'short', volHi ? 0.65 : 0.5, 'Aralık üstü süpürüldü, kapanış içeri döndü' + (volHi ? ', hacim yüksek' : ''));
    if (c.close > tr.hi && volHi) add('sos', 'Wyckoff SOS', 'long', 0.55, 'Hacimli kapanış aralığın üstünde (sign of strength)');
    if (c.close < tr.lo && volHi) add('sow', 'Wyckoff SOW', 'short', 0.55, 'Hacimli kapanış aralığın altında (sign of weakness)');
  }
  // Aralık bilgisi (nötr) — yalnızca olay yoksa
  if (!out.length && ctx.price >= tr.lo && ctx.price <= tr.hi) {
    out.push(signal({
      id: 'wy|range', type: 'wyckoff', group: 'wyckoff', name: `Wyckoff ${phaseTr} aralığı`, direction: 'neutral', strength: 0.2, index: ctx.last, status: 'forming',
      zone: [tr.lo, tr.hi], note: `Fiyat ${tr.to - tr.from} mumluk yatay aralıkta (${tr.touchesHi} üst, ${tr.touchesLo} alt dokunuş).`,
      draw: [{ kind: 'box', from: tr.from, to: ctx.last, lo: tr.lo, hi: tr.hi, color: '#e66767', label: 'TR' }], meta: { range: [tr.lo, tr.hi], phase: tr.phase },
    }));
  }
  return out;
}
