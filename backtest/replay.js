// Canlı-backtest eşleştirme: canlı sinyali (geçmiş kaydı) aynı seviyelerle gerçek mumlarda yeniden oynatır.
// İki ölçüm: (1) canlı takip kodu (trackPlan) tam veriyle — canlıda kaydedilen sonuçla aynı mı?
// (2) backtest motoru (simulateTrade) aynı planla — motor ile canlı takip kuralı aynı sonucu mu veriyor?
import { trackPlan, PLAN_DEFAULTS, CLOSED } from '../bot/plan.js';
import { finalR } from '../bot/review/metrics.js';
import { simulateTrade, BT_DEFAULTS } from './engine.js';
import { TIMEFRAMES } from '../src/data/okx.js';

/** Geçmiş kaydından gönderim anındaki plan (takip alanları temizlenmiş). Piyasa girişi: activeAt === sentAt. */
export function planOfItem(s) {
  const market = s.activeAt != null && s.activeAt === s.sentAt;
  const entry = s.entryPlanned ?? s.entry;
  const risk = s.d * (entry - s.stop);
  const plan = {
    key: s.key, coin: s.coin, tf: s.tf, direction: s.direction, d: s.d, entry, stop: s.stop, tp1: s.tp1, tp2: s.tp2,
    atr: s.atr, zone: s.zone, sentAt: s.sentAt, status: market ? 'active' : 'waiting', inZone: market,
    rr1: risk > 0 ? +((s.d * (s.tp1 - entry)) / risk).toFixed(2) : s.rr1, rr: risk > 0 ? +((s.d * (s.tp2 - entry)) / risk).toFixed(2) : s.rr,
  };
  if (s.early) Object.assign(plan, { early: s.early, earlyPortion: s.earlyPortion ?? 0.8 });
  return plan;
}

/**
 * Canlı takibi taklit eder: önce yalnız ilk expireHours içindeki mumlar (bekleyen emir o sürede düşer), sonra
 * mevcut durumla tüm mumlar (canlı bot her turda sentAt'tan yeniden tarar). candles: kapanmış mumlar, eskiden yeniye.
 */
export function replayTrack(plan, candles, now, { knifeGuard = null, expireHours = PLAN_DEFAULTS.expireHours } = {}) {
  const exp = plan.sentAt + expireHours * 3600e3;
  let p = { ...plan };
  const events = [];
  const step = (cs, t) => {
    const r = trackPlan(p, cs, t, { knifeGuard, expireHours });
    p = { ...p, ...r.patch, status: r.status };
    if (r.events.some((e) => e === 'tp1' || e === 'early')) p.tp1At = p.tp1At ?? 1;
    events.push(...r.events);
  };
  step(candles.filter((c) => c.time + (TIMEFRAMES[plan.tf]?.ms || 0) <= Math.min(exp, now)), Math.min(exp + 1, now));
  if (now > exp && !CLOSED.has(p.status)) step(candles, now);
  return { status: p.status, events, R: finalR(p), plan: p };
}

/** Motor: aynı plan; erken kâr varsa TP1 = erken hedef, kısım = earlyPortion (half_be ile aynı mekanik). */
export function replayEngine(plan, candles, { knifeGuard = null, feePct = 0, slipPct = 0 } = {}) {
  const from = candles.findIndex((c) => c.time > plan.sentAt);
  if (from < 0) return { outcome: 'nodata', R: null };
  const p = { ...plan, ...(plan.early ? { tp1: plan.early } : {}) };
  const o = { ...BT_DEFAULTS, feePct, slipPct, knifeGuard, tpScheme: 'half_be', tp1Portion: plan.early ? plan.earlyPortion : 0.5 };
  const r = simulateTrade(p, candles, from, plan.tf, o);
  // Açık kalan (veri sonu) işlemler sonuçsuz sayılır
  const open = (r.outcome === 'timeout' || r.outcome === 'tp1_timeout') && from + (r.bars ?? 0) >= candles.length - 1;
  const R = ['expired', 'missed', 'knife', 'invalid'].includes(r.outcome) ? null : open ? null : r.R;
  return { outcome: open ? 'open' : r.outcome, R };
}

const r3 = (x) => (x == null ? null : +x.toFixed(3));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Tek kayıt: kaydedilen / takip yeniden / motor. */
export function replayItem(s, candles, now, opts = {}) {
  const plan = planOfItem(s);
  const t = replayTrack(plan, candles, now, opts);
  const e = replayEngine(plan, candles, opts);
  const rec = CLOSED.has(s.status) ? finalR(s) : null;
  return {
    id: s.id, coin: s.coin, tf: s.tf, direction: s.direction, sentAt: s.sentAt, market: plan.inZone,
    recorded: { status: s.status, R: r3(rec) }, track: { status: t.status, R: r3(t.R) }, engine: { outcome: e.outcome, R: r3(e.R) },
    match: !CLOSED.has(s.status) ? null : s.status === t.status,
  };
}

/** Grup özeti: üç ölçümün ort. R'si (her biri kendi kapanmış kayıtlarıyla) + aynı kayıtlarda karşılaştırma. */
export function summarize(rows) {
  const st = (k) => { const a = rows.map((r) => r[k].R).filter((x) => x != null); return { n: a.length, avgR: r3(avg(a)), win: a.length ? r3(a.filter((x) => x > 0).length / a.length) : null }; };
  const both = rows.filter((r) => r.recorded.R != null && r.track.R != null);
  const recClosed = rows.filter((r) => r.match != null);
  return {
    n: rows.length, recorded: st('recorded'), track: st('track'), engine: st('engine'),
    statusMatch: recClosed.length ? r3(recClosed.filter((r) => r.match).length / recClosed.length) : null, compared: recClosed.length,
    sameSet: { n: both.length, recorded: r3(avg(both.map((r) => r.recorded.R))), track: r3(avg(both.map((r) => r.track.R))) },
    reopened: rows.filter((r) => !CLOSED.has(r.recorded.status) && CLOSED.has(r.track.status)).length,
  };
}
