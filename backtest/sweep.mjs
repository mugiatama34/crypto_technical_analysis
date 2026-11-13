#!/usr/bin/env node
// Parametre taraması (ucuz aşama): mevcut planları (plans.json.gz) önbellekteki mumlarla farklı çıkış/giriş/filtre
// kurallarıyla yeniden simüle eder; eğitim diliminde (ilk 2/3) sıralar, doğrulama diliminde (son 1/3) raporlar.
//   node backtest/sweep.mjs [--in docs/backtest] [--out docs/backtest] [--cache backtest/cache] [--fixture]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { simulateTrade, BT_DEFAULTS } from './engine.js';
import { stats, statsCi, meetsStrict, CI_DEFAULTS, MIN_N, by, approachBucket, sessionOf, weekpartOf, entryTimeOf, entryDayOf } from './report.js';
import { adx as adxOf, ema as emaOf } from '../src/data/indicators.js';
import { TIMEFRAMES } from '../src/data/okx.js';
import { horizonSeries, htfTrendAt, htfOk, UP_TF, dailyTrendAt } from '../src/scan/regime.js';
import { mergeRule, onCooldown } from '../bot/plan.js';
import { getHistoryCached } from './data.js';
import { loadPlans, cooldownSkippedOf } from './plans.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), OUT = String(arg('out', 'docs/backtest')), CACHE = String(arg('cache', 'backtest/cache')), FIXTURE = arg('fixture', false) === true;
// --variants <json>: ek varyant listesi (araştırmacı); --only: yalnız temel + bu liste (SINGLE/birleşim yok); --outfile: çıktı adı
const VARIANTS_FILE = arg('variants', null), ONLY = arg('only', false) === true, OUTFILE = String(arg('outfile', 'sweep.json'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Seri verisi: mumlar + indeks haritası + ADX/EMA200. */
export async function loadSeries(coin, tf, instId) {
  let candles;
  if (FIXTURE) { const { fixtureProvider } = await import('../src/data/fixture.js'); candles = (await fixtureProvider.candles(instId, tf, 1500)).candles; }
  else {
    const file = path.join(CACHE, `${instId}_${tf}.json.gz`);
    if (!fs.existsSync(file)) return null;
    candles = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()).candles;
  }
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const idx = new Map(candles.map((c, i) => [c.time, i]));
  return { candles, idx, adx: adxOf(highs, lows, closes, 14), ema200: emaOf(closes, 200) };
}

/** Plan için stop/tp yeniden hesapla. */
export function rebuild(plan, v) {
  const d = plan.d, atr = plan.atr, [lo, hi] = plan.zone;
  const entry = plan.entry;
  let stop = v.stopPadAtr == null ? plan.stop : (d === 1 ? lo - v.stopPadAtr * atr : hi + v.stopPadAtr * atr);
  const minRisk = (v.minRiskAtr ?? 0.6) * atr;
  if (d * (entry - stop) < minRisk) stop = entry - d * minRisk;
  const risk = d * (entry - stop);
  // tp1Pct: fiyat yüzdesiyle erken hedef (ör. 25x'te marjin %30 ≈ fiyat %1,2); keepTp2: TP2 plandaki gibi
  const tp1 = v.tp1Pct != null ? entry * (1 + d * v.tp1Pct / 100) : entry + d * (v.tp1R ?? 1.5) * risk;
  let tp2 = v.keepTp2 ? plan.tp2 : entry + d * (v.tp2R ?? 2.5) * risk;
  if (d * (tp2 - tp1) < 0) tp2 = tp1;
  // midTp: plandaki özgün TP1 ara hedef olur (erken hedefin ötesindeyse; değilse yok sayılır)
  const tpMid = v.midTp && d * (plan.tp1 - tp1) > 0 && d * (tp2 - plan.tp1) > 0 ? plan.tp1 : null;
  return { ...plan, stop, tp1, tp2, ...(v.tp1Pct != null ? { missTp: plan.tp1 } : {}), ...(tpMid ? { tpMid } : {}) };
}

/** Sıralı mum dizisinde time'a kadar (dahil) son kapanış; yoksa null. */
export function closeAt(cs, time) {
  let lo = 0, hi = cs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time <= time) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 ? cs[k].close : null;
}

/**
 * Hedge'li R (lab attachBtc ile aynı mantık, kısmi çıkışlı): pozisyonun yanında eşit nominal ters BTC. Erken kısım (portion)
 * TP1'e kadar (tp1Bars), kalan çıkışa kadar hedge'lenir. t: { time, tf, waitBars, bars, tp1Bars, d, entryFill, stop, R }.
 * → { btcPct, hedgedR, hedgedROpen } (BTC verisi yoksa null'lar).
 * hedgedR (eski, aynen korunur): BTC bacağı dolum mumunun KAPANIŞINDAN başlar; işlem ise mum içinde (limit fiyatında) açılır →
 * dolum mumundaki BTC hareketi hedge'e girmez. hedgedROpen (13.11, yeni alan): BTC bacağı dolum mumunun AÇILIŞINDAN (= bir
 * önceki mumun kapanışı; vadeli seri kesintisiz) başlar. Hangisinin esas alınacağı kullanıcı kararı; çıkış ucu ikisinde aynı.
 */
export function hedgeOf(t, btc, feePct, portion) {
  const ms = TIMEFRAMES[t.tf]?.ms;
  if (!btc || !ms || !(t.entryFill > 0) || t.R == null) return { btcPct: null, hedgedR: null };
  const t0 = t.time + (t.waitBars || 1) * ms;
  const stopPct = Math.abs(t.entryFill - t.stop) / t.entryFill;
  // a: BTC başlangıç fiyatı → hedge'li R (aynı çıkış uçları); başlangıç yoksa null
  const leg = (a) => {
    const pct = (bars) => { const b = closeAt(btc, t0 + Math.max(0, bars) * ms); return a && b ? (b / a - 1) * 100 : null; };
    const full = pct(t.bars || 0);
    if (full == null || !(stopPct > 0)) return null;
    const early = t.tp1Bars != null ? pct(t.tp1Bars - 1) : null;
    const p = early != null ? portion : 0;
    const hedgePct = p * (early ?? 0) + (1 - p) * full;
    return { full, R: +(t.R - (t.d * (hedgePct / 100) + 2 * (feePct / 100)) / stopPct).toFixed(3) };
  };
  const old = leg(closeAt(btc, t0)), open = leg(closeAt(btc, t0 - ms));
  if (!old) return { btcPct: null, hedgedR: null, hedgedROpen: open ? open.R : null };
  return { btcPct: +old.full.toFixed(2), hedgedR: old.R, hedgedROpen: open ? open.R : null };
}

