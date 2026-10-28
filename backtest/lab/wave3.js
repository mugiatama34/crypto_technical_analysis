// Dalga-3 limit bölge ailesi (klonnist/ew-setup-scanner kuralı): dalga 2 sürerken (0-1-A-B onaylı, C oluşuyor) görülen
// kurulumun bölgesine limit emir. Her mumda yalnız o ana kadarki W mum (geleceğe bakmaz); kurulum bir kez işlenir.
// Etiketler: SMT (C, A dibini süpürdü mü, BTC aynı anda süpürdü mü — yalnız long), ders kitabı x/4, C uzaması, ★ mükemmel.
// Yaklaşım: tek limit (yakın kenar), emir 96 saat geçerli (orijinalde "B kırılana kadar"); TP1 = 1 × dalga 1, TP2 = 1,618 ×.
import { findWave3Setups, DEFAULTS as W3 } from '../../src/scan/wave3.js';
import { smtApplies, smtPoints, smtCheck, timeIndex } from '../../src/scan/smt.js';

const W = 400; // pencere (mum)
const ACTIVE = new Set(['waiting', 'approaching']);
const r6 = (x) => +Number(x).toPrecision(8);

// Aynı mum dizisi için tarama bir kez (aileler aynı ön hesabı paylaşır): candles → Map(cExtend → bar → [{ key, d, plan }]).
// Yalnız küçük plan nesneleri saklanır (pencere ve kurulum nesnesi değil).
const memo = new WeakMap();
function setupsAt(candles, i, cExtend, opts, btc) {
  let m = memo.get(candles); if (!m) memo.set(candles, (m = new Map()));
  let byBar = m.get(cExtend); if (!byBar) m.set(cExtend, (byBar = new Map()));
  if (!byBar.has(i)) {
    const from = Math.max(0, i - W + 1), win = candles.slice(from, i + 1);
    let list = [];
    try { list = findWave3Setups(win, { ...opts, cExtend }).filter((s) => s.phase === 'forming' && s.zone && ACTIVE.has(s.zone.state)); } catch { list = []; }
    byBar.set(i, list.length ? list.map((s) => ({ key: `${from + s.points.p0.i}-${from + s.points.p1.i}-${from + s.abc.A.i}-${from + s.abc.B.i}`, d: s.d, plan: zonePlanOf(s, win, btc) })) : EMPTY);
  }
  return byBar.get(i);
}
const EMPTY = [];

/** Kurulum → lab planı (limit) + etiketler; uygun değilse null. */
export function zonePlanOf(s, win, ref, { minRR = 1.5 } = {}) {
  const Z = s.zone, d = s.d;
  const entry = Z.entry, stop = Z.stop, tp1 = Z.targets[0]?.price, tp2 = Z.targets[1]?.price;
  const risk = d * (entry - stop);
  if (!(risk > 0) || !(d * (tp1 - entry) > 0)) return null;
  const rr1 = (d * (tp1 - entry)) / risk;
  if (rr1 < minRR) return null;
  const smt = ref && smtApplies(s) ? smtCheck(win, ref, smtPoints(s), d) : null;
  return {
    d, direction: d === 1 ? 'long' : 'short', entry: r6(entry), stop: r6(stop), tp1: r6(tp1), tp2: r6(tp2), inZone: false,
    atr: r6(Z.atr), price: r6(win[win.length - 1].close), zone: [Math.min(Z.near, Z.far), Math.max(Z.near, Z.far)],
    tags: { smt, tb: s.textbook?.n ?? null, cExt: !!s.cExt, perfect: !!Z.perfect, rr1: +rr1.toFixed(2) },
  };
}

const mkW3 = (id, label, { cExtend = true, keep = () => true, dir = null } = {}) => ({
  id, label, tfs: ['4H'], exit: { tpScheme: 'half_be', maxHoldBars: 120, expireHours: 96 },
  prepare(candles, tf, extra) {
    const btc = extra.btc && extra.btc !== candles ? { candles: extra.btc, index: timeIndex(extra.btc) } : null;
    return { btc, seen: new Set(), opts: { ...W3, entryType: 'zone', zoneEntry: 'near', minRR: 0 } };
  },
  signal(i, candles, p) {
    if (i < 150) return null;
    for (const { key, d, plan } of setupsAt(candles, i, cExtend, p.opts, p.btc)) {
      if ((dir && d !== dir) || p.seen.has(key) || !plan) continue;
      p.seen.add(key);
      if (!keep(plan.tags)) continue;
      return plan;
    }
    return null;
  },
});

export const W3_STRATEGIES = [
  mkW3('w3_zone', 'Dalga-3 limit bölge (C uzaması açık), long + short'),
  mkW3('w3_zone_legacy', 'Dalga-3 limit bölge, eski C kuralı (bot/varsayılan)', { cExtend: false }),
  mkW3('w3_zone_long', 'Dalga-3 limit bölge, yalnız long', { dir: 1 }),
  mkW3('w3_zone_long_smt', 'Dalga-3 limit bölge long, SMT ✓ (C, A dibini süpürdü; BTC süpürmedi)', { dir: 1, keep: (t) => t.smt === 'smt' }),
  mkW3('w3_zone_long_nosmt', 'Dalga-3 limit bölge long, SMT değil (yok / ters / süpürme yok)', { dir: 1, keep: (t) => t.smt != null && t.smt !== 'smt' }),
  mkW3('w3_zone_tb3', 'Dalga-3 limit bölge, ders kitabı ≥ 3/4', { keep: (t) => t.tb >= 3 }),
  mkW3('w3_zone_tb4', 'Dalga-3 limit bölge, ders kitabı 4/4', { keep: (t) => t.tb === 4 }),
  mkW3('w3_zone_tb_low', 'Dalga-3 limit bölge, ders kitabı ≤ 2/4', { keep: (t) => t.tb != null && t.tb <= 2 }),
];
