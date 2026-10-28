import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistOf, CHECKS } from '../src/scan/checklist.js';
import { build } from './helpers.js';

const H4 = 4 * 3600e3;
// Yükselen seri (long lehine) ve düşen seri
const up = build(Array.from({ length: 30 }, (_, k) => [k * 10, 100 + k * 3]), { tfMs: 86400e3 });
const down = build(Array.from({ length: 30 }, (_, k) => [k * 10, 200 - k * 3]), { tfMs: 86400e3 });
const plan = { d: 1, atr: 1, entry: 100, stop: 99, tp1: 103, tp2: 105, inZone: false, riskPct: 1, groups: ['smc', 'fib', 'candle'], trend: { rsSide: 1, rsBtc: 2.1 } };
const slow = build([[0, 102], [10, 101], [20, 100.5]]);
const wed = Date.UTC(2026, 9, 28, 12), sat = Date.UTC(2026, 9, 31, 12);

test('check list: 8 madde, ölçülmüş/ölçülmemiş etiketi; long lehine her şey ✓', () => {
  assert.equal(CHECKS.length, 8);
  const r = checklistOf({ plan, candles: slow, btcDaily: up, upCandles: up, smc: [{ type: 'liquidity', direction: 'neutral', name: 'EQH (alınmamış)', zone: [102.8, 103.2], meta: { level: 103 } }], coin: 'X', now: wed });
  const by = Object.fromEntries(r.items.map((x) => [x.id, x.ok]));
  assert.deepEqual(by, { btc: true, htf: true, rs: true, limit: true, slow: true, weekday: true, stop: true, path: true });
  assert.equal(r.n, 8); assert.equal(r.known, 8);
  assert.equal(r.items.find((x) => x.id === 'stop').ev, 'sağlam'); assert.equal(r.items.find((x) => x.id === 'btc').ev, 'tutarsız');
});

test('check list: ters koşullar ✗, veri yoksa ?', () => {
  const r = checklistOf({
    plan: { ...plan, inZone: true, riskPct: 0.5, groups: ['smc', 'candle', 'indicator'], trend: {} },
    candles: build([[0, 110], [3, 100]]), btcDaily: down, upCandles: null,
    smc: [{ type: 'fvg', direction: 'short', status: 'active', name: 'FVG ↓', zone: [101, 101.6] }], coin: 'X', now: sat,
  });
  const by = Object.fromEntries(r.items.map((x) => [x.id, x.ok]));
  assert.deepEqual(by, { btc: false, htf: null, rs: null, limit: false, slow: false, weekday: false, stop: false, path: false });
  assert.equal(r.n, 0); assert.equal(r.known, 6);
  assert.match(r.items.find((x) => x.id === 'path').detail, /FVG/);
});

test('check list: dokunulmuş FVG yolu kapatmaz; girişteki bölge sayılmaz', () => {
  const smc = [{ type: 'fvg', direction: 'short', status: 'mitigated', zone: [101, 102] }, { type: 'orderblock', direction: 'short', status: 'active', zone: [99.5, 100.05] }];
  assert.equal(checklistOf({ plan, candles: slow, smc, now: wed }).items.find((x) => x.id === 'path').ok, true);
});

test('check list raporu: madde etkisi (✓ − ✗), sayım kovaları, ağırlıklar yalnız eğitimden', async () => {
  const { perItem, byCount, weighted } = await import('../backtest/checklistReport.js');
  const ids = ['btc', 'htf', 'rs', 'limit', 'slow', 'weekday', 'stop', 'path'];
  const mk = (time, btc, R) => ({ time, R, hedgedR: R / 2, outcome: R > 0 ? 'tp2' : 'stopped', ok: Object.fromEntries(ids.map((id) => [id, id === 'btc' ? btc : false])) });
  const trades = [];
  for (let k = 0; k < 40; k++) { trades.push(mk(k, true, 1), mk(k, false, -1)); } // eğitim: btc ✓ +1, ✗ −1
  for (let k = 100; k < 140; k++) { trades.push(mk(k, true, -1), mk(k, false, 1)); } // doğrulama: ters (ağırlık bunu görmemeli)
  const p = perItem(trades, 50);
  assert.equal(p.btc.delta.train, 2); assert.equal(p.btc.delta.valid, -2); assert.equal(p.htf.delta.train, null);
  const w = weighted(trades, 50);
  assert.equal(w.weights.btc, 2); assert.equal(w.weights.htf, 0);
  const hi = w.tiers.find((t) => t.label === 'yüksek') || w.tiers.find((t) => t.train.n);
  assert.ok(hi.valid.avgR <= 0, 'doğrulamada ağırlık işe yaramazsa bunu göstermeli');
  const c = byCount(trades, 50);
  assert.equal(c.find((b) => b.label === '≤ 3').train.n, 80);
});
