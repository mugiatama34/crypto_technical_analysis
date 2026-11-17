// Ön kayıtlı ölçüm (saf kısım): yüksek ADX'te short (docs/arastirma/on-kayit-adx-short.md). Tanım / dönem / eşik / ölçüt ön kayıttan
// birebir; burada değiştirilmez. Betik: backtest/adx-short.mjs. Plan ve çıkış = 13.11 taramasındaki "bugünkü canlı satır"
// (sweep.mjs capLists: live4h + "3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H"), aynı simülasyon yolu
// (sweep evaluate: passes → rebuild → simulateTrade, alt TF mumlarıyla → hedgeOf).
import { TIMEFRAMES } from '../src/data/okx.js';
import { simulateTrade } from './engine.js';
import { stats, statsCi, meetsStrict, MIN_N, entryTimeOf } from './report.js';
import { capLists, merge, passes, rebuild, hedgeOf, optsOf } from './sweep.mjs';

const DAY = 86400e3;
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'time_stop']);

export const ADX = {
  prereg: 'docs/arastirma/on-kayit-adx-short.md',
  // Bağımsız dönem (hipotezi üreten 12 ayın öncesi) ve hipotezi üreten ("görülmüş") dönem; [from, to) plan mumu zamanı, UTC
  periods: {
    independent: { from: Date.UTC(2023, 10, 13), to: Date.UTC(2025, 10, 13), label: 'bağımsız dönem 13.11.2023–13.11.2025' },
    seen: { from: Date.UTC(2025, 10, 13), to: Date.UTC(2026, 10, 13), label: 'görülmüş (hipotezi üreten dönem) 13.11.2025–13.11.2026' },
  },
  primaryTf: '4H', infoTfs: ['1H'], minAdx: 40, top: 50, minN: MIN_N,
  cost: { fee: 0.05, slip: 0.05 }, // fonlama: taramanın varsayılanı (BT_DEFAULTS.fundingPct8h = 0; 13.11 satırı fonlamasız)
  // Plan üretimi: tam koşu (run.mjs) varsayılanları
  plan: { minScore: 50, minRR: 2, maxRiskPct: 5 },
  liveRowLast: '3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H',
  lower: { '4H': '1H', '1H': '15m' },
};

/** 13.11 taramasındaki bugünkü canlı satır (sweep.mjs capLists'ten, adıyla; bulunamazsa hata). */
export function liveRowVariant() {
  const list = capLists().find((l) => l[l.length - 1]?.name === ADX.liveRowLast);
  if (!list) throw new Error(`sweep.mjs capLists içinde "${ADX.liveRowLast}" yok`);
  return merge(list);
}

/** Varyantın TF'ye göre hali: 4H = satırın kendisi; 1H (bilgi) = aynı satır, TF filtresi 1H. knifeBar: 'touch' | 'lowerBar'. */
export function variantFor(tf, knifeBar = 'touch') {
  const v = liveRowVariant();
  return { ...v, ...(tf === '4H' ? {} : { tfs: [tf], name: `${v.name} · TF ${tf} (bilgi)` }), ...(knifeBar === 'touch' ? {} : { knifeBar, name: `${v.name} · bıçak ${knifeBar} (bilgi)${tf === '4H' ? '' : ` · TF ${tf}`}` }) };
}

const ADX_RE = /^ADX (\d+) trend ([↑↓])$/;
/** Plan kümesindeki "ADX <n> trend ↑/↓" sinyallerinden ok yönüne uyanın n'i (adı üreten yuvarlamayla; birden çoksa en büyüğü); yoksa null. */
export function adxOfPlan(plan, arrow) {
  let best = null;
  for (const s of plan?.signals || []) {
    const m = ADX_RE.exec(s.name || '');
    if (m && m[2] === arrow) { const n = +m[1]; if (best == null || n > best) best = n; }
  }
  return best;
}

/** Gruplar: birincil (ön kayıt filtresi) + bilgi satırları. t: { d, adxDown, adxUp } (sinyal anındaki plan bilgisi). */
export const GROUPS = {
  primary: { label: `short · kümede "ADX n trend ↓", n ≥ ${ADX.minAdx} (birincil)`, test: (t) => t.d === -1 && t.adxDown != null && t.adxDown >= ADX.minAdx },
  allShorts: { label: 'tüm short\'lar (filtresiz, bilgi)', test: (t) => t.d === -1 },
  adx40Long: { label: `long · kümede "ADX n trend ↑", n ≥ ${ADX.minAdx} (bilgi)`, test: (t) => t.d === 1 && t.adxUp != null && t.adxUp >= ADX.minAdx },
  adx50Short: { label: 'short · "ADX n trend ↓", n ≥ 50 (bilgi)', test: (t) => t.d === -1 && t.adxDown != null && t.adxDown >= 50 },
  adxLt40Short: { label: `short · "ADX n trend ↓", n < ${ADX.minAdx} (dedektör eşiği 25 → 25–39; bilgi)`, test: (t) => t.d === -1 && t.adxDown != null && t.adxDown < ADX.minAdx },
};
export const isPrimary = GROUPS.primary.test;

