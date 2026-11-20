# Ön kayıt — "PSL AI" tarzı 8 ölçütlü gösterge puanı + üst zaman dilimi uyumu (20.11.2026)

**Durum: ONAYLANDI (kullanıcı, 20.11.2026 — "İki isteğini de onaylıyorum": Aşama A koşusu + Aşama B için betiğin TradingView grafiğine
eklenmesi). Bu dosya yazıldığında bu kural için ölçüm yoktu.** Tanım / eşik değişmez (değişirse tarihli not + neden). Soru ve kaynak kullanıcının;
gösterge dönemleri, eşik (6 / 8), 1D uyum tanımı ve çıkış planı orkestratörün seçimi.

**Not (20.11.2026, koşudan önce — dönem netleştirildi):** dönem 20.11.2024 00:00 – 20.11.2026 00:00 UTC (2 yıl; sinyal mumu kapanışı bu
aralıkta). Göstergelerin ısınması için öncesinden en az 200 günlük (1D) ve 300 mumluk (4H / 1H) veri çekilir; ısınma mumlarında sinyal
üretilmez. Evren: 20.11.2026 itibarıyla OKX hacminde ilk 50 (tarama ile aynı liste kuralı). Eğitim / doğrulama zamanla 2/3 · 1/3.

## Nereden çıktı (görülmüş veri — kanıt sayılmaz)
- Kaynak: Kripto Pusulası yayını (19.11.2026, youtube `OTQdTZl1U0s`) ve TradingView betiği "PSL AI - Analytical Intelligence"
  (`j9pfOGZl`, v2.0 / v2.1 sürüm notları). **Kaynak kodu kapalı**; yazar yayında kodu ve al-sat mantığını vermeyeceğini söyledi.
- Yayında gösterilen sayılar (yazarın kendi simülasyon tablosu; 1.000 $ kasa, işlem başına 150 $ teminat): BTC 1H 1 yıl +%122 (15x) ·
  ETH 1H +%85 · CHZ 5m +%410 (50x) · DOT 5m ocaktan beri +%690 · BTC 1H 4 yıl 11 ay +%267 · BTC 4H 2 yıl +%36 (8x) · altın 1m −%1.
- Bu sayılar neden kanıt değil (yazarın kendi sürüm notlarından): (1) stop yalnız mum KAPANIŞINDA çalışır ama zarar stop SEVİYESİNDEN
  yazılır (gerçekte kapanış fiyatından çıkılır); (2) hedef fitille, stop kapanışla; (3) TP1 ve stop aynı mumdaysa kazanç sayılır;
  (4) mesafeler 1m / 5m / 15m / 1H / 4H için ayrı ayrı "kalibre" edildi ve aynı geçmişte gösterildi (örneklem içi); (5) komisyon gidiş-dönüş
  toplam %0,05, kayma ve fonlama yok (5m + 50x'te gerçek maliyet bunun ≥ 2–3 katı); (6) gösterilen pariteler izleyici / yazar seçimi.

## Yeniden üretilebilen ↔ üretilemeyen
- **Açıkça yayımlanmış (birebir kurulabilir):** 8 ölçütlü puan. Her ölçüt long ya da short tarafa +1:
  MACD > sinyal ↔ < · RSI 50–70 ↔ 30–50 · Stokastik %K 50–80 ↔ 20–50 · göreli hacim > 1,2 ve mum yeşil ↔ kırmızı · kapanış > açılış ↔ < ·
  EMA50 > EMA169 ↔ < · ADX > 20 ve DI+ > DI− ↔ DI− > DI+ · CCI 0…150 ↔ −150…0. Sonuç: büyük taraf (ör. "SAT 6/8").
- **Yayımlanmamış (kapalı):** v2 işlem planının tetikleyicisi (hangi puan / hangi sonuç), hangi üç üst zaman dilimi, giriş / 4 hedef / stop
  mesafelerinin ATR katsayıları ve zaman dilimine göre kalibrasyon. Bunlar ancak betik TradingView grafiğine eklenip çizilen işlemlerin
  seviyeleri okunarak (ya da betiğin JSON alarm iletilerinden) kestirilebilir → **Aşama B**, ayrı not ile.

## Soru
Aşama A: 4H mum kapanışında 8 ölçütlü puanı ≥ 6 / 8 olan ve 1D EMA50 ↔ EMA169 yönüyle uyumlu sinyaller, sabit ve önceden yazılmış bir
çıkış planıyla, maliyet sonrası sıkı ölçütü geçiyor mu? Yazılı beklenti: geçmez; hedge'li R ≈ 0 ya da eksi (trend + momentum oylaması
BTC yönünü taşır; bkz. `bulgular.md` trend kuralları).

