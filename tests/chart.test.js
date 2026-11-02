import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalChartSvg, fmtPrice } from '../bot/chart.js';

test('signalChartSvg: seviyeler, R etiketleri ve başlık', () => {
  const cs = Array.from({ length: 30 }, (_, i) => ({ time: i * 4 * 36e5, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }));
  const svg = signalChartSvg(cs, { coin: 'BNB', tf: '4H', direction: 'short', entry: 130, stop: 132, tp1: 127, tp2: 121, early: 128, zone: [130, 131], sentAt: 30 * 4 * 36e5 });
  assert.match(svg, /^<svg/); assert.match(svg, /BNBUSDT · 4H/); assert.match(svg, /SHORT/);
  assert.match(svg, /TP1 1\.5R/); assert.match(svg, /TP2 4\.5R/); assert.match(svg, /Erken 1\.0R/);
});

test('fmtPrice: basamak', () => { assert.equal(fmtPrice(714.315), '714.32'); assert.equal(fmtPrice(0.095581), '0.09558'); });
