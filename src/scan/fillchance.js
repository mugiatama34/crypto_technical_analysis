// "Dolma şansı": limit girişli planda fiyatın TP1'den ÖNCE girişe dokunma olasılığının kaba ölçüsü. Eğilimsiz rastgele yürüyüş
// varsayımı: p = TP1'e uzaklık / (girişe uzaklık + TP1'e uzaklık). Trend TP1 yönündeyse gerçek oran daha düşüktür.
// Kanıtlanmış bir süzgeç DEĞİL, görünüm: takip kaydında (15–22.11.2026, fib kesişimi, n 33) p < 0,3 olan 12 kaydın 0'ı doldu.
// Tarayıcı (src/ui/app.js) ve takip geçmişi aracı (tools/watch/history-lib.mjs) aynı işlevi kullanır.

/** d: 1 long / −1 short. → [0, 1] ya da null (veri eksik). Fiyat girişte / ötesindeyse 1; TP1'de / ötesindeyse 0. */
export function fillChance(d, price, entry, tp1) {
  if (![d, price, entry, tp1].every(Number.isFinite) || !d) return null;
  const distEntry = d * (price - entry), distTp1 = d * (tp1 - price);
  if (distEntry <= 0) return 1;
  if (distTp1 <= 0) return 0;
  return distTp1 / (distEntry + distTp1);
}

/** Rozet sınıfı: düşük (< 0,3) / orta (< 0,5) / iyi. */
export const fillChanceClass = (p) => (p == null ? '' : p < 0.3 ? 'low' : p < 0.5 ? 'mid' : 'ok');
