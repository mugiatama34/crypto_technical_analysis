// Ön kayıt docs/arastirma/on-kayit-psl-ai.md (Aşama A): 8 ölçütün her biri ayrı, sınır / eşitlik durumları, puan ve sinyal, 1D uyumu
// (yalnız kapanmış 1D mum), geleceğe bakış yok, simülatör (stop önce, TP1 → stop girişe, maliyet, yazarın muhasebesi), motorla eşitlik,
// aynı yönde açık işlem kilidi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PSL, DAY, cci, indicatorsOf, criteriaOf, scoreOf, signalOf, dailyTrendAt, dailyOf, levelsOf, simEngine, simulateExit, runSeries, valuesAt, pslReport, ROWS, CRITERIA } from '../backtest/psl.js';

const H4 = 4 * 3600e3;

test('psl: ön kayıt sabitleri (dönem, eşik, ısınma, plan, maliyet)', () => {
  assert.equal(new Date(PSL.period.from).toISOString(), '2024-11-20T00:00:00.000Z');
  assert.equal(new Date(PSL.period.to).toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(PSL.threshold, 6); assert.deepEqual(PSL.infoThresholds, [5, 7]); assert.equal(PSL.top, 50); assert.equal(PSL.tf, '4H');
  assert.equal(PSL.warmBars, 300); assert.equal(PSL.warmDays, 200);
  assert.equal(PSL.stopAtr, 1.5); assert.deepEqual(PSL.tpR, [1, 2]); assert.equal(PSL.tp1Portion, 0.5); assert.deepEqual(PSL.ladderR, [1, 2, 3, 4]);
  assert.deepEqual(PSL.cost, { fee: 0.05, slip: 0.05 }); assert.deepEqual(PSL.authorCost, { fee: 0.025, slip: 0 });
  assert.deepEqual(PSL.ind.macd, [12, 26, 9]); assert.deepEqual(PSL.ind.stoch, [14, 3, 3]); assert.deepEqual(PSL.ind.ema, [50, 169]);
  assert.equal(PSL.ind.rvol, 20); assert.equal(PSL.ind.rvolMin, 1.2); assert.equal(PSL.ind.adxMin, 20); assert.equal(PSL.ind.cci, 20);
  assert.equal(PSL.minN, 100);
});

// Nötr değerler: hiçbir ölçüt oy vermez
const NEUTRAL = { macd: 1, macdSig: 1, rsi: 50, stochK: 50, rvol: 1, open: 10, close: 10, ema50: 5, ema169: 5, adx: 10, pdi: 30, mdi: 10, cci: 0 };
const crit = (over) => criteriaOf({ ...NEUTRAL, ...over });

test('psl: nötr değerlerde 8 ölçütün hepsi 0 (sınır değerleri hiçbir tarafa oy vermez)', () => {
  assert.deepEqual(Object.keys(crit({})), CRITERIA);
  assert.deepEqual(Object.values(crit({})), [0, 0, 0, 0, 0, 0, 0, 0]);
  const s = scoreOf(NEUTRAL); assert.equal(s.long, 0); assert.equal(s.short, 0);
});

test('psl: ölçüt 1 — MACD > / < sinyal, eşit 0', () => {
  assert.equal(crit({ macd: 1.1 }).macd, 1); assert.equal(crit({ macd: 0.9 }).macd, -1); assert.equal(crit({}).macd, 0);
  assert.equal(crit({ macd: null }).macd, 0);
});
test('psl: ölçüt 2 — RSI (50, 70) long, (30, 50) short; 30 / 50 / 70 ve dışı 0', () => {
  for (const [v, e] of [[60, 1], [69.9, 1], [70, 0], [75, 0], [50, 0], [40, -1], [30.1, -1], [30, 0], [20, 0]]) assert.equal(crit({ rsi: v }).rsi, e, `RSI ${v}`);
});
test('psl: ölçüt 3 — Stokastik %K (50, 80) long, (20, 50) short', () => {
  for (const [v, e] of [[65, 1], [80, 0], [90, 0], [50, 0], [35, -1], [20, 0], [10, 0]]) assert.equal(crit({ stochK: v }).stoch, e, `%K ${v}`);
});
test('psl: ölçüt 4 — göreli hacim > 1,2 ve mum yönü; 1,2 tam = 0', () => {
  assert.equal(crit({ rvol: 1.5, close: 11 }).rvol, 1);
  assert.equal(crit({ rvol: 1.5, close: 9 }).rvol, -1);
  assert.equal(crit({ rvol: 1.2, close: 11 }).rvol, 0);
  assert.equal(crit({ rvol: 1.5 }).rvol, 0, 'doji: yön yok');
  assert.equal(crit({ rvol: 1.0, close: 11 }).rvol, 0);
});
test('psl: ölçüt 5 — kapanış > / < açılış', () => {
  assert.equal(crit({ close: 11 }).candle, 1); assert.equal(crit({ close: 9 }).candle, -1); assert.equal(crit({}).candle, 0);
});
test('psl: ölçüt 6 — EMA50 > / < EMA169', () => {
  assert.equal(crit({ ema50: 6 }).ema, 1); assert.equal(crit({ ema50: 4 }).ema, -1); assert.equal(crit({ ema169: null }).ema, 0);
});
test('psl: ölçüt 7 — ADX > 20 ve DI yönü; ADX 20 tam = 0', () => {
  assert.equal(crit({ adx: 25 }).dmi, 1);
  assert.equal(crit({ adx: 25, pdi: 10, mdi: 30 }).dmi, -1);
  assert.equal(crit({ adx: 20 }).dmi, 0);
  assert.equal(crit({ adx: 25, pdi: 20, mdi: 20 }).dmi, 0);
});
test('psl: ölçüt 8 — CCI (0, 150) long, (−150, 0) short', () => {
  for (const [v, e] of [[100, 1], [150, 0], [200, 0], [0, 0], [-100, -1], [-150, 0], [-200, 0]]) assert.equal(crit({ cci: v }).cci, e, `CCI ${v}`);
});

test('psl: puan ve sinyal — eşik, büyük taraf, 1D uyumu, eşitlik', () => {
  const allLong = { macd: 2, macdSig: 1, rsi: 60, stochK: 60, rvol: 2, open: 10, close: 11, ema50: 6, ema169: 5, adx: 30, pdi: 30, mdi: 10, cci: 50 };
  const s = scoreOf(allLong); assert.equal(s.long, 8); assert.equal(s.short, 0);
  assert.equal(signalOf(s, 6, 1), 1); assert.equal(signalOf(s, 6, -1), 0, '1D ters'); assert.equal(signalOf(s, 6, 0), 0, '1D eşit / yok');
  assert.equal(signalOf(s, 6, -1, false), 1, 'üst TF şartsız');
  const six = scoreOf({ ...allLong, rsi: 75, cci: 200 }); assert.equal(six.long, 6);
  assert.equal(signalOf(six, 6, 1), 1); assert.equal(signalOf(six, 7, 1), 0);
  const five = scoreOf({ ...allLong, rsi: 75, cci: 200, stochK: 85 }); assert.equal(five.long, 5); assert.equal(signalOf(five, 6, 1), 0); assert.equal(signalOf(five, 5, 1), 1);
  // eşitlik: 3 / 3 → sinyal yok (eşik 3'te bile)
  assert.equal(signalOf({ long: 3, short: 3 }, 3, 1), 0);
  const sh = scoreOf({ macd: 0, macdSig: 1, rsi: 40, stochK: 30, rvol: 2, open: 11, close: 10, ema50: 4, ema169: 5, adx: 30, pdi: 10, mdi: 30, cci: -50 });
  assert.equal(sh.short, 8); assert.equal(signalOf(sh, 6, -1), -1); assert.equal(signalOf(sh, 6, 1), 0);
});

test('psl: CCI elle hesapla eşleşir (TradingView tanımı: hlc3, ortalama mutlak sapma, 0,015)', () => {
  const n = 25, h = [], l = [], c = [];
  for (let i = 0; i < n; i++) { c.push(100 + Math.sin(i) * 5 + i * 0.3); h.push(c[i] + 1 + (i % 3)); l.push(c[i] - 1 - (i % 2)); }
  const out = cci(h, l, c, 20);
  assert.equal(out[18], null);
  const i = 24, tp = c.map((x, k) => (h[k] + l[k] + x) / 3), w = tp.slice(i - 19, i + 1), m = w.reduce((a, b) => a + b, 0) / 20;
  const md = w.reduce((a, b) => a + Math.abs(b - m), 0) / 20;
  assert.ok(Math.abs(out[i] - (tp[i] - m) / (0.015 * md)) < 1e-9);
  assert.equal(cci(Array(20).fill(1), Array(20).fill(1), Array(20).fill(1), 20)[19], null, 'sapma 0 → null');
});

// Rastgele yürüyüş mumları (sabit tohum)
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function walk(n, seed = 1, t0 = Date.UTC(2025, 0, 1), ms = H4) {
  const r = rnd(seed), out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = o * (1 + (r() - 0.5) * 0.04), hi = Math.max(o, c) * (1 + r() * 0.015), lo = Math.min(o, c) * (1 - r() * 0.015);
    out.push({ time: t0 + i * ms, open: o, high: hi, low: lo, close: c, volume: 1000 + r() * 2000 }); p = c;
  }
  return out;
}

