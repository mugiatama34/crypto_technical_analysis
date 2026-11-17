# Bulgular — ölçülmüş ve kapanmış fikirler

Yeni bir ölçüm fikrinde ÖNCE buraya bak (`grep`): fikir kapanmışsa yeni bir neden olmadan yeniden ölçülmez. Her yeni ölçüm sonucu buraya
bir madde olarak eklenir (tarih, ön kayıt dosyası, sonuç JSON'u, koşu no, eğ / doğr sayıları, karar). Ayrıntı `docs/DURUM.md`; 13.11 öncesi
günlük `docs/DURUM-arsiv.md`. Bu metin 17.11.2026'da `CLAUDE.md`'den buraya taşındı (içerik değişmedi).

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
- **Fib kesişiminde iç dalga sayımı (16.11, ön kayıtlı: `docs/arastirma/on-kayit-fib-dalga.md`; `fib-wave.json`):** itkinin içinin "5'li ✓"
  olması (yarı eşikli ZigZag + 2 Elliott kuralı) 0,618 × 1,272 kurulumunun sonucunu AYIRMIYOR — fark (5'li − diğerleri) 5m −0,12 / −0,19R,
  15m −0,19 / +0,01R, aralıklar sıfırı içeriyor, işaret çoğunlukla ters; hiçbir sınıf (tek parça / 3'lü / 5'li / 7+) iki dilimde artı değil.
  Etiket tarayıcıda yalnız bilgi olarak duruyor (`src/ew/innerCount.js`, `meta.wave`); filtre / kural olmaz, başka iç eşik denenmez.
- **Yüksek ADX'te short (17.11, ön kayıtlı: `docs/arastirma/on-kayit-adx-short.md`; `adx-short.json`, koşu 44085171578):** 4H'de "kümede ADX
  trend ↓, ADX ≥ 40, yalnız short" bağımsız dönemde (13.11.2023–13.11.2025) **SONUÇSUZ — n 53 / 42 (< 100)**. İşaret artı (eğ +0,058R PF 1,29
  hedge'li +0,089 · doğr +0,343R PF 3,31 hedge'li +0,178) ama 95 işlem 24 haftaya kümeli, eğitim aralığı sıfırı içeriyor. Kural / filtre olmaz;
  başka eşik denenmez. İleriye dönük sayım canlı kayıttaki `adx` + sinyal adlarıyla yapılabilir (13.12 değerlendirmesinde bak). Backtest
  sayfasında tek değerli "ADX 57" satırları aralıklara toplandı (`backtest/names.js`).
- **"Ort. R nasıl artar" araştırması (13.11, ön kayıtlı: `docs/arastirma/on-kayit.md`; `diag.json`, `stage1.json`):** giriş zamanlamasında bilgi
  yok (aynı eğilimde rastgele andan farksız; e-oranı ≈ 1,0) · giriş biçimi fark etmiyor (limit = piyasa, sinyal başına) · stoplar avlanmıyor ·
  maliyet 0,046R (en iyi komisyon modeli +0,012R) · BTC'ye göre güç koşulu tabanı +0,02…+0,05R iyileştiriyor ama geçmiyor · portföy sınırının
  seçim değeri yok. Taban üç bağımsız dilimde −0,092 / +0,003 / −0,062R (kasa = 24.11.2024–18.11.2025). **Sonuç: 4H sinyal motoru tarayıcı /
  eğitim aracı; işlem sistemi değil.** Yeni hipotez = önce ön kayıt, kasaya tek bakış; plasebo kurarken yön bilgisini geçmişe taşıma.
