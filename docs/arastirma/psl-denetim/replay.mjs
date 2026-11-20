import { T } from './trades.mjs'; import { klines, tOf, atrW } from './probe.mjs';
const NOT = 8000; // 1000 $ marjin × 8x (4H özel ayarı)
// mode 'author': stop kapanışla tetiklenir, çıkış stop SEVİYESİNDEN; maliyet toplam %0,05
// mode 'close' : aynı kural, çıkış o mumun KAPANIŞINDAN; maliyet taraf başına %0,05 + %0,05 (toplam %0,20)
// mode 'wick'  : stop borsada emir (fitille, seviyeden); hedef + stop aynı mumda → stop; maliyet %0,20
function sim(K, i, d, mode) {
  const e = K[i].c, R = 2 * atrW(K, i), tp = [1, 1.5, 2.5, 3.5].map((m) => e + d * m * R);
  let stop = e - d * R, hit = 0, label = null, exit = null;
  for (let j = i + 1; j < K.length; j++) {
    const k = K[j], beyond = (p, lvl) => d * (p - lvl) <= 0; // stopun ötesi
    const reach = (lvl) => (d === 1 ? k.h >= lvl : k.l <= lvl);
    if (mode === 'wick' && (d === 1 ? k.l <= stop : k.h >= stop)) { exit = stop; label = hit ? `TP${hit}+stop` : 'SL'; break; }
    let nh = hit; while (nh < 4 && reach(tp[nh])) nh++;
    if (nh === 4) { exit = tp[3]; label = 'TP4'; break; }
    if (mode !== 'wick' && beyond(k.c, stop)) { exit = mode === 'author' ? stop : k.c; label = hit ? `TP${hit}+stop` : 'SL'; hit = Math.max(hit, 0); break; }
    if (nh > hit) { // taşınan stop sonraki mumdan geçerli: TP1 → TP1, TP2 → değişmez, TP3 → TP2
      if (nh >= 3) stop = tp[1]; else if (nh >= 1) stop = tp[0];
      hit = nh;
      if (mode !== 'wick' && false) {}
    }
  }
  if (exit == null) return { open: true };
  const cost = mode === 'author' ? 0.0005 : 0.002;
  const pnl = NOT * (d * (exit - e) / e - cost);
  return { e, R, exit, label: label.replace(/TP(\d)\+stop/, (m, n) => `TP${n}+${n >= 3 ? 'TP2' : 'TP1'} stop`), pnl, r: pnl / (NOT * R / e), hitMax: hit };
}
let rows = [], match = 0, lab = 0;
for (const [sym, v] of Object.entries(T)) {
  const K = await klines(sym);
  for (const [no, side, ts, res, pl] of v.rows) {
    const t = tOf(ts), i = K.findIndex((k) => k.t === t), d = side === 'L' ? 1 : -1;
    const a = sim(K, i, d, 'author'), c = sim(K, i, d, 'close'), w = sim(K, i, d, 'wick');
    const okP = Math.abs(a.pnl - pl) <= Math.max(3, Math.abs(pl) * 0.02), okL = a.label === res; if (okP) match++; if (okL) lab++;
    rows.push({ sym, no, side, ts, res, pl, a, c, w, okP, okL });
  }
}
const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(0);
for (const r of rows) console.log(r.sym.replace('USDT', '').padEnd(5), String(r.no).padStart(2), r.side, r.ts, r.res.padEnd(13), 'tablo', f(r.pl).padStart(5), '| yeniden', f(r.a.pnl).padStart(5), r.a.label.padEnd(13), r.okP ? 'OK' : '≠ ', '| kapanış', f(r.c.pnl).padStart(5), r.c.label.padEnd(13), '| fitil', f(r.w.pnl).padStart(5), r.w.label);
const sum = (k, g = (x) => x.pnl) => rows.reduce((s, r) => s + g(r[k]), 0);
const stat = (k) => { const p = rows.map((r) => r[k]); const R = p.map((x) => x.r); const pos = p.filter((x) => x.pnl > 0); const gp = pos.reduce((s, x) => s + x.pnl, 0), gl = -p.filter((x) => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0); return `toplam ${f(sum(k))} $ · ort ${(R.reduce((s, x) => s + x, 0) / R.length).toFixed(3)}R · kazanan ${pos.length}/${p.length} · PF ${(gp / gl).toFixed(2)}`; };
console.log('\nn', rows.length, '· K/Z eşleşen', match, '· etiket eşleşen', lab);
console.log('tablo toplamı      ', f(rows.reduce((s, r) => s + r.pl, 0)), '$');
console.log('yazarın muhasebesi ', stat('a')); console.log('kapanıştan çıkış   ', stat('c')); console.log('borsada stop emri  ', stat('w'));
for (const side of ['L', 'S']) { const rr = rows.filter((r) => r.side === side); console.log(side, 'n', rr.length, 'tablo', f(rr.reduce((s, r) => s + r.pl, 0)), 'kapanış', f(rr.reduce((s, r) => s + r.c.pnl, 0)), 'fitil', f(rr.reduce((s, r) => s + r.w.pnl, 0))); }