test('psl: geleceğe bakış yok — i sonrasındaki mumları değiştirmek i\'deki göstergeleri / puanı değiştirmez', () => {
  const cs = walk(500, 7), ind = indicatorsOf(cs);
  const cs2 = cs.map((c, k) => (k > 400 ? { ...c, close: c.close * 3, high: c.high * 3, low: c.low * 0.2, volume: c.volume * 50 } : c));
  const ind2 = indicatorsOf(cs2);
  for (const i of [320, 380, 400]) {
    assert.deepEqual(valuesAt(ind2, i), valuesAt(ind, i), `mum ${i}`);
    assert.deepEqual(scoreOf(valuesAt(ind2, i)), scoreOf(valuesAt(ind, i)));
  }
  assert.notDeepEqual(valuesAt(ind2, 401), valuesAt(ind, 401));
});

test('psl: 1D uyumu yalnız sinyal anında KAPANMIŞ son 1D mumdan; ≥ 200 kapanmış gün şartı', () => {
  const D0 = Date.UTC(2024, 0, 1);
  const mkDaily = (n, f) => Array.from({ length: n }, (_, k) => ({ time: D0 + k * DAY, open: f(k), high: f(k), low: f(k), close: f(k), volume: 1 }));
  const up = mkDaily(260, (k) => 100 + k); // yükselen → EMA50 > EMA169
  const dUp = dailyOf(up);
  const T = D0 + 240 * DAY; // gün 239'un kapanışı = T (dahil), gün 240 kapanmadı
  assert.equal(dailyTrendAt(dUp, T), 1);
  // Gün 240 ve sonrasını sert düşüşe çevir: T'deki karar değişmez (gün 240 T + 1 g'de kapanır)
  const crash = up.map((c, k) => (k >= 240 ? { ...c, close: 1, open: 1, high: 1, low: 1 } : c));
  const dCrash = dailyOf(crash);
  assert.equal(dailyTrendAt(dCrash, T), 1, 'kapanmamış gün kullanılmaz');
  assert.equal(dailyTrendAt(dCrash, T + 4 * 3600e3), 1, 'gün içi 4H kapanışında da o gün kullanılmaz');
  // Gün 239'u (T'de kapanan) değiştirmek kararı etkileyebilir → kullanıldığının kanıtı: yalnız gün 239 EMA'sı okunuyor
  let k = -1; for (let j = 0; j < up.length; j++) if (up[j].time + DAY <= T) k = j;
  assert.equal(k, 239);
  // Isınma: < 200 kapanmış gün → 0
  assert.equal(dailyTrendAt(dUp, D0 + 199 * DAY), 0, '199 kapanmış gün');
  assert.equal(dailyTrendAt(dUp, D0 + 200 * DAY), 1, '200 kapanmış gün');
  assert.equal(dailyTrendAt(dailyOf(mkDaily(260, (k2) => 400 - k2)), T), -1);
  assert.equal(dailyTrendAt(null, T), 0);
});

