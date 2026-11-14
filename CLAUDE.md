# CLAUDE.md — proje belleği (her oturumda önce bunu oku)

Bu repo Ferhat'ın kripto teknik analiz platformu: GitHub Pages tarayıcı, Telegram sinyal botu (15 dk'da bir, GitHub
Actions), kâğıt-işlem Claude ajanları, haftalık momentum kâğıt portföyü, backtest/tarama/laboratuvar, denetçi ve
araştırmacı ajanlar. **Her şey kâğıt (sanal) işlem; gerçek emir yok ve eklenmez.** Dil Türkçe. Kullanıcı makine
mühendisi; kısa, net, sayılı cevap ister; kararları (Variables, canlı kural değişikliği) kendisi verir.

## "Devam edelim" protokolü (yeni sohbet)
1. `docs/DURUM.md`'yi oku (üstte "Güncel durum" özeti + son günlük). Eski günlük `docs/DURUM-arsiv.md` dosyasında: baştan sona
   OKUMA, gerektiğinde `grep` ile bak.
2. Son koşuları kontrol et: `docs/agent/review.json` (denetçi), `docs/agent/research.json` (araştırmacı),
   `docs/backtest/{sweep,lab,results}.json` `meta.generatedAt/sweepAt`, `docs/signals/history.json` (canlı sinyaller).
   Gerekirse `gh run list --workflow scan.yml --limit 3` / `backtest.yml`.
3. Kullanıcıya 3–5 satır durum ver (ne değişti, ne bekleniyor) ve sıradaki adımı öner; sonra devam et.
4. Oturum sonunda `docs/DURUM.md`'ye tarihli kısa bir giriş ekle (ne yapıldı, ne bulundu, ne bekleniyor) ve push et.

## Sabit kurallar
- **Sorgula ve geri bildir:** Kullanıcının isteği ya da önerisi mantıksızsa, ölçümlerle çelişiyorsa, eksik ya da riskliyse bunu
  uygulamadan önce açıkça söyle (neden, kanıt, daha iyi seçenek); körü körüne uygulama. Karar yine kullanıcınındır.
- **Model orkestrasyonu (13.11.2026, maliyet):** birkaç araç çağrısından uzun her işte önce `orkestrasyon` skill'ini yükle
  (`.claude/skills/orkestrasyon/SKILL.md`). Ana oturum planlar, brief yazar, doğrular, commit eder; işi `Agent` aracıyla dağıtır:
  **Opus** = orta–yüksek zorluk, gevşek brief (hedef + kısıt + bitti ölçütü) · **Sonnet** = basit–orta, sıkı brief (numaralı adım,
  dosya yolu, dokunma listesi, rapor biçimi) · **Haiku** = çok büyük veri temizliği, en sıkı brief (şema + kural + sayım kontrolü;
  kural mekanikse betik). ≤ ~3 araç çağrılık işi delege etme. Alt ajan commit/push yapmaz; testleri ve ölçüm sayılarını ana oturum
  teyit eder. Cevap sonunda tek satır "Dağılım: …".
- Testler: `node --test tests/*.test.js` (hepsi geçmeli; sayı DURUM.md'de). Yeni özellik = test + README notu.
- Git: dal `claude/awesome-heisenberg-mmuyod` (repo HEAD). Commit → `git pull -q --rebase origin <dal>` → push. PR açma.
  Commit mesajı Türkçe; model adı yazılmaz; sonuna Co-Authored-By ve Claude-Session satırları (oturumun verdiği).
- GitHub Actions'ı `gh workflow run` ile tetikleyebilirsin (backtest.yml: mode full|sweep|lab|research; scan.yml:
  force_audit). Koşu bitişini `gh run view <id> --json status` döngüsüyle arka planda bekle.
