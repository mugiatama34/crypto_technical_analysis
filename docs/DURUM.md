# DURUM — tarihli durum günlüğü

Yeni oturumda önce bu dosya okunur (bkz. `CLAUDE.md` → "Devam edelim" protokolü). Her oturum sonunda en üste tarihli
kısa bir giriş eklenir. Eski girişler silinmez.

## 26.10.2026 (Pazartesi öğleden sonra) — Coin analizi sayfası (coin.html)

Kullanıcı isteği: tek coin için 1G/4H/1H/15m teknik analiz, seçilebilir aileler, BTC karşılaştırması ve yazılı yorum.
`src/scan/coin.js` (saf çekirdek: analyzeTf/analyzeCoin, structureBias, dealingRange, btcCorr, commentary) +
`src/ui/coin.js` + `coin.html` (tarayıcı menüsünde). Bölge = kümenin tohum sinyalinin bölgesi (birleşik küme çok
genişliyordu); > 3 ATR "geniş" sayılır, yorumda bölgede/yaklaşıyor için kullanılmaz; yaklaşıyor = ≤ 1,5 ATR ve ≤ %3.
Karar notu: bölge (puan ≥ 35, içinde ya da ≤ 1 ATR) üst dilim (4H, yoksa günlük) yönüyle uyumlu → teyitle %1; ters →
%0,5; BTC güçlü bağlantılı (r ≥ 0,6) ve ters → uyarı; hafta sonu notu. Yorum kural tabanlı (Claude çağrısı yok).
Fib kesişimi çiziminde itki/A bacağı/0,618/1,272 seviyeleri ve işaretleri. Testler 121.

## 26.10.2026 (Pazartesi öğle) — Fib kesişimi: tarayıcı hatası düzeltildi, Telegram izleme uyarısı eklendi

Arkadaşın XRP 15m 0,618×1,272 long'u (bölge ≈ 1,2767, 26 Eki 03:00 UTC dokundu). Tekrar oynatma: detektör 1H'de
25 Eki 16:00 UTC'den beri aynı bölgeyi (1,2767) görüyordu; bize ulaşmadı çünkü (1) bot yalnız 4H gönderiyor, (2) Pazar,
(3) fib kesişimi bot sinyali değil, yalnız tarayıcı preseti — ve presetin minScore'u 20 iken tek sinyal oluşurken 6–16
puan alıyordu → liste hep boş (bölgeye 0,35 ATR yaklaşınca ≈ 28). 15m'de son 4 pivot penceresi gürültüyle kayıyordu.
Düzeltme: `fibonacci.clusterKs` (varsayılan null = eski davranış; preset ve uyarı [2,3,4]), preset minScore 5,
`bot/fibalert.js` (FIB_ALERT=1, yalnız 0,618×1,272, "yeni"/"bölgede", itki başına ≤ 2, tur özeti tek mesaj, ilk 30
coin). Hacim tahmini: 4 coin 60 saatte 6 kurulum → 30 coinde günde ≈ 15–20 kurulum. **Kullanıcının Variables'a
`FIB_ALERT=1` eklemesi gerekiyor** (SCAN_TFS 15m,1H,4H içermeli). Testler 117.

## 26.10.2026 (Pazartesi sabah) — pratik Adım 2 (likidite haritası) başladı; kullanıcının ARB işlemi açık

Kullanıcı ARB'de Bybit'te gerçek (küçük) long açtı: limit 0,16659 (gece doldu), 96 ARB, 10x izole, SL 0,1614 (Bybit 8 Eki
dibi 0,16164 altı), TP 0,2022, risk ≈ 0,50 $ (%0,5), 1R 0,1718. pratik.html'e Adım 2 eklendi (BTC/ETH 1H, Temiz/İşaretli,
5 görev + cevap anahtarı). Asya (Pzt) iki coinde PDL'yi süpürdü (BTC 79 323 < 79 773, ETH 2 291,7 < 2 308), PWL alınmadı
(BTC 79 168, ETH 2 281,02). Yukarıda PDH = 1H EQH (BTC ≈ 81 000, ETH 2 365–2 371). Senaryo: Londra'da PWL süpürme + MSS
→ discount long; PWL altında kapanış/kabul → range kırılır, günlük düşüş devam. Bekleniyor: kullanıcının Adım 2 çizimleri
ve Londra gözlemi; sonra Adım 3 (4H FVG/OB).

## 25.10.2026 (Pazar, akşam) — ARB likidite haritası (arkadaşın 14R Elliott long'u)

`pratik.yml` artık `extra=ARB,…` girişiyle ek coin çekiyor (`docs/pratik/extra/<COIN>.json`, 1H 720 mum). ARB (OKX):
giriş 0,16625 / stop 0,16252 / hedef 0,21906 = 14,2R. 15m'de kurulum tamam (24 Eki dibi 0,16332 → 25 Eki 09:15 süpürme
0,16304 → 15:00 MSS 0,16668 → FVG 0,1662–0,1670). Engeller: FVG 0,1729–0,1772, range ortası 0,1829, FVG 0,1865–0,1875,
range tepesi EQH 0,2023–0,2043 (≈ 9,7R, en olası hedef), EQH 0,2050, EQH 0,2083–0,2089, PWH 0,2110, FVG 0,2159–0,2212.
Stopun altında alınmamış range dibi 0,16142 (Binance 0,15979). Günlük yapı alçalan, hafta sonu, ters işlem → 0,5R.
Kullanıcıya bacak/range seçim kuralı anlatıldı (son HH'yi yapan itki; range = son trend bacağı bittikten sonra; takvim
değil yapı). Artifact: ARB Likidite Haritası.

## 25.10.2026 (Pazar, öğleden sonra) — pratik Adım 1 tamamlandı

Kullanıcı TradingView'da (masaüstü + iOS) BTC ve ETH 1D + 4H Adım 1'i bitirdi; son çizimler doğru. Kurulum: OKX perp,
lineer, UTC, "SMC Çeyrek" fib şablonu. Renk kodu: yapı yeşil/kırmızı, likidite mor, FVG sarı (sonra), OB mavi (sonra),
range gri kutu (%5–10 dolgu), fib gri + 0,5 vurgulu. Çizim kuralları: likidite çizgisi fitile; alınan likidite
süpürüldüğü mumda biter, alınmayan sağa uzar; günlük çizimler 4H'de Görünürlük ile gizli. Takıldığı yerler (tekrar
vurgulanacak): HL → MSS (kapanış) → LL sırası (iki kez HL'yi LL/MSS sandı); çizgiyi gövdeye hizalama. Açık likidite:
ETH EQH 2 529. Sıradaki: **Adım 2 (likidite haritası: PDH/PDL, PWH/PWL, Asya seansı, 1H EQH/EQL) Pazartesi 09–10 TR**,
Asya seansı canlı işaretlenecek; pratik.html'e Adım 2 eklenecek (yeni veriyle). Telefonda metin aracının ve ok
işaretinin yeri hâlâ doğrulanmadı.

## 25.10.2026 (Pazar) — pratik başladı: BTC + ETH, Adım 1 (yön)

Konteynerden OKX/Binance kapalı (403) → veri GitHub Actions'tan: `pratik.yml` + `bot/practice/snapshot.mjs` →
`docs/pratik/candles.json` (BTC/ETH 1D 220, 4H/1H/15m 300 mum; her sabah 06:20 UTC). `pratik.html` Adım 1: gerçek
1D/4H grafikleri, Temiz/İşaretli geçişi, 5 soru + cevap anahtarı. Bulgular: günlük yapı iki coinde alçalan (BTC MSS
8 Eki, ETH 7 Eki); BTC büyük bacağın 0,74'ünde, ETH 0,54'ünde (ETH zayıf); 4H range BTC 79 168–84 876, ETH 2 281–2 530,
fiyat discount'ta; 24 Eki 12:00 iki coin de PWL'yi süpürdü; 21 Eki SMT (BTC tepeyi aldı, ETH alamadı). Arkadaşın BTC
short hedefi (80 338) 24 Eki öğleden sonra görüldü (dip 79 168). Kullanıcının cevapları bekleniyor; sonra Adım 2
(likidite haritası). Testler 110.

## 24.10.2026 (Cumartesi, gece) — görsel eğitim sayfası

`egitim.html` (repo kökü, GitHub Pages): `docs/egitim` 01–06 modülleri 8 sekmede (Başlangıç, Temeller, Kurulum, Risk,
Örnekler, Ölçüm, Rutin, Alıştırma). Kendi SVG mum motoru (seri üretici + açıklama katmanları: bölge, çizgi, fib,
pozisyon kutusu, seans bandı, RSI paneli, adım oynatıcı); ~30 grafik. XRP kurulumu 6 adımda mum mum oynatılır; pozisyon
hesaplayıcı, beklenti hesaplayıcı + ısı haritası, risk simülasyonu (150 işlem, %35 kazanma, +2,2R; %10 risk %5'ten geride
bitiyor, düşüş %74), şans simülasyonu (kenarı sıfır 24 yol), 9 soruluk grafikli test. Mumlar temsilî; Örnekler sekmesi
arkadaşın seviyeleriyle yeniden çizildi (ARB grafiği seviyeler tutarsız olduğu için yalnız tabloda). Açık/koyu tema,
mobil 390 px'te taşma yok, konsol hatası yok. `docs/egitim/img/` boştu; .md'lerdeki resim bağlantıları hâlâ kırık.

## 24.10.2026 (Cumartesi, akşam) — kâğıt hesap muhasebe hatası düzeltildi

**Bulgu (açık iş 3 kapandı):** Agresif ajanda "ort. R ≈ 0 ama özsermaye −%12" tutarsızlığının kaynağı `bot/agent/account.js`
`closePart`: kısmi kapanış (TP1 yarı / erken %80) sonrası ikinci kapanışta marjin payı `pos.margin × q/qty0` ile hesaplanıyordu;
marjin zaten azaltılmış olduğu için kalan marjinin bir kısmı (TP1'de çeyreği) nakde dönmüyor, pozisyon silinince özsermayeden
siliniyordu. İşlem pnl/R kayıtları doğruydu; yalnız nakit/özsermaye eksikti.
| Hesap | Eski özsermaye | Kayıp marjin | Onarılmış | Not |
|---|---|---|---|---|
| Temkinli | 260,55 | 12,50 (JTO) | 273,05 | kalan fark ≈ açılış komisyonları |
| Agresif | 264,28 | 29,25 (GRVT, JTO, PEPE, MEW, LA) | 293,53 | ort. R +0,01 ile artık tutarlı (−%2,2) |
Düzeltme: marjin payı artık `pos.margin × q/pos.qty` (kalan oranı); açılış komisyonu da `realized`'a dahil (işlem pnl tam net;
likidasyonda pnl = −marjin − açılış komisyonu). Hesap dosyalarına kayıp tutar nakde geri eklendi, nota yazıldı; eski
maxDD/eğri ve denetçi raporlarındaki "−%12" düzeltilmedi (tarihsel). Momentum portföyü bu kodu kullanmıyor, etkilenmedi.
Bir sonraki denetçi koşusu (Pazar 09:00 TR) özsermayeyi yeni değerden okur.

**Durum:** canlı ayar değişmedi; hafta sonu sinyal yok (bugün 0 yeni sinyal, 128 eski açık). Testler 109 geçiyor.
Sıradaki: DURUM 24.10 listesi 1, 2, 4, 5, 6 aynen geçerli.

## 24.10.2026 (Cumartesi) — son durum

**Canlı (Variables):** `KNIFE_GUARD=1 LIMIT_ONLY=1 SKIP_WEEKEND=1 EARLY_TP={"pct":1.2,"portion":0.8,"tfs":["4H"]}
TF_RULES={"15m":{"off":true},"1H":{"off":true}} HTF_TREND=with AUDIT=1` + momentum (short, rel, hedge). Yalnız 4H
sinyal; hafta sonu sinyal yok → **ilk sinyaller Pazartesi 27.10** (UTC gün değişince). Kural seti zaman damgası botta
(`state.ruleSince`); denetçi eski rejimle (20–24.10, 558 sinyal, −0,83R) yeni düzeni karşılaştırmaz.

**Ajanlar:** denetçi günlük 09:00 TR (son rapor: 🟡 izle — filtreler çalışıyor, eski 178 açık sinyal long yığılması,
agresif ajanda ort. R +0,01 ama özsermaye −%12 → araştırılacak). Araştırmacı Pazar 09:00 TR (ilk rapor: 6 standart
hipotezin hiçbiri doğrulanmadı; kuyrukta eski "son 7 gün" isteği var, sonuçsuz kapanacak). Temkinli 260 USDT, agresif
263 USDT, momentum 317 USDT (+%5,6; hedge net ≈ 12 USDT).

**Bugün test edilen ve ret edilenler (24 ay 1H/4H, ilk 50):**
| Aile | Eğitim R | Doğr. R | Hedge'li doğr. R | Karar |
|---|---|---|---|---|
| fib_cluster_c (0,618 × 1,272 kesişimi, tüm çiftler) | −0,20 | −0,15 | −0,25 | ret |
| fib_cluster_c_strict (yalnız 0,618×1,272) | −0,10 | −0,025 | +0,05 | tutarsız, ret |
| sweep_mss_fvg (arkadaşın SMC kuralı) | −0,07 | −0,10 | −0,16 | ret |
| sweep_mss_fvg_htf / _btc / _1r | −0,12 / −0,04 / +0,02 | −0,04 / −0,09 / +0,02 | −0,01 / −0,16 / −0,06 | ret |
Tarayıcıda "Fib kesişimi (0,618×1,272)" preseti görme aracı olarak duruyor. Lab hedge'li R hatası düzeltildi (limit
girişte BTC getirisi dolum zamanından).

