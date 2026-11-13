// Kesitsel momentum aşama M1 (13.11.2026; tanımlar docs/arastirma/on-kayit-momentum.md "Aşama M1 — kesin tanımlar" + "Geçme
// ölçütü", bağlayıcı) — saf fonksiyonlar (ağ yok). Betik: backtest/mom-stage1.mjs.
// Satırlar: T (short_rel + işlem başına eşit nominal ters BTC = M0d hedgedWeekly), HM1 (ls_rel, hedge yok), HM2 (T seçimi, short
// nominalleri ∝ 1/σ28, toplam = T), HM3 (T, sıralama t−28 → t−7); her biri L = 28 (birincil), 14 ve 56 (plato). Bilgi amaçlı: T
// hedge'siz, T canlı eşit risk boyutlaması. Geliştirme ve kasa-M AYRI akış (ayrı seriler, ayrı simülasyon). lock 0: kasa akışı hiç
// koşmaz (yalnız veri varlığı sayımı).
import { runXsMom, selectAt, XS_DEFAULTS } from './lab/xsmom.js';
import { prepSeries, universeAt, pxAt, exitEffOf, weekOf, weekStartOf, weeklySeries, weeklyStats, lockedAvailability, lockedLeaks, DEV_START, LOCK_START, LOCK_END, DAY, WEEK } from './mom-diag.js';
import { targetNotional, MOM_DEFAULTS } from '../bot/momentum/portfolio.js';

export const SANITY = { dataEnd: 1794441600000, train: 2.651, valid: 3.636, tol: 0.05, run: 43503125194 };
export const WINDOWS = [28, 14, 56];
export const SKIP = 7;
const rd = (x, n = 3) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Satır tanımları (L = pencere). weight: 'hm2' | 'eqrisk' | null; field: karar serisi ('hedged' | 'ret'). */
export function rowDefs(L) {
  return {
    T: { params: { lookback: L, k: 5, side: 'short', rank: 'rel' }, hedge: true, weight: null, field: 'hedged' },
    HM1: { params: { lookback: L, k: 5, side: 'ls', rank: 'rel' }, hedge: false, weight: null, field: 'ret' },
    HM2: { params: { lookback: L, k: 5, side: 'short', rank: 'rel' }, hedge: true, weight: 'hm2', field: 'hedged' },
    HM3: { params: { lookback: L, k: 5, side: 'short', rank: 'rel', skip: SKIP }, hedge: true, weight: null, field: 'hedged' },
  };
}
export const INFO_DEFS = {
  T_unhedged: { params: { lookback: 28, k: 5, side: 'short', rank: 'rel' }, hedge: false, weight: null, field: 'ret' },
  T_eqRisk: { params: { lookback: 28, k: 5, side: 'short', rank: 'rel' }, hedge: true, weight: 'eqrisk', field: 'hedged' },
};
const slotsOfP = (p) => p.k * (p.side === 'ls' ? 2 : 1);

/** Son n günlük günlük getirinin örnek standart sapması (i. mum dahil, yalnız ≤ i); yetersiz → null. */
export function dailyStd(c, i, n = 28) {
  if (i == null || i - n < 0) return null;
  const r = []; for (let k = i - n + 1; k <= i; k++) r.push(c[k].close / c[k - 1].close - 1);
  const m = mean(r), v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1);
  return v > 0 ? Math.sqrt(v) : null;
}

/** HM2 ağırlıkları (seçim başına): w_c = |S| × (1/σ_c) / Σ(1/σ) → Σ w = |S| (toplam short nominali T ile aynı). σ yoksa liste ortalaması. */
export function invVolWeights(sigmas) {
  const ok = sigmas.filter((x) => x.sigma > 0), avgInv = ok.length ? mean(ok.map((x) => 1 / x.sigma)) : 1;
  const inv = sigmas.map((x) => (x.sigma > 0 ? 1 / x.sigma : avgInv)), sum = inv.reduce((a, b) => a + b, 0);
  return new Map(sigmas.map((x, k) => [x.coin, sum > 0 ? (sigmas.length * inv[k]) / sum : 1]));
}

