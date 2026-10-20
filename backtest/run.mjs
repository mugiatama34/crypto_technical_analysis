#!/usr/bin/env node
// Backtest koşusu: veri (OKX geçmiş, disk önbelleği) → walk-forward simülasyon → rapor (docs/backtest/results.json + plans.json.gz).
//   node backtest/run.mjs --months 6 --top 50 --tfs 15m,1H,4H --fee 0.05 --slip 0.05 [--coins BTC,ETH] [--fixture] [--out docs/backtest]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getTopCoins, TIMEFRAMES, instIdOf } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { simulateSeries, BT_DEFAULTS } from './engine.js';
import { buildReport } from './report.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = {
  months: +arg('months', 6), top: +arg('top', 50), tfs: String(arg('tfs', '15m,1H,4H')).split(','), coins: arg('coins', '') ? String(arg('coins')).split(',') : null,
  fee: +arg('fee', 0.05), slip: +arg('slip', 0.05), minScore: +arg('minScore', 50), minRR: +arg('minRR', 2), maxRiskPct: +arg('maxRiskPct', 5),
  out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true,
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const t0 = Date.now();
  const endMs = Date.now(), startMs = endMs - CFG.months * 30 * 86400e3;
  let coins;
  if (CFG.fixture) {
    const { fixtureProvider } = await import('../src/data/fixture.js');
    coins = await fixtureProvider.topCoins(CFG.top);
  } else if (CFG.coins) coins = CFG.coins.map((c) => ({ coin: c.toUpperCase(), instId: instIdOf(c.toUpperCase()) }));
  else coins = await getTopCoins(CFG.top, { onRetry: (r) => log('retry', r.path, r.attempt) });
  log(`Backtest: ${coins.length} coin × ${CFG.tfs.join(',')}; ${CFG.months} ay; fee ${CFG.fee}% slip ${CFG.slip}%`);
  const o = { ...BT_DEFAULTS, feePct: CFG.fee, slipPct: CFG.slip, plan: { minScore: CFG.minScore, minRR: CFG.minRR, maxRiskPct: CFG.maxRiskPct } };
  const trades = [];
  const coverage = {};
  for (const c of coins) {
    for (const tf of CFG.tfs) {
      let candles;
      try {
        if (CFG.fixture) {
          const { fixtureProvider } = await import('../src/data/fixture.js');
          candles = (await fixtureProvider.candles(c.instId, tf, 1500)).candles;
        } else candles = await getHistoryCached(c.instId, tf, startMs, endMs, { cacheDir: CFG.cacheDir, onRetry: (r) => log('retry', r.path, r.attempt) });
      } catch (err) { log(`  ${c.coin} ${tf}: veri hatası ${err.message}`); continue; }
      if (candles.length < 350) { log(`  ${c.coin} ${tf}: ${candles.length} mum, atlandı`); continue; }
      coverage[`${c.coin}|${tf}`] = { bars: candles.length, from: candles[0].time, to: candles[candles.length - 1].time };
      const ts = Date.now();
      const tr = simulateSeries({ coin: c.coin, instId: c.instId, tf, candles }, o);
      trades.push(...tr);
      log(`  ${c.coin.padEnd(6)} ${tf.padEnd(3)} ${String(candles.length).padStart(5)} mum → ${String(tr.length).padStart(3)} plan (${((Date.now() - ts) / 1000).toFixed(0)} sn)`);
    }
  }
  const meta = { ...CFG, coins: coins.map((c) => c.coin), startMs, endMs, coverage, elapsedSec: Math.round((Date.now() - t0) / 1000) };
  const report = buildReport(trades.map(({ plan, ...t }) => t), meta);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'results.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(CFG.out, 'plans.json.gz'), zlib.gzipSync(JSON.stringify(trades.map((t) => ({ coin: t.coin, tf: t.tf, time: t.time, outcome: t.outcome, R: t.R, plan: t.plan })))));
  const s = report.overall;
  log(`Bitti: ${trades.length} plan, ${s.n} dolum, kazanma %${(s.winRate * 100).toFixed(0)}, ort ${s.avgR}R, toplam ${s.totalR}R, PF ${s.profitFactor}, maxDD ${s.maxDD}R; ${meta.elapsedSec} sn`);
}
main().catch((e) => { console.error(e); process.exit(1); });
