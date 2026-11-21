// Sinyal paylaşım kartı (21.11): tarama satırı / ★ takip kaydı → tek PNG (1080 px genişlik, koyu zemin), paylaşım sayfası,
// yoksa panoya kopyalama, o da yoksa indirme. Harici kütüphane yok; yalnız Canvas 2D.
// Üç katman: shareCardModel (saf, test edilir; DOM yok) → drawShareCard (canvas çizimi) → shareCard (paylaş / kopyala / indir).
// Resimde kişisel veri yok: hesap, not, takip notu, etiket yazılmaz.
import { fmtPrice } from './format.js';
import { watchEarlyOf, watchEarlyR, watchThree } from '../watch/watch.js?v=11';

export const CARD_W = 1080;
export const CARD_COLORS = Object.freeze({
  bg: '#131722', panel: '#1a2030', grid: '#232b3a', text: '#ffffff', dim: '#8f99aa', muted: '#6b7485',
  long: '#5ea3f0', short: '#f0813f', up: '#26a69a', down: '#ef5350', check: '#0ca30c',
  // takip grafiğindeki çizgi renkleriyle aynı (app.js renderWatchDetail)
  entry: '#3987e5', stop: '#ef5350', early: '#f0c75e', tp: '#7cc4a8', price: '#c3c2b7',
});
export const CARD_FOOTER = 'Kripto TA Tarayıcı · kâğıt işlem · yatırım tavsiyesi değildir';

const pad2 = (n) => String(n).padStart(2, '0');
/** R metni: 1,50R (Türkçe ondalık virgül). */
export const fmtR = (x) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(2).replace('.', ',')}R`;
const fmtPctTr = (x) => `%${x.toFixed(2).replace('.', ',')}`;
/** UTC tarih-saat: 21.11.2026 14:30 UTC */
export function fmtUtc(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}
const fileStamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`; };

/**
 * Kart verisi (saf). row: tarama satırı { coin, tf, direction, score, price, candles, live, best: { signals, zone } } ya da
 * takip kaydından kurulmuş benzeri (signals yerine signalNames: string[]). plan: buildPlan çıktısı / takip kaydı
 * { d, entry, stop, tp1, tp2, zone, early?… } ya da null (plan kurulamadı).
 * opts: { checklist: { n, of } | null, now (ms), computeEarly (vars. true: plan.early yoksa watchEarlyOf ile hesapla; takip
 * kaydında false — eski kayıt erken hedefsiz kalır), noPlanReason, bars (grafikteki mum sayısı, vars. 90) }.
 * → { header, info, levels[], planOk, noPlanText, chart, signals, footer, fileName, shareTitle, shareText }
 */
