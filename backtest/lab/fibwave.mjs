#!/usr/bin/env node
// Ön kayıtlı ölçüm: fib kesişiminde iç dalga sayımı (docs/arastirma/on-kayit-fib-dalga.md). Strateji testi değil, ETİKETİN
// ayırma gücü testi: fark = ort. R("itki 5'li ✓") − ort. R(diğerleri), TF başına (5m, 15m), eğitim 2/3 / doğrulama 1/3.
// Taban kurulum lab'deki fib_cluster_g (corrections.js) — aynı plan, yalnız her işleme iç sayım etiketi (tags) taşınır.
//   node backtest/lab/fibwave.mjs                         (tam koşu: ilk 50, 5m 6 ay, 15m 24 ay → docs/backtest/fib-wave.json)
//   node backtest/lab/fibwave.mjs --fixture --out /tmp/x  (sentetik veri, uçtan uca biçim denemesi)
//   --tfs 5m (ya da 15m): yalnız o TF; dosyadaki diğer TF sonucu korunur (iki ayrı koşu)
//   node backtest/lab/fibwave.mjs --coins BTC,ETH,SOL --days 5m:5,15m:10 --out /tmp/x   (küçük yerel deneme; sonuç YORUMLANMAZ)
// Sabitler ön kayıttan: komisyon %0,05 + kayma %0,05, fonlama %0,01 / 8 saat, dolum mumu 'skip'; düşük maliyet satırı
// (%0,02 + %0,01) aynı koşuda. Bootstrap: giriş gününe göre bloklu, %95.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../../src/data/okx.js';
import { getHistoryCached } from '../data.js';
import { BT_DEFAULTS } from '../engine.js';
import { stats, mulberry32, entryTimeOf, meetsStrict, MIN_N } from '../report.js';
import { runStrategy, attachBtc, hedgedReport } from './run.mjs';
import { fibClusterG } from './corrections.js';
import { WAVE_CLASSES } from '../../src/ew/innerCount.js';

const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'time_stop']);
export const FW = {
  tfs: ['5m', '15m'], months: { '5m': 6, '15m': 24 }, top: 50,
  cost: { fee: 0.05, slip: 0.05 }, lowCost: { fee: 0.02, slip: 0.01 }, funding: 0.01, fillbar: 'skip',
  boot: { reps: 2000, seed: 20261115, level: 0.95 }, minN: MIN_N,
};

/** Taban kurulum + etiket: fib_cluster_g ile aynı plan; o.waveTag → plan.tags = { k, imp, a, impM, aM }. */
export const fibWaveStrategy = { ...fibClusterG, id: 'fib_cluster_g_wave', label: `${fibClusterG.label} · iç dalga etiketi`, tfs: FW.tfs, o: { ...fibClusterG.o, waveTag: true } };

export const isPrimary = (t) => t.tags?.imp === 'five_ok';
const isAgood = (t) => t.tags?.a === 'five_ok' || t.tags?.a === 'three';

/**
 * İki grubun ort. R farkı (A − B) ve giriş gününe (UTC) göre bloklu bootstrap aralığı. Yalnız dolan işlemler; field: 'R' | 'hedgedR'.
 * Her örnekte günler yerine koyarak çekilir; fark = ΣR_A/n_A − ΣR_B/n_B (bir grup boş kalırsa örnek atlanır).
 */
export function diffCi(trades, inA, { reps = FW.boot.reps, seed = FW.boot.seed, level = FW.boot.level, field = 'R' } = {}) {
  const byDay = new Map();
  for (const t of trades) {
    const r = t[field];
    if (!TRADED.has(t.outcome) || !Number.isFinite(r)) continue;
    const k = Math.floor(entryTimeOf(t) / 86400e3);
    const b = byDay.get(k) || { sA: 0, nA: 0, sB: 0, nB: 0 };
    if (inA(t)) { b.sA += r; b.nA++; } else { b.sB += r; b.nB++; }
    byDay.set(k, b);
  }
  const blocks = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), D = blocks.length;
  const tot = blocks.reduce((a, b) => ({ sA: a.sA + b.sA, nA: a.nA + b.nA, sB: a.sB + b.sB, nB: a.nB + b.nB }), { sA: 0, nA: 0, sB: 0, nB: 0 });
  const diff = tot.nA && tot.nB ? +(tot.sA / tot.nA - tot.sB / tot.nB).toFixed(3) : null;
  if (diff == null || D < 2) return { diff, ci: null, nA: tot.nA, nB: tot.nB, days: D };
  const rnd = mulberry32(seed), ds = [];
  for (let r = 0; r < reps; r++) {
    let sA = 0, nA = 0, sB = 0, nB = 0;
    for (let j = 0; j < D; j++) { const b = blocks[(rnd() * D) | 0]; sA += b.sA; nA += b.nA; sB += b.sB; nB += b.nB; }
    if (nA && nB) ds.push(sA / nA - sB / nB);
  }
  ds.sort((a, b) => a - b);
  const q = (p) => ds[Math.min(ds.length - 1, Math.max(0, Math.floor(p * ds.length)))];
  return { diff, ci: ds.length ? [+q((1 - level) / 2).toFixed(3), +q(1 - (1 - level) / 2).toFixed(3)] : null, nA: tot.nA, nB: tot.nB, days: D, level };
}

