// Bilgi taraması (14.11.2026; tanımlar docs/arastirma/on-kayit-tarama.md, bağlayıcı) — saf fonksiyonlar (ağ yok).
// Betik: backtest/screen.mjs. Strateji backtest'i DEĞİL: stop / hedef / maliyet yok; olay / grup sonrası göreli getiri ↔ aynı
// günden rastgele seçim (plasebo). Kural önermez; tablo + ön kayıtlı geçme ölçütüne göre verdict.
import * as I from '../src/data/indicators.js';
import { quoteVolOf } from './lab/xsmom.js';
import { blockCi, seedOf, sampleK } from './diag.js';
import { mulberry32 } from './report.js';
import { fundingIntervalH, to8h } from './mom-diag.js';
import { analyzeRow, barsFor } from '../src/scan/scanner.js';
import { buildPlan, onCooldown } from '../bot/plan.js';

export const DAY = 86400e3, WEEK = 7 * DAY;
export const HALF_A_START = Date.UTC(2022, 10, 24), HALF_B_START = Date.UTC(2024, 10, 24);
export const SCREEN_DEFAULTS = {
  universeN: 80, volDays: 30, minHistory: 60, // dönem evreni: önceki 30 günün USDT hacmine göre ilk 80, ≥ 60 günlük geçmiş
  draws: 1000, reps: 2000, level: 0.99, seed: 20261114,
  minEvents: 100, minWeeks: 60,
  k1: { thr: 0.25, strictThr: 0.40, volX: 3, medDays: 30, primary: 3, horizons: [1, 3, 7] },
  k2: { thr: -0.20, volX: 3, medDays: 30, primary: 3, horizons: [1, 3, 7] },
  k3: { primary: 7, horizons: [3, 7, 14], momDays: 28, aWindowDays: 90, top: 50 },
  k4: { ageMin: 30, ageMax: 120, buckets: [[30, 60], [60, 120], [120, 365], [365, Infinity]], primary: 7, horizons: [1, 3, 7] },
  k5: { days: 7, primary: 7, horizons: [1, 3, 7] },
  k6: { days: 28, primary: 7, horizons: [1, 3, 7] },
  dedupDays: 7,
};
export const VERDICT = { pass: 'ileriye dönük denemeye değer', fail: 'geçmedi', inconclusive: 'sonuçsuz' };

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const rd = (x, n = 3) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const qOf = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : null);
export const halfOf = (t) => (t >= HALF_B_START ? 'B' : t >= HALF_A_START ? 'A' : null);

/** Seriler (1D) → { coin, c, idx, qv, cum, atr, first } (first = ilk günlük mum = OKX swap'ındaki ilk mum varsayımı). */
export function prepScreen(seriesByCoin) {
  return seriesByCoin.filter((s) => s.candles?.length).map((s) => {
    const c = s.candles;
    const qv = c.map((x) => quoteVolOf(x) || 0);
    const cum = [0]; for (const v of qv) cum.push(cum[cum.length - 1] + v);
    const atr = I.atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14);
    return { coin: s.coin, c, idx: new Map(c.map((x, i) => [x.time, i])), qv, cum, atr, first: c[0].time };
  });
}

/**
 * Bağlam: seriler + önbellekler. universe(t): t günü dönem evreni (yalnız t'den ÖNCEKİ volDays günün hacmi; t'nin kendi hacmi
 * girmez), ≥ minHistory mum geçmiş (t mumundan önce), BTC dahil. → [{ s, i }] hacme göre azalan.
 */
export function makeCtx(series, p = SCREEN_DEFAULTS) {
  const S = prepScreen(series);
  const U = new Map(), M = new Map();
  const ctx = {
    S, p, byCoin: new Map(S.map((s) => [s.coin, s])),
    universe(t) {
      if (U.has(t)) return U.get(t);
      const a = [];
      for (const s of S) {
        const i = s.idx.get(t);
        if (i == null || i < Math.max(p.minHistory, p.volDays)) continue;
        a.push({ s, i, vol: s.cum[i] - s.cum[i - p.volDays] });
      }
      a.sort((x, y) => y.vol - x.vol || (x.s.coin < y.s.coin ? -1 : 1));
      const u = a.slice(0, p.universeN);
      U.set(t, u);
      return u;
    },
    /** Aday (olay / grup üyesi olabilecek) = evren − BTC. */
    cands(t) { return ctx.universe(t).filter((x) => x.s.coin !== 'BTC'); },
    /** Evren ortalaması (eşit ağırlık; ileri getirisi olan üyeler) — açılış[t+1] → kapanış[t+N]. */
    uniMean(t, N) {
      const k = `${t}|${N}`;
      if (M.has(k)) return M.get(k);
      const v = ctx.universe(t).map((x) => fwdRet(x.s, t, N)).filter((x) => x != null);
      const m = v.length ? mean(v) : null;
      M.set(k, m);
      return m;
    },
    /** Göreli getiri (kesir): coin − evren ortalaması; ileri veri yoksa null. */
    rel(s, t, N) { const r = fwdRet(s, t, N), m = ctx.uniMean(t, N); return r == null || m == null ? null : r - m; },
  };
  return ctx;
}

