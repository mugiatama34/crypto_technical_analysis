// Sahte seviye testi (backtest/levels.js; ön kayıt docs/arastirma/on-kayit-seviye.md): zigzag nedenselliği, seviye fiyatları, ilk dokunuş /
// "zaten geçilmiş", sonuç sınıflaması, S2 adım + sahte seviyeler + 0,25 s yeniden kurma, komşu-ortalaması farkı + ağırlıklı birincil ölçü,
// verdict; sentetik: rastgele yürüyüşte geçmez, inanılan seviyelere yapay sıçrama yerleştirilince geçer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ZigZag, zigzagLegs, atrOf, fibPrice, legLevelTouches, classify, stepOf, s2Series, s1Stat, weightedPrimary, s1Cell, verdictOf, runLevels,
  LEVELS_DEFAULTS, VERDICT, RES, HALF_A_START, HALF_B_START, levelKey,
} from '../backtest/levels.js';
import { mulberry32 } from '../backtest/report.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const bar = (o, h, l, c, t = 0) => ({ time: t, open: o, high: h, low: l, close: c });
const H4 = 4 * 3600e3;
const T0 = Date.UTC(2022, 8, 1), T_END = Date.UTC(2026, 9, 1);
const P = { ...LEVELS_DEFAULTS, reps: 400 };

// ---------- sentetik üreteçler ----------
/** I.atr ile aynı aritmetik (gerçek aralık + Wilder RMA), artımlı. */
class AtrStream {
  constructor(n = 14) { Object.assign(this, { n, k: 0, sum: 0, prev: null, pc: null }); }
  push(b) {
    const tr = this.pc == null ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - this.pc), Math.abs(b.low - this.pc));
    this.pc = b.close; this.k++;
    if (this.k < this.n) { this.sum += tr; return null; }
    if (this.k === this.n) { this.sum += tr; this.prev = this.sum / this.n; return this.prev; }
    this.prev = (this.prev * (this.n - 1) + tr) / this.n; return this.prev;
  }
}

/**
 * 4H rastgele yürüyüş (log getiri ~ N(0, sd)), isteğe bağlı yapay etki: mode 'fib' → nedensel zigzag'ın (aynı ZigZag + aynı ATR)
 * etkin bacaklarında inanılan seviyeye geri çekilen mum seviyede durur ve fiyat bacak yönünde 0,13 × bacak itilir (olasılık prob);
 * mode 'round' → s katlarında aynı (0,13 s).
 */
function genSeries({ seed, start = 5, sd = 0.012, mode = null, prob = 0.85 }) {
  const rnd = mulberry32(seed);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const n = Math.round((T_END - T0) / H4), c = [];
  const atrS = new AtrStream(14), zz = new ZigZag(LEVELS_DEFAULTS);
  const active = []; // { leg, untouched: Set(r), until }
  let p = start, push = null; // push: { target, dir, step }
  for (let i = 0; i < n; i++) {
    const o = p;
    let cl = o * Math.exp(sd * gauss());
    let lo = null, hi = null;
    if (push) {
      cl = o + push.dir * push.step;
      if (push.dir * (cl - push.target) >= 0) push = null;
    } else if (mode === 'fib') {
      for (const a of active) {
        if (i > a.until) continue;
        const d = a.leg.dir;
        for (const r of [...a.untouched]) {
          const L = fibPrice(a.leg, r);
          if (d > 0 ? Math.min(o, cl) * 0.998 > L : Math.max(o, cl) * 1.002 < L) continue;
          a.untouched.delete(r);
          if (rnd() < prob && (d > 0 ? o > L : o < L)) {
            const sz = a.leg.size;
            lo = d > 0 ? L - sz * 0.001 : null; hi = d < 0 ? L + sz * 0.001 : null;
            cl = L + d * 0.02 * sz;
            push = { target: L + d * 0.13 * sz, dir: d, step: 0.04 * sz };
          }
          break;
        }
        if (push) break;
      }
    } else if (mode === 'round') {
      const st = stepOf(o), s = st.s;
      const k = o > cl ? Math.floor(o / s) : Math.ceil(o / s), L = k * s;
      const crosses = o > cl ? Math.min(o, cl) * 0.998 <= L && L < o : Math.max(o, cl) * 1.002 >= L && L > o;
      if (crosses && L > 0 && rnd() < prob) {
        const d = o > L ? 1 : -1;
        lo = d > 0 ? L - s * 0.001 : null; hi = d < 0 ? L + s * 0.001 : null;
        cl = L + d * 0.02 * s;
        push = { target: L + d * 0.13 * s, dir: d, step: 0.04 * s };
      }
    }
    const b = { time: T0 + i * H4, open: o, close: cl, high: hi ?? Math.max(o, cl) * (1 + 0.002 * rnd()), low: lo ?? Math.min(o, cl) * (1 - 0.002 * rnd()) };
    if (hi != null) b.high = Math.max(hi, o, cl); if (lo != null) b.low = Math.min(lo, o, cl);
    c.push(b);
    const leg = zz.push(b, atrS.push(b));
    if (leg?.eligible && mode === 'fib') active.push({ leg, untouched: new Set([...LEVELS_DEFAULTS.believed, ...LEVELS_DEFAULTS.fake].filter((r) => LEVELS_DEFAULTS.believed.includes(r)).sort()), until: leg.doneIdx + LEVELS_DEFAULTS.window });
    for (let q = active.length - 1; q >= 0; q--) { const a = active[q]; if (i > a.until || (a.leg.dir > 0 ? b.high > a.leg.tip : b.low < a.leg.tip)) active.splice(q, 1); }
    p = cl;
  }
  return c;
}
const universe = (n, opt) => Array.from({ length: n }, (_, k) => ({ coin: `C${k}`, candles: genSeries({ seed: 1000 + k * 7 + (opt.seedOff || 0), start: 2 + (k % 7), ...opt }) }));