/** Zamanla 2/3 eğitim – 1/3 doğrulama bölünmesi (dönemin takvim aralığı; plan sayısına göre değil). */
export const splitOf = (p) => p.from + ((p.to - p.from) * 2) / 3;
export const inPeriod = (t, p) => t.time >= p.from && t.time < p.to;

const hedged = (ts, f = 'hedgedR') => ts.filter((t) => t[f] != null).map((t) => ({ ...t, R: t[f] }));
/** Dilim özeti: n (dolan), ort. R, PF, %90 GA + hedge'li R (eşit nominal ters BTC; hedgedR) ve bilgi olarak açılıştan hedge. */
export function oneStats(ts) {
  const s = statsCi(ts), h = statsCi(hedged(ts)), ho = stats(hedged(ts, 'hedgedROpen'));
  return { n: s.n, signals: s.signals, fillRate: s.fillRate, avgR: s.avgR, profitFactor: s.profitFactor, winRate: s.winRate, totalR: s.totalR, maxDD: s.maxDD, ci90: s.ci90, inconclusive: s.inconclusive, outcomes: s.outcomes,
    hedgedN: h.n, hedgedAvgR: h.avgR, hedgedPF: h.profitFactor, hedgedCi90: h.ci90, hedgedOpenAvgR: ho.avgR };
}
export function sliceStats(trades, split) {
  return { train: oneStats(trades.filter((t) => t.time < split)), valid: oneStats(trades.filter((t) => t.time >= split)), all: oneStats(trades) };
}

/** Kümelenme: dolan işlemlerin giriş günü / haftası (UTC, Pazartesi başlangıçlı) sayısı, en kalabalık gün, en kalabalık 5 günün payı. */
export function clusteringOf(trades) {
  const tr = trades.filter((t) => TRADED.has(t.outcome));
  const days = new Map();
  for (const t of tr) { const k = Math.floor(entryTimeOf(t) / DAY); days.set(k, (days.get(k) || 0) + 1); }
  const weeks = new Set([...days.keys()].map((d) => Math.floor((d + 3) / 7))); // 01.01.1970 Perşembe → +3 ile Pazartesi
  const counts = [...days.values()].sort((a, b) => b - a);
  const top5 = counts.slice(0, 5).reduce((a, b) => a + b, 0);
  return { n: tr.length, days: days.size, weeks: weeks.size, maxPerDay: counts[0] || 0, top5DaysShare: tr.length ? +(top5 / tr.length).toFixed(3) : null };
}

/**
 * Ön kayıt ölçütü (yalnız birincil grup, bağımsız dönem, 4H, knifeBar 'touch'). p: sliceStats(birincil).
 * sonucsuz: bir dilimde dolan n < 100 · gecer: iki dilimde ort. R > 0, PF > 1,1 ve hedge'li ort. R > 0 · btc-yonu: sıkı ölçüt
 * geçer, hedge'li geçmez · gecmez: sıkı ölçüt geçmez.
 */
export function verdictOf(p, minN = ADX.minN) {
  const reasons = [];
  const tn = p.train.n, vn = p.valid.n;
  if (!(tn >= minN && vn >= minN)) {
    reasons.push(`dolan işlem eğitim ${tn} / doğrulama ${vn} (< ${minN})`);
    return { verdict: 'sonucsuz', strict: false, hedgedOk: false, conclusion: 'sonuçsuz (dilim başına n < 100)', reasons };
  }
  const strict = meetsStrict(p.train, p.valid);
  const hedgedOk = p.train.hedgedAvgR > 0 && p.valid.hedgedAvgR > 0;
  for (const [k, s] of [['eğitim', p.train], ['doğrulama', p.valid]]) {
    if (!(s.avgR > 0)) reasons.push(`${k}: ort. R ${s.avgR} ≤ 0`);
    if (!(s.profitFactor > 1.1)) reasons.push(`${k}: PF ${s.profitFactor} ≤ 1,1`);
    if (!(s.hedgedAvgR > 0)) reasons.push(`${k}: hedge'li ort. R ${s.hedgedAvgR} ≤ 0`);
  }
  if (strict && hedgedOk) return { verdict: 'gecer', strict, hedgedOk, conclusion: 'geçer → kural ADAYI (canlı kural değil; sonraki adım ileriye dönük gölge etiket, karar kullanıcıda)', reasons };
  if (strict) return { verdict: 'btc-yonu', strict, hedgedOk, conclusion: 'BTC yönü; coin / kurulum seçimi değil → kural olmaz', reasons };
  return { verdict: 'gecmez', strict, hedgedOk, conclusion: 'geçmez (sıkı ölçüt yok)', reasons };
}