/** HM2: hafta (pazartesi) → Map coin → ağırlık; karar = önceki pazar kapanışı, seçim selectAt (T ile aynı), σ aynı ana kadar. */
export function hm2WeekWeights(S, p, { pitN, from, to }) {
  const by = new Map(S.map((s) => [s.coin, s])), out = new Map();
  for (let T = from; T <= to; T += DAY) {
    if (new Date(T).getUTCDay() !== 0) continue;
    const u = universeAt(S, T, p, pitN); if (!u) continue;
    const sel = selectAt(u.ranks, p, { pitN }); if (!sel || !sel.shorts.length) continue;
    out.set(weekOf(T + DAY), invVolWeights(sel.shorts.map((c) => { const s = by.get(c); return { coin: c, sigma: dailyStd(s.c, s.idx.get(T), 28) }; })));
  }
  return out;
}

/** Canlı eşit risk boyutlaması (bilgi): ağırlık = slot × targetNotional(1, risk) (%2 risk, üst sınır 1/5) → min(1, 0,1 / risk). */
export const eqRiskWeight = (t) => { const risk = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : null; const o = { ...MOM_DEFAULTS, side: 'short', k: 5, riskPct: 2 }; return risk > 0 ? 5 * targetNotional(1, risk, o) : 1; };

/**
 * mom-diag splitWeekly'nin ağırlıklı genellemesi (weightOf(t, hafta) ≡ 1 → aynı toplama sırası, aynı sayılar). Ağırlık o haftadaki
 * parçaya (coin ve hedge bacağı) ve o haftaya düşen komisyona uygulanır; ağırlık değişimi (yeniden boyutlama) maliyetsiz.
 * Ek: işlem başına portföy katkısı (contrib, contribHedged; 1 = sermayenin tamamı).
 */
export function splitWeeklyW(trades, byCoin, { slots, fee, slip, dataEnd, hedge = false, weightOf = () => 1 }) {
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
    const funding = gross - 2 * fee - t.ret;
    const span = Math.max(1, e1 - e0);
    const wE = weekOf(e0), wExit = weekOf(e1 - 1), aE = weightOf(t, wE), aX = weightOf(t, wExit);
    let cU = 0, cH = 0, hRet = null;
    for (let k = 0; k < pts.length - 1; k++) {
      const w = weekOf(pts[k]), share = (pts[k + 1] - pts[k]) / span, a = weightOf(t, w);
      const v = ((d * (px[k + 1] - px[k])) / t.entry - funding * share) * a;
      add(w, 'ret', v); add(w, 'hedged', v); cU += v; cH += v;
    }
    add(wE, 'ret', -fee * aE); add(wE, 'hedged', -fee * aE);
    add(wExit, 'ret', -fee * aX); add(wExit, 'hedged', -fee * aX);
    cU -= fee * (aE + aX); cH -= fee * (aE + aX);
    if (hedge && btc) {
      const hd = -d;
      const bp = pts.map((x) => pxAt(btc, x));
      if (bp.every((x) => x > 0)) {
        const b0 = bp[0] * (1 + hd * slip), bEnd = bp[bp.length - 1] * (1 - hd * slip);
        const bpx = bp.map((x, k) => (k === 0 ? b0 : k === bp.length - 1 ? bEnd : x));
        hRet = (hd * (bEnd - b0)) / b0 - 2 * fee - funding;
        for (let k = 0; k < pts.length - 1; k++) { const a = weightOf(t, weekOf(pts[k])), v = ((hd * (bpx[k + 1] - bpx[k])) / b0 - funding * ((pts[k + 1] - pts[k]) / span)) * a; add(weekOf(pts[k]), 'hedged', v); cH += v; }
        add(wE, 'hedged', -fee * aE); add(wExit, 'hedged', -fee * aX); cH -= fee * (aE + aX);
      }
    }
    const risk = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : null;
    out.push({ ...t, hedgeRet: hRet == null ? null : rd(hRet, 5), hedgedR: hRet != null && risk > 0 ? rd((t.ret + hRet) / risk) : null, contrib: cU / slots, contribHedged: cH / slots });
  }
  return { weeks, trades: out };
}

