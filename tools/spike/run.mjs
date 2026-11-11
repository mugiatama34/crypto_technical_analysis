// node tools/spike/run.mjs <klines klasörü> [SYM1,SYM2,...]  (Binance USDT-M 15m aylık CSV: SYMBOL-15m-YYYY-MM.csv)
// Çıktı: havuzlanmış olay sonrası tablo + işlem simülasyonu (fade / devam / yeni uç+geri dönüş), eğitim/doğrulama,
// hedge'li R (altcoinlerde aynı süre ters yönlü eşit nominal BTC), sıkı ölçüt + en iyi ay atılınca.
import fs from 'node:fs';
import { atr, aggregate, findEvents, simTrade, simSweep } from './spike.js';
const dir = process.argv[2];
const syms = (process.argv[3] || 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');
const load = (s) => fs.readdirSync(dir).filter((f) => f.startsWith(s + '-15m-') && f.endsWith('.csv')).sort().flatMap((f) => fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').filter((l) => /^\d/.test(l)).map((l) => { const x = l.split(','); return { t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }; }));
const ema = (v, n) => { const k = 2 / (n + 1); let e = null; return v.map((x) => (e = e == null ? x : x * k + e * (1 - k))); };
const f = (x, d = 2) => (x == null || isNaN(x) ? '   -' : (x >= 0 ? '+' : '') + x.toFixed(d));
const stat = (a) => { if (!a.length) return { n: 0 }; const w = a.filter((x) => x > 0), l = a.filter((x) => x <= 0); return { n: a.length, R: a.reduce((s, x) => s + x, 0) / a.length, win: w.length / a.length, pf: w.reduce((s, x) => s + x, 0) / Math.max(1e-9, -l.reduce((s, x) => s + x, 0)) }; };
const H = [1, 4, 16, 32, 96];
const btc15 = load('BTCUSDT'); const btcIdx = { '15m': new Map(btc15.map((x, i) => [x.t, i])) }; const btc1h = aggregate(btc15, 4); btcIdx['1H'] = new Map(btc1h.map((x, i) => [x.t, i]));
const btcC = { '15m': btc15, '1H': btc1h };
const all = btc15[0].t, end = btc15[btc15.length - 1].t, split = all + (end - all) * 2 / 3;
const fwd = {}; const cells = {};
for (const sym of syms) {
  const c15 = load(sym); if (c15.length < 3000) continue;
  const day = aggregate(c15, 96), dE = ema(day.map((x) => x.c), 20);
  const trendAt = (t) => { let lo = 0, hi = day.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (day[m].t + 864e5 <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 20 ? Math.sign(day[r].c - dE[r]) : 0; };
  for (const [tf, c] of [['15m', c15], ['1H', aggregate(c15, 4)]]) {
    const A = atr(c), B = btcC[tf], BI = btcIdx[tf];
    const hedge = (r) => { if (sym === 'BTCUSDT') return r.R; const a = BI.get(c[r.j].t), b = BI.get(c[r.xi].t); if (a == null || b == null) return null; return r.R - (((B[b].c - B[a].c) / B[a].c) * r.dir) / r.riskPct; };
    for (const k of [2, 3, 4]) {
      const ev = findEvents(c, A, k);
      for (const e of ev) { e.tr = trendAt(e.t); e.with = e.tr === 0 ? null : e.tr === e.d; }
      const N = tf === '15m' ? 96 : 24;
      for (const e of ev) for (const lab of ['tümü', e.with === true ? 'trend yönünde' : e.with === false ? 'trende ters' : null]) {
        if (!lab) continue; const key = `${tf} k=${k} ${lab}`; const F = (fwd[key] ||= { n: 0, r: H.map(() => []), half: 0, ext: 0 });
        F.n++; H.forEach((h, i) => { if (e.i + h < c.length) F.r[i].push(((c[e.i + h].c - c[e.i].c) * e.d) / e.a); });
        const lvl = c[e.i].c - e.d * 0.5 * e.body; let hx = null, he = null;
        for (let x = e.i + 1; x <= Math.min(c.length - 1, e.i + N); x++) { if (he == null && (e.d > 0 ? c[x].h > c[e.i].h : c[x].l < c[e.i].l)) he = x; if (hx == null && (e.d > 0 ? c[x].l <= lvl : c[x].h >= lvl)) hx = x; }
        if (hx != null) F.half++; if (he != null && (hx == null || he < hx)) F.ext++;
      }
      const push = (mode, p, r, e) => { if (!r) return; const C = (cells[[tf, k, mode, p].join('|')] ||= { tr: [], va: [], htr: [], hva: [], ters: [], mo: {} }); const v = e.t >= split, hR = hedge(r); C[v ? 'va' : 'tr'].push(r.R); if (hR != null) C[v ? 'hva' : 'htr'].push(hR); if (e.with === false) C.ters.push(r.R); (C.mo[new Date(e.t).toISOString().slice(0, 7)] ||= []).push(r.R); };
      for (const e of ev) {
        for (const cost of [0.0015, 0]) {
          const g = cost ? '' : ' brüt';
          for (const w of [0, 4]) for (const m of [1, 1.5, 2]) for (const buf of [0.1, 1]) {
            push('fade', `w${w} m${m} pay${buf}${g}`, simTrade(c, e, { mode: 'fade', w, m, T: 64, buf, cost }), e);
            push('devam', `w${w} m${m} pay${buf}${g}`, simTrade(c, e, { mode: 'cont', w, m, T: 64, buf, cost }), e);
          }
          for (const q of [0, 0.25]) for (const m of [1, 1.5, 2]) for (const buf of [0.1, 0.5]) push('yeniuç', `q${q} m${m} pay${buf}${g}`, simSweep(c, e, { q, N: 16, m, T: 64, buf, cost }), e);
        }
      }
    }
  }
  process.stderr.write(sym + ' ');
}
console.log(`Coinler: ${syms.length} | dönem ${new Date(all).toISOString().slice(0, 10)}–${new Date(end).toISOString().slice(0, 10)} | bölünme ${new Date(split).toISOString().slice(0, 10)}`);
console.log('\n=== Olay sonrası (havuz; yönlü getiri ATR, + = devam) ===');
for (const [key, F] of Object.entries(fwd)) {
  const mean = F.r.map((a) => a.reduce((s, x) => s + x, 0) / a.length), med = F.r.map((a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }), cont = F.r.map((a) => Math.round((100 * a.filter((x) => x > 0).length) / a.length));
  console.log(`${key.padEnd(24)} n ${String(F.n).padStart(5)} | ort ${H.map((h, i) => `${h}:${f(mean[i])}`).join(' ')} | medyan ${H.map((h, i) => `${h}:${f(med[i])}`).join(' ')} | devam% ${cont.join('/')} | %50 geri ${Math.round((100 * F.half) / F.n)}% · önce yeni uç ${Math.round((100 * F.ext) / F.n)}%`);
}
const rows = Object.entries(cells).map(([key, C]) => { const a = stat(C.tr), b = stat(C.va), ha = stat(C.htr), hb = stat(C.hva), t = stat(C.ters);
  const mo = Object.entries(C.mo).map(([m, r]) => [m, r.reduce((s, x) => s + x, 0)]).sort((x, y) => y[1] - x[1]); const tot = [...C.tr, ...C.va].reduce((s, x) => s + x, 0); const exBest = (tot - (mo[0]?.[1] || 0)) / (C.tr.length + C.va.length - (C.mo[mo[0]?.[0]]?.length || 0));
  return { key, a, b, ha, hb, t, exBest }; });
const line = (o) => `${o.key.padEnd(34)} | eğ ${String(o.a.n).padStart(5)} ${f(o.a.R)} PF ${f(o.a.pf)} | doğr ${String(o.b.n).padStart(5)} ${f(o.b.R)} PF ${f(o.b.pf)} | hedge'li ${f(o.ha.R)} / ${f(o.hb.R)} | trende ters ${f(o.t.R)} (${o.t.n}) | en iyi ay hariç ${f(o.exBest)}`;
for (const mode of ['fade', 'devam', 'yeniuç']) {
  console.log(`\n=== ${mode} (maliyetli; doğrulamada en iyi 8 + her k için m1.5 özeti) ===`);
  const g = rows.filter((o) => o.key.split('|')[2] === mode && !o.key.includes('brüt'));
  for (const o of [...g].sort((x, y) => y.b.R - x.b.R).slice(0, 8)) console.log(line(o));
  console.log('-- özet (m1.5, pay0.1 / w0 / q0):'); for (const o of g.filter((o) => / m1\.5 pay0\.1$/.test(o.key) && !/w4|q0\.25/.test(o.key))) console.log(line(o));
  const avg = (arr, sel) => arr.reduce((s, o) => s + (sel(o) || 0), 0) / arr.length;
  console.log(`hücre ${g.length} | ort. eğitim ${f(avg(g, (o) => o.a.R))} doğr ${f(avg(g, (o) => o.b.R))} | brüt ort. doğr ${f(avg(rows.filter((o) => o.key.split('|')[2] === mode && o.key.includes('brüt')), (o) => o.b.R))}`);
}
const ok = (o) => o.a.R > 0 && o.b.R > 0 && o.a.pf > 1.1 && o.b.pf > 1.1 && o.b.n >= 100;
const pass = rows.filter((o) => !o.key.includes('brüt') && ok(o));
console.log(`\nSıkı ölçüt (maliyetli): ${pass.length}/${rows.filter((o) => !o.key.includes('brüt')).length}`); for (const o of pass) console.log(line(o) + (o.ha.R > 0 && o.hb.R > 0 ? '  ✓hedge' : '  ✗hedge') + (o.exBest > 0 ? ' ✓sağlam' : ' ✗sağlam'));