- Variables (repo Settings) yalnız kullanıcı değiştirir; sen önerirsin. Ajanlar (denetçi/araştırmacı) da yalnız öneri.
- Ölçüm disiplini: eğitim/doğrulama 2/3 bölünmesi; **sıkı ölçüt** = iki dilimde ort. R > 0 ve PF > 1,1 (lab'de
  `acceptance`), "sağlam" = en iyi ay atılınca da pozitif; **hedge'li R** (eşit nominal ters BTC) kazancın BTC
  yönünden mi coin seçiminden mi geldiğini gösterir; çok varyant arasından seçim = iyimserlik, n < 100 = sonuçsuz;
  **ölçmeden canlıya kural konmaz**; canlı değişiklik = Variables bayrağı, varsayılan kapalı.
- Küçük örneklem (n < 30) ile iddia yok. Günlük R dalgalanması normal.
- **TradingView / Bybit talimatı:** ayrıntılı arayüz notları (doğrulanmış telefon/masaüstü menü adları, renk paleti, alarm ayarları,
  Bybit TP/SL · kısmi kapanış · trailing stop davranışı, çarpanlı semboller, indikatörler, fib şablonları) `tradingview-bybit` skill'inde
  (`.claude/skills/tradingview-bybit/SKILL.md`). TradingView ya da Bybit ekranı tarif edeceğin her cevaptan önce yükle; yeni doğrulanan
  arayüz bilgisini oraya işle. Her zaman geçerli çekirdek: her talimatta **hem masaüstü hem telefon** yolu (emin olmadığın menü adını
  söyle, doğrulat); sembol **OKX:BTCUSDT.P / OKX:ETHUSDT.P** (bot verisiyle aynı), **lineer** ölçek, saat dilimi **UTC**; **fib düzeni:**
  dipten tepeye çekilen fib'te 0 = tepe, 1 = dip; kullanıcı çoğu zaman telefondan (iOS, Türkçe) çizer, masaüstü TradingView Almanca,
  işlemleri Bybit'te (İngilizce uygulama) açar. Gerçek para sorularında: %1 risk (ters işlem / hafta sonu / ilk işlem → %0,5),
  adet = risk $ ÷ (giriş − stop), izole marjin, kaldıraç yalnız teminatı belirler.
## Mimari harita
- Tarayıcı: `index.html` + `src/` (detectors, scan, ew, ui). Presetler `src/scan/presets.js` (ICT/SMC, EW, zigzag/flat,
  diyagonal, Fib kesişimi…). Detektörler `src/detectors/*.js` (signal(ctx) → Signal[]), `src/scan/registry.js`.