/** Dilim özeti: weeklyStats (+ en kötü hafta), işlem sayısı / ort. R, en kötü tek işlem (sermaye %), long / short bacak. */
function sliceStats(ser, tr, field, ci, legSer) {
  const w = weeklyStats(ser, field, ci), v = ser.map((x) => x[field]);
  const R = tr.map((t) => (field === 'hedged' ? t.hedgedR : t.R)).filter(Number.isFinite);
  const worst = (k) => (tr.length ? rd(Math.min(...tr.map((t) => t[k])) * 100, 2) : null);
  const legs = {};
  for (const [dir, ls] of Object.entries(legSer)) { const x = ls.filter((y) => ser.some((z) => z.w === y.w)); legs[dir] = { trades: tr.filter((t) => t.direction === dir).length, meanPct: rd(mean(x.map((y) => y.ret))), totalPct: rd(x.reduce((s, y) => s + y.ret, 0), 2) }; }
  if (field === 'hedged') legs.hedgeTotalPct = rd(ser.reduce((s, x) => s + (x.hedged - x.ret), 0), 2);
  return { ...w, worstWeekPct: v.length ? rd(Math.min(...v), 2) : null, trades: tr.length, avgR: rd(mean(R)), worstTradePct: worst('contrib'), ...(field === 'hedged' ? { worstTradeHedgedPct: worst('contribHedged') } : {}), legs };
}

/**
 * Bir satırın bir akıştaki raporu. series: [{ coin, candles }] (akışın kendi mumları); startMs: işlem başı; split: null → tek dilim 'all'.
 * → { trades, train?, valid?, all, _weekly }
 */
export function rowReport(series, def, { startMs, dataEnd, split = null, pitN = 50, fee = 0.05, slip = 0.05, fundingPct8h = 0.01, ci = {} }) {
  const p = { ...XS_DEFAULTS, ...def.params };
  const btcDaily = series.find((s) => s.coin === 'BTC')?.candles || null;
  const trades = runXsMom(series, { feePct: fee, slipPct: slip, fundingPct8h }, { btcDaily, startMs, pitN }, p);
  const S = prepSeries(series), by = new Map(S.map((s) => [s.coin, s]));
  const slots = slotsOfP(p);
  let weightOf = () => 1;
  if (def.weight === 'hm2') { const W = hm2WeekWeights(S, p, { pitN, from: startMs, to: dataEnd }); weightOf = (t, w) => (t.direction === 'short' ? W.get(w)?.get(t.coin) ?? 1 : 1); }
  else if (def.weight === 'eqrisk') { const cache = new Map(); weightOf = (t) => { if (!cache.has(t)) cache.set(t, eqRiskWeight(t)); return cache.get(t); }; }
  const o = { slots, fee: fee / 100, slip: slip / 100, dataEnd, hedge: def.hedge, weightOf };
  if (!trades.length) return { trades: 0, all: null, ...(split ? { train: null, valid: null } : {}), _weekly: [] };
  const sw = splitWeeklyW(trades, by, o);
  const w0 = weekOf(Math.min(...trades.map((t) => t.entryTime))), w1 = weekOf(dataEnd);
  const ser = weeklySeries(sw.weeks, w0, w1);
  const legSer = Object.fromEntries(['long', 'short'].filter((dir) => trades.some((t) => t.direction === dir)).map((dir) => [dir, weeklySeries(splitWeeklyW(trades.filter((t) => t.direction === dir), by, { ...o, hedge: false }).weeks, w0, w1)]));
  const part = (sr, tr) => sliceStats(sr, tr, def.field, ci, legSer);
  return {
    trades: trades.length, firstWeek: weekStartOf(w0), lastWeekPartial: weekStartOf(w1) + WEEK > dataEnd + DAY,
    all: part(ser, sw.trades),
    ...(split ? { train: part(ser.filter((x) => x.start < split), sw.trades.filter((t) => t.time < split)), valid: part(ser.filter((x) => x.start >= split), sw.trades.filter((t) => t.time >= split)) } : {}),
    _weekly: ser.map((x) => x[def.field]),
  };
}

