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

## Telegram sinyal botu (15 dakikada bir, GitHub Actions)

`bot/run.mjs` aynı tarama motorunu Node ile koşturur, kural motorundan plan çıkarır (giriş bölgesi, stop, TP1, TP2, R:R),
planı **Claude**'a değerlendirtir (take / wait / skip, güven, gerekçe, kanıt, geçersizlik) ve Telegram'a gönderir.
Gönderilen planlar takip edilir: giriş bölgesine geldi → TP1 → TP2 / stop / süresi doldu güncellemeleri ve günlük özet.

**Zaman dilimine göre kurallar** (`TF_RULES`, JSON ile ezilebilir): 15m → puan ≥ 75, MTF zorunlu, ADX ≥ 35 ve ±DI yön
uyumu, fiyat EMA200'ün doğru tarafında, 12 saat cooldown, tur başına en fazla 1 mesaj · 1H → puan ≥ 70, MTF, ADX ≥ 25
· 4H → puan ≥ 65. Örnek: `{"15m":{"minScore":80},"4H":{"requireMtf":true}}`.
Genel kurallar: en iyi küme puanı ≥ `MIN_SCORE` (70) ve **MTF uyumu** (`REQUIRE_MTF=1`: en az iki zaman dilimi aynı yön),
stop bölge kenarının ötesinde, TP2 için R:R ≥ `MIN_RR` (2), fiyat bölgeye en fazla 3 ATR uzakta, risk fiyatın ≤ %5'i,
aynı sembol+yön+TF 6 saat içinde tekrar gönderilmez. Tur başına en fazla `MAX_EVAL` (8) aday değerlendirilir,
en fazla `MAX_ALERTS` (3) mesaj gönderilir. **Sinyal botunda Claude varsayılan olarak kapalıdır** (`SEND_CLAUDE=0`):
250 planlık örneklemde Claude'un take/wait ayrımı kural motoruna göre fark yaratmadı; Claude yalnızca ajanda çalışır.
Kapalıyken karar kural motorundandır (güven: MTF + ADX yön uyumu varsa "orta", yoksa "düşük"; gerekçe = aynı bölgedeki
yapılar + trend özeti) ve mesaj başlığında "(kural motoru)" yazar. `SEND_CLAUDE=1` ile Claude değerlendirmesi açılır:
`SEND_WAIT` (vars. `high`) `take` her zaman, `wait` yalnız yüksek güvenle gönderilir (`medium`: orta+yüksek, `none`:
yalnız take); Claude'un önerdiği seviyeler kurallara uymazsa kural motorunun seviyeleri kullanılır ve mesajda belirtilir.
**Otomatik emir yoktur; sadece bildirim.**

