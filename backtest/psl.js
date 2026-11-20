// Ön kayıtlı ölçüm (saf kısım): "PSL AI" tarzı 8 ölçütlü gösterge puanı + 1D EMA50 ↔ EMA169 uyumu (docs/arastirma/on-kayit-psl-ai.md,
// Aşama A). Tanım / eşik / dönem / çıkış planı / maliyet ön kayıttan birebir; burada değiştirilmez. Betik: backtest/psl.mjs.
// Karar satırının simülasyonu motorun kendisi (engine.js simulateTrade: piyasa girişi, half_be, stop önce); yazarın muhasebesi ve
// 4 hedefli düzen için küçük saf simülatör (simulateExit; 'real' kipi motorla eşitliği testle kilitli). Dilim / ölçüt / kümelenme /
// hedge'li R depodaki işlevlerle (adx-short.js sliceStats, verdictOf, clusteringOf; sweep.mjs hedgeOf; liq.js coinSpread).
import { TIMEFRAMES } from '../src/data/okx.js';
import { rsi, atr, sma, ema, macd, stoch, adx } from '../src/data/indicators.js';
import { simulateTrade, BT_DEFAULTS } from './engine.js';
import { MIN_N } from './report.js';
import { sliceStats, verdictOf, clusteringOf, TRADED } from './adx-short.js';
import { hedgeOf } from './sweep.mjs';
import { coinSpread, VERDICT_TEXT } from './liq.js';

export const DAY = 86400e3;

export const PSL = {
  prereg: 'docs/arastirma/on-kayit-psl-ai.md',
  // [from, to): sinyal mumunun KAPANIŞ zamanı bu aralıkta (ön kayıt notu 20.11.2026)
  period: { from: Date.UTC(2024, 10, 20), to: Date.UTC(2026, 10, 20), label: '20.11.2024–20.11.2026 UTC (sinyal mumu kapanışı)' },
  tf: '4H', infoTf: '1H', top: 50, minN: MIN_N,
  threshold: 6, infoThresholds: [5, 7],
  warmBars: 300, warmDays: 200, // ısınma: sinyal mumunun önünde ≥ 300 mum; 1D şartı için sinyal anında ≥ 200 kapanmış 1D mum
  ind: { macd: [12, 26, 9], rsi: 14, stoch: [14, 3, 3], rvol: 20, rvolMin: 1.2, adx: 14, adxMin: 20, cci: 20, cciMax: 150, ema: [50, 169], atr: 14 },
  stopAtr: 1.5, tpR: [1, 2], tp1Portion: 0.5, ladderR: [1, 2, 3, 4],
  cost: { fee: 0.05, slip: 0.05 }, // % / taraf; fonlama 0
  authorCost: { fee: 0.025, slip: 0 }, // yazarın muhasebesi: gidiş-dönüş toplam %0,05, kayma yok
};

/** CCI (TradingView ta.cci, kaynak hlc3): (tp − SMA(tp, n)) ÷ (0,015 × ortalama mutlak sapma). Sapma 0 → null. */
export function cci(high, low, close, period = 20) {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const m = sma(tp, period);
  const out = new Array(tp.length).fill(null);
  for (let i = period - 1; i < tp.length; i++) {
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
    dev /= period;
    out[i] = dev > 0 ? (tp[i] - m[i]) / (0.015 * dev) : null;
  }
  return out;
}

/** Tüm göstergeler (mum dizisiyle aynı uzunlukta; ısınmada null). Her değer yalnız o mum ve öncesinden (nedensel). */
export function indicatorsOf(candles, p = PSL.ind) {
  const o = candles.map((c) => c.open), h = candles.map((c) => c.high), l = candles.map((c) => c.low), c = candles.map((x) => x.close), v = candles.map((x) => x.volume);
  const m = macd(c, ...p.macd), st = stoch(h, l, c, ...p.stoch), dmi = adx(h, l, c, p.adx), vs = sma(v, p.rvol);
  return {
    open: o, close: c, macd: m.macd, macdSig: m.signal, rsi: rsi(c, p.rsi), stochK: st.k,
    rvol: v.map((x, i) => (vs[i] > 0 ? x / vs[i] : null)), ema50: ema(c, p.ema[0]), ema169: ema(c, p.ema[1]),
    adx: dmi.adx, pdi: dmi.pdi, mdi: dmi.mdi, cci: cci(h, l, c, p.cci), atr: atr(h, l, c, p.atr),
  };
}

