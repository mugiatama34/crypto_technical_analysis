import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeCoin, btcCorr, detectorsFor, FAMILIES, DEFAULT_TFS } from '../src/scan/coin.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/coin-arb.json', import.meta.url)));
const toC = (a) => ({ time: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: a[5] ?? 0 });
const conv = (o) => Object.fromEntries(Object.entries(o).map(([tf, arr]) => [tf, { candles: arr.map(toC), live: null }]));
const ARB = conv(fx.ARB), BTC = conv(fx.BTC);

test('coin analizi: dört dilim, tablo alanları ve yorum', () => {
  const r = analyzeCoin({ coin: 'ARB', perTf: ARB, btcPerTf: BTC, now: Date.UTC(2026, 9, 26, 12) });
  assert.deepEqual(r.tfs, DEFAULT_TFS);
  for (const tf of r.tfs) {
    const x = r.res[tf];
    assert.ok(x.price > 0 && x.atr > 0);
    assert.ok(x.range && x.range.pos >= 0 && x.range.pos <= 1);
    assert.ok(x.corr == null || (x.corr >= -1 && x.corr <= 1));
    for (const z of [x.bestLong, x.bestShort].filter(Boolean)) assert.ok(z.zone[0] <= z.zone[1] && z.distPct >= 0);
  }
  const c = r.comment;
  assert.match(c.headline, /^ARB: genel eğilim/);
  assert.ok(c.bullets.some((b) => b.startsWith('<b>Yön:</b>')));
  assert.ok(c.bullets.some((b) => b.startsWith('<b>BTC ile ilişki')));
  assert.ok(c.bullets.some((b) => b.startsWith('<b>Konum:</b>')));
  assert.ok(c.verdict.length > 20);
  assert.ok(['long', 'short', 'wait'].includes(c.tone));
  assert.doesNotMatch(c.verdict, /Hafta sonu/, 'Pazartesi');
});

test('coin analizi: aile seçimi detektörleri sınırlar; BTC kendisiyle karşılaştırılmaz', () => {
  assert.deepEqual(detectorsFor(['elliott']), ['elliott']);
  assert.equal(detectorsFor(FAMILIES.map((f) => f.id)).length, 13);
  const r = analyzeCoin({ coin: 'ARB', perTf: { '4H': ARB['4H'] }, btcPerTf: { '4H': BTC['4H'] }, families: ['elliott'], now: Date.UTC(2026, 9, 25, 12) });
  assert.ok(r.res['4H'].signals.every((s) => s.detector === 'elliott'));
  assert.match(r.comment.verdict, /Hafta sonu/);
  const b = analyzeCoin({ coin: 'BTC', perTf: { '4H': BTC['4H'] }, families: ['pa'] });
  assert.equal(b.res['4H'].corr, null);
  assert.ok(!b.comment.bullets.some((x) => x.includes('BTC ile ilişki')));
});

test('btcCorr: kendisiyle 1, yetersiz veride null', () => {
  const cs = ARB['1H'].candles;
  assert.equal(btcCorr(cs, cs), 1);
  assert.equal(btcCorr(cs.slice(0, 10), cs.slice(0, 10)), null);
});