// Elle mum dizisi: sinyal mumu i = 0 (kapanış 100, ATR 2 → stop mesafesi 3), giriş mumu 1 açılış 100
const C = (open, high, low, close, k) => ({ time: k * H4, open, high, low, close, volume: 1 });
const ZERO = { fee: 0, slip: 0 };

test('psl simülatör (gerçekçi): aynı mumda stop + TP1 → stop', () => {
  const cs = [C(100, 100, 100, 100, 0), C(100, 104, 96, 100, 1)];
  const s = simulateExit(cs, 0, 1, 2, { cost: ZERO });
  assert.equal(s.outcome, 'stopped'); assert.equal(s.R, -1);
  const e = simEngine(cs, 0, 1, 2, '4H', ZERO); assert.equal(e.outcome, 'stopped'); assert.equal(e.R, -1);
});

test('psl simülatör (gerçekçi): TP1 → %50 + stop girişe; sonra başabaş; TP2', () => {
  const be = [C(100, 100, 100, 100, 0), C(100, 103.5, 99, 103, 1), C(103, 103, 99.5, 100, 2)];
  const s = simulateExit(be, 0, 1, 2, { cost: ZERO });
  assert.equal(s.outcome, 'tp1_be'); assert.equal(s.R, 0.5); assert.equal(s.tp1Bars, 1); assert.equal(s.bars, 1);
  const tp2 = [C(100, 100, 100, 100, 0), C(100, 103.5, 99, 103, 1), C(103, 106.5, 101, 106, 2)];
  const s2 = simulateExit(tp2, 0, 1, 2, { cost: ZERO });
  assert.equal(s2.outcome, 'tp2'); assert.equal(s2.R, 1.5);
  // short ayna
  const sh = [C(100, 100, 100, 100, 0), C(100, 101, 96.5, 97, 1), C(97, 98, 93.5, 94, 2)];
  assert.equal(simulateExit(sh, 0, -1, 2, { cost: ZERO }).R, 1.5);
  // veri sonu: açık kaldı, son kapanıştan
  const open = [C(100, 100, 100, 100, 0), C(100, 101, 99, 101.5, 1)];
  const so = simulateExit(open, 0, 1, 2, { cost: ZERO });
  assert.equal(so.outcome, 'timeout'); assert.equal(so.openAtEnd, true); assert.equal(so.R, 0.5);
});

