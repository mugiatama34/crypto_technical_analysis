// Ölçüm dürüstlüğü (13.11): gerçekçi/iyimser ayrımı, gün bloklu bootstrap aralığı, fonlama, hedge başlangıcı, lab varsayılan listesi,
// sayfa yardımcıları (src/ui/measure.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, statsCi, dayBlockCi, mulberry32, meetsStrict, MIN_N } from '../backtest/report.js';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';
import { hedgeOf, rankResults, strictPassOf } from '../backtest/sweep.mjs';
import { attachBtc, pickStrategies } from '../backtest/lab/run.mjs';
import { STRATEGIES, STRATEGY_MAP, DEFAULT_OFF, DEFAULT_STRATEGIES } from '../backtest/lab/strategies.js';
import { ciNote, rWithCi, measureBadges, strictSummary, isInconclusive, rowClass } from '../src/ui/measure.js';

const H = 3600e3, DAY = 86400e3;
const tr = (day, R, h = 0) => ({ outcome: R > 0 ? 'tp2' : 'stopped', R, tf: '1H', time: day * DAY + h * H, waitBars: 1 });

test('PRNG sabit tohumlu: aynı tohum aynı dizi, farklı tohum farklı; [0,1)', () => {
  const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
  const xa = Array.from({ length: 5 }, a), xb = Array.from({ length: 5 }, b), xc = Array.from({ length: 5 }, c);
  assert.deepEqual(xa, xb); assert.notDeepEqual(xa, xc);
  assert.ok(xa.every((x) => x >= 0 && x < 1));
});

test('dayBlockCi: deterministik, ortalamayı kapsar; aynı gün işlemleri birlikte örneklenir (aralık genişler)', () => {
  // 40 gün × 5 işlem; her günün 5 işlemi aynı sonuç (aynı piyasa hareketi) → blok yapısı
  const same = []; const indep = [];
  const rnd = mulberry32(1);
  for (let d = 0; d < 40; d++) { const R = rnd() < 0.45 ? 1.5 : -1; for (let k = 0; k < 5; k++) same.push(tr(d, R, k)); }
  // Aynı R'ler, ama her işlem ayrı günde (bağımsız): blok etkisi yok
  same.forEach((t, i) => indep.push(tr(i, t.R)));
  const a = dayBlockCi(same), b = dayBlockCi(same), c = dayBlockCi(indep);
  assert.deepEqual(a, b);
  const m = stats(same).avgR;
  assert.ok(a[0] < m && m < a[1], `${a} ∌ ${m}`);
  assert.ok(a[1] - a[0] > (c[1] - c[0]) * 1.6, `blok ${a[1] - a[0]} vs bağımsız ${c[1] - c[0]}`); // ≈ √5 kat
  // Dolmayan işlemler sayılmaz; tek gün → null
  assert.deepEqual(dayBlockCi([...same, { outcome: 'expired', R: 0, tf: '1H', time: 0 }]), a);
  assert.equal(dayBlockCi([tr(1, 1), tr(1, -1, 2)]), null);
  assert.equal(dayBlockCi([]), null);
});

test('statsCi: stats alanları birebir aynı + ci90 + inconclusive (n < 100); meetsStrict', () => {
  const few = Array.from({ length: 30 }, (_, i) => tr(i, i % 3 ? -1 : 2.5));
  const s = statsCi(few), base = stats(few);
  for (const [k, v] of Object.entries(base)) assert.deepEqual(s[k], v, k);
  assert.equal(s.inconclusive, true); assert.equal(s.ci90.length, 2);
  const many = Array.from({ length: 120 }, (_, i) => tr(i, i % 3 ? -1 : 2.5));
  const m = statsCi(many);
  assert.equal(m.inconclusive, false); assert.equal(MIN_N, 100);
  assert.equal(meetsStrict(m, m), m.avgR > 0 && m.profitFactor > 1.1);
  assert.equal(meetsStrict(s, s), false); // n < 100
  assert.equal(meetsStrict(m, { ...m, profitFactor: 1.05 }), false);
  assert.equal(statsCi([]).ci90, null);
});

