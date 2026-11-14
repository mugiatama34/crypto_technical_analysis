# Ön kayıt — rejim haritası ve "trend yönünde işlem" testi (14.11.2026)

**Durum: ONAYLANDI (kullanıcı, 14.11.2026 — "Rejim haritası fikrine katılıyorum, bunu analiz edelim"; hareketli ortalama dizilimi önerisi
kullanıcıdan); bu dosya yazıldığında ölçüm yoktu.** Tanım / eşik değişmez (değişirse tarihli not + neden).

## İki ayrı parça
1. **Trend testi (karar taşır):** kullanıcının iddiası — "trendin yönü belliyken o yöne işlem almak kazandırır; trend dönüşten uzun sürer".
   Bu doğrudan sınanabilir bir kural ve **bizim hiç bakmadığımız bir dönem var** (OKX verisinin başından 24.11.2022'ye kadar BTC / ETH
   günlük mumları): gerçek bir bağımsız sınama.
2. **Rejim haritası (yalnız betimsel):** elimizdeki üç şeyin (4H sinyaller, momentum, fonlama geliri) sonuçlarını gözlenebilir durumlara göre
   bölmek. Bu verilere zaten bakıldı → kanıt değil; yalnız ileriye dönük izlenecek 2–3 hipotez üretir. Karar / verdict yok.

## Durum değişkenleri (hepsi nedensel: t günü kapanışına kadar veriyle, ertesi açılıştan itibaren geçerli)
- **Trend (hareketli ortalama dizilimi; kullanıcı önerisi, sayılar orkestratörden):** günlük kapanışlarla
  YUKARI = kapanış > SMA50 **ve** SMA50 > SMA200 · AŞAĞI = kapanış < SMA50 **ve** SMA50 < SMA200 · aksi KARIŞIK.
