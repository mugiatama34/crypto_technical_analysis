// Ön kayıtlı ölçüm (saf kısım): Bybit hacim eşiğiyle canlı 4H düzeni (docs/arastirma/on-kayit-hacim-esigi.md). Tanım / dönem / eşik /
// ölçüt ön kayıttan birebir; burada değiştirilmez. Betik: backtest/liq.mjs. Plan ve çıkış = adx-short.js'teki canlı satır (variantFor,
// evaluatePlans); dilim, ölçüt ve kümelenme aynı işlevlerle (sliceStats, verdictOf, clusteringOf).
import { TIMEFRAMES } from '../src/data/okx.js';
import { entryTimeOf, MIN_N } from './report.js';
import { sliceStats, verdictOf, clusteringOf, splitOf, inPeriod, TRADED } from './adx-short.js';

export const DAY = 86400e3;

export const LIQ = {
  prereg: 'docs/arastirma/on-kayit-hacim-esigi.md',
  period: { from: Date.UTC(2025, 10, 17), to: Date.UTC(2026, 10, 17), label: '17.11.2025–17.11.2026 UTC' }, // [from, to) plan mumu zamanı
  tf: '4H', lowerTf: '1H', top: 100, minN: MIN_N,
  threshold: 20e6, windowDays: 7, neighbors: [5e6, 50e6], // komşu eşikler yalnız bilgi
  cost: { fee: 0.05, slip: 0.05 }, slipSens: [0.10, 0.20],
  account: { start: 100000, riskPct: 1, fixedRisk: 1000 },
};

