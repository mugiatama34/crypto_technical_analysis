# Kaynak özeti — fonlama geliri ve "kendini gerçekleştiren" seviyeler (14.11.2026)

Alt ajan (Sonnet) web araması; **tam metinler açılamadı, bulgular arama özetlerinden** — sayıları kullanmadan önce kaynağından teyit et.

## A) Fonlama geliri (spot al + sürekli vadeli sat)
- **Mekanizma:** Bybit fonlama = prim endeksi + clamp(faiz − prim, ±sınır); faiz günde %0,03 = 8 saatte %0,01; sınır sözleşmeye göre.
  OKX benzer (iç clamp ±%0,05, N saatlik döngüde 8 / N'e bölünür). Oran artıysa long short'a öder.
  [Bybit yardım](https://bybit.nl/en/help-center/article/What-is-funding-rate-and-predicted-rate) ·
  [OKX yardım](https://www.okx.com/en-us/help/perps-funding-fee-mechanism)
- **Geçmiş getiri:** BIS WP 1087 "Crypto carry" (Schmeling, Schrimpf, Todorov; 2023, 2025 revize): vadeli − spot farkı yıllık ortalama
  %10'un üstünde, zaman zaman ~%60; yüksek taşıma sonraki fiyat çöküşlerini öngörüyor; neden: kaldıraç talebi + sınırlı arbitraj sermayesi.
  [BIS](https://www.bis.org/publ/work1087.pdf) · Galaxy (Eylül 2025): BTC fonlaması yıllık %6–10.
  [Galaxy](https://www.galaxy.com/insights/perspectives/rate-cut-momentum-fuels-crypto-gains-before-volatility-returns) · Amberdata (2025,
  satıcı yorumu): taşıma 2025'te yılın yalnız ~%8'inde cazipti.
  [Amberdata](https://blog.amberdata.io/the-carry-trade-that-broke-how-basis-compression-triggered-the-cascade)
- **Riskler:** oranın eksiye dönmesi; Ekim 2025 çöküşünde baz sıfıra sıkıştı, "hedge'li" pozisyonlar zarar etti, zorunlu kapanış / otomatik
  pozisyon azaltma (ADL) etkisi; bazı nötr fonlar düşük–orta tek haneli düşüş yaşadı.
  [FTI](https://www.fticonsulting.com/insights/articles/crypto-crash-october-2025-leverage-met-liquidity) ·
  [Presto](https://www.prestolabs.io/research/crypto-investor-survey-october-2025)
- **Bybit'te pratik:** Unified Trading Account'ta spot varlık teminat sayılabilir (coin'e göre teminat oranı; ne kadarını karşıladığı
  doğrulanamadı). "Arbitrage Trading" aracı (yalnız uygulama, UTA Cross Margin): iki bacağı aynı miktarda birlikte gönderir, pozisyonu
  YÖNETMEZ / kapatmaz. [Bybit](https://www.bybit.com/en/help-center/article/Arbitrage-Trading) · Otomatik bot ürünü bulunamadı.
  Standart komisyon: spot %0,1 / %0,1; USDT sürekli vadeli yapıcı %0,02 / alıcı %0,055 (hesapta "My Fee Rate"ten teyit).
  [Bybit ücretler](https://bybit.nl/en/help-center/article/Bybit-Fees-You-Need-to-Know)

## B) Seviyeler ve "kendini gerçekleştiren kehanet"
- **Yuvarlak sayılar (belgelenmiş):** Osler (2003, Journal of Finance; ~9.700 stop ve kâr-al emri, 1999–2000): kâr-al emirleri yuvarlak sayıda,
  stop emirleri yuvarlak sayının HEMEN ÖTESİNDE kümeleniyor → seviyede dönüş, kırılınca ivmelenme.
  [NY Fed SR125](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr125.pdf) · Osler (2000): yayımlanan destek / direnç
  seviyeleri gün içi trend kesilmelerini rastgele seviyelerden iyi öngörüyor; firmalar birbirine pek katılmıyor.
  [FRBNY EPR](https://www.newyorkfed.org/research/epr/00v06n2/0007osle.html)
- **Fibonacci (bulunamadı):** Batchelor & Ramyar (2006, DJIA 1914–2002): fib oranlarında kümelenme yok (ikincil özetten).
  [City Univ.](https://openaccess.city.ac.uk/16276/) · Kripto / döviz için hakemli test bulunamadı.
- **Kripto yuvarlak sayılar:** Bitcoin'de yuvarlak sayıda kümelenme ve psikolojik bariyer bulguları var; Urquhart (2017): yuvarlak sayıdan
  sonra anlamlı getiri deseni yok → kümelenme var, yön öngörüsü zayıf. Stop avını doğrudan sınayan hakemli çalışma bulunamadı.
- **Elliott:** bağımsız hakemli sınama bulunamadı; hakemsiz bir inceleme (CXO Advisory, 2006–2008) çağrıların gelecek getiriyle ilişkisiz
  olduğunu buldu.

## Doğrulanamayanlar
Güncel Bybit clamp değerleri ve komisyonları; spot teminatın short teminatını ne kadar karşıladığı; BIS makalesinin Sharpe ve 2022 rakamları;
Batchelor & Ramyar sonuç metni (ikincil özet).
