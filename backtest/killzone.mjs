// Kayıpların saati ↔ killzone'lar (ön kayıt: docs/arastirma/on-kayit-killzone.md). Girdi: sweep.mjs'in live-trades.json dökümü (stop fiyatı
// dökümde). Stop ve dolum saati OKX 1H mumlarından bulunur (yalnız yerelde; önbellek backtest/cache/kz-1h.json).
//   node backtest/killzone.mjs --in <live-trades.json> [--plans <plans.json.gz>] [--history docs/signals/history.json] [--out docs/backtest/killzone.json]
// S1 tam stopların killzone payı ↔ zaman payı ↔ BTC oynaklık payı (bilgi) · S2 dolumu killzone'da olan ↔ diğerleri (tek birincil test).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isFilled, closeTimeOf, dayOf } from './cluster.mjs';
import { okxGet, parseCandle, TIMEFRAMES } from '../src/data/okx.js';

const H = 3600e3, H4 = 4 * H;
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const mean = (a) => (a.length ? a.reduce((s, t) => s + t.R, 0) / a.length : null);
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });

/** New York yerel saati (0–23; yaz / kış saati dahil). */
export const nyHour = (ms) => +NY.format(new Date(ms)) % 24;
/** Killzone: Londra 02–05 NY, New York 07–10 NY; değilse null. */
export const zoneOf = (ms) => { const h = nyHour(ms); return h >= 2 && h < 5 ? 'london' : h >= 7 && h < 10 ? 'ny' : null; };

export const fillBarOf = (t) => t.time + (t.waitBars || 1) * TIMEFRAMES[t.tf].ms; // dolum 4H mumunun başlangıcı
export const closeBarOf = (t) => closeTimeOf(t) - TIMEFRAMES[t.tf].ms; // kapanış 4H mumunun başlangıcı

/** Dolum saati: fiyatı aralığında tutan ilk 1H mum (kayma payı için tol). Yoksa null. */
export function fillHour(c1h, price, tol = 0.001) {
  const c = c1h.find((x) => x.low <= price * (1 + tol) && x.high >= price * (1 - tol));
  return c ? c.time : null;
}
/** Stop saati: stopa dokunan ilk 1H mum (from = en erken zaman; aynı mumda dolan işlemde dolum saati). Yoksa null. */
export function stopHour(c1h, stop, d, from = 0) {
  const c = c1h.find((x) => x.time >= from && (d === 1 ? x.low <= stop : x.high >= stop));
  return c ? c.time : null;
}

/** BTC 1H mumlarında killzone'ların oynaklık payı: Σ (yüksek − düşük) / kapanış. */
export function volShare(candles) {
  const z = { london: 0, ny: 0, all: 0 }, hours = Array(24).fill(0);
  for (const c of candles) { const v = (c.high - c.low) / c.close, k = zoneOf(c.time); z.all += v; if (k) z[k] += v; hours[nyHour(c.time)] += v; }
  return { london: r2(z.london / z.all), ny: r2(z.ny / z.all), kz: r2((z.london + z.ny) / z.all), hours: hours.map((v) => r2(v / z.all)), n: candles.length };
}

/** S1: stop saatlerinin dağılımı. stops = [{ at }] */
export function stopShare(stops) {
  const z = { london: 0, ny: 0 }, hours = Array(24).fill(0);
  for (const s of stops) { const k = zoneOf(s.at); if (k) z[k]++; hours[nyHour(s.at)]++; }
  const n = stops.length || 1;
  // Kümelenme: killzone stopları kaç ayrı güne düşüyor, en kalabalık gün kaç stop (bağımsız örnek n'den küçüktür).
  const byDay = new Map(); for (const s of stops) if (zoneOf(s.at)) byDay.set(dayOf(s.at), (byDay.get(dayOf(s.at)) || 0) + 1);
  const top = [...byDay.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([day, c]) => ({ day, n: c }));
  return { n: stops.length, london: z.london, ny: z.ny, kz: z.london + z.ny, kzDays: byDay.size, days: new Set(stops.map((s) => dayOf(s.at))).size, topKzDays: top, kzShare: r2((z.london + z.ny) / n), londonShare: r2(z.london / n), nyShare: r2(z.ny / n), hours };
}