/**
 * Yön yığılması sınırı (portföy düzeyi, coin'ler arası): karar anında (plan mumu kapanışı) aynı yönde açık — bekleyen ya da
 * dolmuş, kapanmamış — işlem sayısı maxOpen'a ulaştıysa yeni sinyal alınmaz; maxNew: aynı karar anında aynı yönde en fazla
 * bu kadar yeni sinyal. Aynı anda gelenlerde puanı yüksek önce. Açık aralık: dolan → dolum + süre; dolmayan → 24 saat.
 * trades: { time, tf, d, score, waitBars, bars, entryFill }. → filtrelenmiş dizi (zaman sırasıyla).
 */
export function capTrades(trades, { maxOpen = null, maxNew = null } = {}, expireHours = 24) {
  if (!maxOpen && !maxNew) return trades;
  const ms = (t) => TIMEFRAMES[t.tf].ms;
  const at = (t) => t.time + ms(t);
  const endOf = (t) => (t.entryFill ? t.time + ((t.waitBars || 1) + (t.bars || 0) + 1) * ms(t) : at(t) + expireHours * 3600e3);
  const sorted = [...trades].sort((a, b) => at(a) - at(b) || (b.score ?? 0) - (a.score ?? 0));
  const open = { 1: [], [-1]: [] }, out = [];
  let lastAt = null, newCount = { 1: 0, [-1]: 0 };
  for (const t of sorted) {
    const now = at(t);
    if (now !== lastAt) { lastAt = now; newCount = { 1: 0, [-1]: 0 }; }
    const o = (open[t.d] = open[t.d].filter((e) => e > now));
    if (maxOpen && o.length >= maxOpen) continue;
    if (maxNew && newCount[t.d] >= maxNew) continue;
    o.push(endOf(t)); newCount[t.d]++; out.push(t);
  }
  return out;
}

/** Yığılma tanısı: her sinyalin karar anında aynı yönde açık sayısı (p50/p90/max) ve en kötü 7 günlük R toplamı (dolanlar). */
export function stackOf(trades, expireHours = 24) {
  const ms = (t) => TIMEFRAMES[t.tf].ms, at = (t) => t.time + ms(t);
  const endOf = (t) => (t.entryFill ? t.time + ((t.waitBars || 1) + (t.bars || 0) + 1) * ms(t) : at(t) + expireHours * 3600e3);
  const sorted = [...trades].sort((a, b) => at(a) - at(b));
  const open = { 1: [], [-1]: [] }, counts = [];
  for (const t of sorted) { const now = at(t); open[t.d] = open[t.d].filter((e) => e > now); counts.push(open[t.d].length); open[t.d].push(endOf(t)); }
  counts.sort((a, b) => a - b);
  const q = (p) => (counts.length ? counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] : null);
  const filled = sorted.filter((t) => t.entryFill && t.R != null && !['expired', 'missed', 'knife'].includes(t.outcome));
  let worst7 = 0;
  for (let i = 0, j = 0, sum = 0; j < filled.length; j++) {
    sum += filled[j].R;
    while (filled[j].time - filled[i].time > 7 * 86400e3) sum -= filled[i++].R;
    if (sum < worst7) worst7 = sum;
  }
  return { p50: q(0.5), p90: q(0.9), max: counts.length ? counts[counts.length - 1] : null, worst7dR: +worst7.toFixed(1) };
}

const corr = (pts) => {
  const n = pts.length; if (n < 10) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(2) : null;
};

/** Filtreler: true = plan dahil. */
export function passes(t, v, series, mtfIndex, htf) {
  if (v.tfs && !v.tfs.includes(t.tf)) return false;
  if (v.minScore && t.plan.score < v.minScore) return false;
  if (v.onlyLimit && t.plan.inZone) return false;
  if (v.excludeGroups && t.plan.groups.some((g) => v.excludeGroups.includes(g))) return false;
  if (v.excludeDetectors && t.plan.signals.some((s) => v.excludeDetectors.includes(s.detector))) return false;
  if (v.requireAnyGroup && !t.plan.groups.some((g) => v.requireAnyGroup.includes(g))) return false;
  const i = series.idx.get(t.time);
  if (i == null) return false;
  // Seans/hafta sonu: plan mumunun kapanışı (karar anı), UTC
  const decided = t.time + TIMEFRAMES[t.tf].ms, hr = new Date(decided).getUTCHours();
  if (v.skipWeekend && weekpartOf(decided) === 'hafta sonu') return false;
  if (v.hoursUtc && !(hr >= v.hoursUtc[0] && hr < v.hoursUtc[1])) return false;
  if (v.excludeHoursUtc && hr >= v.excludeHoursUtc[0] && hr < v.excludeHoursUtc[1]) return false;
  if (v.trend === 'adx' || v.trend === 'both') {
    const a = series.adx.adx[i], p = series.adx.pdi[i], m = series.adx.mdi[i];
    if (a == null || a < (v.adxMin ?? 25)) return false;
    if (t.plan.d === 1 ? p <= m : m <= p) return false;
  }
  if (v.trend === 'ema' || v.trend === 'both') {
    const e = series.ema200[i];
    if (e == null || (t.plan.d === 1 ? t.plan.price < e : t.plan.price > e)) return false;
  }
  if (v.htfTrend) { // coin'in kendi üst TF eğilimi (15m→1H, 1H→4H, 4H→1D), karar anında kapanmış mumlarla
    const h = htf?.get(`${t.coin}|${UP_TF[t.tf]}`);
    // Seri yoksa eski varyantlarda filtre uygulanmaz (geçer); htfStrict (canlıya eşit) elenir — canlı: 'üst TF verisi yok' (bot/run.mjs:328)
    if (!h && v.htfStrict) return false;
    if (h && !htfOk(v.htfTrend, htfTrendAt(h.hs, h.ms, t.time + TIMEFRAMES[t.tf].ms), t.plan.d)) return false;
  }
  if (v.mtf) {
    // Aynı coin + yön, bir üst TF'de ±1 üst-TF barı içinde plan var mı
    const up = { '15m': '1H', '1H': '4H' }[t.tf];
    if (!up) return false;
    const key = `${t.coin}|${up}|${t.plan.direction}`;
    const times = mtfIndex.get(key) || [];
    const ms = TIMEFRAMES[up].ms;
    if (!times.some((x) => Math.abs(x - t.time) <= ms)) return false;
  }
  return true;
}

