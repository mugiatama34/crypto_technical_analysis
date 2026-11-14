// Fonlama geliri (taşıma) ölçümü (backtest/carry.js; ön kayıt docs/arastirma/on-kayit-fonlama.md): yıllıklandırma ve işaret, haftalık
// kararın yalnız önceki haftayı kullanması, R2 seçim + maliyet, R3 eşik, sermaye ölçeği, en kötü 4 hafta, maliyet parametresi, verdict,
// sayfalama birleştirme, ad eşleme. Ağ yok, sentetik veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annualize, eq8h, mapCoin, parseHlRows, mergeRows, withPeriods, mondayOf, buildWeeks, weeklyPanel, ruleR1, ruleR2, ruleR3, summarize,
  worstWindow, rulePasses, verdictOf, spearman, crossCoin, runCarry, COSTS, VERDICT, HOUR, DAY, WEEK, HALF_A_START, HALF_B_START, CARRY_DEFAULTS,
} from '../backtest/carry.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const W0 = Date.UTC(2024, 0, 1); // pazartesi
/** Saatlik satırlar: from..to, oran fn(t). */
const hourly = (from, to, fn) => { const out = []; for (let t = from; t < to; t += HOUR) out.push({ time: t, rate: fn(t), h: 1 }); return out; };
const panelOf = (spec, weeks) => weeklyPanel(spec.map(([coin, fn]) => ({ coin, rows: hourly(weeks[0] - WEEK, weeks[weeks.length - 1] + WEEK, fn) })), weeks);
const weeksN = (n) => Array.from({ length: n }, (_, i) => W0 + i * WEEK);

test('yıllıklandırma, 8 s eşdeğeri ve işaret (pozitif oran → short alır, +)', () => {
  close(annualize(0.0001 * 10, 10), 0.876);
  close(eq8h(0.0001 * 10, 10), 0.0008);
  assert.equal(annualize(1, 0), null);
  const p = panelOf([['BTC', () => -0.00001]], weeksN(2));
  const s = summarize(ruleR1(p, weeksN(2)), { cost: 0 });
  assert.ok(s.nominal.netAnnPct < 0); // negatif fonlamada taşıma öder
  close(s.nominal.grossAnnPct, -0.00001 * 168 * (365.25 / 7) * 100, 1e-3);
});

test('HL ilk dönem 8 saatlik kayıtları 8 saati kapsar; saatlik dönemde boşluk kapsanmaz', () => {
  const t = HALF_A_START;
  const rows = withPeriods([{ time: t, rate: 1e-4 }, { time: t + 8 * HOUR, rate: 1e-4 }, { time: t + 16 * HOUR, rate: 1e-4 }, { time: Date.UTC(2024, 0, 1), rate: 1e-5 }, { time: Date.UTC(2024, 0, 1) + 8 * HOUR, rate: 1e-5 }]);
  assert.deepEqual(rows.map((x) => x.h), [8, 8, 8, 1, 1]);
});

test('sayfalama birleştirme: yinelenen saat atılır, sıralı; saat başına yuvarlama', () => {
  const p1 = parseHlRows([{ time: 3600e3 * 10 + 139, fundingRate: '0.0001' }, { time: 3600e3 * 11 + 5, fundingRate: '0.00002' }, { time: 'x', fundingRate: '1' }]);
  const p2 = parseHlRows([{ time: 3600e3 * 11 + 99, fundingRate: '0.9' }, { time: 3600e3 * 12, fundingRate: '-0.00001' }]);
  const m = mergeRows(p1, p2);
  assert.deepEqual(m.map((x) => x.time), [36000e3, 39600e3, 43200e3]);
  assert.equal(m[1].rate, 0.00002); // ilk gelen kalır
});

test('ad eşleme: aynısı, 1000\'lik k öneki, bulunamayan null', () => {
  const hl = ['BTC', 'kPEPE', 'kBONK'];
  assert.equal(mapCoin('BTC', hl), 'BTC');
  assert.equal(mapCoin('PEPE', hl), 'kPEPE');
  assert.equal(mapCoin('1000BONK', hl), 'kBONK');
  assert.equal(mapCoin('OKB', hl), null);
  assert.equal(mondayOf(Date.UTC(2024, 0, 7, 23)), W0);
  assert.deepEqual(buildWeeks(Date.UTC(2023, 11, 30), W0 + 2 * WEEK + 5), [W0, W0 + WEEK]);
});