export const CRITERIA = ['macd', 'rsi', 'stoch', 'rvol', 'candle', 'ema', 'dmi', 'cci'];
const ok = (...xs) => xs.every((x) => x != null && Number.isFinite(x));
const sgn = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
/**
 * 8 ölçüt, her biri +1 (long), −1 (short) ya da 0 (hiçbiri / veri yok). Aralıklar AÇIK (sınır değeri hiçbir tarafa oy vermez):
 * MACD > / < sinyal · RSI (50, 70) / (30, 50) · %K (50, 80) / (20, 50) · göreli hacim > 1,2 ve yeşil / kırmızı mum · kapanış > / < açılış ·
 * EMA50 > / < EMA169 · ADX > 20 ve DI+ > / < DI− · CCI (0, 150) / (−150, 0).
 */
export function criteriaOf(x, p = PSL.ind) {
  const band = (val, lo, mid, hi) => (!ok(val) ? 0 : val > mid && val < hi ? 1 : val > lo && val < mid ? -1 : 0);
  return {
    macd: ok(x.macd, x.macdSig) ? sgn(x.macd, x.macdSig) : 0,
    rsi: band(x.rsi, 30, 50, 70),
    stoch: band(x.stochK, 20, 50, 80),
    rvol: ok(x.rvol, x.open, x.close) && x.rvol > p.rvolMin ? sgn(x.close, x.open) : 0,
    candle: ok(x.open, x.close) ? sgn(x.close, x.open) : 0,
    ema: ok(x.ema50, x.ema169) ? sgn(x.ema50, x.ema169) : 0,
    dmi: ok(x.adx, x.pdi, x.mdi) && x.adx > p.adxMin ? sgn(x.pdi, x.mdi) : 0,
    cci: band(x.cci, -p.cciMax, 0, p.cciMax),
  };
}
export const valuesAt = (ind, i) => Object.fromEntries(Object.keys(ind).map((k) => [k, ind[k][i]]));
/** Puan: { long, short, parts }. */
export function scoreOf(x, p = PSL.ind) {
  const parts = criteriaOf(x, p);
  const vals = Object.values(parts);
  return { long: vals.filter((s) => s === 1).length, short: vals.filter((s) => s === -1).length, parts };
}

/**
 * 1D EMA50 ↔ EMA169 yönü, T anında (ms) KAPANMIŞ son 1D mumdan: açılışı + 1 gün ≤ T olan son mum. Kapanmış mum sayısı < minDays ya da
 * EMA yok / eşit → 0. daily: { candles, e50, e169 }.
 */
export function dailyTrendAt(daily, T, minDays = PSL.warmDays) {
  const cs = daily?.candles;
  if (!cs?.length) return 0;
  let lo = 0, hi = cs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time + DAY <= T) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0 || k + 1 < minDays) return 0;
  const a = daily.e50[k], b = daily.e169[k];
  return ok(a, b) ? sgn(a, b) : 0;
}
export const dailyOf = (candles, p = PSL.ind) => { const c = candles.map((x) => x.close); return { candles, e50: ema(c, p.ema[0]), e169: ema(c, p.ema[1]) }; };

/** Sinyal yönü: büyük taraf ≥ eşik ve diğerinden büyük, (requireTrend ise) 1D yönü aynı → 1 / −1; yoksa 0. */
export function signalOf(score, threshold, trend, requireTrend = true) {
  if (score.long >= threshold && score.long > score.short && (!requireTrend || trend === 1)) return 1;
  if (score.short >= threshold && score.short > score.long && (!requireTrend || trend === -1)) return -1;
  return 0;
}

/** Plan seviyeleri sinyal mumunun kapanışından (sinyal anında bilinen): stop 1,5 ATR, hedefler k × (1,5 ATR). */
export function levelsOf(close, atrV, d, rs = PSL.tpR, stopAtr = PSL.stopAtr) {
  const dist = stopAtr * atrV;
  return { ref: close, dist, stop: close - d * dist, tps: rs.map((r) => close + d * r * dist) };
}

