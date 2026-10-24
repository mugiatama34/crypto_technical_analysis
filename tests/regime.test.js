import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizonTrend, horizonSeries, horizonTrendAt, htfTrendAt, htfOk, UP_TF, marketRead, regimeFor, dailyTrendAt } from '../src/scan/regime.js';

const H = 3600e3, DAY = 86400e3;
const series = (f, n, ms, amp = 0.002) => Array.from({ length: n }, (_, i) => { const c = f(i); return { time: i * ms, open: c, high: c * (1 + amp), low: c * (1 - amp), close: c, volume: 1 }; });

test('horizonTrend: düşen seri down, yükselen up, testere flat, kısa seri null', () => {
  const down = series((i) => 100 - 0.3 * i, 120, 4 * H);
  const up = series((i) => 100 + 0.3 * i, 120, 4 * H);
  const saw = series((i) => 100 + (i % 2 ? 2 : -2), 120, 4 * H, 0.03);
  assert.equal(horizonTrend(down).dir, 'down');
  assert.equal(horizonTrend(up).dir, 'up');
  assert.equal(horizonTrend(saw).dir, 'flat');
  assert.equal(horizonTrend(series((i) => 100 + i, 30, 4 * H)), null);
  assert.equal(horizonTrend(null), null);
});

test('marketRead: günlük yükseliş + 4H düşüş birlikte raporlanır; regimeFor TF eşlemesi; getiriler', () => {
  const daily = Array.from({ length: 90 }, (_, i) => ({ time: i * DAY, open: 0, high: 0, low: 0, close: 100 + i })); // günlük yükseliş
  const h4 = series((i) => 300 - 0.4 * i, 120, 4 * H); // son 20 gün düşüş
  const h1 = series((i) => 300 - 0.1 * i, 200, H);
  const now = 90 * DAY;
  const r = marketRead({ daily, h4, h1, now });
  assert.equal(r.daily, 'up'); assert.equal(r.h4, 'down'); assert.equal(r.h1, 'down');
  assert.ok(r.ret4h < 0 && r.ret24h < 0 && r.adx4h > 20);
  assert.ok(r.summary.includes('günlük yükseliş') && r.summary.includes('4H düşüş'));
  assert.equal(regimeFor('1H', r), 'down'); assert.equal(regimeFor('15m', r), 'down'); assert.equal(regimeFor('4H', r), 'up');
  assert.equal(regimeFor('1H', { ...r, h4: 'flat' }), null); // yatay 4H: 1H için rejim yok
  assert.equal(regimeFor('4H', { ...r, daily: null }), null);
  assert.equal(regimeFor('1H', null), null);
  assert.equal(dailyTrendAt(daily, now).up, true);
  const empty = marketRead({ daily: null, h4: null, h1: null, now });
  assert.equal(empty.daily, null); assert.equal(empty.h4, null); assert.ok(empty.summary.includes('bilinmiyor'));
});

test('horizonTrendAt / htfTrendAt: son indekste horizonTrend ile aynı; karar anından sonraki mumları kullanmaz; htfOk', () => {
  const up = series((i) => 100 + 0.3 * i, 120, 4 * H);
  const hs = horizonSeries(up);
  assert.deepEqual(horizonTrendAt(hs, up.length - 1), horizonTrend(up));
  assert.equal(horizonTrendAt(hs, 10), null); // yetersiz geçmiş
  // 80. mumdan sonra seri çöküyor; karar anı 80. mumun kapanışı → geleceği görmez, hâlâ 'up'
  const crash = up.map((c, i) => (i > 80 ? { ...c, close: 100 - 2 * (i - 80), high: 101 - 2 * (i - 80), low: 99 - 2 * (i - 80) } : c));
  const hs2 = horizonSeries(crash);
  assert.equal(htfTrendAt(hs2, 4 * H, crash[80].time + 4 * H), 'up');
  assert.equal(htfTrendAt(hs2, 4 * H, crash[119].time + 4 * H), 'down');
  assert.equal(htfTrendAt(hs2, 4 * H, crash[0].time), null);
  assert.equal(UP_TF['1H'], '4H'); assert.equal(UP_TF['4H'], '1D');
  assert.equal(htfOk('with', 'up', 1), true); assert.equal(htfOk('with', 'flat', 1), false); assert.equal(htfOk('with', null, 1), false);
  assert.equal(htfOk('notAgainst', 'flat', 1), true); assert.equal(htfOk('notAgainst', 'down', 1), false); assert.equal(htfOk('notAgainst', 'down', -1), true);
  assert.equal(htfOk(null, 'down', 1), true);
});