/** Olay günü t (mum zamanı) → N günlük ufuk getirisi: açılış[t+1] → kapanış[t+N] (kesir). Mum yoksa null (ufku dolmamış). */
export function fwdRet(s, t, N) {
  const o = s.idx.get(t + DAY), e = s.idx.get(t + N * DAY);
  if (o == null || e == null || !(s.c[o].open > 0)) return null;
  return s.c[e].close / s.c[o].open - 1;
}

/** Günler (mum zamanları) from..to arası, DAY adımlı. */
export const daysBetween = (from, to) => { const a = []; for (let t = from; t <= to; t += DAY) a.push(t); return a; };

// ---------------- K1 / K2 olay tanımları ----------------
/**
 * t günü olayları: evren adaylarında (BTC hariç) günlük kapanıştan kapanışa getiri eşiği (thr > 0: ≥ thr; thr < 0: ≤ thr) ve
 * o günün hacmi ≥ volX × önceki medDays günün medyan günlük hacmi (t günü hariç). → [{ coin, s, i, t, ret1, volRatio }]
 */
export function eventsOn(ctx, t, { thr, volX, medDays }) {
  const out = [];
  for (const { s, i } of ctx.cands(t)) {
    if (i < medDays || !(s.c[i - 1].close > 0)) continue;
    const ret1 = s.c[i].close / s.c[i - 1].close - 1;
    if (!(thr > 0 ? ret1 >= thr : ret1 <= thr)) continue;
    const med = median(s.qv.slice(i - medDays, i));
    if (!(med > 0) || !(s.qv[i] >= volX * med)) continue;
    out.push({ coin: s.coin, s, i, t, ret1, volRatio: s.qv[i] / med });
  }
  return out;
}

/** Coin başına dedupDays günde en çok bir olay (ilk olay tutulur; sonraki dedupDays gün içindekiler atılır). */
export function dedupEvents(events, days = 7) {
  const last = new Map(), out = [];
  for (const e of [...events].sort((a, b) => a.t - b.t || (a.coin < b.coin ? -1 : 1))) {
    const l = last.get(e.coin);
    if (l != null && e.t - l < days * DAY) continue;
    last.set(e.coin, e.t); out.push(e);
  }
  return out;
}

/**
 * Olaylar → N ufkunda göreli getiri (%) ve gün başına plasebo: her olay günü, o günün adaylarından (BTC hariç evren, ileri getirisi
 * olan) olay sayısı kadar rastgele coin (yerine koymadan), draws çekiliş; tohum seedOf(`${key}|N|t`, seed).
 * → { items: [{ t, coin, v }], pdays: [{ t, k, sums: Float64Array(draws) }], dropped }
 */
export function evalEvents(ctx, events, N, { key, draws, seed }) {
  const byDay = new Map();
  let dropped = 0;
  for (const e of events) {
    const r = ctx.rel(e.s, e.t, N);
    if (r == null) { dropped++; continue; }
    (byDay.get(e.t) || byDay.set(e.t, []).get(e.t)).push({ t: e.t, coin: e.coin, v: r * 100, ev: e });
  }
  const items = [], pdays = [];
  for (const [t, evs] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    items.push(...evs);
    pdays.push(placeboDay(ctx, t, N, evs.length, { key, draws, seed }));
  }
  return { items, pdays, dropped };
}

/** Bir günün plasebosu: k coin, draws çekiliş → her çekilişte göreli getiri (%) toplamı. Belirlenimci (gün + anahtar tohumu). */
export function placeboDay(ctx, t, N, k, { key, draws, seed }) {
  const pool = ctx.cands(t).map((x) => ctx.rel(x.s, t, N)).filter((x) => x != null).map((x) => x * 100);
  const sums = new Float64Array(draws);
  const rnd = mulberry32(seedOf(`${key}|${N}|${t}`, seed));
  const kk = Math.min(k, pool.length);
  for (let j = 0; j < draws; j++) { let s = 0; for (const v of sampleK(pool, kk, rnd)) s += v; sums[j] = kk ? (s * k) / kk : 0; }
  return { t, k, sums };
}

/**
 * Hücre: items [{ t, v }] (v %), pdays [{ t, k, sums }] → n, gün, ort. %, %99 bloklu bootstrap (gün bloğu), plasebo dağılımı
 * (çekiliş j: Σ gün sums_j ÷ Σ k = olay ağırlıklı plasebo ortalaması), gerçek değerin plasebo yüzdeliği (çekilişlerin ≤ gerçek payı, %).
 */
export function cellOf(items, pdays, { reps, seed, level = 0.99, minN }) {
  const n = items.length;
  const m = mean(items.map((x) => x.v));
  const days = new Set(items.map((x) => x.t)).size;
  let placebo = null, percentile = null;
  if (pdays.length && n) {
    const D = pdays[0].sums.length, K = pdays.reduce((a, d) => a + d.k, 0), dist = new Float64Array(D);
    for (const d of pdays) for (let j = 0; j < D; j++) dist[j] += d.sums[j];
    for (let j = 0; j < D; j++) dist[j] /= K;
    const s = [...dist].sort((a, b) => a - b);
    placebo = { draws: D, meanPct: rd(mean(s)), p0_5: rd(qOf(s, 0.005)), p1: rd(qOf(s, 0.01)), p99: rd(qOf(s, 0.99)), p99_5: rd(qOf(s, 0.995)) };
    percentile = rd((s.filter((x) => x <= m).length / D) * 100, 2);
  }
  return { n, days, meanPct: rd(m), ci99: n ? blockCi(items.map((x) => ({ day: x.t, v: x.v })), { reps, seed, level }) : null, placebo, percentile, inconclusive: n < minN };
}