// ---------- birim testleri ----------
test('AtrStream = I.atr (üreteç bacakları analizle aynı)', () => {
  const c = genSeries({ seed: 3 }).slice(0, 500), a = atrOf(c), s = new AtrStream(14);
  c.forEach((b, i) => { const v = s.push(b); if (a[i] == null) assert.equal(v, null); else close(v, a[i], 1e-12); });
});

test('zigzag nedensel: bacak, tamamlanma mumundan sonraki veriye bakmadan aynı çıkar', () => {
  const c = genSeries({ seed: 11, sd: 0.02 }).slice(0, 3000);
  const legs = zigzagLegs(c);
  assert.ok(legs.length > 50, `bacak ${legs.length}`);
  for (const leg of legs.filter((_, q) => q % 7 === 0)) {
    const pre = zigzagLegs(c.slice(0, leg.doneIdx + 1));
    assert.deepEqual(pre.at(-1), leg);
    const pre2 = zigzagLegs(c.slice(0, leg.doneIdx));
    assert.ok(!pre2.some((x) => x.doneIdx === leg.doneIdx), 'tamamlanma mumundan önce bacak yok');
    assert.ok(leg.tipIdx < leg.doneIdx && leg.startIdx < leg.tipIdx);
  }
  // bacaklar yön değiştirerek ardışık; uygunluk = boyut ≥ 10 ATR
  for (let q = 1; q < legs.length; q++) { assert.equal(legs[q].dir, -legs[q - 1].dir); assert.equal(legs[q].startIdx, legs[q - 1].tipIdx); }
  for (const l of legs) assert.equal(l.eligible, l.size >= 10 * l.atr);
});

test('zigzag elle: 2 ATR dönüş, yeni uç mumunda dönüş yok, bacak boyutu', () => {
  // 20 düz mum (aralık 1 → ATR 1), sonra 100 → 115 yükseliş, sonra düşüş
  const c = [];
  for (let k = 0; k < 20; k++) c.push(bar(100, 100.5, 99.5, 100));
  for (let k = 1; k <= 15; k++) c.push(bar(100 + k - 1, 100 + k + 0.2, 100 + k - 1.2, 100 + k));
  const tipIdx = c.length - 1;
  c.push(bar(115, 115.1, 113.5, 113.6)); // 1,6 aşağı: dönüş yok (ATR ~1,3 → eşik ~2,6)
  c.push(bar(113.6, 113.7, 110.0, 110.2)); // uç 115,2 − 110 = 5,2 → dönüş
  const legs = zigzagLegs(c);
  const up = legs.find((l) => l.dir === 1);
  assert.ok(up, 'yukarı bacak');
  assert.equal(up.tipIdx, tipIdx); close(up.tip, 115.2);
  assert.equal(up.doneIdx, c.length - 1);
  // aynı mumda yeni uç + derin dip: dönüş sayılmaz
  const c2 = c.slice(0, tipIdx + 1); c2.push(bar(115, 116, 105, 106));
  assert.ok(!zigzagLegs(c2).some((l) => l.dir === 1 && l.doneIdx === tipIdx + 1));
});

