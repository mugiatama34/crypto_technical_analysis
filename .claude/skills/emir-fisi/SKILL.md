---
name: emir-fisi
description: Ferhat bir coin için "emir hazırla", "emir oluştur", "emir fişi", "NEAR emir", "şu sinyale gireceğim, miktar ne" dediğinde ya da bot sinyalini gerçek Bybit hesabına ELLE girmek istediğinde yükle. Botun son planını Deney B kurallarıyla (risk $, stop ≥ %1, kaldıraç sınırı) Bybit'e yazılacak hazır sayılara çevirir - giriş, stop, üç kademe adetleri - ve girilen emrin plana uyup uymadığını kontrol etme adımlarını içerir. Emir GÖNDERMEZ.
---

# Emir fişi (plan → Bybit'e elle girilecek sayılar)

**Sınır (değişmez):** gerçek hesapta emir vermek, değiştirmek, iptal etmek yok; kullanıcı açıkça istese de. Gerçek hesap anahtarı istenmez,
saklanmaz. Bu skill yalnız sayı hazırlar ve (istenirse) salt okuma ile kontrol eder. "Girmeli miyim" sorusuna yatırım tavsiyesi verilmez;
sistemin ölçülmüş durumu söylenir (canlı 4H düzeninin kenarı yok, deneme).

## 1. Fişi üret
```
node tools/trades/ticket.mjs <COIN> [--risk <$>] [--dir short|long] [--tf 4H]
```
- Planı uzak daldaki güncel `docs/signals/history.json`'dan okur (bot 15 dakikada bir yazar), Bybit'in herkese açık uç noktasından adım
  büyüklüklerini ve son fiyatı alır. Çarpanlı semboller (1000PEPE vb.) otomatik.
- Varsayılan risk Deney B: **long 1 $, short 0,5 $**. İlk işlem / hafta sonu / ters işlem → `--risk 0.5`. Kullanıcı başka tutar söylerse onu ver.
- Miktar = risk ÷ |giriş − stop|, adıma **aşağı** yuvarlı. Kademeler demo köprüsüyle aynı işlevden (`legsOf`): T1 erken hedef %50,
  T2 TP1 %25, T3 TP2 kalan.

## 2. Kullanıcıya ver
Çıktıyı kısaltmadan, üç başlıkla aktar (alan adları uygulamadaki gibi İngilizce kalır):
- **A) Giriş:** Trade → Futures → sembol, Limit; Price, Qty, TP/SL kutusu işaretli (Take Profit = son kademe, Stop Loss), Reduce-Only
  işaretsiz, düğme (Short / Long).
- **B) Dolduktan sonra:** her kademe ayrı Limit emir; TP/SL işaretsiz, **Reduce-Only işaretli**, düğme pozisyonun tersi.
  Pozisyon açılmadan girilemez (Bybit reddeder: "current position is zero", 110017; demo hesapta doğrulandı 18.11.2026).
- **C) Stop taşıma:** pozisyon kartı → Set TP/SL → Entire Position; T1 dolunca giriş, T2 dolunca erken hedef.
- Kaldıraç sınırı ve **izole** marjin satırını, sonra **UYARI** satırlarının hepsini yaz.

## 3. Uyarıları yorumla (fişi vermeden önce)
| Uyarı | Söylenecek |
|---|---|
| plan kapanmış / artık beklemiyor | Fiş geçersiz; sistem bu işleme çoktan girdi ya da çıktı. Aynı seviyeden yeni giriş plan dışıdır. |
| son fiyat girişi geçmiş | Limit emir hemen piyasa fiyatından dolar; plan fiyatından giriş değildir. |
| son fiyat ilk hedefi geçmiş | Plan kaçmış olabilir; girme. |
| stop < %1 | Deney B kuralı: girme (17.11 ara bakışta üç örneğin üçü de kaybetti). |
| kademe değeri < en az | Bybit reddederse o kademeyi sonrakiyle birleştir. |
| "miktar … < en az emir" | En küçük emirle riskin kaç $ olduğunu söyle; kural dışıysa işlem yok. |

Açık pozisyonu olan coinde yeni giriş aynı pozisyona eklenir (ortalama giriş değişir, emre bağlı stop tüm pozisyona uygulanır): sor.

## 4. Kontrol (kullanıcı emri girdikten sonra, isterse)
Chrome'da kullanıcının oturumuyla Bybit'i **salt okuma** aç (tıklama yalnız sekme / liste; emir ya da ayar düğmesine dokunma) ya da
kullanıcının ekran görüntüsünden karşılaştır: sembol, yön, Price, Qty, Stop Loss, Reduce-Only, izole / kaldıraç. Farkı tablo olarak yaz.
Kademe dolduktan sonra SL ve varsa trailing stop yerinde mi (Bybit kısmi TP sonrası kaybedebiliyor; bkz. `tradingview-bybit`).

## 5. Kayıt
Girilen işlem Deney B tablosuna "bot" etiketiyle girer; plan dışı giriş (farklı fiyat, eksik stop) varsa notla. Yeni doğrulanan Bybit
ekran bilgisi `tradingview-bybit` skill'ine işlenir.
