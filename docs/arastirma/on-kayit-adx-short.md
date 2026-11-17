# Ön kayıt — yüksek ADX'te short (17.11.2026)

**Durum: ONAYLANDI (kullanıcı, 17.11.2026 — "ölçümü yapalım"). Bu dosya yazıldığında aşağıdaki bağımsız dönem için ölçüm yoktu.**
Tanım / eşik değişmez (değişirse tarihli not + neden). Eşik, dönem ve ölçüt orkestratörün seçimi; soruyu kullanıcı (arkadaşının gözlemi) getirdi.

## Nereden çıktı (görülmüş veri — kanıt sayılmaz)
13.11.2026 tam koşusu (`docs/backtest/results.json`, 12 ay ≈ 11.2025–11.2026, 1H + 4H, ilk 50 coin) "sinyal adına göre" tablosunda
"ADX 57 trend ↓" en üstte (n 16, +0,66R). Satırlar birleştirilince: ADX 25–30 −0,145R (n 3.483) · 30–35 −0,095 · 35–40 −0,090 · 40–50 −0,003 ·
50+ +0,142 (n 363). Yöne ayrılınca ADX ≥ 40: short +0,108R (n 960) ↔ long −0,059R (n 964). Eşik 40 bu tabloya bakılarak seçildi →
**bu dönem hipotezi üretti, sınayamaz.**

## Soru
Kümede "ADX trend ↓" sinyali varken ve ADX ≥ 40 iken açılan **short** işlemler, hipotezi üreten dönemin DIŞINDA da artı mı; artıysa kazanç
BTC yönünden mi (hedge'li R)? Beklenti (yazılı): hedge'li sonuç ≈ 0 (önceki tüm ailelerde kazanç BTC yönündendi; üç trend tanımında short
tarafı kazandırmadı).

## Veri ve kurulum
- **Bağımsız dönem: 13.11.2023 – 13.11.2025** (hipotezi üreten 12 ayın öncesi; 24 ay). OKX USDT sürekli vadeli, bugünün hacimde ilk 50 coini
  (o tarihte listelenmemiş olanlar doğal olarak eksik; hayatta kalma yanlılığı bilinen sınır). Zamanla 2/3 eğitim, 1/3 doğrulama.
- **Birincil: 4H** (canlı düzenin zaman dilimi). 1H yalnız bilgi satırı.
- Plan ve çıkış: 13.11 taramasındaki **bugünkü canlı satır** (3 kademe erken hedef + stop erkene, limit giriş, hafta sonu yok, bıçak koruması
  açık, `HTF_TREND=with`). Gerçekçi motor: `fillBarTp: 'lower'`, erken hedefli ölçümde `missTp`, **`knifeBar: 'touch'` (kötümser sınır) karar
  satırı**; `'lowerBar'` bilgi. Maliyet dahil (komisyon %0,05 + kayma %0,05, fonlama varsayılan).
- **Filtre (nedensel):** planın kümesinde adı `ADX <n> trend ↓` olan sinyal var **ve** n ≥ 40 (adı üreten yuvarlamayla; `src/detectors/misc.js`
  `adx|trend`) **ve** plan yönü short. Başka eşik denenmez.

## Geçme ölçütü (tek birincil test)
- **Geçer:** filtreli grupta eğitimde ve doğrulamada ort. R > 0 **ve** PF > 1,1 (sıkı ölçüt) **ve** hedge'li R (eşit nominal ters BTC) iki
  dilimde > 0; dilim başına dolan işlem n ≥ 100. n < 100 → **sonuçsuz**.
- Sıkı ölçüt geçer, hedge'li geçmezse sonuç: "BTC yönü; coin / kurulum seçimi değil" → kural olmaz.
- Geçerse bile canlı kural değil **aday**: sonraki adım ileriye dönük gölge etiket (Variables bayrağı, varsayılan kapalı, karar kullanıcıda).

## Bilgi satırları (karar vermez, seçim yapılmaz)
- Aynı dönemde: tüm short'lar (filtresiz) · ADX ≥ 40 long · ADX ≥ 50 short · ADX < 40 short — ort. R / PF / n / hedge'li R, dilim başına.
- Filtreli grubun işlemlerinin kaç ayrı güne / haftaya düştüğü (kümelenme; bağımsız örnek sayısı).
- 1H'de aynı birincil ölçü. Hipotezi üreten dönemde (13.11.2025–13.11.2026) aynı satır, "görülmüş" etiketiyle.
- `knifeBar: 'lowerBar'` altında birincil ölçü.

## Bilinen sınırlar
- Kural yalnız short → tek yönlü; dönemin BTC yönüne çok duyarlı. Hedge'li R bu yüzden ölçütün parçası.
- Yüksek ADX olayları az sayıda sert satış dalgasında kümelenir; n büyük görünse de bağımsız olay sayısı küçük olabilir.

## Not (17.11.2026, koşudan önce — tanım netleştirme, sonuç görülmeden)
- "Fonlama varsayılan" = taramanın varsayılanı, yani **0** (13.11 canlı satırı da fonlamasız ölçüldü; short'ta fonlama çoğu dönemde gelir
  olduğundan bu, kuralın lehine değil).
- Hedge'li ölçüt alanı: taramadaki `hedgedR` (BTC bacağı dolum mumunun kapanışından). `hedgedROpen` yalnız bilgi.
- Bilgi satırı "ADX < 40 short" = kümede "ADX trend ↓" sinyali olan ve n 25–39 kalan short'lar (ADX sinyali olmayanlar bu satırda değil;
  onlar "tüm short'lar" satırında).
- Plan üretimi `backtest/run.mjs` varsayılanlarıyla (min puan 50, min R:R 2, risk ≤ %5, bekleme 6 s); 1H bilgi satırı ayrı koşu (`adxshort1h`).
