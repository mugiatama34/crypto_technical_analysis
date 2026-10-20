import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, positionSize, trackPlan, onCooldown } from '../bot/plan.js';
import { validateDecision, buildPrompt, SCHEMA, askBrain } from '../bot/brain.js';
import { formatSetup, formatUpdate, formatSummary, esc } from '../bot/telegram.js';

const sig = (name, extra = {}) => ({ name, detector: 'fvg', group: 'smc', direction: 'long', strength: 0.6, status: 'active', zone: [99, 100], ...extra });
const row = (over = {}) => ({
  coin: 'BTC', instId: 'BTC-USDT-SWAP', tf: '1H', price: 101, atr: 1, direction: 'long', score: 70,
  mtf: { direction: 'long', score: 75, tfs: ['1H', '4H'], conflicting: [] },
  best: { direction: 'long', score: 70, zone: [99, 100], groups: new Set(['smc', 'fib']), signals: [sig('FVG ↑', { invalidation: 98.8 }), sig('Fib %61.8', { detector: 'fibonacci', group: 'fib', target: 104 })] },
  clusters: [], candles: [], live: null, ...over,
});

test('buildPlan: long bölge planı, stop bölge altı, TP R:R ≥ 2', () => {
  const p = buildPlan(row());
  assert.ok(p.ok, p.reason);
  assert.equal(p.entry, 100); // bölgenin üst kenarı
  assert.ok(p.stop < 99, `stop ${p.stop}`);
  assert.ok(p.tp2 > p.tp1 && p.tp1 > p.entry);
  assert.ok(p.rr >= 2, `rr ${p.rr}`);
  assert.equal(p.status, 'waiting');
  assert.ok(p.mtf && p.mtf.tfs.length === 2);
});

test('buildPlan: red durumları', () => {
  assert.equal(buildPlan(row({ score: 30, mtf: null })).ok, false);
  assert.equal(buildPlan(row({ price: 110 })).ok, false); // bölge çok uzak
  assert.equal(buildPlan(row({ price: 97 })).ok, false); // fiyat bölgeyi geçmiş
  assert.equal(buildPlan(row(), { requireMtf: true, }).ok, true);
  assert.equal(buildPlan(row({ mtf: null }), { requireMtf: true }).ok, false);
});

test('buildPlan: short ayna', () => {
  const r = row({ price: 98, direction: 'short', mtf: null, best: { direction: 'short', score: 70, zone: [99, 100], groups: new Set(['smc']), signals: [sig('OB ↓', { direction: 'short', invalidation: 100.3 })] } });
  const p = buildPlan(r);
  assert.ok(p.ok, p.reason);
  assert.equal(p.entry, 99);
  assert.ok(p.stop > 100 && p.tp1 < 99 && p.tp2 < p.tp1);
});

test('positionSize: risk %1', () => {
  const p = buildPlan(row());
  const s = positionSize(p, 10000, 1);
  assert.equal(s.riskUsd, 100);
  assert.ok(Math.abs(s.qty * p.risk - 100) < 1, `qty×risk ${s.qty * p.risk}`); // qty 4 anlamlı haneye yuvarlanır
  assert.equal(positionSize(p, 0, 1), null);
});

test('trackPlan: bekliyor → aktif → tp1 → tamam; stop; süre dolumu', () => {
  const base = { d: 1, direction: 'long', entry: 100, stop: 98.5, tp1: 102, tp2: 104, sentAt: 1000, status: 'waiting' };
  const c = (time, low, high) => ({ time, low, high, open: low, close: high });
  let r = trackPlan(base, [c(2000, 100.5, 101), c(3000, 99.8, 101), c(4000, 100, 102.5), c(5000, 101, 104.2)]);
  assert.equal(r.status, 'done'); assert.deepEqual(r.events, ['active', 'tp1', 'done']);
  r = trackPlan(base, [c(2000, 99.8, 101), c(3000, 98.4, 100)]);
  assert.equal(r.status, 'stopped');
  // Aynı mumda stop ve TP1: stop sayılır
  r = trackPlan({ ...base, status: 'active' }, [c(2000, 98, 103)]);
  assert.equal(r.status, 'stopped');
  // Girişsiz TP1
  r = trackPlan(base, [c(2000, 100.5, 102.5)]);
  assert.equal(r.status, 'missed');
  // Süre dolumu
  r = trackPlan(base, [], 1000 + 25 * 3600e3);
  assert.equal(r.status, 'expired');
  // sentAt öncesi mumlar sayılmaz
  r = trackPlan(base, [c(500, 90, 110)], 2000);
  assert.equal(r.status, 'waiting');
});

