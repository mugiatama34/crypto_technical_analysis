// Bybit "Closed P&L" CSV'si → kapanış kayıtları (saf; test: tests/trades.test.js). Sütunlar başlıktan bulunur;
// başlık tanınmazsa tools/trades/rtable.mjs'in doğruladığı sıra kullanılır (0 sözleşme, 1 adet, 2 giriş, 3 çıkış,
// 4–5 ücret, 6 fonlama, 9 tür, 10 kapanış K/Z, 11 zaman "SS:DD YYYY-AA-GG" UTC).
const split = (l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '').trim());
/** "18:32 2026-11-10", "2026-11-10 18:32:05", "10-11-2026 18:32" → ms (UTC). */
export function parseTime(s) {
  const t = String(s).trim().split(/\s+/); const date = t.find((x) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(x)), time = t.find((x) => /^\d{1,2}:\d{2}/.test(x)) || '00:00';
  if (!date) return NaN; let [a, b, c] = date.split(/[-/.]/).map(Number); if (a < 100) [a, c] = [c, a]; // GG-AA-YYYY → YYYY-AA-GG
  const [h, m, sec = 0] = time.split(':').map(Number);
  return Date.UTC(a, b - 1, c, h, m, sec);
}
export function parseClosedPnl(text) {
  const lines = String(text).replace(/^﻿/, '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = split(lines[0]).map((h) => h.toLowerCase()); const hasHead = head.some((h) => /p&l|pnl|contract|symbol|market/.test(h));
  const col = (re, fb) => { const i = head.findIndex((h) => re.test(h)); return hasHead && i >= 0 ? i : fb; };
  const C = { sym: col(/contract|symbol|market/, 0), qty: col(/^qty|quantity|size/, 1), entry: col(/entry/, 2), exit: col(/exit/, 3), type: col(/type/, 9), pnl: col(/closed p&l|realized|p&l|pnl/, 10), time: col(/time|date/, 11) };
  const out = [];
  for (const l of lines.slice(hasHead ? 1 : 0)) {
    const c = split(l); const pnl = +c[C.pnl], t = parseTime(c[C.time]);
    if (!c[C.sym] || !Number.isFinite(pnl) || !Number.isFinite(t)) continue;
    const sym = c[C.sym].replace(/USDT$|USDC$|PERP$/, '');
    out.push({ id: `${c[C.sym]}|${t}|${c[C.qty]}|${pnl}`, sym, qty: +c[C.qty], entry: +c[C.entry], exit: +c[C.exit], pnl, liq: /liquid/i.test(c[C.type] || ''), t, addedAt: t, updatedAt: 1 });
  }
  return out;
}
/** Günlük toplam ($ ve R = $ ÷ riskUnit): { 'YYYY-MM-DD': { R, usd, n, win } }. */
export function dailyTrades(items, riskUnit = 1) {
  const m = {};
  for (const x of items) { const k = new Date(x.t).toISOString().slice(0, 10); const d = (m[k] ||= { R: 0, usd: 0, n: 0, win: 0 }); d.usd += x.pnl; d.R += x.pnl / riskUnit; d.n++; if (x.pnl > 0) d.win++; }
  return m;
}
