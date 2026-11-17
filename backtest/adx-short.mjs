#!/usr/bin/env node
// Ön kayıtlı ölçüm: yüksek ADX'te short (docs/arastirma/on-kayit-adx-short.md) → docs/backtest/adx-short.json.
// Birincil: 4H, bağımsız dönem 13.11.2023–13.11.2025, bugünün hacimde ilk 50 coini, bugünkü canlı satır (sweep capLists), knifeBar
// 'touch'; filtre = kümede "ADX n trend ↓" (n ≥ 40) + short. Bilgi: diğer gruplar, kümelenme, 'lowerBar', 1H, görülmüş dönem (4H).
//   node backtest/adx-short.mjs                       (tam koşu: 4H + 1H)
//   node backtest/adx-short.mjs --tfs 4H              (yalnız 4H; dosyadaki diğer TF sonucu korunur — 1H ayrı koşulabilir)
//   node backtest/adx-short.mjs --coins BTC,ETH --from 2025-06-01 --to 2025-08-01 --tfs 4H --out /tmp/x --cache /tmp/c
//     (küçük deneme; sonuç YORUMLANMAZ, docs/backtest'e yazmaz; --from/--to verilince görülmüş dönem hesaplanmaz)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { BT_DEFAULTS, simulateSeries } from './engine.js';
import { barsFor } from '../src/scan/scanner.js';
import { horizonSeries, UP_TF } from '../src/scan/regime.js';
import { ADX, variantFor, evaluatePlans, periodReport, seriesOf, fetchRanges } from './adx-short.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ALL_TFS = [ADX.primaryTf, ...ADX.infoTfs];

