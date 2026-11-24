# Ön kayıt: yığılma anında koşullu BTC hedge'i (24.11.2026; kullanıcı sorusu 24.11.2026, koşudan önce yazıldı)

**Soru:** Açık pozisyonların çoğu tek yönlüyken (aynı yönde 8–10 açık) ters yönde bir hedge ne kadara mal olur, ters günlerde zararı ne kadar azaltır, kazancı artırır mı?
**Beklenti (önceki bulgu):** her işleme koşulsuz BTC hedge'i ort. R'yi düşürüyor (canlıya eşit satır: −0,034 → −0,063 / −0,060 → −0,121R); kazanç BTC yönünden geldiği için hedge onu da siler.

**Veri / kurulum:** `on-kayit-ters-gun.md` ile aynı işlem dökümü (koşu 45393710134, `live-trades.json`, "canlıya eşit" 3 kademe, gerçekçi sıra). Hedge tanımı = taramadaki `hedgedR`:
işlemle eşit büyüklükte ters yönlü BTC bacağı, dolum mumunun kapanışından işlemin çıkışına (kısmi çıkışlarda orantılı), maliyet 2 × %0,05 komisyon (kayma ve fonlama yok).
**Koşul:** işlemin karar anında aynı yönde açık (bekleyen + dolmuş) sayısı ≥ K ise o işlem hedge'li sayılır (R → hedgedR). Yani "yığın büyüdükten sonra açılan her yeni pozisyon
BTC ile dengelenir". Sınır: yığının tamamını tek hedge ile sonradan dengelemek (eski açık pozisyonlar dahil) dökümden hesaplanamaz; bu ölçüm onun yaklaşığıdır.

**Satırlar:** A sınırsız · B aynı yönde ≤ 10 (kullanıcının 24.11 kararı) · **C = B + K = 8 hedge (birincil)** · D = A + K = 8 hedge (bilgi) · E = A + her işlem hedge'li (bilgi).
**Birincil test (C ↔ B), "işe yarar"** = iki dilimde de ort. R, B'den en çok 0,02R düşük **ve** en kötü gün ile en kötü 7 gün B'den küçük. Hedge'lenen işlem sayısı bir dilimde < 30 → **sonuçsuz**.
"Kazancı artırır" = iki dilimde de ort. R, B'den büyük (yalnız bildirilir; kural olması için ayrı, bağımsız dönem gerekir). Başka K denenmez.
**Sınırlar:** tek 12 ay; 12 ayın ters günlerinin hepsi long tarafta (short yığılması bu veride sınanmıyor); hedge maliyetinde kayma ve fonlama yok (iyimser).
