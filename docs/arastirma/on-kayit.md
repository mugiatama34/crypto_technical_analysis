# Ön kayıt — "ortalama R nasıl artar" araştırması (13.11.2026)

Amaç: canlı 4H düzeninin (≈ −0,1R; brüt ≈ 0, maliyet ≈ 0,045R) beklentisini **yeni bilgi** ya da **giriş biçimi** ile artırmak.
Bu dosya ölçümden ÖNCE yazılır; sonuç görüldükten sonra eşik ya da tanım değiştirilmez (değişirse tarihli not + neden).
Kullanıcı onayı: 13.11.2026 ("Aşama 0 ve gölge etiketlerle başla").

## Neden ön kayıt
13.11'e kadar 109 çıkış/filtre varyantı ve ~20 strateji ailesi denendi; doğrulama dilimine defalarca bakıldı → artık temiz değil.
Çok denemeden birinin şans eseri geçmesi beklenir. Kural: az sayıda, gerekçesi önceden yazılmış hipotez + bir kez bakılan kilitli dilim.

## Veri ve dilimler
- Taban: tam koşu planları (12 ay, ilk 50 coin, 4H; 1H + 15m yalnız uyum/sıra için), bölünme 31.07.2026 (eğitim / doğrulama).
- **Kilitli dilim (kasa):** aşama 1'den önce veri 24 aya uzatılır; en eski 12 ay kilitlenir. Her hipotez orada **bir kez** sınanır.
  Aşama 0 teşhisleri kasaya dokunmaz.
- Evren: canlı 4H seçimi (hafta sonu yok, üst TF eğilimi aynı yön; ≈ 1.835 sinyal / 12 ay). Gerçekçi satır kuralları geçerli
  (`fillBarTp: 'lower'`, bıçak kararı 'touch' ↔ 'lowerBar'), maliyet dahil.

## Aşama 0 — teşhis (kural önermez; karar eşikleri aşağıda)
| # | Ölçüm | Tanım | Önceden yazılmış yorum kuralı |
|---|---|---|---|
| D1 | Giriş kalitesi | Sinyal sonrası 6 / 12 / 24 mumda (4H) yön işaretli getiri, lehe (MFE) ve aleyhe (MAE) hareket, ATR biriminde; piyasa girişi, stop/hedef yok. Plasebo A: aynı coin, ±30 gün içinde rastgele an, aynı yön (zamanlama bilgisi). Plasebo B: aynı an, rastgele başka coin, aynı yön (coin seçimi bilgisi). | "Bilgi var" = sinyal − plasebo farkının %90 güven aralığı alt ucu > 0, **hem eğitim hem doğrulamada**, en az bir ufukta. Aksi "yön bilgisi yok". |
| D2 | Kaçanlar | Limit dolmadan kaçan / süresi dolan planlar piyasa girişiyle (sinyal sonrası ilk açılış, aynı stop ve çıkış) ne verirdi; tüm evren için "hepsi piyasa" ve "yarı piyasa + yarı limit". | Yalnız teşhis; H2'nin tanımını belirler (hangi giriş biçimi sınanacak). |
| D3 | Stop sonrası devam | Stop olan işlemlerde stop mumundan sonraki 6 / 12 / 24 mumda özgün TP1'e ulaşma oranı; karşılaştırma: tüm dolan işlemlerin stop olmadan TP1'e ulaşma oranı. Stop ötesi aşım (R) dağılımı. | Stop sonrası TP1 oranı taban orandan ≥ 10 puan yüksekse (iki dilimde) "stop yeri / giriş derinliği" hipotezi (H6) listeye girer; değilse girmez. |
| D4 | Maliyet ayrışması | Brüt R (komisyon = kayma = 0) ↔ net R; stop mesafesi (%) dilimlerine göre. | Yalnız teşhis; H5'in eşiğini (stop mesafesi alt sınırı) belirler. |

