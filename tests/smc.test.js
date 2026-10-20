import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror, patch, ctxOf, randomWalk } from './helpers.js';
import { labelSwings, structureEvents, dealingRange, detect as detectStructure } from '../src/detectors/structure.js';
import { findFvgs, detect as detectFvg } from '../src/detectors/fvg.js';
import { findOrderBlocks, detect as detectOb } from '../src/detectors/orderblock.js';
import { equalLevels, detect as detectLiq } from '../src/detectors/liquidity.js';
import { detect as detectFib } from '../src/detectors/fibonacci.js';

// Yükseliş yapısı: HL/HH dizisi, sonra son HL kırılır (CHoCH ↓)
const UP = [[0, 100], [15, 120], [25, 110], [40, 135], [50, 124], [65, 150], [75, 138]];

test('labelSwings: HH/HL/LH/LL etiketleri', () => {
  const c = build(UP);
  const ctx = ctxOf(c);
  const labels = labelSwings(ctx.swings).map((p) => p.label);
  assert.deepEqual(labels.slice(0, 2), ['L', 'H']);
  assert.ok(labels.includes('HH') && labels.includes('HL'));
  assert.ok(!labels.includes('LL'));
});

test('structureEvents: yükselişte BOS ↑, dönüşte CHoCH ↓', () => {
  // 138'den sonra 124 (son HL) altına düşüş → CHoCH ↓
  const c = build([...UP, [85, 150], [100, 115]]);
  const ctx = ctxOf(c);
  const { events, trend } = structureEvents(ctx.candles, ctx.swings);
  assert.ok(events.length >= 2, `en az iki kırılım (${events.length})`);
  assert.ok(events.some((e) => e.kind === 'BOS' && e.dir === 1), 'BOS ↑ olmalı');
  const ch = events.find((e) => e.kind === 'CHoCH');
  assert.ok(ch && ch.dir === -1, 'CHoCH ↓ olmalı');
  assert.ok(events.every((e, k) => k === 0 || e.i >= events[k - 1].i), 'kronolojik');
  assert.equal(trend, -1);
});

test('dealingRange: discount/premium ve OTE', () => {
  const c = build([[0, 100], [20, 100], [40, 140], [48, 128]]); // bacak 100→140, fiyat 128 = %70
  const ctx = ctxOf(c);
  const dr = dealingRange(ctx);
  assert.ok(dr);
  assert.ok(dr.pos > 0.6 && dr.pos < 0.8, `pos ${dr.pos}`);
  assert.ok(dr.ote[0] < dr.ote[1] && dr.ote[1] < 140 && dr.ote[0] > 100);
  const sigs = detectStructure(ctx);
  assert.ok(sigs.some((s) => s.id === 'structure|trend'));
});

test('FVG: yükseliş boşluğu, dolum ve inversion', () => {
  const base = build([[0, 100], [60, 100]], { spread: 0.2 });
  // 30. mumda yukarı boşluk: mum 28 high=100.2, mum 30 low=103 (boşluk 100.2–103)
  let c = patch(base, {
    29: { open: 100, close: 104, high: 104.5, low: 99.8 },
    30: { open: 104, close: 105, high: 105.5, low: 103 },
    31: { open: 105, close: 105.5, high: 106, low: 104.5 },
  });
  // Sonraki mumlar 105 civarı — boşluk dolmaz
  c = c.map((x, i) => (i > 31 ? { ...x, open: 105, close: 105.2, high: 105.6, low: 104.8 } : x));
  let ctx = ctxOf(c);
  const f = findFvgs(ctx, { minAtr: 0.1, maxAge: 100, keep: 5 }).find((x) => x.dir === 1 && x.i === 30);
  assert.ok(f, 'FVG bulunmalı');
  assert.equal(f.status, 'open');
  assert.ok(Math.abs(f.lo - 100.2) < 1e-9 && Math.abs(f.hi - 103) < 1e-9);
  assert.ok(detectFvg(ctx).some((s) => s.name === 'FVG ↑' && s.status === 'active'));
  // Kısmi dolum
  const c2 = patch(c, { 45: { open: 105, close: 102.5, high: 105, low: 101.8 } });
  ctx = ctxOf(c2);
  const f2 = findFvgs(ctx, { minAtr: 0.1, maxAge: 100, keep: 5 }).find((x) => x.i === 30);
  assert.equal(f2.status, 'partial');
  assert.ok(f2.filled > 0.3 && f2.filled < 0.6, `filled ${f2.filled}`);
  // Inversion: kapanış boşluğun altında
  const c3 = patch(c, { 45: { open: 105, close: 99, high: 105, low: 98.5 } });
  ctx = ctxOf(c3);
  const f3 = findFvgs(ctx, { minAtr: 0.1, maxAge: 100, keep: 5 }).find((x) => x.i === 30);
  assert.equal(f3.status, 'inverted');
  assert.ok(detectFvg(ctx).some((s) => s.name === 'iFVG ↓'));
});

