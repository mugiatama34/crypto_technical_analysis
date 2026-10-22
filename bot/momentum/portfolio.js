// Haftalık kesitsel momentum kâğıt portföyü (saf fonksiyonlar, ağ yok). Seçim kuralı laboratuvarla ortaktır
// (backtest/lab/xsmom.js: momentumAt + selectAt). Sanal sermaye, gerçek emir yok.
//   Yeniden dengeleme: pazar UTC günlük kapanışından (pazartesi 00:00) sonraki ilk tur; o anki fiyattan giriş/çıkış.
//   Koruma: 3 ATR izleyen stop (yalnız kapanmış günlük mumla yukarı/aşağı çekilir), fiyat değerse kapanır.
//   Maliyet: komisyon %0,05/taraf, kayma %0,05, fonlama 8 saatte %0,01 (iki yöne de maliyet, ihtiyatlı).
//   Boyut: eşit risk (stop'a kadar özsermayenin riskPct %'si), nominal üst sınırı özsermaye / slot.
import * as I from '../../src/data/indicators.js';
import { XS_DEFAULTS, momentumAt, selectAt, quoteVolOf, slotsOf } from '../../backtest/lab/xsmom.js';

const DAY = 86400e3, H8 = 8 * 3600e3;
// riskPct: her pozisyon stop'a kadar özsermayenin bu %'sini riske eder (eşit risk; laboratuvarın R ölçüsüyle tutarlı),
// nominal üst sınırı özsermaye / slot. universe: çekilen havuz (24 saatlik hacim), pitN: 30 günlük hacme göre ilk N.
// resizeTol: listede kalan pozisyon hedef nominalden bu oranda saparsa yeniden boyutlanır.
export const MOM_DEFAULTS = { ...XS_DEFAULTS, lookback: 28, k: 5, side: 'ls', capital: 300, feePct: 0.05, slipPct: 0.05, fundingPct8h: 0.01, riskPct: 2, universe: 80, pitN: 50, resizeTol: 0.2, maxTrades: 400, maxCurve: 2000 };

/** Eşit risk hedef nominali: min(özsermaye / slot, riskPct% × özsermaye ÷ stop uzaklığı). */
export function targetNotional(equity, stopPct, o = MOM_DEFAULTS) {
  const cap = equity / slotsOf(o);
  if (!(stopPct > 0)) return cap;
  return Math.min(cap, (o.riskPct / 100) * equity / stopPct);
}

export function newPortfolio(now, o = MOM_DEFAULTS) {
  return { version: 1, start: now, startEquity: o.capital, realized: 0, positions: [], trades: [], curve: [], lastRebalance: 0, lastAccrual: now, rebalances: [], btcStart: null };
}

/** En son pazar kapanışı = bu haftanın pazartesi 00:00 UTC (now'a eşit ya da önce). */
export function lastWeekClose(now) {
  const d = new Date(now); const dow = d.getUTCDay(); // 0 pazar, 1 pazartesi
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((dow + 6) % 7) * DAY;
  return monday;
}
export const rebalanceDue = (pf, now) => pf.lastRebalance < lastWeekClose(now);

const pnlOf = (q, price) => q.d * (price - q.entry) * q.qty;
export function equityOf(pf, prices) {
  let u = 0;
  for (const q of pf.positions) u += pnlOf(q, prices[q.coin] ?? q.lastPrice ?? q.entry) - q.funding;
  return pf.startEquity + pf.realized + u;
}

function closePos(pf, q, price, reason, now, o) {
  const exit = price * (1 - q.d * (o.slipPct / 100));
  const fee = (q.entry * q.qty + exit * q.qty) * (o.feePct / 100);
  const pnl = q.d * (exit - q.entry) * q.qty - fee - q.funding;
  pf.realized += pnl;
  const t = { coin: q.coin, direction: q.d === 1 ? 'long' : 'short', entryTime: q.entryTime, exitTime: now, entry: q.entry, exit: +exit.toPrecision(8), qty: q.qty, notional: q.notional, pnl: +pnl.toFixed(2), pct: +((pnl / q.notional) * 100).toFixed(2), R: +((pnl / q.notional) / q.risk).toFixed(2), reason, funding: +q.funding.toFixed(3), fee: +fee.toFixed(3) };
  pf.trades.push(t);
  if (pf.trades.length > o.maxTrades) pf.trades.splice(0, pf.trades.length - o.maxTrades);
  pf.positions = pf.positions.filter((x) => x !== q);
  return t;
}

/**
 * Pozisyonu hedef nominale çek (|sapma| ≥ resizeTol ise). Küçültmede azaltılan kısmın K/Z'si, komisyonu ve fonlama payı
 * gerçekleşir; büyütmede ortalama giriş güncellenir (giriş komisyonu kapanışta tüm miktar üzerinden alınır).
 */
