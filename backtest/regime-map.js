// Rejim haritası + "trend yönünde işlem" testi (14.11.2026; tanımlar docs/arastirma/on-kayit-rejim.md, bağlayıcı) — saf fonksiyonlar
// (ağ yok). Betik: backtest/regime-map.mjs. src/scan/regime.js'ten (canlı BTC rejimi) BAĞIMSIZ: buradaki durumlar yalnız bu ölçüm için.
// Parça 1: HT1 (birincil, verdict) · HT2 (bilgi) · plato satırları. Parça 2: betimsel harita (4H sinyaller, momentum, fonlama geliri), verdict YOK.
// Nedensellik: durum t günü kapanışıyla hesaplanır (yalnız ≤ t mumları), t+1 açılışından itibaren geçerlidir.
import { weeklyStats } from './mom-diag.js';
import { statsCi } from './report.js';
import { quoteVolOf } from './lab/xsmom.js';
import { dailyIndex, windowStats, eq8h } from './carry.js';

export const DAY = 86400e3, WEEK = 7 * DAY;
export const UP = 'YUKARI', DOWN = 'AŞAĞI', MIXED = 'KARIŞIK';
export const TRENDS = [UP, DOWN, MIXED];
export const HIGH = 'YÜKSEK', MID = 'ORTA', LOW = 'DÜŞÜK';
export const LEVELS = [HIGH, MID, LOW];
export const ALIGN = { same: 'trendle aynı yön', against: 'trende ters', mixed: 'karışık' };
export const VERDICT = { pass: 'geçti — trend yönü kuralı ileriye dönük kâğıt denemeye değer', fail: 'geçmedi', inconclusive: 'sonuçsuz' };
/** Ön kayıt sayıları (değişmez). Oranlar ondalık: fee 0,00075 = %0,075; fund8h 0,0001 = %0,01 / 8 s; fonlama eşikleri 8 s eşdeğeri. */
export const RM_DEFAULTS = {
  fast: 50, slow: 200, plateaus: [[30, 150], [70, 250]],
  fee: 0.00075, fund8h: 0.0001,
  volWin: 30, volMedDays: 365, volHi: 1.25, volLo: 0.8,
  fundHi: 0.00015, fundLo: 0.00005, fundDays: 7, fundMinDays: 5,
  knownStart: Date.UTC(2022, 10, 24), minIndepWeeks: 52, sharpeMin: 0.5,
  basketN: 30, basketVolDays: 30, basketMin: 10, exclude: ['BTC', 'ETH'],
  minN: 100, minWeeks: 26, reps: 1000, seed: 20261114, level: 0.9,
};

const rd = (x, n = 3) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const dayOf = (t) => Math.floor(t / DAY) * DAY;
/** Pazartesi 00:00 UTC (≤ t). */
export const mondayOf = (t) => { const d = dayOf(t), dow = new Date(d).getUTCDay(); return d - ((dow + 6) % 7) * DAY; };
/** τ anında geçerli durum: son TAMAMLANMIŞ günün (τ'dan önce kapanan) durumu. Günlük mum t açılış zamanıyla anahtarlı. */
export const stateAt = (map, tau) => (map ? map.get(dayOf(tau) - DAY) ?? null : null);

