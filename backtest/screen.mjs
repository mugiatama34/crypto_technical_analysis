#!/usr/bin/env node
// Bilgi taraması (14.11.2026; tanımlar docs/arastirma/on-kayit-tarama.md, bağlayıcı): K1–K6 olay / grup sonrası göreli getiri ↔ plasebo.
// Strateji backtest'i DEĞİL (stop / hedef / maliyet yok).
//   node backtest/screen.mjs [--out docs/backtest] [--cache backtest/cache/screen] [--pool 150] [--k3Top 50] [--from 2019-01-01]
//                            [--draws 1000] [--reps 2000] [--fundingDays 100] [--noK3] [--fixture]
// Çıktı: docs/backtest/screen.json (meta, k1 … k6) + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { fetchFunding } from './mom-diag.mjs';
import { runScreen, k3Signals, SCREEN_DEFAULTS, HALF_A_START, DAY } from './screen.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/screen')), pool: +arg('pool', 150), k3Top: +arg('k3Top', SCREEN_DEFAULTS.k3.top), from: Date.parse(`${arg('from', '2019-01-01')}T00:00:00Z`), draws: +arg('draws', SCREEN_DEFAULTS.draws), reps: +arg('reps', SCREEN_DEFAULTS.reps), fundingDays: +arg('fundingDays', 100), noK3: arg('noK3', false) === true, fixture: arg('fixture', false) === true };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const t0 = Date.now();
  let provider = null, now = Date.now();
  if (CFG.fixture) { ({ fixtureProvider: provider } = await import('../src/data/fixture.js')); now = Date.UTC(2026, 9, 1); }
  const coins = CFG.fixture ? await provider.topCoins(CFG.pool) : await getTopCoins(CFG.pool, {});
  if (!coins.some((c) => c.coin === 'BTC')) coins.push({ coin: 'BTC', instId: instIdOf('BTC') });
  log(`Havuz: ${coins.length} coin; 1D mumlar ${new Date(CFG.from).toISOString().slice(0, 10)} → bugün (önbellek ${CFG.cacheDir})`);
  const series = [];
  let k = 0, errs = 0;
  for (const c of coins) {
    let cs = [];
    try {
      cs = CFG.fixture ? (await provider.candles(c.instId, '1D', Math.ceil((now - CFG.from) / DAY))).candles : await getHistoryCached(c.instId, '1D', CFG.from, now, { cacheDir: CFG.cacheDir });
    } catch (e) { if (errs++ < 10) log(`  ${c.coin} 1D: ${e.message}`); }
    if (cs.length >= 2) series.push({ coin: c.coin, instId: c.instId, candles: cs });
    if (++k % 25 === 0) log(`  ${k}/${coins.length} coin`);
  }
  log(`1D seri: ${series.length} coin; mum toplamı ${series.reduce((a, s) => a + s.candles.length, 0)}`);

  // K3: bugünün ilk k3Top coini (BTC hariç), 1D sinyal motoru planları (yalnız yön / gün; dolum simülasyonu yok)
  let k3 = { unavailable: 'kapalı (--noK3)' };
  if (!CFG.noK3) {
    try {
      const top = coins.slice(0, CFG.k3Top).map((c) => c.coin).filter((c) => c !== 'BTC');
      const signals = [];
      let enough = 0;
      const t1 = Date.now();
      for (const coin of top) {
        const s = series.find((x) => x.coin === coin);
        if (!s) continue;
        if (s.candles.length > 601) enough++;
        signals.push(...k3Signals(s, { fromMs: HALF_A_START }));
      }
      log(`K3: ${top.length} coin (600 günlük ısınmaya yeten ${enough}), ${signals.length} sinyal, ${Math.round((Date.now() - t1) / 1000)} sn`);
      k3 = enough ? { signals, meta: { coins: top.length, coinsWithWarmup: enough, how: 'backtest/screen.js k3Signals: engine.simulateSeries ile aynı tarama (analyzeRow + buildPlan, 600 mum pencere, bekleme süresi), dolum simülasyonu yok' } } : { unavailable: 'hiçbir coinde 600 günlük ısınmaya yetecek 1D veri yok' };
    } catch (e) { k3 = { unavailable: `hata: ${e.message}` }; log(`K3 hata: ${e.message}`); }
  }

  // K5: fonlama geçmişi (OKX ~3 ay), havuzdaki tüm coinler (BTC hariç)
  const funding = new Map();
  if (!CFG.fixture) {
    const since = now - CFG.fundingDays * DAY;
    let fe = 0;
    for (const s of series) {
      if (s.coin === 'BTC') continue;
      try { funding.set(s.coin, await fetchFunding(instIdOf(s.coin), since)); } catch (e) { funding.set(s.coin, null); if (fe++ < 5) log(`  fonlama ${s.coin}: ${e.message}`); }
    }
    log(`Fonlama: verisi olan ${[...funding.values()].filter(Boolean).length} / ${funding.size}`);
  }

  const out = runScreen({ series, k3, funding, now, p: { draws: CFG.draws, reps: CFG.reps }, meta: { fixture: CFG.fixture, coinsFetched: coins.length, candlesFrom: new Date(CFG.from).toISOString().slice(0, 10), k3Top: CFG.k3Top, fundingDays: CFG.fundingDays, fundingEndpoint: '/api/v5/public/funding-rate-history (realizedRate, yoksa fundingRate; fundingTime)' } });
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'screen.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'screen.json')}`);
}

