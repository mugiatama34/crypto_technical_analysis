#!/usr/bin/env node
// Strateji laboratuvarı koşusu: her strateji × coin × TF → sinyaller simüle edilir (aynı coinde açık işlem varken yeni
// sinyal alınmaz) → eğitim/doğrulama raporu → docs/backtest/lab.json (lab.html okur).
//   node backtest/lab/run.mjs [--months 6 --top 50] [--universe 150] [--funding 0.01] [--strategies donchian,meanrev] [--tfs 4H] [--fee 0.05 --slip 0.05] [--fixture]
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../../src/data/okx.js';
import { getHistoryCached } from '../data.js';
import { simulateTrade, BT_DEFAULTS } from '../engine.js';
import { stats, sessionOf, weekpartOf, entryTimeOf } from '../report.js';
import { STRATEGIES, STRATEGY_MAP } from './strategies.js';
import { portfolioOf, benchmarks, slotsOf } from './xsmom.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { months: +arg('months', 6), top: +arg('top', 50), fee: +arg('fee', 0.05), slip: +arg('slip', 0.05), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true, coins: arg('coins', '') ? String(arg('coins')).split(',') : null, strategies: arg('strategies', '') ? String(arg('strategies')).split(',') : null, tfs: arg('tfs', '') ? String(arg('tfs')).split(',').map((t) => t.trim()).filter(Boolean) : null, universe: +arg('universe', 0), funding: +arg('funding', 0.01) };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'time_stop']);

/** Bir seri üzerinde strateji: sinyal → simülasyon; işlem sürerken yeni sinyal yok. */
export function runStrategy(strategy, { coin, tf, candles, extra }, o) {
  const pre = strategy.prepare(candles, tf, extra || {});
  const trades = [];
  let busyUntil = -1;
  for (let i = 50; i < candles.length - 1; i++) {
    if (i <= busyUntil) continue;
    const plan = strategy.signal(i, candles, pre);
    if (!plan) continue;
    const sim = simulateTrade(plan, candles, i + 1, tf, { ...o, ...strategy.exit });
    if (sim.outcome === 'invalid') continue;
    busyUntil = i + 1 + (sim.waitBars || 1) + (sim.bars || 0);
    trades.push({ coin, tf, direction: plan.direction, time: candles[i].time, entry: plan.entry, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, ...sim });
  }
  return trades;
}

/** Kabul: sıkı aday = eğitim ort. R > 0 VE doğrulama (n ≥ 100, ort. R > 0, PF > 1,1) VE en iyi ay hariç doğrulama
 *  ve eğitim ort. R > 0.
 *  zayıf = yalnız doğrulama ölçütü (n ≥ 50). */
export function acceptance(rep) {
  const v = rep.valid.n >= 100 && rep.valid.avgR > 0 && rep.valid.profitFactor > 1.1;
  // eğitimde de en iyi ay çıkarılınca pozitif kalmalı (ör. Kasım 2024 rallisi tek başına eğitimi taşımasın)
  const candidate = v && rep.train.avgR > 0 && rep.robust.avgR > 0 && (!rep.robustTrain || rep.robustTrain.avgR > 0);
  const weak = !candidate && rep.valid.n >= 50 && rep.valid.avgR > 0 && rep.valid.profitFactor > 1.1;
  return { candidate, weak };
}

