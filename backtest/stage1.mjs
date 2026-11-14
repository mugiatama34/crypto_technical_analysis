#!/usr/bin/env node
// Aşama 1 (13.11; tanımlar docs/arastirma/on-kayit.md "Aşama 1 — kesin tanımlar", bağlayıcı). Taban: aşama 0 ile aynı satır ("3 kademe
// + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H"; canlı 4H evreni, gerçekçi: fillBarTp 'lower', bıçak 'touch', missTp).
// H1 (BTC'ye göre 28 günlük güç, üçte bir) · H4 (yön başına açık plan ≤ N, N = 3 / 5) · H5 (komisyon modeli a / b) · ikincil H1 ∧ H4(5).
//   node backtest/stage1.mjs --in backtest/stage1-data [--out docs/backtest] [--cache backtest/cache] [--lock 0|1] [--fixture]
//   --lock 0 (varsayılan): kasa (kilitli dilim) HİÇ hesaplanmaz / yazılmaz / loglanmaz; yalnız geliştirme + sağlamlık denetimi.
//   --lock 1: kasa dahil tam rapor (tek bakış).
// Çıktı: docs/backtest/stage1.json + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { simulateTrade } from './engine.js';
import { stats, MIN_N } from './report.js';
import { loadSeries, loadHtf, optsOf, rebuild, passes, capLists, merge, hedgeOf } from './sweep.mjs';
import { loadPlans } from './plans.js';
import { getHistoryCached } from './data.js';
import { barsFor } from '../src/scan/scanner.js';
import { TIMEFRAMES } from '../src/data/okx.js';
import { ROW_NAME } from './diag.mjs';
import { slicesOf, sliceOf, rankAt, resolveEndOf, analyze, COST_A, COST_B, CAP_NS, LOOKBACK, MIN_RANK_COINS, SPLIT_DEFAULT, SLICE_DAYS } from './stage1.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'backtest/stage1-data')), OUT = String(arg('out', 'docs/backtest')), CACHE = String(arg('cache', 'backtest/cache'));
const FIXTURE = arg('fixture', false) === true, LOCK = String(arg('lock', '0')) === '1';
const SPLIT = arg('split', null) ? Date.parse(String(arg('split'))) : SPLIT_DEFAULT;
const STAGE0 = String(arg('stage0', 'docs/backtest/results.json')); // aşama 0 plan koşusunun meta'sı (sağlamlık penceresi; yalnız okunur)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TF = '4H', LOWER = '1H', MS = TIMEFRAMES[TF].ms;
const SL = LOCK ? ['train', 'valid', 'kasa'] : ['train', 'valid'];

/**
 * Aşama 1 evreni (taban satır işlemleri): plan seti → canlı 4H seçimi (sweep passes) → simulateTrade maliyet (a) / (b). slices: dahil
 * edilecek dilimler ('train' | 'valid' | 'kasa'); 'kasa' varsa planlar kasa başından, yoksa geliştirme başından okunur. Davranış
 * stage1 main ile aynı (rejim haritası da bunu kullanır: backtest/regime-map.mjs).
 */
