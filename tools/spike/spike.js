// Ani hareket (spike) sonrası ölçümü: olay = gövdesi ≥ k × ATR14 olan mum. Sonrası: devam/geri dönüş, düzeltme oranı,
// bekle-ve-ters (fade) / devam işlemi simülasyonu. Saf fonksiyonlar (test: tests/spike.test.js).
export function atr(c, n = 14) {
  const out = new Array(c.length).fill(null); let a = null;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    a = a == null ? tr : (a * (n - 1) + tr) / n; if (i >= n) out[i] = a;
  }
  return out;
}
export function aggregate(c, k) { // 15m → 1H (k=4) vb.; zaman hizalı gruplar
  const out = []; const ms = (c[1].t - c[0].t) * k;
  for (const x of c) {
    const g = Math.floor(x.t / ms) * ms; const last = out[out.length - 1];
    if (last && last.t === g) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; }
    else out.push({ t: g, o: x.o, h: x.h, l: x.l, c: x.c });
  }
  return out;
}
// olaylar: |c−o| ≥ k·ATR(önceki mum); aynı yönde son `gap` mumda olay varsa atla
export function findEvents(c, A, k, gap = 8) {
  const ev = []; let lastUp = -1e9, lastDn = -1e9;
  for (let i = 15; i < c.length; i++) {
    const a = A[i - 1]; if (!a || a < c[i].c * 1e-4) continue; const b = c[i].c - c[i].o; // bozuk/donuk veri: ATR ≈ 0
    if (Math.abs(b) < k * a) continue; const d = Math.sign(b);
    if (d > 0 ? i - lastUp <= gap : i - lastDn <= gap) { if (d > 0) lastUp = i; else lastDn = i; continue; }
    if (d > 0) lastUp = i; else lastDn = i;
    ev.push({ i, d, a, body: Math.abs(b), t: c[i].t });
  }
  return ev;
}
// buf = stop payı (ATR). işlem: giriş = c[i+w] kapanışı, yön dir (fade: −d, devam: +d). Stop: fade → olay uç noktası (i..i+w) ± 0,1 ATR;
// devam → olay mumunun açılışı ∓ 0,1 ATR. Hedef = giriş ± m × risk. Aynı mumda ikisi → stop (kötümser). T mum sonra kapanış.
export function simTrade(c, e, { mode, w = 0, m = 1.5, T = 32, cost = 0.0015, buf = 0.1 }) {
  const j = e.i + w; if (j + 1 >= c.length) return null;
  const dir = mode === 'fade' ? -e.d : e.d, entry = c[j].c;
  let ext = e.d > 0 ? -Infinity : Infinity;
  for (let x = e.i; x <= j; x++) ext = e.d > 0 ? Math.max(ext, c[x].h) : Math.min(ext, c[x].l);
  const stop = mode === 'fade' ? ext + e.d * buf * e.a : c[e.i].o - e.d * buf * e.a;
  const risk = (entry - stop) * dir; if (!(risk > 0)) return null;
  const tp = entry + dir * m * risk; let exit = null, how = 'time', xi = j;
  for (let x = j + 1; x <= Math.min(c.length - 1, j + T); x++) {
    xi = x; const hitS = dir > 0 ? c[x].l <= stop : c[x].h >= stop, hitT = dir > 0 ? c[x].h >= tp : c[x].l <= tp;
    if (hitS) { exit = stop; how = 'stop'; break; } if (hitT) { exit = tp; how = 'tp'; break; }
    exit = c[x].c;
  }
  const R = ((exit - entry) * dir - cost * entry) / risk;
  return { R, how, riskPct: risk / entry, j, xi, dir };
}
// "yeni uç + geri dönüş": olaydan sonra N mum içinde olay ucunun ötesine geçilir (yeni uç), sonra bir mum seviyenin
// içine kapanır → o kapanışta ters giriş. Seviye = olay ucu − q × gövde (q=0: uç, q=0,25: gövdenin üst çeyreği).
// Stop = olaydan beri en uç fiyat ± buf × ATR. Hedef = m × R. T mum sonra kapanış. Aynı mumda stop önce.
export function simSweep(c, e, { q = 0, N = 16, m = 1.5, T = 64, buf = 0.1, cost = 0.0015 }) {
  const d = e.d, edge = d > 0 ? c[e.i].h : c[e.i].l, lvl = edge - d * q * e.body;
  let ext = edge, broke = false, j = -1;
  for (let x = e.i + 1; x <= Math.min(c.length - 2, e.i + N); x++) {
    ext = d > 0 ? Math.max(ext, c[x].h) : Math.min(ext, c[x].l);
    if (!broke && (d > 0 ? c[x].h > edge : c[x].l < edge)) broke = true;
    if (broke && (d > 0 ? c[x].c < lvl : c[x].c > lvl)) { j = x; break; }
  }
  if (j < 0) return null;
  const dir = -d, entry = c[j].c, stop = ext + d * buf * e.a, risk = (entry - stop) * dir; if (!(risk > 0)) return null;
  const tp = entry + dir * m * risk; let exit = c[j].c, how = 'time', xi = j;
  for (let x = j + 1; x <= Math.min(c.length - 1, j + T); x++) {
    xi = x; const hitS = dir > 0 ? c[x].l <= stop : c[x].h >= stop, hitT = dir > 0 ? c[x].h >= tp : c[x].l <= tp;
    if (hitS) { exit = stop; how = 'stop'; break; } if (hitT) { exit = tp; how = 'tp'; break; }
    exit = c[x].c;
  }
  return { R: ((exit - entry) * dir - cost * entry) / risk, how, riskPct: risk / entry, j, xi, dir };
}
