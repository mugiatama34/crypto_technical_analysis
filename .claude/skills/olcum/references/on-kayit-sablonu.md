# Ön kayıt şablonu

Dosya adı `docs/arastirma/on-kayit-<konu>.md`. Ölçüm koşusundan önce ayrı commit. Örnekler: `on-kayit-adx-short.md` (bağımsız dönemli
kural testi), `on-kayit-fib-dalga.md` (etiketin ayırma gücü, fark testi), `on-kayit-momentum.md` (kilitli dönem).

```markdown
# Ön kayıt — <konu> (<GG.AA.YYYY>)

**Durum: ONAYLANDI (kullanıcı, <tarih> — "<kullanıcının sözü>"). Bu dosya yazıldığında <dönem> için ölçüm yoktu.**
Tanım / eşik değişmez (değişirse tarihli not + neden). <Hangi seçim kullanıcının, hangisi orkestratörün.>

## Nereden çıktı (görülmüş veri — kanıt sayılmaz)
<Fikri üreten tablo / gözlem ve sayıları. Eşik buna bakılarak seçildiyse açıkça yaz: "bu dönem hipotezi üretti, sınayamaz".>

## Soru
<Tek cümle. Sınanan iddia. Yazılı beklenti (ör. "hedge'li sonuç ≈ 0").>

## Veri ve kurulum
- Dönem (bağımsız / kilitli), borsa, coin evreni, zaman dilimi (birincil ↔ bilgi), eğitim / doğrulama bölünmesi.
- Plan ve çıkış düzeni, motor seçenekleri (`fillBarTp`, `missTp`, `knifeBar`), maliyet, fonlama.
- **Filtre (nedensel):** yalnız sinyal anına kadarki veriyle hesaplanan tam tanım; kod konumu. "Başka eşik denenmez."

## Geçme ölçütü (tek birincil test)
- **Geçer:** <sıkı ölçüt + hedge'li R + n ≥ 100, ya da fark testi için bootstrap aralığı>. n < 100 → **sonuçsuz**.
- Kısmi geçişin anlamı (ör. sıkı geçer, hedge'li geçmez → BTC yönü).
- Geçerse bile aday; sonraki adım ileriye dönük gölge etiket.

## Bilgi satırları (karar vermez, seçim yapılmaz)
<Karşı gruplar, diğer zaman dilimi, iyimser sınır, kümelenme sayımı, "görülmüş" dönem.>

## Bilinen sınırlar
<Hayatta kalma yanlılığı, tek yönlülük, kümelenme, maliyet duyarlılığı.>
```

## Doldurma kuralları
- Birincil test sayısı küçük tutulur (1, en çok TF başına 1). Her ek test yanlış pozitif olasılığını artırır.
- Eşik, pencere, dönem bir kez seçilir. Komşu değerler ancak bilgi satırı olabilir.
- Plasebo kurarken yön bilgisini geçmişe taşıma (karşılaştırma grubu aynı eğilimde rastgele an olmalı).
- Kilitli döneme (kasa) tek bakış: bakıldıktan sonra o dönem geliştirme verisi sayılır.
- Sonuç sonrası dosyaya yalnız "Sonuç (<tarih>)" bölümü eklenir; üst kısım değişmez.
