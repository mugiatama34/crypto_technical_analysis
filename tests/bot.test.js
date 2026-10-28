import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, positionSize, trackPlan, onCooldown, CLOSED, isWeekendUtc, mergeRule, earlyTpOf, earlyPriceOf, orphansOf } from '../bot/plan.js';
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
  assert.equal(validateDecision({ ...good, trade: 'wait', confidence: 'orta' }, p).sendable, false); // varsayılan 'high'
  assert.equal(validateDecision({ ...good, trade: 'wait', confidence: 'orta' }, p, { sendWait: 'medium' }).sendable, true);
  assert.equal(validateDecision({ ...good, trade: 'wait', confidence: 'yüksek' }, p, { sendWait: 'none' }).sendable, false);
  assert.equal(validateDecision({ ...good, trade: 'take', confidence: 'düşük' }, p, { sendWait: 'none' }).sendable, true);
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
  assert.ok(!m.includes('kural motoru'));
  assert.ok(formatSetup(p, { ...v, source: 'rules' }, null).includes('İŞLEM ADAYI (kural motoru)'));
  assert.ok(formatUpdate({ ...p, entry: 100, stop: 98.6, tp1: 102, tp2: 104 }, 'tp1', 102.3).includes('TP1'));
  assert.ok(formatSummary({ sent: 3, active: 1, tp1: 0, done: 1, stopped: 1, expired: 0, missed: 0 }, [{ coin: 'ETH', tf: '4H', direction: 'short', status: 'waiting', entry: 1, stop: 2 }], Date.now()).includes('ETH'));
  assert.equal(esc('a<b>&'), 'a&lt;b&gt;&amp;');
});

test('entryZone: geniş küme bölgesi çekirdek sinyale / 1,5 ATR dilime daralır, risk % sınırı', async () => {
  const { entryZone } = await import('../bot/plan.js');
  const wide = { zone: [90, 100], signals: [sig('OB ↑', { zone: [97, 100], strength: 0.9 }), sig('FVG ↑', { zone: [98, 99.5], strength: 0.6 }), sig('Fib', { zone: [90, 92], strength: 0.4 })] };
  const z = entryZone(wide, 1, 1, 1.5);
  assert.ok(z[1] - z[0] <= 1.5 + 1e-9 && z[0] >= 97, `zone ${z}`);
  // Çekirdek bölge 4 ATR genişse yakın kenardan 1,5 ATR
  const z2 = entryZone({ zone: [90, 100], signals: [sig('X', { zone: [94, 100], strength: 0.9 })] }, 1, 1, 1.5);
  assert.deepEqual(z2, [98.5, 100]);
  const z3 = entryZone({ zone: [90, 100], signals: [sig('X', { direction: 'short', zone: [90, 96], strength: 0.9 })] }, -1, 1, 1.5);
  assert.deepEqual(z3, [90, 91.5]);
  // Risk % sınırı: ATR fiyata göre büyükse plan elenir
  const r = row({ price: 10.1, atr: 1, best: { direction: 'long', score: 70, zone: [9, 10], groups: new Set(['smc']), signals: [sig('OB', { zone: [9, 10] })] } });
  assert.equal(buildPlan(r, { maxRiskPct: 5 }).ok, false);
  assert.equal(buildPlan(r, { maxRiskPct: 20 }).ok, true);
});

test('buildPlan: trend filtreleri (ADX ≥ eşik + DI yönü, EMA200 tarafı)', () => {
  const base = row();
  assert.equal(buildPlan({ ...base, trend: { adx: 20, pdi: 30, mdi: 10, ema200: 90 } }, { trendAdxMin: 35 }).ok, false);
  assert.equal(buildPlan({ ...base, trend: { adx: 40, pdi: 10, mdi: 30, ema200: 90 } }, { trendAdxMin: 35 }).ok, false); // yön uyumsuz
  const ok = buildPlan({ ...base, trend: { adx: 40, pdi: 30, mdi: 10, ema200: 90, time: 5 } }, { trendAdxMin: 35, trendEma: true });
  assert.ok(ok.ok && ok.trend.aligned && ok.trend.emaSide && ok.time === 5);
  assert.equal(buildPlan({ ...base, trend: { adx: 40, pdi: 30, mdi: 10, ema200: 110 } }, { trendEma: true }).ok, false); // fiyat EMA altında
  assert.ok(buildPlan({ ...base }, { trendEma: false }).ok); // trend alanı yoksa filtre yok
});

