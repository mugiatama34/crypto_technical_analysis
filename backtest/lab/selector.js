// Rejim seçici (yürüyen / walk-forward): her ay başında YALNIZ geçmiş işlemlerden her hücrenin (BTC rejimi × yön × strateji)
// istatistiği çıkarılır; ölçütü geçen hücreler o ay "açık" sayılır ve o ayın işlemleri yalnız bu hücrelerden alınır.
// Böylece seçim, ölçüldüğü veriye hiç bakmaz (iyimserliğe karşı). Aynı coin/TF/zaman/yöndeki tekrar işlemler bir kez sayılır.
const TRADED = new Set(['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout', 'time_stop']);
export const SELECTOR_DEFAULTS = { minN: 50, minR: 0.05, minPF: 1.1, warmMonths: 6, field: 'R' };

const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
export const cellOf = (t) => `${t.regime || 'rejim yok'} | ${t.direction} | ${t.strategy}`;

/**
 * trades: { strategy, regime, direction, time, outcome, R, hedgedR?, coin, tf }[]
 * → { picked: trade[], months: [{ month, cells, n, R }], lastCells: [{ cell, n, avgR, pf }] }
 */
export function walkForward(trades, o = SELECTOR_DEFAULTS) {
  const sorted = [...trades].filter((t) => t.regime).sort((a, b) => a.time - b.time);
  const months = [...new Set(sorted.map((t) => monthOf(t.time)))];
  const agg = new Map(); // hücre → { n, sum, win, loss }
  const add = (t) => {
    if (!TRADED.has(t.outcome)) return;
    const r = t[o.field]; if (r == null) return;
    const k = cellOf(t); const a = agg.get(k) || { n: 0, sum: 0, win: 0, loss: 0 };
    a.n++; a.sum += r; if (r > 0) a.win += r; else a.loss -= r; agg.set(k, a);
  };
  const ok = (a) => a && a.n >= o.minN && a.sum / a.n > o.minR && (a.loss ? a.win / a.loss : Infinity) > o.minPF;
  const picked = [], out = []; const seen = new Set();
  let idx = 0;
  months.forEach((m, mi) => {
    const monthTrades = [];
    while (idx < sorted.length && monthOf(sorted[idx].time) === m) monthTrades.push(sorted[idx++]);
    if (mi >= o.warmMonths) {
      const open = new Set([...agg.entries()].filter(([, a]) => ok(a)).map(([k]) => k));
      let n = 0, R = 0;
      for (const t of monthTrades) {
        if (!open.has(cellOf(t))) continue;
        const key = `${t.coin}|${t.tf}|${t.time}|${t.direction}`; if (seen.has(key)) continue; seen.add(key);
        picked.push(t); if (TRADED.has(t.outcome) && t[o.field] != null) { n++; R += t[o.field]; }
      }
      out.push({ month: m, cells: open.size, n, R: +R.toFixed(2) });
    }
    for (const t of monthTrades) add(t); // ay bitti: geçmişe ekle
  });
  const lastCells = [...agg.entries()].filter(([, a]) => ok(a)).map(([cell, a]) => ({ cell, n: a.n, avgR: +(a.sum / a.n).toFixed(3), pf: a.loss ? +(a.win / a.loss).toFixed(2) : null })).sort((a, b) => b.avgR - a.avgR);
  return { picked, months: out, lastCells };
}