/** Karar satırı: motorun kendisi (piyasa girişi = sonraki mumun açılışı + kayma, half_be, stop önce, süre sınırı yok). */
export function engineOpts(cost = PSL.cost) {
  return { ...BT_DEFAULTS, feePct: cost.fee, slipPct: cost.slip, tpScheme: 'half_be', tp1Portion: PSL.tp1Portion, maxHoldBars: Infinity, knifeGuard: null, timeStop: null, fundingPct8h: 0, feeMakerPct: null };
}
export function simEngine(candles, i, d, atrV, tf, cost = PSL.cost) {
  const L = levelsOf(candles[i].close, atrV, d);
  const plan = { d, inZone: true, entry: L.ref, stop: L.stop, tp1: L.tps[0], tp2: L.tps[1], atr: atrV };
  const s = simulateTrade(plan, candles, i + 1, tf, engineOpts(cost));
  return { ...s, stop: L.stop, exitI: s.entryFill ? i + 1 + s.bars : null };
}

/**
 * Küçük saf çıkış simülatörü. scheme: 'half_be' (TP1'de %50 + stop girişe, kalan TP2) | 'ladder' (tam pozisyon, TPk geçilince stop
 * TP(k−1)'e, TP0 = giriş; son hedefte tam çıkış). acct: 'real' (stop fitille + kayma, aynı mumda stop + hedef → stop; TP1 mumunda taşınan
 * stop sonraki mumdan; motorla aynı) | 'author' (hedef fitille önce; stop yalnız KAPANIŞ stopun ötesindeyse, çıkış stop SEVİYESİNDEN;
 * aynı mumda TP1 + stop → TP1 sayılır, kalan taşınmış stopla aynı kapanışta değerlendirilir). Giriş = sonraki mumun açılışı (± kayma).
 * Veri biterse kalan son kapanıştan (açık kaldı: openAtEnd). Komisyon: 2 × fee × giriş ÷ risk (motorla aynı).
 */
export function simulateExit(candles, i, d, atrV, { scheme = 'half_be', acct = 'real', cost = acct === 'author' ? PSL.authorCost : PSL.cost, rs = scheme === 'ladder' ? PSL.ladderR : PSL.tpR, portion1 = PSL.tp1Portion } = {}) {
  const fillI = i + 1;
  if (fillI >= candles.length) return { outcome: 'expired', R: 0 };
  const L = levelsOf(candles[i].close, atrV, d, rs);
  const slip = cost.slip / 100, fee = cost.fee / 100;
  const entry = candles[fillI].open * (1 + d * slip);
  const risk = d * (entry - L.stop);
  if (!(risk > 0)) return { outcome: 'invalid', R: 0 };
  const Rof = (p) => (d * (p - entry)) / risk;
  const beyond = (px, lvl) => (d === 1 ? px <= lvl : px >= lvl);
  const reach = (c, lvl) => (d === 1 ? c.high >= lvl : c.low <= lvl);
  let stop = L.stop, portion = 1, R = 0, outcome = null, exitI = fillI, tp1Bars = null, firstTpBars = null, hits = 0;
  const stopOut = (k, px) => { R += portion * Rof(px); outcome = hits === 0 ? 'stopped' : 'tp1_be'; exitI = k; portion = 0; };
  // Hedefler (bu mumda dokunulanlar, sırayla). true → pozisyon kapandı.
  const targets = (c, k) => {
    if (scheme === 'half_be') {
      if (hits === 0 && reach(c, L.tps[0])) { R += portion1 * Rof(L.tps[0]); portion -= portion1; hits = 1; tp1Bars = firstTpBars = k - fillI + 1; stop = entry; }
      if (hits === 1 && reach(c, L.tps[1])) { R += portion * Rof(L.tps[1]); portion = 0; hits = 2; outcome = 'tp2'; exitI = k; return true; }
      return false;
    }
    while (hits < L.tps.length && reach(c, L.tps[hits])) {
      if (hits === 0) firstTpBars = k - fillI + 1;
      stop = hits === 0 ? entry : L.tps[hits - 1]; hits++;
    }
    if (hits === L.tps.length) { R += portion * Rof(L.tps[hits - 1]); portion = 0; outcome = 'tp2'; exitI = k; return true; }
    return false;
  };
  for (let k = fillI; k < candles.length && portion > 0; k++) {
    const c = candles[k];
    exitI = k;
    if (acct === 'real') {
      if (beyond(d === 1 ? c.low : c.high, stop)) { stopOut(k, stop * (1 - d * slip)); break; }
      if (targets(c, k)) break;
    } else {
      if (targets(c, k)) break;
      if (beyond(c.close, stop)) { stopOut(k, stop); break; }
    }
  }
  let openAtEnd = false;
  if (portion > 0) { const c = candles[candles.length - 1]; R += portion * Rof(c.close * (1 - d * slip)); outcome = hits === 0 ? 'timeout' : 'tp1_timeout'; exitI = candles.length - 1; openAtEnd = true; }
  R -= (fee * 2 * entry) / risk;
  return { outcome, R: +R.toFixed(3), bars: exitI - fillI, tp1Bars: scheme === 'half_be' ? tp1Bars : null, firstTpBars, hits, waitBars: 1, entryFill: +entry.toPrecision(6), stop: L.stop, exitI, openAtEnd };
}

