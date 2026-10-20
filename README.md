# Kripto TA Tarayıcı

OKX USDT perp piyasalarını (hacme göre ilk 50/100/200 ya da elle liste) birden çok zaman diliminde
(1m, 5m, 15m, 1H, 4H, 1D) tarayıp teknik analiz yapılarını otomatik bulan, aynı fiyat bölgesinde üst üste
gelen yapıları **confluence puanı** ile sıralayan statik bir web sayfası. Kurulum yok, build yok, sunucu yok:
tarayıcı veriyi doğrudan OKX public API'sinden çeker.

**Canlı sayfa:** `https://mugiatama34.github.io/crypto_technical_analysis/` (GitHub Pages — aşağıdaki adımla açılır)

> Yatırım tavsiyesi değildir. Otomatik yapı tespiti hatalı olabilir; grafiği kendin kontrol et.

## Neler var

| Grup | Detektör | İçerik |
|---|---|---|
| ICT / SMC | `structure` | Swing etiketleri (HH/HL/LH/LL), **BOS**, **CHoCH**, trend, premium/discount, denge (EQ), **OTE** bölgesi |
| | `fvg` | **Fair Value Gap** (açık / kısmen dolu / dolu), **inversion FVG** |
| | `orderblock` | **Order block** (yer değiştirme öncesi son ters mum), mitigation, **breaker block** |
| | `liquidity` | **Eşit tepe/dip** havuzları, **likidite süpürmesi** (BSL/SSL), kırılım, PDH/PDL, PWH/PWL |
| Fibonacci | `fibonacci` | Son bacakların geri çekilme (0.382–0.886) ve uzantı (1.272–2.618) seviyeleri, iki bacak **çakışması** |
| Elliott Wave | `elliott` | **Dalga-3 giriş setup'ları** (dalga 2 = ABC, kırılım ve limit bölge planı) + kural motoruyla sayım: itki, diagonal, zigzag, flat, üçgen, WXY (F&P / Neely / Kurs kural setleri), hedef ve geçersizlik |
| Formasyonlar | `patterns` | İkili/üçlü tepe-dip, **omuz-baş-omuz** (+ters), simetrik/genişleyen üçgen, rising/falling **wedge**, dikdörtgen, kanal, **bayrak**, fincan-kulp |
| | `triangles` | **Yükselen / alçalan üçgen** ve kırılımları (ölçülü hareket + fib hedefleri) |
| Harmonik | `harmonic` | **Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, Cypher, AB=CD** — tamamlanmış ya da PRZ projeksiyonu |
| Mum | `candlesticks` | Engulfing, hammer / shooting star / pin bar, doji, inside bar, morning / evening star, three soldiers / crows |
| Uyumsuzluk | `divergence` | RSI / MACD / OBV **regular ve gizli** uyumsuzluk |
| Wyckoff | `wyckoff` | Yatay aralıkta **spring**, **upthrust**, SOS, SOW |
| İndikatör | `indicator` | EMA 9/21 ve 50/200 kesişimi, EMA200, **Bollinger/Keltner sıkışması** ve kırılımı, Supertrend, Donchian, Ichimoku (kumo, TK), RSI, Stoch RSI, MACD, ADX, hacim patlaması, VWAP, hacim profili (POC/VAH/VAL), Andrews pitchfork |

Her detektör saf bir fonksiyondur: `detect(ctx) → Signal[]`. Sinyal = tür, yön, güç (0–1), fiyat bölgesi,
durum (aktif / oluşuyor / tetiklendi / dokunulmuş), geçersizlik, hedef, açıklama ve grafik çizim talimatları.

### Confluence puanı
Bir sembol + zaman diliminin sinyalleri fiyat bölgesine göre kümelenir (0,5 × ATR tolerans). Küme puanı:
sinyal gücü × detektör ağırlığı × durum ağırlığı; aynı detektörün tekrarları azalan katkıyla sayılır; farklı
grupların aynı bölgede buluşması bonus alır; fiyata uzaklık ve küme genişliği ceza alır. Aynı sembolde birden
çok zaman dilimi aynı yönü gösteriyorsa **MTF** rozeti ve bonus verilir.

### Presetler
**Hepsi**, **ICT giriş**, **Elliott 3. dalga**, **Harmonik PRZ**, **Kırılım**, **Dönüş**. "Detektörler ve
ağırlıklar" panelinden her detektör ayrı ayrı açılıp kapatılabilir ve ağırlığı değiştirilebilir ("Özel").

### Ekran görüntüsü yorumu
Sayfanın altındaki panele bir grafik görseli bırak / yapıştır, odak seç (genel, ICT, Elliott, Fib+harmonik,
formasyon) ve **kendi Anthropic API anahtarınla** yorum al. Anahtar yalnızca tarayıcının `localStorage`'ında
tutulur; istek doğrudan `api.anthropic.com`'a gider (sunucu yok). Anahtar yoksa görseli Claude sohbetine
yapıştırmak da olur.

## GitHub Pages'i açma (bir kez)
1. Repo → **Settings → Pages**.
2. **Source:** "Deploy from a branch"; **Branch:** `main`, klasör `/ (root)` → Save.
3. Birkaç dakika sonra `https://mugiatama34.github.io/crypto_technical_analysis/` yayında olur.
   (Başka bir dalı yayınlamak istersen branch seçiminde onu seç.)

## Yerel çalıştırma
Herhangi bir statik sunucu yeter (ES module'ler `file://` ile çalışmaz):
```bash
python3 -m http.server 8000
# http://localhost:8000/index.html
# OKX'e erişimin olmayan ortamda sentetik veri: http://localhost:8000/index.html?fixture=1
```

## Testler
```bash
node --test tests/*.test.js
```
Her detektör için elle kurgulanmış mum serileri (bilinen FVG, OB, eşit tepe süpürmesi, Gartley oranları,
OBO, wedge, spring…), rastgele yürüyüşte hata vermeme testi ve fixture sağlayıcıyla uçtan uca tarama testi.

## Dosya yapısı
```
index.html                 sayfa
src/ui/                    app.js (akış), chart.js (Lightweight Charts çizimi), screenshot.js, settings.js, styles.css
src/data/okx.js            OKX istemcisi (hız sınırı, retry, sayfalama)  ·  fixture.js (sentetik veri)
src/data/indicators.js     EMA/SMA/RSI/MACD/BB/Keltner/Donchian/Stoch/ADX/OBV/VWAP/Supertrend/Ichimoku/hacim profili
src/core/zigzag.js         ATR tabanlı swing noktaları  ·  signal.js  Signal tipi
src/detectors/*.js         detektörler (yukarıdaki tablo)
src/scan/                  context.js (ortak ön hesap), registry.js, scoring.js (confluence), scanner.js, presets.js,
                           wave3.js / triangle.js / zone.js (Elliott dalga-3 ve üçgen tarayıcıları)
src/ew/                    Elliott Wave kural motoru (kalıplar, kurallar, F&P / Neely / Kurs setleri)
lib/                       lightweight-charts 5.2.1 (Apache-2.0)
tests/                     node --test
```

## Kaynaklar ve lisans
MIT. Elliott Wave kural motoru, dalga-3 / üçgen tarayıcıları ve OKX istemcisi
[klonnist/ew-setup-scanner](https://github.com/klonnist/ew-setup-scanner) (MIT) kopyasından alınmıştır
(`LICENSE-ew-scanner`). Grafik: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/).