test('fonlama: varsayılan 0 → sonuç birebir aynı (fundingR alanı yok); oran > 0 → iki yönde maliyet = oran × süre/8s ÷ stop%', () => {
  const c = (i, o, h, l, cl) => ({ time: i * H, open: o, high: h, low: l, close: cl });
  // long piyasa girişi 100, stop 98 (risk 2, stop %2); 15 mum yatay, sonra süre dolumu (maxHoldBars 16)
  const cs = Array.from({ length: 30 }, (_, i) => c(i, 100, 100.5, 99.5, 100));
  const plan = { d: 1, entry: 100, stop: 98, tp1: 110, tp2: 120, inZone: true, atr: 1 };
  const o = { ...BT_DEFAULTS, feePct: 0, slipPct: 0, maxHoldBars: 16 };
  const a = simulateTrade(plan, cs, 0, '1H', o), z = simulateTrade(plan, cs, 0, '1H', { ...o, fundingPct8h: 0 });
  assert.equal(BT_DEFAULTS.fundingPct8h, 0);
  assert.deepEqual(a, z); assert.equal('fundingR' in a, false);
  const f = simulateTrade(plan, cs, 0, '1H', { ...o, fundingPct8h: 0.01 });
  const hold = (a.bars + 1) * H; // dolum ve çıkış mumu dahil
  const exp = (0.0001 * (hold / (8 * H))) / 0.02;
  assert.ok(Math.abs(f.fundingR - exp) < 1e-4, `${f.fundingR} vs ${exp}`);
  assert.ok(Math.abs(a.R - f.R - exp) < 2e-3);
  // short da öder (ihtiyatlı, xsmom.js ile aynı kural)
  const s = simulateTrade({ ...plan, d: -1, stop: 102, tp1: 90, tp2: 80 }, cs, 0, '1H', { ...o, fundingPct8h: 0.01 });
  assert.ok(s.fundingR > 0 && Math.abs(s.fundingR - exp) < 1e-4);
});

test('hedge başlangıcı: hedgedR (eski, dolum mumu kapanışı) aynen; hedgedROpen dolum mumunun açılışından — fark = dolum mumundaki BTC% ÷ stop%', () => {
  // BTC 1H: dolum mumu (1. saat) 100 → 101 (+%1), çıkış mumunda 102. Long, stop %2, R = 1.
  const btc = [{ time: 0, close: 100 }, { time: H, close: 101 }, { time: 2 * H, close: 101.5 }, { time: 3 * H, close: 102 }];
  const t = { time: 0, tf: '1H', waitBars: 1, bars: 2, tp1Bars: null, d: 1, entryFill: 100, stop: 98, R: 1 };
  const h = hedgeOf(t, btc, 0, 0.5);
  assert.equal(h.hedgedR, +(1 - (102 / 101 - 1) / 0.02).toFixed(3)); // ≈ 0,505
  assert.equal(h.hedgedROpen, +(1 - (102 / 100 - 1) / 0.02).toFixed(3)); // 0,000
  const diff = h.hedgedR - h.hedgedROpen;
  assert.ok(Math.abs(diff - 0.505) < 0.002, `fark ${diff}R`); // %1'lik dolum mumu × 1/%2 stop ≈ 0,5R (işlem başına)
  // Önceki mum yoksa yeni alan null, eski alan yine hesaplanır
  const h2 = hedgeOf({ ...t, time: -H }, btc, 0, 0.5);
  assert.ok(h2.hedgedR != null); assert.equal(h2.hedgedROpen, null);
  assert.deepEqual(hedgeOf(t, null, 0, 0.5), { btcPct: null, hedgedR: null });
});

