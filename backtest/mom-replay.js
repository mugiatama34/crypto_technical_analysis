// M0a ek (13.11.2026): canlı momentum kâğıt portföyünün yeniden oynatılması — canlı kodun KENDİ fonksiyonlarıyla
// (bot/momentum/portfolio.js; yalnız import, değişiklik yok), 15 dakikalık adımlarla, canlının seçtiği coin listeleriyle
// (rebalances kaydı; seçim yeniden hesaplanmaz → fark yalnız muhasebe / fiyat yolundan). Ağ yok (saf): mumlar girdi.
// Adım sırası run.js runMomentum ile aynı: fonlama tahakkuku → stop → (dengeleme değilse) hedge eşitleme → (dengelemede) rebalance
// + hedge eşitleme → markCurve. Dengelemede rebalance hedge kapalı çağrılır ve hemen ardından syncHedge çağrılır (canlıda
// rebalance'ın son adımı aynı çağrı; böylece hedge ile short yeniden boyutlamasının gerçekleşeni ayrı ölçülür).
// Seçimin zorlanması: rebalance() evreni = canlı listedeki coinler (gerçek günlük mumlar) + BTC + 10 yapay yükselen coin
// (BTC'ye göre getirisi > 0, short seçilemez) → selectAt en zayıf 5'i (getirisi < 0) = canlı liste. Eşleşmezse selectionMismatch.
import { MOM_DEFAULTS, newPortfolio, rebalanceDue, accrueFunding, checkStops, rebalance, markCurve, equityOf, syncHedge, lastWeekClose } from '../bot/momentum/portfolio.js';
import { instIdOf } from '../src/data/okx.js';

