# Ajan arşivi · 30.10.2026 10:16 UTC (sıfırlanmadan önceki son yayın)

Neden: 30.10 10:30 UTC'de `scan.yml` önbellek yol listesine `bot/regime-state.json` eklendi. `actions/cache` sürümü yol
listesinden türediği için eski önbellek bulunamadı ve bot durumu (ajanlar, momentum, sinyal durumu) sıfırdan başladı.
Düzeltme: yol listesi eski haline döndürüldü (eski önbellek yeniden eşleşir); rejim durumu yayınlanan dosyadan kurulur.
Bu klasör, sıfırlanmadan önceki yayınlanmış hesapları (işlemler, günlük, dersler, parametreler) saklar.

| Hesap | Özsermaye | İşlem | Kazanma | Ort. R | PF | Getiri |
|---|---|---|---|---|---|---|
| Temkinli | 256,90 / 300 | 32 | %25 | −0,46 | 0,21 | −%14,4 |
| Agresif | 266,49 / 300 | 32 | %47 | +0,04 | 0,94 | −%11,2 |
| Momentum (short, BTC hedge'li) | 277,86 / 300 | – | – | – | – | −%7,4 (BTC −%7,2) |

## Ajanların ortak dersleri (iki hesapta da tekrar eden)
1. Aynı hareketten türeyen FVG/iFVG/OB/BOS/Breaker/Fib tek teyittir; sinyal sayısı güç değildir.
2. OB/FVG'ye kör limitle girme; tepki mumu kapanışı ya da 15m mikro CHoCH bekle.
3. Altta alınmamış EQL/PDL varken long açma ya da stopu o likiditenin ötesine (≥ 1 ATR) koy; mıknatısın hemen üstündeki stop süpürülür.
4. Premium'da long açma; discount/OTE ve yapı onayı.
5. 4H kırılımda kapanış + retest bekle; dar (%2) stoplar retestte alınıyor.
6. TP1'e ≥ 1,5R yoksa girme; TP1'de kısmi kâr tek pozitif desen.
7. BTC 4H aşağı dönüyorsa altcoin long açma.
8. Hedge yalnız tanımlı (beta ayarlı, teknik stoplu) olmalı; tanımsız hedge yalnız ücret ödetti.
9. Emir öncesi stop tarafı ve gerçek mesafe gerekçeyle sayısal olarak kontrol edilmeli (yanlış taraf stoplar oldu).
10. Orijinal ve taşınan stop ayrı kaydedilmeli; aksi halde R doğrulanamıyor.

Tam metin ve işlem listeleri: `temkinli.json`, `agresif.json` (`trades`, `journal`, `lessons`, `paramsHistory`), `momentum.json`.
