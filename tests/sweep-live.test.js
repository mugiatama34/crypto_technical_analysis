// Canlıya eşit tarama (13.11): canlı 4H kural zinciri (liveRuleOf / liveCheck / liveCooldown), htfStrict, yön kırılımı,
// plan dosyası ek alanları (mtfBt, cd) ve mevcut live4h satır adlarının değişmediği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveRuleOf, liveCheck, liveCooldown, passes, dirSplit, merge, capLists, targetedLists, liveVariants, LIVE_NAME_A, LIVE_NAME_B } from '../backtest/sweep.mjs';
import { mtfAt, simulateWithExtras, cooldownSkippedOf } from '../backtest/plans.js';
import { simulateSeries, BT_DEFAULTS } from '../backtest/engine.js';
import { expectedOf } from '../bot/review/metrics.js';
import { build, randomWalk } from './helpers.js';

const H4 = 4 * 3600e3, DAY = 86400e3;
const T0 = 200 * DAY; // plan zamanı (BTC günlük serisinin içinde)
const plan = (o = {}) => ({ key: 'X|4H|long|5', coin: 'X', tf: '4H', direction: 'long', d: 1, score: 70, trend: { adx: 35, aligned: true, emaSide: true }, ...o });
const shortPlan = (o = {}) => plan({ key: 'X|4H|short|5', direction: 'short', d: -1, score: 80, ...o });
const mtf = (direction, score = 80, tfs = ['1H', '4H']) => ({ tfs: ['1H', '4H'], align: { direction, tfs, score } });
// BTC günlük: 0..250. gün; yükselen ya da düşen seri (kapanış EMA50'nin üstünde / altında)
const daily = (up) => Array.from({ length: 250 }, (_, k) => { const p = up ? 100 + k : 400 - k; return { time: k * DAY, open: p, high: p + 1, low: p - 1, close: p }; });

test('liveRuleOf: canlı 4H long / short kuralı (TF_RULES_DEFAULT + SHORT_RULE_DEFAULT, Variables ile 15m/1H kapalı)', () => {
  const L = liveRuleOf('4H', 'long'), S = liveRuleOf('4H', 'short');
  assert.equal(L.minScore, 65); assert.equal(L.requireMtf, false); assert.equal(L.cooldownHours, 6); assert.ok(!L.trendAdxMin); assert.ok(!L.btcRegime);
  assert.equal(S.minScore, 75); assert.equal(S.requireMtf, true); assert.equal(S.trendAdxMin, 30); assert.equal(S.trendEma, true); assert.equal(S.btcRegime, 'with'); assert.equal(S.cooldownHours, 12);
  assert.equal(liveRuleOf('1H', 'long').off, true); assert.equal(liveRuleOf('15m', 'short').off, true);
});

test('liveCheck long: puan ≥ 65 geçer; düşük puan MTF ile yükselirse geçer; MTF alanı yoksa bilinmiyor (elenir)', () => {
  const t = (p, m) => ({ tf: '4H', time: T0, plan: p, ...(m ? { mtfBt: m } : {}) });
  assert.equal(liveCheck(t(plan({ score: 66 }))).ok, true); // MTF gerekmez
  const low = liveCheck(t(plan({ score: 60 })));
  assert.equal(low.ok, false); assert.equal(low.unknown, 'mtf'); assert.equal(low.cooldownHours, 6);
  assert.equal(liveCheck(t(plan({ score: 60 }), mtf('long', 70))).ok, true); // puan = max(60, 70)
  const noAlign = liveCheck(t(plan({ score: 60 }), { tfs: ['1H', '4H'], align: null }));
  assert.equal(noAlign.ok, false); assert.equal(noAlign.unknown, undefined); assert.equal(noAlign.reason, 'puan');
  assert.equal(liveCheck(t(plan({ score: 60 }), mtf('short', 90))).ok, false); // ters yönde MTF puanı sayılmaz
  assert.equal(liveCheck(t(plan({ score: 60 }), mtf('long', 90, ['4H']))).ok, false); // tek TF uyum değil
  assert.equal(liveCheck({ tf: '1H', time: T0, plan: plan({ tf: '1H' }) }).reason, 'TF kapalı');
});