const DAY = 86400e3, HOUR = 3600e3, M15 = 15 * 60e3;
const rd = (x, n = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const keyOf = (q) => (q.hedge ? 'BTC (hedge)' : q.coin);

/** Sıralı mum dizisinde time ≤ t olan son indeks (yoksa −1). */
function lastLE(cs, t) {
  let lo = 0, hi = cs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}

/** Yapay yükselen coin (günlük %3, ±%1 fitil): seçimi zorlamak için; t'den önceki n kapanmış mum. */
function dummyCandles(dayStart, n = 69) {
  return Array.from({ length: n }, (_, k) => { const c = 1.03 ** k, o = k ? 1.03 ** (k - 1) : c; return { time: dayStart - (n - k) * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1, quoteVol: 1 }; });
}

/**
 * Piyasa görünümü (t anı, canlının gördüğü gibi): fiyat = t'den önce KAPANMIŞ son 15m mumunun kapanışı; günlük = t gününden önceki
 * son 69 kapanmış 1D mum (canlı getCandles 70: 69 kapanmış + canlı) ve canlı günlük mum = bugünün kapanmış 15m mumlarından
 * (açılış / en yüksek / en düşük / kapanış); bugün kapanmış 15m yoksa fiyattan tek noktalı mum.
 */
export function marketAt(coin, t, m15, d1) {
  const a = m15.get(coin), D = d1.get(coin);
  let price = null, live = null;
  if (a && a.length) {
    const k = lastLE(a, t - M15);
    if (k >= 0 && t - a[k].time < DAY) {
      price = a[k].close;
      const day = Math.floor(t / DAY) * DAY;
      let j = k, hi = -Infinity, lo = Infinity;
      while (j >= 0 && a[j].time >= day) { hi = Math.max(hi, a[j].high); lo = Math.min(lo, a[j].low); j--; }
      live = j < k ? { time: day, open: a[j + 1].open, high: hi, low: lo, close: price } : { time: day, open: price, high: price, low: price, close: price };
    }
  }
  let candles = [];
  if (D && D.length) { const k = lastLE(D, Math.floor(t / DAY) * DAY - 1); candles = k >= 0 ? D.slice(Math.max(0, k - 68), k + 1) : []; }
  return { price, daily: { candles, live } };
}

const snap = (pf) => new Map(pf.positions.map((q) => [keyOf(q), { coin: q.coin, hedge: !!q.hedge, d: q.d, qty: q.qty, entry: q.entry, funding: q.funding }]));

/**
 * Bir işlemin (op) etkisini sınıflar: yeni kapanan işlemler (trades) ve aynı pozisyonun adet değişimi (küçültme = gerçekleşen,
 * resizePos formülüyle; büyütme = gerçekleşen yok). acc: biriken kalemler. → muhasebe kontrol farkı (Σ sınıflanan − realized değişimi).
 */
function classify(acc, pf, before, nTrades, realized0, prices, o) {
  let sum = 0;
  for (const t of pf.trades.slice(nTrades)) {
    const k = t.hedge ? 'BTC (hedge)' : t.coin;
    acc.byKey.set(k, (acc.byKey.get(k) || 0) + t.pnl);
    acc.fees += t.fee; sum += t.pnl;
    const c = t.hedge ? acc.hedgeClosed : t.reason === 'stop' ? acc.shortStopped : acc.shortRebalanced;
    c.n++; c.usd += t.pnl;
  }
  const after = snap(pf);
  for (const [k, b] of before) {
    const a = after.get(k); if (!a || Math.abs(a.qty - b.qty) < 1e-12 * Math.max(1, b.qty)) continue;
    const c = b.hedge ? acc.hedgeResize : acc.shortResize;
    c.n++;
    if (a.qty < b.qty) {
      const cut = b.qty - a.qty, px = prices[b.coin], exit = px * (1 - b.d * (o.slipPct / 100));
      const fee = (b.entry * cut + exit * cut) * (o.feePct / 100), fShare = b.funding * (cut / b.qty);
      const r = b.d * (exit - b.entry) * cut - fee - fShare;
      c.usd += r; c.cuts++; acc.fees += fee; sum += r;
      acc.byKey.set(k, (acc.byKey.get(k) || 0) + r);
    } else c.grows++;
  }
  for (const [k, a] of after) if (!before.has(k) && a.hedge) acc.hedgeOpened++;
  return Math.abs(sum - (pf.realized - realized0));
}

/** Pozisyon başına değer (gerçekleşen + açık K/Z − fonlama), USDT; Σ + başlangıç = equityOf. */
function valuesOf(pf, acc, prices) {
  const V = new Map(acc.byKey);
  for (const q of pf.positions) { const px = prices[q.coin] ?? q.lastPrice ?? q.entry; V.set(keyOf(q), (V.get(keyOf(q)) || 0) + q.d * (px - q.entry) * q.qty - q.funding); }
  return V;
}

/**
 * Yeniden oynatma. live: momentum.json (start, rebalances, params, positions/trades: hedge başlangıcı, updatedAt).
 * m15 / d1: Map coin → mumlar (15m / 1D, eskiden yeniye). opts: { end, overrides (MOM_DEFAULTS üstüne), hedgeResize (false →
 * dengeleme dışı turlarda hedge yalnız yoksa açılır), weeklyResize (false → dengelemede kalan pozisyonlar yeniden boyutlanmaz),
 * hedgeFrom (ms; varsayılan canlı hedge bacağının girişi) }.
 */
export function replayLive(live, m15, d1, opts = {}) {
  const { hedgeResize = true, weeklyResize = true } = opts;
  const lp = live.params || {};
  const o = { ...MOM_DEFAULTS, ...(lp.side ? { side: lp.side } : {}), ...(lp.rank ? { rank: lp.rank } : {}), hedge: !!lp.hedge, maxTrades: 1e9, maxCurve: 1e9, ...(opts.overrides || {}) };
  const hedgeLegs = [...(live.positions || []), ...(live.trades || [])].filter((q) => q.hedge);
  const hedgeFrom = opts.hedgeFrom ?? (hedgeLegs.length ? Math.min(...hedgeLegs.map((q) => q.entryTime)) : live.start);
  const recs = [...(live.rebalances || [])].sort((a, b) => a.time - b.time);
  const end = opts.end ?? live.updatedAt;
  const pf = newPortfolio(live.start, o);
  pf.startEquity = live.startEquity ?? o.capital;
  const acc = { byKey: new Map(), fees: 0, funding: 0, hedgeOpened: 0, shortStopped: { n: 0, usd: 0 }, shortRebalanced: { n: 0, usd: 0 }, hedgeClosed: { n: 0, usd: 0 }, hedgeResize: { n: 0, cuts: 0, grows: 0, usd: 0 }, shortResize: { n: 0, cuts: 0, grows: 0, usd: 0 } };
  const steps = [], mismatches = [], rebs = [];
  let check = 0;
  const op = (fn, prices) => { const b = snap(pf), n = pf.trades.length, r0 = pf.realized; const res = fn(); check = Math.max(check, classify(acc, pf, b, n, r0, prices, o)); return res; };
  for (let t = live.start; t <= end; t += M15) {
    const due = rebalanceDue(pf, t);
    const rec = due ? [...recs].reverse().find((r) => r.time <= t + HOUR && lastWeekClose(r.time) === lastWeekClose(t)) || null : null;
    const coins = new Set([...pf.positions.map((q) => q.coin), 'BTC', ...(rec ? [...(rec.shorts || []), ...(rec.longs || [])] : [])]);
    const daily = {}, prices = {};
    for (const c of coins) { const m = marketAt(c, t, m15, d1); daily[c] = m.daily; if (m.price != null) prices[c] = m.price; }
    const hedgeOn = o.hedge && t >= hedgeFrom;
    const oh = { ...o, hedge: hedgeOn };
    const f0 = pf.positions.reduce((s, q) => s + q.funding, 0);
    accrueFunding(pf, t, oh);
    acc.funding += pf.positions.reduce((s, q) => s + q.funding, 0) - f0;
    op(() => checkStops(pf, daily, prices, t, oh), prices);
    if (!due) {
      if (hedgeOn && (hedgeResize || !pf.positions.some((q) => q.hedge))) op(() => syncHedge(pf, prices, t, oh), prices);
    } else if (rec) {
      const day = Math.floor(t / DAY) * DAY, dc = dummyCandles(day);
      const universe = [...new Set([...(rec.shorts || []), ...(rec.longs || [])])].filter((c) => c !== 'BTC' && daily[c].candles.length).map((c) => ({ coin: c, instId: instIdOf(c), candles: daily[c].candles, live: daily[c].live }));
      universe.push({ coin: 'BTC', instId: instIdOf('BTC'), candles: daily.BTC?.candles || [], live: daily.BTC?.live });
      for (let k = 0; k < 10; k++) universe.push({ coin: `__D${k}`, instId: `__D${k}-USDT-SWAP`, candles: dc, live: null });
      const r = op(() => rebalance(pf, universe, prices, t, { ...oh, hedge: false, ...(weeklyResize ? {} : { resizeTol: Infinity }) }), prices);
      const got = r.sel ? [...r.sel.shorts, ...r.sel.longs].sort() : [], want = [...(rec.shorts || []), ...(rec.longs || [])].sort();
      if (got.join() !== want.join()) mismatches.push({ time: t, live: want, replay: got });
      if (hedgeOn) op(() => syncHedge(pf, prices, t, oh), prices);
      rebs.push({ time: t, liveTime: rec.time, shorts: r.sel?.shorts || [], equity: rd(equityOf(pf, prices)), hedgeNotional: pf.positions.find((q) => q.hedge)?.notional ?? 0, liveEquity: rec.equity, liveHedgeNotional: rec.hedgeNotional ?? null });
    } else pf.lastRebalance = t; // kayıt yok: canlıda bu hafta dengeleme yapılmamış sayılır
    markCurve(pf, prices, t, oh);
    steps.push({ t, eq: equityOf(pf, prices), V: valuesOf(pf, acc, prices), px: prices });
  }
  return { pf, acc, steps, mismatches, rebalances: rebs, accountingCheck: rd(check, 6), hedgeFrom, o };
}

const pick = (steps, t) => { let lo = 0, hi = steps.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? steps[k] : null; };

/** Replay sonucu → özet (kalemler, canlı eğri farkları, saatlik coin katkıları, canlı sıçramalar). */
export function summarizeReplay(live, R) {
  const { pf, acc, steps } = R, last = steps.at(-1);
  if (!last) return { available: false, reason: 'adım yok' };
  const open = pf.positions, px = last.px;
  const openNet = (h) => open.filter((q) => !!q.hedge === h).reduce((s, q) => s + q.d * ((px[q.coin] ?? q.lastPrice ?? q.entry) - q.entry) * q.qty - q.funding, 0);
  const total = last.eq - pf.startEquity;
  const items = {
    shortClosedNet: rd(acc.shortStopped.usd + acc.shortRebalanced.usd), shortStopped: { n: acc.shortStopped.n, usd: rd(acc.shortStopped.usd) }, shortRebalanced: { n: acc.shortRebalanced.n, usd: rd(acc.shortRebalanced.usd) },
    shortOpenNet: rd(openNet(false)), shortResize: { n: acc.shortResize.n, cuts: acc.shortResize.cuts, grows: acc.shortResize.grows, realizedUsd: rd(acc.shortResize.usd) },
    hedgeClosed: { n: acc.hedgeClosed.n, usd: rd(acc.hedgeClosed.usd) }, hedgeOpenNet: rd(openNet(true)), hedgeResize: { n: acc.hedgeResize.n, cuts: acc.hedgeResize.cuts, grows: acc.hedgeResize.grows, realizedUsd: rd(acc.hedgeResize.usd) }, hedgeOpened: acc.hedgeOpened,
    feesUsd: rd(-acc.fees), fundingUsd: rd(-acc.funding),
  };
  const sumItems = items.shortClosedNet + items.shortOpenNet + items.shortResize.realizedUsd + items.hedgeClosed.usd + items.hedgeOpenNet + items.hedgeResize.realizedUsd;
  // Canlı eğri: markCurve noktası [t0, eq] saat içindeki SON turun değeri (zaman ilk turun) → karşılaştırma anı = sonraki noktadan hemen önce
  const lc = Array.isArray(live.curve) ? live.curve : [];
  const cmp = lc.map((p, k) => { const te = k + 1 < lc.length ? lc[k + 1][0] - 1 : live.updatedAt; const s = pick(steps, te); return s ? { time: p[0], at: te, live: p[1], replay: rd(s.eq), diff: rd(p[1] - s.eq) } : null; }).filter(Boolean);
  const firstDiv = cmp.find((x) => Math.abs(x.diff) > 2) || null;
  // Saatlik coin katkıları
  const hourly = [];
  let prev = null;
  for (const s of steps) {
    if (prev && Math.floor(s.t / HOUR) !== Math.floor(prev.t / HOUR)) {
      for (const k of new Set([...prev.V.keys(), ...s.V.keys()])) {
        const dv = (s.V.get(k) || 0) - (prev.V.get(k) || 0); if (Math.abs(dv) < 0.01) continue;
        const coin = k === 'BTC (hedge)' ? 'BTC' : k, p0 = prev.px[coin], p1 = s.px[coin];
        hourly.push({ key: k, from: prev.t, to: s.t, usd: rd(dv), pricePct: p0 && p1 ? rd((p1 / p0 - 1) * 100) : null });
      }
      prev = s;
    } else if (!prev) prev = s;
  }
  const topHourly = hourly.sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)).slice(0, 10);
  const jumps = [];
  for (let k = 1; k < cmp.length; k++) {
    const a = cmp[k - 1], b = cmp[k], sa = pick(steps, a.at), sb = pick(steps, b.at);
    let top = null;
    if (sa && sb) for (const key of new Set([...sa.V.keys(), ...sb.V.keys()])) { const dv = (sb.V.get(key) || 0) - (sa.V.get(key) || 0); if (!top || Math.abs(dv) > Math.abs(top.usd)) top = { key, usd: rd(dv) }; }
    jumps.push({ from: a.time, to: b.time, liveUsd: rd(b.live - a.live), replayUsd: rd(b.replay - a.replay), replayTop: top });
  }
  return {
    available: true, steps: steps.length, hedgeFrom: R.hedgeFrom, accountingCheck: R.accountingCheck, selectionMismatches: R.mismatches,
    equity: { start: pf.startEquity, replay: rd(last.eq), live: live.equity, totalUsd: rd(total), itemsCheck: rd(sumItems - total, 4) },
    items, rebalances: R.rebalances,
    curve: { points: cmp.length, finalDiff: cmp.length ? cmp.at(-1).diff : null, meanAbsDiff: cmp.length ? rd(cmp.reduce((s, x) => s + Math.abs(x.diff), 0) / cmp.length) : null, firstDivergence: firstDiv, top10: [...cmp].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 10) },
    topHourly, liveJumpsTop10: jumps.sort((a, b) => Math.abs(b.liveUsd) - Math.abs(a.liveUsd)).slice(0, 10),
  };
}

