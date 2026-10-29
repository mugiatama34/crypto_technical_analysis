// SMC kontrol listesi için seviye hesabı (smc-analiz skill'i). Veri: docs/pratik/extra/<COIN>.json ya da
// docs/pratik/candles.json (BTC/ETH); pratik.yml (extra=COIN) ile güncellenir. Saatler UTC.
// Kullanım: node bot/practice/smc_levels.mjs AVAX [--json]
import fs from 'node:fs';
import * as I from '../../src/data/indicators.js';
import { zigzag, fillAtr } from '../../src/core/zigzag.js';
import { equalLevels } from '../../src/detectors/liquidity.js';

const DAY = 864e5;
export const toCandles = (rows) => rows.map((a) => ({ time: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: a[5] ?? 0 }));

/** Ham veri: { generatedAt, tfs: { '1D': [...], '4H': [...], '1H': [...], '15m': [...] } } */
export function loadCoin(coin, root = '.') {
  const ex = `${root}/docs/pratik/extra/${coin}.json`;
  if (fs.existsSync(ex)) { const d = JSON.parse(fs.readFileSync(ex)); return { generatedAt: d.generatedAt, tfs: d.tfs }; }
  const d = JSON.parse(fs.readFileSync(`${root}/docs/pratik/candles.json`));
  if (!d.coins[coin]) throw new Error(`${coin} verisi yok: pratik.yml'i extra=${coin} ile çalıştır`);
  return { generatedAt: d.generatedAt, tfs: d.coins[coin].tfs || d.coins[coin] };
}

const atrOf = (cs) => fillAtr(I.atr(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), 14));
export const swings = (cs, k) => zigzag(cs, atrOf(cs), k).pivots;

/** Son iki tepe/dip → HH/LH, HL/LL; yön ve yapıyı bozan seviye. */
export function structure(piv) {
  const hs = piv.filter((p) => p.type === 'H').slice(-2), ls = piv.filter((p) => p.type === 'L').slice(-2);
  if (hs.length < 2 || ls.length < 2) return null;
  const hi = hs[1].price > hs[0].price ? 'HH' : 'LH', lo = ls[1].price > ls[0].price ? 'HL' : 'LL';
  const dir = hi === 'HH' && lo === 'HL' ? 'up' : hi === 'LH' && lo === 'LL' ? 'down' : 'mixed';
  return { dir, label: `${hi}/${lo}`, lastHigh: hs[1], lastLow: ls[1], breakUp: hs[1].price, breakDown: ls[1].price };
}

/** Kapanışla son kırılım (BOS): bir pivotun ötesinde ilk kapanış; en yenisi. */
export function lastBos(cs, piv) {
  let best = null;
  for (const p of piv) {
    for (let j = (p.at ?? p.i) + 1; j < cs.length; j++) {
      const c = cs[j];
      if (p.type === 'H' && c.close > p.price) { if (!best || j > best.i) best = { dir: 'up', level: p.price, i: j, time: c.time, pivot: p }; break; }
      if (p.type === 'L' && c.close < p.price) { if (!best || j > best.i) best = { dir: 'down', level: p.price, i: j, time: c.time, pivot: p }; break; }
    }
  }
  return best;
}

/** Kırılımdan önceki son ters renkli mum (OB): BOS ↓ → kırılan bacağın tepesine kadarki son yükselen mum. */
export function orderBlock(cs, piv, bos) {
  if (!bos) return null;
  const want = bos.dir === 'down' ? 'H' : 'L';
  const origin = [...piv].reverse().find((p) => p.type === want && p.i < bos.i);
  if (!origin) return null;
  for (let j = origin.i; j >= Math.max(0, origin.i - 6); j--) {
    const c = cs[j], up = c.close > c.open;
    if (bos.dir === 'down' ? up : !up) return { lo: c.low, hi: c.high, time: c.time, dir: bos.dir === 'down' ? 'bear' : 'bull' };
  }
  const c = cs[origin.i];
  return { lo: c.low, hi: c.high, time: c.time, dir: bos.dir === 'down' ? 'bear' : 'bull' };
}

