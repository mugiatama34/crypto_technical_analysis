// Tarama presetleri: hangi detektörler açık, ağırlıklar, min puan. UI'da tek tıkla seçilir.
export const PRESETS = [
  {
    id: 'all', name: 'Hepsi', desc: 'Tüm detektörler, varsayılan ağırlıklar.',
    detectors: null, weights: {}, minScore: 30,
  },
  {
    id: 'ict', name: 'ICT giriş', desc: 'Yapı + FVG + OB + likidite + OTE; mum teyidi ve fib destek.',
    detectors: ['structure', 'fvg', 'orderblock', 'liquidity', 'fibonacci', 'candlesticks'],
    weights: { structure: 1.2, fvg: 1.2, orderblock: 1.3, liquidity: 1.3, fibonacci: 0.6, candlesticks: 0.4 }, minScore: 35,
  },
  {
    id: 'ew3', name: 'Elliott 3. dalga', desc: 'Dalga-3 setup\'ları, fib çakışmaları ve uyumsuzluk teyidi.',
    detectors: ['elliott', 'fibonacci', 'divergence', 'structure'],
    weights: { elliott: 1.5, fibonacci: 0.9, divergence: 0.7, structure: 0.5 }, minScore: 35,
  },
  {
    id: 'harmonic', name: 'Harmonik PRZ', desc: 'Harmonik kalıplar + fib + mum dönüşü.',
    detectors: ['harmonic', 'fibonacci', 'candlesticks', 'divergence'],
    weights: { harmonic: 1.5, fibonacci: 0.8, candlesticks: 0.5, divergence: 0.6 }, minScore: 35,
  },
  {
    id: 'breakout', name: 'Kırılım', desc: 'Formasyon kırılımları, Donchian/sıkışma, hacim, yapı.',
    detectors: ['patterns', 'triangles', 'indicator', 'structure', 'liquidity', 'wyckoff'],
    weights: { patterns: 1.2, triangles: 1.2, indicator: 0.8, structure: 0.8, liquidity: 0.7, wyckoff: 0.8 }, minScore: 35,
  },
  {
    id: 'reversal', name: 'Dönüş', desc: 'Likidite süpürmesi + uyumsuzluk + mum + harmonik + Wyckoff.',
    detectors: ['liquidity', 'divergence', 'candlesticks', 'harmonic', 'wyckoff', 'orderblock', 'fvg'],
    weights: { liquidity: 1.3, divergence: 1.1, candlesticks: 0.6, harmonic: 1.0, wyckoff: 1.0, orderblock: 0.8, fvg: 0.7 }, minScore: 35,
  },
];

export const PRESET_MAP = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
