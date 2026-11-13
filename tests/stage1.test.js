// Aşama 1 (backtest/stage1.js): 28 günlük BTC'ye göre getiri ve yüzdelik sıra (geleceğe bakmaz), üçte bir kuralı, portföy sınırı
// sayımı (bekleyen + açık, sonuçlanınca düşer, aynı anda puan sırası), lock 0'da kasa alanı yok, motor yapıcı komisyon seçeneği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retOf, pctRanks, rankAt, h1Ok, h1Bucket, capOpen, openBucket, resolveEndOf, analyze, slicesOf, sliceOf, LOOKBACK, COST_A, COST_B } from '../backtest/stage1.js';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';
import { randomWalk } from './helpers.js';

const H4 = 4 * 3600e3;
// Doğrusal seri: kapanış 0. mumda 100, son mumda 100 × (1 + g); n mum, zaman k × 4H
const lin = (n, g, t0 = 0) => Array.from({ length: n }, (_, k) => { const c = 100 * (1 + (g * k) / (n - 1)); return { time: t0 + k * H4, open: c, high: c, low: c, close: c }; });
const ser = (cs) => ({ candles: cs, idx: new Map(cs.map((c, i) => [c.time, i])) });

test('retOf: 168 mumluk kapanıştan kapanışa getiri; geçmiş yetmezse null; yalnız ≤ i mumları', () => {
  const cs = lin(LOOKBACK + 1, 0.2);
  assert.ok(Math.abs(retOf(cs, LOOKBACK) - 0.2) < 1e-12);
  assert.equal(retOf(cs, LOOKBACK - 1), null);
  const cs2 = [...cs, { time: 999 * H4, open: 1, high: 1e9, low: 1, close: 1e6 }];
  assert.equal(retOf(cs2, LOOKBACK), retOf(cs, LOOKBACK)); // sonraki mum değerini değiştirmez
});

test('pctRanks: en düşük 0, en yüksek 1, eşitlerde ortalama konum', () => {
  const r = pctRanks(new Map([['a', 1], ['b', 2], ['c', 3]]));
  assert.deepEqual([...r.values()], [0, 0.5, 1]);
  const t = pctRanks(new Map([['a', 1], ['b', 2], ['c', 2], ['d', 5]]));
  assert.deepEqual([t.get('a'), t.get('b'), t.get('c'), t.get('d')], [0, 0.5, 0.5, 1]);
  assert.equal(pctRanks(new Map([['a', 1]])).size, 0);
});

test('rankAt: BTC\'ye göre 28 günlük güç sırası (elle kurulmuş 12 coin), BTC sıraya girmez, ≥ 10 coin ve ≥ 168 mum şartı, geleceğe bakmaz', () => {
  const n = LOOKBACK + 6;
  const series = new Map([['BTC', ser(lin(n, 0.1))]]);
  const g = [-0.3, -0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6]; // C0..C11 (doğrusal → i = 168'de getiri g × 168/(n−1))
  g.forEach((x, k) => series.set(`C${k}`, ser(lin(n, x))));
  const tm = LOOKBACK * H4;
  const r = rankAt(tm, series);
  assert.equal(r.m, 12); assert.ok(!r.ranks.has('BTC'));
  assert.equal(r.ranks.get('C0'), 0); assert.equal(r.ranks.get('C11'), 1);
  assert.ok(Math.abs(r.ranks.get('C4') - 4 / 11) < 1e-12);
  // C5'in göreli getirisi ≈ 0 (BTC ile aynı)
  assert.ok(Math.abs(r.rel.get('C5')) < 1e-12);
  // Geçmiş yetmeyen an → sıra yok; 9 coin → sıra yok
  assert.equal(rankAt((LOOKBACK - 1) * H4, series), null);
  const few = new Map([...series].slice(0, 10)); // BTC + 9 coin
  assert.equal(rankAt(tm, few), null);
  // Geleceğe bakmaz: karar mumundan sonraki fiyatlar değişse de sıra aynı
  const fut = new Map([...series].map(([c, s]) => [c, ser(s.candles.map((x, k) => (k > LOOKBACK ? { ...x, close: c === 'C0' ? 1e6 : 1 } : x)))]));
  assert.deepEqual([...rankAt(tm, fut).ranks], [...r.ranks]);
  // BTC verisi yoksa sıra yok
  assert.equal(rankAt(tm, new Map([...series].filter(([c]) => c !== 'BTC'))), null);
});

