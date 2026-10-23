// Elliott Wave: (1) dalga-3 giriş setup'ları (wave3.js), (2) ZigZag pivot pencerelerinin kural motoruyla
// sayımı (ew/engine/analyze.js: itki, diagonal, zigzag, flat, üçgen, WXY) ve sıradaki dalga hedefi.
import { signal } from '../core/signal.js';
import { findWave3Setups, activePlans, DEFAULTS as W3 } from '../scan/wave3.js';
import { analyze } from '../ew/engine/analyze.js';

export const EW_DEFAULTS = {
  ruleSet: 'course', // 'course' | 'fp' | 'neely'
  minScore: 55, // kural motoru skoru (0–100) bu değerin altındaki sayımlar atlanır
  windows: [6, 5, 4, 3], // pivot pencere boyları (son N pivot)
  sensitivities: [2, 3, 4.5],
  minRR: 1.5,
  patterns: null, // ör. ['diagonal'] | ['zigzag', 'flat']: yalnız bu kalıpların sayımları (null = hepsi)
  wave3: true, // dalga-3 giriş setup'ları (preset'e özgü taramada kapatılabilir)
  maxCounts: 3, // en fazla bu kadar sayım sinyali
};

/** Sıradaki dalganın yönü: kalıp + nokta sayısı. c.d = ilk dalganın yönü. */
function nextDirection(pattern, n, d) {
  if (pattern === 'impulse' || pattern === 'diagonal') {
    if (n === 6) return -d; // tamamlandı → düzeltme
    return n % 2 === 1 ? d : -d; // 3 nokta → dalga 3 (d), 4 → dalga 4 (−d), 5 → dalga 5 (d)
  }
  if (pattern === 'zigzag' || pattern === 'flat' || pattern === 'wxy') {
    return n === 4 ? -d : d; // ABC bitti → trend devam (A'nın tersi); 3 nokta → C (A yönü)
  }
  if (pattern === 'triangle') return n === 6 ? -d : (n % 2 === 0 ? d : -d);
  return 0;
}

const labelsOf = (pattern) => ({
  impulse: ['0', '1', '2', '3', '4', '5'], diagonal: ['0', '1', '2', '3', '4', '5'],
  zigzag: ['0', 'A', 'B', 'C'], flat: ['0', 'A', 'B', 'C'], triangle: ['0', 'A', 'B', 'C', 'D', 'E'], wxy: ['0', 'W', 'X', 'Y'],
}[pattern] || []);

/** Pivot pencerelerini kural motoruyla sayar; en iyi geçerli sayımları döndürür. */
export function countWaves(ctx, o) {
  const out = [];
  const seen = new Set();
  for (const k of o.sensitivities) {
    const { pivots, tentative } = ctx.pivots(k);
    const pts = tentative ? [...pivots, tentative] : pivots;
    for (const w of o.windows) {
      if (pts.length < w) continue;
      const win = pts.slice(-w);
      const key = win.map((p) => p.i).join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      const res = analyze(win.map((p) => ({ t: p.i, p: p.price })), { ruleSet: o.ruleSet, logScale: true });
      if (!res.ok) continue;
      for (const cand of res.candidates) {
        if (!cand.valid || cand.score < o.minScore) continue;
        if (o.patterns && !o.patterns.includes(cand.pattern)) continue;
        out.push({ k, points: win, n: w, cand, tentative: win[win.length - 1] === tentative });
      }
    }
  }
  // Aynı son noktada biten pencereler için tek (en yüksek skorlu) sayım; en fazla 3 sayım
  out.sort((a, b) => b.cand.score - a.cand.score || b.n - a.n);
  const kept = [];
  for (const c of out) {
    const dup = kept.find((x) => x.points[x.points.length - 1].i === c.points[c.points.length - 1].i);
    if (!dup) kept.push(c);
  }
  return kept.slice(0, o.maxCounts ?? 3);
}