### Kurulum (bir kez)
1. Repo → **Settings → Secrets and variables → Actions → Secrets**:
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (crypto-scanner'daki bot kullanılabilir)
   - `ANTHROPIC_API_KEY` (ajan için; sinyal botu `SEND_CLAUDE=1` değilse kullanmaz)
   - `ACCOUNT_USDT` (isteğe bağlı; pozisyon büyüklüğü hesabı için hesap tutarı)
2. İsteğe bağlı **Variables**: `SCAN_TFS` (vars. `15m,1H,4H`), `TOP_N` (100), `MIN_SCORE` (50), `MIN_RR` (2),
   `REQUIRE_MTF` (1), `RISK_PCT` (1), `MAX_RISK_PCT` (5), `MAX_EVAL` (8), `MAX_ALERTS` (3), `SEND_CLAUDE` (0), `SEND_WAIT` (high), `COOLDOWN_H` (6), `SUMMARY_HOUR_UTC` (6).
3. **Actions** sekmesinde `scan-and-alert` workflow'unu bir kez **Run workflow** ile elle başlat (önce `dry` işaretli
   deneyip logda mesajları görebilirsin). Sonra her 15 dakikada kendi koşar (GitHub cron'u birkaç dakika geciktirebilir).

Durum dosyası (`bot/state.json`) çalıştırmalar arasında Actions cache ile taşınır; repo'ya commit edilmez.

### Sinyal geçmişi
Gönderilen her setup ve takip sonucu `docs/signals/history.json`'a yazılır (her koşuda commit) ve **`signals.html`**'de
görünür: kaçı giriş bölgesine geldi, kaçı TP1/TP2 gördü, kaçı stop oldu / süresi doldu / kaçtı; TF, yön, karar, güven ve
aya göre kırılım; filtrelenebilir tam liste. Gerçekleşen R varsayımı backtest ile aynı (TP1'de yarı, başabaş stop).

### GitHub cron güvenilirliği
GitHub'ın zamanlayıcısı "elinden geleni yapar": yoğun saatlerde dakikalarca gecikebilir, bazı tetiklemeler hiç
düşmeyebilir ve yeni eklenen bir workflow'un ilk zamanlanmış koşusu saatler sürebilir. Bildirim botu için genelde
yeterlidir; daha düzenli istiyorsan ücretsiz bir dış zamanlayıcı (ör. **cron-job.org**) her 15 dakikada workflow'u
elle tetikleyebilir:

- URL: `https://api.github.com/repos/mugiatama34/crypto_technical_analysis/actions/workflows/scan.yml/dispatches`
- Yöntem: `POST`, gövde: `{"ref":"claude/awesome-heisenberg-mmuyod"}`
- Başlıklar: `Authorization: Bearer <GitHub fine-grained PAT, bu repo için Actions: Read and write>`,
  `Accept: application/vnd.github+json`, `Content-Type: application/json`

İki tetikleme çakışırsa `concurrency` grubu sayesinde ikincisi birincinin bitmesini bekler; durum dosyası bozulmaz.

### Yerel deneme
```bash
DRY=1 node bot/run.mjs                 # OKX'ten çeker, Telegram/Claude'a gitmez, mesajları konsola yazar
FIXTURE=1 DRY=1 node bot/run.mjs       # sentetik veriyle
```

### Maliyet
Claude yalnızca kural filtresini geçen adaylar için çağrılır (tur başına en fazla `MAX_ALERTS`); çağrı başına
birkaç bin token. Sessiz piyasada çoğu tur sıfır çağrı yapar.

## Kâğıt-işlem ajanı (`bot/agent/`, `agent.html`)
Her 15 dakikalık koşuda, sinyal botunun yanında iki sanal hesap işlem yapar (**temkinli**: maks 10x, marjin ≤ %40
özsermaye, ≤ 3 pozisyon · **agresif**: maks 20x, ≤ %60, ≤ 5 pozisyon; ikisi de 300 USDT ile başlar). Claude portföy
yöneticisi olarak hesabı, açık pozisyonları (gerçekleşmemiş K/Z, likidasyon uzaklığı), kural motorunun adaylarını, son
işlemlerini ve derslerini görür; **giriş büyüklüğü, kaldıraç, piyasa/limit, stop ve hedefleri kendisi seçer**; kod yalnızca
sert sınırları uygular (aşan istek kırpılır, günlük kayıp %15'i geçince o gün yeni pozisyon açılmaz).
- Simülasyon: izole marjin, likidasyon fiyatı = giriş × (1 ∓ (1/kaldıraç − %0,5)), komisyon %0,05/taraf, kayma %0,05,
  TP1'de yarı kapanış + başabaş stop, aynı mumda kötü olan önce, 24 saatte dolmayan limit düşer. Funding yok.
- Öğrenme: her kapanan işlemde kısa **yansıma** (ders) yazılır; her 20 kapanan işlemde ya da 7 günde bir **gözden geçirme**
  dersleri süzer (≤ 10) ve parametreleri (risk iştahı, kaldıraç aralığı, marjin/işlem, kaçınılan TF/detektör) sınır içinde
  günceller. Hafıza sonraki her karara girer; sayfada parametre geçmişi görünür.
- Telegram: `🤖 Ajan [profil]` başlığıyla açılış, dolum, kapanış/likidasyon, gözden geçirme ve günlük özet.
- Sayfa: **`agent.html`** (`docs/agent/<profil>.json`, her koşuda değişince commit edilir).
- Ayarlar (Variables): `AGENT` (1/0), `AGENT_MODEL` (vars. `claude-opus-5-5`; `claude-sonnet-5-5` yarı maliyet),
  `AGENT_EVERY_MIN` (15; karar sıklığı — pozisyon takibi her koşuda), `AGENT_MIN_SCORE` (60; ajanın aday eşiği, MTF zorunlu değil).
- Maliyet: profil başına koşuda 1 karar çağrısı (yalnız aday ya da pozisyon varsa) ≈ 5–8k token; Opus ile günde ≈ 5–8 $,
  Sonnet ile yarısı; `AGENT_EVERY_MIN=60` ile dörtte biri.

## Backtest
`backtest/` walk-forward simülasyon: her adımda yalnızca o ana kadarki mumlarla detektörler + plan çıkarma koşar
(`bot/plan.js` ile aynı kurallar), plan ileriye simüle edilir. Dolum kuralları: limit giriş bölge kenarından, piyasa giriş
(fiyat bölgedeyken) sonraki mumun açılışından + kayma; TP1'de yarısı kapanır ve stop başabaşa çekilir; aynı mumda stop ve
hedef varsa stop sayılır; komisyon iki taraf; 24 saatte dolmayan plan düşer; dolumdan sonra en fazla 200 mum.

- **Çalıştırma:** Actions → **backtest** → Run workflow (ay, coin sayısı, TF'ler, komisyon, kayma, Claude örneklem sayısı).
  Veri OKX `history-candles` ile çekilir ve Actions cache'te saklanır; rapor `docs/backtest/results.json` olarak dala
  commit edilir ve **`backtest.html`** sayfasında görüntülenir.
- **Claude örneklemi:** `claude_sample` > 0 verilirse rastgele N plan Claude'a yorumlatılır (`ANTHROPIC_API_KEY` secret'ı),
  take / wait / skip gruplarının gerçek sonucu kıyaslanır (≈ 4 sent / plan).
- **Parametre taraması:** `backtest/sweep.mjs` son koşunun planlarını farklı stop (+0,3/0,6/1,0 ATR), hedef şeması
  (TP1 yarı + başabaş, başabaşsız, tek hedef 2R/3R, ATR izleyen stop), giriş tipi, trend filtresi (ADX, EMA200),
  puan eşiği, TF alt kümesi, grup dışlama/zorunluluk ve MTF vekiliyle yeniden simüle eder; eğitim diliminde en iyi
  4 tek değişikliğin birleşimlerini de dener. Rapor **`sweep.html`** (`docs/backtest/sweep.json`). Workflow'da
  `mode: sweep` yalnız taramayı koşar (son planlar Actions cache'ten), `full` önce yeniden koşar.
- **Öğrenilen puan:** `backtest/learn.mjs` planları özelliklere çevirir (hangi detektör/grup var, sinyal sayısı, puan,
  risk %, TF, yön, giriş tipi, ADX kovası ve yön uyumu, EMA200 tarafı, üst TF uyumu, saat dilimi) ve L2 cezalı lojistik
  regresyonla "R > 0" olasılığını öğrenir (eğitim ilk 2/3). Rapor `backtest.html` → "Öğrenilen puan": doğrulama
  desilleri ve katsayılar. Kabul koşulu (doğrulamada en üst %20: ort. R > 0, PF > 1,1, n ≥ 100) sağlanırsa
  `src/scan/learned.json` yazılır ve bot adayları bu olasılıkla da süzer (`MODEL_MIN_PROB`: 0 kapatır, boş = modelin eşiği).
- **Strateji laboratuvarı:** tarama ve öğrenilen puan aynı giriş-çıkış iskeletini (bölge kenarı giriş, dar stop, sabit
  R hedef) paylaştığı için `backtest/lab/` farklı aileleri aynı simülasyon ve raporla yan yana koşar: `donchian`
  (20 bar kırılımı + ADX ≥ 25 yön uyumu, 2 ATR stop, 2 ATR izleyen stop; 1H/4H), `meanrev` (EMA20'den ≥ 2 ATR sapma,
  EMA200 yönünde, hedef EMA20; 1H/4H), `sweep_reclaim` (o ana kadarki onaylı pivotlardan eşit dip/tepe süpürülüp kapanışla
  geri alınırsa; stop fitil ötesi, TP1 karşı eşit seviye ya da 2R, TP2 3R; 15m/1H/4H) ve kontrol grubu `engine_wide`
  (mevcut motor puan ≥ 60 + ADX ≥ 25, ama 2 ATR stop ve izleyen çıkış). 2. tur (1. turda 4H ve long kesitleri pozitif
  çıkınca): `donchian_4h_long` (yalnız 4H long, EMA200 üstü), `donchian_4h_long_htf` (+ günlük EMA50 üstü; 1D mumlar
  ayrıca çekilir), `meanrev_long`, `engine_wide_4h`; `sweep_reclaim` 15m'den çıkarıldı (PF 0,57). Kırılımlar (TF, yön,
  TF × yön, ay) eğitim/doğrulama ayrı raporlanır. **Elliott diyagonalleri** (`backtest/lab/diagonal.js`, ders
  "Diyagonaller"): `ending_diagonal` (trend sonunda kural motorunun geçerli saydığı daralan kama; 5. dalga 1-3 çizgisinin
  dışına fitil atıp gövde kamanın içine kapanınca ters yönde piyasa girişi; stop 5. dalga ucu + 0,2 ATR; TP1 diyagonal
  başı, TP2 başın ötesi; TP1 ≥ 2R şartı) ve `leading_diagonal` (uzun trend ucunda başlayan diyagonal tamamlanınca
  2. dalganın %61,8'ine 5 gün geçerli limit; stop diyagonal başının ötesi; TP1 1. dalga tepesi, TP2 giriş + 1,618 × (1);
  TP2 ≥ 2R). Dersin 15m PO3 tetiği modellenmez; throw-over mumunun kapanışı tetiktir. Girişler sinyal mumundan sonraki açılıştan
  (piyasa + kayma); aynı coinde işlem sürerken yeni sinyal alınmaz. Kabul: doğrulamada ort. R > 0, PF > 1,1, n ≥ 100 →
  raporda "aday" (n 50–99: "zayıf aday"). Workflow'da `mode: lab`; rapor **`lab.html`** (`docs/backtest/lab.json`). Yeni aile eklemek için
  `backtest/lab/strategies.js`'e `{ id, label, tfs, exit, prepare, signal }` nesnesi eklenir.
- **Yerel:** `node backtest/run.mjs --months 6 --top 50 --tfs 15m,1H,4H` (OKX erişimi gerekir); `--fixture` sentetik veri;
  `node backtest/sweep.mjs --fixture --in <plans klasörü>`; `node backtest/lab/run.mjs --fixture --top 6`.
- **Sınırlar:** evren bugünkü hacim sıralamasıdır (sağ kalanlık yanlılığı); 15m geçmişi OKX'in verdiği kadardır (~3 ay);
  bot'taki MTF uyumu backtest'te uygulanmaz (her TF bağımsız); dönemin son 1/3'ü doğrulama olarak ayrı raporlanır,
  ağırlıklar yalnızca ilk 2/3'e bakılarak ayarlanmalıdır.

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
bot/                       run.mjs (cron akışı), plan.js (plan/takip), brain.js (Claude), telegram.js
bot/agent/                 profiles.js (sert sınırlar), account.js (kâğıt hesap), manager.js (Claude), run.js (akış)
agent.html                 ajan sayfası (docs/agent/*.json)
backtest/                  data.js, engine.js, report.js, run.mjs, brain-sample.mjs, sweep.mjs, features.js + learn.mjs (öğrenilen puan), lab/ (strateji laboratuvarı)
signals.html               sinyal geçmişi ve istatistik (docs/signals/history.json)
sweep.html                 parametre taraması sayfası (docs/backtest/sweep.json)
lab.html                   strateji laboratuvarı sayfası (docs/backtest/lab.json)
backtest.html              rapor sayfası (docs/backtest/results.json)
tests/                     node --test
```

## Kaynaklar ve lisans
MIT. Elliott Wave kural motoru, dalga-3 / üçgen tarayıcıları ve OKX istemcisi
[klonnist/ew-setup-scanner](https://github.com/klonnist/ew-setup-scanner) (MIT) kopyasından alınmıştır
(`LICENSE-ew-scanner`). Grafik: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/).
