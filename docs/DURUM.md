# DURUM — tarihli durum günlüğü

Yeni oturumda önce bu dosya okunur (bkz. `CLAUDE.md` → "Devam edelim" protokolü). Her oturum sonunda en üste tarihli
kısa bir giriş eklenir. Eski girişler silinmez.

## 24.10.2026 (Cumartesi, akşam) — kâğıt hesap muhasebe hatası düzeltildi

**Bulgu (açık iş 3 kapandı):** Agresif ajanda "ort. R ≈ 0 ama özsermaye −%12" tutarsızlığının kaynağı `bot/agent/account.js`
`closePart`: kısmi kapanış (TP1 yarı / erken %80) sonrası ikinci kapanışta marjin payı `pos.margin × q/qty0` ile hesaplanıyordu;
marjin zaten azaltılmış olduğu için kalan marjinin bir kısmı (TP1'de çeyreği) nakde dönmüyor, pozisyon silinince özsermayeden
siliniyordu. İşlem pnl/R kayıtları doğruydu; yalnız nakit/özsermaye eksikti.
| Hesap | Eski özsermaye | Kayıp marjin | Onarılmış | Not |
|---|---|---|---|---|
| Temkinli | 260,55 | 12,50 (JTO) | 273,05 | kalan fark ≈ açılış komisyonları |
| Agresif | 264,28 | 29,25 (GRVT, JTO, PEPE, MEW, LA) | 293,53 | ort. R +0,01 ile artık tutarlı (−%2,2) |
Düzeltme: marjin payı artık `pos.margin × q/pos.qty` (kalan oranı); açılış komisyonu da `realized`'a dahil (işlem pnl tam net;
likidasyonda pnl = −marjin − açılış komisyonu). Hesap dosyalarına kayıp tutar nakde geri eklendi, nota yazıldı; eski
maxDD/eğri ve denetçi raporlarındaki "−%12" düzeltilmedi (tarihsel). Momentum portföyü bu kodu kullanmıyor, etkilenmedi.
Bir sonraki denetçi koşusu (Pazar 09:00 TR) özsermayeyi yeni değerden okur.

**Durum:** canlı ayar değişmedi; hafta sonu sinyal yok (bugün 0 yeni sinyal, 128 eski açık). Testler 109 geçiyor.
Sıradaki: DURUM 24.10 listesi 1, 2, 4, 5, 6 aynen geçerli.

## 24.10.2026 (Cumartesi) — son durum

**Canlı (Variables):** `KNIFE_GUARD=1 LIMIT_ONLY=1 SKIP_WEEKEND=1 EARLY_TP={"pct":1.2,"portion":0.8,"tfs":["4H"]}
TF_RULES={"15m":{"off":true},"1H":{"off":true}} HTF_TREND=with AUDIT=1` + momentum (short, rel, hedge). Yalnız 4H
sinyal; hafta sonu sinyal yok → **ilk sinyaller Pazartesi 27.10** (UTC gün değişince). Kural seti zaman damgası botta
(`state.ruleSince`); denetçi eski rejimle (20–24.10, 558 sinyal, −0,83R) yeni düzeni karşılaştırmaz.

**Ajanlar:** denetçi günlük 09:00 TR (son rapor: 🟡 izle — filtreler çalışıyor, eski 178 açık sinyal long yığılması,
agresif ajanda ort. R +0,01 ama özsermaye −%12 → araştırılacak). Araştırmacı Pazar 09:00 TR (ilk rapor: 6 standart
hipotezin hiçbiri doğrulanmadı; kuyrukta eski "son 7 gün" isteği var, sonuçsuz kapanacak). Temkinli 260 USDT, agresif
263 USDT, momentum 317 USDT (+%5,6; hedge net ≈ 12 USDT).

**Bugün test edilen ve ret edilenler (24 ay 1H/4H, ilk 50):**
| Aile | Eğitim R | Doğr. R | Hedge'li doğr. R | Karar |
|---|---|---|---|---|
| fib_cluster_c (0,618 × 1,272 kesişimi, tüm çiftler) | −0,20 | −0,15 | −0,25 | ret |
| fib_cluster_c_strict (yalnız 0,618×1,272) | −0,10 | −0,025 | +0,05 | tutarsız, ret |
| sweep_mss_fvg (arkadaşın SMC kuralı) | −0,07 | −0,10 | −0,16 | ret |
| sweep_mss_fvg_htf / _btc / _1r | −0,12 / −0,04 / +0,02 | −0,04 / −0,09 / +0,02 | −0,01 / −0,16 / −0,06 | ret |
Tarayıcıda "Fib kesişimi (0,618×1,272)" preseti görme aracı olarak duruyor. Lab hedge'li R hatası düzeltildi (limit
girişte BTC getirisi dolum zamanından).

**Önceki bulgular (özet):** zaman stopu (4/8/16 mum) işe yaramadı; seans filtresi işe yaramadı, hafta sonu kötü
(+0,02R hariç tutunca); düşen bıçak koruması +0,02R; dört filtre + erken %80 birlikte 4H'de +0,064/+0,097R, günlük
trend aynı yön eklenince hedge'li +0,039/+0,079R (n 293) → canlıya alındı. Zigzag/flat/diyagonal/Donchian/meanrev/
sweep/engine aileleri: kenar yok, BTC bağımlı. Momentum `xsmom_l28_k5_short_rel` hedge'li zayıf pozitif → canlı.

**Açık işler / sıradaki adımlar:**
1. Pazartesi–Cuma: ilk 4H sinyalleri; Telegram "⚡ Erken hedef" satırı ve takip olayları (early/be) doğru mu?
   `signals.html` ve denetçi raporu.
2. Pazar: araştırmacı raporu (standart hipotezler); kuyruk temiz mi?
3. Agresif ajan: ort. R ≈ 0 ama −%12 özsermaye — komisyon/boyut/açık pozisyon değerlemesi; `statsOf` kontrolü.
4. Arkadaştan "pas geçtiği 3–5 kurulum" cevabı gelirse SMC ailesine seçicilik filtresi olarak eklenip yeniden koşulur.
5. 4–6 hafta sonra 4H düzeninin ileriye dönük sonucu (hedef: ort. R ≈ +0,08, BTC ters giderken ayakta mı).
6. Eğitim: `docs/egitim/` okunup pratik rutinine başlanır; kişisel işlem günlüğü (05-olcum.md şablonu).

**Testler:** 108 geçiyor. Son commit: eğitim + CLAUDE.md + DURUM.md.