/** Yarılara böl (olay günü t'ye göre). */
const splitHalves = (items, pdays) => ({
  A: { items: items.filter((x) => halfOf(x.t) === 'A'), pdays: pdays.filter((x) => halfOf(x.t) === 'A') },
  B: { items: items.filter((x) => halfOf(x.t) === 'B'), pdays: pdays.filter((x) => halfOf(x.t) === 'B') },
});

// ---------------- Geçme ölçütü ----------------
/**
 * Yarı başına koşul (ön kayıt): 1) ortalama hipotez yönünde ve %99 aralık sıfırı içermiyor; 2) plasebo yüzdeliği tek yönde ≤ %1
 * (dir 'neg') ya da iki yönde ≤ %0,5 / ≥ %99,5 (dir 'two'); 3) n ≥ eşik (değilse sonuçsuz). İki yarıda da → geçer; 'two'da iki yarı
 * aynı işaret. → { verdict, checks: { A: { mean, placebo }, B } }
 */
export function verdictOf(dir, A, B) {
  const chk = (c) => {
    if (!c || c.meanPct == null || !c.ci99) return { mean: false, placebo: false };
    const meanOk = dir === 'neg' ? c.meanPct < 0 && c.ci99[1] < 0 : c.ci99[0] > 0 || c.ci99[1] < 0;
    const pl = c.percentile;
    const placeboOk = pl != null && (dir === 'neg' ? pl <= 1 : pl <= 0.5 || pl >= 99.5);
    return { mean: meanOk, placebo: placeboOk };
  };
  const checks = { A: chk(A), B: chk(B) };
  if (!A || !B || A.inconclusive || B.inconclusive) return { verdict: VERDICT.inconclusive, checks };
  const sameSign = dir !== 'two' || Math.sign(A.meanPct) === Math.sign(B.meanPct);
  const ok = checks.A.mean && checks.A.placebo && checks.B.mean && checks.B.placebo && sameSign;
  return { verdict: ok ? VERDICT.pass : VERDICT.fail, checks, ...(dir === 'two' ? { sameSign } : {}) };
}

/** K3 ölçütü: ort. ATR getirisi > 0 ve %99 aralık > 0; fark (sinyal − plasebo) aralığının alt ucu > 0, B ve A-mom'a karşı; n ≥ eşik. */
export function verdictK3(A, B) {
  const chk = (c) => ({ mean: !!(c && c.meanAtr > 0 && c.ci99 && c.ci99[0] > 0), vsB: !!(c?.vsB?.diffCi99 && c.vsB.diffCi99[0] > 0), vsA: !!(c?.vsA?.diffCi99 && c.vsA.diffCi99[0] > 0) });
  const checks = { A: chk(A), B: chk(B) };
  if (!A || !B || A.inconclusive || B.inconclusive) return { verdict: VERDICT.inconclusive, checks };
  const ok = ['A', 'B'].every((h) => checks[h].mean && checks[h].vsB && checks[h].vsA);
  return { verdict: ok ? VERDICT.pass : VERDICT.fail, checks };
}

// ---------------- Olay adayları (K1 / K2) ----------------
const pctl = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: rd(qOf(s, 0.5), 2), p90: rd(qOf(s, 0.9), 2), max: rd(s.at(-1), 2) }; };
/** Sıkışma riski: giriş açılış[t+1] sonrası N gün içinde aleyhe en büyük hareket (%). d = −1 short (tepe / giriş − 1), +1 long (1 − dip / giriş). */
export function adverseOf(s, t, N, d) {
  const o = s.idx.get(t + DAY), e = s.idx.get(t + N * DAY);
  if (o == null || e == null) return null;
  const entry = s.c[o].open;
  let hi = -Infinity, lo = Infinity;
  for (let k = o; k <= e; k++) { if (s.c[k].high > hi) hi = s.c[k].high; if (s.c[k].low < lo) lo = s.c[k].low; }
  return d === -1 ? (hi / entry - 1) * 100 : (1 - lo / entry) * 100;
}

function eventCandidate(ctx, days, def, { key, dir, opt }) {
  const p = ctx.p, o = { key, draws: p.draws, seed: p.seed }, co = { reps: p.reps, seed: p.seed, level: p.level, minN: p.minEvents };
  const all = days.flatMap((t) => eventsOn(ctx, t, def));
  const horizons = {};
  let primaryItems = null, dropped = 0;
  const run = (evs, N, k = key) => { const r = evalEvents(ctx, evs, N, { ...o, key: k }); const h = splitHalves(r.items, r.pdays); return { A: cellOf(h.A.items, h.A.pdays, co), B: cellOf(h.B.items, h.B.pdays, co), dropped: r.dropped, items: r.items }; };
  for (const N of opt.horizons) {
    const r = run(all, N);
    horizons[N] = { A: r.A, B: r.B, droppedHorizon: r.dropped };
    if (N === opt.primary) { primaryItems = r.items; dropped = r.dropped; }
  }
  const prim = horizons[opt.primary];
  const byYear = {};
  for (const x of primaryItems) { const y = new Date(x.t).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + 1; }
  const dd = run(dedupEvents(all, p.dedupDays), opt.primary, `${key}dd`);
  return { all, prim, horizons, dropped, byYear, primaryItems, dedup: { A: dd.A, B: dd.B, droppedHorizon: dd.dropped }, verdict: verdictOf(dir, prim.A, prim.B) };
}

