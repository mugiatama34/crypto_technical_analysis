# Ön kayıt — fib kesişiminde iç dalga sayımı (15.11.2026)

**Durum: ONAYLANDI (kullanıcı, 15.11.2026 — "etiket işi olsun, ölçüm de isterim; 5m ve 15m'de ölç"). Bu dosya yazıldığında ölçüm yoktu.**
Tanım / eşik değişmez (değişirse tarihli not + neden). Ölçüm ayrıntıları (iç eşik, sınıflar, ölçüt) orkestratörün seçimi; kullanıcı soruyu ve
zaman dilimlerini belirledi.

## Soru
Fib kesişimi (itki → ABC, itkinin 0,618 geri çekilmesi × A'nın B'den 1,272 uzantısı) kurulumunda **itkinin içinin 5 dalga olması** kurulumun
sonucunu iyileştiriyor mu? Sınanan iddia: "5'li itki" etiketli kurulumların ort. R'si, etiketsiz kurulumlardan yüksek. Strateji testi değil,
**etiketin ayırma gücü** testi. Taban (etiketsiz) 5m / 15m fib kesişimi 04–08.11'de ölçüldü, kenar yok (−0,10…−0,26R); o dönemlerin bir kısmı
bu veriyle örtüşüyor → geçse bile kanıt değil **aday** (sonraki adım ileriye dönük kayıt), geçmezse fikir kapanır.

## Veri ve taban kurulum
- OKX USDT sürekli vadeli, bugünün hacimde ilk 50 coini. **5m: son 6 ay · 15m: son 24 ay.** Her TF kendi içinde zamanla 2/3 eğitim, 1/3 doğrulama.
- Taban: lab `fib_cluster_g` (yalnız 0,618 × 1,272, tol 0,5 ATR, B = A'nın %38,2–%100'ü, ZigZag eşiği 2 / 3 / 4 ATR, limit giriş kesişim
  ortasına, stop itkinin 0,886'sı − 0,2 ATR, TP1 itki ucu, TP2 +0,272; çıkış düzeni lab'deki gibi). Komisyon %0,05 + kayma %0,05, fonlama
  varsayılan, dolum mumu kötümser (`fillbar skip`). R yalnız dolan işlemlerden; dolum oranı grup başına ayrıca raporlanır.

## Etiket (nedensel; yalnız sinyal anına kadarki veri)
- **İç sayım:** bir bacağın (itki P0→P1 ya da A bacağı P1→A) iki ucu arasındaki mumlarda aynı ZigZag algoritması, eşik = kurulumu bulan dış
  eşiğin **yarısı** (k / 2 × ATR; ATR = dedektörün sinyal anında kullandığı ATR). İç pivot dizisi bacağın başıyla başlar, ucuyla biter; iç
  bacak sayısı m (tek sayı).
- **Sınıflar:** m = 1 "tek parça" · m = 3 "3'lü" · m = 5 ve iki Elliott kuralı sağlanıyor (3. dalga, 1 / 3 / 5 içinde en kısa değil; 4. dalga
  1. dalganın ucunu aşmıyor) → **"5'li ✓"** · m = 5, kural bozuk → "5'li ✗" · m ≥ 7 → "7+".
- **Birincil grup:** itki "5'li ✓". Karşılaştırma grubu: geri kalan tüm kurulumlar.

## Birincil ölçü ve geçme ölçütü
Her TF için ayrı (birincil test sayısı 2: 5m, 15m): **fark = ort. R("5'li ✓") − ort. R(diğerleri).**
- **Geçer:** eğitimde ve doğrulamada fark > 0 **ve** giriş gününe göre bloklu bootstrap %95 aralığının alt ucu > 0; "5'li ✓" grubunda dilim
  başına dolan işlem n ≥ 100. n < 100 → **sonuçsuz**.
- **Kural adayı** sayılması için ek olarak "5'li ✓" grubu tek başına sıkı ölçütü geçmeli (iki dilimde ort. R > 0 ve PF > 1,1) ve hedge'li R
  iki dilimde > 0 olmalı. Fark geçer ama bu geçmezse sonuç: "etiket bilgi taşıyor, işlem kenarı değil".

## Bilgi satırları (karar vermez)
- Sınıf başına ort. R / PF / n / dolum oranı (tek parça, 3'lü, 5'li ✓, 5'li ✗, 7+), long / short ayrı.
- A bacağının sınıfı (aynı sayım): "A 5'li ✓" (zigzag) · "A 3'lü" (flat) · diğer; ve birleşik "itki 5'li ✓ + A 5'li ✓ ya da 3'lü".
- Düşük maliyet (komisyon %0,02 + kayma %0,01) altında aynı birincil fark.
- Bu satırlardan seçim yapılmaz; ilginç çıkan yeni ön kayıt ister.

## Bilinen sınırlar
- Dalga sayımı eşiğe bağlı; "yarı eşik" tek sabit seçimdir, başka eşik denenmez.
- 5m'de maliyet R'nin büyük kısmını yer; fark ölçüsü iki grubu aynı maliyetle karşılaştırdığı için buna dayanıklı, mutlak R değil.