const hedged = (ts) => ts.filter((t) => t.hedgedR != null).map((t) => ({ ...t, R: t.hedgedR }));
/** Grup özeti: n (dolan), sinyal, dolum oranı, ort. R, PF, hedge'li ort. R / PF — eğitim / doğrulama / hepsi. */
export function groupStats(trades, split) {
  const one = (ts) => { const s = stats(ts), h = stats(hedged(ts)); return { n: s.n, signals: s.signals, fillRate: s.fillRate, avgR: s.avgR, profitFactor: s.profitFactor, winRate: s.winRate, totalR: s.totalR, hedgedAvgR: h.avgR, hedgedPF: h.profitFactor, hedgedN: h.n }; };
  return { train: one(trades.filter((t) => t.time < split)), valid: one(trades.filter((t) => t.time >= split)), all: one(trades) };
}

/**
 * Ön kayıttaki ölçüt. primary: { train: diffCi, valid: diffCi }; A: "5'li ✓" grubunun groupStats'ı.
 * → { verdict: 'gecer'|'gecmez'|'sonucsuz', candidate, conclusion, reasons }
 */
export function verdictOf(primary, A, minN = FW.minN) {
  const reasons = [];
  if (!(A.train.n >= minN && A.valid.n >= minN)) {
    reasons.push(`"5'li ✓" dolan işlem eğitim ${A.train.n} / doğrulama ${A.valid.n} (< ${minN})`);
    return { verdict: 'sonucsuz', candidate: false, conclusion: 'sonuçsuz (n < 100)', reasons };
  }
  const ok = (d) => d && d.diff != null && d.diff > 0 && d.ci && d.ci[0] > 0;
  for (const k of ['train', 'valid']) { const d = primary[k]; if (!ok(d)) reasons.push(`${k === 'train' ? 'eğitim' : 'doğrulama'}: fark ${d?.diff ?? '–'} · %95 alt uç ${d?.ci?.[0] ?? '–'}`); }
  const pass = ok(primary.train) && ok(primary.valid);
  const strict = meetsStrict({ n: A.train.n, avgR: A.train.avgR, profitFactor: A.train.profitFactor }, { n: A.valid.n, avgR: A.valid.avgR, profitFactor: A.valid.profitFactor });
  const candidate = pass && strict && A.train.hedgedAvgR > 0 && A.valid.hedgedAvgR > 0;
  return { verdict: pass ? 'gecer' : 'gecmez', candidate, strictA: strict, conclusion: !pass ? 'etiket ayırmıyor (fikir kapanır)' : candidate ? 'kural adayı (aday; sonraki adım ileriye dönük kayıt)' : 'etiket bilgi taşıyor, işlem kenarı değil', reasons };
}

