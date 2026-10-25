# Kripto TA Tarayıcı

OKX USDT perp piyasalarını (hacme göre ilk 50/100/200 ya da elle liste) birden çok zaman diliminde
(1m, 5m, 15m, 1H, 4H, 1D) tarayıp teknik analiz yapılarını otomatik bulan, aynı fiyat bölgesinde üst üste
gelen yapıları **confluence puanı** ile sıralayan statik bir web sayfası. Kurulum yok, build yok, sunucu yok:
tarayıcı veriyi doğrudan OKX public API'sinden çeker.

**Canlı sayfa:** `https://mugiatama34.github.io/crypto_technical_analysis/` (GitHub Pages — aşağıdaki adımla açılır)

> Yatırım tavsiyesi değildir. Otomatik yapı tespiti hatalı olabilir; grafiği kendin kontrol et.

## Devam etmek için (yeni sohbet)
Yeni bir Claude Code oturumunda "devam edelim" demek yeter: kökteki `CLAUDE.md` proje belleğidir (otomatik okunur) ve
`docs/DURUM.md` tarihli durum günlüğüdür (bulgular, canlı ayarlar, açık işler, sıradaki adım). Oturum sonunda DURUM.md
güncellenir. Eğitim notları: `docs/egitim/` (SMC / price action, arkadaşın yöntemi, örnekler, ölçüm, rutin); aynı içeriğin
sekmeli, bol grafikli hali `egitim.html` (8 sekme: SVG mum çizimleri, XRP kurulumu adım adım oynatıcı, pozisyon ve
beklenti hesaplayıcı, risk/şans simülasyonları, 9 soruluk grafikli alıştırma; harici bağımlılık yok, yalnız Google Fonts).
Pratik: `pratik.html` BTC/ETH gerçek grafiklerinde adım adım işaretleme (Temiz/İşaretli, cevap anahtarı). Veri
`pratik.yml` (her sabah 06:20 UTC + elle) → `bot/practice/snapshot.mjs` → `docs/pratik/candles.json` (elle tetiklerken `extra=ARB,SOL` → `docs/pratik/extra/<COIN>.json`, 1H 720 mum); sayfa
`python3 bot/practice/build_page.py` ile şablondan (`bot/practice/pratik_template.html`) üretilir.

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
**Hepsi**, **ICT giriş**, **Elliott 3. dalga**, **EW diyagonal**, **EW zigzag**, **EW flat**, **EW düzeltmeler**,
**Harmonik PRZ**, **Kırılım**, **Dönüş**. "Detektörler ve ağırlıklar" panelinden her detektör ayrı ayrı açılıp
kapatılabilir ve ağırlığı değiştirilebilir ("Özel"). Elliott kalıbına özgü presetler yalnız kural motorunun geçerli
saydığı o kalıbın sayımlarını listeler (`detectorOpts.elliott.patterns`; dalga-3 setup'ları kapalı): diyagonal
(leading/ending, daralan/genişleyen; tamamlananda ters yön hedefi), zigzag (5-3-5; C hedefi ve tamamlanmış zigzag
sonrası trend yönü), flat (3-3-5; regular/expanded/running). Tek detektör olduğundan küme puanı düşüktür, eşik 20.

### Ekran görüntüsü yorumu
Sayfanın altındaki panele bir grafik görseli bırak / yapıştır, odak seç (genel, ICT, Elliott, Fib+harmonik,
formasyon) ve **kendi Anthropic API anahtarınla** yorum al. Anahtar yalnızca tarayıcının `localStorage`'ında
tutulur; istek doğrudan `api.anthropic.com`'a gider (sunucu yok). Anahtar yoksa görseli Claude sohbetine
yapıştırmak da olur.

## Telegram sinyal botu (15 dakikada bir, GitHub Actions)

`bot/run.mjs` aynı tarama motorunu Node ile koşturur, kural motorundan plan çıkarır (giriş bölgesi, stop, TP1, TP2, R:R),
planı **Claude**'a değerlendirtir (take / wait / skip, güven, gerekçe, kanıt, geçersizlik) ve Telegram'a gönderir.
Gönderilen planlar takip edilir: giriş bölgesine geldi → TP1 → TP2 / stop / süresi doldu güncellemeleri ve günlük özet.

**Zaman dilimine ve yöne göre kurallar** (laboratuvarda short her ailede negatif, 15m en kötü TF çıktı; kapatılmadı,
girişler sıkılaştırıldı). **BTC piyasa okuması** (`src/scan/regime.js` `marketRead`): günlük (kapanış vs EMA50), 4H ve
1H eğilimi (kapanış EMA50 tarafı + EMA50 eğimi + ADX ≥ 20 ile DI yönü; çelişirse "yatay"), 4 ve 24 saatlik getiri.
"BTC rejimiyle aynı yön" şartı TF'ye göre okunur: **15m/1H için 4H eğilimi** (yatayken şartlı yön yok → o TF'de sinyal
yok), **4H için günlük**. Böylece BTC saatlerce düşerken günlük rejim "yükseliş" dese de 1H short'lar açılabilir.
- **15m:** puan ≥ 80, MTF zorunlu, ADX ≥ 35 ve ±DI yön uyumu, EMA200'ün doğru tarafı, BTC rejimiyle aynı yön, 12 saat
  cooldown, tur başına en fazla 1 mesaj.
