// Ön kayıt docs/arastirma/on-kayit-adx-short.md: filtre eşlemesi (ADX adı, eşik, yön), dilim bölmesi, kümelenme, karar mantığı,
// canlı satır eşlemesi (13.11 taramasındaki 3 kademe + stop erkene satırı) ve veri aralıklarının iç içe olması.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADX, adxOfPlan, GROUPS, isPrimary, splitOf, inPeriod, verdictOf, sliceStats, clusteringOf, liveRowVariant, variantFor, periodReport, fetchRanges } from '../backtest/adx-short.js';

const DAY = 86400e3;
const sig = (name) => ({ name });

test('adx-short: ADX adı eşlemesi (yön oku, adı üreten yuvarlama, birden çok sinyalde en büyüğü)', () => {
  const plan = { signals: [sig('ADX 41 trend ↓'), sig('Fib 0.618'), sig('ADX 38 trend ↓'), sig('ADX 55 trend ↑')] };
  assert.equal(adxOfPlan(plan, '↓'), 41);
  assert.equal(adxOfPlan(plan, '↑'), 55);
  assert.equal(adxOfPlan({ signals: [sig('RSI 30')] }, '↓'), null);
  assert.equal(adxOfPlan({ signals: [sig('ADX 40 trend ↓ ekstra')] }, '↓'), null, 'ad tam eşleşmeli');
  assert.equal(adxOfPlan({}, '↓'), null);
  // Dedektörün adı: toFixed(0) → 39.6 "40" olur ve eşiği geçer (ön kayıt: "adı üreten yuvarlamayla")
  assert.equal(adxOfPlan({ signals: [sig(`ADX ${(39.6).toFixed(0)} trend ↓`)] }, '↓'), 40);
});

test('adx-short: birincil filtre = short + ADX ↓ ≥ 40; bilgi grupları', () => {
  const t = (d, adxDown, adxUp = null) => ({ d, adxDown, adxUp });
  assert.equal(isPrimary(t(-1, 40)), true);
  assert.equal(isPrimary(t(-1, 39)), false);
  assert.equal(isPrimary(t(1, 45)), false, 'long dahil değil');
  assert.equal(isPrimary(t(-1, null, 60)), false, 'ADX ↑ sayılmaz');
  assert.equal(GROUPS.allShorts.test(t(-1, null)), true);
  assert.equal(GROUPS.adx40Long.test(t(1, null, 40)), true);
  assert.equal(GROUPS.adx40Long.test(t(1, 45, null)), false);
  assert.equal(GROUPS.adx50Short.test(t(-1, 49)), false);
  assert.equal(GROUPS.adx50Short.test(t(-1, 50)), true);
  assert.equal(GROUPS.adxLt40Short.test(t(-1, 25)), true);
  assert.equal(GROUPS.adxLt40Short.test(t(-1, 40)), false);
  assert.equal(GROUPS.adxLt40Short.test(t(-1, null)), false);
  assert.equal(ADX.minAdx, 40);
});

test('adx-short: dönemler ve zamanla 2/3 bölünme', () => {
  const p = ADX.periods.independent;
  assert.equal(new Date(p.from).toISOString().slice(0, 10), '2023-11-13');
  assert.equal(new Date(p.to).toISOString().slice(0, 10), '2025-11-13');
  assert.equal(new Date(ADX.periods.seen.from).toISOString().slice(0, 10), '2025-11-13');
  const s = splitOf(p);
  assert.ok(Math.abs((s - p.from) / (p.to - p.from) - 2 / 3) < 1e-12);
  assert.equal(new Date(s).toISOString().slice(0, 10), '2025-03-14');
  assert.equal(inPeriod({ time: p.from }, p), true);
  assert.equal(inPeriod({ time: p.to }, p), false, 'bitiş hariç');
});

// Yapay dolan işlemler: n tane, R değerleri döngüyle; gün başına 1
const mk = (n, start, Rs, hR = Rs) => Array.from({ length: n }, (_, i) => ({ time: start + i * DAY, tf: '4H', waitBars: 1, outcome: 'stopped', R: Rs[i % Rs.length], hedgedR: hR[i % hR.length], hedgedROpen: hR[i % hR.length], d: -1, adxDown: 45 }));

