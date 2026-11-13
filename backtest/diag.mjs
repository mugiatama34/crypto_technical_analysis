#!/usr/bin/env node
// Aşama 0 teşhis (13.11; tanımlar docs/arastirma/on-kayit.md D1–D4, bağlayıcı). Evren: canlı 4H seçimi (bıçak koruması, hafta sonu
// hariç, yalnız limit, yalnız 4H, üst TF eğilimi aynı yön) — sweep'teki "3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 ·
// sıra 1H" satırı (gerçekçi: fillBarTp 'lower', bıçak kararı 'touch', missTp = özgün TP1, maliyet dahil).
//   node backtest/diag.mjs [--in docs/backtest] [--out docs/backtest] [--cache backtest/cache] [--fixture]
// Çıktı: docs/backtest/diag.json (meta, d1, d2, d3, d4; her birinde train/valid × all/long/short) + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { simulateTrade } from './engine.js';
import { statsCi, stats, MIN_N, CI_DEFAULTS, weekpartOf, mulberry32 } from './report.js';
import { loadSeries, loadHtf, optsOf, rebuild, passes, capLists, merge } from './sweep.mjs';
import { loadPlans } from './plans.js';
import { TIMEFRAMES } from '../src/data/okx.js';
import { UP_TF } from '../src/scan/regime.js';
import { trendMatch, HORIZONS, DAY, atrSeries, forwardOf, seedOf, sampleK, placeboACandidates, d1Cell, d1Verdict, marketPlanOf, halfHalfR, postStopOf, tp1BeforeStop, quantiles, costOf, stopBucket, STOP_BUCKETS, splitDir } from './diag.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), OUT = String(arg('out', 'docs/backtest'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TF = '4H', LOWER = '1H', MS = TIMEFRAMES[TF].ms, K = 20, WIN_DAYS = 30;
export const ROW_NAME = '3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H';
const UNFILLED = new Set(['missed', 'expired', 'knife']);

