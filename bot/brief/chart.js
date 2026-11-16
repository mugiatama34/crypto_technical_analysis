// Sabah özeti grafiği (SVG; PNG'ye bot/chart.js renderPng ile): mumlar + mesajdaki destek / direnç bölgeleri etiketli + fiyat.
// Renkler sinyal grafiğiyle aynı (karanlık TradingView paleti).
import { MONTHS } from './core.js';
import { fpx, fzone } from './format.js';

const C = { bg: '#131722', grid: '#2a2e39', text: '#d1d4dc', dim: '#787b86', up: '#26a69a', down: '#ef5350', res: '#ef5350', sup: '#26a69a', px: '#f0c75e' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * candles: mumlar (canlı mum dahil, eskiden yeniye); levels: { res, sup } bölgeleri; price; title; weekly: haftalık eksen.
 */
export function briefChartSvg(candles, { levels, price, title, subtitle = '', weekly = false, bars, width = 1000, height = 620 } = {}) {
  const cs = candles.slice(-(bars || (weekly ? 78 : 130)));
  const W = width, H = height, padL = 64, padR = 250, padT = 56, padB = 36;
  const zs = [...levels.res.map((z) => ({ ...z, side: 'res' })), ...levels.sup.map((z) => ({ ...z, side: 'sup' }))];
  let lo = Math.min(...cs.map((c) => c.low), ...zs.map((z) => z.lo)), hi = Math.max(...cs.map((c) => c.high), ...zs.map((z) => z.hi));
  const m = (hi - lo) * 0.04; lo -= m; hi += m;
  const n = cs.length + 3, cw = (W - padL - padR) / n, xR = W - padR;
  const x = (i) => padL + (i + 0.5) * cw, y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  out.push(`<text x="${padL}" y="30" fill="${C.text}" font-size="20" font-weight="bold">${esc(title)}</text>`);
  if (subtitle) out.push(`<text x="${padL}" y="48" fill="${C.dim}" font-size="13">${esc(subtitle)}</text>`);
  // ızgara + fiyat ekseni (solda)
  const raw = (hi - lo) / 6, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((q) => q * mag).find((s) => s >= raw);
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const yy = y(p);
    out.push(`<line x1="${padL}" x2="${xR}" y1="${yy}" y2="${yy}" stroke="${C.grid}"/>`, `<text x="${padL - 6}" y="${yy + 4}" fill="${C.dim}" font-size="12" text-anchor="end">${fpx(p)}</text>`);
  }
  // zaman ekseni: günlükte her ayın ilk mumu, haftalıkta üç ayda bir
  let lastM = -1;
  cs.forEach((c, i) => {
    const d = new Date(c.time), mm = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (mm === lastM) return; lastM = mm;
    if (weekly && d.getUTCMonth() % 3 !== 0) return;
    const lab = weekly || d.getUTCMonth() === 0 ? `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${String(d.getUTCFullYear()).slice(2)}` : MONTHS[d.getUTCMonth()].slice(0, 3);
    out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${padT}" y2="${H - padB}" stroke="${C.grid}" stroke-dasharray="2 4"/>`, `<text x="${x(i)}" y="${H - padB + 20}" fill="${C.dim}" font-size="12" text-anchor="middle">${lab}</text>`);
  });
  // seviye bölgeleri (mumların arkasında)
  for (const z of zs) {
    const col = z.side === 'res' ? C.res : C.sup, y1 = y(z.hi), y2 = y(z.lo);
    if (y2 - y1 >= 2) out.push(`<rect x="${padL}" y="${y1}" width="${xR - padL}" height="${y2 - y1}" fill="${col}" fill-opacity="0.16"/>`);
    out.push(`<line x1="${padL}" x2="${xR}" y1="${(y1 + y2) / 2}" y2="${(y1 + y2) / 2}" stroke="${col}" stroke-width="1.6"/>`);
  }
  // mumlar
  const bw = Math.max(1.5, cw * 0.65);
  cs.forEach((c, i) => {
    const col = c.close >= c.open ? C.up : C.down, yo = y(c.open), yc = y(c.close);
    out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}" stroke-width="1"/>`,
      `<rect x="${x(i) - bw / 2}" y="${Math.min(yo, yc)}" width="${bw}" height="${Math.max(1, Math.abs(yc - yo))}" fill="${col}"/>`);
  });
  // fiyat çizgisi
  const yp = y(price);
  out.push(`<line x1="${padL}" x2="${xR}" y1="${yp}" y2="${yp}" stroke="${C.px}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  // sağ etiketler (üst üste binmesin: en az 30 px aralık)
  const labs = [...zs.map((z) => ({ yy: y((z.lo + z.hi) / 2), col: z.side === 'res' ? C.res : C.sup, t1: `${z.side === 'res' ? 'Direnç' : 'Destek'} ${fzone(z)}`, t2: z.reasons.join(', ') })), { yy: yp, col: C.px, t1: `Fiyat ${fpx(price)}`, t2: '' }].sort((a, b) => a.yy - b.yy);
  const gap = 30;
  for (let i = 1; i < labs.length; i++) if (labs[i].yy - labs[i - 1].yy < gap) labs[i].yy = labs[i - 1].yy + gap;
  const over = labs.length ? labs[labs.length - 1].yy - (H - padB + 6) : 0;
  if (over > 0) for (const l of labs) l.yy -= over;
  for (let i = labs.length - 2; i >= 0; i--) if (labs[i + 1].yy - labs[i].yy < gap) labs[i].yy = labs[i + 1].yy - gap;
  for (const l of labs) {
    out.push(`<text x="${xR + 10}" y="${l.yy}" fill="${l.col}" font-size="14" font-weight="bold">${esc(l.t1)}</text>`);
    if (l.t2) out.push(`<text x="${xR + 10}" y="${l.yy + 15}" fill="${C.dim}" font-size="12">${esc(l.t2.length > 34 ? `${l.t2.slice(0, 33)}…` : l.t2)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
