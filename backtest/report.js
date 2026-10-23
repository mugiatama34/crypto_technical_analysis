// Backtest raporu (saf): işlem listesinden özet istatistikler ve kırılımlar.
import { TIMEFRAMES } from '../src/data/okx.js';
const sum = (a) => a.reduce((s, x) => s + x, 0);
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout']);

export function stats(trades) {
  const tr = trades.filter((t) => TRADED.has(t.outcome));
  const n = tr.length;
  if (!n) return { n: 0, signals: trades.length, winRate: 0, avgR: 0, totalR: 0, profitFactor: 0, maxDD: 0, fillRate: 0 };
  const wins = tr.filter((t) => t.R > 0), losses = tr.filter((t) => t.R <= 0);
  const gross = sum(wins.map((t) => t.R)), lossSum = -sum(losses.map((t) => t.R));
  let eq = 0, peak = 0, maxDD = 0;
  for (const t of [...tr].sort((a, b) => a.time - b.time)) { eq += t.R; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }
  return {
    n, signals: trades.length, fillRate: +(n / trades.length).toFixed(2),
    winRate: +(wins.length / n).toFixed(3), avgR: +(sum(tr.map((t) => t.R)) / n).toFixed(3), totalR: +sum(tr.map((t) => t.R)).toFixed(1),
    avgWin: wins.length ? +(gross / wins.length).toFixed(2) : 0, avgLoss: losses.length ? +(-lossSum / losses.length).toFixed(2) : 0,
    profitFactor: lossSum ? +(gross / lossSum).toFixed(2) : Infinity, maxDD: +maxDD.toFixed(1),
    outcomes: Object.fromEntries(['expired', 'missed', 'knife', 'stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout'].map((o) => [o, trades.filter((t) => t.outcome === o).length])),
    avgMfe: +(sum(tr.map((t) => t.mfe || 0)) / n).toFixed(2),
  };
}

/** Bölgeye yaklaşma hızı kovası (düşen bıçak ölçüsü): piyasa · limit yavaş < 1 ATR · orta 1–2 · hızlı > 2. */
export const approachBucket = (t) => (t.inZone ? 'piyasa (bölgede)' : t.approachAtr == null ? null : t.approachAtr < 1 ? 'limit yavaş (<1 ATR)' : t.approachAtr <= 2 ? 'limit orta (1–2 ATR)' : 'limit hızlı (>2 ATR)');

/** Giriş zamanı: kayıtlı entryTime ya da plan mumu + bekleme (waitBars) × TF. */
export const entryTimeOf = (t) => t.entryTime ?? t.time + (t.waitBars || 1) * (TIMEFRAMES[t.tf]?.ms || 0);
/** İşlem seansı (UTC saat; TR = UTC+3). */
export function sessionOf(ms) {
  const h = new Date(ms).getUTCHours();
  return h < 7 ? 'Asya 00–07 UTC (03–10 TR)' : h < 13 ? 'Avrupa 07–13 UTC (10–16 TR)' : h < 20 ? 'New York 13–20 UTC (16–23 TR)' : 'gece 20–24 UTC (23–03 TR)';
}
export const SESSIONS = ['Asya 00–07 UTC (03–10 TR)', 'Avrupa 07–13 UTC (10–16 TR)', 'New York 13–20 UTC (16–23 TR)', 'gece 20–24 UTC (23–03 TR)'];
/** Hafta içi / hafta sonu (UTC Cumartesi–Pazar). */
export const weekpartOf = (ms) => ([0, 6].includes(new Date(ms).getUTCDay()) ? 'hafta sonu' : 'hafta içi');

export const by = (trades, keyOf) => {
  const m = new Map();
  for (const t of trades) { const k = keyOf(t); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return Object.fromEntries([...m.entries()].map(([k, v]) => [k, stats(v)]));
};

export function buildReport(trades, meta = {}) {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const times = sorted.map((t) => t.time);
  const split = times.length ? times[Math.floor(times.length * 2 / 3)] : 0;
  const scoreBucket = (t) => (t.score >= 80 ? '80+' : t.score >= 70 ? '70-79' : t.score >= 60 ? '60-69' : '50-59');
  const groups = [...new Set(trades.flatMap((t) => t.groups))];
  const dets = [...new Set(trades.flatMap((t) => t.detectors))];
  const names = [...new Set(trades.flatMap((t) => t.names))];
  const presence = (list, field) => Object.fromEntries(list.map((g) => {
    const w = trades.filter((t) => t[field].includes(g)), wo = trades.filter((t) => !t[field].includes(g));
    return [g, { with: stats(w), without: stats(wo) }];
  }));
  const nameStats = Object.fromEntries(names.map((nm) => [nm, stats(trades.filter((t) => t.names.includes(nm)))]).filter(([, s]) => s.n >= 15).sort((a, b) => b[1].avgR - a[1].avgR));
  // Grup çiftleri
  const pairs = {};
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const s = stats(trades.filter((t) => t.groups.includes(groups[i]) && t.groups.includes(groups[j])));
    if (s.n >= 15) pairs[`${groups[i]}+${groups[j]}`] = s;
  }
  // Aylık
  const month = (t) => new Date(t.time).toISOString().slice(0, 7);
  // Özsermaye eğrisi (R, işlem sırasına göre), seyreltilmiş
  const tr = sorted.filter((t) => TRADED.has(t.outcome));
  let eq = 0; const curve = tr.map((t) => { eq += t.R; return [t.time, +eq.toFixed(2)]; });
  const thin = curve.length > 600 ? curve.filter((_, i) => i % Math.ceil(curve.length / 600) === 0 || i === curve.length - 1) : curve;
  return {
    meta: { ...meta, generatedAt: Date.now(), trades: trades.length, from: times[0] || null, to: times[times.length - 1] || null, split },
    overall: stats(trades),
    inSample: stats(sorted.filter((t) => t.time < split)), outOfSample: stats(sorted.filter((t) => t.time >= split)),
    byTf: by(trades, (t) => t.tf), byDirection: by(trades, (t) => t.direction), byScore: by(trades, scoreBucket),
    byEntry: by(trades, (t) => (t.inZone ? 'piyasa (bölgede)' : 'limit (bekleme)')),
    byApproach: { train: by(sorted.filter((t) => t.time < split), approachBucket), valid: by(sorted.filter((t) => t.time >= split), approachBucket) },
    bySession: { train: by(sorted.filter((t) => t.time < split), (t) => sessionOf(entryTimeOf(t))), valid: by(sorted.filter((t) => t.time >= split), (t) => sessionOf(entryTimeOf(t))) },
    byWeekpart: { train: by(sorted.filter((t) => t.time < split), (t) => weekpartOf(entryTimeOf(t))), valid: by(sorted.filter((t) => t.time >= split), (t) => weekpartOf(entryTimeOf(t))) },
    byGroup: presence(groups, 'groups'), byDetector: presence(dets, 'detectors'), byName: nameStats, byGroupPair: pairs,
    byMonth: by(trades, month), bySymbol: by(trades, (t) => t.coin),
    curve: thin,
  };
}
