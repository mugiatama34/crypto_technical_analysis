#!/usr/bin/env node
// Backtest koşusu: veri (OKX geçmiş, disk önbelleği) → walk-forward simülasyon → rapor (docs/backtest/results.json + plans.json.gz).
//   node backtest/run.mjs --months 6 --top 50 --tfs 15m,1H,4H --fee 0.05 --slip 0.05 [--coins BTC,ETH] [--fixture] [--out docs/backtest]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getTopCoins, TIMEFRAMES, instIdOf } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { BT_DEFAULTS } from './engine.js';
import { simulateWithExtras, writePlansFile } from './plans.js';
import { buildReport } from './report.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = {
  months: +arg('months', 6), top: +arg('top', 50), tfs: String(arg('tfs', '15m,1H,4H')).split(','), coins: arg('coins', '') ? String(arg('coins')).split(',') : null,
  fee: +arg('fee', 0.05), slip: +arg('slip', 0.05), minScore: +arg('minScore', 50), minRR: +arg('minRR', 2), maxRiskPct: +arg('maxRiskPct', 5),
  out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true,
  // --mtfTfs: bu TF'lerin planlarına karar anındaki çoklu TF uyumu (mtfBt) yazılır (diğer --tfs TF'leriyle; canlıya eşit tarama)
  mtfTfs: String(arg('mtfTfs', '4H')).split(',').filter(Boolean),
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
  let cdSkipped = 0, mtfDone = 0;
  for (const c of coins) {
    // Önce coin'in tüm TF mumları (çoklu TF uyumu için diğer TF'ler karar anında gerekir), sonra TF başına simülasyon
    const byTf = {};
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
      byTf[tf] = candles;
    }
    for (const tf of CFG.tfs) {
      const candles = byTf[tf]; if (!candles) continue;
      const ts = Date.now();
      const others = CFG.mtfTfs.includes(tf) ? Object.fromEntries(Object.entries(byTf).filter(([k]) => k !== tf)) : null;
      const tr = simulateWithExtras({ coin: c.coin, instId: c.instId, tf, candles }, o, others);
      for (const t of tr) { if (t.mtfBt) mtfDone++; for (const x of t.cd || []) { cdSkipped++; if (x.mtfBt) mtfDone++; } }
      trades.push(...tr);
      log(`  ${c.coin.padEnd(6)} ${tf.padEnd(3)} ${String(candles.length).padStart(5)} mum → ${String(tr.length).padStart(3)} plan (${((Date.now() - ts) / 1000).toFixed(0)} sn)`);
    }
  }
  // planFields (13.11): plans.json.gz girdilerinde ek alanlar — mtfBt (karar anı çoklu TF uyumu), cd (bekleme süresi yüzünden atlanan planlar)
  const meta = { ...CFG, coins: coins.map((c) => c.coin), startMs, endMs, coverage, planFields: ['mtfBt', 'cd'], cdTfs: CFG.mtfTfs.filter((tf) => CFG.tfs.includes(tf)), cooldownSkipped: cdSkipped, mtfComputed: mtfDone, elapsedSec: Math.round((Date.now() - t0) / 1000) };
  const report = buildReport(trades.map(({ plan, cd, mtfBt, ...t }) => t), meta);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'results.json'), JSON.stringify(report));
  writePlansFile(path.join(CFG.out, 'plans.json.gz'), trades.map((t) => ({ coin: t.coin, tf: t.tf, time: t.time, outcome: t.outcome, R: t.R, plan: t.plan, ...(t.mtfBt ? { mtfBt: t.mtfBt } : {}), ...(t.cd ? { cd: t.cd } : {}) })));
  const s = report.overall;
  log(`Bitti: ${trades.length} plan, ${s.n} dolum, kazanma %${(s.winRate * 100).toFixed(0)}, ort ${s.avgR}R, toplam ${s.totalR}R, PF ${s.profitFactor}, maxDD ${s.maxDD}R; ${meta.elapsedSec} sn`);
}
main().catch((e) => { console.error(e); process.exit(1); });
