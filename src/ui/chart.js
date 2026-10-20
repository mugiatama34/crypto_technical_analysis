// Lightweight Charts 5 ile satır grafiği: mumlar + sinyallerin `draw` talimatları (kutu, yatay çizgi, çizgi, işaret).
import { decimals } from './format.js';

const C = { bg: '#121822', grid: '#1c2430', text: '#8f99aa', up: '#26a69a', down: '#ef5350' };
const TZ = -new Date().getTimezoneOffset() * 60;
const sec = (ms) => Math.floor(ms / 1000) + TZ;
const STYLE = { solid: 0, dotted: 1, dashed: 2 };

let current = null;
export function destroyChart() {
  if (current) { current.ro?.disconnect(); current.chart.remove(); current = null; }
}

/**
 * @param el        kap
 * @param candles   kapanmış mumlar
 * @param live      canlı mum ya da null
 * @param signals   çizilecek sinyaller (draw alanları)
 * @param price     referans fiyat (ondalık hane için)
 */
export function drawRow(el, candles, live, signals, price) {
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
  series.setData(all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const lastI = all.length - 1;
  const tm = (i) => sec(all[Math.max(0, Math.min(Math.round(i), lastI))].time);
  const lineOpts = (color, style = 'solid', width = 1) => ({
    color, lineWidth: width, lineStyle: STYLE[style] ?? 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf,
  });
  const markers = [];
  const hlines = new Map(); // aynı fiyattaki etiketleri birleştir
  let minI = lastI;
  const addLine = (pts, color, style, width) => {
    const data = pts.map((p) => ({ time: tm(p.i), value: p.price }));
    // Zaman artan olmalı; aynı zaman tekrarlarını ele
    const seen = new Set();
    const clean = data.filter((d) => !seen.has(d.time) && seen.add(d.time)).sort((a, b) => a.time - b.time);
    if (clean.length >= 2) chart.addSeries(LW.LineSeries, lineOpts(color, style, width)).setData(clean);
  };
  for (const s of signals) {
    for (const d of s.draw || []) {
      try {
        if (d.kind === 'box') {
          const from = Math.max(0, d.from), to = Math.max(from + 1, Math.min(lastI, d.to));
          minI = Math.min(minI, from);
          addLine([{ i: from, price: d.hi }, { i: to, price: d.hi }], d.color, 'solid', 2);
          addLine([{ i: from, price: d.lo }, { i: to, price: d.lo }], d.color, 'solid', 2);
          // kutu içi: yarı saydam alan çizgileri (üst-alt arası) — 3 ara çizgi
          for (let k = 1; k <= 3; k++) addLine([{ i: from, price: d.lo + ((d.hi - d.lo) * k) / 4 }, { i: to, price: d.lo + ((d.hi - d.lo) * k) / 4 }], d.color + '33', 'solid', 1);
          if (d.label) markers.push({ time: tm(from), position: 'aboveBar', shape: 'square', color: d.color, text: d.label, _p: d.hi });
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
  for (const h of hlines.values()) series.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: STYLE[h.style] ?? 2, axisLabelVisible: true, title: h.title });
  if (markers.length) {
    const seen = new Set();
    LW.createSeriesMarkers(series, markers.filter((m) => { const k = `${m.time}|${m.position}|${m.text}`; return !seen.has(k) && seen.add(k); }).sort((a, b) => a.time - b.time).map(({ _p, ...m }) => m));
  }
  const from = Math.max(0, Math.min(minI, lastI - 40) - 10);
  chart.timeScale().setVisibleLogicalRange({ from, to: all.length + 8 });
  const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 0 && r.height > 0) chart.resize(Math.floor(r.width), Math.floor(r.height)); });
  ro.observe(el);
  current = { chart, ro };
}