- **Oynaklık (BTC):** 30 günlük günlük-getiri standart sapması ÷ kendi son 365 günlük medyanı: > 1,25 YÜKSEK · < 0,8 DÜŞÜK · aksi ORTA.
- **Fonlama (BTC, 2023-06'dan; Hyperliquid 8 saatlik eşdeğer, son 7 gün ortalaması):** > %0,015 YÜKSEK · < %0,005 DÜŞÜK · aksi ORTA.

## Parça 1 — trend testi
- **HT1 (birincil):** BTC ve ETH, eşit ağırlık; her varlık KENDİ trend durumuna göre: YUKARI → long, AŞAĞI → short, KARIŞIK → boş. Karar t
  kapanışında, işlem t+1 açılışında; getiri açılıştan açılışa. Maliyet: pozisyon değişiminde nominalin %0,075'i (komisyon + kayma) +
  tutulan nominale 8 saatte %0,01 fonlama (iki yönde de maliyet; ihtiyatlı). Kaldıraç yok (1× nominal).
- **Dönemler:** **bağımsız dönem** = verinin başı (SMA200 oluştuktan sonra) → 24.11.2022 (hiç bakılmadı) · **bilinen dönem** = 24.11.2022 → veri
  sonu.
- **Rapor:** haftalık getiri ortalaması, hafta bloklu bootstrap %90 aralığı, yıllık Sharpe, maks. düşüş, en kötü hafta; **long bacak ve short
  bacak ayrı** (yükselen bir varlıkta "yukarı trendde long" yalnızca piyasayı taşımak olabilir; iddianın asıl sınavı short bacak ve "al-tut"a
  göre fark); al-tut karşılaştırması; durumlarda geçen süre payı ve durum değişim sayısı (bağımsız trend dönemi sayısı azdır — bunu yaz).
- **Plato satırları (seçim değil, sağlamlık):** SMA 30 / 150 ve SMA 70 / 250.
- **Geçme ölçütü:** bağımsız dönemde haftalık ortalama > 0, %90 aralığın alt ucu > 0, Sharpe ≥ 0,5 **ve** short bacak tek başına ortalama > 0;
  bilinen dönemde toplam ve short bacak ortalaması > 0; iki plato satırı iki dönemde de aynı işarette. Geçerse: "trend yönü kuralı ileriye
  dönük kâğıt denemeye değer" (Variables bayrağı, varsayılan kapalı; karar kullanıcının).
- **HT2 (bilgi amaçlı, karara girmez):** alt coin sepeti (her gün önceki 30 günün hacmine göre ilk 30, BTC ve ETH hariç, eşit ağırlık), BTC'nin
  trend durumuna göre: YUKARI → sepet long, AŞAĞI → sepet short. Aynı maliyetler. Yalnız verisi olan dönem.

## Parça 2 — rejim haritası (betimsel)
Her hücre: n (ya da hafta), ortalama, %90 aralık; n < 100 işlem ya da < 26 hafta → "sonuçsuz" etiketi.
- **4H sinyaller** (Aşama 1 plan seti, 24.11.2024 → 2026-11; taban = bugünkü 3 kademe, gerçekçi): ort. R, karar anındaki BTC trend durumu ×
  yön (long / short) → "trendle aynı yön" · "trende ters" · "karışık"; ayrıca oynaklık durumuna göre.
- **Momentum** (canlının eşit risk biçimi, hedge'li, haftalık; 24.11.2022 →): haftalık getiri, dengeleme anındaki BTC trend ve oynaklık
  durumuna göre.
- **Fonlama geliri** (BTC + ETH, haftalık, Hyperliquid; 2023-06 →): haftalık fonlama, haftanın başındaki trend ve fonlama durumuna göre.

## Bilinen sınırlar (ölçümden önce)
1. Trend dönemleri uzun ve az sayıda: 6 yılda bağımsız trend dönemi belki 10–15 tane → haftalık sayı büyük görünse de gerçek örneklem küçük;
   aralıklar hafta bloklu, yine de iyimser olabilir.
2. Parça 2 bakılmış veride; hücrelere bölmek şans eseri desen üretir. Yalnız hipotez üretimi.
3. Kripto 2020–2021'de tek yönlü yükseldi: "yukarı trendde long" o dönemde neredeyse kesin kazanır → short bacak ve al-tut farkı ayrıca
   bu yüzden ölçütte.

## Günlük
- 14.11.2026: dosya yazıldı (ölçüm yok). Betik yazılıyor.
- 14.11.2026 (ilk koşudan ÖNCE) uygulama notları: durum t kapanışında hesaplanır, t+1 tutma gününde kullanılır; bağımsız dönemin başı = BTC ve
  ETH'nin ikisinin de durumu oluştuğu ilk gün; haftalar pazartesi–pazar, yalnız 7 günü de dönem içinde olanlar (24.11.2022'yi içeren hafta iki
  dönemde de yok); long → short geçişinde kapanan birimin maliyeti long bacağa, açılanınki short bacağa; plato satırları kendi SMA'ları
  oluştuğu günden başlar; HT2 sepetinde 10'dan az coin varsa boş; momentum tek akış (24.11.2022'den, 100 gün ısınma); fonlama durumu için
  pencerede en az 5 gün veri; aralıklar haftalık blokla (trend dönemleri ardışık haftalara yayıldığı için İYİMSER olabilir). Sentetik doğrulama:
  kalıcı trendli seride HT1 geçiyor, rastgele yürüyüşte geçmiyor.