/**
 * Bir seri için sinyaller + işlemler. Kilit: aynı coin + yönde açık işlem varken (sinyal mumu < çıkış mumu) yeni sinyal alınmaz; ters yön
 * serbest (mevcut işlem kapatılmaz). Isınma: i ≥ warmBars. Dönem: sinyal mumu kapanışı [from, to).
 * o: { coin, tf, ind, daily, threshold, requireTrend, period, sim: (i, d, atr) → sonuç, btc, hedgeFee, hedgePortion, signals (verilirse
 * kilit / puan hesabı yapılmaz, bu {i, d} listesi yeniden simüle edilir) }.
 * → { trades, signals: [{ i, d }] }.
 */
export function runSeries(candles, o) {
  const ms = TIMEFRAMES[o.tf].ms;
  const trades = [], signals = [];
  const mk = (i, d, score) => {
    const s = o.sim(i, d, o.ind.atr[i]);
    const t = { coin: o.coin, tf: o.tf, time: candles[i].time, closeTime: candles[i].time + ms, d, score, outcome: s.outcome, R: s.R, bars: s.bars, tp1Bars: s.tp1Bars ?? null, waitBars: s.waitBars ?? 1, entryFill: s.entryFill, stop: s.stop, openAtEnd: !!(s.openAtEnd || (s.entryFill && s.exitI === candles.length - 1 && ['timeout', 'tp1_timeout'].includes(s.outcome))), ...(s.hits != null ? { hits: s.hits } : {}) };
    if (s.entryFill) Object.assign(t, hedgeOf(t, o.btc, o.hedgeFee ?? PSL.cost.fee, o.hedgePortion ?? PSL.tp1Portion));
    trades.push(t);
    return s;
  };
  if (o.signals) { for (const g of o.signals) mk(g.i, g.d, g.score); return { trades, signals: o.signals }; }
  const openUntil = { 1: -1, [-1]: -1 };
  for (let i = o.warmBars ?? PSL.warmBars; i < candles.length - 1; i++) {
    const T = candles[i].time + ms;
    if (T < o.period.from || T >= o.period.to) continue;
    if (!(o.ind.atr[i] > 0)) continue;
    const sc = scoreOf(valuesAt(o.ind, i));
    const d = signalOf(sc, o.threshold, o.requireTrend ? dailyTrendAt(o.daily, T) : 0, o.requireTrend);
    if (!d || i < openUntil[d]) continue;
    const score = d === 1 ? sc.long : sc.short;
    const s = mk(i, d, score);
    signals.push({ i, d, score });
    openUntil[d] = s.exitI ?? i; // dolmadıysa (veri sonu) kilit yok
  }
  return { trades, signals };
}

/** Satır tanımları (karar + bilgi). split: 4H mum zamanı (açılış) ile karşılaştırılır → splitOf − TF ms. */
export const ROWS = {
  primary: { label: '4H · puan ≥ 6 · 1D EMA50/169 uyumu · gerçekçi (KARAR)', tf: '4H', threshold: 6, requireTrend: true, sim: 'engine' },
  primaryLong: { label: 'karar satırı · yalnız long (bilgi)', of: 'primary', test: (t) => t.d === 1 },
  primaryShort: { label: 'karar satırı · yalnız short (bilgi)', of: 'primary', test: (t) => t.d === -1 },
  thr5: { label: '4H · puan ≥ 5 · 1D uyumu (bilgi)', tf: '4H', threshold: 5, requireTrend: true, sim: 'engine' },
  thr7: { label: '4H · puan ≥ 7 · 1D uyumu (bilgi)', tf: '4H', threshold: 7, requireTrend: true, sim: 'engine' },
  noHtf: { label: '4H · puan ≥ 6 · üst TF şartı yok (bilgi)', tf: '4H', threshold: 6, requireTrend: false, sim: 'engine' },
  h1: { label: '1H · puan ≥ 6 · 1D uyumu (bilgi)', tf: '1H', threshold: 6, requireTrend: true, sim: 'engine' },
  author: { label: 'karar satırının sinyalleri · yazarın muhasebesi (stop kapanışla ama seviyeden, aynı mum TP1 + stop = kazanç, %0,05 toplam, kayma yok; bilgi)', tf: '4H', sameSignalsAs: 'primary', sim: 'author' },
  ladder4: { label: '4H · puan ≥ 6 · 1D uyumu · 4 hedef (1/2/3/4 R), stop bir önceki hedefe, TP4 tam çıkış · gerçekçi (bilgi)', tf: '4H', threshold: 6, requireTrend: true, sim: 'ladder' },
};

