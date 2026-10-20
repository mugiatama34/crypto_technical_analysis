// Kâğıt hesap simülasyonu (saf): izole marjinli perp pozisyonlar, likidasyon, komisyon, kayma, kısmi kapanış,
// bekleyen limit emirler, sert sınırlarla kırpma, istatistik ve özsermaye eğrisi.
import { FEES } from './profiles.js';

const r6 = (x) => +Number(x).toPrecision(8);
const dirSign = (d) => (d === 'long' ? 1 : -1);
let seq = 0;
export const newId = (p) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function newAccount(profile, now = Date.now()) {
  return {
    profile: profile.id, label: profile.label, createdAt: now, lastRun: null,
    equity: profile.startEquity, cash: profile.startEquity, startEquity: profile.startEquity,
    positions: [], orders: [], trades: [], journal: [], lessons: [], params: { ...profile.params }, paramsHistory: [{ at: now, params: { ...profile.params }, reason: 'başlangıç' }],
    stats: { trades: 0, wins: 0, losses: 0, liquidations: 0, grossProfit: 0, grossLoss: 0, maxEquity: profile.startEquity, maxDD: 0, sumR: 0 },
    curve: [[now, profile.startEquity]], day: { key: dayKey(now), startEquity: profile.startEquity, halted: false },
    closedSinceReview: 0, lastReview: now, notes: [],
  };
}

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Likidasyon fiyatı (izole): long = giriş × (1 − 1/kaldıraç + mmr), short = giriş × (1 + 1/kaldıraç − mmr). */
export function liqPrice(entry, leverage, direction, mmrPct = FEES.mmrPct) {
  const d = dirSign(direction);
  return entry * (1 - d * (1 / leverage - mmrPct / 100));
}

/** Açık pozisyonların mevcut fiyatla gerçekleşmemiş K/Z'si ve özsermaye. */
export function markToMarket(acct, prices) {
  let unreal = 0;
  for (const p of acct.positions) {
    const px = prices[p.coin] ?? p.lastPrice ?? p.entry;
    p.lastPrice = px;
    p.unrealized = r6(p.qty * (px - p.entry) * dirSign(p.direction));
    unreal += p.unrealized;
  }
  acct.equity = r6(acct.cash + acct.positions.reduce((s, p) => s + p.margin, 0) + unreal);
  return acct.equity;
}

/** Sert sınırlara göre açılış isteğini kırpar; uygunsuzsa reason döner. */
export function clampOpen(acct, req, guards, now) {
  const notes = [];
  if (acct.day.halted) return { ok: false, reason: 'günlük kayıp sınırı: bugün yeni pozisyon yok' };
  if (acct.positions.length + acct.orders.length >= guards.maxPositions) return { ok: false, reason: `en fazla ${guards.maxPositions} pozisyon/emir` };
  if (acct.positions.some((p) => p.coin === req.coin) || acct.orders.some((o) => o.coin === req.coin)) return { ok: false, reason: `${req.coin} için zaten pozisyon/emir var` };
  let leverage = Math.max(1, Math.round(+req.leverage || 1));
  if (leverage > guards.maxLeverage) { notes.push(`kaldıraç ${leverage}→${guards.maxLeverage}`); leverage = guards.maxLeverage; }
  let margin = +req.margin || 0;
  const cap = (acct.equity * guards.maxMarginPct) / 100;
  if (margin > cap) { notes.push(`marjin ${margin.toFixed(0)}→${cap.toFixed(0)} (≤ %${guards.maxMarginPct})`); margin = cap; }
  const usable = acct.cash - margin * leverage * (FEES.takerPct / 100);
  if (margin > usable) { notes.push(`marjin nakde göre ${margin.toFixed(0)}→${Math.max(0, usable).toFixed(0)}`); margin = Math.max(0, usable); }
  if (margin < guards.minMargin) return { ok: false, reason: `marjin ${margin.toFixed(1)} < ${guards.minMargin} USDT` };
  const d = dirSign(req.direction);
  const ref = req.order === 'limit' ? +req.limit_price : +req.price;
  if (!(ref > 0)) return { ok: false, reason: 'fiyat yok' };
  let stop = +req.stop, tp1 = +req.tp1 || null, tp2 = +req.tp2 || null;
  if (!(stop > 0) || d * (ref - stop) <= 0) return { ok: false, reason: 'stop yanlış tarafta' };
  const liq = liqPrice(ref, leverage, req.direction);
  if (d * (stop - liq) <= 0) { notes.push(`stop likidasyonun ötesinde (${liq.toPrecision(5)}), likidasyonun içine çekildi`); stop = ref - d * 0.9 * Math.abs(ref - liq); }
  if (tp1 && d * (tp1 - ref) <= 0) tp1 = null;
  if (tp2 && d * (tp2 - ref) <= 0) tp2 = null;
  if (tp1 && tp2 && d * (tp2 - tp1) < 0) [tp1, tp2] = [tp2, tp1];
  return { ok: true, leverage, margin: r6(margin), stop: r6(stop), tp1: tp1 && r6(tp1), tp2: tp2 && r6(tp2), notes, liq: r6(liq) };
}

