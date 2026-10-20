// Likidite: eşit tepeler/dipler (EQH/EQL), likidite süpürmesi (sweep / stop hunt), önceki gün / hafta H-L.
// Sweep: fitil seviyeyi geçer, kapanış geri döner → ters yön sinyali. Kapanış da geçerse kırılım (breakout).
import { signal } from '../core/signal.js';

export const LIQ_DEFAULTS = {
  eqTolAtr: 0.2, // eşit sayılan tepeler arası fark ≤ bu × ATR
  sweepBars: 12, // son bu kadar mumdaki süpürmeler
  maxAge: 150,
};

/** Eşit tepeler/dipler: aynı tipten ardışık (arada en fazla 3 pivot) pivot çiftleri. */
export function equalLevels(pivots, atr, tolAtr) {
  const out = [];
  for (let a = 0; a < pivots.length; a++) {
    const p = pivots[a];
    const group = [p];
    for (let b = a + 2; b < Math.min(pivots.length, a + 7); b += 2) {
      const q = pivots[b];
      if (q.type !== p.type) break;
      if (Math.abs(q.price - p.price) <= tolAtr * atr[q.i]) group.push(q);
      else if (p.type === 'H' ? q.price > p.price + tolAtr * atr[q.i] : q.price < p.price - tolAtr * atr[q.i]) break; // seviye aşıldı
    }
    if (group.length >= 2) {
      const level = p.type === 'H' ? Math.max(...group.map((g) => g.price)) : Math.min(...group.map((g) => g.price));
      out.push({ type: p.type, level, touches: group, from: group[0].i, to: group[group.length - 1].i });
      a += (group.length - 1) * 2; // grubu atla
    }
  }
  return out;
}

/** Seviye üstünde/altında süpürme: fitil geçer, kapanış dönmez(breakout) / döner(sweep). */
export function sweepsOf(ctx, level, type, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const c = ctx.candles[i];
    if (type === 'H' && c.high > level) out.push({ i, kind: c.close < level ? 'sweep' : 'break', depth: c.high - level });
    if (type === 'L' && c.low < level) out.push({ i, kind: c.close > level ? 'sweep' : 'break', depth: level - c.low });
  }
  return out;
}

