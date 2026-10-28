// Check list ölçümü (saf): işlem listesi + her işlemin madde sonuçları → madde madde etki, ağırlıksız sayım kovaları,
// eğitimden öğrenilen ağırlıklarla puan (doğrulamada test). trades: { time, R, hedgedR, outcome, ok: { id: true|false|null } }.
import { stats } from './report.js';
import { CHECKS } from '../src/scan/checklist.js';

const IDS = CHECKS.map((c) => c.id);
const hedged = (a) => a.filter((t) => t.hedgedR != null).map((t) => ({ ...t, R: t.hedgedR }));
const pick = (s) => ({ n: s.n, avgR: s.avgR, PF: s.profitFactor, win: s.winRate });
const slices = (a, split) => ({ train: a.filter((t) => t.time < split), valid: a.filter((t) => t.time >= split) });

/** Bir kümenin eğitim/doğrulama ve hedge'li özetleri. */
export function block(a, split) {
  const { train, valid } = slices(a, split);
  return { train: pick(stats(train)), valid: pick(stats(valid)), hTrain: pick(stats(hedged(train))), hValid: pick(stats(hedged(valid))) };
}

/** Madde madde: ✓ ve ✗ kümeleri (? = veri yok, ikisine de girmez) ve fark (Δ = ✓ − ✗, ort. R). */
export function perItem(trades, split) {
  const out = {};
  for (const id of IDS) {
    const yes = trades.filter((t) => t.ok[id] === true), no = trades.filter((t) => t.ok[id] === false);
    const Y = block(yes, split), N = block(no, split);
    const d = (k) => (Y[k].n && N[k].n ? +(Y[k].avgR - N[k].avgR).toFixed(3) : null);
    out[id] = { yes: Y, no: N, delta: { train: d('train'), valid: d('valid'), hTrain: d('hTrain'), hValid: d('hValid') } };
  }
  return out;
}

const countOf = (t) => IDS.filter((id) => t.ok[id] === true).length;
const BUCKETS = [[0, 3, '≤ 3'], [4, 4, '4'], [5, 5, '5'], [6, 6, '6'], [7, 7, '7'], [8, 10, '≥ 8']];

/** Ağırlıksız sayım (kartta görünen n/10) kovaları. */
export function byCount(trades, split) {
  return BUCKETS.map(([lo, hi, label]) => ({ label, ...block(trades.filter((t) => { const n = countOf(t); return n >= lo && n <= hi; }), split) }));
}

/**
 * Ağırlıklı puan: w = max(0, eğitimde ✓ ort. R − ✗ ort. R), her iki tarafta n ≥ minN değilse 0 (key: 'R' ya da 'hedgedR').
 * Puan = Σ w × ✓. Eşikler eğitim puanlarının üçte birlik dilimleri; doğrulama aynı eşiklerle → düşük / orta / yüksek.
 */
export function weighted(trades, split, { key = 'R', minN = 30 } = {}) {
  const train = trades.filter((t) => t.time < split && t[key] != null && TRADED(t));
  const w = {};
  for (const id of IDS) {
    const y = train.filter((t) => t.ok[id] === true), n = train.filter((t) => t.ok[id] === false);
    const m = (a) => a.reduce((s, t) => s + t[key], 0) / a.length;
    w[id] = y.length >= minN && n.length >= minN ? +Math.max(0, m(y) - m(n)).toFixed(3) : 0;
  }
  const score = (t) => IDS.reduce((s, id) => s + (t.ok[id] === true ? w[id] : 0), 0);
  const ts = train.map(score).sort((a, b) => a - b);
  const q1 = ts[Math.floor(ts.length / 3)] ?? 0, q2 = ts[Math.floor((2 * ts.length) / 3)] ?? 0;
  const tier = (t) => { const s = score(t); return s > q2 ? 'yüksek' : s > q1 ? 'orta' : 'düşük'; };
  const tiers = ['düşük', 'orta', 'yüksek'].map((label) => ({ label, ...block(trades.filter((t) => tier(t) === label), split) }));
  return { key, weights: w, cut: [+q1.toFixed(3), +q2.toFixed(3)], tiers };
}
const TRADED_SET = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'time_stop']);
const TRADED = (t) => TRADED_SET.has(t.outcome);

export function checklistReport(trades, split) {
  const n = trades.filter(TRADED).length;
  return { n, all: block(trades, split), perItem: perItem(trades, split), byCount: byCount(trades, split), weighted: weighted(trades, split, { key: 'R' }), weightedHedged: weighted(trades, split, { key: 'hedgedR' }) };
}
