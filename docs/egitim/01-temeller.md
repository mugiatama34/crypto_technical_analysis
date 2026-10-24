# 01 — Temeller: SMC / ICT sözlüğü

Her kavram üç parça: tanım, grafikte nasıl görünür, bizim tarayıcıdaki karşılığı.

## 1. Likidite
**Tanım.** Stop emirlerinin biriktiği fiyatlar. Alıcıların stopları diplerin altında, satıcıların stopları tepelerin
üstünde durur. Büyük oyuncu pozisyon açmak için bu emirlere ihtiyaç duyar; bu yüzden "fiyat likiditeye akar".
**Nerede birikir.**
- **Eşit tepeler / eşit dipler** (equal highs/lows): iki-üç kez aynı yere gelen tepe ya da dip. En net tuzak.
- **Eski tepe / eski dip** (swing high/low): belirgin dönüş noktaları.
- **Önceki günün tepesi/dibi (PDH/PDL)**, **önceki haftanın (PWH/PWL)**, **seans tepesi/dibi** (Asya, Londra, NY).
- Trend çizgisi altı/üstü: herkesin stopunu koyduğu yer.
**Grafikte.** Arkadaşının grafiklerindeki "Liquidity" çizgisi (BTC 84.358) ve "Asia" işaretleri; XRP grafiğinde
turuncu daireler (iki eşit tepe) ve "1. likidite bölgesi".
**Bizde.** `liquidity` detektörü (eşit tepe/dip, süpürme), `misc` içinde PD/PW seviyeleri; lab `smc.js`
`liquidityLevels` (pivot, eşit, PDH/PDL).

## 2. Süpürme (sweep) ile kırılım (break) farkı
- **Süpürme:** fiyat seviyeyi **fitille** geçer, mum seviyenin bu tarafında kapanır. Stoplar alınmış, fiyat geri
  dönmüştür. Tuzak.
- **Kırılım (BOS):** mum seviyenin ötesinde **gövdeyle** kapanır ve orada kalır. Yapı değişmiştir.
- Arkadaşı: "süpürme fark etmez, fitil de olur kapanış da; önemli olan sonrasında ters yöne MSS gelmesi." Pratikte
  kapanışla geçip hemen geri dönen mumlar da süpürme sayılır; ayırt edici şey **ne olduğu değil, sonrasında ne olduğu**.
**Bizde.** Lab `smc.js`: süpürme = fitil geçer, kapanış seviyenin bu tarafında (0,1 ATR pay).

## 3. Yapı: swing, BOS, MSS/CHoCH
- **Swing tepe/dip:** iki yanındaki mumlardan yüksek/alçak mumlar. Büyük dilimde büyük swing, küçük dilimde küçük.
- **BOS (break of structure):** trend yönünde son swing'in kırılması (yükselişte son tepe aşılır). Trend sürüyor.
- **MSS / CHoCH (market structure shift / change of character):** trendin **tersine** son swing'in kapanışla
  kırılması. Yükselişte son dip kırılırsa yapı değişti. Arkadaşının tetiği bu: süpürmeden sonra **ters yöne MSS**.
- MSS'i yapan mum "istekli" (büyük gövde, hızlı) olmalı; sürünerek kırmak zayıftır.
**Grafikte.** XRP örneği 4. adım: "istekli bir yeşil mum ile tekrar range içine girdi ve MSS yaptı."
**Bizde.** `structure` detektörü (BOS/CHoCH), lab `smc.js` MSS = kapanış son minör dip/tepeyi geçer.

## 4. FVG (fair value gap) ve IFVG
- **FVG:** üç mumluk boşluk. Yükselişte 1. mumun tepesi ile 3. mumun dibi arasında kalan, 2. mumun gövdesinin geçtiği
  ama kimsenin işlem yapamadığı alan. Sert hareket (displacement) bırakır. Fiyat genelde geri gelip bu boşluğu
  "doldurur"; giriş bölgesi olarak kullanılır. **%50'si (CE)** en çok izlenen seviye.
