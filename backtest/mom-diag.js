// Kesitsel momentum aşama M0 teşhis (13.11.2026; tanımlar docs/arastirma/on-kayit-momentum.md M0a–M0d, bağlayıcı) — saf
// fonksiyonlar (ağ yok). Betik: backtest/mom-diag.mjs. Kural önermez; tablo + ön kayıtlı karar kuralına göre verdict.
// YALNIZ geliştirme dilimi (DEV_START → bugün): kilitli dilimden (kasa-M) yalnız veri VARLIĞI sayılır (mum zaman damgaları;
// fiyat / getiri yok) — lockedAvailability. lockedLeaks() çıktıda kasa dönemine ait zaman alanı arar (betik yazmadan önce durur).
import * as I from '../src/data/indicators.js';
import { XS_DEFAULTS, XS_STRATEGIES, momentumAt, selectAt, quoteVolOf, slotsOf } from './lab/xsmom.js';
import { blockCi, seedOf, sampleK } from './diag.js';
import { mulberry32, CI_DEFAULTS } from './report.js';

export const DAY = 86400e3, WEEK = 7 * DAY, HOUR = 3600e3;
export const DEV_START = Date.UTC(2024, 10, 24); // geliştirme dilimi başı (pazar)
export const LOCK_START = Date.UTC(2022, 10, 24), LOCK_END = DEV_START; // kasa-M
export const LIVE_VARIANT = 'xsmom_l28_k5_short_rel';
export const ASSUMED_FUNDING_PCT8H = 0.01;
const MONDAY0 = Date.UTC(2024, 0, 1); // pazartesi 00:00 UTC (hafta ekseni)
/** Hafta = pazartesi açılışı → sonraki pazartesi açılışı (yeniden dengeleme girişleri pazartesi açılışında). */
export const weekOf = (t) => Math.floor((t - MONDAY0) / WEEK);
export const weekStartOf = (w) => MONDAY0 + w * WEEK;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const rd = (x, n = 3) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/** Seriler (1D) → { coin, c, atr, cum, idx } (runXsMom ile aynı hazırlık: ATR(14), kümülatif USDT hacim). */
export function prepSeries(seriesByCoin) {
  return seriesByCoin.map((s) => {
    const c = s.candles;
    const atr = I.atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14);
    const cum = [0]; for (const x of c) cum.push(cum[cum.length - 1] + (quoteVolOf(x) || 0));
    return { coin: s.coin, c, atr, cum, idx: new Map(c.map((x, i) => [x.time, i])) };
  });
}
const volAt = (s, i, n) => s.cum[i + 1] - s.cum[Math.max(0, i + 1 - n)];

/**
 * T günlük mumunun kapanışındaki sıralama (yalnız ≤ T mumları): ranks (runXsMom/selectAt girdisi; rel'de BTC − çıkarılmış, BTC
 * null) ve dönem evreni (pitN: o tarihteki son volDays günlük hacme göre ilk N). BTC yoksa (rel) null.
 */
export function universeAt(S, T, p, pitN = null) {
  let ranks = S.map((s) => { const i = s.idx.get(T); return i == null ? null : momentumAt(s.coin, s.c, i, s.atr, p, volAt(s, i, p.volDays)); });
  if (p.rank === 'rel') {
    const b = ranks.find((x) => x && x.coin === 'BTC');
    if (!b) return null;
    ranks = ranks.map((x) => (x && x.coin !== 'BTC' ? { ...x, r: x.r - b.r } : null));
  }
  let U = ranks.filter(Boolean);
  if (pitN) U = [...U].sort((a, b) => b.vol - a.vol).slice(0, pitN);
  return { ranks, universe: U };
}

/** Beşte birlik: evren sıralamaya göre artan (q 0 = en zayıf … 4 = en güçlü); q = ⌊sıra × 5 / n⌋. */
export function quintilesOf(universe) {
  const a = [...universe].sort((x, y) => x.r - y.r || (x.coin < y.coin ? -1 : 1)), n = a.length;
  return a.map((x, k) => ({ ...x, q: Math.floor((k * 5) / n) }));
}

/** T kapanışından T + days kapanışına getiri (stop / maliyet yok); mum yoksa null. */
export function fwdReturn(s, T, days = 7) {
  const i = s.idx.get(T), j = s.idx.get(T + days * DAY);
  if (i == null || j == null || !(s.c[i].close > 0)) return null;
  return s.c[j].close / s.c[i].close - 1;
}

/**
 * M0b haftası (T = dengeleme günü mumu, pazar): evren + beşte birlikler T'ye kadar veriyle; sonraki 7 günlük getiri evren
 * ortalamasına göre (%). weak = seçim kuralının (selectAt) short listesi; plasebo = aynı hafta evrenden rastgele aynı sayıda coin
 * (draws çekiliş, tohum = seedOf('m0b|T')). İleri getirisi olmayan coin (veri sonu) o haftanın hesabından düşer.
 */
export function m0bWeek(S, T, p, { pitN = null, draws = 1000, days = 7 } = {}) {
  const u = universeAt(S, T, p, pitN);
  if (!u || u.universe.length < 2 * p.k) return null;
  const sel = selectAt(u.ranks, p, { pitN });
  const byCoin = new Map(S.map((s) => [s.coin, s]));
  const fwd = new Map();
  for (const x of u.universe) { const r = fwdReturn(byCoin.get(x.coin), T, days); if (r != null) fwd.set(x.coin, r); }
  const uni = u.universe.filter((x) => fwd.has(x.coin));
  if (uni.length < 2 * p.k) return null;
  const uniMean = mean(uni.map((x) => fwd.get(x.coin)));
  const qs = quintilesOf(u.universe);
  const qDiff = [0, 1, 2, 3, 4].map((q) => { const v = qs.filter((x) => x.q === q && fwd.has(x.coin)).map((x) => fwd.get(x.coin)); return v.length ? (mean(v) - uniMean) * 100 : null; });
  const weak = (sel?.shorts || []).filter((c) => fwd.has(c));
  const weakDiff = weak.length ? (mean(weak.map((c) => fwd.get(c))) - uniMean) * 100 : null;
  const placebo = new Float64Array(weak.length ? draws : 0);
  if (weak.length) {
    const rnd = mulberry32(seedOf(`m0b|${T}`)), coins = uni.map((x) => x.coin);
    for (let j = 0; j < draws; j++) placebo[j] = (mean(sampleK(coins, weak.length, rnd).map((c) => fwd.get(c))) - uniMean) * 100;
  }
  return { T, week: weekOf(T + DAY), n: uni.length, nUniverse: u.universe.length, uniMeanPct: uniMean * 100, qDiff, weak, weakDiff, placebo };
}