export function runK1(ctx, days) {
  const o = ctx.p.k1;
  const r = eventCandidate(ctx, days, { thr: o.thr, volX: o.volX, medDays: o.medDays }, { key: 'k1', dir: 'neg', opt: o });
  const st = eventCandidate(ctx, days, { thr: o.strictThr, volX: o.volX, medDays: o.medDays }, { key: 'k1s', dir: 'neg', opt: { ...o, horizons: [o.primary] } });
  const sq = (h) => pctl(r.primaryItems.filter((x) => halfOf(x.t) === h).map((x) => adverseOf(x.ev.s, x.t, o.primary, -1)).filter((x) => x != null));
  return {
    def: { event: `kapanıştan kapanışa getiri ≥ +%${o.thr * 100} ve hacim ≥ ${o.volX} × önceki ${o.medDays} günün medyanı (USDT hacim; olay günü hariç)`, hypothesis: `sonraki ${o.primary} gün göreli getiri < 0 (tek yön)`, primary: o.primary, dir: 'neg' },
    eventsTotal: r.all.length, droppedHorizon: r.dropped, byYear: r.byYear,
    A: r.prim.A, B: r.prim.B, ...r.verdict,
    horizons: r.horizons, strict40: { def: `≥ +%${o.strictThr * 100} (bilgi amaçlı)`, eventsTotal: st.all.length, A: st.prim.A, B: st.prim.B },
    dedup7: { def: `coin başına ${ctx.p.dedupDays} günde en çok bir olay (bilgi amaçlı)`, ...r.dedup },
    squeeze: { def: `short varsayımı: giriş açılış[t+1], ${o.primary} gün içinde en yüksek / giriş − 1 (%)`, A: sq('A'), B: sq('B') },
  };
}

export function runK2(ctx, days) {
  const o = ctx.p.k2;
  const r = eventCandidate(ctx, days, { thr: o.thr, volX: o.volX, medDays: o.medDays }, { key: 'k2', dir: 'two', opt: o });
  const sq = (h, d) => pctl(r.primaryItems.filter((x) => halfOf(x.t) === h).map((x) => adverseOf(x.ev.s, x.t, o.primary, d)).filter((x) => x != null));
  return {
    def: { event: `kapanıştan kapanışa getiri ≤ −%${-o.thr * 100} ve hacim ≥ ${o.volX} × önceki ${o.medDays} günün medyanı`, hypothesis: `sonraki ${o.primary} gün göreli getiri ≠ 0 (iki yön; yüzdelik ≤ %0,5 ya da ≥ %99,5, iki yarıda aynı işaret)`, primary: o.primary, dir: 'two' },
    eventsTotal: r.all.length, droppedHorizon: r.dropped, byYear: r.byYear,
    A: r.prim.A, B: r.prim.B, ...r.verdict,
    horizons: r.horizons, dedup7: { def: `coin başına ${ctx.p.dedupDays} günde en çok bir olay (bilgi amaçlı)`, ...r.dedup },
    squeeze: { def: `giriş açılış[t+1], ${o.primary} gün içinde aleyhe en büyük hareket (%): long = 1 − dip / giriş, short = tepe / giriş − 1`, long: { A: sq('A', 1), B: sq('B', 1) }, short: { A: sq('A', -1), B: sq('B', -1) } },
  };
}

// ---------------- Haftalık gruplar (K4, K5, K6) ----------------
/** Pazar günlük mumları (karar = pazar kapanışı; giriş pazartesi açılışı) from..to. */
export function sundays(from, to) { let T = from; while (new Date(T).getUTCDay() !== 0) T += DAY; const a = []; for (; T <= to; T += WEEK) a.push(T); return a; }

/**
 * Bir haftanın grubu → hafta değeri (grup ort. göreli getiri %) ve plasebo (aynı hafta adaylardan grup büyüklüğü kadar rastgele coin;
 * çekiliş başına ortalama). groupOf(T) → s dizisi (adaylar içinden). Grup boşsa null.
 */
export function weekCell(ctx, T, N, members, { key, draws, seed }) {
  const v = members.map((s) => ctx.rel(s, T, N)).filter((x) => x != null).map((x) => x * 100);
  if (!v.length) return null;
  const pd = placeboDay(ctx, T, N, v.length, { key, draws, seed });
  const sums = new Float64Array(pd.sums.length);
  for (let j = 0; j < sums.length; j++) sums[j] = pd.sums[j] / v.length;
  return { item: { t: T, v: mean(v), size: v.length }, pday: { t: T, k: 1, sums } };
}

