#!/usr/bin/env node
// Parametre taraması (ucuz aşama): mevcut planları (plans.json.gz) önbellekteki mumlarla farklı çıkış/giriş/filtre
// kurallarıyla yeniden simüle eder; eğitim diliminde (ilk 2/3) sıralar, doğrulama diliminde (son 1/3) raporlar.
//   node backtest/sweep.mjs [--in docs/backtest] [--out docs/backtest] [--cache backtest/cache] [--fixture]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { simulateTrade, BT_DEFAULTS } from './engine.js';
import { stats } from './report.js';
import { adx as adxOf, ema as emaOf } from '../src/data/indicators.js';
import { TIMEFRAMES } from '../src/data/okx.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), OUT = String(arg('out', 'docs/backtest')), CACHE = String(arg('cache', 'backtest/cache')), FIXTURE = arg('fixture', false) === true;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Seri verisi: mumlar + indeks haritası + ADX/EMA200. */
async function loadSeries(coin, tf, instId) {
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
function rebuild(plan, v) {
  const d = plan.d, atr = plan.atr, [lo, hi] = plan.zone;
  const entry = plan.entry;
  let stop = v.stopPadAtr == null ? plan.stop : (d === 1 ? lo - v.stopPadAtr * atr : hi + v.stopPadAtr * atr);
  const minRisk = (v.minRiskAtr ?? 0.6) * atr;
  if (d * (entry - stop) < minRisk) stop = entry - d * minRisk;
  const risk = d * (entry - stop);
  const tp1 = entry + d * (v.tp1R ?? 1.5) * risk, tp2 = entry + d * (v.tp2R ?? 2.5) * risk;
  return { ...plan, stop, tp1, tp2 };
}

/** Filtreler: true = plan dahil. */
function passes(t, v, series, mtfIndex) {
  if (v.tfs && !v.tfs.includes(t.tf)) return false;
  if (v.minScore && t.plan.score < v.minScore) return false;
  if (v.onlyLimit && t.plan.inZone) return false;
  if (v.excludeGroups && t.plan.groups.some((g) => v.excludeGroups.includes(g))) return false;
  if (v.excludeDetectors && t.plan.signals.some((s) => v.excludeDetectors.includes(s.detector))) return false;
  if (v.requireAnyGroup && !t.plan.groups.some((g) => v.requireAnyGroup.includes(g))) return false;
  const i = series.idx.get(t.time);
  if (i == null) return false;
  if (v.trend === 'adx' || v.trend === 'both') {
    const a = series.adx.adx[i], p = series.adx.pdi[i], m = series.adx.mdi[i];
    if (a == null || a < (v.adxMin ?? 25)) return false;
    if (t.plan.d === 1 ? p <= m : m <= p) return false;
  }
  if (v.trend === 'ema' || v.trend === 'both') {
    const e = series.ema200[i];
    if (e == null || (t.plan.d === 1 ? t.plan.price < e : t.plan.price > e)) return false;
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
];

async function main() {
  const t0 = Date.now();
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, 'plans.json.gz'))).toString());
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(IN, 'results.json'), 'utf8')).meta; } catch { return {}; } })();
  const times = all.map((t) => t.time).sort((a, b) => a - b);
  const split = meta.split || times[Math.floor(times.length * 2 / 3)];
  log(`Plan: ${all.length}; bölünme ${new Date(split).toISOString().slice(0, 10)}`);
  // Seriler
  const groups = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const series = new Map();
  for (const k of groups.keys()) { const [coin, tf] = k.split('|'); const s = await loadSeries(coin, tf, `${coin}-USDT-SWAP`); if (s) series.set(k, s); else log(`  ${k}: mum yok, atlandı`); }
  // MTF indeksi
  const mtfIndex = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}|${t.plan.direction}`; if (!mtfIndex.has(k)) mtfIndex.set(k, []); mtfIndex.get(k).push(t.time); }

  const evaluate = (v) => {
    const o = { ...BT_DEFAULTS, tpScheme: v.tpScheme || 'half_be', trailAtr: v.trailAtr ?? 1, feePct: meta.fee ?? 0.05, slipPct: meta.slip ?? 0.05 };
    const trades = [];
    for (const [k, list] of groups) {
      const s = series.get(k); if (!s) continue;
      for (const t of list) {
        if (!passes(t, v, s, mtfIndex)) continue;
        const i = s.idx.get(t.time);
        const plan = (v.stopPadAtr != null || v.minRiskAtr != null || v.tp1R != null || v.tp2R != null) ? rebuild(t.plan, v) : t.plan;
        const sim = simulateTrade(plan, s.candles, i + 1, t.tf, o);
        trades.push({ time: t.time, outcome: sim.outcome, R: sim.R, mfe: sim.mfe });
      }
    }
    const train = stats(trades.filter((t) => t.time < split)), valid = stats(trades.filter((t) => t.time >= split));
    return { ...v, train, valid, all: stats(trades) };
  };

  const results = [];
  log('Temel…'); results.push(evaluate(BASE));
  for (const v of SINGLE) { log(`  ${v.name}`); results.push(evaluate(v)); }
  // Birleşimler: eğitimde ort. R'yi en çok artıran 4 tek değişikliğin ikili/üçlü/dörtlü birleşimleri
  const base = results[0];
  const gains = results.slice(1).filter((r) => r.train.n >= 300).map((r) => ({ r, gain: r.train.avgR - base.train.avgR })).sort((a, b) => b.gain - a.gain).slice(0, 4).map((x) => x.r);
  const merge = (list) => { const out = { name: list.map((v) => v.name).join(' + ') }; for (const v of list) for (const [k, val] of Object.entries(v)) if (!['name', 'train', 'valid', 'all'].includes(k)) out[k] = val; return out; };
  const combos = [];
  for (let i = 0; i < gains.length; i++) for (let j = i + 1; j < gains.length; j++) { combos.push(merge([gains[i], gains[j]])); for (let k = j + 1; k < gains.length; k++) combos.push(merge([gains[i], gains[j], gains[k]])); }
  if (gains.length === 4) combos.push(merge(gains));
  for (const v of combos) { log(`  ${v.name}`); results.push({ ...evaluate(v), combo: true }); }

  results.sort((a, b) => (b.valid.avgR ?? -9) - (a.valid.avgR ?? -9));
  const out = { meta: { ...meta, sweepAt: Date.now(), split, plans: all.length, elapsedSec: Math.round((Date.now() - t0) / 1000) }, base, results };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(out));
  log('En iyi (doğrulama):');
  for (const r of results.slice(0, 8)) log(`  ${r.name.padEnd(60)} eğitim n${r.train.n} ${r.train.avgR}R | doğrulama n${r.valid.n} ${r.valid.avgR}R PF ${r.valid.profitFactor}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