// ---- Canlı kural zinciri (13.11, "canlıya eşit" birleşimleri). bot/run.mjs içe aktarılamaz (yüklenince main() koşar) → kural
// sabitleri kopya; birleştirme ve bekleme süresi bot/plan.js'ten (mergeRule, onCooldown: tek kaynak).
// Canlı karşılığı: bot/run.mjs:59-60 (MIN_SCORE 70, REQUIRE_MTF 1), :68 (COOLDOWN_H 6), :129-137 (TF_RULES_DEFAULT, SHORT_RULE_DEFAULT,
// ruleFor) + Variables TF_RULES={"15m":{"off":true},"1H":{"off":true}} (üst düzeyde birleşir: 15m/1H tamamen ezilir, 4H varsayılan kalır).
export const LIVE_BASE = { minScore: 70, requireMtf: true, cooldownHours: 6 };
export const LIVE_TF_RULES = { '15m': { off: true }, '1H': { off: true }, '4H': { minScore: 65, requireMtf: false } };
export const LIVE_SHORT_RULE = { scoreAdd: 10, requireMtf: true, trendAdxMin: 30, trendEma: true, btcRegime: 'with', cooldownHours: 12 };
/** Canlı kural (4H long: puan ≥ 65, MTF serbest, 6 s; 4H short: puan ≥ 75, MTF, ADX ≥ 30 yön uyumlu, EMA200 tarafı, BTC günlük rejimi, 12 s). */
export const liveRuleOf = (tf, direction) => mergeRule(tf, direction, LIVE_TF_RULES, LIVE_SHORT_RULE, LIVE_BASE);

/**
 * Plan canlı TF/yön kuralından geçer mi (buildPlan'ın canlıda ek uyguladığı kısım; geometri/R:R/risk planda zaten aynı).
 * t: { tf, time, plan, mtfBt? }; ctx.btcDaily: BTC 1D mumları (yoksa rejim bilinmiyor).
 * → { ok, reason?, unknown?: 'mtf'|'trend'|'regime', cooldownHours }. Veri yoksa (eski plan dosyası) ok=false + unknown: sessizce
 * geçirilmez; çağıran sayar ve varyant adı "veri yoksa elenir" der.
 */
export function liveCheck(t, ctx = {}) {
  const p = t.plan, d = p.d, rule = liveRuleOf(t.tf, p.direction);
  const out = (ok, reason, unknown) => ({ ok, ...(reason ? { reason } : {}), ...(unknown ? { unknown } : {}), cooldownHours: rule.cooldownHours });
  if (rule.off) return out(false, 'TF kapalı');
  // Puan ve MTF (canlı karşılığı: bot/plan.js:54-57): puan = max(küme, MTF puanı). Plan dosyasında plan.score = küme puanı
  // (tam koşu satırında MTF yok); mtfBt karar anında diğer TF'lerden (backtest/plans.js mtfAt).
  const m = t.mtfBt;
  const mtfOk = m ? !!(m.align && m.align.direction === p.direction && m.align.tfs.length > 1) : null;
  const score = Math.max(p.score, mtfOk ? m.align.score : 0);
  if (score < rule.minScore) return mtfOk == null ? out(false, 'puan (MTF bilinmiyor)', 'mtf') : out(false, 'puan');
  if (rule.requireMtf) { if (mtfOk == null) return out(false, 'MTF bilinmiyor', 'mtf'); if (!mtfOk) return out(false, 'MTF uyumu yok'); }
  // Trend (canlı karşılığı: bot/plan.js:60-67; plan.trend aynı buildPlan'ın yazdığı ADX / DI uyumu / EMA200 tarafı)
  const tr = p.trend;
  if (rule.trendAdxMin) {
    if (!tr) return out(false, 'trend bilinmiyor', 'trend');
    if (tr.adx == null || tr.adx < rule.trendAdxMin) return out(false, 'ADX');
    if (!tr.aligned) return out(false, 'DI yönü uyumsuz');
  }
  if (rule.trendEma) { if (!tr) return out(false, 'trend bilinmiyor', 'trend'); if (!tr.emaSide) return out(false, 'EMA200'); }
  // BTC rejimi (canlı karşılığı: bot/plan.js:75-78 + src/scan/regime.js regimeFor: 4H → günlük kapanış vs EMA50, kapanmış günler)
  if (rule.btcRegime === 'with') {
    if (!ctx.btcDaily?.length) return out(false, 'BTC günlük serisi yok', 'regime');
    const r = dailyTrendAt(ctx.btcDaily, t.time + TIMEFRAMES[t.tf].ms);
    if (!r) return out(false, 'BTC rejimi bilinmiyor'); // canlı da eler
    if ((d === 1) !== r.up) return out(false, 'BTC rejimi ters');
  }
  return out(true);
}

/**
 * Canlı bekleme süresi (canlı karşılığı: bot/run.mjs:333 onCooldown(plan, state.sent, now, rule.cooldownHours)): yalnız GÖNDERİLEN
 * planlar süreyi tüketir; aynı anahtar ya da aynı coin + yön + TF. items: [{ t, hours }] (tüm canlı filtrelerden geçmiş) →
 * kalanlar (karar zamanı sırasıyla). Karar anı = plan mumu (motorla aynı ölçek).
 */
export function liveCooldown(items) {
  const sorted = [...items].sort((a, b) => a.t.time - b.t.time);
  const sent = [], kept = [];
  for (const x of sorted) {
    const p = x.t.plan, now = x.t.time;
    if (onCooldown(p, sent, now, x.hours)) continue;
    sent.push({ key: p.key, coin: p.coin ?? x.t.coin, direction: p.direction, tf: p.tf ?? x.t.tf, sentAt: now });
    kept.push(x);
  }
  return kept;
}