export function resizePos(pf, q, px, target, now, o = MOM_DEFAULTS) {
  const cur = q.qty * px;
  if (!(target > 0) || Math.abs(cur - target) / target < o.resizeTol) return null;
  const dq = target / px - q.qty, before = q.notional;
  if (dq < 0) {
    const cut = -dq, exit = px * (1 - q.d * (o.slipPct / 100));
    const fee = (q.entry * cut + exit * cut) * (o.feePct / 100);
    const fShare = q.funding * (cut / q.qty);
    pf.realized += q.d * (exit - q.entry) * cut - fee - fShare;
    q.funding -= fShare; q.qty -= cut;
  } else {
    const fill = px * (1 + q.d * (o.slipPct / 100));
    q.entry = +((q.entry * q.qty + fill * dq) / (q.qty + dq)).toPrecision(8);
    q.qty += dq;
  }
  q.notional = +(q.qty * q.entry).toFixed(2);
  q.stopPct = +((Math.abs(px - q.stop) / px) * 100).toFixed(1);
  q.riskUsd = +(q.qty * Math.abs(px - q.stop)).toFixed(2);
  return { coin: q.coin, d: q.d, from: before, to: q.notional, time: now };
}

/** Fonlama tahakkuku (son tahakkuktan bu yana; nominal üzerinden). */
export function accrueFunding(pf, now, o = MOM_DEFAULTS) {
  const dt = Math.max(0, now - pf.lastAccrual);
  for (const q of pf.positions) q.funding += q.notional * (o.fundingPct8h / 100) * (dt / H8);
  pf.lastAccrual = now;
}

/**
 * Stop kontrolü ve izleyen stop güncellemesi. daily[coin] = { candles (kapanmış), live } (1D).
 * Bugünkü canlı mumun uçları yalnız pozisyon bugünden önce açıldıysa kullanılır (açılış öncesi hareket sayılmaz).
 */
export function checkStops(pf, daily, prices, now, o = MOM_DEFAULTS) {
  const closed = [];
  const today = Math.floor(now / DAY) * DAY;
  for (const q of [...pf.positions]) {
    const D = daily[q.coin]; const price = prices[q.coin];
    if (price == null) continue;
    q.lastPrice = price;
    if (D?.candles?.length) {
      const c = D.candles, i = c.length - 1;
      if (c[i].time > (q.trailDay ?? 0) && c[i].time >= Math.floor(q.entryTime / DAY) * DAY) {
        const atr = I.atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14)[i];
        if (atr) { const ns = c[i].close - q.d * o.stopAtr * atr; if (q.d * (ns - q.stop) > 0) q.stop = +ns.toPrecision(8); }
        q.trailDay = c[i].time;
      }
    }
    const lv = D?.live && q.entryTime < today ? D.live : null;
    const hitPrice = q.d === 1 ? Math.min(price, lv?.low ?? price) <= q.stop : Math.max(price, lv?.high ?? price) >= q.stop;
    if (hitPrice) closed.push(closePos(pf, q, q.d === 1 ? Math.min(price, q.stop) : Math.max(price, q.stop), 'stop', now, o));
  }
  return closed;
}

/**
 * Yeniden dengeleme. universe: [{ coin, instId, candles (kapanmış 1D), live }]; prices: coin → son fiyat.
 * → { exits, entries, sel } (sel null: evren yetersiz, değişiklik yok).
 */
