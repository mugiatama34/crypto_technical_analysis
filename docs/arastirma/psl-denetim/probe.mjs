import fs from 'node:fs'; import { T } from './trades.mjs';
const H4 = 4 * 3600e3;
export async function klines(sym) {
  const f = `k-${sym}.json`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let out = [], start = Date.UTC(2026, 2, 1);
  for (;;) { const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=1000&startTime=${start}`); const a = await r.json(); if (!Array.isArray(a) || !a.length) { if (!Array.isArray(a)) console.log('hata', JSON.stringify(a).slice(0, 200)); break; } out.push(...a.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }))); if (a.length < 1000) break; start = a[a.length - 1][0] + H4; }
  fs.writeFileSync(f, JSON.stringify(out)); return out;
}
export const tOf = (s) => { const [d, hm] = s.split(' '); const [dd, mm] = d.split('.'); const [h, m] = hm.split(':'); return Date.UTC(2026, +mm - 1, +dd, +h - 3, +m); };
export function atrW(K, i, n = 14) { // Wilder ATR, i dahil
  let a = null, s = 0; for (let j = 1; j <= i; j++) { const tr = Math.max(K[j].h - K[j].l, Math.abs(K[j].h - K[j - 1].c), Math.abs(K[j].l - K[j - 1].c)); if (j <= n) { s += tr; if (j === n) a = s / n; } else a = (a * (n - 1) + tr) / n; } return a;
}
if (process.argv[1].endsWith('probe.mjs')) {
  for (const sym of Object.keys(T)) { const K = await klines(sym); console.log(sym, K.length, new Date(K[0].t).toISOString().slice(0, 10), new Date(K[K.length - 1].t).toISOString().slice(0, 16)); }
  // bilinen seviyeler: SOL #66 giriş 78.47 SL 81.89 ; BTC açık: giriş 61986.73 stop 64199.85 ; ETH #52 giriş 1934.57 SL 2012.03 ; BTC #51 giriş 74851.44 SL 76384.05
  const chk = [['SOLUSDT', '13.11 03:00', 78.47, 81.89], ['ETHUSDT', '13.11 03:00', 1934.57, 2012.03], ['BTCUSDT', '08.11 23:00', 74851.44, 76384.05], ['XRPUSDT', '12.11 15:00', null, 1.0725]];
  for (const [sym, ts, e, sl] of chk) { const K = await klines(sym); const t = tOf(ts); const i = K.findIndex((k) => k.t === t); if (i < 0) { console.log(sym, ts, 'mum yok'); continue; }
    for (const d of [-1, 0, 1]) { const k = K[i + d]; const a = atrW(K, i + d); console.log(sym, ts, 'mum', d, new Date(k.t).toISOString().slice(5, 16), 'O', k.o, 'C', k.c, 'ATR14', a.toFixed(4), 'tablo giriş', e, 'SL', sl, e ? '|SL−giriş|/ATR ' + (Math.abs(sl - e) / a).toFixed(3) : ''); } }
}