export async function stage1Universe({ inDir = IN, cache = CACHE, fixture = FIXTURE, slices = SL, split = SPLIT, log: lg = log } = {}) {
  const withKasa = slices.includes('kasa');
  const { all: all0, meta } = loadPlans(inDir);
  const S = slicesOf(meta.endMs, split);
  // lock 0: kasa planları hiç okunmaz (geliştirme diliminden önceki her şey atılır); lock 1: kasa başından önceki (ısınma) atılır
  const from = withKasa ? S.kasa.from : S.dev.from;
  const all = all0.filter((t) => t.tf === TF && t.time >= from && t.time <= S.dev.to);
  const times = all.map((t) => t.time).sort((a, b) => a - b);
  lg(`Plan (4H, ${withKasa ? 'kasa + geliştirme' : 'geliştirme'}): ${all.length}; geliştirme ${iso(S.dev.from)} → ${iso(S.dev.to)}, bölünme ${iso(S.dev.split)}${withKasa ? `; kasa ${iso(S.kasa.from)} → ${iso(S.kasa.to)}` : ''}`);
  const v = capLists().map(merge).find((x) => x.name.endsWith(ROW_NAME));
  if (!v) throw new Error(`sweep satırı bulunamadı: ${ROW_NAME}`);

  // Seriler: evren = plan koşusunun coinleri (bugünün ilk N'i) ∪ BTC. 4H: plan koşusunun aralığı; 1H: yalnız dolum mumu sırası için,
  // hesaplanan dilimlerin aralığı (önbellekte yoksa indirilir).
  const coins = [...new Set([...(meta.coins || []), ...all.map((t) => t.coin), 'BTC'])];
  const series = new Map(), s4 = new Map();
  for (const c of coins) {
    const inst = `${c}-USDT-SWAP`;
    if (!fixture) {
      try { await getHistoryCached(inst, TF, meta.startMs, meta.endMs, { cacheDir: cache }); } catch (e) { lg(`  ${c} ${TF}: veri hatası ${e.message}`); }
      try { await getHistoryCached(inst, LOWER, from - 2 * 86400e3, meta.endMs, { cacheDir: cache }); } catch (e) { lg(`  ${c} ${LOWER}: veri hatası ${e.message}`); }
    }
    for (const tf of [TF, LOWER]) { const s = await loadSeries(c, tf, inst); if (s) series.set(`${c}|${tf}`, s); }
    const s = series.get(`${c}|${TF}`); if (s) s4.set(c, s);
  }
  lg(`4H seri ${s4.size} / ${coins.length} coin, 1H ${[...series.keys()].filter((k) => k.endsWith(`|${LOWER}`)).length}`);
  const htf = await loadHtf(all, times, series);
  const btc4h = s4.get('BTC')?.candles || null;

  // Evren (taban): canlı 4H seçimi (sweep passes, aşama 0 ile aynı)
  const oA = { ...optsOf(v, meta), ...COST_A }, oB = { ...optsOf(v, meta), ...COST_B };
  const rows = [];
  let noSeries = 0;
  for (const t of all) {
    const s = series.get(`${t.coin}|${TF}`);
    if (!s || s.idx.get(t.time) == null) { noSeries++; continue; }
    if (!passes(t, v, s, new Map(), htf)) continue;
    const slice = sliceOf(t.time, S);
    if (!slice || !slices.includes(slice)) continue;
    const cs = s.candles, i = s.idx.get(t.time), lower = series.get(`${t.coin}|${LOWER}`)?.candles || null;
    const plan = rebuild(t.plan, v);
    const a = simulateTrade(plan, cs, i + 1, TF, { ...oA, lowerCandles: lower });
    const b = simulateTrade(plan, cs, i + 1, TF, { ...oB, lowerCandles: lower });
    const tr = (sim) => ({ time: t.time, tf: TF, d: plan.d, score: t.plan.score, outcome: sim.outcome, R: sim.R, waitBars: sim.waitBars, bars: sim.bars, tp1Bars: sim.tp1Bars ?? null, entryFill: sim.entryFill, stop: plan.stop, mfe: sim.mfe });
    const A = tr(a); if (a.entryFill) Object.assign(A, hedgeOf(A, btc4h, oA.feePct, oA.tp1Portion));
    const key = `${t.coin}|${t.time}|${plan.d}`;
    rows.push({ key, coin: t.coin, slice, d: plan.d, score: t.plan.score, decided: t.time + MS, end: resolveEndOf(plan, cs, i + 1, TF, oA, a), A, B: tr(b) });
  }
  lg(`Evren: ${rows.length} sinyal (${slices.map((k) => `${k} ${rows.filter((r) => r.slice === k).length}`).join(', ')}); 4H mumu olmayan plan ${noSeries}`);
  return { meta, S, from, all, coins, s4, oA, oB, rows, noSeries };
}