export function detect(ctx) {
  const o = { ...LIQ_DEFAULTS, ...ctx.opts.liquidity };
  const out = [];
  const { last, price } = ctx;
  const pivots = ctx.minor.filter((p) => last - p.i <= o.maxAge);
  const atrNow = ctx.atrNow;

  // 1) Eşit tepeler / dipler
  for (const lv of equalLevels(pivots, ctx.atr, o.eqTolAtr)) {
    const sw = sweepsOf(ctx, lv.level, lv.type, lv.to + 1, last);
    const brk = sw.find((s) => s.kind === 'break');
    const sweep = [...sw].reverse().find((s) => s.kind === 'sweep' && (!brk || s.i < brk.i));
    const label = lv.type === 'H' ? 'EQH' : 'EQL';
    if (brk) {
      // Seviye kapanışla geçildi: likidite alındı, yapı o yönde ilerledi
      if (last - brk.i <= o.sweepBars) {
        out.push(signal({
          id: `liq|break|${lv.type}|${lv.from}`, type: 'liquidity', group: 'smc',
          name: `${label} kırıldı`, direction: lv.type === 'H' ? 'long' : 'short', strength: 0.4,
          zone: [lv.level - 0.2 * atrNow, lv.level + 0.2 * atrNow], index: brk.i, status: 'active',
          note: `${lv.touches.length} ${lv.type === 'H' ? 'eşit tepe' : 'eşit dip'} seviyesi kapanışla geçildi (${last - brk.i} mum önce).`,
          draw: [{ kind: 'line', points: [{ i: lv.from, price: lv.level }, { i: brk.i, price: lv.level }], color: '#c98500', label, style: 'dotted' }],
          meta: { level: lv.level, touches: lv.touches.length },
        }));
      }
      continue;
    }
    if (sweep && last - sweep.i <= o.sweepBars) {
      out.push(signal({
        id: `liq|sweep|${lv.type}|${lv.from}`, type: 'liquidity', group: 'smc',
        name: lv.type === 'H' ? 'BSL süpürüldü' : 'SSL süpürüldü',
        direction: lv.type === 'H' ? 'short' : 'long',
        strength: Math.min(1, 0.55 + 0.1 * (lv.touches.length - 2) + Math.min(0.2, sweep.depth / atrNow / 5)),
        zone: [lv.level - 0.25 * atrNow, lv.level + 0.25 * atrNow], index: sweep.i, status: 'active',
        invalidation: lv.type === 'H' ? ctx.highs[sweep.i] : ctx.lows[sweep.i],
        note: `${lv.touches.length} ${lv.type === 'H' ? 'eşit tepenin üstündeki alış' : 'eşit dibin altındaki satış'} likiditesi fitille alındı, kapanış geri döndü (${last - sweep.i} mum önce).`,
        draw: [
          { kind: 'line', points: [{ i: lv.from, price: lv.level }, { i: sweep.i, price: lv.level }], color: '#c98500', label, style: 'dotted' },
          { kind: 'marker', i: sweep.i, price: lv.type === 'H' ? ctx.highs[sweep.i] : ctx.lows[sweep.i], position: lv.type === 'H' ? 'aboveBar' : 'belowBar', shape: 'circle', color: '#c98500', text: 'sweep' },
        ],
        meta: { level: lv.level, touches: lv.touches.length, depthAtr: sweep.depth / atrNow },
      }));
    } else if (!sweep) {
      // Hâlâ alınmamış likidite havuzu: fiyat yakınsa hedef/mıknatıs
      const dist = Math.abs(price - lv.level) / atrNow;
      if (dist <= 3) {
        out.push(signal({
          id: `liq|pool|${lv.type}|${lv.from}`, type: 'liquidity', group: 'smc',
          name: lv.type === 'H' ? `${label} (alınmamış)` : `${label} (alınmamış)`,
          direction: 'neutral', strength: 0.3,
          zone: [lv.level - 0.2 * atrNow, lv.level + 0.2 * atrNow], index: lv.to, status: 'forming',
          note: `${lv.touches.length} ${lv.type === 'H' ? 'eşit tepe' : 'eşit dip'}: ${lv.type === 'H' ? 'üstünde' : 'altında'} stoplar birikmiş olabilir (fiyata ${dist.toFixed(1)}×ATR).`,
          draw: [{ kind: 'line', points: [{ i: lv.from, price: lv.level }, { i: last, price: lv.level }], color: '#c98500', label, style: 'dotted' }],
          meta: { level: lv.level, touches: lv.touches.length, dist },
        }));
      }
    }
  }

  // 2) Önceki gün / hafta H-L (gün içi TF'lerde)
  const periods = [];
  if (ctx.tfInfo.ms < 86400e3 && ctx.days.length >= 2) periods.push({ name: 'PD', d: ctx.days[ctx.days.length - 2], label: 'önceki gün' });
  if (ctx.tfInfo.ms <= 4 * 3600e3 && ctx.weeks.length >= 2) periods.push({ name: 'PW', d: ctx.weeks[ctx.weeks.length - 2], label: 'önceki hafta' });
  for (const p of periods) {
    for (const [type, level] of [['H', p.d.high], ['L', p.d.low]]) {
      const sw = sweepsOf(ctx, level, type, p.d.to + 1, last);
      const lastSw = sw[sw.length - 1];
      const name = `${p.name}${type}`;
      if (lastSw && lastSw.kind === 'sweep' && last - lastSw.i <= o.sweepBars && !sw.some((s) => s.kind === 'break' && s.i > lastSw.i)) {
        out.push(signal({
          id: `liq|${name}|sweep`, type: 'liquidity', group: 'smc',
          name: `${name} süpürüldü`, direction: type === 'H' ? 'short' : 'long', strength: 0.5,
          zone: [level - 0.25 * atrNow, level + 0.25 * atrNow], index: lastSw.i, status: 'active',
          note: `${p.label} ${type === 'H' ? 'yükseği' : 'düşüğü'} fitille geçildi, kapanış geri döndü.`,
          draw: [{ kind: 'hline', price: level, color: '#f0c75e', label: name, style: 'dotted' }],
          meta: { level },
        }));
      } else if (!sw.length && Math.abs(price - level) / atrNow <= 2) {
        out.push(signal({
          id: `liq|${name}|near`, type: 'liquidity', group: 'smc',
          name: `${name} yakın`, direction: 'neutral', strength: 0.25,
          zone: [level - 0.2 * atrNow, level + 0.2 * atrNow], index: last, status: 'forming',
          note: `Fiyat ${p.label} ${type === 'H' ? 'yükseğine' : 'düşüğüne'} yakın; henüz alınmamış likidite.`,
          draw: [{ kind: 'hline', price: level, color: '#f0c75e', label: name, style: 'dotted' }],
          meta: { level },
        }));
      }
    }
  }
  return out;
}
