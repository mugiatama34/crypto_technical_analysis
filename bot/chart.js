// Sinyal grafiği (SVG): son mumlar + giriş bölgesi, stop, erken kâr, TP1/TP2, sinyal anı. Bağımlılık yok; PNG'ye çevirme
// Actions'ta başsız Chrome ile yapılır (bkz. README). Renkler kullanıcının TradingView paletine yakın (karanlık mod).
const C = { bg: '#131722', grid: '#2a2e39', text: '#d1d4dc', dim: '#787b86', up: '#26a69a', down: '#ef5350', zone: '#ff9800', stop: '#ef5350', early: '#4dd0e1', tp: '#66bb6a', sig: '#5b9cf6' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Fiyatı anlamlı basamakla yazar (0,09558 / 714,32 / 77.344). */
export function fmtPrice(p) {
  const d = p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7;
  return p.toFixed(d);
}

/**
 * candles: { time, open, high, low, close }[] (sinyal TF'si, eskiden yeniye)
 * plan: { coin, tf, direction, entry, stop, tp1, tp2, early?, zone?: [lo, hi], sentAt, status? }
 * o: { width, height, bars } → SVG metni
 */
export function signalChartSvg(candles, plan, o = {}) {
  const W = o.width || 960, H = o.height || 600, bars = o.bars || 70;
  const padL = 12, padR = 150, padT = 52, padB = 34;
  const cs = candles.slice(-bars);
  const levels = [plan.stop, plan.entry, plan.tp1, plan.tp2, plan.early, ...(plan.zone || [])].filter((x) => x != null);
  let lo = Math.min(...cs.map((c) => c.low), ...levels), hi = Math.max(...cs.map((c) => c.high), ...levels);
  const m = (hi - lo) * 0.04; lo -= m; hi += m;
  const extra = 10; // sağda boş mum alanı (seviyeler uzasın)
  const n = cs.length + extra, cw = (W - padL - padR) / n;
  const x = (i) => padL + (i + 0.5) * cw, y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const tfMs = cs.length > 1 ? cs[cs.length - 1].time - cs[cs.length - 2].time : 0;
  const idxOf = (t) => (tfMs ? (t - cs[0].time) / tfMs : 0);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  // ızgara + fiyat ekseni
  for (let k = 0; k <= 6; k++) {
    const p = lo + ((hi - lo) * k) / 6, yy = y(p);
    out.push(`<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`); if (yy > padT + 12) out.push(`<text x="${padL + 4}" y="${yy - 4}" fill="${C.dim}" font-size="11">${fmtPrice(p)}</text>`);
  }
  // zaman ekseni (günde bir etiket)
  let lastDay = '';
  cs.forEach((c, i) => { const d = new Date(c.time), day = `${d.getUTCDate()}.${d.getUTCMonth() + 1}`; if (day !== lastDay && d.getUTCHours() < (tfMs / 36e5 || 1)) { lastDay = day; out.push(`<text x="${x(i)}" y="${H - 12}" fill="${C.dim}" font-size="12" text-anchor="middle">${day}</text>`); } });
  // sinyal anı
  const si = idxOf(plan.sentAt);
  const sx = si >= 0 ? Math.min(x(si) - cw / 2, W - padR) : padL;
  if (si >= 0) out.push(`<line x1="${sx}" x2="${sx}" y1="${padT}" y2="${H - padB}" stroke="${C.sig}" stroke-dasharray="5 4" stroke-width="1.5"/>`, `<text x="${sx + 4}" y="${padT + 14}" fill="${C.sig}" font-size="12">sinyal</text>`);
  // giriş bölgesi
  if (plan.zone) { const [a, b] = plan.zone; out.push(`<rect x="${sx}" y="${y(Math.max(a, b))}" width="${W - padR - sx}" height="${Math.max(1, Math.abs(y(a) - y(b)))}" fill="${C.zone}" fill-opacity="0.18" stroke="${C.zone}" stroke-opacity="0.6"/>`); }
  // mumlar
  const bw = Math.max(1, cw * 0.62);
  cs.forEach((c, i) => {
    const col = c.close >= c.open ? C.up : C.down, top = y(Math.max(c.open, c.close)), h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}" stroke-width="1"/>`, `<rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${col}"/>`);
  });
  // seviyeler (sinyal anından sağa) + sağ etiketler (çakışmasın diye aralık)
  const risk = Math.abs(plan.entry - plan.stop), R = (p) => (risk ? ((plan.direction === 'short' ? plan.entry - p : p - plan.entry) / risk) : 0);
  const lv = [
    { p: plan.stop, c: C.stop, t: 'Stop' },
    { p: plan.entry, c: C.zone, t: 'Giriş' },
    plan.early != null ? { p: plan.early, c: C.early, t: `Erken ${R(plan.early).toFixed(1)}R`, dash: true } : null,
    plan.tp1 != null ? { p: plan.tp1, c: C.tp, t: `TP1 ${R(plan.tp1).toFixed(1)}R` } : null,
    plan.tp2 != null ? { p: plan.tp2, c: C.tp, t: `TP2 ${R(plan.tp2).toFixed(1)}R` } : null,
  ].filter(Boolean).sort((a, b) => y(a.p) - y(b.p));
  let prevY = -1e9;
  for (const l of lv) {
    const yy = y(l.p), ly = Math.max(yy, prevY + 18); prevY = ly;
    out.push(`<line x1="${sx}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${l.c}" stroke-width="1.6"${l.dash ? ' stroke-dasharray="6 4"' : ''}/>`,
      `<rect x="${W - padR + 4}" y="${ly - 10}" width="${padR - 70}" height="20" rx="3" fill="${l.c}" fill-opacity="0.85"/>`,
      `<text x="${W - padR + 9}" y="${ly + 4}" fill="#0b0e14" font-size="12" font-weight="bold">${esc(l.t)}</text>`,
      `<text x="${W - padR + 88}" y="${ly + 4}" fill="${l.c}" font-size="12" font-weight="bold">${fmtPrice(l.p)}</text>`);
  }
  // başlık
  const dirTxt = plan.direction === 'short' ? 'SHORT' : 'LONG', dirCol = plan.direction === 'short' ? C.down : C.up;
  const when = new Date(plan.sentAt).toISOString().slice(0, 16).replace('T', ' ');
  out.push(`<text x="${padL + 4}" y="24" fill="${C.text}" font-size="18" font-weight="bold">${esc(plan.coin)}USDT · ${esc(plan.tf)} · <tspan fill="${dirCol}">${dirTxt}</tspan></text>`,
    `<text x="${padL + 4}" y="42" fill="${C.dim}" font-size="12">${when} UTC · OKX perp · kâğıt sinyal, yatırım tavsiyesi değil</text>`);
  if (o.note) out.push(`<text x="${W - padR}" y="24" fill="${C.dim}" font-size="12" text-anchor="end">${esc(o.note)}</text>`);
  out.push('</svg>');
  return out.join('\n');
}