const BASE = { name: 'temel (mevcut kurallar)' };
const SINGLE = [
  { name: 'stop +0.6 ATR', stopPadAtr: 0.6 }, { name: 'stop +1.0 ATR', stopPadAtr: 1.0 }, { name: 'min risk 1.0 ATR', minRiskAtr: 1.0 },
  { name: 'TP1 2R yarı, başabaş yok', tpScheme: 'half_nobe', tp1R: 2, tp2R: 3 }, { name: 'tek hedef 2R', tpScheme: 'single', tp2R: 2 }, { name: 'tek hedef 3R', tpScheme: 'single', tp2R: 3 },
  { name: 'TP1 1R yarı + 1 ATR izleyen', tpScheme: 'trail', tp1R: 1, trailAtr: 1 }, { name: 'TP1 1.5R yarı + 1.5 ATR izleyen', tpScheme: 'trail', tp1R: 1.5, trailAtr: 1.5 },
  { name: 'yalnız limit giriş', onlyLimit: true },
  { name: 'trend: ADX≥25 yön uyumlu', trend: 'adx' }, { name: 'trend: EMA200 tarafı', trend: 'ema' }, { name: 'trend: ADX + EMA200', trend: 'both' }, { name: 'trend: ADX≥35', trend: 'adx', adxMin: 35 },
  { name: 'puan ≥ 60', minScore: 60 }, { name: 'puan ≥ 70', minScore: 70 },
  { name: 'yalnız 1H+4H', tfs: ['1H', '4H'] }, { name: 'yalnız 4H', tfs: ['4H'] },
  { name: 'üçgen/yapı hariç', excludeDetectors: ['triangles', 'structure'] }, { name: 'harmonik veya uyumsuzluk zorunlu', requireAnyGroup: ['harmonic', 'divergence'] },
  { name: 'MTF: üst TF aynı yön', mtf: true },
  // Düşen bıçak: bölgeye hızlı gelen limit dolumlar (son 3 mumda > 2 ATR ya da dolum mumu > 1,5 ATR)
  { name: 'düşen bıçak koruması (teyit mumu)', knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 } },
  { name: 'düşen bıçak: hızlı dolumları atla', knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, skip: true } },
  { name: 'düşen bıçak koruması, eşik 1,5 ATR', knifeGuard: { maxApproachAtr: 1.5, maxFillBarAtr: 1.2, confirmBars: 3 } },
  // Seans: plan saati (UTC; TR = UTC+3)
  { name: 'hafta sonu hariç', skipWeekend: true },
  { name: 'New York seansı hariç (13–20 UTC)', excludeHoursUtc: [13, 20] },
  { name: 'yalnız Asya + Avrupa (00–13 UTC)', hoursUtc: [0, 13] },
  // Zaman stopu: dolumdan N mum içinde TP1 yoksa kapanıştan çık (15m: 15 dk, 1H: 1 saat, 4H: 4 saat / mum)
  { name: 'zaman stopu 4 mum', timeStop: { bars: 4 } },
  { name: 'zaman stopu 8 mum', timeStop: { bars: 8 } },
  { name: 'zaman stopu 16 mum', timeStop: { bars: 16 } },
  { name: 'ilerleme stopu: 8 mumda MFE < 0,5R', timeStop: { bars: 8, minMfeR: 0.5 } },
  // Erken kâr al: pozisyonun %80'i erken hedefte, kalan %20 başabaş stopla plan TP2'sine (kullanıcının elle yönetimi)
  { name: 'elle yönetim: +%1,2 fiyatta %80 kapat, kalan başabaş → TP2', tp1Pct: 1.2, tp1Portion: 0.8, keepTp2: true },
  { name: 'erken %80: 0,5R', tp1R: 0.5, tp1Portion: 0.8, keepTp2: true },
  { name: 'erken %80: 0,75R', tp1R: 0.75, tp1Portion: 0.8, keepTp2: true },
  { name: 'erken %80: 1R', tp1R: 1, tp1Portion: 0.8, keepTp2: true },
  // Coin'in kendi üst TF eğilimi (EMA50 tarafı + eğimi + ADX/DI; 15m→1H, 1H→4H, 4H→1D), karar anında
  { name: 'üst TF eğilimi aynı yön', htfTrend: 'with' },
  { name: 'üst TF eğilimi ters değil', htfTrend: 'notAgainst' },
];
/** Temel kırılımı: üst TF eğilimi işlem yönüne göre. */
const htfBucket = (t) => (t.htf == null ? 'üst TF: veri yok' : t.htf === 'flat' ? 'üst TF: yatay' : (t.htf === 'up') === (t.d === 1) ? 'üst TF: aynı yön' : 'üst TF: ters');
/** TP1'e ulaşma süresi kovası (mum; TF × kova). */
/** Dolum gecikmesi (sinyal kararından dolum mumuna, saat; üst sınır): yalnız dolan işlemler. Bekleme süresi çalışması (11.11). */
export const waitBucket = (t) => {
  if (t.outcome === 'expired' || t.outcome === 'missed' || t.outcome === 'knife' || t.waitBars == null) return null;
  const h = t.waitBars * (TIMEFRAMES[t.tf].ms / 3600e3);
  return h <= 4 ? 'a ≤4 saat' : h <= 12 ? 'b 4–12 saat' : h <= 24 ? 'c 12–24 saat' : h <= 48 ? 'd 24–48 saat' : 'e 48–72 saat';
};
const tp1Bucket = (t) => (t.outcome === 'expired' || t.outcome === 'missed' || t.outcome === 'knife' ? null : `${t.tf} · ${t.tp1Bars == null ? 'e TP1 yok' : t.tp1Bars <= 4 ? 'a ≤4 mum' : t.tp1Bars <= 8 ? 'b 5–8 mum' : t.tp1Bars <= 16 ? 'c 9–16 mum' : 'd >16 mum'}`);

