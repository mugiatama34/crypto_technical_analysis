---
name: tradingview-bybit
description: TradingView ya da Bybit ekranını tarif eden her cevaptan ÖNCE yükle - çizim, fib, alarm, gösterge, renk/ayar, pozisyon aracı, Bybit'te TP/SL, kısmi kapanış, trailing stop, çarpanlı semboller (1000PEPE vb.), gerçek işlem adımları. Ferhat'ın doğrulanmış telefon (iOS, Türkçe) ve masaüstü (Almanca) menü adlarını, standart paletini ve Bybit davranış notlarını içerir.
---

# TradingView + Bybit arayüz notları (doğrulanmış)

Bu dosya `CLAUDE.md`'den taşındı (13.11.2026, her oturumun bağlam maliyetini düşürmek için). Kullanım:
- Her talimatta **hem masaüstü hem telefon** yolunu yaz. Aşağıda doğrulanmış olmayan bir menü adını kullanacaksan "emin değilim" de,
  kullanıcıdan doğrulamasını iste ve doğrulananı **bu dosyaya** tarihle işle (commit + push).
- Çekirdek kurallar (sembol, ölçek, saat dilimi, fib düzeni, risk kuralı) `CLAUDE.md` "Sabit kurallar"da da durur; çelişki olursa orası geçerli.

## Notlar (taşınan metin, değiştirilmedi)

