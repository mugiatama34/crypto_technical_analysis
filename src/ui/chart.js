// Lightweight Charts 5 ile satır grafiği: mumlar + sinyallerin `draw` talimatları (kutu, yatay çizgi, çizgi, işaret).
import { decimals } from './format.js';

const C = { bg: '#121822', grid: '#1c2430', text: '#8f99aa', up: '#26a69a', down: '#ef5350' };
const TZ = -new Date().getTimezoneOffset() * 60;
const sec = (ms) => Math.floor(ms / 1000) + TZ;
const STYLE = { solid: 0, dotted: 1, dashed: 2 };

let current = null;
export function destroyChart() {
  if (current) { current.ro?.disconnect(); current.overlay?.remove(); current.chart.remove(); current = null; }
}

/**
 * @param el        kap
 * @param candles   kapanmış mumlar
 * @param live      canlı mum ya da null
 * @param signals   çizilecek sinyaller (draw alanları)
 * @param price     referans fiyat (ondalık hane için)
 * @param opts      { clean: sade mod (coin sayfası): eksende yalnız ana seviyeler, diğer etiketler grafiğin sağ boşluğunda,
 *                    ince kutular, yakın seviyeler birleşir; onLegend(items): çizilenlerin listesi }
 */
export function drawRow(el, candles, live, signals, price, opts = {}) {
  const clean = !!opts.clean;
  destroyChart();
  const LW = window.LightweightCharts;
  if (!LW) { el.innerHTML = '<p class="empty">Grafik kütüphanesi yüklenemedi.</p>'; return; }
  const prec = decimals(price);
  const pf = { type: 'price', precision: prec, minMove: 10 ** -prec };
  const chart = LW.createChart(el, {
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.grid },
    timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'tr-TR' },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down, priceFormat: pf,
  });
  const all = live ? [...candles, live] : candles;
  const data = all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));
  // Sade modda sağa boş (whitespace) mumlar: etiketler mumların üstüne değil bu boşluğa yazılır
  const step = all.length > 1 ? all[all.length - 1].time - all[all.length - 2].time : 3600e3;
  const pad = clean ? 14 : 0;
  for (let k = 1; k <= pad; k++) data.push({ time: sec(all[all.length - 1].time + k * step) });
  series.setData(data);
  const lastI = all.length - 1;
  const labelTime = sec(all[all.length - 1].time + Math.max(1, pad - 1) * step);
  const tm = (i) => sec(all[Math.max(0, Math.min(Math.round(i), lastI))].time);
  const lineOpts = (color, style = 'solid', width = 1) => ({
    color, lineWidth: width, lineStyle: STYLE[style] ?? 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf,
  });
  const markers = [];
  const labelMarks = []; // sade mod: sağ boşluktaki seviye etiketleri (görünmez yardımcı seride)
  const legend = [];
  const hlines = new Map(); // aynı fiyattaki etiketleri birleştir
  let minI = lastI;
  const addLine = (pts, color, style, width) => {
    const data = pts.map((p) => ({ time: tm(p.i), value: p.price }));
    // Zaman artan olmalı; aynı zaman tekrarlarını ele
    const seen = new Set();
    const clean = data.filter((d) => !seen.has(d.time) && seen.add(d.time)).sort((a, b) => a.time - b.time);
    if (clean.length >= 2) chart.addSeries(LW.LineSeries, lineOpts(color, style, width)).setData(clean);
  };
  const fade = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c + '66' : c);
  for (const s of signals) {
    // Katman (s.faint): soluk renk, etiketsiz; kutular ve yatay seviyeler (son 60 mum boyunca) çizilir, gerisi atlanır
    if (s.faint) {
      for (const d of s.draw || []) {
        try {
          if (d.kind === 'box') {
            const from = Math.max(0, d.from), to = Math.max(from + 1, Math.min(lastI, d.to));
            addLine([{ i: from, price: d.hi }, { i: to, price: d.hi }], fade(d.color), 'solid', 1);
            addLine([{ i: from, price: d.lo }, { i: to, price: d.lo }], fade(d.color), 'dotted', 1);
            if (clean) legend.push({ color: fade(d.color), text: `${d.label || s.name} (katman)`, lo: d.lo, hi: d.hi, faint: true });
          } else if (d.kind === 'hline') {
            addLine([{ i: Math.max(0, lastI - 60), price: d.price }, { i: lastI, price: d.price }], fade(d.color), 'dotted', 1);
            if (clean) legend.push({ color: fade(d.color), text: `${d.label || s.name} (katman)`, price: d.price, faint: true });
          }
        } catch { /* yoksay */ }
      }
      continue;
    }
    for (const d of s.draw || []) {
      try {
        if (d.kind === 'box') {
          const from = Math.max(0, d.from), to = Math.max(from + 1, Math.min(lastI, d.to));
          minI = Math.min(minI, from);
          addLine([{ i: from, price: d.hi }, { i: to, price: d.hi }], d.color, 'solid', clean ? 1 : 2);
          addLine([{ i: from, price: d.lo }, { i: to, price: d.lo }], d.color, clean ? 'dashed' : 'solid', clean ? 1 : 2);
          // kutu içi: yarı saydam alan çizgileri (üst-alt arası) — 3 ara çizgi (sade modda yok)
          if (!clean) for (let k = 1; k <= 3; k++) addLine([{ i: from, price: d.lo + ((d.hi - d.lo) * k) / 4 }, { i: to, price: d.lo + ((d.hi - d.lo) * k) / 4 }], d.color + '33', 'solid', 1);
          if (d.label && !clean) markers.push({ time: tm(from), position: 'aboveBar', shape: 'square', color: d.color, text: d.label, _p: d.hi });
          if (clean) { legend.push({ color: d.color, text: d.label || 'Bölge', lo: d.lo, hi: d.hi }); if (d.label) labelMarks.push({ boxTime: tm(from), price: d.hi, color: d.color, text: d.label }); }
        } else if (d.kind === 'hline') {
          const key = d.price.toPrecision(8);
          if (hlines.has(key)) { hlines.get(key).title += ` / ${d.label}`; continue; }
          hlines.set(key, { price: d.price, color: d.color, title: d.label || '', style: d.style });
        } else if (d.kind === 'line') {
          for (const p of d.points) minI = Math.min(minI, p.i);
          addLine(d.points, d.color, d.style || 'solid', 2);
        } else if (d.kind === 'marker') {
          minI = Math.min(minI, d.i);
          markers.push({ time: tm(d.i), position: d.position || 'belowBar', shape: d.shape || 'circle', color: d.color, text: d.text || '' });
        }
      } catch { /* bozuk çizim talimatı grafiği düşürmesin */ }
    }
  }
  if (!clean) for (const h of hlines.values()) series.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: STYLE[h.style] ?? 2, axisLabelVisible: true, title: h.title });
  else {
    // Yakın seviyeleri (fiyatın %0,15'i içinde) birleştir; eksende yalnız ana seviyeler, diğerleri sağ boşlukta etiket
    const KEY = /giriş|stop|^h1|^h2|tp1|tp2|hedef/i;
    const groups = [];
    for (const h of [...hlines.values()].sort((a, b) => a.price - b.price)) {
      const g = groups.find((x) => Math.abs(x.price - h.price) <= 0.0015 * Math.abs(h.price));
      if (g) { g.title += ` · ${h.title}`; g.key = g.key || KEY.test(h.title); } else groups.push({ ...h, key: KEY.test(h.title) });
    }
    // Yakın etiketler (görünür fiyat aralığının ~%4'ü içinde) üst üste binmesin: sırayla sola kaydır (3 kademe)
    const vals = all.slice(-80).flatMap((c) => [c.high, c.low]);
    const span = Math.max(...vals) - Math.min(...vals) || Math.abs(price) * 0.05;
    let lastP = null, slot = 0;
    for (const g of groups) {
      series.createPriceLine({ price: g.price, color: g.color + (g.key ? '' : '99'), lineWidth: 1, lineStyle: STYLE[g.style] ?? 2, axisLabelVisible: g.key, title: g.key ? g.title.split(' · ')[0] : '' });
      if (!g.key && g.title) {
        slot = lastP != null && Math.abs(g.price - lastP) < 0.04 * span ? (slot + 1) % 3 : 0;
        lastP = g.price;
        const t = sec(all[all.length - 1].time + Math.max(1, pad - 1 - slot * 5) * step);
        labelMarks.push({ time: t, position: 'atPriceMiddle', price: g.price, shape: 'circle', size: 0.1, color: g.color, text: g.title.length > 24 ? g.title.slice(0, 23) + '…' : g.title });
      }
      legend.push({ color: g.color, text: g.title || 'Seviye', price: g.price, key: g.key });
    }
  }
  if (markers.length) {
    const seen = new Set();
    LW.createSeriesMarkers(series, markers.filter((m) => { const k = `${m.time}|${m.position}|${m.text}|${m.price ?? ''}`; return !seen.has(k) && seen.add(k); }).sort((a, b) => a.time - b.time).map(({ _p, ...m }) => m));
  }
  // Sade mod etiketleri: grafiğin üstünde HTML katmanı (sağ kenar, çizgi hizası); kaydırma/yakınlaştırmada yeniden yerleşir
  let overlay = null, layout = null;
  if (labelMarks.length) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3';
    const items = labelMarks.map((m) => {
      if (m.boxTime != null) { const d = document.createElement('div'); d.textContent = m.text; d.style.cssText = `position:absolute;font:600 10px/1.2 system-ui,sans-serif;color:${m.color};white-space:nowrap;text-shadow:0 0 3px #121822,0 0 3px #121822`; overlay.appendChild(d); return { d, price: m.price, boxTime: m.boxTime }; }
      const d = document.createElement('div');
      d.textContent = m.text;
      d.style.cssText = `position:absolute;right:0;transform:translateY(-50%);font:600 10.5px/1.25 system-ui,sans-serif;color:${m.color};background:rgba(18,24,34,.85);border:1px solid ${m.color}55;border-radius:3px;padding:1px 5px;white-space:nowrap;max-width:46%;overflow:hidden;text-overflow:ellipsis`;
      overlay.appendChild(d); return { d, price: m.price };
    });
    el.appendChild(overlay);
    layout = () => {
      const paneW = chart.timeScale().width();
      const placed = [];
      for (const it of items) {
        const y = series.priceToCoordinate(it.price); it.y = y;
        const x = it.boxTime != null ? chart.timeScale().timeToCoordinate(it.boxTime) : 0;
        const hide = y == null || y < 0 || y > el.clientHeight - 24 || x == null || x > paneW - 20;
        it.d.style.display = hide ? 'none' : 'block';
        if (!hide && it.boxTime != null) { it.d.style.left = `${Math.max(2, x + 2)}px`; it.d.style.right = 'auto'; it.d.style.top = `${y}px`; it.d.style.transform = 'translateY(-110%)'; }
      }
      const vis = items.filter((it) => it.d.style.display !== 'none' && it.boxTime == null).sort((a, b) => a.y - b.y);
      for (const it of vis) { let y = it.y; const prev = placed[placed.length - 1]; if (prev != null && y - prev < 15) y = prev + 15; placed.push(y); it.d.style.top = `${y}px`; it.d.style.right = `${el.clientWidth - paneW + 4}px`; }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(layout));
  }
  const from = Math.max(0, Math.min(minI, lastI - (clean ? 70 : 40)) - 10);
  chart.timeScale().setVisibleLogicalRange({ from, to: all.length + (clean ? pad : 8) });
  opts.onLegend?.(legend);
  const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 0 && r.height > 0) { chart.resize(Math.floor(r.width), Math.floor(r.height)); if (layout) requestAnimationFrame(layout); } });
  ro.observe(el);
  if (layout) { setTimeout(layout, 50); el.addEventListener('wheel', () => requestAnimationFrame(layout), { passive: true }); el.addEventListener('touchmove', () => requestAnimationFrame(layout), { passive: true }); el.addEventListener('mouseup', () => requestAnimationFrame(layout)); }
  current = { chart, ro, overlay };
}
