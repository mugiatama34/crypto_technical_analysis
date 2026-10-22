// Tarama akışı: sembol listesi → her sembol × TF için mumlar → detektörler → confluence → sıralama.
// Veri sağlayıcı enjekte edilebilir (testlerde fixture, tarayıcıda OKX).
import { getTopCoins, getCandles, TIMEFRAMES, instIdOf } from '../data/okx.js';
import { attachRelativeStrength } from './relative.js';
import { makeContext } from './context.js';
import { runDetectors, DETECTORS } from './registry.js';
import { clusterSignals, multiTfAlignment } from './scoring.js';

const CONCURRENCY = 6;
/** TF'ye göre indirilecek mum sayısı (OKX tek istekte 300 verir; fazlası sayfalanır). */
export const barsFor = (tf) => (TIMEFRAMES[tf]?.rank >= 4 ? 600 : TIMEFRAMES[tf]?.rank >= 2 ? 400 : 300);

/** Varsayılan veri sağlayıcı: OKX. */
export const okxProvider = {
  topCoins: (n, net) => getTopCoins(n, net),
  candles: (instId, tf, count, net) => getCandles(instId, TIMEFRAMES[tf], count, net),
};

/**
 * @param settings { timeframes: string[], topN, manualCoins: string[]|null, detectors: string[]|null, weights, minScore, detectorOpts }
 * @param hooks { onProgress({done,total,symbol,tf}), onResult(row), onRetry, signal, provider, cache }
 * @returns {{ rows: Row[], symbols: Row[][], at, errors }}
 * Row = { coin, instId, tf, candles, live, signals, clusters, best, score, direction, error }
 */
export async function runScan(settings, hooks = {}) {
  const provider = hooks.provider || okxProvider;
  const net = { signal: hooks.signal, onRetry: hooks.onRetry };
  const tfs = (settings.timeframes?.length ? settings.timeframes : ['4H']).filter((t) => TIMEFRAMES[t]);
  const ids = settings.detectors || DETECTORS.map((d) => d.id);
  const weights = settings.weights || {};
  const cache = hooks.cache || new Map();
  const errors = [];

  let coins;
  if (settings.manualCoins?.length) coins = settings.manualCoins.map((c) => ({ coin: c.toUpperCase(), instId: instIdOf(c.toUpperCase()) }));
  else coins = await provider.topCoins(settings.topN || 50, net);

  const jobs = [];
  for (const c of coins) for (const tf of tfs) jobs.push({ ...c, tf });
  const rows = new Array(jobs.length);
  let done = 0, next = 0;
  hooks.onProgress?.({ done, total: jobs.length });

  const worker = async () => {
    while (next < jobs.length) {
      const idx = next++;
      const j = jobs[idx];
      try {
        const key = `${j.instId}|${j.tf}`;
        let data = cache.get(key);
        if (!data || Date.now() - data.at > (TIMEFRAMES[j.tf].ms / 4)) {
          const { candles, live } = await provider.candles(j.instId, j.tf, barsFor(j.tf), net);
          data = { candles, live, at: Date.now() };
          cache.set(key, data);
        }
        rows[idx] = analyzeRow({ ...j, candles: data.candles, live: data.live }, { ids, weights, settings, errors });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        rows[idx] = { ...j, candles: [], live: null, signals: [], clusters: [], best: null, score: 0, direction: null, error: err.message };
      }
      done++;
      hooks.onProgress?.({ done, total: jobs.length, symbol: j.coin, tf: j.tf });
      hooks.onResult?.(rows[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  // Sembol düzeyinde çoklu TF uyumu
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.coin)) bySymbol.set(r.coin, {});
    bySymbol.get(r.coin)[r.tf] = r;
  }
  for (const [, perTf] of bySymbol) {
    const align = multiTfAlignment(Object.fromEntries(Object.entries(perTf).map(([tf, r]) => [tf, { best: r.best }])));
    for (const r of Object.values(perTf)) r.mtf = align;
  }
  attachRelativeStrength(rows);
  rows.sort(compareRows);
  return { rows, at: Date.now(), errors, tfs, coins };
}

/** Tek sembol+TF: bağlam → sinyaller → kümeler. Saf; testlerde doğrudan çağrılır. */
export function analyzeRow(job, { ids, weights = {}, settings = {}, errors = null }) {
  const ctx = makeContext({ candles: job.candles, live: job.live, tf: job.tf, symbol: job.coin, opts: settings.detectorOpts || {} });
  if (ctx.n < 50) return { ...job, signals: [], clusters: [], best: null, score: 0, direction: null, error: 'Yetersiz mum' };
  const signals = runDetectors(ctx, ids, errors);
  const { clusters, best } = clusterSignals(signals, { atr: ctx.atrNow, price: ctx.price, weights, opts: settings.scoring });
  // Trend bağlamı (bot TF kuralları ve öğrenilen puan için): ADX / ±DI, EMA200, son mum zamanı
  const ax = ctx.adx, e200 = ctx.ema(200)[ctx.last];
  const trend = { adx: ax.adx[ctx.last], pdi: ax.pdi[ctx.last], mdi: ax.mdi[ctx.last], ema200: e200, time: ctx.candles[ctx.last].time };
  return { ...job, price: ctx.price, atr: ctx.atrNow, trend, signals, clusters, best, score: best?.score ?? 0, direction: best?.direction ?? null, error: null };
}

export function compareRows(a, b) {
  const am = a.mtf?.direction === a.direction ? a.mtf.score : 0, bm = b.mtf?.direction === b.direction ? b.mtf.score : 0;
  const as = Math.max(a.score, am), bs = Math.max(b.score, bm);
  if (bs !== as) return bs - as;
  return (b.best?.signals.length || 0) - (a.best?.signals.length || 0);
}
