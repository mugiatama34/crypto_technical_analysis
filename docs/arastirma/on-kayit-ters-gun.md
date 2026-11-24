# Ön kayıt: ters gün yığılması, eşzamanlı pozisyon sınırı, Pazartesi (24.11.2026; kullanıcı isteği 24.11.2026, koşudan önce yazıldı)

**Bağlam:** 23.11.2026'da canlı 4H kâğıt kaydında aynı gün dolan 20 short tek 4H mumunda kapandı (−16,3R). Kullanıcı soruları: (1) geriye dönük testte kayıplar
çoğunlukla böyle sert dönüş günlerinden mi geliyor, (2) önlem (aynı yönde açık pozisyon sınırı) ne değiştirirdi, (3) Pazartesi dolan işlemler kötü mü.
Fikri üreten olay (23.11.2026, Pazartesi) veri aralığının dışında: plan seti 27.11.2025 – 22.11.2026 (koşu 45029913090).

**Veri / kurulum:** `sweep.mjs` "canlıya eşit" 3 kademeli satır (`LIVE_NAME_A`; 4H, gerçekçi sıra `fillBarTp: 'lower'`, maliyet dahil, hafta sonu hariç), işlem dökümü
`docs/backtest/live-trades.json`. Eğitim / doğrulama = taramanın bölünmesi. Gün = dolum anının UTC günü (`entryTimeOf`); kapanış günü = dolum + tutulan mum.

**S1 — tanı (ölçüt yok, yalnız sayım):** kapanış gününe göre günlük R toplamı; (a) en kötü %5 günün toplam brüt kayıptaki payı, (b) "ters gün" = aynı UTC gününde
aynı yönde ≥ 5 stop; kaç gün, toplam R'deki payı, (c) ters günler çıkarılınca ort. R (yalnız büyüklük göstergesi; kural değil, geleceği bilmeyi gerektirir).

**S2 — sınır (bilgi satırları; aralarından seçim yapılmaz):** aynı yönde ≤ 3 / 5 / 10 açık (`capTrades`): n, ort. R, toplam R, maks. düşüş, en kötü gün, en kötü 7 gün.
"Bedelsiz koruma" ölçütü (önceden): iki dilimde de ort. R tabandan en çok 0,02R düşük **ve** en kötü 7 gün tabandan küçük. Sınır kenar testi değildir (13.11 bulgusu: seçim değeri yok).

**S3 — Pazartesi (tek birincil test):** Pazartesi (UTC) dolan işlemler ↔ Salı–Cuma dolanlar, ort. R farkı (diğer − Pazartesi). **Geçer** = fark iki dilimde > 0 ve tüm dönemde
güne göre bloklu bootstrap %95 aralığının alt ucu > 0 ve Pazartesi n ≥ 100 (dilim başına). Pazartesi n < 100 → **sonuçsuz**. Bilgi: hafta günü tablosu (seçim yapılmaz).
Önceki bulgu: gün filtreleri etkisiz (eski motor). Geçse bile canlı kural değil, aday.

**Sınırlar:** tek 12 aylık dönem; taban satır zaten eksi (kenar yok); makro olay takvimi yok (yalnız hafta günü); günler kümeli → bağımsız örnek n'den küçük.
