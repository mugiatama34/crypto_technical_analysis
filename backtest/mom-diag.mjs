#!/usr/bin/env node
// Kesitsel momentum aşama M0 teşhis (13.11.2026; tanımlar docs/arastirma/on-kayit-momentum.md M0a–M0d, bağlayıcı).
// YALNIZ geliştirme dilimi (24.11.2024 → bugün). Kasa-M (24.11.2022 → 24.11.2024) için yalnız veri VARLIĞI sayılır: mumlar
// indirildikten hemen sonra kasa kısmı zaman damgalarına indirgenir (fiyat atılır); getiri hesaplanmaz / yazılmaz / loglanmaz.
//   node backtest/mom-diag.mjs [--out docs/backtest] [--cache backtest/cache] [--live docs/agent/momentum.json] [--pool 150]
//                              [--fundingDays 100] [--draws 1000] [--fixture]
// Çıktı: docs/backtest/mom-diag.json (meta, m0a, m0b, m0c, m0d) + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf, okxGet } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { runAll, parseFundingRows, lockedLeaks, DEV_START, LOCK_START, DAY, LIVE_VARIANT } from './mom-diag.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), live: String(arg('live', 'docs/agent/momentum.json')), pool: +arg('pool', 150), fundingDays: +arg('fundingDays', 100), draws: +arg('draws', 1000), fixture: arg('fixture', false) === true };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/**
 * Fonlama geçmişi: GET /api/v5/public/funding-rate-history?instId&limit=100&after=<fundingTime> (daha eskiler). OKX yalnız
 * ~3 ay verir. Boş / hatalı yanıt → null (M0c "veri yok"); betik çökmez.
 */
export async function fetchFunding(instId, sinceMs) {
  const all = [];
  let after = null;
  for (let page = 0; page < 12; page++) {
    let data;
    try { data = await okxGet('/api/v5/public/funding-rate-history', { instId, limit: 100, after }, { lane: 'other' }); } catch (e) { if (!all.length) throw e; break; }
    if (!Array.isArray(data) || !data.length) break;
    all.push(...data);
    const times = data.map((x) => Number(x?.fundingTime)).filter(Number.isFinite);
    if (!times.length) break;
    const oldest = Math.min(...times);
    if (oldest <= sinceMs || data.length < 100 || String(oldest) === String(after)) break;
    after = oldest;
  }
  const rows = parseFundingRows(all);
  return rows.length ? rows : null;
}

