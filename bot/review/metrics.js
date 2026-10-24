// Denetçi ölçümleri (saf): sinyal geçmişi, ajan hesapları ve momentum portföyünden dönem özetleri.
// signals.html'deki R hesabıyla aynı kural (erken kâr, zaman stopu, düşen bıçak durumları dahil).
export const CLOSED = new Set(['done', 'stopped', 'expired', 'missed', 'knife', 'timeout', 'be']);
const NOFILL = new Set(['waiting', 'expired', 'missed', 'confirming', 'knife']);

const earlyR = (s) => Math.abs(s.early - s.entry) / Math.abs(s.entry - s.stop);
/** Kapanmış sinyalin R'si; açık ya da dolmamışsa null. */
export function finalR(s) {
  if (s.early) { const p = s.earlyPortion ?? 0.8; if (s.status === 'stopped') return -1; if (s.status === 'be') return p * earlyR(s); if (s.status === 'done') return p * earlyR(s) + (1 - p) * (s.rr || 2.5); return null; }
  if (s.status === 'timeout') return s.exitR ?? null;
  if (s.status === 'stopped') return s.tp1At ? 0.5 * (s.rr1 || 1.5) : -1;
  if (s.status === 'done') return 0.5 * (s.rr1 || 1.5) + 0.5 * (s.rr || 2.5);
  return null;
}
const r3 = (x) => +Number(x).toFixed(3);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Sinyal listesinin özeti. */
export function signalStats(list) {
  const n = list.length;
  const filled = list.filter((s) => !NOFILL.has(s.status)).length;
  const c = (st) => list.filter((s) => s.status === st).length;
  const Rs = list.map(finalR).filter((x) => x != null);
  const adverse = list.filter((s) => s.btcAtSend && s.btcAtClose && finalR(s) != null && ((s.direction === 'long') === (s.btcAtClose < s.btcAtSend))).map(finalR);
  const byTf = {};
  for (const s of list) { const R = finalR(s); (byTf[s.tf] ??= { n: 0, closed: 0, sumR: 0 }); byTf[s.tf].n++; if (R != null) { byTf[s.tf].closed++; byTf[s.tf].sumR += R; } }
  for (const k of Object.keys(byTf)) byTf[k].avgR = byTf[k].closed ? r3(byTf[k].sumR / byTf[k].closed) : null;
  return {
    sent: n, filled, fillRate: n ? r3(filled / n) : 0, stopped: c('stopped'), done: c('done'), early: c('early') + c('be') + list.filter((s) => s.early && s.status === 'done').length, knife: c('knife'), expired: c('expired'), missed: c('missed'), timeout: c('timeout'),
    open: list.filter((s) => !CLOSED.has(s.status)).length, closed: Rs.length,
    winRate: Rs.length ? r3(Rs.filter((r) => r > 0).length / Rs.length) : null, avgR: Rs.length ? r3(avg(Rs)) : null, totalR: r3(Rs.reduce((a, b) => a + b, 0)),
    btcAdverse: { n: adverse.length, avgR: adverse.length ? r3(avg(adverse)) : null }, byTf,
  };
}

/** Ajan hesabı özeti (docs/agent/<profil>.json). */
export function agentSummary(a) {
  if (!a) return null;
  const tr = (a.trades || []).filter((t) => !t.hedgeOf);
  const last7 = tr.filter((t) => t.closedAt >= Date.now() - 7 * 86400e3);
  return {
    label: a.label, equity: a.equity, returnPct: a.stats?.returnPct ?? null, trades: a.stats?.trades ?? tr.length, winRate: a.stats?.winRate ?? null, avgR: a.stats?.avgR ?? null, maxDD: a.stats?.maxDD ?? null, liquidations: a.stats?.liquidations ?? 0,
    open: (a.positions || []).filter((p) => !p.hedgeOf).length, orders: (a.orders || []).length, last7: { n: last7.length, avgR: last7.length ? r3(avg(last7.map((t) => t.R))) : null },
    lessons: (a.lessons || []).slice(-5),
  };
}