/** Pozisyon açar (piyasa) ya da limit emir koyar. */
export function openPosition(acct, req, now, guards) {
  const c = clampOpen(acct, req, guards, now);
  if (!c.ok) return { ok: false, reason: c.reason };
  const base = { id: newId(acct.profile), coin: req.coin, tf: req.tf, direction: req.direction, leverage: c.leverage, margin: c.margin, stop: c.stop, tp1: c.tp1, tp2: c.tp2, rationale: req.rationale || '', signals: req.signals || [], notes: c.notes, createdAt: now, beAfterTp1: req.beAfterTp1 !== false };
  if (req.order === 'limit') {
    acct.orders.push({ ...base, type: 'limit', price: r6(+req.limit_price), expiresAt: now + (req.expireHours || 24) * 3600e3 });
    return { ok: true, order: acct.orders[acct.orders.length - 1], notes: c.notes };
  }
  const fill = r6(+req.price * (1 + dirSign(req.direction) * FEES.slipPct / 100));
  return { ok: true, position: fillPosition(acct, base, fill, now), notes: c.notes };
}

function fillPosition(acct, base, fill, now) {
  const notional = base.margin * base.leverage;
  const qty = notional / fill;
  const fee = notional * (FEES.takerPct / 100);
  acct.cash = r6(acct.cash - base.margin - fee);
  const pos = { ...base, entry: fill, qty: r6(qty), qty0: r6(qty), notional: r6(notional), fees: r6(fee), realized: 0, liq: r6(liqPrice(fill, base.leverage, base.direction)), openedAt: now, lastTime: now, lastPrice: fill, unrealized: 0, initialRisk: r6(qty * Math.abs(fill - base.stop)), tp1Done: false };
  acct.positions.push(pos);
  return pos;
}

/** Kısmi/tam kapanış. kind: 'stop'|'tp1'|'tp2'|'liq'|'manual'|'trail' */
function closePart(acct, pos, portion, price, kind, now, events) {
  const d = dirSign(pos.direction);
  const q = portion >= 1 ? pos.qty : r6(pos.qty * portion);
  const pnl = q * (price - pos.entry) * d;
  const fee = kind === 'liq' ? 0 : q * price * (FEES.takerPct / 100);
  const marginShare = pos.margin * (q / pos.qty0);
  let back = marginShare + pnl - fee;
  if (kind === 'liq') back = 0; // marjin tamamen gider
  acct.cash = r6(acct.cash + Math.max(0, back));
  pos.realized = r6(pos.realized + (kind === 'liq' ? -marginShare : pnl - fee));
  pos.fees = r6(pos.fees + fee);
  pos.qty = r6(pos.qty - q);
  pos.margin = r6(pos.margin - marginShare);
  events.push({ type: kind, pos, price, qty: q, pnl: r6(kind === 'liq' ? -marginShare : pnl - fee) });
  if (pos.qty <= 1e-12 || portion >= 1) finalizeTrade(acct, pos, kind, now, events);
}

