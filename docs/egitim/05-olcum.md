# 05 — Ölçüm: kural olarak ne kadar işe yarıyor, kendi günlüğün

## Backtest ne dedi (24 ay, 1H/4H, hacme göre ilk 50 coin, komisyon ve kayma dahil)

Arkadaşının kuralını **mekanik** olarak kodladık (`backtest/lab/smc.js`): likidite süpürmesi (swing, eşit, PDH/PDL)
→ 12/6 mum içinde kapanışla MSS → bacakta FVG → %50'sine limit → stop fitil ötesi → hedef karşı likidite ≥ 2R.

| Varyant | Eğitim ort. R | Doğrulama ort. R | Kazanma | BTC hedge'li doğr. R |
|---|---|---|---|---|
| Temel (üst dilime ters işlemde 0,5R) | −0,07 | −0,10 | %25 | −0,16 |
| Yalnız üst dilim yönünde | −0,12 | −0,04 | %26 | −0,01 |
| Yalnız BTC rejimi yönünde | −0,04 | −0,09 | %25 | −0,16 |
| 1R'de yarı kapat + başabaş | +0,02 | +0,02 | %61 | −0,06 |

Fib kesişimi ailesi: −0,02 … −0,15R. Önceki tüm fiyat-yapı aileleri de (süpürme+geri alma, Donchian, Elliott zigzag/
flat/diyagonal) benzer.

**Okuma:** kazanç olduğunda BTC'nin yönünden geliyor (korelasyon 0,5); BTC yatayken her varyant −0,5R. Kurulum sık
dolar (%60) ama işlemlerin dörtte üçü stop. Yani "süpürme + MSS + FVG" **tek başına** bir kenar değil.

## Neden arkadaşın yine de kazanıyor olabilir
- **Seçicilik:** hangi süpürmeyi aldığı, hangisini pas geçtiği. Bunu ölçemedik; sorduk, cevap bekliyoruz
  ("pas geçtiğin 3–5 kurulum").
- **Bağlam:** HTF FVG/OB ile çakışma, USDT.D, RSI uyumsuzluğu, seans zamanlaması. Bunlar kodda yok ya da kaba.
- **Yönetim:** 2,5–3R hızlı gelince kapatmak, güvensizde 1R yarı. Kısmen test ettik; tek başına yetmedi.
- **Hayatta kalma kuralları:** günlük 2–3R limit, en fazla 2 işlem. Bunlar getiriyi değil, hesabın ömrünü belirler.
- Ve dürüst ihtimal: örnekler akılda kalanlar. Kendisi "disiplinli bir ay bile olmadı" dedi.

## Senin ölçümün: işlem günlüğü
Her işaretlemeyi (aldın ya da almadın) yaz. 30 satır dolmadan sonuç çıkarma.

| Tarih-saat | Coin / TF | Yön | Süpürülen seviye | MSS var mı | FVG %50 | Stop | Hedef | R:R | Aldın mı / neden | Sonuç R | BTC o sırada |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-24 14:00 | XRP 15m | long | eşit dipler + 4H OB | evet (istekli) | 1,2809 | 1,2766 | 1,2957 | 3,4 | evet — RL+OTE çakışması | +2,9 | yatay |
| | | | | | | | | | hayır — RSI uyumsuz | (ne oldu) | |

Kurallar:
- **Pas geçtiklerini de yaz** ve sonra ne olduğunu doldur. Arkadaşının ölçülemeyen kısmı tam burası; senin öğreneceğin
  de bu.
- Sonuç R'yi gerçek çıkıştan yaz; "aslında hedefe gitti" yazma.
- 30 satır sonra: kazanma oranı, ortalama R, toplam R, "aldım" ile "pas geçtim ama hedefe gitti" oranı.
- BTC sütunu: işlem sırasında BTC ±%1'den fazla mı gitti? 30 satır sonra "BTC yatayken" grubunu ayrı topla; yöntem
  orada da kazanıyorsa gerçek seçicilik var.

## Hangi sayı iyi?
- Bu tür kurulumlarda %35–45 kazanma ve ortalama +0,3R ve üstü iyi (R:R 3 ile). Kazanma %60 + ortalama 0 kötü (küçük
  kazanç sık, büyük kayıp).
- 30 işlemde +3R toplam şans olabilir; 100 işlemde +10R ciddi.
- Bizim sinyal botu referansı: 4H düzeni doğrulamada +0,08R, kazanma %79 (erken kâr yönetimi yüzünden yüksek).
