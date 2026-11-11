// Gerçek işlemleri (Bybit CSV) Binance USDT-M 5m mumlarıyla yeniden oynatır: gerçek vs plan (girişteki TP/SL) vs
// çıkış varyantları (1,5R kuralı, ara TP, iz süren stop). Mumlar data.binance.vision günlük arşivinden (ortam izni gerekir).
//   node tools/trades/replay.mjs <Bybit-ClosedPNL.csv> <Bybit-OrderHistory.csv>
// İşlem CSV'leri kişisel veridir: repoya konmaz (repo herkese açık).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [CLOSED, ORDERS] = process.argv.slice(2);
const KL = process.env.KL_DIR || path.join(process.env.TMPDIR || '/tmp', 'binance-klines'); // mum önbelleği (repo dışı)
fs.mkdirSync(KL, { recursive: true });
const split = (l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
const pt = (s) => { const [hm, d] = s.trim().split(' '); return Date.parse(`${d}T${hm}:00Z`); };
const FEE = 0.00055, DAY = 86400e3, LAST_DAY = Math.floor(Date.now() / DAY) * DAY - DAY; // dünün günlük arşivi en son

// --- pozisyonlar ---
const rows = fs.readFileSync(CLOSED, 'utf8').trim().split('\n').slice(1).map((l) => { const c = split(l); return { m: c[0], q: +c[1], e: +c[2], x: +c[3], fee: +c[4] + +c[5], fund: +c[6], type: c[9], pnl: +c[10], t: pt(c[11]) }; });
for (const r of rows) { const g = r.pnl + r.fee + r.fund; r.dir = Math.abs(r.x - r.e) * r.q < 0.005 ? 0 : (Math.sign(g) === Math.sign(r.x - r.e) ? 1 : -1); }
const pos = [];
for (const r of [...rows].sort((a, b) => a.t - b.t)) {
  const p = pos.find((p) => p.m === r.m && Math.abs(p.e - r.e) / r.e < 1e-6 && r.t - p.last < 48 * 3600e3);
  if (p) { p.last = r.t; p.pnl += r.pnl; p.q += r.q; if (r.type === 'Liquidation') p.liq = true; if (!p.dir) p.dir = r.dir; }
  else pos.push({ m: r.m, e: r.e, first: r.t, last: r.t, q: r.q, pnl: r.pnl, liq: r.type === 'Liquidation', dir: r.dir });
}
const ord = fs.readFileSync(ORDERS, 'utf8').trim().split('\n').slice(1).map((l) => { const c = split(l); return { m: c[0], q: +c[1], fill: +c[3], trig: +c[4] || null, side: c[7], type: c[8], status: c[9], ct: pt(c[13] || c[11]) }; });
for (const p of pos) {
  if (!p.dir) continue;
  const openSide = p.dir > 0 ? 'Long' : 'Short', closeSide = p.dir > 0 ? 'Short' : 'Long';
  const en = ord.filter((o) => o.m === p.m && o.side === openSide && o.status === 'Filled' && !o.trig && Math.abs(o.fill - p.e) / p.e < 0.002 && o.ct <= p.first).sort((a, b) => b.ct - a.ct)[0];
  p.t0 = en?.ct ?? null; if (!p.t0) continue;
  const after = ord.filter((o) => o.m === p.m && o.trig && o.side === closeSide && o.ct >= p.t0 - 60e3 && o.ct <= p.last + 6 * 3600e3).sort((a, b) => a.ct - b.ct);
  const loss = (o) => (p.dir > 0 ? o.trig < p.e * 0.9995 : o.trig > p.e * 1.0005);
  p.sl = after.find(loss)?.trig ?? null;
  if (p.m === 'PENDLEUSDT') p.sl = 1.6505; // DURUM: plan stopu (Bybit'teki SL yalnız küçük parça içindi)
  const t1 = p.sl ? after.find(loss).ct : p.t0;
  // plan TP'leri: ilk SL ile aynı anda (±3 dk) konan kâr tarafı tetikler, adetleriyle
  p.tps = after.filter((o) => !loss(o) && Math.abs(o.ct - t1) <= 3 * 60e3 && (p.dir > 0 ? o.trig > p.e : o.trig < p.e)).map((o) => ({ px: o.trig, q: o.q }));
}

// --- mumlar (Binance arşivi, günlük zip) ---
const sym = (m) => m; // Bybit ve Binance adları çoğunlukla aynı (1000PEPEUSDT, 1000BONKUSDT)
function day(m, t) {
  const d = new Date(t).toISOString().slice(0, 10), f = path.join(KL, `${m}-${d}.csv`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  if (fs.existsSync(f + '.none')) return null;
  const z = path.join(KL, `${m}-${d}.zip`);
  try {
    execFileSync('curl', ['-sS', '-f', '-m', '30', '-o', z, `https://data.binance.vision/data/futures/um/daily/klines/${sym(m)}/5m/${sym(m)}-5m-${d}.zip`]);
    const csv = execFileSync('unzip', ['-p', z]).toString(); fs.writeFileSync(f, csv); fs.unlinkSync(z); return csv;
  } catch { fs.writeFileSync(f + '.none', ''); return null; }
}
function candles(m, from, to) {
  const out = [];
  for (let t = Math.floor(from / DAY) * DAY; t <= Math.min(to, LAST_DAY); t += DAY) {
    const csv = day(m, t); if (!csv) continue;
    for (const l of csv.trim().split('\n')) { const c = l.split(','); const ot = +c[0]; if (!Number.isFinite(ot)) continue; if (ot >= from && ot <= to) out.push({ t: ot, h: +c[2], l: +c[3], c: +c[4] }); }
  }
  return out.sort((a, b) => a.t - b.t);
}

// saat dilimi: giriş fiyatının giriş mumunda bulunduğu kaymayı seç (0 / −1 / −2 / −3 saat)
const offs = [0, -1, -2, -3].map((h) => h * 3600e3);
const probe = pos.filter((p) => p.t0 && p.sl).slice(-12);
const score = offs.map((o) => probe.filter((p) => { const cs = candles(p.m, p.t0 + o - 5 * 60e3, p.t0 + o + 5 * 60e3); return cs.some((c) => c.l <= p.e && p.e <= c.h); }).length);
const OFF = offs[score.indexOf(Math.max(...score))];
console.log('saat kayması (saat):', OFF / 3600e3, 'eşleşme', score.join('/'), 'of', probe.length);

// --- simülasyon: legs = [{px, frac}], be = TP1 sonrası stop girişe ---
function sim(p, cs, legs, be) {
  const risk = Math.abs(p.e - p.sl), d = p.dir; let stop = p.sl, left = 1, R = 0, hit = 0;
  for (const c of cs) {
    const adverse = d > 0 ? c.l <= stop : c.h >= stop;
    if (adverse) { R += left * ((stop - p.e) * d) / risk; left = 0; break; } // kötümser: aynı mumda önce stop
    for (const lg of legs) if (!lg.done && (d > 0 ? c.h >= lg.px : c.l <= lg.px)) { lg.done = true; R += lg.frac * ((lg.px - p.e) * d) / risk; left -= lg.frac; hit++; if (be && hit === 1) stop = p.e; }
    if (left <= 1e-9) break;
  }
  if (left > 1e-9 && cs.length) R += left * ((cs[cs.length - 1].c - p.e) * d) / risk; // süre doldu: son kapanış
  return R - (2 * FEE * p.e) / risk; // giriş + çıkış ücreti (R cinsinden)
}

// --- çıkış varyantları: legs (R, pay), after: TP1 sonrası stop (R cinsinden; 0 = başa baş, null = yerinde), trail: TP1 sonrası en iyi fiyatın kaç R gerisinden izle
function simV(p, cs, v) {
  const risk = Math.abs(p.e - p.sl), d = p.dir, px = (r) => p.e + r * risk * d;
  let stop = p.sl, left = 1, R = 0, hit = 0, best = p.e;
  const legs = v.legs.map(([r, frac]) => ({ px: px(r), frac }));
  for (const c of cs) {
    if (d > 0 ? c.l <= stop : c.h >= stop) { R += left * ((stop - p.e) * d) / risk; left = 0; break; }
    for (const lg of legs) if (!lg.done && (d > 0 ? c.h >= lg.px : c.l <= lg.px)) { lg.done = true; R += lg.frac * ((lg.px - p.e) * d) / risk; left -= lg.frac; hit++; if (hit === 1 && v.after != null) stop = px(v.after); }
    if (left <= 1e-9) break;
    best = d > 0 ? Math.max(best, c.h) : Math.min(best, c.l);
    if (v.trail && hit >= 1) { const t = best - v.trail * risk * d; if ((t - stop) * d > 0) stop = t; }
  }
  if (left > 1e-9 && cs.length) R += left * ((cs[cs.length - 1].c - p.e) * d) / risk;
  return R - (2 * FEE * p.e) / risk;
}
const V = {
  'A şimdiki: 1,5R %50 → BE → 3R': { legs: [[1.5, 0.5], [3, 0.5]], after: 0 },
  'B ara hedef: 1,5R %50, 2,25R %25, 3R %25, BE': { legs: [[1.5, 0.5], [2.25, 0.25], [3, 0.25]], after: 0 },
  'C ara hedef: 1,5R %50, 2R %25, 3R %25, BE': { legs: [[1.5, 0.5], [2, 0.25], [3, 0.25]], after: 0 },
  'D 1,5R %50 → stop −0,5R (gevşek BE) → 3R': { legs: [[1.5, 0.5], [3, 0.5]], after: -0.5 },
  'E 1,5R %50 → stop yerinde → 3R': { legs: [[1.5, 0.5], [3, 0.5]], after: null },
  'F 1,5R %50 → iz süren stop 1R → 5R': { legs: [[1.5, 0.5], [5, 0.5]], after: 0, trail: 1 },
  'G 1,5R %50 → iz süren stop 1,5R → 5R': { legs: [[1.5, 0.5], [5, 0.5]], after: 0, trail: 1.5 },
  'H 1,5R %70 → BE → 3R %30': { legs: [[1.5, 0.7], [3, 0.3]], after: 0 },
  'I tek hedef 2R (BE yok)': { legs: [[2, 1]], after: null },
  'J 1R %50 → BE → 2R': { legs: [[1, 0.5], [2, 0.5]], after: 0 },
};
const vres = {}; for (const k of Object.keys(V)) vres[k] = [];
let beStops = 0, tp1n = 0;
for (const p of pos) {
  if (!p.dir || !p.sl || !p.t0) continue;
  const cs = candles(p.m, p.t0 + OFF + 5 * 60e3, p.t0 + OFF + 7 * DAY); if (cs.length < 12) continue;
  for (const [k, v] of Object.entries(V)) vres[k].push(simV(p, cs, v));
}
console.log('\n=== çıkış varyantları (aynı girişler) ===');
for (const [k, a] of Object.entries(vres)) { const m = a.reduce((s, x) => s + x, 0) / a.length; console.log(k.padEnd(48), 'n' + a.length, 'ort', (m >= 0 ? '+' : '') + m.toFixed(3) + 'R', 'kazanma %' + Math.round(100 * a.filter((x) => x > 0.05).length / a.length)); }
// TP1 sonrası ne oldu: TP1 gelen işlemlerde 3R'ye mi gitti, BE'de mi kapandı, ara (2R) gördü mü
const stat = { tp1: 0, be: 0, r2: 0, r3: 0 };
for (const p of pos) {
  if (!p.dir || !p.sl || !p.t0) continue;
  const cs = candles(p.m, p.t0 + OFF + 5 * 60e3, p.t0 + OFF + 7 * DAY); if (cs.length < 12) continue;
  const risk = Math.abs(p.e - p.sl), d = p.dir, px = (r) => p.e + r * risk * d; let stage = 0, mx = 0;
  for (const c of cs) {
    if (stage === 0) { if (d > 0 ? c.l <= p.sl : c.h >= p.sl) break; if (d > 0 ? c.h >= px(1.5) : c.l <= px(1.5)) { stage = 1; stat.tp1++; } continue; }
    const fav = ((d > 0 ? c.h : c.l) - p.e) * d / risk; mx = Math.max(mx, fav);
    if (d > 0 ? c.l <= p.e : c.h >= p.e) { stat.be++; break; }
    if (mx >= 3) break;
  }
  if (stage === 1) { if (mx >= 2) stat.r2++; if (mx >= 3) stat.r3++; }
}
console.log('TP1 (1,5R) gelen', stat.tp1, '| sonra başa başa dönen', stat.be, '| 2R gören', stat.r2, '| 3R gören', stat.r3);
const res = [];
for (const p of pos) {
  if (!p.dir || !p.sl || !p.t0) continue;
  const t0 = p.t0 + OFF, cs = candles(p.m, t0 + 5 * 60e3, t0 + 7 * DAY);
  if (cs.length < 12) { res.push({ p, skip: 'mum yok' }); continue; }
  const risk = Math.abs(p.e - p.sl), real = p.pnl / (risk * p.q);
  const totQ = p.tps.reduce((s, x) => s + x.q, 0);
  const planLegs = p.tps.length ? p.tps.sort((a, b) => (a.px - b.px) * p.dir).map((x) => ({ px: x.px, frac: x.q / Math.max(totQ, p.q) })) : null;
  if (planLegs) { const s = planLegs.reduce((a, b) => a + b.frac, 0); if (s < 1) planLegs[planLegs.length - 1].frac += 1 - s; }
  const plan = planLegs ? sim(p, cs, planLegs.map((x) => ({ ...x })), false) : null;
  const r15 = sim(p, cs, [{ px: p.e + 1.5 * risk * p.dir, frac: 0.5 }, { px: p.e + 3 * risk * p.dir, frac: 0.5 }], true);
  res.push({ p, real, plan, r15, tpR: planLegs ? planLegs.map((x) => ((x.px - p.e) * p.dir / risk).toFixed(1)).join('/') : '-' });
}
const f = (x) => (x == null ? '   -  ' : (x >= 0 ? '+' : '') + x.toFixed(2));
for (const r of res) console.log(new Date(r.p.first).toISOString().slice(5, 10), r.p.m.replace('USDT', '').padEnd(9), r.p.dir > 0 ? 'L' : 'S', r.skip ? r.skip : `gerçek ${f(r.real)} | plan ${f(r.plan)} (TP ${r.tpR}R) | 1,5R kuralı ${f(r.r15)}${r.p.liq ? ' | TASFİYE' : ''}`);
const ok = res.filter((r) => !r.skip), both = ok.filter((r) => r.plan != null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, win = (a) => Math.round((100 * a.filter((x) => x > 0).length) / a.length);
const line = (name, a) => console.log(`${name.padEnd(30)} n${a.length}  ort ${f(mean(a))}R  toplam ${f(a.reduce((s, x) => s + x, 0))}R  kazanma %${win(a)}`);
console.log('\n--- karşılaştırma ---');
line('gerçek (hepsi)', ok.map((r) => r.real));
line('1,5R kuralı (hepsi)', ok.map((r) => r.r15));
line('gerçek (plan TP\'si olanlar)', both.map((r) => r.real));
line('plana dokunmasaydın', both.map((r) => r.plan));
line('1,5R kuralı (aynı işlemler)', both.map((r) => r.r15));
console.log('atlanan:', res.filter((r) => r.skip).map((r) => r.p.m.replace('USDT', '')).join(', ') || '-');