/** Taban + iki karşı-olgusal + tek cümlelik bulgu. */
export function replayReport(live, m15, d1, opts = {}) {
  const base = summarizeReplay(live, replayLive(live, m15, d1, opts));
  if (!base.available) return base;
  const cf = (x) => { const s = summarizeReplay(live, replayLive(live, m15, d1, { ...opts, ...x })); return { equity: s.equity.replay, totalUsd: s.equity.totalUsd, diffVsBase: rd(s.equity.replay - base.equity.replay), hedgeResize: s.items.hedgeResize, shortResize: s.items.shortResize, hedgeOpenNet: s.items.hedgeOpenNet, shortOpenNet: s.items.shortOpenNet }; };
  const noHedgeResize = cf({ hedgeResize: false }), noWeeklyResize = cf({ weeklyResize: false });
  const liveTotal = live.equity - live.startEquity, gap = base.equity.replay - live.equity;
  const reproduced = Math.abs(gap) <= Math.max(2, 0.1 * Math.abs(liveTotal));
  const it = base.items;
  const finding = reproduced
    ? `Replay canlı sonucu yeniden üretiyor (replay ${base.equity.totalUsd} ↔ canlı ${rd(liveTotal)} USDT): hedge yeniden boyutlama gerçekleşeni ${it.hedgeResize.realizedUsd} USDT (${it.hedgeResize.n} ayar), short yeniden boyutlama ${it.shortResize.realizedUsd} USDT (${it.shortResize.n}); hedge ayarı kapalıyken ${noHedgeResize.diffVsBase >= 0 ? '+' : ''}${noHedgeResize.diffVsBase}, haftalık yeniden boyutlama kapalıyken ${noWeeklyResize.diffVsBase >= 0 ? '+' : ''}${noWeeklyResize.diffVsBase} USDT fark.`
    : `Replay canlıyı yeniden üretmiyor (replay ${base.equity.totalUsd} ↔ canlı ${rd(liveTotal)} USDT, fark ${rd(gap)}); ilk ayrışma ${base.curve.firstDivergence ? new Date(base.curve.firstDivergence.time).toISOString().slice(0, 16) : '—'}, en büyük sapma ${base.curve.top10[0] ? `${new Date(base.curve.top10[0].time).toISOString().slice(0, 16)} (${base.curve.top10[0].diff} USDT)` : '—'}.`;
  return { ...base, counterfactuals: { noHedgeResize: { def: 'dengeleme dışı turlarda hedge yalnız yoksa açılır (yeniden boyutlanmaz)', ...noHedgeResize }, noWeeklyResize: { def: 'dengelemede listede kalan pozisyonlar yeniden boyutlanmaz (resizeTol ∞)', ...noWeeklyResize } }, reproduced, finding };
}