test('seviye fiyatları: yukarı bacakta uç − r × bacak, aşağı bacakta uç + r × bacak', () => {
  const up = { dir: 1, start: 100, tip: 200, size: 100 }, dn = { dir: -1, start: 200, tip: 100, size: 100 };
  close(fibPrice(up, 0.382), 161.8); close(fibPrice(up, 0), 200); close(fibPrice(up, 1), 100);
  close(fibPrice(dn, 0.382), 138.2); close(fibPrice(dn, 0.618), 161.8); close(fibPrice(dn, 1), 200);
});

test('ilk dokunuş, zaten geçilmiş, uç aşımı (kapanış / aynı mum), pencere', () => {
  const leg = { dir: 1, start: 100, startIdx: 0, tip: 200, tipIdx: 5, doneIdx: 6, size: 100 };
  const c = [bar(100, 101, 99, 100), bar(100, 130, 100, 130), bar(130, 160, 130, 160), bar(160, 180, 160, 180), bar(180, 190, 180, 190), bar(190, 200, 189, 199),
    bar(199, 199, 165, 166), // tamamlanma: 0,31 (169) zaten geçildi
    bar(166, 170, 160, 162), // 0,382 (161,8) ilk dokunuş
    bar(162, 175, 158, 170), // 0,382 ikinci dokunuş sayılmaz; 0,44 (156) değmedi
    bar(170, 201, 149, 190)]; // 0,44 / 0,5 (150) dokunuşu + uç aşımı aynı mumda → olay yok; derinler kapandı
  const r = Object.fromEntries(legLevelTouches(c, leg, [0.31, 0.382, 0.44, 0.5, 0.56], P).map((o) => [o.r, o]));
  assert.equal(r[0.31].status, 'passed');
  assert.equal(r[0.382].status, 'event'); assert.equal(r[0.382].j, 7);
  assert.equal(r[0.44].status, 'tipSameBar'); assert.equal(r[0.5].status, 'tipSameBar');
  assert.equal(r[0.56].status, 'closed');
  // pencere: 60 mumda dokunuş yok → noTouch; seri erken biterse noTouchTrunc
  const flatC = [...c.slice(0, 7), ...Array.from({ length: 61 }, () => bar(180, 185, 175, 180))];
  assert.equal(legLevelTouches(flatC, leg, [0.382], P)[0].status, 'noTouch');
  assert.equal(legLevelTouches(flatC.slice(0, 30), leg, [0.382], P)[0].status, 'noTouchTrunc');
  // 61. mumda dokunuş pencerenin dışında
  const late = [...flatC.slice(0, 67), bar(180, 180, 150, 151)];
  assert.equal(late.length, 68); assert.equal(legLevelTouches(late, leg, [0.382], P)[0].status, 'noTouch');
  const in60 = [...flatC.slice(0, 66), bar(180, 180, 150, 151)];
  assert.equal(legLevelTouches(in60, leg, [0.382], P)[0].status, 'event');
});

test('sonuç sınıflaması: tepki / kırılım / belirsiz / sonuçsuz / ufuk (elle mumlar)', () => {
  const L = 100, d = 10; // yukarıdan gelindi (dir +1): tepki ≥ 110, kırılım ≤ 90
  const pre = bar(105, 106, 104, 105);
  const cls = (...bs) => classify([pre, ...bs], 1, L, 1, d, 3).res;
  assert.equal(cls(bar(105, 106, 99, 101), bar(101, 111, 100, 110)), RES.react);
  assert.equal(cls(bar(105, 106, 99, 101), bar(101, 102, 89, 90)), RES.brk);
  assert.equal(cls(bar(105, 106, 99, 101), bar(101, 111, 89, 95)), RES.amb);
  assert.equal(cls(bar(105, 106, 99, 101), bar(101, 105, 95, 100), bar(100, 105, 95, 100), bar(100, 105, 95, 100)), RES.none);
  assert.equal(cls(bar(105, 106, 99, 101), bar(101, 105, 95, 100)), RES.horizon);
  // dokunuş mumunda: kırılım kesin → kırılım; tepe ≥ hedef ama kapanış altında ve açılış seviyenin üstünde → sayılmaz, devam
  assert.equal(cls(bar(105, 106, 89, 92)), RES.brk);
  assert.equal(cls(bar(105, 112, 99, 105), bar(105, 106, 89, 90)), RES.brk);
  assert.equal(cls(bar(105, 106, 99, 111)), RES.react); // kapanış hedefte: dokunuştan sonra kesin
  assert.equal(cls(bar(105, 106, 89, 111)), RES.amb);
  // aşağıdan gelindi (dir −1): tepki ≤ 90, kırılım ≥ 110
  const pre2 = bar(95, 96, 94, 95);
  assert.equal(classify([pre2, bar(95, 101, 94, 99), bar(99, 100, 89, 90)], 1, L, -1, d, 3).res, RES.react);
  assert.equal(classify([pre2, bar(95, 101, 94, 99), bar(99, 111, 98, 110)], 1, L, -1, d, 3).res, RES.brk);
});