/** Varyant listesini tek varyanta birleştirir (ad ' + ' ile; değerlendirme sonucu alanları taşınmaz). */
export const merge = (list) => { const out = { name: list.map((v) => v.name).join(' + ') }; for (const v of list) for (const [k, val] of Object.entries(v)) if (!['name', 'train', 'valid', 'all', 'byApproach', 'bySession', 'byWeekpart', 'byTp1Time', 'byTf', 'byHtfTrend', 'stack', 'hedged', 'hedgedByTf', 'btcCorr', 'requestId', 'research', 'combo', 'targeted', 'byDir', 'hedgedByDir', 'liveInfo', 'realistic', 'strict', 'meetsStrict', 'hedgedOpen'].includes(k)) out[k] = val; return out; };
// Hedefli birleşimlerin yapı taşları (SINGLE'dan, adla). live4h = canlı 4H düzeninin ölçülen yaklaşığı (adları denetçi expectedOf arar).
const parts = () => {
  const V = (name) => SINGLE.find((v) => v.name === name);
  const guard = V('düşen bıçak koruması (teyit mumu)'), wk = V('hafta sonu hariç'), lim = V('yalnız limit giriş'), h14 = V('yalnız 1H+4H'), adx = V('trend: ADX≥35'), t8 = V('zaman stopu 8 mum'), t16 = V('zaman stopu 16 mum'), man = V('elle yönetim: +%1,2 fiyatta %80 kapat, kalan başabaş → TP2'), hw = V('üst TF eğilimi aynı yön'), hn = V('üst TF eğilimi ters değil');
  const only4h = { name: 'yalnız 4H', tfs: ['4H'] };
  return { guard, wk, lim, h14, adx, t8, t16, man, hw, hn, only4h, live4h: [guard, wk, lim, only4h, man, hw] };
};
/** Hedefli birleşimler: kayıp azaltan filtrelerin birlikte etkisi (düşen bıçak, hafta sonu, limit, TF, ADX) */
export function targetedLists() {
  const { guard, wk, lim, h14, adx, t8, t16, man, hw, hn } = parts();
  return [[guard, wk], [guard, wk, lim], [guard, wk, h14], [guard, wk, lim, h14], [guard, wk, lim, h14, adx], [guard, wk, lim, h14, t8], [guard, wk, lim, h14, t16], [guard, wk, lim, h14, man], [guard, wk, lim, h14, man, hw], [guard, wk, lim, h14, man, hn]];
}
/** Yön yığılması sınırı: canlı 4H düzeni (ve eski 1H+4H düzeni) üstüne aynı yönde açık/yeni sinyal tavanı (ve gerçekçi sıra, bıçak kararı, erken hedef, iz, 3 kademe, bekleme çalışmaları). */
export function capLists() {
  const { guard, wk, lim, h14, man, hw, only4h, live4h } = parts();
  return [
    live4h, [...live4h, { name: 'aynı yönde ≤ 3 açık', maxOpenSameDir: 3 }], [...live4h, { name: 'aynı yönde ≤ 5 açık', maxOpenSameDir: 5 }],
    [...live4h, { name: 'aynı yönde ≤ 10 açık', maxOpenSameDir: 10 }], [...live4h, { name: 'mum başına aynı yönde ≤ 1 yeni', maxNewSameDir: 1 }],
    [...live4h, { name: 'mum başına aynı yönde ≤ 2 yeni', maxNewSameDir: 2 }],
    // Dolum mumunda hedef: iyimser (varsayılan) / kötümser / 1H sırasıyla (aynı 4H mumda giriş + erken hedef)
    [...live4h, { name: 'dolum mumunda hedef sayılmaz (kötümser)', fillBarTp: 'skip' }], [...live4h, { name: 'dolum mumunda sıra 1H ile', fillBarTp: 'lower' }],
    // Bıçak kararı (13.11): varsayılan dokunma anına kadarki yarım mum (canlı gibi); karşılaştırma için eski tam mum kararı
    [...live4h, { name: 'eski bıçak kararı (tam mum, iyimser)', knifeBar: 'full' }],
    // Bıçak kararı iki yandan (13.11, K1): 'touch' (varsayılan) kötümser sınır; dokunan 1H mumun sonuna kadar iyimser sınır (canlı 15m arada)
    [...live4h, { name: 'bıçak kararı: dokunan 1H mumun sonuna kadar · sıra 1H', knifeBar: 'lowerBar', fillBarTp: 'lower' }],
    // Korumanın net katkısı: aynı filtreler, koruma yok (limit dokununca dolar), aynı gerçekçi sıra
    [wk, lim, only4h, man, hw, { name: 'bıçak koruması yok · sıra 1H', fillBarTp: 'lower' }],
    // Erken hedef mesafesi, gerçek sırayla (dolum mumunda 1H): %1,2 yerine R cinsinden; erken kısmı yoksa standart yarı/başabaş
    ...[['erken %80: 0,5R', { tp1R: 0.5, tp1Portion: 0.8, keepTp2: true }], ['erken %80: 0,75R', { tp1R: 0.75, tp1Portion: 0.8, keepTp2: true }],
      ['erken %80: 1R', { tp1R: 1, tp1Portion: 0.8, keepTp2: true }], ['erken %80: 1,5R', { tp1R: 1.5, tp1Portion: 0.8, keepTp2: true }],
      ['erken %50: 1R', { tp1R: 1, tp1Portion: 0.5, keepTp2: true }], ['standart: TP1 yarı (plan), başabaş', {}]]
      .map(([name, x]) => [guard, wk, lim, only4h, hw, { name: `${name} · sıra 1H`, fillBarTp: 'lower', ...x }]),
    // Erken hedef sonrası kalan %20 için iz süren stop (13.11, kullanıcı sorusu): başa baş → en iyi kapanışın k ATR gerisi,
    // aktivasyon (MFE ≥ a R) sonrası; TP2 kaldırılır (kalan koşar) ya da tutulur. Gerçek sıra (1H).
    ...[['iz 1 ATR', { trailAtr: 1 }], ['iz 2 ATR', { trailAtr: 2 }], ['iz 3 ATR', { trailAtr: 3 }],
      ['iz 2 ATR, 2R sonrası', { trailAtr: 2, trailActR: 2 }], ['iz 2 ATR, 3R sonrası', { trailAtr: 2, trailActR: 3 }],
      ['iz 3 ATR, 3R sonrası', { trailAtr: 3, trailActR: 3 }], ['iz 2 ATR + TP2', { trailAtr: 2, trailKeepTp2: true }],
      ['iz 2 ATR, 2R sonrası + TP2', { trailAtr: 2, trailActR: 2, trailKeepTp2: true }]]
      .map(([name, x]) => [...live4h, { name: `kalan: ${name} · sıra 1H`, fillBarTp: 'lower', tpScheme: 'be_trail', ...x }]),
    // Erken hedef ızgarası (13.11, kullanıcı sorusu): fiyat % × kapatılan pay, kalan başa baş → TP2; gerçek sıra (1H)
    ...[1.0, 1.2, 1.5, 1.8, 2.0].flatMap((pct) => [0.5, 0.7, 0.8].map((por) => [...live4h, { name: `ızgara erken %${pct} · %${por * 100} kapat · sıra 1H`, fillBarTp: 'lower', tp1Pct: pct, tp1Portion: por, keepTp2: true }])),
    // Üç kademe (13.11, kullanıcı sorusu): erken hedefte %50 + stop girişe, plandaki TP1'de %25, kalan %25 TP2 / başa baş
    ...[1.2, 1.5].map((pct) => [...live4h, { name: `3 kademe: erken %${pct} %50 · TP1 %25 · TP2 %25 · sıra 1H`, fillBarTp: 'lower', tp1Pct: pct, tp1Portion: 0.5, keepTp2: true, midTp: true, midPortion: 0.25 }]),
    // Üç kademe + TP1 sonrası stop erken hedefe (13.11, kullanıcı sorusu)
    ...[1.2, 1.5].map((pct) => [...live4h, { name: `3 kademe + TP1 sonrası stop erken hedefe: erken %${pct} · sıra 1H`, fillBarTp: 'lower', tp1Pct: pct, tp1Portion: 0.5, keepTp2: true, midTp: true, midPortion: 0.25, midStopToTp1: true }]),
    // Bekleme süresi çalışması (11.11): canlı 4H düzeni, gerçek sıra (1H); limit 24 / 48 / 72 saat açık kalırsa dolum gecikmesine göre R
    ...[24, 48, 72].map((hrs) => [...live4h, { name: `bekleme ${hrs} saat · sıra 1H`, fillBarTp: 'lower', expireHours: hrs }]),
    [guard, wk, lim, h14, { name: 'aynı yönde ≤ 5 açık', maxOpenSameDir: 5 }], [guard, wk, lim, h14, { name: 'aynı yönde ≤ 10 açık', maxOpenSameDir: 10 }],
  ];
}
/** Canlıya eşit (13.11) birleşimlerinin adları. Denetçinin aradığı live4h sonekleriyle BİTMEZ (expectedOf karışmasın). */
export const LIVE_NAME_A = 'canlıya eşit: long puan ≥ 65 · short kuralı · cooldown 6/12s · 3 kademe + stop erken hedefe %1.2 · sıra 1H · veri yoksa elenir';
export const LIVE_NAME_B = 'canlıya eşit: long puan ≥ 65 · short kuralı · cooldown 6/12s · erken %1.2 %80 (eski) · sıra 1H · veri yoksa elenir';
/**
 * Canlıya eşit birleşimler: live4h filtreleri (bıçak koruması, hafta sonu, yalnız limit, yalnız 4H, üst TF eğilimi aynı yön — seri
 * yoksa elenir) + canlı TF/yön kuralı (liveCheck: long puan ≥ 65; short puan ≥ 75 + MTF + ADX ≥ 30 yön uyumlu + EMA200 + BTC günlük
 * rejimi) + canlı bekleme süresi (liveCooldown; long 6 s, short 12 s, yalnız gönderilenler tüketir). Gerçek sıra (1H). A: bugünkü
 * canlı çıkış (3 kademe + TP1 sonrası stop erken hedefe, %1,2), B: eski %80 düzeni (karşılaştırma).
 */
