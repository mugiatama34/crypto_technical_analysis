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