/** Satırın simülatörü. */
export function simFor(kind, candles, tf) {
  if (kind === 'engine') return (i, d, a) => simEngine(candles, i, d, a, tf);
  if (kind === 'author') return (i, d, a) => simulateExit(candles, i, d, a, { scheme: 'half_be', acct: 'author' });
  if (kind === 'ladder') return (i, d, a) => simulateExit(candles, i, d, a, { scheme: 'ladder', acct: 'real' });
  throw new Error(`simülatör yok: ${kind}`);
}

export const splitOf = (p) => p.from + ((p.to - p.from) * 2) / 3;
export const openCount = (ts) => ts.filter((t) => t.openAtEnd).length;

/** Rapor: rows = { primary: [...işlemler], thr5: [...], ... } (primaryLong / Short türetilir). */
export function pslReport(rows, period = PSL.period) {
  const split = splitOf(period);
  const groups = {};
  for (const [k, def] of Object.entries(ROWS)) {
    const ts = def.of ? (rows[def.of] || []).filter(def.test) : rows[k] || [];
    const tf = def.of ? ROWS[def.of].tf : def.tf;
    const s = sliceStats(ts, split - TIMEFRAMES[tf].ms);
    groups[k] = { label: def.label, tf, ...s, openAtEnd: openCount(ts), ...(k === 'primary' ? {} : { infoVerdict: verdictOf(s, PSL.minN).verdict }) };
  }
  const v = verdictOf(groups.primary, PSL.minN);
  const prim = rows.primary || [];
  const sp = split - TIMEFRAMES['4H'].ms;
  return {
    period, split, n: { signals: prim.length, filled: prim.filter((t) => TRADED.has(t.outcome)).length },
    verdict: v.verdict, result: VERDICT_TEXT[v.verdict], strict: v.strict, hedgedOk: v.hedgedOk, reasons: v.reasons, conclusion: v.conclusion,
    groups,
    clustering: { train: clusteringOf(prim.filter((t) => t.time < sp)), valid: clusteringOf(prim.filter((t) => t.time >= sp)), all: clusteringOf(prim), ...coinSpread(prim) },
  };
}

// ============================================================================================================================
// Aşama B — klon (ön kayıt "## Aşama B — klon", commit 6c499cb2). Tanım ön kayıttan birebir; burada değiştirilmez.
// ============================================================================================================================
export const CLONE = {
  threshold: 6, levelBars: 50, invAtr: 2, atrLen: 14, tpX: [1, 1.5, 2.5, 3.5],
  cost: { fee: 0.05, slip: 0.05 }, authorCost: { fee: 0.025, slip: 0 },
  // Klon doğrulaması: betik tablosundaki son 10 işlem (UTC+3 → UTC; mum açılış saati), BTC 4H
  validation: [
    ['2026-06-02T04:00Z', -1], ['2026-06-24T12:00Z', -1], ['2026-07-29T16:00Z', -1], ['2026-08-11T12:00Z', -1],
    ['2026-08-25T00:00Z', 1], ['2026-09-03T12:00Z', 1], ['2026-09-18T12:00Z', 1], ['2026-10-02T00:00Z', 1],
    ['2026-11-08T20:00Z', -1], ['2026-11-12T12:00Z', -1],
  ].map(([s, d]) => ({ time: Date.parse(s.replace('Z', ':00Z')), d })),
  panel: { bars: 3000, trades: 37, tp1Rate: 0.62 },
};

