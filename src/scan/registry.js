// Detektör kaydı: id, grup, etiket, varsayılan ağırlık, fonksiyon. UI ve puanlama bu listeden beslenir.
import { GROUPS } from '../core/signal.js';
import * as structure from '../detectors/structure.js';
import * as fvg from '../detectors/fvg.js';
import * as orderblock from '../detectors/orderblock.js';
import * as liquidity from '../detectors/liquidity.js';
import * as fibonacci from '../detectors/fibonacci.js';
import * as elliott from '../detectors/elliott.js';
import * as patterns from '../detectors/patterns.js';
import * as harmonic from '../detectors/harmonic.js';
import * as candlesticks from '../detectors/candlesticks.js';
import * as divergence from '../detectors/divergence.js';
import * as wyckoff from '../detectors/wyckoff.js';
import * as misc from '../detectors/misc.js';

export const DETECTORS = [
  { id: 'structure', group: 'smc', label: 'Piyasa yapısı (BOS / CHoCH / OTE)', weight: 1.0, fn: structure.detect, desc: 'Swing etiketleri, yapı kırılımları, premium/discount, OTE bölgesi.' },
  { id: 'fvg', group: 'smc', label: 'Fair Value Gap', weight: 1.0, fn: fvg.detect, desc: 'Üç mumlu dengesizlik boşlukları, dolum durumu, inversion FVG.' },
  { id: 'orderblock', group: 'smc', label: 'Order Block / Breaker', weight: 1.1, fn: orderblock.detect, desc: 'Yer değiştirme öncesi son ters mum; mitigation ve breaker.' },
  { id: 'liquidity', group: 'smc', label: 'Likidite (EQH/EQL, sweep, PDH/PDL)', weight: 1.1, fn: liquidity.detect, desc: 'Eşit tepe/dip havuzları, süpürmeler, önceki gün/hafta seviyeleri.' },
  { id: 'fibonacci', group: 'fib', label: 'Fibonacci', weight: 0.8, fn: fibonacci.detect, desc: 'Son bacakların geri çekilme/uzantı seviyeleri ve çakışmaları.' },
  { id: 'elliott', group: 'elliott', label: 'Elliott Wave', weight: 1.0, fn: elliott.detect, desc: 'Dalga-3 setup\'ları ve kural motoruyla sayım (itki, diagonal, zigzag, flat, üçgen, WXY).' },
  { id: 'patterns', group: 'pattern', label: 'Klasik formasyonlar', weight: 0.9, fn: patterns.detect, desc: 'İkili/üçlü tepe-dip, OBO, üçgen, wedge, kanal, bayrak, fincan-kulp.' },
  { id: 'triangles', group: 'pattern', label: 'Yükselen / alçalan üçgen', weight: 0.9, fn: patterns.detectTriangles, desc: 'Düz kenar + eğik kenar üçgenleri ve kırılımları.' },
  { id: 'harmonic', group: 'harmonic', label: 'Harmonik (Gartley, Bat, Crab…)', weight: 0.9, fn: harmonic.detect, desc: 'XABCD ve AB=CD oranları, PRZ bölgesi.' },
  { id: 'candlesticks', group: 'candle', label: 'Mum formasyonları', weight: 0.5, fn: candlesticks.detect, desc: 'Engulfing, pin bar, doji, star, soldiers/crows.' },
  { id: 'divergence', group: 'divergence', label: 'Uyumsuzluk (RSI/MACD/OBV)', weight: 0.8, fn: divergence.detect, desc: 'Regular ve gizli uyumsuzluklar.' },
  { id: 'wyckoff', group: 'wyckoff', label: 'Wyckoff', weight: 0.8, fn: wyckoff.detect, desc: 'Spring, upthrust, SOS, SOW.' },
  { id: 'indicator', group: 'indicator', label: 'İndikatör sinyalleri', weight: 0.5, fn: misc.detect, desc: 'EMA kesişimleri, sıkışma, Supertrend, Donchian, Ichimoku, RSI, MACD, ADX, hacim, VWAP, POC, pitchfork.' },
];

export const DETECTOR_MAP = Object.fromEntries(DETECTORS.map((d) => [d.id, d]));
export { GROUPS };

/** Seçili detektörleri bağlam üzerinde çalıştırır; hata veren detektör atlanır (errors listesine yazılır). */
export function runDetectors(ctx, ids = null, errors = null) {
  const out = [];
  for (const d of DETECTORS) {
    if (ids && !ids.includes(d.id)) continue;
    try {
      for (const s of d.fn(ctx)) out.push({ ...s, type: s.type || d.id, group: s.group || d.group, detector: d.id, tf: ctx.tf, symbol: ctx.symbol });
    } catch (err) {
      errors?.push({ detector: d.id, symbol: ctx.symbol, tf: ctx.tf, message: err.message });
    }
  }
  return out;
}