test('üçte bir kuralı: long üst üçte bir (≥ 2/3), short alt üçte bir (≤ 1/3); dilimler uyumlu / orta / ters', () => {
  assert.equal(h1Ok(1, 2 / 3), true); assert.equal(h1Ok(1, 0.66), false); assert.equal(h1Ok(1, 1), true);
  assert.equal(h1Ok(-1, 1 / 3), true); assert.equal(h1Ok(-1, 0.34), false); assert.equal(h1Ok(-1, 0), true);
  assert.deepEqual([0.9, 0.5, 0.1].map((p) => h1Bucket(1, p)), ['aligned', 'middle', 'against']);
  assert.deepEqual([0.9, 0.5, 0.1].map((p) => h1Bucket(-1, p)), ['against', 'middle', 'aligned']);
});

test('portföy sınırı: bekleyen + açık sayılır, sonuçlanınca düşer, aynı anda yüksek puan önce, yönler ayrı', () => {
  const it = (key, decided, d, score, end) => ({ key, decided, d, score, end });
  const items = [
    it('a', 0, 1, 60, 10), it('b', 0, 1, 80, 5), // aynı an: b (80) önce
    it('c', 1, 1, 90, 20), // açık 2 → N = 2'de atlanır
    it('s', 1, -1, 70, 50), // short ayrı sayılır
    it('d', 5, 1, 50, 30), // b 5'te sonuçlandı (end ≤ an → düşer): açık 1 (a) → alınır
    it('e', 6, 1, 50, 40), // a + d açık = 2 → atlanır
  ];
  const r = capOpen(items, 2);
  assert.deepEqual(r.kept.map((x) => x.key), ['b', 'a', 's', 'd']);
  assert.deepEqual(r.skipped.map((x) => x.key), ['c', 'e']);
  assert.deepEqual(['b', 'a', 'c', 's', 'd', 'e'].map((k) => r.openAt.get(k)), [0, 1, 2, 0, 1, 2]);
  // Aynı anda puan eşitken: N = 1'de yalnız ilk (puan yüksek) alınır
  const t = capOpen([it('x', 0, 1, 70, 9), it('y', 0, 1, 75, 9)], 1);
  assert.deepEqual(t.kept.map((x) => x.key), ['y']);
  // Sınırsız sayım (N null): hepsi alınır, açık sayıları birikir
  assert.deepEqual(capOpen(items, null).kept.length, items.length);
  assert.deepEqual([0, 2, 3, 4, 5, 9, 10, 25].map(openBucket), ['0–2', '0–2', '3–4', '3–4', '5–9', '5–9', '≥ 10', '≥ 10']);
});

