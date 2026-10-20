// Ortak sinyal tipi. Her detektör `detect(ctx) → Signal[]` döndürür; sinyaller saf veridir (DOM yok).
//
// Signal = {
//   id: string            // detektör içinde tekil anahtar (ör. 'fvg|bull|123')
//   type: string          // detektör kimliği (registry id), ör. 'fvg'
//   group: string         // 'smc' | 'elliott' | 'fib' | 'pattern' | 'harmonic' | 'candle' | 'divergence' | 'indicator' | 'wyckoff'
//   name: string          // kısa Türkçe etiket (rozet)
//   direction: 'long' | 'short' | 'neutral'
//   strength: 0..1        // detektörün kendi güveni
//   zone: [lo, hi] | null // ilgili fiyat bölgesi (confluence kümelemesi için)
//   index: number         // sinyalin bağlı olduğu son mum indeksi
//   status: 'active' | 'forming' | 'triggered' | 'mitigated' | 'done' | 'invalid'
//   invalidation?: number // geçersizlik fiyatı
//   target?: number       // ilk hedef
//   entry?: number
//   stop?: number
//   note?: string         // bir cümlelik açıklama
//   draw?: Draw[]         // grafik çizim talimatları (chart.js yorumlar)
//   meta?: object
// }
//
// Draw: { kind: 'box', from, to, lo, hi, color, label } | { kind: 'hline', price, color, label, style }
//     | { kind: 'line', points: [{i, price}], color, label, style } | { kind: 'marker', i, price, position, shape, color, text }

export const GROUPS = {
  smc: { id: 'smc', label: 'ICT / SMC', color: '#3987e5' },
  elliott: { id: 'elliott', label: 'Elliott Wave', color: '#f0c75e' },
  fib: { id: 'fib', label: 'Fibonacci', color: '#7cc4a8' },
  pattern: { id: 'pattern', label: 'Formasyon', color: '#9085e9' },
  harmonic: { id: 'harmonic', label: 'Harmonik', color: '#d55181' },
  candle: { id: 'candle', label: 'Mum', color: '#c98500' },
  divergence: { id: 'divergence', label: 'Uyumsuzluk', color: '#199e70' },
  indicator: { id: 'indicator', label: 'İndikatör', color: '#a5a39a' },
  wyckoff: { id: 'wyckoff', label: 'Wyckoff', color: '#e66767' },
};

export const ACTIVE_STATUS = new Set(['active', 'forming', 'triggered']);

/** Sinyal fabrikası: zorunlu alanlar + varsayılanlar. */
export function signal(s) {
  if (!s.type || !s.name) throw new Error('Signal: type ve name zorunlu');
  return {
    id: s.id ?? `${s.type}|${s.direction ?? 'n'}|${s.index ?? 0}`,
    group: s.group ?? 'indicator',
    direction: s.direction ?? 'neutral',
    strength: clamp01(s.strength ?? 0.5),
    zone: s.zone ?? null,
    index: s.index ?? 0,
    status: s.status ?? 'active',
    draw: s.draw ?? [],
    meta: s.meta ?? {},
    ...s,
  };
}

export const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Bölge orta noktası. */
export const zoneMid = (z) => (z ? (z[0] + z[1]) / 2 : NaN);

/** İki bölge çakışıyor mu (tol kadar genişletilmiş)? */
export function zonesOverlap(a, b, tol = 0) {
  if (!a || !b) return false;
  return a[0] - tol <= b[1] && b[0] - tol <= a[1];
}

/** Fiyat bölgenin içinde mi (tol ile)? */
export const inZone = (p, z, tol = 0) => !!z && p >= z[0] - tol && p <= z[1] + tol;
