// Fib kesişimi iç dalga sayımı (ön kayıt docs/arastirma/on-kayit-fib-dalga.md): sınıflar, iki Elliott kuralı, yön aynası,
// eşik = k / 2 × ATR; etiket yalnız bilgi (puan / plan / sinyal değişmez); ölçüm betiğinin fark + bootstrap + karar mantığı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, mirror, ctxOf, randomWalk } from './helpers.js';
import { legPivots, legClass, classifyPivots, fibWaveOf, waveText, WAVE_CLASSES } from '../src/ew/innerCount.js';
import { detect as detectFib } from '../src/detectors/fibonacci.js';
import { clusterSignals } from '../src/scan/scoring.js';
import { PRESET_MAP } from '../src/scan/presets.js';
import { fibClusterG } from '../backtest/lab/corrections.js';
import { runStrategy } from '../backtest/lab/run.mjs';
import { fibWaveStrategy, diffCi, verdictOf, isPrimary } from '../backtest/lab/fibwave.mjs';
import { BT_DEFAULTS } from '../backtest/engine.js';

// Bacak: yol noktaları → mumlar; uçlar ilk mumun dibi ve son mumun tepesi (yükselen bacak)
const upLeg = (pathPts) => { const c = build(pathPts, { spread: 0.1 }); return { c, a: { i: 0, price: c[0].low }, b: { i: c.length - 1, price: c.at(-1).high } }; };
const cls = (pathPts, thr = 3) => { const { c, a, b } = upLeg(pathPts); return legClass(c, a, b, thr); };

test('iç sayım: tek parça / 3\'lü / 5\'li ✓ / 5\'li ✗ / 7+ (yükselen bacak, eşik 3)', () => {
  assert.equal(cls([[0, 100], [30, 130]]).cls, 'one');
  assert.equal(cls([[0, 100], [10, 115], [15, 113.5], [30, 130]]).cls, 'one', 'eşik altı geri çekilme sayılmaz');
  const t = cls([[0, 100], [10, 115], [15, 108], [30, 130]]);
  assert.equal(t.cls, 'three'); assert.equal(t.m, 3); assert.equal(t.label, "3'lü");
  const f = cls([[0, 100], [10, 110], [15, 105], [30, 125], [35, 118], [45, 130]]);
  assert.equal(f.cls, 'five_ok'); assert.equal(f.m, 5); assert.deepEqual(f.rules, { w3NotShortest: true, w4NoOverlap: true });
  assert.equal(f.pivots.length, 6); assert.equal(f.pivots[0].i, 0); assert.equal(f.pivots[5].i, 44);
  const ov = cls([[0, 100], [10, 110], [15, 105], [30, 125], [38, 108], [50, 130]]); // 4. dalga 1. dalganın ucunun altına
  assert.equal(ov.cls, 'five_bad'); assert.equal(ov.rules.w4NoOverlap, false); assert.equal(ov.rules.w3NotShortest, true);
  const sh = cls([[0, 100], [12, 112], [16, 108], [26, 118], [30, 114], [50, 135]]); // 3. dalga (10) 1 (12) ve 5'ten (21) kısa
  assert.equal(sh.cls, 'five_bad'); assert.equal(sh.rules.w3NotShortest, false); assert.equal(sh.rules.w4NoOverlap, true);
  assert.equal(cls([[0, 100], [10, 110], [14, 106], [24, 116], [28, 112], [38, 122], [42, 118], [52, 130]]).cls, 'seven');
});

test('iç sayım: düşen bacak (short ayna) aynı sınıfları verir', () => {
  const cases = [
    [[[0, 100], [30, 130]], 'one'],
    [[[0, 100], [10, 115], [15, 108], [30, 130]], 'three'],
    [[[0, 100], [10, 110], [15, 105], [30, 125], [35, 118], [45, 130]], 'five_ok'],
    [[[0, 100], [10, 110], [15, 105], [30, 125], [38, 108], [50, 130]], 'five_bad'],
    [[[0, 100], [10, 110], [14, 106], [24, 116], [28, 112], [38, 122], [42, 118], [52, 130]], 'seven'],
  ];
  for (const [p, want] of cases) {
    const c = mirror(build(p, { spread: 0.1 }), 260); // fiyat 260 − x: 160 → 130 düşüş
    const r = legClass(c, { i: 0, price: c[0].high }, { i: c.length - 1, price: c.at(-1).low }, 3);
    assert.equal(r.cls, want, JSON.stringify(p));
  }
});