**Önceki bulgular (özet):** zaman stopu (4/8/16 mum) işe yaramadı; seans filtresi işe yaramadı, hafta sonu kötü
(+0,02R hariç tutunca); düşen bıçak koruması +0,02R; dört filtre + erken %80 birlikte 4H'de +0,064/+0,097R, günlük
trend aynı yön eklenince hedge'li +0,039/+0,079R (n 293) → canlıya alındı. Zigzag/flat/diyagonal/Donchian/meanrev/
sweep/engine aileleri: kenar yok, BTC bağımlı. Momentum `xsmom_l28_k5_short_rel` hedge'li zayıf pozitif → canlı.

**Açık işler / sıradaki adımlar:**
1. Pazartesi–Cuma: ilk 4H sinyalleri; Telegram "⚡ Erken hedef" satırı ve takip olayları (early/be) doğru mu?
   `signals.html` ve denetçi raporu.
2. Pazar: araştırmacı raporu (standart hipotezler); kuyruk temiz mi?
3. Agresif ajan: ort. R ≈ 0 ama −%12 özsermaye — komisyon/boyut/açık pozisyon değerlemesi; `statsOf` kontrolü.
4. Arkadaştan "pas geçtiği 3–5 kurulum" cevabı gelirse SMC ailesine seçicilik filtresi olarak eklenip yeniden koşulur.
5. 4–6 hafta sonra 4H düzeninin ileriye dönük sonucu (hedef: ort. R ≈ +0,08, BTC ters giderken ayakta mı).
6. Eğitim: `docs/egitim/` okunup pratik rutinine başlanır; kişisel işlem günlüğü (05-olcum.md şablonu).

**Testler:** 108 geçiyor. Son commit: eğitim + CLAUDE.md + DURUM.md.

## 26.10.2026 — coin.html grafik sadeleştirme
- Odak modu: grafikte yalnız seçili küme (en güçlü 3 sinyal); küme kartına dokununca değişir. "Tüm sinyaller" isteğe bağlı.
- Y ekseni temiz: yalnız Giriş/Stop/H1/H2 eksende; diğer seviyeler çizgi ucunda küçük etiket + grafik altı lejant. Kutular ince çerçeve, sağda 14 mum boşluk.
- Bekleyen: lab koşusu 40318035445 (fib_cluster_g / g_p0 karşılaştırması). Testler: 121 geçiyor.

## 26.10.2026 — Fib kesişimi backtest (lab, 24 ay, top 50, koşu 40318035445)
| Varyant | Eğitim R / PF | Doğr. R / PF | Hedge'li eğ / doğr | n |
|---|---|---|---|---|
| c_strict (1H/4H, tol 0,3) | −0,03 / 0,95 | +0,05 / 1,08 | −0,07 / +0,09 | 291 |
| g (B≤%100, k 2/3/4, 15m/1H/4H) | −0,08 / 0,89 | −0,06 / 0,92 | −0,17 / −0,14 | 4730 |
| g_p0 (arkadaşın yönetimi: stop P0) | −0,06 / 0,91 | −0,07 / 0,89 | −0,14 / −0,11 | 3379 |
- Hiçbiri sıkı ölçütü geçmedi. Gevşetme (B ≤ %100, ince k, 15m) sinyali 16 kat artırdı, kaliteyi düşürdü; 15m n 3852 R −0,08.
- Arkadaşın yönetimi (stop itki başı) kazanma oranını %34→%40 çıkarıyor ama R'yi kurtarmıyor. Kazanç BTC yönünden (β 0,4–0,5).
- Karar: Fib uyarısı Telegram'da "bakılacak yer" olarak kalır; işlem kuralı/canlı filtre olmaz. INJ diyagonal sorusu: iii > i → daralan diyagonal kuralı bozuk (DIA-R5), sistem göstermiyor.

## 26.10.2026 akşam — kullanıcının gerçek işlemleri (Bybit, kâğıt değil; yalnız kayıt)
- DOGE 4H short (bot sinyali): giriş 0,07749, 943 adet, SL 0,07852 (risk $0,97), TP1 0,07653 ×755 (sonra SL girişe, otomatik), TP2 0,07469.
- ARB long: 96 adet, giriş 0,16659, SL girişe çekildi (risksiz), TP1 0,1745 ×48, TP2 0,2022.
- Pratik: BTC/ETH 26.10 Londra/NY analizi yapıldı (BTC Asya tepesi süpürme + ETH SMT; NY PDL süpürdü). Sıradaki: Adım 3 (4H FVG/OB) sayfaya eklenecek.