test('haftalık karar yalnız önceki 7 günü kullanır (hafta içi sıçrama seçimi değiştirmez)', () => {
  const weeks = weeksN(3);
  // A: önceki haftalarda yüksek; B: yalnız 2. haftanın İÇİNDE çok yüksek → 2. hafta seçimi A, 3. hafta B
  const p = panelOf([['A', (t) => (t < weeks[1] ? 5e-5 : 0)], ['B', (t) => (t >= weeks[1] && t < weeks[2] ? 1e-3 : 0)]], weeks);
  const r = ruleR2(p, weeks, { ...CARRY_DEFAULTS, topK: 1 });
  assert.deepEqual(r.map((x) => x.held), [['A'], ['A'], ['B']]);
  close(r[1].gross, 0); // A seçildi, gerçekleşen 0 (geleceğe bakma yok)
});

test('R2 seçim + maliyet: yeni giren coin %0,30 × ağırlık, kalan coinde maliyet yok; eşik altı aday değil; < 5 gün veri aday değil', () => {
  const weeks = weeksN(3);
  const p = panelOf([
    ['A', () => 2e-5], ['B', () => 3e-5],
    ['C', (t) => (t >= weeks[1] - WEEK ? 4e-5 : 1e-6)], // 2. haftadan itibaren aday
    ['D', () => 1e-5], // 8 s = %0,008 < eşik
  ], weeks);
  const r = ruleR2(p, weeks);
  assert.deepEqual(r.map((x) => x.held), [['B', 'A'], ['C', 'B', 'A'], ['C', 'B', 'A']]);
  assert.deepEqual(r.map((x) => x.entries), [2, 1, 0]);
  const s = summarize(r, { cost: 0.003 });
  const expNet = [(2e-5 + 3e-5) / 2 * 168 - 0.003, (2e-5 + 3e-5 + 4e-5) / 3 * 168 - 0.003 / 3, 3e-5 * 168];
  close(s.nominal.netAnnPct, Math.round((expNet.reduce((a, b) => a + b) / 3) * (365.25 / 7) * 1e5) / 1e3);
  // veri yalnız 4 gün → aday değil
  const short = weeklyPanel([{ coin: 'E', rows: hourly(weeks[0] - 4 * DAY, weeks[0] + WEEK, () => 1e-3) }], weeks.slice(0, 1));
  assert.deepEqual(ruleR2(short, weeks.slice(0, 1))[0].held, []);
});

test('R3 eşik: BTC 8 s eşdeğeri tam %0,01 (HL taban) geçmez, üstü geçer; çıkış-yeniden giriş maliyet öder', () => {
  const weeks = weeksN(4);
  const p = panelOf([['BTC', (t) => (t < weeks[0] ? 1.25e-5 : t < weeks[1] ? 2e-5 : t < weeks[2] ? 1e-6 : 2e-5)]], weeks);
  const r = ruleR3(p, weeks);
  assert.deepEqual(r.map((x) => x.held), [[], ['BTC'], [], ['BTC']]);
  assert.deepEqual(r.map((x) => x.entries), [0, 1, 0, 1]);
  const s = summarize(r);
  assert.equal(s.idleShare, 0.5); assert.equal(s.entries, 2);
});

