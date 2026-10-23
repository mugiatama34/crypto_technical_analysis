import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror, patch, ctxOf, randomWalk } from './helpers.js';
import { DETECTORS, runDetectors } from '../src/scan/registry.js';
import { detect as detectEw } from '../src/detectors/elliott.js';
import { patternsAt, detect as detectCandles } from '../src/detectors/candlesticks.js';
import { findDivergences } from '../src/detectors/divergence.js';
import { findClassic, detect as detectPatterns } from '../src/detectors/patterns.js';
import { matchXabcd, detect as detectHarm } from '../src/detectors/harmonic.js';
import { tradingRange, detect as detectWy } from '../src/detectors/wyckoff.js';
import { detect as detectMisc } from '../src/detectors/misc.js';
import * as I from '../src/data/indicators.js';

test('tüm detektörler gürültüde ve kısa veride hata vermez', () => {
  for (const n of [10, 60, 120, 500]) {
    const ctx = ctxOf(randomWalk(n, { seed: n }));
    const errors = [];
    const sigs = runDetectors(ctx, null, errors);
    assert.deepEqual(errors, [], `hatalar (n=${n}): ${JSON.stringify(errors)}`);
    for (const s of sigs) {
      assert.ok(DETECTORS.some((d) => d.id === s.detector));
      assert.ok(['long', 'short', 'neutral'].includes(s.direction));
      assert.ok(!s.zone || (Number.isFinite(s.zone[0]) && Number.isFinite(s.zone[1]) && s.zone[0] <= s.zone[1]), `zone ${s.id} ${s.zone}`);
    }
  }
});

test('indikatörler: ema/sma/macd/bb/adx/supertrend uzunluk ve ısınma', () => {
  const c = randomWalk(120);
  const closes = c.map((x) => x.close), highs = c.map((x) => x.high), lows = c.map((x) => x.low);
  assert.equal(I.ema(closes, 20).length, 120);
  assert.equal(I.ema(closes, 20)[18], null);
  assert.ok(Number.isFinite(I.ema(closes, 20)[19]));
  assert.ok(Math.abs(I.sma(closes, 5)[10] - closes.slice(6, 11).reduce((s, x) => s + x, 0) / 5) < 1e-9);
  const m = I.macd(closes);
  assert.ok(Number.isFinite(m.hist[60]));
  const bb = I.bollinger(closes);
  assert.ok(bb.upper[50] > bb.mid[50] && bb.lower[50] < bb.mid[50]);
  const ax = I.adx(highs, lows, closes);
  assert.ok(ax.adx[60] >= 0 && ax.adx[60] <= 100);
  const st = I.supertrend(highs, lows, closes);
  assert.ok([1, -1].includes(st.dir[60]));
  const vp = I.volumeProfile(c);
  assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah);
});

test('Elliott: 0-1-2 sonrası dalga-3 setup sinyali', () => {
  const BASE = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119]];
  const c = build([[0, 120], [10, 120], ...BASE.map(([b, p]) => [b + 10, p])]);
  const ctx = ctxOf(c);
  const sigs = detectEw(ctx);
  const w3 = sigs.find((s) => /dalga-3/.test(s.name));
  assert.ok(w3, `dalga-3: ${sigs.map((s) => s.name)}`);
  assert.equal(w3.direction, 'long');
  assert.ok(w3.target > ctx.price);
});

test('Mum formasyonları: engulfing ve hammer', () => {
  const base = build([[0, 100], [40, 100]], { spread: 0.3 });
  const c = patch(base, {
    38: { open: 100.5, close: 99.5, high: 100.7, low: 99.3 },
    39: { open: 99.4, close: 101, high: 101.2, low: 99.2 }, // bullish engulfing
  });
  const p = patternsAt(c, 39, 1);
  assert.ok(p.some((x) => x.name === 'Bullish engulfing'));
  const h = patch(base, { 39: { open: 100.2, close: 100.4, high: 100.5, low: 98 } });
  assert.ok(patternsAt(h, 39, 1).some((x) => x.name === 'Hammer'));
  assert.ok(detectCandles(ctxOf(c)).some((s) => s.name === 'Bullish engulfing'));
});

test('Divergence: fiyat LL, RSI HL → bullish regular', () => {
  // Düşüş: 100→80 keskin, 95'e tepki, sonra 78'e yavaş düşüş (RSI daha yüksek dip)
  const c = build([[0, 110], [10, 110], [16, 80], [30, 95], [60, 78], [63, 82]], { spread: 0.2 });
  const ctx = ctxOf(c);
  const divs = findDivergences(ctx, { maxAge: 12, maxSpan: 80, minSpan: 4 });
  assert.ok(divs.some((d) => d.dir === 1 && d.kind === 'regular'), `divs: ${JSON.stringify(divs.map((d) => [d.ind, d.kind, d.dir]))}`);
});

test('Klasik: ikili tepe ve OBO', () => {
  const dt = build([[0, 100], [15, 120], [25, 108], [40, 120.2], [52, 109]]);
  const f = findClassic(ctxOf(dt), { tolAtr: 0.6, maxAge: 25, minPivots: 5 });
  assert.ok(f.some((p) => p.kind === 'double' && p.dir === -1), `double: ${f.map((p) => p.name)}`);
  const hs = build([[0, 100], [12, 118], [20, 108], [32, 130], [40, 109], [52, 117], [60, 110]]);
  const g = findClassic(ctxOf(hs), { tolAtr: 0.6, maxAge: 25, minPivots: 5 });
  assert.ok(g.some((p) => p.kind === 'hs' && p.dir === -1), `hs: ${g.map((p) => p.name)}`);
  const sigs = detectPatterns(ctxOf(mirror(hs, 240)));
  assert.ok(sigs.some((s) => /Ters omuz/.test(s.name) && s.direction === 'long'), sigs.map((s) => s.name));
});

