# Price action / SMC eğitimi

Bu klasör, arkadaşının (SMC / ICT ekolü) yöntemini öğrenmek için hazırlandı. Kaynaklar: arkadaşının gönderdiği
grafikler ve soru listesine verdiği cevaplar (Ekim 2026), ICT/SMC'nin yerleşik kavramları ve bizim backtest
ölçümlerimiz. Her bölüm kısa; önce oku, sonra grafikte kendin işaretle. Teori değil, işaretleme alışkanlığı kazandırır.

**Görsel sürüm:** [`egitim.html`](../../egitim.html) — aynı modüller sekmeler halinde, her kavram çizimli grafikle,
kurulum adım adım oynatılır, hesaplayıcılar ve 9 soruluk alıştırma. (`img/` klasöründeki resimler hiç eklenmedi;
grafikler sayfada SVG olarak çizilir, mumlar temsilîdir.)

| Bölüm | Ne öğretir | Süre |
|---|---|---|
| [01 — Temeller](01-temeller.md) | Likidite, süpürme, yapı (BOS/MSS), FVG, order block, premium/discount, OTE, üst dilim | 1–2 saat |
| [02 — Kurulum](02-kurulum.md) | Süpürme → MSS → FVG %50 → karşı likidite; XRP örneği adım adım; kontrol listesi | 1 saat |
| [03 — Risk ve yönetim](03-risk-yonetim.md) | %1 risk, ≥ 2R, stop/hedef, kısmi kâr, günlük limit, ne zaman işlem yok | 30 dk |
| [04 — Örnekler](04-ornekler.md) | BTC long→short dizisi, XRP, AAVE/COMP/ARB fib kesişimi; her biri adımlarıyla | 1 saat |
| [05 — Ölçüm](05-olcum.md) | Kuralın mekanik halinin backtest sonucu; neden; kendi işlem günlüğü şablonu | 30 dk |
| [06 — Rutin](06-rutin.md) | Günlük 20 dakikalık işaretleme rutini, haftalık gözden geçirme, tarayıcı desteği | 15 dk |

## Nasıl çalışılır
1. 01 ve 02'yi oku. Sonra TradingView'da bir coinin 4H ve 15m grafiğini aç; 06'daki rutini **işlem açmadan** iki hafta
   uygula: yalnız işaretle ve ne olduğunu kaydet.
2. 05'teki günlüğe pas geçtiğin kurulumları da yaz. Arkadaşının yönteminde ölçemediğimiz tek şey "hangi kurulumu
   aldığı, hangisini pas geçtiği"; senin öğrenmen gereken de bu.
3. 30 işaretleme (gerçek ya da kâğıt) birikince sonuçları tabloya dök. Kazanma oranı ve ortalama R'yi, `signals.html`
   gibi, dürüstçe hesapla.

## Dürüst not
Bu yöntemin **kural olarak** 24 aylık backtesti kâr göstermedi (bkz. 05). Yani yöntem bir "sinyal" değil, bir
**okuma dili**. Para, hangi kurulumu almayıp hangisini aldığında ve risk disiplininde. Arkadaşın da kendi cevabında
"kurallara disiplinli uyduğum bir ay bile olmadı" dedi; önce disiplin, sonra kurulum.