function finalizeTrade(acct, pos, kind, now) {
  acct.positions = acct.positions.filter((p) => p !== pos);
  const pnl = pos.realized;
  const R = pos.initialRisk > 0 ? pnl / pos.initialRisk : 0;
  const trade = { id: pos.id, coin: pos.coin, tf: pos.tf, direction: pos.direction, leverage: pos.leverage, margin: r6(pos.margin0 ?? (pos.notional / pos.leverage)), entry: pos.entry, stop: pos.stop, tp1: pos.tp1, tp2: pos.tp2, openedAt: pos.openedAt, closedAt: now, outcome: kind, pnl: r6(pnl), R: +R.toFixed(2), pnlPct: +((pnl / (pos.notional / pos.leverage)) * 100).toFixed(2), rationale: pos.rationale, signals: pos.signals, notes: pos.notes, reflection: null };
  acct.trades.push(trade);
  const s = acct.stats;
  s.trades++; if (pnl > 0) { s.wins++; s.grossProfit = r6(s.grossProfit + pnl); } else { s.losses++; s.grossLoss = r6(s.grossLoss - pnl); }
  if (kind === 'liq') s.liquidations++;
  s.sumR = r6(s.sumR + R);
  acct.closedSinceReview++;
  return trade;
}

/**
 * Bekleyen emirleri ve açık pozisyonları yeni mumlarla günceller.
 * @param candlesByCoin { [coin]: candles (eskiden yeniye; pozisyonun lastTime'ından sonrakiler işlenir) }
 */
export function updatePositions(acct, candlesByCoin, now) {
  const events = [];
  // Limit emirler
  for (const o of [...acct.orders]) {
    const cs = (candlesByCoin[o.coin] || []).filter((c) => c.time > o.createdAt);
    let filled = false;
    for (const c of cs) {
      const d = dirSign(o.direction);
      if (d === 1 ? c.low <= o.price : c.high >= o.price) {
        acct.orders = acct.orders.filter((x) => x !== o);
        const pos = fillPosition(acct, { ...o, type: undefined, price: undefined, expiresAt: undefined }, o.price, c.time);
        pos.lastTime = c.time - 1; // bu mumun kalanı aşağıda işlenir
        events.push({ type: 'filled', pos, price: o.price });
        filled = true; break;
      }
    }
    if (!filled && now > o.expiresAt) { acct.orders = acct.orders.filter((x) => x !== o); events.push({ type: 'expired', order: o }); }
  }
  // Pozisyonlar
  for (const pos of [...acct.positions]) {
    const cs = (candlesByCoin[pos.coin] || []).filter((c) => c.time > pos.lastTime);
    for (const c of cs) {
      if (!acct.positions.includes(pos)) break;
      const d = dirSign(pos.direction);
      const liqHit = d === 1 ? c.low <= pos.liq : c.high >= pos.liq;
      const stopHit = d === 1 ? c.low <= pos.stop : c.high >= pos.stop;
      const tp1Hit = pos.tp1 && !pos.tp1Done && (d === 1 ? c.high >= pos.tp1 : c.low <= pos.tp1);
      const tp2Hit = pos.tp2 && (d === 1 ? c.high >= pos.tp2 : c.low <= pos.tp2);
      if (liqHit) { closePart(acct, pos, 1, pos.liq, 'liq', c.time, events); break; }
      if (stopHit) { closePart(acct, pos, 1, pos.stop * (1 - d * FEES.slipPct / 100), pos.tp1Done ? 'tp1_stop' : 'stop', c.time, events); break; }
      if (tp1Hit) {
        if (pos.tp2) { closePart(acct, pos, 0.5, pos.tp1, 'tp1', c.time, events); pos.tp1Done = true; if (pos.beAfterTp1) pos.stop = r6(pos.entry); }
        else { closePart(acct, pos, 1, pos.tp1, 'tp2', c.time, events); break; }
        if (tp2Hit) { closePart(acct, pos, 1, pos.tp2, 'tp2', c.time, events); break; }
        continue;
      }
      if (tp2Hit && pos.tp1Done) { closePart(acct, pos, 1, pos.tp2, 'tp2', c.time, events); break; }
      pos.lastTime = c.time; pos.lastPrice = c.close;
    }
    if (acct.positions.includes(pos) && cs.length) pos.lastTime = cs[cs.length - 1].time;
  }
  return events;
}