test('S2 adım ve sahte seviye konumları', () => {
  assert.deepEqual(stepOf(65000), { e: 4, s: 10000 });
  assert.deepEqual(stepOf(1000), { e: 3, s: 1000 });
  assert.equal(stepOf(999.99).s, 100);
  close(stepOf(0.065).s, 0.01); close(stepOf(0.001).s, 0.001);
  assert.equal(stepOf(0), null);
  // seviyeler: 5 → yuvarlak; 5,37 / 5,63 sahte (s = 1)
  const c = [bar(5.9, 5.95, 5.85, 5.9, HALF_A_START), bar(5.9, 5.9, 4.9, 4.95, HALF_A_START + H4)];
  const ev = s2Series({ coin: 'X', candles: c }, P).events.map((e) => `${e.key}`);
  assert.deepEqual(ev.sort(), ['fake', 'fake', 'round']); // 5,63 + 5,37 + 5,0 (hepsi ≥ 0,25 s uzaktan: önceki dip 5,85)
});

test('S2 0,25 s yeniden kurma kuralı', () => {
  const t = (k) => HALF_A_START + k * H4;
  const c = [
    bar(5.5, 5.52, 5.48, 5.5, t(0)),
    bar(5.5, 5.5, 4.98, 5.05, t(1)), // 5,0 olay (önceki tepe 5,52 ≥ 5,25); 5,37 değdi ama kurulu değil (önceden 0,25 s uzak değildi)
    bar(5.05, 5.15, 5.02, 5.1, t(2)),
    bar(5.1, 5.12, 4.99, 5.05, t(3)), // 5,0 yeniden dokunuş: kurulu değil → olay yok
    bar(5.05, 5.3, 5.04, 5.28, t(4)), // 5,3 ≥ 5,25 → 5,0 yeniden kuruldu
    bar(5.28, 5.29, 4.99, 5.0, t(5)), // 5,0 olay (5,37 değmedi: tepe 5,29)
    bar(5.0, 5.7, 5.0, 5.65, t(6)), // 5,37 / 5,63 dokunuşu (aşağıdan); 5,0 yeniden dokunuş kurulu değil
  ];
  const r = s2Series({ coin: 'X', candles: c }, P);
  const ev = r.events.map((e) => [e.key, (e.t - HALF_A_START) / H4, e.dir]);
  // bar 6: 5,37 bar 1'de görülmüştü (kurulu değil), bar 2'de dip 5,02 ≤ 5,12 → kuruldu → olay; 5,63 ilk görüş, önceki dip 4,98 ≤ 5,38 → olay
  assert.deepEqual(ev, [['round', 1, 1], ['round', 5, 1], ['fake', 6, -1], ['fake', 6, -1]]);
  assert.ok(r.counts.notArmed >= 3); // bar 1: 5,37 · bar 3: 5,0 · bar 6: 5,0
});

test('komşu-ortalaması farkı ve ağırlıklı birincil ölçü aritmetiği', () => {
  const keys = [0.31, 0.382, 0.44, 0.5, 0.56, 0.618, 0.66].map(levelKey);
  const rates = { 0.31: [5, 10], 0.382: [8, 10], 0.44: [3, 10], 0.5: [12, 20], 0.56: [6, 20], 0.618: [1, 4], 0.66: [2, 4] };
  const tot = new Float64Array(14);
  keys.forEach((k, q) => { tot[2 * q] = rates[k][0]; tot[2 * q + 1] = rates[k][1]; });
  const [d1, d2, d3, prim] = s1Stat(tot, keys, P);
  close(d1, 0.8 - (0.5 + 0.3) / 2); close(d2, 0.6 - (0.3 + 0.3) / 2); close(d3, 0.25 - (0.3 + 0.5) / 2);
  close(prim, (d1 * 10 + d2 * 20 + d3 * 4) / 34);
  close(weightedPrimary([0.1, NaN, 0.3], [1, 5, 3]), (0.1 + 0.9) / 4);
  assert.ok(Number.isNaN(weightedPrimary([NaN], [3])));
  // s1Cell: olaylardan aynı sayılar
  const evs = [];
  keys.forEach((k) => { const [a, n] = rates[k]; for (let q = 0; q < n; q++) evs.push({ key: k, t: HALF_A_START + q * 86400e3, day: HALF_A_START + q * 86400e3, res: q < a ? RES.react : RES.brk }); });
  evs.push({ key: '0.382', t: HALF_A_START, day: HALF_A_START, res: RES.amb }, { key: '0.382', t: HALF_A_START, day: HALF_A_START, res: RES.none });
  const cell = s1Cell(evs, P);
  close(cell.diffs['0.382'].diff, +d1.toFixed(4)); close(cell.diff, +prim.toFixed(4));
  assert.equal(cell.levels['0.382'].n, 12); assert.equal(cell.levels['0.382'].resolved, 10);
  close(cell.levels['0.382'].ambShare, 1 / 12, 1e-4); close(cell.levels['0.382'].noneShare, 1 / 12, 1e-4);
  assert.equal(cell.nBelieved, 34); assert.equal(cell.inconclusive, true);
});

