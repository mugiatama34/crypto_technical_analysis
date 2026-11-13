// Düşen bıçak kararı (13.11): karar yalnız girişe dokunma anına kadar bilinen veriyle (canlı bot 15 dk'lık turda yarım mumla
// karar verir). Eski davranış (knifeBar: 'full') dolum mumunun tamamına bakıyordu: dokunmadan sonraki dip karara giriyor,
// aynı mumda stop görülünce işlem 0R 'knife' sayılıyordu (canlıda −1R) → koruma iyimser ölçülüyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, touchBar, BT_DEFAULTS } from '../backtest/engine.js';

const c = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0 };
const guard = { ...o, knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 } };
const full = { ...guard, knifeBar: 'full' };
const long = { d: 1, direction: 'long', entry: 100, stop: 97, tp1: 104, tp2: 108, zone: [99.5, 100], atr: 1, inZone: false, price: 100.6 };
const short = { d: -1, direction: 'short', entry: 100, stop: 103, tp1: 96, tp2: 92, zone: [100, 100.5], atr: 1, inZone: false, price: 99.4 };
const H = 3600e3, H4 = 4 * H;

// Yavaş yaklaşma; dolum mumu girişe dokunduktan sonra stopa iniyor
const slowLongStop = [c(1, 100.6, 100.8, 100.4, 100.6), c(2, 100.5, 100.7, 100.3, 100.5), c(3, 100.4, 100.5, 96.5, 97), c(4, 97, 98, 96, 97.5)];
const slowShortStop = [c(1, 99.4, 99.6, 99.2, 99.4), c(2, 99.5, 99.7, 99.3, 99.5), c(3, 99.6, 103.5, 99.5, 103), c(4, 103, 104, 102, 102.5)];

test('bıçak kararı: dokunma anına kadar yavaş yaklaşma → emir dolar, aynı mumda stop −1R (long + short)', () => {
  const l = simulateTrade(long, slowLongStop, 0, '1H', guard);
  assert.deepEqual([l.outcome, l.R, l.entryFill], ['stopped', -1, 100]);
  assert.equal(l.approachAtr, 0.8); assert.equal(l.fillBarAtr, 0.5); // dip = giriş (dokunma anı)
  const s = simulateTrade(short, slowShortStop, 0, '1H', guard);
  assert.deepEqual([s.outcome, s.R, s.entryFill], ['stopped', -1, 100]);
  assert.equal(s.approachAtr, 0.8); assert.equal(s.fillBarAtr, 0.5);
});

test('bıçak kararı: eski seçenek (knifeBar full) → tam mum, 0R knife (karşılaştırma yolu)', () => {
  const l = simulateTrade(long, slowLongStop, 0, '1H', full);
  assert.deepEqual([l.outcome, l.R], ['knife', 0]); assert.equal(l.approachAtr, 4.3);
  const s = simulateTrade(short, slowShortStop, 0, '1H', full);
  assert.deepEqual([s.outcome, s.R], ['knife', 0]); assert.equal(s.approachAtr, 4.3);
});

test('bıçak kararı: dokunma anına kadar gerçekten hızlı yaklaşma → koruma çalışır (knife / teyit)', () => {
  const drop = [c(1, 102.5, 102.8, 102.2, 102.5), c(2, 102.5, 102.5, 100.5, 100.6)];
  // dokunma anında yaklaşma 102,8 − 100 = 2,8 ATR > 2 → bıçak; aynı mumda stop → iptal (0R)
  const k = simulateTrade(long, [...drop, c(3, 100.6, 100.6, 96.5, 97), c(4, 97, 98, 96, 97.5)], 0, '1H', guard);
  assert.deepEqual([k.outcome, k.R], ['knife', 0]); assert.equal(k.approachAtr, 2.8);
  // stop yok, teyit mumu → teyit kapanışından giriş
  const up = [c(4, 99.4, 99.8, 98.9, 99.6), c(5, 99.6, 100.4, 99.5, 100.3), c(6, 100.3, 104.5, 100.2, 104.2), c(7, 104, 108.5, 103.8, 108)];
  const g = simulateTrade(long, [...drop, c(3, 100.6, 100.6, 99.2, 99.4), ...up], 0, '1H', guard);
  assert.deepEqual([g.outcome, g.entryFill, g.confirmed], ['tp2', 100.3, true]);
  // short ayna
  const rise = [c(1, 97.5, 97.8, 97.2, 97.5), c(2, 97.5, 99.5, 97.5, 99.4)];
  const ks = simulateTrade(short, [...rise, c(3, 99.4, 103.5, 99.4, 103), c(4, 103, 104, 102, 102.5)], 0, '1H', guard);
  assert.deepEqual([ks.outcome, ks.R], ['knife', 0]); assert.equal(ks.approachAtr, 2.8);
});

