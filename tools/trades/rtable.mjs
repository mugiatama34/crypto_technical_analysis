// Gerçek işlemler R tablosu: Bybit Closed P&L + Order History (TP/SL) CSV → pozisyonlar, ilk SL (plan stopu), R,
// kırılımlar (giriş tipi, saat, hafta sonu, BTC günlük yönü history.json'dan, tutma süresi, kapanış türü).
//   node tools/trades/rtable.mjs <Bybit-ClosedPNL.csv> <Bybit-OrderHistory.csv>
import fs from 'node:fs';
const split = (l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
const pt = (s) => { const [hm, d] = s.trim().split(' '); return Date.parse(`${d}T${hm}:00Z`); };
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => { const c = split(l); return { m: c[0], q: +c[1], e: +c[2], x: +c[3], fee: +c[4] + +c[5], fund: +c[6], type: c[9], pnl: +c[10], t: pt(c[11]) }; });
for (const r of rows) { const g = r.pnl + r.fee + r.fund; r.dir = Math.abs(r.x - r.e) * r.q < 0.005 ? 0 : (Math.sign(g) === Math.sign(r.x - r.e) ? 1 : -1); }
const pos = [];
for (const r of [...rows].sort((a, b) => a.t - b.t)) {
  const p = pos.find((p) => p.m === r.m && Math.abs(p.e - r.e) / r.e < 1e-6 && r.t - p.last < 48 * 3600e3);
  if (p) { p.legs.push(r); p.last = r.t; p.pnl += r.pnl; p.q += r.q; if (r.type === 'Liquidation') p.liq = true; if (!p.dir) p.dir = r.dir; }
  else pos.push({ m: r.m, e: r.e, first: r.t, last: r.t, legs: [r], q: r.q, pnl: r.pnl, liq: r.type === 'Liquidation', dir: r.dir });
}
const ord = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').slice(1).map((l) => { const c = split(l); return { m: c[0], q: +c[1], fill: +c[3], trig: +c[4] || null, side: c[7], status: c[9], ct: pt(c[13] || c[11]) }; });
const out = [];
for (const p of pos) {
  if (!p.dir) { out.push({ p, stop: null }); continue; }
  const closeSide = p.dir > 0 ? 'Short' : 'Long';
  // pozisyonun kendi giriş emri: aynı yön, dolmuş, ort. dolum ≈ giriş (ilk kapanıştan önceki son eşleşen)
  const openSide = p.dir > 0 ? 'Long' : 'Short';
  const entries = ord.filter((o) => o.m === p.m && o.side === openSide && o.status === 'Filled' && Math.abs(o.fill - p.e) / p.e < 0.002 && o.ct <= p.first).sort((a, b) => b.ct - a.ct);
  const tOpen = entries[0]?.ct ?? p.first - 4 * 86400e3;
  p.tOpen = entries[0]?.ct ?? null;
  const cand = ord.filter((o) => o.m === p.m && o.trig && o.side === closeSide && o.ct <= p.last + 6 * 3600e3 && o.ct >= tOpen - 60e3
    && (p.dir > 0 ? o.trig < p.e * (1 - 0.0005) : o.trig > p.e * (1 + 0.0005))).sort((a, b) => a.ct - b.ct);
  out.push({ p, stop: cand[0]?.trig ?? null });
}
const f = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const rs = [];
for (const { p, stop } of out) {
  const risk = stop ? Math.abs(p.e - stop) * p.q : null, R = risk ? p.pnl / risk : null, sp = stop ? (Math.abs(p.e - stop) / p.e) * 100 : null;
  Object.assign(p, { R, sp, risk, stop }); if (R != null) rs.push(p);
  console.log(new Date(p.first).toISOString().slice(5, 10), p.m.replace('USDT', ''), p.dir > 0 ? 'L' : 'S', 'giriş', p.e, 'stop', stop ?? '-', sp ? `(%${sp.toFixed(2)})` : '', 'risk$', risk ? risk.toFixed(2) : '-', 'P&L', f(p.pnl), 'R', R != null ? f(R) : '-', p.liq ? 'TASFIYE' : '');
}
const sum = (a, k) => a.reduce((s, p) => s + p[k], 0), med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (g) => (g.length ? f(sum(g, 'R') / g.length) : '-');
console.log(`\nstoplu ${rs.length}/${pos.length} | ort R ${avg(rs)} | toplam R ${f(sum(rs, 'R'), 1)} | kazanma %${(100 * rs.filter((p) => p.R > 0).length / rs.length).toFixed(0)} | medyan risk $${med(rs.map((p) => p.risk)).toFixed(2)} | medyan stop %${med(rs.map((p) => p.sp)).toFixed(2)}`);
const nl = rs.filter((p) => !p.liq);
console.log(`tasfiyesiz ort R ${avg(nl)} (n ${nl.length}) | tasfiyeler: ${rs.filter((p) => p.liq).map((p) => `${p.m.replace('USDT', '')} ${f(p.R)}`).join(', ')}`);
for (const [k, g] of [['long', rs.filter((p) => p.dir > 0)], ['short', rs.filter((p) => p.dir < 0)]]) console.log(k, g.length, 'ort R', avg(g));
console.log('-1,3R altı:', rs.filter((p) => p.R < -1.3).map((p) => `${p.m.replace('USDT', '')} ${f(p.R)}${p.liq ? ' (tasfiye)' : ''}`).join(', '));
for (const [k, g] of [['stop <%1', rs.filter((p) => p.sp < 1)], ['stop %1-3', rs.filter((p) => p.sp >= 1 && p.sp < 3)], ['stop >=%3', rs.filter((p) => p.sp >= 3)]]) console.log(k, g.length, 'ort R', avg(g), 'kazanma %', g.length ? (100 * g.filter((p) => p.R > 0).length / g.length).toFixed(0) : '-');
console.log('stopsuz:', out.filter((o) => !o.stop).map((o) => `${o.p.m.replace('USDT', '')} ${f(o.p.pnl)}${o.p.liq ? ' TASFIYE' : ''}`).join(', '));
const trim = rs.filter((p) => Math.abs(p.R) <= 3);
console.log('\n|R|<=3:', trim.length, 'ort R', avg(trim), 'toplam R', f(sum(trim, 'R'), 1), '| long', avg(trim.filter((p) => p.dir > 0)), 'short', avg(trim.filter((p) => p.dir < 0)));
const cut = Date.parse('2026-10-24T00:00:00Z');
console.log('24.10 sonrası (|R|<=3):', avg(trim.filter((p) => p.first >= cut)), 'n', trim.filter((p) => p.first >= cut).length, '| öncesi', avg(trim.filter((p) => p.first < cut)), 'n', trim.filter((p) => p.first < cut).length);
const fixed = sum(rs, 'R'), fixedT = sum(trim, 'R');
console.log('sabit 2$ risk ile: tümü', f(fixed * 2), '$ | |R|<=3', f(fixedT * 2), '$ | gerçek', f(sum(pos, 'pnl')), '$');
const bigRisk = rs.filter((p) => p.risk > 10); console.log('risk>10$:', bigRisk.length, 'toplam $', f(sum(bigRisk, 'pnl')), bigRisk.map((p) => `${p.m.replace('USDT', '')} risk ${p.risk.toFixed(0)}$ ${f(p.pnl)}`).join(', '));
// --- 2. aşama: özellik kırılımları ---
const P = rs.map((p) => p.m === 'PENDLEUSDT' ? Object.assign(p, { R: p.pnl / (Math.abs(p.e - 1.6505) * p.q) }) : p);
// giriş emri tipi (Limit/Market) ve açılış saati
const ordFull = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').slice(1).map((l) => { const c = split(l); return { m: c[0], fill: +c[3], trig: +c[4] || null, side: c[7], type: c[8], status: c[9], ct: pt(c[13] || c[11]) }; });
const H = JSON.parse(fs.readFileSync(new URL('../../docs/signals/history.json', import.meta.url), 'utf8')); const items = (H.items || H).filter((s) => s.btcRead).sort((a, b) => a.sentAt - b.sentAt);
for (const p of P) {
  const openSide = p.dir > 0 ? 'Long' : 'Short';
  const e = ordFull.filter((o) => o.m === p.m && o.side === openSide && o.status === 'Filled' && !o.trig && Math.abs(o.fill - p.e) / p.e < 0.002 && o.ct <= p.first).sort((a, b) => b.ct - a.ct)[0];
  p.etype = e?.type || '?'; p.t0 = e?.ct ?? null;
  p.hold = p.t0 ? (p.last - p.t0) / 3600e3 : null;
  const t = p.t0 ?? p.first; const s = [...items].reverse().find((s) => s.sentAt <= t + 2 * 3600e3);
  p.btc = s && Math.abs(s.sentAt - t) < 24 * 3600e3 ? s.btcRead.daily : null;
  const d = new Date(t); p.wk = [0, 6].includes(d.getUTCDay()); p.hr = d.getUTCHours();
}
const W = P.filter((p) => p.R > 0), L = P.filter((p) => p.R <= 0);
console.log('\n=== kırılımlar (n', P.length, ') ===');
console.log('ort kazanan R', avg(W), '(n', W.length, ') | ort kaybeden R', avg(L), '(n', L.length, ') | başabaş için gereken kazanma %', (100 * -sum(L,'R')/L.length / (sum(W,'R')/W.length - sum(L,'R')/L.length)).toFixed(0));
const grp = (name, fn) => { const g = {}; for (const p of P) { const k = fn(p); (g[k] ||= []).push(p); } console.log(name + ':', Object.entries(g).map(([k, a]) => `${k} n${a.length} ${avg(a)}R %${(100 * a.filter((p) => p.R > 0).length / a.length).toFixed(0)}`).join(' | ')); };
grp('giriş emri', (p) => p.etype);
grp('hafta', (p) => (p.wk ? 'hafta sonu' : 'hafta içi'));
grp('saat (UTC+2?)', (p) => (p.hr < 6 ? '00-06' : p.hr < 12 ? '06-12' : p.hr < 18 ? '12-18' : '18-24'));
grp('BTC günlük', (p) => !p.btc ? 'veri yok' : p.btc === 'flat' ? 'yatay' : (p.btc === 'up') === (p.dir > 0) ? 'BTC ile aynı yön' : 'BTC tersine');
grp('tutma', (p) => p.hold == null ? '?' : p.hold < 1 ? '<1s' : p.hold < 6 ? '1-6s' : p.hold < 24 ? '6-24s' : '>24s');
grp('kapanış', (p) => p.liq ? 'tasfiye' : p.R <= -0.9 ? 'stop' : p.R < 0 ? 'erken zararla' : p.R < 0.5 ? 'erken küçük kârla' : 'hedef/iyi kâr');
