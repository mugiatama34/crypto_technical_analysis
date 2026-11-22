// Arkadaş sistemi (docs/signals/friend.json) gösterim yardımcıları. Saf modül: DOM yok.
// Etiketler bot/friend.js → FRIEND_SOURCES[src].label ile aynı tutulmalı.
export const FRIEND_LABELS = { '4h': 'Elliott dalga 4H', 'r50-4h': 'Elliott dalga 4H · ilk 50 coin' };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const srcOf = (x) => (x && typeof x.src === 'string' && x.src ? x.src : '4h');
export const friendLabel = (src) => FRIEND_LABELS[src ?? '4h'] ?? String(src);
const list = (items) => (Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : []);

export function friendSummary(items) {
  const out = { open: 0, closed: 0, wins: 0, sumR: 0, avgR: null, gone: 0, bySrc: {} };
  let nR = 0;
  for (const it of list(items)) {
    const s = srcOf(it);
    const b = (out.bySrc[s] ??= { open: 0, closed: 0, wins: 0, sumR: 0 });
    if (it.status === 'open') { out.open++; b.open++; }
    else if (it.status === 'gone') out.gone++;
    else if (it.status === 'closed') {
      out.closed++; b.closed++;
      const r = num(it.r);
      if (r != null) { nR++; out.sumR += r; b.sumR += r; if (r > 0) { out.wins++; b.wins++; } }
    }
  }
  out.avgR = nR ? out.sumR / nR : null;
  return out;
}

/** Gösterim sırası: açıklar (yeni→eski), kapananlar (kapanışa göre yeni→eski), gone. */
export function friendRows(items) {
  const rank = { open: 0, closed: 1 };
  const key = (it) => (it.status === 'closed' ? num(it.closeTime) ?? num(it.openTime) ?? 0 : num(it.openTime) ?? 0);
  return list(items).map((it) => {
    const entry = num(it.entry), stop = num(it.stop), tp = num(it.tp);
    const pct = (a, b) => (entry && a != null ? Math.abs(a - b) / b * 100 : null);
    const risk = entry != null && stop != null ? stop - entry : null;
    const planR = risk && tp != null && risk > 0 ? (entry - tp) / risk : null;
    return { ...it, src: srcOf(it), srcLabel: friendLabel(srcOf(it)), stopPct: pct(stop, entry), tpPct: pct(tp, entry), planR };
  }).sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || key(b) - key(a));
}
