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