test('iç sayım: dizi bacağın başıyla başlar, ucuyla biter, tipler sırayla; m tek', () => {
  const { c, a, b } = upLeg([[0, 100], [10, 110], [15, 105], [30, 125], [35, 118], [45, 130]]);
  const pts = legPivots(c, a, b, 3);
  assert.deepEqual([pts[0].i, pts[0].price], [a.i, a.price]); assert.deepEqual([pts.at(-1).i, pts.at(-1).price], [b.i, b.price]);
  for (let j = 1; j < pts.length; j++) assert.notEqual(pts[j].type, pts[j - 1].type);
  assert.equal((pts.length - 1) % 2, 1);
  assert.equal(legPivots(c, b, a, 3), null); assert.equal(legPivots(c, a, b, 0), null);
  assert.equal(classifyPivots([{ price: 1 }]), null);
});

test('fibWaveOf: eşik = bulan k / 2 × sinyal anı ATR; metin "İtki: … · A: …"', () => {
  // İtki 100 → 130 (içinde 7'lik geri çekilme), A 130 → 118 tek parça
  const c = build([[0, 100], [10, 115], [15, 108], [30, 130], [40, 118], [45, 124]], { spread: 0.1 });
  const P0 = { i: 0, price: c[0].low }, P1 = { i: 29, price: c[29].high }, A = { i: 39, price: c[39].low }, B = { i: 44, price: c[44].high };
  const w = fibWaveOf(c, [P0, P1, A, B], 2, 4); // eşik 2 × 2 = 4 < 7 → 3'lü
  assert.equal(w.kIn, 2); assert.equal(w.thr, 4); assert.equal(w.imp.cls, 'three'); assert.equal(w.a.cls, 'one');
  assert.equal(w.text, "İtki: 3'lü · A: tek parça");
  assert.equal(fibWaveOf(c, [P0, P1, A, B], 2, 8).imp.cls, 'one', 'eşik 8 > 7 → tek parça');
  assert.equal(fibWaveOf(c, [P0, P1, A, B], 0, 2), null);
  assert.equal(waveText('five_ok', 'three'), "İtki: 5'li ✓ · A: 3'lü");
  assert.deepEqual(Object.keys(WAVE_CLASSES), ['one', 'three', 'five_ok', 'five_bad', 'seven']);
});

