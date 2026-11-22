// ★ Takip listesi geçmişi: özel depodaki watch.json sürümlerinden kayıtları yeniden kurar, "neden kaçtı" tanısı ve performans
// özeti çıkarır. Saf işlevler: ağ / dosya / süreç yok (CLI: history.mjs). Kâğıt R; n < 30 = iddia yok.

const itemsOf = (json) => (Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null);

/** versions: eskiden yeniye [{ time(ms), json }] → [{ last, firstSeen, lastSeen, gone }]. Bozuk sürüm atlanır. */
export function rebuild(versions) {
  const map = new Map();
  for (const v of versions || []) {
    const items = itemsOf(v?.json);
    if (!items) continue;
    const present = new Set();
    for (const it of items) {
      if (!it || it.id == null) continue;
      present.add(it.id);
      const r = map.get(it.id);
      if (!r) map.set(it.id, { last: it, firstSeen: v.time, lastSeen: v.time, gone: null });
      else { r.last = it; r.lastSeen = v.time; r.gone = null; }
    }
    for (const [id, r] of map) if (!present.has(id) && r.gone == null) r.gone = v.time;
  }
  return [...map.values()];
}

/** Aynı plan (coin|tf|yön, entry ve stop göreli fark < 1e-6) tek kayda iner; en erken addedAt kalır. → { list, dropped }. */
export function dedupe(records) {
  const w = (r) => r.last ?? r;
  const same = (a, b) => {
    const x = w(a), y = w(b);
    const rel = (p, q) => Math.abs(p - q) / (Math.abs(q) || 1) < 1e-6;
    return `${x.coin}|${x.tf}|${x.direction}` === `${y.coin}|${y.tf}|${y.direction}` && rel(x.entry, y.entry) && rel(x.stop, y.stop);
  };
  const list = [];
  let dropped = 0;
  for (const r of records) {
    const i = list.findIndex((k) => same(k, r));
    if (i < 0) list.push(r);
    else {
      dropped++;
      if ((w(r).addedAt ?? Infinity) < (w(list[i]).addedAt ?? Infinity)) list[i] = r;
    }
  }
  return { list, dropped };
}

/** "Neden kaçtı" tanısı: kayıt + (varsa) sentAt'ten sonraki mumlar. */
export function diag(w, candles) {
  const risk = Math.abs(w.entry - w.stop);
  const stopPct = (risk / w.entry) * 100;
  const hasP = Number.isFinite(w.priceAtAdd);
  const distEntry = hasP ? w.d * (w.priceAtAdd - w.entry) : null;
  const distTp1 = hasP ? w.d * (w.tp1 - w.priceAtAdd) : null;
  const distEntryAtr = hasP && w.atr > 0 ? distEntry / w.atr : null;
  const distEntryR = hasP && risk > 0 ? distEntry / risk : null;
  let pFill = null;
  if (hasP) pFill = distEntry <= 0 ? 1 : distTp1 <= 0 ? 0 : distTp1 / (distEntry + distTp1);
  let gapLeft = null;
  if (hasP && candles?.length) {
    if (distEntry <= 0) gapLeft = 0;
    else {
      const endT = w.closedBar ?? w.closedAt ?? candles[candles.length - 1].time;
      const cs = candles.filter((c) => c.time >= w.sentAt && c.time <= endT);
      if (cs.length) {
        const best = w.d === 1 ? Math.min(...cs.map((c) => c.low)) : Math.max(...cs.map((c) => c.high));
        gapLeft = Math.max(0, (w.d * (best - w.entry)) / distEntry);
      }
    }
  }
  const endMs = w.closedBar ?? w.closedAt;
  const minsToEnd = endMs != null && w.addedAt != null ? (endMs - w.addedAt) / 60000 : null;
  return { stopPct, distEntry, distTp1, distEntryAtr, distEntryR, pFill, gapLeft, minsToEnd };
}

/** Gidiş-dönüş maliyetin R karşılığı düşülmüş R. */
export const netR = (R, stopPct, costPct = 0.1) => (R == null ? null : R - costPct / stopPct);

const NOT_FILLED = new Set(['waiting', 'missed', 'expired']);
export const isFilled = (row) => row.R != null && !NOT_FILLED.has(row.w.status);