**TradingView talimatı (eğitim/pratik):** Kullanıcı çoğu zaman telefondan çizer. Her TradingView talimatında
**hem masaüstü hem telefon uygulaması** yolunu yaz (ör. "Masaüstü: sol araç çubuğu → … · Telefon: alt menü → …").
Telefon menü adlarından emin değilsen öyle söyle, kullanıcıdan doğrulamasını iste ve doğrulananı buraya işle.
Standart ayar: sembol **OKX:BTCUSDT.P / OKX:ETHUSDT.P** (bot verisiyle aynı), **lineer** ölçek (log kapalı), saat
dilimi **UTC**. Çizimler hesapla eşitlenir; telefonda çizilen masaüstünde görünür. Pratik sayfası `pratik.html`.
**Doğrulanmış telefon arayüzü (iOS, 25.10.2026):** alt menü İzleme Listesi / Grafik / Keşfet / Topluluk / Menü; bir
çizimin ayar penceresi sekmeleri **Stil / Kordinatlar / Görünürlük**, sol altta "…" düğmesi, sağ altta İptal /
Tamam; fib aracının adı "Fib düzeltmesi". Kordinatlar sekmesinde noktaların fiyatı elle yazılabilir. Yatay
grafikte alt araç çubuğu: kalem (çizim) · göstergeler · düzen · … · + · alarm · mum tipi · tekrar oynat (⏪) ·
katmanlar · "…" · geri al; kaleme basınca grafiğin üstünde yüzen çizim çubuğu açılır (fib, çizgiler, kanal, ABCD,
Elliott, dikdörtgen, fırça, ok/yol). Sembol başlığı borsayı ele verir: OKX "…USDT Perpetual Swap Contract",
Binance "… / TetherUS PERPETUAL CONTRACT", Bybit "…USDT Perpetual Contract" (fitiller OKX'ten birkaç pip farklı;
ör. ARB 8 Eki dibi OKX 0,16142 / Bybit 0,16164 / Binance 0,15979). Kullanıcının TradingView indikatörleri (29.10): **ICT Killzones [LuxAlgo]**, **LuxAlgo - Smart Money Concepts**, LuxAlgo - Previous Highs & Lows, LuxAlgo - Fair Value Gap (öneri: SMC tek başına yeter; killzone yalnız 15m/1H; ayar sekmeleri Eingaben / Stil / Sichtbarkeit). Kullanıcının **masaüstü TradingView arayüzü Almanca** (28.10: üst çubuk Indikatoren / Alarm / **Wiedergabe** = Bar Replay). Telefonda grafiğe uzun basınca mum değerleri **A / Y / D / K** (açılış /
yüksek / düşük / kapanış) yazar; masaüstü İngilizce O / H / L / C. Telefon grafik ayarları → **Sembol** sayfası:
MUMLAR = Temel hat / Kenarlar / Fitil, her birinde iki kutu (sol yükselen, sağ düşen); renk seçici hex almaz:
10 sütun × 8 satır tablo (1. satır griler, 2. satır canlı renkler, altı açık→koyu tonlar), altında "+" (özel renk)
ve Şeffaflık kaydırıcısı. Renk tarifini "satır/sütun" ile ver. Standart palet (26.10'da uygulandı, okunaklı): yükselen 2/5 turkuaz, düşen 2/1
kırmızı, likidite 4/8 lavanta %80, kutular/fib 1/5 gri; arka plan ≈ #131722 (yoksa 1/8). Kullanıcı karanlık mod sever.
Telefon grafik ayarları → **Alarmlar**: "Grafik çizgisi görünürlüğü" → "Alarm çizgileri" kutusu (+ renk) ve
"Yalnızca etkin alarmları"; "Bildirimler" → "Tost bildirimleri otomatik olarak gizle". Kullanıcı alarm çizgilerini
kapattı (alarmlar çalışır). Alarm kurma: alt araç çubuğu → alarm simgesi. Kullanıcı işlemleri Bybit'te açar (uygulama İngilizce; doğrulandı 26.10: Futures → pozisyon → **TP/SL** penceresi, sekmeler **Entire Position / Partial Position**; Partial'da Qty/Proportion, TP ve SL Trigger Price (Last), "Exit at Market", **"Set SL at entry price after TP is filled"** kutusu = otomatik başa baş; kademeli çıkış: Entire'da TP2+SL, Partial'da TP1 adedi; tüm TP/SL'ler tek listede: Trade → **Orders** sekmesi (All Markets, "Close Short/Long" kartları); kapanan işlemler: Orders ekranı → geçmiş → **All Orders → P&L** sekmesi → Closed Positions (özet) / **Closed Orders** (her kademe ayrı)); Bybit **Trailing Stop** (doğrulandı 10.11, telefon): pozisyon kartı → Trailing Stop → "Set Trailing Stop": **Retracement** (By Distance, fiyat farkı) + **Activation Price** kutusu; kartta "Trailing Stop  Active: x  Retracement: y" satırı, SL ile birlikte durur. Aktivasyonsuz kurulursa izleme o andan başlar (geçmiş en iyi fiyatı bilmez). Deney B iz süren kol: Retracement = 1R, Activation = TP1 (1,5R), SL yerinde; kısmi TP'de "Set SL at entry price after TP is filled" işaretliyse Bybit Entire Position SL'sini DEĞİŞTİRMEZ; kalan adet için **Partial Position** sekmesinde ayrı bir "SL at Entry" etiketli SL (giriş fiyatı, Last, Market) açar — Entire SL eski yerinde yedek kalır (doğrulandı 12.11 STRK; 10.11 SAND/KAITO'da da muhtemelen böyleydi). Kontrol: TP/SL → Partial Position. Bybit küçük fiyatlı coinler çarpanlı (11.11): PEPE → 1000PEPEUSDT, SHIB → SHIB1000USDT, BONK → 1000BONKUSDT; mesajlarda "Bybit …" satırı hazır fiyat verir (`src/data/bybit-symbols.js`, düzeltme `BYBIT_MULT`). TradingView telefon Türkçe pozisyon aracı etiketleri: Hedef / Durdur / Kapalı K&Z / Mktr / Risk/ödül oranı; Bybit grafiği
için sembolde BYBIT seçili olmalı (OKX ile karışabiliyor). Gerçek para sorularında modül 03 kuralı: %1 risk (ters
işlem/hafta sonu/ilk işlem → %0,5), adet = risk $ ÷ (giriş − stop), izole marjin, kaldıraç yalnız teminatı belirler.
**Fib düzeni:** TradingView'da dipten tepeye çekilen fib'te 0 = tepe, 1 = dip (geri çekilme tepeden ölçülür).
Sayfalarda ve cevaplarda hep bu düzeni kullan. Kullanıcının varsayılan fib ayarı Elliott'a göre; SMC için şablon
("SMC Çeyrek": 0/0,25/0,5/0,75/1 · "SMC OTE": 0/0,5/0,618/0,705/0,786/1) kullanılır, varsayılan değiştirilmez.
