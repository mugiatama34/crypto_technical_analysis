// Elliott Wave: (1) dalga-3 giriş setup'ları (wave3.js), (2) ZigZag pivot pencerelerinin kural motoruyla
// sayımı (ew/engine/analyze.js: itki, diagonal, zigzag, flat, üçgen, WXY) ve sıradaki dalga hedefi.
import { signal } from '../core/signal.js';
import { findWave3Setups, activePlans, tbMissing, DEFAULTS as W3 } from '../scan/wave3.js';
import { tagSmt, SMT_LABEL } from '../scan/smt.js';
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

/**
 * Ders 2 işlem seviyeleri (0, A, B, C noktaları; prev: düzeltmeden önceki itkinin başı).
 * zigzag: giriş C = A seviyesi, stop min(0,786, C) ötesi, TP1 itkinin ucu (0), TP2 C + 1,618 × itki.
 * genişleyen flat: giriş A ucu (geri kapanış), stop C ucu ötesi, TP1 B ucu. → { entry, stop, tp1, tp2, note } ya da null.
 */
export function correctionLevels(pattern, label, [P0, A, B, C], prev, atr) {
  const d = Math.sign(P0.price - A.price) || 1; // işlem yönü: düzeltmenin tersi (ana trend)
  const LA = Math.abs(A.price - P0.price), buf = 0.2 * atr;
  if (pattern === 'zigzag') {
    const cEqA = B.price - d * LA;
    if (!prev || d * (P0.price - prev.price) <= 0) return null;
    const L1 = Math.abs(P0.price - prev.price), lvl786 = P0.price - d * 0.786 * L1, lvl618 = P0.price - d * 0.618 * L1;
    const far = d === 1 ? Math.min(lvl786, C.price, cEqA) : Math.max(lvl786, C.price, cEqA);
    return { entry: cEqA, stop: far - d * buf, tp1: P0.price, tp2: (d === 1 ? Math.min(C.price, cEqA) : Math.max(C.price, cEqA)) + d * 1.618 * L1, invalid: prev.price,
      note: `Ders 2: C = A seviyesi ${cEqA.toPrecision(6)}; önceki itkinin 0,618–0,786 bölgesi ${lvl618.toPrecision(6)}–${lvl786.toPrecision(6)}. C bitince dönüş tetiğiyle ${d === 1 ? 'alış' : 'satış'}; stop 0,786 ötesi; TP1 itki ucu ${P0.price.toPrecision(6)}; sayım itkinin başı ${prev.price.toPrecision(6)} kırılırsa geçersiz.` };
  }
  if (pattern === 'flat' && /expanded\)/.test(label) && d * (A.price - C.price) > 0) {
    return { entry: A.price, stop: C.price - d * buf, tp1: B.price, tp2: null, invalid: prev?.price ?? null,
      note: `Ders 2: genişleyen flat. B önceki ucu geçti, C A ucunu (${A.price.toPrecision(6)}) süpürdü; fiyat A ucunun ${d === 1 ? 'üstüne' : 'altına'} geri kapanınca ${d === 1 ? 'alış' : 'satış'}; stop C ucu ötesi; TP1 B ucu ${B.price.toPrecision(6)}.` };
  }
  return null;
}

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
        out.push({ k, points: win, n: w, cand, tentative: win[win.length - 1] === tentative, prev: pts[pts.length - w - 1] || null });
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
  // o.w3: tarayıcı Ayarlar bölmesi (C uzaması, ders kitabı, bölge, SMT…); bot göndermez → varsayılanlar
  const w3opts = { ...W3, ruleSet: o.ruleSet, entryType: 'both', minRR: o.minRR, sensitivities: o.sensitivities, ...(o.w3 || {}) };
  const setups = o.wave3 === false ? [] : findWave3Setups(candles, w3opts, live);
  if (ctx.opts.ref && w3opts.smtRef && w3opts.smtRef !== 'off') tagSmt(setups, candles, ctx.opts.ref, w3opts);
  for (const s of setups) {
    if (w3opts.smtOnly && s.phase === 'forming' && s.d === 1 && s.zone && s.smt !== 'smt') continue; // yalnız SMT'li limit bölge long
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
      name: `EW dalga-3 ${plan.type === 'zone' ? 'bölge' : 'kırılım'} (${s.stateLabel})${o.w3 && s.textbook ? ` 📐${s.textbook.n}/4` : ''}${s.smt === 'smt' ? ' SMT ✓' : ''}`,
      direction: s.direction,
      strength: Math.min(1, (s.score / 100) * (s.zone?.perfect ? 1.1 : 1)),
      zone, index: (s.points.p2 || s.points.cNow).i,
      status: s.state === 'triggered' ? 'triggered' : s.phase === 'forming' ? 'forming' : 'active',
      invalidation: s.points.p0.price, entry, stop,
      target: (plan.type === 'zone' ? Z.targets : L.targets)[0].price,
      note: `Dalga 2 = ${s.abc?.label || 'ABC yok'}, geri çekilme %${(s.retr * 100).toFixed(0)}, süre oranı ${s.timeRatio.toFixed(1)}×; R:R ${plan.rr.toFixed(1)}${s.zone?.perfect ? ' · ★ mükemmel bölge' : ''}`
        + `${o.w3 && s.textbook ? ` · 📐 ders kitabı ${s.textbook.n}/4${s.textbook.n < 4 ? ` (eksik: ${tbMissing(s.textbook).join(', ')})` : ''}` : ''}`
        + `${o.w3 && s.w1q ? ` · dalga 1 verimi ${s.w1q.er.toFixed(2)}, hızı ${s.w1q.speed.toFixed(2)}` : ''}${s.cExt ? ' · C uzadı' : ''}${s.cDone ? ' · C alt derecede bitti' : ''}`
        + `${s.smt ? ` · ${SMT_LABEL[s.smt]}` : ''}.`,
      draw: [
        { kind: 'line', points: pts.map(({ p }) => ({ i: p.i, price: p.price })), color: '#f0c75e', label: 'EW' },
        ...pts.map(({ p, l }) => ({ kind: 'marker', i: p.i, price: p.price, position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: p.type === 'H' ? 'arrowDown' : 'arrowUp', color: '#f0c75e', text: l })),
        { kind: 'hline', price: entry, color: '#3987e5', label: 'Giriş', style: 'solid' },
        { kind: 'hline', price: stop, color: '#ef5350', label: 'Stop', style: 'dashed' },
        ...(plan.type === 'zone' ? Z.targets : L.targets).slice(0, 2).map((t, i) => ({ kind: 'hline', price: t.price, color: '#7cc4a8', label: `H${i + 1}`, style: 'dashed' })),
      ],
      meta: { score: s.score, rr: plan.rr, plan: plan.type, state: s.state, abc: s.abc?.kind || null, perfect: !!s.zone?.perfect, textbook: s.textbook?.n ?? null, smt: s.smt ?? null, cExt: !!s.cExt },
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
    const lv = n === 4 && (cand.pattern === 'zigzag' || cand.pattern === 'flat') ? correctionLevels(cand.pattern, cand.label, points, c.prev, ctx.atrNow) : null;
    out.push(signal({
      id: `ew|count|${cand.pattern}|${points[0].i}|${lastP.i}`,
      type: 'elliott', group: 'elliott',
      name: `EW ${cand.label}${complete ? ' tamam' : ` ${lbl[n - 1]}'de`}`,
      direction: nd === 1 ? 'long' : nd === -1 ? 'short' : 'neutral',
      strength: Math.min(1, (cand.score / 100) * (complete ? 0.9 : 0.75)),
      zone: [Math.min(lastP.price, ctx.price) - 0.2 * ctx.atrNow, Math.max(lastP.price, ctx.price) + 0.2 * ctx.atrNow],
      index: lastP.i,
      status: c.tentative ? 'forming' : 'active',
      invalidation: lv?.invalid ?? inv, target: lv ? lv.tp1 : target,
      ...(lv ? { entry: lv.entry, stop: lv.stop } : {}),
      note: `${cand.label}, ${n} nokta, kural skoru ${cand.score}/100${cand.warns ? ` (${cand.warns} uyarı)` : ''}. ${lv ? lv.note : `${cand.targets?.title || ''}${target ? `: ilk hedef ${target.toPrecision(6)}` : ''}.`}`,
      draw: [
        { kind: 'line', points: points.map((p) => ({ i: p.i, price: p.price })), color: '#f0c75e', label: 'EW' },
        ...points.map((p, k) => ({ kind: 'marker', i: p.i, price: p.price, position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: p.type === 'H' ? 'arrowDown' : 'arrowUp', color: '#f0c75e', text: lbl[k] })),
        ...(lv ? [
          { kind: 'hline', price: lv.entry, color: '#3987e5', label: 'Giriş', style: 'solid' },
          { kind: 'hline', price: lv.stop, color: '#ef5350', label: 'Stop', style: 'dashed' },
          { kind: 'hline', price: lv.tp1, color: '#7cc4a8', label: 'H1', style: 'dashed' },
          ...(lv.tp2 ? [{ kind: 'hline', price: lv.tp2, color: '#7cc4a8', label: 'H2', style: 'dashed' }] : []),
        ] : [
          ...(target ? [{ kind: 'hline', price: target, color: '#7cc4a8', label: 'EW hedef', style: 'dashed' }] : []),
        ]),
        ...((lv?.invalid ?? inv) ? [{ kind: 'hline', price: lv?.invalid ?? inv, color: '#b06cf0', label: 'EW geçersiz', style: 'dotted' }] : []),
      ],
      meta: { pattern: cand.pattern, score: cand.score, n, complete, sensitivity: c.k, ratios: cand.ratios },
    }));
  }
  return out;
}
