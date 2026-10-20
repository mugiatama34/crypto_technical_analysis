// Geçmiş mumlar: OKX /market/history-candles (100 mum/istek, `after` ile geriye). Disk önbelleği (gzip JSON).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { okxGet, parseCandle, splitLive, TIMEFRAMES } from '../src/data/okx.js';

const PER = 100;

/** [startMs, endMs] aralığındaki kapanmış mumlar, eskiden yeniye. */
export async function getHistory(instId, tf, startMs, endMs, opts = {}) {
  const T = TIMEFRAMES[tf];
  endMs = Math.min(endMs, Date.now());
  const out = [];
  let after = endMs + T.ms;
  for (;;) {
    const data = await okxGet('/api/v5/market/history-candles', { instId, bar: T.okxBar, limit: PER, after }, { ...opts, lane: 'history' });
    if (!data.length) break;
    for (const a of data) out.push(parseCandle(a));
    const oldest = +data[data.length - 1][0];
    opts.onPage?.({ oldest, count: out.length });
    if (oldest <= startMs || data.length < PER) break;
    after = oldest;
  }
  const { candles } = splitLive(out);
  return candles.filter((c) => c.time >= startMs && c.time <= endMs);
}

/** Disk önbelleği: cacheDir/<inst>_<tf>.json.gz; eksik kısmı tamamlamaz, aralık değişirse yeniden indirir. */
export async function getHistoryCached(instId, tf, startMs, endMs, { cacheDir, ...opts } = {}) {
  const file = path.join(cacheDir, `${instId}_${tf}.json.gz`);
  try {
    const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
    if (j.startMs <= startMs && j.endMs >= endMs - TIMEFRAMES[tf].ms * 2) return j.candles.filter((c) => c.time >= startMs && c.time <= endMs);
  } catch { /* yok */ }
  const candles = await getHistory(instId, tf, startMs, endMs, opts);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ startMs, endMs, candles })));
  return candles;
}