## Veri ve kurulum
- OKX USDT sürekli vadeli, hacimde ilk 50 coin, **4H** (birincil); 1H bilgi satırı. Dönem: betiğin mevcut olduğu tüm geçmiş, zamanla
  2/3 eğitim · 1/3 doğrulama.
- Gösterge ayarları (standart; betik açıklamasında dönem yazmadığı için TradingView varsayılanları): MACD 12/26/9 · RSI 14 · Stokastik
  14/3/3 (%K) · göreli hacim = hacim ÷ SMA20(hacim) · ADX / DI 14 · CCI 20 · EMA 50 / 169.
- **Sinyal (nedensel, yalnız kapanmış mumlar):** 4H mum kapanışında long puanı ≥ 6 ve long > short ve son kapanmış 1D mumda EMA50 > EMA169
  → long (short ayna). Aynı coin + yönde açık işlem varken yeni sinyal alınmaz; yön değişince yeni sinyal serbest. Başka eşik denenmez.
- **Çıkış planı (karar satırı, yazarın kalibrasyonu KULLANILMAZ):** giriş sinyal mumunun kapanışından piyasa emri; stop 1,5 × ATR(14);
  TP1 1R'de %50 + stop girişe; kalan TP2 2R. Stop mum içi dokunuşla (fitil) çalışır; aynı mumda stop + hedef → stop sayılır.
- Maliyet: komisyon %0,05 + kayma %0,05 (taraf başına), fonlama 0 (varsayılan).

## Geçme ölçütü (tek birincil test)
- **Geçer:** eğitimde ve doğrulamada ort. R > 0 ve PF > 1,1 **ve** hedge'li R iki dilimde > 0 **ve** dilim başına n ≥ 100.
  n < 100 → **sonuçsuz**. Diğer her durum → **geçmedi**.
- Sıkı ölçüt geçer, hedge'li geçmezse: kazanç BTC yönünden → kural olmaz.
- Geçerse bile aday; sonraki adım ileriye dönük gölge etiket (Variables bayrağı, varsayılan kapalı).

## Bilgi satırları (karar vermez, seçim yapılmaz)
- Puan eşiği 5 / 7 · üst zaman dilimi şartı olmadan · long / short ayrı · 1H.
- **Yazarın muhasebesiyle aynı sinyaller** (stop kapanışta ama seviyeden yazılır, aynı mumda TP1 + stop = kazanç, komisyon toplam %0,05,
  kayma yok): iki muhasebe arasındaki fark = yayındaki sayıların ne kadarının muhasebeden geldiği.
- 4 hedefli, "TP4'te kapat, hedef geçildikçe stopu bir önceki hedefe taşı" düzeni (yayında anlatılan 4H ayarı), hedefler 1 / 2 / 3 / 4 R.
- Kümelenme: işlemlerin düştüğü gün / hafta / coin sayısı.

## Aşama B — klon (tanım 20.11.2026'da, Aşama B koşusundan ÖNCE yazıldı; Aşama A sonucu bu tanımı değiştirmez)
**Kaynak (görülmüş veri):** TradingView misafir grafiğine topluluk betiği eklenemedi (hesap gerekiyor; kullanıcının hesabı bu tarayıcıda açık
değil). Onun yerine betik sayfasında yayımlanan grafik görüntüsü okundu (BITGET:BTCUSDT.P 4H, fiyat 62.957,2): sonuç SAT 7/8 · üst zaman
dilimleri 1G / 1H(afta) / 1A, uyum %100 · plan "tetik bekleniyor": giriş 61.957,4 ("%1,59 altında kapanış" = 50 mum dibi / destek) ·
geçersiz 64.187,6 ("üstünde kapanış") · hedefler 59.727,2 / 58.612,1 / 56.381,9 / 54.151,7 (R:R 1,0 / 1,5 / 2,5 / 3,5) · ATR %1,77.
Hesap: |giriş − geçersiz| = 2.230,2 = 2,00 × ATR (1.114,3). Tabloda son 10 işlem (saat UTC+3): SATIŞ 02.06 07:00, 24.06 15:00, 29.07 19:00,
11.08 15:00 · ALIŞ 25.08 03:00, 03.09 15:00, 18.09 15:00, 02.10 03:00 · SATIŞ 08.11 23:00, 12.11 15:00 (2026). Panel: son 3000 mumda 37 işlem.