- Sinyal botu: `bot/run.mjs` (CFG = env; TF kuralları `TF_RULES_DEFAULT`, `mergeRule`), `bot/plan.js` (buildPlan,
  trackPlan: waiting→active→tp1→done | confirming/knife | early/be | timeout), `bot/telegram.js`, `src/scan/regime.js`
  (BTC rejimi, horizonTrend, htfTrendAt), `src/scan/relative.js` (BTC'ye göre güç). Geçmiş `docs/signals/history.json`
  → `signals.html`.
- Ajanlar: `bot/agent/` (account, manager = Claude çağrıları `call()`, run, profiles). `agent.html` (Temkinli/Agresif +
  Denetçi/Araştırmacı sekmeleri).
- Momentum portföyü: `bot/momentum/` (`momentum.html`): short, BTC'ye göre sıralama, BTC hedge.
- Denetçi: `bot/review/` (metrics, auditor, run) — günlük 06:00 UTC (`AUDIT=1`, `force_audit`). Araştırmacı:
  `bot/research/` — Pazar 06:00 UTC + acil (kuyruk `docs/agent/research-queue.json`, rapor `research.json`).
- Backtest: `backtest/engine.js` (simulateTrade: limit/piyasa, half_be/single/trail, knifeGuard, timeStop, tp1Portion),
  `backtest/run.mjs` (tam koşu → plans.json.gz), `backtest/sweep.mjs` (varyant taraması, hedefli birleşimler,
  hedge'li R, `--variants/--only`), `backtest/lab/` (strateji aileleri: strategies.js, corrections.js, diagonal.js,
  smc.js, xsmom.js; `run.mjs` rapor/kabul). Sayfalar `backtest.html`, `sweep.html`, `lab.html`.
- Workflow'lar: `.github/workflows/scan.yml` (15 dk cron; env = Variables), `backtest.yml` (elle; Pazar cron research).
- Eğitim: `docs/egitim/` (SMC/price action, arkadaşın yöntemi, örnekler, ölçüm notları).

## Canlı ayar (24.10.2026'da kuruldu, ilk sinyal 26.10 00:00 UTC; 24.10 00–08 UTC'deki 46 sinyal eski düzenden → canlı istatistiklerde 26.10'dan başla; DURUM.md günceldir)
`KNIFE_GUARD=1 LIMIT_ONLY=1 SKIP_WEEKEND=1 EARLY_TP={"pct":1.2,"portion":0.5,"tfs":["4H"],"mid":0.25,"midStop":"early"}` (13.11'den beri 3 kademe; önce `{"pct":1.2,"portion":0.8,"tfs":["4H"]}`) `
TF_RULES={"15m":{"off":true},"1H":{"off":true}} HTF_TREND=with AUDIT=1 MOMENTUM=1 MOMENTUM_VARIANT=short
MOMENTUM_RANK=rel MOMENTUM_HEDGE=1`. `AGENT_SOURCE=signals AGENT_EXIT=1 AGENT_RESET=2026-11-13`. Yani yalnız 4H sinyalleri; güncel beklenti (13.11 taraması, gerçekçi sıra + düzeltilmiş bıçak kararı)
eğ −0,14 / doğr +0,01R, hedge'li eksi → kenar yok, kâğıt deneme; canlıda ≈ 220 sinyal / ay (≈ 115 dolum; 26.10–13.11 sayımı).

## Kısa bulgu özeti (ayrıntı `docs/DURUM.md`; 13.11 öncesi günlük `docs/DURUM-arsiv.md`)
- Fiyat-yapı aileleri (motor, Donchian, meanrev, sweep, diyagonal, zigzag/flat, fib kesişimi, SMC süpürme→MSS→FVG, uyumsuzluk, kanal,
  range sapması, spike sonrası) sıkı ölçütte kenar vermedi; kazanç BTC yönünden (r 0,4–0,7).
- **Canlı 4H düzeninin kenarı yok** (13.11 taraması, koşu 43431346650, 12 ay, sıra 1H; eğ / doğr): %1,2'de %80 kapat −0,132 / −0,018R
  (hedge'li −0,095 / −0,061) · bugünkü 3 kademe + stop erkene −0,125 / +0,010 (hedge'li −0,089 / −0,045) · bıçak koruması YOK −0,124 /
  −0,001 · koruma iyimser sınır ('lowerBar' 1H) −0,111 / +0,006 → **bıçak korumasının net katkısı ≈ 0**. Canlı kayıt 26.10–13.11:
  +0,02R yazılmış, yeniden oynatmayla düzeltilmiş ≈ −0,04…−0,11R (n ~72). Düzen kullanıcı kararıyla **deneme** olarak kâğıtta sürüyor;
  `KNIFE_GUARD` 30 kapanış sonrası yeniden değerlendirilecek.
- **Motor ↔ canlı sapmaları (hepsi ölçümü/kaydı iyimser yapıyordu, düzeltildi):** 29.10 dolum mumunda hedef sırası (`fillBarTp: 'lower'`) ·
  13.11 'kaçtı' özgün TP1'e göre (`missTp`) · 13.11 `trackPlan` dolum öncesi mumlar (sahte erken hedef → başa baş) · 13.11 motor bıçak
  kararı tam mumla (`knifeBar`: 'touch' varsayılan/kötümser sınır · 'lowerBar' + 15m alt TF = canlı · 'full' eski hatalı).
  `tests/parity.test.js` (1200 rastgele yol) "motor = canlı takip" ve "artımlı tur = tek geçiş" eşitliğini kilitler; açık 2 fark erken
  hedefsiz düzende (NB, F1). **Bu düzeltmelerden önceki tüm 4H sayıları (arşiv) iyimserdir; alıntılama.**
- Ölçüm kuralı: gerçekçi satır = `fillBarTp: 'lower'` + `knifeBar` 'touch' ↔ 'lowerBar' sınırları. İyimser dolum mumu ('count') satırı
  sıkı ölçütü geçse de sayılmaz (13.11'de 6 varyant böyle geçti).
- Düzeltilmiş canlı kayıtlar `docs/signals/rescored.json` (ham history değişmez; `applyRescore`, sayfada ↻).
- Etkisiz bulunanlar: zaman stopu, seans ve gün filtreleri, bekleme süresi (24→72 s), kalan pay için iz süren stop. Hafta sonu kötü.
  Çıkışta 3 kademe / %50 kapatma ≈ %80'den biraz iyi, fark gürültüye yakın.
- **Momentum (13.11, ön kayıtlı: `docs/arastirma/on-kayit-momentum.md`; `mom-diag.json`, `mom-stage1.json`):** sıralamada bilgi var (en zayıf
  beşte birlik sonraki hafta evrenden −%1,3 / −%1,8; plaseboyu geçiyor) ama `xsmom_l28_k5_short_rel` + BTC hedge kilitli dönemde (24.11.2022–
  24.11.2024) haftalık +%0,90 [−0,16; +2,12], Sharpe 0,98 → **ölçütü geçmedi; canlı momentum "deneme"** (geliştirmedeki +%2,6…3,6 seçim +
  dönem iyimserliği; 28 gün pencere eğitimde tepe). Long-short / ters-oynaklık / son haftayı atla geçmedi. Canlının eşit risk boyutlaması
  bilgi satırı olarak en düzgünü (Sharpe 2,1 / 2,3 / 1,25; en kötü tek işlem −%2). Canlı −%7,7'nin kaynağı: 21.10 10:00'da eski eşit nominalle
  açılış + APR sıkışması (geçiş artığı; kod hatası yok; 26.10'dan sonra canlı = yeniden oynatma). Temiz veri kalmadı → yalnız ileriye dönük kayıt.
- **Bilgi taraması (14.11, ön kayıtlı: `docs/arastirma/on-kayit-tarama.md`; `screen.json`):** hiçbir aday geçmedi — pump sonrası (+%25, hacim 3×)
  geri verme YOK (3 gün +%4 göreli, ortalamada devam; short'ta sıkışma medyan %16, p90 %70, en büyük %741) · sert düşüş sonrası etki yok ·
  günlük (1D) yapı sinyallerinde de yön bilgisi yok · yeni listelenen ve yüksek oynaklık grupları ters işaretli, anlamsız · fonlama uçları (13
  hafta, bilgi) sonraki hafta −%2 → canlı etiketle izleniyor. Fiyat tabanlı yeni kenar aramak yerine ileriye dönük kayıtlar beklenir.
- **Fonlama geliri / taşıma (14.11, ön kayıtlı: `docs/arastirma/on-kayit-fonlama.md`; `carry.json`):** spot al + vadeli sat. BTC yıllık fonlama
  2024 %24 → 2026 %5,6 (Hyperliquid). BTC + ETH sürekli taşıma, maliyet %0,39, sermaye üzerinden, OKX'e ölçekli (Hyperliquid ≈ 1,5–1,8 kat):
  %9,8 (2023–25) / %3,6 (2025–26) → **eşik %5 geçilmedi, "zahmetine değmiyor"**; dönen kurallar devir maliyetiyle daha kötü. Rejime bağlı:
  BTC fonlaması yeniden ~%0,02 / 8 saat üstüne çıkarsa yeniden bakılır (gölge etiket `fundingBtc`). Kaynak özeti:
  `docs/arastirma/kaynaklar-fonlama-seviye.md` (yuvarlak sayılarda emir kümelenmesi belgelenmiş; fib için bulunamamış).
- **Rejim haritası + trend testi (14.11, ön kayıtlı: `docs/arastirma/on-kayit-rejim.md`; `regime-map.json`):** BTC + ETH SMA50 / 200 trend kuralı
  geçmedi — kazanç yalnız long bacaktan (al-tut getirisi, yarı düşüş); **aşağı trendde short iki dönemde de ≈ 0** (07.2020–11.2022 bağımsız
  dönem dahil); komşu ortalamalar tutarsız. Harita (betimsel): 4H sinyallerde BTC trendiyle aynı yön işlemler en kötü (−0,10R) · fonlama
  geliri gözlenen fonlama durumuna bağlı (yüksek %0,59 / hafta ↔ düşük %0,07) · momentum her durumda artı. "Rejime göre model seçen üst beyin"
  için kanıt yok; ileriye dönük F1–F3 hipotezleri ön kayıt günlüğünde. **HT3 kısa vadeli dizilim (4H: kapanış / SMA3 / SMA6 / SMA42) da
  geçmedi:** net −%0,57 / −%0,62 hafta (brüt +0,4; maliyet %0,9 / hafta), short bacak anlamlı eksi, aşağı dizilimden sonra tepki; durumların
  medyanı 8 saat. Üç trend tanımında da short tarafı kazandırmıyor.
- **Sahte seviye testi (14.11, ön kayıtlı: `docs/arastirma/on-kayit-seviye.md`; `levels.json`):** 4H'de inanılan seviyeler komşu sahte
  seviyelerden daha çok tepki ÇEKMİYOR — fib 0,382 / 0,5 / 0,618 sonuçsuz (n az) ve ters işaretli (−0,03 / −0,12); yuvarlak sayılar geçmedi,
  ters işaretli (%40,7 ↔ %44,7; aşağıdan yaklaşmada daha sık kırılıyor). "Kendini gerçekleştiren kehanet" bu ölçekte görülmedi.
- **"Ort. R nasıl artar" araştırması (13.11, ön kayıtlı: `docs/arastirma/on-kayit.md`; `diag.json`, `stage1.json`):** giriş zamanlamasında bilgi
  yok (aynı eğilimde rastgele andan farksız; e-oranı ≈ 1,0) · giriş biçimi fark etmiyor (limit = piyasa, sinyal başına) · stoplar avlanmıyor ·
  maliyet 0,046R (en iyi komisyon modeli +0,012R) · BTC'ye göre güç koşulu tabanı +0,02…+0,05R iyileştiriyor ama geçmiyor · portföy sınırının
  seçim değeri yok. Taban üç bağımsız dilimde −0,092 / +0,003 / −0,062R (kasa = 24.11.2024–18.11.2025). **Sonuç: 4H sinyal motoru tarayıcı /
  eğitim aracı; işlem sistemi değil.** Yeni hipotez = önce ön kayıt, kasaya tek bakış; plasebo kurarken yön bilgisini geçmişe taşıma.

## Açık işler (11.11.2026)
- **13.11 inceleme listesinden kalanlar** (DURUM 13.11 "Devam 2" girişi → "Açık kararlar / sıradaki" 1–8) ve karar: `KNIFE_GUARD` 3 kademe denemesi (30 kapanış) sonrası yeniden değerlendirilir. Canlı 4H düzeni **deneme** (kenar yok); n ≥ 30 kapanışta mevcut düzenin yeniden oynatmasıyla karşılaştır. Agresif ajan karar kaydı Actions logundan kontrol edilecek.
- **Short tarafı ~13.12.2026'da canlı kayıtla değerlendirilir** (kullanıcı kararı 13.11: 15 dk adımlı canlı öykünmesi yazılmaz; taramadaki "canlıya eşit" satır yalnız long için geçerli). **"Ort. R nasıl artar" araştırması** aşama 0 + 1 bitti, hiçbir hipotez geçmedi (DURUM 13.11 son giriş); açık: H3 (fonlama / açık pozisyon) canlı gölge etiketle (`history.json` `shadow`; fonlama alanı ilk sinyalde doğrulanacak) ~13.12; momentum araştırması da bitti (M0 + M1, geçmedi; DURUM 13.11 son giriş) — 14.11'de kayıt sıfırlandı (`MOMENTUM_RESET=2026-11-14`, arşiv `docs/agent/archive/momentum-ilk/`; ilk dengeleme 16.11), yeniden boyutlama K/Z'si `trades`'e yazılıyor; **ileriye dönük ara bakış 17.05.2027** (ölçütler ön kayıtta; maks. düşüş > %20 ya da tek işlemde > %5 kayıp görülürse hemen haber ver). 13.12'de "puan v2" (gölge etiket + `bd` puan dökümü ile tek ön kayıtlı test) önerildi.
- **Ajan adım 3 (13.11'de ertelendi):** ilk ajan ara değerlendirmesinde (10 kapanış; Telegram'da "📌 Hatırlatma") ajanın ek bilgi
  isteyebilmesini (sınırlı menü, karar başına ≤ 2) kullanıcıyla değerlendir. Önce 1–2. adımın (AGENT_EXIT=1, 13.11'de açıldı)
  ilk 10 işlemdeki etkisi: signals.html "Ajan vs sinyal" + ajanların `reviews`. "Devam edelim"de agent `reviews` uzunluğuna bak.
- **Hyperliquid incelemesi yapıldı (11.11, DURUM.md):** 16 kârlı cüzdan; ders = küçük pozisyon (medyan pozisyon hesabın
  %1–40'ı), çok küçük kayıp + nadir büyük kayıp, kazananı uzun tutma; seçilim yanlılığı büyük (48 bin hesaptan kazananlar).
  Ortam izni: api.hyperliquid.xyz + stats-data.hyperliquid.xyz (Default). Node fetch proxy'yi ancak `NODE_USE_ENV_PROXY=1` ile kullanır.
- **Bekleyen (14.11):** Deney B CSV'leri ~21.11 · 13.12 değerlendirmesinde rejim haritasının F1 hipotezine de bak (canlı 4H sinyallerde BTC trendiyle aynı yön ↔ ters, `btcRead` / `regime`) · günlük özetteki durum satırı (`bot/status.js`, 14.11) ilk canlı özet mesajında kontrol edilecek (dört alan dolu mu).
- **Not (14.11, kullanıcının paylaştığı görüş):** piyasanın katılımcı yapısı değişti (ETF'ler, kurumsal para, faiz kanalı; "grafik tek başına yetmiyor") → `docs/arastirma/notlar-piyasa-yapisi.md` (özet + ileride sınanabilecek fiyat dışı durum değişkenleri: ETF akışı, dolar, faiz, BTC hakimiyeti). Kullanıcı açmadıkça başlama.
- **Deney B sürüyor (gerçek işlemler, 30 işlem):** risk 1 $ (short/ilk işlem 0,5 $), stop ≥ %1, TP1 1,5R'de %50 + SL girişe,
  kaldıraç ≤ ⌊100/(stop%×1,5)⌋ ve tasfiye stopun ötesinde; ikinci kol iz süren stop (Retracement 1R, Activation TP1). Bot
  sinyallerinde botun planı (erken %1,2'de %80). Her kısmi TP'den sonra SL ve trailing stop elle kontrol (Bybit ikisini de
  korumadı: 10.11 SAND/KAITO SL, 11.11 BCH trailing kayboldu). Kullanıcı CSV'leri 10.11'den itibaren gönderecek →
  `tools/trades/rtable.mjs` + `replay.mjs`, önceki 65 pozisyonla tekrarları ayıkla, tablo (etiket kendi/arkadaş/bot/izlenen).
- Deney C: BTC günlük yönü etiketi (history.json btcRead) — ilk 61'de "BTC'ye ters" +0,29R (n 14), gürültü olabilir.
- FIB_ALERT=1 açık; 10.11'den beri "yaklaşıyor" aşaması 4 ATR'de (puan eşiği yalnız "bölgede"); mesaj sıklığını say.
- Tarayıcı takip listesi (kullanıcının "izlenen" kâğıt işlemleri, localStorage): ara sıra "Dışa aktar" ile al; kapananları silme.
- QML / "kesişim + QML" ölçümü **askıda** (kullanıcı açmadıkça başlama).
- Pazartesi haftalık sinyal raporu (WEEKLY_REPORT) birlikte okunur; P5 canlı 4H düzeninde n ≥ 100 beklenir.