test('psl simülatör: maliyet — komisyon 2 × %0,05 × giriş ÷ risk, kayma giriş ve stopta', () => {
  const cs = [C(100, 100, 100, 100, 0), C(100, 100.5, 96, 99, 1)];
  const s = simulateExit(cs, 0, 1, 2, { cost: { fee: 0.05, slip: 0 } });
  assert.ok(Math.abs(s.R - (-1 - (0.001 * 100) / 3)) < 1e-3);
  const s2 = simulateExit(cs, 0, 1, 2, { cost: { fee: 0, slip: 0.05 } });
  const entry = 100 * 1.0005, risk = entry - 97;
  assert.ok(Math.abs(s2.R - (97 * 0.9995 - entry) / risk) < 1e-3);
  assert.ok(s2.R < -1);
});

test('psl simülatör: yazarın muhasebesi — stop kapanışla ama seviyeden; aynı mumda TP1 + stop = kazanç', () => {
  // Fitil stopun altına iner ama kapanış üstünde: gerçekçi = stop, yazar = devam
  const wick = [C(100, 100, 100, 100, 0), C(100, 101, 96, 99, 1), C(99, 106.5, 98, 106, 2)];
  assert.equal(simulateExit(wick, 0, 1, 2, { cost: ZERO }).outcome, 'stopped');
  const a = simulateExit(wick, 0, 1, 2, { acct: 'author', cost: ZERO });
  assert.equal(a.outcome, 'tp2'); assert.equal(a.R, 1.5);
  // Kapanış stopun altında (95): yazar −1R (seviye 97'den; gerçek kapanış 95 olsa da)
  const closeBelow = [C(100, 100, 100, 100, 0), C(100, 101, 94, 95, 1)];
  assert.equal(simulateExit(closeBelow, 0, 1, 2, { acct: 'author', cost: ZERO }).R, -1);
  // Aynı mumda TP1 + kapanış stopun altında: gerçekçi −1R, yazar +0,5R (TP1, kalan taşınmış stoptan = giriş)
  const both = [C(100, 100, 100, 100, 0), C(100, 104, 94, 95, 1)];
  assert.equal(simulateExit(both, 0, 1, 2, { cost: ZERO }).R, -1);
  const ab = simulateExit(both, 0, 1, 2, { acct: 'author', cost: ZERO });
  assert.equal(ab.R, 0.5); assert.equal(ab.outcome, 'tp1_be');
  // Varsayılan yazar maliyeti: toplam %0,05 (taraf başına %0,025), kayma yok
  const ac = simulateExit(closeBelow, 0, 1, 2, { acct: 'author' });
  assert.ok(Math.abs(ac.R - (-1 - (0.0005 * 100) / 3)) < 1e-3);
});