test('Klasik: simetrik üçgen ve falling wedge', () => {
  const tri = build([[0, 100], [10, 130], [20, 100], [30, 124], [40, 106], [50, 119], [60, 111], [66, 115]]);
  const f = findClassic(ctxOf(tri), { tolAtr: 0.8, maxAge: 30, minPivots: 5 });
  assert.ok(f.some((p) => p.kind === 'symtri'), f.map((p) => p.name));
  const wedge = build([[0, 140], [10, 120], [20, 134], [30, 112], [40, 124], [50, 106], [60, 115], [66, 103]]);
  const g = findClassic(ctxOf(wedge), { tolAtr: 0.8, maxAge: 30, minPivots: 5 });
  assert.ok(g.some((p) => p.kind === 'fwedge' && p.dir === 1), g.map((p) => p.name));
});

test('Harmonik: Gartley oranları', () => {
  // Bullish Gartley: X=100 (L), A=200 (H), B=138.2 (0.618), C=176 (0.618 AB), D=121.4 (0.786 XA)
  const X = { i: 0, price: 100, type: 'L' }, A = { i: 10, price: 200, type: 'H' }, B = { i: 20, price: 138.2, type: 'L' }, C = { i: 30, price: 176.4, type: 'H' }, D = { i: 40, price: 121.4, type: 'L' };
  const m = matchXabcd(X, A, B, C, D, { tol: 0.06 });
  assert.ok(m.some((x) => x.pattern.id === 'gartley' && x.bull && x.complete), JSON.stringify(m.map((x) => x.pattern.id)));
  const forming = matchXabcd(X, A, B, C, null, { tol: 0.06 });
  const g = forming.find((x) => x.pattern.id === 'gartley');
  assert.ok(g && g.prz[0] < 125 && g.prz[1] > 117);
  const c = build([[0, 100], [30, 100], [40, 200], [50, 138.2], [60, 176.4], [70, 121.4], [74, 126]], { spread: 0.5 });
  const sigs = detectHarm(ctxOf(c, { swingK: 2, minorK: 1 }));
  assert.ok(sigs.some((s) => /Gartley/.test(s.name) && s.direction === 'long'), sigs.map((s) => s.name));
});

test('Wyckoff: aralık ve spring', () => {
  let c = build([[0, 130], [20, 100], [30, 104], [40, 100], [50, 104], [60, 100], [70, 104], [80, 100], [90, 104], [96, 102]], { spread: 0.2 });
  c = patch(c, { 95: { open: 101, close: 101.5, high: 101.8, low: 98.5, volume: 400 } });
  const ctx = ctxOf(c);
  const tr = tradingRange(ctx, { rangeBars: 60, maxWidthAtr: 12, recent: 6, minTouches: 2 });
  assert.ok(tr, 'aralık bulunmalı');
  assert.equal(tr.phase, 'accumulation');
  const sigs = detectWy(ctx);
  assert.ok(sigs.some((s) => s.name === 'Wyckoff spring'), sigs.map((s) => s.name));
});

test('İndikatör sinyalleri: Donchian kırılımı ve hacim', () => {
  let c = build([[0, 100], [80, 100], [84, 106]], { spread: 0.2 });
  c = patch(c, { 83: { ...c[83], volume: 500 } });
  const sigs = detectMisc(ctxOf(c));
  assert.ok(sigs.some((s) => /Donchian 20 kırılımı ↑/.test(s.name)), sigs.map((s) => s.name));
  assert.ok(sigs.some((s) => /Hacim/.test(s.name)));
});

test('Elliott preset seçenekleri: patterns yalnız o kalıbı bırakır, wave3:false dalga-3 setup\'larını kapatır', async () => {
  const { PRESETS } = await import('../src/scan/presets.js');
  let total = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const cs = randomWalk(400, { seed, step: 0.9 });
    for (const pat of ['diagonal', 'zigzag', 'flat']) {
      const out = detectEw(ctxOf(cs, { tf: '1H', elliott: { patterns: [pat], wave3: false, minScore: 50, maxCounts: 4 } }));
      total += out.length;
      for (const s of out) { assert.equal(s.meta?.pattern, pat, s.name); assert.ok(!s.name.startsWith('EW dalga-3')); }
    }
    const all = detectEw(ctxOf(cs, { tf: '1H', elliott: { minScore: 50 } }));
    assert.ok(all.length >= detectEw(ctxOf(cs, { tf: '1H', elliott: { patterns: ['flat'], wave3: false, minScore: 50 } })).length);
  }
  assert.ok(total > 0, 'kısıtlı taramalar en az bir sayım üretmeli');
  for (const id of ['ew_diagonal', 'ew_zigzag', 'ew_flat', 'ew_corrections']) {
    const p = PRESETS.find((x) => x.id === id);
    assert.ok(p && p.detectors.includes('elliott') && p.detectorOpts.elliott.patterns.length && p.detectorOpts.elliott.wave3 === false, id);
  }
});