async function main() {
  const t0 = Date.now();
  const { meta, S, all, coins, s4, oA, rows, noSeries } = await stage1Universe();

  // H1: karar anında BTC'ye göre 28 günlük güç sırası (evren coinleri, BTC dışı, ≥ 168 mum geçmişi; < 10 coin → sıra yok)
  const rankCache = new Map();
  const rankOf = (r) => { const tm = r.decided - MS; if (!rankCache.has(tm)) rankCache.set(tm, rankAt(tm, s4)); const x = rankCache.get(tm); return x && x.ranks.has(r.coin) ? { pct: x.ranks.get(r.coin), m: x.m } : null; };
  const { rows: R, pass, h1Info, h1Slices, h4Info } = analyze(rows, { lock: LOCK, rankOf, rowName: ROW_NAME });

  // Sağlamlık denetimi (yalnız yazılır, karar kullanıcının): taban satır eğitim / doğrulama; ayrıca aşama 0 plan koşusunun 4H penceresinde
  // (ilk 4H planı = 4H kapsam başı + barsFor(4H) mum ısınma) — aşama 0'da 4H planları bu tarihten başlıyordu.
  const sanity = { expected: { train: { n: 520, avgR: -0.09 }, valid: { n: 516, avgR: 0.01 }, nTolerance: 0.05, source: 'on-kayit.md (aşama 0, diag.json)' }, devSlice: {}, stage0Window: null };
  const base = rows;
  for (const k of ['train', 'valid']) sanity.devSlice[k] = { n: R.base[k].n, signals: R.base[k].signals, avgR: R.base[k].avgR, nDiffPct: pctDiff(R.base[k].n, sanity.expected[k].n) };
  try {
    const m0 = JSON.parse(fs.readFileSync(STAGE0, 'utf8')).meta;
    const covFrom = Math.min(...Object.entries(m0.coverage || {}).filter(([k]) => k.endsWith(`|${TF}`)).map(([, c]) => c.from));
    const w = { from: covFrom + barsFor(TF) * MS, to: m0.to ?? m0.endMs, source: STAGE0 };
    if (Number.isFinite(w.from)) {
      sanity.stage0Window = { from: w.from, to: w.to, source: w.source };
      for (const k of ['train', 'valid']) {
        const x = base.filter((r) => r.slice === k && r.decided - MS >= w.from && r.decided - MS <= w.to), s = stats(x.map((r) => r.A));
        sanity.stage0Window[k] = { n: s.n, signals: x.length, avgR: s.n ? s.avgR : null, nDiffPct: pctDiff(s.n, sanity.expected[k].n) };
      }
    }
  } catch (e) { sanity.stage0WindowError = e.message; }

  // Coin sayıları (hayatta kalma yanlılığı: kasada verisi olan coin sayısı)
  const coinsOf = (lo, hi) => {
    const withData = [...s4.entries()].filter(([, s]) => s.candles.some((c) => c.time >= lo && c.time < hi));
    return { withData: withData.length, fullCoverage: withData.filter(([, s]) => s.candles[0].time <= lo + 86400e3).length, withSignals: new Set(rows.filter((r) => r.decided - MS >= lo && r.decided - MS < hi).map((r) => r.coin)).size };
  };
  const out = {
    meta: {
      stage1At: Date.now(), lock: LOCK ? 1 : 0, row: ROW_NAME, minN: MIN_N, fixture: FIXTURE,
      slices: { dev: S.dev, ...(LOCK ? { kasa: S.kasa } : {}), sliceDays: SLICE_DAYS, sliceBy: 'plan mumu zamanı (t.time), sweep ile aynı' },
      coins: { universe: coins.length, series4h: s4.size, dev: coinsOf(S.dev.from, S.dev.to + 1), ...(LOCK ? { kasa: coinsOf(S.kasa.from, S.kasa.to) } : {}) },
      planRun: { months: meta.months, top: meta.top, tfs: meta.tfs, mtfExtra: meta.mtfExtra, startMs: meta.startMs, endMs: meta.endMs, fee: meta.fee, slip: meta.slip, in: IN },
      params: { lookbackBars: LOOKBACK, minRankCoins: MIN_RANK_COINS, capNs: CAP_NS, costA: COST_A, costB: COST_B, opts: { fillBarTp: oA.fillBarTp, knifeBar: oA.knifeBar, expireHours: oA.expireHours, tp1Portion: oA.tp1Portion, midPortion: oA.midPortion, midStopToTp1: oA.midStopToTp1 } },
      counts: { plans4h: all.length, noSeries, universe: rows.length },
      defs: {
        h1: 'karar anı = plan mumu kapanışı; getiri = kapanış(i) / kapanış(i − 168) − 1 (4H); fark = coin − BTC; sıra = evren coinleri (BTC dışı, o mumu ve ≥ 168 mum geçmişi olan) arasında artan yüzdelik, eşitlerde ortalama konum: (küçük + (eşit − 1)/2) / (M − 1); M < 10 → sıra yok (elenir)',
        h4: 'zaman sırası (karar anı), aynı anda yüksek puan önce (eşitse coin|zaman); açık = alınmış ve sonuçlanmamış (bekleyen limit + açık pozisyon); dolan → çıkış mumu kapanışında, dolmayan → kaçtı / bıçak / süre sonu mumunun kapanışında düşer; iki ayrı akış: geliştirme (eğitim + doğrulama kesintisiz) ve kasa',
        h5: '(a) %0,05 / taraf + %0,05 kayma; (b) limit giriş ve limit hedefler %0,02, piyasa / teyit girişi ve stop / süre sonu %0,055, kayma %0,05 (engine feeMakerPct, pay bazında); geçme kararları (a) ile',
        worst7dR: 'dolan işlemler plan zamanına göre sıralı, 7 günlük kayan pencerede en kötü R toplamı (sweep stackOf)',
        hedged: 'sweep hedgeOf hedgedR (eski tanım; geçme ölçütü) · hedgedOpen bilgi amaçlı',
        pass: 'h1: dev = iki dilimde n ≥ 100, ort. R > 0, PF > 1,1; kasa = n ≥ 100, ort. R > 0, %90 GA alt ucu > −0,05, hedged ort. R ≥ 0. h4: her dilimde n ≥ 100, ort. R ≥ taban, en kötü 7 gün ve maks. düşüş ≥ %30 iyileşme (1 − |satır|/|taban|)',
      },
      elapsedSec: null,
    },
    sanity, rows: R, pass, h1Info, h1Slices, h4Info,
  };
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'stage1.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(OUT, 'stage1.json')}`);
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const pctDiff = (n, e) => (e ? +(((n - e) / e) * 100).toFixed(1) : null);
const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
function printTables(o) {
  const SLs = o.meta.lock ? ['train', 'valid', 'kasa'] : ['train', 'valid'];
  console.log(`\nAşama 1 · lock ${o.meta.lock} · * = n < 100 (sonuçsuz) · maliyet (a) = geçme kararı, (b) = Bybit yapıcı/alıcı`);
  console.log(`${'satır'.padEnd(8)} ${'dilim'.padEnd(6)} ${'n'.padStart(6)} ${'sinyal'.padStart(6)} ${'ort.R'.padStart(7)} ${'PF'.padStart(5)} %90 GA            ${'maxDD'.padStart(6)} ${'kötü7g'.padStart(7)} ${'hedged'.padStart(7)} ${'hOpen'.padStart(7)} ${'long'.padStart(13)} ${'short'.padStart(13)} ${'(b)'.padStart(7)}`);
  for (const [k, r] of Object.entries(o.rows)) for (const sp of SLs) {
    const c = r[sp];
    console.log(`${k.padEnd(8)} ${sp.padEnd(6)} ${f(c.n, 5)}${c.inconclusive ? '*' : ' '} ${f(c.signals, 6)} ${f(c.avgR)} ${f(c.profitFactor, 5)} ${ci(c.ci90).padEnd(18)} ${f(c.maxDD, 6)} ${f(c.worst7dR)} ${f(c.hedged.avgR)} ${f(c.hedgedOpen.avgR)} ${f(`${c.long.n}/${c.long.avgR ?? '—'}`, 13)} ${f(`${c.short.n}/${c.short.avgR ?? '—'}`, 13)} ${f(c.cost.b)}`);
  }
  console.log('\nGeçme (ön kayıt ölçütü):');
  console.log(`  H1: geliştirme ${o.pass.h1.dev}${o.meta.lock ? ` · kasa ${o.pass.h1.kasa} · genel ${o.pass.h1.pass}` : ''}`);
  for (const N of o.meta.params.capNs) { const p = o.pass[`h4_${N}`]; console.log(`  H4 N=${N}: ${SLs.map((sp) => `${sp} ${p[sp].pass} (ΔR ${p[sp].avgRvsBase}, kötü7g %${p[sp].worst7Impr != null ? Math.round(p[sp].worst7Impr * 100) : '—'}, maxDD %${p[sp].maxDDImpr != null ? Math.round(p[sp].maxDDImpr * 100) : '—'})`).join(' · ')}${o.meta.lock ? ` · genel ${p.pass}` : ''}`); }
  if (o.meta.lock) console.log(`  Geçen: ${o.pass.anyPassed.length ? o.pass.anyPassed.join(', ') : 'yok'}`);
  console.log('\nH1 bilgi: sinyal / BTC hariç / sıra yok / sıralı (coin aralığı) / kalan');
  for (const sp of SLs) { const x = o.h1Info[sp]; console.log(`  ${sp.padEnd(6)} ${x.signals} / ${x.btcExcluded} / ${x.noRank} / ${x.ranked} (${x.coinsRankedMin ?? '—'}–${x.coinsRankedMax ?? '—'}) / ${x.kept}`); }
  console.log('H1 dilimleri (n, ort. R, PF):');
  for (const b of ['aligned', 'middle', 'against']) console.log(`  ${b.padEnd(8)} ${SLs.map((sp) => { const c = o.h1Slices[b][sp]; return `${sp} n${c.n}${c.inconclusive ? '*' : ''} ${c.avgR ?? '—'}R PF ${c.profitFactor ?? '—'}`; }).join(' · ')}`);
  console.log('H4 atlanan sinyaller (sinyal, n, ort. R):');
  for (const N of o.meta.params.capNs) console.log(`  N=${N} ${SLs.map((sp) => { const x = o.h4Info.skipped[N][sp]; return `${sp} ${x.signals} / n${x.n}${x.inconclusive ? '*' : ''} ${x.avgR ?? '—'}R`; }).join(' · ')}`);
  console.log('Girişte aynı yönde açık plan (taban evren; n, ort. R):');
  for (const sp of SLs) console.log(`  ${sp.padEnd(6)} ${Object.entries(o.h4Info.openAtEntry[sp]).map(([b, x]) => `${b}: n${x.n}${x.inconclusive ? '*' : ''} ${x.avgR ?? '—'}R`).join(' · ')}`);
  const sn = o.sanity;
  console.log(`\nSağlamlık (beklenen eğitim n≈${sn.expected.train.n} ${sn.expected.train.avgR}R, doğrulama n≈${sn.expected.valid.n} ${sn.expected.valid.avgR}R):`);
  console.log(`  geliştirme dilimi: eğitim n${sn.devSlice.train.n} ${sn.devSlice.train.avgR}R (n farkı %${sn.devSlice.train.nDiffPct}) · doğrulama n${sn.devSlice.valid.n} ${sn.devSlice.valid.avgR}R (%${sn.devSlice.valid.nDiffPct})`);
  if (sn.stage0Window) console.log(`  aşama 0 penceresi (${iso(sn.stage0Window.from)} → ${iso(sn.stage0Window.to)}): eğitim n${sn.stage0Window.train.n} ${sn.stage0Window.train.avgR}R (%${sn.stage0Window.train.nDiffPct}) · doğrulama n${sn.stage0Window.valid.n} ${sn.stage0Window.valid.avgR}R (%${sn.stage0Window.valid.nDiffPct})`);
  const cn = o.meta.coins;
  console.log(`Coin: evren ${cn.universe}, 4H seri ${cn.series4h}; geliştirme veri ${cn.dev.withData} (tam ${cn.dev.fullCoverage}), sinyal ${cn.dev.withSignals}${cn.kasa ? `; kasa veri ${cn.kasa.withData} (tam ${cn.kasa.fullCoverage}), sinyal ${cn.kasa.withSignals}` : ''}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
