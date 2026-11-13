// Aşama 0 teşhis (13.11, docs/arastirma/on-kayit.md D1–D4) — saf fonksiyonlar. Betik: backtest/diag.mjs.
// Kural önermez; tablo + ön kayıtlı karar kuralına göre verdict üretir.
import { atr as atrOf } from '../src/data/indicators.js';
import { fillOrder } from './engine.js';
import { mulberry32, CI_DEFAULTS, MIN_N } from './report.js';
import { htfTrendAt, htfOk } from '../src/scan/regime.js';

export const HORIZONS = [6, 12, 24];
export const DAY = 86400e3;

/** ATR(14) dizisi (Wilder; i. eleman yalnız 0..i mumlarından → geleceğe bakmaz). */
export const atrSeries = (cs) => atrOf(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), 14);

/**
 * İleri getiri (D1): i0 mumunun AÇILIŞINDAN piyasa girişi, stop/hedef yok; N mum (i0..i0+N−1) tutulur.
 * ret = d × (N. mumun kapanışı − giriş) / atr; mfe = lehe en büyük hareket (≥ 0), mae = aleyhe en büyük hareket (≥ 0, büyüklük).
 * Ufku veriyle dolmayan (i0+N−1 ≥ uzunluk) ya da atr ≤ 0 → null.
 */
export function forwardOf(cs, i0, d, atr, N) {
  if (!(atr > 0) || i0 < 0 || i0 + N - 1 >= cs.length) return null;
  const e = cs[i0].open;
  let fav = 0, adv = 0;
  for (let k = i0; k < i0 + N; k++) {
    const c = cs[k];
    const f = d === 1 ? c.high - e : e - c.low, a = d === 1 ? e - c.low : c.high - e;
    if (f > fav) fav = f; if (a > adv) adv = a;
  }
  return { ret: (d * (cs[i0 + N - 1].close - e)) / atr, mfe: fav / atr, mae: adv / atr };
}

/** Dizeden 32 bit tohum (FNV-1a) ^ taban tohum: sıra bağımsız, koşular arası aynı. */
export function seedOf(str, base = CI_DEFAULTS.seed) {
  let h = 0x811c9dc5;
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return (h ^ base) >>> 0;
}

/** Diziden yerine koymadan en çok K eleman (kısmi Fisher–Yates, rnd: [0,1) üreteci). */
export function sampleK(arr, K, rnd) {
  const a = [...arr], n = Math.min(K, a.length);
  for (let k = 0; k < n; k++) { const j = k + Math.floor(rnd() * (a.length - k)); [a[k], a[j]] = [a[j], a[k]]; }
  return a.slice(0, n);
}

/**
 * Plasebo A adayları: aynı seride sinyal mumu i'nin ±days günü içindeki mumlar (i hariç), ok(j) true olanlar.
 * Seçim yalnız zaman damgalarına ve ok'a bağlıdır (sinyalin sonucuna değil).
 */
export function placeboACandidates(cs, i, { days = 30, ok = () => true } = {}) {
  const t = cs[i].time, w = days * DAY, out = [];
  for (let j = i - 1; j >= 0 && t - cs[j].time <= w; j--) if (ok(j)) out.push(j);
  for (let j = i + 1; j < cs.length && cs[j].time - t <= w; j++) if (ok(j)) out.push(j);
  return out.sort((a, b) => a - b);
}

/**
 * Plasebo A-eğilim (13.11, bilgi amaçlı) aday koşulu: evren filtresiyle (sweep passes, htfTrend) AYNI kural — karar anında
 * (decidedMs) coin'in üst TF eğilimi htfOk(mode, htfTrendAt(...), d). h (üst TF serisi) yoksa passes gibi koşul uygulanmaz.
 */
export const trendMatch = (h, decidedMs, d, mode = 'with') => (!h ? true : htfOk(mode, htfTrendAt(h.hs, h.ms, decidedMs), d));

/**
 * Giriş gününe göre bloklu bootstrap: items [{ day, v }] → ort. v'nin %level aralığı [alt, üst] (sabit tohum; report.dayBlockCi ile
 * aynı yöntem, işlem dışı değerler için). < 2 gün ya da < 2 değer → null.
 */
