---
name: olcum
description: Bu repoda her ölçüm işinden ÖNCE yükle - backtest, tarama (sweep), laboratuvar, yeni hipotez ya da "şu kural / filtre işe yarar mı" sorusu, canlı kaydın (history.json, momentum, ajanlar) değerlendirilmesi, başkasının bot / strateji sonuçlarının incelenmesi, "kenar var mı", "ön kayıt", "ölçelim". Ön kayıt şablonunu, gerçekçi ölçüm satırını, karar ölçütünü, motor ↔ canlı tuzaklarını ve daha önce ölçülüp kapanmış fikirlerin listesini içerir.
---

# Ölçüm (hipotezden karara)

Amaç: bir fikrin kenarı olup olmadığına, sonucu görmeden yazılmış bir ölçütle karar vermek. Sıra değişmez:

1. Fikir daha önce kapandı mı bak.
2. Ön kaydı yaz, kullanıcı onaylasın, commit et.
3. Gerçekçi satırla ölç.
4. Ölçüte göre karar ver: **geçti (aday) / geçmedi / sonuçsuz**.
5. Sonucu kaydet (iyi de olsa kötü de olsa).

Ayrıntı dosyaları, gerektiğinde oku:

- `references/bulgular.md`: ölçülmüş ve kapanmış fikirler, sayılarıyla. Her yeni fikirde önce burada `grep`.
- `references/on-kayit-sablonu.md`: ön kayıt dosyasının şablonu ve doldurma kuralları.
- `references/tuzaklar.md`: sonucu iyimser yapan bilinen hatalar (motor ↔ canlı sapmaları, seçim, kümelenme) ve dış sonuçları
  değerlendirme listesi.

## 1. Başlamadan

- `references/bulgular.md` içinde fikri ara. Kapanmışsa kullanıcıya sayısıyla söyle; yeni bir neden (yeni veri, farklı mekanizma) yoksa
  yeniden ölçme. "Başka eşik deneyelim" yeni neden değildir.
- Fikri üreten veri fikri sınayamaz. Tabloya bakılarak seçilen eşik için **bağımsız dönem** gerekir (o tablonun dışı).
- Soru net değilse tek cümleye indir: "X koşulundaki işlemler, X dışındakilerden / sıfırdan iyi mi?" Strateji testi mi, etiketin
  ayırma gücü testi mi, ayır.

## 2. Ön kayıt (ölçümden önce, ayrı commit)

- Dosya: `docs/arastirma/on-kayit-<konu>.md`, şablon `references/on-kayit-sablonu.md`.
- İçinde: soru, beklenti, veri ve dönem, kurulum, nedensel filtre tanımı, **tek** birincil test ve geçme ölçütü, bilgi satırları, bilinen sınırlar.
- Kullanıcı onayı başlığa tarihle yazılır. Tanım sonradan netleşirse sonuç görülmeden "Not (tarih, koşudan önce)" eklenir; sonuç
  görüldükten sonra tanım değişmez.
- Ön kayıt commit'i ölçüm koşusundan önce atılır (sıra git geçmişinden okunabilsin).

## 3. Kurulum (varsayılanlar)

- Veri: OKX USDT sürekli vadeli, hacimde ilk 50 coin; zamanla 2/3 eğitim, 1/3 doğrulama.
- **Gerçekçi satır = karar satırı:** `fillBarTp: 'lower'` + erken hedefli düzende `missTp` + `knifeBar: 'touch'` (kötümser sınır).
  `'lowerBar'` yalnız bilgi. İyimser dolum mumu (`'count'`) satırı geçse de sayılmaz.
- Maliyet dahil: komisyon %0,05 + kayma %0,05. Fonlama taramanın varsayılanı (0); ön kayıtta açıkça yaz.
- Canlı düzeni ölçüyorsan plan ve çıkış bugünkü canlı ayarla aynı olmalı (`CLAUDE.md` "Canlı ayar").
- Hedge'li R alanı: taramadaki `hedgedR`.
- Koşu: yerelde kısa işler; uzun işler `gh workflow run backtest.yml --ref <dal> -f mode=<mod>` (modlar workflow'daki `mode`
  açıklamasında). Bitişi arka planda bekle; koşu numarasını kayda yaz.

## 4. Karar

| Durum | Koşul |
|---|---|
| **Geçti (aday)** | Eğitimde ve doğrulamada ort. R > 0 ve PF > 1,1 (sıkı ölçüt) **ve** hedge'li R iki dilimde > 0 **ve** dilim başına n ≥ 100 |
| **Sonuçsuz** | Herhangi bir dilimde n < 100 (işaret ne olursa olsun) |
| **Geçmedi** | Diğer her durum |

- Sıkı ölçüt geçer, hedge'li geçmezse: "kazanç BTC yönünden; coin / kurulum seçimi değil" → kural olmaz.
- Fark testinde (etiket A ↔ diğerleri): fark iki dilimde > 0 ve güne göre bloklu bootstrap %95 aralığının alt ucu > 0.
- "Sağlam" = en iyi ay atılınca da pozitif. İşlemlerin kaç ayrı güne / haftaya düştüğünü yaz; kümeliyse bağımsız örnek n'den küçüktür.
- Çok varyant arasından en iyisini seçmek iyimserliktir; bilgi satırlarından seçim yapılmaz, ilginç çıkan yeni ön kayıt ister.
- n < 30 ile hiçbir iddia yok.
- **Geçen sonuç canlı kural değildir, adaydır.** Sonraki adım ileriye dönük gölge etiket (Variables bayrağı, varsayılan kapalı); karar kullanıcıda.

## 5. Sonuç şüpheliyse

Beklenmedik iyi sonuçta önce ölçümden şüphelen: `references/tuzaklar.md` listesini sırayla kontrol et. Bu repoda sıkı ölçütü geçen her
satır şimdiye kadar bir ölçüm hatası ya da iyimser dolum varsayımı çıktı.

## 6. Kayıt (sonuç ne olursa olsun)

- `references/bulgular.md`'ye bir madde: tarih, ön kayıt dosyası, sonuç JSON'u, koşu no, eğ / doğr ort. R · PF · n · hedge'li R, karar,
  "başka eşik denenmez" notu.
- `CLAUDE.md` "Kısa bulgu özeti"ndeki kapananlar listesine yalnız konu adı eklenir (sayı değil).
- `docs/DURUM.md`'ye tarihli giriş; sonuç dosyası `docs/backtest/<ad>.json`; yeni betik = test + README notu.

## 7. Kullanıcıya rapor

- Önce tek cümle karar (geçti / geçmedi / sonuçsuz), sonra tablo: satır, eğitim ve doğrulama için ort. R, PF, n, hedge'li R.
- Hangi satır karar, hangisi bilgi olduğunu ayır. Neyin ölçülmediğini açıkça yaz.
- Alt ajan ölçüm yaptıysa en az 2–3 hücreyi sonuç dosyasından kendin teyit et; karar cümlesini ana oturum yazar.