/** Bybit v5 kline listesi ([start, o, h, l, c, volume, turnover], yeniden eskiye) → [[gün başı ms, turnover]] eskiden yeniye. */
export function parseBybitKlines(list) {
  return (list || []).map((r) => [+r[0], +r[6]]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
}

/** [[t, turnover]] → Map(UTC gün indeksi → turnover). */
export const turnoverIndex = (rows) => new Map((rows || []).map(([t, v]) => [Math.floor(t / DAY), v]));

/**
 * Nedensel 7 günlük ortalama: sinyal mumunun AÇILDIĞI UTC gününden (D) önceki windowDays kapanmış günlük mum (D−7 … D−1).
 * D günü ve sonrası kullanılmaz. Pencerede eksik gün varsa null (ön kayıt: "o tarihte 7 günlük verisi olmayan" → filtre dışı).
 */
export function avgTurnoverBefore(idx, signalTime, windowDays = LIQ.windowDays) {
  if (!idx) return null;
  const D = Math.floor(signalTime / DAY);
  let s = 0;
  for (let k = D - windowDays; k <= D - 1; k++) { const v = idx.get(k); if (v == null) return null; s += v; }
  return s / windowDays;
}

/** Sınıf: 'nobybit' (sözleşme yok) · 'nodata' (sözleşme var, 7 gün eksik) · 'pass' (≥ eşik) · 'below'. */
export function liqClass(avg, onBybit, threshold = LIQ.threshold) {
  if (!onBybit) return 'nobybit';
  if (avg == null) return 'nodata';
  return avg >= threshold ? 'pass' : 'below';
}

/** Gruplar (t: { d, liq7, onBybit }). primary = karar; diğerleri bilgi. */
export const GROUPS = {
  primary: { label: `Bybit 7 g ort. ciro ≥ ${LIQ.threshold / 1e6} M$ (karar)`, test: (t) => liqClass(t.liq7, t.onBybit) === 'pass' },
  all: { label: 'filtresiz tümü (bilgi)', test: () => true },
  below: { label: `eşik altı (Bybit'te var, 7 g verisi tam, < ${LIQ.threshold / 1e6} M$; bilgi)`, test: (t) => liqClass(t.liq7, t.onBybit) === 'below' },
  noData: { label: "Bybit'te sözleşme var, 7 g verisi eksik (bilgi)", test: (t) => liqClass(t.liq7, t.onBybit) === 'nodata' },
  noBybit: { label: "Bybit'te sözleşme yok (bilgi)", test: (t) => !t.onBybit },
  primaryLong: { label: 'filtreli · long (bilgi)', test: (t) => t.d === 1 && GROUPS.primary.test(t) },
  primaryShort: { label: 'filtreli · short (bilgi)', test: (t) => t.d === -1 && GROUPS.primary.test(t) },
  allLong: { label: 'filtresiz · long (bilgi)', test: (t) => t.d === 1 },
  allShort: { label: 'filtresiz · short (bilgi)', test: (t) => t.d === -1 },
  ...Object.fromEntries(LIQ.neighbors.map((x) => [`thr${x / 1e6}`, { label: `komşu eşik ≥ ${x / 1e6} M$ (bilgi)`, test: (t) => liqClass(t.liq7, t.onBybit, x) === 'pass' }])),
};
export const isPrimary = GROUPS.primary.test;

/** Çıkış zamanı: çıkış mumunun kapanışı (giriş mumu + bars mum; capTrades endOf ile aynı, ihtiyatlı). */
export const exitTimeOf = (t) => entryTimeOf(t) + ((t.bars || 0) + 1) * (TIMEFRAMES[t.tf]?.ms || 0);

/**
 * 100.000 $ hesabı. Dolan işlemler; olaylar zamana göre (aynı anda çıkış önce, sonra giriş). mode 'compound': risk = girişteki
 * özsermaye × riskPct %; 'fixed': işlem başına fixedRisk $. K/Z = R × risk, kapanışta eklenir. Düşüş kapanış sırasındaki özsermayeden
 * (%) ve birikimli R'den; kayıp serisi = kapanış sırasıyla art arda R ≤ 0 (report.js stats ile aynı kayıp tanımı).
 */
export function accountSim(trades, { mode = 'compound', start = LIQ.account.start, riskPct = LIQ.account.riskPct, fixedRisk = LIQ.account.fixedRisk } = {}) {
  const tr = trades.filter((t) => TRADED.has(t.outcome) && Number.isFinite(t.R));
  const ev = [];
  tr.forEach((t, i) => { ev.push({ time: entryTimeOf(t), type: 1, i }); ev.push({ time: exitTimeOf(t), type: 0, i }); });
  ev.sort((a, b) => a.time - b.time || a.type - b.type || a.i - b.i);
  let eq = start, peak = start, maxDDPct = 0, maxDDUsd = 0, cumR = 0, peakR = 0, maxDDR = 0, streak = 0, maxStreak = 0;
  let maxOpen = 0, maxOpenRisk = 0, maxOpenRiskPct = 0, minEq = start;
  const open = new Map();
  for (const e of ev) {
    if (e.type === 1) {
      const risk = mode === 'compound' ? (eq * riskPct) / 100 : fixedRisk;
      open.set(e.i, risk);
      const tot = [...open.values()].reduce((a, b) => a + b, 0);
      if (open.size > maxOpen) maxOpen = open.size;
      if (tot > maxOpenRisk) maxOpenRisk = tot;
      if (eq > 0 && tot / eq > maxOpenRiskPct) maxOpenRiskPct = tot / eq;
      continue;
    }
    const R = tr[e.i].R, risk = open.get(e.i);
    open.delete(e.i);
    eq += R * risk; cumR += R;
    if (eq > peak) peak = eq;
    if (eq < minEq) minEq = eq;
    if (peak - eq > maxDDUsd) maxDDUsd = peak - eq;
    if (peak > 0 && (peak - eq) / peak > maxDDPct) maxDDPct = (peak - eq) / peak;
    if (cumR > peakR) peakR = cumR;
    if (peakR - cumR > maxDDR) maxDDR = peakR - cumR;
    streak = R <= 0 ? streak + 1 : 0;
    if (streak > maxStreak) maxStreak = streak;
  }
  return {
    mode, start, n: tr.length, endEquity: +eq.toFixed(0), returnPct: +(((eq - start) / start) * 100).toFixed(2), totalR: +cumR.toFixed(2),
    maxDDPct: +(maxDDPct * 100).toFixed(2), maxDDUsd: +maxDDUsd.toFixed(0), maxDDR: +maxDDR.toFixed(2), minEquity: +minEq.toFixed(0),
    maxLossStreak: maxStreak, maxOpen, maxOpenRiskUsd: +maxOpenRisk.toFixed(0), maxOpenRiskPct: +(maxOpenRiskPct * 100).toFixed(2),
  };
}

/** Kümelenme + coin dağılımı (dolan işlemler). */
export function coinSpread(trades, top = 5) {
  const m = new Map();
  for (const t of trades) if (TRADED.has(t.outcome)) m.set(t.coin, (m.get(t.coin) || 0) + 1);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { coins: m.size, top: sorted.slice(0, top).map(([coin, n]) => ({ coin, n })) };
}

/** Ön kaydın mekanik sonucu (verdictOf kodu → kısa metin; yorum yok). */
export const VERDICT_TEXT = { gecer: 'geçti', gecmez: 'geçmedi', sonucsuz: 'sonuçsuz', 'btc-yonu': "sıkı ölçüt geçti, hedge'li R geçmedi (ön kayıt: BTC yönü)" };

/**
 * Rapor: tüm gruplar (eğitim / doğrulama / tümü), karar (yalnız birincil, knifeBar 'touch'), 'lowerBar' birincil, kayma duyarlılığı,
 * kümelenme, 100.000 $ hesabı. runs: { touch, lowerBar, slip: { '0.1': [...], '0.2': [...] } } — işlem kayıtları (liq7 / onBybit alanlı).
 */
export function liqReport(runs, period = LIQ.period) {
  const split = splitOf(period);
  const inP = (ts) => ts.filter((t) => inPeriod(t, period));
  const ts = inP(runs.touch);
  const groups = Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, { label: g.label, ...sliceStats(ts.filter(g.test), split) }]));
  const v = verdictOf(groups.primary, LIQ.minN);
  const prim = ts.filter(isPrimary);
  const out = {
    period, split, n: { plans: ts.length, filled: ts.filter((t) => TRADED.has(t.outcome)).length },
    verdict: v.verdict, result: VERDICT_TEXT[v.verdict], strict: v.strict, hedgedOk: v.hedgedOk, reasons: v.reasons,
    groups,
    clustering: { train: clusteringOf(prim.filter((t) => t.time < split)), valid: clusteringOf(prim.filter((t) => t.time >= split)), all: clusteringOf(prim), ...coinSpread(prim) },
    account: {
      primary: { compound: accountSim(prim, { mode: 'compound' }), fixed: accountSim(prim, { mode: 'fixed' }) },
      all: { compound: accountSim(ts, { mode: 'compound' }), fixed: accountSim(ts, { mode: 'fixed' }) },
    },
  };
  if (runs.lowerBar) {
    const lb = inP(runs.lowerBar).filter(isPrimary);
    const s = sliceStats(lb, split);
    out.knifeLowerBar = { label: "filtreli · knifeBar 'lowerBar' (bilgi)", ...s, infoVerdict: verdictOf(s, LIQ.minN).verdict };
  }
  out.slip = {};
  for (const [k, arr] of Object.entries(runs.slip || {})) {
    const a = inP(arr);
    out.slip[k] = { slipPct: +k, primary: sliceStats(a.filter(isPrimary), split), all: sliceStats(a, split),
      account: { primary: { compound: accountSim(a.filter(isPrimary), { mode: 'compound' }), fixed: accountSim(a.filter(isPrimary), { mode: 'fixed' }) } } };
  }
  return out;
}

/** Evren özeti: Bybit sözleşmesi olan coin sayısı, dönemde hiç (herhangi bir gün) 7 g ortalaması eşiği geçmeyenler. */
export function universeOf(turnover, coins, period = LIQ.period, threshold = LIQ.threshold) {
  const on = [], off = [], never = [], neverNeighbors = Object.fromEntries(LIQ.neighbors.map((x) => [x, []]));
  for (const c of coins) {
    const b = turnover[c];
    if (!b || b.status !== 'ok') { off.push(c); continue; }
    on.push(c);
    const idx = turnoverIndex(b.rows);
    let mx = -Infinity;
    for (let t = period.from; t < period.to; t += DAY) { const a = avgTurnoverBefore(idx, t); if (a != null && a > mx) mx = a; }
    if (!(mx >= threshold)) never.push(c);
    for (const x of LIQ.neighbors) if (!(mx >= x)) neverNeighbors[x].push(c);
  }
  return { coins: coins.length, onBybit: on.length, notOnBybit: off, neverPass: never, neverPassNeighbors: neverNeighbors };
}