/** 1D mumlarından haftalık (Pazartesi 00:00 UTC) / aylık (takvim ayı UTC) mumlar; closeTime = dönemin bitişi. Kısmi dönem de mumdur. */
export function aggregate(daily, unit) {
  const keyOf = (t) => {
    if (unit === 'W') { const wk = Math.floor((Math.floor(t / DAY) + 3) / 7); const start = (wk * 7 - 3) * DAY; return [start, start + 7 * DAY]; }
    const d = new Date(t); return [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)];
  };
  const out = [];
  for (const c of daily) {
    const [start, end] = keyOf(c.time);
    const last = out[out.length - 1];
    if (last && last.time === start) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.volume += c.volume; }
    else out.push({ time: start, closeTime: end, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
  }
  return out;
}

const CRIT_FIELDS = { macd: ['macd', 'macdSig'], rsi: ['rsi'], stoch: ['stochK'], rvol: ['rvol', 'open', 'close'], candle: ['open', 'close'], ema: ['ema50', 'ema169'], dmi: ['adx', 'pdi', 'mdi'], cci: ['cci'] };
/** Hesaplanabilen ölçüt sayısı (göstergesi null olmayan). */
export const computableOf = (x) => Object.values(CRIT_FIELDS).filter((fs) => fs.every((f) => x[f] != null && Number.isFinite(x[f]))).length;
/** Üst TF yönü: büyük taraf +1 / −1, eşit ya da hiç hesaplanabilen ölçüt yoksa 0. */
export function htfDirOf(x) {
  if (!computableOf(x)) return 0;
  const s = scoreOf(x);
  return s.long > s.short ? 1 : s.short > s.long ? -1 : 0;
}
/** Üst TF serisi: { closeTimes, dirs } (her mumun kendi kapanışına kadarki veriyle). */
export function htfSeries(candles, closeTimeOf) {
  const ind = indicatorsOf(candles);
  return { closeTimes: candles.map(closeTimeOf), dirs: candles.map((_, i) => htfDirOf(valuesAt(ind, i))) };
}
/** T anında kapanmış son üst TF mumunun yönü (kapanışı ≤ T); yoksa 0. */
export function htfDirAt(s, T) {
  if (!s?.closeTimes.length) return 0;
  let lo = 0, hi = s.closeTimes.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.closeTimes[m] <= T) { k = m; lo = m + 1; } else hi = m - 1; }
  return k < 0 ? 0 : s.dirs[k];
}
/** 1G / 1H(afta) / 1A yön serileri (1D mumlarından). */
export function htfOf(daily) {
  return {
    D: htfSeries(daily, (c) => c.time + DAY),
    W: htfSeries(aggregate(daily, 'W'), (c) => c.closeTime),
    M: htfSeries(aggregate(daily, 'M'), (c) => c.closeTime),
  };
}
/** Uyum: üç üst TF'nin hepsi d yönünde. */
export const htfAligned = (htf, T, d) => ['D', 'W', 'M'].every((k) => htfDirAt(htf[k], T) === d);

/** Plan seviyeleri: seviye = i dahil son 50 mumun dibi (SAT) / tepesi (AL); geçersiz = seviye ± 2 ATR; hedefler seviyeden k × (2 ATR). */
export function clonePlanOf(candles, i, d, atrV, p = CLONE) {
  let lv = d === 1 ? -Infinity : Infinity;
  for (let j = Math.max(0, i - p.levelBars + 1); j <= i; j++) lv = d === 1 ? Math.max(lv, candles[j].high) : Math.min(lv, candles[j].low);
  const unit = p.invAtr * atrV;
  return { d, formedI: i, level: lv, unit, invalid: lv - d * unit, tps: p.tpX.map((x) => lv + d * x * unit) };
}

/**
 * Klon çıkışı: giriş = tetik mumu (ti) kapanışı ± kayma; kısmi yok; TP1 geçilince (fitil) stop TP1'e, TP3 geçilince TP2'ye, TP4'te tamamı.
 * Stop yalnız KAPANIŞ stopun ötesindeyse. acct 'real' (KARAR): önce mum başındaki stopa göre kapanış (aynı mumda hedef + stop → stop),
 * çıkış KAPANIŞ fiyatından − kayma; sonra hedefler; hedef sonrası kapanış taşınmış stopun ötesindeyse yine kapanıştan çıkış.
 * acct 'author': hedefler önce, sonra kapanış (taşınmış) stopun ötesindeyse çıkış stop SEVİYESİNDEN; aynı mumda TP1 + stop → kazanç.
 * R = (yönlü K/Z − 2 × komisyon × giriş) ÷ |seviye − geçersiz|. Veri biterse son kapanıştan (openAtEnd).
 */
