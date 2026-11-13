# İlerleme planı (13.11.2026) — sinyal sayfası + ajanların yeniden başlatılması

Kaynak: kullanıcının 13.11 isteği. Her adım bitince [x] işaretlenir; yeni sohbette buradan devam edilir.

## 0. Durum
- [x] `AGENT_SOURCE=signals` Variables'ta açıldı (kullanıcı, 13.11). Ajanlar Telegram'ın 4H canlı kurallarından geçen
  long + short planları + ölçülmüş Donchian adaylarını görür. BTC rejim kısıtı yalnız Donchian'da; sinyallerde yok →
  BTC düşüşteyken de short adaylar gelir.
- [ ] İlk turun Actions logunda "Ajan adayları (canlı sinyal kuralları + ölçülmüş)" satırını doğrula.

## 1. Sinyal sayfası: kural kitabı (`signals.html`)
- [x] Katlanır "📖 Kural kitabı" bölümü (13.11; etkin kural metni review.json `metrics.rules.label`'dan canlı): sinyalin nasıl doğduğu (tarama → kümeleme → puan), canlı filtreler (4H, puan eşiği,
  MTF, hafta sonu yok, yalnız limit, düşen bıçak, üst TF yönü), plan (giriş bölgesi, stop, TP1/TP2, erken %1,2'de %80,
  başa baş), 24 saat limit, R hesabı, kaldıraç tavanı, Bybit çarpanlı semboller, ölçüm durumu (beklenti, canlı sonuç).
- [x] Kaynak: `bot/run.mjs` CFG + `bot/plan.js` PLAN_DEFAULTS + CLAUDE.md "Canlı ayar". Mümkünse history.json'daki `cfg`
  etiketinden canlı düzeni otomatik göster.

## 2. Sinyal sayfası: analiz yöntemi performansı
- [x] history.json `signals` (yapı adları: Bearish engulfing, EQL kırıldı, Fib çakışması, Donchian, MACD, ADX…) →
  yöntem ailesine eşle (src/scan/registry.js grupları: SMC/likidite, fib, mum formasyonu, trend, momentum…).
- [x] Tablo: aile × n (13.11; `familyOf`/`familyStats`, kırılım BTC günlük / long-short / son 3 ay; yapı düzeyi tablo yapılmadı), kazanma, ort. R; kırılım: BTC günlük yönü (btcRead.daily), yön (long/short), ay.
  Varsayılan canlı düzen (26.10'dan beri). Uyarı: n < 30 sonuçsuz; çok yapı arasından seçim = iyimserlik.
- [ ] İsteğe bağlı: aynı kırılım 12 ay plan verisi (sweep) üzerinden — `plan.signals` gruplarına göre (ayrı iş).

## 3. Ajanları (SIRADAKİ — yeni sohbette başla) yeni sistemle sıfırlama + karşılaştırma
- [ ] `AGENT_RESET=<etiket>` (ör. 2026-11-13): etiket durumdakinden farklıysa yayınlanan hesaplar
  `docs/agent/archive/<etiket>/` altına arşivlenir, özsermaye 300 $'a, işlemler/pozisyonlar sıfırlanır; **dersler (lessons)
  ve parametreler korunur** (öğrenme sürsün). Varsayılan kapalı; kullanıcı Variables'tan açar.
- [ ] Her ajan işlemine kaynak sinyal kimliği (signal id / key) yaz → sinyal sayfasında "Ajan vs sinyal" karşılaştırması:
  aynı sinyallerde ajanın R'si ile botun planının R'si; ajanın atladığı sinyallerin R'si (seçim değeri).
- [ ] Karar ölçütü (kullanıcıyla): ~30 ajan işleminden sonra ajan ort. R > sinyal ort. R değilse ajanlar kapatılır ya da
  yönetim kuralları tartışılır.

## Notlar
- Bağlam sınırı: bu dosya yeni sohbetin başlangıç noktası. "Devam edelim" → DURUM.md + bu dosya.

## İlk gözlem (13.11, canlı 26.10'dan beri, kapanan ~70)
Aileler BTC günlük ↓ iken artıda (FVG +0,27, OB/Breaker +0,30, Fib +0,16), BTC günlük ↑ iken çoğu eksi (−0,13…−0,28);
klasik formasyon her iki durumda eksi (n 10). Aileler aynı sinyallerde birlikte geçtiği için bağımsız değil; n < 30 hücreler
sonuçsuz. Bu, ileride 12 ay plan verisinde (sweep, `plan.signals` grupları) ölçülmeli.
