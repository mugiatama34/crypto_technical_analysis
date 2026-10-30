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