async function main() {
  const t0 = Date.now();
  const { all, meta, times, split } = loadPlans(IN);
  const plans4h = all.filter((t) => t.tf === TF);
  log(`Plan: ${all.length} (4H ${plans4h.length}); bölünme ${new Date(split).toISOString().slice(0, 10)}`);
  const v = capLists().map(merge).find((x) => x.name.endsWith(ROW_NAME));
  if (!v) throw new Error(`sweep satırı bulunamadı: ${ROW_NAME}`);
  // Seriler: evren (plasebo B) = plan dosyasındaki coin'ler ∪ meta.coins; 4H + 1H (alt TF sırası)
  const coins = [...new Set([...(meta.coins || []), ...all.map((t) => t.coin)])];
  const series = new Map();
  for (const c of coins) for (const tf of [TF, LOWER]) { const s = await loadSeries(c, tf, `${c}-USDT-SWAP`); if (s) series.set(`${c}|${tf}`, s); }
  const atrs = new Map([...series].filter(([k]) => k.endsWith(`|${TF}`)).map(([k, s]) => [k.split('|')[0], atrSeries(s.candles)]));
  log(`4H seri ${atrs.size} / ${coins.length} coin`);
  const htf = await loadHtf(plans4h, times, series);

  // Evren: canlı 4H seçimi (passes = sweep ile aynı filtre zinciri)
  const uni = [];
  for (const t of plans4h) { const s = series.get(`${t.coin}|${TF}`); if (s && passes(t, v, s, new Map(), htf)) uni.push(t); }
  log(`Evren: ${uni.length} sinyal (eğitim ${uni.filter((t) => t.time < split).length})`);

  const oNet = optsOf(v, meta), oGross = { ...oNet, feePct: 0, slipPct: 0 };
  const rows = [];
  for (const t of uni) {
    const s = series.get(`${t.coin}|${TF}`), cs = s.candles, i = s.idx.get(t.time), lower = series.get(`${t.coin}|${LOWER}`)?.candles || null;
    const plan = rebuild(t.plan, v), d = plan.d;
    const lim = simulateTrade(plan, cs, i + 1, TF, { ...oNet, lowerCandles: lower });
    const gross = simulateTrade(plan, cs, i + 1, TF, { ...oGross, lowerCandles: lower });
    const mkt = i + 1 < cs.length ? simulateTrade(marketPlanOf(plan, cs[i + 1].open, oNet.slipPct), cs, i + 1, TF, { ...oNet, lowerCandles: lower }) : { outcome: 'expired', R: 0 };
    rows.push({ t, cs, i, lower, plan, d, lim, gross, mkt });
  }

  // ---- D1 giriş kalitesi
  const d1Rows = { AT: Object.fromEntries(HORIZONS.map((N) => [N, []])), A: Object.fromEntries(HORIZONS.map((N) => [N, []])), B: Object.fromEntries(HORIZONS.map((N) => [N, []])) };
  const dropped = Object.fromEntries(HORIZONS.map((N) => [N, { signal: 0, drawsA: 0, drawsB: 0, noPlaceboA: 0, noPlaceboB: 0, drawsAT: 0, noPlaceboAT: 0 }]));
  let noCandAT = 0; // A-eğilim: eğilimi eşleşen aday hiç yok → sinyal bu plasebodan düşer
  const weekday = (cs) => (j) => weekpartOf(cs[j].time + MS) !== 'hafta sonu';
  for (const r of rows) {
    const { t, cs, i, d } = r, atrs0 = atrs.get(t.coin);
    const day = i + 1 < cs.length ? Math.floor(cs[i + 1].time / DAY) : null;
    // Plasebo A: aynı coin, ±30 gün, karar anı hafta içi (evrenle aynı), ATR(14) > 0; K = 20, yerine koymadan
    const candA = placeboACandidates(cs, i, { days: WIN_DAYS, ok: (j) => weekday(cs)(j) && atrs0[j] > 0 });
    const pickA = sampleK(candA, K, mulberry32(seedOf(`${t.coin}|${t.time}|A`)));
    // Plasebo A-eğilim (bilgi amaçlı): A'nın adayları + karar anında üst TF eğilimi sinyal yönünde (evren filtresiyle aynı kural); ayrı tohum akışı
    const hT = htf.get(`${t.coin}|${UP_TF[TF]}`);
    const candAT = candA.filter((j) => trendMatch(hT, cs[j].time + MS, d, v.htfTrend));
    const pickAT = sampleK(candAT, K, mulberry32(seedOf(`${t.coin}|${t.time}|AT`)));
    if (!candAT.length) noCandAT++;
    // Plasebo B: aynı mum zamanı, başka coin (4H serisinde aynı mum ve ATR var); K'ya kadar
    const others = [...atrs.keys()].filter((c) => c !== t.coin).map((c) => ({ c, s: series.get(`${c}|${TF}`) })).map((x) => ({ ...x, j: x.s.idx.get(t.time) })).filter((x) => x.j != null && atrs.get(x.c)[x.j] > 0).sort((a, b) => (a.c < b.c ? -1 : 1));
    const pickB = sampleK(others, K, mulberry32(seedOf(`${t.coin}|${t.time}|B`)));
    for (const N of HORIZONS) {
      const sig = forwardOf(cs, i + 1, d, t.plan.atr, N);
      if (!sig) { dropped[N].signal++; continue; }
      const pa = pickA.map((j) => forwardOf(cs, j + 1, d, atrs0[j], N));
      const pb = pickB.map((x) => forwardOf(x.s.candles, x.j + 1, d, atrs.get(x.c)[x.j], N));
      dropped[N].drawsA += pa.filter((x) => !x).length; dropped[N].drawsB += pb.filter((x) => !x).length;
      const A = pa.filter(Boolean), B = pb.filter(Boolean);
      const base = { time: t.time, d, day, sig };
      if (A.length) d1Rows.A[N].push({ ...base, pla: A }); else dropped[N].noPlaceboA++;
      if (B.length) d1Rows.B[N].push({ ...base, pla: B }); else dropped[N].noPlaceboB++;
      const pat = pickAT.map((j) => forwardOf(cs, j + 1, d, atrs0[j], N));
      dropped[N].drawsAT += pat.filter((x) => !x).length;
      const AT = pat.filter(Boolean);
      if (AT.length) d1Rows.AT[N].push({ ...base, pla: AT }); else dropped[N].noPlaceboAT++;
    }
  }
  const d1Of = (key) => {
    const bySplit = { train: { all: {}, long: {}, short: {} }, valid: { all: {}, long: {}, short: {} } };
    for (const N of HORIZONS) {
      const sd = splitDir(d1Rows[key][N], split, (a) => d1Cell(a));
      for (const sp of ['train', 'valid']) for (const g of ['all', 'long', 'short']) bySplit[sp][g][N] = sd[sp][g];
    }
    const verdict = Object.fromEntries(['all', 'long', 'short'].map((g) => [g, d1Verdict(bySplit.train[g], bySplit.valid[g])]));
    return { ...bySplit, verdict };
  };
  const d1 = {
    def: { horizonsBars: HORIZONS, unit: 'plan ATR (sinyal) / ATR(14) o mumda (plasebo)', entry: 'sinyal mumundan sonraki ilk açılış, kayma/komisyon yok, stop/hedef yok', K, placeboA: `aynı coin, sinyal mumunun ±${WIN_DAYS} günü (sinyal mumu hariç), karar anı hafta içi, aynı yön`, placeboATrend: 'bilgi amaçlı, verdict\'e girmez: plasebo A + karar anında üst TF eğilimi sinyal yönünde (evren filtresiyle aynı kural: htfOk(htfTrend, htfTrendAt)); ayrı tohum akışı (A örnekleri değişmez)', placeboB: 'aynı 4H mumu, evrendeki başka coin (o mumda 4H serisi ve ATR(14) olan), aynı yön, o coinin ATR(14)', ci: { method: 'giriş gününe (UTC) göre bloklu bootstrap, fark = sinyal − kendi plasebo ortalaması', reps: CI_DEFAULTS.reps, seed: CI_DEFAULTS.seed, level: 0.9 }, rule: 'bilgi var = en az bir ufukta fark (getiri) %90 aralığı alt ucu > 0, hem eğitim hem doğrulama' },
    dropped, noCandidateATrend: noCandAT, placeboA: d1Of('A'), placeboB: d1Of('B'), placeboATrend: { informational: true, ...d1Of('AT') },
  };
  d1.verdict = { placeboA: d1.placeboA.verdict.all.verdict, placeboB: d1.placeboB.verdict.all.verdict };

  // ---- D2 kaçanlar + giriş biçimi (tüm evren)
  const trade = (r, sim) => ({ time: r.t.time, tf: TF, d: r.d, ...sim });
  const pf = (s) => ({ n: s.n, avgR: s.n ? s.avgR : null, profitFactor: s.n ? s.profitFactor : null, winRate: s.n ? s.winRate : null, totalR: s.totalR, ...(s.ci90 !== undefined ? { ci90: s.ci90 } : {}), inconclusive: s.n < MIN_N });
  const d2Groups = (a) => Object.fromEntries(['missed', 'expired', 'knife'].map((g) => { const x = a.filter((r) => r.lim.outcome === g); return [g, { signals: x.length, market: pf(stats(x.map((r) => trade(r, r.mkt)))), marketInvalid: x.filter((r) => r.mkt.outcome === 'invalid' || r.mkt.outcome === 'expired').length }]; }));
  const perSig = (tr, nSig) => (nSig ? +(tr.reduce((s, x) => s + (stats([x]).n ? x.R : 0), 0) / nSig).toFixed(3) : null);
  const d2Rows = (a) => {
    const limT = a.map((r) => trade(r, r.lim)), mktT = a.map((r) => trade(r, r.mkt));
    const ok = a.filter((r) => r.mkt.entryFill);
    const mix = ok.map((r) => ({ time: r.t.time, tf: TF, d: r.d, outcome: r.mkt.outcome, waitBars: r.mkt.waitBars, R: halfHalfR(r.mkt.R, r.lim.R, !UNFILLED.has(r.lim.outcome) && r.lim.entryFill != null) }));
    return {
      signals: a.length,
      limitOnly: { ...pf(statsCi(limT)), perSignalR: perSig(limT, a.length) },
      allMarket: { ...pf(statsCi(mktT)), perSignalR: perSig(mktT, a.length) },
      halfHalf: { ...pf(statsCi(mix)), perSignalR: perSig(mix, a.length) },
    };
  };
  const d2 = {
    def: { row: ROW_NAME, market: 'sinyal sonrası ilk açılış + kayma; aynı stop, ara kademe ve TP2; erken hedef yeni girişe aynı % uzaklıkta; maliyet dahil', halfHalf: 'R = 0,5 × R_piyasa + 0,5 × R_limit (limit dolmadıysa 0); payda 1R tam risk; piyasa girişi geçersiz (stopun ötesi / veri yok) olan sinyal atılır', perSignalR: 'Σ R ÷ sinyal sayısı (dolmayan 0R)' },
    groups: splitDir(rows, split, d2Groups, (r) => r.t.time), universe: splitDir(rows, split, d2Rows, (r) => r.t.time),
  };

  // ---- D3 stop sonrası devam
  const d3Of = (a) => {
    const filled = a.filter((r) => r.lim.entryFill && !UNFILLED.has(r.lim.outcome) && r.lim.outcome !== 'invalid');
    const stopped = filled.filter((r) => r.lim.outcome === 'stopped' && r.lim.tp1Bars == null);
    const fillIOf = (r) => r.i + r.lim.waitBars;
    const out = { filled: filled.length, stopped: stopped.length, byN: {} };
    const base = (N) => { const x = filled.map((r) => tp1BeforeStop(r.cs, fillIOf(r), r.d, r.plan, { tp1: r.t.plan.tp1, stop: r.plan.stop }, N, { market: !!r.lim.confirmed, lower: r.lower, ms: MS, maxBars: oNet.maxHoldBars })).filter((y) => y != null); return { n: x.length, rate: x.length ? +(x.filter(Boolean).length / x.length).toFixed(3) : null }; };
    out.baseUnbounded = base(Infinity);
    for (const N of HORIZONS) {
      const ps = stopped.map((r) => postStopOf(r.cs, fillIOf(r) + r.lim.bars, r.d, { tp1: r.t.plan.tp1, entry: r.lim.entryFill, stop: r.plan.stop }, N)).filter(Boolean);
      const n = ps.length, b = base(N);
      const tp1Rate = n ? +(ps.filter((x) => x.tp1Hit).length / n).toFixed(3) : null;
      out.byN[N] = { n, dropped: stopped.length - n, tp1Rate, entryRate: n ? +(ps.filter((x) => x.entryHit).length / n).toFixed(3) : null, base: b, diffPts: tp1Rate != null && b.rate != null ? +((tp1Rate - b.rate) * 100).toFixed(1) : null,
        overshootR: { all: { n, ...quantiles(ps.map((x) => x.overshootR)) }, tp1Reached: { n: ps.filter((x) => x.tp1Hit).length, ...quantiles(ps.filter((x) => x.tp1Hit).map((x) => x.overshootR)) } }, inconclusive: n < MIN_N };
    }
    return out;
  };
  const d3s = splitDir(rows, split, d3Of, (r) => r.t.time);
  const d3Pass = (g) => HORIZONS.filter((N) => d3s.train[g].byN[N].diffPts >= 10 && d3s.valid[g].byN[N].diffPts >= 10);
  const d3 = {
    def: { row: ROW_NAME, stopped: 'erken hedef görmeden stop olan (outcome stopped)', postStop: 'stop mumundan SONRAKİ N mumda özgün TP1 (plan tp1) / girişe (dolum fiyatı) dokunma', overshoot: 'stop mumu dahil N mum içinde stop ötesi en büyük aşım, R (risk = giriş − stop)', base: 'tüm dolan işlemler: dolum mumundan N mum içinde özgün TP1 özgün stoptan önce (aynı mum → stop; dolum mumunda 1H sırası); baseUnbounded: 200 mum / seri sonu', rule: 'stop sonrası TP1 oranı − taban (aynı N) ≥ 10 puan, hem eğitim hem doğrulama, en az bir ufukta → H6 listeye girer' },
    ...d3s,
    verdict: Object.fromEntries(['all', 'long', 'short'].map((g) => [g, { verdict: d3Pass(g).length ? 'H6 listeye girer' : 'H6 girmez', horizonsPassed: d3Pass(g) }])),
  };

  // ---- D4 maliyet
  const d4Of = (a) => {
    const cell = (x) => {
      const net = stats(x.map((r) => trade(r, r.lim))), gr = stats(x.map((r) => trade(r, r.gross)));
      const both = x.filter((r) => stats([trade(r, r.lim)]).n && stats([trade(r, r.gross)]).n);
      const paired = both.length ? +(both.reduce((s, r) => s + (r.gross.R - r.lim.R), 0) / both.length).toFixed(3) : null;
      const g = gr.n ? gr.avgR : null, nt = net.n ? net.avgR : null;
      return { n: net.n, nGross: gr.n, gross: g, net: nt, cost: costOf(g, nt), pairedCost: paired, grossPF: gr.n ? gr.profitFactor : null, netPF: net.n ? net.profitFactor : null, inconclusive: net.n < MIN_N };
    };
    const pct = (r) => (Math.abs(r.plan.entry - r.plan.stop) / r.plan.entry) * 100;
    return { total: cell(a), byStopPct: Object.fromEntries(STOP_BUCKETS.map((b) => [b, cell(a.filter((r) => stopBucket(pct(r)) === b))])) };
  };
  const d4 = { def: { row: ROW_NAME, gross: 'komisyon = kayma = 0', net: `komisyon %${oNet.feePct} + kayma %${oNet.slipPct}`, cost: 'brüt ort. R − net ort. R; pairedCost: iki koşuda da dolan işlemlerde ort. (brüt − net)', stopPct: 'plan limit girişi ile stop arası, %' }, ...splitDir(rows, split, d4Of, (r) => r.t.time) };

  const out = { meta: { ...meta, diagAt: Date.now(), split, plans: all.length, universe: uni.length, row: ROW_NAME, minN: MIN_N, notes: { placeboATrend: 'bilgi amaçlı, verdict\'e girmez (d1.verdict yalnız plasebo A ve B)' }, elapsedSec: Math.round((Date.now() - t0) / 1000) }, d1, d2, d3, d4 };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'diag.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(OUT, 'diag.json')}`);
}

