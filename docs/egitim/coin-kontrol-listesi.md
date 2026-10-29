# Coin kontrol listesi (şablon) · ~15 dakika

Saatler UTC; Türkiye = UTC+3 (yaz saati yok). ABD 1 Kasım'da kış saatine geçer: NY saatleri o tarihten sonra +1 saat kayar.
Ön koşul: borsa sembolü doğru (işlem Bybit'teyse Bybit), saat dilimi UTC, lineer ölçek; indikatörler yalnız ilgili dilimde görünür.

## 1 · Günlük (1D) · 2 dk · YÖN
- [ ] Yapı: HH/HL mi, LH/LL mi? Son büyük LH (düşüşte) / HL (yükselişte) hangi fiyat? → **bu seviyenin ötesinde günlük kapanış = MSS**
- [ ] Büyük range ve 0,5: fiyat premium mı (> 0,5), discount mı?
- Soru: *Günlük yön ne, onu ne bozar?* → tek cümle yaz.

## 2 · 4 saat (4H) · 3 dk · BÖLGELER
- [ ] 4H yapı günlükle aynı yönde mi? Değilse 4H hareketi = günlüğe karşı geri çekilme.
- [ ] Son iç BOS/CHoCH nerede? 4H yapıyı bozan seviye (son HL/LH)?
- [ ] Bölgeler: swing OB, açık FVG. Hangisi premium'da (short), hangisi discount'ta (long)?
- Soru: *Fiyat hangi bölgeye gidiyor, o bölge bir likiditeyle çakışıyor mu?*

## 3 · 1 saat (1H) · 3 dk · LİKİDİTE HARİTASI
- [ ] PDH / PDL, PWH / PWL, bugünün Asya tepe/dibi (00:00–07:00 UTC)
- [ ] EQH / EQL (fitil farkı ≤ ~0,1–0,2 ATR, en az 2 ayrı salınım), weak high / weak low
- [ ] Hangileri **alındı** (sil/düz çizgi), hangileri bekliyor?
- Soru: *Üstte ve altta en yakın alınmamış havuz hangisi, fiyata ne kadar uzak?*

## 4 · BTC kontrolü · 1 dk (altcoin ise)
- [ ] BTC aynı yönde mi? BTC kendi premium/discount'unda nerede?
- [ ] SMT: biri yeni tepe/dip yapıp diğeri yapamıyor mu? (zayıf olan önce döner)

## 5 · Senaryo cümleleri · 2 dk (Adım 4)
- **A (günlükle aynı yön):** "Eğer ___ süpürülür ve 15m ___ altında/üstünde kapanırsa ___ FVG'sinden giriş, stop ___, TP1 ___, TP2 ___."
- **B (karşı yön, %0,5):** aynı kalıp.
- **İptal:** "___ olursa ikisi de geçersiz."
- [ ] Alarmlar: süpürülecek seviye + MSS seviyesi (masaüstü: üst çubuk Alarm · telefon: alt araç çubuğu → alarm)

## 6 · Seans saatleri (izleme pencereleri)
| Seans | UTC | TR | Ne beklenir |
|---|---|---|---|
| Asya | 00:00–07:00 | 03:00–10:00 | Range oluşur; işlem yok, kutuyu çiz |
| Londra killzone | ≈ 07:00–10:00 | 10:00–13:00 | Asya tepesi/dibi süpürülür → ters yöne MSS |
| NY killzone | ≈ 12:00–15:00 (1 Kas sonrası 13:00–16:00) | 15:00–18:00 (sonra 16:00–19:00) | Borsa açılışı 13:30 (sonra 14:30) UTC; Londra'nın tersi ya da devamı |

## 7 · Tetik (15m) · alarm çalınca
1. [ ] Süpürme: fitil seviyeyi geçti, **kapanış geri içeride** (fitil tek başına sinyal değil)
2. [ ] MSS: son minör dip/tepenin ötesinde **15m kapanış**
3. [ ] FVG / iFVG: kırılım bacağındaki boşluk (üç mumu kaydır; 3. mum fitili 1. mumunkine değmiyor)
4. [ ] Giriş: limit, bölgenin premium (short) / discount (long) yarısında; **kovalamak yok**
5. [ ] Stop: süpürme ucunun ötesi (+ küçük pay). TP1: en yakın karşı likidite. **TP1 ≥ 2R değilse geç.**

## 8 · Risk ve emir
- [ ] Risk %1; karşı yön / hafta sonu / aynı yönlü ikinci işlem / ilk işlem → **%0,5**. Aynı anda en fazla 2 açık işlem.
- [ ] Adet = risk $ ÷ (stop mesafesi + giriş fiyatının ~%0,11'i (komisyon payı))
- [ ] Bybit: Entire Position = SL + TP2 · Partial Position = TP1 adedi + "Set SL at entry price after TP is filled"
- [ ] 24 saatte dolmazsa ya da fiyat TP1'e dolmadan giderse emri iptal et

## 9 · Girme (filtreler)
- Hafta sonu · fiyat range'in ortasında · TP1 < 2R · BTC sert ters yönde · büyük haber saati (ABD verisi 12:30 UTC civarı) · zaten 2 açık işlem

## 10 · Sonra · günlük kaydı (Adım 6)
- Kurulum ne? Süpürülen seviye, MSS seviyesi, giriş/stop/hedef, sonuç R.
- Girdiğim anda fiyat sinyalden/bölgeden ne kadar uzaktı?
- Kurala uydum mu? Uymadıysam hangi madde?
- Tek cümle ders.