async function main() {
  const t0 = Date.now();
  const CFG = {
    top: +arg('top', ADX.top), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/adx')),
    coins: arg('coins', '') ? String(arg('coins')).split(',').map((c) => c.trim().toUpperCase()) : null,
    from: arg('from', null), to: arg('to', null),
    tfs: arg('tfs', '') ? String(arg('tfs')).split(',').map((t) => t.trim()).filter((t) => ALL_TFS.includes(t)) : ALL_TFS,
  };
  const trial = !!(CFG.coins || CFG.from || CFG.to || CFG.top !== ADX.top);
  if (trial && path.resolve(CFG.out) === path.resolve('docs/backtest')) { console.error('Deneme koşusu (--coins/--from/--to/--top) docs/backtest\'e yazmaz: --out <geçici klasör> ver.'); process.exit(2); }
  const periods = trial && (CFG.from || CFG.to)
    ? { independent: { from: Date.parse(CFG.from || '2023-11-13'), to: Date.parse(CFG.to || '2025-11-13'), label: `DENEME ${CFG.from}–${CFG.to}` } }
    : ADX.periods;
  const coins = CFG.coins ? CFG.coins.map((c) => ({ coin: c, instId: instIdOf(c) })) : await getTopCoins(CFG.top, {});
  log(`ADX short: ${coins.length} coin, TF ${CFG.tfs.join(',')}${trial ? ' (DENEME)' : ''}`);
  const fetch = (instId, tf, [a, b]) => getHistoryCached(instId, tf, a, b, { cacheDir: CFG.cacheDir, onRetry: (r) => log('retry', r.path, r.attempt) });
  const planOpts = { ...BT_DEFAULTS, feePct: ADX.cost.fee, slipPct: ADX.cost.slip, plan: ADX.plan };
  const out = {
    meta: {
      prereg: ADX.prereg, trial, coins: coins.map((c) => c.coin), top: CFG.top, periods, primaryTf: ADX.primaryTf, infoTfs: ADX.infoTfs, minAdx: ADX.minAdx, minN: ADX.minN,
      cost: { ...ADX.cost, fundingPct8h: 0, note: 'fonlama: tarama varsayılanı (0), 13.11 satırıyla aynı' },
      variant: variantFor('4H'), planOpts: ADX.plan, lower: ADX.lower,
      criterion: 'birincil (4H, bağımsız dönem, knifeBar touch): eğitim ve doğrulamada ort. R > 0, PF > 1,1 ve hedge\'li ort. R > 0; dilim başına dolan n ≥ 100 (yoksa sonucsuz). Sıkı ölçüt geçer, hedge\'li geçmez → btc-yonu.',
      split: 'dönemin takvim aralığında 2/3 eğitim – 1/3 doğrulama (plan mumu zamanı)', generatedAt: null,
    },
    tfs: {},
  };
  if (trial) out.meta.warning = 'DENEME KOŞUSU: biçim kontrolü; sayılar yorumlanmaz (ön kayıt: sonuca tek bakış tam koşuda).';

  for (const tf of CFG.tfs) {
    const ts = Date.now(), ms = TIMEFRAMES[tf].ms, low = ADX.lower[tf], up = UP_TF[tf];
    const tfPeriods = tf === ADX.primaryTf ? periods : { independent: periods.independent };
    const ranges = fetchRanges(tf, tfPeriods, Date.now());
    const firstFrom = tfPeriods.independent.from, lastTo = Math.max(...Object.values(tfPeriods).map((p) => p.to));
    const vMain = variantFor(tf, 'touch'), vLow = variantFor(tf, 'lowerBar');
    let btc;
    try { btc = await fetch(instIdOf('BTC'), tf, ranges[tf]); } catch (e) { log(`  BTC ${tf}: ${e.message}`); }
    const tradesMain = [], tradesLow = [], coverage = {};
    let plansN = 0;
    for (const c of coins) {
      const tc = Date.now();
      let candles, lower = null, upper = null;
      try { candles = c.coin === 'BTC' && btc ? btc : await fetch(c.instId, tf, ranges[tf]); } catch (e) { log(`  ${c.coin} ${tf}: ${e.message}`); continue; }
      const W = barsFor(tf);
      // Simülasyon: ilk planın zamanı dönem başına yakın olsun diye seri dönem başından W (+10) mum önce başlar
      const s0 = candles.findIndex((x) => x.time >= firstFrom - (W + 10) * ms);
      if (s0 > 0) candles = candles.slice(s0);
      if (candles.length < 350 || !candles.some((x) => x.time >= firstFrom && x.time < lastTo)) { log(`  ${c.coin} ${tf}: ${candles.length} mum (az / dönem dışı, atlandı)`); continue; }
      try { lower = await fetch(c.instId, low, ranges[low]); } catch (e) { log(`  ${c.coin} ${low}: ${e.message}`); }
      try { upper = await fetch(c.instId, up, ranges[up]); } catch (e) { log(`  ${c.coin} ${up}: ${e.message}`); }
      const htf = new Map(upper?.length ? [[`${c.coin}|${up}`, { hs: horizonSeries(upper), ms: TIMEFRAMES[up].ms }]] : []);
      const plans = simulateSeries({ coin: c.coin, instId: c.instId, tf, candles }, planOpts).filter((t) => t.time >= firstFrom && t.time < lastTo);
      plansN += plans.length;
      const ctx = { series: seriesOf(candles), lower, htf, btc, fee: ADX.cost.fee, slip: ADX.cost.slip };
      tradesMain.push(...evaluatePlans(plans, vMain, ctx));
      tradesLow.push(...evaluatePlans(plans, vLow, ctx));
      coverage[c.coin] = { bars: candles.length, from: candles[0].time, to: candles[candles.length - 1].time, lower: lower?.length || 0, upper: upper?.length || 0 };
      log(`  ${c.coin.padEnd(6)} ${tf} ${String(candles.length).padStart(5)} mum → ${String(plans.length).padStart(4)} plan (${Math.round((Date.now() - tc) / 1000)} sn)`);
    }
    const rep = { series: Object.keys(coverage).length, plans: plansN, coverage, btcBars: btc?.length || 0 };
    for (const [k, p] of Object.entries(tfPeriods)) rep[k] = periodReport(tradesMain, tradesLow, p, { decision: tf === ADX.primaryTf && k === 'independent' });
    rep.elapsedSec = Math.round((Date.now() - ts) / 1000);
    out.tfs[tf] = rep;
    const pr = rep.independent.groups.primary;
    log(`${tf}: ${plansN} plan; birincil n eğitim ${pr.train.n} / doğr. ${pr.valid.n} → ${rep.independent.verdict ?? rep.independent.infoVerdict} (${rep.elapsedSec} sn)`);
  }
  // --tfs ile tek TF koşulduysa dosyadaki diğer TF'nin sonucu korunur (aynı deneme / tam koşu türünden ise)
  const file = path.join(CFG.out, 'adx-short.json');
  if (CFG.tfs.length < ALL_TFS.length) { try { const prev = JSON.parse(fs.readFileSync(file, 'utf8')); if (!!prev.meta?.trial === trial) out.tfs = { ...prev.tfs, ...out.tfs }; } catch { /* yok */ } }
  const d = out.tfs[ADX.primaryTf]?.independent;
  Object.assign(out, d ? { verdict: d.verdict, conclusion: d.conclusion, reasons: d.reasons } : { verdict: null, conclusion: '4H koşulmadı' });
  out.meta.tfsRun = CFG.tfs; out.meta.generatedAt = Date.now(); out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  log(`Bitti: ${out.meta.elapsedSec} sn → ${file}; karar: ${out.verdict}`);
}
// Doğrudan çalıştırma denetimi yol karşılaştırmasıyla (URL biçimi '~' / boşluk gibi karakterleri farklı kodlayabiliyor)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