- 14.11.2026 **Sonuç (koşu 43562586738, `docs/backtest/regime-map.json`; BTC / ETH günlük veri 01.01.2020'den, durum 18.07.2020'den):**
  - **HT1 trend kuralı (SMA50 / 200): GEÇMEDİ** (`knownShortPos` ve `plateau_70_250` koşulları tutmadı). Haftalık %:
    - Bağımsız dönem (07.2020 → 11.2022, 122 hafta): toplam **+1,71 [0,46; 2,96]**, Sharpe 1,47 · long bacak +1,67 (Sharpe 1,69) · **short bacak
      +0,05 [−0,62; +0,69]** · al-tut +1,58 (Sharpe 1,05). Maks. düşüş kural %54 ↔ al-tut %114.
    - Bilinen dönem (11.2022 → 11.2026, 206 hafta): toplam +0,27 [−0,21; +0,82], Sharpe 0,44 · long +0,30 · **short −0,02** · al-tut +0,79
      (Sharpe 0,83).
    - Plato: 30 / 150 → +1,63 / +0,02 · 70 / 250 → +1,48 / **−0,14**.
    - Okuma: kazancın tamamı long bacaktan (2020–21 yükselişi); kural al-tut getirisini artırmıyor, düşüşü yarıya indiriyor. **Aşağı trendde
      short iki dönemde de ≈ 0** (2022 ayı piyasası dahil). Trend durumları kısa: BTC'de 858 günde 46 durum dönemi, trend dönemi medyanı 6–10 gün.
  - **HT2 (bilgi; alt sepet, BTC durumuna göre):** +2,61 / −0,15 (short bacak +0,18 / −0,03).
  - **Harita (betimsel, karar yok):**
    - 4H sinyaller (24.11.2024 →, n 2.483, ort. −0,061R): **trendle aynı yön −0,102R [−0,169; −0,037] (n 1.192)** · trende ters −0,011 (n 224) ·
      karışık −0,025 (n 1.067). Ayrıntı: long · YUKARI −0,116 · short · AŞAĞI −0,093 · short · YUKARI +0,021 (n 164) · short · KARIŞIK +0,004.
      Oynaklık: yüksek −0,094 · orta −0,057 · düşük −0,055.
    - Momentum (eşit risk, hedge'li; 206 hafta, ort. +%0,42): YUKARI +0,53 · AŞAĞI +0,14 · KARIŞIK +0,43; oynaklık düşük +0,77 [0,32; 1,24] ·
      orta +0,12 · yüksek +0,59 (25 hafta, sonuçsuz).
    - Fonlama geliri (BTC + ETH, Hyperliquid brüt; 179 hafta, ort. +%0,275): fonlama durumu YÜKSEK **+0,59** · ORTA +0,20 · DÜŞÜK +0,07; trend
      YUKARI +0,49 · AŞAĞI +0,12 · KARIŞIK +0,16.
  - **İleriye dönük izlenecek hipotezler (haritadan; kanıt değil):** (F1) 4H sinyallerde BTC trendiyle aynı yöndeki işlemler diğerlerinden
    kötü — canlı kayıtta `btcRead` / `regime` ile 13.12'de bak. (F2) Fonlama geliri yalnız fonlama durumu YÜKSEK iken anlamlı (gözlenen durum →
    mekanik getiri). (F3) Momentum BTC AŞAĞI durumunda zayıf (38 hafta; zayıf ipucu).

## Ek — HT3: kısa vadeli çoklu ufuk dizilimi (14.11.2026, kullanıcı sorusu; ölçümden ÖNCE)
Kullanıcının itirazı: işlemler 4H'de açılıyor; günlük 50 / 200 çok yavaş. Önerisi: "4 saat > 12 saat > 1 gün > 1 hafta" (düşüşte tersi) gibi
kısa ufukların dizilimi. Bu ayrı bir kural; HT1'in sonucunu değiştirmez, kendi ölçütüyle sınanır.
- **Durum (4H mumlarla; t mumu kapanışında, t+1 açılışından geçerli):** YUKARI = kapanış > SMA3 > SMA6 > SMA42 (12 saat, 1 gün, 1 haftalık
  ortalamalar) · AŞAĞI = kapanış < SMA3 < SMA6 < SMA42 · aksi KARIŞIK.
- **Kural:** BTC ve ETH, eşit ağırlık, her varlık kendi durumuna göre: YUKARI → long, AŞAĞI → short, KARIŞIK → boş. Karar 4H mum kapanışında,
  işlem sonraki mumun açılışında. Maliyet HT1 ile aynı (değişim başına %0,075 + 8 saatte %0,01 fonlama). Sık durum değişimi beklenir →
  **brüt ve net ayrı** raporlanır; karar NET ile.
