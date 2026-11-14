// Fonlama geliri (taşıma) ölçümü — saf fonksiyonlar (14.11.2026; tanımlar docs/arastirma/on-kayit-fonlama.md, bağlayıcı).
// Taşıma = spot long + sürekli vadeli short: pozitif fonlamada short ALIR (+), negatifte öder (−). Baz / teminat simüle edilmez.
// Ağ yok; backtest/carry.mjs veriyi çeker ve runCarry'yi çağırır.
import { mulberry32 } from './report.js';

export const HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY;
export const YEAR_H = 8760, WEEKS_PER_YEAR = 365.25 / 7;
export const HALF_A_START = Date.UTC(2023, 5, 1), HALF_B_START = Date.UTC(2025, 2, 1);
/** Ön kayıt: maliyet %0,30 (bilgi) · %0,39 (Bybit standart spot %0,10; 14.11 ek, verdict bununla). */
export const COSTS = { preReg: 0.003, bybitStd: 0.0039 };
export const VERDICT_COST = 'bybitStd';
export const CARRY_DEFAULTS = { capDiv: 1.33, thr8h: 0.0001, minDays: 5, topK: 5, worstN: 4, netMinPct: 5, worstMinPct: -2, reps: 2000, seed: 20261114, level: 0.9, c2MinCoins: 10 };
/** 8 saatlik eşik karşılaştırmasında kayan nokta payı (HL taban faizi tam %0,01 / 8 s; "büyük" sayılmasın). */
const EPS = 1e-12;
/** HL ilk dönemde (2023-06 başı) 8 saatlik fonlama yazıyordu; bu tarihten önce ~8 s aralıklı kayıt 8 saati kapsar. */
export const HL_8H_REGIME_END = Date.UTC(2023, 6, 1);
export const VERDICT = { pass: 'Kâğıt denemeye değer', fail: 'getirisi zahmetine değmiyor' };

const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e3) / 1e3);
const pct = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e5) / 1e3); // ondalık → % (3 basamak)
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** OKX adı → Hyperliquid adı: aynısı; yoksa 1000'lik "k" öneki (PEPE → kPEPE); "1000X" → X / kX. Bulunamazsa null. */
export function mapCoin(coin, hlNames) {
  const set = hlNames instanceof Set ? hlNames : new Set(hlNames);
  const base = String(coin).replace(/^1000/, '');
  for (const c of [coin, base, `k${base}`]) if (set.has(c)) return c;
  return null;
}

/** HL fundingHistory sayfası → [{time (saat başına yuvarlanmış), rate}] (bozuk satır atılır). */
export function parseHlRows(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    const t = Number(x?.time), r = x?.fundingRate === '' || x?.fundingRate == null ? NaN : Number(x.fundingRate);
    if (Number.isFinite(t) && t > 0 && Number.isFinite(r)) out.push({ time: Math.floor(t / HOUR) * HOUR, rate: r });
  }
  return out;
}

/** Sayfa birleştirme: saat anahtarına göre yinelenen kayıt atılır (sonraki sayfa aynı saati yeniden getirirse ilk kalır), zamana göre sıralı. */
export function mergeRows(a, b) {
  const m = new Map();
  for (const x of [...(a || []), ...(b || [])]) if (!m.has(x.time)) m.set(x.time, x.rate);
  return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([time, rate]) => ({ time, rate }));
}

/**
 * Kapsanan saat: HL saatlik; yalnız ilk dönemde (HL_8H_REGIME_END öncesi) önceki kayda ~8 s uzaklıktaki kayıt 8 saati kapsar (oranı 8 saatlik).
 * Saatlik dönemde eksik saat (kesinti) kapsanmaz sayılır (oran toplamı ÷ kapsanan saat).
 */
export function withPeriods(rows) {
  return rows.map((x, i) => {
    let h = 1;
    if (x.time < HL_8H_REGIME_END) {
      // kayıt önceki aralığın fonlamasını öder → aralık = önceki kayda uzaklık (ilk kayıtta sonrakine)
      const gap = i > 0 ? (x.time - rows[i - 1].time) / HOUR : i + 1 < rows.length ? (rows[i + 1].time - x.time) / HOUR : 1;
      if (gap >= 7.5 && gap <= 8.5) h = 8;
    }
    return { time: x.time, rate: x.rate, h };
  });
}