async function main() {
  const t0 = Date.now();
  let provider = null, now = Date.now();
  if (CFG.fixture) { ({ fixtureProvider: provider } = await import('../src/data/fixture.js')); now = Date.UTC(2026, 9, 1); }
  let live = null;
  try { live = JSON.parse(fs.readFileSync(CFG.live, 'utf8')); } catch (e) { log(`canlı durum okunamadı (${CFG.live}): ${e.message}`); }
  const livePool = live?.params?.universe || 80;
  const coins = CFG.fixture ? await provider.topCoins(Math.max(CFG.pool, livePool)) : await getTopCoins(Math.max(CFG.pool, livePool), {});
  if (!coins.some((c) => c.coin === 'BTC')) coins.push({ coin: 'BTC', instId: instIdOf('BTC') });
  log(`Havuz: ${coins.length} coin (M0b–d ilk ${CFG.pool}, M0a ilk ${livePool}); kasa için yalnız veri varlığı`);
  // 1D mumlar: kasa başı − 60 gün → bugün. Kasa kısmı hemen zaman damgasına indirgenir.
  const from = LOCK_START - 60 * DAY;
  const series = [], lockedTimes = new Map();
  let k = 0;
  for (const c of coins) {
    let cs = [];
    try {
      cs = CFG.fixture ? (await provider.candles(c.instId, '1D', Math.ceil((now - from) / DAY))).candles : await getHistoryCached(c.instId, '1D', from, now, { cacheDir: CFG.cacheDir });
    } catch (e) { log(`  ${c.coin} 1D: ${e.message}`); }
    lockedTimes.set(c.coin, cs.filter((x) => x.time < DEV_START).map((x) => x.time));
    const dev = cs.filter((x) => x.time >= DEV_START);
    if (dev.length >= 2) series.push({ coin: c.coin, candles: dev });
    if (++k % 25 === 0) log(`  ${k}/${coins.length} coin`);
  }
  log(`1D seri (geliştirme): ${series.length} coin`);
  // M0a: canlı dönem BTC 1H (hedge fiyatları); ayrı önbellek klasörü (diğer modların 1H önbelleğinin aralığını bozmamak için)
  let btcHourly = null;
  if (live?.start && !CFG.fixture) {
    try { btcHourly = await getHistoryCached(instIdOf('BTC'), '1H', Math.floor(live.start / DAY) * DAY - DAY, now, { cacheDir: path.join(CFG.cacheDir, 'momdiag') }); log(`BTC 1H: ${btcHourly.length} mum`); } catch (e) { log(`BTC 1H: ${e.message}`); }
  }
  // M0a yeniden oynatma: canlı coinler (işlemler, pozisyonlar, dengeleme listeleri) + BTC — 15m (canlı başı − 1 gün → bugün) ve 1D (− 100 gün)
  let replay = null;
  if (live?.start && !CFG.fixture) {
    const rc = new Set(['BTC', ...(live.trades || []).map((q) => q.coin), ...(live.positions || []).map((q) => q.coin), ...(live.rebalances || []).flatMap((r) => [...(r.shorts || []), ...(r.longs || [])])]);
    const m15 = new Map(), d1 = new Map(), dir = path.join(CFG.cacheDir, 'momdiag'), d0 = Math.floor(live.start / DAY) * DAY;
    for (const c of rc) {
      try { m15.set(c, await getHistoryCached(instIdOf(c), '15m', d0 - DAY, now, { cacheDir: dir })); } catch (e) { log(`  replay ${c} 15m: ${e.message}`); }
      try { d1.set(c, await getHistoryCached(instIdOf(c), '1D', d0 - 100 * DAY, now, { cacheDir: dir })); } catch (e) { log(`  replay ${c} 1D: ${e.message}`); }
    }
    replay = { m15, d1 };
    log(`Replay verisi: ${m15.size} coin 15m, ${d1.size} coin 1D`);
  }
  // Fonlama: önce fonlamasız koşu ile taban short coinlerini bul (son fundingDays gün), canlı coinler + BTC eklenir
  const funding = new Map();
  if (!CFG.fixture) {
    const { XS_STRATEGIES } = await import('./lab/xsmom.js');
    const st = XS_STRATEGIES.find((s) => s.id === LIVE_VARIANT);
    const btcDaily = series.find((s) => s.coin === 'BTC')?.candles || null;
    const base = st.run(series.slice(0, CFG.pool).map((s) => ({ coin: s.coin, candles: s.candles })), { feePct: 0.05, slipPct: 0.05, fundingPct8h: 0.01 }, { btcDaily, startMs: DEV_START, pitN: live?.params?.pitN || 50 });
    const since = now - CFG.fundingDays * DAY;
    const want = new Set(base.filter((t) => t.direction === 'short' && t.exitTime >= since).map((t) => t.coin));
    for (const q of [...(live?.trades || []), ...(live?.positions || [])]) want.add(q.coin);
    want.add('BTC');
    log(`Fonlama geçmişi: ${want.size} coin`);
    let errs = 0;
    for (const coin of want) {
      try { funding.set(coin, await fetchFunding(instIdOf(coin), since)); } catch (e) { funding.set(coin, null); if (errs++ < 5) log(`  fonlama ${coin}: ${e.message}`); }
    }
    log(`  verisi olan: ${[...funding.values()].filter(Boolean).length} / ${want.size}`);
  }
  const out = runAll({ series, lockedTimes, live, btcHourly, funding, replay, now, pool: CFG.pool, draws: CFG.draws, meta: { fixture: CFG.fixture, coinsFetched: coins.length, fundingDays: CFG.fundingDays, fundingEndpoint: '/api/v5/public/funding-rate-history (realizedRate, yoksa fundingRate; fundingTime)' } });
  const leaks = lockedLeaks(out);
  if (leaks.length) throw new Error(`kasa dönemine ait alan çıktıda: ${leaks.slice(0, 5).join(', ')}`);
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'mom-diag.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'mom-diag.json')}`);
}