/** Spearman (sıra korelasyonu) — x: 0..n−1, y: değerler (null yok). */
const spearman = (y) => {
  const n = y.length; if (n < 2) return null;
  const order = [...y.keys()].sort((a, b) => y[a] - y[b]), rk = new Array(n);
  order.forEach((k, r) => { rk[k] = r; });
  const d2 = rk.reduce((s, r, k) => s + (r - k) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
};

/** M0b dilim özeti: dilimler (fark %, %90 aralık hafta bloklu), zayıf-5 seçimi ve plasebodaki yeri, tekdüzelik, kural. */
export function m0bSlice(weeks, ci = {}) {
  const W = weeks.filter(Boolean);
  const cell = (vals) => { const it = vals.filter((x) => x.v != null); return { n: it.length, meanPct: rd(mean(it.map((x) => x.v))), ci90: blockCi(it.map((x) => ({ day: x.day, v: x.v })), ci) }; };
  const quintiles = [0, 1, 2, 3, 4].map((q) => cell(W.map((w) => ({ day: w.week, v: w.qDiff[q] }))));
  const weak = cell(W.map((w) => ({ day: w.week, v: w.weakDiff })));
  const PW = W.filter((w) => w.weakDiff != null && w.placebo.length);
  let placebo = null;
  if (PW.length) {
    const D = PW[0].placebo.length, dist = new Float64Array(D);
    for (let j = 0; j < D; j++) dist[j] = mean(PW.map((w) => w.placebo[j]));
    const actual = mean(PW.map((w) => w.weakDiff));
    const sorted = [...dist].sort((a, b) => a - b), q = (p) => sorted[Math.min(D - 1, Math.floor(p * D))];
    placebo = { draws: D, weeks: PW.length, actualPct: rd(actual), meanPct: rd(mean(sorted)), p5: rd(q(0.05)), p95: rd(q(0.95)), percentile: rd((dist.filter((x) => x <= actual).length / D) * 100, 1) };
  }
  const qm = quintiles.map((x) => x.meanPct);
  const full = qm.every((x) => x != null);
  const monotonic = full ? qm.every((x, k) => k === 0 || x > qm[k - 1]) : null;
  const infoRule = quintiles[0].ci90 ? quintiles[0].ci90[1] < 0 : false;
  return { weeks: W.length, quintiles, weak5: weak, placebo, monotonic, spearman: full ? rd(spearman(qm)) : null, infoRule };
}
export const m0bVerdict = (train, valid) => (train.infoRule && valid.infoRule ? 'bilgi var' : 'bilgi gösterilemedi');

// ---------------- Fonlama (M0c) ----------------
/**
 * OKX /public/funding-rate-history satırları → [{ time, rate }] (eskiden yeniye, tekil). rate = realizedRate (sayıysa), yoksa
 * fundingRate (8 saatlik değil, dönem başına kesir). Savunmacı: dizi değil / alan eksik → atlanır.
 */
export function parseFundingRows(data) {
  if (!Array.isArray(data)) return [];
  const m = new Map();
  for (const x of data) {
    if (!x || typeof x !== 'object') continue;
    const t = Number(x.fundingTime);
    const rr = x.realizedRate, rrN = rr === '' || rr == null ? NaN : Number(rr);
    const r = Number.isFinite(rrN) ? rrN : (x.fundingRate === '' || x.fundingRate == null ? NaN : Number(x.fundingRate));
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(r)) continue;
    m.set(t, r);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([time, rate]) => ({ time, rate }));
}
/** Fonlama aralığı (saat): ardışık zaman farklarının ortancası, en yakın 1 / 2 / 4 / 8 saate yuvarlanmaz (ham); < 2 satır → null. */
export function fundingIntervalH(rows) {
  if (!rows || rows.length < 2) return null;
  const d = []; for (let k = 1; k < rows.length; k++) d.push((rows[k].time - rows[k - 1].time) / HOUR);
  d.sort((a, b) => a - b);
  return +d[Math.floor(d.length / 2)].toFixed(2);
}
/** Dönem başına oran → 8 saatlik eşdeğer. */
export const to8h = (rate, intervalH) => (intervalH > 0 ? (rate * 8) / intervalH : null);
/** İşaretli fonlama maliyeti (kesir, + = öder): long pozitif oranda öder, short negatif oranda öder → d × rate. */
export const fundingCost = (d, rate) => d * rate;

/**
 * Bir pozisyonun gerçek fonlaması: (entryTime, exitTime] içindeki fonlama anları (pozisyon o anda açık). Kapsanan saat =
 * pozisyon ∩ [ilk anın bir aralık öncesi, son an]. → { events, cost (kesir, işaretli), hours } | null (kapsam yok).
 */
export function positionFunding({ d, entryTime, exitTime }, rows) {
  if (!rows || !rows.length) return null;
  const iv = fundingIntervalH(rows) || 8;
  const from = Math.max(entryTime, rows[0].time - iv * HOUR), to = Math.min(exitTime, rows[rows.length - 1].time);
  if (!(to > from)) return null;
  let cost = 0, events = 0;
  for (const x of rows) if (x.time > entryTime && x.time <= exitTime) { cost += fundingCost(d, x.rate); events++; }
  return { events, cost, hours: (to - from) / HOUR, intervalH: iv };
}