export function liveVariants() {
  const { guard, wk, lim, only4h, man, hw } = parts();
  const live = { live: true, htfStrict: true, fillBarTp: 'lower' };
  return [
    { ...merge([guard, wk, lim, only4h, hw, { name: '', ...live, tp1Pct: 1.2, tp1Portion: 0.5, keepTp2: true, midTp: true, midPortion: 0.25, midStopToTp1: true }]), name: LIVE_NAME_A },
    { ...merge([guard, wk, lim, only4h, man, hw, { name: '', ...live }]), name: LIVE_NAME_B },
  ];
}

/** Yön kırılımı: { long: { train, valid }, short: { train, valid } } (t.d). */
export const dirSplit = (tr, va) => Object.fromEntries([['long', 1], ['short', -1]].map(([k, d]) => [k, { train: stats(tr.filter((t) => t.d === d)), valid: stats(va.filter((t) => t.d === d)) }]));

async function main() {
  const t0 = Date.now();
  const { all, meta, times, split } = loadPlans(IN);
  log(`Plan: ${all.length}; bölünme ${new Date(split).toISOString().slice(0, 10)}`);
  // Seriler
  const groups = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const series = new Map();
  for (const k of groups.keys()) { const [coin, tf] = k.split('|'); const s = await loadSeries(coin, tf, `${coin}-USDT-SWAP`); if (s) series.set(k, s); else log(`  ${k}: mum yok, atlandı`); }
  // Üst TF serileri (coin'in kendi eğilimi): 1H/4H önbellekten; 1D ağdan (getHistoryCached), yoksa o TF filtreden muaf
  const htf = new Map();
  {
    const tMin = times[0], tMax = times[times.length - 1];
    const need = new Set(all.map((t) => `${t.coin}|${UP_TF[t.tf]}`).filter((k) => k.split('|')[1]));
    let miss = 0;
    for (const k of need) {
      const [coin, up] = k.split('|');
      let cs = series.get(k)?.candles || null;
      if (!cs) {
        if (FIXTURE) { const { fixtureProvider } = await import('../src/data/fixture.js'); cs = (await fixtureProvider.candles(`${coin}-USDT-SWAP`, up, 400)).candles; }
        else if (up === '1D') { try { cs = await getHistoryCached(`${coin}-USDT-SWAP`, '1D', tMin - 120 * 86400e3, tMax + 86400e3, { cacheDir: CACHE }); } catch (e) { miss++; } }
        else { const s = await loadSeries(coin, up, `${coin}-USDT-SWAP`); cs = s?.candles || null; }
      }
      if (cs && cs.length) htf.set(k, { hs: horizonSeries(cs), ms: TIMEFRAMES[up].ms }); else miss++;
    }
    log(`Üst TF serisi: ${htf.size} yüklendi, ${miss} eksik`);
  }
  // BTC serileri (hedge'li R için; TF başına)
  const btcByTf = new Map();
  for (const tf of new Set(all.map((t) => t.tf))) { const b = series.get(`BTC|${tf}`) || await loadSeries('BTC', tf, 'BTC-USDT-SWAP'); if (b) btcByTf.set(tf, b.candles); }
  // Canlıya eşit: bekleme süresi yüzünden atlanmış planlar (plan dosyasında cd alanı; eski dosyada yok) ve BTC günlük serisi (rejim)
  const cdList = cooldownSkippedOf(all), cdGroups = new Map();
  for (const t of cdList) { const k = `${t.coin}|${t.tf}`; if (!cdGroups.has(k)) cdGroups.set(k, []); cdGroups.get(k).push(t); }
  const hasCd = Array.isArray(meta.planFields) && meta.planFields.includes('cd');
  let btcDaily = htf.get('BTC|1D')?.hs.candles || null;
  if (!btcDaily && all.some((t) => t.tf === '4H')) {
    try {
      if (FIXTURE) { const { fixtureProvider } = await import('../src/data/fixture.js'); btcDaily = (await fixtureProvider.candles('BTC-USDT-SWAP', '1D', 400)).candles; }
      else btcDaily = await getHistoryCached('BTC-USDT-SWAP', '1D', times[0] - 120 * 86400e3, times[times.length - 1] + 86400e3, { cacheDir: CACHE });
    } catch (e) { btcDaily = null; }
  }
  log(`Canlıya eşit: bekleme süresi atlanan plan ${hasCd ? cdList.length : 'yok (eski plan dosyası)'}, MTF alanı ${all.filter((t) => t.mtfBt).length}/${all.length}, BTC 1D ${btcDaily?.length || 0} mum`);
  // MTF indeksi
  const mtfIndex = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}|${t.plan.direction}`; if (!mtfIndex.has(k)) mtfIndex.set(k, []); mtfIndex.get(k).push(t.time); }

  const evaluate = (v) => {
    const o = { ...BT_DEFAULTS, tpScheme: v.tpScheme || 'half_be', trailAtr: v.trailAtr ?? 1, trailActR: v.trailActR ?? 0, trailKeepTp2: !!v.trailKeepTp2, midPortion: v.midPortion ?? 0.25, midStopToTp1: !!v.midStopToTp1, knifeGuard: v.knifeGuard || null, knifeBar: v.knifeBar || BT_DEFAULTS.knifeBar, timeStop: v.timeStop || null, tp1Portion: v.tp1Portion ?? BT_DEFAULTS.tp1Portion, feePct: meta.fee ?? 0.05, slipPct: meta.slip ?? 0.05, fillBarTp: v.fillBarTp || 'count', expireHours: v.expireHours ?? BT_DEFAULTS.expireHours };
    const LOWER = { '4H': '1H', '1H': '15m' };
    // Seçim. Canlıya eşit (v.live): bekleme süresi atlanan planlar da adaydır; filtreler → canlı kural → canlı bekleme süresi.
    // Veri yoksa (alan/seri) plan elenir ve liveInfo.unknown'da sayılır (sessiz geçirme/eleme yok).
    const info = v.live ? { unknown: { mtf: 0, trend: 0, regime: 0, htf: 0 }, rejected: {}, candidates: 0, mtfField: 0, mtfTfs: {}, cdPlans: hasCd ? cdList.length : null, cdUsed: 0, cooldownDropped: 0 } : null;
    let picked = [];
    for (const [k, list0] of groups) {
      const s = series.get(k); if (!s) continue;
      const list = v.live ? [...list0, ...(cdGroups.get(k) || [])] : list0;
      for (const t of list) {
        if (!v.live) { if (passes(t, v, s, mtfIndex, htf)) picked.push({ t }); continue; }
        if (!passes(t, { ...v, htfTrend: null }, s, mtfIndex, htf)) continue;
        if (v.htfTrend && !htf.get(`${t.coin}|${UP_TF[t.tf]}`)) { info.unknown.htf++; continue; }
        if (!passes(t, v, s, mtfIndex, htf)) continue;
        info.candidates++;
        if (t.mtfBt) { info.mtfField++; const tk = t.mtfBt.tfs.join('+'); info.mtfTfs[tk] = (info.mtfTfs[tk] || 0) + 1; }
        const lc = liveCheck(t, { btcDaily });
        if (!lc.ok) { if (lc.unknown) info.unknown[lc.unknown]++; else info.rejected[lc.reason] = (info.rejected[lc.reason] || 0) + 1; continue; }
        picked.push({ t, hours: lc.cooldownHours });
      }
    }
    if (v.live) { const kept = liveCooldown(picked); info.cooldownDropped = picked.length - kept.length; info.cdUsed = kept.filter((x) => x.t.cd).length; picked = kept; }
    const trades = [];
    for (const { t } of picked) {
      const s = series.get(`${t.coin}|${t.tf}`);
      const i = s.idx.get(t.time);
      const plan = (v.stopPadAtr != null || v.minRiskAtr != null || v.tp1R != null || v.tp2R != null || v.tp1Pct != null || v.midTp) ? rebuild(t.plan, v) : t.plan;
      const sim = simulateTrade(plan, s.candles, i + 1, t.tf, o.fillBarTp === 'lower' || o.knifeGuard ? { ...o, lowerCandles: series.get(`${t.coin}|${LOWER[t.tf]}`)?.candles || null } : o); // alt TF: dolum mumu sırası ('lower') ve bıçak kararının dokunma anı (knifeBar 'touch')
      const h = htf.get(`${t.coin}|${UP_TF[t.tf]}`);
      const tr = { time: t.time, tf: t.tf, score: t.plan.score, htf: h ? htfTrendAt(h.hs, h.ms, t.time + TIMEFRAMES[t.tf].ms) : null, waitBars: sim.waitBars, bars: sim.bars, tp1Bars: sim.tp1Bars ?? null, d: plan.d, entryFill: sim.entryFill, stop: plan.stop, outcome: sim.outcome, R: sim.R, mfe: sim.mfe, inZone: plan.inZone, approachAtr: sim.approachAtr };
      if (sim.entryFill) Object.assign(tr, hedgeOf(tr, btcByTf.get(t.tf), o.feePct, o.tp1Portion));
      trades.push(tr);
    }
    if (v.maxOpenSameDir || v.maxNewSameDir) { const kept = capTrades(trades, { maxOpen: v.maxOpenSameDir, maxNew: v.maxNewSameDir }); trades.length = 0; trades.push(...kept); }
    const tr = trades.filter((t) => t.time < split), va = trades.filter((t) => t.time >= split);
    // Dilim özetleri + %90 güven aralığı (gün bloklu bootstrap) + sonuçsuz (n < 100); diğer alanlar stats ile birebir aynı
    const train = statsCi(tr), valid = statsCi(va);
    // Gerçekçi: limit dolum mumunda sıra alt TF ile ('lower'; alt TF yoksa hedef sayılmaz) ya da hedef hiç sayılmaz ('skip').
    // 'count' iyimser (önce dolum sonra hedef varsayılır) → sıkı ölçüt dışı. strict yalnız gerçekçi satırda true olabilir.
    const realistic = o.fillBarTp === 'lower' || o.fillBarTp === 'skip', meets = meetsStrict(train, valid);
    const hd = (a) => a.filter((t) => t.hedgedR != null).map((t) => ({ ...t, R: t.hedgedR }));
    return { ...v, train, valid, all: stats(trades), byDir: dirSplit(tr, va), hedgedByDir: dirSplit(hd(tr), hd(va)), ...(info ? { liveInfo: info } : {}), byApproach: { train: by(tr, approachBucket), valid: by(va, approachBucket) },
      bySession: { train: by(tr, (x) => sessionOf(entryTimeOf(x))), valid: by(va, (x) => sessionOf(entryTimeOf(x))) },
      byWeekpart: { train: by(tr, (x) => weekpartOf(entryTimeOf(x))), valid: by(va, (x) => weekpartOf(entryTimeOf(x))) },
      byTp1Time: { train: by(tr, tp1Bucket), valid: by(va, tp1Bucket) },
      byTf: { train: by(tr, (x) => x.tf), valid: by(va, (x) => x.tf) },
      byHtfTrend: { train: by(tr, htfBucket), valid: by(va, htfBucket) },
      byWait: { train: by(tr, waitBucket), valid: by(va, waitBucket) },
      byWeekday: { train: by(tr, entryDayOf), valid: by(va, entryDayOf) },
      stack: { train: stackOf(tr), valid: stackOf(va) },
      ...hedgedOfTrades(tr, va), realistic, meetsStrict: meets, strict: realistic && meets };
  };

  // Hedge'li istatistikler (R yerine hedgedR) ve R ~ yönlü BTC% korelasyonu
  const hedgedOfTrades = (tr, va) => {
    const h = (a) => a.filter((t) => t.hedgedR != null).map((t) => ({ ...t, R: t.hedgedR }));
    const ht = h(tr), hv = h(va);
    const pts = (a) => a.filter((t) => t.btcPct != null && t.R != null && t.outcome !== 'expired' && t.outcome !== 'missed' && t.outcome !== 'knife').map((t) => [t.d * t.btcPct, t.R]);
    if (!ht.length && !hv.length) return {};
    // hedgedOpen (13.11): BTC bacağı dolum mumunun açılışından (hedgeOf); eski hedged alanı aynen kalır
    const ho = (a) => a.filter((t) => t.hedgedROpen != null).map((t) => ({ ...t, R: t.hedgedROpen }));
    return { hedged: { train: statsCi(ht), valid: statsCi(hv) }, hedgedOpen: { train: statsCi(ho(tr)), valid: statsCi(ho(va)) }, hedgedByTf: { train: by(ht, (x) => x.tf), valid: by(hv, (x) => x.tf) }, hedgedByWait: { train: by(ht, waitBucket), valid: by(hv, waitBucket) }, hedgedByWeekday: { train: by(ht, entryDayOf), valid: by(hv, entryDayOf) }, btcCorr: { train: corr(pts(tr)), valid: corr(pts(va)) } };
  };

  const results = [];
  log('Temel…'); results.push(evaluate(BASE));
  const extra = VARIANTS_FILE ? JSON.parse(fs.readFileSync(String(VARIANTS_FILE), 'utf8')) : [];
  for (const v of extra) { log(`  [araştırma] ${v.name}`); results.push({ ...evaluate(v), combo: true, targeted: true, research: true }); }
  if (ONLY) { writeOut(results, all, meta, split, t0); return; }
  for (const v of SINGLE) { log(`  ${v.name}`); results.push(evaluate(v)); }
  // Birleşimler: eğitimde ort. R'yi en çok artıran 4 tek değişikliğin ikili/üçlü/dörtlü birleşimleri
  const base = results[0];
  const gains = results.slice(1).filter((r) => r.train.n >= 300).map((r) => ({ r, gain: r.train.avgR - base.train.avgR })).sort((a, b) => b.gain - a.gain).slice(0, 4).map((x) => x.r);
  for (const list of targetedLists()) { const v = merge(list); log(`  ${v.name}`); results.push({ ...evaluate(v), combo: true, targeted: true }); }
  for (const list of capLists()) { const v = merge(list); log(`  ${v.name}`); results.push({ ...evaluate(v), combo: true, targeted: true, cap: true }); }
  // Canlıya eşit (13.11): canlı 4H kural zinciri (puan, short kuralı, bekleme süresi) plan verisinin izin verdiği ölçüde
  for (const v of liveVariants()) { log(`  ${v.name}`); results.push({ ...evaluate(v), combo: true, targeted: true, cap: true }); }
  const combos = [];
  for (let i = 0; i < gains.length; i++) for (let j = i + 1; j < gains.length; j++) { combos.push(merge([gains[i], gains[j]])); for (let k = j + 1; k < gains.length; k++) combos.push(merge([gains[i], gains[j], gains[k]])); }
  if (gains.length === 4) combos.push(merge(gains));
  // aynı alanı ezen varyantlar (ör. iki düşen bıçak ayarı) birleştirilmez
  const clash = (v) => (v.name.match(/düşen bıçak/g) || []).length > 1 || (v.name.match(/seansı|Asya \+ Avrupa/g) || []).length > 1 || (v.name.match(/zaman stopu|ilerleme stopu/g) || []).length > 1 || (v.name.match(/erken %80|elle yönetim|TP1 /g) || []).length > 1 || (v.name.match(/üst TF eğilimi/g) || []).length > 1;
  for (const v of combos.filter((x) => !clash(x))) { log(`  ${v.name}`); results.push({ ...evaluate(v), combo: true }); }

  writeOut(results, all, meta, split, t0);
}

/** Sıralama (yerinde): önce gerçekçi dolum mumu satırları (en iyi seçimi onların arasından), sonra iyimserler; her grupta doğrulama ort. R. */
export const rankResults = (results) => results.sort((a, b) => (b.realistic === true) - (a.realistic === true) || (b.valid.avgR ?? -9) - (a.valid.avgR ?? -9));
/** Sıkı ölçüt özeti: gerçekçi geçen / yalnız iyimser dolum mumuyla geçen / toplam varyant (çok varyanttan seçim = iyimserlik). */
export const strictPassOf = (results) => ({
  realistic: results.filter((r) => r.strict).length, optimisticOnly: results.filter((r) => r.meetsStrict && !r.realistic).length, variants: results.length,
  criterion: `iki dilimde n ≥ ${MIN_N}, ort. R > 0, PF > 1,1; yalnız gerçekçi dolum mumu sırası ('lower' / 'skip')`,
  ci: { method: 'giriş gününe (UTC) göre bloklu bootstrap, ort. R, %90 (yüzdelik)', reps: CI_DEFAULTS.reps, seed: CI_DEFAULTS.seed, rows: 'tüm satırların train/valid, hedged ve hedgedOpen dilimleri' },
});

function writeOut(results, all, meta, split, t0) {
  const base = results[0];
  rankResults(results);
  const strictPass = strictPassOf(results);
  const approach = results.find((r) => r.name === BASE.name)?.byApproach;
  for (const r of results) if (r.name !== BASE.name) { delete r.bySession; delete r.byWeekpart; delete r.byTp1Time; delete r.byHtfTrend; if (!/bekleme/.test(r.name)) { delete r.byWait; delete r.hedgedByWait; delete r.byWeekday; delete r.hedgedByWeekday; } }
  const out = { approach, meta: { ...meta, sweepAt: Date.now(), split, plans: all.length, variantsTested: results.length, elapsedSec: Math.round((Date.now() - t0) / 1000) }, strictPass, base, results };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, OUTFILE), JSON.stringify(out));
  log(`Sıkı ölçüt: gerçekçi ${strictPass.realistic} · yalnız iyimser ${strictPass.optimisticOnly} · ${strictPass.variants} varyant arasından`);
  log('En iyi (doğrulama; önce gerçekçi satırlar):');
  for (const r of results.slice(0, 8)) log(`  ${r.name.padEnd(60)} eğitim n${r.train.n} ${r.train.avgR}R | doğrulama n${r.valid.n} ${r.valid.avgR}R PF ${r.valid.profitFactor}${r.valid.ci90 ? ` %90 [${r.valid.ci90.join(', ')}]` : ''}${r.realistic ? '' : ' (iyimser dolum mumu)'}${r.strict ? ' ← SIKI' : ''}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