/** S2: dolumu killzone'da olan (t.fillAt) ↔ diğerleri; fark = diğer − killzone. */
export function kzDiff(trades) {
  const kz = trades.filter((t) => zoneOf(t.fillAt)), oth = trades.filter((t) => !zoneOf(t.fillAt)), a = mean(kz), b = mean(oth);
  return { kzN: kz.length, kzAvg: r2(a), otherN: oth.length, otherAvg: r2(b), diff: a == null || b == null ? null : r2(b - a) };
}
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Dolum gününe göre bloklu bootstrap → farkın %95 aralığı. */
export function kzCi(trades, { iters = 5000, seed = 7 } = {}) {
  const blocks = new Map();
  for (const t of trades) { const k = dayOf(t.fillAt); if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(t); }
  const B = [...blocks.values()], rand = rng(seed), out = [];
  for (let i = 0; i < iters; i++) { const s = []; for (let j = 0; j < B.length; j++) s.push(...B[Math.floor(rand() * B.length)]); const d = kzDiff(s).diff; if (d != null) out.push(d); }
  out.sort((a, b) => a - b);
  return out.length ? [r2(out[Math.floor(out.length * 0.025)]), r2(out[Math.floor(out.length * 0.975)])] : null;
}

/** Ön kayıttaki karar: grup n < 30 → iddia yok; < 100 → sonuçsuz; fark iki dilimde > 0 ve aralığın alt ucu > 0 → işaret var. */
export function verdict(train, valid, ci) {
  const minN = Math.min(train.kzN, valid.kzN);
  if (minN < 100) return minN < 30 ? 'sonuçsuz (n < 30: iddia yok)' : 'sonuçsuz (n < 100)';
  return train.diff > 0 && valid.diff > 0 && ci && ci[0] > 0 ? 'işaret var' : 'işaret yok';
}

/** Zamanlanmış işlemler → S1 + S2 özeti. timed = dolmuş işlemler; fillAt / stopAt (ms ya da null). */
export function analyze({ timed, split, btc }) {
  const stops = timed.filter((t) => t.outcome === 'stopped'), sOk = stops.filter((t) => t.stopAt != null), fOk = timed.filter((t) => t.fillAt != null);
  const vol = btc?.length ? volShare(btc) : null, s1 = stopShare(sOk.map((t) => ({ at: t.stopAt })));
  const sl = (a) => ({ train: a.filter((t) => t.time < split), valid: a.filter((t) => t.time >= split) });
  const F = sl(fOk), train = kzDiff(F.train), valid = kzDiff(F.valid), ci = kzCi(fOk);
  // Bilgi: çıkışı killzone'da olan kazançlar (R > 0) da aynı pencerelere mi düşüyor? Kapanış mumunun orta saati kaba ölçüdür; yalnız stoplar 1H çözünürlükte.
  return {
    match: { filled: timed.length, fillTimed: fOk.length, stops: stops.length, stopTimed: sOk.length, stopRate: r2(sOk.length / (stops.length || 1)), fillRate: r2(fOk.length / (timed.length || 1)) },
    s1: { timeShare: 0.25, vol, stops: s1, ratioVsTime: r2(s1.kzShare / 0.25), ratioVsVol: vol ? r2(s1.kzShare / vol.kz) : null,
      train: stopShare(sOk.filter((t) => t.time < split).map((t) => ({ at: t.stopAt }))), valid: stopShare(sOk.filter((t) => t.time >= split).map((t) => ({ at: t.stopAt }))) },
    s2: { all: kzDiff(fOk), train, valid, ci, verdict: verdict(train, valid, ci),
      byZone: ['london', 'ny'].map((z) => { const a = fOk.filter((t) => zoneOf(t.fillAt) === z); return { zone: z, n: a.length, avgR: r2(mean(a)) }; }) },
  };
}