/** Bir dönemin raporu: tüm gruplar, birincilin kümelenmesi, ölçüt (yalnız decision=true iken karar; diğerlerinde bilgi). */
export function periodReport(trades, lowerBarTrades, period, { decision = false } = {}) {
  const split = splitOf(period);
  const ts = trades.filter((t) => inPeriod(t, period));
  const groups = Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, { label: g.label, ...sliceStats(ts.filter(g.test), split) }]));
  const prim = ts.filter(isPrimary);
  const v = verdictOf(groups.primary);
  const out = {
    label: period.label, from: period.from, to: period.to, split, n: { plans: ts.length, filled: ts.filter((t) => TRADED.has(t.outcome)).length },
    groups,
    clustering: { train: clusteringOf(prim.filter((t) => t.time < split)), valid: clusteringOf(prim.filter((t) => t.time >= split)), all: clusteringOf(prim) },
    ...(decision ? v : { infoVerdict: v.verdict, infoConclusion: v.conclusion, note: 'bilgi satırı: karar vermez' }),
  };
  if (lowerBarTrades) {
    const lb = lowerBarTrades.filter((t) => inPeriod(t, period) && isPrimary(t));
    out.knifeLowerBar = { label: "birincil · knifeBar 'lowerBar' (bıçak kararı dokunan alt TF mumunun sonuna kadar; iyimser sınır, bilgi)", ...sliceStats(lb, split), infoVerdict: verdictOf(sliceStats(lb, split)).verdict };
  }
  return out;
}

/** Seri nesnesi (sweep passes için): mumlar + zaman → indeks. Canlı satır ADX/EMA filtresi kullanmaz (passes yalnız v.trend'de okur). */
export const seriesOf = (candles) => ({ candles, idx: new Map(candles.map((c, i) => [c.time, i])), adx: null, ema200: null });

/**
 * Bir seri planlarını canlı satırla yeniden simüle eder (sweep evaluate'in canlı olmayan dalı, birebir): passes → rebuild →
 * simulateTrade (alt TF mumları: dolum mumu sırası 'lower' + bıçak kararı) → hedgeOf. plans: simulateSeries çıktısı (plan alanlı).
 * ctx: { series, lower, htf (Map 'coin|upTf' → { hs, ms }), btc (aynı TF BTC mumları), fee, slip }.
 * → işlem kayıtları (sinyal anı ADX bilgisi adxDown / adxUp dahil; nedensel: yalnız plan kümesinin adları).
 */
export function evaluatePlans(plans, v, ctx) {
  const o = optsOf(v, { fee: ctx.fee, slip: ctx.slip });
  const out = [];
  for (const t of plans) {
    if (!passes(t, v, ctx.series, new Map(), ctx.htf)) continue;
    const i = ctx.series.idx.get(t.time);
    const plan = (v.stopPadAtr != null || v.minRiskAtr != null || v.tp1R != null || v.tp2R != null || v.tp1Pct != null || v.midTp) ? rebuild(t.plan, v) : t.plan;
    const sim = simulateTrade(plan, ctx.series.candles, i + 1, t.tf, o.fillBarTp === 'lower' || o.knifeGuard ? { ...o, lowerCandles: ctx.lower || null } : o);
    const tr = { coin: t.coin, time: t.time, tf: t.tf, score: t.plan.score, d: plan.d, adxDown: adxOfPlan(t.plan, '↓'), adxUp: adxOfPlan(t.plan, '↑'), waitBars: sim.waitBars, bars: sim.bars, tp1Bars: sim.tp1Bars ?? null, entryFill: sim.entryFill, stop: plan.stop, outcome: sim.outcome, R: sim.R, mfe: sim.mfe };
    if (sim.entryFill) Object.assign(tr, hedgeOf(tr, ctx.btc, o.feePct, o.tp1Portion));
    out.push(tr);
  }
  return out;
}

/** Veri aralıkları (iç içe: 4H koşusunun indirdiği 1H / 4H dosyaları 1H koşusunda önbellekten okunur). */
export function fetchRanges(runTf, periods, now) {
  const ind = periods.independent, last = runTf === '4H' && periods.seen ? periods.seen.to : ind.to;
  const end = Math.min(now, last + 45 * DAY);
  const r = { '1D': [ind.from - 250 * DAY, end], '4H': [ind.from - 120 * DAY, end], '1H': [ind.from - 120 * DAY, end] };
  if (runTf === '1H') r['15m'] = [ind.from - 30 * DAY, Math.min(now, ind.to + 20 * DAY)];
  return r;
}

export { TRADED, TIMEFRAMES };