test('liveCheck short: puan 75 + MTF + ADX ≥ 30 yön uyumlu + EMA200 + BTC günlük düşüş; her madde geçer / elenir / veri yok', () => {
  const down = { btcDaily: daily(false) }, up = { btcDaily: daily(true) };
  const t = (p = {}, m = mtf('short'), extra = {}) => ({ tf: '4H', time: T0, plan: shortPlan(p), ...(m ? { mtfBt: m } : {}), ...extra });
  const ok = liveCheck(t(), down);
  assert.equal(ok.ok, true); assert.equal(ok.cooldownHours, 12);
  // puan
  assert.equal(liveCheck(t({ score: 70 }, mtf('short', 74)), down).reason, 'puan');
  assert.equal(liveCheck(t({ score: 70 }, mtf('short', 76)), down).ok, true);
  // MTF
  assert.equal(liveCheck(t({}, mtf('long')), down).reason, 'MTF uyumu yok');
  assert.equal(liveCheck(t({}, null), down).unknown, 'mtf');
  // ADX / DI / EMA200
  assert.equal(liveCheck(t({ trend: { adx: 25, aligned: true, emaSide: true } }), down).reason, 'ADX');
  assert.equal(liveCheck(t({ trend: { adx: null, aligned: true, emaSide: true } }), down).reason, 'ADX'); // canlı da eler
  assert.equal(liveCheck(t({ trend: { adx: 40, aligned: false, emaSide: true } }), down).reason, 'DI yönü uyumsuz');
  assert.equal(liveCheck(t({ trend: { adx: 40, aligned: true, emaSide: false } }), down).reason, 'EMA200');
  assert.equal(liveCheck(t({ trend: undefined }), down).unknown, 'trend');
  // BTC rejimi
  assert.equal(liveCheck(t(), up).reason, 'BTC rejimi ters');
  assert.equal(liveCheck(t(), {}).unknown, 'regime');
  assert.equal(liveCheck(t({}, mtf('short'), { time: 10 * DAY }), down).reason, 'BTC rejimi bilinmiyor'); // EMA50 için gün yetmez
  // long'a short kuralı uygulanmaz (BTC yükselişi / ADX önemsiz)
  assert.equal(liveCheck({ tf: '4H', time: T0, plan: plan({ trend: { adx: 5, aligned: false, emaSide: false } }) }, up).ok, true);
});

test('liveCooldown: yalnız gönderilen planlar süreyi tüketir; long 6 s, short 12 s; başka coin etkilenmez', () => {
  const L = (time, coin = 'X') => ({ t: { time, tf: '4H', coin, plan: plan({ coin, key: `${coin}|4H|long|5` }) }, hours: 6 });
  const S = (time) => ({ t: { time, tf: '4H', coin: 'X', plan: shortPlan() }, hours: 12 });
  const kept = liveCooldown([L(T0 + 2 * H4), L(T0), L(T0 + H4), L(T0 + H4, 'Y'), S(T0), S(T0 + 2 * H4), S(T0 + 3 * H4), S(T0 + 4 * H4)]);
  const sig = kept.map((x) => `${x.t.coin}${x.t.plan.d === 1 ? 'L' : 'S'}${(x.t.time - T0) / H4}`);
  // long: 0 gönderildi, +4 s elendi, +8 s geçti; Y ayrı; short: 0, +8 s ve +12 s elendi (sınır dahil), +16 s geçti
  assert.deepEqual(sig.sort(), ['XL0', 'XL2', 'XS0', 'XS4', 'YL1'].sort());
  // Elenmiş (gönderilmemiş) plan süre tüketmez: +4 s listede yoksa +8 s yine geçer
  assert.equal(liveCooldown([L(T0), L(T0 + 2 * H4)]).length, 2);
});

