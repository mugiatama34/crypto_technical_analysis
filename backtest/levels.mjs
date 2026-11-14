#!/usr/bin/env node
// Sahte seviye testi (14.11.2026; tanımlar docs/arastirma/on-kayit-seviye.md, bağlayıcı): S1 Fibonacci geri çekilme ↔ komşu sahte seviyeler,
// S2 yuvarlak sayılar ↔ ötelenmiş sahte seviyeler. Strateji backtest'i DEĞİL: yalnız tepki oranı farkı.
//   node backtest/levels.mjs [--out docs/backtest] [--cache backtest/cache/levels] [--top 50] [--from 2022-09-01] [--reps 2000] [--no1d] [--fixture]
// Çıktı: docs/backtest/levels.json (meta, s1, s2, info1d) + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { runLevels, LEVELS_DEFAULTS } from './levels.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/levels')), top: +arg('top', 50), from: Date.parse(`${arg('from', '2022-09-01')}T00:00:00Z`), reps: +arg('reps', LEVELS_DEFAULTS.reps), no1d: arg('no1d', false) === true, fixture: arg('fixture', false) === true };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TF_MS = { '4H': 4 * 3600e3, '1D': 86400e3 };

async function load(provider, coins, tf, now) {
  const out = [];
  let k = 0, errs = 0;
  for (const c of coins) {
    let cs = [];
    try {
      cs = provider ? (await provider.candles(c.instId, tf, Math.ceil((now - CFG.from) / TF_MS[tf]))).candles : await getHistoryCached(c.instId, tf, CFG.from, now, { cacheDir: CFG.cacheDir });
    } catch (e) { if (errs++ < 10) log(`  ${c.coin} ${tf}: ${e.message}`); }
    if (cs.length >= 30) out.push({ coin: c.coin, instId: c.instId, candles: cs });
    if (++k % 10 === 0) log(`  ${tf} ${k}/${coins.length} coin`);
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  let provider = null, now = Date.now();
  if (CFG.fixture) { ({ fixtureProvider: provider } = await import('../src/data/fixture.js')); now = Date.UTC(2026, 9, 1); }
  const coins = CFG.fixture ? await provider.topCoins(CFG.top) : await getTopCoins(CFG.top, {});
  log(`Coin: ${coins.length}; 4H${CFG.no1d ? '' : ' + 1D'} mumlar ${new Date(CFG.from).toISOString().slice(0, 10)} → bugün (önbellek ${CFG.cacheDir})`);
  const series4h = await load(provider, coins, '4H', now);
  log(`4H seri: ${series4h.length} coin; mum toplamı ${series4h.reduce((a, s) => a + s.candles.length, 0)}`);
  const series1d = CFG.no1d ? [] : await load(provider, coins, '1D', now);
  if (!CFG.no1d) log(`1D seri: ${series1d.length} coin`);
  const out = runLevels({ series4h, series1d, now, p: { reps: CFG.reps }, meta: { fixture: CFG.fixture, coinsFetched: coins.length, candlesFrom: new Date(CFG.from).toISOString().slice(0, 10), source: CFG.fixture ? 'src/data/fixture.js' : 'OKX /api/v5/market/history-candles (USDT sürekli vadeli)' } });
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'levels.json'), JSON.stringify(out));
  printAll(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'levels.json')}`);
}

const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
const lvHead = () => console.log(`  ${'seviye'.padEnd(8)} ${'olay'.padStart(6)} ${'tepki'.padStart(6)} ${'kırılım'.padStart(7)} ${'oran'.padStart(7)} ${'belirsiz'.padStart(8)} ${'sonuçsuz'.padStart(8)} ${'ufuk'.padStart(5)}`);
const lvRow = (k, x) => console.log(`  ${k.padEnd(8)} ${f(x.n, 6)} ${f(x.react, 6)} ${f(x.brk, 7)} ${f(x.rate)} ${f(x.ambShare, 8)} ${f(x.noneShare, 8)} ${f(x.horizon, 5)}`);
function printTf(tag, r) {
  console.log(`\n${tag} S1 · Fibonacci geri çekilme ↔ komşu sahte (olay ${r.s1.eventsTotal}; dokunuş durumu ${JSON.stringify(r.s1.touchStatus)})`);
  for (const h of ['A', 'B']) {
    const c = r.s1[h];
    console.log(` yarı ${h} · gün ${c.days} · inanılan ${c.nBelieved} / sahte ${c.nFake} çözülmüş${c.inconclusive ? ' · n < 200 → sonuçsuz' : ''}`);
    lvHead();
    for (const [k, x] of Object.entries(c.levels)) lvRow(k, x);
    for (const [k, d] of Object.entries(c.diffs)) console.log(`   ${k} − ort(${d.vs.join(', ')}): ${f(d.diff)} ${ci(d.ci99)} (ağırlık ${d.weight})`);
    console.log(`   birincil (ağırlıklı): ${f(c.diff)} %99 ${ci(c.ci99)}`);
  }
  console.log(`  verdict: ${r.s1.verdict} ${JSON.stringify(r.s1.checks)}`);
  console.log(`\n${tag} S2 · yuvarlak sayılar ↔ ötelenmiş sahte (olay ${r.s2.eventsTotal}; sayımlar ${JSON.stringify(r.s2.counts)})`);
  for (const h of ['A', 'B']) {
    const c = r.s2[h];
    console.log(` yarı ${h} · gün ${c.days}${c.inconclusive ? ' · n < 200 → sonuçsuz' : ''}`);
    lvHead();
    for (const [k, x] of Object.entries(c.levels)) lvRow(k, x);
    for (const k of ['round', 'fake']) { lvRow(`${k}↓`, c.byApproach[k].fromAbove); lvRow(`${k}↑`, c.byApproach[k].fromBelow); }
    console.log(`   fark (yuvarlak − sahte): ${f(c.diff)} %99 ${ci(c.ci99)}`);
    console.log(`   Osler devam (s): yuvarlak ${c.osler.round.mean} (n ${c.osler.round.n}) · sahte ${c.osler.fake.mean} (n ${c.osler.fake.n}) · fark ${c.osler.diff} ${ci(c.osler.ci99)}`);
  }
  console.log(`  verdict: ${r.s2.verdict} ${JSON.stringify(r.s2.checks)}`);
}
function printAll(o) {
  console.log(`\nSahte seviye testi · ${o.meta.period} · coin ${o.meta.coins} · bacak ${JSON.stringify(o.meta.legs)} · bootstrap ${o.meta.params.bootstrap.reps} × %99`);
  printTf('4H', o);
  if (o.info1d) { console.log(`\n--- ${o.info1d.info} · coin ${o.info1d.coins} · bacak ${JSON.stringify(o.info1d.legs)}`); printTf('1D', o.info1d); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
