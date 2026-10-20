// Tarayıcı içi fixture sağlayıcı (?fixture=1): OKX'e erişilemeyen ortamlarda arayüzü sentetik veriyle çalıştırır.
// Deterministik rastgele yürüyüş + birkaç sembolde bilinen yapılar.

function rng(seed = 1) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function walk(n, seed, tfMs, start = 100) {
  const r = rng(seed);
  const out = [];
  let p = start;
  const t0 = Date.now() - n * tfMs;
  for (let i = 0; i < n; i++) {
    const o = p;
    const drift = Math.sin(i / 40) * 0.2;
    const c = p * (1 + ((r() - 0.5) * 0.02 + drift * 0.002));
    const hi = Math.max(o, c) * (1 + r() * 0.006), lo = Math.min(o, c) * (1 - r() * 0.006);
    out.push({ time: t0 + i * tfMs, open: o, high: hi, low: lo, close: c, volume: 1000 + r() * 3000, confirmed: true });
    p = c;
  }
  return out;
}

function path(points, tfMs, seed = 3) {
  const r = rng(seed);
  const out = [];
  const total = points[points.length - 1][0];
  const t0 = Date.now() - total * tfMs;
  for (let s = 0; s < points.length - 1; s++) {
    const [b0, p0] = points[s], [b1, p1] = points[s + 1];
    for (let b = b0; b < b1; b++) {
      const a = p0 + ((p1 - p0) * (b - b0)) / (b1 - b0);
      const z = p0 + ((p1 - p0) * (b + 1 - b0)) / (b1 - b0);
      const spread = Math.abs(p1 - p0) / (b1 - b0) * 0.6 + 0.3;
      out.push({ time: t0 + b * tfMs, open: a, close: z, high: Math.max(a, z) + spread * r(), low: Math.min(a, z) - spread * r(), volume: 1000 + r() * 2000, confirmed: true });
    }
  }
  return out;
}

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'SUI', 'PEPE', 'ARB', 'OP', 'LTC', 'BCH', 'NEAR', 'APT', 'TON', 'TRX', 'ATOM'];
const TF_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1H': 3600e3, '4H': 14400e3, '1D': 86400e3 };

export const fixtureProvider = {
  async topCoins(n) {
    await new Promise((r) => setTimeout(r, 50));
    return COINS.slice(0, n).map((coin, i) => ({ coin, instId: `${coin}-USDT-SWAP`, last: 100, volUsd: 1e9 / (i + 1), change24h: 0 }));
  },
  async candles(instId, tfArg, count) {
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 60));
    const tf = typeof tfArg === 'string' ? tfArg : tfArg?.id || '1H', ms = TF_MS[tf] || 3600e3;
    const coin = instId.split('-')[0];
    const seed = coin.split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) + tf.length;
    let candles;
    if (coin === 'BTC') candles = path([[0, 120], [60, 120], [100, 100], [120, 130], [132, 115], [140, 122], [150, 110], [156, 119]], ms, seed);
    else if (coin === 'ETH') candles = path([[0, 100], [40, 100], [55, 120], [65, 108], [80, 120.2], [92, 109], [100, 112]], ms, seed);
    else candles = walk(count, seed, ms, 10 + (seed % 90));
    return { candles, live: null };
  },
};
