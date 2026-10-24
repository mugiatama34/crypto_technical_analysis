# CLAUDE.md — proje belleği (her oturumda önce bunu oku)

Bu repo Ferhat'ın kripto teknik analiz platformu: GitHub Pages tarayıcı, Telegram sinyal botu (15 dk'da bir, GitHub
Actions), kâğıt-işlem Claude ajanları, haftalık momentum kâğıt portföyü, backtest/tarama/laboratuvar, denetçi ve
araştırmacı ajanlar. **Her şey kâğıt (sanal) işlem; gerçek emir yok ve eklenmez.** Dil Türkçe. Kullanıcı makine
mühendisi; kısa, net, sayılı cevap ister; kararları (Variables, canlı kural değişikliği) kendisi verir.

## "Devam edelim" protokolü (yeni sohbet)
1. `docs/DURUM.md`'yi oku (tarihli durum günlüğü: bulgular, canlı ayarlar, açık işler, sıradaki adım).
2. Son koşuları kontrol et: `docs/agent/review.json` (denetçi), `docs/agent/research.json` (araştırmacı),
   `docs/backtest/{sweep,lab,results}.json` `meta.generatedAt/sweepAt`, `docs/signals/history.json` (canlı sinyaller).
   Gerekirse `gh run list --workflow scan.yml --limit 3` / `backtest.yml`.
3. Kullanıcıya 3–5 satır durum ver (ne değişti, ne bekleniyor) ve sıradaki adımı öner; sonra devam et.
4. Oturum sonunda `docs/DURUM.md`'ye tarihli kısa bir giriş ekle (ne yapıldı, ne bulundu, ne bekleniyor) ve push et.

## Sabit kurallar
- Testler: `node --test tests/*.test.js` (hepsi geçmeli; sayı DURUM.md'de). Yeni özellik = test + README notu.
- Git: dal `claude/awesome-heisenberg-mmuyod` (repo HEAD). Commit → `git pull -q --rebase origin <dal>` → push. PR açma.
  Commit mesajı Türkçe; model adı yazılmaz; sonuna Co-Authored-By ve Claude-Session satırları (oturumun verdiği).
- GitHub Actions'ı `gh workflow run` ile tetikleyebilirsin (backtest.yml: mode full|sweep|lab|research; scan.yml:
  force_audit). Koşu bitişini `gh run view <id> --json status` döngüsüyle arka planda bekle.
- Variables (repo Settings) yalnız kullanıcı değiştirir; sen önerirsin. Ajanlar (denetçi/araştırmacı) da yalnız öneri.
- Ölçüm disiplini: eğitim/doğrulama 2/3 bölünmesi; **sıkı ölçüt** = iki dilimde ort. R > 0 ve PF > 1,1 (lab'de
  `acceptance`), "sağlam" = en iyi ay atılınca da pozitif; **hedge'li R** (eşit nominal ters BTC) kazancın BTC
  yönünden mi coin seçiminden mi geldiğini gösterir; çok varyant arasından seçim = iyimserlik, n < 100 = sonuçsuz;
  **ölçmeden canlıya kural konmaz**; canlı değişiklik = Variables bayrağı, varsayılan kapalı.
- Küçük örneklem (n < 30) ile iddia yok. Günlük R dalgalanması normal.

## Mimari harita
- Tarayıcı: `index.html` + `src/` (detectors, scan, ew, ui). Presetler `src/scan/presets.js` (ICT/SMC, EW, zigzag/flat,
  diyagonal, Fib kesişimi…). Detektörler `src/detectors/*.js` (signal(ctx) → Signal[]), `src/scan/registry.js`.
- Sinyal botu: `bot/run.mjs` (CFG = env; TF kuralları `TF_RULES_DEFAULT`, `mergeRule`), `bot/plan.js` (buildPlan,
  trackPlan: waiting→active→tp1→done | confirming/knife | early/be | timeout), `bot/telegram.js`, `src/scan/regime.js`
  (BTC rejimi, horizonTrend, htfTrendAt), `src/scan/relative.js` (BTC'ye göre güç). Geçmiş `docs/signals/history.json`
  → `signals.html`.
- Ajanlar: `bot/agent/` (account, manager = Claude çağrıları `call()`, run, profiles). `agent.html` (Temkinli/Agresif +
  Denetçi/Araştırmacı sekmeleri).
- Momentum portföyü: `bot/momentum/` (`momentum.html`): short, BTC'ye göre sıralama, BTC hedge.
- Denetçi: `bot/review/` (metrics, auditor, run) — günlük 06:00 UTC (`AUDIT=1`, `force_audit`). Araştırmacı:
  `bot/research/` — Pazar 06:00 UTC + acil (kuyruk `docs/agent/research-queue.json`, rapor `research.json`).
- Backtest: `backtest/engine.js` (simulateTrade: limit/piyasa, half_be/single/trail, knifeGuard, timeStop, tp1Portion),
  `backtest/run.mjs` (tam koşu → plans.json.gz), `backtest/sweep.mjs` (varyant taraması, hedefli birleşimler,
  hedge'li R, `--variants/--only`), `backtest/lab/` (strateji aileleri: strategies.js, corrections.js, diagonal.js,
  smc.js, xsmom.js; `run.mjs` rapor/kabul). Sayfalar `backtest.html`, `sweep.html`, `lab.html`.
- Workflow'lar: `.github/workflows/scan.yml` (15 dk cron; env = Variables), `backtest.yml` (elle; Pazar cron research).
- Eğitim: `docs/egitim/` (SMC/price action, arkadaşın yöntemi, örnekler, ölçüm notları).

## Canlı ayar (24.10.2026'dan beri; DURUM.md günceldir)
`KNIFE_GUARD=1 LIMIT_ONLY=1 SKIP_WEEKEND=1 EARLY_TP={"pct":1.2,"portion":0.8,"tfs":["4H"]}
TF_RULES={"15m":{"off":true},"1H":{"off":true}} HTF_TREND=with AUDIT=1 MOMENTUM=1 MOMENTUM_VARIANT=short
MOMENTUM_RANK=rel MOMENTUM_HEDGE=1`. Yani yalnız 4H sinyalleri; beklenti (12 ay tarama) 4H doğr. +0,08R, kazanma ~%79,
hedge'li +0,08R; ayda ~25 sinyal.

## Kısa bulgu özeti (ayrıntı DURUM.md)
Fiyat-yapı aileleri (motor, Donchian, meanrev, sweep, diyagonal, zigzag/flat, fib kesişimi, SMC süpürme→MSS→FVG) sıkı
ölçütte kenar vermedi; kazanç BTC yönünden (r 0,4–0,7). Çalışan tek kesit: 4H + düşen bıçak koruması + hafta sonu yok +
yalnız limit + erken %80 kâr + günlük trend aynı yön (hedge'li doğr. +0,08R, n 293) — zayıf ama iki dilimde pozitif;
ileriye dönük kâğıt test sürüyor. Zaman stopu ve seans filtreleri işe yaramadı; hafta sonu kötü. Momentum
`xsmom_l28_k5_short_rel` hedge'li zayıf pozitif, canlı.
