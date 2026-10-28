// ICT / SMC piyasa yapısı: swing etiketleri (HH/HL/LH/LL), BOS, CHoCH, trend, premium/discount, OTE.
// Saf fonksiyonlar. Pivotlar ctx.swings (ZigZag, k × ATR) — her pivot ancak fiyat ondan k×ATR uzaklaşınca
// onaylanır; kırılım, pivotun ARDINDAN gelen ters pivot oluştuktan sonraki mumlarda aranır (geleceğe bakmaz).
import { signal } from '../core/signal.js';

export const STRUCTURE_DEFAULTS = {
  maxEvents: 3, // sinyal olarak döndürülecek son kırılım sayısı
  recentBars: 30, // bu kadar mumdan eski kırılımlar 'done' sayılır
};

/** Pivotları HH/HL/LH/LL ile etiketler. */
export function labelSwings(pivots) {
  const out = [];
  let lastH = null, lastL = null;
  for (const p of pivots) {
    let label;
    if (p.type === 'H') { label = lastH ? (p.price > lastH.price ? 'HH' : 'LH') : 'H'; lastH = p; }
    else { label = lastL ? (p.price < lastL.price ? 'LL' : 'HL') : 'L'; lastL = p; }
    out.push({ ...p, label });
  }
  return out;
}

/**
 * Yapı kırılımları: her pivot için, ardındaki ters pivottan sonra kapanışla aşılma anı.
 * @returns {{ events: {i, dir, kind:'BOS'|'CHoCH', level, pivot}[], trend: 1|-1|0 }}
 */
export function structureEvents(candles, pivots) {
  const events = [];
  let trend = 0; // 1 yükseliş, −1 düşüş
  // Pivot sırayla; her pivot (j) için kırılım penceresi: pivots[j+1].i+1 .. (bir sonraki aynı tip pivotun kırılımına kadar)
  const pending = []; // kırılmayı bekleyen seviyeler
  for (let j = 0; j < pivots.length; j++) {
    const p = pivots[j];
    const next = pivots[j + 1];
    if (!next) break;
    pending.push({ pivot: p, from: next.i + 1, broken: false });
    // Bu pivotun onayı ile bir sonraki pivot arasında kalan mumlarda eski bekleyenleri kontrol et
    const to = pivots[j + 2] ? pivots[j + 2].i : candles.length - 1;
    for (let i = next.i + 1; i <= to; i++) {
      const c = candles[i];
      for (const q of pending) {
        if (q.broken || i < q.from) continue;
        const up = q.pivot.type === 'H';
        const broke = up ? c.close > q.pivot.price : c.close < q.pivot.price;
        if (!broke) continue;
        q.broken = true;
        const dir = up ? 1 : -1;
        const kind = trend === 0 || trend === dir ? 'BOS' : 'CHoCH';
        trend = dir;
        events.push({ i, dir, kind, level: q.pivot.price, pivot: q.pivot });
      }
    }
    // Aynı tipten daha yeni bir pivot gelince eskisi artık beklenmez (yapı ilerledi)
    for (const q of pending) if (!q.broken && q.pivot.type === p.type && q.pivot.i < p.i) q.broken = true;
  }
  return { events, trend };
}

/** Son bacak (son iki pivot + varsa oluşan uç) → premium/discount, OTE. */
export function dealingRange(ctx) {
  const { pivots, tentative } = ctx.pivots(ctx.opts.swingK);
  if (pivots.length < 2) return null;
  const a = pivots[pivots.length - 2], b = pivots[pivots.length - 1];
  // Oluşan uç, son pivotu aşıyorsa bacağı ona kadar uzat
  const end = tentative && tentative.type !== b.type ? tentative : null;
  const lo = Math.min(a.price, b.price, end?.price ?? Infinity), hi = Math.max(a.price, b.price, end?.price ?? -Infinity);
  const d = b.type === 'H' ? 1 : -1; // son bacak yukarı mı
  const eq = (lo + hi) / 2;
  const price = ctx.price;
  const pos = hi > lo ? (price - lo) / (hi - lo) : 0.5; // 0 = dip, 1 = tepe
  // OTE: bacağın %61,8–%79 geri çekilmesi (yukarı bacakta tepe'den aşağı)
  const ote = d === 1 ? [hi - 0.79 * (hi - lo), hi - 0.618 * (hi - lo)] : [lo + 0.618 * (hi - lo), lo + 0.79 * (hi - lo)];
  return { lo, hi, eq, d, pos, ote, from: a, to: b, end };
}

