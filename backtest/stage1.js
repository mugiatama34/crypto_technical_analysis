// Aşama 1 (13.11, docs/arastirma/on-kayit.md "Aşama 1 — kesin tanımlar", bağlayıcı) — saf fonksiyonlar. Betik: backtest/stage1.mjs.
// H1: BTC'ye göre 28 günlük güç (üçte bir kuralı) · H4: yön başına açık plan sınırı (N = 3 / 5) · H5: komisyon modeli (a / b).
// Kural önermez; tablo + ön kayıtlı geçme ölçütüne göre pass alanları üretir.
import { TIMEFRAMES } from '../src/data/okx.js';
import { knifeGuardOf, confirmsTurn } from '../bot/plan.js';
import { stats, statsCi, meetsStrict, MIN_N } from './report.js';
import { stackOf } from './sweep.mjs';

export const DAY = 86400e3;
/** 28 gün = 168 × 4H mum (canlı momentum portföyü xsmom_l28 penceresi). */
export const LOOKBACK = 168;
/** Karar anında sıralanabilen en az coin sayısı (altı → "sıra yok", sinyal elenir). */
export const MIN_RANK_COINS = 10;
/** Dilim sınırları: geliştirme = son 12 ay (12 × 30 gün, run.mjs ay tanımı), kasa = ondan önceki 12 ay; bölünme aşama 0 ile aynı. */
export const SPLIT_DEFAULT = Date.UTC(2026, 6, 31, 4); // aşama 0 (docs/backtest/results.json meta.split) = 2026-07-31T04:00Z
export const SLICE_DAYS = 360;
/** H5 maliyet modelleri: (a) bugünkü (iki taraf %0,05 + %0,05 kayma), (b) Bybit standart: yapıcı %0,02, alıcı %0,055, kayma %0,05. */
export const COST_A = { feePct: 0.05, slipPct: 0.05, feeMakerPct: null };
export const COST_B = { feePct: 0.055, slipPct: 0.05, feeMakerPct: 0.02 };
export const CAP_NS = [3, 5];
export const OPEN_BUCKETS = ['0–2', '3–4', '5–9', '≥ 10'];
export const UNFILLED = new Set(['missed', 'expired', 'knife']);

/** Dilim sınırları: end (plan koşusu meta.endMs) → { kasa: [from, to), dev: [from, to], split }. */
export function slicesOf(endMs, split = SPLIT_DEFAULT, days = SLICE_DAYS) {
  const devFrom = endMs - days * DAY;
  return { dev: { from: devFrom, split, to: endMs }, kasa: { from: devFrom - days * DAY, to: devFrom } };
}
/** Plan zamanına (plan mumu açılışı, sweep ile aynı ölçek) göre dilim: 'train' | 'valid' | 'kasa' | null (dışarıda). */
export function sliceOf(time, s) {
  if (time >= s.dev.from && time <= s.dev.to) return time < s.dev.split ? 'train' : 'valid';
  if (time >= s.kasa.from && time < s.kasa.to) return 'kasa';
  return null;
}

/** Kapanıştan kapanışa n mumluk getiri: cs[i].close / cs[i − n].close − 1; i < n ya da fiyat yoksa null (geleceğe bakmaz: yalnız ≤ i). */
export function retOf(cs, i, n = LOOKBACK) {
  if (i == null || i < n || i >= cs.length) return null;
  const a = cs[i - n].close, b = cs[i].close;
  return a > 0 && b > 0 ? b / a - 1 : null;
}

/**
 * Yüzdelik sıra (artan): en düşük 0, en yüksek 1; eşitlerde ortalama konum. pct = (küçük sayısı + (eşit − 1) / 2) ÷ (M − 1).
 * values: Map(coin → değer). → Map(coin → pct). M < 2 → boş.
 */
export function pctRanks(values) {
  const arr = [...values.entries()], M = arr.length, out = new Map();
  if (M < 2) return out;
  for (const [c, v] of arr) {
    let lt = 0, eq = 0;
    for (const [, w] of arr) { if (w < v) lt++; else if (w === v) eq++; }
    out.set(c, (lt + (eq - 1) / 2) / (M - 1));
  }
  return out;
}

/**
 * Karar anında (plan mumu time'ın kapanışı) BTC'ye göre 28 günlük güç sırası. series: Map(coin → { candles, idx }) — evren coinleri
 * (BTC dahil olabilir; sıraya girmez). Sıraya girenler: o mumu ve ≥ lookback mum geçmişi olan BTC dışı coinler; BTC'nin de aynı
 * koşulu sağlaması gerekir. → { ranks: Map(coin → pct), m } | null (BTC yok ya da m < minCoins → "sıra yok").
 */