test('psl simülatör: 4 hedef — stop bir önceki hedefe, TP4 tam çıkış', () => {
  // mesafe 3: TP1 103, TP2 106, TP3 109, TP4 112
  const cs = [C(100, 100, 100, 100, 0), C(100, 106.5, 99, 106, 1), C(106, 107, 102.5, 103, 2)];
  const s = simulateExit(cs, 0, 1, 2, { scheme: 'ladder', cost: ZERO });
  assert.equal(s.hits, 2); assert.equal(s.outcome, 'tp1_be'); assert.equal(s.R, 1, 'stop TP1\'de (103) → +1R');
  const full = [C(100, 100, 100, 100, 0), C(100, 113, 99.5, 112.5, 1)];
  const f = simulateExit(full, 0, 1, 2, { scheme: 'ladder', cost: ZERO });
  assert.equal(f.outcome, 'tp2'); assert.equal(f.R, 4); assert.equal(f.tp1Bars, null, 'kısmi çıkış yok → hedge tam pozisyon');
  const st = [C(100, 100, 100, 100, 0), C(100, 101, 96, 98, 1)];
  assert.equal(simulateExit(st, 0, 1, 2, { scheme: 'ladder', cost: ZERO }).R, -1);
});

test('psl: simülatör gerçekçi kipi = motor (simulateTrade, piyasa girişi, half_be) — rastgele seriler', () => {
  let n = 0;
  for (const seed of [1, 2, 3, 4]) {
    const cs = walk(400, seed), ind = indicatorsOf(cs);
    for (let i = 30; i < 380; i += 7) for (const d of [1, -1]) {
      const a = ind.atr[i]; if (!(a > 0)) continue;
      const e = simEngine(cs, i, d, a, '4H'), s = simulateExit(cs, i, d, a);
      assert.equal(s.outcome, e.outcome, `seed ${seed} i ${i} d ${d}`);
      assert.ok(Math.abs(s.R - e.R) < 1.5e-3, `R ${s.R} ↔ ${e.R}`);
      assert.equal(s.bars, e.bars); assert.equal(s.tp1Bars, e.tp1Bars); assert.equal(s.exitI, e.exitI);
      n++;
    }
  }
  assert.ok(n > 300);
});

test('psl: plan seviyeleri sinyal mumu kapanışından (1,5 ATR; 1R / 2R)', () => {
  const L = levelsOf(100, 2, 1); assert.equal(L.stop, 97); assert.deepEqual(L.tps, [103, 106]);
  const S = levelsOf(100, 2, -1); assert.equal(S.stop, 103); assert.deepEqual(S.tps, [97, 94]);
});

