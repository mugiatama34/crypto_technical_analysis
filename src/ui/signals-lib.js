// Sinyal sayfası yardımcıları (saf; test: tests/signals-lib.test.js): sonuç R, açık/kapanan ayrımı, günlük R takvimi.
export const CLOSED = new Set(['done', 'stopped', 'expired', 'missed', 'knife', 'timeout', 'be']);
const TRADED = new Set(['stopped', 'done', 'timeout', 'be']);
export const earlyR = (s) => Math.abs(s.early - s.entry) / Math.abs(s.entry - s.stop);
/** Kapanmış işlemin R'si (TP1 sonrası başabaş +½R1; erken kâr düzeninde payı × erken R). Açık/işlemsiz → null. */
export function finalR(s) {
  if (s.early) { const p = s.earlyPortion ?? 0.8, eR = earlyR(s), mOk = s.midPortion > 0 && s.d * (s.tp1 - s.early) > 0 && s.d * (s.tp2 - s.tp1) > 0, m = mOk && s.midAt ? s.midPortion : 0, rest = 1 - p - m; if (s.status === 'stopped') return -1; if (s.status === 'be') return p * eR + m * (s.rr1 || 1.5) + (m && s.midStop === 'early' ? rest * eR : 0); if (s.status === 'done') return p * eR + m * (s.rr1 || 1.5) + rest * (s.rr || 2.5); return null; }
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

// ---- Analiz yöntemi performansı: sinyal adı → aile (src/scan/registry.js gruplarına göre) ----
const FAMILIES = [
  ['Elliott', /^EW /],
  ['Harmonik', /AB=CD|Gartley|Bat\b|Crab|Butterfly|Shark|Cypher/i],
  ['Uyumsuzluk', /uyumsuzluk/i],
  ['Wyckoff', /Spring|Upthrust|\bSOS\b|\bSOW\b|Wyckoff/],
  ['Fibonacci', /Fib|OTE/],
  ['FVG', /FVG/],
  ['Order Block / Breaker', /Order Block|Breaker/],
  ['Likidite (EQH/EQL, PDH/PDL, süpürme)', /EQ[HL]|PD[HL]|PW[HL]|süpür|likidite/i],
  ['Piyasa yapısı (BOS/CHoCH, premium/discount)', /BOS|CHoCH|yapısı|Premium|Discount/],
  ['Mum formasyonu', /engulfing|pin bar|doji|star|soldiers|crows|Inside bar|harami|hammer|marubozu/i],
  ['Klasik formasyon', /tepe|dip|OBO|omuz|üçgen|wedge|takoz|kanal|bayrağı|bayrak|flama|fincan/i],
  ['İndikatör (EMA, MACD, ADX, RSI, VWAP…)', /EMA|MACD|RSI|ADX|VWAP|POC|VAL|VAH|Değer alanı|Bollinger|BB |Supertrend|Donchian|Ichimoku|Kumo|Tenkan|Kijun|cross|hacim|pitchfork|sıkışma|Stoch/i],
];
export function familyOf(name) { for (const [f, re] of FAMILIES) if (re.test(name)) return f; return 'Diğer'; }
/**
 * Kapanan işlemleri sinyalin içerdiği analiz ailelerine göre gruplar (bir işlem her ailede bir kez sayılır).
 * split(s) → kırılım anahtarı (ör. BTC günlük yönü) ya da null. → [{ family, all:{n,win,avgR}, parts:{key:{n,win,avgR}} }]
 */
export function familyStats(items, split = () => null) {
  const m = new Map(), add = (o, r) => { o.n++; o.sum += r; if (r > 0) o.w++; };
  for (const s of closedTrades(items)) {
    const r = finalR(s); const fams = new Set((s.signals || []).map(familyOf)); const k = split(s);
    for (const f of fams) {
      if (!m.has(f)) m.set(f, { family: f, all: { n: 0, w: 0, sum: 0 }, parts: {} });
      const e = m.get(f); add(e.all, r); if (k != null) add((e.parts[k] ||= { n: 0, w: 0, sum: 0 }), r);
    }
  }
  const fin = (o) => ({ n: o.n, win: o.n ? o.w / o.n : null, avgR: o.n ? o.sum / o.n : null });
  return [...m.values()].map((e) => ({ family: e.family, all: fin(e.all), parts: Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, fin(v)])) })).sort((a, b) => b.all.n - a.all.n);
}

// ---- Ajan vs sinyal (ilerleme.md §3): aynı sinyallerde ajanın R'si ile botun planının R'si ----
/**
 * trades: ajan işlemleri (signalKey'li), items: history.json sinyalleri, since: karşılaştırma başlangıcı (ms; ör. resetAt).
 * Eşleşme: işlemin signalKey'i = sinyalin key'i ve sentAt ≤ openedAt (+1 sa) olan en yeni gönderim.
 * → { taken:{n, agentR, signalR, signalN}, skipped:{n, avgR}, agentOnly:{n, avgR}, rows:[{coin, tf, direction, agentR, signalR}] }
 */
export function agentVsSignal(trades, items, since = 0) {
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sigs = items.filter((s) => (s.sentAt || 0) >= since);
  const byKey = new Map();
  for (const s of sigs) { if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push(s); }
  const own = trades.filter((t) => !t.hedgeOf && (t.openedAt || t.closedAt || 0) >= since);
  const used = new Set(), rows = [], onlyR = [];
  for (const t of own) {
    const cand = (byKey.get(t.signalKey) || []).filter((s) => s.sentAt <= (t.openedAt || t.closedAt) + 3600e3).sort((a, b) => b.sentAt - a.sentAt)[0];
    if (!t.signalKey || !cand) { onlyR.push(t.R); continue; }
    used.add(cand.id);
    rows.push({ coin: t.coin, tf: t.tf, direction: t.direction, agentR: t.R, signalR: finalR(cand), signalStatus: cand.status, at: t.openedAt });
  }
  const skippedR = sigs.filter((s) => !used.has(s.id) && TRADED.has(s.status)).map(finalR).filter((r) => r != null);
  const sR = rows.map((r) => r.signalR).filter((r) => r != null);
  return {
    taken: { n: rows.length, agentR: avg(rows.map((r) => r.agentR)), signalR: avg(sR), signalN: sR.length },
    skipped: { n: skippedR.length, avgR: avg(skippedR) },
    agentOnly: { n: onlyR.length, avgR: avg(onlyR) },
    rows,
  };
}

/**
 * Açık sinyalin plana göre R'si (13.11): erken hedef görüldüyse %portion kilitli (portion × erken R), kalan (1 − portion)
 * fiyatla, stop girişte; TP1 görüldüyse (erkensiz düzen) ½·R1 kilitli + ½ fiyatla. uR = fiyat hareketi (tam pozisyon R).
 * → { R, locked, openShare, beStop } | null
 */
export function planOpenR(s, uR) {
  if (!Number.isFinite(uR)) return null;
  if (s.status === 'early' && s.early) { const p = s.earlyPortion ?? 0.8, m = s.midAt && s.midPortion > 0 ? s.midPortion : 0, locked = p * earlyR(s) + m * (s.rr1 || 1.5), open = 1 - p - m; return { R: locked + open * uR, locked, openShare: open, beStop: true, stopAtEarly: !!(m && s.midStop === 'early') }; }
  if (s.status === 'tp1') { const locked = 0.5 * (s.rr1 || 1.5); return { R: locked + 0.5 * uR, locked, openShare: 0.5, beStop: true }; }
  return { R: uR, locked: 0, openShare: 1, beStop: false };
}