export function detect(ctx) {
  const o = { ...EW_DEFAULTS, ...ctx.opts.elliott };
  const out = [];
  const { candles, live, last } = ctx;
  if (candles.length < 60) return out;

  // 1) Dalga-3 setup'ları (preset'e özgü taramada kapatılabilir)
  const w3opts = { ...W3, ruleSet: o.ruleSet, entryType: 'both', minRR: o.minRR, sensitivities: o.sensitivities };
  for (const s of o.wave3 === false ? [] : findWave3Setups(candles, w3opts, live)) {
    const plans = activePlans(s, w3opts);
    if (!plans.length) continue;
    const plan = plans[0];
    const L = s.levels, Z = s.zone;
    const entry = plan.type === 'zone' ? Z.entry : L.entry;
    const stop = plan.type === 'zone' ? Z.stop : L.stop;
    // Bölge: limit planda bölge kenarları; kırılım planında tetik seviyesi civarı (giriş–stop aralığı değil)
    const zone = plan.type === 'zone' ? [Math.min(Z.near, Z.far), Math.max(Z.near, Z.far)] : [entry - 0.4 * ctx.atrNow, entry + 0.4 * ctx.atrNow];
    const pts = [{ p: s.points.p0, l: '0' }, { p: s.points.p1, l: '1' }, ...(s.abc ? [{ p: s.abc.A, l: 'A' }, { p: s.abc.B, l: 'B' }] : []), { p: s.points.p2 || s.points.cNow, l: s.phase === 'forming' ? 'C?' : '2' }];
    out.push(signal({
      id: `ew|w3|${s.direction}|${s.points.p0.i}|${s.points.p1.i}`,
      type: 'elliott', group: 'elliott',
      name: `EW dalga-3 ${plan.type === 'zone' ? 'bölge' : 'kırılım'} (${s.stateLabel})`,
      direction: s.direction,
      strength: Math.min(1, (s.score / 100) * (s.zone?.perfect ? 1.1 : 1)),
      zone, index: (s.points.p2 || s.points.cNow).i,
      status: s.state === 'triggered' ? 'triggered' : s.phase === 'forming' ? 'forming' : 'active',
      invalidation: s.points.p0.price, entry, stop,
      target: (plan.type === 'zone' ? Z.targets : L.targets)[0].price,
      note: `Dalga 2 = ${s.abc?.label || 'ABC yok'}, geri çekilme %${(s.retr * 100).toFixed(0)}, süre oranı ${s.timeRatio.toFixed(1)}×; R:R ${plan.rr.toFixed(1)}${s.zone?.perfect ? ' · ★ mükemmel bölge' : ''}.`,
      draw: [
        { kind: 'line', points: pts.map(({ p }) => ({ i: p.i, price: p.price })), color: '#f0c75e', label: 'EW' },
        ...pts.map(({ p, l }) => ({ kind: 'marker', i: p.i, price: p.price, position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: p.type === 'H' ? 'arrowDown' : 'arrowUp', color: '#f0c75e', text: l })),
        { kind: 'hline', price: entry, color: '#3987e5', label: 'Giriş', style: 'solid' },
        { kind: 'hline', price: stop, color: '#ef5350', label: 'Stop', style: 'dashed' },
        ...(plan.type === 'zone' ? Z.targets : L.targets).slice(0, 2).map((t, i) => ({ kind: 'hline', price: t.price, color: '#7cc4a8', label: `H${i + 1}`, style: 'dashed' })),
      ],
      meta: { score: s.score, rr: plan.rr, plan: plan.type, state: s.state, abc: s.abc?.kind || null, perfect: !!s.zone?.perfect },
    }));
  }

  // 2) Genel sayım: son pivot pencereleri
  for (const c of countWaves(ctx, o)) {
    const { cand, points, n } = c;
    const d = Math.sign(points[1].price - points[0].price) || 1;
    const nd = nextDirection(cand.pattern, n, d);
    const target = cand.targets?.items?.find((t) => Number.isFinite(t.price))?.price ?? null;
    const inv = cand.invalidation?.find((t) => Number.isFinite(t.price))?.price ?? null;
    const lbl = labelsOf(cand.pattern);
    const lastP = points[points.length - 1];
    const complete = cand.complete;
    out.push(signal({
      id: `ew|count|${cand.pattern}|${points[0].i}|${lastP.i}`,
      type: 'elliott', group: 'elliott',
      name: `EW ${cand.label}${complete ? ' tamam' : ` ${lbl[n - 1]}'de`}`,
      direction: nd === 1 ? 'long' : nd === -1 ? 'short' : 'neutral',
      strength: Math.min(1, (cand.score / 100) * (complete ? 0.9 : 0.75)),
      zone: [Math.min(lastP.price, ctx.price) - 0.2 * ctx.atrNow, Math.max(lastP.price, ctx.price) + 0.2 * ctx.atrNow],
      index: lastP.i,
      status: c.tentative ? 'forming' : 'active',
      invalidation: inv, target,
      note: `${cand.label}, ${n} nokta, kural skoru ${cand.score}/100${cand.warns ? ` (${cand.warns} uyarı)` : ''}. ${cand.targets?.title || ''}${target ? `: ilk hedef ${target.toPrecision(6)}` : ''}.`,
      draw: [
        { kind: 'line', points: points.map((p) => ({ i: p.i, price: p.price })), color: '#f0c75e', label: 'EW' },
        ...points.map((p, k) => ({ kind: 'marker', i: p.i, price: p.price, position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: p.type === 'H' ? 'arrowDown' : 'arrowUp', color: '#f0c75e', text: lbl[k] })),
        ...(target ? [{ kind: 'hline', price: target, color: '#7cc4a8', label: 'EW hedef', style: 'dashed' }] : []),
        ...(inv ? [{ kind: 'hline', price: inv, color: '#b06cf0', label: 'EW geçersiz', style: 'dotted' }] : []),
      ],
      meta: { pattern: cand.pattern, score: cand.score, n, complete, sensitivity: c.k, ratios: cand.ratios },
    }));
  }
  return out;
}