test('resolveEndOf: dolmayan plan kaçtığı / süresi dolduğu mumun kapanışında, dolan plan çıkış mumunun kapanışında sonuçlanır', () => {
  const c = (k, o, h, l, cl) => ({ time: k * H4, open: o, high: h, low: l, close: cl });
  const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0 };
  const plan = { d: 1, direction: 'long', entry: 95, stop: 90, tp1: 105, tp2: 110, zone: [94, 95], atr: 2, inZone: false };
  // Kaçtı: k = 3'te TP1'e dokunur, giriş hiç gelmez
  const miss = [c(0, 100, 100, 99, 100), c(1, 100, 101, 99, 100), c(2, 100, 102, 99, 101), c(3, 101, 106, 100, 105), c(4, 105, 106, 104, 105)];
  const sm = simulateTrade(plan, miss, 1, '4H', o);
  assert.equal(sm.outcome, 'missed');
  assert.equal(resolveEndOf(plan, miss, 1, '4H', o, sm), 4 * H4);
  // Süresi doldu: 24 saat = 6 mum (1..6) → 6. mumun kapanışı
  const flat = Array.from({ length: 12 }, (_, k) => c(k, 100, 101, 99, 100));
  const se = simulateTrade(plan, flat, 1, '4H', o);
  assert.equal(se.outcome, 'expired');
  assert.equal(resolveEndOf(plan, flat, 1, '4H', o, se), 7 * H4);
  // Dolan: k = 2'de dolum, k = 4'te stop → 4. mumun kapanışı
  const fill = [c(0, 100, 100, 99, 100), c(1, 100, 101, 98, 99), c(2, 99, 99, 94.5, 96), c(3, 96, 97, 95, 96), c(4, 96, 96, 89, 90), c(5, 90, 91, 89, 90)];
  const sf = simulateTrade(plan, fill, 1, '4H', o);
  assert.equal(sf.outcome, 'stopped');
  assert.equal(resolveEndOf(plan, fill, 1, '4H', o, sf), 5 * H4);
});

test('dilimler: geliştirme = son 360 gün (bölünme aşama 0), kasa = önceki 360 gün', () => {
  const end = Date.UTC(2026, 10, 13), s = slicesOf(end);
  assert.equal(s.dev.from - s.kasa.from, 360 * 86400e3);
  assert.equal(sliceOf(Date.UTC(2026, 6, 31), s), 'train');
  assert.equal(sliceOf(Date.UTC(2026, 7, 1), s), 'valid');
  assert.equal(sliceOf(s.dev.from - 1, s), 'kasa');
  assert.equal(sliceOf(s.kasa.from - 1, s), null);
});

// Sentetik satırlar (analyze girdisi): dilim başına yeterli işlem
function synthRows() {
  const rows = [];
  const slices = [['kasa', 0], ['train', 1000], ['valid', 2000]];
  for (const [slice, base] of slices) for (let k = 0; k < 150; k++) {
    const time = (base + k * 2) * H4, d = k % 3 === 0 ? -1 : 1, R = k % 2 ? 1.2 : -1;
    const tr = { time, tf: '4H', d, outcome: R > 0 ? 'tp2' : 'stopped', R, waitBars: 1, bars: 3, entryFill: 100, stop: 95, hedgedR: R - 0.1, hedgedROpen: R - 0.05 };
    rows.push({ key: `C${k % 12}|${time}|${d}`, coin: `C${k % 12}`, slice, d, score: 60 + (k % 7), decided: time + H4, end: time + 6 * H4, A: tr, B: { ...tr, R: R + 0.02 } });
  }
  return rows;
}

test('analyze: lock 0 → çıktıda kasa alanı hiç yok (kasa satırları verilse de); lock 1 → kasa + genel karar', () => {
  const rows = synthRows(), rankOf = (r) => ({ pct: (r.score - 60) / 6, m: 12 });
  const a0 = analyze(rows, { lock: false, rankOf });
  const js = JSON.stringify(a0);
  assert.ok(!/kasa/.test(js), 'lock 0 çıktısında kasa geçmemeli');
  assert.equal(a0.rows.base.train.n, 150); assert.equal(a0.rows.base.valid.n, 150);
  assert.ok('dev' in a0.pass.h1 && !('pass' in a0.pass.h1));
  const a1 = analyze(rows, { lock: true, rankOf });
  assert.equal(a1.rows.base.kasa.n, 150);
  assert.ok('pass' in a1.pass.h1 && 'kasa' in a1.pass.h4_3 && Array.isArray(a1.pass.anyPassed));
  // Geliştirme sonuçları lock'tan bağımsız (H4 akışları ayrı)
  for (const k of ['base', 'h1', 'h4_3', 'h4_5', 'h1h4_5']) for (const sp of ['train', 'valid']) assert.deepEqual(a1.rows[k][sp], a0.rows[k][sp]);
  // (b) maliyeti ayrı raporlanır
  assert.ok(a0.rows.base.train.cost.b > a0.rows.base.train.cost.a);
});