/** Akış (geliştirme ya da kasa) için tüm satırlar. */
export function runFlow(series, ctx) {
  const rows = {}, raw = {};
  for (const L of WINDOWS) for (const [id, def] of Object.entries(rowDefs(L))) {
    const { _weekly, ...r } = rowReport(series, def, ctx);
    (rows[id] ||= {})[`L${L}`] = { field: def.field, ...r }; (raw[id] ||= {})[`L${L}`] = _weekly;
  }
  const info = {};
  for (const [id, def] of Object.entries(INFO_DEFS)) { const { _weekly, ...r } = rowReport(series, def, ctx); info[id] = { field: def.field, ...r }; }
  return { rows, info, raw };
}

/**
 * Geçme ölçütü (ön kayıt). dev[row][L].train/valid, kasa[row][L].all (lock 1), raw: haftalık değerler (plato: geliştirme + kasa
 * toplam ortalaması). lock 0 → yalnız devPass (+ geliştirme platosu).
 */
export function passOf(dev, kasa, rawDev, rawKasa, lock) {
  const T = dev.T.L28, Tk = kasa?.T?.L28?.all;
  const sh = (x) => (x && Number.isFinite(x.sharpe) ? x.sharpe : null);
  const gt = (a, b) => a != null && b != null && a > b;
  const plateauMean = (id, L) => { const v = [...(rawDev[id]?.[`L${L}`] || []), ...(lock && rawKasa ? rawKasa[id]?.[`L${L}`] || [] : [])].filter(Number.isFinite); return v.length ? rd(mean(v)) : null; };
  const out = {};
  for (const id of ['T', 'HM1', 'HM2', 'HM3']) {
    const plateau = { L14: plateauMean(id, 14), L56: plateauMean(id, 56) };
    const plateauOk = plateau.L14 > 0 && plateau.L56 > 0;
    if (id === 'T') {
      const kasaPass = lock ? !!(Tk && Tk.meanPct > 0 && Tk.ci90 && Tk.ci90[0] > 0 && Tk.sharpe >= 0.5) : null;
      out.T = { rule: 'kasa-M: ort > 0, %90 alt uç > 0, Sharpe ≥ 0,5; plato işareti yalnız raporlanır', kasaPass, plateau, plateauPositive: plateauOk, pass: lock ? kasaPass : null };
      continue;
    }
    const r = dev[id].L28;
    const devPass = !!(r.train && r.valid && r.train.meanPct > 0 && r.valid.meanPct > 0 && gt(sh(r.train), sh(T.train)) && gt(sh(r.valid), sh(T.valid)));
    let kasaPass = null;
    if (lock) { const k = kasa?.[id]?.L28?.all; kasaPass = !!(k && k.meanPct > 0 && k.ci90 && k.ci90[0] > 0 && gt(sh(k), sh(Tk))); }
    out[id] = { rule: 'geliştirme: eğitim ve doğrulamada ort > 0 ve Sharpe > T; kasa-M: ort > 0, alt uç > 0, Sharpe > T; plato: L 14 ve 56 geliştirme + kasa toplam ort > 0', devPass, kasaPass, plateau, plateauPositive: plateauOk, pass: lock ? devPass && kasaPass && plateauOk : null };
  }
  return out;
}

/**
 * Uçtan uca (saf). devSeries: ≥ DEV_START mumları; kasaSeries: < DEV_START mumları (ısınma dahil; yalnız lock 1); lockedTimes: kasa
 * varlık sayımı için zaman damgaları. now: geliştirme bitişi (veri sonu). → { meta, sanity, dev, kasa?, info, pass }
 */