**Klon tanımı (4H; betikte görülmeyen kısımlar kestirimdir, öyle işaretlendi):**
1. Yön: kapanmış 4H mumda 8 ölçütlü puanın büyük tarafı ≥ 6 → AL / SAT (kestirim: eşik; betik "6+/8" öneriyor).
2. Üst zaman dilimi uyumu: kapanmış son 1G, 1H(afta) ve 1A mumunda aynı puanın büyük tarafı planla aynı yönde (kestirim: betik yön tanımını
   yayımlamıyor; yetersiz geçmiş yüzünden hesaplanamayan ölçüt atlanır, üst TF'de hiç ölçüt hesaplanamıyorsa o TF uyumlu sayılmaz).
3. Plan: 1 + 2 sağlandığı ilk mumda oluşur ve kilitlenir. Seviye = o mum dahil son 50 mumun en düşük dibi (SAT) / en yüksek tepesi (AL).
   Geçersiz = seviye ± 2 × ATR(14); hedefler seviyeden 1 / 1,5 / 2,5 / 3,5 × (2 × ATR). Yön (madde 1) terse dönerse ya da uyum bozulursa
   tetiklenmemiş plan iptal.
4. Tetik / giriş: bir mum seviyenin ötesinde KAPANIRSA o kapanıştan giriş. Aynı coinde açık işlem varken yeni plan yok.
5. Çıkış (yayında anlatılan 4H ayarı): kısmi kâr yok; TP1 geçilince stop TP1'e, TP2'de değişmez, TP3 geçilince stop TP2'ye, TP4'te tamamı kapanır.
   Hedef fitille; stop mum kapanışı stopun ötesindeyse.
6. **Karar satırı muhasebesi (bizim):** stop çıkışı o mumun KAPANIŞ fiyatından; aynı mumda hedef + stop koşulu → stop; maliyet taraf başına
   %0,05 komisyon + %0,05 kayma; R = K/Z ÷ |giriş − geçersiz|. **Bilgi satırı (yazarın muhasebesi):** stop çıkışı stop seviyesinden, aynı
   mumda TP1 + stop → kazanç, maliyet toplam %0,05.
- Dönem, evren, bölme, geçme ölçütü Aşama A ile aynı (tek birincil test: klon, bizim muhasebe). Bilgi: long / short ayrı, kümelenme, yazarın muhasebesi.
- **Klon doğrulaması (karardan önce raporlanır):** aynı kurallar BTC 4H'de (OKX; Bitget ile fitil farkı olabilir) koşulur; yukarıdaki 10 işlemin
  kaçı aynı yönde ± 1 mum içinde üretiliyor ve aynı aralıkta klon kaç fazladan işlem açıyor. Örtüşme < 8 / 10 ise sonuç "betiğin kendisi"
  olarak sunulmaz, "betikten esinlenen kural" olarak sunulur. Doğrulamaya bakıp tanım DEĞİŞTİRİLMEZ.

## Bilinen sınırlar
- Kapalı kaynak: Aşama A betiğin birebir kopyası değildir (v2 tetikleyicisi ve mesafeleri bilinmiyor).
- Hayatta kalma yanlılığı (bugünün ilk 50 coini), dönem tek yönlüyse yön etkisi (hedge'li R ve long / short ayrımı bunun için).
- Yayındaki 1m / 5m sonuçları ölçülmez: bizim veri ve maliyet varsayımıyla 5m'de komisyon + kayma R'nin büyük kısmıdır.

## Sonuç (20.11.2026) — Aşama A GEÇMEDİ · Aşama B GEÇMEDİ (klon doğrulanamadı: 3 / 10)
Sonuç dosyası `docs/backtest/psl.json` (betik `backtest/psl.mjs`, `--clone`; yerel koşu, 49 seri, BTW atlandı). Ön kayıtta yazmayan
seçimler dosyada `unstatedChoices` (A: 14, B: 11 madde); sonuca bakılarak hiçbiri değiştirilmedi.
- **Aşama A (karar satırı, 4H, puan ≥ 6 + 1D uyumu):** eğ n 3.087, ort. +0,007R, PF 1,01, hedge'li −0,035 · doğr n 2.374, −0,072R, PF 0,86,
  hedge'li −0,064 → **geçmedi**. Bilgi: long −0,069 / −0,152 · short +0,047 / −0,036 (hedge'li −0,006 / −0,049) · eşik 5 −0,001 / −0,086 ·
  eşik 7 −0,007 / −0,030 · üst TF şartsız −0,001 / −0,023 · 1H −0,071 / −0,121 · 4 hedefli +0,030 / −0,104.
  **Aynı sinyaller, yazarın muhasebesi: +0,201 / +0,149R, PF 1,48 / 1,35** → işlem başına ≈ +0,2R yalnız muhasebeden.
- **Aşama B (klon, bizim muhasebe):** eğ n 672, −0,003R, PF 0,99, hedge'li −0,032 · doğr n 453, +0,017R, PF 1,03, hedge'li −0,012 →
  **geçmedi**. Yazarın muhasebesi +0,266 / +0,291R (PF 1,70 / 1,76). Long −0,213 / −0,015 · short +0,116 / +0,028 (hedge'li +0,047 / −0,021).
- **Klon doğrulaması:** betiğin 10 BTC 4H işleminden 3'ü üretildi (24.06 SAT, 03.09 AL +1 mum, 18.09 AL), aynı aralıkta 3 fazladan işlem;
  son 3000 mumda klon 16 işlem (panel 37), TP1 oranı %56 (panel %62). **Örtüşme < 8 / 10 → Aşama B "betiğin kendisi" değil, "betikten
  esinlenen kural" ölçümüdür.** Betiğin üst TF yönü / tetik tanımı bizim kestirimimizden farklı; kaynak kapalı olduğu için tanım değiştirilmedi.
- **Sonuç cümlesi:** yayımlanmış puan ve görüntüden çıkarılan plan yapısı kenar göstermiyor; yayındaki kazancın ölçülebilen kaynağı muhasebe
  (stop kapanışla ama seviyeden yazılıyor, aynı mumda TP1 + stop = kazanç, düşük maliyet). Betiğin gerçek işlemleri ölçülmedi; bunun tek yolu
  betiğin kendi alarm / işlem listesini (TradingView hesabıyla) dışa alıp gerçek muhasebeyle yeniden hesaplamak. Başka eşik denenmez.

## Ek (20.11.2026) — betiğin KENDİ işlemlerinin denetimi (ön kayıtlı test değil; n 46, karar vermez)
Kullanıcı betiği kendi TradingView grafiğine ekleyip simülasyon tablosunu gönderdi (Binance spot BTC / ETH / SOL / XRP / DOGE, 4H, başlangıç
20.12.2024, marjin 1.000 $, "zaman dilimine özel TP/SL" açık → 8x). Tablolardaki son 9–10 işlem (toplam 46; 26.05–13.11.2026) Binance 4H
mumlarıyla yeniden oynatıldı: `docs/arastirma/psl-denetim/` (`trades.mjs` okunan tablolar, `replay.mjs`, çıktı `sonuc.txt`; test yok, tek seferlik denetim).
- **İşlem planı birebir çözüldü:** tablo saati = tetik mumunun açılışı (UTC+3); giriş = tetik mumunun kapanışı; stop = giriş ± 2,000 × ATR(14,
  Wilder, tetik mumu dahil); hedefler girişten 1 / 1,5 / 2,5 / 3,5R; 4H düzeni: kısmi kâr yok, TP1 geçilince stop TP1'e, TP3 geçilince TP2'ye,
  TP4'te kapanış; stop mum kapanışıyla, taşınan stop sonraki mumdan. Bu kuralla **46 işlemin 46'sında K/Z tablodakiyle dolar hassasiyetinde aynı**
  (etiket 45 / 46). Bilinmeyen tek şey tetikleyici (hangi mumda plan oluşuyor).
- **Aynı 46 işlem, üç muhasebe** (pozisyon 8.000 $): yazarın tablosu **+2.936 $** (ort. +0,256R, PF 1,53) · aynı kural ama stopta çıkış o mumun
  KAPANIŞ fiyatından + maliyet toplam %0,20: **−1.777 $** (ort. −0,133R, PF 0,76) · stop borsada emir (fitille, seviyeden) + %0,20: **0 $**
  (ort. +0,001R, PF 1,00). Long 17 işlem: −1.146 / −3.192 / −1.350 $ · short 29 işlem: +4.082 / +1.415 / +1.350 $ (dönem düşüş).
- Sınır: n 46, 5 coin, 6 ay, tek yönlü dönem, coin ve dönem seçimi kullanıcının / tablonun "son 10" sınırı. Karar değil; Aşama A / B sonucuyla aynı yönde.