/** Canlı kayıt (bilgi): 26.10.2026'dan beri 4H, dolmuş tam stopların kapanış saati ve dolum saatine göre sayım. */
export function liveInfo(history, since = Date.UTC(2026, 9, 26)) {
  const f = history.filter((s) => s.tf === '4H' && s.sentAt >= since && s.activeAt && s.closedAt);
  const stops = f.filter((s) => s.status === 'stopped');
  return { closed: f.length, stops: stopShare(stops.map((s) => ({ at: s.closedBar || s.closedAt }))), fillsInKz: f.filter((s) => zoneOf(s.filledAt || s.activeAt)).length,
    stopsOfKzFills: stops.filter((s) => zoneOf(s.filledAt || s.activeAt)).length, stopsOfOtherFills: stops.filter((s) => !zoneOf(s.filledAt || s.activeAt)).length };
}

// ── CLI (ağ: OKX history-candles 1H) ──
const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache', 'kz-1h.json');
async function hourly(instId, barStart, cache) {
  const k = `${instId}|${barStart}`;
  if (cache[k]) return cache[k];
  let data = [];
  try { data = await okxGet('/api/v5/market/history-candles', { instId, bar: '1H', after: barStart + H4, limit: 4 }, { lane: 'history' }); } catch { data = []; }
  const c = data.map(parseCandle).filter((x) => x.time >= barStart && x.time < barStart + H4).sort((a, b) => a.time - b.time).map(({ time, high, low, close }) => ({ time, high, low, close }));
  cache[k] = c;
  return c;
}
async function btcRange(from, to, cache) {
  const k = `BTC|${from}|${to}`;
  if (cache[k]) return cache[k];
  const out = [];
  for (let after = to; after > from;) {
    const data = await okxGet('/api/v5/market/history-candles', { instId: 'BTC-USDT-SWAP', bar: '1H', after, limit: 100 }, { lane: 'history' });
    if (!data.length) break;
    for (const a of data) { const c = parseCandle(a); if (c.time >= from) out.push({ time: c.time, high: c.high, low: c.low, close: c.close }); }
    after = +data[data.length - 1][0];
  }
  return (cache[k] = out.sort((a, b) => a.time - b.time));
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const src = JSON.parse(fs.readFileSync(arg('in', 'docs/backtest/live-trades.json'), 'utf8'));
  // Stop fiyatı dökümde (25.11'den beri `stop` alanı); eski dökümde --plans ile aynı koşunun plans.json.gz dosyasından eşlenir (eşleşme eksik kalabilir).
  const plans = arg('plans') ? JSON.parse(zlib.gunzipSync(fs.readFileSync(arg('plans'))).toString()) : [];
  const P = new Map(plans.map((p) => [`${p.coin}|${p.tf}|${p.time}|${p.plan?.d}`, p.plan]));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const filled = src.trades.filter(isFilled), timed = [];
  let noPlan = 0;
  for (const [i, t] of filled.entries()) {
    const plan = t.stop > 0 ? { stop: t.stop } : P.get(`${t.coin}|${t.tf}|${t.time}|${t.d}`), instId = `${t.coin}-USDT-SWAP`;
    const fb = fillBarOf(t), cb = closeBarOf(t), row = { ...t, fillAt: null, stopAt: null };
    row.fillAt = fillHour(await hourly(instId, fb, cache), t.entryFill);
    if (t.outcome === 'stopped') { if (!plan) noPlan++; else row.stopAt = stopHour(await hourly(instId, cb, cache), plan.stop, t.d, cb === fb ? row.fillAt ?? 0 : 0); }
    timed.push(row);
    if (i % 50 === 49) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`${i + 1} / ${filled.length}`); }
  }
  const times = filled.map((t) => t.time), btc = await btcRange(Math.min(...times), Math.max(...filled.map(closeTimeOf)), cache);
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const res = analyze({ timed, split: src.split, btc });
  const hist = arg('history', 'docs/signals/history.json');
  let live = null;
  if (fs.existsSync(hist)) { const h = JSON.parse(fs.readFileSync(hist, 'utf8')); live = liveInfo(Array.isArray(h) ? h : h.signals || Object.values(h).find(Array.isArray)); }
  const out = { name: src.name, split: src.split, source: { generatedAt: src.generatedAt, trades: src.trades.length, noPlan }, generatedAt: Date.now(),
    def: { london: '02:00–05:00 NY', ny: '07:00–10:00 NY', resolution: '1H' }, ...res, live };
  const file = arg('out', 'docs/backtest/killzone.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`HATA: ${e.message}`); process.exit(1); });
