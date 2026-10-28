import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, randomWalk } from './helpers.js';
import { runScan, analyzeRow, compareRows, compareByScore } from '../src/scan/scanner.js';
import { clusterSignals, multiTfAlignment } from '../src/scan/scoring.js';
import { PRESETS } from '../src/scan/presets.js';
import { DETECTORS } from '../src/scan/registry.js';

// Fixture sağlayıcı: BTC = dalga-3 setup'ı (detectors.test ile aynı doğrulanmış yol), diğerleri rastgele yürüyüş
const BULL = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119]];
const provider = {
  topCoins: async (n) => ['BTC', 'ETH', 'SOL'].slice(0, n).map((coin) => ({ coin, instId: `${coin}-USDT-SWAP`, last: 1, volUsd: 1 })),
  candles: async (instId, tf) => {
    const seed = instId.length + tf.length;
    const candles = instId.startsWith('BTC') ? build([[0, 120], [10, 120], ...BULL.map(([b, p]) => [b + 10, p])]) : randomWalk(200, { seed });
    return { candles, live: null };
  },
};

test('runScan: fixture sağlayıcıyla uçtan uca', async () => {
  const progress = [];
  const res = await runScan({ timeframes: ['15m', '4H'], topN: 3 }, { provider, onProgress: (p) => progress.push(p) });
  assert.equal(res.rows.length, 6);
  assert.equal(progress[progress.length - 1].done, 6);
  assert.deepEqual(res.errors, []);
  for (const r of res.rows) {
    assert.ok(r.coin && r.tf);
    assert.ok(Array.isArray(r.signals));
    assert.ok(r.score >= 0 && r.score <= 100);
  }
  // Sıralı: puan azalan
  for (let i = 1; i < res.rows.length; i++) assert.ok(compareRows(res.rows[i - 1], res.rows[i]) <= 0);
  const btc = res.rows.filter((r) => r.coin === 'BTC');
  // Dalga-3 long sinyali bir long kümesinde yer almalı; aynı veri iki TF'de aynı yönü vermeli (MTF uyumu)
  for (const r of btc) {
    const w3 = r.signals.find((s) => s.detector === 'elliott' && /dalga-3/.test(s.name));
    assert.ok(w3 && w3.direction === 'long', `dalga-3 (${r.tf})`);
    assert.ok(r.clusters.some((c) => c.direction === 'long' && c.signals.includes(w3)), 'dalga-3 long kümede');
  }
  assert.ok(btc[0].mtf && btc[0].mtf.tfs.length === 2 && btc[0].mtf.direction === btc[0].direction, 'çoklu TF uyumu');
});

test('runScan: elle sembol listesi ve detektör alt kümesi', async () => {
  const res = await runScan({ timeframes: ['1H'], manualCoins: ['btc', 'eth'], detectors: ['fvg', 'structure'] }, { provider });
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows.find((r) => r.coin === 'BTC').instId, 'BTC-USDT-SWAP');
  for (const r of res.rows) for (const s of r.signals) assert.ok(['fvg', 'structure'].includes(s.detector));
});

test('analyzeRow: yetersiz mum hata satırı', () => {
  const r = analyzeRow({ coin: 'X', instId: 'X-USDT-SWAP', tf: '1H', candles: randomWalk(20), live: null }, { ids: null });
  assert.equal(r.error, 'Yetersiz mum');
});

test('clusterSignals: aynı bölgede farklı gruplar daha yüksek puan', () => {
  const mk = (id, detector, group, zone, direction = 'long', strength = 0.6) => ({ id, detector, group, zone, direction, strength, status: 'active' });
  const one = clusterSignals([mk('a', 'fvg', 'smc', [100, 101])], { atr: 1, price: 100.5 });
  const two = clusterSignals([mk('a', 'fvg', 'smc', [100, 101]), mk('b', 'fibonacci', 'fib', [100.3, 100.8])], { atr: 1, price: 100.5 });
  const far = clusterSignals([mk('a', 'fvg', 'smc', [100, 101]), mk('b', 'fibonacci', 'fib', [110, 111])], { atr: 1, price: 100.5 });
  assert.ok(two.best.score > one.best.score);
  assert.equal(two.best.signals.length, 2);
  assert.equal(far.clusters.length, 2);
  // Ters yön ayrı küme
  const mixed = clusterSignals([mk('a', 'fvg', 'smc', [100, 101]), mk('b', 'orderblock', 'smc', [100, 101], 'short')], { atr: 1, price: 100.5 });
  assert.equal(mixed.clusters.length, 2);
});

test('multiTfAlignment: yön uyumu ve çelişki', () => {
  const al = multiTfAlignment({ '15m': { best: { direction: 'long', score: 50 } }, '4H': { best: { direction: 'long', score: 60 } }, '1D': { best: { direction: 'short', score: 40 } } });
  assert.equal(al.direction, 'long');
  assert.deepEqual(al.tfs, ['15m', '4H']);
  assert.deepEqual(al.conflicting, ['1D']);
  assert.equal(al.htf, '4H');
  assert.equal(multiTfAlignment({ '4H': { best: { direction: 'long', score: 50 } } }), null);
});

test('presetler yalnızca kayıtlı detektörleri anar', () => {
  const ids = new Set(DETECTORS.map((d) => d.id));
  for (const p of PRESETS) {
    for (const d of p.detectors || []) assert.ok(ids.has(d), `${p.id}: ${d}`);
    for (const d of Object.keys(p.weights)) assert.ok(ids.has(d), `${p.id} weight: ${d}`);
  }
});

test('compareByScore: kartta görünen küme puanına göre sıralar (MTF puanı öne geçirmez)', () => {
  const r = (coin, score, mtf, n = 1) => ({ coin, direction: 'long', score, mtf: { direction: 'long', score: mtf }, best: { signals: Array(n).fill({}) } });
  const rows = [r('A', 10, 80), r('B', 45, 0), r('C', 30, 50), r('D', 30, 60)];
  assert.deepEqual([...rows].sort(compareByScore).map((x) => x.coin), ['B', 'D', 'C', 'A']);
  // eski sıralama MTF ile A'yı öne alıyordu
  assert.equal([...rows].sort(compareRows)[0].coin, 'A');
});

test('Ayarlar: withEw dalga-3 seçeneklerini Elliott detektörüne ekler, preset ayarlarını korur', async () => {
  const { withEw } = await import('../src/ui/settings.js');
  const { EW_UI_DEFAULTS, parseField } = await import('../src/ui/settingsPanel.js');
  const o = withEw({ elliott: { patterns: ['zigzag'], wave3: false }, fvg: { x: 1 } }, { ...EW_UI_DEFAULTS, textbook: true, ruleSet: 'fp' });
  assert.deepEqual(o.elliott.patterns, ['zigzag']); assert.equal(o.elliott.wave3, false); assert.equal(o.fvg.x, 1);
  assert.equal(o.elliott.ruleSet, 'fp'); assert.equal(o.elliott.w3.textbook, true); assert.equal(o.elliott.w3.cExtend, true);
  assert.equal(parseField('retrMin', '50'), 0.5);
  assert.deepEqual(parseField('targets', ''), EW_UI_DEFAULTS.targets);
  assert.equal(parseField('textbookMin', '4'), 4);
});