/**
 * M0c: pozisyon saatiyle ağırlıklı gerçek fonlama maliyeti (% / 8 saat, işaretli: + = öder) ↔ varsayılan (her iki yönde maliyet).
 * trades: [{ coin, direction|d, entryTime, exitTime }]; funding: Map coin → rows | null.
 * Kural (ön kayıt): gerçek maliyet > 2 × varsayılan → M1 öncesi fonlama modeli gerçek ortalamayla yeniden kurulur.
 */
export function m0cSummary(trades, funding, { assumed = ASSUMED_FUNDING_PCT8H } = {}) {
  let cost = 0, hours = 0, events = 0, used = 0, neg = 0, nEv = 0, sum8 = 0;
  const byCoin = new Map(), intervals = {};
  for (const t of trades) {
    const d = t.d ?? (t.direction === 'long' ? 1 : -1);
    const rows = funding.get(t.coin);
    const f = positionFunding({ d, entryTime: t.entryTime, exitTime: t.exitTime }, rows);
    if (!f || f.hours <= 0) continue;
    used++; cost += f.cost; hours += f.hours; events += f.events;
    for (const x of rows) if (x.time > t.entryTime && x.time <= t.exitTime) { nEv++; if (x.rate < 0) neg++; sum8 += to8h(x.rate, f.intervalH); }
    const b = byCoin.get(t.coin) || { coin: t.coin, intervalH: f.intervalH, trades: 0, hours: 0, cost: 0 };
    b.trades++; b.hours += f.hours; b.cost += f.cost; byCoin.set(t.coin, b);
  }
  for (const b of byCoin.values()) { const k = String(Math.round(b.intervalH)); intervals[k] = (intervals[k] || 0) + 1; }
  const coinsWithData = [...funding.values()].filter((r) => r && r.length).length;
  if (!used) return { available: false, verdict: 'veri yok', coinsRequested: funding.size, coinsWithData, tradesInWindow: 0, assumedPct8h: assumed };
  const costPct8h = (cost / hours) * 8 * 100;
  const ratio = costPct8h / assumed;
  return {
    available: true, coinsRequested: funding.size, coinsWithData, tradesInWindow: used, positionDays: rd(hours / 24, 1), events,
    costPct8h: rd(costPct8h, 4), assumedPct8h: assumed, ratio: rd(ratio, 2), meanRatePct8h: rd((sum8 / nEv) * 100, 4), negativeShare: rd(neg / nEv, 3),
    intervalsH: intervals,
    byCoin: [...byCoin.values()].sort((a, b) => b.hours - a.hours).slice(0, 40).map((b) => ({ coin: b.coin, intervalH: b.intervalH, trades: b.trades, days: rd(b.hours / 24, 1), costPct8h: rd((b.cost / b.hours) * 8 * 100, 4) })),
    verdict: ratio > 2 ? 'gerçek maliyet > 2 × varsayılan: M1 öncesi fonlama modeli gerçek ortalamayla yeniden kurulur' : 'gerçek maliyet ≤ 2 × varsayılan: varsayılan korunur',
  };
}

// ---------------- Haftalık portföy (M0d) ----------------
/** Günlük seride t anındaki fiyat: t gün başıysa o günün açılışı, gün içiyse o günün kapanışı (yaklaşık), mum yoksa önceki son kapanış. */
export function pxAt(s, t) {
  if (!s) return null;
  const day = Math.floor(t / DAY) * DAY, i = s.idx.get(day);
  if (i != null) return t === day ? s.c[i].open : s.c[i].close;
  let lo = 0, hi = s.c.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.c[m].time < t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 ? s.c[k].close : null;
}

/** İşlemin etkin çıkış anı: stop gün içinde (gün ortası), yeniden dengeleme çıkışı gün açılışında, dönem sonu kapanışı gün sonunda. */
export const exitEffOf = (t, dataEnd) => (t.outcome === 'stopped' ? t.exitTime + DAY / 2 : t.exitTime >= dataEnd ? t.exitTime + DAY : t.exitTime);

/**
 * İşlemleri haftalık parçalara böler (eşit nominal, her işlem 1 / slot; basit toplam = portfolioOf ile tutarlı). Hafta sınırında
 * fiyat = pazartesi açılışı. Parça getirisi d × (P₁ − P₀) / giriş; komisyon giriş ve çıkış haftasına, fonlama süreye orantılı;
 * bir işlemin parçalarının toplamı tam olarak işlemin ret'i. hedge: eşit nominal ters BTC bacağı (kayma iki taraf, komisyon iki
 * taraf, fonlama aynı varsayım); BTC fiyatı aynı anlarda (gün içi stop çıkışında o günün kapanışı, yaklaşık).
 * → { weeks: Map(w → { ret, hedged }), trades: [{ ...t, hedgeRet, hedgedR }] }
 */
export function splitWeekly(trades, byCoin, { slots, fee, slip, dataEnd, hedge = false }) {
  const weeks = new Map();
  const add = (w, k, v) => { const x = weeks.get(w) || { ret: 0, hedged: 0 }; x[k] += v / slots; weeks.set(w, x); };
  const btc = byCoin.get('BTC');
  const out = [];
  for (const t of trades) {
    const d = t.direction === 'long' ? 1 : -1, s = byCoin.get(t.coin);
    const e0 = t.entryTime, e1 = exitEffOf(t, dataEnd);
    const pts = [e0];
    for (let w = weekOf(e0) + 1; weekStartOf(w) < e1; w++) pts.push(weekStartOf(w));
    pts.push(e1);
    const px = pts.map((x, k) => (k === 0 ? t.entry : k === pts.length - 1 ? t.exit : pxAt(s, x) ?? t.entry));
    const gross = (d * (t.exit - t.entry)) / t.entry;
    const funding = gross - 2 * fee - t.ret; // runXsMom'un fonlaması (kalan)
    const span = Math.max(1, e1 - e0);
    const wExit = weekOf(e1 - 1);
    let hRet = null;
    for (let k = 0; k < pts.length - 1; k++) {
      const w = weekOf(pts[k]), share = (pts[k + 1] - pts[k]) / span;
      const v = (d * (px[k + 1] - px[k])) / t.entry - funding * share;
      add(w, 'ret', v); add(w, 'hedged', v);
    }
    add(weekOf(e0), 'ret', -fee); add(weekOf(e0), 'hedged', -fee);
    add(wExit, 'ret', -fee); add(wExit, 'hedged', -fee);
    if (hedge && btc) {
      const hd = -d;
      const bp = pts.map((x) => pxAt(btc, x));
      if (bp.every((x) => x > 0)) {
        const b0 = bp[0] * (1 + hd * slip), bEnd = bp[bp.length - 1] * (1 - hd * slip);
        const bpx = bp.map((x, k) => (k === 0 ? b0 : k === bp.length - 1 ? bEnd : x));
        hRet = (hd * (bEnd - b0)) / b0 - 2 * fee - funding;
        for (let k = 0; k < pts.length - 1; k++) add(weekOf(pts[k]), 'hedged', (hd * (bpx[k + 1] - bpx[k])) / b0 - funding * ((pts[k + 1] - pts[k]) / span));
        add(weekOf(e0), 'hedged', -fee); add(wExit, 'hedged', -fee);
      }
    }
    const risk = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : null;
    out.push({ ...t, hedgeRet: hRet == null ? null : rd(hRet, 5), hedgedR: hRet != null && risk > 0 ? rd((t.ret + hRet) / risk) : null });
  }
  return { weeks, trades: out };
}

