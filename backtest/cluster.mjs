// Ters gün yığılması tanısı (ön kayıt: docs/arastirma/on-kayit-ters-gun.md). Girdi: sweep.mjs'in yazdığı live-trades.json
// ("canlıya eşit" 3 kademeli satırın işlem dökümü). Çıktı: docs/backtest/cluster.json + konsol tablosu.
//   node backtest/cluster.mjs [--in docs/backtest/live-trades.json] [--out docs/backtest/cluster.json]
// S1 kayıpların günlere dağılımı · S2 aynı yönde ≤ N açık sınırı (bilgi) · S3 Pazartesi ↔ Salı–Cuma (tek birincil test).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capTrades } from './sweep.mjs';
import { TIMEFRAMES } from '../src/data/okx.js';

const DAY = 86400e3, NO_TRADE = new Set(['expired', 'missed', 'knife']);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isFilled = (t) => !!t.entryFill && t.R != null && !NO_TRADE.has(t.outcome);
export const closeTimeOf = (t) => t.time + ((t.waitBars || 1) + (t.bars || 0) + 1) * TIMEFRAMES[t.tf].ms;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);

/** Kapanış gününe göre günlük R toplamı → [{ day, R, n, stopsLong, stopsShort }] (tarih sıralı). */
export function dailyOf(trades) {
  const m = new Map();
  for (const t of trades.filter(isFilled)) {
    const k = dayOf(closeTimeOf(t));
    const d = m.get(k) || { day: k, R: 0, n: 0, loss: 0, stopsLong: 0, stopsShort: 0 };
    d.R += t.R; d.n++; if (t.R < 0) d.loss += t.R;
    if (t.outcome === 'stopped') { if (t.d === 1) d.stopsLong++; else d.stopsShort++; }
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Kapanış sırasına göre birikimli R'nin en büyük tepeden-dibe düşüşü. */
export function maxDrawdown(trades) {
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades.filter(isFilled).sort((a, b) => closeTimeOf(a) - closeTimeOf(b))) { eq += t.R; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq; }
  return dd;
}

/** En kötü ardışık `days` günlük pencere (kapanış gününe göre). */
export function worstWindow(daily, days = 7) {
  let worst = 0;
  for (let i = 0; i < daily.length; i++) {
    const end = Date.parse(daily[i].day), s = sum(daily.filter((d) => { const x = Date.parse(d.day); return x <= end && x > end - days * DAY; }), (d) => d.R);
    if (s < worst) worst = s;
  }
  return worst;
}

/** S1: en kötü %5 günün brüt kayıptaki payı + "ters gün" (aynı yönde ≥ minStops stop) sayımı. */
export function concentration(trades, { worstPct = 0.05, minStops = 5 } = {}) {
  const f = trades.filter(isFilled), daily = dailyOf(f), gross = sum(daily, (d) => d.loss);
  const k = Math.max(1, Math.round(daily.length * worstPct));
  const worst = [...daily].sort((a, b) => a.R - b.R).slice(0, k);
  const adv = daily.filter((d) => d.stopsLong >= minStops || d.stopsShort >= minStops), advSet = new Set(adv.map((d) => d.day));
  const rest = f.filter((t) => !advSet.has(dayOf(closeTimeOf(t))));
  return {
    n: f.length, days: daily.length, totalR: r2(sum(f, (t) => t.R)), avgR: r2(sum(f, (t) => t.R) / (f.length || 1)), grossLoss: r2(gross),
    worstDays: k, worstDaysR: r2(sum(worst, (d) => d.R)), worstDaysLossShare: gross ? r2(sum(worst, (d) => d.loss) / gross) : null,
    adverseDays: adv.length, adverseTrades: f.length - rest.length, adverseR: r2(sum(adv, (d) => d.R)), adverseLossShare: gross ? r2(sum(adv, (d) => d.loss) / gross) : null,
    exAdverse: { n: rest.length, avgR: rest.length ? r2(sum(rest, (t) => t.R) / rest.length) : null, totalR: r2(sum(rest, (t) => t.R)) },
    worstDayList: worst.slice(0, 8).map((d) => ({ day: d.day, R: r2(d.R), n: d.n, stopsLong: d.stopsLong, stopsShort: d.stopsShort })),
  };
}

/** S2: sınır satırı (dilim). */
export function capRow(trades, maxOpen) {
  const kept = maxOpen ? capTrades(trades, { maxOpen }) : trades, f = kept.filter(isFilled), daily = dailyOf(f);
  return { cap: maxOpen || null, n: f.length, avgR: f.length ? r2(sum(f, (t) => t.R) / f.length) : null, totalR: r2(sum(f, (t) => t.R)), maxDD: r2(maxDrawdown(f)),
    worstDay: r2(Math.min(0, ...daily.map((d) => d.R))), worst7d: r2(worstWindow(daily, 7)) };
}

/** Her işlemin karar anında aynı yönde açık (bekleyen + dolmuş) sayısı; sweep.mjs stackOf / capTrades ile aynı tanım. */
export function stackCounts(trades, expireHours = 24) {
  const ms = (t) => TIMEFRAMES[t.tf].ms, at = (t) => t.time + ms(t);
  const endOf = (t) => (t.entryFill ? closeTimeOf(t) : at(t) + expireHours * 3600e3);
  const open = { 1: [], [-1]: [] }, out = new Map();
  for (const t of [...trades].sort((a, b) => at(a) - at(b) || (b.score ?? 0) - (a.score ?? 0))) { const now = at(t); open[t.d] = open[t.d].filter((e) => e > now); out.set(t, open[t.d].length); open[t.d].push(endOf(t)); }
  return out;
}
/** Koşullu hedge (ön kayıt: on-kayit-kosullu-hedge.md): yığın ≥ k iken açılan işlemde R → hedgedR (k = 0: her işlem). hedgedR yoksa işlem olduğu gibi kalır. */
export function hedgeWhen(trades, k) {
  const c = stackCounts(trades); let hedged = 0, cost = 0;
  const out = trades.map((t) => { if (!isFilled(t) || t.hedgedR == null || c.get(t) < k) return t; hedged++; cost += t.hedgedR - t.R; return { ...t, R: t.hedgedR }; });
  return { trades: out, hedged, deltaR: cost };
}
export function hedgeRows(trades) {
  const row = (name, list, h = null) => ({ name, ...capRow(list, null), cap: undefined, hedged: h?.hedged ?? 0, hedgeDeltaR: h ? r2(h.deltaR) : 0 });
  const B = capTrades(trades, { maxOpen: 10 }), C = hedgeWhen(B, 8), D = hedgeWhen(trades, 8), E = hedgeWhen(trades, 0);
  return [row('A sınırsız', trades), row('B ≤ 10', B), row('C ≤ 10 + yığın ≥ 8 hedge', C.trades, C), row('D sınırsız + yığın ≥ 8 hedge', D.trades, D), row('E her işlem hedge', E.trades, E)];
}

const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const weekdayIdx = (t) => new Date(t.entryTime).getUTCDay();
const mean = (a) => (a.length ? sum(a, (t) => t.R) / a.length : null);
/** Ort. R farkı: Salı–Cuma − Pazartesi (dolum günü, UTC). */
export function mondayDiff(trades) {
  const f = trades.filter(isFilled), mon = f.filter((t) => weekdayIdx(t) === 1), oth = f.filter((t) => weekdayIdx(t) >= 2 && weekdayIdx(t) <= 5);
  const a = mean(mon), b = mean(oth);
  return { monN: mon.length, monAvg: r2(a), otherN: oth.length, otherAvg: r2(b), diff: a == null || b == null ? null : r2(b - a) };
}
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Güne göre bloklu bootstrap: dolum günleri yerine koyarak yeniden örneklenir → farkın %95 aralığı. */
export function mondayCi(trades, { iters = 5000, seed = 7 } = {}) {
  const f = trades.filter(isFilled), blocks = new Map();
  for (const t of f) { const k = dayOf(t.entryTime); if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(t); }
  const B = [...blocks.values()], rand = rng(seed), out = [];
  for (let i = 0; i < iters; i++) {
    const s = []; for (let j = 0; j < B.length; j++) s.push(...B[Math.floor(rand() * B.length)]);
    const d = mondayDiff(s).diff; if (d != null) out.push(d);
  }
  out.sort((a, b) => a - b);
  return out.length ? [r2(out[Math.floor(out.length * 0.025)]), r2(out[Math.floor(out.length * 0.975)])] : null;
}
export function weekdayTable(trades) {
  const f = trades.filter(isFilled);
  return WD.map((name, i) => { const a = f.filter((t) => weekdayIdx(t) === i); return { day: name, n: a.length, avgR: r2(mean(a)), totalR: r2(sum(a, (t) => t.R)) }; }).filter((x) => x.n);
}

export function analyze({ trades, split }) {
  const slices = { train: trades.filter((t) => t.time < split), valid: trades.filter((t) => t.time >= split), all: trades };
  const per = (fn) => Object.fromEntries(Object.entries(slices).map(([k, a]) => [k, fn(a)]));
  const mon = per(mondayDiff), ci = mondayCi(trades);
  const enough = mon.train.monN >= 100 && mon.valid.monN >= 100;
  const s3 = !enough ? 'sonuçsuz' : (mon.train.diff > 0 && mon.valid.diff > 0 && ci && ci[0] > 0 ? 'geçti (aday)' : 'geçmedi');
  return { s1: per(concentration), s2: per((a) => [null, 10, 5, 3].map((c) => capRow(a, c))), s3: { ...mon, ci95All: ci, verdict: s3 }, weekday: per(weekdayTable), hedge: per(hedgeRows) };
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const src = JSON.parse(fs.readFileSync(arg('in', 'docs/backtest/live-trades.json'), 'utf8'));
  const out = { name: src.name, split: src.split, source: { generatedAt: src.generatedAt, trades: src.trades.length }, generatedAt: Date.now(), ...analyze(src) };
  fs.writeFileSync(arg('out', 'docs/backtest/cluster.json'), JSON.stringify(out, null, 1));
  for (const k of ['train', 'valid', 'all']) {
    const c = out.s1[k];
    console.log(`\n[${k}] n ${c.n} · ${c.days} gün · toplam ${c.totalR}R · ort ${c.avgR}R · brüt kayıp ${c.grossLoss}R`);
    console.log(`  en kötü ${c.worstDays} gün: ${c.worstDaysR}R, brüt kaybın %${Math.round(c.worstDaysLossShare * 100)}'i · ters gün ${c.adverseDays} (işlem ${c.adverseTrades}, ${c.adverseR}R, kaybın %${Math.round(c.adverseLossShare * 100)}'i) · ters günler hariç n ${c.exAdverse.n} ort ${c.exAdverse.avgR}R`);
    console.table(out.s2[k]); console.table(out.weekday[k]);
    console.table(out.hedge[k]);
  }
  console.log('S3 Pazartesi:', JSON.stringify(out.s3));
  console.log('En kötü günler (tüm dönem):'); console.table(out.s1.all.worstDayList);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