const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
const d10 = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '—');
function printTables(o) {
  const A = o.meta.lockedAvailability;
  console.log(`\nKasa-M veri varlığı (yalnız sayım): ${A.rebalances} dengeleme, uygun coin min/ortanca/maks ${A.eligibleMin}/${A.eligibleMedian}/${A.eligibleMax}, < ${A.minCoins}: ${A.below} hafta, ilk ≥ ${A.minCoins}: ${A.firstDateAtLeast ?? '—'}`);
  console.log(`\nM0d · geliştirme dilimi (bölünme ${d10(o.meta.split)}), haftalık % (eşit nominal), havuz ${o.meta.pool}`);
  console.log(`${'varyant'.padEnd(26)} ${'dilim'.padEnd(6)} ${'hafta'.padStart(5)} ${'ort%'.padStart(7)} %90 GA            ${'Sharpe'.padStart(6)} ${'düşüş%'.padStart(7)} ${'işlem'.padStart(5)} ${'ort R'.padStart(7)}`);
  for (const [id, v] of Object.entries(o.m0d.variants)) for (const sp of ['train', 'valid']) {
    const x = v[sp]; if (!x) { console.log(`${id.padEnd(26)} ${sp.padEnd(6)} işlem yok`); continue; }
    const row = (lab, w, t) => console.log(`${lab.padEnd(26)} ${sp.padEnd(6)} ${f(w.weeks, 5)} ${f(w.meanPct)} ${ci(w.ci90).padEnd(18)} ${f(w.sharpe, 6)} ${f(w.maxDDPct)} ${f(t.n, 5)} ${f(t.avgR)}`);
    row(id, x.weekly, x.trades);
    if (x.hedgedWeekly) row(`  └ hedge'li`, x.hedgedWeekly, x.hedgedTrades);
  }
  const b = o.m0b;
  console.log(`\nM0b · sıralamada bilgi (hafta ${b.weeksUsed}/${b.weeksTotal}); dilim farkı % (sonraki 7 gün − evren), q1 en zayıf`);
  for (const sp of ['train', 'valid']) {
    const x = b[sp];
    console.log(`${sp.padEnd(6)} hafta ${x.weeks} | ${x.quintiles.map((q, i) => `q${i + 1} ${q.meanPct} ${ci(q.ci90)}`).join(' · ')} | tekdüze ${x.monotonic} (ρ ${x.spearman})`);
    console.log(`${''.padEnd(6)} zayıf-5 ${x.weak5.meanPct} ${ci(x.weak5.ci90)} | plasebo ort ${x.placebo?.meanPct} [p5 ${x.placebo?.p5}, p95 ${x.placebo?.p95}], zayıf-5 yüzdeliği %${x.placebo?.percentile} | kural ${x.infoRule}`);
  }
  console.log(`  verdict: ${b.verdict}`);
  const c = o.m0c;
  console.log(`\nM0c · fonlama: ${c.available ? `işlem ${c.tradesInWindow}, ${c.positionDays} pozisyon-günü, gerçek maliyet %${c.costPct8h}/8s (short işaretli) ↔ varsayılan %${c.assumedPct8h} → oran ${c.ratio}; negatif oran payı ${c.negativeShare}; aralıklar ${JSON.stringify(c.intervalsH)}` : 'veri yok'} (verisi olan coin ${c.coinsWithData}/${c.coinsRequested})`);
  console.log(`  verdict: ${c.verdict}`);
  const a = o.m0a;
  console.log(`\nM0a · canlı ↔ backtest: ${a.available ? '' : `(${a.reason})`}`);
  if (a.selections) {
    for (const s of a.selections) console.log(`  ${d10(s.time)} karar ${d10(s.decisionDay)} | canlı ${s.live.join(',')} | bt ${s.bt ? s.bt.join(',') : '—'} | ortak ${s.common.length}`);
    for (const r of a.trades.rows) console.log(`  ${r.coin.padEnd(8)} ${d10(r.entryDay)} canlı ${r.live.entry}→${r.live.exit} %${r.live.pct} (${r.live.reason}) | bt ${r.bt.entry}→${r.bt.exit} %${r.bt.pct} (${r.bt.outcome}) | giriş farkı %${r.diff.entryPct} risk ${r.live.riskPct}/${r.bt.riskPct}`);
    console.log(`  yalnız canlı: ${a.trades.onlyLive.map((x) => `${x.coin} ${d10(x.entryDay)}`).join(', ') || '—'} | yalnız bt: ${a.trades.onlyBt.map((x) => `${x.coin} ${d10(x.entryDay)}`).join(', ') || '—'}`);
    const D = a.decomposition;
    console.log(`  ayrışma (USDT): toplam ${D.totalUsd} (%${D.totalPct}) = short brüt ${D.components.shortsGross} + hedge brüt (tahmin) ${D.components.hedgeGrossEst} + komisyon ${D.components.fees} + fonlama ${D.components.funding} + açıklanamayan ${D.components.unexplained}; kayma (fiyatlarda, tahmin) ${D.slippageEstUsd}`);
    console.log(`  kimlik: kapanan short ${D.identity.shortsClosedNet} + açık short ${D.identity.shortsOpenNet} + açık hedge ${D.identity.hedgeOpenNet} + yeniden boyutlama gerçekleşeni ${D.identity.resizeRealized} (fark ${D.identity.check})`);
    const P = a.replay;
    if (P?.available) {
      const it = P.items;
      console.log(`  REPLAY (${P.steps} adım): replay ${P.equity.replay} ↔ canlı ${P.equity.live} USDT | short kapanan ${it.shortClosedNet} (stop ${it.shortStopped.n}: ${it.shortStopped.usd}) açık ${it.shortOpenNet} yeniden boyut ${it.shortResize.n}: ${it.shortResize.realizedUsd} | hedge açık ${it.hedgeOpenNet} kapanan ${it.hedgeClosed.usd} ayar ${it.hedgeResize.n}: ${it.hedgeResize.realizedUsd} | komisyon ${it.feesUsd} fonlama ${it.fundingUsd} | muhasebe ${P.accountingCheck}`);
      console.log(`  karşı-olgusal: hedge ayarı yok ${P.counterfactuals.noHedgeResize.equity} (${P.counterfactuals.noHedgeResize.diffVsBase}) · haftalık yeniden boyut yok ${P.counterfactuals.noWeeklyResize.equity} (${P.counterfactuals.noWeeklyResize.diffVsBase}) | seçim uyuşmazlığı ${P.selectionMismatches.length}`);
      for (const x of P.curve.top10) console.log(`    sapma ${new Date(x.time).toISOString().slice(0, 16)} canlı ${x.live} replay ${x.replay} fark ${x.diff}`);
      for (const x of P.liveJumpsTop10) console.log(`    canlı sıçrama ${new Date(x.from).toISOString().slice(5, 16)}→${new Date(x.to).toISOString().slice(11, 16)} ${x.liveUsd} | replay ${x.replayUsd} (en çok ${x.replayTop?.key} ${x.replayTop?.usd})`);
      for (const x of P.topHourly) console.log(`    saatlik ${new Date(x.from).toISOString().slice(5, 16)} ${x.key} ${x.usd} USDT (fiyat %${x.pricePct})`);
      console.log(`  bulgu: ${P.finding}`);
    } else if (P) console.log(`  replay: ${P.reason}`);
    for (const w of a.weekly) console.log(`  ${d10(w.from)} → ${d10(w.to)}: canlı %${w.livePct} | bt %${w.btPct} (hedge'li %${w.btHedgedPct}, ${w.btWeeks} hafta)`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
