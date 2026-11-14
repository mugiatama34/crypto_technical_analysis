# Ön kayıt — fonlama geliri (taşıma) araştırması (14.11.2026)

**Durum: kullanıcı isteğiyle başlatıldı (14.11.2026 — "Fonlama geliri … önce anlatıp sonra araştırır mısın"); bu dosya yazıldığında ölçüm yoktu.**
Yön tahmini içermeyen bir konu: spot al + aynı miktarda sürekli vadeli sat (delta-nötr), fonlama oranını topla. **Kâğıt / araştırma; gerçek emir
yok.** Tanım / eşik değişmez (değişirse tarihli not).

## Veri
- **Hyperliquid saatlik fonlama geçmişi** (`fundingHistory`, 2023-06 → bugün; buradan erişilebilen tek çok yıllı kaynak), bugünün OKX hacimde
  ilk 50 coininden Hyperliquid'de listeli olanlar.
- **Çapraz denetim:** OKX fonlama geçmişi (~100 gün) aynı coinler ve aynı günler için → "Hyperliquid oranı / OKX oranı" (kullanıcı Bybit'te işlem
  yapıyor; Bybit ve OKX 8 saatlik ve sınırlı oranlı, Hyperliquid saatlik → Hyperliquid sonuçları ÜST sınır sayılır, oranla ölçeklenir).
- İki yarı: A = 2023-06-01 → 2025-03-01 · B = 2025-03-01 → veri sonu.

## Ölçümler
- **C1 betimsel:** coin başına ve toplu yıllıklandırılmış ortalama fonlama (short sürekli vadeli pozitif oranda ALIR), pozitif saat payı, yıllara
  göre; BTC, ETH, ilk 10, tümü.
- **C2 kalıcılık:** haftalık — son 7 günün ortalama fonlaması sonraki 7 günün fonlamasını öngörüyor mu (sıra korelasyonu; son 7 günde en yüksek
  5 coin'in sonraki hafta GERÇEKLEŞEN fonlaması ↔ evren ortalaması).
- **C3 basit kurallar (maliyet dahil; fiyat riski spot bacağıyla kapalı varsayılır, baz hareketi simüle edilmez):**
  - **R1** BTC + ETH sürekli taşıma (eşit ağırlık; maliyet yalnız giriş ve çıkışta).
  - **R2** haftalık dönen ilk 5: her hafta son 7 günlük fonlaması en yüksek 5 coin (yalnız 8 saatlik eşdeğeri > %0,01 olanlar; yoksa boş), eşit
    ağırlık; sonraki haftanın gerçekleşen fonlaması alınır.
  - **R3** eşik anahtarı: yalnız BTC, son 7 günlük fonlaması 8 saatlik eşdeğer > %0,01 iken; değilse boş.
  - **Maliyet:** pozisyon açma + kapama = 4 işlem × (%0,055 komisyon + %0,02 kayma) = nominalin **%0,30**'u; değişen her coin için.
  - **Sermaye:** getiri hem nominal üzerinden hem toplam sermaye üzerinden (spot 1× + vadeli teminatı 1/3 → nominal ÷ 1,33).
  - Rapor: net yıllık getiri (yarı A / B), en kötü 4 hafta, eksi hafta payı, yıllık devir, boşta geçen süre.

## Önceden yazılmış yorum kuralı
"Kâğıt denemeye değer" = R1–R3'ten en az biri, **iki yarıda da** toplam sermaye üzerinden net yıllık **> %5** ve en kötü 4 hafta **> −%2**
(OKX çapraz oranıyla ölçeklendikten sonra). Aksi halde "getirisi zahmetine değmiyor" olarak kapanır.

## Bilinen sınırlar (ölçümden önce)
1. Hyperliquid fonlaması Bybit / OKX'ten farklı kurallı; çapraz denetim yalnız son ~100 günü kapsar.
2. Baz (vadeli − spot farkı) ve short bacağının teminat / tasfiye riski simüle edilmiyor: sert yükselişte short bacak teminat ister.
3. Borsa riski (iki bacak aynı borsada), işlem bacaklarının aynı anda dolmaması, vergi.
4. Havuz bugünün listesi (listeden kalkan coinler yok).

## Günlük
- 14.11.2026: dosya yazıldı (ölçüm yok). Betik yazılıyor; ayrıca kaynaklı bir literatür / uygulama özeti isteniyor.
- 14.11.2026 (sonuç görülmeden) **maliyet düzeltmesi:** kaynak taraması Bybit standart spot komisyonunu %0,1 (yapıcı / alıcı) gösterdi; ön kayıttaki
  %0,30 dört işlemi de vadeli komisyonuyla saymıştı. Gerçekçi değer 2 × (%0,10 + %0,02) + 2 × (%0,055 + %0,02) = **%0,39**. Karar %0,39 ile
  verilir; %0,30 satırı bilgi amaçlı raporlanır. (Kesin oran hesapta "My Fee Rate"ten teyit edilmeli.)
- 14.11.2026 **Sonuç (yerel koşu + Actions koşusu 43555193808, `docs/backtest/carry.json`; Hyperliquid 05.06.2023 → 09.11.2026, 40 coin, 179 hafta):**
  - **C1** yıllık fonlama (short alır): BTC %14,2 (2023 %15,9 · 2024 %24,1 · 2025 %10,6 · 2026 %5,6), ETH %14,3, ilk 10 %15,3, tüm havuz %8,7
    (2026 %1,6); pozitif saat payı %78–87.
  - **C2** kalıcılık: sıra korelasyonu 0,69 / 0,62; son haftanın en yüksek 5'i sonraki hafta evrenden yıllık +%19,6 / +%8,5 fazla, haftaların
    %97'sinde önde → bilgi var.
  - **C3 ham (Hyperliquid oranlarıyla; maliyet %0,39; sermaye üzerinden net yıllık, yarı A / B):** R1 %15,6 / %5,64 (en kötü 4 hafta −%0,31) ·
    R2 %20,9 / %1,7 (yılda ~93 devir) · R3 %12,8 / %0,08 (B'de %81 boşta). Ham karar: R1 geçer.
  - **Çapraz ölçek (OKX, son 95 gün, 40 coin):** Hyperliquid fonlaması OKX'in **1,45 katı (BTC) – 1,76 katı (ETH)**; coin medyanı ~2,0; R1
    için kullanılan oran 1,58.
  - **Ölçeklenmiş (karar):** R1 **%9,8 / %3,6** · R2 %0,0 / −%5,7 · R3 %8,4 / −%0,5 → iki yarıda da > %5 şartını sağlayan kural YOK.
    **Karar (ön kayıt kuralı): "getirisi zahmetine değmiyor".**
  - Yorum sınırı: oran yalnız son 95 günden; önceki dönemlerde farklı olabilir. Baz ve teminat riski simüle edilmedi. Fonlama rejime bağlı:
    2024 gibi dönemlerde (BTC %24 / yıl) taşıma yeniden cazip olur → canlı gölge etiketteki `fundingBtc` ile izlenebilir.