export function shareCardModel(row, plan, opts = {}) {
  const { checklist = null, now = Date.now(), computeEarly = true, noPlanReason = '', bars = 90 } = opts;
  const C = CARD_COLORS;
  const dir = row.direction === 'short' ? 'short' : 'long';
  const ref = Number.isFinite(row.price) ? row.price : plan?.entry;
  const fp = (p) => fmtPrice(p, ref);
  const header = {
    coin: row.coin, tf: row.tf, direction: dir, dirText: dir.toUpperCase(), dirColor: dir === 'long' ? C.long : C.short,
    score: Number.isFinite(row.score) ? row.score : null,
    check: checklist && Number.isFinite(checklist.n) ? `✓ ${checklist.n}/${checklist.of}` : null,
    time: fmtUtc(now),
  };
  const zone = plan?.zone || row.best?.zone || null;
  const zoneOk = zone && Number.isFinite(zone[0]) && Number.isFinite(zone[1]) && zone[0] !== zone[1];
  const info = [
    ...(Number.isFinite(row.price) ? [['Fiyat', fp(row.price)]] : []),
    ...(zoneOk ? [['Bölge', `${fp(Math.min(...zone))} – ${fp(Math.max(...zone))}`]] : []),
  ];

  const planOk = !!(plan && [plan.entry, plan.stop, plan.tp1, plan.tp2].every(Number.isFinite) && Math.abs(plan.entry - plan.stop) > 0);
  const levels = [];
  let early = null;
  if (planOk) {
    const d = plan.d ?? (dir === 'long' ? 1 : -1), p = { ...plan, d };
    const risk = d * (p.entry - p.stop), R = (x) => (d * (x - p.entry)) / risk;
    const e = p.early != null ? p : computeEarly ? watchEarlyOf(p) : {};
    if (e.early != null) {
      const x = { ...p, ...e };
      early = { price: e.early, R: watchEarlyR(x), portion: e.earlyPortion, mid: watchThree(x) ? e.midPortion : null };
    }
    const pct = (v) => `%${Math.round(v * 100)}`;
    levels.push({ key: 'entry', label: 'Giriş', price: p.entry, priceText: fp(p.entry), rText: '', note: p.inZone ? 'fiyat bölgede' : 'limit', color: C.entry });
    levels.push({ key: 'stop', label: 'Stop', price: p.stop, priceText: fp(p.stop), rText: fmtR(-1), note: `stop ${fmtPctTr((Math.abs(p.entry - p.stop) / p.entry) * 100)}`, color: C.stop });
    if (early) levels.push({ key: 'early', label: 'Erken', price: early.price, priceText: fp(early.price), rText: fmtR(early.R), note: `${pct(early.portion)} kapat · stop girişe`, color: C.early });
    levels.push({ key: 'tp1', label: 'TP1', price: p.tp1, priceText: fp(p.tp1), rText: fmtR(R(p.tp1)), note: early?.mid ? `${pct(early.mid)} kapat` : early ? '' : '%50 kapat · stop girişe', color: C.tp });
    levels.push({ key: 'tp2', label: 'TP2', price: p.tp2, priceText: fp(p.tp2), rText: fmtR(R(p.tp2)), note: 'kalan', color: C.tp });
  }

  // Grafik: son `bars` mum (kapanmış + canlı); fiyat ekseni mumları, bölgeyi ve tüm seviyeleri kapsar.
  const all = [...(row.candles || []), ...(row.live ? [row.live] : [])].filter((c) => c && [c.open, c.high, c.low, c.close].every(Number.isFinite));
  let chart = null;
  if (all.length) {
    const cs = all.slice(-bars).map((c) => ({ o: c.open, h: c.high, l: c.low, c: c.close }));
    const lines = levels.map((l) => ({ key: l.key, label: l.label, price: l.price, color: l.color, dash: l.key === 'entry' ? [] : l.key === 'early' ? [4, 8] : [16, 10] }));
    const last = Number.isFinite(row.price) ? row.price : cs[cs.length - 1].c;
    const vals = [...cs.flatMap((c) => [c.h, c.l]), ...lines.map((l) => l.price), last, ...(zoneOk ? zone : [])];
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || Math.abs(hi) * 0.01 || 1;
    chart = { candles: cs, min: lo - span * 0.05, max: hi + span * 0.05, lines, zone: zoneOk ? [Math.min(...zone), Math.max(...zone)] : null, lastPrice: last, lastText: fp(last) };
  }

  const names = (row.signalNames || row.best?.signals?.map((s) => s.name) || []).filter((n) => n && !/^elle\b/.test(n));
  const signals = [...new Set(names)].slice(0, 6).join(' · ');
  const lv = Object.fromEntries(levels.map((l) => [l.key, l.priceText]));
  return {
    header, info, levels, planOk, chart, signals, footer: CARD_FOOTER,
    noPlanText: planOk ? '' : `Plan kurulamadı${noPlanReason ? ` (${noPlanReason})` : ''}`,
    fileName: `${row.coin}-${row.tf}-${dir}-${fileStamp(now)}.png`,
    shareTitle: `${row.coin} ${row.tf} ${header.dirText}`,
    shareText: planOk ? `${row.coin} ${row.tf} ${header.dirText} · giriş ${lv.entry} · stop ${lv.stop}${lv.early ? ` · erken ${lv.early}` : ''} · TP1 ${lv.tp1} · TP2 ${lv.tp2} (kâğıt işlem, tavsiye değil)` : `${row.coin} ${row.tf} ${header.dirText}`,
  };
}

// ------------------------------------------------------------------ çizim (canvas)
const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const font = (w, px) => `${w} ${px}px ${FONT}`;
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
function pill(ctx, x, y, text, color, px = 30, fill = null) {
  ctx.font = font(700, px);
  const w = ctx.measureText(text).width + px * 0.9, h = px * 1.55;
  ctx.fillStyle = fill || `${color}2e`; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, x + px * 0.45, y + h / 2 + 1);
  return w;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Kartı canvas'a çizer (senkron) → canvas. canvas verilmezse yenisi oluşturulur. */