/** Yıllıklandırma: oran toplamı ÷ kapsanan saat × 8.760 (ondalık). */
export const annualize = (sum, hours) => (hours > 0 ? (sum / hours) * YEAR_H : null);
/** 8 saatlik eşdeğer = saatlik ortalama × 8. */
export const eq8h = (sum, hours) => (hours > 0 ? (sum / hours) * 8 : null);

/** Pazartesi 00:00 UTC (≤ t). */
export function mondayOf(t) { const d = Math.floor(t / DAY) * DAY, dow = new Date(d).getUTCDay(); return d - ((dow + 6) % 7) * DAY; }
/** Tam haftalar: [ilk pazartesi ≥ from, ...] son hafta sonu ≤ end. */
export function buildWeeks(from, end) {
  const out = [];
  let w = mondayOf(from); if (w < from) w += WEEK;
  for (; w + WEEK <= end; w += WEEK) out.push(w);
  return out;
}

/** Günlük indeks: gün başı → {sum, hours} (kayıt zamanı hangi günde ise). */
export function dailyIndex(rows) {
  const m = new Map();
  for (const x of rows) { const d = Math.floor(x.time / DAY) * DAY, o = m.get(d) || { sum: 0, hours: 0 }; o.sum += x.rate; o.hours += x.h ?? 1; m.set(d, o); }
  return m;
}
/** [from, to) penceresi günlük indeksten: toplam, kapsanan saat, veri olan gün sayısı. */
export function windowStats(daily, from, to) {
  let sum = 0, hours = 0, days = 0;
  for (let d = from; d < to; d += DAY) { const o = daily.get(d); if (o && o.hours > 0) { sum += o.sum; hours += o.hours; days++; } }
  return { sum, hours, days };
}

/**
 * Haftalık panel: coin × hafta → prev (haftadan ÖNCEKİ 7 gün; karar yalnız bununla) + real (haftanın gerçekleşen toplamı).
 * series: [{coin, rows (withPeriods)}].
 */
export function weeklyPanel(series, weeks) {
  return series.map((s) => {
    const daily = dailyIndex(s.rows);
    return { coin: s.coin, weeks: weeks.map((w) => ({ prev: windowStats(daily, w - WEEK, w), real: windowStats(daily, w, w + WEEK) })) };
  });
}

/** Ön kayıt adayı: önceki 7 günde ≥ minDays gün veri. */
const isCand = (p, o) => p.days >= o.minDays && p.hours > 0;
const above = (p, o) => eq8h(p.sum, p.hours) > o.thr8h + EPS;

/**
 * Kural koşusu → hafta kayıtları {week, held[], entries, gross (nominal, ondalık), costN (entries × maliyet ÷ k, maliyet 1'e göre)}.
 * pick(i) → tutulan coin listesi (eşit ağırlık). Maliyet: yeni giren coin başına ağırlığının × c; kalan coinde yok; çıkışta yok
 * (giriş ödemesi çıkışı da kapsar). costN = maliyet katsayısı 1 iken düşülen pay; summarize maliyetle çarpar.
 */
