---
name: orkestrasyon
description: Bu repoda birkaç araç çağrısından uzun her işte (kod değişikliği, ölçüm/tarama, veri temizliği, çok dosyalı okuma, sayfa/belge üretimi) işe başlamadan ÖNCE yükle. Ana oturum (pahalı model) yalnız planlar, böler, brief yazar ve doğrular; işi model katmanlarına dağıtır — Opus (orta–yüksek zorluk, gevşek brief), Sonnet (basit–orta, sıkı brief), Haiku (çok büyük veri temizliği, en sıkı brief). Kullanıcı "orkestrasyon", "alt ajanlara dağıt", "ucuz modelle yap", "maliyeti düşür" dediğinde de kullan.
---

# Orkestrasyon (model katmanları)

Amaç: pahalı ana modelin (orkestratör) token'ını **karar, brief ve doğrulamaya** harcamak; üretim işini ucuz katmana vermek.
Kullanıcı kararı (13.11.2026): bundan sonra bu repoda böyle çalışılır. Alt ajan = `Agent` aracı, `model` parametresi
`opus` / `sonnet` / `haiku` (ana oturum hangi modelde olursa olsun kurallar aynı; ana oturum zaten Opus/Sonnet ise
"kendin yap" eşiği yükselir, bir üst katmana delege edilmez).

## 1) Yönlendirme tablosu

| Katman | Hangi iş | Brief sıkılığı |
|---|---|---|
| **Orkestratör (ana oturum)** | Kullanıcıyla konuşma, "sorgula ve geri bildir", planı bölme, brief yazma, alt ajan çıktısını doğrulama, ölçüm yorumunun son hali, canlı kural/Variables **önerisi**, gerçek para soruları, commit/push, DURUM.md | — |
| **Opus** (`model: "opus"`) | Orta–yüksek zorluk: çok dosyalı özellik, motor/bot/ajan mantığı (`backtest/engine.js`, `bot/plan.js`, `bot/agent/`), hata kök nedeni, yeni ölçüm/tarama tasarımı ve ilk yorumu, kod incelemesi, belirsiz kapsamlı araştırma | **Gevşek:** hedef + bağlam + kısıtlar + bitti ölçütü. Yöntemi ajan seçer. |
| **Sonnet** (`model: "sonnet"`) | Basit–orta: iyi tanımlı tek/iki dosya değişikliği, test ekleme, HTML/sayfa düzeltmesi, hazır betiği çalıştırıp tablo çıkarma, README/eğitim notu, hedefi belli arama/okuma özeti, koşu bekleme + sonuç okuma | **Sıkı:** numaralı adımlar, dosya yolları, dokunulmayacaklar, çıktı biçimi, "emin değilsen dur ve bildir". |
| **Haiku** (`model: "haiku"`) | Çok büyük verinin temizliği: CSV/JSON satır ayıklama, tekrar ayıklama, biçim normalizasyonu, etiketleme, toplu log özetleme | **En sıkı:** şema, kural listesi, girdi/çıktı örneği, yorum yasak, kural dışı satır ayrı dosyaya, sayım kontrolü. |

Kısa yol: iş **≤ ~3 araç çağrısı** ya da hedefi bilinen tek okuma/tek satır düzeltme ise delege etme, kendin yap (brief + rapor
turu işin kendisinden pahalı). Dosya taraması gereken arama → `Explore` ajanı (`model: "sonnet"`; çok geniş ve mekanikse `haiku`).

Emin değilsen bir alt katmandan başla; yetmezse yükselt (bkz. 4).

## 2) Bölme ve çalıştırma
1. İşi bağımsız parçalara böl; her parçaya katman ata. Kullanıcıya **tek satır** plan yaz ("Opus: motor değişikliği · Sonnet: test + sayfa").
2. Bağımsız parçaları **aynı mesajda** paralel başlat. Aynı dosyaya yazan iki ajanı paralel koşma (sırala ya da `isolation: "worktree"`).
3. Alt ajan yalnız brief'i bilir: gereken kuralı, dosya yolunu, sayıyı brief'e yaz; "DURUM.md'yi baştan sona oku" deme — ilgili
   satır aralığını ya da başlığı göster.
4. Beklerken aynı işi kendin yapma. Rapor gelince 3. bölümdeki doğrulamayı uygula.
5. Düzeltme gerekiyorsa yeni ajan açma; aynı ajana `SendMessage` ile devam ettir (bağlamı korunur, ucuzdur).

## 3) Doğrulama (orkestratör yapar, atlanmaz)
Alt ajan raporu **iddiadır**, kanıt değil.
- Kod: `git diff --stat` + kritik kısmın diff'ini oku; `node --test tests/*.test.js` kendin çalıştır (sayı DURUM.md'dekinden az olamaz).
- Ölçüm: rapordaki sayıları üreten dosyadan (`docs/backtest/*.json`, betik çıktısı) en az 2–3 hücre teyit et; n, eğitim/doğrulama,
  hedge'li R var mı bak. Sıkı ölçüt kararını ve "kural olur/olmaz" cümlesini orkestratör yazar.