- **1H:** puan ≥ 70, MTF, ADX ≥ 25 yön uyumlu, EMA200 tarafı. **4H:** puan ≥ 65.
- **Short (tüm TF'ler, `SHORT_RULE`):** TF eşiği + 10 puan, MTF zorunlu, ADX ≥ 30 (TF'ninki daha yüksekse o) yön uyumlu,
  EMA200 tarafı, BTC rejimi düşüşte, 12 saat cooldown.
- Ajan adayları aynı yön kurallarını kullanır (puan eşiği 10 düşük). Elenme nedenlerinde "BTC rejimi ters" görünür.
- **BTC'ye göre göreli güç** (`src/scan/relative.js`): her satırda `trend.rsBtc` (coin/BTC oranının son 20 bardaki %
  değişimi) ve `trend.rsSide` (oran EMA50 üstünde +1 / altında −1). Tarayıcıda "vs BTC" çipi, Telegram gerekçesinde
  "BTC'ye göre 20 bar". Kural `rsBtc: "with"` (vars. kapalı): long yalnız BTC'den güçlü coinde (rsSide +1 ve rs > 0),
  short yalnız zayıfta. Örn. `SHORT_RULE={"rsBtc":"with"}` ya da `TF_RULES={"1H":{"rsBtc":"with"}}`.
