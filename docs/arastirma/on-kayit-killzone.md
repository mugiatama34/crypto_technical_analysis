# Ön kayıt: kayıpların saati ve killzone'lar (25.11.2026; kullanıcı sorusu 25.11.2026, koşudan önce yazıldı)

**Soru:** Kayıpların geldiği saatler killzone'larla örtüşüyor mu? Kullanıcının gözlemi: Asya → Londra ve Londra → New York geçişlerinde oynaklık / "manipülasyon" artıyor.
**Beklenti:** stoplar bu saatlerde zaman payından fazla çıkar, çünkü günün hareketinin büyük kısmı zaten bu saatlerde olur; aynı nedenle kazanç çıkışları da orada yığılır.
Önceki bulgu: sinyal zamanına göre seans / gün filtreleri etkisiz (`bulgular.md`). Yeni olan: 4 saatlik mum yerine **1 saatlik** çözünürlükte stop ve dolum saati.

**Veri:** `on-kayit-ters-gun.md` ile aynı işlem dökümü (koşu 45393710134, `live-trades.json`, "canlıya eşit" 3 kademe, gerçekçi sıra; 403 dolum, 128 tam stop; eğitim / doğrulama ayrımı dökümdeki `split`).
Stop fiyatı aynı koşunun `plans.json.gz` dosyasından (coin + TF + zaman eşlemesi). Saat: OKX `history-candles` 1H mumları, yalnız dolum mumu ile kapanış mumunun içindeki 4'er mum.

**Tanımlar (New York yerel saati, yaz / kış saati dahil):**
- Londra killzone = 02:00–05:00 NY (Asya → Londra geçişi) · New York killzone = 07:00–10:00 NY (Londra → New York geçişi). İkisi birlikte = günün 6 saati = zamanın %25'i.
- **Stop saati** = işlemin kapanış 4H mumu içinde stop fiyatına dokunan ilk 1H mumun başlangıcı. **Dolum saati** = dolum 4H mumu içinde `entryFill` fiyatını aralığında tutan ilk 1H mum.
- Eşleşmeyen (plan bulunamadı, 1H veri yok, dokunan mum yok) işlemler dışarıda kalır ve sayısı yazılır; eşleşme oranı < %90 ise ölçüm geçersiz sayılır.
- **Oynaklık payı** = aynı dönemde BTC 1H mumlarının (yüksek − düşük) / kapanış toplamında killzone saatlerinin payı.

**S1 (tanı, bilgi):** tam stopların killzone'a düşen payı ↔ zaman payı (%25) ↔ oynaklık payı. Ayrıca NY saatine göre 24 saatlik stop tablosu ve canlı kayıt (26.10.2026 →, 4H, `closedAt` saati; n küçükse yalnız sayım).
"Stoplar oynaklığın ötesinde yığılıyor" = stop payı / oynaklık payı > 1,25 (yalnız bildirilir).

**S2 (tek birincil test, kurala çevrilebilir tek soru):** dolumu killzone içinde olan işlemler ↔ diğerleri, ort. R farkı (diğer − killzone).
"İşaret var" = fark iki dilimde > 0 **ve** dolum gününe göre bloklu bootstrap %95 aralığının alt ucu > 0. Bir dilimde killzone grubu n < 100 → **sonuçsuz**; n < 30 → hiçbir iddia yok.
Beklenen n (403 dolumun ≈ %25–35'i, iki dilime bölünmüş) 100'ün altında; yani sonuç büyük olasılıkla **sonuçsuz** çıkacak, yalnız yön bilgisi verecek.

**Seçim yok:** saat tablosundan saat / pencere seçilmez; başka killzone tanımı denenmez. İlginç çıkan saat yeni ön kayıt ve bağımsız dönem ister.
**Sınırlar:** tek 12 ay; 1H çözünürlük (killzone sınırındaki mum başlangıç saatine göre sayılır); stop yalnız "tam stop" (başa baş ve kısmi çıkışlar yok);
S2 "killzone'da bekleyen emri iptal et" kuralının yaklaşığıdır (iptal edilen emrin yerine geleni oynatmaz); canlı kayıt short ağırlıklı ve küçük.

**Not (25.11.2026, ilk koşudan sonra; tanım değişmedi):** ilk koşuda 128 stopun 42'sinin planı `plans.json.gz` ile eşleşmedi (artefakttaki plan dosyası taramanın kullandığı plan
kümesiyle birebir aynı değil) → stop eşleşmesi %67 < %90, yukarıdaki kurala göre **geçersiz**. Düzeltme yalnız veri kaynağında: `sweep.mjs` dökümüne `stop` alanı eklendi,
tarama yeniden koşuldu ve ölçüm yeni dökümle tekrarlandı. Geçersiz koşunun sayıları görüldü (86 stop; killzone payı %33, oynaklık payı %25; S2 sonuçsuz); tanım, pencere ve ölçüt aynı kaldı.