/** Haftalık getiri serisi (%), w0..w1 arası tüm haftalar (pozisyonsuz hafta = 0). */
export function weeklySeries(weeksMap, w0, w1) {
  const a = [];
  for (let w = w0; w <= w1; w++) { const x = weeksMap.get(w) || { ret: 0, hedged: 0 }; a.push({ w, start: weekStartOf(w), ret: x.ret * 100, hedged: x.hedged * 100 }); }
  return a;
}

/** Haftalık istatistik: ort. %, %90 aralık (hafta bloklu bootstrap), yıllık Sharpe (ort / sd × √52), maks. düşüş (% birikimli toplam). */
export function weeklyStats(weeks, field = 'ret', ci = {}) {
  const v = weeks.map((x) => x[field]).filter(Number.isFinite), n = v.length;
  if (!n) return { weeks: 0, meanPct: null, ci90: null, sharpe: null, maxDDPct: null, totalPct: null };
  const m = mean(v), sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  let eq = 0, peak = 0, dd = 0;
  for (const x of v) { eq += x; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq; }
  return { weeks: n, meanPct: rd(m), ci90: blockCi(weeks.filter((x) => Number.isFinite(x[field])).map((x) => ({ day: x.w, v: x[field] })), ci), sharpe: sd > 0 ? rd((m / sd) * Math.sqrt(52), 2) : null, maxDDPct: rd(dd, 2), totalPct: rd(eq, 2) };
}
const tradeStats = (tr, field = 'R') => { const v = tr.map((t) => t[field]).filter(Number.isFinite); return { n: v.length, avgR: rd(mean(v)), winRate: v.length ? rd(v.filter((x) => x > 0).length / v.length) : null }; };

/** Bir varyantın geliştirme dilimi raporu: eğitim / doğrulama (+ hedge'li). */
export function variantReport(trades, byCoin, { slots, fee, slip, dataEnd, split, hedge = false, ci = {} }) {
  const sw = splitWeekly(trades, byCoin, { slots, fee, slip, dataEnd, hedge });
  if (!trades.length) return { trades: 0, train: null, valid: null };
  const w0 = weekOf(Math.min(...trades.map((t) => t.entryTime))), w1 = weekOf(dataEnd);
  const ser = weeklySeries(sw.weeks, w0, w1);
  const part = (wk, tr) => ({ weekly: weeklyStats(wk, 'ret', ci), trades: tradeStats(tr), ...(hedge ? { hedgedWeekly: weeklyStats(wk, 'hedged', ci), hedgedTrades: tradeStats(tr, 'hedgedR') } : {}) });
  return {
    trades: trades.length, firstWeek: weekStartOf(w0), lastWeekPartial: weekStartOf(w1) + WEEK > dataEnd + DAY,
    train: part(ser.filter((x) => x.start < split), sw.trades.filter((t) => t.time < split)),
    valid: part(ser.filter((x) => x.start >= split), sw.trades.filter((t) => t.time >= split)),
    all: part(ser, sw.trades),
    _weekly: ser, _trades: sw.trades,
  };
}

// ---------------- Kasa veri varlığı (yalnız sayım) ----------------
/**
 * Kilitli dilimde her dengeleme gününde (pazar) verisi olan coin sayısı. timesByCoin: Map coin → mum zaman damgaları (fiyat YOK).
 * eligible = o gün mumu var ve öncesinde ≥ minBars mum (momentumAt koşulu: lookback + minHistory). Dönen tarihler metin.
 */
export function lockedAvailability(timesByCoin, { from = LOCK_START, to = LOCK_END, minBars = XS_DEFAULTS.lookback + XS_DEFAULTS.minHistory, minCoins = 20 } = {}) {
  const sets = [...timesByCoin.entries()].filter(([c]) => c !== 'BTC').map(([, ts]) => { const a = [...ts].sort((x, y) => x - y); return { a, set: new Map(a.map((t, k) => [t, k])) }; });
  let T = from; while (new Date(T).getUTCDay() !== 0) T += DAY;
  const rows = [];
  for (; T < to; T += WEEK) {
    let withCandle = 0, eligible = 0;
    for (const s of sets) { const k = s.set.get(T); if (k == null) continue; withCandle++; if (k >= minBars) eligible++; }
    rows.push({ date: iso(T), withCandle, eligible });
  }
  const el = rows.map((r) => r.eligible).sort((a, b) => a - b);
  const firstOk = rows.find((r) => r.eligible >= minCoins);
  return { pool: sets.length, minCoins, minBars, rebalances: rows.length, eligibleMin: el[0] ?? 0, eligibleMedian: el.length ? el[Math.floor(el.length / 2)] : 0, eligibleMax: el.at(-1) ?? 0,
    below: rows.filter((r) => r.eligible < minCoins).length, firstDateAtLeast: firstOk ? firstOk.date : null, byDate: rows };
}