test('onCooldown: aynı anahtar / aynı coin+yön+tf', () => {
  const p = buildPlan(row());
  const now = Date.now();
  assert.equal(onCooldown(p, [{ ...p, sentAt: now - 3600e3 }], now, 6), true);
  assert.equal(onCooldown(p, [{ ...p, sentAt: now - 7 * 3600e3 }], now, 6), false);
  assert.equal(onCooldown(p, [{ ...p, key: 'x', tf: '4H', sentAt: now }], now, 6), false);
});

test('validateDecision: kural ihlalleri kural motoruna döner', () => {
  const p = buildPlan(row());
  const good = { trade: 'take', direction: 'long', entry_low: 99.2, entry_high: 100, stop: 98.6, tp1: 102, tp2: 104, confidence: 'orta', reason: 'ok', invalidation: 'x', evidence: ['a'] };
  const v = validateDecision(good, p, { minRR: 2 });
  assert.deepEqual(v.adjusted, []);
  assert.ok(v.sendable);
  const bad = { ...good, direction: 'short', stop: 101, tp1: 99, tp2: 98, entry_low: 120, entry_high: 121 };
  const w = validateDecision(bad, p, { minRR: 2 });
  assert.equal(w.direction, 'long');
  assert.ok(w.adjusted.includes('giriş bölgesi') && w.adjusted.includes('stop') && w.adjusted.includes('tp1'));
  assert.ok(w.rr >= 2);
  assert.equal(validateDecision({ ...good, trade: 'skip' }, p).sendable, false);
  assert.equal(validateDecision({ ...good, trade: 'wait', confidence: 'düşük' }, p).sendable, false);
  assert.equal(validateDecision({ ...good, trade: 'wait', confidence: 'yüksek' }, p).sendable, true);
});

test('askBrain: sahte fetch ile istek gövdesi ve yanıt ayrıştırma', async () => {
  const p = buildPlan(row());
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    const content = JSON.stringify({ trade: 'take', direction: 'long', entry_low: 99, entry_high: 100, stop: 98.6, tp1: 102, tp2: 104, confidence: 'yüksek', reason: 'r', invalidation: 'i', evidence: ['e1'] });
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: content }] }) };
  };
  const dec = await askBrain(p, { minRR: 2, riskPct: 1, htf: [] }, { apiKey: 'k', fetchImpl });
  assert.equal(dec.trade, 'take');
  assert.equal(captured.init.headers['x-api-key'], 'k');
  assert.equal(captured.body.model, 'claude-opus-5-5');
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.deepEqual(captured.body.output_config.format.schema, SCHEMA);
  assert.equal(captured.body.fallbacks, 'default');
  assert.ok(buildPrompt(p, { minRR: 2 }).includes('BTCUSDT'));
  await assert.rejects(askBrain(p, {}, { apiKey: '', fetchImpl }), /ANTHROPIC_API_KEY/);
});

test('telegram biçimleri', () => {
  const p = buildPlan(row());
  const v = validateDecision({ trade: 'take', direction: 'long', entry_low: 99, entry_high: 100, stop: 98.6, tp1: 102, tp2: 104, confidence: 'orta', reason: 'Neden <b>', invalidation: 'inv', evidence: ['e'] }, p);
  const m = formatSetup(p, v, positionSize({ ...p, entry: v.entry, risk: v.entry - v.stop }, 5000, 1));
  assert.ok(m.includes('İŞLEM ADAYI') && m.includes('BTC') && m.includes('LONG') && m.includes('&lt;b&gt;') && m.includes('TradingView'));
  assert.ok(formatUpdate({ ...p, entry: 100, stop: 98.6, tp1: 102, tp2: 104 }, 'tp1', 102.3).includes('TP1'));
  assert.ok(formatSummary({ sent: 3, active: 1, tp1: 0, done: 1, stopped: 1, expired: 0, missed: 0 }, [{ coin: 'ETH', tf: '4H', direction: 'short', status: 'waiting', entry: 1, stop: 2 }], Date.now()).includes('ETH'));
  assert.equal(esc('a<b>&'), 'a&lt;b&gt;&amp;');
});
