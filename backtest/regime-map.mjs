#!/usr/bin/env node
// Rejim haritası + "trend yönünde işlem" testi (14.11.2026; tanımlar docs/arastirma/on-kayit-rejim.md, bağlayıcı). Kâğıt / araştırma.
//   node backtest/regime-map.mjs [--out docs/backtest] [--in backtest/stage1-data] [--cache backtest/cache] [--dcache backtest/cache/screen]
//                                [--fcache backtest/cache/carry] [--pool 150] [--from 2019-01-01] [--noSignals] [--noAlts] [--noFunding] [--fixture]
// Kaynaklar: OKX 1D (BTC, ETH, havuz; backtest/data.js getHistoryCached) · Aşama 1 plan seti (stage1.mjs stage1Universe, 4H önbellek
// --cache; sweep.mjs ile aynı bayrak) · Hyperliquid fundingHistory (BTC, ETH; önbellek --fcache, kaldığı yerden sayfalama).
// Bir parçanın verisi yoksa o parça "veri yok: <neden>" olarak yazılır, diğerleri yine koşar. --fixture: sentetik veri (ağ yok).
// Çıktı: docs/backtest/regime-map.json + konsolda tablolar.
import fs from 'node:fs';
import path from 'node:path';
import { runRegimeMap, momentumWeeks, synthDaily, regimeDrift, RM_DEFAULTS, TRENDS, LEVELS, ALIGN, DAY } from './regime-map.js';
import { parseHlRows, mergeRows, withPeriods, HALF_A_START } from './carry.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = {
  out: String(arg('out', 'docs/backtest')), inDir: String(arg('in', 'backtest/stage1-data')), cache: String(arg('cache', 'backtest/cache')),
  dcache: String(arg('dcache', 'backtest/cache/screen')), fcache: String(arg('fcache', 'backtest/cache/carry')), pool: +arg('pool', 150),
  from: Date.parse(`${arg('from', '2019-01-01')}T00:00:00Z`), noSignals: arg('noSignals', false) === true, noAlts: arg('noAlts', false) === true,
  noFunding: arg('noFunding', false) === true, fixture: arg('fixture', false) === true,
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const HOUR = 3600e3, MOM_WARMUP = 100 * DAY;

/** Hyperliquid fonlama: önbellek (carry.mjs ile aynı biçim) + kaldığı yerden sayfalama. */
async function hlFundingRows(hl, from, end) {
  const { hlPost } = await import('./carry.mjs');
  fs.mkdirSync(CFG.fcache, { recursive: true });
  const f = path.join(CFG.fcache, `${hl}.json`);
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { rows = []; }
  let t = rows.length ? rows[rows.length - 1].time + HOUR : from, err = null;
  try {
    while (t < end - HOUR) {
      const page = await hlPost({ type: 'fundingHistory', coin: hl, startTime: t });
      if (!Array.isArray(page) || !page.length) break;
      rows = mergeRows(rows, parseHlRows(page));
      const lastRaw = Math.max(...page.map((x) => Number(x.time)).filter(Number.isFinite));
      if (page.length < 500 || !(lastRaw + 1 > t)) break;
      t = lastRaw + 1;
    }
    fs.writeFileSync(f, JSON.stringify(rows));
  } catch (e) { err = e.message; }
  return { rows: rows.filter((x) => x.time >= from && x.time < end), err };
}

/** Sentetik veri (--fixture): BTC / ETH kalıcı trendli, 40 alt rastgele yürüyüş, saatlik fonlama, 4H sinyaller. */
function fixtureData(now) {
  const n = Math.floor((now - CFG.from) / DAY);
  const daily = { BTC: synthDaily({ n, t0: CFG.from, seed: 11, drift: regimeDrift(240, 0.003), sigma: 0.03, vol: 5e9 }), ETH: synthDaily({ n, t0: CFG.from, seed: 12, drift: regimeDrift(200, 0.003), sigma: 0.035, vol: 3e9 }) };
  const alts = Array.from({ length: 40 }, (_, k) => {
    const skip = k * 25; // listeleme tarihleri yayılsın
    return { coin: `ALT${k}`, candles: synthDaily({ n: n - skip, t0: CFG.from + skip * DAY, seed: 100 + k, sigma: 0.05, vol: 1e8 / (k + 1) }) };
  });
  let a = 7; const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  const fund = (coin) => { const out = []; for (let t = HALF_A_START; t < now; t += HOUR) out.push({ time: t, rate: 0.0000125 + (r() - 0.45) * 0.00002 }); return withPeriods(out); };
  const signals = [];
  for (let t = Date.UTC(2024, 10, 24); t < now; t += 4 * HOUR) {
    if (r() > 0.25) continue;
    const d = r() < 0.6 ? 1 : -1, filled = r() < 0.55;
    signals.push({ d, decided: t + 4 * HOUR, A: { time: t, tf: '4H', d, outcome: filled ? (r() < 0.4 ? 'tp2' : 'stopped') : 'expired', R: filled ? (r() < 0.4 ? 1.5 : -1) : 0, waitBars: 1 } });
  }
  return { daily, alts, funding: { BTC: fund('BTC'), ETH: fund('ETH') }, signals };
}