/** Son `look` mumdaki FVG'ler ve durumları (açık/kısmi/dolu). */
export function fvgs(cs, look = 80) {
  const out = [];
  for (let j = Math.max(2, cs.length - look); j < cs.length; j++) {
    const a = cs[j - 2], b = cs[j];
    let z = null;
    if (b.low > a.high) z = { dir: 'bull', lo: a.high, hi: b.low };
    if (b.high < a.low) z = { dir: 'bear', lo: b.high, hi: a.low };
    if (!z) continue;
    let st = 'açık';
    for (let m = j + 1; m < cs.length; m++) {
      const c = cs[m];
      if (z.dir === 'bull' ? c.low <= z.lo : c.high >= z.hi) { st = 'dolu'; break; }
      if (z.dir === 'bull' ? c.low < z.hi : c.high > z.lo) st = 'kısmi';
    }
    out.push({ ...z, time: cs[j - 1].time, status: st });
  }
  return out.filter((z) => z.status !== 'dolu');
}

const range = (cs, from, to) => { const s = cs.filter((c) => c.time >= from && c.time < to); return s.length ? { hi: Math.max(...s.map((c) => c.high)), lo: Math.min(...s.map((c) => c.low)) } : null; };
const mondayOf = (t) => { const d = Math.floor(t / DAY) * DAY; const wd = (new Date(d).getUTCDay() + 6) % 7; return d - wd * DAY; };

/** 1H likidite: PDH/PDL, PWH/PWL, bugünün Asya (00–07 UTC) ve bugün; alındı mı? EQH/EQL (alınmamış). */
export function liquidity(h1, now) {
  const today = Math.floor(now / DAY) * DAY, wk = mondayOf(now);
  const pd = range(h1, today - DAY, today), pw = range(h1, wk - 7 * DAY, wk), asia = range(h1, today, today + 7 * 36e5);
  const td = range(h1, today, now + 1), tw = range(h1, wk, now + 1);
  const lv = [];
  if (pd) lv.push({ name: 'PDH', type: 'H', level: pd.hi, taken: td && td.hi > pd.hi }, { name: 'PDL', type: 'L', level: pd.lo, taken: td && td.lo < pd.lo });
  if (pw) lv.push({ name: 'PWH', type: 'H', level: pw.hi, taken: tw && tw.hi > pw.hi }, { name: 'PWL', type: 'L', level: pw.lo, taken: tw && tw.lo < pw.lo });
  if (asia && now >= today + 36e5) { const after = range(h1, today + 7 * 36e5, now + 1); lv.push({ name: 'Asya tepe', type: 'H', level: asia.hi, taken: after && after.hi > asia.hi }, { name: 'Asya dip', type: 'L', level: asia.lo, taken: after && after.lo < asia.lo }); }
  const piv = swings(h1, 1), atr = atrOf(h1);
  for (const e of equalLevels(piv.filter((p) => h1.length - 1 - p.i <= 150), atr, 0.15)) {
    let taken = false;
    for (let j = e.to + 1; j < h1.length && !taken; j++) taken = e.type === 'H' ? h1[j].high > e.level : h1[j].low < e.level;
    if (!taken) lv.push({ name: e.type === 'H' ? 'EQH' : 'EQL', type: e.type, level: e.level, taken: false, touches: e.touches.length });
  }
  return lv;
}

export function analyze(coin, root = '.') {
  const raw = loadCoin(coin, root);
  const D = toCandles(raw.tfs['1D']), H4 = toCandles(raw.tfs['4H']), H1 = toCandles(raw.tfs['1H']);
  // Bugünün (henüz kapanmamış) günlük mumu 1H'den
  const t0 = D[D.length - 1].time + DAY, todayH = H1.filter((c) => c.time >= t0);
  if (todayH.length) D.push({ time: t0, open: todayH[0].open, high: Math.max(...todayH.map((c) => c.high)), low: Math.min(...todayH.map((c) => c.low)), close: todayH[todayH.length - 1].close, volume: 0, live: true });
  const price = H1[H1.length - 1].close, now = H1[H1.length - 1].time + 36e5 - 1;
  const pD = swings(D, 1), p4 = swings(H4, 2); // 1G k=1: elle çizdiğimiz günlük salınımlarla örtüşüyor (k=2 aylık salınımlara kaçar)
  const sD = structure(pD), s4 = structure(p4);
  // dealing range: son günlük tepe ve dip; henüz onaylanmamış güncel bacağın ucu da dahil (ör. tepe sonrası yeni dip)
  const after = (i, key, fn) => D.slice(i + 1).reduce((m, c) => fn(m, c[key]), key === 'low' ? Infinity : -Infinity);
  const rHi = Math.max(sD.lastHigh.price, after(sD.lastLow.i, 'high', Math.max)), rLo = Math.min(sD.lastLow.price, after(sD.lastHigh.i, 'low', Math.min));
  const pos = (price - rLo) / (rHi - rLo);
  const bos4 = lastBos(H4, p4);
  const atr4 = atrOf(H4).at(-1);
  const z4 = fvgs(H4).filter((z) => Math.abs((z.lo + z.hi) / 2 - price) <= 8 * atr4);
  const tOf = (cs, p) => p && cs[p.i]?.time;
  if (sD) { sD.lastHigh.time = tOf(D, sD.lastHigh); sD.lastLow.time = tOf(D, sD.lastLow); }
  if (s4) { s4.lastHigh.time = tOf(H4, s4.lastHigh); s4.lastLow.time = tOf(H4, s4.lastLow); }
  return {
    coin, generatedAt: raw.generatedAt, price,
    daily: { ...sD, range: { hi: rHi, lo: rLo, eq: (rHi + rLo) / 2, pos } },
    h4: { ...s4, bos: bos4, ob: orderBlock(H4, p4, bos4), fvg: z4, atr: atr4 },
    liq: liquidity(H1, now),
  };
}