export function blockCi(items, { reps = CI_DEFAULTS.reps, seed = CI_DEFAULTS.seed, level = CI_DEFAULTS.level } = {}) {
  const m = new Map();
  for (const x of items) { if (!Number.isFinite(x.v)) continue; const b = m.get(x.day) || { s: 0, n: 0 }; b.s += x.v; b.n++; m.set(x.day, b); }
  const blocks = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), D = blocks.length;
  if (D < 2 || blocks.reduce((a, b) => a + b.n, 0) < 2) return null;
  const rnd = mulberry32(seed), means = new Float64Array(reps);
  for (let r = 0; r < reps; r++) { let s = 0, n = 0; for (let j = 0; j < D; j++) { const b = blocks[(rnd() * D) | 0]; s += b.s; n += b.n; } means[r] = s / n; }
  means.sort();
  const q = (p) => means[Math.min(reps - 1, Math.max(0, Math.floor(p * reps)))];
  return [+q((1 - level) / 2).toFixed(3), +q(1 - (1 - level) / 2).toFixed(3)];
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
/** e-oranı = ΣMFE / ΣMAE (ΣMAE = 0 → null). */
export const eRatioOf = (rows) => { const a = rows.reduce((s, x) => s + x.mae, 0); return a > 0 ? r3(rows.reduce((s, x) => s + x.mfe, 0) / a) : null; };

/**
 * D1 hücresi: rows [{ day, sig: {ret,mfe,mae}, pla: [{ret,mfe,mae}] }] (yalnız ≥ 1 plasebo çekilişi olan sinyaller).
 * fark = sinyal − kendi plasebo ortalaması (sinyal başına), %90 aralık gün bloklu.
 */
export function d1Cell(rows, ciOpt = {}) {
  const sig = rows.map((x) => x.sig), pla = rows.flatMap((x) => x.pla);
  const diff = (k) => rows.map((x) => ({ day: x.day, v: x.sig[k] - mean(x.pla.map((p) => p[k])) }));
  const dm = (k) => r3(mean(diff(k).map((x) => x.v)));
  const n = rows.length;
  return {
    n, draws: pla.length, inconclusive: n < MIN_N,
    signal: { ret: r3(mean(sig.map((x) => x.ret))), mfe: r3(mean(sig.map((x) => x.mfe))), mae: r3(mean(sig.map((x) => x.mae))), eRatio: eRatioOf(sig) },
    placebo: { ret: r3(mean(pla.map((x) => x.ret))), mfe: r3(mean(pla.map((x) => x.mfe))), mae: r3(mean(pla.map((x) => x.mae))), eRatio: eRatioOf(pla) },
    diff: { ret: dm('ret'), retCi90: n ? blockCi(diff('ret'), ciOpt) : null, mfe: dm('mfe'), mfeCi90: n ? blockCi(diff('mfe'), ciOpt) : null, mae: dm('mae'), maeCi90: n ? blockCi(diff('mae'), ciOpt) : null },
  };
}

/** D1 karar kuralı (ön kayıt): en az bir ufukta, hem eğitimde hem doğrulamada fark (getiri) %90 aralığı alt ucu > 0. */
export function d1Verdict(train, valid, horizons = HORIZONS) {
  const pass = horizons.filter((N) => train[N]?.diff.retCi90?.[0] > 0 && valid[N]?.diff.retCi90?.[0] > 0);
  return { verdict: pass.length ? 'bilgi var' : 'yön bilgisi yok', horizonsPassed: pass, inconclusive: horizons.some((N) => train[N]?.inconclusive !== false || valid[N]?.inconclusive !== false) };
}

/**
 * D2: limit planın piyasa girişli eşi. Giriş = from mumunun açılışı × (1 + d × kayma) (simulateTrade'in piyasa yolu ile aynı);
 * stop, ara kademe (tpMid = özgün TP1) ve TP2 aynı; erken hedef (tp1) yeni girişe aynı % uzaklıkta (tp1 / limit giriş oranı).
 * Taşınan erken hedef ara kademeyi geçerse ara kademe yok (motordaki CE kuralı).
 */
export function marketPlanOf(plan, openPrice, slipPct) {
  const d = plan.d, e = openPrice * (1 + (d * slipPct) / 100);
  const tp1 = plan.missTp != null ? +(e * (plan.tp1 / plan.entry)).toPrecision(8) : plan.tp1;
  return { ...plan, inZone: true, tp1, ...(plan.tpMid && !(d * (plan.tpMid - tp1) > 0) ? { tpMid: null } : {}) };
}

/**
 * Yarı piyasa + yarı limit (iki yarım pozisyon, her biri 0,5R risk): R = 0,5 × R_piyasa + 0,5 × (limit dolduysa R_limit, yoksa 0).
 * Paydada tam 1R risk. filled(limit): limit yarısı doldu mu.
 */
