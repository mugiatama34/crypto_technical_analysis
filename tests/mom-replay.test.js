// M0a yeniden oynatma (backtest/mom-replay.js): canlı portföy fonksiyonlarıyla 15 dk adımlı replay — düz fiyatta (maliyetsiz)
// özsermaye korunur; senkron testerede (alt ±%10, BTC ±%5) her adımda yeniden boyutlanan hedge zarar gerçekleştirir, hedge
// ayarı kapalı karşı-olgusalda zarar yok; seçim canlı listeye zorlanır; muhasebe kontrolü tutar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayLive, summarizeReplay, replayReport, marketAt } from '../backtest/mom-replay.js';

const DAY = 86400e3, M15 = 15 * 60e3;
const START = Date.UTC(2026, 9, 21, 10, 0, 49), DAY0 = Date.UTC(2026, 9, 21);
// Günlük: başlangıç gününden 100 gün önce → 5 gün sonra; X başlangıca kadar günde %1 düşer (BTC'ye göre zayıf), sonra düz; ±%10 fitil
const d1Of = (p0, slope) => Array.from({ length: 105 }, (_, k) => { const t = DAY0 - (100 - k) * DAY, c = p0 * (1 + slope) ** Math.min(0, k - 100), o = p0 * (1 + slope) ** Math.min(0, k - 101); return { time: t, open: o, high: Math.max(o, c) * 1.1, low: Math.min(o, c) * 0.9, close: c, volume: 1, quoteVol: 1e6 }; });
const m15Of = (f) => Array.from({ length: 4 * 96 }, (_, k) => { const t = DAY0 - DAY + k * M15, c = f(k), o = k ? f(k - 1) : c; return { time: t, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c }; });
const liveOf = () => ({ start: START, updatedAt: START + 2 * DAY, startEquity: 300, equity: 300, params: { side: 'short', rank: 'rel', hedge: true, k: 5 }, rebalances: [{ time: START, shorts: ['X'], longs: [], equity: 300 }], positions: [], trades: [], curve: [[START, 300], [START + DAY, 300]] });
const NOCOST = { feePct: 0, slipPct: 0, fundingPct8h: 0 };

test('piyasa görünümü: fiyat = t öncesi kapanmış son 15m kapanışı; günlük mumlar yalnız t gününden önce; canlı günlük mum bugünden', () => {
  const m15 = new Map([['X', m15Of((k) => 10 + k)]]), d1 = new Map([['X', d1Of(10, -0.01)]]);
  const t = DAY0 + 3 * M15 + 49e3;
  const m = marketAt('X', t, m15, d1);
  const k = 96 + 2; // DAY0 − 1 gün başlangıçlı; t'den önce kapanan son mum DAY0 + 2×15m
  assert.equal(m.price, 10 + k);
  assert.ok(m.daily.candles.every((c) => c.time < DAY0)); assert.equal(m.daily.candles.length, 69);
  assert.equal(m.daily.live.open, 10 + 95); assert.equal(m.daily.live.high, 10 + k);
});

test('düz fiyat, maliyet yok: özsermaye 300 korunur; seçim canlı listeye zorlanır; hedge açılır; muhasebe tutar', () => {
  const m15 = new Map([['X', m15Of(() => 10)], ['BTC', m15Of(() => 100)]]), d1 = new Map([['X', d1Of(10, -0.01)], ['BTC', d1Of(100, 0)]]);
  const R = replayLive(liveOf(), m15, d1, { overrides: NOCOST });
  assert.deepEqual(R.mismatches, []);
  assert.ok(R.pf.positions.some((q) => q.coin === 'X' && q.d === -1));
  assert.ok(R.pf.positions.some((q) => q.hedge && q.d === 1));
  for (const s of R.steps) assert.ok(Math.abs(s.eq - 300) < 1e-9);
  assert.ok(R.accountingCheck < 1e-9);
  const S = summarizeReplay(liveOf(), R);
  assert.equal(S.equity.totalUsd, 0); assert.equal(S.curve.finalDiff, 0); assert.ok(Math.abs(S.equity.itemsCheck) < 1e-6);
  // maliyetlerle: yalnız komisyon + kayma + fonlama kadar düşer
  const C = summarizeReplay(liveOf(), replayLive(liveOf(), m15, d1));
  assert.ok(C.equity.totalUsd < 0 && C.equity.totalUsd > -1);
});

test('senkron testere (X ±%10, BTC ±%5), her adımda hedge ayarı: zarar gerçekleşir; hedge ayarı kapalı: zarar yok', () => {
  const s = (k) => [0, 1, 0, -1][k % 4];
  const m15 = new Map([['X', m15Of((k) => 10 * (1 + 0.1 * s(k)))], ['BTC', m15Of((k) => 100 * (1 + 0.05 * s(k)))]]);
  const d1 = new Map([['X', d1Of(10, -0.01)], ['BTC', d1Of(100, 0)]]);
  const live = { ...liveOf(), updatedAt: START + 188 * M15 }; // son adımın fiyatı = giriş fiyatları (testere evresi −1, mum 323)
  const ov = { ...NOCOST, resizeTol: 0.001 };
  const rep = replayReport(live, m15, d1, { overrides: ov });
  assert.ok(rep.items.hedgeResize.n > 50);
  assert.ok(rep.items.hedgeResize.realizedUsd < -0.2, String(rep.items.hedgeResize.realizedUsd));
  assert.ok(rep.equity.totalUsd < -0.2);
  const cf = summarizeReplay(live, replayLive(live, m15, d1, { overrides: ov, hedgeResize: false }));
  assert.equal(cf.items.hedgeResize.n, 0);
  assert.ok(Math.abs(cf.equity.totalUsd) < 1e-6, String(cf.equity.totalUsd));
  // fiyatlar girişe döndü: short K/Z 0; zarar tamamen hedge bacağında (ayar gerçekleşeni + ortalama girişli açık hedge)
  assert.ok(Math.abs(rep.items.shortOpenNet) < 1e-6);
  assert.ok(Math.abs(rep.equity.totalUsd - (rep.items.hedgeResize.realizedUsd + rep.items.hedgeOpenNet)) < 0.02);
  assert.ok(rep.counterfactuals.noHedgeResize.diffVsBase > 0.2);
  assert.equal(typeof rep.finding, 'string');
  assert.ok(rep.topHourly.length > 0);
});