- **IFVG (inverted):** doldurulup kapanışla geçilen FVG; artık ters yönde destek/direnç.
**Grafikte.** Sarı kutular ("FVG"), XRP'de "MSS sonrası oluşan FVG" ve kesikli çizgi = %50.
**Bizde.** `fvg` detektörü (açık/kısmen dolu/ters çevrilmiş), lab `fvgInLeg` (süpürme→MSS bacağındaki son FVG).

## 5. Order block (OB)
Sert hareketten hemen önceki son ters renkli mum (yükseliş öncesi son kırmızı mum). Kurumsal emirlerin kaldığı
varsayılan alan; FVG ile çakışırsa güçlenir. XRP örneği 2. adım: "burası 4H order block bölgesine tekabül ediyor."
**Bizde.** `orderblock` detektörü.

## 6. Premium / discount, çeyrek seviyeler, OTE
- Bir range'in (swing dip → tepe) **0,5'i denge**. Üstü **premium** (pahalı → short aranır), altı **discount** (ucuz →
  long aranır). Arkadaşı 0 / 0,25 / 0,5 / 0,75 / 1 çeyrek seviyelerini çizer; 0,25 ve 0,75 ara basamaklar.
- **OTE (optimal trade entry):** bacağın 0,62–0,79 geri çekilmesi (0,618 / 0,705 / 0,786). BTC long girişi tam
  0,705'ten (81.356). OTE + FVG/OB çakışması = en iyi giriş.
- Kural: üst dilim yükselişte ise **discount'ta long**, düşüşte ise **premium'da short**. Premium'da long almak,
  yapı yükseliş olsa bile zayıf işlemdir.
**Bizde.** `fibonacci` detektörü (OTE bölgesi, fib çakışması, Fib kesişimi 0,618×1,272), `structure.dealingRange`.

## 7. Üst dilimden alt dilime (top-down)
- **Günlük + 4H:** yön (yükselen/alçalan dip-tepe), büyük likidite ve FVG/OB bölgeleri işaretlenir.
- **1H / 15m:** bu bölgelere gelince giriş aranır: süpürme → MSS → FVG.
- **USDT.D** (Tether dominance): yükseliyorsa kriptolar düşer; arkadaşı işlem yönünü bununla da teyit eder.
  Bizde USDT.D yok; BTC'nin günlük/4H eğilimi vekil (`regime.js`).
- Altcoinde BTC yönünde işlem: BTC sert hareket ederken altcoinde ters işlem riskli.

## 8. Seanslar ve killzone
- Asya (00–07 UTC), Londra (07–10), New York (12–15 UTC civarı) açılışları. Londra/NY açılışında Asya seansının
  tepesi/dibi sık süpürülür. Arkadaşı killzone'ları "riskli" sayar: hareket orada olur ama tuzak da.
- Hafta sonu hacim düşük, hareket sahte; bizim 6 aylık ölçümde de hafta sonu her dilimde daha kötü çıktı.

## 9. RSI ve hacim (onay)
- Alacağın yönde **RSI uyumsuzluğu** varsa (fiyat yeni dip, RSI daha yüksek dip → düşüş zayıflıyor) işlemi almaz.
- Sert gelen büyük mumlar: hacim ve RSI desteklemiyorsa "manipülasyon" (bizim düşen bıçak koruması aynı gözlem).

## Küçük sözlük
BOS kırılım · MSS/CHoCH yapı değişimi · FVG boşluk · CE boşluğun %50'si · OB order block · PDH/PDL önceki günün
tepe/dibi · EQH/EQL eşit tepe/dip · OTE 0,62–0,79 · DOL draw on liquidity (fiyatın çekildiği hedef) · RH/RL range
high/low · HTF/LTF üst/alt zaman dilimi · R risk birimi (stop mesafesi).