export function runStage1({ devSeries, kasaSeries = null, lockedTimes = new Map(), now, lock = 0, pool = 150, pitN = 50, ci = {}, sanity = SANITY, meta = {} }) {
  for (const s of devSeries) if (s.candles.length && s.candles[0].time < DEV_START) throw new Error(`geliştirme akışına kasa mumu girdi: ${s.coin}`);
  if (!lock && kasaSeries) throw new Error('lock 0: kasa serisi verilmemeli');
  const withBtc = (a, all) => (a.some((s) => s.coin === 'BTC') ? a : [...a, ...all.filter((s) => s.coin === 'BTC')]);
  const dev = withBtc(devSeries.slice(0, pool), devSeries);
  const dataEnd = Math.max(...dev.map((s) => s.candles.at(-1)?.time ?? 0));
  const end = Math.min(now, dataEnd + DAY), split = DEV_START + ((end - DEV_START) * 2) / 3;
  const devFlow = runFlow(dev, { startMs: DEV_START, dataEnd, split, pitN, ci });
  // Sağlamlık denetimi: T geliştirme, M0d penceresinde (aynı dataEnd → aynı split)
  let sanityOut = { available: false, reason: 'veri penceresi M0d dataEnd\'ini kapsamıyor' };
  if (dataEnd >= sanity.dataEnd) {
    const cut = dev.map((s) => ({ coin: s.coin, candles: s.candles.filter((c) => c.time <= sanity.dataEnd) })).filter((s) => s.candles.length);
    const sEnd = sanity.dataEnd + DAY, sSplit = DEV_START + ((sEnd - DEV_START) * 2) / 3;
    const r = rowReport(cut, rowDefs(28).T, { startMs: DEV_START, dataEnd: sanity.dataEnd, split: sSplit, pitN, ci });
    const tr = r.train?.meanPct ?? null, va = r.valid?.meanPct ?? null;
    sanityOut = { available: true, run: sanity.run, dataEnd: sanity.dataEnd, expected: { train: sanity.train, valid: sanity.valid }, got: { train: tr, valid: va }, tol: sanity.tol, ok: tr != null && va != null && Math.abs(tr - sanity.train) <= sanity.tol && Math.abs(va - sanity.valid) <= sanity.tol };
  }
  let kasaFlow = null, kasaEnd = null;
  if (lock && kasaSeries) {
    const k = withBtc(kasaSeries.slice(0, pool), kasaSeries).map((s) => ({ coin: s.coin, candles: s.candles.filter((c) => c.time < LOCK_END) })).filter((s) => s.candles.length);
    kasaEnd = Math.max(...k.map((s) => s.candles.at(-1)?.time ?? 0));
    kasaFlow = runFlow(k, { startMs: LOCK_START, dataEnd: kasaEnd, split: null, pitN, ci });
  }
  const pass = passOf(devFlow.rows, kasaFlow?.rows || null, devFlow.raw, kasaFlow?.raw || null, lock);
  const out = {
    meta: { ...meta, lock, generatedAt: now, slices: { dev: `${iso(DEV_START)} → ${iso(end)} (eğitim < ${iso(split)} ≤ doğrulama)`, kasaM: `${iso(LOCK_START)} → ${iso(LOCK_END)}${lock ? '' : ' (lock 0: hesaplanmadı)'}`, kasaEnd: kasaEnd ? iso(kasaEnd) : null }, split, dataEnd, pool: dev.length, pitN, windows: WINDOWS, skip: SKIP,
      params: { k: 5, stopAtr: XS_DEFAULTS.stopAtr, fee: 0.05, slip: 0.05, fundingPct8h: 0.01, rebalance: 'pazar kapanışı → pazartesi açılışı', unit: 'haftalık portföy getirisi %, işlem başı 1/slot nominal, basit toplam', hedge: 'işlem başına eşit nominal ters BTC (M0d)', hm2: 'σ = karar gününe kadar son 28 günlük getiri std; haftalık yeniden ağırlık maliyetsiz; long bacak (yok) 1', eqRisk: 'ağırlık = min(1, 0,1 / giriş riski) (canlı targetNotional, %2 risk, üst sınır 1/5)' },
      ci: { method: 'hafta bloklu bootstrap, %90', reps: ci.reps ?? 1000 }, lockedAvailability: lockedAvailability(lockedTimes) },
    sanity: sanityOut, dev: devFlow.rows, ...(kasaFlow ? { kasa: kasaFlow.rows, kasaInfo: kasaFlow.info } : {}), info: devFlow.info, pass,
  };
  if (!lock) { const leaks = lockedLeaks(out); if (leaks.length) throw new Error(`lock 0 çıktısında kasa alanı: ${leaks.slice(0, 5).join(', ')}`); }
  return out;
}