const bucket = (x, edges, labels) => {
  if (x == null || !Number.isFinite(x)) return 'yok';
  for (let i = 0; i < edges.length; i++) if (x < edges[i]) return labels[i];
  return labels[edges.length];
};
const KEYS = {
  'TF': (r) => r.w.tf ?? '?',
  'Yön': (r) => r.w.direction ?? '?',
  'İlk sinyal': (r) => r.w.signals?.[0] ?? '?',
  'Check list ✓': (r) => { const n = r.w.checklist?.n; return n == null ? 'yok' : n <= 4 ? '≤4' : n <= 6 ? '5–6' : '7–8'; },
  'Etiket': (r) => r.w.tag || 'etiketsiz',
  'Stop %': (r) => bucket(r.diag?.stopPct, [1, 2], ['< 1', '1–2', '≥ 2']),
  'Giriş uzaklığı (ATR)': (r) => bucket(r.diag?.distEntryAtr, [1, 2, 4], ['< 1', '1–2', '2–4', '≥ 4']),
  'pFill': (r) => bucket(r.diag?.pFill, [0.3, 0.5, 0.7], ['< 0,3', '0,3–0,5', '0,5–0,7', '≥ 0,7']),
};
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function group(rows) {
  const filled = rows.filter(isFilled);
  const Rs = filled.map((r) => r.R);
  return {
    n: rows.length, filled: filled.length, fillRate: rows.length ? filled.length / rows.length : null,
    missed: rows.filter((r) => r.w.status === 'missed').length, avgR: avg(Rs),
  };
}

export function summarize(rows) {
  const filled = rows.filter(isFilled);
  const Rs = filled.map((r) => r.R);
  const nets = filled.map((r) => netR(r.R, r.diag?.stopPct)).filter((x) => x != null && Number.isFinite(x));
  const withP = rows.filter((r) => r.diag?.pFill != null);
  const breakdowns = {};
  for (const [name, fn] of Object.entries(KEYS)) {
    const m = new Map();
    for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    breakdowns[name] = [...m].map(([key, rs]) => ({ key, ...group(rs) })).sort((a, b) => b.n - a.n);
  }
  return {
    total: rows.length, filled: filled.length,
    missed: rows.filter((r) => r.w.status === 'missed').length,
    expired: rows.filter((r) => r.w.status === 'expired').length,
    waiting: rows.filter((r) => r.w.status === 'waiting').length,
    avgR: avg(Rs), sumR: Rs.length ? Rs.reduce((s, x) => s + x, 0) : null,
    winPct: Rs.length ? (Rs.filter((x) => x > 0).length / Rs.length) * 100 : null,
    avgNetR: avg(nets),
    expectedFills: withP.reduce((s, r) => s + r.diag.pFill, 0), expectedN: withP.length,
    actualFills: withP.filter(isFilled).length,
    breakdowns,
  };
}

const f1 = (x) => String(x.toFixed(1)).replace('.', ',');
const f2 = (x) => String(x.toFixed(2)).replace('.', ',');
export const fmtR = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '-'}${f2(Math.abs(x))}`);
const pct = (x) => (x == null ? '—' : `%${Math.round(x * 100)}`);
const dt = (ms) => (ms == null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));

export function formatReport(summary, rows) {
  const L = [];
  L.push(`Kayıtlar (${rows.length}); * = silinmiş açık kayıt mumlarla sonuna kadar oynatıldı`);
  for (const r of rows) {
    const w = r.w, d = r.diag || {};
    const st = `${w.status}${r.replayed ? '*' : ''}`;
    L.push([
      dt(w.addedAt), String(w.coin).padEnd(8), String(w.tf).padEnd(3), String(w.direction).padEnd(5), st.padEnd(10),
      `R ${fmtR(r.R).padStart(6)}`, `net ${fmtR(netR(r.R, d.stopPct)).padStart(6)}`,
      `stop %${d.stopPct != null ? f2(d.stopPct) : '—'}`, `pFill ${d.pFill != null ? f2(d.pFill) : '—'}`,
      `gap ${d.gapLeft != null ? f2(d.gapLeft) : '—'}`, w.tag || '', String(w.note || '').slice(0, 20),
    ].join(' · '));
  }
  const s = summary;
  L.push('', 'Özet');
  L.push(`Toplam ${s.total} · dolan ${s.filled} · girişsiz kaçan ${s.missed} · süresi dolan ${s.expired} · hâlâ bekleyen ${s.waiting}`);
  L.push(`Dolanlar: ort. R ${fmtR(s.avgR)} · toplam R ${fmtR(s.sumR)} · kazanma ${s.winPct == null ? '—' : `%${Math.round(s.winPct)}`} · ort. net R ${fmtR(s.avgNetR)} (maliyet %0,1)`);
  L.push(`Dolum: rastgele yürüyüş beklentisi ${f1(s.expectedFills)} / gerçekleşen ${s.actualFills} (${s.expectedN} kayıt)`);
  for (const [name, list] of Object.entries(s.breakdowns)) {
    L.push('', `Kırılım: ${name}`, 'grup · kayıt · dolan · dolum · kaçan · ort. R');
    for (const g of list) L.push(`${g.key} · ${g.n} · ${g.filled} · ${pct(g.fillRate)} · ${g.missed} · ${fmtR(g.avgR)}`);
  }
  if (s.total < 30 || s.filled < 30) L.push('', 'n < 30: iddia yok (yalnız kayıt)');
  return L.join('\n');
}