const by = (trades, f, split) => { const m = new Map(); for (const t of trades) { const k = f(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return Object.fromEntries([...m.entries()].map(([k, v]) => [k, { all: stats(v), train: stats(v.filter((t) => t.time < split)), valid: stats(v.filter((t) => t.time >= split)) }])); };

/** Sağlamlık: doğrulama işlemlerinden toplam R'si en yüksek ay atılınca kalan istatistik. */
export function robustStats(validTrades) {
  const byM = new Map();
  for (const t of validTrades) { const k = new Date(t.time).toISOString().slice(0, 7); if (!byM.has(k)) byM.set(k, []); byM.get(k).push(t); }
  if (byM.size < 2) return { ...stats(validTrades), droppedMonth: null };
  let best = null, bestR = -Infinity;
  for (const [k, v] of byM) { const r = v.filter((t) => TRADED.has(t.outcome)).reduce((a, t) => a + t.R, 0); if (r > bestR) { bestR = r; best = k; } }
  return { ...stats(validTrades.filter((t) => new Date(t.time).toISOString().slice(0, 7) !== best)), droppedMonth: best };
}

/** İşaretli BTC getirisi (long: +BTC, short: −BTC) → R'ye regresyon eğimi ve korelasyon. */
export function btcBeta(trades) {
  const pts = trades.filter((t) => TRADED.has(t.outcome) && t.btcPct != null).map((t) => [(t.direction === 'long' ? 1 : -1) * t.btcPct, t.R]);
  const n = pts.length;
  if (n < 10) return { n, beta: null, corr: null };
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return { n, beta: sxx ? +(sxy / sxx).toFixed(3) : null, corr: sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null };
}
const btcBucket = (t) => (t.btcPct == null ? 'BTC bilinmiyor' : t.btcPct < -1 ? 'BTC < −1%' : t.btcPct > 1 ? 'BTC > +1%' : 'BTC ±1%');

/** İşlemlere, tutulduğu süredeki BTC getirisini yazar (btcCloseAt(tf, time) → kapanış). */
export function attachBtc(trades, btcCloseAt, feePct = 0.05) {
  for (const t of trades) {
    const exitT = t.exitTime ?? (t.time + ((t.waitBars || 1) + (t.bars || 0)) * (TIMEFRAMES[t.tf]?.ms || 0));
    const a = btcCloseAt(t.tf, t.entryTime ?? t.time), b = btcCloseAt(t.tf, exitT);
    t.btcPct = a && b ? +((b / a - 1) * 100).toFixed(2) : null;
    // Hedge'li R: pozisyonun yanına eşit nominalde ters BTC konsaydı (piyasa-nötr). Hedge K/Z = −d × BTC%; R birimine
    // çevirmek için stop uzaklığına (%) bölünür; hedge komisyonu iki taraf.
    const stopPct = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : (t.risk || null);
    const d = t.direction === 'long' ? 1 : -1;
    t.hedgedR = t.btcPct != null && stopPct > 0 && t.R != null ? +(t.R - (d * (t.btcPct / 100) + 2 * (feePct / 100)) / stopPct).toFixed(3) : null;
  }
  return trades;
}

/** İşlem listesinin R'si hedgedR ile değiştirilmiş kopyası (hedgedR olmayanlar atılır). */
const hedgedOf = (trades) => trades.filter((t) => t.hedgedR != null).map((t) => ({ ...t, R: t.hedgedR }));

/** BTC hedge'li (piyasa-nötr) istatistikler; btcPct'si olmayan işlemler dışarıda. */
export function hedgedReport(trades, split) {
  const h = hedgedOf(trades);
  const tr = h.filter((t) => t.time < split), va = h.filter((t) => t.time >= split);
  const rep = { all: stats(h), train: stats(tr), valid: stats(va), robust: robustStats(va), robustTrain: robustStats(tr) };
  return { ...rep, ...acceptance(rep) };
}

export function report(trades, split) {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  let eq = 0; const curve = sorted.filter((t) => TRADED.has(t.outcome)).map((t) => { eq += t.R; return [t.time, +eq.toFixed(2)]; });
  const thin = curve.length > 500 ? curve.filter((_, i) => i % Math.ceil(curve.length / 500) === 0 || i === curve.length - 1) : curve;
  const validTrades = sorted.filter((t) => t.time >= split);
  return { all: stats(trades), train: stats(sorted.filter((t) => t.time < split)), valid: stats(validTrades), robust: robustStats(validTrades), robustTrain: robustStats(sorted.filter((t) => t.time < split)), byTf: by(trades, (t) => t.tf, split), byDirection: by(trades, (t) => t.direction, split), byTfDir: by(trades, (t) => `${t.tf} ${t.direction}`, split), byMonth: by(trades, (t) => new Date(t.time).toISOString().slice(0, 7), split), byBtc: by(trades, btcBucket, split), bySession: by(trades, (t) => sessionOf(entryTimeOf(t)), split), byWeekpart: by(trades, (t) => weekpartOf(entryTimeOf(t)), split), btcBeta: { all: btcBeta(trades), valid: btcBeta(validTrades) }, hedged: hedgedReport(trades, split), curve: thin };
}

async function main() {
  const t0 = Date.now();
  const endMs = Date.now(), startMs = endMs - CFG.months * 30 * 86400e3;
  let coins, fixtureProvider = null;
  if (CFG.fixture) { ({ fixtureProvider } = await import('../../src/data/fixture.js')); coins = await fixtureProvider.topCoins(CFG.top); }
  else if (CFG.coins) coins = CFG.coins.map((c) => ({ coin: c.toUpperCase(), instId: instIdOf(c.toUpperCase()) }));
  else coins = await getTopCoins(Math.max(CFG.top, CFG.universe || 0), {});
  // --universe N (> top): portföy aileleri N coinlik havuzdan her yeniden dengelemede dönemin ilk `top`unu seçer;
  // coin başına aileler yalnız bugünün ilk `top` coininde koşar.
  const pit = CFG.universe > CFG.top;
  const topSet = new Set(coins.slice(0, CFG.top).map((c) => c.coin));
  // --tfs: stratejilerin TF'leri bu kümeyle kesişir; kesişimi boş olan strateji atlanır (yalnız bu TF'lerin mumları çekilir)
  const strategies = (CFG.strategies ? CFG.strategies.map((id) => STRATEGY_MAP[id]).filter(Boolean) : STRATEGIES)
    .map((s) => (CFG.tfs ? { ...s, tfs: s.tfs.filter((t) => CFG.tfs.includes(t)) } : s)).filter((s) => s.tfs.length);
  const tfs = [...new Set(strategies.flatMap((s) => s.tfs))];
  log(`Laboratuvar: ${strategies.map((s) => s.id).join(', ')} × ${coins.length} coin × ${tfs.join(',')}; ${CFG.months} ay`);
  const o = { ...BT_DEFAULTS, feePct: CFG.fee, slipPct: CFG.slip, fundingPct8h: CFG.funding };
  const needDaily = strategies.some((s) => s.needs?.includes('1D'));
  const needBtc = strategies.some((s) => s.needs?.includes('BTC1D'));
  const fetchTf = async (instId, tf, n) => (CFG.fixture ? (await fixtureProvider.candles(instId, tf, n)).candles : getHistoryCached(instId, tf, startMs - (tf === '1D' ? 120 * 86400e3 : 0), endMs, { cacheDir: CFG.cacheDir }));
  let btcDaily = null;
  if (needBtc) { try { btcDaily = await fetchTf(CFG.fixture ? 'BTC' : instIdOf('BTC'), '1D', 400); log(`  BTC 1D: ${btcDaily.length} mum (rejim filtresi)`); } catch (err) { log(`  BTC 1D: ${err.message}`); } }
  const series = [];
  for (const c of coins) {
    let daily = null;
    if (needDaily) { try { daily = await fetchTf(c.instId, '1D', 400); } catch (err) { log(`  ${c.coin} 1D: ${err.message}`); } }
    for (const tf of tfs) {
      try {
        const candles = await fetchTf(c.instId, tf, 1500);
        if (candles.length >= (tf === '1D' ? 120 : 350)) series.push({ coin: c.coin, tf, candles, extra: { daily, btcDaily } });
      } catch (err) { log(`  ${c.coin} ${tf}: ${err.message}`); }
    }
  }
  // BTC kapanışı (TF, zaman): BTC serisi yoksa null → btcPct null
  const btcMaps = new Map();
  for (const s of series) if (s.coin === 'BTC') btcMaps.set(s.tf, s.candles);
  for (const tf of tfs) if (!btcMaps.has(tf)) { try { btcMaps.set(tf, await fetchTf(CFG.fixture ? 'BTC' : instIdOf('BTC'), tf, 1500)); } catch (err) { log(`  BTC ${tf}: ${err.message}`); } }
  if (btcDaily && !btcMaps.has('1D')) btcMaps.set('1D', btcDaily);
  const btcCloseAt = (tf, time) => { const c = btcMaps.get(tf); if (!c) return null; let lo = 0, hi = c.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].time <= time) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? c[k].close : null; };
  const allTimes = series.flatMap((s) => [s.candles[0].time, s.candles[s.candles.length - 1].time]);
  const split = Math.min(...allTimes) + (Math.max(...allTimes) - Math.min(...allTimes)) * 2 / 3;
  const out = { meta: { ...CFG, tfs, pit, coins: coins.map((c) => c.coin), split, startMs, endMs, generatedAt: Date.now() }, strategies: {} };
  for (const st of strategies) {
    const ts = Date.now(); const trades = [];
    if (st.kind === 'portfolio') {
      const daily = series.filter((s) => s.tf === '1D').map((s) => ({ coin: s.coin, candles: s.candles }));
      trades.push(...st.run(daily, o, { btcDaily, startMs: CFG.fixture ? null : startMs, pitN: pit ? CFG.top : null }));
      if (!out.meta.benchmark && daily.length) out.meta.benchmark = benchmarks(daily.filter((s) => topSet.has(s.coin)), startMs, split, endMs);
    } else for (const s of series) { if (!st.tfs.includes(s.tf) || !topSet.has(s.coin) || (st.coins && !st.coins.includes(s.coin))) continue; trades.push(...runStrategy(st, s, o)); }
    attachBtc(trades, btcCloseAt, CFG.fee);
    const rep = report(trades, split);
    out.strategies[st.id] = { id: st.id, label: st.label, tfs: st.tfs, exit: st.exit, ...rep, elapsedSec: Math.round((Date.now() - ts) / 1000), ...acceptance(rep), ...(st.kind === 'portfolio' ? { kind: 'portfolio', params: st.params, slots: slotsOf(st.params), portfolio: portfolioOf(trades, slotsOf(st.params), split) } : {}) };
    log(`  ${st.id.padEnd(14)} işlem ${String(trades.length).padStart(5)} | eğitim ${rep.train.avgR}R PF ${rep.train.profitFactor} | doğrulama n${rep.valid.n} ${rep.valid.avgR}R PF ${rep.valid.profitFactor} win %${(rep.valid.winRate * 100).toFixed(0)} | sağlam(${rep.robust.droppedMonth || '-'} hariç) ${rep.robust.avgR}R PF ${rep.robust.profitFactor} | eğitim sağlam(${rep.robustTrain.droppedMonth || '-'} hariç) ${rep.robustTrain.avgR}R | BTC beta ${rep.btcBeta.all.beta ?? '-'} (r ${rep.btcBeta.all.corr ?? '-'}) | hedge'li doğr. n${rep.hedged.valid.n} ${rep.hedged.valid.avgR}R PF ${rep.hedged.valid.profitFactor}${rep.hedged.candidate ? ' ← HEDGE\'Lİ ADAY' : ''} ${out.strategies[st.id].candidate ? '← ADAY' : out.strategies[st.id].weak ? '← zayıf (yalnız doğrulama)' : ''} (${Math.round((Date.now() - ts) / 1000)} sn)`);
  }
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'lab.json'), JSON.stringify(out));
  log(`Bitti: ${out.meta.elapsedSec} sn`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
