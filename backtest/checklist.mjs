#!/usr/bin/env node
// Check list ölçümü: son tam koşunun planları (plans.json.gz) → her planın karar anında 10 madde (yalnız o ana kadarki veri)
// → (A) tüm planlar, temel çıkış · (B) canlı 4H düzeni (bıçak koruması + limit + hafta içi + üst TF aynı yön + erken %80).
// Rapor: madde madde etki, ağırlıksız sayım kovaları, eğitimden öğrenilen ağırlıklı puan (doğrulamada), hepsi hedge'li de.
//   node backtest/checklist.mjs [--in docs/backtest] [--cache backtest/cache] [--fixture]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { simulateTrade, BT_DEFAULTS } from './engine.js';
import { loadSeries, rebuild, hedgeOf, passes } from './sweep.mjs';
import { getHistoryCached } from './data.js';
import { checklistOf } from '../src/scan/checklist.js';
import { checklistReport } from './checklistReport.js';
import { relativeStrength } from '../src/scan/relative.js';
import { makeContext } from '../src/scan/context.js';
import { runDetectors } from '../src/scan/registry.js';
import { horizonSeries, UP_TF } from '../src/scan/regime.js';
import { TIMEFRAMES } from '../src/data/okx.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), OUT = String(arg('out', 'docs/backtest')), CACHE = String(arg('cache', 'backtest/cache')), FIXTURE = arg('fixture', false) === true;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const W = 400;
const LIVE = { name: 'canlı 4H', tfs: ['4H'], onlyLimit: true, skipWeekend: true, htfTrend: 'with', knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 }, tp1Pct: 1.2, tp1Portion: 0.8, keepTp2: true };
const closedBefore = (cs, ms, t) => { const out = []; for (const c of cs) { if (c.time + ms <= t) out.push(c); else break; } return out; };