export function detect(ctx) {
  const o = { ...STRUCTURE_DEFAULTS, ...ctx.opts.structure };
  const pivots = ctx.swings;
  if (pivots.length < 2) return [];
  const { events, trend } = pivots.length >= 3 ? structureEvents(ctx.candles, pivots) : { events: [], trend: 0 };
  const out = [];
  const recent = events.slice(-o.maxEvents);
  for (const e of recent) {
    const age = ctx.last - e.i;
    const dir = e.dir === 1 ? 'long' : 'short';
    out.push(signal({
      id: `structure|${e.kind}|${e.i}`,
      type: 'structure', group: 'smc',
      name: e.kind === 'CHoCH' ? (e.dir === 1 ? 'CHoCH ↑' : 'CHoCH ↓') : (e.dir === 1 ? 'BOS ↑' : 'BOS ↓'),
      direction: dir,
      strength: (e.kind === 'CHoCH' ? 0.7 : 0.55) * Math.max(0.4, 1 - age / (2 * o.recentBars)),
      zone: [e.level - 0.25 * ctx.atr[e.i], e.level + 0.25 * ctx.atr[e.i]],
      index: e.i,
      status: age <= o.recentBars ? 'active' : 'done',
      note: `${e.kind}: kapanış ${e.pivot.type === 'H' ? 'swing tepeyi' : 'swing dibi'} ${e.dir === 1 ? 'yukarı' : 'aşağı'} kırdı (${age} mum önce).`,
      draw: [
        { kind: 'line', points: [{ i: e.pivot.i, price: e.level }, { i: e.i, price: e.level }], color: e.dir === 1 ? '#3987e5' : '#d95926', label: e.kind, style: 'dashed' },
      ],
      meta: { kind: e.kind, level: e.level, age },
    }));
  }
  // Trend + premium/discount özeti (nötr bilgi sinyali, bölge = dealing range)
  const dr = dealingRange(ctx);
  if (dr) {
    const labeled = labelSwings(pivots).slice(-4).map((p) => p.label).join(' ');
    const side = dr.pos < 0.5 ? 'discount' : 'premium';
    const bias = trend === 1 ? 'long' : trend === -1 ? 'short' : 'neutral';
    // Discount'ta yükseliş trendi → long için uygun; premium'da düşüş → short için uygun.
    const aligned = (trend === 1 && side === 'discount') || (trend === -1 && side === 'premium');
    out.push(signal({
      id: 'structure|trend',
      type: 'structure', group: 'smc',
      name: `${trend === 1 ? 'Yükseliş yapısı' : trend === -1 ? 'Düşüş yapısı' : 'Yatay'} · ${side === 'discount' ? 'Discount' : 'Premium'}`,
      direction: bias,
      strength: aligned ? 0.5 : 0.2,
      zone: [dr.lo, dr.hi],
      index: ctx.last,
      status: 'active',
      note: `Son swingler: ${labeled}. Fiyat aralığın %${Math.round(dr.pos * 100)} seviyesinde (${side}); denge ${dr.eq.toPrecision(6)}.`,
      draw: [{ kind: 'hline', price: dr.eq, color: '#a5a39a', label: 'EQ (denge)', style: 'dotted' }],
      meta: { trend, side, pos: dr.pos, eq: dr.eq, range: [dr.lo, dr.hi] },
    }));
    // OTE bölgesi: trend yönünde geri çekilme beklenirken
    const inOte = ctx.price >= dr.ote[0] && ctx.price <= dr.ote[1];
    const near = Math.min(Math.abs(ctx.price - dr.ote[0]), Math.abs(ctx.price - dr.ote[1])) <= ctx.atrNow;
    if (dr.d !== 0 && (inOte || near)) {
      out.push(signal({
        id: 'structure|ote',
        type: 'structure', group: 'smc',
        name: 'OTE bölgesi',
        direction: dr.d === 1 ? 'long' : 'short',
        strength: inOte ? 0.6 : 0.35,
        zone: dr.ote,
        index: ctx.last,
        status: inOte ? 'active' : 'forming',
        note: `Son ${dr.d === 1 ? 'yükseliş' : 'düşüş'} bacağının %61,8–%79 geri çekilme bölgesi${inOte ? ' (fiyat içinde)' : ' (fiyat yakın)'}.`,
        draw: [{ kind: 'box', from: dr.to.i, to: ctx.last, lo: dr.ote[0], hi: dr.ote[1], color: '#3987e5', label: 'OTE' }],
        meta: { ote: dr.ote },
      }));
    }
  }
  return out;
}

/**
 * Grafik katmanı (sinyal değil): son `swings` pivot HH/HL/LH/LL etiketiyle ve son `breaks` BOS/CHoCH kesikli çizgi + etiket.
 * ctx.swings ile aynı pivotlar. → sözde sinyal { id, name, draw } (drawRow'a eklenir).
 */
export function structureOverlay(ctx, { swings = 8, breaks = 4 } = {}) {
  const pivots = ctx.swings || [];
  const draw = [];
  for (const p of labelSwings(pivots).slice(-swings)) {
    const up = p.type === 'H', bull = p.label === 'HH' || p.label === 'HL';
    draw.push({ kind: 'marker', i: p.i, price: p.price, position: up ? 'aboveBar' : 'belowBar', shape: 'circle', color: bull ? '#4fb3a9' : '#e5655f', text: p.label });
  }
  if (pivots.length >= 3) {
    for (const e of structureEvents(ctx.candles, pivots).events.slice(-breaks)) {
      const color = e.dir === 1 ? '#3987e5' : '#d95926';
      draw.push({ kind: 'line', points: [{ i: e.pivot.i, price: e.level }, { i: e.i, price: e.level }], color, style: 'dashed' });
      draw.push({ kind: 'marker', i: e.i, price: e.level, position: e.dir === 1 ? 'aboveBar' : 'belowBar', shape: e.dir === 1 ? 'arrowUp' : 'arrowDown', color, text: e.kind });
    }
  }
  return { id: 'overlay|structure', name: 'Yapı (HH/HL · BOS)', type: 'overlay', group: 'smc', direction: 'neutral', strength: 0, draw };
}