export function rankAt(time, series, { lookback = LOOKBACK, minCoins = MIN_RANK_COINS, btc = 'BTC' } = {}) {
  const b = series.get(btc);
  const rb = b ? retOf(b.candles, b.idx.get(time), lookback) : null;
  if (rb == null) return null;
  const vals = new Map();
  for (const [c, s] of series) {
    if (c === btc) continue;
    const r = retOf(s.candles, s.idx.get(time), lookback);
    if (r != null) vals.set(c, r - rb);
  }
  if (vals.size < minCoins) return null;
  return { ranks: pctRanks(vals), m: vals.size, rel: vals };
}

/** H1 kuralı: long yalnız üst üçte bir (sıra ≥ 2/3), short yalnız alt üçte bir (sıra ≤ 1/3). */
export const h1Ok = (d, pct) => (d === 1 ? pct >= 2 / 3 : pct <= 1 / 3);
/** H1 dilimi (tekdüzelik, bilgi amaçlı): uyumlu (kural geçer) / ters (karşı uçtaki üçte bir) / orta. */
export const h1Bucket = (d, pct) => (h1Ok(d, pct) ? 'aligned' : h1Ok(-d, pct) ? 'against' : 'middle');

/**
 * Planın sonuçlandığı an (ms; o mumun kapanışı): dolan → çıkış mumu kapanışı (t.time + (waitBars + bars + 1) × TF); dolmayan → motorun
 * bekleme döngüsünün bittiği mum (kaçtı: özgün TP1'e dokunan mum; bıçak: stop / teyit mumu ya da teyit penceresi sonu; süresi doldu:
 * son bekleme mumu). Motorla (simulateTrade) aynı sıra: önce dokunma, sonra kaçtı. plan: simüle edilen (yeniden kurulmuş) plan;
 * from: plan mumundan sonraki indeks; sim: simulateTrade sonucu.
 */
export function resolveEndOf(plan, cs, from, tf, o, sim) {
  const ms = TIMEFRAMES[tf].ms, t0 = cs[from - 1].time;
  if (sim.entryFill != null && !UNFILLED.has(sim.outcome) && sim.outcome !== 'invalid') return t0 + (sim.waitBars + sim.bars + 1) * ms;
  const endAt = (k) => cs[Math.min(Math.max(k, from - 1), cs.length - 1)].time + ms;
  if (plan.inZone || sim.outcome === 'invalid') return endAt(from);
  const d = plan.d, expireBars = Math.min(Math.ceil((o.expireHours * 3600e3) / ms), plan.expireBars ?? Infinity);
  const g = knifeGuardOf(o.knifeGuard), stopOf = (x) => (d === 1 ? x.low <= plan.stop : x.high >= plan.stop);
  const missAt = plan.missTp ?? plan.tp1;
  for (let k = from; k < cs.length && k < from + expireBars; k++) {
    const c = cs[k];
    if (d === 1 ? c.low <= plan.entry : c.high >= plan.entry) { // dokundu ama dolmadı → bıçak yolu
      if (!g || g.skip || stopOf(c)) return endAt(k);
      let kk = k + 1;
      for (; kk <= k + g.confirmBars && kk < cs.length; kk++) if (stopOf(cs[kk]) || confirmsTurn(cs[kk], cs[kk - 1], plan)) return endAt(kk);
      return endAt(kk - 1);
    }
    if (d === 1 ? c.high >= missAt : c.low <= missAt) return endAt(k);
  }
  return endAt(Math.min(from + expireBars, cs.length) - 1);
}

/**
 * H4 portföy sınırı: items [{ decided, d, score, end, key }] zaman sırasıyla (aynı anda yüksek puan önce, eşitse key); o an aynı yönde
 * kapanmamış (gönderilmiş, end > decided) plan sayısı ≥ N → atlanır. Yalnız alınanlar sayıma girer; sonuçlanan (end ≤ an) düşer.
 * N null → sınır yok (yalnız sayım). → { kept, skipped, openAt: Map(key → o anki açık sayısı) }.
 */