test('passes htfStrict: üst TF serisi yoksa eski varyant geçer, canlıya eşit elenir', () => {
  const t = { coin: 'X', tf: '4H', time: T0, plan: { ...plan(), groups: [], signals: [], inZone: false, price: 1 } };
  const series = { idx: new Map([[T0, 0]]), adx: { adx: [], pdi: [], mdi: [] }, ema200: [] };
  assert.equal(passes(t, { htfTrend: 'with' }, series, new Map(), new Map()), true);
  assert.equal(passes(t, { htfTrend: 'with', htfStrict: true }, series, new Map(), new Map()), false);
});

test('dirSplit: long / short eğitim ve doğrulama ayrı', () => {
  const tr = [{ d: 1, outcome: 'tp2', R: 2, time: 1 }, { d: -1, outcome: 'stopped', R: -1, time: 2 }], va = [{ d: -1, outcome: 'tp2', R: 1, time: 3 }];
  const x = dirSplit(tr, va);
  assert.equal(x.long.train.n, 1); assert.equal(x.long.train.avgR, 2); assert.equal(x.long.valid.n, 0);
  assert.equal(x.short.train.avgR, -1); assert.equal(x.short.valid.avgR, 1);
});

test('mevcut live4h satır adları değişmedi; canlıya eşit adları ayrı ve denetçi sonekleriyle bitmez', () => {
  const C = capLists().map(merge).map((v) => v.name), T = targetedLists().map(merge).map((v) => v.name);
  const pre = 'düşen bıçak koruması (teyit mumu) + hafta sonu hariç + yalnız limit giriş + yalnız 4H + elle yönetim: +%1,2 fiyatta %80 kapat, kalan başabaş → TP2 + üst TF eğilimi aynı yön';
  assert.equal(C[0], pre);
  assert.ok(C.includes(`${pre} + dolum mumunda sıra 1H ile`));
  assert.ok(C.includes(`${pre} + 3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H`));
  assert.ok(C.includes(`${pre} + bıçak kararı: dokunan 1H mumun sonuna kadar · sıra 1H`));
  assert.ok(C.includes('hafta sonu hariç + yalnız limit giriş + yalnız 4H + elle yönetim: +%1,2 fiyatta %80 kapat, kalan başabaş → TP2 + üst TF eğilimi aynı yön + bıçak koruması yok · sıra 1H'));
  assert.equal(C.length, 49); assert.equal(T.length, 10);
  const L = liveVariants();
  assert.deepEqual(L.map((v) => v.name), [LIVE_NAME_A, LIVE_NAME_B]);
  for (const v of L) {
    assert.ok(v.name.startsWith('canlıya eşit: ')); assert.equal(v.live, true); assert.equal(v.htfStrict, true); assert.equal(v.fillBarTp, 'lower');
    assert.ok(!v.name.endsWith('3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H') && !v.name.endsWith('dolum mumunda sıra 1H ile'));
    assert.ok(!C.includes(v.name));
  }
  assert.equal(L[0].tp1Portion, 0.5); assert.equal(L[0].midStopToTp1, true); assert.equal(L[1].tp1Portion, 0.8); assert.ok(!L[1].midTp);
  // Denetçi: canlıya eşit satırları önde olsa da live4h satırını seçer
  const row = (name) => ({ targeted: true, name, train: { n: 1, avgR: 0 }, valid: { n: 1, avgR: 0 } });
  assert.equal(expectedOf({ results: [...L.map((v) => row(v.name)), row(`${pre} + 3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H`)] }).name, `${pre} + 3 kademe + TP1 sonrası stop erken hedefe: erken %1.2 · sıra 1H`);
});