/** Çıktıda kilitli döneme ait zaman alanı (adı time/Time/start/end/week… olan, DEV_START'tan önceki sayı ya da tarih metni) → yollar. */
export function lockedLeaks(obj, allow = ['lockedAvailability', 'slices'], path = '') {
  const out = [];
  const isTimeKey = (k) => /time|Time|start|Start|^end|End|^T$|week|Week|date|Date|day|Day/.test(k);
  const walk = (o, p) => {
    if (o == null || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (allow.includes(k)) continue;
      const q = p ? `${p}.${k}` : k;
      if (typeof v === 'number' && isTimeKey(k) && v > 1e12 && v < DEV_START) out.push(q);
      else if (typeof v === 'string' && isTimeKey(k) && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 10) < iso(DEV_START)) out.push(q);
      else if (typeof v === 'object') walk(v, q);
    }
  };
  walk(obj, path);
  return out;
}

// ---------------- M0a canlı ↔ backtest ----------------
/** Canlı karar günü: yeniden dengeleme anından önceki son KAPANMIŞ günlük mum (pazartesi turunda pazar mumu). */
export const decisionDayOf = (t) => Math.floor(t / DAY) * DAY - DAY;

/** momentum.json → bacaklar (kapanan işlemler + açık pozisyonlar; hedge ayrı işaretli), eskiden yeniye. */
export function liveLegs(mom) {
  const closed = (mom.trades || []).map((t) => ({ coin: t.coin, d: t.direction === 'long' ? 1 : -1, hedge: !!t.hedge, open: false, entryTime: t.entryTime, exitTime: t.exitTime, entry: t.entry, exit: t.exit, notional: t.notional, pnl: t.pnl, pct: t.pct, R: t.R, reason: t.reason, funding: t.funding || 0, fee: t.fee || 0, stop: null }));
  const open = (mom.positions || []).map((q) => ({ coin: q.coin, d: q.direction === 'long' ? 1 : -1, hedge: !!q.hedge, open: true, entryTime: q.entryTime, exitTime: mom.updatedAt, entry: q.entry, exit: q.price, notional: q.notional, pnl: q.pnl, pct: q.pct, R: null, reason: 'açık', funding: q.funding || 0, fee: 0, stop: q.stop ?? null }));
  return [...closed, ...open].sort((a, b) => a.entryTime - b.entryTime || (a.coin < b.coin ? -1 : 1));
}

/** Yeniden dengeleme seçimleri: canlı short/long listesi ↔ backtest seçimi (selectFn(T) → { longs, shorts } | null) aynı karar gününde. */
export function compareSelections(rebalances, selectFn) {
  return [...(rebalances || [])].sort((a, b) => a.time - b.time).map((r) => {
    const T = decisionDayOf(r.time), bt = selectFn(T);
    const L = new Set([...(r.shorts || []), ...(r.longs || [])]), B = new Set(bt ? [...bt.shorts, ...bt.longs] : []);
    return { time: r.time, decisionDay: T, weekday: new Date(T).getUTCDay(), live: [...L], bt: bt ? [...B] : null, common: [...L].filter((c) => B.has(c)), onlyLive: [...L].filter((c) => !B.has(c)), onlyBt: [...B].filter((c) => !L.has(c)), equity: r.equity, hedgeNotional: r.hedgeNotional ?? null };
  });
}

/**
 * Canlı ↔ backtest işlem eşleştirme: aynı coin + aynı giriş günü (UTC) + aynı yön. live: liveLegs (hedge hariç), bt: runXsMom işlemleri.
 * → { rows: [{ coin, entryDay, live, bt, diff }], onlyLive, onlyBt }
 */
export function matchTrades(live, bt, { from = -Infinity } = {}) {
  const key = (coin, t, d) => `${coin}|${Math.floor(t / DAY) * DAY}|${d}`;
  const B = new Map();
  for (const t of bt) if (t.entryTime >= from) B.set(key(t.coin, t.entryTime, t.direction === 'long' ? 1 : -1), t);
  const rows = [], onlyLive = [], used = new Set();
  for (const l of live.filter((x) => !x.hedge)) {
    const k = key(l.coin, l.entryTime, l.d), b = B.get(k);
    const liveRiskPct = l.R ? rd(Math.abs(l.pct / l.R), 2) : l.stop ? rd((Math.abs(l.stop - l.entry) / l.entry) * 100, 2) : null;
    const L = { entryTime: l.entryTime, exitTime: l.exitTime, entry: l.entry, exit: l.exit, pct: l.pct, R: l.R, reason: l.reason, open: l.open, notional: l.notional, riskPct: liveRiskPct, stopNow: l.stop };
    if (!b) { onlyLive.push({ coin: l.coin, entryDay: Math.floor(l.entryTime / DAY) * DAY, live: L }); continue; }
    used.add(k);
    const btRiskPct = rd((Math.abs(b.entry - b.stop) / b.entry) * 100, 2);
    rows.push({ coin: l.coin, entryDay: Math.floor(l.entryTime / DAY) * DAY, live: L,
      bt: { entryTime: b.entryTime, exitTime: b.exitTime, entry: b.entry, exit: b.exit, stop: b.stop, pct: rd(b.ret * 100, 2), R: b.R, outcome: b.outcome, riskPct: btRiskPct, hedgeRet: b.hedgeRet ?? null },
      diff: { entryPct: rd((l.entry / b.entry - 1) * 100, 2), exitPct: l.open ? null : rd((l.exit / b.exit - 1) * 100, 2), sameExitDay: l.open ? null : Math.floor(l.exitTime / DAY) === Math.floor(b.exitTime / DAY), retPts: l.open ? null : rd(l.pct - b.ret * 100, 2), riskPts: liveRiskPct != null ? rd(liveRiskPct - btRiskPct, 2) : null } });
  }
  const onlyBt = [...B.entries()].filter(([k]) => !used.has(k)).map(([, b]) => ({ coin: b.coin, entryDay: Math.floor(b.entryTime / DAY) * DAY, bt: { entryTime: b.entryTime, exitTime: b.exitTime, entry: b.entry, exit: b.exit, pct: rd(b.ret * 100, 2), R: b.R, outcome: b.outcome } }));
  return { rows, onlyLive, onlyBt };
}