test('fib kesişimi: iç sayım meta.wave\'de; waveNote yalnız nota ekler — puan, giriş / stop / hedef, sinyal aynı', () => {
  const cs = build([[0, 100], [60, 100], [72, 112], [80, 107], [86, 110.94], [90, 108.5]], { spread: 0.15 });
  const base = { only: 'cluster', clusterKs: [2, 3, 4], bRetr: [0.382, 1.0] };
  const [s0] = detectFib(ctxOf(cs, { fibonacci: base }));
  const [s1] = detectFib(ctxOf(cs, { fibonacci: { ...base, waveNote: true } }));
  assert.ok(s0 && s1);
  assert.ok(s0.meta.wave && WAVE_CLASSES[s0.meta.wave.imp] && WAVE_CLASSES[s0.meta.wave.a]);
  assert.match(s1.note, /İç sayım \(ZigZag [\d,]+×ATR\): İtki: .+ · A: .+ \(yalnız bilgi/);
  assert.doesNotMatch(s0.note, /İç sayım/, 'varsayılan (canlı bot) not metni değişmez');
  assert.ok(s1.note.startsWith(s0.note));
  const strip = (s) => ({ ...s, note: null });
  assert.deepEqual(strip(s1), strip(s0));
  for (const k of ['id', 'name', 'direction', 'strength', 'entry', 'stop', 'target', 'invalidation', 'status']) assert.deepEqual(s1[k], s0[k], k);
  const sc = (s) => clusterSignals([s], { atr: 1, price: 108.5, weights: { fibonacci: 2.0 } }).best?.score;
  assert.equal(sc(s1), sc(s0));
  // meta.wave'siz (etiket yokmuş gibi) puan da aynı: puanlama etiketi okumaz
  assert.equal(sc({ ...s0, meta: { ...s0.meta, wave: undefined } }), sc(s0));
  assert.equal(PRESET_MAP.fib_cluster.detectorOpts.fibonacci.waveNote, true);
  assert.equal(PRESET_MAP.fib_cluster_618.detectorOpts.fibonacci.waveNote, true);
});

test('lab: etiketli strateji fib_cluster_g ile aynı işlemleri üretir (yalnız tags eklenir)', () => {
  const o = { ...BT_DEFAULTS, feePct: 0.05, slipPct: 0.05, fundingPct8h: 0.01, fillBarTp: 'skip' };
  let total = 0;
  for (const seed of [3, 11, 29]) {
    const candles = randomWalk(1500, { seed, tfMs: 15 * 60e3, step: 0.8 });
    const s = { coin: 'X', tf: '15m', candles, extra: {} };
    const a = runStrategy(fibClusterG, s, o), b = runStrategy(fibWaveStrategy, s, o);
    assert.equal(b.length, a.length);
    assert.deepEqual(b.map(({ tags, ...t }) => t), a);
    for (const t of b) { assert.ok([2, 3, 4].includes(t.tags.k)); assert.ok(t.tags.imp == null || WAVE_CLASSES[t.tags.imp]); }
    assert.ok(a.every((t) => !t.tags), 'taban stratejiye etiket yazılmaz');
    total += a.length;
  }
  assert.ok(total > 0, 'rastgele yürüyüşte en az bir kesişim işlemi');
});

test('fibwave: fark + bloklu bootstrap ve ön kayıtlı karar (sonuçsuz / geçer / geçmez / aday)', () => {
  const day = 86400e3, mk = (d, R, imp) => ({ time: d * day, entryTime: d * day + 1, outcome: 'stopped', R, tags: { imp } });
  const ts = [];
  for (let d = 0; d < 60; d++) { ts.push(mk(d, 0.5 + (d % 3) * 0.1, 'five_ok'), mk(d, -0.2 - (d % 2) * 0.1, 'three'), { ...mk(d, 0, 'one'), outcome: 'expired' }); }
  const r = diffCi(ts, isPrimary, { reps: 300 });
  assert.equal(r.nA, 60); assert.equal(r.nB, 60, 'dolmayanlar sayılmaz'); assert.ok(r.diff > 0.7 && r.ci[0] > 0 && r.ci[0] <= r.diff && r.diff <= r.ci[1]);
  assert.deepEqual(diffCi(ts, isPrimary, { reps: 300 }), r, 'sabit tohum');
  const g = (n, avgR, pf, h) => ({ n, avgR, profitFactor: pf, hedgedAvgR: h });
  const P = { train: { diff: 0.2, ci: [0.05, 0.3] }, valid: { diff: 0.1, ci: [0.01, 0.2] } };
  assert.equal(verdictOf(P, { train: g(99, 0.1, 1.3, 0.1), valid: g(150, 0.1, 1.3, 0.1) }).verdict, 'sonucsuz');
  const ok = verdictOf(P, { train: g(120, 0.1, 1.3, 0.1), valid: g(110, 0.1, 1.3, 0.1) });
  assert.equal(ok.verdict, 'gecer'); assert.equal(ok.candidate, true);
  const info = verdictOf(P, { train: g(120, -0.1, 0.9, -0.1), valid: g(110, 0.1, 1.3, 0.1) });
  assert.equal(info.verdict, 'gecer'); assert.equal(info.candidate, false); assert.match(info.conclusion, /bilgi taşıyor/);
  assert.equal(verdictOf({ ...P, valid: { diff: 0.1, ci: [-0.01, 0.2] } }, { train: g(120, 0.1, 1.3, 0.1), valid: g(110, 0.1, 1.3, 0.1) }).verdict, 'gecmez');
});

test('fibwave uçtan uca --fixture: fib-wave.json biçimi (TF başına grup, birincil fark, karar, bilgi satırları); deneme docs\'a yazmaz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fibwave-'));
  execFileSync(process.execPath, ['backtest/lab/fibwave.mjs', '--fixture', '--top', '8', '--out', dir], { stdio: 'pipe' });
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'fib-wave.json'), 'utf8'));
  assert.equal(j.meta.trial, true); assert.match(j.meta.warning, /yorumlanmaz/);
  assert.deepEqual(j.meta.cost, { fee: 0.05, slip: 0.05 }); assert.deepEqual(j.meta.lowCost, { fee: 0.02, slip: 0.01 }); assert.equal(j.meta.fillbar, 'skip');
  for (const tf of ['5m', '15m']) {
    const r = j.tfs[tf];
    assert.ok(r.groups.five_ok.train && r.groups.others.valid && 'fillRate' in r.groups.five_ok.valid && 'hedgedAvgR' in r.groups.others.train, tf);
    assert.ok('diff' in r.primary.train && 'diff' in r.primary.valid);
    assert.ok(['gecer', 'gecmez', 'sonucsuz'].includes(r.verdict));
    for (const c of ['one', 'three', 'five_ok', 'five_bad', 'seven']) assert.ok(r.info.byClass[c].long && r.info.byClass[c].short, c);
    assert.ok(r.info.byA['A three'] && r.info.combo.group && r.info.lowCost.train);
  }
  let err = null;
  try { execFileSync(process.execPath, ['backtest/lab/fibwave.mjs', '--fixture'], { stdio: 'pipe' }); } catch (e) { err = e; }
  assert.equal(err?.status, 2, 'deneme koşusu docs/backtest\'e yazmayı reddeder');
});