test('Order block: yukarı yer değiştirmeden önceki son düşüş mumu', () => {
  const base = build([[0, 100], [60, 100]], { spread: 0.2 });
  let c = patch(base, {
    28: { open: 100.5, close: 99.5, high: 100.7, low: 99.2 }, // son düşüş mumu → OB [99.2, 100.7]
    29: { open: 99.6, close: 103, high: 103.3, low: 99.4 },
    30: { open: 103, close: 106, high: 106.5, low: 102.8 }, // FVG: low 102.8 > high[28] 100.7
    31: { open: 106, close: 107, high: 107.5, low: 105.5 },
  });
  c = c.map((x, i) => (i > 31 ? { ...x, open: 107, close: 107.2, high: 107.6, low: 106.7 } : x));
  const ctx = ctxOf(c);
  const obs = findOrderBlocks(ctx, { lookback: 8, maxAge: 150, keep: 3, minMoveAtr: 1 });
  const ob = obs.find((b) => b.dir === 1 && b.i === 28);
  assert.ok(ob, `OB bulunmalı: ${JSON.stringify(obs.map((b) => [b.dir, b.i]))}`);
  assert.equal(ob.status, 'fresh');
  const sigs = detectOb(ctx);
  assert.ok(sigs.some((s) => s.name === 'Order Block ↑'));
  // Mitigation: fiyat bölgeye döner
  const c2 = patch(c, { 50: { open: 107, close: 101, high: 107, low: 100.5 } });
  const ob2 = findOrderBlocks(ctxOf(c2), { lookback: 8, maxAge: 150, keep: 3, minMoveAtr: 1 }).find((b) => b.i === 28);
  assert.equal(ob2.status, 'mitigated');
});

test('Likidite: eşit tepeler ve süpürme', () => {
  // İki eşit tepe 120 civarı, sonra fitil 122'ye çıkıp 118'e kapanış → BSL sweep
  const path = [[0, 100], [10, 120], [20, 108], [30, 120.1], [40, 108], [50, 115]];
  let c = build(path, { spread: 0.3 });
  c = patch(c, { 49: { open: 115, close: 117.5, high: 122.5, low: 114.8 } });
  const ctx = ctxOf(c);
  const eq = equalLevels(ctx.minor, ctx.atr, 0.3);
  assert.ok(eq.some((l) => l.type === 'H' && l.touches.length >= 2), 'EQH bulunmalı');
  const sigs = detectLiq(ctx);
  const sw = sigs.find((s) => s.name === 'BSL süpürüldü');
  assert.ok(sw, `sweep sinyali: ${sigs.map((s) => s.name)}`);
  assert.equal(sw.direction, 'short');
});

test('Likidite: ayna (eşit dipler, SSL sweep → long)', () => {
  const path = [[0, 100], [10, 120], [20, 108], [30, 120.1], [40, 108], [50, 115]];
  let c = mirror(build(path, { spread: 0.3 }), 230);
  c = patch(c, { 49: { open: 115, close: 112.5, high: 115.2, low: 107.5 } });
  const sigs = detectLiq(ctxOf(c));
  const sw = sigs.find((s) => s.name === 'SSL süpürüldü');
  assert.ok(sw);
  assert.equal(sw.direction, 'long');
});

test('Fibonacci: fiyat %61,8 seviyesinde', () => {
  // Bacak 100→140, geri çekilme 140 − 0.618×40 = 115.28
  const c = build([[0, 100], [20, 100], [40, 140], [52, 115.3]]);
  const ctx = ctxOf(c);
  const sigs = detectFib(ctx);
  const s = sigs.find((x) => x.name === 'Fib %61.8' || x.name === 'Fib %61,8' || /61/.test(x.name));
  assert.ok(s, `fib sinyali: ${sigs.map((x) => x.name)}`);
  assert.equal(s.direction, 'long');
});

test('Gürültü: rastgele yürüyüşte detektörler hata vermez', () => {
  const ctx = ctxOf(randomWalk(400));
  for (const d of [detectStructure, detectFvg, detectOb, detectLiq, detectFib]) {
    const r = d(ctx);
    assert.ok(Array.isArray(r));
    for (const s of r) { assert.ok(s.type && s.name && s.group); assert.ok(s.strength >= 0 && s.strength <= 1); }
  }
});