export function runRule(panel, weeks, pick) {
  const byCoin = new Map(panel.map((p) => [p.coin, p]));
  let prev = new Set();
  return weeks.map((week, i) => {
    const held = pick(i);
    const k = held.length;
    const entries = held.filter((c) => !prev.has(c)).length;
    const gross = k ? held.reduce((a, c) => a + byCoin.get(c).weeks[i].real.sum, 0) / k : 0;
    prev = new Set(held);
    return { week, held, entries, gross, costN: k ? entries / k : 0 };
  });
}
/** R1: BTC + ETH sürekli, eşit ağırlık (ilk haftadan dönem sonuna; maliyet yalnız ilk girişte). */
export function ruleR1(panel, weeks) {
  const coins = ['BTC', 'ETH'].filter((c) => panel.some((p) => p.coin === c));
  return runRule(panel, weeks, () => coins);
}
/** R2: önceki 7 günde ortalaması en yüksek topK aday, yalnız 8 s eşdeğeri > eşik; yoksa boş. */
export function ruleR2(panel, weeks, o = CARRY_DEFAULTS) {
  return runRule(panel, weeks, (i) => panel
    .filter((p) => isCand(p.weeks[i].prev, o) && above(p.weeks[i].prev, o))
    .sort((a, b) => b.weeks[i].prev.sum / b.weeks[i].prev.hours - a.weeks[i].prev.sum / a.weeks[i].prev.hours || (a.coin < b.coin ? -1 : 1))
    .slice(0, o.topK).map((p) => p.coin));
}
/** R3: yalnız BTC, önceki 7 günün 8 s eşdeğeri > eşik iken. */
export function ruleR3(panel, weeks, o = CARRY_DEFAULTS) {
  const btc = panel.find((p) => p.coin === 'BTC');
  return runRule(panel, weeks, (i) => (btc && isCand(btc.weeks[i].prev, o) && above(btc.weeks[i].prev, o) ? ['BTC'] : []));
}

/** Ardışık n haftalık en kötü toplam (n'den az hafta → tümünün toplamı; boş → null). */
export function worstWindow(arr, n) {
  if (!arr.length) return null;
  if (arr.length <= n) return arr.reduce((a, b) => a + b, 0);
  let s = 0; for (let i = 0; i < n; i++) s += arr[i];
  let w = s;
  for (let i = n; i < arr.length; i++) { s += arr[i] - arr[i - n]; if (s < w) w = s; }
  return w;
}

/**
 * Özet (hafta kayıtları; cost = maliyet katsayısı, scale = brüt fonlama çarpanı (OKX ölçeği), capDiv = sermaye böleni).
 * Yıllık = haftalık ortalama × 365,25/7 (bileşiksiz). Değerler % olarak.
 */
export function summarize(recs, { cost = COSTS.preReg, scale = 1, capDiv = CARRY_DEFAULTS.capDiv, worstN = CARRY_DEFAULTS.worstN } = {}) {
  const n = recs.length;
  if (!n) return null;
  const net = recs.map((r) => r.gross * scale - r.costN * cost), gross = recs.map((r) => r.gross * scale);
  const nom = { netAnnPct: pct(mean(net) * WEEKS_PER_YEAR), grossAnnPct: pct(mean(gross) * WEEKS_PER_YEAR), worst4wPct: pct(worstWindow(net, worstN)) };
  const cap = { netAnnPct: pct((mean(net) * WEEKS_PER_YEAR) / capDiv), grossAnnPct: pct((mean(gross) * WEEKS_PER_YEAR) / capDiv), worst4wPct: pct(worstWindow(net, worstN) / capDiv) };
  const entries = recs.reduce((a, r) => a + r.entries, 0);
  return {
    weeks: n, nominal: nom, capital: cap,
    negWeekShare: r3(net.filter((x) => x < 0).length / n),
    turnoverPerYear: r3((entries / n) * WEEKS_PER_YEAR), entries,
    idleShare: r3(recs.filter((r) => !r.held.length).length / n),
    avgHeld: r3(mean(recs.map((r) => r.held.length))),
  };
}
/** Yarılar: hafta başlangıcı HALF_B_START'tan önce → A, değilse B; "all" tümü. */
export function splitHalves(recs) {
  return { A: recs.filter((r) => r.week < HALF_B_START), B: recs.filter((r) => r.week >= HALF_B_START), all: recs };
}

/** Spearman sıra korelasyonu (eşit değerlere ortalama sıra). < 3 nokta → null. */
export function spearman(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(n); for (let i = 0; i < n;) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Hafta bloklu bootstrap: haftalık değerler yerine koyarak yeniden örneklenir; ortalamanın %level aralığı (sabit tohum). */
export function weekBootstrap(vals, { reps = CARRY_DEFAULTS.reps, seed = CARRY_DEFAULTS.seed, level = CARRY_DEFAULTS.level } = {}) {
  const n = vals.length;
  if (n < 2) return null;
  const rnd = mulberry32(seed), m = new Float64Array(reps);
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += vals[Math.floor(rnd() * n)]; m[r] = s / n; }
  m.sort();
  const lo = m[Math.floor(((1 - level) / 2) * reps)], hi = m[Math.min(reps - 1, Math.floor((1 - (1 - level) / 2) * reps))];
  return [lo, hi];
}