// ---------------- Durum değişkenleri ----------------
/** Basit hareketli ortalama dizisi (i. eleman = son n kapanışın ortalaması, i < n − 1 → null). */
export function smaArr(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
/** Trend durumu (ön kayıt): YUKARI = kapanış > SMA hızlı ve SMA hızlı > SMA yavaş · AŞAĞI = tersi · aksi KARIŞIK; yavaş SMA yoksa null. */
export function trendOf(close, f, s) {
  if (f == null || s == null) return null;
  if (close > f && f > s) return UP;
  if (close < f && f < s) return DOWN;
  return MIXED;
}
/** Günlük mumlar → Map(gün açılış zamanı → durum); yalnız yavaş SMA oluşmuş günler. */
export function trendStates(candles, fast = RM_DEFAULTS.fast, slow = RM_DEFAULTS.slow) {
  const c = candles.map((x) => x.close), F = smaArr(c, fast), S = smaArr(c, slow), out = new Map();
  for (let i = 0; i < candles.length; i++) { const st = trendOf(c[i], F[i], S[i]); if (st) out.set(candles[i].time, st); }
  return out;
}
/** Seviye (oynaklık / fonlama): > hi YÜKSEK · < lo DÜŞÜK · aksi ORTA. */
export const levelOf = (x, hi, lo) => (x == null || !Number.isFinite(x) ? null : x > hi ? HIGH : x < lo ? LOW : MID);
/**
 * Oynaklık durumu: 30 günlük günlük-getiri (kapanıştan kapanışa) örnek std'si ÷ son 365 günün (t dahil) aynı std değerlerinin medyanı.
 * 365 geçerli std yoksa durum yok. → { states: Map(gün → durum), ratio: Map(gün → oran) }.
 */
export function volStates(candles, o = RM_DEFAULTS) {
  const n = candles.length, sd = new Array(n).fill(null);
  for (let i = o.volWin; i < n; i++) {
    const r = []; for (let k = i - o.volWin + 1; k <= i; k++) r.push(candles[k].close / candles[k - 1].close - 1);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    sd[i] = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  }
  const states = new Map(), ratio = new Map();
  for (let i = 0; i < n; i++) {
    if (sd[i] == null || i - o.volMedDays + 1 < 0) continue;
    const w = sd.slice(i - o.volMedDays + 1, i + 1);
    if (w.some((x) => x == null)) continue;
    const med = median(w); if (!(med > 0)) continue;
    const x = sd[i] / med; ratio.set(candles[i].time, x); states.set(candles[i].time, levelOf(x, o.volHi, o.volLo));
  }
  return { states, ratio };
}
/**
 * Fonlama durumu (BTC, Hyperliquid): t günü için [t − 6 g, t + 1 g) penceresinin (son 7 gün, t dahil) 8 saatlik eşdeğer ortalaması
 * (oran toplamı ÷ kapsanan saat × 8). Pencerede < fundMinDays gün veri → durum yok. rows: withPeriods çıktısı. days: gün açılış zamanları.
 */
export function fundingStates(rows, days, o = RM_DEFAULTS) {
  const daily = dailyIndex(rows), states = new Map(), value = new Map();
  for (const d of days) {
    const w = windowStats(daily, d - (o.fundDays - 1) * DAY, d + DAY);
    if (w.days < o.fundMinDays) continue;
    const x = eq8h(w.sum, w.hours); value.set(d, x); states.set(d, levelOf(x, o.fundHi, o.fundLo));
  }
  return { states, value };
}

// ---------------- Getiri aritmetiği ----------------
/**
 * Bir günün portföy getirisi (ağırlık değişimi gün açılışında). prevW / w: Map(varlık → ağırlık; + long, − short), rets: Map(varlık →
 * açılış → ertesi açılış getirisi). Maliyet = fee × Σ|Δw| (boş → long 1 birim, long → short 2 birim), fonlama = 3 × fund8h × Σ|w|.
 * Bacaklar: long = pozitif ağırlıkların getirisi − pozitif kısmın değişim maliyeti − fonlaması (short simetrik); long + short = net.
 */
export function dayReturn(prevW, w, rets, { fee = RM_DEFAULTS.fee, fund8h = RM_DEFAULTS.fund8h } = {}) {
  const keys = new Set([...prevW.keys(), ...w.keys()]);
  const pos = (x) => Math.max(x, 0), neg = (x) => Math.min(x, 0);
  let gL = 0, gS = 0, cL = 0, cS = 0, fL = 0, fS = 0;
  for (const k of keys) {
    const a = prevW.get(k) || 0, b = w.get(k) || 0, r = rets.get(k) || 0;
    gL += pos(b) * r; gS += neg(b) * r;
    cL += fee * Math.abs(pos(b) - pos(a)); cS += fee * Math.abs(neg(b) - neg(a));
    fL += 3 * fund8h * pos(b); fS += 3 * fund8h * -neg(b);
  }
  const long = gL - cL - fL, short = gS - cS - fS;
  return { gross: gL + gS, cost: cL + cS, fund: fL + fS, long, short, net: long + short };
}
const posOf = (st) => (st === UP ? 1 : st === DOWN ? -1 : 0);
/** Seri hazırlığı: { candles, idx: Map(zaman → i) }. */
export const prep = (candles) => ({ candles, idx: new Map(candles.map((x, i) => [x.time, i])) });
/** d günü (açılış) → d + 1 açılışı getirisi; mum yoksa null. */
export function retOO(s, d) {
  const i = s.idx.get(d), j = s.idx.get(d + DAY);
  if (i == null || j == null || !(s.candles[i].open > 0)) return null;
  return s.candles[j].open / s.candles[i].open - 1;
}

/**
 * HT1 günlük seri: her varlık kendi durumuna göre (YUKARI long, AŞAĞI short, KARIŞIK boş), ağırlık 1 / varlık sayısı (biri boşsa o pay
 * nakitte). d tutma günü: pozisyon = durum(d − 1 kapanışı), getiri açılış(d) → açılış(d + 1). Başlangıç = her varlığın durumu olan ilk
 * günün ertesi (en geç olanı); son = her varlığın d + 1 açılışı olan son gün. Al-tut: aynı günler, eşit ağırlık, maliyetsiz (bhF: tam
 * nominal üzerinden fonlama maliyetiyle). assets: [{ coin, candles, states: Map }]. → { rows: [{ day, net, long, short, ..., bh, bhF }], start, end }
 */
export function ht1Days(assets, o = RM_DEFAULTS) {
  const A = assets.map((a) => ({ ...a, s: prep(a.candles) }));
  if (!A.length || A.some((a) => !a.states.size || a.candles.length < 2)) return { rows: [], start: null, end: null };
  const start = Math.max(...A.map((a) => Math.min(...a.states.keys()) + DAY));
  const end = Math.min(...A.map((a) => a.candles[a.candles.length - 1].time - DAY));
  const rows = [], N = A.length;
  let prevW = new Map();
  for (let d = start; d <= end; d += DAY) {
    const w = new Map(), rets = new Map();
    let bh = 0;
    for (const a of A) {
      const r = retOO(a.s, d), st = a.states.get(d - DAY) ?? null;
      if (r == null) continue; // veri boşluğu: o pay nakitte
      rets.set(a.coin, r); bh += r / N;
      const p = posOf(st); if (p) w.set(a.coin, p / N);
    }
    const x = dayReturn(prevW, w, rets, o);
    rows.push({ day: d, ...x, bh, bhF: bh - 3 * o.fund8h, w: Object.fromEntries(w) });
    prevW = w;
  }
  return { rows, start, end };
}

/**
 * HT2 günlük seri (bilgi): alt coin sepeti (karar günü d − 1: o güne kadarki son basketVolDays günün USDT hacmine göre ilk basketN, BTC ve
 * ETH hariç, ≥ basketVolDays gün geçmiş; eşit ağırlık), yön BTC'nin trend durumuna göre (YUKARI long, AŞAĞI short, KARIŞIK boş). Sepette
 * < basketMin coin → boş. Getirisi olmayan üye (veri sonu / boşluk) nakit. end: son tutma günü (BTC'nin d + 1 açılışı olan). → { rows, start, end }
 */
export function ht2Days(alts, btcStates, o = RM_DEFAULTS, end = Infinity) {
  const S = alts.filter((a) => !o.exclude.includes(a.coin) && a.candles.length > o.basketVolDays).map((a) => {
    const s = prep(a.candles), cum = [0];
    for (const x of a.candles) cum.push(cum[cum.length - 1] + (quoteVolOf(x) || 0));
    return { coin: a.coin, ...s, cum };
  });
  if (!S.length || !btcStates.size) return { rows: [], start: null, end: null };
  const days = [...btcStates.keys()].sort((a, b) => a - b).map((t) => t + DAY).filter((d) => d <= end);
  const rows = [];
  let prevW = new Map(), started = false;
  for (const d of days) {
    const dec = d - DAY, pos = posOf(btcStates.get(dec));
    const cand = [];
    for (const s of S) { const i = s.idx.get(dec); if (i == null || i + 1 < o.basketVolDays) continue; cand.push({ s, vol: s.cum[i + 1] - s.cum[i + 1 - o.basketVolDays] }); }
    cand.sort((a, b) => b.vol - a.vol || (a.s.coin < b.s.coin ? -1 : 1));
    const mem = cand.slice(0, o.basketN);
    if (!started && mem.length < o.basketMin) continue;
    if (!started) started = true;
    const rets = new Map(), w = new Map();
    for (const m of mem) { const r = retOO(m.s, d); if (r != null) rets.set(m.s.coin, r); }
    if (pos && mem.length >= o.basketMin) for (const m of mem) if (rets.has(m.s.coin)) w.set(m.s.coin, pos / mem.length);
    const x = dayReturn(prevW, w, rets, o);
    rows.push({ day: d, ...x, k: mem.length, pos });
    prevW = w;
  }
  return { rows, start: rows[0]?.day ?? null, end: rows.at(-1)?.day ?? null };
}

/** Haftalık toplama: pazartesiden pazartesiye günlük getirilerin toplamı (%); yalnız 7 günü de [from, to] içinde olan haftalar. */
export function weeklyOf(rows, field, from, to) {
  const by = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  let M = mondayOf(from); if (M < from) M += WEEK;
  for (; M + 6 * DAY <= to; M += WEEK) {
    let s = 0, n = 0;
    for (let k = 0; k < 7; k++) { const r = by.get(M + k * DAY); if (r) { s += r[field]; n++; } }
    if (n) out.push({ w: Math.round(M / WEEK), start: M, v: s * 100 });
  }
  return out;
}
/** Haftalık istatistik (%): ort., %90 hafta bloklu bootstrap aralığı, yıllık Sharpe, maks. düşüş (birikimli toplam), en kötü hafta. */
export function weekStats(weeks, o = RM_DEFAULTS) {
  const s = weeklyStats(weeks, 'v', { reps: o.reps, seed: o.seed, level: o.level });
  return { ...s, worstWeekPct: weeks.length ? rd(Math.min(...weeks.map((x) => x.v)), 2) : null };
}
/** Dönem raporu: toplam / long / short bacak / al-tut (maliyetsiz) / al-tut fonlamalı. */
export function periodReport(rows, from, to, o = RM_DEFAULTS) {
  const f = (k) => weekStats(weeklyOf(rows, k, from, to), o);
  return { from, to, total: f('net'), long: f('long'), short: f('short'), ...(rows[0]?.bh !== undefined ? { buyHold: f('bh'), buyHoldFunding: f('bhF') } : {}) };
}

/** Durum özeti (gün = durumun geçerli olduğu tutma günü, [from, to]): gün payı, durum değişim sayısı, ardışık aynı-durum dönemleri. */
export function stateSummary(states, from, to, labels = TRENDS) {
  const keys = [...states.keys()].filter((t) => t + DAY >= from && t + DAY <= to).sort((a, b) => a - b);
  const counts = {}, runs = [];
  let changes = 0, prev = null, len = 0;
  for (const t of keys) {
    const st = states.get(t);
    counts[st] = (counts[st] || 0) + 1;
    if (prev != null && st !== prev) { changes++; runs.push({ st: prev, len }); len = 0; }
    prev = st; len++;
  }
  if (prev != null) runs.push({ st: prev, len });
  const n = keys.length;
  labels = [...new Set([...labels, ...Object.keys(counts)])];
  const runsBy = Object.fromEntries(labels.map((l) => { const r = runs.filter((x) => x.st === l).map((x) => x.len); return [l, { runs: r.length, medianDays: median(r), maxDays: r.length ? Math.max(...r) : null }]; }));
  const trendRuns = runs.filter((x) => x.st === UP || x.st === DOWN).map((x) => x.len);
  return { days: n, share: Object.fromEntries(labels.map((l) => [l, n ? rd((counts[l] || 0) / n) : null])), changes, runs: runs.length, runsBy, trendRuns: { n: trendRuns.length, medianDays: median(trendRuns) } };
}

/**
 * HT1 bir satır (SMA hızlı / yavaş): her varlık kendi durumu → günlük seri → bağımsız [başlangıç, knownStart) ve bilinen [knownStart, son]
 * dönem raporları + durum özetleri. assets: [{ coin, candles }].
 */
export function ht1Row(assets, fast, slow, o = RM_DEFAULTS) {
  const A = assets.map((a) => ({ ...a, states: trendStates(a.candles, fast, slow) }));
  const { rows, start, end } = ht1Days(A, o);
  if (!rows.length) return { fast, slow, available: false, reason: 'durum oluşmadı (SMA yavaş için yetersiz veri)' };
  const ks = o.knownStart;
  const periods = {
    indep: start < ks ? periodReport(rows, start, Math.min(end, ks - DAY), o) : null,
    known: end >= ks ? periodReport(rows, Math.max(start, ks), end, o) : null,
  };
  const states = Object.fromEntries(A.map((a) => [a.coin, {
    firstState: a.states.size ? Math.min(...a.states.keys()) : null,
    indep: start < ks ? stateSummary(a.states, start, Math.min(end, ks - DAY)) : null,
    known: end >= ks ? stateSummary(a.states, Math.max(start, ks), end) : null,
  }]));
  return { fast, slow, available: true, start, end, periods, states, _rows: rows };
}

/**
 * HT1 geçme ölçütü (ön kayıt): bağımsız dönemde ort > 0, %90 alt uç > 0, Sharpe ≥ 0,5, short bacak ort > 0; bilinen dönemde toplam ve
 * short bacak ort > 0; plato satırları iki dönemde de toplam ort > 0. Bağımsız dönem < 52 hafta → 'sonuçsuz'.
 */
export function verdictOf(main, plateaus, o = RM_DEFAULTS) {
  const I = main?.periods?.indep, K = main?.periods?.known;
  const gt0 = (x) => x != null && Number.isFinite(x) && x > 0;
  const checks = {
    indepWeeksEnough: (I?.total?.weeks ?? 0) >= o.minIndepWeeks,
    indepMeanPos: gt0(I?.total?.meanPct),
    indepCiLowPos: !!(I?.total?.ci90 && I.total.ci90[0] > 0),
    indepSharpe: I?.total?.sharpe != null && I.total.sharpe >= o.sharpeMin,
    indepShortPos: gt0(I?.short?.meanPct),
    knownMeanPos: gt0(K?.total?.meanPct),
    knownShortPos: gt0(K?.short?.meanPct),
  };
  for (const p of plateaus) checks[`plateau_${p.fast}_${p.slow}`] = gt0(p?.periods?.indep?.total?.meanPct) && gt0(p?.periods?.known?.total?.meanPct);
  const { indepWeeksEnough, ...rest } = checks;
  const verdict = !indepWeeksEnough ? VERDICT.inconclusive : Object.values(rest).every(Boolean) ? VERDICT.pass : VERDICT.fail;
  return { verdict, checks };
}

// ---------------- Parça 2: betimsel hücreler ----------------
/** 4H sinyal yönü × BTC trend durumu → hizalama etiketi. d: 1 long, −1 short. */
export function alignOf(d, btcState) {
  if (btcState == null) return null;
  if (btcState === MIXED) return ALIGN.mixed;
  return (d === 1 && btcState === UP) || (d === -1 && btcState === DOWN) ? ALIGN.same : ALIGN.against;
}
/** İşlem hücresi: statsCi (gün bloklu %90) — sinyal, n (dolan), ort. R, aralık, "sonuçsuz" (n < 100). */
export function tradeCell(trades, o = RM_DEFAULTS) {
  const s = statsCi(trades, { reps: o.reps, seed: o.seed, level: o.level });
  return { signals: trades.length, n: s.n, avgR: s.n ? s.avgR : null, ci90: s.ci90, inconclusive: s.n < o.minN };
}
/** Hafta hücresi: hafta sayısı, ort. %, %90 hafta bloklu aralık, "sonuçsuz" (< 26 hafta). */
export function weekCell(weeks, o = RM_DEFAULTS) {
  const s = weeklyStats(weeks, 'v', { reps: o.reps, seed: o.seed, level: o.level });
  return { weeks: s.weeks, meanPct: s.meanPct, ci90: s.ci90, inconclusive: s.weeks < o.minWeeks };
}
const groupCells = (items, keyOf, labels, cellFn) => {
  const g = Object.fromEntries(labels.map((l) => [l, []])); let noState = 0;
  for (const x of items) { const k = keyOf(x); if (k == null) { noState++; continue; } (g[k] ||= []).push(x); }
  return { cells: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, cellFn(v)])), noState };
};