const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
const head = () => console.log(`  ${'yarı'.padEnd(4)} ${'n'.padStart(6)} ${'gün'.padStart(5)} ${'ort%'.padStart(8)} ${'%99 GA'.padEnd(20)} ${'plasebo ort'.padStart(11)} ${'p0,5 / p1 / p99 / p99,5'.padEnd(30)} ${'yüzdelik'.padStart(8)} sonuçsuz`);
const row = (h, c) => console.log(`  ${h.padEnd(4)} ${f(c?.n, 6)} ${f(c?.days, 5)} ${f(c?.meanPct, 8)} ${ci(c?.ci99).padEnd(20)} ${f(c?.placebo?.meanPct, 11)} ${(c?.placebo ? `${c.placebo.p0_5} / ${c.placebo.p1} / ${c.placebo.p99} / ${c.placebo.p99_5}` : '—').padEnd(30)} ${f(c?.percentile, 8)} ${c?.inconclusive}`);
const sq = (x) => (x ? `n ${x.n} p50 ${x.p50} p90 ${x.p90} en büyük ${x.max}` : '—');
function printTables(o) {
  const U = o.meta.universe.perDay;
  console.log(`\nBilgi taraması · ${o.meta.period} · havuz ${o.meta.pool} · evren/gün min ${U.min} ortanca ${U.median} maks ${U.max} · çekiliş ${o.meta.draws} · bootstrap ${o.meta.bootstrap.reps} × %99`);
  for (const key of ['k1', 'k2']) {
    const x = o[key];
    console.log(`\n${key.toUpperCase()} · ${x.def.event} → ${x.def.hypothesis}; olay ${x.eventsTotal} (ufku dolmayan ${x.droppedHorizon}); yıllar ${JSON.stringify(x.byYear)}`);
    for (const [N, hz] of Object.entries(x.horizons)) { console.log(` ufuk ${N} g${+N === x.def.primary ? ' (birincil)' : ''}`); head(); row('A', hz.A); row('B', hz.B); }
    if (x.strict40) { console.log(` ${x.strict40.def}: olay ${x.strict40.eventsTotal}`); row('A', x.strict40.A); row('B', x.strict40.B); }
    console.log(` ${x.dedup7.def}`); row('A', x.dedup7.A); row('B', x.dedup7.B);
    if (key === 'k1') console.log(` sıkışma (short): A ${sq(x.squeeze.A)} | B ${sq(x.squeeze.B)}`);
    else console.log(` sıkışma long: A ${sq(x.squeeze.long.A)} | B ${sq(x.squeeze.long.B)} · short: A ${sq(x.squeeze.short.A)} | B ${sq(x.squeeze.short.B)}`);
    console.log(`  verdict: ${x.verdict} ${JSON.stringify(x.checks)}`);
  }
  const k3 = o.k3;
  console.log(`\nK3 · ${k3.def.signals}`);
  if (!k3.available) console.log(`  ${k3.reason}`);
  else {
    console.log(`  sinyal ${k3.signalsTotal}; yıllar ${JSON.stringify(k3.byYear)}`);
    for (const [N, hz] of Object.entries(k3.horizons)) for (const h of ['A', 'B']) {
      const c = hz[h];
      console.log(`  ufuk ${N}${+N === k3.def.primary ? '*' : ' '} ${h} n ${f(c.n, 6)} ort ATR ${f(c.meanAtr)} ${ci(c.ci99).padEnd(18)} | B: fark ${f(c.vsB.diffAtr)} ${ci(c.vsB.diffCi99).padEnd(18)} yüzd ${f(c.vsB.percentile)} | A-mom (n ${c.vsA.n}): fark ${f(c.vsA.diffAtr)} ${ci(c.vsA.diffCi99).padEnd(18)} yüzd ${f(c.vsA.percentile)} | long ${c.long.n}: ${c.long.meanAtr} · short ${c.short.n}: ${c.short.meanAtr}`);
    }
  }
  console.log(`  verdict: ${k3.verdict}${k3.checks ? ` ${JSON.stringify(k3.checks)}` : ''}`);
  const weekly = (key, x, groups) => {
    for (const [g, c] of Object.entries(groups)) { console.log(` ${key} ${g}`); row('A', c.A); row('B', c.B); }
  };
  const k4 = o.k4;
  console.log(`\nK4 · ${k4.def.group} → ${k4.def.hypothesis}\n  not: ${k4.def.note}`);
  for (const [N, hz] of Object.entries(k4.horizons)) { console.log(` ufuk ${N} g${+N === k4.def.primary ? ' (birincil)' : ''}`); head(); row('A', hz.A); row('B', hz.B); }
  weekly('yaş', k4, k4.buckets);
  if (k4.wide) { console.log(` wide (evren geçmiş eşiği ${k4.wide.minHistory} gün): grup`); row('A', k4.wide.group.A); row('B', k4.wide.group.B); weekly('wide yaş', k4, k4.wide.buckets); }
  console.log(`  verdict: ${k4.verdict} ${JSON.stringify(k4.checks)}`);
  const k5 = o.k5;
  console.log(`\nK5 · ${k5.def.group || ''} (${k5.def.info})`);
  if (!k5.available) console.log(`  ${k5.reason}`); else { console.log(`  hafta ${k5.weeksWithData}, coin ${k5.coinsWithData}`); head(); weekly('', k5, k5.quintiles); }
  const k6 = o.k6;
  console.log(`\nK6 · ${k6.def.group} → ${k6.def.hypothesis}`);
  head(); weekly('', k6, k6.quintiles);
  for (const [N, hz] of Object.entries(k6.horizons)) { console.log(` q5 ufuk ${N} g`); row('A', hz.A); row('B', hz.B); }
  console.log(`  verdict: ${k6.verdict} ${JSON.stringify(k6.checks)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