async function main() {
  const t0 = Date.now();
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, 'plans.json.gz'))).toString());
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(IN, 'results.json'), 'utf8')).meta; } catch { return {}; } })();
  const times = all.map((t) => t.time).sort((a, b) => a - b);
  const split = meta.split || times[Math.floor((times.length * 2) / 3)];
  log(`Plan: ${all.length}; bölünme ${new Date(split).toISOString().slice(0, 10)}`);
  const fee = meta.fee ?? 0.05, slip = meta.slip ?? 0.05;
  const groups = new Map();
  for (const t of all) { const k = `${t.coin}|${t.tf}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(t); }
  const series = new Map();
  for (const k of groups.keys()) { const [coin, tf] = k.split('|'); const s = await loadSeries(coin, tf, `${coin}-USDT-SWAP`); if (s) series.set(k, s); }
  const tMin = times[0], tMax = times[times.length - 1];
  const day = async (coin) => {
    if (FIXTURE) { const { fixtureProvider } = await import('../src/data/fixture.js'); return (await fixtureProvider.candles(`${coin}-USDT-SWAP`, '1D', 400)).candles; }
    try { return await getHistoryCached(`${coin}-USDT-SWAP`, '1D', tMin - 150 * 86400e3, tMax + 86400e3, { cacheDir: CACHE }); } catch { return null; }
  };
  const btc1d = await day('BTC');
  const btcByTf = new Map();
  for (const tf of new Set(all.map((t) => t.tf))) { const b = series.get(`BTC|${tf}`) || await loadSeries('BTC', tf, 'BTC-USDT-SWAP'); if (b) btcByTf.set(tf, b.candles); }
  const upCache = new Map();
  const upOf = async (coin, tf) => {
    const up = UP_TF[tf]; if (!up) return null;
    const k = `${coin}|${up}`;
    if (!upCache.has(k)) upCache.set(k, series.get(k)?.candles || (up === '1D' ? await day(coin) : (await loadSeries(coin, up, `${coin}-USDT-SWAP`))?.candles) || null);
    return upCache.get(k);
  };
  // Üst TF eğilim filtresi (canlı düzen) için sweep'in passes'ı: htf haritası
  const htf = new Map();
  for (const t of all) { const up = UP_TF[t.tf]; const k = `${t.coin}|${up}`; if (up && !htf.has(k)) { const cs = await upOf(t.coin, t.tf); if (cs?.length) htf.set(k, { hs: horizonSeries(cs), ms: TIMEFRAMES[up].ms }); } }
  log(`Seri ${series.size}, BTC 1D ${btc1d?.length ?? 0}, üst TF ${htf.size}`);

  const oBase = { ...BT_DEFAULTS, feePct: fee, slipPct: slip };
  const oLive = { ...oBase, knifeGuard: LIVE.knifeGuard, tp1Portion: LIVE.tp1Portion };
  const A = [], B = [];
  let done = 0;
  for (const [k, list] of groups) {
    const s = series.get(k); if (!s) continue;
    const [coin, tf] = k.split('|'), ms = TIMEFRAMES[tf].ms;
    const btc = btcByTf.get(tf), upC = await upOf(coin, tf), upMs = UP_TF[tf] ? TIMEFRAMES[UP_TF[tf]].ms : 0;
    for (const t of list) {
      const i = s.idx.get(t.time); if (i == null) continue;
      const decided = t.time + ms;
      const win = s.candles.slice(Math.max(0, i - W + 1), i + 1);
      let smc = [];
      try { smc = runDetectors(makeContext({ candles: win, tf, symbol: coin, opts: {} }), ['fvg', 'orderblock', 'liquidity']); } catch { smc = []; }
      const rsx = coin === 'BTC' || !btc ? null : relativeStrength(win, btc.filter((c) => c.time >= win[0].time && c.time <= t.time));
      const plan = { ...t.plan, riskPct: t.plan.riskPct ?? t.riskPct, trend: { rsSide: rsx?.rsSide ?? null, rsBtc: rsx?.rs ?? null } };
      const cl = checklistOf({ plan, candles: win, btcDaily: btc1d ? closedBefore(btc1d, 86400e3, decided) : null, upCandles: upC ? closedBefore(upC, upMs, decided) : null, smc, coin, now: decided });
      const ok = Object.fromEntries(cl.items.map((x) => [x.id, x.ok]));
      const simA = simulateTrade(t.plan, s.candles, i + 1, tf, oBase);
      const rowA = { time: t.time, tf, d: t.plan.d, stop: t.plan.stop, ...simA, ok };
      if (simA.entryFill) Object.assign(rowA, hedgeOf(rowA, btc, fee, oBase.tp1Portion));
      A.push(rowA);
      if (passes(t, LIVE, s, new Map(), htf)) {
        const pB = rebuild(t.plan, LIVE);
        const simB = simulateTrade(pB, s.candles, i + 1, tf, oLive);
        const rowB = { time: t.time, tf, d: pB.d, stop: pB.stop, ...simB, ok };
        if (simB.entryFill) Object.assign(rowB, hedgeOf(rowB, btc, fee, oLive.tp1Portion));
        B.push(rowB);
      }
      if (++done % 2000 === 0) log(`  ${done}/${all.length}`);
    }
  }
  const out = { meta: { ...meta, checklistAt: Date.now(), split, plans: all.length, elapsedSec: Math.round((Date.now() - t0) / 1000) }, all: checklistReport(A, split), live4h: checklistReport(B, split) };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'checklist.json'), JSON.stringify(out));
  for (const [name, r] of [['tüm planlar', out.all], ['canlı 4H', out.live4h]]) {
    log(`${name}: n ${r.n} | eğitim ${r.all.train.avgR}R doğr ${r.all.valid.avgR}R | hedge'li doğr ${r.all.hValid.avgR}R`);
    for (const [id, x] of Object.entries(r.perItem)) log(`  ${id.padEnd(8)} Δ eğt ${x.delta.train} doğr ${x.delta.valid} | hedge'li Δ eğt ${x.delta.hTrain} doğr ${x.delta.hValid} | ✓ n${x.yes.valid.n} ✗ n${x.no.valid.n}`);
    log('  sayım:', r.byCount.map((b) => `${b.label}: eğt ${b.train.avgR}/${b.train.n} doğr ${b.valid.avgR}/${b.valid.n}`).join(' · '));
    log('  ağırlıklı:', r.weighted.tiers.map((b) => `${b.label}: eğt ${b.train.avgR} doğr ${b.valid.avgR}/${b.valid.n} h ${b.hValid.avgR}`).join(' · '), JSON.stringify(r.weighted.weights));
  }
  log(`Bitti: ${out.meta.elapsedSec} sn`);
}
main().catch((e) => { console.error(e); process.exit(1); });