async function main() {
  const t0 = Date.now();
  const now = CFG.fixture ? Date.UTC(2026, 10, 1) : Date.now();
  const sources = {};
  let daily = {}, alts = null, funding = null, signals = null, momentum = null;
  if (CFG.fixture) {
    const fx = fixtureData(now);
    ({ daily, alts, funding, signals } = fx);
    sources.all = 'sentetik (--fixture): synthDaily (BTC / ETH kalıcı trend, 40 alt rastgele yürüyüş), sentetik fonlama ve 4H sinyaller';
  } else {
    // 1D: havuz (bugünün OKX hacimde ilk N'i) + BTC + ETH
    const { getTopCoins, instIdOf } = await import('../src/data/okx.js');
    const { getHistoryCached } = await import('./data.js');
    let coins = [];
    if (!CFG.noAlts) { try { coins = await getTopCoins(CFG.pool, {}); } catch (e) { alts = { unavailable: `OKX havuz listesi alınamadı: ${e.message}` }; log(alts.unavailable); } }
    for (const c of ['BTC', 'ETH']) if (!coins.some((x) => x.coin === c)) coins.push({ coin: c, instId: instIdOf(c) });
    const series = [];
    let k = 0, errs = 0;
    for (const c of coins) {
      let cs = [];
      try { cs = await getHistoryCached(c.instId, '1D', CFG.from, now, { cacheDir: CFG.dcache }); } catch (e) { if (errs++ < 10) log(`  ${c.coin} 1D: ${e.message}`); }
      if (cs.length >= 2) series.push({ coin: c.coin, candles: cs });
      if (++k % 25 === 0) log(`  ${k}/${coins.length} coin`);
    }
    for (const c of ['BTC', 'ETH']) { const s = series.find((x) => x.coin === c); if (s) daily[c] = s.candles; }
    log(`1D: ${series.length} / ${coins.length} coin; BTC ${daily.BTC?.length || 0} mum, ETH ${daily.ETH?.length || 0} mum`);
    sources.daily = `OKX history-candles 1D (${CFG.from ? new Date(CFG.from).toISOString().slice(0, 10) : ''} →), önbellek ${CFG.dcache}`;
    if (!alts) alts = CFG.noAlts ? { unavailable: 'kapalı (--noAlts)' } : series.length > 2 ? series.filter((s) => s.coin !== 'BTC' && s.coin !== 'ETH') : { unavailable: 'alt coin 1D mumu yok (OKX erişimi?)' };
    sources.pool = `OKX getTopCoins(${CFG.pool}) — bugünün hacim sırası (hayatta kalma yanlılığı)`;
    // Momentum: aynı havuz, 24.11.2022 − 100 gün ısınma
    if (Array.isArray(alts) && daily.BTC) {
      try {
        const ms = series.map((s) => ({ coin: s.coin, candles: s.candles.filter((x) => x.time >= RM_DEFAULTS.knownStart - MOM_WARMUP) })).filter((s) => s.candles.length >= 2);
        const t1 = Date.now();
        momentum = await momentumWeeks(ms, { startMs: RM_DEFAULTS.knownStart });
        log(`Momentum: ${momentum.trades} işlem, ${momentum.weeks.length} hafta (${Math.round((Date.now() - t1) / 1000)} sn)`);
      } catch (e) { momentum = { unavailable: `hata: ${e.message}` }; log(momentum.unavailable); }
    } else momentum = { unavailable: Array.isArray(alts) ? 'BTC 1D yok' : `havuz yok (${alts?.unavailable})` };
    sources.momentum = 'mom-stage1.js rowReport(INFO_DEFS.T_eqRisk), pitN 50, tek akış';
    // Fonlama (Hyperliquid)
    if (CFG.noFunding) funding = { unavailable: 'kapalı (--noFunding)' };
    else {
      const end = Math.floor(now / HOUR) * HOUR, f = {}, errsF = [];
      for (const c of ['BTC', 'ETH']) { const x = await hlFundingRows(c, HALF_A_START, end); if (x.err) errsF.push(`${c}: ${x.err}`); if (x.rows.length) f[c] = withPeriods(x.rows); }
      funding = f.BTC && f.ETH ? f : { unavailable: `Hyperliquid fonlama yok (${errsF.join('; ') || 'boş'})` };
      if (errsF.length) log(`Fonlama uyarı: ${errsF.join('; ')}`);
      log(`Fonlama: BTC ${f.BTC?.length || 0}, ETH ${f.ETH?.length || 0} kayıt`);
    }
    sources.funding = `Hyperliquid info fundingHistory (BTC, ETH; ${new Date(HALF_A_START).toISOString().slice(0, 10)} →), önbellek ${CFG.fcache}`;
    // 4H sinyaller: Aşama 1 plan seti, taban satır, tüm dilimler
    if (CFG.noSignals) signals = { unavailable: 'kapalı (--noSignals)' };
    else {
      try {
        const { stage1Universe } = await import('./stage1.mjs');
        const u = await stage1Universe({ inDir: CFG.inDir, cache: CFG.cache, fixture: false, slices: ['kasa', 'train', 'valid'], log });
        signals = u.rows.map((r) => ({ d: r.d, decided: r.decided, coin: r.coin, slice: r.slice, A: r.A }));
        sources.signals = `Aşama 1 plan seti ${CFG.inDir} (planRun ${u.meta.months} ay, ilk ${u.meta.top}, ${u.meta.tfs}; plan sonu ${new Date(u.meta.endMs).toISOString().slice(0, 10)}), stage1.mjs stage1Universe taban satır (maliyet a), dilimler kasa + eğitim + doğrulama birlikte`;
        if (!signals.length) signals = { unavailable: 'plan setinde taban satıra giren sinyal yok' };
      } catch (e) { signals = { unavailable: `Aşama 1 plan seti yüklenemedi (${CFG.inDir}): ${e.message}` }; log(signals.unavailable); }
    }
  }
  if (CFG.fixture) {
    try { const ms = [{ coin: 'BTC', candles: daily.BTC }, ...alts].map((s) => ({ coin: s.coin, candles: s.candles.filter((x) => x.time >= RM_DEFAULTS.knownStart - MOM_WARMUP) })).filter((s) => s.candles.length >= 2); momentum = await momentumWeeks(ms); } catch (e) { momentum = { unavailable: `hata: ${e.message}` }; }
  }
  const out = await runRegimeMap({ daily, alts, funding, signals, momentum, meta: { now, fixture: CFG.fixture, sources, args: { pool: CFG.pool, from: new Date(CFG.from).toISOString().slice(0, 10), in: CFG.inDir }, momentum: momentum && !momentum.unavailable ? { trades: momentum.trades, weeks: momentum.weeks.length, lastWeekPartialDropped: momentum.lastWeekPartialDropped, warmupDays: 100 } : null } });
  out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'regime-map.json'), JSON.stringify(out));
  printTables(out);
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'regime-map.json')}`);
}

const d10 = (t) => (t == null ? '—' : new Date(t).toISOString().slice(0, 10));
const f = (x, w = 7) => String(x ?? '—').padStart(w);
const ci = (c) => (c ? `[${c[0]}, ${c[1]}]` : '—');
const wHead = () => console.log(`  ${'seri'.padEnd(16)} ${'hafta'.padStart(5)} ${'ort%'.padStart(7)} ${'%90 GA'.padEnd(18)} ${'Sharpe'.padStart(6)} ${'düşüş%'.padStart(7)} ${'kötü hf'.padStart(7)} ${'toplam%'.padStart(8)}`);
const wLine = (lab, x) => console.log(`  ${lab.padEnd(16)} ${x ? `${f(x.weeks, 5)} ${f(x.meanPct)} ${ci(x.ci90).padEnd(18)} ${f(x.sharpe, 6)} ${f(x.maxDDPct)} ${f(x.worstWeekPct)} ${f(x.totalPct, 8)}` : '—'}`);
function printTables(o) {
  console.log(`\nRejim haritası · ön kayıt ${o.meta.preReg} · veri BTC ${d10(o.meta.data.start.BTC)} → ${d10(o.meta.data.end.BTC)}, ETH ${d10(o.meta.data.start.ETH)} → ${d10(o.meta.data.end.ETH)}${o.meta.fixture ? ' · SENTETİK' : ''}`);
  if (o.meta.missing.length) console.log(`Eksik parçalar: ${o.meta.missing.join(' · ')}`);
  const h = o.ht1;
  console.log('\n=== Parça 1 · HT1 (BTC + ETH, her biri kendi trend durumu; maliyetli) ===');
  if (!h.available) console.log(`  ${h.reason || 'durum oluşmadı'}`);
  else {
    for (const [lab, row] of [[`SMA ${h.main.fast}/${h.main.slow} (birincil)`, h.main], ...Object.values(h.plateaus).map((p) => [`SMA ${p.fast}/${p.slow} (plato)`, p])]) {
      if (!row.available) { console.log(` ${lab}: ${row.reason}`); continue; }
      for (const [pk, pn] of [['indep', 'bağımsız'], ['known', 'bilinen']]) {
        const P = row.periods[pk];
        console.log(` ${lab} · ${pn} dönem ${P ? `${d10(P.from)} → ${d10(P.to)}` : '—'}`);
        if (!P) continue;
        wHead(); wLine('toplam', P.total); wLine('long bacak', P.long); wLine('short bacak', P.short); wLine('al-tut', P.buyHold); wLine('al-tut fonlamalı', P.buyHoldFunding);
      }
    }
    console.log(' Durumlar (birincil; gün payı YUKARI / AŞAĞI / KARIŞIK · değişim · trend dönemi sayısı, medyan gün):');
    for (const [c, s] of Object.entries(h.main.states)) for (const [pk, pn] of [['indep', 'bağımsız'], ['known', 'bilinen']]) {
      const x = s[pk]; if (!x) continue;
      console.log(`  ${c} ${pn.padEnd(8)} ${x.days} gün · ${TRENDS.map((t) => x.share[t]).join(' / ')} · değişim ${x.changes} · trend dönemi ${x.trendRuns.n} (medyan ${x.trendRuns.medianDays} g; YUKARI ${x.runsBy[TRENDS[0]]?.runs ?? 0}, AŞAĞI ${x.runsBy[TRENDS[1]]?.runs ?? 0})`);
    }
    console.log(`  verdict: ${h.verdict}\n  checks: ${JSON.stringify(h.checks)}`);
  }
  const h2 = o.ht2;
  console.log('\n=== HT2 (bilgi) · alt sepet, BTC trend durumuna göre ===');
  if (!h2.available) console.log(`  ${h2.reason}`);
  else {
    console.log(`  ${d10(h2.start)} → ${d10(h2.end)} · havuz ${h2.coins} coin · sepet min/medyan/maks ${h2.basketSize.min}/${h2.basketSize.median}/${h2.basketSize.max}`);
    for (const [pk, pn] of [['indep', 'bağımsız'], ['known', 'bilinen']]) { const P = h2.periods[pk]; console.log(` ${pn}: ${P ? `${d10(P.from)} → ${d10(P.to)}` : '—'}`); if (P) { wHead(); wLine('toplam', P.total); wLine('long bacak', P.long); wLine('short bacak', P.short); } }
  }
  const st = o.states;
  if (st.btcVol) console.log(`\nBTC oynaklık gün payı (YÜKSEK / ORTA / DÜŞÜK): bağımsız ${st.btcVol.indep ? LEVELS.map((l) => st.btcVol.indep.share[l]).join(' / ') : '—'} · bilinen ${LEVELS.map((l) => st.btcVol.known.share[l]).join(' / ')}`);
  if (st.btcFunding) console.log(`BTC fonlama gün payı (YÜKSEK / ORTA / DÜŞÜK): ${LEVELS.map((l) => st.btcFunding.all.share[l]).join(' / ')} (${st.btcFunding.all.days} gün, değişim ${st.btcFunding.all.changes})`);

  console.log('\n=== Parça 2 · rejim haritası (betimsel; verdict yok; * = sonuçsuz) ===');
  const s4 = o.map.signals4h;
  console.log(` 4H sinyaller (ort. R, dolan n):${s4.available ? ` ${d10(s4.from)} → ${d10(s4.to)} · durumsuz ${JSON.stringify(s4.noState)}` : ` ${s4.reason}`}`);
  if (s4.available) {
    const tl = (lab, c) => console.log(`  ${lab.padEnd(24)} sinyal ${f(c.signals, 5)} n ${f(c.n, 5)}${c.inconclusive ? '*' : ' '} ort.R ${f(c.avgR)} ${ci(c.ci90)}`);
    tl('tümü', s4.all);
    for (const k of Object.values(ALIGN)) tl(k, s4.byAlign[k]);
    for (const [k, c] of Object.entries(s4.byDirTrend)) tl(k, c);
    for (const k of LEVELS) tl(`oynaklık ${k}`, s4.byVol[k]);
  }
  const wl = (lab, c) => console.log(`  ${lab.padEnd(24)} hafta ${f(c.weeks, 4)}${c.inconclusive ? '*' : ' '} ort% ${f(c.meanPct)} ${ci(c.ci90)}`);
  for (const [name, key, groups] of [['Momentum (eşit risk, hedge\'li, haftalık %)', 'momentum', [['trend', TRENDS], ['vol', LEVELS]]], ['Fonlama geliri (BTC + ETH R1, brüt haftalık %)', 'carry', [['trend', TRENDS], ['funding', LEVELS]]]]) {
    const m = o.map[key];
    console.log(` ${name}:${m.available ? ` ${d10(m.from)} → ${d10(m.to)}` : ` ${m.reason}`}`);
    if (!m.available) continue;
    wl('tümü', m.all);
    for (const [g, labels] of groups) for (const l of labels) wl(`${g} ${l}`, m[g][l]);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