export function capOpen(items, N = null) {
  const sorted = [...items].sort((a, b) => a.decided - b.decided || (b.score ?? 0) - (a.score ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const open = { 1: [], [-1]: [] }, kept = [], skipped = [], openAt = new Map();
  for (const x of sorted) {
    const o = (open[x.d] = open[x.d].filter((e) => e > x.decided));
    openAt.set(x.key, o.length);
    if (N != null && o.length >= N) { skipped.push(x); continue; }
    o.push(x.end); kept.push(x);
  }
  return { kept, skipped, openAt };
}
/** "Girişte aynı yönde açık plan sayısı" dilimi. */
export const openBucket = (k) => (k <= 2 ? '0–2' : k <= 4 ? '3–4' : k <= 9 ? '5–9' : '≥ 10');

const brief = (s) => ({ n: s.n, avgR: s.n ? s.avgR : null, profitFactor: s.n ? s.profitFactor : null, totalR: s.totalR, ...(s.ci90 !== undefined ? { ci90: s.ci90 } : {}) });
/**
 * Bir satırın bir dilimdeki hücresi. A: maliyet (a) işlemleri ({ time, tf, d, outcome, R, waitBars, bars, entryFill, hedgedR?, hedgedROpen? }),
 * B: aynı sinyallerin maliyet (b) işlemleri. Geçme kararı (a) ile.
 */
export function cellOf(A, B) {
  const s = statsCi(A), hd = (k) => A.filter((t) => t[k] != null).map((t) => ({ ...t, R: t[k] }));
  const sb = stats(B);
  return {
    n: s.n, signals: A.length, avgR: s.n ? s.avgR : null, profitFactor: s.n ? s.profitFactor : null, winRate: s.n ? s.winRate : null, totalR: s.totalR,
    ci90: s.ci90, maxDD: s.n ? s.maxDD : null, worst7dR: s.n ? stackOf(A).worst7dR : null, inconclusive: s.n < MIN_N,
    hedged: brief(statsCi(hd('hedgedR'))), hedgedOpen: brief(statsCi(hd('hedgedROpen'))),
    long: brief(stats(A.filter((t) => t.d === 1))), short: brief(stats(A.filter((t) => t.d === -1))),
    cost: { a: s.n ? s.avgR : null, b: sb.n ? sb.avgR : null, nB: sb.n, profitFactorB: sb.n ? sb.profitFactor : null },
  };
}

/** H1 geçme: geliştirme = iki dilimde sıkı ölçüt (n ≥ 100, ort. R > 0, PF > 1,1); kasa = n ≥ 100, ort. R > 0, %90 GA alt ucu > −0,05, hedge'li (eski) ort. R ≥ 0. */
export function h1PassOf(row, lock) {
  const dev = meetsStrict(row.train, row.valid);
  const out = { dev, inconclusive: row.train.inconclusive || row.valid.inconclusive };
  if (!lock) return out;
  const k = row.kasa;
  out.kasa = !!(k.n >= MIN_N && k.avgR > 0 && k.ci90 && k.ci90[0] > -0.05 && k.hedged.n > 0 && k.hedged.avgR >= 0);
  out.kasaInconclusive = k.inconclusive;
  out.pass = dev && out.kasa;
  return out;
}

/** İyileşme oranı (kayıp büyüklüğünde): 1 − |satır| / |taban| (taban 0 → null). */
export const improvement = (row, base) => (base ? +(1 - Math.abs(row) / Math.abs(base)).toFixed(3) : null);
/** H4 tek dilim: n ≥ 100, ort. R ≥ taban, en kötü 7 gün ve maks. düşüş ≥ %30 iyileşme. */
export function h4SliceOf(c, b) {
  const w7 = improvement(c.worst7dR, b.worst7dR), dd = improvement(c.maxDD, b.maxDD);
  const ok = !!(c.n >= MIN_N && c.avgR != null && b.avgR != null && c.avgR >= b.avgR && w7 != null && w7 >= 0.3 && dd != null && dd >= 0.3);
  return { pass: ok, inconclusive: c.inconclusive, avgRvsBase: c.avgR != null && b.avgR != null ? +(c.avgR - b.avgR).toFixed(3) : null, worst7Impr: w7, maxDDImpr: dd };
}
export function h4PassOf(row, base, lock) {
  const train = h4SliceOf(row.train, base.train), valid = h4SliceOf(row.valid, base.valid);
  const out = { train, valid, dev: train.pass && valid.pass };
  if (!lock) return out;
  out.kasa = h4SliceOf(row.kasa, base.kasa);
  out.pass = out.dev && out.kasa.pass;
  return out;
}

/**
 * Satırlar → rapor (saf). rows: [{ key, coin, slice ('train'|'valid'|'kasa'), d, score, decided, end, A, B }]; rankOf(r) → { pct, m } | null.
 * lock false → 'kasa' dilimindeki satırlar yok sayılır ve çıktıda kasa alanı hiç olmaz.
 * → { rows: { base, h1, h4_3, h4_5, h1h4_5 }, pass, h1Info, h1Slices, h4Info }.
 */
export function analyze(rows0, { lock = false, rankOf = () => null, rowName = '' } = {}) {
  const SL = lock ? ['train', 'valid', 'kasa'] : ['train', 'valid'];
  const rows = rows0.filter((r) => SL.includes(r.slice)).map((r) => ({ ...r }));
  const h1Info = Object.fromEntries(SL.map((k) => [k, { signals: 0, btcExcluded: 0, noRank: 0, ranked: 0, kept: 0, coinsRankedMin: null, coinsRankedMax: null }]));
  for (const r of rows) {
    const inf = h1Info[r.slice]; inf.signals++; r.h1 = null;
    if (r.coin === 'BTC') { inf.btcExcluded++; continue; }
    const x = rankOf(r);
    if (!x) { inf.noRank++; continue; }
    r.pct = x.pct; inf.ranked++;
    inf.coinsRankedMin = Math.min(inf.coinsRankedMin ?? x.m, x.m); inf.coinsRankedMax = Math.max(inf.coinsRankedMax ?? x.m, x.m);
    r.h1 = h1Bucket(r.d, r.pct); if (r.h1 === 'aligned') inf.kept++;
  }
  // H4: iki ayrı akış — geliştirme (eğitim + doğrulama kesintisiz) ve kasa → geliştirme sonuçları lock 0 ve lock 1'de aynı.
  const cap = (list, N) => {
    const parts = [list.filter((r) => r.slice !== 'kasa'), list.filter((r) => r.slice === 'kasa')].map((x) => capOpen(x, N));
    return { kept: parts.flatMap((x) => x.kept), skipped: parts.flatMap((x) => x.skipped), openAt: new Map(parts.flatMap((x) => [...x.openAt])) };
  };
  const h1 = rows.filter((r) => r.h1 === 'aligned');
  const capRes = Object.fromEntries(CAP_NS.map((N) => [N, cap(rows, N)]));
  const openAt = cap(rows, null).openAt;
  const cellsOf = (list) => Object.fromEntries(SL.map((k) => { const x = list.filter((r) => r.slice === k); return [k, cellOf(x.map((r) => r.A), x.map((r) => r.B))]; }));
  const R = {
    base: { def: `taban: ${rowName}`, ...cellsOf(rows) },
    h1: { def: "H1: long yalnız sıra ≥ 2/3, short yalnız sıra ≤ 1/3 (28 gün, BTC'ye göre; BTC sinyalleri ve sıra yok elenir)", ...cellsOf(h1) },
    ...Object.fromEntries(CAP_NS.map((N) => [`h4_${N}`, { def: `H4: aynı yönde kapanmamış plan ≥ ${N} → atla`, ...cellsOf(capRes[N].kept) }])),
    h1h4_5: { def: 'ikincil (bilgi): H1 ∧ H4 (N = 5)', secondary: true, ...cellsOf(cap(h1, 5).kept) },
  };
  const pass = { h1: h1PassOf(R.h1, lock), ...Object.fromEntries(CAP_NS.map((N) => [`h4_${N}`, h4PassOf(R[`h4_${N}`], R.base, lock)])) };
  if (lock) pass.anyPassed = ['h1', ...CAP_NS.map((N) => `h4_${N}`)].filter((k) => pass[k].pass);
  const mini = (x) => { const s = stats(x.map((r) => r.A)); return { signals: x.length, n: s.n, avgR: s.n ? s.avgR : null, profitFactor: s.n ? s.profitFactor : null, inconclusive: s.n < MIN_N }; };
  const h1Slices = Object.fromEntries(['aligned', 'middle', 'against'].map((b) => [b, cellsOf(rows.filter((r) => r.h1 === b))]));
  const h4Info = {
    skipped: Object.fromEntries(CAP_NS.map((N) => [N, Object.fromEntries(SL.map((k) => [k, mini(capRes[N].skipped.filter((r) => r.slice === k))]))])),
    openAtEntry: Object.fromEntries(SL.map((k) => [k, Object.fromEntries(OPEN_BUCKETS.map((b) => [b, mini(rows.filter((r) => r.slice === k && openBucket(openAt.get(r.key)) === b))]))])),
  };
  return { rows: R, pass, h1Info, h1Slices, h4Info };
}