test('psl: kilit — aynı yönde açık işlem varken yeni sinyal yok; ters yön serbest; dönem kapanışa göre', () => {
  const n = 400, cs = Array.from({ length: n }, (_, k) => C(100, 101, 99, 100, k)).map((c, k) => ({ ...c, time: PSL.period.from - 310 * H4 + k * H4 }));
  const L = { macd: 2, macdSig: 1, rsi: 60, stochK: 60, rvol: 2, open: 10, close: 11, ema50: 6, ema169: 5, adx: 30, pdi: 30, mdi: 10, cci: 50, atr: 1 };
  const ind = Object.fromEntries(Object.keys(L).map((k) => [k, Array(n).fill(L[k])]));
  // 350'den sonra short puanı 8
  for (let i = 350; i < n; i++) Object.assign(ind.macd, { [i]: 0 }) && [['rsi', 40], ['stochK', 30], ['close', 9], ['ema50', 4], ['pdi', 10], ['mdi', 30], ['cci', -50]].forEach(([k, v]) => { ind[k][i] = v; });
  const sim = (i) => ({ outcome: 'stopped', R: -1, bars: 4, waitBars: 1, entryFill: 100, stop: 99, exitI: i + 5 });
  const r = runSeries(cs, { coin: 'X', tf: '4H', ind, daily: null, threshold: 6, requireTrend: false, period: PSL.period, sim, btc: null });
  const longs = r.signals.filter((s) => s.d === 1).map((s) => s.i), shorts = r.signals.filter((s) => s.d === -1).map((s) => s.i);
  // dönem: kapanış ≥ from → i ≥ 309 (açılış from − H4); ısınma i ≥ 300 zaten sağlanır
  assert.equal(longs[0], 309);
  assert.deepEqual(longs.slice(0, 4), [309, 314, 319, 324], 'çıkış mumunda yeni sinyal serbest');
  assert.ok(longs.every((i) => i < 350));
  assert.equal(shorts[0], 350, 'ters yön: long açıkken bile serbest');
  // 1D şartı: daily yok → sinyal yok
  const r2 = runSeries(cs, { coin: 'X', tf: '4H', ind, daily: null, threshold: 6, requireTrend: true, period: PSL.period, sim, btc: null });
  assert.equal(r2.signals.length, 0);
  // aynı sinyallerle yeniden simülasyon (yazarın muhasebesi satırı)
  const r3 = runSeries(cs, { coin: 'X', tf: '4H', ind, signals: r.signals, sim: (i) => ({ outcome: 'tp2', R: 1.5, bars: 1, waitBars: 1, entryFill: 100, stop: 99, exitI: i + 2 }), btc: null });
  assert.deepEqual(r3.trades.map((t) => t.time), r.trades.map((t) => t.time));
});

test('psl: rapor — karar yalnız birincil satırdan, bilgi satırları infoVerdict', () => {
  const mk = (k, R, d = 1) => ({ coin: `C${k % 7}`, tf: '4H', time: PSL.period.from + k * 6 * 3600e3, waitBars: 1, bars: 1, d, outcome: R > 0 ? 'tp2' : 'stopped', R, hedgedR: R - 0.1 });
  const prim = Array.from({ length: 2900 }, (_, k) => mk(k, k % 3 === 0 ? -1 : 1.5, k % 2 ? 1 : -1));
  const rep = pslReport({ primary: prim, author: prim });
  assert.equal(rep.verdict, 'gecer');
  assert.ok(rep.groups.primaryLong.all.n + rep.groups.primaryShort.all.n === rep.groups.primary.all.n);
  assert.equal(rep.groups.thr5.all.n, 0); assert.equal(rep.groups.thr5.infoVerdict, 'sonucsuz');
  assert.ok(rep.clustering.coins === 7);
  assert.ok(Object.keys(ROWS).every((k) => rep.groups[k]));
  const few = pslReport({ primary: prim.slice(0, 150) });
  assert.equal(few.verdict, 'sonucsuz');
});