export function drawShareCard(model, canvas = document.createElement('canvas')) {
  const C = CARD_COLORS, W = CARD_W, P = 56;
  const ROW = 92, chartH = 470;
  const levelsH = model.planOk ? model.levels.length * ROW + 24 : 110;
  const H = P + 120 + 64 + levelsH + 24 + chartH + 30 + 50 + 70;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Başlık: coin · TF · yön · puan · ✓ n/8
  let y = P;
  const h = model.header;
  ctx.fillStyle = C.text; ctx.font = font(800, 84); ctx.textBaseline = 'top';
  ctx.fillText(h.coin, P, y); let x = P + ctx.measureText(h.coin).width + 22;
  x += pill(ctx, x, y + 18, h.tf, C.dim, 30, 'rgba(143,153,170,0.16)') + 14;
  x += pill(ctx, x, y + 18, h.dirText, h.dirColor, 30) + 14;
  if (h.check) pill(ctx, x, y + 18, h.check, C.check, 30, 'rgba(12,163,12,0.16)');
  if (h.score != null) {
    ctx.textBaseline = 'top'; ctx.textAlign = 'right';
    ctx.fillStyle = h.score >= 60 ? C.check : h.score >= 40 ? '#fab219' : C.dim; ctx.font = font(800, 64); ctx.fillText(String(h.score), W - P, y + 6);
    ctx.fillStyle = C.dim; ctx.font = font(600, 22); ctx.fillText('küme puanı', W - P, y + 76);
    ctx.textAlign = 'left';
  }
  y += 120;
  // Bilgi satırı: tarih · fiyat · bölge
  ctx.textBaseline = 'top'; ctx.font = font(500, 28);
  const info = [h.time, ...model.info.map(([k, v]) => `${k} ${v}`)].join('   ·   ');
  ctx.fillStyle = C.dim; ctx.fillText(fitText(ctx, info, W - 2 * P), P, y);
  y += 64;

  // Seviyeler
  ctx.fillStyle = C.panel; roundRect(ctx, P - 16, y - 12, W - 2 * P + 32, levelsH, 22); ctx.fill();
  if (model.planOk) {
    for (const l of model.levels) {
      const cy = y + ROW / 2;
      ctx.fillStyle = l.color; ctx.fillRect(P + 4, cy - 26, 8, 52);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = C.dim; ctx.font = font(600, 34); ctx.fillText(l.label, P + 32, cy);
      ctx.fillStyle = C.text; ctx.font = font(800, 54); ctx.fillText(l.priceText, P + 190, cy);
      ctx.textAlign = 'right';
      ctx.fillStyle = l.key === 'stop' ? C.stop : l.color; ctx.font = font(800, 40); ctx.fillText(l.rText || '', W - P - 8, cy - (l.note ? 14 : 0));
      if (l.note) { ctx.fillStyle = C.muted; ctx.font = font(500, 24); ctx.fillText(l.note, W - P - 8, cy + 24); }
      ctx.textAlign = 'left';
      y += ROW;
    }
    y += 24;
  } else {
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#fab219'; ctx.font = font(700, 38);
    ctx.fillText(fitText(ctx, model.noPlanText, W - 2 * P - 20), P + 10, y + 43);
    y += 110;
  }
  y += 24;

  // Grafik
  const gx = P, gw = W - 2 * P - 150, gy = y, gh = chartH; // sağda 150 px etiket şeridi
  ctx.fillStyle = C.panel; roundRect(ctx, P - 16, gy - 12, W - 2 * P + 32, gh + 24, 22); ctx.fill();
  const ch = model.chart;
  if (ch) {
    const py = (p) => gy + ((ch.max - p) / (ch.max - ch.min)) * gh;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const yy = gy + (gh * k) / 4; ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke(); }
    if (ch.zone) { ctx.fillStyle = `${model.header.dirColor}22`; const a = py(ch.zone[1]), b = py(ch.zone[0]); ctx.fillRect(gx, a, gw, Math.max(2, b - a)); }
    const n = ch.candles.length, step = gw / Math.max(n, 1), bw = Math.max(2, step * 0.62);
    ch.candles.forEach((c, i) => {
      const cx = gx + step * (i + 0.5), col = c.c >= c.o ? C.up : C.down;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, step * 0.12);
      ctx.beginPath(); ctx.moveTo(cx, py(c.h)); ctx.lineTo(cx, py(c.l)); ctx.stroke();
      const top = py(Math.max(c.o, c.c)), bot = py(Math.min(c.o, c.c));
      ctx.fillStyle = col; ctx.fillRect(cx - bw / 2, top, bw, Math.max(1.5, bot - top));
    });
    // Seviye çizgileri + sağ etiketler (çakışan etiketler aşağı/yukarı itilir)
    const tags = [...ch.lines.map((l) => ({ y: py(l.price), text: l.label, color: l.color, line: l })), { y: py(ch.lastPrice), text: ch.lastText, color: C.price, line: null }]
      .sort((a, b) => a.y - b.y);
    for (const t of tags) {
      ctx.strokeStyle = t.color; ctx.lineWidth = t.line ? 3 : 1.5; ctx.setLineDash(t.line ? t.line.dash : [3, 6]);
      ctx.beginPath(); ctx.moveTo(gx, t.y); ctx.lineTo(gx + gw, t.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    const TH = 36;
    for (let i = 1; i < tags.length; i++) tags[i].ty = Math.max(tags[i].y, (tags[i - 1].ty ?? tags[i - 1].y) + TH);
    tags[0].ty = tags[0].y;
    const over = (tags[tags.length - 1].ty + TH / 2) - (gy + gh);
    if (over > 0) for (const t of tags) t.ty -= over;
    for (let i = tags.length - 2; i >= 0; i--) tags[i].ty = Math.min(tags[i].ty, tags[i + 1].ty - TH);
    ctx.font = font(700, 24); ctx.textBaseline = 'middle';
    for (const t of tags) {
      const tx = gx + gw + 12, tw = 138;
      ctx.fillStyle = C.bg; roundRect(ctx, tx, t.ty - 15, tw, 30, 6); ctx.fill();
      ctx.strokeStyle = t.color; ctx.lineWidth = 1.5; roundRect(ctx, tx, t.ty - 15, tw, 30, 6); ctx.stroke();
      ctx.fillStyle = t.color; ctx.fillText(fitText(ctx, t.text, tw - 14), tx + 7, t.ty + 1);
    }
  } else {
    ctx.fillStyle = C.dim; ctx.font = font(500, 30); ctx.textBaseline = 'middle'; ctx.fillText('Grafik verisi yok', P + 10, gy + gh / 2);
  }
  y = gy + gh + 30;

  // Yapılar + alt bilgi
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (model.signals) { ctx.fillStyle = C.text; ctx.font = font(600, 28); ctx.fillText(fitText(ctx, model.signals, W - 2 * P), P, y); }
  y += 50;
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = font(500, 22); ctx.fillText(model.footer, P, y + 20);
  return canvas;
}