/**
 * 4H sinyaller: rows [{ d, decided, A: { time, tf, outcome, R, waitBars, ... } }] → karar anındaki BTC trend / oynaklık durumuna göre
 * hücreler: hizalama (aynı / ters / karışık), yön × trend, oynaklık. trend / vol: Map(gün → durum).
 */
export function signalsMap(rows, trend, vol, o = RM_DEFAULTS) {
  const cell = (x) => tradeCell(x.map((r) => r.A), o);
  const dirLab = (d) => (d === 1 ? 'long' : 'short');
  const all = tradeCell(rows.map((r) => r.A), o);
  const byAlign = groupCells(rows, (r) => alignOf(r.d, stateAt(trend, r.decided)), Object.values(ALIGN), cell);
  const byDirTrend = groupCells(rows, (r) => { const st = stateAt(trend, r.decided); return st ? `${dirLab(r.d)} · ${st}` : null; }, ['long', 'short'].flatMap((d) => TRENDS.map((t) => `${d} · ${t}`)), cell);
  const byVol = groupCells(rows, (r) => stateAt(vol, r.decided), LEVELS, cell);
  return { all, byAlign: byAlign.cells, byDirTrend: byDirTrend.cells, byVol: byVol.cells, noState: { trend: byAlign.noState, vol: byVol.noState } };
}
/** Haftalık seri [{ w, start (pazartesi), v (%) }] → hafta başındaki (önceki pazar kapanışı) durumlara göre hücreler. maps: { ad: { map, labels } }. */
export function weeklyMap(weeks, maps, o = RM_DEFAULTS) {
  const out = { all: weekCell(weeks, o) };
  for (const [name, { map, labels }] of Object.entries(maps)) {
    const g = groupCells(weeks, (x) => stateAt(map, x.start), labels, (v) => weekCell(v, o));
    out[name] = g.cells; out[`${name}NoState`] = g.noState;
  }
  return out;
}

