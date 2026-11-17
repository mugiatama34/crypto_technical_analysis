import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, plansOf, loadConfig } from '../bot/exchange/local.mjs';

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