function weeklyGroups(ctx, weeks, groupFns, opt, key) {
  const p = ctx.p, o = { draws: p.draws, seed: p.seed }, co = { reps: p.reps, seed: p.seed, level: p.level, minN: p.minWeeks };
  const out = {};
  for (const [g, fn] of Object.entries(groupFns)) {
    out[g] = {};
    for (const N of opt.horizons) {
      const items = [], pdays = [];
      let empty = 0;
      for (const T of weeks) { const w = weekCell(ctx, T, N, fn(T), { ...o, key: `${key}|${g}` }); if (!w) { empty++; continue; } items.push(w.item); pdays.push(w.pday); }
      const h = splitHalves(items, pdays);
      const A = cellOf(h.A.items, h.A.pdays, co), B = cellOf(h.B.items, h.B.pdays, co);
      const size = (hh) => { const a = h[hh].items.map((x) => x.size); return a.length ? rd(mean(a), 1) : null; };
      A.avgGroupSize = size('A'); B.avgGroupSize = size('B');
      out[g][N] = { A, B, weeksEmpty: empty };
    }
  }
  return out;
}
/** Gün sayısı cinsinden yaş: OKX'teki ilk günlük mumdan beri (t − ilk mum) / gün. */
export const ageDays = (s, t) => (t - s.first) / DAY;
/** 28 günlük günlük getiri standart sapması (i'ye kadar: kapanış i−days..i; days getiri). Yetersizse null. */
export function vol28(s, i, days = 28) {
  if (i < days) return null;
  const r = []; for (let k = i - days + 1; k <= i; k++) { if (!(s.c[k - 1].close > 0)) return null; r.push(s.c[k].close / s.c[k - 1].close - 1); }
  const m = mean(r);
  return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
}
/** Beşte birlik: değere göre artan, q = ⌊sıra × 5 / n⌋ (0 = en düşük … 4 = en yüksek). xs: [{ s, val }] → Map coin → q. */
export function quintileMap(xs) {
  const a = [...xs].sort((x, y) => x.val - y.val || (x.s.coin < y.s.coin ? -1 : 1)), n = a.length;
  return new Map(a.map((x, k) => [x.s.coin, Math.floor((k * 5) / n)]));
}

export function runK4(ctx, weeks, ctxWide = null) {
  const o = ctx.p.k4;
  const inAge = (lo, hi) => (c) => (T) => c.cands(T).filter((x) => { const a = ageDays(x.s, T); return a >= lo && (hi === Infinity ? true : a <= hi); }).map((x) => x.s);
  const fns = (c) => ({ [`${o.ageMin}-${o.ageMax}`]: inAge(o.ageMin, o.ageMax)(c), ...Object.fromEntries(o.buckets.map(([lo, hi]) => [`${lo}-${hi === Infinity ? 'üstü' : hi}`, (T) => c.cands(T).filter((x) => { const a = ageDays(x.s, T); return a >= lo && a < hi; }).map((x) => x.s)])) });
  const G = weeklyGroups(ctx, weeks, fns(ctx), o, 'k4');
  const g0 = `${o.ageMin}-${o.ageMax}`, prim = G[g0][o.primary];
  const wide = ctxWide ? weeklyGroups(ctxWide, weeks, fns(ctxWide), { ...o, horizons: [o.primary] }, 'k4w') : null;
  return {
    def: { group: `haftalık (pazar kapanışı): OKX'teki ilk günlük mumundan beri ${o.ageMin}–${o.ageMax} gün geçmiş evren coinleri`, compare: 'evren ortalaması (göreli getiri)', hypothesis: `sonraki ${o.primary} gün göreli getiri < 0`, primary: o.primary, dir: 'neg', note: `evren kuralı ≥ ${ctx.p.minHistory} günlük geçmiş ister: ana satırda ${ctx.p.minHistory} günden genç coin evrende yok (etkin grup ${ctx.p.minHistory}–${o.ageMax}); "wide" = evren geçmiş eşiği ${ctxWide?.p.minHistory ?? '—'} gün (bilgi amaçlı)` },
    A: prim.A, B: prim.B, ...verdictOf('neg', prim.A, prim.B),
    horizons: G[g0], buckets: Object.fromEntries(Object.keys(G).filter((g) => g !== g0).map((g) => [g, G[g][o.primary]])),
    ...(wide ? { wide: { minHistory: ctxWide.p.minHistory, group: wide[g0][o.primary], buckets: Object.fromEntries(Object.keys(wide).filter((g) => g !== g0).map((g) => [g, wide[g][o.primary]])) } } : {}),
  };
}

export function runK6(ctx, weeks) {
  const o = ctx.p.k6;
  const qCache = new Map();
  const qOfWeek = (T) => { if (!qCache.has(T)) qCache.set(T, quintileMap(ctx.cands(T).map((x) => ({ s: x.s, val: vol28(x.s, x.i, o.days) })).filter((x) => x.val != null))); return qCache.get(T); };
  const fns = Object.fromEntries([0, 1, 2, 3, 4].map((q) => [`q${q + 1}`, (T) => { const m = qOfWeek(T); return ctx.cands(T).filter((x) => m.get(x.s.coin) === q).map((x) => x.s); }]));
  const G = weeklyGroups(ctx, weeks, fns, o, 'k6');
  const prim = G.q5[o.primary];
  return {
    def: { group: `haftalık: ${o.days} günlük günlük getiri standart sapmasına göre beşte birlikler (q1 en düşük, q5 en yüksek; T'ye kadar veri)`, hypothesis: `q5 sonraki ${o.primary} gün göreli getiri < 0`, primary: o.primary, dir: 'neg' },
    A: prim.A, B: prim.B, ...verdictOf('neg', prim.A, prim.B),
    horizons: G.q5, quintiles: Object.fromEntries(Object.keys(G).map((q) => [q, G[q][o.primary]])),
  };
}