// ------------------------------------------------------------------ paylaş / kopyala / indir (DOM)
/** data: URL → Blob (senkron; toBlob'un geri çağrısı iOS'ta kullanıcı hareketini düşürmesin diye). */
function dataUrlBlob(url) {
  const [head, b64] = url.split(','), type = /data:([^;]+)/.exec(head)?.[1] || 'image/png';
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
}

/**
 * Kartı paylaşır. TIKLAMA İŞLEYİCİSİNDEN SENKRON çağrılmalı: çizim + PNG + File hep senkron, navigator.share ilk await'ten
 * önce çağrılır (iOS Safari geçici kullanıcı hareketi şartı). Sıra: paylaşım sayfası → panoya kopya → indirme.
 * notify(mesaj, tür) ile sonuç bildirilir; kullanıcı iptali (AbortError) sessiz.
 */
export function shareCard(model, notify = () => {}) {
  let blob;
  try { blob = dataUrlBlob(drawShareCard(model).toDataURL('image/png')); } catch (err) { notify(`Resim üretilemedi: ${err.message}`, 'err'); return Promise.resolve('error'); }
  const file = typeof File === 'function' ? new File([blob], model.fileName, { type: 'image/png' }) : null;
  const fallback = () => {
    if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => { notify('Resim panoya kopyalandı.'); return 'clipboard'; })
        .catch(() => { download(blob, model.fileName); notify('Resim indirildi.'); return 'download'; });
    }
    download(blob, model.fileName); notify('Resim indirildi.'); return Promise.resolve('download');
  };
  let can = false;
  try { can = !!(file && navigator.canShare?.({ files: [file] })); } catch { can = false; }
  if (can) {
    return navigator.share({ files: [file], title: model.shareTitle, text: model.shareText })
      .then(() => 'share')
      .catch((err) => (err?.name === 'AbortError' ? 'cancel' : fallback()));
  }
  return fallback();
}
