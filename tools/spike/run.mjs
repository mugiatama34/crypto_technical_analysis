// node tools/spike/run.mjs <klines klasörü>  (Binance USDT-M 15m aylık CSV: SYMBOL-15m-YYYY-MM.csv)
import fs from 'node:fs';
import { atr, aggregate, findEvents, simTrade } from './spike.js';
const dir = process.argv[2];
const load = (s) => fs.readdirSync(dir).filter((f) => f.startsWith(s + '-15m-')).sort().flatMap((f) => fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').filter((l) => /^\d/.test(l)).map((l) => { const x = l.split(','); return { t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }; }));
const ema = (v, n) => { const k = 2 / (n + 1); let e = null; return v.map((x) => (e = e == null ? x : x * k + e * (1 - k))); };
const f = (x, d = 2) => (x == null || isNaN(x) ? '   -' : (x >= 0 ? '+' : '') + x.toFixed(d));
const stat = (a) => { if (!a.length) return { n: 0 }; const w = a.filter((x) => x > 0), l = a.filter((x) => x <= 0); return { n: a.length, R: a.reduce((s, x) => s + x, 0) / a.length, win: w.length / a.length, pf: w.reduce((s, x) => s + x, 0) / Math.max(1e-9, -l.reduce((s, x) => s + x, 0)) }; };
const H = [1, 2, 4, 8, 16, 32, 96];
const sims = [];
for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const c15 = load(sym); if (!c15.length) continue;
  const day = aggregate(c15, 96), dE = ema(day.map((x) => x.c), 20);
  const trendAt = (t) => { let lo = 0, hi = day.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (day[m].t + 864e5 <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 20 ? Math.sign(day[r].c - dE[r]) : 0; };
  const split = c15[0].t + (c15[c15.length - 1].t - c15[0].t) * 2 / 3;
  for (const [tf, c] of [['15m', c15], ['1H', aggregate(c15, 4)]]) {
    const A = atr(c);
    // taban: rastgele mumdan sonraki ortalama |hareket| yön bilgisi yok → 0 beklenir; burada yönlü getiriyi ATR biriminde veriyoruz
    for (const k of [2, 3, 4]) {
      const ev = findEvents(c, A, k);
      for (const e of ev) { e.tr = trendAt(e.t); e.with = e.tr === 0 ? null : e.tr === e.d; }
      const rows = [];
      for (const [lab, g] of [['tümü', ev], ['trend yönünde', ev.filter((e) => e.with === true)], ['trende ters', ev.filter((e) => e.with === false)], ['yukarı', ev.filter((e) => e.d > 0)], ['aşağı', ev.filter((e) => e.d < 0)]]) {
        const fr = H.map((h) => { const a = g.filter((e) => e.i + h < c.length).map((e) => ((c[e.i + h].c - c[e.i].c) * e.d) / e.a); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; });
        const cont = H.map((h) => { const a = g.filter((e) => e.i + h < c.length); return a.length ? a.filter((e) => (c[e.i + h].c - c[e.i].c) * e.d > 0).length / a.length : null; });
        // 24 saat (96×15m / 24×1H) içinde gövdenin %50'si geri alındı mı, önce yeni uç mu yapıldı
        const N = tf === '15m' ? 96 : 24; let half = 0, ext = 0;
        for (const e of g) { const lvl = c[e.i].c - e.d * 0.5 * e.body; let hx = null, he = null; for (let x = e.i + 1; x <= Math.min(c.length - 1, e.i + N); x++) { if (he == null && (e.d > 0 ? c[x].h > c[e.i].h : c[x].l < c[e.i].l)) he = x; if (hx == null && (e.d > 0 ? c[x].l <= lvl : c[x].h >= lvl)) hx = x; } if (hx != null) half++; if (he != null && (hx == null || he < hx)) ext++; }
        rows.push(`${lab.padEnd(14)} n ${String(g.length).padStart(4)} | yönlü getiri (ATR) ${H.map((h, i) => `${h}:${f(fr[i])}`).join(' ')} | devam% ${H.map((h, i) => (cont[i] == null ? '-' : Math.round(cont[i] * 100))).join('/')} | %50 geri alma ${Math.round((100 * half) / (g.length || 1))}% · önce yeni uç ${Math.round((100 * ext) / (g.length || 1))}%`);
      }
      console.log(`\n=== ${sym} ${tf} k=${k} (olay: gövde ≥ ${k} ATR) ===\n` + rows.join('\n'));
      for (const mode of ['fade', 'devam']) for (const w of [0, 1, 4]) for (const m of [1, 1.5, 2]) for (const buf of [0.1, 1]) for (const cost of [0, 0.0015]) for (const e of ev) {
        const r = simTrade(c, e, { mode: mode === 'fade' ? 'fade' : 'cont', w, m, T: 64, buf, cost }); if (r) sims.push({ sym, tf, k, mode, w, m, T: `b${buf}${cost ? '' : 'g'}`, with: e.with, val: e.t >= split, ...r });
      }
    }
  }
}
// işlem tablosu: hücre = tf × k × mod × w × m × T (3 coin birlikte); eğitim / doğrulama
const cells = {};
for (const s of sims) { const key = [s.tf, s.k, s.mode, s.w, s.m, s.T].join('|'); (cells[key] ||= { tr: [], va: [], trTer: [], vaTer: [] }); cells[key][s.val ? 'va' : 'tr'].push(s.R); if (s.with === false) cells[key][s.val ? 'vaTer' : 'trTer'].push(s.R); }
console.log('\n=== İşlem simülasyonu (BTC+ETH+SOL; maliyet %0,15 gidiş-dönüş; aynı mumda stop önce) ===');
console.log('tf  k mod   w  m   pay(b, g=maliyetsiz) | eğitim n/R/PF       | doğrulama n/R/PF    | trende ters: eğ R / doğr R (n)');
const out = [];
for (const [key, v] of Object.entries(cells)) { const [tf, k, mode, w, m, T] = key.split('|'); const a = stat(v.tr), b = stat(v.va), at = stat(v.trTer), bt = stat(v.vaTer); out.push({ key, a, b, at, bt }); console.log(`${tf.padEnd(3)} ${k} ${mode.padEnd(5)} ${w} ${m.padEnd(3)} ${T.padStart(2)} | ${String(a.n).padStart(4)} ${f(a.R)} ${f(a.pf)} | ${String(b.n).padStart(4)} ${f(b.R)} ${f(b.pf)} | ${f(at.R)} / ${f(bt.R)} (${at.n}/${bt.n})`); }
const pass = out.filter((o) => o.a.R > 0 && o.b.R > 0 && o.a.pf > 1.1 && o.b.pf > 1.1 && o.b.n >= 100);
console.log(`\nSıkı ölçütü geçen hücre: ${pass.length}/${out.length}` + (pass.length ? '\n' + pass.map((o) => o.key).join('\n') : ''));
const passT = out.filter((o) => o.at.R > 0 && o.bt.R > 0 && o.at.pf > 1.1 && o.bt.pf > 1.1 && o.bt.n >= 100);
console.log(`Trende ters alt kümede geçen: ${passT.length}` + (passT.length ? '\n' + passT.map((o) => o.key).join('\n') : ''));