/**
 * C2 kalıcılık: her hafta evren = önceki 7 günde ≥ minDays gün ve hafta içinde ≥ 5 gün (120 s) verisi olan coinler (≥ c2MinCoins).
 * Spearman(önceki 7 gün ort., hafta ort.); ilk-5 (eşiksiz, yalnız sıra) gerçekleşen ort. − evren ort. (yıllık %).
 */
export function c2Persistence(panel, weeks, o = CARRY_DEFAULTS) {
  const rows = [];
  weeks.forEach((w, i) => {
    const u = panel.filter((p) => isCand(p.weeks[i].prev, o) && p.weeks[i].real.hours >= 120)
      .map((p) => ({ coin: p.coin, x: p.weeks[i].prev.sum / p.weeks[i].prev.hours, y: p.weeks[i].real.sum / p.weeks[i].real.hours }));
    if (u.length < o.c2MinCoins) return;
    const top = [...u].sort((a, b) => b.x - a.x || (a.coin < b.coin ? -1 : 1)).slice(0, o.topK);
    const uni = mean(u.map((z) => z.y)), t5 = mean(top.map((z) => z.y));
    rows.push({ week: w, n: u.length, rho: spearman(u.map((z) => z.x), u.map((z) => z.y)), top5: t5 * YEAR_H, uni: uni * YEAR_H, diff: (t5 - uni) * YEAR_H });
  });
  const sum = (rs) => {
    if (!rs.length) return null;
    const rhos = rs.map((r) => r.rho).filter((x) => x != null), diffs = rs.map((r) => r.diff), ci = weekBootstrap(diffs, o), ciR = weekBootstrap(rhos, o);
    return {
      weeks: rs.length, avgCoins: r3(mean(rs.map((r) => r.n))),
      rhoMean: r3(mean(rhos)), rhoCi90: ciR ? ciR.map(r3) : null,
      top5AnnPct: pct(mean(rs.map((r) => r.top5))), universeAnnPct: pct(mean(rs.map((r) => r.uni))),
      diffAnnPct: pct(mean(diffs)), diffCi90Pct: ci ? ci.map(pct) : null, top5BeatShare: r3(diffs.filter((d) => d > 0).length / rs.length),
    };
  };
  return { A: sum(rows.filter((r) => r.week < HALF_B_START)), B: sum(rows.filter((r) => r.week >= HALF_B_START)), all: sum(rows) };
}

/** C1 tek grup: satırlar (withPeriods) → yıllık %, pozitif saat payı, kapsanan saat. */
function c1Of(rowsList, from = -Infinity, to = Infinity) {
  let sum = 0, h = 0, pos = 0;
  for (const rows of rowsList) for (const x of rows) if (x.time >= from && x.time < to) { sum += x.rate; h += x.h; if (x.rate > 0) pos += x.h; }
  return h ? { annPct: pct(annualize(sum, h)), eq8hPct: pct(eq8h(sum, h)), posShare: r3(pos / h), hours: h } : null;
}
/** C1 betimsel: coin başına + gruplar (BTC, ETH, ilk 10, tümü; havuzlanmış coin-saat), yarılar ve yıllar. */
export function c1Describe(series, top10) {
  const years = [...new Set(series.flatMap((s) => s.rows.map((x) => new Date(x.time).getUTCFullYear())))].sort();
  const slices = (rl) => ({ all: c1Of(rl), A: c1Of(rl, HALF_A_START, HALF_B_START), B: c1Of(rl, HALF_B_START), byYear: Object.fromEntries(years.map((y) => [y, c1Of(rl, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1))])) });
  const by = new Map(series.map((s) => [s.coin, s.rows]));
  const pick = (cs) => cs.filter((c) => by.has(c)).map((c) => by.get(c));
  const perCoin = series.map((s) => ({ coin: s.coin, hl: s.hl, from: s.rows[0]?.time ?? null, ...c1Of([s.rows]) }));
  const coinAnn = perCoin.map((p) => p.annPct).filter((x) => x != null);
  return {
    groups: { BTC: slices(pick(['BTC'])), ETH: slices(pick(['ETH'])), top10: { coins: top10, ...slices(pick(top10)) }, all: { coins: series.length, ...slices(series.map((s) => s.rows)) } },
    coinMedianAnnPct: r3(median(coinAnn)), perCoin,
  };
}