- **BTC bağımlılığı ölçümü:** sinyal geçmişi `btcAtSend`/`btcAtClose`/`rsBtc`, ajan işlemleri `btcAtOpen`/`btcAtClose`/
  `btcPct` kaydeder; `signals.html` ve `agent.html` "BTC bağımlılığı" bölümünde BTC ters/lehte giderken sonuçlar ve
  R ~ BTC korelasyonu; laboratuvarda her aile için `byBtc` kırılımı ve BTC betası (`lab.html`). 12 ay 4H koşusunda
  tüm ailelerde r 0,55–0,74 ve BTC ±1% iken hepsi negatif çıktı: kazanç BTC'nin yönünden geliyordu. **Hedge'li R:**
  her işlemin yanına eşit nominalde ters BTC pozisyonu konmuş gibi (`hedgedR = R − d·BTC%/stop% − hedge komisyonu`);
  `hedged` istatistikleri aynı sıkı ölçütle "hedge'li aday" verir. Pozitifse coin seçiminde BTC'den bağımsız kenar var. Momentum laboratuvarı
  `rank: 'rel'` varyantları (BTC'ye göre fazla getiriyle sıralama: `xsmom_l28_k5_short_rel`, `_ls_rel`); canlı portföy
  `MOMENTUM_RANK=rel` ile aynı sıralamaya geçer (vars. `abs`).
- Ezme: `TF_RULES` (ör. `{"15m":{"minScore":85,"long":{"trendAdxMin":30}},"4H":{"requireMtf":true}}`; TF içinde
  `long`/`short` alt kuralı), `SHORT_RULE` (ör. `{"scoreAdd":5,"btcRegime":null}`).
- **Düşen bıçak koruması (`KNIFE_GUARD`, vars. kapalı):** limit giriş çoğu zaman fiyat bölgeye en sert geldiğinde dolar
  (ters seçim; canlı geçmişte gönderimden 4–24 saat sonra dolan 15 işlemin 15'i stop). Ölçü: dolum mumu dahil son 3 mumda
  giriş yönüne ters hareket ÷ ATR (`approachAtr`) ve dolum mumu boyu ÷ ATR (`fillBarAtr`). Hızlı gelişte (> 2 ATR ya da
  dolum mumu > 1,5 ATR) emir dolmaz → "teyit bekliyor"; sonraki 3 **kapanmış** mumda teyit mumu (long: kapanış bölge üst
  kenarı ya da önceki mumun tepesi üstünde; short ayna) gelirse o mumun kapanışından girilir, teyitten önce stop geçilirse
  plan iptal (`knife`, işlem yok), teyit gelmezse süresi dolar. Sinyal takibi ve ajan limit emirleri (15m mumlarla) aynı
  kuralı uygular. `KNIFE_GUARD=1` ya da JSON `{"maxApproachAtr":2,"maxFillBarAtr":1.5,"confirmBars":3,"skip":false}`
  (`skip`: teyit beklemeden atla). Backtest raporu ve tarama `byApproach` kırılımını (piyasa · yavaş < 1 ATR · orta 1–2 ·
  hızlı > 2) ve üç "düşen bıçak" varyantını gösterir (`sweep.html`); canlıda açmadan önce `mode: sweep` sonucuna bakın.
- **Kayıp kesici giriş kuralları (bayrakla):** `LIMIT_ONLY=1` (gönderim anında fiyat zaten bölgedeyse gönderme),
  `SKIP_WEEKEND=1` (UTC Cumartesi/Pazar yeni sinyal yok; açık planların takibi sürer), TF kapatma
  `TF_RULES={"15m":{"off":true}}` (tarama ve ajanın 15m takibi sürer). Alanlar TF/yön kuralı olarak da verilebilir
  (`limitOnly`, `skipWeekend`, `off`). 6 aylık hedefli taramada (doğrulama 28.08 sonrası) temel −0,132R iken
  düşen bıçak koruması + hafta sonu hariç + yalnız limit + yalnız 1H/4H birlikte +0,028R (PF 1,05, n 2 734; eğitim
  −0,032R). Etkiler toplanıyor ama sonuç başabaş ve çok varyant içinden seçildi: kenar değil, kayıp kesici; ileriye
  dönük kâğıt sonuçla doğrulanmalı.
- **Zaman stopu (`TIME_STOP`, vars. kapalı):** dolumdan N mum içinde TP1 görülmezse işlem mum kapanışından kapatılır
  (`TIME_STOP=8` ya da `{"bars":8,"minMfeR":0.5}` = 8 mumda en iyi hareket 0,5R'nin altındaysa). Mum, sinyalin
  kendi TF'si (15m: 15 dk, 1H: 1 saat, 4H: 4 saat). TP1 sonrası işlemler etkilenmez (stop zaten başabaşta). Sinyal
  takibi (`timeout` durumu, Telegram ⏱️) ve ajan pozisyonları aynı kuralı uygular. Tarama varyantları: 4 / 8 / 16 mum,
  "8 mumda MFE < 0,5R", en iyi düzenle birlikte 8 ve 16 mum; `sweep.html` "TP1'e ulaşma süresi" tablosu.
  6 ayda hiçbir zaman stopu varyantı temeli geçmedi (TP1'e ulaşanların ~%30'u 16 mumdan sonra ulaşıyor); kapalı tutun.
- **Erken kâr al (`EARLY_TP`, vars. kapalı):** `{"pct":1.2,"portion":0.8,"tfs":["4H"]}` = listedeki TF planlarında fiyat
  girişten %1,2 lehte gidince pozisyonun %80'i kapatılır, stop girişe çekilir, kalan %20 TP2'ye (TP1 kullanılmaz).
  Sinyal mesajında "⚡ Erken hedef" satırı; takip durumları `early` → `done` | `be`; sinyal sayfası R'si
  0,8 × erken R + 0,2 × (TP2 R | 0); ajan pozisyonları aynı kısmi kapanışı yapar. 12 aylık tam koşuda (1H/4H;
  doğrulama 13.07.2026 sonrası) düşen bıçak koruması + hafta sonu hariç + yalnız limit + bu yönetim **4H'de eğitim
  +0,064R (PF 1,29, n 1 404) / doğrulama +0,097R (PF 1,44, n 992)**; 1H ≈ 0. Tarama hedge'li R'yi (kısmi çıkışlı, eşit
  nominal ters BTC) ve R ~ BTC korelasyonunu da raporlar (`sweep.html` "Hedefli birleşimler — zaman dilimine göre");
  canlıya almadan önce 4H hedge'li doğrulama R'sine bakın.
- **Üst zaman dilimi eğilimi (`HTF_TREND`, vars. kapalı):** sistem üst TF'ye zaten iki yoldan bakar — MTF uyumu
  (taranan TF'lerden en az ikisinin *kurulum yönü* aynı; `REQUIRE_MTF`) ve BTC rejimi (`btcRegime`: 15m/1H → BTC 4H,
  4H → BTC günlük). Bu bayrak üçüncüsünü ekler: **coin'in kendi** bir üst TF eğilimi (15m→1H, 1H→4H, 4H→1D; EMA50
  tarafı + eğimi + ADX/DI, kapanmış mumlarla). `HTF_TREND=with` aynı yön ister, `notAgainst` yalnız ters trendi eler
  (yatay/veri yok geçer); TF/yön kuralı alanı `htfTrend` olarak da verilebilir. 4H için günlük mumlar yalnız adaylar
  için indirilir (tur başına ≤ 10). Tarama varyantları "üst TF eğilimi aynı yön / ters değil" ve temel kırılımı
  `byHtfTrend` (`sweep.html`); 6 ve 12 aylık koşularda "üst TF'de aynı yönde plan" filtresi kötüleştirmişti, eğilim
  filtresi ölçülmeden açılmaz.

### Fib kesişimi (0,618 × 1,272)
Bir itkiden (P0→P1) sonra ABC düzeltmesi: giriş bölgesi = itkinin **0,618 geri çekilmesi** ile düzeltmenin ilk bacağı
**A'nın B'den ölçülen 1,272 uzantısı** (C = 1,272 × A) aynı yerdeyse (≤ 0,5 ATR); yön itkinin yönü (düzeltme biter,
trend sürer). Stop itkinin 0,886'sının 0,2 ATR ötesi, hedef 1 itki ucu, hedef 2 itki ucu + 0,272 L. Diğer oranlar
(0,5/0,786 × 1,382/1,618) da kabul edilir; 0,618×1,272 öncelikli. Tarayıcıda "Fib kesişimi (0,618×1,272)" preseti
(`fibonacci.only='cluster'`) yalnız bu sinyali gösterir (giriş/stop/hedef çizgileriyle); diğer presetlerde de fib
grubunda yer alır. Laboratuvar aileleri `fib_cluster_c` (tüm oran çiftleri) ve `fib_cluster_c_strict` (yalnız
0,618×1,272, tol 0,3 ATR): fiyat bölgeye gelmeden limit emir, 24 saat geçerli, half_be çıkış.
24 ay 1H/4H sonucu (hedge'siz): loose eğitim −0,19R / doğrulama −0,12R (kazanma %22), strict −0,11 / −0,015R
(kazanma %35); dolum oranı %12–18 (sinyallerin yarısında fiyat bölgeye gelmeden itki ucunu geçiyor). Kenar yok.
Not: lab hedge'li R'si limit girişli ailelerde önceden sinyal mumundan hesaplanıyordu; artık dolum zamanından.

### SMC: süpürme → MSS → FVG %50 (arkadaşın kuralı)
Lab aileleri `sweep_mss_fvg*` (`backtest/lab/smc.js`): bir likidite seviyesi (swing tepe/dip, eşit tepe/dip, önceki günün
tepe/dibi) **fitille süpürülür** (kapanış seviyenin bu tarafında), ardından `maxBars` içinde (1H 12, 4H 6) ters yöne
**MSS** (kapanış son minör dip/tepeyi geçer), süpürme→MSS bacağında **FVG** varsa FVG'nin **%50'sine limit** (24 saat),
stop süpürme fitili ∓ 0,1 ATR, TP1 en yakın karşı likidite (**≥ 2R yoksa işlem yok**, ≤ 6R), TP2 sonraki likidite / 4R;
half_be çıkış. Üst dilim eğilimine ters işlemde `sizeMult` 0,5 (R ölçeklenir; `runStrategy`). Varyantlar: `_htf`
(yalnız üst dilim yönünde), `_btc` (yalnız BTC günlük rejimi yönünde; USDT.D verisi olmadığı için vekil), `_1r`
(1R'de yarı + başabaş, kalan likiditeye). Lab `needs: upper` ile coin'in üst TF mumlarını (15m→1H, 1H→4H, 4H→1D) sağlar.

### Denetçi ve araştırmacı ajanlar (`AUDIT=1`)
İki Claude ajanı sistemi gözetler; **hiçbiri kural değiştirmez**, yalnız öneri üretir (Variables'ı kullanıcı değiştirir).
- **Denetçi** (`bot/review`, günlük özet anında, günde bir çağrı): sinyal geçmişi (24s/7g/30g: dolum, stop, erken kâr, ort. R,
  BTC ters giderken R), ajan hesapları, momentum portföyü ve son taramadaki beklenti ile karşılaştırır; durum
  (`ok`/`watch`/`alert`), bulgular ve test edilebilir hipotezler üretir → Telegram "🕵️ Denetçi günlük rapor",
  `docs/agent/review.json`, hipotezler `docs/agent/research-queue.json`. Elle: Actions → scan-and-alert → `force_audit`. Acil hipotezde `backtest.yml mode=research`
  tetiklenir. Küçük örneklemde iddia yok (n < 30 → "izle"). `AUDIT_MODEL` (vars. claude-opus-5-5).
- **Araştırmacı** (`bot/research`, Pazar 06:00 UTC ve istek üzerine): kuyruktaki hipotezleri (boşsa standart komşu-eşik
  seti: erken hedef %1,0/%1,5, kapanış %70/%90, üst TF "ters değil", bıçak eşiği 1,5) canlı 4H düzeninin üstüne tarama
  varyantı olarak koşar (`sweep.mjs --variants --only`), sonucu sıkı ölçütle değerlendirir (confirmed = 4H'de eğitim ve
  doğrulama temelden iyi, hedge'li doğrulama > 0, n ≥ 100) → Telegram "🔬 Araştırmacı raporu", `docs/agent/research.json`;
  kuyruk `done` olur. `RESEARCH_MODEL`. İki ajan bu JSON dosyalarıyla haberleşir; `agent.html`'de "Denetçi" ve
  "Araştırmacı" sekmeleri.
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
  İşlem kârı (pnl, R) açılış + kapanış komisyonları düşülmüş nettir; kısmi kapanışta marjin kalan miktara oranla iade
  edilir (24.10.2026 düzeltmesi: önceki sürüm TP1 sonrası kapanışta marjinin çeyreğini iade etmiyordu, hesaplar onarıldı).
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
  TF × yön, ay) eğitim/doğrulama ayrı raporlanır. 3. tur: `engine_wide_4h_long` ve `meanrev_4h_long` (2. turda
  4H long kesitleri doğrulamada pozitif, short negatifti; `donchian_4h_long` ise eğitim +0,89R → doğrulama −0,02R ile
  aşırı uyum çıktı). **Elliott diyagonalleri** (`backtest/lab/diagonal.js`, ders
  "Diyagonaller"): `ending_diagonal` (trend sonunda kural motorunun geçerli saydığı daralan kama; 5. dalga 1-3 çizgisinin
  dışına fitil atıp gövde kamanın içine kapanınca ters yönde piyasa girişi; stop 5. dalga ucu + 0,2 ATR; TP1 diyagonal
  başı, TP2 başın ötesi; TP1 ≥ 2R şartı) ve `leading_diagonal` (uzun trend ucunda başlayan diyagonal tamamlanınca
  2. dalganın %61,8'ine 5 gün geçerli limit; stop diyagonal başının ötesi; TP1 1. dalga tepesi, TP2 giriş + 1,618 × (1);
  TP2 ≥ 2R); **Ders 2 (Zigzag ve flat)** `backtest/lab/corrections.js`: `zigzag_c` ((1) itkisinden sonra zigzag; C ≈ A
  (0,8–1,7) ve (1)'in 0,5–0,886 düzeltmesinde; dönüş mumuyla giriş; stop 0,786 ile C ucunun ötesi; TP1 (1) ucu ≥ 2R;
  TP2 C + 1,618 × (1)) ve `expanded_flat_c` (B (3)'ün ucunu geçer, C A ucunu kırar, mum A ucunun bu tarafına geri kapanır;
  stop C ucu ötesi; TP1 B ucu ≥ 2R; TP2 C + (3) boyu); iki yön, 1H/4H; ZigZag seri başına bir kez, `pivotsAsOf` ile
  yalnız o ana kadar onaylı pivotlar (hızlı, geleceğe bakmaz). Tarayıcıda EW zigzag / EW flat sayımları (C oluşurken)
  aynı seviyeleri Giriş/Stop/H1/H2 çizgileri ve not olarak gösterir. Koşu: `mode: lab, months: 24, tfs: 1H,4H,
  strategies: zigzag_c,expanded_flat_c`. İlk sonuç (24 ay): `zigzag_c` başa baş (doğr. −0,01R; hedge'li −0,10R),
  `expanded_flat_c` zararda (doğr. −0,30R, %80 stop). Varyantlar: `zigzag_c_1h_short` (tek tutarlı kesit, sonradan
  seçildiği için ayrı test) ve `expanded_flat_c_wide` (stop C ucu ∓ 1 ATR). `ending_diagonal_wide` stop tamponu 1 ATR (3. turda 0,2 ATR tamponla 55 işlemin 47'si stop oldu). Dersin
  15m PO3 tetiği modellenmez; throw-over mumunun kapanışı tetiktir. Girişler sinyal mumundan sonraki açılıştan
  (piyasa + kayma); aynı coinde işlem sürerken yeni sinyal alınmaz. Kabul: doğrulamada ort. R > 0, PF > 1,1, n ≥ 100 →
  raporda "aday"; 5. turdan itibaren sıkı ölçüt: eğitimde de ort. R > 0 **ve** doğrulamadan en iyi ay çıkarılınca ort. R > 0
  ("sağlam"); yalnız doğrulama ölçütünü tutan aile "zayıf" (12 ay 4H koşusunda dört long ailesi doğrulamada pozitif ama
  eğitimde sıfır/eksiydi: kazanç Ağustos–Eylül yükselişinden geliyordu). Rejim filtreli aileler (`*_btc`): yalnız BTC
  günlük kapanışı günlük EMA50 üstündeyken long (`withBtcRegime`, karar anında bilinir; rejim `src/scan/regime.js`).
  6. tur, **kesitsel momentum** (`backtest/lab/xsmom.js`, portföy düzeyi, 1D): her pazar kapanışında coinler son 28
  (ya da 14) günlük getiriye göre sıralanır, en güçlü 5'i (getirisi > 0) ertesi açılışta long; listede kalan tutulur,
  düşen çıkar; koruma 3 ATR izleyen stop. Varyantlar: `xsmom_l28_k5`, `xsmom_l14_k5`, `xsmom_l28_k5_btc` (BTC rejimi),
  `xsmom_l28_k5_ls` (+ en zayıf 5 short). Raporda portföy getirisi BTC ve eşit ağırlık al-tut ile kıyaslanır.
  Çalıştırma: `mode: lab, months: 24, tfs: 1D`. **Dönem evreni** (`universe: 150`): bugünün ilk 150 coini havuz olur,
  her yeniden dengelemede o tarihteki 30 günlük USDT hacmine göre ilk `top` (50) seçilir; "bugün ilk 50'de olan =
  geçmişte yükselmiş" yanlılığını azaltır (listeden kalkmış coinler yine yoktur). 7. turdan itibaren sıkı aday,
  eğitimden de en iyi ay çıkarılınca pozitif kalmalıdır. 8. tur: fonlama maliyeti (`--funding 0.01`, 8 saatte %0,01,
  ihtiyatlı olarak iki yöne de) ve `xsmom_l28_k5_short` (yalnız en zayıf 5 short). Workflow'da `mode: lab`; rapor **`lab.html`** (`docs/backtest/lab.json`). Yeni aile eklemek için
  `backtest/lab/strategies.js`'e `{ id, label, tfs, exit, prepare, signal }` nesnesi eklenir.
- **Yerel:** `node backtest/run.mjs --months 6 --top 50 --tfs 15m,1H,4H` (OKX erişimi gerekir); `--fixture` sentetik veri;
  `node backtest/sweep.mjs --fixture --in <plans klasörü>`; `node backtest/lab/run.mjs --fixture --top 6`; `--tfs 4H` yalnız o TF'leri çeker/koşar (workflow `tfs` girdisi; 4H
  motoru 600 mumluk pencere istediği için 4H kanıtı 12 ayla koşulmalı: `months: 12, tfs: 4H`).
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

### Ajanda piyasa okuması ve BTC trend adayı
Ajan her karar turunda BTC okumasını (günlük/4H/1H eğilim, ADX, 4s/24s getiri) ve hesabın yön istatistiğini
(long/short ort. R, **BTC ters giderken long'ların ort. R'si**) görür. BTC 4H eğilimi ile günlük rejim aynı yöndeyse adaylara
`source: btc_trend` ile BTC'nin kendisi eklenir (stop 2 ATR, hedef yok, izleyerek yönetilir). Sistem talimatı:
BTC 4H düşüşteyken altcoin long'a, yükselişteyken altcoin short'a şüpheyle bak; BTC trend takibi laboratuvarda henüz
doğrulanmadı, küçük marjinle dene. `agent.html`'de "BTC trend" etiketi. Laboratuvarda `btc_tsmom_1h` / `btc_tsmom_4h`
(yalnız BTC ve ETH; EMA50 tarafı + eğim + ADX ≥ 20 + Donchian 20, 2 ATR izleyen) aynı sıkı ölçütle test edilir:
`mode: lab, months: 24, tfs: 1H,4H, strategies: btc_tsmom_1h,btc_tsmom_4h` (`strategies` girdisi boşsa tüm aileler koşar;
1H'te 50 coinin tüm aileleri saatler sürer). Sonuç (24 ay): 1H doğrulama −0,17R PF 0,71, 4H −0,15R PF 0,76, eğitimde
başa baş → BTC'nin saatlik/4H yönü bu kuralla öngörülemiyor; ajana BTC trend adayı yalnız 4H eğilimi ile günlük rejim
aynı yöndeyken sunulur.

### Ajanda BTC hedge seçeneği
Ajan `open` eyleminde `hedge: true` diyebilir: aynı anda eşit nominalde **ters BTC bacağı** açılır (aynı marjin ve
kaldıraç, stop likidasyonun %90 içinde, hedef yok, `hedgeOf` ile ana pozisyona bağlı). Ana pozisyon kapanınca bacak aynı
turda piyasa fiyatından kapanır; limit emirlerde bacak dolumda açılır. Hedge bacakları pozisyon sayısına girmez; marjin
sınırı ana + bacak toplamına uygulanır. Sistem talimatı laboratuvar bulgusunu söyler (4H kurulumlarının kazancı BTC'nin
yönüydü); hedge'leyip hedge'lememek Claude'un kararıdır. `agent.html`'de "hedge'li" / "hedge bacağı" etiketleri.

## Momentum kâğıt portföyü (`bot/momentum/`, `momentum.html`)

Laboratuvarda dönem evreniyle sıkı ölçütü geçen tek aile kesitsel momentumdu (28 günlük getiri; en güçlü 5 long + en
zayıf 5 short; asıl tutarlı ayak short). Geçmiş test sağ kalanlık yanlılığını tamamen temizleyemediği için asıl kanıt
ileriye dönük kâğıt testidir. Repo → Settings → Variables: `MOMENTUM=1` ile açılır (`MOMENTUM_VARIANT`: `ls` vars.,
`short`, `long`).

- Seçim kuralı laboratuvarla aynı fonksiyondur (`backtest/lab/xsmom.js`: `momentumAt` + `selectAt`).
- Her pazartesi 00:00 UTC'den sonraki ilk turda evren: 24 saatlik hacimde ilk 80 coinden o anki 30 günlük hacme göre
  ilk 50 (laboratuvarın `pitN` kuralı). Çıkan kapanır, giren açılır (o anki fiyat + kayma). Sanal 300 USDT.
- **Eşit risk boyutlama:** her pozisyon stop'a kadar özsermayenin %2'sini riske eder: nominal = %2 × özsermaye ÷ stop
  uzaklığı, üst sınır özsermaye / slot (laboratuvarın R ölçüsüyle tutarlı). Örn. stop %25 uzaktaysa 24 USDT, %160
  uzaktaysa ~4 USDT. Listede kalan pozisyon her yeniden dengelemede hedefe çekilir (sapma ≥ %20 ise; azaltılan kısmın
  K/Z'si gerçekleşir). İlk sürüm eşit nominal (60 USDT) açmıştı; bu pozisyonlar ilk yeniden dengelemede uyarlanır.
- Her turda: 3 ATR izleyen stop (kapanmış günlük mumla güncellenir), fonlama tahakkuku (8 saatte %0,01).
- Telegram: başlangıç, haftalık yeniden dengeleme (giren/çıkan), stop olan pozisyonlar, günlük özete portföy satırı.
- Durum `bot/momentum-state.json` (Actions cache), sayfa verisi `docs/agent/momentum.json`; sayfa **`momentum.html`**
  (özsermaye eğrisi, BTC al-tut kıyası, açık pozisyonlar, yeniden dengelemeler, işlemler).
- Açıldığı ilk turda hemen bir yeniden dengeleme yapar (hafta ortasında başlayabilir).
- **BTC hedge (piyasa-nötr):** `MOMENTUM_HEDGE=1` ile alt pozisyonların net maruziyetine eşit **ters BTC bacağı**
  tutulur (stop yok, fonlama işler); her yeniden dengelemede ve bir alt stop olduğunda hedefe çekilir. `MOMENTUM_RANK=rel`
  ile birlikte laboratuvarda hedge'li kesitlerin tamamında pozitif kalan tek aile (`xsmom_l28_k5_short_rel`) canlıya
  taşınmış olur. Sayfada "alt net maruziyet" ve hedge satırı görünür.
