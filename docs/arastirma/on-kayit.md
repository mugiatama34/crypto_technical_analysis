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
