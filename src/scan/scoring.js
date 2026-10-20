// Confluence puanlama: bir sembol + TF'nin sinyalleri fiyat bölgesine göre kümelenir, yön tutarlılığı ve
// detektör çeşitliliği ödüllendirilir; çoklu TF uyumu sembol düzeyinde ayrıca hesaplanır.
import { ACTIVE_STATUS, zonesOverlap, zoneMid } from '../core/signal.js';
import { DETECTOR_MAP } from './registry.js';
import { TIMEFRAMES } from '../data/okx.js';

export const SCORING_DEFAULTS = {
  clusterAtr: 0.5, // bölgeler bu × ATR içinde çakışıyorsa aynı küme
  maxZoneAtr: 4, // bundan geniş bölgeli sinyaller (ör. dealing range özeti) kümeye katılmaz
  statusWeight: { active: 1, triggered: 1, forming: 0.6, mitigated: 0.5, done: 0.3, invalid: 0 },
  repeatDecay: [1, 0.5, 0.25, 0.1], // aynı detektörün 1., 2., 3., 4.+ sinyalinin katkısı
  scale: 4.5, // doygunluk eğrisi: score = 100 × (1 − e^(−raw/scale))
  minScore: 0,
};

const dirSign = (d) => (d === 'long' ? 1 : d === 'short' ? -1 : 0);

/**
 * @param signals  tek sembol+TF'nin sinyalleri
 * @param weights  { detectorId: ağırlık } (yoksa registry varsayılanı)
 * @returns {{ clusters: Cluster[], best: Cluster|null }}
 * Cluster = { direction, score, zone, signals, types: Set, groups: Set, price }
 */
export function clusterSignals(signals, { atr, price, weights = {}, opts = {} }) {
  const o = { ...SCORING_DEFAULTS, ...opts };
  const tol = o.clusterAtr * (atr || 0);
  const usable = signals.filter((s) => s.zone && o.statusWeight[s.status] !== 0 && (s.zone[1] - s.zone[0]) <= o.maxZoneAtr * (atr || Infinity));
  // Yön başına kümeleme (nötr sinyaller her iki yöne de katılır, düşük ağırlıkla)
  const clusters = [];
  for (const dir of [1, -1]) {
    const pool = usable.filter((s) => dirSign(s.direction) === dir || dirSign(s.direction) === 0);
    const used = new Set();
    // Çekirdek: yönlü sinyaller, güçlüden zayıfa. Üyelik yalnızca ÇEKİRDEĞİN bölgesine göre (zincirleme büyüme yok).
    const seeds = pool.filter((s) => dirSign(s.direction) === dir).sort((a, b) => b.strength - a.strength);
    for (const seed of seeds) {
      if (used.has(seed.id)) continue;
      const members = [seed];
      used.add(seed.id);
      let zone = [...seed.zone];
      for (const s of pool) {
        if (used.has(s.id) || !zonesOverlap(seed.zone, s.zone, tol)) continue;
        members.push(s); used.add(s.id);
        zone = [Math.min(zone[0], s.zone[0]), Math.max(zone[1], s.zone[1])];
      }
      const width = (zone[1] - zone[0]) / (atr || 1);
      const c = scoreCluster(members, dir, zone, { price, atr, weights, o, width });
      clusters.push(c);
    }
    // Nötr sinyaller tek başına küme olmaz
  }
  clusters.sort((a, b) => b.score - a.score);
  return { clusters, best: clusters[0] || null };
}

function scoreCluster(members, dir, zone, { price, atr, weights, o, width }) {
  let sum = 0;
  const types = new Set(), groups = new Set(), seen = {};
  // Aynı detektörün tekrarları azalan katkıyla (en güçlüden başlayarak)
  const ordered = [...members].sort((a, b) => b.strength - a.strength);
  for (const s of ordered) {
    const w = weights[s.detector] ?? DETECTOR_MAP[s.detector]?.weight ?? 1;
    const sw = o.statusWeight[s.status] ?? 0.5;
    const neutral = dirSign(s.direction) === 0 ? 0.4 : 1;
    const k = seen[s.detector] = (seen[s.detector] || 0) + 1;
    const decay = o.repeatDecay[Math.min(k - 1, o.repeatDecay.length - 1)];
    sum += s.strength * w * sw * neutral * decay;
    types.add(s.detector); groups.add(s.group);
  }
  // Çeşitlilik bonusu: farklı gruplar aynı bölgede → daha sağlam
  const diversity = 1 + 0.12 * Math.min(4, groups.size - 1);
  // Fiyat yakınlığı: fiyat bölgede ya da yakınsa tam, uzaksa azalır
  const mid = zoneMid(zone);
  const dist = atr ? Math.max(0, Math.abs(price - mid) - (zone[1] - zone[0]) / 2) / atr : 0;
  const proximity = Math.max(0.35, 1 - dist / 6);
  // Geniş küme cezası
  const widthPen = width > 4 ? 0.7 : width > 2.5 ? 0.85 : 1;
  const raw = sum * diversity * proximity * widthPen;
  const score = Math.round(100 * (1 - Math.exp(-raw / o.scale))); // 0–100 doygunluk eğrisi
  return { direction: dir === 1 ? 'long' : 'short', score, zone, signals: members, types, groups, price, dist, raw };
}

/**
 * Sembol düzeyinde çoklu TF uyumu: her TF'nin en iyi kümesi aynı yöndeyse bonus.
 * @param perTf  { [tf]: { best, clusters } }
 */
export function multiTfAlignment(perTf) {
  const tfs = Object.keys(perTf).filter((t) => perTf[t]?.best).sort((a, b) => (TIMEFRAMES[a]?.rank ?? 0) - (TIMEFRAMES[b]?.rank ?? 0));
  if (tfs.length < 2) return null;
  const dirs = tfs.map((t) => perTf[t].best.direction);
  const longs = dirs.filter((d) => d === 'long').length, shorts = dirs.length - longs;
  const direction = longs > shorts ? 'long' : shorts > longs ? 'short' : null;
  if (!direction) return null;
  const aligned = tfs.filter((t) => perTf[t].best.direction === direction);
  const htf = aligned[aligned.length - 1], ltf = aligned[0];
  const avg = aligned.reduce((s, t) => s + perTf[t].best.score, 0) / aligned.length;
  const bonus = 1 + 0.15 * (aligned.length - 1);
  return { direction, tfs: aligned, htf, ltf, score: Math.min(100, Math.round(avg * bonus)), conflicting: tfs.filter((t) => !aligned.includes(t)) };
}

/** Satır özeti: en iyi kümenin rozetleri (detektör adları) sıralı. */
export const activeSignals = (signals) => signals.filter((s) => ACTIVE_STATUS.has(s.status));
