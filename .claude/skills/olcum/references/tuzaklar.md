# Tuzaklar — sonucu iyimser yapan bilinen hatalar

İyi görünen her sonuçta sırayla kontrol et. Hepsi bu repoda en az bir kez sonucu değiştirdi.

## Motor ↔ canlı sapmaları (düzeltildi; yeni kodda aynısını arama listesi)
| Tuzak | Belirti | Doğrusu |
|---|---|---|
| Dolum mumunda hedef sırası (29.10) | Giriş ve hedef aynı mumda, hedef sayılıyor | `fillBarTp: 'lower'` (alt zaman dilimiyle sıra) |
| "Kaçtı" kararı (13.11) | Erken hedefe göre kaçtı sayılıyor | `missTp`: özgün TP1'e göre |
| Dolum öncesi mumlar (13.11) | Sahte erken hedef → başa baş | `trackPlan` yalnız dolumdan sonraki fiyatı sayar |
| Bıçak kararı tam mumla (13.11) | Koruma olduğundan iyi görünüyor | `knifeBar` 'touch' (kötümser) ↔ 'lowerBar' (canlı); 'full' hatalı |
| Kendi mumlarıyla yeniden oynatma (17.11) | Aynı 4H mumun dolum öncesi dibi "erken hedef" | Alt zaman dilimi (15m) `lower` ile ver |
| Evrenden düşen coin (17.11) | Bekleyen plan izlenmiyor, "süresi doldu" | `needsOwnCandles`; kayıt `rescored.json` ile düzeltilir |

`tests/parity.test.js` "motor = canlı takip" eşitliğini kilitler; motor ya da takip koduna dokunan her değişiklikte çalıştır.
**13.11 düzeltmelerinden önceki tüm 4H sayıları iyimserdir; alıntılama.**

## Ölçüm tasarımı
- **Seçim:** çok varyanttan en iyisi, en iyi zaman dilimi, en iyi coin → iyimser. 13.11'de 6 varyant yalnız iyimser dolum satırında geçti.
- **Görülmüş veri:** eşiği üreten dönemde sınama. Tek satırlık "ADX 57" (n 16, +0,66R) sıralama şansıydı.
- **Kümelenme:** n büyük, bağımsız olay az (aynı satış dalgası, aynı coin). Gün / hafta sayısını yaz.
- **BTC yönü:** tek yönlü dönemde trend yönündeki her kural kazanır. Hedge'li R ve long / short ayrı tablo.
- **Geleceğe bakış:** filtre ya da plasebo sinyal anından sonraki veriyi kullanıyor mu; son (kapanmamış) mum; onaylanmamış pivot.
- **Hayatta kalma:** bugünün ilk 50 coini geçmişe uygulanınca delist olanlar eksik; bilinen sınır olarak yaz.
- **Maliyet:** kısa zaman dilimlerinde komisyon + kayma R'nin büyük kısmı (5m / 15m). Maliyetsiz sayı karar olmaz.
- **Örneklem:** n < 100 sonuçsuz, n < 30 iddia yok. Günlük R dalgalanması normal.

## Canlı kayıt değerlendirirken
- Canlı istatistik 26.10.2026'dan başlar (öncesi eski düzen). Düzeltilmiş kayıt için `applyRescore` (`docs/signals/rescored.json`).
- Yazılmış R ile yeniden oynatma (`replayItem`, 4H + 15m) farklıysa ikisini de ver; takip kodu ile motor anlaşmıyorsa kayda dokunma.
- Düzen değişikliğinin öncesi ve sonrası aynı havuzda toplanmaz.

## Başkasının sonucunu değerlendirirken (17.11, arkadaşın botu örneği)
1. Ham veriyi bul (JSON / CSV); sayfadaki toplamı işlemlerden yeniden hesapla.
2. Birkaç giriş / çıkış fiyatını borsanın gerçek mumlarıyla karşılaştır.
3. Long / short ayrı: kazanç tek yönden ve tek piyasa hareketinden mi geliyor?
4. Aynı coin / aynı günlere kümelenme; bağımsız örnek kaç?
5. İşlem başına risk hesabın yüzde kaçı, sabit mi? Getiriyi %1 riske çevir (toplam R).
6. Komisyon, kayma, fonlama var mı; kısmi kâr ve stop hangi fiyattan yazılıyor (mumun ucu mu, seviye mi)?
7. Kayıt sıfırlanmış mı, diğer zaman dilimleri / sekmeler ne gösteriyor (seçim)?
8. Sonuç dili: "sayılar gerçek mi" ile "kenar kanıtı mı" ayrı sorulardır.
