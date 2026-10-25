// Pratik anlık görüntüsü: BTC ve ETH (USDT perp) için 1D/4H/1H/15m kapanmış mumları docs/pratik/candles.json'a yazar.
// egitim pratiği (pratik.html) bu dosyayı okur. Gerçek emir yok; yalnız veri.
import { writeFile, mkdir } from 'node:fs/promises';
import { getCandles, instIdOf, TIMEFRAMES } from '../../src/data/okx.js';

export const COINS = ['BTC', 'ETH'];
export const PLAN = { '1D': 220, '4H': 300, '1H': 300, '15m': 300 };
// Ek coinler (EXTRA=ARB,SOL): pratikte bakılan altcoinler, daha uzun 1H geçmişiyle docs/pratik/extra/<COIN>.json'a.
export const EXTRA_PLAN = { '1D': 300, '4H': 300, '1H': 720, '15m': 300 };
/** "arb, sol ,ARB" → ['ARB','SOL'] (büyük harf, tekil, yalnız harf/rakam). */
export const parseCoins = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{2,15}$/.test(x)))];

async function fetchPlan(coin, plan) {
  const o = {};
  for (const [tf, n] of Object.entries(plan)) {
    const { candles } = await getCandles(instIdOf(coin), TIMEFRAMES[tf], n);
    o[tf] = compact(candles);
    console.log(coin, tf, candles.length, 'son kapanış', candles.at(-1)?.close);
  }
  return o;
}

/** Mum nesnelerini kısa diziye çevirir: [zaman, açılış, yüksek, düşük, kapanış, USDT hacmi]. */
export const compact = (cs) => cs.map((c) => [c.time, c.open, c.high, c.low, c.close, Number.isFinite(c.quoteVol) ? Math.round(c.quoteVol) : null]);

async function main() {
  const out = { generatedAt: Date.now(), source: 'OKX USDT perp', coins: {} };
  for (const coin of COINS) out.coins[coin] = await fetchPlan(coin, PLAN);
  await mkdir('docs/pratik/extra', { recursive: true });
  await writeFile('docs/pratik/candles.json', JSON.stringify(out));
  for (const coin of parseCoins(process.env.EXTRA)) {
    const one = { generatedAt: Date.now(), source: 'OKX USDT perp', coin, tfs: await fetchPlan(coin, EXTRA_PLAN) };
    await writeFile(`docs/pratik/extra/${coin}.json`, JSON.stringify(one));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
