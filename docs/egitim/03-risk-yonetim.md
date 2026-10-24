# 03 — Risk ve işlem yönetimi

Arkadaşının cevapları, kısa ve uygulanabilir hale getirildi. Kendisi de "burada başarılı değilim" dedi; kural
burada, disiplin sende.

## Risk birimi: R
- **1R = stop olursa kaybedeceğin para.** Her şey R ile konuşulur; yüzde ya da dolar değil.
- **İşlem başına risk: hesabın %1'i.** 1 000 USDT hesapta 1R = 10 USDT.
- **Kaldıraç risk değildir.** Pozisyon büyüklüğü stop mesafesinden hesaplanır:
  `büyüklük (nominal) = risk USDT / stop mesafesi (%)`. Örnek: 1 000 USDT, %1 risk = 10 USDT; giriş 1,2809, stop 1,2766
  → mesafe %0,34 → nominal 10 / 0,0034 ≈ 2 940 USDT. Kaldıraç yalnız bu nominali hangi marjinle taşıdığını belirler
  (10x → 294 USDT marjin). 100x de olsa stopta 1R kaybedersin; fark likidasyon mesafesi. Stop her zaman likidasyonun
  içinde kalmalı.

## Giriş ve stop
- Limit emir; TP de limit. Mum kapanışı beklenir.
- Stop **son dip/tepenin ötesi** (süpürme fitilinin arkası). Stop **hiç genişletilmez**: "yararı da oldu zararı da,
  zararı daha çok."
- **R:R en az 2–2,5.** Hedef (karşı likidite / karşı FVG) bundan yakınsa işlem yok. "Yoksa almanın anlamı yok."

## Hedef ve kısmi kâr
- Hedef karşı likidite bölgesi ya da karşı FVG. Hedefe gelince biter; uzatma yok.
- **Güvenmiyorsan:** 1R kârda pozisyonun yarısını kapat, stopu girişe çek (başabaş). Kalanı hedefe.
- **Güveniyorsan:** tam hedef. Ama 4R'lik işlemde 2,5–3R **hızlı** geldiyse tamamını kapat: "1R daha almak için risk
  almaya gerek yok."
- Stop girişe: ilk kısmi kârda. Fiyat çok ilerlediyse stopu yapının arkasına taşımak (nadiren) kabul.
- Çok bekleyen işlem: "analizim yanlıştır" diye kapatılır. (Bizim ölçüm: saatle kesmek mekanik olarak işe yaramadı;
  ama tez bozulduysa kapatmak başka şey.)

## Kaç işlem, ne zaman yok
- Aynı anda **en fazla 2** işlem. Mümkünse biri long biri short (doğal hedge): piyasa düşerse short 2R kazanır, long 1R
  kaybeder → net +1R. Hepsi aynı yöndeyse tek BTC hareketi hepsini stoplar.
- **Günlük kayıp sınırı 2–3R, haftalık 5–6R.** Dolunca ekranı kapat. "Yoksa düzeltmek için daha fazla risk alırsın."
- Hafta sonu işlem yok. Londra/NY açılışları (killzone) riskli: ya önce işaretle sonra bekle, ya hiç girme.
- Haber saatleri yok.
- Altcoinde BTC yönünde işlem; BTC sert hareket ederken ters altcoin işlemi yok.

## Küçük hesap tablosu (1 000 USDT, %1 risk)
| Stop mesafesi | Nominal | 10x marjin | 25x marjin |
|---|---|---|---|
| %0,5 | 2 000 | 200 | 80 |
| %1 | 1 000 | 100 | 40 |
| %2 | 500 | 50 | 20 |
| %3 | 333 | 33 | 13 |

Uyarı: 25x ile 2 000 USDT nominal taşımak için 80 USDT marjin yeter ama likidasyon ≈ %3,5–4 uzakta; stop %0,5'te
olduğu için sorun yok. Stop %3'te ve 25x ise likidasyon stoptan önce gelebilir → kaldıracı düşür.
