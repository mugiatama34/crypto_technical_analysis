// Ön kayıt docs/arastirma/on-kayit-psl-ai.md (Aşama A): 8 ölçütün her biri ayrı, sınır / eşitlik durumları, puan ve sinyal, 1D uyumu
// (yalnız kapanmış 1D mum), geleceğe bakış yok, simülatör (stop önce, TP1 → stop girişe, maliyet, yazarın muhasebesi), motorla eşitlik,
// aynı yönde açık işlem kilidi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLONE, aggregate, computableOf, htfDirOf, htfSeries, htfDirAt, htfAligned, clonePlanOf, simulateClone, runClone, cloneRecord, cloneValidation, cloneReport } from '../backtest/psl.js';
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

// ---------------- Aşama B — klon ----------------
test('klon: sabitler (ön kayıt Aşama B)', () => {
  assert.equal(CLONE.threshold, 6); assert.equal(CLONE.levelBars, 50); assert.equal(CLONE.invAtr, 2); assert.deepEqual(CLONE.tpX, [1, 1.5, 2.5, 3.5]);
  assert.deepEqual(CLONE.cost, { fee: 0.05, slip: 0.05 }); assert.deepEqual(CLONE.authorCost, { fee: 0.025, slip: 0 });
  assert.equal(CLONE.validation.length, 10);
  assert.equal(new Date(CLONE.validation[0].time).toISOString(), '2026-06-02T04:00:00.000Z', '02.06 07:00 UTC+3');
  assert.equal(new Date(CLONE.validation[8].time).toISOString(), '2026-11-08T20:00:00.000Z', '08.11 23:00 UTC+3');
  assert.deepEqual(CLONE.validation.map((v) => v.d), [-1, -1, -1, -1, 1, 1, 1, 1, -1, -1]);
});

test('klon: 1D → haftalık (Pazartesi UTC) / aylık mumlar; kısmi hafta da mum', () => {
  const t0 = Date.UTC(2026, 0, 28); // Çarşamba
  const ds = Array.from({ length: 12 }, (_, k) => ({ time: t0 + k * DAY, open: 10 + k, high: 20 + k, low: 5 + k, close: 11 + k, volume: 1 }));
  const w = aggregate(ds, 'W');
  assert.equal(w.length, 2);
  assert.equal(new Date(w[0].time).toISOString(), '2026-01-26T00:00:00.000Z'); // Pazartesi
  assert.equal(w[0].closeTime, Date.UTC(2026, 1, 2));
  assert.deepEqual([w[0].open, w[0].high, w[0].low, w[0].close, w[0].volume], [10, 24, 5, 15, 5]); // Çar–Paz 5 gün
  const m = aggregate(ds, 'M');
  assert.equal(m.length, 2); assert.equal(m[0].closeTime, Date.UTC(2026, 1, 1)); assert.equal(m[1].time, Date.UTC(2026, 1, 1)); assert.equal(m[0].close, 14);
});

test('klon: üst TF yönü yalnız KAPANMIŞ mumdan (kapanış ≤ T); süren hafta / ay kullanılmaz', () => {
  const s = { closeTimes: [100, 200, 300], dirs: [1, -1, 1] };
  assert.equal(htfDirAt(s, 99), 0); assert.equal(htfDirAt(s, 100), 1); assert.equal(htfDirAt(s, 299), -1); assert.equal(htfDirAt(s, 300), 1);
  const ds = walk(400, 3, Date.UTC(2025, 0, 1), DAY);
  const wk = htfSeries(aggregate(ds, 'W'), (c) => c.closeTime);
  const T = ds[300].time + 12 * 3600e3;
  const ds2 = ds.map((c, k) => (k >= 300 ? { ...c, close: c.close * 5, high: c.high * 5 } : c));
  const wk2 = htfSeries(aggregate(ds2, 'W'), (c) => c.closeTime);
  assert.equal(htfDirAt(wk2, T), htfDirAt(wk, T), 'süren haftanın günleri kararı değiştirmez');
  const hs = { D: s, W: s, M: s };
  assert.equal(htfAligned(hs, 150, 1), true); assert.equal(htfAligned(hs, 250, 1), false);
  assert.equal(htfAligned({ D: s, W: s, M: { closeTimes: [], dirs: [] } }, 150, 1), false, 'üst TF yok → uyumlu değil');
});

test('klon: üst TF büyük taraf; eşitlik ve hesaplanamayan ölçüt', () => {
  assert.equal(computableOf({}), 0); assert.equal(htfDirOf({}), 0, 'hiç ölçüt yok → 0');
  assert.equal(computableOf({ open: 1, close: 2 }), 1);
  assert.equal(htfDirOf({ open: 1, close: 2 }), 1, 'yalnız mum yönü hesaplanabiliyor → o');
  assert.equal(htfDirOf({ open: 1, close: 2, ema50: 1, ema169: 2 }), 0, '1 / 1 eşit');
  assert.equal(htfDirOf({ open: 2, close: 1, ema50: 1, ema169: 2, rsi: 40 }), -1);
});