/**
 * Canlı K/Z ayrışması (USDT). Kimlik (tam): özsermaye − başlangıç = kapanan short + açık short + açık hedge + yeniden boyutlama
 * gerçekleşeni (realized − Σ kapanan işlem K/Z; yayında ayrı kayıt yok: hedge ve short küçültmeleri). Brüt kalemler:
 * short bacaklar (K/Z + komisyon + fonlama; kayma fiyatın içinde), hedge (BTC yolundan TAHMİN: anlık görüntüler arası adet sabit),
 * komisyon, fonlama (tahakkuk, varsayılan oran), açıklanamayan = toplam − diğerleri. btcAt(t) → BTC fiyatı.
 */
export function liveDecomposition(mom, btcAt, { slipPct = 0.05 } = {}) {
  const legs = liveLegs(mom);
  const total = mom.equity - mom.startEquity;
  const closed = legs.filter((l) => !l.open), open = legs.filter((l) => l.open);
  const sumOf = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const shortsClosedNet = sumOf(closed.filter((l) => !l.hedge), (l) => l.pnl);
  const hedgeClosedNet = sumOf(closed.filter((l) => l.hedge), (l) => l.pnl);
  const shortsOpenNet = sumOf(open.filter((l) => !l.hedge), (l) => l.pnl);
  const hedgeOpenNet = sumOf(open.filter((l) => l.hedge), (l) => l.pnl);
  const resizeRealized = mom.realized - sumOf(closed, (l) => l.pnl);
  const fees = sumOf(legs, (l) => l.fee), funding = sumOf(legs, (l) => l.funding);
  const shortsGross = sumOf(legs.filter((l) => !l.hedge), (l) => l.pnl + l.fee + l.funding);
  const slipEst = sumOf(legs, (l) => l.notional * (slipPct / 100) * (l.open ? 1 : 2));
  // Hedge tahmini: açık hedge bacağı (giriş fiyatı E; yalnız küçültüldüyse E değişmez) + yeniden dengeleme anlık görüntüleri
  const h = (mom.positions || []).find((q) => q.hedge);
  let hedgeEst = null;
  if (h && btcAt) {
    const E = h.entry, d = h.direction === 'long' ? 1 : -1;
    const n0 = sumOf(legs.filter((l) => !l.hedge && l.entryTime <= h.entryTime && l.exitTime > h.entryTime), (l) => l.notional);
    const snaps = [...(mom.rebalances || [])].filter((r) => r.time > h.entryTime && r.hedgeNotional != null).sort((a, b) => a.time - b.time);
    const pts = [{ time: h.entryTime, px: E, notional: n0 }, ...snaps.map((r) => ({ time: r.time, px: btcAt(r.time), notional: r.hedgeNotional })), { time: mom.updatedAt, px: h.price, notional: h.notional }];
    if (pts.every((p) => p.px > 0)) {
      let pnl = 0; const steps = [];
      for (let k = 1; k < pts.length; k++) { const q = pts[k - 1].notional / E, v = d * q * (pts[k].px - pts[k - 1].px); pnl += v; steps.push({ from: pts[k - 1].time, to: pts[k].time, notional: rd(pts[k - 1].notional, 2), btcFrom: rd(pts[k - 1].px, 1), btcTo: rd(pts[k].px, 1), pnl: rd(v, 2) }); }
      hedgeEst = { grossUsd: rd(pnl, 2), steps, initialNotionalEst: rd(n0, 2), note: 'yaklaşık: ilk nominal = hedge açılışında açık short nominalleri toplamı; anlık görüntüler arasındaki (%20 sapma) ayarlamalar yok sayıldı' };
    }
  }
  const hedgeGross = hedgeEst ? hedgeEst.grossUsd : null;
  const unexplained = hedgeGross == null ? null : total - (shortsGross + hedgeGross - fees - funding);
  const pct = (x) => (x == null ? null : rd((x / mom.startEquity) * 100, 2));
  return {
    totalUsd: rd(total, 2), totalPct: pct(total),
    identity: { shortsClosedNet: rd(shortsClosedNet, 2), hedgeClosedNet: rd(hedgeClosedNet, 2), shortsOpenNet: rd(shortsOpenNet, 2), hedgeOpenNet: rd(hedgeOpenNet, 2), resizeRealized: rd(resizeRealized, 2), check: rd(shortsClosedNet + hedgeClosedNet + shortsOpenNet + hedgeOpenNet + resizeRealized - total, 2) },
    components: { shortsGross: rd(shortsGross, 2), hedgeGrossEst: hedgeGross, fees: rd(-fees, 2), funding: rd(-funding, 2), unexplained: rd(unexplained, 2) },
    componentsPct: { shortsGross: pct(shortsGross), hedgeGrossEst: pct(hedgeGross), fees: pct(-fees), funding: pct(-funding), unexplained: pct(unexplained) },
    slippageEstUsd: rd(-slipEst, 2), hedge: hedgeEst,
  };
}

/** Canlı bacakların gerçek fonlaması (USDT, + = ödenen) ↔ tahakkuk edilen. funding: Map coin → rows. */
export function liveRealFunding(legs, funding) {
  let charged = 0, real = 0, covered = 0, n = 0;
  for (const l of legs) {
    charged += l.funding || 0;
    const f = positionFunding({ d: l.d, entryTime: l.entryTime, exitTime: l.exitTime }, funding.get(l.coin));
    if (!f) continue;
    n++; real += f.cost * l.notional; covered += l.funding || 0;
  }
  return n ? { legs: n, chargedUsd: rd(charged, 3), chargedCoveredUsd: rd(covered, 3), realUsd: rd(real, 3) } : { legs: 0, verdict: 'veri yok' };
}