export function simulateClone(candles, ti, plan, { acct = 'real', cost = acct === 'author' ? CLONE.authorCost : CLONE.cost } = {}) {
  const d = plan.d, slip = cost.slip / 100, fee = cost.fee / 100, unit = plan.unit;
  const entry = candles[ti].close * (1 + d * slip);
  const beyond = (px, lvl) => (d === 1 ? px < lvl : px > lvl);
  const reach = (c, lvl) => (d === 1 ? c.high >= lvl : c.low <= lvl);
  let stop = plan.invalid, hits = 0, exit = null, exitI = ti, outcome = null, firstTpBars = null;
  const moveOn = (c, k) => {
    while (hits < 4 && reach(c, plan.tps[hits])) {
      if (hits === 0) { stop = plan.tps[0]; firstTpBars = k - ti; } else if (hits === 2) stop = plan.tps[1];
      hits++;
    }
    if (hits === 4) { exit = plan.tps[3]; outcome = 'tp2'; exitI = k; return true; }
    return false;
  };
  const stopOut = (k, px) => { exit = px; outcome = hits ? 'tp1_be' : 'stopped'; exitI = k; };
  for (let k = ti + 1; k < candles.length; k++) {
    const c = candles[k];
    if (acct === 'real') {
      if (beyond(c.close, stop)) { stopOut(k, c.close * (1 - d * slip)); break; }
      if (moveOn(c, k)) break;
      if (beyond(c.close, stop)) { stopOut(k, c.close * (1 - d * slip)); break; }
    } else {
      if (moveOn(c, k)) break;
      if (beyond(c.close, stop)) { stopOut(k, stop); break; }
    }
  }
  let openAtEnd = false;
  if (exit == null) { exitI = candles.length - 1; exit = candles[exitI].close * (1 - d * slip); outcome = hits ? 'tp1_timeout' : 'timeout'; openAtEnd = true; }
  const R = (d * (exit - entry) - 2 * fee * entry) / unit;
  return { outcome, R: +R.toFixed(3), hits, entryFill: +entry.toPrecision(6), exitI, bars: exitI - ti, firstTpBars, openAtEnd, tp1Reached: hits >= 1 };
}

/**
 * Klon durum makinesi (tüm seri boyunca, ısınmadan sonra; nedensel: her adım yalnız kapanmış mumlar). Mum i kapanışında sırayla:
 * (1) açık işlem varsa çıkış mumuna kadar bekle (çıkış mumunun kapanışında yeni plan serbest); (2) bekleyen plan varsa önce iptal (4H yönü
 * terse döndü ya da üst TF uyumu bozuldu), sonra tetik (kapanış seviyenin ötesinde → giriş); (3) plan yoksa ve madde 1 + 2 sağlanıyorsa plan
 * oluşur ve kilitlenir. o: { tf, ind, htf, warmBars, acct }. → [{ plan, ti, sim }] (tetiklenen işlemler) + cancelled sayısı.
 */
export function runClone(candles, o) {
  const ms = TIMEFRAMES[o.tf || '4H'].ms, warm = o.warmBars ?? PSL.warmBars, accts = o.accts || ['real'];
  const out = [];
  let plan = null, busyUntil = -1, cancelled = 0;
  for (let i = warm; i < candles.length; i++) {
    if (i < busyUntil) continue;
    const T = candles[i].time + ms;
    const sc = scoreOf(valuesAt(o.ind, i));
    const dir = signalOf(sc, CLONE.threshold, 0, false);
    if (plan) {
      if (dir === -plan.d || !htfAligned(o.htf, T, plan.d)) { plan = null; cancelled++; }
      else if (d1Beyond(candles[i].close, plan)) {
        const sims = Object.fromEntries(accts.map((a) => [a, simulateClone(candles, i, plan, { acct: a })]));
        out.push({ plan, ti: i, sims });
        busyUntil = sims[accts[0]].exitI;
        plan = null;
        continue;
      }
    }
    if (!plan && dir && o.ind.atr[i] > 0 && htfAligned(o.htf, T, dir)) plan = clonePlanOf(candles, i, dir, o.ind.atr[i]);
  }
  return { trades: out, cancelled, pending: plan };
}
const d1Beyond = (close, plan) => (plan.d === 1 ? close > plan.level : close < plan.level);

