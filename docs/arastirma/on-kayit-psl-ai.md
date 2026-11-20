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

## Aşama B (ayrı karar; bu ön kayıttan bağımsız)
Betiğin gerçek işlem planını (tetik + seviyeler) TradingView'den okuyup aynı coin / dönemde bizim sinyallerle örtüşme oranını ve
seviye katsayılarını çıkarmak. Örtüşme ≥ %80 olmadan "indikatörün kendisi ölçüldü" denmez; Aşama A yalnız **yayımlanmış puanı** ölçer.

## Bilinen sınırlar
- Kapalı kaynak: Aşama A betiğin birebir kopyası değildir (v2 tetikleyicisi ve mesafeleri bilinmiyor).
- Hayatta kalma yanlılığı (bugünün ilk 50 coini), dönem tek yönlüyse yön etkisi (hedge'li R ve long / short ayrımı bunun için).
- Yayındaki 1m / 5m sonuçları ölçülmez: bizim veri ve maliyet varsayımıyla 5m'de komisyon + kayma R'nin büyük kısmıdır.