/**
 * Çapraz denetim tek coin: HL ve OKX günlük toplamları, örtüşen tam günler (OKX ilk / son günü hariç, HL ≥ 23 s).
 * ratioTotal = ΣHL ÷ ΣOKX · ratioMedian = medyan(HL günlük) ÷ medyan(OKX günlük). Payda ≤ 0 → null.
 */
export function crossCoin(hlRows, okxRows) {
  if (!hlRows?.length || !okxRows?.length) return null;
  const hl = dailyIndex(hlRows), ok = new Map();
  for (const x of okxRows) { const d = Math.floor(x.time / DAY) * DAY; ok.set(d, (ok.get(d) || 0) + x.rate); }
  const first = Math.floor(okxRows[0].time / DAY) * DAY, last = Math.floor(okxRows[okxRows.length - 1].time / DAY) * DAY;
  const a = [], b = [];
  for (let d = first + DAY; d < last; d += DAY) { const h = hl.get(d); if (h && h.hours >= 23 && ok.has(d)) { a.push(h.sum); b.push(ok.get(d)); } }
  if (!a.length) return null;
  const sa = a.reduce((x, y) => x + y, 0), sb = b.reduce((x, y) => x + y, 0), ma = median(a), mb = median(b);
  return { days: a.length, hlSum: sa, okxSum: sb, ratioTotal: sb > 0 ? sa / sb : null, ratioMedian: mb > 0 ? ma / mb : null };
}
/** Toplu oran (havuzlanmış toplamlar) bir coin kümesi için. */
export function pooledRatio(per, coins) {
  const xs = coins.map((c) => per[c]).filter(Boolean);
  if (!xs.length) return null;
  const sa = xs.reduce((s, x) => s + x.hlSum, 0), sb = xs.reduce((s, x) => s + x.okxSum, 0);
  return sb > 0 ? sa / sb : null;
}

/** Bir kuralın geçme koşulu (sermaye üzerinden, iki yarıda da): net yıllık > netMinPct ve en kötü 4 hafta > worstMinPct. */
export function rulePasses(halves, o = CARRY_DEFAULTS) {
  if (!halves?.A || !halves?.B) return false;
  return ['A', 'B'].every((h) => halves[h].capital.netAnnPct > o.netMinPct && halves[h].capital.worst4wPct > o.worstMinPct);
}
/** verdict: rules = {R1: {A, B}, …} (null değerli kural = hesaplanamadı). Hepsi null → null. */
export function verdictOf(rules, o = CARRY_DEFAULTS) {
  const vals = Object.values(rules);
  if (!vals.length || vals.every((v) => v == null)) return null;
  const passing = Object.entries(rules).filter(([, v]) => v && rulePasses(v, o)).map(([k]) => k);
  return { passing, result: passing.length ? VERDICT.pass : VERDICT.fail };
}

/**
 * Tam ölçüm. series: [{coin, hl, rows: [{time, rate}] (ham, saatlik)}] (coin = OKX adı); okx: null | {coin: [{time, rate}]};
 * top10: OKX sırasıyla ilk 10 (HL'de olan); end: veri sonu (ms).
 */