## 27.10.2026 — Pratik Adım 3 (4H FVG/OB) sayfada
- `pratik.html` Adım 3: günlük güncelleme (PDH/PDL 26 Eki) + 4H bölge görevi + BTC/ETH 4H grafik + gizli cevap anahtarı. BTC premium yığını 81 008 likidite → FVG 81 176–81 222 → OB 81 510–81 887 (bozulma 82 048); ETH 2 371 → OB 2 377–2 417 (FVG 2 390–2 392). Altta geçerli yükseliş bölgesi yok.
- Şablonda `at()` pencere dışı tarihi kenara sabitler; 1H penceresi 110 mum (Adım 2 grafikleri yeni veriyle bozulmasın).
- Gerçek işlemler: DOGE açık (TP1 bekliyor); ARB girişteki stoptan kapandı (≈0R, komisyon kadar eksi).
- 27.10 SUI long (kullanıcının kendi kurulumu, Bybit): genişleyen formasyonun alt çizgisinden long, giriş 0,9019, stop 0,8988 (%0,34), hedef 0,9155 = üst çizgi (R/Ö 4,39); 10:55 UTC sonrası hedefte kapandı (+4,39R planlanan). Gerçek: 300 adet, ort. giriş 0,9024, ort. çıkış 0,91169 (kademeli), 28 dk; brüt +2,79, komisyon 0,30, **net +2,49 $**; risk 300×0,0036 = 1,08 $ → **net +2,3R** (komisyon ≈ 0,28R: dar stopta ağır). Kademeler: 210 adet (%70) 0,9101 (+2,1R) net +1,41 $; 90 adet (%30) 0,9154 (+3,6R) net +1,08 $. ARB 26.10 20:01 girişte stoptan kapandı: −0,02 $ (≈0R).
- 27.10 SUI short Plan A (bekleyen limit): sell 0,9215, 43 adet, SL 0,9320, TP1 0,8985 (26, SL girişe), TP2 0,8870 (11), kalan 0,8200 (Eylül itkisinin 0,618'i). Risk %0,5 (DOGE short ile ilişkili). Geçersiz: 4H > 0,9310 kapanış; 24 saatte dolmazsa iptal.
- 27.10 DOGE short stop oldu (0,07853, 1 pip kayma): −1,06 $ = −1,1R (komisyon dahil). TP1 0,07653 hiç gelmedi. Gerçek işlem günlüğü (26–27.10): ARB 0R, SUI long +2,3R, DOGE −1,1R → net +1,2R ≈ +1,41 $. SUI short (0,9215) açık, kısmi TP'ler kurulu.

## 28.10.2026
- SUI short (0,9215) 27.10 21:00 UTC'de 0,9362 fitiliyle stop oldu (≈ −0,5 $ ≈ −1R); 4H 20–24 kapanışı da 0,9326 (> 0,9310) → fikir de bozuldu. Arkadaş 1D/4H'den long girdi (EW (iv) 0,618 ≈ 0,9098 + yükselen çizgi + RSI trend çizgisi); SUI 03:00 UTC 0,94.
- Uyumsuzluk sorusu: `divergence` dedektörü var (coin sayfası "Momentum" ailesi, botun kural motorunda ağırlık 0,7), ama lab'de tek başına hiç ölçülmedi; RSI trend çizgisi kırılımı yok. 27.10 17:30 UTC itibarıyla dedektör SUI 1D'de gizli ↓ (RSI+MACD+OBV) ve klasik ↑ (yalnız MACD, oluşuyor) gördü — çelişkili. Öneri: lab'e "klasik uyumsuzluk 4H/1D + tetik" ailesi ekleyip ölç; ayrı kategori gerekmez.
- HUMA long planı (kullanıcı): 26.10 kapitülasyon fitili 0,0175 (hacim ~10–20×), 27.10 0,02864 tepe; giriş limit 0,02595, stop önerisi 0,0242 (0,02437 dibinin altı), TP1 0,0284 (EQH altı), TP2 0,03075 (22 Eki tepesi); günlük trend aşağı → %0,5 risk.
- BTC 03:00 UTC 81 199: 25 Eki tepesi 81 008 süpürüldü, Adım 3 premium bölgesine (FVG 81 176–81 222, OB 81 510–81 887) girdi.
- **Yeni sohbete devir (28.10 sabah):** Açık işler → (1) lab koşusu 40636015586 (div_* uyumsuzluk, 24 ay, top 50, 1H/4H/1D): bitince `docs/backtest/lab.json` oku (meta.strategies div_*), sıkı ölçüt + hedge'li R + TF kırılımı raporla, DURUM'a yaz. (2) HUMA long limit emri verildi (giriş 0,02595, öneri stop 0,0242, TP1 0,0284, TP2 0,03075); kullanıcı dolunca paylaşacak. (3) Pratik: Adım 3 sayfada (artifact https://claude.ai/artifact/QTodSVAzfiDm59JQBQ8zLV), kullanıcı çizimi bekleniyor; bugün çalışma günü planı `docs/egitim/calisma-gunu-28-10.md` (Adım 3 → replay → Adım 4–6). (4) NEAR short planı (süpürme 4,665–4,696 + 15m < 4,614) bilgi olarak. Gerçek işlem günlüğü: ARB 0R, SUI +2,3R, DOGE −1,1R, SUI short ≈ −1R.

## 28.10.2026 — Uyumsuzluk lab sonucu (koşu 40636015586, 24 ay, top 50, 1H/4H/1D)
| Varyant | Eğitim R / PF | Doğr. R / PF | Hedge'li eğ / doğr | n |
|---|---|---|---|---|
| div_rsi_pivot | −0,06 / 0,90 | +0,00 / 1,00 | −0,06 / −0,12 | 5334 |
| div_rsi_mss | −0,01 / 0,98 | +0,01 / 1,03 | −0,04 / −0,07 | 2526 |
| div_rsi_mss_ext | +0,01 / 1,02 | +0,02 / 1,03 | −0,03 / −0,10 | 1644 |
| div_rsimacd_mss | −0,02 / 0,97 | +0,02 / 1,03 | −0,03 / −0,07 | 2264 |
| div_rsi_mss_btc | +0,03 / 1,06 | +0,08 / 1,17 | −0,05 / −0,06 | 1034 (zayıf) |
- Sıkı ölçütü geçen yok. En iyisi BTC rejimi yönünde olan; ama hedge'li negatif → kazanç BTC yönünden, uyumsuzluktan değil.
- 1D umut verici ama n çok küçük (doğr. 23–29; ör. div_rsi_mss 1D doğr. +0,43R PF 2,2, eğitim −0,07R) → sonuçsuz. 1H/4H ≈ 0.
- Karar: uyumsuzluk yorumda "bakılacak işaret" kalır, ağırlık artmaz, ayrı kategori yok. Sıradaki (isteğe bağlı): 1D'yi geniş evren (universe 150) + daha uzun geçmişle n ≥ 100'e çıkarıp tekrar ölç; RSI trend çizgisi kırılımı ölçülmedi.

## 28.10.2026 — Denetçi 🔴 uyarısı incelendi (canlı −0,86R vs backtest +0,02R)
- **Sahipsiz kayıt hatası (düzeltildi, 6675809):** geçmişte 110 açık kayıt vardı; ~80'i 20–23.10'dan beri hiç güncellenmemiş (durum
  önbelleği `bot/state.json` o tarihlerde kaybolmuş/eski sürüme dönmüş; geçmiş dosyası kalmış). Denetçinin "süre dolumu çalışmıyor"
  dediği bu: takip yalnız `state.sent` üzerinden. Artık her tur geçmişte açık olup durumda olmayan kayıtlar **sessizce** (Telegram'sız,
  istatistiğe sayılmadan) yeniden takibe alınıyor, geçmişte `orphan: true` işaretli; mumu olmayan (TF taranmıyor/coin listeden çıktı)
  bekleyen planlar da 24 saatte `expired`. İlk canlı turda eski kayıtlar toplu kapanacak (closedAt = o tur; gerçek zaman değil).
- **−0,86R'nin ana nedeni yön yığılması, kod değil (kuvvetli işaret):** eski rejimin 558 sinyalinin **509'u long** (109 coin, coin başına
  13'e kadar tekrar); stop olan 380'in 366'sı long. 21–24.10 düşüşünde aynı long bahsi ~400 kez açılmış = tek bağımsız sonuç.
  12 aylık backtest ortalaması bu tür 4 günlük tek yönlü pencereyi yansıtmaz. Stop takibi doğrulanmadı (bu ortamdan OKX'e erişim yok).
- Sıradaki (öneri): canlı-backtest eşleştirme betiği (her canlı sinyali aynı seviyelerle gerçek mumlarda `trackPlan` + motorla yeniden
  oynat, farkları listele) → backtest.yml'de `mode=replay`. Denetçinin "uygulama hatası" şüphesini kesin kapatır.

## 28.10.2026 — Canlı-backtest eşleştirme sonucu (replay, koşu 40639326072, 592 kayıt, gerçek OKX mumları)
| Kesit | Kaydedilen R (n, kazanma) | Takip yeniden (n) | Motor (n) | Durum eşleşmesi |
|---|---|---|---|---|
| Eski rejim long | −0,80 (402, %9) | −0,74 (387) | −0,73 (387) | %90 |
| Eski rejim short | +0,29 (40, %45) | +0,30 (45) | +0,30 (44) | %93 |
| Yeni 4H (26.10'dan) | +0,10 (14, %79) | +0,08 (13) | −0,05 (10) | %92 |
| Tümü, aynı kayıtlar | −0,659 (418) | −0,663 | — | %91 |
- **Uygulama hatası yok:** canlı takip, aynı seviyelerle gerçek mumlarda yeniden oynatılınca aynı sonucu veriyor (aynı 418 kayıtta
  −0,659 vs −0,663R); backtest motoru da aynı planlarla aynı yerde (−0,73R). Eski rejimin kaybı gerçek: long yığılması + düşüş.
  Eski short'lar +0,29R. Denetçinin "uygulama hatası şüphesi" kapandı.
- Uyuşmayan 51 kaydın 33'ü bıçak koruması açılış tarihi belirsizliği (betik 21.10 07:00 varsaydı), kalanı çoğunlukla
  önbellek kaybı dönemindeki sahipsiz kayıtlar ve aynı mumda stop/hedef sırası; sistematik yön yok.
- Yeni 4H: n 13 → sonuçsuz (motor −0,05 farkı 3 kaydın kaçan/bıçak sayılmasından). 4–6 hafta beklenir.
- Araç: `node backtest/replay.mjs` / Actions → backtest → `mode=replay` (rapor `docs/backtest/replay.json`). İstenirse haftada bir.

## 28.10.2026 — Yön yığılması sınırı ölçüldü (sweep 40640085060, 12 ay, 1H/4H planları)
Canlı 4H düzeni (bıçak + hafta sonu yok + limit + erken %80 + HTF aynı yön) üstüne portföy tavanı:
| Varyant | Eğitim R / PF (n) | Doğr. R / PF (n) | Hedge'li eğ / doğr | maxDD eğ/doğr | En kötü 7 gün R | Aynı yönde açık p50/max |
|---|---|---|---|---|---|---|
| tavansız (canlı) | +0,114 / 1,59 (238) | +0,093 / 1,51 (257) | +0,054 / +0,079 | 7,9 / 7,9 | −4,4 / −3,7 | 7–8 / 22–25 |
| ≤ 10 açık | +0,118 / 1,60 (210) | +0,084 / 1,43 (204) | +0,053 / +0,057 | 8,3 / 7,2 | −4,4 / −3,7 | 5–6 / 9 |
| ≤ 5 açık | +0,047 / 1,22 (155) | +0,088 / 1,45 (148) | +0,008 / +0,072 | 6,4 / 5,8 | −3,1 / −4,3 | 3 / 4 |
| ≤ 3 açık | +0,013 / 1,06 (119) | +0,121 / 1,73 (110) | −0,021 / +0,099 | 7,3 / 2,7 | −2,9 / −2,7 | 1 / 2 |
| mum başına ≤ 2 yeni | +0,048 / 1,23 (200) | +0,097 / 1,52 (202) | +0,006 / +0,086 | 8,3 / 5,2 | −4,6 / −2,8 | 5 / 12–15 |
| mum başına ≤ 1 yeni | +0,007 / 1,03 (155) | +0,079 / 1,41 (140) | +0,003 / +0,076 | 8,1 / 5,8 | −4,5 / −3,5 | 3 / 7–9 |
- **Hiçbir tavan iki dilimde temeli geçmedi.** Sıkı tavanlar eğitimde R'yi çökertiyor (≤ 3: +0,01R, PF 1,06 → sıkı ölçüt dışı); doğrulamadaki
  +0,12R tek dilim = seçim iyimserliği. Tavan kârlı işlemleri de kesiyor; toplam R düşüyor (eğitim 27 → 1,5–25).
- Yığılma backtest'te de olağan (aynı yönde ortanca 7–8 açık, en çok 25) ve 4H'de zarar kaynağı değil; en kötü 7 gün yalnız −4R.
- Eski 1H+4H düzeni tavanla da negatif (≤ 5: doğr. −0,07R, hedge'li −0,13R) → 21–24.10 kaybı yığılmadan çok 1H + eski filtrelerden.
- **Karar:** canlıya kural yok (Variables değişmez). Gerçek parada kişisel risk kuralı olarak "aynı yönde ≤ 3 açık işlem" mantıklı
  (toplam risk sınırı), ama bu kenar artırmaz, yalnız kötü haftayı yumuşatır.
- Not: tavansız 4H satırı n 257 (24.10 taramasında 293) — aradaki tam koşuyla planlar yenilenmiş; karşılaştırma aynı koşu içinde.

## 28.10.2026 — Arkadaşın tarayıcısı (klonnist/ew-setup-scanner) karşılaştırması
- Bizdeki `src/scan/wave3.js` ~24–25.10 kopyası; `src/ew` motoru aynı. Onda sonradan gelenler: C uzaması/C alt derecede bitti
  düzeltmeleri (kurulum listeden düşmüyor), "ders kitabı şekli" x/4 (kendi notu: 4/4 en zayıf grup), SMT etiketi (yalnız dalga-3 limit
  bölge long; iddia 1 yıl 4H ilk 20: +53R, n 151, PF 1,68, iki yarıda kârlı — hedge'li R yok), çelişen sayım chip'i, running üçgen
  (ABCDE) ve diagonal dalga 4→5 modları, tarayıcıda ★ takip listesi, backtest para simülasyonu (kaldıraç/tasfiye), hedef seçimi, CSV.
- Öneri sırası: (1) wave3 düzeltmelerini taşı, (2) lab'de SMT + ders kitabı etiketini sıkı ölçüt + hedge'li R ile ölç, (3) ★ takip listesi.
  Kullanıcı kararı bekleniyor.

## 28.10.2026 — Dalga-3 güncellemesi + SMT / ders kitabı ölçümü (lab 40658989127, 24 ay, 4H, ilk 50; bölünme 02.03.2026)
| Aile | Eğitim R / PF (n) | Doğr. R / PF (n) | Hedge'li eğ / doğr | Karar |
|---|---|---|---|---|
| w3_zone (C uzaması açık, L+S) | −0,08 / 0,87 (978) | +0,02 / 1,04 (671) | −0,10 / −0,02 | ret |
| w3_zone_legacy (eski C kuralı) | −0,06 / 0,90 (968) | +0,05 / 1,08 (660) | −0,08 / 0,00 | ret (≈ aynı) |
| w3_zone_long | −0,12 / 0,80 (868) | +0,18 / 1,34 (591) | −0,13 / +0,06 | zayıf (yalnız doğr.) |
| w3_zone_long_smt (SMT ✓) | −0,16 / 0,76 (581) | +0,13 / 1,24 (344) | −0,13 / +0,06 | ret |
| w3_zone_long_nosmt | −0,17 / 0,73 (704) | +0,19 / 1,36 (497) | −0,15 / +0,04 | ret |
| w3_zone_tb3 (≥ 3/4) | −0,06 / 0,91 (525) | −0,11 / 0,84 (368) | −0,03 / −0,13 | ret |
| w3_zone_tb4 (4/4) | +0,09 / 1,14 (147) | −0,23 / 0,67 (102) | +0,06 / −0,11 | ret |
| w3_zone_tb_low (≤ 2/4) | −0,08 / 0,86 (931) | +0,03 / 1,05 (631) | −0,12 / 0,00 | ret |
- **SMT doğrulanmadı:** SMT ✓ long'lar SMT'siz long'lardan iyi değil (doğr. +0,13 vs +0,19; hedge'li +0,06 vs +0,04). Long'lar
  eğitimde −, doğrulamada + (Mart–Ekim 2026 yükselişi; short'lar tersi) → kazanç BTC yönünden (r 0,55). Arkadaşın 1 yıllık +53R'si
  büyük olasılıkla bu yükseliş dilimi (hedge'siz).
- **Ders kitabı şekli kenar vermedi**; 4/4 doğrulamada en kötü (arkadaşın notuyla aynı). Etiket olarak kalır, filtre önerilmez.
- **C uzaması** sonucu değiştirmiyor (≈ aynı) → tarayıcıda açık, botta kapalı kalır.
- Yaklaşım farkı: tek limit yakın kenarda, emir 96 saat (orijinal: kademeli, B kırılana kadar); TP1 1 × dalga 1.
- **Yapılanlar:** `src/scan/wave3.js` güncel sürüm (`cExtend` bayrağı, bot varsayılanı eski davranış, 240/240 birebir), `src/scan/smt.js`,
  tarayıcıda **Ayarlar** bölmesi (Genel + Dalga-3 alt başlıkları), sinyal adında 📐 x/4 ve SMT ✓, notta eksik şartlar. Testler 145.

## 28.10.2026 — ★ Takip listesi + CLAUDE.md "sorgula" kuralı
- Tarayıcıya ★ takip listesi (botun buildPlan/trackPlan'ı; localStorage; not, sil, kapananları sil, dışa/içe aktar, 5 dk'da bir
  güncelleme, bildirim). Testler 147.
- CLAUDE.md: kullanıcı isteği mantıksız/eksik/ölçümle çelişiyorsa uygulamadan önce söyle ve sorgula.
- Bekleyen: işlem check list'i (10 madde) — öneri kullanıcı onayında.
- **Check list (10 madde, onaylandı; stop eşiği %0,8):** ayrıntıda ✓/✗/? + ölçüldü/ölçülmedi etiketi; takibe alınana dondurulur.
  Maddeler 1–6 ölçülmüş filtreler, 7 kural, 8–10 ölçülmedi. Öneri: "≥ N madde" kesitini sweep'te ölç (karar aracı değil, kontrol
  aracı). Testler 150.

## 28.10.2026 — Check list ölçümü (koşu 40666195858; 12 ay 1H/4H, 70 bin plan; bölünme 13.07.2026)
**Tüm planlar (filtresiz, n 47 bin; taban eğitim −0,09 / doğr −0,08R).** Madde etkisi Δ = ✓ − ✗ (eğitim / doğrulama · hedge'li):
| Madde | Δ R | Δ hedge'li | Sonuç |
|---|---|---|---|
| stop ≥ %0,8 | +0,22 / +0,22 | +0,32 / +0,32 | **sağlam, en güçlü** (dar stop = komisyon) |
| limit giriş | +0,04 / +0,07 | +0,05 / +0,06 | sağlam |
| hafta içi | +0,03 / +0,03 | +0,04 / +0,04 | sağlam |
| BTC günlük rejimi | +0,15 / **−0,11** | +0,04 / 0,00 | tutarsız |
| üst TF trendi | +0,07 / −0,09 | +0,04 / +0,03 | tutarsız |
| yavaş yaklaşma | −0,01 / +0,06 | −0,02 / +0,03 | tutarsız |
| rs, yol temiz, likidite, ≥ 2 yöntem | ≈ 0 ya da − | ≈ 0 | etkisiz |
- **Ağırlıksız sayım:** ≤ 3 en kötü (doğr. −0,17R), 4–7 arası −0,04…−0,08, **≥ 8 yine kötü (−0,15)**; hiçbir kova pozitif değil.
- **Ağırlıklı puan (ağırlık eğitimden):** doğrulamada yüksek dilim (−0,10R) düşük dilimden (−0,04R) **kötü** → çöktü (BTC ve üst TF
  ağırlıkları dönemle ters döndü). Hedge'li ağırlıkla da ayırt etmiyor.
**Canlı 4H düzeni içinde (n 495; 4, 6, 7 ve üst TF hep ✓ → ölçülemez):** rs +0,04 / +0,03 (hedge'li +0,09 / +0,06), yavaş yaklaşma
+0,02 / +0,11, yol temiz +0,19 / +0,01 (n 65–80) → zayıf pozitif, sonuçsuz; likidite mıknatısı −0,07 / −0,05; BTC rejimi ≈ 0.
Sayım 6 / 7 / ≥ 8: doğr. +0,07 / +0,10 / +0,11R (fark gürültü düzeyinde); ağırlıklı yüksek–düşük farkı +0,02R (anlamsız).
**Düzeltme (önemli):** "kazanç BTC yönünden" = işlem SÜRESİNCE BTC'nin gittiği yön (β, geriye bakınca). Girişteki BTC günlük
rejimi bunu önceden bilmiyor (tutarsız). Check list etiketleri ölçüme göre güncellendi (sağlam / zayıf + / tutarsız / olumsuz / etkisiz).
**Karar önerisi:** sayı/puan karar aracı değil. Gerçek parada sağlam üçlü: stop ≥ %0,8 · limit · hafta içi. Canlıya kural yok
(4H stopları zaten geniş; stop ≥ %0,8 yalnız 1H/15m açılırsa anlamlı). Testler 151.
- 28.10 son: check list 8 maddeye indi ("hedefte likidite" olumsuz, "≥ 2 yöntem" etkisiz → çıkarıldı). Coin sayfasına
  **Katmanlar** (FVG / OB / Likidite / Fib; odak modunda soluk çizim). FVG "Price action / SMC" ailesinde; odak modu yalnız
  en güçlü 3 sinyali çizdiği için görünmüyordu. Testler 151.
- Takip kartına dokununca ayrıntı + grafik (giriş/stop/TP çizgileri, eklendi/giriş/TP1/kapanış işaretleri, dondurulan check list).
  Grafiklere isteğe bağlı **Yapı** katmanı (son 8 swing HH/HL/LH/LL + son 4 BOS/CHoCH): tarayıcı ayrıntısında kutu, coin
  sayfasında Katmanlar. Testler 152.

## 28.10.2026 akşam — Diyagonal lab yeniden (koşu 40762943515; 24 ay, ilk 50, 1H/4H; bölünme 02.03.2026)
| Aile | Eğitim n / kazanma / R / PF | Doğr. n / kazanma / R / PF | Hedge'li eğ / doğr |
|---|---|---|---|
| ending_diagonal | 95 / %14 / −0,22 / 0,78 | 75 / %19 / +0,30 / 1,32 | −0,37 / +0,08 |
| ending_diagonal_wide (stop +1 ATR) | 85 / %24 / −0,01 / 0,99 | 68 / %29 / +0,24 / 1,32 | −0,14 / −0,07 |
| leading_diagonal | 11 / %64 / +1,00 / 3,68 | 6 / %33 / −0,12 / 0,82 | +0,59 / −0,78 |
- Sıkı ölçütü geçen yok. Ending doğrulamadaki kâr long'lardan (+0,63R; short −0,13R) = yükseliş dönemi (β 1,0, r 0,67). Leading n 17 → sonuçsuz.
- Arkadaşlara paylaşım sayfası: https://claude.ai/artifact/9pFjTqbgE5Yve2u3ZJQNad (komisyon %0,05/taraf, kayma %0,05 piyasa/stop; funding yok).

## 29.10.2026 — ÖNEMLİ: dolum mumunda erken hedef iyimserliği (sweep 40841478908, 12 ay)
Soru (OL 4H): Telegram'da "giriş bölgesine geldi" ve "erken hedef" aynı turda. Canlıda erken hedefe ulaşan 21 işlemin 12'si
girişle aynı turda. Neden: erken hedef girişin %1,2 ötesi, 4H ATR %2–5 → tek 4H mum ikisini de kapsıyor; bot ve backtest
motoru 4H mumda sırayı bilmeden "önce dolum, sonra hedef" varsayıyordu (iyimser). Ölçüm, canlı 4H düzeni:
| Dolum mumunda hedef | Eğitim R / PF | Doğr. R / PF | Hedge'li eğ / doğr |
|---|---|---|---|
| iyimser (eski varsayım) | +0,114 / 1,59 | +0,093 / 1,51 | +0,054 / +0,079 |
| **1H mumlarla gerçek sıra** | **+0,025 / 1,09** | **+0,028 / 1,11** | **−0,020 / +0,016** |
| kötümser (hiç sayılmaz) | −0,023 / 0,93 | −0,029 / 0,90 | −0,047 / −0,033 |
- **Canlı 4H düzeninin beklentisi +0,08R değil, ≈ +0,03R; hedge'li ≈ 0.** Sıkı ölçüt (eğitim PF 1,09) geçilmiyor. "Çalışan tek kesit"
  bulgusunun büyük kısmı bu iyimser varsayımdan geliyordu. Önceki tüm sweep/lab sonuçları da (limit dolum + yakın hedef olanlar)
  aynı iyimserliği taşıyabilir; geniş hedefli ailelerde etki küçük.
- Motor: `fillBarTp` ('count' varsayılan / 'skip' / 'lower' + `fillOrder`), sweep satırları "dolum mumunda sıra 1H ile" / "kötümser".
- Öneri (kullanıcı kararı): (1) canlı kural değişmeden kâğıt test sürsün, beklenti ≈ 0 olarak okunsun; (2) bundan sonra tüm
  ölçümler `fillBarTp: 'lower'` ile; (3) erken hedef mesafesini (%1,2 yerine 0,75R / 1R / 1,5R) 1H sırasıyla yeniden ölç;
  (4) bot takibinde aynı 4H mumdaki dolum + hedefi 15m mumlarla çöz, Telegram'da tek mesaj. Testler 153.

## 29.10.2026 — Erken hedef mesafesi gerçek sırayla (sweep 40846483158) + bot 15m sıra düzeltmesi
| Canlı 4H düzeni, dolum mumunda 1H sırası | Eğitim R / PF | Doğr. R / PF | Hedge'li eğ / doğr |
|---|---|---|---|
| erken %80 @ %1,2 (canlı) | +0,025 / 1,09 | +0,028 / 1,11 | −0,02 / +0,02 |
| erken %80 @ 0,5R | −0,02 / 0,94 | −0,02 / 0,93 | −0,05 / −0,04 |
| erken %80 @ 0,75R | −0,06 / 0,87 | +0,00 / 1,01 | −0,05 / −0,03 |
| erken %80 @ 1R | −0,05 / 0,90 | −0,04 / 0,93 | −0,04 / −0,06 |
| erken %80 @ 1,5R | −0,07 / 0,88 | −0,06 / 0,91 | −0,05 / −0,05 |
| erken %50 @ 1R | −0,02 / 0,96 | −0,02 / 0,96 | −0,03 / −0,04 |
| standart (TP1 yarı, başabaş) | −0,08 / 0,87 | −0,07 / 0,89 | −0,05 / −0,04 |
- Daha iyi mesafe yok; en iyisi mevcut %1,2 ve o da ≈ 0 (hedge'li ≈ 0). **Sonuç: 4H sinyal düzeninin gerçekçi kenarı yok.**
  Canlı kâğıt test, ölçümü doğrulamak için sürebilir; gerçek para için kural olarak önerilmez.
- Bot: aynı 4H mumdaki dolum + erken hedef/TP1/stop sırası 15m mumlarla çözülüyor (`fillRes`), aynı turdaki olaylar tek mesaj
  ("↳" ile; "sıra 15m mumlarla doğrulandı" ya da "son 15 dakikada sırayla"). Testler 154.

## 29.10.2026 — Eğitim: indikatörler + kontrol listesi
- Kullanıcı TradingView'a ICT Killzones / Smart Money Concepts / Previous Highs & Lows [LuxAlgo] ekledi; öneriler CLAUDE.md'de. Killzone Asya ≈ 01–05 UTC (bizim tanım 00–07).
- Coin kontrol listesi: `docs/egitim/coin-kontrol-listesi.md` + telefonda işaretlenebilir sayfa https://claude.ai/artifact/Nr2ZywwscFMkDBwNQ8iVsD (coin başına localStorage).
- İlk deneme AVAX: günlük MSS 10,048 (PWH, 21 Eki) doğru; düzeltilenler: 4H'yi bozan seviye 4H LH 9,166 (PWH değil), weak low 8,55 alınmadı (hedef), BTC 4H range'de discount (0,81), AVAX PWL'yi aldı BTC almadı (AVAX zayıf), senaryo A short olmalı (Asya tepesi 9,014 + OB 8,97–9,06 süpürme → 15m MSS → short, stop süpürme ucu + 0,1–0,2 ATR).

## 29.10.2026 — Takip kartı düzeltmesi
- 29.10: takip kartı hatası (PONS 5m): kart eski fiyatla "+0,18R anlık" gösterirken grafik stopu gösteriyordu. Sebep: ayrıntı
  grafiği yeni mumları indiriyor ama kaydı güncellemiyordu; 5 dk'lık yenileme sekme arka plandayken atlanıyordu. Düzeltme:
  ayrıntı açılınca aynı mumlarla kayıt güncellenir, sekmeye dönünce liste hemen yenilenir, kartta son güncelleme saati var.
- 29.10: **smc-analiz skill'i** eklendi (`.claude/skills/smc-analiz/`) + `bot/practice/smc_levels.mjs` (seviye hesabı) + test. Kullanıcı "SMC'ye göre analiz et <COIN>" der; öğrenme modunda önce sorular. Testler 157 geçiyor.
- 29.10 HUMA long (kullanıcı): giriş 0,02668, **25x**, plan stop 0,02496 (−%6,4) / hedef 0,03278; tepe 0,02749 (+%3,1), elle +%1,0'da (0,02695) kapandı, ROI +%26 ≈ **+0,16R**. Uyarı: 25x izole marjinde tasfiye ≈ −%3,6 (≈ 0,0257) → stoptan ÖNCE; kaldıraç stop mesafesine göre seçilmeli (≤ ~1/(stop%×1,5)). ROI yanıltıcı, R esas.
- 29.10 ONDO: kullanıcının fikri (0,4100 long, stop 0,4074, hedef 0,4188) yönde doğru çıktı; EQL 0,4073 süpürülmeden yükseldi (tepe ≈ 0,4172). Benim "önce süpürme" önerim bu örnekte işlemi kaçırırdı; tek örnek, kayda alındı.
- 29.10: Lab'e **kanal + 0,618×1,272** ailesi (`chan_fib_p0/pool/sweep/p0_htf`, long+short) ve `--fillbar skip` (kötümser dolum mumu) eklendi. Koşu 1: 24 ay, top 50, 15m/1H/4H (+ kontrol `fib_cluster_g_p0`); koşu 2: 5m, 6 ay. Testler 158.
- **Kullanıcının kendi kurulumu (kanal + fib, 5m) gözlem listesi:** ONDO 29.10 (limit 0,4100) → yön doğru, giriş muhtemelen dolmadı (dip ≈ 0,4105); SUI 29.10 (limit 0,9292) → yön doğru, giriş gelmedi (BTC NY'de 80,0k → 81,5k). İkisinde de benim "önce süpürme" şartım da tetiklenmezdi. Ders: güçlü hareketlerde derin limit dolmuyor → backtest'te dolum oranı (fillRate) ayrıca okunacak.

## 29.10.2026 — Kanal + 0,618×1,272 lab sonucu (koşu 40888890873, 24 ay, top 50, 15m/1H/4H, fillbar=skip)
| Varyant | Eğitim R / PF | Doğr. R / PF | Hedge'li eğ / doğr | n | Dolum |
|---|---|---|---|---|---|
| chan_fib_p0 (kullanıcının stopu) | −0,13 / 0,81 | −0,17 / 0,75 | −0,23 / −0,17 | 153 | %52–62 |
| chan_fib_pool (stop havuz altı) | −0,57 / 0,35 | −0,54 / 0,29 | – | 31 | %48–59 |
| chan_fib_sweep (süpürme sonrası giriş) | −0,69 / 0,39 | −1,13 / 0,11 | – | 47 | piyasa |
| chan_fib_p0_htf (günlük yönde) | −0,10 / 0,85 | −0,09 / 0,86 | −0,33 / −0,23 | 72 | %39–64 |
| kontrol fib_cluster_g_p0 (kanalsız) | −0,06 / 0,91 | −0,09 / 0,86 | −0,15 / −0,14 | 3422 | %18–20 |
- Hiçbiri sıkı ölçütü geçmedi; kanal şartı sonucu iyileştirmedi (ve n'yi 20× azalttı). Süpürmeli giriş en kötüsü (stop fitile çok yakın, çoğu stop). Kanalsız fib kesişiminde limitlerin ~%80'i hiç dolmuyor (kullanıcının ONDO/SUI gözlemi).
- Tek pozitif kesit (seçilmiş, iyimser): kontrolde 1H long n270 +0,10R PF 1,18, 4H long n20 +0,29R — long-only = BTC yönü olabilir, ölçülmeden kural yok.
- 5m (6 ay, koşu 40910478840): chan_fib_p0 eğ −0,25R / doğr −0,57R (n 112), pool −0,02 / −0,58 (n 27), sweep −0,85 / −0,64 (n 30), p0_htf −0,58 / −0,26 (n 51); hedge'li hepsi negatif. 5m daha kötü (gürültü + komisyon). **Karar: kanal + fib kesişimi tek başına kural olmaz; yorumda "bakılacak yer".**

## 30.10.2026
- 29.10 NY: BTC PDH/EQH 81 787'yi 81 944'e süpürdü → 17:00 geri altında kapanış → 20:00'den itibaren 76 472'ye düşüş (PWL 79 168 ve PDL alındı; günlük LL). 28.10'daki "81 787 süpürülür + MSS ↓ → short" senaryosu gerçekleşti.
- DATA: önerilen limit 0,1371 dolup stop olurdu (dip 0,1259) → −1R (%0,5); kullanıcı girmedi. Kesişim (0,1381) de stop olurdu.
- smc_levels notu: 4H yapı etiketi pivot onayı gecikmeli (30.10 sabahı "HH/HL" dedi, gerçek 4H BOS ↓ 79 168) → skill'de son BOS'u öncele.
- 30.10: **Rejim → model** çalışması başladı (kullanıcı onayı). `src/scan/btcRegime.js` (G↑/G↓ × normal / şok↓ toparlanma|devam / şok↑ geri çekilme|devam) + lab `byRegime`/`byRegimeDir`. Faz 1 hızlı test: 10 aile, 1H/4H, 24 ay, fillbar=skip. Sonra tam matris + eğitimde seç/doğrulamada test eden seçici. Testler 159.

## 30.10.2026 — Rejim × model hızlı test (koşu 41025413530; 10 aile, 1H/4H, 24 ay, fillbar=skip)
- Seçici dürüst testi: eğitimde (n ≥ 50, R > 0,05, PF > 1,1) seçilen 20 rejim×yön×aile hücresi doğrulamada **n 3836, ort. −0,018R** (tümünün ortalaması −0,125R). Rejim seçimi kaybı büyük ölçüde azaltıyor ama tek başına pozitif değil.
- Tek güçlü hücre: **G↑ · şok↑ devam · long · donchian** eğitim n525 +0,35R PF 1,81 / doğr. n350 +0,84R PF 3,6 (engine_wide, w3_zone aynı yönde pozitif). Aynı rejimde short'lar her ailede sert negatif. Tersi (G↓ · şok↓ devam · long) her ailede negatif → "bıçak yakalama".
- Sınırda: G↑ · normal · short · div_rsi_mss +0,12 / +0,08 (n 428/315, doğr. PF 1,17); G↓ · normal · short · zigzag_c +0,30 / +0,30 (doğr. n 62).
- 30.10 sabahki rejim (G↓ · şok↓ toparlanma): doğrulamada çok az örnek → sonuçsuz.
- Eksik: rejim hücrelerinde hedge'li R yok (donchian long kazancı BTC yönü olabilir — amaç zaten BTC ile birlikte kazanmak, ama ölçülmeli). Sıradaki: tam matris + hücre başına hedge'li R + yürüyen (walk-forward) seçim.
- 30.10: Lab'e **yürüyen rejim seçici** (`backtest/lab/selector.js`: her ay yalnız geçmişten n ≥ 50, R > 0,05, PF > 1,1 olan rejim×yön×strateji hücreleri; 6 ay ısınma; R ve hedge'li R ile ayrı) + hücre başına hedge'li kırılım (`byRegimeDirHedged`). Tam matris koşusu: tüm aileler (chan_* hariç), 1H/4H/1D, 24 ay, fillbar=skip. Testler 160.

## 30.10.2026 — Tam rejim matrisi (koşu 41037446881; 49 aile, 1H/4H/1D, 24 ay, fillbar=skip)
- **Yürüyen rejim seçici** (her ay yalnız geçmişten seçim): n 9136, ort. **−0,063R** (doğrulama kısmı ≈ 0,00R); hedge'li seçim −0,061R. → Genel "rejime göre model seç" sistemi kenar vermedi.
- **Tek sağlam hücre: G↑ · şok↑ devam · long · Donchian** — donchian (1H/4H) ham eğ n524 +0,35R / doğr n352 +0,84R; **hedge'li +0,16 / +0,38R**; donchian_4h_long hedge'li +0,46 / +0,69R (n 130/116). Aynı rejimde short'lar her ailede negatif.
- Umut veren ama doğrulamada az örnekli: G↓ · şok↓ toparlanma · long · RSI uyumsuzluğu (eğ n 58 +0,65R, doğr n 9) → sonuçsuz.
- Eklendi: **REGIME_DONCHIAN** kâğıt kuralı (varsayılan kapalı; açmak kullanıcıda). Testler 162. Öneri: Variables'ta REGIME_DONCHIAN=1 → ileriye dönük kâğıt test (rejim yılda birkaç kez/ay; az ama hedefli işlem).
- **30.10 olay:** REGIME_DONCHIAN eklerken `scan.yml` önbellek yoluna `bot/regime-state.json` eklendi → actions/cache sürümü değişti, 10:30 turundan itibaren bot durumu (ajanlar, momentum, sinyal durumu) sıfırdan başladı. Düzeltme: yol listesi eski haline döndü (10:16 önbelleği yeniden eşleşmeli), rejim durumu `docs/agent/regime.json`'dan kurulur. Sıfırlanma öncesi yayınlar + dersler: `docs/agent/archive/2026-10-30/` (Temkinli 32 işlem −%14,4, Agresif 32 işlem −%11,2, momentum −%7,4). **Kural: önbellek yol listesi değiştirilmez.**
- 30.10 11:15 turu: geri alma tuttu — Temkinli 32 işlem / 10 ders / 256,90, Agresif 32 / 10 / 266,49, momentum 277,59 geri geldi (10:16 önbelleğinden). Kayıp yalnız 10:30–11:00 arası 3 tur.
- 30.10 **API maliyeti:** ajanlar (2 profil, Opus 5.5, 15 dk) ≈ 190 çağrı/gün × (~12k giriş + ~3k çıkış) ≈ **20 $/gün ≈ 600 $/ay** (tahmin; fiyat $4/$20 MTok). Değer: 64 işlem, Temkinli −%14,4 (PF 0,21), Agresif −%11,2 (PF 0,94); dersler ölçümlerle örtüşüyor ama karar katmanı kenar üretmedi (aday kaynağının kenarı ≈ 0). Öneri: AGENT_MODEL=claude-haiku-5-5 + AGENT_EVERY_MIN=60 (≈ 4 $/ay; Haiku 5.5 $0,10/$0,50) ya da AGENT=0; denetçi (günlük) ve araştırmacı (haftalık) Opus'ta kalabilir (birkaç $/ay). Kod: Haiku'da `fallbacks` gönderilmez (Haiku desteklemiyor). Testler 163.
- 30.10: Kullanıcı A seçeneğini uyguladı (AGENT_MODEL=claude-haiku-5-5, AGENT_EVERY_MIN=60). Eklendi: **AGENT_SOURCE=measured** (varsayılan all) → ajanlar yalnız ölçülmüş kural adaylarını (rejim-Donchian) görür; aday/pozisyon yoksa API çağrısı yok. Testler 164. Ajanların yeni dönemi ölçülmüş kenar + LLM yönetimi (giriş seçimi, stop/çıkış) karşılaştırması olacak: rejim-Donchian'ın kural sonucu (docs/agent/regime.json) ile ajanların sonucu yan yana.
- 30.10 **Dönem karşılaştırması** (`bot/review/periods.js`, history 612 sinyal; dönemler sinyal alanlarından çıkarıldı):
  P1 başlangıç (20.10, tüm TF): 66 sinyal, kapanan 63, kazanma %40, ort. +0,05R · P2 15m kısıldı (21.10): 216 (108/gün), kazanma %9, −0,81R · P3 BTC rejimi + RS (22.10): 181, %9, −0,79R · P4 bıçak koruması (23.10): 95, %13, −0,63R · **P5 canlı düzen (24.10→): 54 (10,8/iş günü), dolum %65, kapanan 33, kazanma %73, ort. +0,01R, toplam +0,22R**.
  Okuma: P5 sıklığı ~%90 azalttı, kaybı durdurdu (−0,6/−0,8R → ≈ 0); P2–P4'te sinyallerin %95+'ı long ve BTC düşüyordu (dönem farkı kısmen piyasa); P5 n = 33 → sonuçsuz, kenar iddiası yok (backtest de ≈ 0 diyor). Eklendi: her sinyale `cfg` etiketi, Pazartesi haftalık Telegram raporu (`WEEKLY_REPORT`, vars. açık). Testler 168.
- 02.11 BNB 4H short (bot sinyali 00:00 UTC): giriş 714,315 (~03:00 doldu), stop 722,604, erken kâr 705,74 07:00'de geldi (%80 kapandı ≈ +0,83R), TP1 701,88 / TP2 677,47 bekliyor. Kurulum: 29.10 düşüşü (754,16→677,47) sonrası W 718,5 – X 693,1 – Y 717,7 düzeltmesi, bölge fib 0,5 (715,8) + W/Y eşit tepesi; stop EQH üstünde. Kullanıcı gerçek işlemle girdi. Pine çizimi: docs/egitim/pine/bnb_short_2026-11-02.pine.
- 02.11 **Sinyal grafiği** eklendi (`SIGNAL_CHART=1`, varsayılan kapalı; kullanıcı onayladı: a = kurulum çizimleri + stop çevresi FVG/likidite uyarısı, b = kapanışta sonuç grafiği). BNB 02.11 örneğinde: EW WXY çizgileri, CHoCH, iFVG, fib %38,2; uyarı "stop 718,5–742,3 düşüş FVG'sinin içinde". Testler 174. Açmak için Variables: SIGNAL_CHART=1.
- 02.11 **Kullanıcı gerçek işlem — APRUSDT long (Bybit, düşük TF, kendi kurulumu):** C/2. dalga sonu fib 0,618 (0,0523; fib 0 = 0,05381, 1 = 0,05137) + kanal alt çizgisi; giriş ≈ 0,05224, stop 0,05125 (risk 0,00099). TP1 0,0539 → 0,0538 dolum, 2676 APR (11:18 TR, +1,6R) · TP2 0,0546 → 0,0545, 574 APR (11:27 TR, +2,3R) · TP3 0,0553 (3. dalga hedefi, +3,1R) bekliyor. Kural uyumu: düzeltme dibinden limit, TP1 ≥ 1,5R, kademeli çıkış ✓.
- 02.11 **Kullanıcı gerçek işlemleri (Bybit, saatler TR), toplam +15,96 USDT, 5/5 kazanç:**
  - APR long (kendi fib çakışması kurulumu, 5m): 3824 adet, +5,83 $. TP1 0,0538 (1432 adet, 11:23), TP2 0,0545 (574, 11:56), kalan 574 adet çekilen stop 0,0538'de kapandı (12:52); sonra TP3 0,0553 geldi (tepe 0,0556). Ders: TP2 sonrası stopu TP1'e çekmek kalan %15'te ≈ 0,86 $ kaçırdı; kapanmış kârı korudu. Tek örnek, kural değil.
  - BEAT long #1 (fib çakışması, 3m): 12:35–13:34, 2508 adet, ≈ 0,0991 → 0,1008, +4,27 $.
  - BEAT long #2 (fib çakışması, 5m): 16:27–19:24, 999 adet, ≈ 0,1003 → 0,1018 (699) / 0,1050 (300), +2,48 $.
  - BNB short (bot 4H sinyali 02.11 00:00 UTC): 0,35 adet @ ≈ 713,6; 0,24 @ 705,73 (erken kâr, 08:45), 0,11 @ 705,01 (13:34), +2,56 $. Bot planıyla uyumlu.
  - HYPE long (bot 4H sinyali 04:45 UTC, giriş 88,10 / stop 86,47): kullanıcı 85,99'dan girdi (09:06 TR = 06:06 UTC), 86,37'den çıktı (14:41), +0,82 $. **Bot planı o sırada stop olmuştu** (history: stopped); bu işlem botun ölçülen kurulumu değil, stop sonrası dip alımı.
- 03.11 SIGNAL_CHART çalışıyor (kullanıcı onayı: grafikler Telegram'a geliyor). BEAT: kullanıcının 02.11 tepeden short planı vardı, fiyat seviyeye hızlı geldi, emir önceden konmadığı için giriş kaçtı; sonradan kovalamadı (kural ✓). Ders: plan varsa limit + stop önceden girilir ya da alarm kurulur.
- 03.11 Kullanıcı PENDLE long'a küçük miktarla girdi (arkadaşın 15m EW sayımı: 1–5 itki 1,6253→1,9147, ardından a-b-c; giriş ≈ 1,7410 fib 0,618 bölgesi, stop 1,6505, hedef 1,9795). Risk %5,2; 5. dalga tepesi 1,9147 = +1,9R, hedef = +2,6R. Not: stop 1,6253 dibinin (likidite) yalnız 0,025 (%1,5) üstünde.
- 03.11 **Range sapması lab (arkadaşın PA yöntemi; 6 ay, ilk 30 coin, 15m/1H/4H, fillBarTp kötümser):** sıkı ölçütü geçen yok.
  range_dev (kapanışta giriş, TP1 orta, TP2 karşı kenar): n 14.973, eğitim −0,29R / doğr. −0,27R, PF 0,63–0,65, hedge'li −0,48R · _edge (kenar geri testinde limit): −0,63 / −0,66R · _htf (günlük trend yönünde): −0,29 / −0,27R · _wide (60 mum): −0,28 / −0,26R.
  TF'ye göre: 15m −0,32R (n 11.387) en kötü, 1H −0,20R, 4H −0,12R; _htf 4H doğr. +0,12R ama eğitim negatif ve n ≈ 300 → sonuçsuz. Maliyet (komisyon + kayma) dar bantlarda R'yi ~0,25 düşürüyor; maliyetsiz bile ≈ 0 civarı. Karar: canlıya/sinyale eklenmez (kullanıcı kuralı: onaylanmadan eklenmez).
- 03.11 Eklendi: senaryo okları + açıklama paneli (Telegram grafiği), tarayıcı ve coin sayfası grafiğinde "Senaryo okları". Testler 177.
- 04.11 **Fib kesişimi 0,618×1,272 düşük TF (kullanıcı hipotezi; 1 ay, ilk 30 coin, fillbar kötümser, komisyon %0,05 + kayma %0,05):**
  - fib_cluster_g_ltf (stop itki 0,886): 1m n 2377 −0,86R (PF 0,36) · 5m n 378 −0,12R (eğ −0,04 / doğr −0,27) · 15m n 137 −0,12R (eğ −0,25 / doğr +0,08). 15m short +0,15R (n 66, sonuçsuz).
  - fib_cluster_g_p0_ltf (arkadaşın yönetimi): 1m n 1695 −0,60R · 5m n 271 −0,15R · 15m n 101 −0,26R. Hedge'li hepsi negatif.
  - Okuma: 1m en kötü (dar stop → maliyet R'yi yiyor); 5m/15m ≈ −0,1R, sıkı ölçüt yok. Sinyallerin ~%80'i dolmadan kaçıyor (missed). Hipotez (düşük TF daha iyi) desteklenmedi. Sıradaki: C zaman sınırı varyantları (koşu 2) ve düşük maliyet kontrolü.
- 04.11 **C zaman sınırı (C ≤ k × A süresi, limit süre dolunca iptal; aynı 1 ay/30 coin/maliyet):** 5m: sınırsız −0,12R (n 378) → k=1 +0,03R (n 97, eğ +0,14 / doğr −0,13), k=1,618 −0,06R (n 160); 15m: −0,12 → k=1 −0,03R (n 48), k=1,618 −0,05R (n 71); 1m daha kötü (−1,1R). Arkadaşın yönetiminde de benzer (5m k=1 −0,02R, n 66). Sınır 5m/15m'de kaybı sıfıra çekiyor ama doğrulama negatif ve n < 100 → sonuçsuz. Koşu 3: düşük maliyet kontrolü (%0,02 + %0,01).
- 04.11 **Düşük maliyet kontrolü (komisyon %0,02 + kayma %0,01, aynı ay):** 1m hâlâ negatif (−0,23 / −0,45R) → 1m'de kurulumun kendisi zayıf, yalnız maliyet değil. 5m pozitife döndü: sınırsız +0,09R (n 372; eğ +0,18 / doğr −0,07), **C ≤ 1,618× A: +0,22R (n 158; eğ +0,30 PF 1,48 / doğr +0,08 PF 1,11), short +0,38 / long +0,05**; C ≤ 1×: +0,30R (n 96). 15m ≈ 0 (n < 140). Yani 5m'de kenar **maliyete çok duyarlı** (%0,05+%0,05 ile ≈ 0) ve tek ay + 18 hücre arasından seçim → iyimser. Örneklem dışı kontrol: `--months 1@1` (önceki ay) koşusu 41847790502.
- 04.11 **Örneklem dışı kontrol (05.09–05.10, düşük maliyet, 5m/15m):** 5m C ≤ 1,618× A +0,00R (n 205; short −0,02), C ≤ 1× +0,02R (n 126), sınırsız −0,04R (n 407); 15m ≈ 0. Hedge'li hepsi negatif. **Bir önceki aydaki +0,22R tekrar etmedi → tesadüf/seçim iyimserliği. Karar: düşük TF fib kesişimi kural olmaz.** Kullanıcının seçerek girdiği işlemler ayrı etiketle kaydedilmeye devam (30+ işlemde karşılaştırma).
- 05.11 **Ajanlar duruyor — neden:** Anthropic API kredisi bitmiş ("credit balance is too low"); ajanların son işlemi, denetçi ve araştırmacının son raporu 26.10. Her tur çağrı hata veriyor; ajanlar 0 pozisyon (Temkinli 256,90 / Agresif 266,49). Ayrıca AGENT_SOURCE=measured: aday yalnız rejim-Donchian; BTC rejimi 31.10–04.11 "G↓" idi (aday 0), 05.11 06:30'da "G↑ · şok↑ devam" oldu (kural aktif, henüz Donchian kırılımı yok). Çözüm kullanıcıda: console'dan kredi yükle (Haiku + 60 dk + measured ile ajan maliyeti ≈ birkaç $/ay; denetçi Opus günlük + araştırmacı haftalık birkaç $/ay).
- 05.11 Kullanıcı API kredisi yükledi. Eklendi: kredi bitince Telegram uyarısı (24 saatte bir) + düzelince haber. Testler 179.
- 05.11 Düzeltme: ajanın rejim-Donchian pozisyonları (ör. Agresif INJ 1H long 8,363, stop 8,148) hedefsiz açılıyor ama ajan hesabı izleyen stopu uygulamıyordu (sabit stop, erken kâr 4H'de devreye girebilirdi). Artık 2 ATR izleyen stop + 100 mum süre + erken kâr yok; mesajda TP yerine "izleyen stop" yazar. Mevcut INJ pozisyonu için ATR stop mesafesinden türetildi. Testler 180.
- 05.11 Eklendi: Telegram sinyal/ajan mesajlarında ve grafik panelinde stop/TP yüzdeleri + kaldıraç tavanı (⌊100/(stop%×1,5)⌋, en fazla 20x). Testler 181.
- 05.11 Eklendi: tarayıcıda "Fib kesişimi (yalnız 0,618×1,272)" preseti; eski preset adı "(tüm oranlar)" oldu (önceden adı 0,618×1,272 dese de tüm çiftleri gösteriyordu). Arkadaşın ew-setup-scanner'ında çıkan OP/SHIB 5m kurulumları bizde çıkmadı: muhtemel nedenler TF (bizim varsayılan 15m/4H), evren (OKX vadeli ilk 50), veri (onda spot), ZigZag (onda tek 2×ATR, bizde 2/3/4 ve fiyata en yakın tek kesişim). Testler 182.
- 08.11 **Tarayıcı tekrar oynatma (fib_scan_week; son 7 gün, ilk 50 coin, preset "yalnız 0,618×1,272", puan > 10, tarayıcının giriş/stop/H1/H2, %0,05+%0,05, kötümser dolum):** 394 kurulum, 198 doldu (%50). Kazanma %35, ort. −0,09R, toplam −18,4R (PF 0,88; %1 risk/100 $ ≈ −18 $). 5m n 138 −9,2R · 15m n 43 −5,7R · 1H n 12 −3,7R · 4H n 5 +0,2R. **Short +31R (n 104) / long −50R (n 94)** → BTC haftası (beta 0,5, hedge'li −0,32R): kazanç yönden geldi, kurulumdan değil. Tek hafta, örnek; kural kanıtı değil.
- 08.11 **Fib kesişimi 0,618×1,272 + BTC günlük trend yönünde (5m/15m, ilk 30 coin, %0,05+%0,05, kötümser dolum):**
  - A (09.09–08.11): filtresiz 5m −0,26R (n 774) / 15m −0,15R (n 260); **BTC yönünde 5m −0,20R (n 392; eğ −0,32 / doğr +0,01) / 15m −0,15R (n 131)**; + C ≤ 1,618×A 5m −0,16R (n 183; eğ −0,39 / doğr +0,27) / 15m −0,18R (n 72).
  - B örneklem dışı (10.08–09.09): filtresiz 5m −0,37R / 15m −0,05R; BTC yönünde 5m −0,22R (n 204) / 15m +0,13R (n 61, doğr −0,13); + C sınırı 5m −0,05R (n 105) / 15m +0,13R (n 35).
  - Hedge'li hepsi −0,14…−0,45R. **Sıkı ölçüt hiçbir hücrede yok.** BTC filtresi kaybı azaltıyor (5m −0,26 → −0,16/−0,20) ama sıfırın üstüne taşımıyor; son haftadaki "short +31R" bir haftalık yön etkisiydi. Karar: kural olmaz; düşük TF fib kesişimi ailesi kapandı (1m/5m/15m, C süresi, maliyet, BTC yönü denendi).
- 08.11 Fib uyarısına puan eşiği (FIB_ALERT_MIN_SCORE vars. 10; puan > 10 ≈ fiyat bölgede), BTC günlük yön notu ve grafik (SIGNAL_CHART) eklendi. Kullanıcı 15m/1H/4H istedi: tahmin ilk 30 coinde ≈ 10 kurulum/gün, aynı turdakiler tek mesaj → ≈ 8–10 mesaj/gün (+ grafik). Açmak için FIB_ALERT=1 (TF'ler varsayılan 15m,1H,4H). Testler 183.
- 09.11 **Oturum devri (yeni sohbet için özet):** Bu oturumda: dönem karşılaştırması + haftalık Telegram raporu (WEEKLY_REPORT), sinyal grafiği (SIGNAL_CHART: kurulum çizimi, stop çevresi FVG/likidite uyarısı, senaryo okları, açıklama paneli, kapanışta sonuç grafiği), tarayıcı/coin sayfasında senaryo okları, API kredi uyarısı, ajan rejim-Donchian izleyen stopu, mesajlarda stop/TP %'si + kaldıraç tavanı (≤ 20x), tarayıcıda "Fib kesişimi (yalnız 0,618×1,272)" preseti, fib uyarısında puan eşiği + grafik. Ölçülenler (hepsi sıkı ölçütte ret): range sapması, düşük TF fib kesişimi (1m/5m/15m, C süresi, düşük maliyet, BTC yönü), tarayıcı haftalık tekrar oynatma (−18R). Bekleyen: kullanıcı FIB_ALERT=1 açacak (15m/1H/4H, ≈ 8–10 mesaj/gün); kullanıcının gerçek işlemleri ("kendi/arkadaş/bot" etiketli) 30+ olunca istatistik; isteğe bağlı QML ve "kesişim + QML" lab ölçümü; P5 canlı 4H düzeninde n ≥ 100 bekleniyor (haftalık rapor Pazartesi).
- 09.11 Kullanıcı Variables'a **FIB_ALERT=1** ekledi (15m/1H/4H, ilk 30 coin, puan > 10, grafik açık; beklenen ≈ 8–10 mesaj/gün — ilk günlerde sıklık kontrol edilecek, fazlaysa FIB_ALERT_TFS=1H,4H). Gerçek işlemlerini geldikçe gönderecek (etiket: kendi / arkadaş / bot; 30+ olunca istatistik). **QML ve "kesişim + QML" ölçümü askıya alındı** (kullanıcı kararı). Sıradaki sohbet: "Devam edelim".
- 09.11 **Araştırmacı 08.11 raporu GEÇERSİZ** (denetçinin "4H eğitim dilimi boş" bulgusu doğru): plan önbelleği silinmişti (son tam koşu 24.10, önbellek 7 günde düşer), iş akışı git geçmişindeki **20.10 planlarını** (6 ay, 15m/1H/4H; 4H yalnız 01.08'den) aldı ve 24.10 koşusunun bölünmesiyle (12 ay, 1H/4H, 13.07) karıştırdı → eğitimde 4H yok, n'ler yanlış (4H doğr. n123 +0,18R gibi değerler anlamsız). Düzeltme: `backtest/plans.js` (sweep/checklist/learn plan–meta uyumsuzluğunda durur) + backtest.yml önbellek yoksa planları tam koşuyla yeniden üretir ve taramayı yeniler (git yedeği kaldırıldı). Testler 185. Araştırma yeniden tetiklendi: ilk deneme (42591390461) korumaya takıldı — eski planlar önbellekte de vardı (08.11 koşusu kaydetmişti); iş akışı artık önbellekteki planı da denetler, uyumsuzsa siler ve yeniden üretir.
- 09.11 FIB_ALERT ilk 4 saat (05:15–09:00 UTC, 16 tur): 2 mesaj / 3 kurulum (DOGE 1H, AAVE 15m, ETH 15m) → ≈ 12 mesaj/gün hızında; beklenen aralıkta, gün sonu tekrar bakılacak.
- 09.11 Haftalık rapor (yerelde üretildi; Telegram'a özet saatinde gider): son 7 gün 29 sinyal, dolum %52, kapanan 12, kazanma %67, ort. −0,02R (toplam −0,29R); long −0,43R / short +0,55R. P5 toplam: 91 sinyal, kapanan 50, %72, +0,01R. n < 100 → sonuçsuz.
- 09.11 Tam koşu yeniden üretildi (koşu 42599921446; 01.12.2025–09.11.2026, 12 ay, ilk 50, 1H/4H, 72.205 plan, bölünme 27.07). Bir önceki deneme (42591630510) runner bağlantı kaybıyla düştü (geçici; tekrarında 34 dk'da bitti).
- 09.11 Araştırmacı da iyimser dolum (count) ile ölçüyordu → temel düzen artık `fillBarTp: 'lower'` (gerçek sıra). **Geçerli araştırma raporu (koşu 42604655431):** canlı 4H düzeni eğitim −0,039R (PF 0,87, n 273) / doğr. +0,075R (PF 1,34, n 282); hedge'li −0,025 / +0,025R → sıkı ölçüt yok (29.10 bulgusuyla aynı: gerçekçi kenar ≈ 0). 6 hipotez: erken hedef %1,0/%1,5, kapanış %70/%90, bıçak 1,5 → sonuçsuz (fark < 0,02R); "üst TF ters değil" → ret (ham doğr. +0,11R ama hedge'li −0,09R = BTC betası). Öneri yok; canlı düzen aynı kalır.

## 10.11.2026
- Kullanıcı: fib mesajı geç geliyor, değerlendirmeye zaman kalmıyor. Ölçüm (son 99 tur ≈ 25 saat): 5 mesaj, **hepsi "bölgede", 0 "yaklaşıyor"**. Neden: puan eşiği (> 10) bölge dışında neredeyse geçilmiyor (bölge dışı sinyal "oluşuyor" × 0,6, yakınlık 1 − uzaklık/6 → eşik ≈ 2,5 ATR'de geçilir; 15m'de 2–4 mum). Düzeltme: eşik yalnız "bölgede" aşamasına; "📐⏳ yaklaşıyor" mesajı 4 ATR'de (`FIB_ALERT_NEAR_ATR`) + "alarm kur / limit + stop'u önceden gir" satırı. Testler 186. Beklenti: mesaj sayısı ~2× (≈ 10/gün; ilk gün loglardan sayılacak). Fazlaysa `FIB_ALERT_TFS=1H,4H` (15m'de 4 ATR zaten kısa süre). Not: kesişim B pivotu onaylanınca oluşur (ZigZag 2–4 ATR geri dönüş ister), bu yüzden bazı kurulumlar doğduğunda fiyat zaten bölgeye yakın olur; bunlarda erken mesaj mümkün değil.
- 10.11 **Kullanıcının gerçek işlemleri — ilk sayım** (Bybit Closed P&L CSV, 11.10–10.11; 90 kısmi kapanış → 65 pozisyon; ham dosya repoya konmadı). 02.11'deki 5 işlem DURUM kaydıyla birebir tuttu (+15,96 $).
  - Toplam **−34,31 $**, kazanma %46 (30/35), ort. kazanç +3,12 $ / ort. kayıp −3,66 $, PF 0,73; ücret + fonlama −15,47 $.
  - **6 tasfiye = −53,30 $** (NEAR, BAT, ZRO, MASK ×2, MAGIC; her biri ≈ −10 $ ≈ 6× medyan kayıp −1,62 $). Tasfiyesiz toplam **+18,99 $**. 24.10 öncesi 24 poz. −32,59 $ (5 tasfiye) · sonrası 41 poz. −1,72 $ (1 tasfiye, MAGIC 05.11).
  - Long 41 poz. +14,64 $ (%56) · short 23 poz. −48,94 $ (%30; tasfiyeler hariç ≈ −25 $).
  - Bot sinyaliyle eşleşen (aynı coin/yön, ≤ 48 saat, giriş ±%1,5; kullanıcı onayı bekliyor): 15 poz. −36,32 $; diğer 50 poz. +2,00 $. MAGIC'te bot planı başa baş kapandı (stop olmadı) ama kullanıcı tasfiye oldu → tasfiye fiyatı bot stopundan önceydi; MASK ×2'de bot limiti hiç dolmadı (missed), kullanıcı farklı yerden girip tasfiye oldu.
  - R hesaplanamadı (stoplar CSV'de yok). Ders: kayıp kontrolü = kaldıraç tavanı ⌊100/(stop%×1,5)⌋ (mesajlarda var), tasfiye fiyatı daima stopun ötesinde olmalı.
- 10.11 **Gerçek işlemler — R hesabı** (Bybit TP/SL emir geçmişi; her pozisyonun kendi giriş emrinden sonra konan ilk SL = plan stopu; PENDLE için DURUM'daki 1,6505 kullanıldı; 61/65 pozisyonda stop var). Ort. **≈ −0,14R**, kazanma %44; tasfiyesiz ≈ −0,09R (n 55). Long ≈ +0,02R (n 38) / **short −0,39R (n 23)**. 24.10 öncesi −0,17R / sonrası −0,12R → $ iyileşmesi seçimden değil, küçülen risk ve azalan tasfiyeden.
  - **Risk tutarsız:** işlem başı risk 0,16–73 $ (medyan 3,65 $). Risk > 10 $ olan 13 işlem −32,5 $ = zararın tamamı. Tasfiyeler −0,1…−0,65R'de geldi (stop hiç çalışmadı; MASK stopu %24 uzakta). Aynı işlemler sabit 2 $ riskle −6,7 $ olurdu (gerçek −34,3 $).
  - Öneri (kullanıcı kararı): sabit risk (%1, ters/ilk işlem %0,5), adet = risk $ ÷ (giriş − stop), kaldıraç ≤ ⌊100/(stop%×1,5)⌋; short'larda n ≥ 30 olana kadar %0,5. Stopsuz 4 işlem (EIGEN, ARB, APR, ETH) +20,4 $.
- 10.11 **Gerçek işlemler — kırılımlar** (n 61, R'li; hesap ≈ 100 $): ort. kazanan +0,75R (n 27) / kaybeden −0,84R (n 34) → başa baş için %53 kazanma gerekir (gerçek %44). Kapanış: hedef/iyi kâr n15 +1,18R · erken küçük kâr n12 +0,22R · erken zarar n8 −0,28R · stop n20 **−1,13R** (kayma+ücret 1R'yi aşıyor) · tasfiye n6. Tutma < 1 saat n14 −0,42R (%29) · 1–6 saat n34 +0,05R. Limit n18 −0,22R / piyasa n42 −0,09R (fark yok). Hafta sonu n7 −0,21R. BTC günlük yönüne ters n14 +0,29R / aynı yön n27 −0,34R (n küçük; botun bulgusunun tersi → gürültü olabilir, kural değil).
  - Okuma: sorun kazanma oranından çok kazanç/kayıp oranı (kazançlar küçük, kayıplar > 1R) ve kısa vadeli dar stoplu işlemlerde maliyet. Önerilen deney: işlemleri plan TP/SL'sine sadık kalınsaydı ne olurdu (mumlarla yeniden oynatma; OKX verisi Actions'ta).
- 10.11 **Deney A — plana sadakat (yeniden oynatma)**: Binance USDT-M 5m mumları (data.binance.vision; Bybit API bu ortamdan coğrafi engelli, OKX proxy'de kapalı → Default ortama data.binance.vision eklendi), girişteki SL/TP emirleri, ücret %0,055×2, aynı mumda önce stop, en fazla 7 gün. n 57 (OKB/BCH/FIL mum yok). Betik + veri repoya konmadı (işlem verisi; repo herkese açık).
  - Gerçek: ort. −0,13R (toplam −7,6R, %44) · **plana dokunmasaydın: −0,16R (−9,1R, %32)** · **1,5R kuralı (1,5R'de %50 + stop girişe, kalan 3R): ±0,00R (+0,1R, %44)**.
  - Okuma: elle yönetim ham plandan biraz iyi (plan TP'leri uzak, medyan ≈ 2,7R → kazanma %32); 1,5R kuralı aynı girişlerde ≈ +0,13R/işlem iyileştirme ama yine ≈ 0 → kenar girişlerde değil, maliyet + çıkış düzeninde. Tasfiyeler kazanacak işlemleri kaybettirdi: BAT plan +1,37R (gerçek −0,62), ZRO +1,68R (−0,11). n < 100, tek karşı-olgusal → yön bilgisi, kanıt değil.
  - Deney B başlıyor (kullanıcı onayı): sonraki 30 işlem 4 kuralla (risk 1 $ / short ve ilk işlem 0,5 $, stop ≥ %1, TP1 ≥ 1,5R + başa baş, kaldıraç ≤ ⌊100/(stop%×1,5)⌋ ve tasfiye fiyatı stopun ötesinde). Deney C: BTC günlük yönü etiketi (history.json'dan otomatik).
  - Kullanıcı yöntemi: SL'yi girip adet/kaldıracı Bybit'in gösterdiği zarar 1–2 $ olacak şekilde ayarlıyor (doğru yöntem); ancak ölçülen risk medyanı 3,65 $, 13 işlemde > 10 $ → kontrol tutarlı uygulanmamış ya da SL sonradan uzaklaştırılmış.
- 10.11 **Çıkış varyantları** (kullanıcı sorusu: "TP1 sonrası başa başa dönüp TP2'yi kaçırıyoruz, ara TP eklesek?"; aynı 57 işlem, Binance 5m, ücretli). TP1 (1,5R) gelen 24 işlemden 12'si 3R'den önce başa başa döndü; 15'i 2R, 9'u 3R gördü.
  - A şimdiki (1,5R %50 → BE → 3R) +0,00R · B ara hedef 1,5/2,25/3R +0,01R · C 1,5/2/3R ±0,00R · H 1,5R %70 +0,02R · D gevşek BE (−0,5R) −0,02R · J 1R/2R −0,04R · I tek 2R −0,08R.
  - **F: 1,5R %50 → iz süren stop (en iyi fiyatın 1R gerisi) → 5R: +0,08R** (G 1,5R iz +0,06R). Ara TP fark yaratmıyor; fark TP1 sonrası stopu başa baş yerine kârın içinde izletmekten (TP1 anında stop ≈ +0,5R'ye kilitlenir). 10 varyanttan seçim + n 57 → iyimser; Deney B'ye ikinci kol olarak önerildi (kullanıcı kararı).

## 11.11.2026
- Kullanıcı: BNB 15m fib kesişiminde "Check list yok: fiyat TP1 ötesinde" ama grafikteki H1 (684,44) geçilmemiş. Neden: tarayıcının takip/check list'i botun genel planını kuruyordu (giriş bölge üst kenarı 675,94, stop bölge altı − 0,3 ATR = 674,38 çünkü yapı stopu 3,4 ATR > 3 sınırı; gevşek çağrıda minRR=0 olduğundan küme hedefleri atlanıp TP1 = 1,5R = 678,29). Grafik ise detektörün planını (giriş 675,46, stop 670,85, H1 684,44) gösteriyordu. Düzeltme: `buildPlan` `fibPlan` seçeneği — tek fib kesişimi kümesinde detektörün giriş/stop/H1/H2'si; takip, check list, senaryo okları ve coin sayfası bunu kullanır; bot yolu aynı. Takipteki eski kayıtlar (AAVE, TAO; dar stoplu) olduğu gibi kalır, yeniler detektör planıyla. Testler 187. Kullanıcı sonuç kartlarına X/8 rozetini istemedi (tarama süresi).
- "Fiyat TP1 ötesinde" uyarısının anlamı (kullanıcıya açıklandı): likidite değil, fiyat girişe gelmeden hedef yönünde 1,5R'den fazla gitmiş → limit dolması için ters yönde > 1,5R dönüş gerekir; girilmez, istenirse bölgeye alarm.
- 11.11 BCH/FIL (bot 4H short'ları): kısmi TP sonrası BCH'nin trailing stopu kayboldu, SL girişe gelmemişti → kullanıcı SL'yi girişe çekti, trailing'i yeniden kurdu (BCH 2,94 / FIL 0,0154). Order History'de eski trailing kaydı görünmedi (neden bilinmiyor).
- 11.11 **Oturum devri:** analiz betikleri repoya alındı (`tools/trades/rtable.mjs`, `replay.mjs`; CSV'ler .gitignore). Ortam (Default): data.binance.vision izinli (api.bybit.com coğrafi engelli, kaldırıldı). Kullanıcının Bybit read-only API anahtarı Mac anahtar zincirinde (`security`, servis `bybit-readonly`, hesaplar `api_key`/`api_secret`; Contract Orders + Positions okuma; IPv4 kısıtlı); otomatik çekim betiği **yazılmadı** — Desktop'ta, yerelde çalışacak (bulut oturumu Bybit'e erişemez). **Sıradaki sohbet: Hyperliquid trader incelemesi** (ayrıntı CLAUDE.md "Açık işler").

- 11.11 **Hyperliquid başarılı trader incelemesi** (`tools/hyperliquid/`; lider tablosu 48.132 hesap → kârlı/ROI > %20/piyasa yapıcı değil 1.075 → en kârlı 300'ün geçmişi: yaş ≥ 180 gün, son 6 ay kârlı, PnL eğrisi düşüşü ≤ %50 → 45 → son 180 gün dolumları, düz→düz pozisyon ≥ 30 ve dolum kârı > 0 → **16 cüzdan**; 27'si sürekli açık pozisyon taşıdığı için düz→düz yöntemiyle ölçülemedi). R birimi = cüzdanın ortalama kaybı (stoplar görünmez).
  - Medyan (16): kazanma %70, kazanç/kayıp 1,9, PF 4,4, haftada 5,8 pozisyon, **pozisyon büyüklüğü hesabın 0,09 katı** (en yüksek 0,4×), medyan kayıp ortalama kaybın 0,35'i (çok sayıda küçük kesilen kayıp) ama en büyük kayıp 6,7× ortalama kayıp; 16'da toplam 2 tasfiye.
  - Swing grubu (medyan tutma ≥ 6 saat, 10 cüzdan): kazanma %77, kazanç/kayıp 3,5, haftada 3 pozisyon, kazanan 94 saat / kaybeden 39 saat tutuluyor (6/10'da kaybeden daha kısa = erken kesme, kazananı koşturma). Scalp grubu (< 1 saat, 4 cüzdan, haftada ~32; büyük ihtimalle algoritma): kazanç/kayıp 1,4.
  - Pozisyonların %55–96'sında ekleme var (kademeli giriş); emirlerin çoğu limit (maker %85–90). Short'lar 14/16'da kârlı; BTC günlük yönüne göre belirgin üstünlük yok. 4H sınıfı: girişlerin çoğu 4H EMA50'ye **ters** (dip/tepe avcılığı veya kaba sınıflama — tek başına kanıt değil).
  - Kullanıcıyla yan yana (10.11 sayımı): kazanma %44 vs %70 · kazanç/kayıp 0,89 vs 1,9 · PF 0,73 vs 4,4 · haftada ~14 vs 3–6 · tasfiye 6/65 vs 2/≈2.500 · risk 0,16–73 $ (450×) vs pozisyon büyüklüğü p90/p10 10–200× (onlarda da sabit değil; ama hesaba oranla çok küçük).
  - **Sınırlar:** seçilim yanlılığı büyük (48 bin hesaptan bugünün kazananları; şans ile beceri ayrılamaz), "neden girdi" görünmez, büyük hesaplar başka varlık/hedge taşıyabilir, bazıları HIP-3 (hisse/emtia) piyasalarında. Kural önerisi değil; çıkarım: kayıp kontrolü ve küçük pozisyon, Deney B kurallarıyla aynı yönde.
  - Ortam: Default'a api.hyperliquid.xyz + stats-data.hyperliquid.xyz eklendi. Not: data.binance.vision izin listesinde artık yok (replay.mjs için gerekirse yeniden istenmeli). Node fetch bulut proxy'sini yalnız `NODE_USE_ENV_PROXY=1` ile kullanıyor (yoksa istek asılı kalıyor). Testler 189.
- 11.11 **Tanınmış (adını kendi koymuş) Hyperliquid trader'ları** (lider tablosu displayName = kendi beyanı; zincir üstü kimlik çıkarımı yapılmadı; beacontrade/hyperstats ortamdan erişilemedi): 1.484 isimli hesaptan bilinenler — **JamesWynnReal on X**: PnL zirvesi +76,5 M $ (05.2025) → bugün −22,1 M $ (98,6 M $ düşüş), hesap 84 M $ → 8 bin $ · **MachiBigBrother**: +44,8 M $ (09.2025) → −37,5 M $ (82,3 M $ düşüş), hesap 0 · **x.com/SilkBtc**: +122,9 M $ (zirvede; arada 61 M $ düşüş 09.2025) · **NAKED SHORTS ONLY**: +93,8 M $ (son 2 ayda −3,4 M $). Dördü de pozisyonu sürekli taşıyor (düz→düz ≥ 30 pozisyon yok) ve API yalnız son ~10.000 dolumu veriyor (SilkBtc'de son 6 gün) → işlem metrikleri çıkarılamadı. Okuma: görünür/ünlü büyük kaldıraççıların ikisi zirveden 80–100 M $ geri verdi; anonim 16 cüzdanın disiplini (küçük pozisyon) ünlülerde değil. AguilaTrades lider tablosunda bu adla yok.
