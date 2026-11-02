// Sinyal grafiği (SVG → PNG): son mumlar + kurulumun kendi çizimleri (detektör `draw` talimatları: yapı çizgileri, OB/FVG
// kutuları, fib/likidite seviyeleri, işaretler) + stop çevresi (açık FVG'ler, EQH/EQL, PDH/PDL/PWH/PWL; stop bunlara
// yakınsa uyarı) + seviyeler (giriş bölgesi, stop, erken kâr, TP1/TP2). Kapanışta aynı grafik dolum/çıkış işaretleri ve R ile.
// Bağımlılık yok; PNG başsız Chrome/Chromium ile (`renderPng`). Renkler kullanıcının TradingView paletine yakın (karanlık mod).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeContext } from '../src/scan/context.js';
import { findFvgs } from '../src/detectors/fvg.js';
import { equalLevels, sweepsOf } from '../src/detectors/liquidity.js';

const C = { bg: '#131722', grid: '#2a2e39', text: '#d1d4dc', dim: '#787b86', up: '#26a69a', down: '#ef5350', zone: '#ff9800', stop: '#ef5350', early: '#4dd0e1', tp: '#66bb6a', sig: '#5b9cf6', liq: '#b39ddb', fvgUp: '#26a69a', fvgDn: '#ef5350', warn: '#ffb74d' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DRAW_MAX = 14;
const SKIP_GROUPS = new Set(['candle', 'indicator', 'divergence']); // mum/indikatör işaretleri grafiği kalabalıklaştırır; yapı çizimleri kalır

/** Fiyatı anlamlı basamakla yazar (0,09558 / 714,32 / 77.344). */
export function fmtPrice(p) {
  const d = p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7;
  return p.toFixed(d);
}

/** Bir mum indeksini zamana çevirir (canlı/ileri indeksler için TF adımıyla uzatır). */
function timeAt(candles, i) {
  if (!candles.length || !Number.isFinite(i)) return null;
  const n = candles.length, ms = n > 1 ? candles[n - 1].time - candles[n - 2].time : 0;
  if (i < 0) return candles[0].time + i * ms;
  return i < n ? candles[i].time : candles[n - 1].time + (i - n + 1) * ms;
}

/**
 * Kurulum sinyallerinin `draw` talimatlarını zamana bağlı, saklanabilir biçime çevirir (indeks yerine time).
 * signals: [{ name, draw: Draw[] }] (tarama kümesinin sinyalleri), candles: o satırın kapanmış mumları.
 */
export function setupDrawOf(signals, candles) {
  const out = [], seenSig = new Set(), seen = new Set();
  for (const s of signals || []) {
    if (seenSig.has(s.name) || SKIP_GROUPS.has(s.group)) continue; // aynı kalıp birden çok pivot dizisinden gelebilir: ilki yeter
    seenSig.add(s.name);
    for (const d of s.draw || []) {
      const key = JSON.stringify(d); if (seen.has(key)) continue; seen.add(key);
      if (d.kind === 'box' && Number.isFinite(d.lo) && Number.isFinite(d.hi)) out.push({ kind: 'box', t0: timeAt(candles, d.from), t1: timeAt(candles, d.to), lo: d.lo, hi: d.hi, color: d.color, label: d.label || s.name });
      else if (d.kind === 'hline' && Number.isFinite(d.price)) out.push({ kind: 'hline', price: d.price, color: d.color, label: d.label || s.name, style: d.style });
      else if (d.kind === 'line' && d.points?.length >= 2) out.push({ kind: 'line', points: d.points.filter((p) => Number.isFinite(p.price)).map((p) => ({ t: timeAt(candles, p.i), price: p.price })), color: d.color, label: d.label || null, style: d.style });
      else if (d.kind === 'marker' && Number.isFinite(d.price)) out.push({ kind: 'marker', t: timeAt(candles, d.i), price: d.price, color: d.color, text: d.text || '', above: d.position === 'aboveBar' });
      if (out.length >= DRAW_MAX) return out;
    }
  }
  return out;
}

/**
 * Stop çevresi: açık/kısmi FVG'ler ve alınmamış likidite (EQH/EQL, PDH/PDL, PWH/PWL); stopun bunlara göre yeri.
 * → { fvgs: [{t0, lo, hi, dir, near}], liqs: [{t0, price, label, near}], notes: string[] }
 */
export function stopContext(candles, tf, plan) {
  const out = { fvgs: [], liqs: [], notes: [] };
  if (!candles || candles.length < 30) return out;
  const ctx = makeContext({ candles, tf });
  const atr = ctx.atrNow || Math.abs(plan.entry - plan.stop), d = plan.direction === 'short' ? -1 : 1, last = ctx.last;
  const view = candles.slice(-80);
  const vLo = Math.min(...view.map((c) => c.low), plan.stop, plan.tp2 ?? Infinity), vHi = Math.max(...view.map((c) => c.high), plan.stop, plan.tp2 ?? -Infinity);
  const inView = (p) => p >= vLo && p <= vHi;
  // FVG: dolmamış/ters dönmemiş, görünür aralıkta; stopa en yakın 6
  const fv = findFvgs(ctx).filter((f) => (f.status === 'open' || f.status === 'partial') && inView((f.lo + f.hi) / 2) && last - f.i <= 80)
    .sort((a, b) => Math.abs((a.lo + a.hi) / 2 - plan.stop) - Math.abs((b.lo + b.hi) / 2 - plan.stop)).slice(0, 6);
  for (const f of fv) {
    const near = plan.stop >= f.lo - 0.1 * atr && plan.stop <= f.hi + 0.1 * atr;
    out.fvgs.push({ t0: candles[f.i - 1]?.time ?? candles[f.i].time, lo: f.lo, hi: f.hi, dir: f.dir, near });
    if (near) out.notes.push(`⚠️ Stop bir ${f.dir === 1 ? 'yükseliş' : 'düşüş'} FVG'sinin içinde (${fmtPrice(f.lo)}–${fmtPrice(f.hi)}): fiyat boşluğu doldururken stopu alabilir`);
  }
  // Likidite: alınmamış EQH/EQL + önceki gün/hafta H/L
  const lv = [];
  for (const q of equalLevels(ctx.minor.filter((p) => last - p.i <= 150), ctx.atr, 0.2)) {
    if (sweepsOf(ctx, q.level, q.type, q.to + 1, last).length) continue;
    lv.push({ t0: candles[q.from].time, price: q.level, label: q.type === 'H' ? 'EQH' : 'EQL' });
  }
  const per = [];
  if (ctx.tfInfo.ms < 864e5 && ctx.days.length >= 2) per.push(['PD', ctx.days.at(-2)]);
  if (ctx.tfInfo.ms <= 4 * 36e5 && ctx.weeks.length >= 2) per.push(['PW', ctx.weeks.at(-2)]);
  for (const [nm, g] of per) for (const [ty, p] of [['H', g.high], ['L', g.low]]) if (!sweepsOf(ctx, p, ty, g.to + 1, last).length) lv.push({ t0: candles[g.from].time, price: p, label: `${nm}${ty}` });
  for (const l of lv) {
    if (!inView(l.price)) continue;
    const gap = Math.abs(plan.stop - l.price) / atr;
    const riskSide = d * (plan.entry - l.price) > 0; // seviye girişin stop tarafında mı
    const pastStop = d * (plan.stop - l.price) > 0; // seviye stopun ötesinde mi
    let near = false;
    if (riskSide && gap <= 0.3) { near = true; out.notes.push(`⚠️ Stop ${l.label} ${fmtPrice(l.price)} likiditesine çok yakın (${gap.toFixed(1)} ATR): süpürmede stop olabilir`); }
    else if (riskSide && pastStop && gap <= 1) { near = true; out.notes.push(`⚠️ ${l.label} ${fmtPrice(l.price)} stopun hemen ötesinde (${gap.toFixed(1)} ATR): fiyat o likiditeye uzanırsa stop alınır`); }
    else if (riskSide && !pastStop && gap <= 1.5) out.notes.push(`✓ Stop ${l.label} ${fmtPrice(l.price)} havuzunun arkasında (${gap.toFixed(1)} ATR)`);
    out.liqs.push({ ...l, near });
  }
  out.notes = [...new Set(out.notes)].slice(0, 4);
  out.liqs = out.liqs.slice(0, 8);
  return out;
}

/**
 * candles: { time, open, high, low, close }[] (sinyal TF'si, eskiden yeniye)
 * plan: { coin, tf, direction, entry, stop, tp1, tp2, early?, zone?: [lo, hi], sentAt }
 * o: { width, height, bars, note, setup: setupDrawOf(...), context: stopContext(...), result: resultOf(...) }
 */
export function signalChartSvg(candles, plan, o = {}) {
  const cx = o.context || { fvgs: [], liqs: [], notes: [] };
  const notes = [...(cx.notes || [])];
  const W = o.width || 960, bars = o.bars || 70;
  const padL = 12, padR = 150, padT = 52, padB = 34 + notes.length * 18;
  const H = (o.height || 600) + notes.length * 18;
  const cs = candles.slice(-bars);
  const levels = [plan.stop, plan.entry, plan.tp1, plan.tp2, plan.early, ...(plan.zone || [])].filter((v) => v != null);
  let lo = Math.min(...cs.map((c) => c.low), ...levels), hi = Math.max(...cs.map((c) => c.high), ...levels);
  const m = (hi - lo) * 0.04; lo -= m; hi += m;
  const extra = 10; // sağda boş mum alanı (seviyeler uzasın)
  const n = cs.length + extra, cw = (W - padL - padR) / n;
  const tfMs = cs.length > 1 ? cs[cs.length - 1].time - cs[cs.length - 2].time : 36e5;
  const xR = W - padR;
  const x = (i) => padL + (i + 0.5) * cw, y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const xt = (t) => (t == null ? padL : Math.max(padL, Math.min(xR, x((t - cs[0].time) / tfMs))));
  const inY = (p) => p >= lo && p <= hi, cl = (p) => Math.max(lo, Math.min(hi, p));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  // ızgara + fiyat ekseni (solda)
  for (let k = 0; k <= 6; k++) {
    const p = lo + ((hi - lo) * k) / 6, yy = y(p);
    out.push(`<line x1="${padL}" x2="${xR}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
    if (yy > padT + 12) out.push(`<text x="${padL + 4}" y="${yy - 4}" fill="${C.dim}" font-size="11">${fmtPrice(p)}</text>`);
  }
  // zaman ekseni (günde bir etiket)
  let lastDay = '';
  cs.forEach((c, i) => { const d = new Date(c.time), day = `${d.getUTCDate()}.${d.getUTCMonth() + 1}`; if (day !== lastDay && d.getUTCHours() < Math.max(1, tfMs / 36e5)) { lastDay = day; out.push(`<text x="${x(i)}" y="${H - padB + 22}" fill="${C.dim}" font-size="12" text-anchor="middle">${day}</text>`); } });
  // stop çevresi: FVG kutuları ve likidite çizgileri (arka plan)
  for (const f of cx.fvgs || []) {
    if (!inY(f.lo) && !inY(f.hi)) continue;
    const col = f.dir === 1 ? C.fvgUp : C.fvgDn, y1 = y(cl(f.hi)), y2 = y(cl(f.lo)), x0 = xt(f.t0);
    out.push(`<rect x="${x0}" y="${y1}" width="${xR - x0}" height="${Math.max(1, y2 - y1)}" fill="${col}" fill-opacity="${f.near ? 0.22 : 0.09}" stroke="${f.near ? C.warn : 'none'}" stroke-dasharray="4 3"/>`,
      `<text x="${xR - 4}" y="${y1 + 11}" fill="${f.near ? C.warn : col}" font-size="10" text-anchor="end">FVG${f.near ? ' ⚠' : ''}</text>`);
  }
  for (const l of cx.liqs || []) {
    if (!inY(l.price)) continue;
    const yy = y(l.price), x0 = xt(l.t0);
    out.push(`<line x1="${x0}" x2="${xR}" y1="${yy}" y2="${yy}" stroke="${l.near ? C.warn : C.liq}" stroke-opacity="0.85" stroke-dasharray="2 3" stroke-width="${l.near ? 1.6 : 1}"/>`,
      `<text x="${x0 + 3}" y="${yy - 3}" fill="${l.near ? C.warn : C.liq}" font-size="10">${esc(l.label)}${l.near ? ' ⚠' : ''}</text>`);
  }
  // sinyal anı
  const sx = xt(plan.sentAt);
  out.push(`<line x1="${sx}" x2="${sx}" y1="${padT}" y2="${H - padB}" stroke="${C.sig}" stroke-dasharray="5 4" stroke-width="1.5"/>`, `<text x="${sx + 4}" y="${padT + 14}" fill="${C.sig}" font-size="12">sinyal</text>`);
  // giriş bölgesi
  if (plan.zone) { const [a, b] = plan.zone; out.push(`<rect x="${sx}" y="${y(Math.max(a, b))}" width="${Math.max(2, xR - sx)}" height="${Math.max(1, Math.abs(y(a) - y(b)))}" fill="${C.zone}" fill-opacity="0.18" stroke="${C.zone}" stroke-opacity="0.6"/>`); }
  // mumlar
  const bw = Math.max(1, cw * 0.62);
  cs.forEach((c, i) => {
    const col = c.close >= c.open ? C.up : C.down, top = y(Math.max(c.open, c.close)), h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}" stroke-width="1"/>`, `<rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${col}"/>`);
  });
  // kurulumun kendi çizimleri (mumların üstünde)
  for (const d of o.setup || []) {
    const col = d.color || C.text, dash = d.style === 'dashed' ? ' stroke-dasharray="6 4"' : d.style === 'dotted' ? ' stroke-dasharray="2 3"' : '';
    if (d.kind === 'box') {
      if (!inY(d.lo) && !inY(d.hi)) continue;
      const x0 = xt(d.t0), x1 = d.t1 != null ? Math.max(xt(d.t1), x0 + 4) : xR, y1 = y(cl(d.hi)), y2 = y(cl(d.lo));
      out.push(`<rect x="${x0}" y="${y1}" width="${x1 - x0}" height="${Math.max(1, y2 - y1)}" fill="${col}" fill-opacity="0.14" stroke="${col}" stroke-opacity="0.7"/>`, `<text x="${x0 + 3}" y="${y1 + 11}" fill="${col}" font-size="10">${esc(d.label)}</text>`);
    } else if (d.kind === 'hline') {
      if (!inY(d.price)) continue;
      const yy = y(d.price);
      out.push(`<line x1="${padL}" x2="${xR}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-opacity="0.8"${dash || ' stroke-dasharray="2 3"'}/>`, `<text x="${padL + 60}" y="${yy - 3}" fill="${col}" font-size="10">${esc(d.label)}</text>`);
    } else if (d.kind === 'line') {
      const pts = d.points.filter((p) => p.t != null);
      if (pts.length < 2) continue;
      out.push(`<polyline points="${pts.map((p) => `${xt(p.t)},${y(cl(p.price))}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.8"${dash}/>`);
      if (d.label) { const p = pts.at(-1); out.push(`<text x="${xt(p.t) + 3}" y="${y(cl(p.price)) - 4}" fill="${col}" font-size="10">${esc(d.label)}</text>`); }
    } else if (d.kind === 'marker') {
      if (!inY(d.price) || d.t == null || d.t < cs[0].time) continue;
      const xx = xt(d.t), yy = y(d.price) + (d.above ? -10 : 14);
      out.push(`<text x="${xx}" y="${yy}" fill="${col}" font-size="11" font-weight="bold" text-anchor="middle">${esc(d.text)}</text>`);
    }
  }
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
    out.push(`<line x1="${sx}" x2="${xR}" y1="${yy}" y2="${yy}" stroke="${l.c}" stroke-width="1.6"${l.dash ? ' stroke-dasharray="6 4"' : ''}/>`,
      `<rect x="${xR + 4}" y="${ly - 10}" width="${padR - 70}" height="20" rx="3" fill="${l.c}" fill-opacity="0.85"/>`,
      `<text x="${xR + 9}" y="${ly + 4}" fill="#0b0e14" font-size="12" font-weight="bold">${esc(l.t)}</text>`,
      `<text x="${xR + 88}" y="${ly + 4}" fill="${l.c}" font-size="12" font-weight="bold">${fmtPrice(l.p)}</text>`);
  }
  // sonuç: dolum/çıkış işaretleri
  for (const f of o.result?.fills || []) {
    if (f.t == null || !inY(f.price)) continue;
    const xx = xt(f.t), yy = y(f.price);
    out.push(`<circle cx="${xx}" cy="${yy}" r="5" fill="${f.color || C.text}" stroke="#0b0e14" stroke-width="1.5"/>`, `<text x="${xx + 7}" y="${yy - 7}" fill="${f.color || C.text}" font-size="11" font-weight="bold">${esc(f.text)}</text>`);
  }
  // başlık
  const dirTxt = plan.direction === 'short' ? 'SHORT' : 'LONG', dirCol = plan.direction === 'short' ? C.down : C.up;
  const when = new Date(plan.sentAt).toISOString().slice(0, 16).replace('T', ' ');
  const res = o.result ? ` · <tspan fill="${o.result.R >= 0 ? C.tp : C.stop}">${esc(o.result.label)} ${o.result.R >= 0 ? '+' : ''}${o.result.R.toFixed(2)}R</tspan>` : '';
  out.push(`<text x="${padL + 4}" y="24" fill="${C.text}" font-size="18" font-weight="bold">${esc(plan.coin)}USDT · ${esc(plan.tf)} · <tspan fill="${dirCol}">${dirTxt}</tspan>${res}</text>`,
    `<text x="${padL + 4}" y="42" fill="${C.dim}" font-size="12">${when} UTC · OKX perp · kâğıt sinyal, yatırım tavsiyesi değil</text>`);
  if (o.note) out.push(`<text x="${xR}" y="24" fill="${C.dim}" font-size="12" text-anchor="end">${esc(o.note)}</text>`);
  notes.forEach((t, k) => out.push(`<text x="${padL + 4}" y="${H - padB + 42 + k * 18}" fill="${t.startsWith('✓') ? C.tp : C.warn}" font-size="12">${esc(t)}</text>`));
  out.push('</svg>');
  return out.join('\n');
}