test('mergeRule: TF ← yön ← short kuralı; BTC rejimi şartı', async () => {
  const { mergeRule } = await import('../bot/plan.js');
  const rules = { '1H': { minScore: 70, requireMtf: true, trendAdxMin: 25 }, '15m': { minScore: 80, trendAdxMin: 35, maxPerRun: 1, long: { minScore: 85 } } };
  const sr = { scoreAdd: 10, trendAdxMin: 30, btcRegime: 'with', cooldownHours: 12 };
  const base = { minScore: 70, requireMtf: false, cooldownHours: 6 };
  assert.deepEqual(mergeRule('1H', 'long', rules, sr, base), { minScore: 70, requireMtf: true, cooldownHours: 6, trendAdxMin: 25 });
  const s1 = mergeRule('1H', 'short', rules, sr, base);
  assert.equal(s1.minScore, 80); assert.equal(s1.trendAdxMin, 30); assert.equal(s1.btcRegime, 'with'); assert.equal(s1.cooldownHours, 12);
  assert.equal(mergeRule('15m', 'short', rules, sr, base).trendAdxMin, 35); // TF daha sıkı: korunur
  assert.equal(mergeRule('15m', 'short', rules, sr, base).maxPerRun, 1);
  assert.equal(mergeRule('15m', 'long', rules, sr, base).minScore, 85); // yön alt kuralı
});

test('buildPlan: btcRegime with → long yalnız yükselişte, short yalnız düşüşte', () => {
  const r = row();
  assert.equal(buildPlan(r, { btcRegime: 'with', regime: 'down' }).reason, 'BTC rejimi ters');
  assert.equal(buildPlan(r, { btcRegime: 'with', regime: null }).reason, 'BTC rejimi bilinmiyor');
  const ok = buildPlan(r, { btcRegime: 'with', regime: 'up' });
  assert.ok(ok.ok); assert.equal(ok.regime, 'up');
  assert.ok(buildPlan(r, { regime: 'down' }).ok); // şart yoksa rejim engellemez
});

test('buildPlan: rsBtc with → long yalnız BTC\'den güçlü coinde, short yalnız zayıfta; plan trend rsBtc taşır', () => {
  const base = row();
  const mk = (rs, side) => ({ ...base, coin: 'ETH', trend: { ...(base.trend || {}), rsBtc: rs, rsSide: side } }); // BTC satırına filtre uygulanmaz
  assert.equal(buildPlan(mk(2.5, 1), { rsBtc: 'with' }).ok, true);
  assert.equal(buildPlan(mk(2.5, 1), { rsBtc: 'with' }).trend.rsBtc, 2.5);
  assert.equal(buildPlan(mk(-2.5, -1), { rsBtc: 'with' }).reason, 'BTC\'ye göre zayıf');
  assert.equal(buildPlan(mk(2.5, -1), { rsBtc: 'with' }).reason, 'BTC\'ye göre zayıf'); // orta vade zayıf
  assert.equal(buildPlan(mk(null, null), { rsBtc: 'with' }).reason, 'BTC göreli gücü bilinmiyor');
  assert.equal(buildPlan(mk(-2.5, -1), {}).ok, true); // şart yoksa engel yok
});

test('çok ufuklu rejim: 1H short, günlük yükseliş ama 4H düşüşte geçer; 4H short günlük yükselişte ret', async () => {
  const { regimeFor } = await import('../src/scan/regime.js');
  const read = { daily: 'up', h4: 'down', h1: 'down' };
  const shortRow = row({ coin: 'ETH', direction: 'short', best: { ...row().best, direction: 'short', zone: [102, 103], signals: [sig('OB ↓', { direction: 'short', zone: [102, 103], invalidation: 103.5, strength: 0.9 })] }, mtf: { direction: 'short', score: 75, tfs: ['1H', '4H'], conflicting: [] } });
  const p1 = buildPlan({ ...shortRow, tf: '1H' }, { btcRegime: 'with', regime: regimeFor('1H', read), minRR: 1 });
  assert.ok(p1.ok, p1.reason); assert.equal(p1.regime, 'down');
  const p4 = buildPlan({ ...shortRow, tf: '4H' }, { btcRegime: 'with', regime: regimeFor('4H', read), minRR: 1 });
  assert.equal(p4.reason, 'BTC rejimi ters');
  const pl = buildPlan(row({ coin: 'ETH', tf: '1H' }), { btcRegime: 'with', regime: regimeFor('1H', read) });
  assert.equal(pl.reason, 'BTC rejimi ters'); // 4H düşüşte 1H long yok
});

