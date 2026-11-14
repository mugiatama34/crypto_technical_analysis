# Ön kayıt — bilgi taraması (14.11.2026)

**Durum: ONAYLANDI (kullanıcı, 14.11.2026 — "Lütfen başlat ve sayıları sen belirle"); bu dosya yazıldığında hiçbir ölçüm koşulmamıştı.**
Tanım / eşik değişmez (değişirse tarihli not + neden). Kardeş dosyalar: `on-kayit.md` (4H sinyal düzeni), `on-kayit-momentum.md`.

## Amaç ve sınır
Altı fikirden hangisinin **ileriye dönük kâğıt denemeye değdiğini** seçmek. Strateji değil: stop, hedef, maliyet yok; yalnız "olaydan /
gruptan sonraki getiri, aynı gün rastgele seçilmiş coinlerden farklı mı?" (momentumda sıralamanın bilgi taşıdığını gösteren M0b testiyle aynı
mantık). **Kanıt üretmez:** 2022-11 → 2026-11 verisinin iki yarısına da momentum için bakıldı; bakılmamış geçmiş veri yok. Geçen fikir için
sonraki adım strateji tasarımı + ileriye dönük kayıt; geçmeyen fikir kapanır.

## Veri
- OKX USDT sürekli vadeli, günlük mumlar; havuz bugünün hacimde ilk 150'si (listeden kalkan coinler yok: short yönlü bulguları zayıflatır,
  long yönlü bulguları güçlendirir — yorumda hatırlanır).
- **Dönem evreni:** her gün, o günden ÖNCEKİ 30 günün USDT hacmine göre ilk 80 coin (olay gününün kendi hacmi sıralamaya girmez), en az 60
  günlük geçmiş. BTC evrende, olay adayı değil.
- **İki yarı:** A = 24.11.2022 → 24.11.2024 · B = 24.11.2024 → veri sonu.
- **Göreli getiri:** coin'in getirisi − aynı penceredeki evren ortalaması (eşit ağırlık). Giriş olaydan sonraki günün AÇILIŞI (uygulanabilir
  fiyat); N günlük ufuk = açılış[t+1] → kapanış[t+N].
- **Plasebo:** her olay günü, evrenden aynı sayıda rastgele coin; 1.000 çekiliş, sabit tohum. **Güven aralığı:** olay gününe (haftalıklarda
  haftaya) göre bloklu bootstrap, %99.

