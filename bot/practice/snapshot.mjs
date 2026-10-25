// Pratik anlık görüntüsü: BTC ve ETH (USDT perp) için 1D/4H/1H/15m kapanmış mumları docs/pratik/candles.json'a yazar.
// egitim pratiği (pratik.html) bu dosyayı okur. Gerçek emir yok; yalnız veri.
import { writeFile, mkdir } from 'node:fs/promises';
import { getCandles, instIdOf, TIMEFRAMES } from '../../src/data/okx.js';

export const COINS = ['BTC', 'ETH'];
export const PLAN = { '1D': 220, '4H': 300, '1H': 300, '15m': 300 };

/** Mum nesnelerini kısa diziye çevirir: [zaman, açılış, yüksek, düşük, kapanış, USDT hacmi]. */
export const compact = (cs) => cs.map((c) => [c.time, c.open, c.high, c.low, c.close, Number.isFinite(c.quoteVol) ? Math.round(c.quoteVol) : null]);

async function main() {
  const out = { generatedAt: Date.now(), source: 'OKX USDT perp', coins: {} };
  for (const coin of COINS) {
    out.coins[coin] = {};
    for (const [tf, n] of Object.entries(PLAN)) {
      const { candles } = await getCandles(instIdOf(coin), TIMEFRAMES[tf], n);
      out.coins[coin][tf] = compact(candles);
      console.log(coin, tf, candles.length, 'son kapanış', candles.at(-1)?.close);
    }
  }
  await mkdir('docs/pratik', { recursive: true });
  await writeFile('docs/pratik/candles.json', JSON.stringify(out));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
