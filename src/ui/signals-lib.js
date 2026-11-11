// Sinyal sayfası yardımcıları (saf; test: tests/signals-lib.test.js): sonuç R, açık/kapanan ayrımı, günlük R takvimi.
export const CLOSED = new Set(['done', 'stopped', 'expired', 'missed', 'knife', 'timeout', 'be']);
const TRADED = new Set(['stopped', 'done', 'timeout', 'be']);
export const earlyR = (s) => Math.abs(s.early - s.entry) / Math.abs(s.entry - s.stop);
/** Kapanmış işlemin R'si (TP1 sonrası başabaş +½R1; erken kâr düzeninde payı × erken R). Açık/işlemsiz → null. */
export function finalR(s) {
  if (s.early) { const p = s.earlyPortion ?? 0.8; if (s.status === 'stopped') return -1; if (s.status === 'be') return p * earlyR(s); if (s.status === 'done') return p * earlyR(s) + (1 - p) * (s.rr || 2.5); return null; }
  if (s.status === 'timeout') return s.exitR ?? null;
  if (s.status === 'stopped') return s.tp1At ? 0.5 * (s.rr1 || 1.5) : -1;
  if (s.status === 'done') return 0.5 * (s.rr1 || 1.5) + 0.5 * (s.rr || 2.5);
  return null;
}
export const isOpen = (s) => !CLOSED.has(s.status);
/** Kapanan (R'si olan) işlemler, en yeni kapanış önce. */
export const closedTrades = (items) => items.filter((s) => TRADED.has(s.status) && finalR(s) != null).sort((a, b) => (b.closedAt || b.updatedAt || 0) - (a.closedAt || a.updatedAt || 0));
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Kapanış gününe (UTC) göre toplam R: { 'YYYY-MM-DD': { R, n, win } }. */
export function dailyR(items) {
  const m = {};
  for (const s of items) {
    if (!TRADED.has(s.status)) continue; const r = finalR(s); const t = s.closedAt || s.updatedAt; if (r == null || !t) continue;
    const k = dayKey(t); const d = (m[k] ||= { R: 0, n: 0, win: 0 }); d.R += r; d.n++; if (r > 0) d.win++;
  }
  return m;
}
/** Ay ızgarası (Pazartesi başlar): haftalar = [[{ day, key } | null ×7]]. y, m (0–11) UTC. */
export function monthGrid(y, m) {
  const first = new Date(Date.UTC(y, m, 1)), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, key: dayKey(Date.UTC(y, m, d)) });
  while (cells.length % 7) cells.push(null);
  const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
/** Açık sinyal için anlık durum: girişe uzaklık (%), aktifse gerçekleşmemiş R. */
export function liveInfo(s, price) {
  if (!Number.isFinite(price)) return null;
  const d = s.direction === 'long' ? 1 : -1, risk = Math.abs(s.entry - s.stop);
  const toEntryPct = ((price - s.entry) / s.entry) * 100 * d; // + = fiyat girişin kâr tarafında (limit henüz dolmamış olabilir)
  const uR = risk > 0 ? ((price - s.entry) * d) / risk : null;
  return { toEntryPct, uR, toStopPct: (Math.abs(price - s.stop) / price) * 100 };
}
