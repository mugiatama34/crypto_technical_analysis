# Ön kayıt — Bybit hacim eşiğiyle canlı 4H düzeni (18.11.2026)

**Durum: ONAYLANDI (kullanıcı, 18.11.2026 — "bu eşikle kalan sinyallerin son 1 senedeki backtest'ini yapar mısın … hem R olarak hem de 100k
dolar sermayeyle komisyon ve kaymalar düşmüş şekilde"). Bu dosya yazıldığında bu filtreyle hiçbir ölçüm yoktu.**
Tanım / eşik değişmez (değişirse tarihli not + neden). Soru ve dönem ("son 1 sene") kullanıcının; eşik (20 M$), hacim tanımı, maliyet ve
dolar hesabı orkestratörün seçimi. Kullanıcı eşiği canlıya / demoya KOYMAMAYA karar verdi; bu yalnız "ne olurdu" ölçümü.

## Nereden çıktı (görülmüş veri — kanıt sayılmaz)
18.11.2026 emir defteri anlık görüntüsü (Bybit vadeli, 15 coin): 30.000 $'lık piyasa alışında kayma BTC / ETH %0,000 · XRP %0,012 ·
BCH / TAO / TIA / DASH %0,05–0,09 · KAITO %0,34 · MAGIC %0,88. Eşik 20 M$ bu tabloya (kaymaya) bakılarak seçildi, **işlem sonuçlarına bakılarak
değil**. Ancak dönem bağımsız değil: son 12 ay, canlı düzenin seçildiği 13.11 taramasının dönemiyle neredeyse aynı (filtresiz canlı satır:
eğ −0,125 / doğr +0,010R, hedge'li eksi). Bu yüzden geçen sonuç bile zayıf kanıttır.

## Soru
Canlı 4H düzeni yalnız, sinyal anında Bybit'te yeterince hacimli (aşağıdaki tanım) coinlerde işlem açsaydı son 12 ayda sıkı ölçütü geçer
miydi? Beklenti (yazılı): **geçmez**; hacim eşiği maliyeti düşürür ama kenar yaratmaz, sonuç filtresiz satıra yakın (≈ 0 ya da eksi),
hedge'li R ≤ 0.

## Veri ve kurulum
- **Dönem: 17.11.2025 00:00 – 17.11.2026 00:00 UTC** (12 ay). OKX USDT sürekli vadeli mumları (bot verisi), **bugünün hacimde ilk 100 coini**
  (canlı evren; o tarihte listelenmemiş olanlar eksik → hayatta kalma yanlılığı). Zamanla 2/3 eğitim, 1/3 doğrulama.
- **Birincil: 4H**, bugünkü canlı satır (3 kademe: erken %1,2'de %50, TP1'de %25 + stop erken hedefe, kalan TP2; limit giriş, hafta sonu yok,
  bıçak koruması açık, `HTF_TREND=with`). Motor: `fillBarTp: 'lower'` (alt TF 1H), `missTp`, **`knifeBar: 'touch'` karar satırı**.
  Plan üretimi `backtest/run.mjs` varsayılanları (min puan 50, min R:R 2, risk ≤ %5, bekleme 6 s).
- **Maliyet:** komisyon %0,05 + kayma %0,05 (taraf başına, motorun varsayılanı; R'ye dahil). Fonlama 0 (tarama varsayılanı).
- **Filtre (nedensel):** sinyal mumunun açıldığı UTC gününden **önceki 7 kapanmış günlük mumun** Bybit lineer sözleşme cirosu (`turnover`, USDT)
  ortalaması **≥ 20.000.000 $**. Sembol eşlemesi `bybitOf` (çarpanlı sözleşmeler dahil). Bybit'te sözleşmesi olmayan ya da o tarihte 7 günlük
  verisi olmayan coin filtrenin dışında kalır (orada işlem açılamazdı). Başka eşik / pencere karar için denenmez.

## Geçme ölçütü (tek birincil test)
- **Geçer:** filtreli grupta eğitimde ve doğrulamada ort. R > 0 **ve** PF > 1,1 **ve** hedge'li R (`hedgedR`) iki dilimde > 0; dilim başına
  dolan işlem n ≥ 100. n < 100 → **sonuçsuz**. Diğer her durum **geçmedi**.
- Sıkı ölçüt geçer, hedge'li geçmezse: "BTC yönü" → kural olmaz. Geçerse bile aday (dönem görülmüş); sonraki adım ileriye dönük sayım.

## Bilgi satırları (karar vermez, seçim yapılmaz)
- **100.000 $ hesabı (kullanıcının sorusu):** filtreli grubun tüm yıl işlemleri, kapanış sırasıyla. (a) bileşik: her işlemin riski, dolduğu
  andaki özsermayenin %1'i; K/Z kapanışta eklenir. (b) sabit: işlem başına 1.000 $. Rapor: yıl sonu özsermaye, toplam R, en büyük düşüş
  (% ve R), en uzun kayıp serisi, aynı anda açık en çok pozisyon (toplam açık risk). Aynı hesap filtresiz grup için de.
- **Kayma duyarlılığı:** aynı işlemler kayma %0,10 ve %0,20 ile (komisyon sabit); motor bunu desteklemiyorsa R'den yaklaşık düşüm, yöntemi yaz.
- Filtresiz tüm işlemler · eşiğin altında kalanlar · long / short ayrı · `knifeBar: 'lowerBar'` · komşu eşikler 5 M$ ve 50 M$ (yalnız bilgi).
- Filtreli işlemlerin kaç ayrı güne / haftaya ve kaç coine düştüğü; en çok işlem alan 5 coin.

## Bilinen sınırlar
- Dönem görülmüş (canlı düzen bu dönemde seçildi) ve tek: bağımsız doğrulama yok.
- Bugünün ilk 100'ü geçmişe uygulanıyor (delist olanlar eksik). Hacim Bybit'ten, fiyat ve dolum OKX mumlarından (fitil farkı olabilir).
- Kayma sabit yüzde; gerçek kayma emir büyüklüğüne ve stop anındaki deftere bağlı (hızlı harekette daha büyük). Limit emirlerde "dokundu ama
  dolmadı" riski modellenmiyor (30.000 $'lık emirde iyimser). Bileşik hesapta eşzamanlı pozisyonların riski kapanışa kadar güncellenmez.

## Sonuç (18.11.2026) — GEÇMEDİ
Yerel koşu `node backtest/liq.mjs` (66 dk), `docs/backtest/liq.json`. 96 coin serisi (4'ü OKX geçmişi kısa olduğu için atlandı), 4.658 sinyal,
2.547 dolan işlem; filtreli 1.113.

| Satır | Eğitim (n · ort. R · PF · hedge'li) | Doğrulama |
|---|---|---|
| **≥ 20 M$ (karar)** | 766 · −0,110 · 0,69 · −0,144 | 347 · −0,018 · 0,94 · −0,117 |
| Filtresiz (bilgi) | 1.561 · −0,067 · 0,80 · −0,107 | 986 · −0,007 · 0,98 · −0,078 |
| Eşik altı (bilgi) | 738 · −0,034 · 0,89 · −0,077 | 597 · −0,016 · 0,95 · −0,064 |

100.000 $ (filtreli, tüm yıl): bileşik %1 → 35.038 $ (maks. düşüş %74,6; toplam −90,95R; en uzun kayıp serisi 18; aynı anda en çok 25 açık
pozisyon); sabit 1.000 $ → 9.048 $. Kayma %0,10 → 30.872 $, %0,20 → 23.798 $ (bileşik). Filtresiz bileşik 23.518 $ (işlem sayısı 2,3 kat).
Beklenti doğrulandı: hacim eşiği kenar yaratmıyor. Uygulama notları: sinyal günü = plan mumunun açıldığı UTC günü, pencere D−7…D−1; 7 günden
biri eksikse "veri eksik" grubu; PUMP, Bybit'te `PUMPFUNUSDT` adıyla olduğu için `bybitOf` eşlemesinde "Bybit'te yok" sayıldı (n küçük, kararı
etkilemez).

