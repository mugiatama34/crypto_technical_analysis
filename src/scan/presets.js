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
  // Elliott kalıbına özgü taramalar: yalnız kural motorunun geçerli saydığı sayımlar (ders: Diyagonaller, Zigzag & Flat).
  // Tek detektör olduğu için küme puanı düşük kalır; minScore buna göre. Kalıp seçimi detectorOpts.elliott.patterns ile.
  {
    id: 'ew_diagonal', name: 'EW diyagonal', desc: 'Yalnız leading/ending diagonal sayımları (daralan/genişleyen); dalga-3 setup\'ları kapalı. Tamamlanan diyagonalde ters yön hedefi.',
    detectors: ['elliott'], weights: { elliott: 2.0 }, minScore: 20,
    detectorOpts: { elliott: { patterns: ['diagonal'], wave3: false, minScore: 50, maxCounts: 4 } },
  },
  {
    id: 'ew_zigzag', name: 'EW zigzag', desc: 'Yalnız zigzag (5-3-5) düzeltme sayımları: C dalgası hedefleri ve tamamlanmış zigzag sonrası trend yönü.',
    detectors: ['elliott'], weights: { elliott: 2.0 }, minScore: 20,
    detectorOpts: { elliott: { patterns: ['zigzag'], wave3: false, minScore: 50, maxCounts: 4 } },
  },
  {
    id: 'ew_flat', name: 'EW flat', desc: 'Yalnız flat (3-3-5: regular / expanded / running) düzeltme sayımları ve C dalgası hedefleri.',
    detectors: ['elliott'], weights: { elliott: 2.0 }, minScore: 20,
    detectorOpts: { elliott: { patterns: ['flat'], wave3: false, minScore: 50, maxCounts: 4 } },
  },
  {
    id: 'fib_cluster', name: 'Fib kesişimi (0,618×1,272)', desc: 'İtki sonrası ABC düzeltmesi: itkinin 0,618 geri çekilmesi ile A bacağının B\'den 1,272 uzantısı aynı yerdeyse giriş bölgesi; yön itkinin yönü.',
    detectors: ['fibonacci'], weights: { fibonacci: 2.0 }, minScore: 20,
    detectorOpts: { fibonacci: { only: 'cluster' } },
  },
  {
    id: 'ew_corrections', name: 'EW düzeltmeler', desc: 'Zigzag + flat + diyagonal birlikte; fib desteğiyle.',
    detectors: ['elliott', 'fibonacci'], weights: { elliott: 1.8, fibonacci: 0.6 }, minScore: 25,
    detectorOpts: { elliott: { patterns: ['zigzag', 'flat', 'diagonal'], wave3: false, minScore: 50, maxCounts: 4 } },
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