/** Son days günün ortalama fonlama oranı (8 saate normalleştirilmiş, %): (T+1g − days, T+1g] içindeki anlar; kapsam yoksa null. */
export function fundingAvg(rows, T, days = 7) {
  if (!rows || rows.length < 2) return null;
  const end = T + DAY, start = end - days * DAY;
  if (rows[0].time > start + DAY || rows.at(-1).time < end - DAY) return null; // pencere kapsanmıyor
  const iv = fundingIntervalH(rows) || 8;
  const v = rows.filter((x) => x.time > start && x.time <= end).map((x) => to8h(x.rate, iv) * 100);
  return v.length ? mean(v) : null;
}

export function runK5(ctx, weeks, funding) {
  const o = ctx.p.k5;
  const have = funding && [...funding.values()].some((r) => r && r.length);
  if (!have) return { def: { info: 'yalnız bilgi amaçlı (verdict yok)' }, available: false, reason: 'veri yok' };
  const qCache = new Map();
  const qOfWeek = (T) => { if (!qCache.has(T)) qCache.set(T, quintileMap(ctx.cands(T).map((x) => ({ s: x.s, val: fundingAvg(funding.get(x.s.coin), T, o.days) })).filter((x) => x.val != null))); return qCache.get(T); };
  const used = weeks.filter((T) => qOfWeek(T).size >= 5);
  const fns = Object.fromEntries([0, 1, 2, 3, 4].map((q) => [`q${q + 1}`, (T) => { const m = qOfWeek(T); return ctx.cands(T).filter((x) => m.get(x.s.coin) === q).map((x) => x.s); }]));
  const G = weeklyGroups(ctx, used, fns, o, 'k5');
  return {
    def: { group: `haftalık: son ${o.days} günün ortalama fonlama oranına (8 saatlik eşdeğer, %) göre beşte birlikler (q1 en düşük / en negatif, q5 en yüksek)`, info: 'yalnız bilgi amaçlı: OKX geçmişi ~3 ay → iki yarı ölçütü uygulanamaz; verdict yok' },
    available: true, weeksWithData: used.length, coinsWithData: [...funding.values()].filter((r) => r && r.length).length,
    quintiles: Object.fromEntries(Object.keys(G).map((q) => [q, G[q][o.primary]])), horizonsQ5: G.q5, horizonsQ1: G.q1,
  };
}

// ---------------- K3: 1D sinyal motoru planları ----------------
/**
 * Bir coin serisinde 1D planları (engine.simulateSeries ile aynı tarama: pencere = son barsFor('1D') mum, t ≥ W, son mum hariç,
 * buildPlan(row, planOpt), bekleme süresi); yalnız time ≥ fromMs günleri döner (dolum / stop simülasyonu yok).
 * → [{ coin, t, d, score }]
 */
export function k3Signals({ coin, instId, candles }, { fromMs = HALF_A_START, planOpt = { minScore: 50, minRR: 2, maxRiskPct: 5 }, cooldownHours = 6, detectors = null, weights = {} } = {}) {
  const tf = '1D', W = barsFor(tf), out = [], sent = [];
  for (let t = W; t < candles.length - 1; t++) {
    if (candles[t].time < fromMs) continue;
    const row = analyzeRow({ coin, instId, tf, candles: candles.slice(t - W + 1, t + 1), live: null }, { ids: detectors, weights });
    if (row.error || !row.best) continue;
    const plan = buildPlan(row, planOpt);
    if (!plan.ok) continue;
    const now = candles[t].time;
    if (onCooldown(plan, sent, now, cooldownHours)) continue;
    sent.push({ key: plan.key, coin, direction: plan.direction, tf, sentAt: now });
    out.push({ coin, t: now, d: plan.direction === 'long' ? 1 : -1, score: plan.score });
  }
  return out;
}

/** ATR birimli yönlü getiri: d × (kapanış[t+N] − açılış[t+1]) / ATR(14)[t]. */
export function atrRet(s, i, N, d) {
  const t = s.c[i].time, o = s.idx.get(t + DAY), e = s.idx.get(t + N * DAY), a = s.atr[i];
  if (o == null || e == null || !(a > 0)) return null;
  return (d * (s.c[e].close - s.c[o].open)) / a;
}
/** Coin'in i günündeki momDays günlük getirisi (kapanış[i] / kapanış[i − momDays] − 1); yetersizse null. */
export const momAt = (s, i, days = 28) => (i >= days && s.c[i - days].close > 0 ? s.c[i].close / s.c[i - days].close - 1 : null);
/**
 * A-mom plasebo adayları: aynı coin, sinyal gününün ±windowDays günü (sinyal günü hariç); her adayın KENDİ momDays getirisinin işareti
 * sinyal yönüyle aynı (long: > 0, short: < 0) ve ufku dolu. Yön bilgisi sinyalden geçmişe taşınmaz: aday yalnız kendi verisiyle seçilir.
 */