/** Canlı haftalık özsermaye değişimi (% başlangıç) ↔ backtest haftalık (aynı haftalar). */
export function liveVsBtWeekly(mom, btWeekly) {
  const snaps = [...(mom.rebalances || [])].sort((a, b) => a.time - b.time).map((r) => ({ time: r.time, equity: r.equity }));
  snaps.push({ time: mom.updatedAt, equity: mom.equity });
  const rows = [];
  for (let k = 1; k < snaps.length; k++) {
    const a = snaps[k - 1], b = snaps[k];
    const a0 = Math.floor(a.time / DAY) * DAY, b0 = Math.floor(b.time / DAY) * DAY;
    const ws = btWeekly.filter((x) => x.start < b0 && x.start + WEEK > a0); // canlı aralığa değen bt haftaları (kısmi hafta tam sayılır)
    rows.push({ from: a.time, to: b.time, livePct: rd(((b.equity - a.equity) / mom.startEquity) * 100, 2), btPct: ws.length ? rd(ws.reduce((s, x) => s + x.ret, 0), 2) : null, btHedgedPct: ws.length ? rd(ws.reduce((s, x) => s + x.hedged, 0), 2) : null, btWeeks: ws.length });
  }
  return rows;
}

// ---------------- Hepsi ----------------
/**
 * Saf uçtan uca: girdiler hazır (ağ yok). series: [{ coin, candles }] (1D, YALNIZ ≥ DEV_START; hacme göre bugünkü sırayla),
 * lockedTimes: Map coin → zaman damgaları (kasa varlık sayımı), live: momentum.json | null, btcHourly: 1H BTC mumları | null,
 * funding: Map coin → rows | null, now. → { meta, m0a, m0b, m0c, m0d }
 */