const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
const mark = (c) => (c.inconclusive ? '*' : ' ');
function printTables(o) {
  console.log('\n* = n < 100 (sonuçsuz)');
  for (const [k, lab] of [['placeboA', 'D1 · plasebo A (aynı coin, ±30 gün)'], ['placeboB', 'D1 · plasebo B (aynı an, başka coin)'], ['placeboATrend', 'D1 · plasebo A-eğilim (A + üst TF eğilimi aynı yön; bilgi amaçlı, verdict\'e girmez)']]) {
    console.log(`\n${lab} — getiri / MFE / MAE (ATR), N mum; fark = sinyal − plasebo`);
    console.log(`${'dilim'.padEnd(6)} ${'grup'.padEnd(5)} ${'N'.padStart(3)} ${'n'.padStart(6)}  ${'sinyal'.padStart(7)} ${'plasebo'.padStart(7)} ${'fark'.padStart(7)} %90 GA            ${'MFE s/p'.padStart(13)} ${'MAE s/p'.padStart(13)} ${'e s/p'.padStart(11)}`);
    for (const sp of ['train', 'valid']) for (const g of ['all', 'long', 'short']) for (const N of HORIZONS) {
      const c = o.d1[k][sp][g][N];
      console.log(`${sp.padEnd(6)} ${g.padEnd(5)} ${String(N).padStart(3)} ${f(c.n, 5)}${mark(c)}  ${f(c.signal.ret)} ${f(c.placebo.ret)} ${f(c.diff.ret)} ${ci(c.diff.retCi90).padEnd(18)} ${f(`${c.signal.mfe}/${c.placebo.mfe}`, 13)} ${f(`${c.signal.mae}/${c.placebo.mae}`, 13)} ${f(`${c.signal.eRatio}/${c.placebo.eRatio}`, 11)}`);
    }
    console.log(`  verdict: ${Object.entries(o.d1[k].verdict).map(([g, x]) => `${g} ${x.verdict}${x.horizonsPassed.length ? ` (${x.horizonsPassed.join(',')})` : ''}`).join(' · ')}`);
  }
  console.log(`\nD2 · kaçanlar piyasa girişiyle (n, ort. R, PF) | evren: yalnız limit / hepsi piyasa / yarı-yarı (ort. R işlem başı; sinyal başı)`);
  for (const sp of ['train', 'valid']) for (const g of ['all', 'long', 'short']) {
    const G = o.d2.groups[sp][g], U = o.d2.universe[sp][g];
    const gs = ['missed', 'expired', 'knife'].map((x) => `${x} ${G[x].market.n}${G[x].market.inconclusive ? '*' : ''} ${G[x].market.avgR}R PF ${G[x].market.profitFactor}`).join(' · ');
    const us = ['limitOnly', 'allMarket', 'halfHalf'].map((x) => `${x} n${U[x].n}${U[x].inconclusive ? '*' : ''} ${U[x].avgR}R (${U[x].perSignalR}/sinyal) PF ${U[x].profitFactor}`).join(' · ');
    console.log(`${sp.padEnd(6)} ${g.padEnd(5)} ${gs}\n${''.padEnd(12)} ${us}`);
  }
  console.log('\nD3 · stop sonrası (erken hedefsiz stop): N, n, TP1 oranı, girişe dönüş, taban, fark (puan), aşım R p50/p75/p90');
  for (const sp of ['train', 'valid']) for (const g of ['all', 'long', 'short']) for (const N of HORIZONS) {
    const c = o.d3[sp][g].byN[N], os = c.overshootR.all;
    console.log(`${sp.padEnd(6)} ${g.padEnd(5)} ${String(N).padStart(3)} ${f(c.n, 5)}${mark(c)} TP1 ${f(c.tp1Rate, 6)} giriş ${f(c.entryRate, 6)} taban ${f(c.base.rate, 6)} (n${c.base.n}) fark ${f(c.diffPts, 6)} aşım ${os.p50}/${os.p75}/${os.p90}`);
  }
  console.log(`  verdict: ${Object.entries(o.d3.verdict).map(([g, x]) => `${g} ${x.verdict}`).join(' · ')}`);
  console.log('\nD4 · maliyet: n, brüt, net, maliyet (R) — toplam ve stop mesafesi dilimleri');
  for (const sp of ['train', 'valid']) for (const g of ['all', 'long', 'short']) {
    const x = o.d4[sp][g], cells = [['toplam', x.total], ...Object.entries(x.byStopPct)];
    console.log(`${sp.padEnd(6)} ${g.padEnd(5)} ${cells.map(([b, c]) => `${b}: n${c.n}${c.inconclusive ? '*' : ''} ${c.gross}/${c.net} (${c.cost})`).join(' · ')}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