const f = (x) => (x == null ? '–' : Number(x).toPrecision(6).replace(/\.?0+$/, ''));
const dt = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');
export function format(a, btc) {
  const L = [];
  L.push(`# ${a.coin} · fiyat ${f(a.price)} · veri ${new Date(a.generatedAt).toISOString().slice(0, 16)} UTC`);
  const d = a.daily;
  L.push(`1G: ${d.label} (${d.dir}) · son tepe ${f(d.lastHigh?.price)} (${dt(d.lastHigh?.time).slice(0, 5)}) · son dip ${f(d.lastLow?.price)} (${dt(d.lastLow?.time).slice(0, 5)}) · range ${f(d.range.lo)}–${f(d.range.hi)}, 0,5 = ${f(d.range.eq)}, fiyat dipten %${Math.round(d.range.pos * 100)} (${d.range.pos > 0.5 ? 'premium' : 'discount'}; fib düzeninde ${(1 - d.range.pos).toFixed(2)})`);
  const h = a.h4;
  L.push(`4H: ${h.label} (${h.dir}) · yukarı bozan ${f(h.breakUp)} · aşağı bozan ${f(h.breakDown)} · son BOS ${h.bos ? `${h.bos.dir === 'up' ? '↑' : '↓'} ${f(h.bos.level)} @ ${dt(h.bos.time)}` : '–'} · OB ${h.ob ? `${h.ob.dir} ${f(h.ob.lo)}–${f(h.ob.hi)} (${dt(h.ob.time)})` : '–'}`);
  for (const z of h.fvg) L.push(`  FVG ${z.dir} ${f(z.lo)}–${f(z.hi)} (${dt(z.time)}, ${z.status}) ${(z.lo + z.hi) / 2 > a.price ? 'üstte' : 'altta'}`);
  L.push('1H likidite:');
  for (const l of [...a.liq].sort((x, y) => y.level - x.level)) L.push(`  ${l.name.padEnd(9)} ${f(l.level).padStart(10)}  ${l.taken ? 'ALINDI' : 'bekliyor'}${l.touches ? ` (${l.touches} dokunuş)` : ''}  ${((l.level / a.price - 1) * 100).toFixed(2)}%`);
  if (btc) {
    L.push(`BTC: 1G ${btc.daily.label}, 4H ${btc.h4.label}, günlük range'de dipten %${Math.round(btc.daily.range.pos * 100)} (${btc.daily.range.pos > 0.5 ? 'premium' : 'discount'})`);
    for (const n of ['PWL', 'PDL', 'PWH', 'PDH']) { const x = a.liq.find((l) => l.name === n), y = btc.liq.find((l) => l.name === n); if (x && y && x.taken !== y.taken) L.push(`  SMT? ${n}: ${a.coin} ${x.taken ? 'aldı' : 'almadı'}, BTC ${y.taken ? 'aldı' : 'almadı'}`); }
  }
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const coin = String(process.argv[2] || 'BTC').toUpperCase();
  const a = analyze(coin), btc = coin === 'BTC' ? null : analyze('BTC');
  console.log(process.argv.includes('--json') ? JSON.stringify({ a, btc }, null, 1) : format(a, btc));
}