// ---------------- Sentetik veri (test + --fixture) ----------------
/** Deterministik PRNG (mulberry32 ile aynı biçim, bağımlılık yok) ve standart normal. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
/**
 * Sentetik günlük mumlar: n gün, t0'dan; günlük log getiri = drift(gün) + sigma × N(0,1). drift: sayı ya da (k) => sayı.
 * Açılış = önceki kapanış; hacim (quoteVol) pozitif rastgele.
 */
export function synthDaily({ n, t0 = Date.UTC(2019, 0, 1), seed = 1, start = 100, drift = 0, sigma = 0.02, vol = 1e6 }) {
  const r = prng(seed), out = [];
  let p = start;
  for (let k = 0; k < n; k++) {
    const o = p, mu = typeof drift === 'function' ? drift(k) : drift;
    const c = o * Math.exp(mu + sigma * gauss(r));
    const hi = Math.max(o, c) * (1 + 0.005 * r()), lo = Math.min(o, c) * (1 - 0.005 * r());
    out.push({ time: t0 + k * DAY, open: o, high: hi, low: lo, close: c, volume: (vol * (0.5 + r())) / c, quoteVol: vol * (0.5 + r()) });
    p = c;
  }
  return out;
}
/** Kalıcı trendli drift: period günlük bloklar, yukarı / aşağı dönüşümlü (± mu). */
export const regimeDrift = (period, mu) => (k) => (Math.floor(k / period) % 2 === 0 ? mu : -mu);

