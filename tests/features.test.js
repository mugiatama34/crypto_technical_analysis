import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, featuresOf, trainLogistic, modelProb } from '../backtest/features.js';

test('featuresOf: uzunluk ve temel kodlama', () => {
  const x = featuresOf({ signals: [{ detector: 'fvg', group: 'smc' }, { detector: 'harmonic', group: 'harmonic' }], score: 70, riskPct: 2.5, tf: '1H', direction: 'long', inZone: true, time: Date.UTC(2026, 0, 1, 14) }, { adx: 40, pdi: 30, mdi: 10, ema200: 90, price: 100, mtf: true });
  assert.equal(x.length, FEATURE_NAMES.length);
  const at = (n) => x[FEATURE_NAMES.indexOf(n)];
  assert.equal(at('det:fvg'), 1); assert.equal(at('det:orderblock'), 0); assert.equal(at('grp:harmonic'), 1);
  assert.equal(at('tf:1H'), 1); assert.equal(at('dir:long'), 1); assert.equal(at('inZone'), 1);
  assert.equal(at('adx:>35'), 1); assert.equal(at('adx:aligned&>35'), 1); assert.equal(at('ema200:side'), 1); assert.equal(at('mtf'), 1); assert.equal(at('hour:12-17'), 1);
  assert.ok(Math.abs(at('score/100') - 0.7) < 1e-9 && Math.abs(at('riskPct/5') - 0.5) < 1e-9);
});

test('trainLogistic: ayrılabilir sentetik veride öğrenir', () => {
  const X = [], y = [];
  let s = 1; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 600; i++) { const a = r() > 0.5 ? 1 : 0, b = r() > 0.5 ? 1 : 0, c = r(); X.push([a, b, c]); y.push(a && !b ? (r() < 0.9 ? 1 : 0) : (r() < 0.2 ? 1 : 0)); }
  const m = trainLogistic(X, y, { epochs: 300, lr: 0.5, l2: 1e-3 });
  assert.ok(m.weights[0] > 0.5 && m.weights[1] < -0.5, JSON.stringify(m));
  assert.ok(modelProb(m, [1, 0, 0.5]) > 0.6 && modelProb(m, [0, 1, 0.5]) < 0.3);
});
