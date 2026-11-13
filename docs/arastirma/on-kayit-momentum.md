# Ön kayıt — kesitsel momentum araştırması (13.11.2026)

**Durum: ONAYLANDI (kullanıcı, 13.11.2026 — "Ön kaydı onaylıyorum"); onay anında hiçbir ölçüm koşulmamıştı.** Tanım / eşik değişmez (değişirse tarihli not + neden).
Kardeş dosya: `on-kayit.md` (4H sinyal düzeni; sonuç: hiçbir hipotez geçmedi).

## Neden momentum
- Repoda hedge'li artı veren tek aile: `xsmom_l28_k5_short_rel` (haftalık, 28 günlük getiri − BTC getirisi, en zayıf 5 coin short, günlük
  3 ATR iz süren stop, BTC long hedge). 4H araştırmasında coin seçimi (BTC'ye göre güç) üç dilimde de tabanı iyileştiren tek izdi.
- **Bilinen zayıflıklar (ölçümden önce yazıldı):**
  1. Bu varyant 7 denenmiş varyant arasından seçildi (`XS_STRATEGIES`: l28, l14, l28+BTC rejimi, l28 long-short, l28 short, l28 short rel,
     l28 long-short rel) ve seçim 24 aylık veride (11.2024 → 11.2026) yapıldı → iyimser; o dönem artık "temiz" değil.
  2. Canlı kâğıt portföy (21.10.2026'dan beri, 4 yeniden dengeleme): **−%7,7** (300 → 276,9 USDT), aynı dönemde BTC −%17. Short + BTC long
     hedge'li bir portföyün düşen piyasada kaybetmesi beklenmezdi → backtest ↔ canlı uyumu ilk iş (4H düzeninde gerçek sorunlar
     böyle çıkmıştı).
  3. Fonlama backtest'te sabit %0,01 / 8 saat maliyet; çok short'lanan zayıf coinlerde gerçek fonlama bundan kat kat olumsuz olabilir.
  4. Evren bugünün listesinden: listeden kalkan coinler yok (short strateji için ihtiyatlı, long için iyimser yan).

## Veri ve dilimler
- Günlük mumlar (OKX USDT sürekli vadeli), dönem evreni (`pitN`: her yeniden dengelemede o tarihteki 30 günlük hacme göre ilk 50; havuz
  bugünün ilk 150'si).
- **Geliştirme dilimi:** 24.11.2024 → 13.11.2026 (taban varyantın seçildiği dönem; yeni hipotezler için ilk 2/3 eğitim, son 1/3 doğrulama).
- **Kilitli dilim (kasa-M):** 24.11.2022 → 24.11.2024 (momentum için hiç bakılmadı). Tek bakış, en sonda, taban + hipotezler birlikte.
  Veri o dönem için yetersizse (dengeleme başına < 20 coin) kasa kısaltılır; kısaltma kasa sonucu görülmeden, coin sayısına bakılarak yapılır.
- Birim: **haftalık portföy getirisi (%)**, eşit nominal, komisyon + kayma + fonlama dahil; ayrıca işlem başı R. İstatistik: haftaya göre
  bloklu bootstrap %90 güven aralığı (sabit tohum), yıllıklandırılmış Sharpe, maks. düşüş.

## Aşama M0 — teşhis (yalnız geliştirme dilimi; kural önermez)
| # | Ölçüm | Tanım | Önceden yazılmış yorum kuralı |
|---|---|---|---|
| M0a | Canlı ↔ backtest uyumu | 21.10.2026'dan beri canlı portföyün her işlemi ve BTC hedge bacağı, aynı tarihlerde backtest motorunun ürettiğiyle karşılaştırılır (seçilen coinler, giriş / çıkış fiyatı, stop, hedge büyüklüğü, fonlama). −%7,7'nin ayrışması: short bacaklar / hedge / maliyet. | Fark kaynağı bulunmadan M1'e geçilmez. Kod hatası varsa önce düzeltilir (düzeltme belgelenir). |
| M0b | Sıralamada bilgi var mı | Her hafta evren, 28 günlük BTC'ye göre getiriye göre beşte birlik dilimlere ayrılır; her dilimin SONRAKİ haftaki getirisi (evren ortalamasına göre; stop / maliyet yok). Plasebo: aynı hafta rastgele 5 coin (1.000 çekiliş). | "Bilgi var" = en zayıf dilim − evren ortalaması farkının %90 aralığı üst ucu < 0 (zayıflar zayıf kalıyor), eğitim ve doğrulamada. Dilimler tekdüze mi ayrıca raporlanır. |
| M0c | Fonlama gerçekçiliği | Short'lanan coinlerin gerçek fonlama oranları (OKX geçmişi ne kadar veriyorsa, ~3 ay) ↔ varsayılan %0,01 / 8 saat. | Gerçek maliyet varsayımın 2 katından fazlaysa M1'de fonlama modeli gerçek ortalamayla yeniden kurulur (M1'den önce, kasa görülmeden). |
| M0d | Taban yeniden ölçüm | Canlı varyant geliştirme diliminde, eğitim / doğrulama ayrı: haftalık getiri, Sharpe, düşüş, hedge'li ve hedge'siz; 7 varyantın hepsi yan yana (seçim iyimserliğini görmek için). | Yalnız teşhis. |

## Aşama M1 — hipotezler (M0'dan sonra kesinleşir; en çok 3 + taban doğrulaması)
| # | Hipotez | Gerekçe (ölçümden önce) | Tanım (tek varyant) |
|---|---|---|---|
| T | Taban doğrulaması | Seçilmiş varyant temiz veride ayakta mı | Canlı varyant aynen, kasa-M'de |
| HM1 | Piyasa-nötr long-short | BTC hedge'i alt-coin betasını kapatmıyor; long güçlü 5 + short zayıf 5 (BTC'ye göre) kendi içinde nötr | `rank: rel`, `side: ls`, K = 5, BTC hedge yok |
| HM2 | Oynaklığa göre boyut | Momentum çöküşleri yüksek oynaklıkta olur; ters-oynaklık ağırlığı belgelenmiş iyileştirme | Pozisyon nominali ∝ 1 / (coin'in 28 günlük günlük getiri std'si), toplam nominal sabit |
| HM3 | Son haftayı atla | Kısa vadeli geri dönüş etkisi: son 7 gün sıralamayı bozar | Sıralama getirisi t−28 → t−7 (son 7 gün hariç) |

Sağlamlık koşulu (hipotez değil): geçen her satır, pencere 14 ve 56 günle de aynı işarette olmalı (en iyisini seçmek yok; plato denetimi).

## Geçme ölçütü
1. **Taban (T):** kasa-M'de haftalık net getiri ortalaması > 0 **ve** %90 aralığının alt ucu > 0; Sharpe ≥ 0,5. Geçmezse canlı momentum
   "ölçülmüş" etiketini kaybeder, "deneme" olur (kapatma kararı kullanıcının).
2. **HM1–HM3:** geliştirmede eğitim ve doğrulamada ortalama > 0 ve tabandan yüksek Sharpe; kasa-M'de ortalama > 0, aralığın alt ucu > 0 ve
   tabandan yüksek Sharpe; sağlamlık koşulu.
3. Geçen satır **Variables bayrağıyla, varsayılan kapalı** canlı kâğıt portföye aday olur; karar kullanıcının. Gerçek para yok.
4. Birincil test sayısı 4 (T, HM1, HM2, HM3). Hiçbiri geçmezse: momentum da "kenar gösterilemedi" olarak yazılır; yeni fikir aranmadan önce
   kullanıcıyla durum değerlendirilir.

## Günlük
- 13.11.2026: taslak yazıldı (ölçüm yok).
- 13.11.2026: kullanıcı onayladı; M0 teşhis betiği yazılıyor.