test('R1 maliyet yalnız ilk haftada; sermaye ölçeği ÷ 1,33; maliyet parametresi etkisi', () => {
  const weeks = weeksN(10);
  const p = panelOf([['BTC', () => 1e-5], ['ETH', () => 1e-5]], weeks);
  const r = ruleR1(p, weeks);
  assert.deepEqual(r.map((x) => x.costN), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const a = summarize(r, { cost: COSTS.preReg }), b = summarize(r, { cost: COSTS.bybitStd });
  close(a.capital.netAnnPct, a.nominal.netAnnPct / 1.33, 2e-3);
  const g = 1e-5 * 168;
  close(a.nominal.netAnnPct, Math.round(((10 * g - 0.003) / 10) * (365.25 / 7) * 1e5) / 1e3);
  close(b.nominal.netAnnPct, Math.round(((10 * g - 0.0039) / 10) * (365.25 / 7) * 1e5) / 1e3);
  // maliyet farkı = (0,39 − 0,30) % / 10 hafta × 52,18; brüt aynı
  close(a.nominal.netAnnPct - b.nominal.netAnnPct, (0.0009 / 10) * (365.25 / 7) * 100, 2e-3);
  assert.equal(a.nominal.grossAnnPct, b.nominal.grossAnnPct);
  assert.equal(COSTS.bybitStd, 0.0039); close(2 * (0.001 + 0.0002) + 2 * (0.00055 + 0.0002), COSTS.bybitStd);
  close(4 * (0.00055 + 0.0002), COSTS.preReg);
});

test('en kötü 4 hafta: ardışık pencere toplamı', () => {
  assert.equal(worstWindow([1, -1, -2, 0, -1, 3, -5], 4), -4);
  close(worstWindow([0.01, 0.02], 4), 0.03);
  assert.equal(worstWindow([], 4), null);
});

test('verdict: iki yarıda da sermaye net > %5 ve en kötü 4 hf > −%2 (elle sayılar)', () => {
  const H = (net, w) => ({ capital: { netAnnPct: net, worst4wPct: w } });
  assert.equal(rulePasses({ A: H(6, -1), B: H(5.5, -1.9) }), true);
  assert.equal(rulePasses({ A: H(6, -1), B: H(5, -1) }), false); // > %5 kesin
  assert.equal(rulePasses({ A: H(9, -2.1), B: H(9, -1) }), false);
  assert.equal(rulePasses({ A: H(9, -1), B: null }), false);
  assert.deepEqual(verdictOf({ R1: { A: H(1, 0), B: H(1, 0) }, R2: { A: H(8, -1), B: H(7, -0.5) }, R3: null }), { passing: ['R2'], result: VERDICT.pass });
  assert.deepEqual(verdictOf({ R1: { A: H(1, 0), B: H(10, 0) } }), { passing: [], result: VERDICT.fail });
  assert.equal(verdictOf({ R1: null, R2: null }), null);
});

test('spearman ve çapraz denetim oranı', () => {
  close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  close(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  const d0 = Date.UTC(2026, 7, 1);
  const hl = hourly(d0, d0 + 5 * DAY, () => 2e-5);
  const okx = []; for (let t = d0; t < d0 + 5 * DAY; t += 8 * HOUR) okx.push({ time: t, rate: 1e-4 });
  const c = crossCoin(hl, okx);
  assert.equal(c.days, 3); // ilk ve son OKX günü hariç
  close(c.ratioTotal, (24 * 2e-5) / 3e-4); close(c.ratioMedian, 1.6);
});

test('runCarry uçtan uca: iki maliyet etiketli, verdict %0,39 ile, OKX yoksa ölçeklenmiş null', () => {
  const end = Date.UTC(2025, 8, 1);
  const series = ['BTC', 'ETH', 'X'].map((coin, k) => ({ coin, hl: coin, rows: hourly(HALF_A_START, end, () => 1e-5 * (k + 1)) }));
  const rep = runCarry({ series, top10: ['BTC', 'ETH', 'X'], end });
  assert.deepEqual(Object.keys(rep.c3), ['preReg', 'bybitStd']);
  assert.equal(rep.verdict.cost, 'bybitStd');
  assert.equal(rep.crossCheck.available, false);
  assert.equal(rep.verdict.scaled, null);
  assert.ok(rep.verdict.unscaled.result);
  assert.ok(rep.c3.preReg.rules.R2.unscaled.A.nominal.netAnnPct > rep.c3.bybitStd.rules.R2.unscaled.A.nominal.netAnnPct);
  assert.ok(rep.period.from >= HALF_A_START && rep.c3.bybitStd.rules.R1.unscaled.B.weeks > 0 && HALF_B_START > rep.period.from);
  // OKX verisi verilince ölçeklenmiş satırlar (OKX = HL/2 → HL/OKX = 2, ölçek 1/2, brüt ×0,5)
  const okx = {}; for (const s of series) okx[s.coin] = s.rows.filter((x) => x.time >= end - 30 * DAY).map((x) => ({ time: x.time, rate: x.rate / 2 }));
  const rep2 = runCarry({ series, okx, top10: [], end });
  assert.equal(rep2.crossCheck.available, true); close(rep2.crossCheck.ratioUsed.R3, 2);
  close(rep2.c3.bybitStd.rules.R3.scaled.all.nominal.grossAnnPct, 0.5 * rep2.c3.bybitStd.rules.R3.unscaled.all.nominal.grossAnnPct, 1e-2);
  assert.notEqual(rep2.verdict.scaled, null);
});
