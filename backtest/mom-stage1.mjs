#!/usr/bin/env node
// Kesitsel momentum aşama M1 (tanımlar docs/arastirma/on-kayit-momentum.md "Aşama M1 — kesin tanımlar", bağlayıcı).
//   node backtest/mom-stage1.mjs [--lock 0|1] [--out docs/backtest] [--cache backtest/cache] [--pool 150] [--fixture]
// lock 0 (varsayılan): yalnız geliştirme dilimi + sağlamlık denetimi; kasa-M mumları indirildikten hemen sonra zaman damgasına
// indirgenir (yalnız veri varlığı sayımı), kasa getirisi hesaplanmaz / yazılmaz / loglanmaz. lock 1: kasa-M dahil tam rapor (tek bakış).
// Çıktı: docs/backtest/mom-stage1.json + konsol tabloları.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { runStage1, WINDOWS } from './mom-stage1.js';
import { DEV_START, LOCK_START, DAY } from './mom-diag.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { lock: +arg('lock', 0) === 1 ? 1 : 0, out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), pool: +arg('pool', 150), fixture: arg('fixture', false) === true };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const t0 = Date.now();
  let provider = null, now = Date.now();
  if (CFG.fixture) { ({ fixtureProvider: provider } = await import('../src/data/fixture.js')); now = Date.UTC(2026, 9, 1); }
  const coins = CFG.fixture ? await provider.topCoins(CFG.pool) : await getTopCoins(CFG.pool, {});
  if (!coins.some((c) => c.coin === 'BTC')) coins.push({ coin: 'BTC', instId: instIdOf('BTC') });
  // Isınma: L 56 + minHistory 20 = 76 mum → kasa başından 100 gün önce
  const from = LOCK_START - 100 * DAY;
  log(`M1 (lock ${CFG.lock}): ${coins.length} coin, 1D ${new Date(from).toISOString().slice(0, 10)} → bugün`);
  const devSeries = [], kasaSeries = [], lockedTimes = new Map();
  let k = 0;
  for (const c of coins) {
    let cs = [];
    try { cs = CFG.fixture ? (await provider.candles(c.instId, '1D', Math.ceil((now - from) / DAY))).candles : await getHistoryCached(c.instId, '1D', from, now, { cacheDir: CFG.cacheDir }); } catch (e) { log(`  ${c.coin} 1D: ${e.message}`); }
    const pre = cs.filter((x) => x.time < DEV_START);
    lockedTimes.set(c.coin, pre.filter((x) => x.time >= LOCK_START - 60 * DAY).map((x) => x.time));
    if (CFG.lock && pre.length >= 2) kasaSeries.push({ coin: c.coin, candles: pre }); // lock 0: kasa fiyatları tutulmaz
    const dev = cs.filter((x) => x.time >= DEV_START);
    if (dev.length >= 2) devSeries.push({ coin: c.coin, candles: dev });
    if (++k % 25 === 0) log(`  ${k}/${coins.length} coin`);
  }
  const out = runStage1({ devSeries, kasaSeries: CFG.lock ? kasaSeries : null, lockedTimes, now, lock: CFG.lock, pool: CFG.pool, meta: { fixture: CFG.fixture, coinsFetched: coins.length } });
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'mom-stage1.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'mom-stage1.json')}`);
}

const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
function printTables(o) {
  const A = o.meta.lockedAvailability;
  console.log(`\nKasa-M veri varlığı: ${A.rebalances} dengeleme, uygun coin min/ortanca/maks ${A.eligibleMin}/${A.eligibleMedian}/${A.eligibleMax}`);
  const s = o.sanity;
  console.log(`Sağlamlık (T ↔ M0d koşu ${s.run ?? '—'}): ${s.available ? `eğitim ${s.got.train} (beklenen ${s.expected.train}) · doğrulama ${s.got.valid} (beklenen ${s.expected.valid}) → ${s.ok ? 'TAMAM' : 'TUTMUYOR'}` : s.reason}`);
  const head = () => console.log(`${'satır'.padEnd(12)} ${'dilim'.padEnd(6)} ${'hafta'.padStart(5)} ${'ort%'.padStart(7)} %90 GA            ${'Sharpe'.padStart(6)} ${'düşüş%'.padStart(7)} ${'kötü hf'.padStart(7)} ${'işlem'.padStart(5)} ${'ort R'.padStart(7)} ${'kötü iş%'.padStart(8)}`);
  const line = (lab, sp, x) => console.log(`${lab.padEnd(12)} ${sp.padEnd(6)} ${x ? `${f(x.weeks, 5)} ${f(x.meanPct)} ${ci(x.ci90).padEnd(18)} ${f(x.sharpe, 6)} ${f(x.maxDDPct)} ${f(x.worstWeekPct)} ${f(x.trades, 5)} ${f(x.avgR)} ${f(x.worstTradeHedgedPct ?? x.worstTradePct, 8)}` : 'işlem yok'}`);
  for (const [flow, rows] of [['geliştirme', o.dev], ...(o.kasa ? [['kasa-M', o.kasa]] : [])]) {
    console.log(`\nM1 · ${flow} (seri: T/HM2/HM3 hedge'li, HM1 hedge'siz)`); head();
    for (const [id, byL] of Object.entries(rows)) for (const L of WINDOWS) {
      const r = byL[`L${L}`];
      for (const sp of flow === 'kasa-M' ? ['all'] : ['train', 'valid']) line(`${id} L${L}`, sp, r[sp]);
    }
  }
  console.log('\nBilgi amaçlı (geliştirme, L 28):'); head();
  for (const [id, r] of Object.entries(o.info)) for (const sp of ['train', 'valid']) line(id, sp, r[sp]);
  console.log('\nGeçme (ön kayıt):');
  for (const [id, p] of Object.entries(o.pass)) console.log(`  ${id.padEnd(4)} ${id === 'T' ? '' : `geliştirme ${p.devPass} · `}kasa ${p.kasaPass ?? '— (lock 0)'} · plato L14 ${p.plateau.L14} / L56 ${p.plateau.L56} → ${p.pass ?? '— (lock 0)'}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