## Adaylar (her birinde TEK birincil ufuk ve önceden yazılmış yön)
| # | Fikir | Olay / grup tanımı | Hipotez (birincil ufuk) |
|---|---|---|---|
| **K1** | Pump sonrası geri verme (kullanıcı gözlemi) | Günlük kapanıştan kapanışa getiri ≥ **+%25** ve o günün hacmi ≥ **3 ×** önceki 30 günün medyan günlük hacmi | Sonraki **3 gün** göreli getiri **< 0** |
| **K2** | Sert düşüş sonrası | Günlük getiri ≤ **−%20** ve hacim ≥ 3 × medyan | Sonraki **3 gün** göreli getiri **≠ 0** (yön önceden seçilmedi: tepki mi devam mı; iki yönlü test) |
| **K3** | Günlük zaman diliminde yapı sinyalleri (kullanıcı fikri) | Sinyal motorunun 1D planları (puan ≥ 50; coin'in tüm geçmişiyle, 600 günlük ısınma), bugünün ilk 50 coini | Sinyal yönünde sonraki **7 günlük** getiri (ATR biriminde) > plasebo; iki plaseboya karşı da (aşağıda) |
| **K4** | Yeni listelenen coinlerin erimesi | Haftalık (pazar kapanışı): OKX'teki ilk mumundan beri **30–120 gün** geçmiş coinler | Sonraki **7 gün** göreli getiri **< 0** |
| **K5** | Fonlama aşırılıkları | Haftalık: son 7 günün ortalama fonlama oranına göre beşte birlikler | **Yalnız bilgi amaçlı** (OKX geçmişi ~3 ay → iki yarı ölçütü uygulanamaz); karar canlı gölge etiketle (~13.12.2026) |
| **K6** | Yüksek oynaklıklı coinler | Haftalık: 28 günlük günlük getiri standart sapmasına göre en yüksek beşte birlik | Sonraki **7 gün** göreli getiri **< 0** |

**K3 plaseboları** (4H teşhisindeki hata tekrarlanmaz: yön bilgisi geçmişe taşınmaz): (B) aynı gün, evrenden rastgele başka coin, aynı yön,
o coinin ATR(14)'ü; (A-mom) aynı coin, ±90 gün içinde rastgele gün, **o günün kendi 28 günlük getirisinin işareti sinyal yönüyle aynı** olan
günler (yön her plasebo gününün kendi bilgisinden). Piyasa girişi sonraki günün açılışı, stop / hedef yok.

Bilgi amaçlı (karara girmez): diğer ufuklar (1 / 3 / 7 gün; K3'te 3 / 7 / 14); K1'de daha sıkı eşik (+%40); **K1 ve K2'de sıkışma riski** —
giriş sonrası ufuk içinde aleyhe en büyük hareket (%; p50 / p90 / en büyük); olay sayıları ve yıllara dağılımı; beşte birliklerin tamamı (K4,
K6); long / short ayrımı (K3).

## Geçme ölçütü (tarama)
Bir aday "ileriye dönük denemeye değer" sayılır, ancak **iki yarıda da**:
1. birincil ufukta ortalama, hipotez yönünde ve bloklu bootstrap **%99** aralığı sıfırı içermiyor;
2. plasebo dağılımında **%1'lik** uçta (K1, K4, K6 tek yön: yüzdelik ≤ %1; K2 iki yön: ≤ %0,5 ya da ≥ %99,5 ve iki yarıda aynı işaret; K3:
   fark aralığının alt ucu > 0, iki plaseboya karşı da);
3. yarı başına en az **100 olay** (K1, K2, K3) ya da **60 hafta** (K4, K6). Altındaysa "sonuçsuz".

Birincil test sayısı 5 (K1, K2, K3, K4, K6); eşik %1 → hepsi boşsa en az birinin şans eseri geçme olasılığı ≈ %5. Hiçbiri geçmezse tarama
"aday yok" olarak kapanır; yeni fikir listesi kullanıcıyla birlikte yazılır.

## Günlük
- 14.11.2026: dosya yazıldı (ölçüm yok); sayılar kullanıcının yetkisiyle orkestratör tarafından belirlendi. Betik yazılıyor.
- 14.11.2026 (ilk koşudan ÖNCE) düzeltme ve uygulama notları:
  - **K4 tanım çelişkisi (benim hatam):** evren ≥ 60 günlük geçmiş istediği için "30–120 gün" grubunun 30–60 gün kısmı evrende hiç yok.
    Karar (sonuç görülmeden): evren kuralı aynen kalır, **K4'ün birincil grubu fiilen 60–120 gün**; evren eşiği 30 güne indirilmiş "30–120
    gün" satırı (`k4.wide`) yalnız bilgi amaçlı.
  - K3 ölçütü betikte daha sıkı okunuyor: sinyal yönünde ham getiri > 0 (%99 aralık > 0) VE iki plaseboya karşı fark aralığının alt ucu > 0.
    Yalnız ham getiri koşulu yüzünden kalırsa ayrıca belirtilir.
  - Plasebo havuzu o günün evreni (BTC hariç; olay coinleri havuzda); bootstrap 2.000 tekrar, tohum 20261114; K3 sinyalleri bugünün ilk
    50 coininden (dönem evreniyle süzülmez), ATR(14) Wilder; yaş = verideki ilk günlük mumdan; K5'te haftada en az 5 coin.