/** Elle kapanış (piyasa). */
export function closeManual(acct, posId, price, now, reason = '') {
  const pos = acct.positions.find((p) => p.id === posId);
  if (!pos) return null;
  const events = [];
  pos.rationale += reason ? ` | kapanış: ${reason}` : '';
  closePart(acct, pos, 1, price * (1 - dirSign(pos.direction) * FEES.slipPct / 100), 'manual', now, events);
  return events[0];
}

/** Stop/TP ayarı; stop yanlış tarafa ya da likidasyonun ötesine alınamaz. */
export function adjustPosition(acct, posId, { stop, tp1, tp2 }) {
  const pos = acct.positions.find((p) => p.id === posId);
  if (!pos) return { ok: false, reason: 'pozisyon yok' };
  const d = dirSign(pos.direction), px = pos.lastPrice;
  const notes = [];
  if (stop != null) { if (d * (px - stop) > 0 && d * (stop - pos.liq) > 0) { pos.stop = r6(stop); notes.push(`stop ${stop}`); } else notes.push('stop reddedildi'); }
  if (tp1 != null && d * (tp1 - px) > 0) { pos.tp1 = r6(tp1); notes.push(`tp1 ${tp1}`); }
  if (tp2 != null && d * (tp2 - px) > 0) { pos.tp2 = r6(tp2); notes.push(`tp2 ${tp2}`); }
  return { ok: true, notes };
}

/** Koşu sonu: özsermaye, günlük sınır, eğri, düşüş. */
export function endOfRun(acct, prices, now, guards) {
  markToMarket(acct, prices);
  const dk = dayKey(now);
  if (acct.day.key !== dk) acct.day = { key: dk, startEquity: acct.equity, halted: false };
  if (acct.equity < acct.day.startEquity * (1 - guards.dailyLossPct / 100)) acct.day.halted = true;
  const s = acct.stats;
  if (acct.equity > s.maxEquity) s.maxEquity = acct.equity;
  s.maxDD = r6(Math.max(s.maxDD, s.maxEquity - acct.equity));
  const last = acct.curve[acct.curve.length - 1];
  if (!last || Math.abs(last[1] - acct.equity) > 1e-9 || now - last[0] > 3600e3) acct.curve.push([now, r6(acct.equity)]);
  if (acct.curve.length > 2000) acct.curve = acct.curve.filter((_, i) => i % 2 === 0 || i === acct.curve.length - 1);
  acct.lastRun = now;
  return acct.equity;
}

export const statsOf = (acct) => {
  const s = acct.stats;
  return { ...s, winRate: s.trades ? +(s.wins / s.trades).toFixed(3) : 0, avgR: s.trades ? +(s.sumR / s.trades).toFixed(2) : 0, profitFactor: s.grossLoss ? +(s.grossProfit / s.grossLoss).toFixed(2) : (s.grossProfit ? Infinity : 0), returnPct: +(((acct.equity - acct.startEquity) / acct.startEquity) * 100).toFixed(1) };
};
