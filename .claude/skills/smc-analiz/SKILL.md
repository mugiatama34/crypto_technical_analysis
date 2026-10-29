---
name: smc-analiz
description: Ferhat "SMC'ye göre analiz et", "SMC analiz", "kontrol listesine göre bak" ya da bir coin adıyla işlem/kurulum değerlendirmesi istediğinde kullan. Coin kontrol listesini (1G → 4H → 1H likidite → BTC/SMT → senaryo → seans → 15m tetik → risk → kayıt) gerçek veriyle sırayla uygular; "beni test et / soru sor" derse öğrenme modunda önce soruları sorar.
---

# SMC analizi (coin kontrol listesi)

Kaynak liste: `docs/egitim/coin-kontrol-listesi.md` (telefon sayfası: https://claude.ai/artifact/Nr2ZywwscFMkDBwNQ8iVsD).
Her şey eğitim/analiz; emir verilmez. Dil Türkçe, kısa, numaralı. Saatler UTC (TR = UTC+3).

## Mod seçimi
- **Analiz modu** (varsayılan): kullanıcı coin (ve varsa kendi kurulumunun ekran görüntüsünü) verir → aşağıdaki 10 adımı veriyle sen cevaplarsın.
- **Öğrenme modu**: kullanıcı "beni test et", "soru sor", "önce ben cevaplayayım" der ya da kendi 1–5 cevaplarını yazar →
  önce o adımın sorularını sor (bir mesajda en fazla 1–2 adım), cevabı gelince veriyle karşılaştır: ✓ / düzeltme + neden.
- Kullanıcının kendi işlem fikri varsa (giriş/stop/hedef), analizi bitirip o fikri 7–9. adımlara göre puanla.

## 1) Veri
1. `gh api -X POST repos/mugiatama34/crypto_technical_analysis/actions/workflows/pratik.yml/dispatches -f ref=<dal> -f 'inputs[extra]=<COIN>'`
   (BTC/ETH için extra boş bırakılabilir; snapshot BTC/ETH'yi her zaman çeker). Son koşunun id'sini al, `status=completed` olana dek
   bekle (`until ...; do sleep 10; done`), sonra `git pull -q --rebase origin <dal>`.
2. `node bot/practice/smc_levels.mjs <COIN>` → 1G yapı + dealing range, 4H yapı/BOS/OB/FVG, 1H likidite (alındı mı), BTC ve SMT ipucu.
3. Betik yaklaşık ZigZag kullanır (1G k=1, 4H k=2, 1H k=1). Şüpheli bir sonuçta ham mumlara bak
   (`docs/pratik/extra/<COIN>.json` → `tfs['4H'|'1H'|'15m']`) ve elle doğrula; kullanıcının ekran görüntüsüyle çelişiyorsa söyle.
4. Kullanıcı Binance/Bybit grafiği kullanıyorsa birkaç pip fark normal; işlem Bybit'te açılacaksa seviyeleri Bybit'te kontrol ettir.

## 2) Cevap şablonu (adım sırası değişmez)
1. **Günlük · yön:** yapı (HH/HL – LH/LL), günlüğü çeviren seviye (son büyük LH/HL; ötesinde günlük kapanış), dealing range ve 0,5;
   fiyat premium mı discount mı. Fib düzeni: 0 = tepe, 1 = dip.
2. **4H · bölgeler:** 4H yön günlükle aynı mı (değilse geri çekilme), son BOS, **4H'yi bozan 4H seviyesi** (günlük seviyeyle karıştırma),
   swing OB ve açık FVG'ler; hangisi premium (short) / discount (long), hangisi likiditeyle çakışık.
3. **1H likidite:** PDH/PDL, PWH/PWL, Asya (00–07 UTC), EQH/EQL (≈ 0,1–0,2 ATR, ≥ 2 ayrı salınım), weak high/low; alınanlar / bekleyenler;
   en yakın alınmamış havuz üstte/altta (%).
4. **BTC/SMT:** BTC yönü ve kendi range'indeki yeri; aynı referans seviyede (PWL/PDL/PWH/PDH) biri aldı diğeri almadı mı → zayıf olan.
5. **Senaryolar:** A = günlükle aynı yön (%1), B = karşı yön (%0,5), İptal. Kalıp: "Eğer ___ süpürülür (fitil geçer, kapanış içeride) ve
   15m ___ ötesinde kapanırsa ___ FVG'sinden limit giriş, stop ___ (süpürme ucu ± 0,1–0,2 ATR), TP1 ___, TP2 ___; R = ___".
   Süpürme ≠ kırılım (kapanış dışarıda = kırılım). Stop = fikrin yanlış olduğu yer.
6. **Seans:** şu an hangi pencere, bir sonraki ne zaman (Asya 00–07, Londra ≈ 07–10, NY ≈ 12–15 UTC; ABD 1 Kasım–Mart kış saatinde NY +1 saat).
7. **15m tetik:** süpürme → kapanış içeride → MSS (son minör dip/tepe ötesinde kapanış) → FVG/iFVG → limit, doğru yarı; kovalamak yok.
8. **Risk:** %1; karşı yön / hafta sonu / aynı yönlü 2. işlem / ilk işlem → %0,5; en fazla 2 açık işlem.
   Adet = risk $ ÷ (|giriş − stop| + giriş × 0,0011). Bybit: Entire = SL + TP2, Partial = TP1 adedi + "Set SL at entry price after TP is filled".
9. **Girme filtreleri:** hafta sonu, range ortası, **TP1 < 2R**, BTC sert ters, haber saati (≈ 12:30 UTC ABD verisi), 2 açık işlem,
   stop bir EQH/EQL havuzunun içinde (önce havuzun alınmasını bekle).
10. **Kayıt:** sonuç gelince `docs/DURUM.md`'ye tarihli kısa satır (kurulum, seviyeler, R, ders).

Sonunda tek satır **karar**: "Gir / Bekle (şu şartı) / Geç (şu madde)". Alarm önerisi ver (masaüstü: üst çubuk Alarm · telefon: alt araç çubuğu → alarm).

## Kurallar
- CLAUDE.md'deki "Sorgula ve geri bildir": kurulum kurala aykırıysa açıkça söyle (neden, sayı, daha iyi seçenek); karar kullanıcının.
- Tek işlemden kural çıkarma; ölçülmemiş bir kuralı "çalışır" diye sunma. Bot 4H sinyallerinin düzeltilmiş kenarı ≈ 0 (DURUM 29.10):
  Telegram sinyali analiz başlatır, tek başına giriş sebebi değildir.
- TradingView talimatında hem masaüstü (Almanca arayüz) hem telefon yolu.