/** Bir TF'nin işlemleri → rapor (birincil + bilgi satırları). tradesLow: aynı koşunun düşük maliyetli işlemleri. */
export function tfReport(trades, tradesLow, split) {
  const tr = (ts) => ts.filter((t) => t.time < split), va = (ts) => ts.filter((t) => t.time >= split);
  const A = trades.filter(isPrimary), B = trades.filter((t) => !isPrimary(t));
  const groups = { five_ok: groupStats(A, split), others: groupStats(B, split) };
  const primary = { train: diffCi(tr(trades), isPrimary), valid: diffCi(va(trades), isPrimary) };
  const primaryHedged = { train: diffCi(tr(trades), isPrimary, { field: 'hedgedR' }), valid: diffCi(va(trades), isPrimary, { field: 'hedgedR' }) };
  const v = verdictOf(primary, groups.five_ok);
  const hA = hedgedReport(A, split);
  // Bilgi satırları (karar vermez)
  const classes = Object.keys(WAVE_CLASSES);
  const byClass = {};
  for (const c of [...classes, null]) {
    const ts = trades.filter((t) => (t.tags?.imp ?? null) === c);
    const key = c ?? 'etiketsiz';
    byClass[key] = { label: c ? WAVE_CLASSES[c] : 'etiket yok', all: groupStats(ts, split), long: groupStats(ts.filter((t) => t.direction === 'long'), split), short: groupStats(ts.filter((t) => t.direction === 'short'), split) };
  }
  const aOf = (t) => (t.tags?.a === 'five_ok' ? 'A five_ok' : t.tags?.a === 'three' ? 'A three' : 'A diğer');
  const byA = {};
  for (const k of ['A five_ok', 'A three', 'A diğer']) byA[k] = groupStats(trades.filter((t) => aOf(t) === k), split);
  const combo = (t) => isPrimary(t) && isAgood(t);
  const lowCost = { train: diffCi(tr(tradesLow), isPrimary), valid: diffCi(va(tradesLow), isPrimary), five_ok: groupStats(tradesLow.filter(isPrimary), split), others: groupStats(tradesLow.filter((t) => !isPrimary(t)), split) };
  return {
    n: { signals: trades.length, filled: trades.filter((t) => TRADED.has(t.outcome)).length },
    groups, primary, ...v,
    fiveOkHedged: { train: { n: hA.train.n, avgR: hA.train.avgR, profitFactor: hA.train.profitFactor, ci90: hA.train.ci90 }, valid: { n: hA.valid.n, avgR: hA.valid.avgR, profitFactor: hA.valid.profitFactor, ci90: hA.valid.ci90 } },
    info: {
      note: 'Bilgi satırları karar vermez; bunlardan seçim yapılmaz (ilginç çıkan yeni ön kayıt ister).',
      byClass, byA,
      combo: { label: "itki 5'li ✓ + A 5'li ✓ ya da 3'lü", group: groupStats(trades.filter(combo), split), rest: groupStats(trades.filter((t) => !combo(t)), split), train: diffCi(tr(trades), combo), valid: diffCi(va(trades), combo) },
      lowCost: { label: 'komisyon %0,02 + kayma %0,01', ...lowCost },
      primaryHedged,
    },
  };
}

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// --days 5m:5,15m:10 (yalnız küçük deneme): ay yerine gün; tam koşuda verilmez
const parseSpan = (s) => Object.fromEntries(String(s).split(',').map((x) => x.split(':')).filter((x) => x.length === 2).map(([tf, n]) => [tf.trim(), +n]));