- **Dönemler:** bağımsız = 4H verisinin başı → 24.11.2022 (BTC / ETH 4H'ye bu dönemde hiç bakılmadı) · bilinen = 24.11.2022 → veri sonu.
- **Plato:** (2, 4, 28) ve (6, 12, 84) mum.
- **Geçme ölçütü (HT1 ile aynı yapı):** bağımsız dönemde net haftalık ortalama > 0, %90 aralığın alt ucu > 0, Sharpe ≥ 0,5 ve short bacak net
  ortalaması > 0; bilinen dönemde toplam ve short bacak net ortalaması > 0; iki plato satırı iki dönemde de net ortalama > 0.
- **Bilgi amaçlı:** durum başına sonraki 6 mumun (1 gün) yön işaretli brüt getirisi (kural yönünde; maliyetsiz) — "durum yönü öngörüyor mu" ·
  durumlarda geçen süre, değişim sayısı, yıllık devir · 4H sinyaller haritasına ek kırılım: karar anında COIN'in kendi kısa vade dizilimiyle
  aynı yön / ters / karışık (betimsel; 24.11.2024 →).
- Önceden yazılmış beklenti (orkestratör): laboratuvarda 1H / 4H trend ve kırılım aileleri (zaman serisi momentumu, Donchian) kenar vermedi;
  kısa ufuk = daha çok durum değişimi = daha çok maliyet ve gürültü. Geçme olasılığını düşük görüyorum; ölçüm bunu sınar.
- 14.11.2026 (HT3 ilk koşusundan ÖNCE) uygulama notları: 4H mum başına fonlama = 8 saatlik oranın yarısı; günlük satır = o günün 4H getirilerinin
  toplamı, haftalık / bootstrap / Sharpe HT1'in koduyla; dönem başı = iki varlığın da durumu oluştuktan sonraki ilk tam gün; brüt ve net ayrı,
  bacaklar yalnız net; ileri-6-mum ölçüsünde pencereler örtüşür (aralık giriş haftasına göre bloklu); devir = varlık başına yıllık pozisyon
  birimi; sinyal kırılımında coin'in karar anından önce kapanan son 4H mumundaki durumu. Sentetik doğrulama: kalıcı trendli 4H seride geçiyor
  (net +0,84 ↔ brüt +1,80 % hafta), rastgele yürüyüşte geçmiyor.
- 14.11.2026 **HT3 sonucu (koşu 43564086338; BTC / ETH 4H verisi 16.12.2019'dan, ~15.100 mum; HT1 sayıları değişmedi: +1,711 / +0,273):**
  - **GEÇMEDİ — 9 koşulun 8'i tutmadı** (yalnız "bağımsız dönem yeterince uzun" tuttu). Haftalık %, bağımsız (150 hafta) / bilinen (206 hafta):
    - **Net −0,57 [−1,35; +0,29] / −0,62 [−1,09; −0,10]** (Sharpe −0,65 / −1,07) · brüt +0,41 / +0,35 · maliyet **%0,90 / hafta** (varlık başına
      yılda ~630 durum değişimi).
    - Long bacak +0,20 / −0,05 · **short bacak −0,77 [−1,36; −0,18] / −0,57 [−0,88; −0,26]** · al-tut +1,69 / +0,78.
    - Plato: (2, 4, 28) net −1,01 / −0,71 · (6, 12, 84) net +0,10 / −0,52; short bacak hepsinde eksi.
  - **Durum yönü öngörüyor mu (maliyetsiz, sonraki 6 mum):** YUKARI'da long **+%0,37 [0,08; 0,63]** / +%0,21 [−0,02; +0,44] · **AŞAĞI'da short
    −%0,41 [−0,85; +0,08] / −%0,12** → aşağı dizilimden sonra fiyat ortalamada TEPKİ veriyor (short kaybediyor), iki dönemde de. KARIŞIK'ta long
    +%0,16 / +%0,07 (genel yükseliş eğilimi).
  - Durumlar çok kısa: zamanın ~%65'i KARIŞIK; YUKARI / AŞAĞI dönemlerinin medyanı **8 saat** (2 mum).
  - **4H sinyaller, coin'in kendi kısa vade dizilimine göre (betimsel, n 2.483):** aynı yön −0,073R (n 419) · ters −0,031 (n 274) · karışık
    −0,062 (n 1.790) → dizilimle aynı yönde olmak yardımcı olmuyor.
  - Okuma: üç trend tanımında da (günlük 50 / 200, 4H kısa dizilim, 4H sinyal filtresi) **short tarafı kazandırmıyor**; kısa dizilimde brüt
    getirinin iki katı maliyete gidiyor.