// 1H fixture serisi (backtest.test.js ile aynı) ve ondan toplanan 4H serisi
const BULL = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119], [90, 140], [100, 128]];
const c1h = [...build([[0, 120], [400, 120]], { tfMs: 3600e3 }), ...build(BULL.map(([b, p]) => [b + 400, p]), { tfMs: 3600e3 }), ...randomWalk(200, { seed: 5 }).map((x, i) => ({ ...x, time: (500 + i) * 3600e3, open: x.open + 28, high: x.high + 28, low: x.low + 28, close: x.close + 28 }))];
const agg = (cs, ms) => { const m = new Map(); for (const x of cs) { const k = Math.floor(x.time / ms) * ms; const g = m.get(k); if (!g) m.set(k, { time: k, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0 }); else { g.high = Math.max(g.high, x.high); g.low = Math.min(g.low, x.low); g.close = x.close; g.volume += x.volume || 0; } } return [...m.values()]; };
const c4h = agg(c1h, H4);
const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0, plan: { minScore: 30, minRR: 2, maxRiskPct: 50 } };

test('mtfAt: karar anında kapanmış diğer TF mumları; geleceğe bakmaz; veri yoksa TF bakılmamış', () => {
  const p = { coin: 'T', direction: 'long', score: 60, clusterScore: 60 };
  const dec = c1h[450].time + 3600e3;
  const m = mtfAt(p, '1H', dec, { '4H': c4h });
  assert.deepEqual(m.tfs, ['1H', '4H']);
  if (m.align) { assert.ok(['long', 'short'].includes(m.align.direction)); assert.ok(m.align.tfs.length >= 1); }
  // Karar anından sonraki 4H mumları değişse de sonuç aynı (geleceğe bakmaz)
  const future = c4h.map((x) => (x.time + H4 > dec ? { ...x, high: x.high * 2, low: x.low / 2, close: x.close * 1.5 } : x));
  assert.deepEqual(mtfAt(p, '1H', dec, { '4H': future }), m);
  // Karar anında kapanmış 4H mumu yok → yalnız kendi TF'si, uyum yok
  assert.deepEqual(mtfAt(p, '1H', c4h[0].time + 1000, { '4H': c4h }), { tfs: ['1H'], align: null });
});

test('simulateWithExtras: simüle edilen planlar simulateSeries ile aynı; bekleme süresi atlananlar cd, mtfBt eklenir', () => {
  const base = simulateSeries({ coin: 'T', instId: 'T', tf: '1H', candles: c1h }, o);
  const ext = simulateWithExtras({ coin: 'T', instId: 'T', tf: '1H', candles: c1h }, o, { '4H': c4h });
  assert.equal(ext.length, base.length);
  assert.deepEqual(ext.map(({ cd, mtfBt, ...t }) => t), base);
  for (const t of ext) assert.ok(t.mtfBt && Array.isArray(t.mtfBt.tfs));
  const skipped = cooldownSkippedOf(ext);
  assert.ok(skipped.length > 0, 'fixture serisinde ardışık planlar bekleme süresine takılmalı');
  for (const t of ext) for (const x of t.cd || []) {
    assert.ok(x.time > t.time && x.time - t.time <= 6 * 3600e3, 'atlatan plan 6 saat içinde (sınır dahil)'); // motorun bekleme süresi
    assert.equal(x.plan.direction, t.direction); assert.ok(x.mtfBt);
  }
  for (const x of skipped) { assert.equal(x.cd, true); assert.equal(x.tf, '1H'); assert.ok(x.plan.entry > 0); }
  // others yoksa (canlıda kapalı TF) ek alan yok: ne mtfBt ne cd — plan dosyası 1H atlananlarıyla şişmesin (koşu 43435631728)
  const plain = simulateWithExtras({ coin: 'T', instId: 'T', tf: '1H', candles: c1h }, o, null);
  assert.ok(plain.every((t) => t.mtfBt === undefined && t.cd === undefined));
  // tek TF'lik koşu (others = {}): cd saklanır, mtfBt yok
  const solo = simulateWithExtras({ coin: 'T', instId: 'T', tf: '1H', candles: c1h }, o, {});
  assert.equal(cooldownSkippedOf(solo).length, skipped.length);
});
