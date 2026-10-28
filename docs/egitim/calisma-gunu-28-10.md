# Çalışma günü planı · 28 Ekim 2026 (3,5–4 saat, masaüstü)

Saatler UTC (TR = UTC+3). Canlı blok (5–6) için en iyi pencere NY açılışı: 13:00–15:00 UTC (16:00–18:00 TR).
İşlem yok; her şey işaretleme ve yazılı karar. Gerçek emir kuralı değişmez (%1 / ters işlem %0,5).

| # | Süre | Blok | Çıktı |
|---|---|---|---|
| 0 | 10 dk | Hazırlık: TradingView masaüstü, OKX:BTCUSDT.P + OKX:ETHUSDT.P, UTC, lineer; `pratik.html` ve `egitim.html` açık; defter | Temiz çalışma alanı |
| 1 | 40 dk | **Adım 3 bitir**: BTC/ETH 4H FVG + OB çiz, cevap anahtarıyla karşılaştır. Canlı kontrol: BTC 28 Eki 03:00 UTC'de 81 008'i süpürüp 81 199'a çıktı → premium bölgede (FVG 81 176–81 222, OB 81 510–81 887) ne yaptı? | Çizim + 3 cümle |
| 2 | 30 dk | **Eğitim**: SMC modülü "süpürme → MSS → FVG girişi" + Elliott düzeltme bölümü tekrar. Her bölümden 1 örneği kendi grafiğinde bul | 2 örnek ekran görüntüsü |
| 3 | 60 dk | **Bar Replay** (masaüstü üst çubuk → Tekrar oynat): BTC 15m, 20–24 Ekim'den 5 gün. Her gün: Asya kutusu + PDH/PDL çiz → Londra/NY'yi mum mum oynat → her kararı oynatmadan önce yaz (süpürme? MSS? FVG? giriş/stop/hedef) | 5–10 sanal işlem tablosu (R ile) |
| – | 15 dk | Mola | |
| 4 | 30 dk | **Adım 4 · Senaryo cümlesi** (bugün için BTC ve ETH): "Eğer ___ süpürülür ve 15m'de ___ altında/üstünde kapanış (MSS) gelirse ___ FVG'sinden giriş, stop ___, hedef ___; olmazsa ___." Alarmları kur | 2 senaryo + alarmlar |
| 5 | 45 dk | **Adım 5 · Canlı izleme** (NY açılışı): alarm çalınca 15m'de kapanışı bekle, senaryoyu doğrula ya da çürüt. Kâğıt üstünde işlem yaz | Canlı karar kaydı |
| 6 | 20 dk | **Adım 6 · Günlük**: gerçek işlemler (ARB 0R, SUI long +2,3R, DOGE −1,1R, SUI short ≈ −1R, HUMA) + replay işlemleri. Her biri: kurulum, giriş anında fiyat sinyalden ne kadar uzaktı, kurala uydum mu, ders | Günlük tablosu |
| 7 | 15 dk | **Lab sonucu**: uyumsuzluk testi (div_*) bittiyse birlikte oku | Karar: yoruma ağırlık mı, "bakılacak işaret" mi |

Replay işlem tablosu sütunları: tarih · seans · süpürülen seviye · MSS seviyesi · giriş · stop · TP1/TP2 · sonuç R · not.
Kural: oynatmadan ÖNCE yaz; geri sarıp düzeltme yok.
