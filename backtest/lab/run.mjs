#!/usr/bin/env node
// Strateji laboratuvarı koşusu: her strateji × coin × TF → sinyaller simüle edilir (aynı coinde açık işlem varken yeni
// sinyal alınmaz) → eğitim/doğrulama raporu → docs/backtest/lab.json (lab.html okur).
//   node backtest/lab/run.mjs [--months 6 --top 50] [--strategies donchian,meanrev] [--fee 0.05 --slip 0.05] [--fixture]
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf } from '../../src/data/okx.js';
import { getHistoryCached } from '../data.js';
import { simulateTrade, BT_DEFAULTS } from '../engine.js';
import { stats } from '../report.js';
import { STRATEGIES, STRATEGY_MAP } from './strategies.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { months: +arg('months', 6), top: +arg('top', 50), fee: +arg('fee', 0.05), slip: +arg('slip', 0.05), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true, coins: arg('coins', '') ? String(arg('coins')).split(',') : null, strategies: arg('strategies', '') ? String(arg('strategies')).split(',') : null };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout']);

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

const by = (trades, f, split) => { const m = new Map(); for (const t of trades) { const k = f(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return Object.fromEntries([...m.entries()].map(([k, v]) => [k, { all: stats(v), train: stats(v.filter((t) => t.time < split)), valid: stats(v.filter((t) => t.time >= split)) }])); };

export function report(trades, split) {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  let eq = 0; const curve = sorted.filter((t) => TRADED.has(t.outcome)).map((t) => { eq += t.R; return [t.time, +eq.toFixed(2)]; });
  const thin = curve.length > 500 ? curve.filter((_, i) => i % Math.ceil(curve.length / 500) === 0 || i === curve.length - 1) : curve;
  return { all: stats(trades), train: stats(sorted.filter((t) => t.time < split)), valid: stats(sorted.filter((t) => t.time >= split)), byTf: by(trades, (t) => t.tf, split), byDirection: by(trades, (t) => t.direction, split), byTfDir: by(trades, (t) => `${t.tf} ${t.direction}`, split), byMonth: by(trades, (t) => new Date(t.time).toISOString().slice(0, 7), split), curve: thin };
}

async function main() {
  const t0 = Date.now();
  const endMs = Date.now(), startMs = endMs - CFG.months * 30 * 86400e3;
  let coins, fixtureProvider = null;
  if (CFG.fixture) { ({ fixtureProvider } = await import('../../src/data/fixture.js')); coins = await fixtureProvider.topCoins(CFG.top); }
  else if (CFG.coins) coins = CFG.coins.map((c) => ({ coin: c.toUpperCase(), instId: instIdOf(c.toUpperCase()) }));
  else coins = await getTopCoins(CFG.top, {});
  const strategies = CFG.strategies ? CFG.strategies.map((id) => STRATEGY_MAP[id]).filter(Boolean) : STRATEGIES;
  const tfs = [...new Set(strategies.flatMap((s) => s.tfs))];
  log(`Laboratuvar: ${strategies.map((s) => s.id).join(', ')} × ${coins.length} coin × ${tfs.join(',')}; ${CFG.months} ay`);
  const o = { ...BT_DEFAULTS, feePct: CFG.fee, slipPct: CFG.slip };
  const needDaily = strategies.some((s) => s.needs?.includes('1D'));
  const fetchTf = async (instId, tf, n) => (CFG.fixture ? (await fixtureProvider.candles(instId, tf, n)).candles : getHistoryCached(instId, tf, startMs - (tf === '1D' ? 120 * 86400e3 : 0), endMs, { cacheDir: CFG.cacheDir }));
  const series = [];
  for (const c of coins) {
    let daily = null;
    if (needDaily) { try { daily = await fetchTf(c.instId, '1D', 400); } catch (err) { log(`  ${c.coin} 1D: ${err.message}`); } }
    for (const tf of tfs) {
      try {
        const candles = await fetchTf(c.instId, tf, 1500);
        if (candles.length >= 350) series.push({ coin: c.coin, tf, candles, extra: { daily } });
      } catch (err) { log(`  ${c.coin} ${tf}: ${err.message}`); }
    }
  }
  const allTimes = series.flatMap((s) => [s.candles[0].time, s.candles[s.candles.length - 1].time]);
  const split = Math.min(...allTimes) + (Math.max(...allTimes) - Math.min(...allTimes)) * 2 / 3;
  const out = { meta: { ...CFG, coins: coins.map((c) => c.coin), split, startMs, endMs, generatedAt: Date.now() }, strategies: {} };
  for (const st of strategies) {
    const ts = Date.now(); const trades = [];
    for (const s of series) { if (!st.tfs.includes(s.tf)) continue; trades.push(...runStrategy(st, s, o)); }
    const rep = report(trades, split);
    out.strategies[st.id] = { id: st.id, label: st.label, tfs: st.tfs, exit: st.exit, ...rep, elapsedSec: Math.round((Date.now() - ts) / 1000), candidate: rep.valid.n >= 100 && rep.valid.avgR > 0 && rep.valid.profitFactor > 1.1, weak: rep.valid.n >= 50 && rep.valid.n < 100 && rep.valid.avgR > 0 && rep.valid.profitFactor > 1.1 };
    log(`  ${st.id.padEnd(14)} işlem ${String(trades.length).padStart(5)} | eğitim ${rep.train.avgR}R PF ${rep.train.profitFactor} | doğrulama n${rep.valid.n} ${rep.valid.avgR}R PF ${rep.valid.profitFactor} win %${(rep.valid.winRate * 100).toFixed(0)} ${out.strategies[st.id].candidate ? '← ADAY' : out.strategies[st.id].weak ? '← zayıf aday' : ''} (${Math.round((Date.now() - ts) / 1000)} sn)`);
  }
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'lab.json'), JSON.stringify(out));
  log(`Bitti: ${out.meta.elapsedSec} sn`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