test('adx-short: karar mantığı (sonucsuz / gecer / btc-yonu / gecmez)', () => {
  const split = 1000 * DAY;
  const both = (tr, va) => sliceStats([...tr, ...va], split);
  const good = [1.5, -1], bad = [0.5, -1];
  // n < 100 bir dilimde → sonucsuz (ortalamalar ne olursa olsun)
  assert.equal(verdictOf(both(mk(150, 0, good), mk(99, split, good))).verdict, 'sonucsuz');
  // iki dilimde ort. R > 0, PF > 1,1, hedge'li > 0 → gecer
  const g = verdictOf(both(mk(120, 0, good), mk(120, split, good)));
  assert.equal(g.verdict, 'gecer'); assert.equal(g.strict, true); assert.equal(g.hedgedOk, true);
  // sıkı geçer, hedge'li bir dilimde ≤ 0 → btc-yonu
  const b = verdictOf(both(mk(120, 0, good), mk(120, split, good, [0.2, -1])));
  assert.equal(b.verdict, 'btc-yonu'); assert.equal(b.strict, true); assert.equal(b.hedgedOk, false);
  // doğrulamada eksi → gecmez
  assert.equal(verdictOf(both(mk(120, 0, good), mk(120, split, bad))).verdict, 'gecmez');
  // PF 1,1 sınırı: ort. R > 0 ama PF ≤ 1,1 → gecmez
  assert.equal(verdictOf(both(mk(120, 0, [1.1, -1]), mk(120, split, [1.1, -1]))).verdict, 'gecmez');
  // dolmayan işlemler n'e girmez
  const filler = mk(120, split, good).map((t) => ({ ...t, outcome: 'expired', R: 0 }));
  assert.equal(verdictOf(both(mk(120, 0, good), [...mk(60, split, good), ...filler])).verdict, 'sonucsuz');
});

test('adx-short: kümelenme (gün / hafta sayısı, en kalabalık gün)', () => {
  const mon = Date.UTC(2024, 0, 1); // Pazartesi
  const base = { tf: '4H', waitBars: 0, outcome: 'stopped', R: -1 };
  const ts = [mon, mon + 3600e3, mon + 2 * DAY, mon + 6 * DAY, mon + 7 * DAY, mon + 8 * DAY].map((time) => ({ ...base, time }));
  ts.push({ ...base, time: mon + 9 * DAY, outcome: 'missed' }); // dolmayan sayılmaz
  const c = clusteringOf(ts);
  assert.equal(c.n, 6); assert.equal(c.days, 5); assert.equal(c.weeks, 2, 'Pazar aynı hafta, ertesi Pazartesi yeni hafta'); assert.equal(c.maxPerDay, 2);
  assert.equal(c.top5DaysShare, 1);
});

test('adx-short: canlı satır = 13.11 taramasındaki 3 kademe + stop erkene satırı (parametreler)', () => {
  const v = liveRowVariant();
  assert.ok(v.name.endsWith(ADX.liveRowLast));
  assert.deepEqual(v.knifeGuard, { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 });
  assert.equal(v.skipWeekend, true); assert.equal(v.onlyLimit, true); assert.deepEqual(v.tfs, ['4H']); assert.equal(v.htfTrend, 'with');
  assert.equal(v.fillBarTp, 'lower'); assert.equal(v.tp1Pct, 1.2); assert.equal(v.tp1Portion, 0.5); assert.equal(v.keepTp2, true);
  assert.equal(v.midTp, true); assert.equal(v.midPortion, 0.25); assert.equal(v.midStopToTp1, true);
  assert.equal(v.knifeBar, undefined, "karar satırı motor varsayılanı 'touch'");
  assert.equal(variantFor('4H', 'lowerBar').knifeBar, 'lowerBar');
  assert.deepEqual(variantFor('1H').tfs, ['1H']);
  assert.equal(variantFor('1H').tp1Pct, 1.2);
});

test('adx-short: dönem raporu karar yalnız decision satırında; bilgi satırları karar vermez', () => {
  const p = { from: 0, to: 300 * DAY, label: 'x' };
  const ts = mk(250, 0, [1.5, -1]);
  const dec = periodReport(ts, ts, p, { decision: true });
  assert.equal(dec.verdict, 'sonucsuz'); // doğrulama diliminde 50 işlem
  assert.ok(dec.groups.primary && dec.groups.allShorts && dec.groups.adx40Long && dec.groups.adx50Short && dec.groups.adxLt40Short);
  assert.equal(dec.groups.primary.train.n, 200); assert.equal(dec.groups.primary.valid.n, 50);
  assert.ok(dec.knifeLowerBar && dec.clustering.all.days === 250);
  const info = periodReport(ts, null, p);
  assert.equal(info.verdict, undefined); assert.equal(info.infoVerdict, 'sonucsuz');
});

test('adx-short: veri aralıkları iç içe (1H koşusu 4H koşusunun 1H / 4H dosyalarını önbellekten okur)', () => {
  const now = Date.UTC(2026, 10, 17);
  const r4 = fetchRanges('4H', ADX.periods, now), r1 = fetchRanges('1H', { independent: ADX.periods.independent }, now);
  for (const tf of ['1H', '4H']) { assert.ok(r4[tf][0] <= r1[tf][0] && r4[tf][1] >= r1[tf][1], tf); }
  assert.ok(r4['1D'][0] <= ADX.periods.independent.from - 200 * DAY);
  assert.ok(r1['15m'] && !r4['15m']);
  assert.ok(r4['4H'][1] <= now);
});