/** Klon işlem kaydı (rapor işlevleri için). time = tetik mumundan bir önceki mumun açılışı ve waitBars 1 → hedgeOf'un BTC başlangıcı
 *  (closeAt(t0)) = tetik mumunun kapanışı = giriş anı; entryTime = tetik mumunun kapanışı. hedgeOf'a R birimi 2 ATR olacak stop verilir. */
export function cloneRecord(candles, coin, tf, x, acct, btc) {
  const ms = TIMEFRAMES[tf].ms, s = x.sims[acct], c = candles[x.ti];
  const t = { coin, tf, time: c.time - ms, entryTime: c.time + ms, trigTime: c.time, formedTime: candles[x.plan.formedI].time, d: x.plan.d, outcome: s.outcome, R: s.R, bars: s.bars, tp1Bars: null, waitBars: 1,
    entryFill: s.entryFill, level: x.plan.level, invalid: x.plan.invalid, stop: s.entryFill - x.plan.d * x.plan.unit, hits: s.hits, tp1Reached: s.tp1Reached, openAtEnd: s.openAtEnd };
  Object.assign(t, hedgeOf(t, btc, (acct === 'author' ? CLONE.authorCost : CLONE.cost).fee, 0));
  return t;
}

/** Klon doğrulaması: betik işlemleri ↔ klon işlemleri (aynı yön, tetik mumu açılışı ± 1 mum). */
export function cloneValidation(trades, ref = CLONE.validation, ms = 4 * 3600e3) {
  const used = new Set();
  const rows = ref.map((r) => {
    let best = null;
    trades.forEach((t, j) => { if (used.has(j) || t.d !== r.d) return; const db = Math.round((t.trigTime - r.time) / ms); if (Math.abs(db) <= 1 && (best == null || Math.abs(db) < Math.abs(best.db))) best = { j, db }; });
    if (best) used.add(best.j);
    return { time: r.time, d: r.d, found: !!best, diffBars: best ? best.db : null, cloneTrig: best ? trades[best.j].trigTime : null };
  });
  const lo = ref[0].time - ms, hi = ref[ref.length - 1].time + ms;
  const inWin = trades.map((t, j) => [t, j]).filter(([t]) => t.trigTime >= lo && t.trigTime <= hi);
  const extra = inWin.filter(([, j]) => !used.has(j)).map(([t]) => ({ trigTime: t.trigTime, d: t.d }));
  return { rows, matched: rows.filter((r) => r.found).length, of: ref.length, cloneInWindow: inWin.length, extra: extra.length, extraList: extra };
}

/** Klon raporu: karar = 'primary' (bizim muhasebe); bilgi = author, long, short. split: tetik mumu kapanışı → kayıt time (−2 mum). */
export function cloneReport(recs, period = PSL.period, tf = '4H') {
  const split = splitOf(period), sp = split - 2 * TIMEFRAMES[tf].ms;
  const inP = (ts) => ts.filter((t) => t.entryTime >= period.from && t.entryTime < period.to);
  const prim = inP(recs.real), au = inP(recs.author);
  const defs = {
    primary: ['klon · 4H · bizim muhasebe (KARAR)', prim],
    author: ['klon · aynı işlemler · yazarın muhasebesi (bilgi)', au],
    long: ['klon · bizim muhasebe · yalnız long (bilgi)', prim.filter((t) => t.d === 1)],
    short: ['klon · bizim muhasebe · yalnız short (bilgi)', prim.filter((t) => t.d === -1)],
  };
  const groups = {};
  for (const [k, [label, ts]] of Object.entries(defs)) {
    const s = sliceStats(ts, sp);
    groups[k] = { label, tf, ...s, openAtEnd: openCount(ts), tp1Rate: ts.length ? +(ts.filter((t) => t.tp1Reached).length / ts.length).toFixed(3) : null, ...(k === 'primary' ? {} : { infoVerdict: verdictOf(s, PSL.minN).verdict }) };
  }
  const v = verdictOf(groups.primary, PSL.minN);
  return {
    period, split, n: { trades: prim.length },
    verdict: v.verdict, result: VERDICT_TEXT[v.verdict], strict: v.strict, hedgedOk: v.hedgedOk, reasons: v.reasons, conclusion: v.conclusion,
    groups,
    clustering: { train: clusteringOf(prim.filter((t) => t.time < sp)), valid: clusteringOf(prim.filter((t) => t.time >= sp)), all: clusteringOf(prim), ...coinSpread(prim) },
  };
}
