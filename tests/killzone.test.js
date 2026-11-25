import test from 'node:test';
import assert from 'node:assert/strict';
import { nyHour, zoneOf, fillHour, stopHour, volShare, stopShare, kzDiff, verdict, analyze, fillBarOf, closeBarOf } from '../backtest/killzone.mjs';

const H = 3600e3, u = (s) => Date.parse(s);

test('killzone: New York saati yaz / kış saatini izler', () => {
  assert.equal(nyHour(u('2026-01-15T07:00:00Z')), 2); // kış: UTC−5
  assert.equal(nyHour(u('2026-07-15T06:00:00Z')), 2); // yaz: UTC−4
  assert.equal(zoneOf(u('2026-01-15T07:00:00Z')), 'london');
  assert.equal(zoneOf(u('2026-01-15T09:59:00Z')), 'london');
  assert.equal(zoneOf(u('2026-01-15T10:00:00Z')), null);
  assert.equal(zoneOf(u('2026-01-15T12:00:00Z')), 'ny');
  assert.equal(zoneOf(u('2026-07-15T11:00:00Z')), 'ny');
  assert.equal(zoneOf(u('2026-07-15T14:00:00Z')), null);
  assert.equal(zoneOf(u('2026-01-15T00:00:00Z')), null);
});

test('killzone: dolum ve stop saati ilk dokunan 1H mumdur', () => {
  const t0 = u('2026-01-15T04:00:00Z');
  const c = [{ time: t0, high: 105, low: 103 }, { time: t0 + H, high: 104, low: 100 }, { time: t0 + 2 * H, high: 101, low: 97 }, { time: t0 + 3 * H, high: 99, low: 94 }];
  assert.equal(fillHour(c, 100), t0 + H);
  assert.equal(fillHour(c, 200), null);
  assert.equal(stopHour(c, 96, 1), t0 + 3 * H); // long: düşük ≤ stop
  assert.equal(stopHour(c, 104.5, -1), t0); // short: yüksek ≥ stop
  assert.equal(stopHour(c, 104.5, -1, t0 + H), null); // dolumdan önceki dokunuş sayılmaz
  const t = { time: t0, tf: '4H', waitBars: 1, bars: 2 };
  assert.equal(fillBarOf(t), t0 + 4 * H);
  assert.equal(closeBarOf(t), t0 + 12 * H);
});

test('killzone: oynaklık ve stop payı', () => {
  const day = u('2026-01-15T00:00:00Z');
  const btc = Array.from({ length: 24 }, (_, i) => ({ time: day + i * H, high: 101, low: 100, close: 100 }));
  const v = volShare(btc);
  assert.equal(v.kz, 0.25);
  assert.equal(v.london, 0.125);
  const s = stopShare([{ at: day + 7 * H }, { at: day + 12 * H }, { at: day + 13 * H }, { at: day + 20 * H }]);
  assert.equal(s.kz, 3);
  assert.equal(s.kzShare, 0.75);
  assert.equal(s.hours[2], 1); // 07 UTC = 02 NY
});

test('killzone: dolum saatine göre fark ve karar', () => {
  const day = u('2026-01-15T00:00:00Z');
  const tr = [{ fillAt: day + 7 * H, R: -1 }, { fillAt: day + 12 * H, R: -0.5 }, { fillAt: day + 1 * H, R: 0.5 }, { fillAt: day + 20 * H, R: 0.1 }];
  const d = kzDiff(tr);
  assert.deepEqual([d.kzN, d.otherN, d.kzAvg, d.otherAvg, d.diff], [2, 2, -0.75, 0.3, 1.05]);
  assert.match(verdict({ kzN: 20, diff: 1 }, { kzN: 200, diff: 1 }, [0.1, 1]), /iddia yok/);
  assert.match(verdict({ kzN: 60, diff: 1 }, { kzN: 200, diff: 1 }, [0.1, 1]), /n < 100/);
  assert.equal(verdict({ kzN: 120, diff: 0.2 }, { kzN: 200, diff: 0.1 }, [0.01, 0.4]), 'işaret var');
  assert.equal(verdict({ kzN: 120, diff: 0.2 }, { kzN: 200, diff: -0.1 }, [0.01, 0.4]), 'işaret yok');
  const a = analyze({ timed: tr.map((t, i) => ({ ...t, time: day + i, outcome: i < 2 ? 'stopped' : 'tp2', stopAt: i < 2 ? t.fillAt : null })), split: day + 2, btc: [] });
  assert.equal(a.match.stopTimed, 2);
  assert.equal(a.s1.stops.kzShare, 1);
  assert.equal(a.s1.ratioVsTime, 4);
});