export function aMomCandidates(s, i, d, N, { windowDays = 90, momDays = 28 } = {}) {
  const t = s.c[i].time, out = [];
  // günlük mumlar: zaman farkı ≥ indeks farkı × gün → i ± windowDays indeks aralığı tüm adayları kapsar
  for (let j = Math.max(0, i - windowDays), j1 = Math.min(s.c.length - 1, i + windowDays); j <= j1; j++) {
    if (j === i || Math.abs(s.c[j].time - t) > windowDays * DAY) continue;
    const m = momAt(s, j, momDays);
    if (m == null || !(d === 1 ? m > 0 : m < 0)) continue;
    const v = atrRet(s, j, N, d);
    if (v != null) out.push(v);
  }
  return out;
}

/**
 * K3 bir ufuk: sinyal başına gerçek ATR getirisi, plasebo B (aynı gün, evrenden rastgele başka coin, aynı yön, kendi ATR'si) ve
 * A-mom (yukarıda) — her biri draws çekiliş (yerine koyarak). Fark = sinyal − kendi plasebo ortalaması.
 * → { rows: [{ t, d, v, b, a }], distB: { A, B } (Float64Array toplam), distA, cntB, cntA, dropped }
 */
export function k3Eval(ctx, signals, N, { draws, seed, windowDays, momDays }) {
  const rows = [], dist = { B: { A: new Float64Array(draws), B: new Float64Array(draws) }, Am: { A: new Float64Array(draws), B: new Float64Array(draws) } };
  const cnt = { B: { A: 0, B: 0 }, Am: { A: 0, B: 0 } };
  let dropped = 0;
  for (const sg of signals) {
    const s = ctx.byCoin.get(sg.coin), i = s?.idx.get(sg.t), h = halfOf(sg.t);
    const v = s && i != null && h ? atrRet(s, i, N, sg.d) : null;
    if (v == null) { dropped++; continue; }
    const rnd = mulberry32(seedOf(`k3|${N}|${sg.coin}|${sg.t}|${sg.d}`, seed));
    const poolB = ctx.cands(sg.t).filter((x) => x.s.coin !== sg.coin).map((x) => atrRet(x.s, x.i, N, sg.d)).filter((x) => x != null);
    let b = null, a = null;
    if (poolB.length) { let sm = 0; for (let j = 0; j < draws; j++) { const x = poolB[(rnd() * poolB.length) | 0]; sm += x; dist.B[h][j] += x; } b = sm / draws; cnt.B[h]++; }
    const poolA = aMomCandidates(s, i, sg.d, N, { windowDays, momDays });
    if (poolA.length) { let sm = 0; for (let j = 0; j < draws; j++) { const x = poolA[(rnd() * poolA.length) | 0]; sm += x; dist.Am[h][j] += x; } a = sm / draws; cnt.Am[h]++; }
    rows.push({ t: sg.t, d: sg.d, coin: sg.coin, v, b, a, h });
  }
  return { rows, dist, cnt, dropped };
}

function k3Cell(ev, h, { reps, seed, level, minN }) {
  const R = ev.rows.filter((x) => x.h === h);
  const ci = (it) => (it.length ? blockCi(it, { reps, seed, level }) : null);
  const vs = (k, field) => {
    const it = R.filter((x) => x[field] != null);
    const n = it.length, D = ev.dist[k][h].length;
    if (!n) return { n: 0 };
    const dist = [...ev.dist[k][h]].map((x) => x / ev.cnt[k][h]).sort((a, b) => a - b);
    const act = mean(it.map((x) => x.v));
    return { n, placeboMeanAtr: rd(mean(it.map((x) => x[field]))), diffAtr: rd(mean(it.map((x) => x.v - x[field]))), diffCi99: ci(it.map((x) => ({ day: x.t, v: x.v - x[field] }))), dist: { draws: D, p0_5: rd(qOf(dist, 0.005)), p1: rd(qOf(dist, 0.01)), p99: rd(qOf(dist, 0.99)), p99_5: rd(qOf(dist, 0.995)) }, percentile: rd((dist.filter((x) => x <= act).length / D) * 100, 2) };
  };
  const side = (d) => { const it = R.filter((x) => x.d === d); return { n: it.length, meanAtr: rd(mean(it.map((x) => x.v))), ci99: ci(it.map((x) => ({ day: x.t, v: x.v }))), diffB: rd(mean(it.filter((x) => x.b != null).map((x) => x.v - x.b))), diffA: rd(mean(it.filter((x) => x.a != null).map((x) => x.v - x.a))) }; };
  return { n: R.length, days: new Set(R.map((x) => x.t)).size, meanAtr: rd(mean(R.map((x) => x.v))), ci99: ci(R.map((x) => ({ day: x.t, v: x.v }))), vsB: vs('B', 'b'), vsA: vs('Am', 'a'), long: side(1), short: side(-1), inconclusive: R.length < minN };
}