// 4H dolum mumu: 1. saatte girişe dokunur, 2. saatte 102'ye tepki, 3. saatte stopa iner
const H4bars = [c(0, 100.6, 100.8, 100.4, 100.6), c(H4, 100.5, 100.7, 100.3, 100.5), c(2 * H4, 100.4, 102, 96.5, 97), c(3 * H4, 97, 98, 96, 97.5)];
const lower1h = [c(2 * H4, 100.4, 100.5, 99.9, 100.2), c(2 * H4 + H, 100.2, 102, 100.1, 101.8), c(2 * H4 + 2 * H, 101.8, 101.9, 96.5, 97), c(2 * H4 + 3 * H, 97, 97.5, 96.8, 97)];

test('bıçak kararı: alt TF yok → dokunan mumun tepesi tamamı sayılır (korumaya karşı kötümser)', () => {
  // tepe 102 dokunmadan sonra olsa da sayılır: dolum mumu (102 − 100) = 2 ATR > 1,5 → bıçak; aynı mumda stop → 0R
  const r = simulateTrade(long, H4bars, 0, '4H', guard);
  assert.deepEqual([r.outcome, r.R, r.fillBarAtr], ['knife', 0, 2]);
  // alt TF mumları üst mumun başından başlamıyorsa (eksik veri) aynı yedek kural
  assert.equal(simulateTrade(long, H4bars, 0, '4H', { ...guard, lowerCandles: lower1h.slice(1) }).outcome, 'knife');
});

test('bıçak kararı: alt TF varsa dokunma anı alt mumdan → tepki karara girmez, dolar, stop −1R', () => {
  for (const fillBarTp of ['count', 'lower']) {
    const r = simulateTrade(long, H4bars, 0, '4H', { ...guard, lowerCandles: lower1h, fillBarTp });
    assert.deepEqual([r.outcome, r.R, r.approachAtr, r.fillBarAtr], ['stopped', -1, 0.8, 0.5], fillBarTp);
  }
  // eski seçenek alt TF'yi yok sayar: tam mum → 0R knife
  assert.equal(simulateTrade(long, H4bars, 0, '4H', { ...full, lowerCandles: lower1h }).outcome, 'knife');
  // alt TF'de dokunmadan önce hızlı düşüş görülürse yine bıçak
  const fast = [c(2 * H4, 102.8, 102.8, 101, 101.1), c(2 * H4 + H, 101.1, 101.2, 99.8, 100.1), c(2 * H4 + 2 * H, 100.1, 100.3, 96.5, 97)];
  const bars = [c(0, 102.5, 102.6, 102.2, 102.5), c(H4, 102.5, 102.7, 102.3, 102.6), c(2 * H4, 102.8, 102.8, 96.5, 97), c(3 * H4, 97, 98, 96, 97.5)];
  const k = simulateTrade(long, bars, 0, '4H', { ...guard, lowerCandles: fast });
  assert.deepEqual([k.outcome, k.R, k.fillBarAtr], ['knife', 0, 2.8]);
});

test('touchBar: boşlukla açılış (açılış girişin ötesinde) → dokunma açılışta; short ayna', () => {
  assert.deepEqual(touchBar(long, 1, c(0, 99.5, 101, 96, 100), H, null), { time: 0, open: 99.5, close: 100, high: 99.5, low: 99.5 });
  assert.deepEqual(touchBar(short, -1, c(0, 100.5, 104, 99, 100), H, null), { time: 0, open: 100.5, close: 100, high: 100.5, low: 100.5 });
  assert.deepEqual(touchBar(short, -1, c(0, 99.4, 103.5, 99.2, 103), H, null), { time: 0, open: 99.4, close: 100, high: 100, low: 99.2 });
});