// ---------------- Momentum (Parça 2) ----------------
/**
 * Momentum eşit risk bilgi satırı (mom-stage1 INFO_DEFS.T_eqRisk: short_rel L28 k5, BTC hedge'li, canlı eşit risk boyutlaması) tek akış:
 * startMs'ten (24.11.2022) veri sonuna, mom-stage1 rowReport ile. series: [{ coin, candles }] (ısınma dahil). Son hafta eksikse atılır.
 * → [{ w, start (pazartesi), v (%) }]
 */
export async function momentumWeeks(series, { startMs = RM_DEFAULTS.knownStart, pitN = 50 } = {}) {
  const { rowReport, INFO_DEFS } = await import('./mom-stage1.js');
  const dataEnd = Math.max(...series.map((s) => s.candles.at(-1)?.time ?? 0));
  const r = rowReport(series, INFO_DEFS.T_eqRisk, { startMs, dataEnd, split: null, pitN });
  if (!r.trades) return { weeks: [], trades: 0, dataEnd };
  let weeks = r._weekly.map((v, k) => ({ w: Math.round((r.firstWeek + k * WEEK) / WEEK), start: r.firstWeek + k * WEEK, v }));
  if (r.lastWeekPartial) weeks = weeks.slice(0, -1);
  return { weeks, trades: r.trades, dataEnd, firstWeek: r.firstWeek, lastWeekPartialDropped: !!r.lastWeekPartial };
}