test('verdict mantığı', () => {
  const c = (diff, lo, inc = false) => ({ diff, ci99: [lo, lo + 0.1], inconclusive: inc });
  assert.equal(verdictOf(c(0.05, 0.01), c(0.04, 0.005)).verdict, VERDICT.pass);
  assert.equal(verdictOf(c(0.05, 0.01), c(0.04, -0.01)).verdict, VERDICT.fail);
  assert.equal(verdictOf(c(-0.05, -0.1), c(0.04, 0.01)).verdict, VERDICT.fail);
  assert.equal(verdictOf(c(0.05, 0.01), c(0.04, 0.01, true)).verdict, VERDICT.inconclusive);
  assert.equal(verdictOf(c(0.05, 0.01), { diff: 0.04, ci99: null, inconclusive: false }).verdict, VERDICT.fail);
});

// ---------- sentetik uçtan uca ----------
test('rastgele yürüyüş: seviyelerin anlamı yok → S1 ve S2 geçmez', () => {
  const series = universe(60, { sd: 0.012 });
  const o = runLevels({ series4h: series, p: { reps: 400 } });
  for (const k of ['s1', 's2']) for (const h of ['A', 'B']) assert.ok(!o[k][h].inconclusive, `${k} ${h} n ${o[k][h].nBelieved}`);
  assert.equal(o.s1.verdict, VERDICT.fail, JSON.stringify([o.s1.A.diff, o.s1.A.ci99, o.s1.B.diff, o.s1.B.ci99]));
  assert.equal(o.s2.verdict, VERDICT.fail, JSON.stringify([o.s2.A.diff, o.s2.A.ci99, o.s2.B.diff, o.s2.B.ci99]));
});

test('yapay etki: inanılan fib seviyelerinde sıçrama → S1 geçer; yuvarlak sayılarda sıçrama → S2 geçer', () => {
  const f = runLevels({ series4h: universe(60, { mode: 'fib', seedOff: 1 }), p: { reps: 400 } });
  assert.equal(f.s1.verdict, VERDICT.pass, JSON.stringify([f.s1.A.diff, f.s1.A.ci99, f.s1.A.nBelieved, f.s1.B.diff, f.s1.B.ci99]));
  const r = runLevels({ series4h: universe(30, { mode: 'round', seedOff: 2 }), p: { reps: 400 } });
  assert.equal(r.s2.verdict, VERDICT.pass, JSON.stringify([r.s2.A.diff, r.s2.A.ci99, r.s2.B.diff, r.s2.B.ci99]));
});

test('uçtan uca --fixture koşusu levels.json üretir (meta, s1, s2, info1d)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-'));
  execFileSync(process.execPath, ['backtest/levels.mjs', '--fixture', '--out', dir, '--reps', '200'], { stdio: 'pipe' });
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'levels.json'), 'utf8'));
  for (const k of ['meta', 's1', 's2', 'info1d']) assert.ok(j[k], k);
  for (const h of ['A', 'B']) { assert.ok(j.s1[h].levels['0.382']); assert.ok(j.s2[h].levels.round); assert.ok('osler' in j.s2[h]); }
  assert.ok(Object.values(VERDICT).includes(j.s1.verdict));
  assert.equal(j.meta.params.minLegAtr, 10); assert.equal(j.meta.params.revAtr, 2); assert.equal(j.meta.params.window, 60);
  assert.equal(j.meta.params.horizon, 40); assert.equal(j.meta.params.s2.armFrac, 0.25); assert.equal(j.meta.params.bootstrap.reps, 200);
  assert.ok(j.meta.legs.eligible >= 0 && j.meta.coins === 20);
  assert.ok(HALF_B_START > HALF_A_START);
});
