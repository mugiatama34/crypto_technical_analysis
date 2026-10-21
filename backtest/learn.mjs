#!/usr/bin/env node
// Veriden öğrenen puan: plans.json.gz + mum önbelleği → özellikler → lojistik regresyon (eğitim: ilk 2/3) →
// doğrulama diliminde desil tablosu. Kabul koşulu sağlanırsa src/scan/learned.json yazılır (bot MODEL_MIN_PROB ile kullanır).
//   node backtest/learn.mjs [--in docs/backtest] [--out docs/backtest] [--cache backtest/cache] [--fixture] [--model src/scan/learned.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { stats } from './report.js';
import { FEATURE_NAMES, featuresOf, modelProb, trainLogistic } from './features.js';
import { adx as adxOf, ema as emaOf } from '../src/data/indicators.js';
import { TIMEFRAMES } from '../src/data/okx.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), OUT = String(arg('out', 'docs/backtest')), CACHE = String(arg('cache', 'backtest/cache')), FIXTURE = arg('fixture', false) === true, MODEL = String(arg('model', 'src/scan/learned.json'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout']);

async function loadSeries(coin, tf, instId) {
  let candles;
  if (FIXTURE) { const { fixtureProvider } = await import('../src/data/fixture.js'); candles = (await fixtureProvider.candles(instId, tf, 1500)).candles; }
  else { const f = path.join(CACHE, `${instId}_${tf}.json.gz`); if (!fs.existsSync(f)) return null; candles = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).candles; }
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  return { idx: new Map(candles.map((c, i) => [c.time, i])), adx: adxOf(highs, lows, closes, 14), ema200: emaOf(closes, 200) };
}

const decileTable = (rows) => {
  const sorted = [...rows].sort((a, b) => b.p - a.p);
  const out = [];
  for (let k = 0; k < 10; k++) {
    const part = sorted.slice(Math.floor((k * sorted.length) / 10), Math.floor(((k + 1) * sorted.length) / 10));
    out.push({ decile: k + 1, pMin: part.length ? +part[part.length - 1].p.toFixed(3) : null, pMax: part.length ? +part[0].p.toFixed(3) : null, ...stats(part) });
  }
  return out;
};
const topShare = (rows, share) => { const s = [...rows].sort((a, b) => b.p - a.p); const part = s.slice(0, Math.max(1, Math.floor(s.length * share))); return { threshold: part.length ? +part[part.length - 1].p.toFixed(3) : null, ...stats(part) }; };

async function main() {
  const t0 = Date.now();
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, 'plans.json.gz'))).toString());
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(IN, 'results.json'), 'utf8')).meta; } catch { return {}; } })();
  const times = all.map((t) => t.time).sort((a, b) => a - b);
  const split = meta.split || times[Math.floor(times.length * 2 / 3)];
  const series = new Map();
  const keys = new Set(all.map((t) => `${t.coin}|${t.tf}`));
  for (const k of keys) { const [coin, tf] = k.split('|'); const s = await loadSeries(coin, tf, `${coin}-USDT-SWAP`); if (s) series.set(k, s); }
  const mtfIndex = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}|${t.plan.direction}`; if (!mtfIndex.has(k)) mtfIndex.set(k, []); mtfIndex.get(k).push(t.time); }
  const rows = [];
  for (const t of all) {
    if (!TRADED.has(t.outcome)) continue;
    const s = series.get(`${t.coin}|${t.tf}`); if (!s) continue;
    const i = s.idx.get(t.time); if (i == null) continue;
    const up = { '15m': '1H', '1H': '4H' }[t.tf];
    const mtf = up ? (mtfIndex.get(`${t.coin}|${up}|${t.plan.direction}`) || []).some((x) => Math.abs(x - t.time) <= TIMEFRAMES[up].ms) : false;
    const x = featuresOf({ ...t.plan, time: t.time }, { adx: s.adx.adx[i], pdi: s.adx.pdi[i], mdi: s.adx.mdi[i], ema200: s.ema200[i], price: t.plan.price, mtf });
    rows.push({ x, y: t.R > 0 ? 1 : 0, R: t.R, outcome: t.outcome, time: t.time });
  }
  const train = rows.filter((r) => r.time < split), valid = rows.filter((r) => r.time >= split);
  log(`Örnek: ${rows.length} (eğitim ${train.length}, doğrulama ${valid.length}), özellik ${FEATURE_NAMES.length}`);
  if (train.length < 200 || valid.length < 100) { log('Yetersiz veri'); fs.writeFileSync(path.join(OUT, 'learn.json'), JSON.stringify({ meta: { error: 'yetersiz veri', n: rows.length } })); return; }
  const model = trainLogistic(train.map((r) => r.x), train.map((r) => r.y), { epochs: 500, lr: 0.3, l2: 2e-3 });
  const score = (list) => list.map((r) => ({ ...r, p: modelProb(model, r.x) }));
  const tr = score(train), va = score(valid);
  const result = {
    meta: { ...meta, learnAt: Date.now(), split, n: rows.length, nTrain: train.length, nValid: valid.length, loss: model.loss, elapsedSec: Math.round((Date.now() - t0) / 1000) },
    coef: FEATURE_NAMES.map((n, i) => ({ feature: n, weight: model.weights[i] })).sort((a, b) => b.weight - a.weight),
    bias: model.bias,
    trainDeciles: decileTable(tr), validDeciles: decileTable(va),
    top10: { train: topShare(tr, 0.1), valid: topShare(va, 0.1) }, top20: { train: topShare(tr, 0.2), valid: topShare(va, 0.2) },
    baseline: { train: stats(tr), valid: stats(va) },
  };
  const t20 = result.top20.valid;
  result.accepted = t20.n >= 100 && t20.avgR > 0 && t20.profitFactor > 1.1;
  result.verdict = result.accepted
    ? `Kabul: doğrulamada en üst %20 dilim ort. ${t20.avgR}R, PF ${t20.profitFactor} (n ${t20.n}); eşik olasılık ${t20.threshold}.`
    : `Ret: doğrulamada en üst %20 dilim ort. ${t20.avgR}R, PF ${t20.profitFactor} (n ${t20.n}). Model kullanılmıyor.`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'learn.json'), JSON.stringify(result));
  if (result.accepted) {
    fs.mkdirSync(path.dirname(MODEL), { recursive: true });
    fs.writeFileSync(MODEL, JSON.stringify({ names: FEATURE_NAMES, weights: model.weights, bias: model.bias, threshold: t20.threshold, acceptedAt: Date.now(), valid: t20 }, null, 1));
    log(`Model yazıldı: ${MODEL}`);
  }
  log(result.verdict);
  log('Doğrulama desilleri (1 = en yüksek olasılık):');
  for (const d of result.validDeciles) log(`  ${d.decile}  p ${d.pMin}–${d.pMax}  n ${d.n}  kazanma %${(d.winRate * 100).toFixed(0)}  ort ${d.avgR}R  PF ${d.profitFactor}`);
  log('En etkili katsayılar: +' + result.coef.slice(0, 6).map((c) => `${c.feature} ${c.weight}`).join(', ') + ' | −' + result.coef.slice(-6).map((c) => `${c.feature} ${c.weight}`).join(', '));
}
main().catch((e) => { console.error(e); process.exit(1); });
