# Ön kayıt — sahte seviye testi (14.11.2026)

**Durum: ONAYLANDI (kullanıcı, 14.11.2026 — "sahte seviye testine de bakalım"); bu dosya yazıldığında ölçüm yoktu.** Tanım / eşik değişmez
(değişirse tarihli not + neden).

## Soru
Kullanıcının düşüncesi: bir seviyeye ne kadar çok kişi inanırsa oraya o kadar emir birikir ve seviye "çalışır" (kendini gerçekleştiren kehanet).
Sınanan iddia yalnız şu: **fiyat, inanılan seviyelerde, kimsenin bakmadığı komşu seviyelere göre daha sık tepki veriyor mu?** Yön tahmini ya da
strateji değil; geçerse sonraki adım strateji tasarımı + ileriye dönük kayıt, geçmezse fikir kapanır. Bakılmamış geçmiş veri yok → kanıt değil,
eleme.

## Veri
OKX USDT sürekli vadeli, **4H mumlar**, bugünün hacimde ilk 50 coini, 24.11.2022 → veri sonu; iki yarı: A = → 24.11.2024, B = 24.11.2024 →.
(Bilgi amaçlı: 1D.)

## S1 — Fibonacci geri çekilme seviyeleri
- **Bacak:** nedensel zigzag — uç noktadan en az **2 ATR(14)** ters hareket olunca bacak "tamamlandı" sayılır (ATR, tamamlanma mumuna kadar
  veriyle); bacak büyüklüğü en az **10 ATR**. Seviyeler bacağın geri çekilme oranı olarak (0 = bacağın ucu, 1 = başlangıcı).
- **İnanılan seviyeler:** 0,382 · 0,5 · 0,618. **Sahte (komşu) seviyeler:** 0,31 · 0,44 · 0,56 · 0,66 (bilinen her fib / OTE / harmonik
  seviyeye — 0,236 · 0,382 · 0,5 · 0,618 · 0,705 · 0,786 — en az 0,04 uzak).
- **Olay:** bacak tamamlandıktan sonra fiyatın seviyeye İLK dokunuşu (mumun ucu seviyeyi geçer); bacak başına seviye başına tek olay; bacak
  bitişinden en çok 60 mum içinde; bu sürede bacağın ucu aşılırsa bacak kapanır.
- **Sonuç ("tepki"):** dokunuştan sonra fiyat bacak yönünde **0,10 × bacak** ilerlemeden önce seviyenin **0,10 × bacak** ötesine geçmezse =
  tepki var. Aynı mumda ikisi birden olursa "belirsiz" (hariç; payı raporlanır). 40 mumda ikisi de olmazsa "sonuçsuz" (hariç; payı raporlanır).
- **Karşılaştırma (derinlik etkisini ayırmak için):** her inanılan seviyenin tepki oranı − iki komşu sahte seviyenin ortalaması
  (0,382 ↔ 0,31 ve 0,44 · 0,5 ↔ 0,44 ve 0,56 · 0,618 ↔ 0,56 ve 0,66). **Birincil ölçü:** üç farkın olay sayısıyla ağırlıklı ortalaması.

## S2 — Yuvarlak sayılar
- **Adım:** s = 10^⌊log10(fiyat)⌋ (tek anlamlı basamak: 60.000 / 70.000; 0,06 / 0,07). **İnanılan seviyeler:** s'nin tam katları.
  **Sahte seviyeler:** iki yuvarlak seviye arasında 0,37 s ve 0,63 s ötelenmiş noktalar.
- **Olay:** fiyat seviyeden en az 0,25 s uzaktayken seviyeye ilk dokunuş (yaklaşma yönü kaydedilir); aynı seviyede yeni olay için fiyatın
  yeniden 0,25 s uzaklaşması gerekir.
- **Sonuç ("tepki"):** dokunuştan sonra fiyat geldiği yöne **0,10 s** geri dönmeden önce seviyenin **0,10 s** ötesine geçmezse = tepki var;
  belirsiz / sonuçsuz kuralları S1 ile aynı (40 mum).