// ---------------- Uçtan uca (saf) ----------------
const strip = (row) => { if (!row || !row._rows) return row; const { _rows, ...x } = row; return x; };
/**
 * daily: { BTC: candles, ETH: candles } (zorunlu; yoksa Parça 1 "veri yok"); alts: [{ coin, candles }] | { unavailable }; funding:
 * { BTC: rows, ETH: rows } (withPeriods) | { unavailable }; signals: [{ d, decided, A }] | { unavailable }; momentum: { weeks } |
 * { unavailable }. → { meta, states, ht1, ht2, map: { signals4h, momentum, carry } }
 */
export async function runRegimeMap({ daily = {}, alts = null, funding = null, signals = null, momentum = null, o: oIn = {}, meta = {} }) {
  const o = { ...RM_DEFAULTS, ...oIn };
  const missing = [];
  const na = (part, reason) => { missing.push(`${part}: ${reason}`); return { available: false, reason: `veri yok: ${reason}` }; };
  const has = (c) => Array.isArray(daily[c]) && daily[c].length > o.slow;
  const assets = ['BTC', 'ETH'].filter(has).map((coin) => ({ coin, candles: daily[coin] }));
  const dataStart = Object.fromEntries(['BTC', 'ETH'].map((c) => [c, daily[c]?.length ? daily[c][0].time : null]));
  const dataEnd = Object.fromEntries(['BTC', 'ETH'].map((c) => [c, daily[c]?.length ? daily[c].at(-1).time : null]));

  // Durum değişkenleri (BTC)
  const btc = has('BTC') ? daily.BTC : null;
  const trendBtc = btc ? trendStates(btc, o.fast, o.slow) : null;
  const volBtc = btc ? volStates(btc, o).states : null;
  let fundBtc = null;
  const fundOk = funding && !funding.unavailable && funding.BTC?.length;
  if (fundOk) {
    const d0 = dayOf(funding.BTC[0].time), d1 = dayOf(funding.BTC.at(-1).time), days = [];
    for (let d = d0; d <= d1; d += DAY) days.push(d);
    fundBtc = fundingStates(funding.BTC, days, o).states;
  }

  // Parça 1 — HT1 (+ plato)
  let ht1;
  if (assets.length < 2) ht1 = { ...na('ht1', `BTC / ETH günlük mum yok ya da < ${o.slow + 1} gün (${['BTC', 'ETH'].map((c) => `${c} ${daily[c]?.length || 0}`).join(', ')})`), verdict: VERDICT.inconclusive, checks: {} };
  else {
    const main = ht1Row(assets, o.fast, o.slow, o);
    const plats = o.plateaus.map(([f, s]) => ht1Row(assets, f, s, o));
    const v = main.available ? verdictOf(main, plats, o) : { verdict: VERDICT.inconclusive, checks: {} };
    ht1 = { available: main.available, main: strip(main), plateaus: Object.fromEntries(plats.map((p) => [`sma${p.fast}_${p.slow}`, strip(p)])), ...v };
  }

  // HT2 (bilgi)
  let ht2;
  if (!trendBtc) ht2 = na('ht2', 'BTC günlük mum yok');
  else if (!alts || alts.unavailable) ht2 = na('ht2', alts?.unavailable || 'alt coin mumları verilmedi');
  else {
    const { rows, start, end } = ht2Days(alts, trendBtc, o, btc.at(-1).time - DAY);
    if (!rows.length) ht2 = na('ht2', `sepet ≥ ${o.basketMin} coin hiç oluşmadı`);
    else {
      const ks = o.knownStart;
      ht2 = {
        available: true, start, end, coins: alts.length,
        basketSize: { min: Math.min(...rows.map((r) => r.k)), median: median(rows.map((r) => r.k)), max: Math.max(...rows.map((r) => r.k)) },
        periods: { indep: start < ks ? periodReport(rows, start, Math.min(end, ks - DAY), o) : null, known: end >= ks ? periodReport(rows, Math.max(start, ks), end, o) : null },
      };
    }
  }

  // Durum özetleri
  const ks = o.knownStart, m = ht1.available ? ht1.main : null;
  const states = {
    trend: m ? m.states : null,
    btcVol: volBtc && m ? { indep: m.start < ks ? stateSummary(volBtc, m.start, ks - DAY, LEVELS) : null, known: stateSummary(volBtc, Math.max(m.start, ks), m.end, LEVELS), firstState: volBtc.size ? Math.min(...volBtc.keys()) : null } : null,
    btcFunding: fundBtc?.size ? { all: stateSummary(fundBtc, Math.min(...fundBtc.keys()) + DAY, Math.max(...fundBtc.keys()) + DAY, LEVELS), firstState: Math.min(...fundBtc.keys()) } : null,
    note: 'gün = durumun geçerli olduğu tutma günü (durum t kapanışı → t + 1); runs = ardışık aynı-durum dönemleri, trendRuns = YUKARI / AŞAĞI dönemleri',
  };

  // Parça 2 — 4H sinyaller
  let signals4h;
  if (!trendBtc) signals4h = na('signals4h', 'BTC günlük mum yok');
  else if (!signals || signals.unavailable) signals4h = na('signals4h', signals?.unavailable || 'sinyal verilmedi');
  else {
    const times = signals.map((r) => r.decided);
    signals4h = { available: true, from: Math.min(...times), to: Math.max(...times), ...signalsMap(signals, trendBtc, volBtc, o) };
  }
  // Momentum
  let momentumCell;
  if (!trendBtc) momentumCell = na('momentum', 'BTC günlük mum yok');
  else if (!momentum || momentum.unavailable) momentumCell = na('momentum', momentum?.unavailable || 'momentum verilmedi');
  else if (!momentum.weeks.length) momentumCell = na('momentum', 'momentum işlemi yok');
  else momentumCell = { available: true, from: momentum.weeks[0].start, to: momentum.weeks.at(-1).start, trades: momentum.trades, ...weeklyMap(momentum.weeks, { trend: { map: trendBtc, labels: TRENDS }, vol: { map: volBtc, labels: LEVELS } }, o) };
  // Fonlama geliri (R1: BTC + ETH sürekli, brüt haftalık fonlama)
  let carryCell;
  if (!fundOk || !funding.ETH?.length) carryCell = na('carry', funding?.unavailable || 'BTC / ETH fonlama geçmişi yok');
  else {
    const { buildWeeks, weeklyPanel, ruleR1 } = await import('./carry.js');
    const from = Math.max(funding.BTC[0].time, funding.ETH[0].time), end = Math.min(funding.BTC.at(-1).time, funding.ETH.at(-1).time) + 3600e3;
    const wk = buildWeeks(from, end), panel = weeklyPanel([{ coin: 'BTC', rows: funding.BTC }, { coin: 'ETH', rows: funding.ETH }], wk);
    const weeks = ruleR1(panel, wk).map((r) => ({ w: Math.round(r.week / WEEK), start: r.week, v: r.gross * 100 }));
    carryCell = { available: true, from: wk[0] ?? null, to: wk.at(-1) ?? null, ...(trendBtc ? {} : { note: 'BTC günlük mum yok → trend hücreleri durumsuz' }), ...weeklyMap(weeks, { trend: { map: trendBtc, labels: TRENDS }, funding: { map: fundBtc, labels: LEVELS } }, o) };
  }

  return {
    meta: {
      generatedAt: meta.now ?? null, preReg: 'docs/arastirma/on-kayit-rejim.md', ...meta,
      data: { start: dataStart, end: dataEnd, fundingStart: fundOk ? { BTC: funding.BTC[0].time, ETH: funding.ETH?.[0]?.time ?? null } : null },
      periods: m ? { indep: m.periods.indep ? { from: m.periods.indep.from, to: m.periods.indep.to } : null, known: m.periods.known ? { from: m.periods.known.from, to: m.periods.known.to } : null, knownStart: ks } : { knownStart: ks },
      params: { ...o, plateaus: o.plateaus.map(([f, s]) => `${f}/${s}`) },
      seed: o.seed, missing,
      defs: {
        trend: 'YUKARI = kapanış > SMA hızlı ve SMA hızlı > SMA yavaş · AŞAĞI = tersi · aksi KARIŞIK; t kapanışı → t + 1 açılışından geçerli; SMA yavaş oluşmadan durum yok',
        vol: 'BTC 30 g günlük getiri (kapanış → kapanış) örnek std ÷ son 365 günün (t dahil) aynı std medyanı; > 1,25 YÜKSEK, < 0,8 DÜŞÜK; 365 std yoksa durum yok',
        funding: 'BTC Hyperliquid, t dahil son 7 gün: oran toplamı ÷ kapsanan saat × 8 (8 s eşdeğer); > %0,015 YÜKSEK, < %0,005 DÜŞÜK; pencerede < 5 gün veri → durum yok',
        ht1: 'BTC ve ETH, her biri kendi durumu (YUKARI long, AŞAĞI short, KARIŞIK boş), ağırlık 1/2 (boş pay nakit); getiri açılış(t+1) → açılış(t+2); maliyet = %0,075 × |Δağırlık| (boş→long 1 birim, long→short 2 birim) + 3 × %0,01 × |ağırlık| / gün; long / short bacak: pozitif / negatif ağırlıkların getirisi − kendi değişim maliyeti − kendi fonlaması (toplam = long + short)',
        periods: 'satır başına başlangıç = her iki varlığın durumu olan ilk günün ertesi (en geç olanı); bağımsız = başlangıç → 23.11.2022, bilinen = 24.11.2022 → veri sonu; haftalık = pazartesi → pazar 7 günlük getiri toplamı (%), yalnız 7 günü de dönem içinde olan haftalar (24.11.2022\'yi içeren hafta iki dönemde de yok)',
        buyHold: 'aynı günler, BTC + ETH eşit ağırlık sürekli long, maliyetsiz; buyHoldFunding: tam nominal × 3 × %0,01 / gün',
        ci: 'hafta bloklu bootstrap (her hafta bir blok, 1000 tekrar, tohum 20261114), %90; Sharpe = ort / sd × √52; maks. düşüş = birikimli % toplamın tepeden düşüşü',
        ht2: 'alt sepet: karar günü (t) dahil son 30 günün USDT hacmine göre ilk 30 (BTC, ETH hariç; ≥ 30 gün geçmiş), eşit ağırlık, BTC trend durumuna göre long / short / boş; < 10 coin → boş; havuz = bugünün OKX hacimde ilk N\'i (hayatta kalma yanlılığı)',
        signals4h: 'Aşama 1 plan seti, taban satır (gerçekçi), tüm dilimler (24.11.2024 →); durum = karar anından (plan mumu kapanışı) önce kapanan son günün BTC durumu; trendle aynı yön = (long ∧ YUKARI) ∨ (short ∧ AŞAĞI), ters = tersi, karışık = BTC KARIŞIK; hücre = dolan işlem n, ort. R, gün bloklu %90 (report.js statsCi); n < 100 sonuçsuz',
        momentum: 'mom-stage1 T_eqRisk (short_rel L28 k5, BTC hedge\'li, eşit risk ağırlığı) TEK akış 24.11.2022 → veri sonu (100 gün ısınma); hafta durumu = dengeleme anı (pazar kapanışı) BTC durumu; < 26 hafta sonuçsuz',
        carry: 'carry.js R1 (BTC + ETH sürekli, eşit ağırlık) brüt haftalık fonlama (short alır, %), maliyet yok; hafta başı (pazar kapanışı) BTC trend ve fonlama durumu',
      },
    },
    states, ht1, ht2,
    map: { signals4h, momentum: momentumCell, carry: carryCell },
  };
}
