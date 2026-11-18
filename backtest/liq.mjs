#!/usr/bin/env node
// Ön kayıtlı ölçüm: Bybit hacim eşiğiyle canlı 4H düzeni (docs/arastirma/on-kayit-hacim-esigi.md) → docs/backtest/liq.json.
// 4H, 17.11.2025–17.11.2026 UTC, bugünün hacimde ilk 100 coini, bugünkü canlı satır (adx-short.js variantFor), knifeBar 'touch' karar;
// filtre = sinyal gününden önceki 7 kapanmış günün Bybit lineer cirosu ortalaması ≥ 20 M$. YEREL koşu (Bybit API Actions'tan kapalı).
//   node backtest/liq.mjs                                                     (tam koşu)
//   node backtest/liq.mjs --coins BTC,ETH,SOL --from 2026-09-01 --to 2026-10-01 --out /tmp/x --cache /tmp/c   (deneme; yorumlanmaz)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../src/data/okx.js';
import { bybitOf } from '../src/data/bybit-symbols.js';
import { getHistoryCached } from './data.js';
import { BT_DEFAULTS, simulateSeries } from './engine.js';
import { barsFor } from '../src/scan/scanner.js';
import { horizonSeries, UP_TF } from '../src/scan/regime.js';
import { ADX, variantFor, evaluatePlans, seriesOf } from './adx-short.js';
import { LIQ, DAY, parseBybitKlines, turnoverIndex, avgTurnoverBefore, liqReport, universeOf } from './liq.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bybit günlük ciro (tek istek ≤ 1000 gün); önbellek dosyası coin bazında. → { sym, mult, status: 'ok' | 'invalid' | 'error', rows }. */
async function bybitTurnover(coins, from, to, file) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* yok */ }
  if (cache.from !== from || cache.to !== to) cache = { from, to, fetchedAt: null, coins: {} };
  for (const coin of coins) {
    if (cache.coins[coin]?.status === 'ok' || cache.coins[coin]?.status === 'invalid') continue;
    const { sym, mult } = bybitOf(coin);
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=D&start=${from}&end=${to}&limit=1000`;
    let rec = { sym, mult, status: 'error', rows: [] };
    for (let a = 0; a < 4; a++) {
      try {
        const j = await (await fetch(url)).json();
        if (j.retCode === 0) { rec = { sym, mult, status: 'ok', rows: parseBybitKlines(j.result?.list) }; if (!rec.rows.length) rec.status = 'invalid'; break; }
        if (j.retCode === 10001) { rec = { sym, mult, status: 'invalid', rows: [], msg: j.retMsg }; break; }
        rec.msg = j.retMsg;
      } catch (e) { rec.msg = e.message; }
      await sleep(1000 * (a + 1));
    }
    cache.coins[coin] = rec;
    log(`  Bybit ${coin.padEnd(8)} ${sym.padEnd(18)} ${rec.status} ${rec.rows.length} gün`);
    await sleep(120);
  }
  cache.fetchedAt = Date.now();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache));
  return cache.coins;
}

async function main() {
  const t0 = Date.now();
  const CFG = {
    top: +arg('top', LIQ.top), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/liq')),
    coins: arg('coins', '') ? String(arg('coins')).split(',').map((c) => c.trim().toUpperCase()) : null,
    from: arg('from', null), to: arg('to', null),
  };
  const trial = !!(CFG.coins || CFG.from || CFG.to || CFG.top !== LIQ.top);
  if (trial && path.resolve(CFG.out) === path.resolve('docs/backtest')) { console.error('Deneme koşusu docs/backtest\'e yazmaz: --out <geçici klasör> ver.'); process.exit(2); }
  const period = trial && (CFG.from || CFG.to)
    ? { from: Date.parse(CFG.from || '2025-11-17'), to: Date.parse(CFG.to || '2026-11-17'), label: `DENEME ${CFG.from}–${CFG.to}` }
    : LIQ.period;
  const tf = LIQ.tf, low = LIQ.lowerTf, up = UP_TF[tf], ms = TIMEFRAMES[tf].ms;
  const coins = CFG.coins ? CFG.coins.map((c) => ({ coin: c, instId: instIdOf(c) })) : await getTopCoins(CFG.top, {});
  log(`Hacim eşiği: ${coins.length} coin, ${tf}${trial ? ' (DENEME)' : ''}`);

  // Bybit cirosu: dönem başından 10 gün önce (ilk sinyalin 7 günlük penceresi) – dönem sonu
  const bFrom = period.from - 10 * DAY, bTo = period.to;
  const turnover = await bybitTurnover(coins.map((c) => c.coin), bFrom, bTo, path.join(CFG.cacheDir, 'bybit-turnover.json'));
  const tIdx = Object.fromEntries(Object.entries(turnover).map(([c, b]) => [c, b.status === 'ok' ? turnoverIndex(b.rows) : null]));

  const now = Date.now();
  const ranges = { '1D': [period.from - 250 * DAY, now], '4H': [period.from - 120 * DAY, now], '1H': [period.from - 120 * DAY, now] };
  const fetch = (instId, t, [a, b]) => getHistoryCached(instId, t, a, b, { cacheDir: CFG.cacheDir, onRetry: (r) => log('retry', r.path, r.attempt) });
  const planOpts = { ...BT_DEFAULTS, feePct: LIQ.cost.fee, slipPct: LIQ.cost.slip, plan: ADX.plan };
  const vMain = variantFor(tf, 'touch'), vLow = variantFor(tf, 'lowerBar');
  let btc;
  try { btc = await fetch(instIdOf('BTC'), tf, ranges[tf]); } catch (e) { log(`  BTC ${tf}: ${e.message}`); }
  const runs = { touch: [], lowerBar: [], slip: Object.fromEntries(LIQ.slipSens.map((s) => [String(s), []])) };
  const coverage = {}, skipped = {};
  let plansN = 0;
  const tag = (c) => (t) => ({ ...t, onBybit: !!tIdx[c.coin], liq7: avgTurnoverBefore(tIdx[c.coin], t.time) });
  for (const c of coins) {
    const tc = Date.now();
    let candles, lower = null, upper = null;
    try { candles = c.coin === 'BTC' && btc ? btc : await fetch(c.instId, tf, ranges[tf]); } catch (e) { log(`  ${c.coin}: ${e.message}`); skipped[c.coin] = e.message; continue; }
    const W = barsFor(tf);
    const s0 = candles.findIndex((x) => x.time >= period.from - (W + 10) * ms);
    if (s0 > 0) candles = candles.slice(s0);
    if (candles.length < 350 || !candles.some((x) => x.time >= period.from && x.time < period.to)) { log(`  ${c.coin}: ${candles.length} mum (az / dönem dışı, atlandı)`); skipped[c.coin] = `${candles.length} mum`; continue; }
    try { lower = await fetch(c.instId, low, ranges[low]); } catch (e) { log(`  ${c.coin} ${low}: ${e.message}`); }
    try { upper = await fetch(c.instId, up, ranges[up]); } catch (e) { log(`  ${c.coin} ${up}: ${e.message}`); }
    const htf = new Map(upper?.length ? [[`${c.coin}|${up}`, { hs: horizonSeries(upper), ms: TIMEFRAMES[up].ms }]] : []);
    const plans = simulateSeries({ coin: c.coin, instId: c.instId, tf, candles }, planOpts).filter((t) => t.time >= period.from && t.time < period.to);
    plansN += plans.length;
    const ctx = { series: seriesOf(candles), lower, htf, btc, fee: LIQ.cost.fee, slip: LIQ.cost.slip };
    runs.touch.push(...evaluatePlans(plans, vMain, ctx).map(tag(c)));
    runs.lowerBar.push(...evaluatePlans(plans, vLow, ctx).map(tag(c)));
    for (const s of LIQ.slipSens) runs.slip[String(s)].push(...evaluatePlans(plans, vMain, { ...ctx, slip: s }).map(tag(c)));
    coverage[c.coin] = { bars: candles.length, from: candles[0].time, to: candles[candles.length - 1].time, lower: lower?.length || 0, upper: upper?.length || 0, bybit: turnover[c.coin]?.status, bybitDays: turnover[c.coin]?.rows?.length || 0 };
    log(`  ${c.coin.padEnd(8)} ${String(candles.length).padStart(5)} mum → ${String(plans.length).padStart(4)} plan (${Math.round((Date.now() - tc) / 1000)} sn)`);
  }
  const rep = liqReport(runs, period);
  const out = {
    meta: {
      prereg: LIQ.prereg, trial, period, tf, lowerTf: low, top: CFG.top, coins: coins.map((c) => c.coin), threshold: LIQ.threshold, windowDays: LIQ.windowDays, neighbors: LIQ.neighbors,
      cost: { ...LIQ.cost, fundingPct8h: 0 }, slipSens: LIQ.slipSens, account: LIQ.account, variant: vMain, planOpts: ADX.plan,
      filter: 'sinyal mumunun açıldığı UTC gününden önceki 7 kapanmış Bybit günlük mumunun turnover ortalaması (eksik gün → filtre dışı)',
      criterion: 'filtreli grup, knifeBar touch: eğitim ve doğrulamada ort. R > 0, PF > 1,1, hedge\'li R > 0; dilim başına dolan n ≥ 100 (yoksa sonuçsuz)',
      slipNote: 'motor slipPct: piyasa girişleri (bıçak teyidi), stop / süre sonu çıkışları; limit giriş ve limit hedeflere kayma uygulanmaz',
      accountNote: 'dolan işlemler; giriş = dolum mumu açılışı, çıkış = çıkış mumu kapanışı; aynı anda çıkış önce; kayıp serisi R ≤ 0',
      bybitFetch: { from: bFrom, to: bTo }, generatedAt: null,
    },
    universe: universeOf(turnover, coins.map((c) => c.coin), period),
    series: Object.keys(coverage).length, plans: plansN, skipped, coverage, btcBars: btc?.length || 0,
    ...rep,
  };
  if (trial) out.meta.warning = 'DENEME KOŞUSU: biçim kontrolü; sayılar yorumlanmaz.';
  out.meta.generatedAt = Date.now(); out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  const file = path.join(CFG.out, 'liq.json');
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const p = out.groups.primary;
  log(`Bitti: ${out.meta.elapsedSec} sn → ${file}; filtreli n eğ ${p.train.n} / doğr ${p.valid.n} → ${out.result}`);
}
// Doğrudan çalıştırma denetimi yol karşılaştırmasıyla (repo yolundaki '~' / boşluk URL biçiminde farklı kodlanıyor)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