test('trackPlan: düşen bıçak koruması — confirming → active (teyit kapanışı) / knife / unconfirmed; kapalıyken eski davranış', () => {
  const H = 3600e3;
  const k = (i, open, high, low, close) => ({ time: i * H, open, high, low, close });
  const base = { d: 1, direction: 'long', tf: '1H', entry: 100, stop: 97, tp1: 104, tp2: 108, zone: [99.5, 100], atr: 1, sentAt: 0, status: 'waiting' };
  const drop = [k(1, 102.5, 102.8, 102.2, 102.5), k(2, 102.5, 102.5, 100.5, 100.6), k(3, 100.6, 100.6, 99.2, 99.4)];
  const up = [k(4, 99.4, 99.8, 98.9, 99.6), k(5, 99.6, 100.4, 99.5, 100.3), k(6, 100.3, 104.5, 100.2, 104.2), k(7, 104, 108.5, 103.8, 108)];
  const now = 9 * H;
  assert.deepEqual(trackPlan(base, [...drop, ...up], now).events, ['active', 'tp1', 'done']);
  let r = trackPlan(base, [...drop, ...up], now, { knifeGuard: '1' });
  assert.deepEqual(r.events, ['confirming', 'active', 'tp1', 'done']);
  assert.equal(r.patch.entry, 100.3); assert.equal(r.patch.entryPlanned, 100); assert.equal(r.patch.approachAtr, 3.6);
  // Koşular arası: önce yalnız düşüş (confirming), sonra devamı
  r = trackPlan(base, drop, 3.5 * H, { knifeGuard: true });
  assert.equal(r.status, 'confirming');
  const p2 = { ...base, ...r.patch, status: r.status };
  r = trackPlan(p2, [...drop, up[0], { ...up[1], time: 5 * H }], 5.5 * H, { knifeGuard: true });
  assert.equal(r.status, 'confirming'); // 5. mum henüz kapanmadı
  r = trackPlan(p2, [...drop, ...up], now, { knifeGuard: true });
  assert.equal(r.status, 'done');
  // Teyitten önce stop → knife (kapalı durum)
  r = trackPlan(base, [...drop, k(4, 99.4, 99.5, 96.8, 97), ...up], now, { knifeGuard: true });
  assert.equal(r.status, 'knife'); assert.ok(CLOSED.has('knife'));
  // 3 mum teyit yok → süre doldu
  const flat = [k(4, 99.4, 99.6, 99, 99.3), k(5, 99.3, 99.6, 99, 99.3), k(6, 99.3, 99.6, 99, 99.3)];
  r = trackPlan(base, [...drop, ...flat], now, { knifeGuard: true });
  assert.deepEqual([r.status, r.events.at(-1)], ['expired', 'unconfirmed']);
  assert.match(formatUpdate({ ...base, approachAtr: 3.6, fillBarAtr: 1.4 }, 'confirming', 99.4), /düşen bıçak.*3\.6×ATR/s);
});

test('isWeekendUtc ve kayıp kesici kural alanları (off/limitOnly/skipWeekend) mergeRule ile birleşir', () => {
  assert.equal(isWeekendUtc(Date.parse('2026-10-24T00:00:00Z')), true); // Cumartesi
  assert.equal(isWeekendUtc(Date.parse('2026-10-25T23:59:00Z')), true); // Pazar
  assert.equal(isWeekendUtc(Date.parse('2026-10-26T00:00:00Z')), false); // Pazartesi
  const base = { minScore: 70, limitOnly: true, skipWeekend: true };
  const rules = { '15m': { off: true, minScore: 80 }, '1H': { long: { limitOnly: false } } };
  assert.equal(mergeRule('15m', 'long', rules, null, base).off, true);
  assert.equal(mergeRule('1H', 'long', rules, null, base).limitOnly, false);
  const s = mergeRule('1H', 'short', rules, { scoreAdd: 10 }, base);
  assert.deepEqual([s.limitOnly, s.skipWeekend, s.minScore, s.off], [true, true, 80, undefined]);
  assert.equal(mergeRule('1H', 'long', { '1H': { htfTrend: 'with' } }, null, { htfTrend: 'notAgainst' }).htfTrend, 'with');
  assert.equal(mergeRule('4H', 'long', {}, null, { htfTrend: 'notAgainst' }).htfTrend, 'notAgainst');
});