/** Kapanmış plan için sonuç işaretleri. plan: state/history kaydı (filledAt/activeAt, earlyAt, tp1At, closedAt, status). */
export function resultOf(plan, R) {
  const fills = [], ent = plan.filledAt ?? plan.activeAt;
  if (ent) fills.push({ t: ent, price: plan.entry, text: 'giriş', color: C.zone });
  if (plan.earlyAt && plan.early != null) fills.push({ t: plan.earlyAt, price: plan.early, text: `erken %${Math.round((plan.earlyPortion ?? 0.8) * 100)}`, color: C.early });
  else if (plan.tp1At && plan.tp1 != null) fills.push({ t: plan.tp1At, price: plan.tp1, text: 'TP1', color: C.tp });
  const exit = plan.status === 'done' ? plan.tp2 : plan.status === 'stopped' ? plan.stop : plan.status === 'be' ? plan.entry : plan.status === 'timeout' ? plan.exitPrice : null;
  const label = { done: 'TP2', stopped: 'stop', be: 'başa baş', timeout: 'süre' }[plan.status] || plan.status;
  if (exit != null && plan.closedAt) fills.push({ t: plan.closedAt, price: exit, text: label, color: plan.status === 'stopped' ? C.stop : plan.status === 'done' ? C.tp : C.dim });
  return { fills, R: R ?? 0, label };
}

/** SVG → PNG (başsız Chrome/Chromium). Tarayıcı yoksa null (çağıran yalnız metin gönderir). */
export function renderPng(svg, { width } = {}) {
  const w = width || +(/width="(\d+)"/.exec(svg)?.[1] || 960), h = +(/height="(\d+)"/.exec(svg)?.[1] || 600);
  const bins = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', '/opt/pw-browsers/chromium'].filter(Boolean);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-'));
  const html = path.join(dir, 'c.html'), png = path.join(dir, 'c.png');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#131722;overflow:hidden}</style>${svg}`);
  try {
    for (const b of bins) {
      try {
        execFileSync(b, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore', timeout: 30000 });
        if (fs.existsSync(png)) return fs.readFileSync(png);
      } catch { /* sıradaki tarayıcı */ }
    }
    return null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
