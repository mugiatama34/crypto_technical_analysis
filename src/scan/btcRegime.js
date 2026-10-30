// BTC rejim etiketi (karar anında, yalnız kapanmış mumlarla): günlük trend (EMA50 tarafı) + son 48 saatte "şok"
// (1H tepe–dip aralığı ≥ shockAtr × günlük ATR%) ve şok sonrası evre (şok bacağının ≥ %38,2'si geri alındı mı).
// Laboratuvarda işlemleri rejime göre kırmak ve ileride "rejime göre model seçimi" için.
import { atr } from '../data/indicators.js';
import { dailyTrendAt } from './regime.js';

const H = 36e5, DAY = 864e5;
export const REGIME_DEFAULTS = { lookH: 48, shockAtr: 2.0, recover: 0.382 };

/** Kapanışı `time`dan önce olan son mum indeksi (ikili arama); yoksa −1. */
function lastClosed(cs, time, ms) {
  let lo = 0, hi = cs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time + ms <= time) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}

/**
 * btc1h, btcDaily: { time, high, low, close }[]; decided: karar anı (ms).
 * → { trend: 'up'|'down'|null, shock: 'none'|'down'|'up', phase: 'toparlanma'|'devam'|'geri çekilme'|null, rangeAtr, label } | null
 */
export function regimeAt(btc1h, btcDaily, decided, o = REGIME_DEFAULTS) {
  if (!btc1h?.length || !btcDaily?.length) return null;
  const t = dailyTrendAt(btcDaily, decided);
  if (!btcDaily._atr) Object.defineProperty(btcDaily, '_atr', { value: atr(btcDaily.map((c) => c.high), btcDaily.map((c) => c.low), btcDaily.map((c) => c.close), 14), enumerable: false });
  const kd = lastClosed(btcDaily, decided, DAY), kh = lastClosed(btc1h, decided, H);
  if (kd < 0 || kh < o.lookH || btcDaily._atr[kd] == null) return null;
  const atrPct = btcDaily._atr[kd] / btcDaily[kd].close;
  let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1;
  for (let j = kh - o.lookH + 1; j <= kh; j++) { const c = btc1h[j]; if (c.high > hi) { hi = c.high; hiI = j; } if (c.low < lo) { lo = c.low; loI = j; } }
  const close = btc1h[kh].close, rng = (hi - lo) / close, rangeAtr = rng / atrPct;
  let shock = 'none', phase = null;
  if (rangeAtr >= o.shockAtr) {
    if (loI > hiI) { shock = 'down'; phase = (close - lo) / (hi - lo) >= o.recover ? 'toparlanma' : 'devam'; }
    else { shock = 'up'; phase = (hi - close) / (hi - lo) >= o.recover ? 'geri çekilme' : 'devam'; }
  }
  const trend = t ? (t.up ? 'up' : 'down') : null;
  const label = `${trend === 'up' ? 'G↑' : trend === 'down' ? 'G↓' : 'G?'} · ${shock === 'none' ? 'normal' : `şok${shock === 'down' ? '↓' : '↑'} ${phase}`}`;
  return { trend, shock, phase, rangeAtr: +rangeAtr.toFixed(2), label };
}
