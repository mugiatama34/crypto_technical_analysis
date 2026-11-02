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

import { setupDrawOf, stopContext, resultOf } from '../bot/chart.js';
import { sendTelegramPhoto } from '../bot/telegram.js';

test('setupDrawOf: indeks → zaman, mum/indikatör grupları ve tekrarlar atlanır', () => {
  const cs = Array.from({ length: 10 }, (_, i) => ({ time: i * 1000 }));
  const sigs = [
    { name: 'EW', group: 'elliott', draw: [{ kind: 'line', points: [{ i: 1, price: 5 }, { i: 12, price: 6 }] }, { kind: 'marker', i: 3, price: 4, text: 'W', position: 'aboveBar' }] },
    { name: 'EW', group: 'elliott', draw: [{ kind: 'hline', price: 9 }] },
    { name: 'Doji', group: 'candle', draw: [{ kind: 'marker', i: 9, price: 1, text: 'D' }] },
    { name: 'OB', group: 'smc', draw: [{ kind: 'box', from: 2, to: 4, lo: 1, hi: 2 }] },
  ];
  const d = setupDrawOf(sigs, cs);
  assert.equal(d.length, 3);
  assert.deepEqual(d[0].points.map((p) => p.t), [1000, 12000]); // ileri indeks TF adımıyla
  assert.equal(d[1].t, 3000); assert.equal(d[1].above, true);
  assert.equal(d[2].t0, 2000); assert.equal(d[2].label, 'OB');
});

test('stopContext: stop alınmamış EQH üstüne çok yakınsa uyarır', () => {
  // 1H mumlar: iki eşit tepe 110 (alınmamış), sonra düşüş; short stop 110,1
  const cs = []; let t = Date.UTC(2026, 9, 1);
  const path = [100, 104, 108, 110, 106, 102, 105, 108, 110, 105, 101, 98, 96, 99, 97, 95];
  for (let k = 0; k < 4; k++) for (const p of path) { cs.push({ time: t, open: p - 0.5, high: p + (p === 110 ? 0 : 0.6), low: p - 1, close: p, volume: 1 }); t += 36e5; }
  for (let i = 0; i < cs.length; i++) if (i < 48) { cs[i].high -= 20; cs[i].low -= 20; cs[i].open -= 20; cs[i].close -= 20; }
  const r = stopContext(cs, '1H', { direction: 'short', entry: 106, stop: 110.1, tp2: 96 });
  assert.ok(r.liqs.some((l) => l.label === 'EQH' && l.near), JSON.stringify(r.liqs));
  assert.ok(r.notes.some((n) => /EQH/.test(n)));
});

test('resultOf: erken kâr + başa baş işaretleri', () => {
  const r = resultOf({ entry: 10, stop: 11, tp2: 7, early: 9.5, earlyPortion: 0.8, status: 'be', filledAt: 1, earlyAt: 2, closedAt: 3 }, 0.4);
  assert.deepEqual(r.fills.map((f) => f.text), ['giriş', 'erken %80', 'başa baş']);
  assert.equal(r.fills[2].price, 10); assert.equal(r.label, 'başa baş');
});

test('sendTelegramPhoto: multipart sendPhoto', async () => {
  let url, body;
  const ok = await sendTelegramPhoto(Buffer.from([1, 2]), '<b>x</b>', { token: 'T', chatId: '1', fetchImpl: async (u, o) => { url = u; body = o.body; return { ok: true }; } });
  assert.equal(ok, true); assert.match(url, /sendPhoto$/); assert.equal(body.get('chat_id'), '1'); assert.ok(body.get('photo'));
  assert.equal(await sendTelegramPhoto(null, 'x', { token: 'T', chatId: '1' }), false);
});