export const halfHalfR = (rMarket, rLimit, limitFilled) => +(0.5 * rMarket + 0.5 * (limitFilled ? rLimit : 0)).toFixed(3);

/**
 * D3: stop mumundan (stopI) SONRAKİ N mumda (stopI+1..stopI+N) özgün TP1'e / girişe dönüş; stop ötesi en büyük aşım (R) stop
 * mumu dahil stopI..stopI+N. risk = d × (giriş − stop). Ufuk dolmazsa null.
 */
export function postStopOf(cs, stopI, d, { tp1, entry, stop }, N) {
  if (stopI + N >= cs.length) return null;
  const risk = d * (entry - stop);
  if (!(risk > 0)) return null;
  let tp1Hit = false, entryHit = false, ext = d === 1 ? cs[stopI].low : cs[stopI].high;
  for (let k = stopI + 1; k <= stopI + N; k++) {
    const c = cs[k];
    if (d === 1 ? c.high >= tp1 : c.low <= tp1) tp1Hit = true;
    if (d === 1 ? c.high >= entry : c.low <= entry) entryHit = true;
    ext = d === 1 ? Math.min(ext, c.low) : Math.max(ext, c.high);
  }
  return { tp1Hit, entryHit, overshootR: Math.max(0, d * (stop - ext)) / risk };
}

/**
 * D3 taban: dolum mumundan (fillI) itibaren N mum içinde (N = Infinity → seri sonu / maxBars) özgün TP1'e özgün stoptan ÖNCE
 * ulaşıldı mı. Aynı mumda ikisi → stop (motor gibi). Dolum mumu: limit dolumda alt TF sırası (fillOrder; 'tp' → ulaştı, 'stop' →
 * stop; alt TF yoksa yalnız stop sayılır); piyasa (teyit) dolumunda aynı mum kuralı. → true | false | null (ufuk dolmadı, olay yok).
 */
export function tp1BeforeStop(cs, fillI, d, plan, { tp1, stop }, N, { market = false, lower = null, ms = 0, maxBars = 200 } = {}) {
  const end = Math.min(cs.length - 1, fillI + Math.min(N, maxBars) - 1);
  const hitT = (c) => (d === 1 ? c.high >= tp1 : c.low <= tp1), hitS = (c) => (d === 1 ? c.low <= stop : c.high >= stop);
  for (let k = fillI; k <= end; k++) {
    const c = cs[k];
    if (k === fillI && !market) {
      if (!lower?.length) { if (hitS(c)) return false; continue; }
      const res = fillOrder({ ...plan, stop }, d, c.time, ms, lower, tp1);
      if (res === 'tp') return true;
      if (res === 'stop' || hitS(c)) return false; // 'none' + stop mumda: motor gibi stop (alt TF bu mumu kapsamıyorsa)
      continue;
    }
    if (hitS(c)) return false;
    if (hitT(c)) return true;
  }
  return Number.isFinite(N) && fillI + N - 1 > cs.length - 1 ? null : false;
}

/** Yüzdelikler (sıralı kopya, en yakın sıra). */
export function quantiles(a, ps = [0.5, 0.75, 0.9]) {
  if (!a.length) return Object.fromEntries(ps.map((p) => [`p${Math.round(p * 100)}`, null]));
  const s = [...a].sort((x, y) => x - y);
  return Object.fromEntries(ps.map((p) => [`p${Math.round(p * 100)}`, r3(s[Math.min(s.length - 1, Math.floor(p * s.length))])]));
}

/** D4: maliyet (R) = brüt ort. R − net ort. R (pozitif = maliyet getiriyi düşürüyor). */
export const costOf = (gross, net) => (gross == null || net == null ? null : r3(gross - net));
/** Stop mesafesi (%) dilimi. */
export const stopBucket = (pct) => (pct < 1.5 ? 'a < %1,5' : pct < 2.5 ? 'b %1,5–2,5' : pct < 4 ? 'c %2,5–4' : 'd > %4');
export const STOP_BUCKETS = ['a < %1,5', 'b %1,5–2,5', 'c %2,5–4', 'd > %4'];

/** Dilim/yön ayrımı: { train: { all, long, short }, valid: {...} } — fn(alt küme). */
export function splitDir(items, split, fn, timeOf = (x) => x.time, dOf = (x) => x.d) {
  const part = (a) => ({ all: fn(a), long: fn(a.filter((x) => dOf(x) === 1)), short: fn(a.filter((x) => dOf(x) === -1)) });
  return { train: part(items.filter((x) => timeOf(x) < split)), valid: part(items.filter((x) => timeOf(x) >= split)) };
}
