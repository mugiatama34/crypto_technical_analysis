// Ön kayıt docs/arastirma/on-kayit-hacim-esigi.md: nedensel 7 günlük Bybit cirosu, eşik sınırı, Bybit'te olmayan coin, 100.000 $
// hesabı (bileşik / sabit), düşüş ve kayıp serisi, dönem ve gruplar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIQ, DAY, parseBybitKlines, turnoverIndex, avgTurnoverBefore, liqClass, GROUPS, isPrimary, exitTimeOf, accountSim, coinSpread, liqReport, universeOf } from '../backtest/liq.js';

const D0 = Date.UTC(2026, 0, 10); // gün başı
const rowsOf = (vals, start = D0) => vals.map((v, i) => [start + i * DAY, v]);

test('liq: ön kayıt sabitleri (dönem, eşik, pencere, maliyet)', () => {
  assert.equal(new Date(LIQ.period.from).toISOString(), '2025-11-17T00:00:00.000Z');
  assert.equal(new Date(LIQ.period.to).toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(LIQ.threshold, 20e6); assert.equal(LIQ.windowDays, 7); assert.equal(LIQ.top, 100); assert.equal(LIQ.tf, '4H');
  assert.deepEqual(LIQ.cost, { fee: 0.05, slip: 0.05 }); assert.deepEqual(LIQ.neighbors, [5e6, 50e6]);
});

test('liq: Bybit kline ayrıştırma (yeniden eskiye → eskiden yeniye, turnover sütunu)', () => {
  const list = [[String(D0 + DAY), '1', '2', '0.5', '1.5', '100', '2500.5'], [String(D0), '1', '2', '0.5', '1.5', '90', '1000']];
  assert.deepEqual(parseBybitKlines(list), [[D0, 1000], [D0 + DAY, 2500.5]]);
  assert.deepEqual(parseBybitKlines(undefined), []);
});

test('liq: nedensellik — sinyal günü ve sonrası kullanılmaz, önceki 7 kapanmış gün', () => {
  // Gün 0–6: 10 M$, gün 7 (sinyal günü): 1000 M$, gün 8: 1000 M$
  const idx = turnoverIndex(rowsOf([10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 1e9, 1e9]));
  const sigDay7 = D0 + 7 * DAY;
  for (const h of [0, 4, 20]) assert.equal(avgTurnoverBefore(idx, sigDay7 + h * 3600e3), 10e6, `saat ${h}: sinyal gününün cirosu girmez`);
  // Gün 8'de açılan mum: pencere gün 1–7 → (6 × 10 M + 1000 M) / 7
  assert.equal(avgTurnoverBefore(idx, D0 + 8 * DAY), (6 * 10e6 + 1e9) / 7);
  // Geleceği değiştirmek geçmiş sinyalin değerini değiştirmez
  const idx2 = turnoverIndex(rowsOf([10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 10e6, 0, 0]));
  assert.equal(avgTurnoverBefore(idx2, sigDay7 + 4 * 3600e3), avgTurnoverBefore(idx, sigDay7 + 4 * 3600e3));
});

test('liq: eksik gün → null (7 günlük veri yok), Bybit\'te olmayan coin ayrı sınıf', () => {
  const idx = turnoverIndex(rowsOf([30e6, 30e6, 30e6, 30e6, 30e6, 30e6]));
  assert.equal(avgTurnoverBefore(idx, D0 + 6 * DAY), null, 'yalnız 6 gün var');
  assert.equal(avgTurnoverBefore(idx, D0 + 5 * DAY), null);
  assert.equal(avgTurnoverBefore(null, D0 + 6 * DAY), null);
  const gap = new Map(rowsOf([30e6, 30e6, 30e6, 30e6, 30e6, 30e6, 30e6]).map(([t, v]) => [Math.floor(t / DAY), v]));
  gap.delete(Math.floor((D0 + 3 * DAY) / DAY));
  assert.equal(avgTurnoverBefore(gap, D0 + 7 * DAY), null, 'pencere ortasında boşluk');
  assert.equal(liqClass(null, false), 'nobybit');
  assert.equal(liqClass(50e6, false), 'nobybit');
  assert.equal(liqClass(null, true), 'nodata');
  assert.equal(GROUPS.noBybit.test({ onBybit: false, liq7: null }), true);
  assert.equal(GROUPS.below.test({ onBybit: false, liq7: null }), false, 'Bybit\'te olmayan eşik altına sayılmaz');
  assert.equal(isPrimary({ onBybit: false, liq7: 99e6 }), false);
});

test('liq: eşik sınırı (≥ 20 M$ geçer) ve komşu eşikler', () => {
  assert.equal(isPrimary({ onBybit: true, liq7: 20e6 }), true);
  assert.equal(isPrimary({ onBybit: true, liq7: 20e6 - 1 }), false);
  assert.equal(GROUPS.below.test({ onBybit: true, liq7: 19.99e6 }), true);
  assert.equal(GROUPS.thr5.test({ onBybit: true, liq7: 5e6 }), true);
  assert.equal(GROUPS.thr50.test({ onBybit: true, liq7: 49e6 }), false);
  assert.equal(GROUPS.primaryShort.test({ d: -1, onBybit: true, liq7: 30e6 }), true);
  assert.equal(GROUPS.primaryLong.test({ d: -1, onBybit: true, liq7: 30e6 }), false);
  const idx = turnoverIndex(rowsOf(Array(7).fill(20e6)));
  assert.equal(liqClass(avgTurnoverBefore(idx, D0 + 7 * DAY), true), 'pass');
});

// İşlem: 4H, plan mumu time, waitBars 1 → giriş time + 4 s, bars → çıkış = giriş + (bars + 1) × 4 s
const H4 = 4 * 3600e3;
const tr = (time, R, bars = 0, extra = {}) => ({ coin: 'X', time, tf: '4H', waitBars: 1, bars, outcome: R > 0 ? 'tp2' : 'stopped', R, ...extra });

test('liq: çıkış zamanı = çıkış mumu kapanışı', () => {
  assert.equal(exitTimeOf(tr(0, 1, 0)), H4 + H4);
  assert.equal(exitTimeOf(tr(0, 1, 3)), H4 + 4 * H4);
});

test('liq: 100.000 $ hesabı — sabit ve bileşik, kapanış sırası, eşzamanlı risk', () => {
  // Ardışık (çakışmayan) işlemler: +2R, −1R, −1R, +1R
  const seq = [tr(0, 2), tr(10 * H4, -1), tr(20 * H4, -1), tr(30 * H4, 1)];
  const f = accountSim(seq, { mode: 'fixed' });
  assert.equal(f.endEquity, 100000 + 1000 * (2 - 1 - 1 + 1)); assert.equal(f.totalR, 1);
  assert.equal(f.maxDDR, 2); assert.equal(f.maxDDUsd, 2000); assert.equal(f.maxDDPct, +((2000 / 102000) * 100).toFixed(2));
  assert.equal(f.maxLossStreak, 2); assert.equal(f.maxOpen, 1); assert.equal(f.maxOpenRiskUsd, 1000);
  const c = accountSim(seq, { mode: 'compound' });
  const e = 100000 * 1.02 * 0.99 * 0.99 * 1.01;
  assert.equal(c.endEquity, +e.toFixed(0));
  assert.equal(c.maxDDPct, +((1 - 0.99 * 0.99) * 100).toFixed(2));
  // Çakışan: A (0, 5 mum) ve B (1. mum, 0 mum) — B girişte A açık → 2 açık; bileşik B riski A kapanmadan önceki özsermayeden
  const ov = [tr(0, -1, 5), tr(H4, 3, 0)];
  const o = accountSim(ov, { mode: 'compound' });
  assert.equal(o.maxOpen, 2); assert.equal(o.maxOpenRiskUsd, 2000);
  // B önce kapanır (+3 × 1000), sonra A (−1 × 1000; risk girişte sabitlendi)
  assert.equal(o.endEquity, 100000 + 3000 - 1000);
  // Aynı anda çıkış ve giriş: çıkış önce → açık sayısı 1
  const touch = [tr(0, 1, 0), tr(H4, 1, 0)]; // A çıkışı = 2 × H4 = B girişi
  assert.equal(accountSim(touch, { mode: 'fixed' }).maxOpen, 1);
  // Bileşikte ikinci risk birincinin kârından sonra
  assert.equal(accountSim(touch, { mode: 'compound' }).endEquity, +(100000 * 1.01 * 1.01).toFixed(0));
});

test('liq: hesap yalnız dolan işlemleri sayar; düşüş en yüksekten', () => {
  const ts = [tr(0, 1), { ...tr(5 * H4, 0), outcome: 'expired' }, tr(10 * H4, -1), tr(20 * H4, -1), tr(30 * H4, -1), tr(40 * H4, 5)];
  const f = accountSim(ts, { mode: 'fixed' });
  assert.equal(f.n, 5); assert.equal(f.maxDDR, 3); assert.equal(f.maxLossStreak, 3); assert.equal(f.totalR, 3);
  assert.equal(f.minEquity, 98000);
});

test('liq: coin dağılımı ve rapor (karar yalnız birincil)', () => {
  const p = { from: 0, to: 300 * DAY, label: 'x' };
  const mk = (n, coin, liq7, onBybit = true) => Array.from({ length: n }, (_, i) => tr(i * DAY + (coin === 'A' ? 0 : 3600e3), i % 2 ? -1 : 1.5, 0, { coin, d: 1, liq7, onBybit, hedgedR: 0.1 }));
  const ts = [...mk(250, 'A', 30e6), ...mk(40, 'B', 1e6), ...mk(10, 'C', null, false)];
  assert.deepEqual(coinSpread(ts).top.map((x) => x.coin), ['A', 'B', 'C']);
  const r = liqReport({ touch: ts, lowerBar: ts, slip: { 0.1: ts } }, p);
  assert.equal(r.groups.primary.all.n, 250); assert.equal(r.groups.below.all.n, 40); assert.equal(r.groups.noBybit.all.n, 10); assert.equal(r.groups.all.all.n, 300);
  assert.equal(r.verdict, 'sonucsuz'); // doğrulama diliminde 50 işlem
  assert.equal(r.clustering.coins, 1);
  assert.ok(r.account.primary.compound && r.account.all.fixed && r.knifeLowerBar && r.slip['0.1']);
});

test('liq: evren özeti (Bybit\'te olmayan, eşiği hiç geçmeyen)', () => {
  const period = { from: D0 + 7 * DAY, to: D0 + 9 * DAY };
  const turnover = { A: { status: 'ok', rows: rowsOf(Array(9).fill(30e6)) }, B: { status: 'ok', rows: rowsOf(Array(9).fill(10e6)) }, C: { status: 'invalid', rows: [] } };
  const u = universeOf(turnover, ['A', 'B', 'C'], period);
  assert.equal(u.onBybit, 2); assert.deepEqual(u.notOnBybit, ['C']); assert.deepEqual(u.neverPass, ['B']);
  assert.deepEqual(u.neverPassNeighbors[5e6], []); assert.deepEqual(u.neverPassNeighbors[50e6], ['A', 'B']);
});