## Aşama 1 — hipotezler (aşama 0'dan sonra kesinleşir; en çok 5 + koşullu H6)
| # | Hipotez | Gerekçe (ölçümden önce) | Tanım (taslak) |
|---|---|---|---|
| H1 | BTC'ye göre güç koşulu | Repoda hedge'li artı veren tek şey kesitsel momentum (`xsmom_l28_k5_short_rel`); belgelenmiş anomali | Long yalnız 28 günlük BTC'ye göre getiride üst üçte birde, short yalnız alt üçte birde |
| H2 | Giriş biçimi | Sinyallerin %30'u limit dolmadan hedefe gidiyor (olumsuz seçilim) | D2'ye göre: yarı piyasa + yarı limit ya da kırılımla giriş |
| H3 | Fonlama + açık pozisyon | Fiyattan bağımsız tek yeni bilgi (kalabalık taraf) | Long yalnız fonlama aşırı pozitif değilken; short tersi (eşik: eğitim dilimi yüzdeliği). Geçmiş veri erişimi doğrulanacak; yoksa yalnız canlı gölge etiketle ölçülür |
| H4 | Portföy sınırı | Eşzamanlı pozisyon p90 14–26; en kötü 7 gün −21 / −30R | Yön başına en çok N açık pozisyon (N: 3 / 5), en yüksek puan önce |
| H5 | Maliyet | Brüt ≈ 0, maliyet ≈ 0,045R | Limit emirde düşük komisyon modeli + stop mesafesi alt sınırı (D4'ten) |
| H6 | Stop yeri / giriş derinliği | Yalnız D3 eşiği geçilirse | Giriş ya da stop k × ATR öteye |

## Geçme ölçütü (aşama 1)
1. Eğitim ve doğrulamada sıkı ölçüt (ort. R > 0, PF > 1,1, n ≥ 100) — gerçekçi satırda.
2. Kilitli dilimde (tek bakış): ort. R > 0 ve %90 güven aralığı alt ucu > −0,05R; hedge'li R ≥ 0 (H4 hariç: orada ölçüt en kötü 7 gün ve
   maks. düşüşte ≥ %30 iyileşme, ort. R kötüleşmeden).
3. Geçen hipotez **Variables bayrağıyla, varsayılan kapalı** canlıya aday olur; karar kullanıcının. Önce canlı gölge etiket verisiyle
   (n ≥ 100) aynı yön teyidi beklenir.
4. Hiçbiri geçmezse: sonuç "motor tarayıcı / eğitim aracı; işlem sistemi değil" olarak yazılır, emek momentum portföyüne kayar.

## Canlı gölge etiketler (kural değiştirmez)
Her gönderilen sinyale `shadow` alanı yazılır: 4H mumu içinde gönderim dakikası, o an aynı yönde / toplam açık plan sayısı, stop
mesafesi (%), BTC'ye göre güç ve o turdaki sırası, fonlama oranı (coin + BTC), açık pozisyonun 24 saatlik değişimi. Hiçbir kararda
kullanılmaz. Değerlendirme: ~13.12.2026 (n ≥ 100 dolum), short tarafının canlı değerlendirmesiyle birlikte.

## Günlük
- 13.11.2026: dosya yazıldı; aşama 0 ve gölge etiketler başlatıldı.
- 13.11.2026 (koşudan ÖNCE, sonuç görülmeden): D1'e bilgi amaçlı üçüncü plasebo eklendi — **A-eğilim**: plasebo A ile aynı, ek olarak
  aday anın üst TF eğilimi sinyal yönünde (evren filtresiyle aynı kural). Gerekçe: evren zaten eğilim filtresinden geçmiş; A ile fark
  yalnız eğilimden (momentum) gelebilir. D1 kararı (verdict) değişmedi: A ve B'ye göre. A-eğilim yorumu: sinyal A'yı geçip A-eğilimi
  geçemiyorsa bilgi eğilim filtresindedir, yapı sinyalinde değil.