const bar = (k, o, h, l, c) => ({ time: k * H4, open: o, high: h, low: l, close: c, volume: 1 });
test('klon: plan seviyesi = mum dahil son 50 mumun dibi / tepesi; geçersiz 2 ATR; hedefler 1 / 1,5 / 2,5 / 3,5 ×', () => {
  const cs = Array.from({ length: 60 }, (_, k) => bar(k, 100, 101 + (k === 20 ? 5 : 0), 99 - (k === 5 ? 10 : 0) - (k === 30 ? 3 : 0), 100));
  const s = clonePlanOf(cs, 59, -1, 1);
  assert.equal(s.level, 96, 'k=30 dibi (k=5 50 mumun dışında)'); assert.equal(s.invalid, 98); assert.deepEqual(s.tps, [94, 93, 91, 89]);
  const l = clonePlanOf(cs, 59, 1, 1); assert.equal(l.level, 106); assert.equal(l.invalid, 104); assert.deepEqual(l.tps, [108, 109, 111, 113]);
});

// SAT planı: seviye 100, birim 2 (geçersiz 102), hedefler 98 / 97 / 95 / 93. Tetik mumu 0 kapanış 99,5.
const P = { d: -1, level: 100, unit: 2, invalid: 102, tps: [98, 97, 95, 93], formedI: 0 };
const Z0 = { fee: 0, slip: 0 };
test('klon çıkışı (bizim): stop kapanışla ve KAPANIŞTAN; fitil stopu tetiklemez', () => {
  const wick = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 103, 99, 101), bar(2, 101, 101, 92, 92.5)];
  const s = simulateClone(wick, 0, P, { cost: Z0 });
  assert.equal(s.outcome, 'tp2'); assert.equal(s.R, +((99.5 - 93) / 2).toFixed(3), 'fitil 103 stopu çalıştırmaz; TP4 93');
  const closeOut = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 104, 99, 103)];
  const c = simulateClone(closeOut, 0, P, { cost: Z0 });
  assert.equal(c.outcome, 'stopped'); assert.equal(c.R, -1.75, 'çıkış kapanış 103 (seviye 102 değil): (99,5 − 103) ÷ 2');
  assert.equal(simulateClone(closeOut, 0, P, { acct: 'author', cost: Z0 }).R, -1.25, 'yazar: seviye 102\'den');
});
test('klon çıkışı: aynı mumda TP1 + stop kapanışı → bizim stop, yazar kazanç', () => {
  const both = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 103, 97.5, 102.5)];
  const r = simulateClone(both, 0, P, { cost: Z0 });
  assert.equal(r.outcome, 'stopped'); assert.equal(r.R, -1.5);
  const a = simulateClone(both, 0, P, { acct: 'author', cost: Z0 });
  assert.equal(a.outcome, 'tp1_be'); assert.equal(a.R, 0.75, 'TP1 98 → stop 98, kapanış ötesinde → 98\'den: (99,5 − 98) ÷ 2');
});
test('klon çıkışı: TP1 → stop TP1, TP2 değişmez, TP3 → stop TP2; maliyet', () => {
  const ladder = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 99.6, 96.8, 97.2), bar(2, 97.2, 98.2, 97, 98.1)];
  const s = simulateClone(ladder, 0, P, { cost: Z0 });
  assert.equal(s.hits, 2); assert.equal(s.outcome, 'tp1_be'); assert.equal(s.R, +((99.5 - 98.1) / 2).toFixed(3), 'stop TP1 (98), kapanış 98,1 → çıkış');
  const l3 = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 99.6, 94.8, 95.2), bar(2, 95.2, 97.2, 95, 97.1)];
  const s3 = simulateClone(l3, 0, P, { cost: Z0 });
  assert.equal(s3.hits, 3); assert.equal(s3.R, +((99.5 - 97.1) / 2).toFixed(3), 'stop TP2 (97)');
  const hold = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 99.6, 96.8, 97.9)];
  const h = simulateClone(hold, 0, P, { cost: Z0 });
  assert.equal(h.openAtEnd, true); assert.equal(h.outcome, 'tp1_timeout');
  // maliyet: giriş kayması + çıkış kayması + 2 × %0,05 × giriş, birim 2
  const cs = [bar(0, 100, 100, 99, 99.5), bar(1, 99.5, 104, 99, 103)];
  const m = simulateClone(cs, 0, P);
  const e = 99.5 * (1 - 0.0005), x = 103 * (1 + 0.0005);
  assert.ok(Math.abs(m.R - (-(x - e) - 0.001 * e) / 2) < 1e-3);
  const ma = simulateClone(cs, 0, P, { acct: 'author' });
  assert.ok(Math.abs(ma.R - (-(102 - 99.5) - 0.0005 * 99.5) / 2) < 1e-3);
});

