import test from 'node:test';
import assert from 'node:assert/strict';
import { trendState, shortState, volState, fundingState, fundingRowsOf, statusLine } from '../bot/status.js';
import { trendStates, volStates } from '../backtest/regime-map.js';
import { formatSummary } from '../bot/telegram.js';

const DAY = 86400e3, H = 3600e3;
const mk = (closes, step = DAY, t0 = 0) => closes.map((c, i) => ({ time: t0 + i * step, open: c, high: c, low: c, close: c, volume: 1 }));
const ramp = (n, a, b) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

test('trendState: yukarı / aşağı / karışık / yetersiz', () => {
  assert.equal(trendState(mk(ramp(250, 100, 300))), 'YUKARI');
  assert.equal(trendState(mk(ramp(250, 300, 100))), 'AŞAĞI');
  assert.equal(trendState(mk([...ramp(240, 100, 300), ...ramp(10, 300, 150)])), 'KARIŞIK');
  assert.equal(trendState(mk(ramp(199, 100, 300))), null);
});
test('trendState = trendStates son gün', () => {
  for (const c of [mk(ramp(250, 100, 300)), mk(ramp(250, 300, 100)), mk([...ramp(240, 100, 300), ...ramp(10, 300, 150)])]) {
    assert.equal(trendState(c), trendStates(c).get(c[c.length - 1].time));
  }
});
test('shortState', () => {
  assert.equal(shortState(mk(ramp(60, 100, 200), 4 * H)), 'YUKARI');
  assert.equal(shortState(mk(ramp(60, 200, 100), 4 * H)), 'AŞAĞI');
  assert.equal(shortState(mk([...ramp(55, 100, 200), 150, 190, 160, 185, 155], 4 * H)), 'KARIŞIK');
  assert.equal(shortState(mk(ramp(41, 100, 200), 4 * H)), null);
});
const wavy = (n, amp) => Array.from({ length: n }, (_, i) => 100 * (1 + amp * Math.sin(i * 1.7)) + i * 0.01);
test('volState: eşikler, volStates ile eşit, yetersiz veri', () => {
  const calm = wavy(500, 0.01), spike = [...calm.slice(0, 460), ...wavy(40, 0.08)], quiet = [...wavy(460, 0.05), ...wavy(40, 0.005)];
  const a = volState(mk(spike)), b = volState(mk(quiet)), c = volState(mk(calm));
  assert.equal(a.state, 'YÜKSEK'); assert.ok(a.ratio > 1.25);
  assert.equal(b.state, 'DÜŞÜK'); assert.ok(b.ratio < 0.8);
  assert.equal(c.state, 'ORTA');
  const cs = mk(spike), vs = volStates(cs);
  assert.equal(a.state, vs.states.get(cs[cs.length - 1].time)); assert.equal(a.ratio, vs.ratio.get(cs[cs.length - 1].time));
  assert.deepEqual(volState(mk(wavy(300, 0.02))), { state: null, ratio: null });
});
const now = 100 * DAY;
const fr = (rate, intervalH, days = 7, step = intervalH) => { const o = []; for (let t = now; t > now - days * DAY; t -= step * H) o.push({ time: t, rate, intervalH }); return o; };
test('fundingState: 8s / 4s karışık, eşikler, yetersiz', () => {
  // 4 saatlik dönemde 0,00003 oran = 8 saatte 0,00006; 8 saatlik 0,00006 ile aynı → ortalama %0,006 (4s yanlış okunsa %0,0045 olurdu)
  const mix = [...fr(0.00006, 8, 3.5), ...fr(0.00003, 4, 7).filter((r) => r.time <= now - 3.5 * DAY)];
  const f = fundingState(mix, now);
  assert.ok(Math.abs(f.avg8hPct - 0.006) < 1e-9);
  assert.equal(f.state, 'ORTA');
  assert.equal(fundingState(fr(0.0002, 8), now).state, 'YÜKSEK');
  assert.equal(fundingState(fr(0.00002, 8), now).state, 'DÜŞÜK');
  assert.equal(fundingState(fr(0.00002, 4), now).avg8hPct.toFixed(4), '0.0040');
  assert.deepEqual(fundingState(fr(0.0001, 8, 3), now), { state: null, avg8hPct: null });
  assert.deepEqual(fundingState(null, now), { state: null, avg8hPct: null });
});
test('fundingRowsOf: aralık ardışık farktan, savunmacı', () => {
  const r = fundingRowsOf([{ fundingTime: String(8 * H), realizedRate: '0.0001' }, { fundingTime: String(4 * H), fundingRate: '0.0002', realizedRate: '' }, { fundingTime: 'x' }, null]);
  assert.equal(r.length, 2); assert.equal(r[1].intervalH, 4); assert.equal(r[0].rate, 0.0002);
  assert.deepEqual(fundingRowsOf(undefined), []);
});
test('statusLine: biçim, null parçalar, hepsi null', () => {
  const l = statusLine({ trend: 'AŞAĞI', short: 'AŞAĞI', vol: { state: 'ORTA', ratio: 1.08 }, funding: { state: 'DÜŞÜK', avg8hPct: 0.0021 } });
  assert.equal(l, 'Durum: BTC trend AŞAĞI (50/200 günlük) · kısa vade AŞAĞI (4H: 12s/1g/1h) · oynaklık ORTA (×1,08) · fonlama DÜŞÜK (%0,0021 / 8s, 7 gün)');
  const p = statusLine({ trend: 'YUKARI', short: null, vol: { state: null, ratio: null }, funding: null });
  assert.equal(p, 'Durum: BTC trend YUKARI (50/200 günlük) · kısa vade — · oynaklık — · fonlama —');
  assert.equal(statusLine({ trend: null, short: null, vol: { state: null, ratio: null }, funding: { state: null, avg8hPct: null } }), '');
  assert.equal(statusLine({}), '');
});
test('formatSummary: status yokken eskisiyle aynı, varken health üstünde', () => {
  const stats = { sent: 3 }, base = formatSummary(stats, [], 0, { health: 'H<b>x</b>' });
  assert.equal(formatSummary(stats, [], 0, { health: 'H<b>x</b>', status: '' }), base);
  assert.equal(formatSummary(stats, [], 0, { health: 'H<b>x</b>', status: undefined }), base);
  const w = formatSummary(stats, [], 0, { health: 'H<b>x</b>', status: 'Durum: a & b' });
  assert.ok(w.indexOf('Durum: a &amp; b') > -1 && w.indexOf('Durum: a &amp; b') < w.indexOf('H<b>x</b>'));
  assert.equal(w.split('\n').filter((x) => x.startsWith('Durum')).length, 1);
  const noHealth = formatSummary(stats, [], 0, {});
  assert.equal(formatSummary(stats, [], 0, { status: 'Durum: z' }), noHealth + '\n\nDurum: z');
});