/** Momentum portföyü özeti (docs/agent/momentum.json). */
export function momentumSummary(m) {
  if (!m) return null;
  const hedgeLeg = (m.positions || []).find((p) => p.hedge);
  return { variant: m.variant, rank: m.params?.rank, hedge: m.hedge, equity: m.equity, pnlPct: m.pnlPct, altNetExposure: m.netExposure, hedgeNotional: m.hedgeNotional ?? 0, netAfterHedge: hedgeLeg ? +((m.netExposure ?? 0) + (hedgeLeg.direction === 'long' ? 1 : -1) * hedgeLeg.notional).toFixed(2) : m.netExposure, note: 'altNetExposure alt pozisyonların net yönü; hedge bacağı ters BTC; netAfterHedge ≈ 0 beklenir. trades yalnız kapanan alt pozisyonları sayar (haftalık yeniden dengeleme).', positions: (m.positions || []).filter((p) => !p.hedge).length, btcPct: m.btc?.pct ?? null, lastRebalance: m.lastRebalance, trades: m.stats?.trades ?? 0, avgPct: m.stats?.avgPct ?? null };
}

/** Beklenti: taramadaki 4H düzeni satırı (varsa) → karşılaştırma için eğitim/doğrulama R ve kazanma. */
export function expectedOf(sweep) {
  const v = sweep?.results?.find((r) => r.targeted && /elle yönetim/.test(r.name) && /üst TF eğilimi aynı yön$/.test(r.name)) || sweep?.results?.find((r) => r.targeted && /elle yönetim/.test(r.name));
  if (!v) return null;
  const tf4 = v.byTf?.valid?.['4H'];
  return { name: v.name, valid: { n: v.valid.n, avgR: v.valid.avgR, winRate: v.valid.winRate }, tf4h: tf4 ? { n: tf4.n, avgR: tf4.avgR, winRate: tf4.winRate } : null, hedgedValid4h: v.hedgedByTf?.valid?.['4H']?.avgR ?? null };
}

/**
 * Denetçi girdisi. history: {items}; agents: {temkinli, agresif}; momentum; sweep; now.
 * → { periods: {d1, d7, d30}, agents, momentum, expected, openSignals }
 */
export function metricsOf({ history, agents = {}, momentum = null, sweep = null, now = Date.now(), lastRejects = null, ruleSince = null, ruleLabel = null }) {
  const items = history?.items || [];
  const since = (d) => items.filter((s) => s.sentAt >= now - d * 86400e3);
  const firstSignalAt = items.length ? Math.min(...items.map((s) => s.sentAt)) : null;
  // Aktif kural seti ne zamandan beri geçerli: öncesi "eski rejim" (farklı TF'ler/kurallar), beklentiyle kıyaslanmaz
  const current = ruleSince ? items.filter((s) => s.sentAt >= ruleSince) : [];
  const legacy = ruleSince ? items.filter((s) => s.sentAt < ruleSince) : items;
  const openSignals = items.filter((s) => !CLOSED.has(s.status)).map((s) => ({ coin: s.coin, tf: s.tf, direction: s.direction, status: s.status, entry: s.entry, stop: s.stop, early: s.early ?? null, sentAt: s.sentAt, htfTrend: s.htfTrend ?? null }));
  const recentClosed = items.filter((s) => (s.closedAt || 0) >= now - 86400e3 && finalR(s) != null).map((s) => ({ coin: s.coin, tf: s.tf, direction: s.direction, status: s.status, R: r3(finalR(s)), approachAtr: s.approachAtr ?? null, htfTrend: s.htfTrend ?? null }));
  return {
    at: now,
    dataSince: firstSignalAt, dataDays: firstSignalAt ? +((now - firstSignalAt) / 86400e3).toFixed(1) : 0,
    rules: { since: ruleSince, label: ruleLabel, hoursActive: ruleSince ? +((now - ruleSince) / 3600e3).toFixed(1) : null, currentRules: signalStats(current), legacyRules: signalStats(legacy), legacyOpen: legacy.filter((s) => !CLOSED.has(s.status)).length },
    periods: { d1: signalStats(since(1)), d7: signalStats(since(7)), d30: signalStats(since(30)) },
    recentClosed, openSignals, lastRejects,
    agents: Object.fromEntries(Object.entries(agents).map(([k, v]) => [k, agentSummary(v)])),
    momentum: momentumSummary(momentum), expected: expectedOf(sweep),
  };
}
