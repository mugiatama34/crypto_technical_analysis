import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOfItem, replayTrack, replayItem, summarize } from '../backtest/replay.js';

const H = 3600e3, MS = 4 * H;
const c = (i, low, high, open = (low + high) / 2, close = open) => ({ time: i * MS, open, high, low, close, volume: 1 });
const item = (o = {}) => ({ id: 'X|4H|long|1', key: 'X|4H|long', coin: 'X', tf: '4H', direction: 'long', d: 1, entry: 100, stop: 97, tp1: 104.5, tp2: 107.5, sentAt: 10 * MS + 1, ...o });

test('replay: limit long dolar ve stop olur; kayıtla eşleşir, motor da −1R', () => {
  const cs = [c(10, 101, 102), c(11, 99.5, 101.5), c(12, 96.5, 100), c(13, 96, 98)];
  const r = replayItem(item({ status: 'stopped', activeAt: 11 * MS }), cs, 14 * MS);
  assert.equal(r.track.status, 'stopped'); assert.equal(r.track.R, -1); assert.equal(r.match, true);
  assert.equal(r.engine.outcome, 'stopped'); assert.equal(r.engine.R, -1);
});

test('replay: 24 saatte dolmayan limit düşer; sonraki dokunuş dolum sayılmaz', () => {
  const cs = Array.from({ length: 12 }, (_, k) => c(11 + k, 101, 103)).concat([c(23, 96, 101)]);
  const t = replayTrack(planOfItem(item()), cs, 24 * MS);
  assert.equal(t.status, 'expired');
});

test('replay: erken kâr → başa baş (be), TP1 kayıtta yoksa da R = kısım × erken R', () => {
  const s = item({ status: 'be', activeAt: 11 * MS, early: 101.2, earlyPortion: 0.8 });
  const cs = [c(11, 99.8, 100.5), c(12, 100.4, 101.5), c(13, 99.5, 101)];
  const r = replayItem(s, cs, 14 * MS);
  assert.equal(r.track.status, 'be'); assert.equal(r.track.R, 0.32);
  assert.equal(r.engine.outcome, 'tp1_be'); assert.equal(r.engine.R, 0.32);
});

test('replay: piyasa girişi (activeAt = sentAt) ve sahipsiz açık kayıt yeniden kapanır; özet', () => {
  const s = item({ status: 'active', activeAt: 10 * MS + 1, entry: 100 });
  assert.equal(planOfItem(s).status, 'active');
  const cs = [c(11, 99, 101), c(12, 103, 105), c(13, 105, 108)];
  const r = replayItem(s, cs, 14 * MS);
  assert.equal(r.track.status, 'done'); assert.equal(r.match, null);
  const sum = summarize([r]);
  assert.equal(sum.reopened, 1); assert.equal(sum.track.n, 1);
});