export function runCarry({ series, okx = null, top10 = [], end, o = CARRY_DEFAULTS }) {
  const S = series.filter((s) => s.rows?.length).map((s) => ({ ...s, rows: withPeriods(s.rows) }));
  const start = Math.min(...S.map((s) => s.rows[0].time));
  const weeks = buildWeeks(Math.max(start, HALF_A_START), end);
  const panel = weeklyPanel(S, weeks);
  const runs = { R1: ruleR1(panel, weeks), R2: ruleR2(panel, weeks, o), R3: ruleR3(panel, weeks, o) };

  // OKX çapraz denetim (varsa) → kural başına ölçek = 1 ÷ (HL ÷ OKX): R1 BTC+ETH, R2 tüm coinler, R3 BTC
  let cross = { available: false };
  const scale = { R1: null, R2: null, R3: null };
  if (okx && Object.keys(okx).length) {
    const per = {};
    for (const s of S) if (okx[s.coin]?.length) { const c = crossCoin(s.rows, okx[s.coin]); if (c) per[s.coin] = c; }
    const coins = Object.keys(per);
    if (coins.length) {
      const pooled = pooledRatio(per, coins), rBE = pooledRatio(per, ['BTC', 'ETH']), rB = pooledRatio(per, ['BTC']);
      const tot = coins.map((c) => per[c].ratioTotal).filter((x) => x != null), med = coins.map((c) => per[c].ratioMedian).filter((x) => x != null);
      scale.R1 = rBE > 0 ? 1 / rBE : null; scale.R2 = pooled > 0 ? 1 / pooled : null; scale.R3 = rB > 0 ? 1 / rB : null;
      cross = {
        available: true, coins: coins.length,
        pooledRatioTotal: r3(pooled), medianCoinRatioTotal: r3(median(tot)), medianCoinRatioMedian: r3(median(med)),
        ratioUsed: { R1: r3(rBE), R2: r3(pooled), R3: r3(rB) },
        perCoin: Object.fromEntries(coins.map((c) => [c, { days: per[c].days, ratioTotal: r3(per[c].ratioTotal), ratioMedian: r3(per[c].ratioMedian), hlSum: r6(per[c].hlSum), okxSum: r6(per[c].okxSum) }])),
      };
    }
  }

  const c3 = {};
  for (const [label, cost] of Object.entries(COSTS)) {
    c3[label] = { costPct: Math.round(cost * 1e5) / 1e3, rules: {} };
    for (const [k, recs] of Object.entries(runs)) {
      const h = splitHalves(recs);
      const sumH = (sc) => ({ A: summarize(h.A, { cost, scale: sc, capDiv: o.capDiv, worstN: o.worstN }), B: summarize(h.B, { cost, scale: sc, capDiv: o.capDiv, worstN: o.worstN }), all: summarize(h.all, { cost, scale: sc, capDiv: o.capDiv, worstN: o.worstN }) });
      c3[label].rules[k] = { unscaled: sumH(1), scaled: scale[k] != null ? sumH(scale[k]) : null };
    }
  }
  const vc = c3[VERDICT_COST].rules;
  const verdict = {
    cost: VERDICT_COST, costPct: Math.round(COSTS[VERDICT_COST] * 1e5) / 1e3,
    rule: `R1–R3'ten en az biri iki yarıda da sermaye üzerinden net yıllık > %${o.netMinPct} ve en kötü ${o.worstN} hafta > %${o.worstMinPct}`,
    unscaled: verdictOf(Object.fromEntries(Object.entries(vc).map(([k, v]) => [k, v.unscaled])), o),
    scaled: cross.available ? verdictOf(Object.fromEntries(Object.entries(vc).map(([k, v]) => [k, v.scaled])), o) : null,
    infoPreRegCost: verdictOf(Object.fromEntries(Object.entries(c3.preReg.rules).map(([k, v]) => [k, v.unscaled])), o),
  };
  const holdings = Object.fromEntries(Object.entries(runs).map(([k, recs]) => [k, recs.map((r) => ({ week: new Date(r.week).toISOString().slice(0, 10), held: r.held, entries: r.entries, grossPct: pct(r.gross) }))]));
  return {
    period: { from: weeks[0] ?? null, to: weeks.length ? weeks[weeks.length - 1] + WEEK : null, weeks: weeks.length, dataStart: start, dataEnd: end },
    c1: c1Describe(S, top10), c2: c2Persistence(panel, weeks, o), c3, crossCheck: cross, verdict, holdings,
    diag: { regime8hRows: Object.fromEntries(S.map((s) => [s.coin, s.rows.filter((x) => x.h === 8).length]).filter(([, n]) => n > 0)) },
  };
}