test('klon durum makinesi: plan kilitlenir, iptal (yön terse / uyum bozulur), kapanışla tetik, açık işlemde yeni plan yok', () => {
  const n = 360, base = Array.from({ length: n }, (_, k) => bar(k, 100, 101, 99, 100));
  const S = { macd: 0, macdSig: 1, rsi: 40, stochK: 30, rvol: 2, open: 11, close: 10, ema50: 4, ema169: 5, adx: 30, pdi: 10, mdi: 30, cci: -50, atr: 1 };
  const indOf = () => Object.fromEntries(Object.keys(S).map((k) => [k, Array(n).fill(S[k])]));
  const down = { closeTimes: [0], dirs: [-1] }, htf = { D: down, W: down, M: down };
  // Plan 300'de: seviye 99, birim 2. 305'te kapanış 98,5 → tetik; sonra 307'de kapanış 101,5 > 101 → stop
  const cs = base.map((c, k) => (k === 305 ? bar(k, 100, 100, 98, 98.5) : k === 307 ? bar(k, 99, 102, 99, 101.5) : c));
  const r = runClone(cs, { tf: '4H', ind: indOf(), htf, accts: ['real', 'author'] });
  assert.equal(r.trades[0].plan.formedI, 300); assert.equal(r.trades[0].plan.level, 99); assert.equal(r.trades[0].ti, 305);
  assert.equal(r.trades[0].sims.real.exitI, 307);
  assert.equal(r.trades.length, 1); assert.equal(r.pending.formedI, 307, 'çıkış mumunun kapanışında yeni plan serbest (açık işlemde plan yok: 306 atlandı)');
  // Uyum bozulursa (D yönü 302'den sonra +1) tetiklenmemiş plan iptal
  const ms = 4 * 3600e3;
  const flip = { closeTimes: [0, cs[302].time + ms], dirs: [-1, 1] };
  const r2 = runClone(cs, { tf: '4H', ind: indOf(), htf: { D: flip, W: down, M: down } });
  assert.equal(r2.trades.length, 0); assert.equal(r2.cancelled, 1);
  // 4H yönü terse dönerse iptal: 303'te long 8 / 8
  const ind3 = indOf();
  Object.assign(ind3, Object.fromEntries(Object.entries({ macd: 2, rsi: 60, stochK: 60, close: 12, ema50: 6, pdi: 30, mdi: 10, cci: 50 }).map(([k, v]) => [k, ind3[k].map((x, i) => (i === 303 ? v : x))])));
  const r3 = runClone(cs, { tf: '4H', ind: ind3, htf });
  assert.equal(r3.cancelled, 1); assert.equal(r3.trades[0].plan.formedI, 304, 'iptalden sonra yeni plan');
  // kayıt: hedgeOf için time = tetik − 1 mum, entryTime = tetik kapanışı
  const rec = cloneRecord(cs, 'X', '4H', r.trades[0], 'real', null);
  assert.equal(rec.entryTime, cs[305].time + ms); assert.equal(rec.time, cs[304].time); assert.equal(Math.abs(rec.entryFill - rec.stop), 2);
});

test('klon doğrulaması: aynı yön ± 1 mum eşleşir, fazladan işlemler sayılır', () => {
  const ms = 4 * 3600e3, ref = [{ time: 10 * ms, d: -1 }, { time: 50 * ms, d: 1 }, { time: 90 * ms, d: 1 }];
  const tr = [{ trigTime: 11 * ms, d: -1 }, { trigTime: 52 * ms, d: 1 }, { trigTime: 70 * ms, d: -1 }, { trigTime: 90 * ms, d: -1 }, { trigTime: 200 * ms, d: 1 }];
  const v = cloneValidation(tr, ref, ms);
  assert.deepEqual(v.rows.map((r) => r.found), [true, false, false]); assert.equal(v.rows[0].diffBars, 1);
  assert.equal(v.matched, 1); assert.equal(v.cloneInWindow, 4); assert.equal(v.extra, 3);
});

test('klon raporu: karar yalnız bizim muhasebe, dönem tetik kapanışıyla', () => {
  const mk = (k, R, d) => ({ coin: `C${k % 5}`, tf: '4H', time: PSL.period.from + k * 6 * 3600e3 - 8 * 3600e3, entryTime: PSL.period.from + k * 6 * 3600e3, waitBars: 1, bars: 1, d, outcome: R > 0 ? 'tp2' : 'stopped', R, hedgedR: R, tp1Reached: R > 0 });
  const real = Array.from({ length: 2900 }, (_, k) => mk(k, k % 2 ? 1 : -1.2, k % 2 ? 1 : -1));
  const rep = cloneReport({ real, author: real.map((t) => ({ ...t, R: 1, hedgedR: 1 })) });
  assert.equal(rep.verdict, 'gecmez'); assert.equal(rep.groups.author.infoVerdict, 'gecer');
  assert.equal(rep.groups.long.all.n + rep.groups.short.all.n, rep.groups.primary.all.n);
  assert.equal(rep.groups.primary.tp1Rate, 0.5);
});
