# Ön kayıt — kesitsel momentum araştırması (13.11.2026)

**Durum: ONAYLANDI (kullanıcı, 13.11.2026 — "Ön kaydı onaylıyorum"); onay anında hiçbir ölçüm koşulmamıştı.** Tanım / eşik değişmez (değişirse tarihli not + neden).
Kardeş dosya: `on-kayit.md` (4H sinyal düzeni; sonuç: hiçbir hipotez geçmedi).

## Neden momentum
- Repoda hedge'li artı veren tek aile: `xsmom_l28_k5_short_rel` (haftalık, 28 günlük getiri − BTC getirisi, en zayıf 5 coin short, günlük
  3 ATR iz süren stop, BTC long hedge). 4H araştırmasında coin seçimi (BTC'ye göre güç) üç dilimde de tabanı iyileştiren tek izdi.
- **Bilinen zayıflıklar (ölçümden önce yazıldı):**
  1. Bu varyant 7 denenmiş varyant arasından seçildi (`XS_STRATEGIES`: l28, l14, l28+BTC rejimi, l28 long-short, l28 short, l28 short rel,
     l28 long-short rel) ve seçim 24 aylık veride (11.2024 → 11.2026) yapıldı → iyimser; o dönem artık "temiz" değil.
  2. Canlı kâğıt portföy (21.10.2026'dan beri, 4 yeniden dengeleme): **−%7,7** (300 → 276,9 USDT), aynı dönemde BTC −%17. Short + BTC long
     hedge'li bir portföyün düşen piyasada kaybetmesi beklenmezdi → backtest ↔ canlı uyumu ilk iş (4H düzeninde gerçek sorunlar
     böyle çıkmıştı).
  3. Fonlama backtest'te sabit %0,01 / 8 saat maliyet; çok short'lanan zayıf coinlerde gerçek fonlama bundan kat kat olumsuz olabilir.
  4. Evren bugünün listesinden: listeden kalkan coinler yok (short strateji için ihtiyatlı, long için iyimser yan).

## Veri ve dilimler
- Günlük mumlar (OKX USDT sürekli vadeli), dönem evreni (`pitN`: her yeniden dengelemede o tarihteki 30 günlük hacme göre ilk 50; havuz
  bugünün ilk 150'si).
- **Geliştirme dilimi:** 24.11.2024 → 13.11.2026 (taban varyantın seçildiği dönem; yeni hipotezler için ilk 2/3 eğitim, son 1/3 doğrulama).
- **Kilitli dilim (kasa-M):** 24.11.2022 → 24.11.2024 (momentum için hiç bakılmadı). Tek bakış, en sonda, taban + hipotezler birlikte.
  Veri o dönem için yetersizse (dengeleme başına < 20 coin) kasa kısaltılır; kısaltma kasa sonucu görülmeden, coin sayısına bakılarak yapılır.
- Birim: **haftalık portföy getirisi (%)**, eşit nominal, komisyon + kayma + fonlama dahil; ayrıca işlem başı R. İstatistik: haftaya göre
  bloklu bootstrap %90 güven aralığı (sabit tohum), yıllıklandırılmış Sharpe, maks. düşüş.

## Aşama M0 — teşhis (yalnız geliştirme dilimi; kural önermez)
| # | Ölçüm | Tanım | Önceden yazılmış yorum kuralı |
|---|---|---|---|
| M0a | Canlı ↔ backtest uyumu | 21.10.2026'dan beri canlı portföyün her işlemi ve BTC hedge bacağı, aynı tarihlerde backtest motorunun ürettiğiyle karşılaştırılır (seçilen coinler, giriş / çıkış fiyatı, stop, hedge büyüklüğü, fonlama). −%7,7'nin ayrışması: short bacaklar / hedge / maliyet. | Fark kaynağı bulunmadan M1'e geçilmez. Kod hatası varsa önce düzeltilir (düzeltme belgelenir). |
| M0b | Sıralamada bilgi var mı | Her hafta evren, 28 günlük BTC'ye göre getiriye göre beşte birlik dilimlere ayrılır; her dilimin SONRAKİ haftaki getirisi (evren ortalamasına göre; stop / maliyet yok). Plasebo: aynı hafta rastgele 5 coin (1.000 çekiliş). | "Bilgi var" = en zayıf dilim − evren ortalaması farkının %90 aralığı üst ucu < 0 (zayıflar zayıf kalıyor), eğitim ve doğrulamada. Dilimler tekdüze mi ayrıca raporlanır. |
| M0c | Fonlama gerçekçiliği | Short'lanan coinlerin gerçek fonlama oranları (OKX geçmişi ne kadar veriyorsa, ~3 ay) ↔ varsayılan %0,01 / 8 saat. | Gerçek maliyet varsayımın 2 katından fazlaysa M1'de fonlama modeli gerçek ortalamayla yeniden kurulur (M1'den önce, kasa görülmeden). |
| M0d | Taban yeniden ölçüm | Canlı varyant geliştirme diliminde, eğitim / doğrulama ayrı: haftalık getiri, Sharpe, düşüş, hedge'li ve hedge'siz; 7 varyantın hepsi yan yana (seçim iyimserliğini görmek için). | Yalnız teşhis. |

## Aşama M1 — hipotezler (M0'dan sonra kesinleşir; en çok 3 + taban doğrulaması)
| # | Hipotez | Gerekçe (ölçümden önce) | Tanım (tek varyant) |
|---|---|---|---|
| T | Taban doğrulaması | Seçilmiş varyant temiz veride ayakta mı | Canlı varyant aynen, kasa-M'de |
| HM1 | Piyasa-nötr long-short | BTC hedge'i alt-coin betasını kapatmıyor; long güçlü 5 + short zayıf 5 (BTC'ye göre) kendi içinde nötr | `rank: rel`, `side: ls`, K = 5, BTC hedge yok |
| HM2 | Oynaklığa göre boyut | Momentum çöküşleri yüksek oynaklıkta olur; ters-oynaklık ağırlığı belgelenmiş iyileştirme | Pozisyon nominali ∝ 1 / (coin'in 28 günlük günlük getiri std'si), toplam nominal sabit |
| HM3 | Son haftayı atla | Kısa vadeli geri dönüş etkisi: son 7 gün sıralamayı bozar | Sıralama getirisi t−28 → t−7 (son 7 gün hariç) |

Sağlamlık koşulu (hipotez değil): geçen her satır, pencere 14 ve 56 günle de aynı işarette olmalı (en iyisini seçmek yok; plato denetimi).

## Geçme ölçütü
1. **Taban (T):** kasa-M'de haftalık net getiri ortalaması > 0 **ve** %90 aralığının alt ucu > 0; Sharpe ≥ 0,5. Geçmezse canlı momentum
   "ölçülmüş" etiketini kaybeder, "deneme" olur (kapatma kararı kullanıcının).
2. **HM1–HM3:** geliştirmede eğitim ve doğrulamada ortalama > 0 ve tabandan yüksek Sharpe; kasa-M'de ortalama > 0, aralığın alt ucu > 0 ve
   tabandan yüksek Sharpe; sağlamlık koşulu.
3. Geçen satır **Variables bayrağıyla, varsayılan kapalı** canlı kâğıt portföye aday olur; karar kullanıcının. Gerçek para yok.
4. Birincil test sayısı 4 (T, HM1, HM2, HM3). Hiçbiri geçmezse: momentum da "kenar gösterilemedi" olarak yazılır; yeni fikir aranmadan önce
   kullanıcıyla durum değerlendirilir.

## Günlük
- 13.11.2026: taslak yazıldı (ölçüm yok).
- 13.11.2026: kullanıcı onayladı; M0 teşhis betiği yazılıyor.
- 13.11.2026 (ilk koşudan ÖNCE) uygulama notları: ısınma geliştirme diliminden (ilk dengeleme ~12.01.2025); hafta = pazartesi açılışı →
  pazartesi açılışı; her işlem 1 / slot nominal; M0b zayıf-5 = `selectAt` short listesi (r < 0 süzgeci dahil), plasebo aynı sayıda coin;
  M0c "2 kattan fazla" (tam 2 kat = varsayılan korunur), son ~100 günde kapanan short'lar; M0d havuz 150, M0a canlının kendi
  parametreleri (havuz 80). Kod okumasından (ölçümden önce) canlı ↔ backtest yapısal farkları: canlı eşit RİSK boyutlar (%2, üst sınır
  özsermaye / 5) ↔ backtest eşit nominal; canlı hedge net maruziyete göre %20 sapmada yeniden boyutlanır ve küçültmeler `realized`'a
  yazılır ↔ backtest'te BTC adedi işlem boyunca sabit; canlı ilk ~30 saat hedge'sizdi; ilk dengeleme hafta ortasında. Canlı kaybın
  kimliği (fiyat gerektirmez): kapanan short +6,88 · açık short +3,95 · açık hedge −7,31 · hedge yeniden boyutlamada gerçekleşen −26,63
  = −23,11 USDT.
- 13.11.2026 **M0 sonucu (koşu 43503125194, `docs/backtest/mom-diag.json`; yalnız geliştirme dilimi, eğitim 62 hafta / doğrulama 34 hafta):**
  - **M0b karar: "bilgi var".** En zayıf beşte birliğin sonraki hafta getirisi evren ortalamasına göre −%1,26 [−2,10; −0,46] / −%1,79
    [−3,42; −0,34]; zayıf-5 −%1,88 / −%5,01, rastgele 5 coin plasebosunun %0,2'lik / %0'lık diliminde. Dilimler kesin tekdüze değil
    (Spearman 0,9 / 0,7); en güçlü dilim +%0,66 / +%1,46 (aralık sıfırı içeriyor) → bilgi zayıf tarafta.
  - **M0c:** short'lar ortalamada fonlama ALMIŞ (gerçek maliyet −%0,0074 / 8 saat ↔ varsayılan +%0,01 maliyet; 35 coin, 445 pozisyon günü;
    dönemlerin %19'unda negatif oran) → varsayılan ihtiyatlı, model değişmez.
  - **M0d (haftalık %, 1× nominal; eğitim / doğrulama):** canlı varyant `short_rel` +3,38 [1,07; 5,90] / +3,57 [1,38; 5,88], Sharpe 2,1 /
    3,2; hedge'li +2,65 [0,98; 4,44] / +3,64 [1,64; 6,16], Sharpe 2,3 / 3,2, maks. düşüş %22 / %13. Diğerleri: short +3,43 / +3,50 · ls
    +1,35 / +1,90 · ls_rel +1,22 / +1,97 · long l28 −0,74 / +0,30 · long l14 −3,28 / −0,31 · long + BTC rejimi +0,15 / +0,94. Not: 7
    varyanttan seçim + dönem alt-coinler için düşüş piyasası; sayılar kasa görülmeden "kanıt" sayılmaz.
  - **M0a: canlı ↔ backtest AYRIŞIYOR.** Seçimler uyumlu (20 coinin 18'i). Canlı −23,2 USDT = short brüt +11,6 · hedge (BTC yolundan tahmin)
    −10,4 · komisyon −0,2 · fonlama −0,9 · **açıklanamayan −23,3**. Aynı haftalarda backtest hedge'li −5,1 / −15,2 / +14,9 / +6,0 %
    (1× nominal), canlı −7,1 / −1,7 / +2,6 / −1,5 % (nominal özsermayenin %17–53'ü). Canlı özsermaye yolunda 24–25.10'da saatlik ±20…31
    USDT sıçramalar. Ön kayıt kuralı: kaynak bulunmadan M1'e geçilmez → canlı kodun kendi fonksiyonlarıyla 15 dk adımlı yeniden oynatma
    ekleniyor.
  - Kasa-M veri varlığı: dengeleme başına uygun coin 32–66 (medyan 46), hepsi ≥ 20 → kasa kısaltılmaz.
- 13.11.2026 **M0a kaynağı bulundu (koşu 43505304886, `m0a.replay`; canlı kodun kendi fonksiyonlarıyla 15 dk adımlı yeniden oynatma, 2.251 adım,
  muhasebe farkı 0,009 USDT):**
  - Bugünkü kodla baştan oynatma: **−1,19 USDT** (298,81) ↔ canlı −23,04 (276,96). Fark −21,85 USDT'nin tamamı ilk haftada: dengeleme
    anlarında oynatma ↔ canlı özsermaye 300,21 ↔ 278,64 · 295,71 ↔ 273,57 · 303,85 ↔ 281,35 · 298,81 ↔ 276,96 → 26.10'dan sonra haftalık
    değişimler ±0,6 USDT içinde aynı.
  - **Neden:** portföy 21.10.2026 10:00 UTC'de, "eşit risk boyutlama" değişikliğinden (commit 4896acd3, 11:39 UTC) ÖNCE açıldı → ilk
    pozisyonlar eski düzenle eşit nominal 60 USDT (UNI ve ZEC kayıtlarında nominal 60). APR short'u 24–25.10'da sıkıştı (saatlik +%43, +%33,
    −%31); 60 USDT'lik pozisyon özsermayeyi saatte ±20–31 USDT oynattı. 26.10 dengelemesinde APR eşit riske (~7 USDT) küçültüldü ve zarar
    `realized`'a yazıldı ama `trades`'e düşmedi ("yeniden boyutlamada gerçekleşen −26,63"). Yani **bir geçiş artığı; bugünkü kodda muhasebe
    hatası yok.** Karşı-olgusallar: hedge yeniden boyutlaması kapalı −0,35 USDT fark, haftalık yeniden boyutlama kapalı +2,18 → mekanik etkiler küçük.
  - **Çıkan dersler:** (1) canlı (eşit risk; nominal özsermayenin %17–53'ü) ile backtest (eşit nominal, 1×) farklı risk profili — yüzdeler
    doğrudan karşılaştırılamaz. (2) 3 ATR günlük stop küçük coinlerde giriş fiyatının %65–200'ü: eşit nominalde TEK işlem özsermayenin
    %20–30'unu götürebilir (APR −%116). M1 raporuna "en kötü tek işlem" ve "en kötü hafta" eklenir. (3) Kayıt eksikleri (düzeltme önerisi,
    kullanıcı kararı): yeniden boyutlamada gerçekleşen K/Z `trades`'e yazılmıyor; `curve` noktasının saati ilk turun, değeri son turun.
  - Ön kayıt koşulu sağlandı (fark kaynağı bulundu, kod hatası yok) → M1'e geçilir.

## Aşama M1 — kesin tanımlar (13.11.2026, koşudan ÖNCE)
- **Satırlar (hepsi haftalık, 28 gün, K = 5, dönem evreni `pitN` 50 / havuz 150, 3 ATR stop, maliyet + varsayılan fonlama):**
  - **T** = `xsmom_l28_k5_short_rel` + işlem başına eşit nominal ters BTC (M0d'deki "hedge'li" seri; canlının ölçülen hali). Hedge'siz seri
    bilgi amaçlı.
  - **HM1** = `xsmom_l28_k5_ls_rel` (long güçlü 5 + short zayıf 5, BTC'ye göre), BTC hedge yok.
  - **HM2** = T'nin seçimi; short nominalleri ∝ 1 / (coin'in son 28 günlük günlük getiri standart sapması), toplam short nominali T ile aynı;
    BTC hedge = toplam short nominali.
  - **HM3** = T; sıralama getirisi t−28 → t−7 kapanışları arası (son 7 gün hariç), BTC getirisi aynı pencereden.
  - Bilgi amaçlı (karara girmez): canlının eşit risk boyutlaması (%2 risk, üst sınır özsermaye / 5); her satır için en kötü tek işlem
    (özsermaye %), en kötü hafta, long / short bacak ayrımı.
- **Dilimler:** geliştirme 24.11.2024 → 13.11.2026 (ilk 2/3 eğitim, son 1/3 doğrulama; M0 ile aynı); kasa-M 24.11.2022 → 24.11.2024
  (ısınma verisi kasadan ÖNCEKİ mumlardan; kısaltma yok: dengeleme başına 32–66 uygun coin).
- **İki aşamalı koşu:** `lock=0` yalnız geliştirme + sağlamlık denetimi (T, M0d ile aynı: eğitim +%2,65 / doğrulama +%3,64 hafta, ±0,05
  puan); geçerse `lock=1` kasa dahil tam rapor (tek bakış).
- **Geçme ölçütü (özet tablodaki ile aynı, kesinleştirilmiş):** T → kasa-M'de haftalık ortalama > 0, %90 aralığının alt ucu > 0, Sharpe ≥ 0,5.
  HM1–HM3 → eğitim ve doğrulamada ortalama > 0 ve Sharpe > T; kasa-M'de ortalama > 0, alt uç > 0, Sharpe > T; ve pencere 14 ile 56 günde
  kasa-M + geliştirme toplamında aynı işaret (plato). T'nin kendisi için de 14 / 56 gün işareti raporlanır.
- 13.11.2026 (M1 ilk koşusundan ÖNCE) uygulama notları: HM2 ağırlığı her hafta yeniden hesaplanır (σ = karar gününe kadar 28 günlük
  getirinin örnek std'si), yeniden ağırlıklandırma maliyeti sıfır sayıldı (HM2 lehine hafif iyimser); kasa ısınması kasa başından 100 gün
  önceki mumlardan; plato = geliştirme + kasa haftalarının birleşik ortalaması (L 14 ve 56); havuz koşu anındaki ilk 150 (M0d koşusundaki
  listeden az farklı olabilir — sağlamlık denetimi ±0,05 puanı bu yüzden tutmazsa fark belgelenir, tanım değişmez).
- 13.11.2026 **M1 geliştirme dilimi (koşu 43506781602, `lock=0`; kasa sonucu okunmadan yazıldı):** sağlamlık denetimi geçti (T eğitim +2,638 ↔
  +2,651, doğrulama +3,636 ↔ +3,636). Haftalık %, eğitim / doğrulama (Sharpe):
  - **T** (L 28): +2,64 (2,27) / +3,64 (3,21); maks. düşüş %22 / %13; en kötü hafta −%16,1; en kötü tek işlem −%13,4. **Pencere duyarlı:**
    L 14 +0,74 (0,62) / +3,55 (3,12) · L 56 −0,61 (−0,49) / +1,57 (1,29) → eğitimde 28 gün bir tepe, plato değil (seçim iyimserliği işareti).
  - **HM1** long-short: +1,27 (1,88) / +1,97 (1,44) → T'den düşük Sharpe, **geliştirmede geçmedi**; L 14 ve 56 eğitimde eksi.
  - **HM2** ters-oynaklık: +2,07 (1,89) / +2,76 (2,95) → **geçmedi** (Sharpe T'den düşük).
  - **HM3** son haftayı atla: +1,85 (1,33) / +1,16 (1,09) → **geçmedi**.
  - Bilgi: hedge'siz T +3,37 / +3,57 (Sharpe 2,1 / 3,2; en kötü hafta −%24,7) · canlının eşit risk boyutlaması +0,63 / +0,41 (Sharpe 2,05 /
    2,31; maks. düşüş %8,6 / %3,9; en kötü tek işlem −%2,0) → benzer Sharpe, çok daha küçük kuyruk.
  - Üç hipotez de geliştirmede geçmediği için kasa-M'de yalnız **T'nin doğrulaması** karar taşır; HM satırları kasada bilgi amaçlıdır.
  (Zaman notu: yukarıdaki geliştirme girişi `lock=0` dosyasından yazıldı; commit 21:05:30 UTC, kasa dosyasının yayınından (21:05:19) 11 sn
  sonra — içerik kasa okunmadan önce hazırdı.)
- 13.11.2026 **M1 kilitli dilim (koşu 43507445359 `lock=1`, tek bakış; kasa-M 24.11.2022 → 24.11.2024, 104 hafta, dengeleme başına 32–66 coin):**
  - **T geçmedi (kıl payı):** haftalık **+%0,90**, %90 aralığı **[−0,16; +2,12]** (alt uç ≤ 0), Sharpe 0,98 (≥ 0,5 ✓), maks. düşüş %35,6, en kötü
    hafta −%18,7, en kötü tek işlem −%14,6. Bacaklar: short'lar −%0,45 / hafta (toplam −%47), BTC hedge toplam +%141 → kasa döneminde
    (yükseliş piyasası) kazanç "zayıf coinler BTC'den az yükseldi" farkından; hedge'siz T −%0,45 / hafta (Sharpe −0,32).
  - Pencere: L 14 +%0,32 (Sharpe 0,32) · L 56 +%0,61 (0,68) → kasada üç pencere de artı, küçük.
  - HM satırları (geliştirmede geçmemişti; bilgi): HM1 +%0,95 [−0,15; 2,05] Sharpe 1,00 · HM2 +%1,03 [−0,01; 2,21] Sharpe 1,15 · HM3 +%0,49
    Sharpe 0,47. Kasadaki 12 satırın 11'i artı; hiçbirinin alt ucu sıfırın üstünde değil.
  - Bilgi: canlının eşit risk boyutlaması kasada +%0,46 / hafta **[+0,05; +0,93]**, Sharpe 1,25, maks. düşüş %15,5, en kötü tek işlem −%2,1
    (geliştirmede +0,63 / +0,41, Sharpe 2,05 / 2,31). Ön kayıtlı hipotez DEĞİLDİ → "geçti" sayılamaz; aynı veride yeniden sınanamaz.
  - **Genel karar (ön kayıt): birincil 4 testin hiçbiri geçmedi.** Canlı momentum "ölçülmüş" etiketini kaybeder → "deneme". Geliştirme
    dilimindeki +%2,6…3,6 / hafta, kasada +%0,9'a iniyor: beklenen seçim + dönem iyimserliği. 4H düzeninden farkı: işaret üç dilimde de artı,
    sıralama bilgisi plaseboyu geçiyor (M0b); kanıt eşiğinin altında, sıfırdan ayırt edilemiyor.
  - Temiz veri kalmadı (kasa-M açıldı). Bundan sonraki tek temiz sınama ileriye dönük kâğıt kayıt; Sharpe ≈ 1 ile %90 güven için ~150 hafta
    gerekir → kısa sürede "kanıt" beklenmemeli.