- 13.11.2026: canlı gölge etiketlere `fundingIntH` (fonlama dönemi, saat) eklendi; OKX'te dönem coin'e göre 1 / 4 / 8 saat.
- 13.11.2026 **Aşama 0 sonucu (koşu 43482081412, `docs/backtest/diag.json`; evren 901 / 934 sinyal, eğitim / doğrulama):**
  - **D1 karar: "yön bilgisi yok"** (plasebo A ve B, tümü / long / short). Sinyalin e-oranı eğitimde 1,00–1,04 (yazı-tura), doğrulamada
    1,12–1,20 ama aynı andaki rastgele coin de 1,16–1,35 (piyasa rüzgârı). Plasebo B farkı (ATR): eğitim +0,08 / **+0,18 [0,04; 0,34]** /
    **+0,27 [0,05; 0,52]** (6 / 12 / 24 mum), doğrulama +0,02 / −0,00 / −0,28 → tekrarlanmadı. Short: eğitim 24 mum +0,40 [0,15; 0,65],
    doğrulama 6 mum +0,18 [0,04; 0,33] → ortak ufuk yok, kural gereği "yok"; coin seçimi (H1) için zayıf ipucu.
  - **Plasebo A yanlı çıktı (tasarım hatası, sonuçtan sonra fark edildi):** yön sinyal anındaki eğilimden alınıp ÖNCEKİ anlara
    uygulanınca, eğilimi oluşturan yükselişin içinden örnek çekiliyor → plasebo getirisi yapay yüksek (+0,2…+0,6 ATR, e 1,2–1,5).
    Bu yüzden A'ya göre farkların eksi çıkması anlam taşımaz. Karar değişmiyor (zaten "yok"). Adil zamanlama ölçütü A-eğilim: fark
    eğitim −0,07 / −0,02 / −0,07, doğrulama +0,08 / +0,08 / +0,03, tüm aralıklar sıfırı içeriyor → **sinyalin zamanlaması, aynı
    eğilimde rastgele bir andan farksız.**
  - **D2:** "kaçan" planlar piyasa girişiyle +0,25…+0,27R (tanım gereği kazanan; tek başına anlam taşımaz). Adil karşılaştırma sinyal
    başına: yalnız limit −0,053 / +0,005 · hepsi piyasa −0,053 / −0,006 · yarı-yarı −0,053 / −0,001 → **giriş biçimi fark etmiyor**
    (limitin iyi fiyatı = kaçırdığı kazananlar). **H2 listeden çıkar.**
  - **D3 karar: "H6 girmez".** Stop sonrası 24 mumda özgün TP1'e ulaşma: eğitim %16 (taban %35, fark −18,7 puan), doğrulama %41 (taban
    %40, +1,8 puan). Stop sonrası aşım medyanı 1,2–1,5R → stoplar "avlanmıyor", hareket sürüyor.
  - **D4:** maliyet 0,046R / işlem (iki dilimde aynı); brüt −0,045 / +0,054R. Stop mesafesi dilimleri dilimler arası TERS (eğitimde dar
    stop iyi, doğrulamada geniş stop iyi) → stop mesafesi alt sınırı desteklenmiyor. **H5 yalnız "limit emir komisyon modeli"ne iner**
    (beklenen ≈ +0,02R).
  - **Aşama 1 listesi (güncel):** H1 (BTC'ye göre güç), H3 (fonlama + açık pozisyon; canlı gölge etiket), H4 (portföy sınırı), H5
    (yalnız komisyon modeli). H2 ve H6 düştü. Kullanıcı onayı bekleniyor.

## Aşama 1 — kesin tanımlar (13.11.2026, koşudan ÖNCE; kullanıcı onayı: "Aşama 1'i üç hipotezle koş")
**Veri:** 24 ay, bugünün ilk 50 coini, yalnız 4H planları (1H mumları yalnız dolum mumu sırası için; 15m / çoklu TF uyumu yok).
- **Geliştirme dilimi:** son 12 ay; bölünme 31.07.2026 (eğitim / doğrulama) — aşama 0 ile aynı.
- **Kilitli dilim (kasa):** ondan önceki 12 ay. Bilinen kısıt: bugünün ilk 50 coininin bir kısmı o dönemde yoktu (hayatta kalma
  yanlılığı; kasadaki coin sayısı raporlanır).
- Plan dosyası ayrı klasörde üretilir, yayınlanmaz; mevcut `sweep.json` / `results.json` (12 ay) değişmez. Tarama (109 varyant)
  kasada KOŞMAZ.
- **Taban satır:** canlı 4H evreni + bugünkü 3 kademe çıkış, gerçekçi (`fillBarTp: 'lower'`, bıçak 'touch', `missTp`), maliyet
  %0,05 komisyon / taraf + %0,05 kayma (bugünkü model).

**İki aşamalı koşu (kasaya tek bakış):** (1) `lock=0`: yalnız geliştirme dilimi hesaplanır ve yazılır; sağlamlık denetimi = taban
satır aşama 0 ile uyumlu mu (eğitim ≈ −0,09R n ≈ 520, doğrulama ≈ +0,01R n ≈ 516; ±%5 n farkı kabul). (2) Denetim geçerse `lock=1`:
kasa dahil tam rapor. Kasa sonucu görüldükten sonra tanım / eşik değişmez; yeniden koşu yalnız belgelenmiş hata düzeltmesi için.

| # | Tanım (tek varyant; ayar taraması yok) | Geçme ölçütü |
|---|---|---|
| **H1** BTC'ye göre güç | Karar anında (plan mumu kapanışı) coin'in 28 günlük (168 × 4H) getirisi − BTC'nin aynı dönem getirisi; o an verisi olan evren coinleri (≥ 10) arasında yüzdelik sıra. **Long yalnız üst üçte birde (sıra ≥ 2/3), short yalnız alt üçte birde (sıra ≤ 1/3).** 28 gün = canlı momentum portföyünün (`xsmom_l28`) penceresi. BTC'nin kendi sinyalleri hariç. | Geliştirme: iki dilimde ort. R > 0, PF > 1,1, n ≥ 100. Kasa: ort. R > 0, %90 GA alt ucu > −0,05R, hedge'li R (`hedged`, eski tanım) ≥ 0. |
| **H4** Portföy sınırı | Sinyaller zaman sırasıyla (aynı anda: yüksek puan önce); o an aynı yönde kapanmamış plan (bekleyen + açık) sayısı ≥ N ise sinyal atlanır. **N = 3 ve N = 5** (iki varyant). | İki geliştirme diliminde ve kasada: ort. R tabandan düşük değil **ve** en kötü 7 gün ile maks. düşüş (R) ≥ %30 iyileşir. Not: R toplamları işlem sayısı azaldığı için kısmen mekanik iyileşir; bu yüzden ayrıca atlanan sinyallerin ort. R'si ve "girişte açık plan sayısı" dilimleri raporlanır (bilgi amaçlı). |
| **H5** Komisyon modeli | Hipotez değil, maliyet sınırı: (a) bugünkü model; (b) en iyi durum = limit giriş ve limit hedefler %0,02 (yapıcı), stop / piyasa çıkışı %0,055 + %0,05 kayma (Bybit standart oranları). | Ölçüt yok; taban ve H1 / H4 için (a) ve (b) altında ort. R raporlanır. Geçme kararları (a) ile verilir. |

İkincil (bilgi amaçlı, geçme kararına girmez): H1 ∧ H4 (N = 5) birleşimi; H1'in üç dilimi (uyumlu / orta / ters) — tekdüzelik
denetimi; long / short kırılımı.

Çoklu sınama: birincil 3 test (H1, H4 N = 3, H4 N = 5). Hiçbiri geçmezse sonuç bölümündeki 4. madde uygulanır.

Uygulama notları (13.11.2026, ilk koşudan ÖNCE):
- Plan üretimi 28 ay: 4H planı ~100 gün (600 mum) ısınma ister; 24 ayla kasa ~260 güne düşerdi. Kasa = [son − 720 gün, son − 360
  gün), geliştirme = son 360 gün; daha eski planlar atılır.
- Aşama 0'da 4H planları ısınma yüzünden ~26.02.2026'da başlıyordu (yani "12 ay" 4H için ~8,5 aydı). Bu koşuda geliştirme dilimi
  tam 12 ay (18.11.2025'ten); eğitim dilimi ~3 ay uzar. Sağlamlık denetimi bu yüzden **aşama 0 penceresinde** (26.02.2026 →)
  yapılır; hipotez ölçütleri tam geliştirme diliminde.
- H1 sırası: (küçük + (eşit − 1) / 2) / (M − 1), BTC sıraya girmez. H4 ve H1'in kasa ölçütünde de n ≥ 100 aranır. Hedge'li R (a)
  maliyet modeliyle. H4 sayımı geliştirme ve kasada ayrı akış (lock 0 / 1 geliştirme sonuçları aynı).