test('motor: feeMakerPct verilmezse sonuç değişmez; (b) modelinde limit giriş + limit hedef işlemin maliyeti düşer', () => {
  const cs = randomWalk(800, { seed: 11, tfMs: H4 });
  const o = { ...BT_DEFAULTS, ...COST_A };
  delete o.feeMakerPct;
  let n = 0, cheaper = 0;
  for (let i = 50; i < 700; i += 7) {
    const p = cs[i].close, d = i % 2 ? 1 : -1, atr = p * 0.01;
    const plan = { d, direction: d === 1 ? 'long' : 'short', entry: p - d * 0.5 * atr, stop: p - d * 2.5 * atr, tp1: p + d * 2 * atr, tp2: p + d * 4 * atr, zone: [p - atr, p], atr, inZone: false };
    const a = simulateTrade(plan, cs, i + 1, '4H', o), a2 = simulateTrade(plan, cs, i + 1, '4H', { ...o, feeMakerPct: null });
    assert.deepEqual(a2, a); // null = seçenek yok
    // feeMakerPct = feePct → eski model ile aynı (yuvarlama sınırında)
    const same = simulateTrade(plan, cs, i + 1, '4H', { ...o, feeMakerPct: o.feePct });
    assert.ok(Math.abs(same.R - a.R) <= 0.001);
    if (a.outcome === 'tp2') { // limit giriş + limit hedefler
      const b = simulateTrade(plan, cs, i + 1, '4H', { ...o, feeMakerPct: 0.02 });
      n++; if (b.R > a.R) cheaper++;
    }
  }
  assert.ok(n > 0 && cheaper === n);
  // Elle: limit giriş 100, stop 95 (risk 5), TP1 %50 @ 105, TP2 @ 110 → komisyon (a) 2 × 0,0005 × 100 / 5 = 0,02R; (b) 2 × 0,0002 × 100 / 5 = 0,008R
  const c = (k, op, h, l, cl) => ({ time: k * H4, open: op, high: h, low: l, close: cl });
  const path = [c(0, 101, 101, 100.5, 101), c(1, 101, 101, 99.5, 100.5), c(2, 100.5, 106, 100.2, 105), c(3, 105, 111, 104, 110)];
  const pl = { d: 1, direction: 'long', entry: 100, stop: 95, tp1: 105, tp2: 110, zone: [99, 100], atr: 2, inZone: false };
  const base = { ...BT_DEFAULTS, feePct: 0.05, slipPct: 0.05 };
  const ra = simulateTrade(pl, path, 1, '4H', base), rb = simulateTrade(pl, path, 1, '4H', { ...base, feeMakerPct: 0.02 });
  assert.equal(ra.outcome, 'tp2'); assert.equal(rb.outcome, 'tp2');
  assert.equal(ra.R, +(1.5 - 0.02).toFixed(3)); assert.equal(rb.R, +(1.5 - 0.008).toFixed(3));
  // Stop çıkışı (b): giriş yapıcı 0,02 + çıkış alıcı 0,055 → (0,0002 + 0,00055) × 100 / 5 = 0,015R
  const stopPath = [c(0, 101, 101, 100.5, 101), c(1, 101, 101, 99.5, 100), c(2, 100, 100, 94, 94.5)];
  const sb = simulateTrade(pl, stopPath, 1, '4H', { ...BT_DEFAULTS, ...COST_B });
  const stopR = (95 * (1 - 0.0005) - 100) / 5;
  assert.equal(sb.outcome, 'stopped'); assert.equal(sb.R, +(stopR - 0.015).toFixed(3));
});
