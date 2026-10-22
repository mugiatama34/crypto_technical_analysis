import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeStrength, attachRelativeStrength } from '../src/scan/relative.js';

const H = 3600e3;
const series = (f, n = 80, skip = new Set()) => Array.from({ length: n }, (_, i) => ({ time: i * H, open: f(i), high: f(i) * 1.01, low: f(i) * 0.99, close: f(i), volume: 1 })).filter((c, i) => !skip.has(i));

test('relativeStrength: BTC\'den hızlı yükselen coin + rs ve rsSide +1; yavaş yükselen −; zaman hizalama eksik mumu atlar', () => {
  const btc = series((i) => 100 + i);
  const fast = series((i) => 100 + 3 * i), slow = series((i) => 100 + 0.2 * i);
  const a = relativeStrength(fast, btc), b = relativeStrength(slow, btc);
  assert.ok(a.rs > 0 && a.rsSide === 1 && a.rsSlope > 0);
  assert.ok(b.rs < 0 && b.rsSide === -1);
  const gappy = relativeStrength(series((i) => 100 + 3 * i, 80, new Set([70, 71])), btc);
  assert.equal(gappy.bars, 78);
  assert.equal(relativeStrength(series((i) => 100 + i, 10), btc), null); // yetersiz
  assert.equal(relativeStrength(fast, []), null);
});

test('attachRelativeStrength: satırlara aynı TF BTC\'sinden yazar; BTC satırı null; BTC yoksa null', () => {
  const btc = series((i) => 100 + i);
  const rows = [
    { coin: 'BTC', tf: '1H', candles: btc, live: null },
    { coin: 'ETH', tf: '1H', candles: series((i) => 100 + 3 * i), live: null },
    { coin: 'SOL', tf: '4H', candles: series((i) => 100 + 3 * i), live: null },
    { coin: 'ERR', tf: '1H', error: 'x' },
  ];
  attachRelativeStrength(rows);
  assert.equal(rows[0].trend.rsBtc, null);
  assert.ok(rows[1].trend.rsBtc > 0 && rows[1].trend.rsSide === 1);
  assert.equal(rows[2].trend.rsBtc, null); // 4H BTC satırı yok
  assert.equal(rows[3].trend, undefined);
});
