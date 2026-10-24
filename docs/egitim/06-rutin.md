# 06 — Rutin: günlük 20 dakika, haftalık 1 saat

Amaç işlem açmak değil, **işaretleme alışkanlığı**. İlk iki hafta işlem yok; yalnız işaretle ve günlüğe yaz.

## Günlük (sabah, Asya kapanışına yakın: 09–10 TR)
1. **BTC günlük + 4H (3 dk):** yön (son dip-tepe yapısı), fiyat premium mu discount mu (son büyük range'in 0,5'i).
   Bizim tarayıcı başlığında BTC okuması ve `signals.html`'de rejim var.
2. **USDT.D yerine (1 dk):** BTC 4H eğilimi (tarayıcı "BTC: günlük … · 4H …" satırı). Altcoin işlemi bu yönde.
3. **İzleme listesi 5–8 coin, 4H (8 dk):** her birinde işaretle: eşit tepe/dip, PDH/PDL, son swing tepe/dip, açık
   FVG/OB. Tarayıcıda **ICT / SMC** preseti ile FVG/OB/likidite otomatik gelir; **Fib kesişimi** preseti 0,618×1,272
   bölgelerini gösterir. Kendin çiz; otomatik çizim öğretmez.
4. **Bekleyen senaryo (3 dk):** her coin için bir cümle: "X seviyesi süpürülürse ve 15m'de MSS gelirse, FVG %50'den
   long; hedef Y; R:R ≥ 2 mi?" Yazmadıysan senaryo yok demektir.
5. **Günlük (5 dk):** dünkü senaryolar ne oldu? Günlüğe yaz (05-olcum.md tablosu).

## Gün içi (yalnız alarm)
- Süpürme alarmı: TradingView'da seviyeye alarm. Alarm gelince **bakma, bekle**: 15m'de kapanışla MSS ve FVG lazım.
- MSS geldiyse: FVG %50'ye limit, stop fitil ötesi, hedef karşı likidite; R:R < 2 → emir yok.
- Londra ve NY açılışında (10:00 ve 15:30 TR) yeni emir girme; mevcut emirler kalır.

## Haftalık (Pazar, 1 saat)
- Günlüğü aç: kaç senaryo yazdın, kaçı gerçekleşti, kaçını aldın, R toplamı.
- "Pas geçtim ama hedefe gitti" satırlarına bak: neden pas geçtin? Kural mı sezgi mi?
- "Aldım ve stop" satırlarına bak: kontrol listesinde hangi madde eksikti?
- Bir cümle ders yaz. Sonraki hafta yalnız o dersi uygula.
- Denetçi raporunu (Telegram / `agent.html` → Denetçi) ve araştırmacı raporunu oku; sistemin ne bulduğuyla kendi
  gözlemin çelişiyor mu?

## Tarayıcı ve bot nasıl destekler
- **ICT / SMC preseti:** FVG, OB, likidite, yapı; sinyaller aynı bölgeye yığıldığında puan yükselir.
- **Fib kesişimi preseti:** 0,618 × 1,272 bölgesi + giriş/stop/hedef çizgileri.
- **4H sinyal botu:** süzgeçten geçen 4H kurulumlarını Telegram'a gönderir (yalnız limit, hafta sonu yok, günlük trend
  yönünde, erken %80 kâr). Senin işaretlemenle çakışan sinyal, en güçlü aday.
- **Sinyal sayfası:** ileriye dönük gerçek sonuç; kendi günlüğünle karşılaştır.

## Üç kural, duvara as
1. Süpürme gördün → **bekle**. MSS yoksa işlem yok.
2. R:R < 2 → işlem yok. Günlük −2R → ekran kapalı.
3. Pas geçtiğini de yaz. Ölçmediğin şeyi öğrenemezsin.