async function main() {
  const t0 = Date.now();
  const CFG = { top: +arg('top', FW.top), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true, coins: arg('coins', '') ? String(arg('coins')).split(',').map((c) => c.trim().toUpperCase()) : null, days: arg('days', '') ? parseSpan(arg('days')) : null, tfs: arg('tfs', '') ? String(arg('tfs')).split(',').map((t) => t.trim()).filter((t) => FW.tfs.includes(t)) : FW.tfs };
  const trial = !!(CFG.fixture || CFG.coins || CFG.days || CFG.top !== FW.top);
  if (!trial && path.resolve(CFG.out) !== path.resolve('docs/backtest')) log(`çıktı klasörü: ${CFG.out}`);
  if (trial && path.resolve(CFG.out) === path.resolve('docs/backtest')) { console.error('Deneme koşusu (--fixture/--coins/--days/--top) docs/backtest\'e yazmaz: --out <geçici klasör> ver.'); process.exit(2); }
  const endMs = Date.now();
  let coins, fx = null;
  if (CFG.fixture) { ({ fixtureProvider: fx } = await import('../../src/data/fixture.js')); coins = await fx.topCoins(CFG.top); }
  else if (CFG.coins) coins = CFG.coins.map((c) => ({ coin: c, instId: instIdOf(c) }));
  else coins = await getTopCoins(CFG.top, {});
  const base = { ...BT_DEFAULTS, fundingPct8h: FW.funding, fillBarTp: FW.fillbar };
  const oMain = { ...base, feePct: FW.cost.fee, slipPct: FW.cost.slip }, oLow = { ...base, feePct: FW.lowCost.fee, slipPct: FW.lowCost.slip };
  const out = { meta: { prereg: 'docs/arastirma/on-kayit-fib-dalga.md', strategy: fibWaveStrategy.id, base: fibClusterG.id, trial, fixture: CFG.fixture, coins: coins.map((c) => c.coin), top: CFG.top, months: FW.months, days: CFG.days, cost: FW.cost, lowCost: FW.lowCost, funding: FW.funding, fillbar: FW.fillbar, bootstrap: { ...FW.boot, block: 'giriş günü (UTC)' }, minN: FW.minN, classes: WAVE_CLASSES, label: 'iç ZigZag eşiği = bulan k / 2 × sinyal anı ATR (src/ew/innerCount.js)', criterion: "fark = ort. R(itki 5'li ✓) − ort. R(diğerleri); geçer: eğitim ve doğrulamada fark > 0 ve %95 bloklu bootstrap alt ucu > 0, \"5'li ✓\" dilim başına n ≥ 100 (yoksa sonuçsuz); kural adayı: ayrıca \"5'li ✓\" sıkı ölçüt (iki dilimde ort. R > 0, PF > 1,1) ve hedge'li R iki dilimde > 0", generatedAt: null }, tfs: {} };
  if (trial) out.meta.warning = 'DENEME KOŞUSU: biçim kontrolü; sayılar yorumlanmaz (ön kayıt: sonuca tek bakış tam koşuda).';
  for (const tf of CFG.tfs) {
    const ts = Date.now();
    const span = CFG.days?.[tf] ? CFG.days[tf] * 86400e3 : FW.months[tf] * 30 * 86400e3, startMs = endMs - span;
    const need = Math.ceil(span / TIMEFRAMES[tf].ms);
    const fetchTf = async (instId) => (fx ? (await fx.candles(instId, tf, Math.min(need, 1500))).candles : getHistoryCached(instId, tf, startMs, endMs, { cacheDir: CFG.cacheDir }));
    const series = [];
    for (const c of coins) {
      try { const candles = await fetchTf(c.instId); if (candles.length >= 350) series.push({ coin: c.coin, tf, candles }); else log(`  ${c.coin} ${tf}: ${candles.length} mum (az, atlandı)`); }
      catch (err) { log(`  ${c.coin} ${tf}: ${err.message}`); }
    }
    let btc = series.find((s) => s.coin === 'BTC')?.candles;
    if (!btc) { try { btc = await fetchTf(fx ? 'BTC' : instIdOf('BTC')); } catch (err) { log(`  BTC ${tf}: ${err.message}`); } }
    const btcCloseAt = (_tf, time) => { const c = btc; if (!c?.length) return null; let lo = 0, hi = c.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].time <= time) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? c[k].close : null; };
    log(`${tf}: ${series.length} seri, veri ${Math.round((Date.now() - ts) / 1000)} sn`);
    if (!series.length) { out.tfs[tf] = { error: 'veri yok' }; continue; }
    const allTimes = series.flatMap((s) => [s.candles[0].time, s.candles[s.candles.length - 1].time]);
    const split = Math.min(...allTimes) + (Math.max(...allTimes) - Math.min(...allTimes)) * 2 / 3;
    const trades = [], low = [];
    for (const s of series) {
      trades.push(...runStrategy(fibWaveStrategy, s, oMain));
      low.push(...runStrategy(fibWaveStrategy, s, oLow));
    }
    attachBtc(trades, btcCloseAt, FW.cost.fee); attachBtc(low, btcCloseAt, FW.lowCost.fee);
    const rep = tfReport(trades, low, split);
    out.tfs[tf] = { split, startMs: Math.min(...allTimes), endMs: Math.max(...allTimes), series: series.length, ...rep, elapsedSec: Math.round((Date.now() - ts) / 1000) };
    log(`${tf}: ${trades.length} sinyal, ${rep.n.filled} dolan; "5'li ✓" n eğitim ${rep.groups.five_ok.train.n} / doğr. ${rep.groups.five_ok.valid.n} → ${rep.verdict} (${Math.round((Date.now() - ts) / 1000)} sn)`);
  }
  out.meta.generatedAt = Date.now(); out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(CFG.out, { recursive: true });
  // --tfs ile tek TF koşulduysa (ör. iş süresi sınırı yüzünden iki ayrı koşu) dosyadaki diğer TF'nin sonucu korunur
  const file = path.join(CFG.out, 'fib-wave.json');
  if (CFG.tfs.length < FW.tfs.length) { try { const prev = JSON.parse(fs.readFileSync(file, 'utf8')); if (!!prev.meta?.trial === trial) out.tfs = { ...prev.tfs, ...out.tfs }; } catch { /* yok */ } }
  out.meta.tfsRun = CFG.tfs;
  fs.writeFileSync(file, JSON.stringify(out));
  log(`Bitti: ${out.meta.elapsedSec} sn → ${path.join(CFG.out, 'fib-wave.json')}`);
}
// Doğrudan çalıştırma denetimi yol karşılaştırmasıyla (URL biçimi '~' gibi karakterleri farklı kodlayabiliyor)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