test('trackPlan: zaman stopu — active, N kapanmış mumda TP1 yok → timeout (time_stop); kapalıyken eski davranış', () => {
  const H = 3600e3;
  const k = (i, low, high, close) => ({ time: i * H, open: close, low, high, close });
  const base = { d: 1, direction: 'long', tf: '1H', entry: 100, stop: 98, tp1: 103, tp2: 106, sentAt: 0, status: 'waiting' };
  const cs = [k(1, 99.8, 100.5, 100.2), k(2, 99.5, 101, 100.6), k(3, 99.6, 101, 100.4), k(4, 99.6, 101, 100.8), k(5, 99.6, 101, 100.5)];
  assert.equal(trackPlan(base, cs, 9 * H).status, 'active');
  let r = trackPlan(base, cs, 9 * H, { timeStop: 4 });
  assert.deepEqual(r.events, ['active', 'time_stop']); assert.equal(r.status, 'timeout');
  assert.equal(r.patch.exitPrice, 100.8); assert.equal(r.patch.exitR, 0.4); assert.equal(r.patch.filledAt, H);
  assert.ok(CLOSED.has('timeout'));
  // 4. mum henüz kapanmadı → bekler
  assert.equal(trackPlan(base, cs.slice(0, 4), 4.5 * H, { timeStop: 4 }).status, 'active');
  // MFE 0,5R ≥ 0,5 → ilerleme stopu yok
  assert.equal(trackPlan(base, cs, 9 * H, { timeStop: '{"bars":4,"minMfeR":0.5}' }).status, 'active');
  assert.match(formatUpdate({ ...base, ...r.patch }, 'time_stop', 100.8), /Zaman stopu.*\+0\.4R/s);
});

test('erken kâr al: earlyTpOf/earlyPriceOf; trackPlan active → early → done / be; koşular arası earlyAt', () => {
  const e = earlyTpOf('{"pct":1.2}');
  assert.deepEqual(e, { portion: 0.8, tfs: ['4H'], pct: 1.2 });
  assert.equal(earlyTpOf(''), null);
  assert.equal(earlyPriceOf({ tf: '4H', d: 1 }, 100, e), 101.2);
  assert.equal(earlyPriceOf({ tf: '1H', d: 1 }, 100, e), null);
  assert.equal(earlyPriceOf({ tf: '4H', d: -1 }, 100, e), 98.8);
  const H = 4 * 3600e3;
  const k = (i, low, high) => ({ time: i * H, open: low, low, high, close: high });
  const base = { d: 1, direction: 'long', tf: '4H', entry: 100, stop: 97, tp1: 104, tp2: 108, early: 101.2, sentAt: 0, status: 'waiting' };
  let r = trackPlan(base, [k(1, 99.9, 100.5), k(2, 100.3, 101.5), k(3, 100.8, 108.2)], 9 * H);
  assert.deepEqual(r.events, ['active', 'early', 'done']);
  r = trackPlan(base, [k(1, 99.9, 100.5), k(2, 100.3, 101.5), k(3, 99.8, 100.6)], 9 * H);
  assert.deepEqual([r.status, r.events.at(-1)], ['be', 'be']); assert.ok(CLOSED.has('be'));
  r = trackPlan(base, [k(1, 99.9, 100.5), k(2, 96.5, 100.6)], 9 * H);
  assert.equal(r.status, 'stopped');
  // sonraki koşu: early durumundaki plan, earlyAt öncesi mumları (dolum mumu girişe dokunur) yok sayar
  r = trackPlan(base, [k(1, 99.9, 100.5), k(2, 100.3, 101.5)], 3 * H);
  const p2 = { ...base, ...r.patch, status: r.status };
  assert.equal(p2.status, 'early');
  assert.equal(trackPlan(p2, [k(1, 99.9, 100.5), k(2, 100.3, 101.5), k(3, 100.5, 102)], 9 * H).status, 'early');
});

test('orphansOf: durumda olmayan açık geçmiş kayıtları yeniden takibe; mumsuz bekleyen süre dolunca düşer', () => {
  const p = (key, sentAt, status) => ({ key, sentAt, status, coin: 'X', tf: '4H', d: 1, entry: 100, stop: 98, tp1: 103, tp2: 105 });
  const items = [{ id: 'a|1', ...p('a', 1, 'waiting') }, { id: 'b|2', ...p('b', 2, 'active') }, { id: 'c|3', ...p('c', 3, 'stopped') }];
  const o = orphansOf(items, [p('b', 2, 'active')]);
  assert.equal(o.length, 1);
  assert.equal(o[0].key, 'a'); assert.equal(o[0].orphan, true); assert.equal(o[0].id, undefined);
  const r = trackPlan(o[0], [], 1 + 25 * 3600e3);
  assert.equal(r.status, 'expired');
});