export function runK3(ctx, signals, { unavailable = null, meta = {} } = {}) {
  const o = ctx.p.k3;
  const def = { signals: `sinyal motorunun 1D planları (puan ≥ 50, minRR 2, maxRisk %5; pencere ${barsFor('1D')} günlük mum), bugünün hacimde ilk ${o.top} coini (BTC hariç)`, measure: 'sinyal yönünde açılış[t+1] → kapanış[t+N], ATR(14)[t] biriminde (tüm seriyle Wilder ATR)', placeboB: 'aynı gün, dönem evreninden rastgele başka coin (BTC hariç), aynı yön, o coinin ATR(14)\'ü', placeboAmom: `aynı coin, ±${o.aWindowDays} gün içinde rastgele gün (sinyal günü hariç); o günün kendi ${o.momDays} günlük getirisinin işareti sinyal yönüyle aynı`, hypothesis: `sinyal yönünde sonraki ${o.primary} gün ATR getirisi > 0 (%99 aralık > 0) ve fark aralığı alt ucu > 0, iki plaseboya karşı`, primary: o.primary };
  if (unavailable || !signals) return { def, available: false, reason: `uygulanamadı: ${unavailable || 'sinyal yok'}`, verdict: VERDICT.inconclusive, ...meta };
  const p = ctx.p, co = { reps: p.reps, seed: p.seed, level: p.level, minN: p.minEvents };
  const horizons = {};
  for (const N of o.horizons) {
    const ev = k3Eval(ctx, signals, N, { draws: p.draws, seed: p.seed, windowDays: o.aWindowDays, momDays: o.momDays });
    horizons[N] = { A: k3Cell(ev, 'A', co), B: k3Cell(ev, 'B', co), droppedHorizon: ev.dropped };
  }
  const prim = horizons[o.primary];
  const byYear = {}; for (const s of signals) { const y = new Date(s.t).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + 1; }
  return { def, available: true, signalsTotal: signals.length, byYear, A: prim.A, B: prim.B, ...verdictK3(prim.A, prim.B), horizons, ...meta };
}

// ---------------- Hepsi ----------------
/**
 * Saf uçtan uca. series: [{ coin, candles }] (1D, olabildiğince eski; havuz = bugünün hacim sırası), k3: { signals } | { unavailable },
 * funding: Map coin → rows. → { meta, k1 … k6 }
 */
export function runScreen({ series, k3 = { unavailable: 'sinyal verilmedi' }, funding = new Map(), now, p: pIn = {}, meta = {} }) {
  const p = { ...SCREEN_DEFAULTS, ...pIn };
  const ctx = makeContext(series, p);
  const dataEnd = Math.max(...ctx.S.map((s) => s.c.at(-1).time));
  const days = daysBetween(HALF_A_START, dataEnd);
  const weeks = sundays(HALF_A_START, dataEnd);
  const uSizes = days.map((t) => ctx.universe(t).length).sort((a, b) => a - b);
  const ctxWide = makeContext(series, { ...p, minHistory: p.k4.ageMin });
  const out = {
    meta: {
      ...meta, generatedAt: now, dataEnd, period: `${iso(HALF_A_START)} → ${iso(dataEnd)}`,
      halves: { A: `${iso(HALF_A_START)} → ${iso(HALF_B_START)} (hariç)`, B: `${iso(HALF_B_START)} → ${iso(dataEnd)}`, rule: 'olay / karar günü t\'ye göre' },
      pool: ctx.S.length, universe: { n: p.universeN, volDays: p.volDays, minHistory: p.minHistory, rule: 'her gün t\'den ÖNCEKİ 30 günün USDT hacmine göre ilk 80 (t günü hariç), t\'den önce ≥ 60 mum; BTC evrende, olay adayı değil', perDay: { days: uSizes.length, min: uSizes[0] ?? 0, median: uSizes.length ? uSizes[uSizes.length >> 1] : 0, max: uSizes.at(-1) ?? 0 } },
      seed: p.seed, draws: p.draws, bootstrap: { reps: p.reps, level: p.level, block: 'olay günü (haftalıklarda hafta)' },
      minEvents: p.minEvents, minWeeks: p.minWeeks,
      relReturn: 'coin getirisi − aynı penceredeki evren ortalaması (eşit ağırlık, BTC dahil, ileri verisi olan üyeler); açılış[t+1] → kapanış[t+N]',
      placebo: 'her olay günü / hafta, o günün evren adaylarından (BTC hariç, ileri verisi olan) olay / grup sayısı kadar rastgele coin (yerine koymadan); tohum seedOf(aday|ufuk|gün)',
      percentile: 'plasebo çekiliş ortalamalarının gerçek ortalamaya eşit ya da küçük olanlarının payı (%)',
      params: p,
    },
  };
  out.k1 = runK1(ctx, days);
  out.k2 = runK2(ctx, days);
  out.k3 = runK3(ctx, k3?.signals || null, { unavailable: k3?.unavailable || null, meta: k3?.meta ? { source: k3.meta } : {} });
  out.k4 = runK4(ctx, weeks, ctxWide);
  out.k5 = runK5(ctx, weeks, funding);
  out.k6 = runK6(ctx, weeks);
  return out;
}
const makeContext = makeCtx;