export function rebalance(pf, universe, prices, now, o = MOM_DEFAULTS) {
  const p = { ...o };
  const ranks = universe.map((u) => {
    const c = u.candles; if (!c || c.length < 2) return null;
    const atr = I.atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14);
    const i = c.length - 1;
    const vol = c.slice(-p.volDays).reduce((a, x) => a + (quoteVolOf(x) || 0), 0);
    const m = momentumAt(u.coin, c, i, atr, p, vol);
    return m && { ...m, atr: atr[i] };
  });
  let R = ranks;
  if (p.rank === 'rel') { const b = ranks.find((x) => x && x.coin === 'BTC'); if (!b) { pf.lastRebalance = now; return { exits: [], entries: [], resized: [], sel: null }; } R = ranks.map((x) => (x && x.coin !== 'BTC' ? { ...x, r: x.r - b.r } : null)); }
  const sel = selectAt(R, p, { pitN: o.pitN }); // laboratuvarla aynı: o anki 30 günlük hacimde ilk pitN
  pf.lastRebalance = now;
  if (!sel) return { exits: [], entries: [], resized: [], sel: null };
  const want = new Map([...sel.longs.map((c) => [c, 1]), ...sel.shorts.map((c) => [c, -1])]);
  const exits = [];
  for (const q of [...pf.positions]) if (want.get(q.coin) !== q.d && prices[q.coin] != null) exits.push(closePos(pf, q, prices[q.coin], 'rebalance', now, o));
  const equity = equityOf(pf, prices);
  const entries = [], resized = [];
  const atrOf = new Map(ranks.filter(Boolean).map((x) => [x.coin, x.atr]));
  // Listede kalan pozisyonlar: eşit risk hedefine yeniden boyutla (stop yerinde kalır; risk = mevcut stop uzaklığı)
  for (const q of pf.positions) {
    const px = prices[q.coin]; if (px == null) continue;
    const r = resizePos(pf, q, px, targetNotional(equity, Math.abs(px - q.stop) / px, o), now, o);
    if (r) resized.push(r);
  }
  for (const [coin, d] of want) {
    if (pf.positions.some((q) => q.coin === coin)) continue;
    const px = prices[coin], atr = atrOf.get(coin);
    if (px == null || !atr) continue;
    const entry = px * (1 + d * (o.slipPct / 100));
    const stop = entry - d * o.stopAtr * atr;
    const stopPct = (o.stopAtr * atr) / entry;
    const notional = targetNotional(equity, stopPct, o);
    const q = { coin, instId: universe.find((u) => u.coin === coin)?.instId, d, entry: +entry.toPrecision(8), qty: notional / entry, notional: +notional.toFixed(2), stop: +stop.toPrecision(8), stop0: +stop.toPrecision(8), risk: stopPct, stopPct: +(stopPct * 100).toFixed(1), riskUsd: +(notional * stopPct).toFixed(2), entryTime: now, funding: 0, trailDay: universe.find((u) => u.coin === coin)?.candles.at(-1)?.time ?? 0, lastPrice: px };
    pf.positions.push(q);
    entries.push(q);
  }
  pf.rebalances.push({ time: now, longs: sel.longs, shorts: sel.shorts, equity: +equity.toFixed(2) });
  if (pf.rebalances.length > 60) pf.rebalances.splice(0, pf.rebalances.length - 60);
  return { exits, entries, resized, sel };
}

/** Özsermaye eğrisine nokta (en fazla saatte bir). */
export function markCurve(pf, prices, now, o = MOM_DEFAULTS) {
  const eq = +equityOf(pf, prices).toFixed(2);
  const last = pf.curve[pf.curve.length - 1];
  if (!last || now - last[0] >= 3600e3) pf.curve.push([now, eq]); else last[1] = eq;
  if (pf.curve.length > o.maxCurve) pf.curve.splice(0, pf.curve.length - o.maxCurve);
  return eq;
}

/** Sayfa için yayın nesnesi. */
export function publishOf(pf, prices, now, o = MOM_DEFAULTS, btcPrice = null) {
  const eq = equityOf(pf, prices);
  const closed = pf.trades;
  const wins = closed.filter((t) => t.pnl > 0);
  return {
    updatedAt: now, variant: o.side, params: { lookback: o.lookback, k: o.k, side: o.side, rank: o.rank, stopAtr: o.stopAtr, feePct: o.feePct, slipPct: o.slipPct, fundingPct8h: o.fundingPct8h, riskPct: o.riskPct, pitN: o.pitN, universe: o.universe },
    start: pf.start, startEquity: pf.startEquity, equity: +eq.toFixed(2), pnlPct: +(((eq / pf.startEquity) - 1) * 100).toFixed(2), realized: +pf.realized.toFixed(2),
    btc: pf.btcStart && btcPrice ? { start: pf.btcStart, now: btcPrice, pct: +(((btcPrice / pf.btcStart) - 1) * 100).toFixed(2) } : null,
    lastRebalance: pf.lastRebalance || null, nextRebalance: lastWeekClose(now) + 7 * DAY,
    positions: pf.positions.map((q) => { const px = prices[q.coin] ?? q.lastPrice ?? q.entry; const pnl = pnlOf(q, px) - q.funding; return { coin: q.coin, direction: q.d === 1 ? 'long' : 'short', entry: q.entry, price: px, stop: q.stop, stopPct: +((Math.abs(px - q.stop) / px) * 100).toFixed(1), riskUsd: +(q.qty * Math.abs(px - q.stop)).toFixed(2), notional: q.notional, pnl: +pnl.toFixed(2), pct: +((pnl / q.notional) * 100).toFixed(2), entryTime: q.entryTime, funding: +q.funding.toFixed(3) }; }),
    stats: { trades: closed.length, winRate: closed.length ? +(wins.length / closed.length).toFixed(3) : 0, avgPct: closed.length ? +(closed.reduce((a, t) => a + t.pct, 0) / closed.length).toFixed(2) : 0 },
    trades: closed.slice(-200).reverse(), rebalances: pf.rebalances.slice(-12).reverse(), curve: pf.curve,
  };
}
