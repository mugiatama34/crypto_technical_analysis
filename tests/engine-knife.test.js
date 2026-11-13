// Düşen bıçak kararı (13.11): karar yalnız girişe dokunma anına kadar bilinen veriyle (canlı bot 15 dk'lık turda yarım mumla
// karar verir). Eski davranış (knifeBar: 'full') dolum mumunun tamamına bakıyordu: dokunmadan sonraki dip karara giriyor,
// aynı mumda stop görülünce işlem 0R 'knife' sayılıyordu (canlıda −1R) → koruma iyimser ölçülüyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrade, touchBar, lowerBar, BT_DEFAULTS } from '../backtest/engine.js';

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

// knifeBar 'lowerBar' (13.11, K1): girişe ilk dokunan alt TF mumunun sonuna kadar (o alt mum tam) — 15 dk'lık turdaki bot gibi
test("bıçak kararı: knifeBar lowerBar → dokunan alt mumun dibi karara girer (touch: dip = giriş); alt TF yoksa touch gibi", () => {
  const bars = [c(0, 100.6, 100.8, 100.4, 100.6), c(H4, 100.5, 100.7, 100.3, 100.5), c(2 * H4, 100.4, 100.5, 96.5, 97), c(3 * H4, 97, 98, 96, 97.5)];
  const low1h = [c(2 * H4, 100.4, 100.5, 97.5, 97.8), c(2 * H4 + H, 97.8, 98, 96.5, 97), c(2 * H4 + 2 * H, 97, 97.2, 96.8, 97), c(2 * H4 + 3 * H, 97, 97.1, 96.9, 97)];
  const t = simulateTrade(long, bars, 0, '4H', { ...guard, lowerCandles: low1h }); // touch: 0,8 / 0,5 → dolar, stop
  assert.deepEqual([t.outcome, t.R, t.approachAtr, t.fillBarAtr], ['stopped', -1, 0.8, 0.5]);
  const lb = simulateTrade(long, bars, 0, '4H', { ...guard, knifeBar: 'lowerBar', lowerCandles: low1h }); // 100,8 − 97,5 = 3,3
  assert.deepEqual([lb.outcome, lb.R, lb.approachAtr, lb.fillBarAtr], ['knife', 0, 3.3, 3]);
  assert.deepEqual(lowerBar(long, 1, bars[2], H4, low1h), { time: 2 * H4, open: 100.4, high: 100.5, low: 97.5, close: 97.8 });
  // alt TF yok / üst mumun başından yok → touchBar
  assert.deepEqual(lowerBar(long, 1, bars[2], H4, null), touchBar(long, 1, bars[2], H4, null));
  assert.deepEqual(lowerBar(long, 1, bars[2], H4, low1h.slice(1)), touchBar(long, 1, bars[2], H4, low1h.slice(1)));
  // short ayna
  const m = (x) => ({ ...x, open: 200 - x.open, high: 200 - x.low, low: 200 - x.high, close: 200 - x.close });
  const s = simulateTrade(short, bars.map(m), 0, '4H', { ...guard, knifeBar: 'lowerBar', lowerCandles: low1h.map(m) });
  assert.deepEqual([s.outcome, s.approachAtr, s.fillBarAtr], ['knife', 3.3, 3]);
});

// CE (13.11): bıçak teyitli girişte erken hedef (plan.tp1, missTp = özgün TP1) yeni girişe aynı % uzaklıkla taşınır (canlı A2)
test('bıçak teyidi: erken hedefli planda tp1 yeni girişe taşınır; erkensiz planda (missTp yok) TP1 yerinde', () => {
  const p = { ...long, stop: 95, tp1: 101.2, missTp: 106, tp2: 110, zone: [99, 100] };
  const cs = [c(1, 104, 104, 99.5, 99.8), c(2, 99.8, 102.2, 99.6, 102), c(3, 102, 102.5, 101.6, 102.2), c(4, 102.2, 103.4, 102, 103)];
  const r = simulateTrade(p, cs, 0, '1H', guard);
  // giriş 102 (teyit kapanışı), erken hedef 102 × 101,2 / 100 = 103,224: 3. mum (102,5) değmez, 4. mum değer (eski: 101,2 →
  // 3. mumda, girişin altında); kalan yarı veri sonunda dolum mumu kapanışı 102,2
  assert.equal(r.confirmed, true); assert.equal(r.entryFill, 102); assert.equal(r.tp1Bars, 2);
  assert.ok(Math.abs(r.R - (0.5 * 1.224 / 7 + 0.5 * 0.2 / 7)) < 0.0011, String(r.R));
  // ara kademe: taşınan erken hedef özgün TP1'i (tpMid) geçerse ara kademe yok
  const q = simulateTrade({ ...p, tpMid: 103 }, cs, 0, '1H', { ...guard, midPortion: 0.25 });
  assert.equal(q.R, r.R);
  // erkensiz: tp1 = özgün TP1 (104), taşınmaz
  const n = simulateTrade({ ...p, tp1: 104, missTp: undefined }, [...cs, c(5, 103, 104.1, 102.9, 104)], 0, '1H', guard);
  assert.equal(n.tp1Bars, 3); // 104'e 5. mumda (dolumdan 3. mum)
});