test('lab attachBtc: hedgedR değişmez; hedgedROpen açılıştan ve gerçek dolum fiyatıyla (teyitli giriş)', () => {
  const btc = [{ time: 9 * H, close: 100 }, { time: 10 * H, close: 100 }, { time: 11 * H, close: 101 }, { time: 15 * H, close: 103 }];
  const closeAt = (tf, x) => { let v = null; for (const c of btc) if (c.time <= x) v = c.close; return v; };
  const t = [{ tf: '1H', time: 10 * H, waitBars: 1, bars: 4, direction: 'long', R: 1, outcome: 'tp2', entry: 100, stop: 98, entryFill: 99 }];
  attachBtc(t, closeAt, 0);
  assert.equal(t[0].hedgedR, +(1 - (103 / 101 - 1) / 0.02).toFixed(3)); // eski: plan girişiyle stop %2, dolum mumu kapanışından
  assert.equal(t[0].hedgedROpen, +(1 - (103 / 100 - 1) / (1 / 99)).toFixed(3)); // yeni: açılıştan, stop = |99 − 98| / 99
});

test('tarama sıralaması ve özet: gerçekçi satırlar önce; strictPass gerçekçi / yalnız iyimser / varyant', () => {
  const row = (name, realistic, avgR, meets) => ({ name, realistic, meetsStrict: meets, strict: realistic && meets, valid: { avgR } });
  const rs = [row('a', false, 0.5, true), row('b', true, 0.1, true), row('c', true, 0.2, false), row('eski'), row('d', false, 0.9, false)];
  rs[3].valid = { avgR: 0.3 };
  rankResults(rs);
  assert.deepEqual(rs.map((r) => r.name), ['c', 'b', 'd', 'a', 'eski']);
  const p = strictPassOf(rs);
  assert.equal(p.realistic, 1); assert.equal(p.optimisticOnly, 1); assert.equal(p.variants, 5);
});

test('lab varsayılan listesi: hiçbir aile silinmez; varsayılan, all ve tek tek seçim', () => {
  assert.equal(STRATEGIES.length, 66);
  for (const id of DEFAULT_OFF) assert.ok(STRATEGY_MAP[id], id);
  assert.equal(DEFAULT_STRATEGIES.length + DEFAULT_OFF.size, STRATEGIES.length);
  assert.deepEqual(pickStrategies(null), DEFAULT_STRATEGIES);
  assert.deepEqual(pickStrategies([]), DEFAULT_STRATEGIES);
  assert.equal(pickStrategies(['all']).length, 66);
  assert.deepEqual(pickStrategies(['zigzag_c', 'yok']).map((s) => s.id), ['zigzag_c']);
  const ids = DEFAULT_STRATEGIES.map((s) => s.id);
  assert.ok(ids.includes('donchian') && ids.includes('xsmom_l28_k5_short_rel'));
  for (const off of ['engine_wide', 'zigzag_c', 'sweep_mss_fvg', 'div_rsi_mss', 'chan_fib_p0', 'range_dev', 'fib_cluster_g']) assert.ok(!ids.includes(off), off);
});

test('sayfa yardımcıları: yeni alanlı ve eski (alansız) dosyada hata yok', () => {
  const nw = { n: 80, avgR: 0.12, ci90: [-0.05, 0.3], inconclusive: true };
  assert.match(ciNote(nw), /%90 -0,05…0,30 · sonuçsuz/);
  assert.match(rWithCi(nw), /^0,120<br>/);
  assert.equal(ciNote({ n: 300, avgR: 0.1 }), ''); // eski dosya, n ≥ 100: not yok
  assert.match(ciNote({ n: 40, avgR: 0.1 }), /sonuçsuz/); // eski dosya: n'den türetilir
  assert.equal(ciNote({ n: 0, avgR: 0 }), ''); assert.equal(ciNote(null), '');
  assert.equal(isInconclusive({ n: 150, inconclusive: false }), false);
  assert.match(measureBadges({ realistic: false }), /iyimser dolum mumu/);
  assert.match(measureBadges({ realistic: true, strict: true }), /sıkı ✓/);
  assert.equal(measureBadges({ name: 'eski satır' }), ''); assert.equal(rowClass({}), ''); assert.equal(rowClass({ realistic: false }), 'opt');
  assert.equal(strictSummary({ results: [] }), '');
  const sm = strictSummary({ strictPass: { realistic: 0, optimisticOnly: 6, variants: 107 } });
  assert.match(sm, /<b>0<\/b> satır geçti/); assert.match(sm, /6 satır yalnız/); assert.match(sm, /107 varyant arasından/);
});