- Veri temizliği: `girdi satırı = temiz + reddedilen` eşitliği; rastgele 10–20 satır gözle kontrol.
- Uymayan şey varsa kullanıcıya olduğu gibi söyle (hangi ajan, ne eksik).

## 4) Yükseltme / düşürme
- Sonnet aynı parçada **2 denemede** bitti ölçütünü tutturamadıysa → Opus'a ver (önceki denemenin neden tutmadığını brief'e yaz).
- Opus takılırsa ya da karar ölçüm disiplinine/gerçek paraya dokunuyorsa → orkestratör kendisi yapar.
- Haiku'nun çıktısında kural ihlali > ~%2 ise → kuralı netleştirip bir kez daha; yine tutmazsa Sonnet.
- İş beklenenden basit çıktıysa sonraki benzer parçayı bir alt katmana ver.

## 5) Alt ajanların yapamayacakları (her brief'e yaz)
- Commit/push yok, dal değiştirmek yok; Variables ve canlı kural değişmez; workflow tetiklenmez (brief açıkça istemedikçe).
- Gerçek emir yok (her şey kâğıt). Kullanıcıya ait kişisel veri (işlem CSV'leri, cüzdan, e-posta) dış servise gönderilmez.
- Kapsam dışı "iyileştirme" yok; fark ettiği sorunu raporda "Not:" olarak yazar.
- Ölçüm yapan ajan için ek: eğitim/doğrulama 2/3, `fillBarTp: 'lower'`, erken hedefli ölçümde `missTp` (özgün TP1), maliyet dahil,
  n < 100 = sonuçsuz, çok hücreden seçim = iyimserlik. Yorum değil **tablo** ister.

## 6) Brief şablonları

**Opus (gevşek)**
```
Hedef: <ne isteniyor, neden — 2–4 cümle>
Bağlam: <ilgili dosyalar/satırlar, bilinen bulgu, daha önce elenen yol>
Kısıtlar: <bölüm 5 + işe özel sınırlar>
Bitti ölçütü: <testler geçer / şu tablo üretilir / şu soru cevaplanır>
Rapor: ne yaptın, hangi dosyalar, test sonucu, emin olmadığın noktalar (≤ 20 satır).
```

**Sonnet (sıkı)**
```
Görev: <tek cümle>
Adımlar:
 1. <dosya:satır> içinde <şunu> yap.
 2. <test dosyası>na <şu durumlar> için test ekle.
 3. `node --test tests/*.test.js` çalıştır.
Dokunma: <dosya/klasör listesi>; davranışı değişmeyecek şeyler: <…>
Belirsizlik: adım uygulanamıyorsa ya da başka dosya gerekiyorsa DUR, değişiklik yapmadan nedenini bildir.
Kısıtlar: <bölüm 5>
Rapor biçimi: değişen dosyalar (yol + 1 satır) · test sayısı geçen/kalan · "Not:" (varsa). Başka metin yok.
```

**Haiku (en sıkı, veri temizliği)**
```
Girdi: <yol> (<biçim>, ~<N> satır). Çıktı: <yol-temiz>, reddedilen: <yol-red> (son sütun = neden kodu).
Şema: <sütun: tip, zorunlu mu, geçerli aralık>
Kurallar (sırayla, başka kural uydurma):
 K1 <…>  K2 <…>  K3 <…>
Örnek: <2–3 girdi satırı → beklenen çıktı / red kodu>
Yasak: değer tahmin etme, satır birleştirme, yorum ekleme, sütun adı değiştirme.
Bitince yalnız şunu yaz: girdi N · temiz N · red N (koda göre dağılım).
```
Önce sor: kurallar tümüyle mekanikse (tarih biçimi, tekrar anahtarı, sayı aralığı) **model yerine betik** daha ucuz ve
tekrarlanabilir — Haiku'ya betiği yazdırıp çalıştırt (`tools/` altına) ya da hazır aracı kullan (`tools/trades/rtable.mjs`).
Satır satır model okuması yalnız bulanık kısım için (serbest metin etiket, bozuk biçim). Büyük dosyayı parçalara böl
(parça başına ≤ ~2.000 satır), parçaları paralel Haiku'lara ver, sayımları topla.

## 7) Kullanıcıya rapor
Cevabın sonunda tek satır dağılım: `Dağılım: Opus 1 (motor) · Sonnet 2 (test, sayfa) · kendim: doğrulama + commit`.
Bir parçayı yükselttiysen ya da kendin yaptıysan nedenini bir cümleyle yaz.

## 8) Kapsam dışı
GitHub Actions'ta koşan ajanların modeli (kâğıt-işlem ajanları `AGENT_MODEL`, denetçi, araştırmacı) Variables'tadır; bu skill
onları değiştirmez. Değişiklik gerekiyorsa kullanıcıya öneri olarak sunulur.
