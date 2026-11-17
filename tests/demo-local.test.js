import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, plansOf, loadConfig, riskUsdOf, equityOf } from '../bot/exchange/local.mjs';

test('parseEnvFile: yorum, tırnak, export ve geçersiz satırlar', () => {
  const e = parseEnvFile('# not\nBYBIT_DEMO_KEY=abc\nexport BYBIT_DEMO_SECRET="s=1"\n\nbozuk satır\nküçük=1\nBYBIT_DEMO_RISK = 1 \n');
  assert.deepEqual(e, { BYBIT_DEMO_KEY: 'abc', BYBIT_DEMO_SECRET: 's=1', BYBIT_DEMO_RISK: '1' });
});

test('plansOf: items dizisi ya da düz dizi; eksik alanlı kayıt atılır', () => {
  const a = { key: 'BNB|4H|short|55', sentAt: 1, status: 'waiting' };
  assert.deepEqual(plansOf({ items: [a, { key: 'x' }, null] }), [a]);
  assert.deepEqual(plansOf([a]), [a]);
  assert.deepEqual(plansOf(null), []);
});

test('loadConfig: ortam dosyadan önce gelir; dosya yoksa varsayılan risk 10', () => {
  const c = loadConfig({ BYBIT_DEMO_ENV: '/yok/boyle/dosya', BYBIT_DEMO_KEY: 'k', BYBIT_DEMO_SECRET: 's' }, '/tmp');
  assert.equal(c.key, 'k'); assert.equal(c.secret, 's'); assert.equal(c.riskUsd, 10);
});

test('riskUsdOf: yüzde + özsermaye → özsermayenin yüzdesi (sente aşağı); okunamazsa sabit tutar', () => {
  assert.equal(riskUsdOf({ riskUsd: 1, riskPct: 1, equity: 100 }), 1);
  assert.equal(riskUsdOf({ riskUsd: 1, riskPct: 1, equity: 123.456 }), 1.23);
  assert.equal(riskUsdOf({ riskUsd: 1, riskPct: 0.5, equity: 87.9 }), 0.43);
  assert.equal(riskUsdOf({ riskUsd: 2, riskPct: 1, equity: null }), 2);
  assert.equal(riskUsdOf({ riskUsd: 2, riskPct: 0, equity: 500 }), 2);
});

test('equityOf: toplam özsermaye ya da yalnız seçilen coin', () => {
  const r = { list: [{ totalEquity: '165000.5', coin: [{ coin: 'BTC', equity: '1' }, { coin: 'USDT', equity: '99925.4' }] }] };
  assert.equal(equityOf(r), 165000.5);
  assert.equal(equityOf(r, 'usdt'), 99925.4);
  assert.equal(equityOf(r, 'ETH'), null);
  assert.equal(equityOf({ list: [] }), null);
});
