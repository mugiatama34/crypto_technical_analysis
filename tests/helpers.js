// Sentetik mum üretici: [[bar, fiyat], ...] dönüş noktaları arasında doğrusal yol.
// Her mumun high/low'u orta fiyatın ±spread kadarıdır; hacim isteğe bağlı segment başına verilir.
import { makeContext } from '../src/scan/context.js';

export function build(path, { spread = 0.3, volumes = null, tfMs = 3600e3 } = {}) {
  const candles = [];
  for (let s = 0; s < path.length - 1; s++) {
    const [b0, p0] = path[s], [b1, p1] = path[s + 1];
    for (let b = b0; b < b1; b++) {
      const a = p0 + ((p1 - p0) * (b - b0)) / (b1 - b0);
      const z = p0 + ((p1 - p0) * (b + 1 - b0)) / (b1 - b0);
      candles.push({
        time: b * tfMs, open: a, close: z,
        high: Math.max(a, z) + spread, low: Math.min(a, z) - spread,
        volume: volumes ? volumes[s] : 100, confirmed: true,
      });
    }
  }
  return candles;
}

export const mirror = (candles, axis) =>
  candles.map((c) => ({ ...c, open: axis - c.open, close: axis - c.close, high: axis - c.low, low: axis - c.high }));

/** Belirli mumları üzerine yazar: patch = { [index]: { open, high, low, close, volume } }. */
export function patch(candles, patches) {
  return candles.map((c, i) => (patches[i] ? { ...c, ...patches[i] } : c));
}

/** Deterministik sözde rastgele (xorshift). */
export function rng(seed = 1) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/** Rastgele yürüyüş mumları (gürültü testleri için). */
export function randomWalk(n, { seed = 7, start = 100, step = 0.6, tfMs = 3600e3 } = {}) {
  const r = rng(seed);
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p + (r() - 0.5) * 2 * step;
    const hi = Math.max(o, c) + r() * step * 0.5, lo = Math.min(o, c) - r() * step * 0.5;
    out.push({ time: i * tfMs, open: o, high: hi, low: lo, close: c, volume: 50 + r() * 100, confirmed: true });
    p = c;
  }
  return out;
}

export const ctxOf = (candles, opts = {}) => makeContext({ candles, live: null, tf: opts.tf || '1H', symbol: opts.symbol || 'TEST', opts });