export function runAll({ series, lockedTimes = new Map(), live = null, btcHourly = null, funding = new Map(), now, pool = 150, fee = 0.05, slip = 0.05, fundingPct8h = ASSUMED_FUNDING_PCT8H, draws = 1000, ci = {}, meta = {} }) {
  for (const s of series) if (s.candles.length && s.candles[0].time < DEV_START) throw new Error(`kasa verisi girdi: ${s.coin}`);
  const lp = live?.params || {};
  const livePool = lp.universe || 80, pitN = lp.pitN || 50;
  const withBtc = (a) => (a.some((s) => s.coin === 'BTC') ? a : [...a, ...series.filter((s) => s.coin === 'BTC')]);
  const s150 = withBtc(series.slice(0, pool)), s80 = withBtc(series.slice(0, livePool));
  const dataEnd = Math.max(...series.map((s) => s.candles.at(-1)?.time ?? 0));
  const end = Math.min(now, dataEnd + DAY);
  const split = DEV_START + ((end - DEV_START) * 2) / 3;
  const o = { feePct: fee, slipPct: slip, fundingPct8h };
  const btcDaily = series.find((s) => s.coin === 'BTC')?.candles || null;
  const S150 = prepSeries(s150), by150 = new Map(S150.map((s) => [s.coin, s]));
  const f = fee / 100, sl = slip / 100;

  // M0d: 7 varyant, havuz 150, pitN 50
  const m0d = { def: { pool: s150.length, pitN, unit: 'haftalık portföy getirisi %, eşit nominal (her işlem 1/slot), basit toplam; komisyon + kayma + fonlama (varsayılan) dahil', week: 'pazartesi açılışı → pazartesi açılışı; pozisyonsuz hafta 0', ci: { method: 'hafta bloklu bootstrap, ort. haftalık %', reps: ci.reps ?? CI_DEFAULTS.reps, seed: ci.seed ?? CI_DEFAULTS.seed, level: 0.9 }, sharpe: 'ort / sd × √52', hedge: `yalnız canlı varyant (${LIVE_VARIANT}): her işleme eşit nominal ters BTC (kayma + komisyon iki taraf, fonlama varsayılan)` }, variants: {} };
  let baseTrades = [];
  for (const st of XS_STRATEGIES) {
    const trades = st.run(s150.map((s) => ({ coin: s.coin, candles: s.candles })), o, { btcDaily, startMs: DEV_START, pitN });
    const isLive = st.id === LIVE_VARIANT;
    const rep = variantReport(trades, by150, { slots: slotsOf(st.params), fee: f, slip: sl, dataEnd, split, hedge: isLive, ci });
    if (isLive) baseTrades = rep._trades || [];
    const { _weekly, _trades, ...pub } = rep;
    m0d.variants[st.id] = { label: st.label, live: isLive, slots: slotsOf(st.params), ...pub };
  }

  // M0b: canlı parametreler (l28, rel, K 5, short), havuz 150, pitN 50
  const pLive = { ...XS_DEFAULTS, lookback: lp.lookback || 28, k: lp.k || 5, side: lp.side || 'short', rank: lp.rank || 'rel', stopAtr: lp.stopAtr || 3 };
  const weeks = [];
  for (let T = DEV_START; T + 7 * DAY <= dataEnd; T += DAY) if (new Date(T).getUTCDay() === 0) weeks.push(m0bWeek(S150, T, pLive, { pitN, draws }));
  const W = weeks.filter(Boolean);
  const bTrain = m0bSlice(W.filter((w) => w.T < split), ci), bValid = m0bSlice(W.filter((w) => w.T >= split), ci);
  const m0b = { def: { universe: `havuz ${s150.length}, dönem evreni pitN ${pitN} (30 günlük hacim)`, rank: `${pLive.lookback} günlük getiri − BTC getirisi`, forward: 'pazar kapanışı → sonraki pazar kapanışı (7 gün), stop / maliyet yok; evren ortalamasına göre fark %', quintile: 'q = ⌊sıra × 5 / n⌋, q1 = en zayıf; evren T verisiyle', weak5: 'selectAt short listesi (en zayıf 5, getirisi < 0)', placebo: `aynı hafta evrenden rastgele, zayıf-5 ile aynı sayıda coin; ${draws} çekiliş; tohum seedOf('m0b|T')`, percentile: 'plasebo ortalamalarının zayıf-5 ortalamasına eşit ya da küçük olanlarının payı (%; küçük = zayıflar rastgeleden zayıf)', ci: 'hafta bloklu bootstrap %90', rule: 'bilgi var = q1 − evren farkının %90 aralığı üst ucu < 0, eğitim ve doğrulamada' }, weeksTotal: weeks.length, weeksUsed: W.length, train: bTrain, valid: bValid, verdict: m0bVerdict(bTrain, bValid) };

  // M0c: taban varyantın short işlemleri (gerçek fonlama verisinin kapsadığı kısmı)
  const m0c = { def: { trades: `M0d ${LIVE_VARIANT} short işlemleri (havuz ${s150.length})`, rate: 'realizedRate (yoksa fundingRate), dönem başına; 8 saate normalleştirme = Σ maliyet ÷ kapsanan saat × 8', sign: 'işaretli maliyet d × oran (short: negatif oran = öder)', assumed: `%${fundingPct8h} / 8 saat, iki yönde maliyet`, rule: 'gerçek > 2 × varsayılan → M1 öncesi fonlama modeli gerçek ortalamayla' }, ...m0cSummary(baseTrades.filter((t) => t.direction === 'short'), funding, { assumed: fundingPct8h }) };

  // M0a
  let m0a = { available: false, reason: 'momentum.json yok' };
  if (live && Array.isArray(live.rebalances)) {
    const S80 = prepSeries(s80), by80 = new Map(S80.map((s) => [s.coin, s]));
    const btTrades = XS_STRATEGIES.find((s) => s.id === LIVE_VARIANT).run(s80.map((s) => ({ coin: s.coin, candles: s.candles })), { feePct: lp.feePct ?? fee, slipPct: lp.slipPct ?? slip, fundingPct8h: lp.fundingPct8h ?? fundingPct8h }, { btcDaily, startMs: DEV_START, pitN });
    const rep = variantReport(btTrades, by80, { slots: lp.k || 5, fee: (lp.feePct ?? fee) / 100, slip: (lp.slipPct ?? slip) / 100, dataEnd, split, hedge: true, ci });
    const btT = rep._trades || [];
    const legs = liveLegs(live);
    const liveFrom = Math.floor(live.start / DAY) * DAY;
    const btcH = btcHourly && btcHourly.length ? { c: btcHourly, idx: new Map(btcHourly.map((x, i) => [x.time, i])) } : null;
    const btcAt = (t) => { if (btcH) { const h0 = Math.floor(t / HOUR) * HOUR, i = btcH.idx.get(h0); if (i != null) return t - h0 < HOUR / 2 ? btcH.c[i].open : btcH.c[i].close; } return t <= dataEnd + DAY ? pxAt(by80.get('BTC'), t) : null; }; // veri dışı → null (bayat fiyat yok)
    const inData = live.start >= DEV_START && Math.floor(live.start / DAY) * DAY <= dataEnd;
    const selections = compareSelections(live.rebalances, (T) => { const u = universeAt(S80, T, { ...pLive }, pitN); return u ? selectAt(u.ranks, pLive, { pitN }) : null; });
    const match = matchTrades(legs, btT, { from: liveFrom });
    const dec = liveDecomposition(live, btcAt, { slipPct: lp.slipPct ?? slip });
    const shortNotionalAt = (t) => legs.filter((l) => !l.hedge && l.entryTime <= t && l.exitTime > t).reduce((s, l) => s + l.notional, 0);
    m0a = {
      available: inData, ...(inData ? {} : { reason: 'canlı dönem mum verisinin dışında' }),
      def: { bt: `${LIVE_VARIANT}, canlı params (havuz ${s80.length}, pitN ${pitN}), runXsMom; giriş pazartesi açılışı`, match: 'aynı coin + giriş günü (UTC) + yön', selection: 'canlı karar günü = yeniden dengeleme anından önceki son kapanmış günlük mum', riskPct: 'canlı: kapanmışta |%K/Z ÷ R| (giriş riski), açıkta güncel stop uzaklığı; bt: ilk stop', weekly: 'canlı: yeniden dengeleme anlık görüntüleri arası özsermaye değişimi (% başlangıç); bt: aynı aralıktaki haftalık portföy (eşit nominal 1/5, hedge = eşit nominal ters BTC)' },
      params: lp, start: live.start, updatedAt: live.updatedAt, equity: { start: live.startEquity, now: live.equity, pct: live.pnlPct }, btc: live.btc || null,
      selections, trades: match,
      hedge: { snapshots: selections.map((s) => { const sn = shortNotionalAt(s.time); return { time: s.time, equity: s.equity, hedgeNotional: s.hedgeNotional, shortNotionalEst: rd(sn, 2), hedgeToShort: s.hedgeNotional && sn ? rd(s.hedgeNotional / sn, 2) : null, shortToEquity: s.equity ? rd(sn / s.equity, 3) : null }; }), btSizing: 'eşit nominal: short nominal / özsermaye = n_short / 5, hedge = short nominali' },
      decomposition: dec, realFunding: liveRealFunding(legs, funding),
      weekly: liveVsBtWeekly(live, (rep._weekly || []).filter((x) => x.start >= liveFrom - WEEK)),
    };
  }

  const out = {
    meta: { ...meta, generatedAt: now, slices: { dev: `${iso(DEV_START)} → ${iso(end)}`, locked: `${iso(LOCK_START)} → ${iso(LOCK_END)} (getiri hesaplanmaz; yalnız veri varlığı)` }, split, dataEnd, pool: s150.length, livePool: s80.length, poolNote: `M0b/M0c/M0d havuz ${pool} (ön kayıt), M0a canlı params havuz ${livePool}; ikisinde de pitN ${pitN}`, warmup: 'ısınma geliştirme diliminden (kasa fiyatı kullanılmaz): ilk dengeleme ≈ DEV_START + 48 gün', fee, slip, fundingPct8h, draws, lockedAvailability: lockedAvailability(lockedTimes) },
    m0a, m0b, m0c, m0d,
  };
  return out;
}