- **Birincil ölçü:** yuvarlak seviyelerde tepki oranı − sahte seviyelerde tepki oranı.
- Bilgi amaçlı (Osler'in ikinci bulgusu): seviye 0,02 s aşıldıktan sonraki 6 mumda aynı yönde devam büyüklüğü, yuvarlak ↔ sahte.

## Geçme ölçütü
Her test (S1, S2) için **iki yarıda da:** fark > 0 ve olay gününe göre bloklu bootstrap **%99** aralığının alt ucu > 0; yarı başına inanılan
seviyelerde en az **200 olay**. Birincil test sayısı 2. Geçen test "seviye gerçekten tepki çekiyor" demektir (işlem kenarı demek DEĞİL).

## Günlük
- 14.11.2026: dosya yazıldı (ölçüm yok); sayılar orkestratör tarafından belirlendi. Betik yazılıyor.
- 14.11.2026 (ilk koşudan ÖNCE) uygulama notları: zigzag dönüşü = uçtan sonraki bir mumun ucunun ≥ 2 × ATR ters gitmesi (yeni uç yapan mumda
  dönüş aranmaz); bacaklar bağımsız izlenir (60 mum; uç aşılınca kapanır; uç aşımı ve dokunuş aynı mumdaysa olay yok); tamamlanma anında
  çoktan geçilmiş seviye için olay yok; dokunuş mumunda kırılım sayılır, tepki yalnız mum içi sıra kesinse (inanılan ve sahte seviyelere aynı
  kural); tepki oranı = tepki ÷ (tepki + kırılım); **200 olay eşiği çözülmüş olaylarla** sayılır (belirsiz / sonuçsuz hariç); S2'de adım önceki
  kapanıştan, mertebe sınırında (9,9 → 10,1) on kat değişir; bootstrap 2.000 tekrar. Sentetik doğrulama: rastgele yürüyüşte iki test de
  geçmiyor, seviyelere yapay sıçrama konunca yalnız ilgili test geçiyor.
- 14.11.2026 **Sonuç (koşu 43561254457, `docs/backtest/levels.json`; 50 coin, 4H, 24.11.2022 → 14.11.2026; yarı A / yarı B):**
  - **S1 Fibonacci: resmî karar "sonuçsuz"** — inanılan seviyelerde çözülmüş olay 48 / 144 (eşik 200; 10 ATR'lik bacak şartı olayı kıttı: toplam
    514 dokunuş). Eldeki sayılar hipotezin TERSİ yönünde: tepki oranı farkı (inanılan − komşu sahte) **−0,03 [−0,20; +0,19] / −0,12 [−0,23;
    −0,01]**. Seviye başına (B): 0,31 %58 · **0,382 %46** · 0,44 %59 · **0,5 %45** · 0,56 %63 · **0,618 %51** · 0,66 %55 → fib seviyeleri
    komşularından daha AZ tepki çekmiş. 1D (bilgi): n 17 / 35, fark −0,00 / +0,06, aralıklar çok geniş.
  - **S2 yuvarlak sayılar: geçmedi, işaret ters.** Tepki oranı yuvarlak %40,7 ↔ sahte %44,7 (fark **−0,040 [−0,068; −0,012]**, n 3.162 / 6.013) ·
    %40,0 ↔ %41,2 (fark −0,012 [−0,031; +0,007], n 6.540 / 12.719). Fark en çok aşağıdan yaklaşmada (direnç): %37,5 ↔ %43,3 ve %38,4 ↔ %41,0 →
    yuvarlak seviye aşağıdan geldiğinde rastgele seviyeden daha sık KIRILIYOR. Kırılım sonrası devam (Osler ölçüsü): fark +0,009 / −0,003 s,
    aralıklar sıfırı içeriyor. 1D (bilgi): %32,2 ↔ %34,6 ve %31,5 ↔ %33,0 (aynı yön).
  - **Genel karar: iki test de "seviye tepki çekiyor" iddiasını desteklemedi** (S1 sonuçsuz + ters işaret, S2 geçmedi + ters işaret). Sınır:
    4H mum çözünürlüğü ve kaba yuvarlak-sayı tanımı (tek anlamlı basamak); dakikalık ölçekteki emir kümelenmesi etkileri (Osler) bu testle
    görülemez. S1'i daha küçük bacak eşiğiyle yeniden koşmak tanım değişikliği olur; yapılmadı.
