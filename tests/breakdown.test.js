import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterSignals } from '../src/scan/scoring.js';
import { formatBreakdown, formatSetup } from '../bot/telegram.js';
import { breakdownText } from '../src/ui/signals-lib.js';

const mk = (id, detector, group, zone, strength = 0.6) => ({ id, detector, group, zone, direction: 'long', strength, status: 'active' });

test('scoreCluster döküm: parça toplamı = sum, çarpanlarla raw', () => {
  const r = clusterSignals([mk('a', 'fvg', 'smc', [100, 101]), mk('b', 'fvg', 'smc', [100.2, 101], 0.5), mk('c', 'fibonacci', 'fib', [100.3, 100.8]), mk('d', 'structure', 'ms', [100, 100.9], 0.7)], { atr: 1, price: 100.5 });
  const bd = r.best.breakdown;
  const tot = Object.values(bd.parts).reduce((t, v) => t + v, 0);
  assert.ok(Math.abs(tot - bd.sum) < 0.02, `${tot} vs ${bd.sum}`);
  assert.ok(Math.abs(bd.sum * bd.diversity * bd.proximity * bd.widthPen - bd.raw) < 0.01);
  assert.ok(bd.parts.fvg > 0 && bd.parts.fibonacci > 0 && bd.parts.structure > 0);
});

const bd = { parts: { orderblock: 2.8, fvg: 2.2, fibonacci: 1.4, structure: 1.2, liquidity: 1.0, patterns: 0.8, elliott: 0.6 }, div: 1.36, prox: 0.92, wpen: 1, raw: 9, cluster: 58, mtf: 75 };

test('formatBreakdown: en büyük 4 + diğer, toplam 100±1', () => {
  const t = formatBreakdown({ bd, mtf: { tfs: ['1H', '4H', '1D'] } });
  assert.ok(t.startsWith('Döküm: OB %'));
  assert.ok(t.includes('diğer %'));
  const pcts = [...t.split('|')[0].matchAll(/%(\d+)/g)].map((m) => +m[1]);
  assert.equal(pcts.length, 5);
  assert.ok(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) <= 1);
  assert.ok(t.includes('çeşitlilik ×1,36') && t.includes('yakınlık ×0,92') && !t.includes('genişlik'));
  assert.ok(t.endsWith('küme 58 → 3 TF uyumu 75'));
  assert.equal(breakdownText({ bd, mtf: ['1H', '4H'] }).split('|')[2].trim(), 'küme 58 → 2 TF uyumu 75');
});

test('formatBreakdown: bd yok → boş; MTF küçükse yalnız küme; genişlik cezası', () => {
  assert.equal(formatBreakdown({}), '');
  assert.equal(formatBreakdown({ bd: null }), '');
  const t = formatBreakdown({ bd: { ...bd, wpen: 0.85, mtf: 40 }, mtf: { tfs: ['1H', '4H'] } });
  assert.ok(t.endsWith('| küme 58') && t.includes('genişlik ×0,85'));
  assert.ok(formatBreakdown({ bd: { ...bd, mtf: null } }).endsWith('| küme 58'));
});

test('formatSetup: bd yokken döküm satırı yok, varken Puan satırından sonra', () => {
  const plan = { coin: 'BTC', tf: '4H', direction: 'long', score: 58, price: 100, signals: [], mtf: null, entry: 99.5, inZone: false };
  const dec = { trade: 'take', confidence: 'orta', entry_low: 99, entry_high: 100, entry: 99.5, stop: 98, tp1: 102, tp2: 104, rr1: 1.5, rr: 2, reason: 'r', invalidation: 'i' };
  const a = formatSetup(plan, dec, null), b = formatSetup({ ...plan, bd: null }, dec, null);
  assert.equal(a, b);
  assert.ok(!a.includes('Döküm'));
  const c = formatSetup({ ...plan, bd }, dec, null).split('\n');
  assert.ok(c[1].startsWith('Puan 58') && c[2].startsWith('Döküm:'));
});
