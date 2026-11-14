// Rejim haritası + trend testi (backtest/regime-map.js; ön kayıt docs/arastirma/on-kayit-rejim.md): trend / oynaklık / fonlama durumları,
// nedensellik, HT1 getiri ve maliyet aritmetiği, bacaklar, haftalık toplama, verdict / checks, Parça 2 hücre ataması, sentetik uçtan uca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  smaArr, trendOf, trendStates, stateAt, levelOf, volStates, fundingStates, dayReturn, ht1Days, ht2Days, weeklyOf, verdictOf, alignOf,
  signalsMap, weeklyMap, runRegimeMap, synthDaily, regimeDrift, mondayOf, RM_DEFAULTS, UP, DOWN, MIXED, HIGH, MID, LOW, ALIGN, VERDICT, DAY, WEEK,
  shortTrendOf, shortStates, stateAt4h, ht3Bars, dailyOfBars, shortSummary, forwardCells, verdict3Of, shortAlignMap, synth4h, HT3_DEFAULTS, H4,
} from '../backtest/regime-map.js';

const T0 = Date.UTC(2024, 0, 1); // pazartesi
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const bars = (closes, t0 = T0) => closes.map((c, k) => ({ time: t0 + k * DAY, open: c, high: c, low: c, close: c, volume: 1, quoteVol: 1 }));
/** Açılış ve kapanışı ayrı verilen mumlar. */
const oc = (pairs, t0 = T0) => pairs.map(([o, c], k) => ({ time: t0 + k * DAY, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1, quoteVol: 1 }));

test('smaArr ve trend sınıflaması: YUKARI / AŞAĞI / KARIŞIK, yavaş SMA öncesi durum yok', () => {
  assert.deepEqual(smaArr([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.equal(trendOf(10, 9, 8), UP);
  assert.equal(trendOf(7, 8, 9), DOWN);
  assert.equal(trendOf(8.5, 9, 8), MIXED); // kapanış < hızlı ama hızlı > yavaş
  assert.equal(trendOf(9.5, 9, 10), MIXED); // kapanış > hızlı ama hızlı < yavaş
  assert.equal(trendOf(10, 9, null), null);
  // Elle: hızlı 2, yavaş 4
  const up = trendStates(bars([1, 2, 3, 4, 5, 6]), 2, 4);
  assert.equal(up.size, 3); // ilk 3 gün (yavaş SMA yok) durumsuz
  assert.equal(up.get(T0 + 2 * DAY), undefined);
  assert.deepEqual([...up.values()], [UP, UP, UP]);
  const dn = trendStates(bars([6, 5, 4, 3, 2]), 2, 4);
  assert.deepEqual([...dn.values()], [DOWN, DOWN]);
  // Yükselişten sonra geri çekilme: kapanış hızlının altında, hızlı yavaşın üstünde → KARIŞIK
  const mx = trendStates(bars([1, 2, 3, 4, 5, 3.5]), 2, 4);
  assert.equal(mx.get(T0 + 5 * DAY), MIXED); // SMA2 = 4,25 > SMA4 = 3,875; kapanış 3,5 < 4,25
  // Varsayılan 50 / 200: 199 gün → durum yok; 200 → ilk durum son gün
  assert.equal(trendStates(bars(Array.from({ length: 199 }, (_, k) => 100 + k))).size, 0);
  const s200 = trendStates(bars(Array.from({ length: 200 }, (_, k) => 100 + k)));
  assert.equal(s200.size, 1); assert.equal(s200.get(T0 + 199 * DAY), UP);
});

test('nedensellik: t + 1 mumu t günü durumunu değiştirmez; durum ertesi günden geçerli (stateAt)', () => {
  const cs = bars(Array.from({ length: 260 }, (_, k) => 100 + Math.sin(k / 9) * 10 + k * 0.05));
  const a = trendStates(cs);
  const b = trendStates([...cs, { time: T0 + 260 * DAY, open: 1, high: 1e9, low: 1, close: 1e6, volume: 1 }]);
  for (const [t, st] of a) assert.equal(b.get(t), st);
  const v1 = volStates(cs, { ...RM_DEFAULTS, volMedDays: 60 }).ratio, v2 = volStates([...cs, { time: T0 + 260 * DAY, open: 1, high: 1, low: 1, close: 1e6 }], { ...RM_DEFAULTS, volMedDays: 60 }).ratio;
  for (const [t, x] of v1) near(v2.get(t), x);
  const m = new Map([[T0, UP], [T0 + DAY, DOWN]]);
  assert.equal(stateAt(m, T0 + DAY), UP); // gün açılışında yalnız önceki günün kapanışı bilinir
  assert.equal(stateAt(m, T0 + DAY + 4 * 3600e3), UP);
  assert.equal(stateAt(m, T0 + 2 * DAY), DOWN);
  assert.equal(stateAt(m, T0), null);
});

test('dayReturn: boş → long (1 birim), long → short (2 birim), fonlama 3 × %0,01; bacaklar toplamı net', () => {
  const o = { fee: 0.00075, fund8h: 0.0001 };
  const a = dayReturn(new Map(), new Map([['X', 1]]), new Map([['X', 0.02]]), o);
  near(a.gross, 0.02); near(a.cost, 0.00075); near(a.fund, 0.0003); near(a.net, 0.02 - 0.00105); near(a.long, a.net); near(a.short, 0);
  const b = dayReturn(new Map([['X', 1]]), new Map([['X', -1]]), new Map([['X', 0.01]]), o);
  near(b.gross, -0.01); near(b.cost, 0.0015); near(b.long, -0.00075); near(b.short, -0.01 - 0.00075 - 0.0003); near(b.long + b.short, b.net);
  const c = dayReturn(new Map([['X', -1]]), new Map(), new Map([['X', 0.05]]), o); // short → boş: kapanış maliyeti short bacakta
  near(c.net, -0.00075); near(c.short, -0.00075); near(c.long, 0);
  const d = dayReturn(new Map([['X', 1]]), new Map([['X', 1]]), new Map([['X', -0.03]]), o); // değişim yok: maliyet yalnız fonlama
  near(d.net, -0.03 - 0.0003);
});

test('ht1Days: pozisyon = önceki gün kapanış durumu, getiri açılış → ertesi açılış, maliyet / fonlama, boş pay nakitte; al-tut maliyetsiz', () => {
  const cs = oc([[100, 100], [100, 101], [110, 111], [121, 120], [110, 109], [99, 99], [99, 99]]);
  // Durumlar elle: gün 0 YUKARI, 1 YUKARI, 2 AŞAĞI, 3 KARIŞIK, 4 AŞAĞI
  const st = new Map([[T0, UP], [T0 + DAY, UP], [T0 + 2 * DAY, DOWN], [T0 + 3 * DAY, MIXED], [T0 + 4 * DAY, DOWN]]);
  const { rows, start, end } = ht1Days([{ coin: 'X', candles: cs, states: st }], RM_DEFAULTS);
  assert.equal(start, T0 + DAY); assert.equal(end, T0 + 5 * DAY);
  const f = 0.00075, fd = 0.0003;
  // gün 1: long (boş → long), açılış 100 → 110
  near(rows[0].net, 0.1 - f - fd); near(rows[0].bh, 0.1); near(rows[0].bhF, 0.1 - fd);
  // gün 2: long sürer, 110 → 121
  near(rows[1].net, 0.1 - fd);
  // gün 3: short (long → short: 2 birim), 121 → 110
  near(rows[2].net, 11 / 121 - 2 * f - fd); near(rows[2].long, -f); near(rows[2].short, 11 / 121 - f - fd);
  // gün 4: boş (short → boş), 110 → 99
  near(rows[3].net, -f); near(rows[3].short, -f);
  // gün 5: short (boş → short), 99 → 99
  near(rows[4].net, -f - fd);
  // İki varlık: Y hep KARIŞIK → X'in getirisi yarıya iner (Y payı nakitte)
  const stY = new Map([...st.keys()].map((t) => [t, MIXED]));
  const two = ht1Days([{ coin: 'X', candles: cs, states: st }, { coin: 'Y', candles: cs, states: stY }], RM_DEFAULTS).rows;
  near(two[0].net, (0.1 - f - fd) / 2); near(two[0].bh, 0.1);
});

test('weeklyOf: pazartesiden pazartesiye 7 günün toplamı (%), eksik haftalar atılır; long / short bacak ayrı seriler', () => {
  const rows = [];
  for (let k = 0; k < 19; k++) rows.push({ day: T0 + 2 * DAY + k * DAY, net: 0.001 * (k + 1), long: k % 2 ? 0.001 : 0, short: k % 2 ? 0 : -0.002 });
  // T0 + 2 g = çarşamba → ilk tam hafta T0 + 7 g (pazartesi)
  const w = weeklyOf(rows, 'net', rows[0].day, rows.at(-1).day);
  assert.equal(w.length, 2);
  assert.equal(w[0].start, T0 + WEEK); assert.equal(mondayOf(w[0].start), w[0].start);
  near(w[0].v, [6, 7, 8, 9, 10, 11, 12].reduce((a, b) => a + b, 0) * 0.1, 1e-9); // gün k = 5..11 → (k + 1) × %0,1
  const L = weeklyOf(rows, 'long', rows[0].day, rows.at(-1).day), S = weeklyOf(rows, 'short', rows[0].day, rows.at(-1).day);
  near(L[0].v, 0.1 * 4, 1e-9); // haftada k tek olan 4 gün (5, 7, 9, 11)
  near(S[0].v, -0.2 * 3, 1e-9); // k çift 3 gün (6, 8, 10)
  assert.equal(weeklyOf(rows.slice(0, 17), 'net', rows[0].day, rows[16].day).length, 1); // ikinci hafta eksik → atılır
});

test('oynaklık ve fonlama durumu eşikleri', () => {
  assert.equal(levelOf(1.26, 1.25, 0.8), HIGH); assert.equal(levelOf(1.25, 1.25, 0.8), MID);
  assert.equal(levelOf(0.79, 1.25, 0.8), LOW); assert.equal(levelOf(0.8, 1.25, 0.8), MID); assert.equal(levelOf(null, 1, 0), null);
  // Sabit oynaklık 400 gün, ardından 30 gün 3 kat → son gün YÜKSEK; ilk durum 30 + 364. günde
  const cs = synthDaily({ n: 430, t0: T0, seed: 3, sigma: 0.01 });
  for (let k = 401; k < 430; k++) { const r = (k % 2 ? 1 : -1) * 0.04; cs[k].close = cs[k - 1].close * (1 + r); }
  const v = volStates(cs);
  assert.equal(Math.min(...v.states.keys()), cs[394].time);
  assert.equal(v.states.get(cs[429].time), HIGH);
  const calm = volStates(synthDaily({ n: 430, t0: T0, seed: 4, sigma: 0.02 }).map((c, k, a) => (k > 400 ? { ...c, close: a[400].close * (1 + (k % 2 ? 0.001 : -0.001)) } : c)));
  assert.equal(calm.states.get(T0 + 429 * DAY), LOW);
  // Fonlama: saatlik oran → 8 s eşdeğer = 8 × saatlik
  const hourly = (rate, days, t0 = T0) => Array.from({ length: days * 24 }, (_, h) => ({ time: t0 + h * 3600e3, rate, h: 1 }));
  const day = T0 + 6 * DAY;
  assert.equal(fundingStates(hourly(0.0002 / 8, 7), [day]).states.get(day), HIGH);
  assert.equal(fundingStates(hourly(0.0001 / 8, 7), [day]).states.get(day), MID);
  assert.equal(fundingStates(hourly(0.00001 / 8, 7), [day]).states.get(day), LOW);
  assert.equal(fundingStates(hourly(0.00001 / 8, 4, T0 + 3 * DAY), [day]).states.get(day), undefined); // < 5 gün veri
  near(fundingStates(hourly(0.0002 / 8, 7), [day]).value.get(day), 0.0002);
});

test('verdictOf: ön kayıt ölçütü koşul koşul (elle kurulmuş sayılar)', () => {
  const per = (m, lo, sh, short, weeks = 100) => ({ total: { weeks, meanPct: m, ci90: [lo, m + 1], sharpe: sh }, short: { meanPct: short } });
  const row = (I, K) => ({ periods: { indep: I, known: K } });
  const plat = (a, b) => ({ fast: 30, slow: 150, ...row({ total: { meanPct: a } }, { total: { meanPct: b } }) });
  const plat2 = (a, b) => ({ ...plat(a, b), fast: 70, slow: 250 });
  const ok = verdictOf(row(per(0.5, 0.1, 0.8, 0.2), per(0.3, -0.2, 0.3, 0.1)), [plat(0.2, 0.1), plat2(0.3, 0.05)]);
  assert.equal(ok.verdict, VERDICT.pass);
  assert.deepEqual(Object.keys(ok.checks), ['indepWeeksEnough', 'indepMeanPos', 'indepCiLowPos', 'indepSharpe', 'indepShortPos', 'knownMeanPos', 'knownShortPos', 'plateau_30_150', 'plateau_70_250']);
  const fail = (I, K, P = [plat(0.2, 0.1), plat2(0.3, 0.05)]) => verdictOf(row(I, K), P);
  assert.equal(fail(per(0.5, -0.01, 0.8, 0.2), per(0.3, 0, 0.3, 0.1)).checks.indepCiLowPos, false);
  assert.equal(fail(per(0.5, 0.1, 0.49, 0.2), per(0.3, 0, 0.3, 0.1)).verdict, VERDICT.fail);
  assert.equal(fail(per(0.5, 0.1, 0.5, 0.2), per(0.3, 0, 0.3, 0.1)).verdict, VERDICT.pass); // Sharpe ≥ 0,5 sınırda geçer
  assert.equal(fail(per(0.5, 0.1, 0.8, -0.01), per(0.3, 0, 0.3, 0.1)).checks.indepShortPos, false);
  assert.equal(fail(per(0.5, 0.1, 0.8, 0.2), per(0.3, 0, 0.3, 0)).checks.knownShortPos, false);
  assert.equal(fail(per(0.5, 0.1, 0.8, 0.2), per(-0.1, 0, 0.3, 0.1)).checks.knownMeanPos, false);
  const p = fail(per(0.5, 0.1, 0.8, 0.2), per(0.3, 0, 0.3, 0.1), [plat(0.2, -0.1), plat2(0.3, 0.05)]);
  assert.equal(p.checks.plateau_30_150, false); assert.equal(p.checks.plateau_70_250, true); assert.equal(p.verdict, VERDICT.fail);
  // Bağımsız dönem < 52 hafta → sonuçsuz (diğerleri geçse de)
  assert.equal(fail(per(0.5, 0.1, 0.8, 0.2, 51), per(0.3, 0, 0.3, 0.1)).verdict, VERDICT.inconclusive);
});

test('Parça 2: trendle aynı yön / ters / karışık ataması ve hafta hücreleri', () => {
  assert.equal(alignOf(1, UP), ALIGN.same); assert.equal(alignOf(-1, DOWN), ALIGN.same);
  assert.equal(alignOf(1, DOWN), ALIGN.against); assert.equal(alignOf(-1, UP), ALIGN.against);
  assert.equal(alignOf(1, MIXED), ALIGN.mixed); assert.equal(alignOf(-1, MIXED), ALIGN.mixed); assert.equal(alignOf(1, null), null);
  const trend = new Map([[T0, UP], [T0 + DAY, DOWN], [T0 + 2 * DAY, MIXED]]), vol = new Map([[T0, HIGH], [T0 + DAY, LOW]]);
  const tr = (d, decided, R) => ({ d, decided, A: { time: decided - 4 * 3600e3, tf: '4H', d, outcome: R > 0 ? 'tp2' : 'stopped', R, waitBars: 1 } });
  const rows = [tr(1, T0 + DAY + 4 * 3600e3, 1), tr(-1, T0 + DAY + 8 * 3600e3, -1), tr(-1, T0 + 2 * DAY, 2), tr(1, T0 + 3 * DAY, -1), tr(1, T0 + 9 * DAY, 1)];
  const m = signalsMap(rows, trend, vol);
  assert.equal(m.byAlign[ALIGN.same].signals, 2); // long @ UP (gün 0), short @ DOWN (gün 1)
  assert.equal(m.byAlign[ALIGN.same].avgR, 1.5);
  assert.equal(m.byAlign[ALIGN.against].signals, 1); // short @ UP
  assert.equal(m.byAlign[ALIGN.mixed].signals, 1); // long @ MIXED (gün 2)
  assert.equal(m.noState.trend, 1); // gün 8 durumu yok
  assert.equal(m.byDirTrend[`long · ${UP}`].signals, 1); assert.equal(m.byDirTrend[`short · ${UP}`].signals, 1);
  assert.equal(m.byVol[HIGH].signals, 2); assert.equal(m.byVol[LOW].signals, 1); assert.equal(m.noState.vol, 2);
  assert.equal(m.byAlign[ALIGN.same].inconclusive, true); // n < 100
  // Hafta: pazartesi başlangıcı → önceki pazar kapanışı durumu
  const M = T0 + WEEK, tw = new Map([[M - DAY, DOWN], [M + 6 * DAY, UP]]);
  const w = weeklyMap([{ w: 1, start: M, v: 2 }, { w: 2, start: M + WEEK, v: -1 }, { w: 3, start: M + 2 * WEEK, v: 5 }], { trend: { map: tw, labels: [UP, DOWN, MIXED] } });
  assert.equal(w.trend[DOWN].weeks, 1); assert.equal(w.trend[DOWN].meanPct, 2);
  assert.equal(w.trend[UP].weeks, 1); assert.equal(w.trend[UP].meanPct, -1);
  assert.equal(w.trendNoState, 1); assert.equal(w.trend[MIXED].weeks, 0); assert.equal(w.trend[UP].inconclusive, true);
});

test('ht2Days: sepet BTC durumuyla yön alır, BTC / ETH hariç, hacimle ilk N, < basketMin → boş', () => {
  const n = 60, o = { ...RM_DEFAULTS, basketN: 2, basketMin: 2, basketVolDays: 5 };
  const mk = (coin, qv, g) => ({ coin, candles: Array.from({ length: n }, (_, k) => ({ time: T0 + k * DAY, open: 100 * (1 + g) ** k, high: 1, low: 1, close: 100 * (1 + g) ** (k + 1), volume: 1, quoteVol: qv })) });
  const alts = [mk('A', 10, 0.01), mk('B', 5, 0.01), mk('C', 1, -0.5), mk('ETH', 100, -0.5)];
  const st = new Map(Array.from({ length: n }, (_, k) => [T0 + k * DAY, k < 30 ? UP : DOWN]));
  const { rows } = ht2Days(alts, st, o, T0 + (n - 2) * DAY);
  assert.ok(rows.length > 0);
  const r0 = rows.find((r) => r.day === T0 + 10 * DAY);
  near(r0.gross, 0.01); // A ve B (C hacimde son, ETH hariç), long
  const r1 = rows.find((r) => r.day === T0 + 40 * DAY);
  near(r1.gross, -0.01); assert.equal(r1.pos, -1);
  assert.equal(rows[0].day, T0 + 5 * DAY); // ilk 5 gün hacim geçmişi yok
});

test('sentetik uçtan uca: kalıcı trendli seride HT1 geçer, rastgele yürüyüşte geçmez; şema ve "veri yok" parçalar', async () => {
  const n = 2800;
  const trendy = { BTC: synthDaily({ n, seed: 1, drift: regimeDrift(250, 0.004), sigma: 0.02 }), ETH: synthDaily({ n, seed: 2, drift: regimeDrift(220, 0.004), sigma: 0.025 }) };
  const a = await runRegimeMap({ daily: trendy, o: { reps: 300 } });
  assert.equal(a.ht1.verdict, VERDICT.pass, JSON.stringify(a.ht1.checks));
  assert.ok(Object.values(a.ht1.checks).every(Boolean));
  for (const k of ['meta', 'states', 'ht1', 'ht2', 'map']) assert.ok(k in a, k);
  for (const k of ['signals4h', 'momentum', 'carry']) { assert.equal(a.map[k].available, false); assert.match(a.map[k].reason, /^veri yok: /); }
  assert.equal(a.ht2.available, false);
  assert.equal(a.meta.missing.length, 5); // signals4h, momentum, carry, ht2, ht3 (4H verilmedi)
  assert.equal(a.meta.periods.knownStart, RM_DEFAULTS.knownStart);
  assert.ok(a.meta.periods.indep.from < RM_DEFAULTS.knownStart && a.meta.periods.known.from >= RM_DEFAULTS.knownStart);
  assert.ok(!('_rows' in a.ht1.main));
  assert.ok(a.ht1.main.states.BTC.indep.changes > 0 && a.ht1.main.states.BTC.indep.trendRuns.n > 0);
  const rw = { BTC: synthDaily({ n, seed: 5, sigma: 0.03 }), ETH: synthDaily({ n, seed: 6, sigma: 0.035 }) };
  const b = await runRegimeMap({ daily: rw, o: { reps: 300 } });
  assert.notEqual(b.ht1.verdict, VERDICT.pass);
  // Kısa bağımsız dönem (< 52 hafta) → sonuçsuz
  const t0 = RM_DEFAULTS.knownStart - 230 * DAY;
  const short = { BTC: synthDaily({ n: 900, t0, seed: 1, drift: regimeDrift(150, 0.004) }), ETH: synthDaily({ n: 900, t0, seed: 2, drift: regimeDrift(150, 0.004) }) };
  assert.equal((await runRegimeMap({ daily: short, o: { reps: 100 } })).ht1.verdict, VERDICT.inconclusive);
  // Veri yok → HT1 sonuçsuz, hata yok
  const none = await runRegimeMap({ daily: {} });
  assert.equal(none.ht1.available, false); assert.equal(none.ht1.verdict, VERDICT.inconclusive);
});

// ---------------- HT3 (kısa vade dizilimi, 4H; ön kayıt "Ek — HT3") ----------------
const bars4 = (closes, t0 = T0) => closes.map((c, k) => ({ time: t0 + k * H4, open: c, high: c, low: c, close: c, volume: 1, quoteVol: 1 }));
const oc4 = (pairs, t0 = T0) => pairs.map(([o, c], k) => ({ time: t0 + k * H4, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1, quoteVol: 1 }));

test('HT3 durum: kapanış > SMA3 > SMA6 > SMA42 (ve tersi), SMA42 öncesi durum yok, nedensellik, stateAt4h', () => {
  assert.equal(shortTrendOf(10, 9, 8, 7), UP);
  assert.equal(shortTrendOf(6, 7, 8, 9), DOWN);
  assert.equal(shortTrendOf(10, 9, 8, 8.5), MIXED); // SMA6 < SMA42
  assert.equal(shortTrendOf(8.9, 9, 8, 7), MIXED); // kapanış < SMA3
  assert.equal(shortTrendOf(6, 7, 8, null), null);
  assert.deepEqual(HT3_DEFAULTS.smas, [3, 6, 42]);
  // Elle küçük pencerelerle (2 / 3 / 4): yükseliş → YUKARI, ilk 3 mum durumsuz
  const up = shortStates(bars4([1, 2, 3, 4, 5, 6]), [2, 3, 4]);
  assert.equal(up.size, 3); assert.equal(up.get(T0 + 2 * H4), undefined); assert.deepEqual([...up.values()], [UP, UP, UP]);
  assert.deepEqual([...shortStates(bars4([6, 5, 4, 3, 2]), [2, 3, 4]).values()], [DOWN, DOWN]);
  // Varsayılan: 41 mum → durum yok; 42. mumda ilk durum
  const lin = (n) => bars4(Array.from({ length: n }, (_, k) => 100 + k));
  assert.equal(shortStates(lin(41)).size, 0);
  const s42 = shortStates(lin(42)); assert.equal(s42.size, 1); assert.equal(s42.get(T0 + 41 * H4), UP);
  // Yükselişte son mumda sert düşüş: kapanış SMA3 altında → KARIŞIK
  const cs = lin(50); cs[49] = { ...cs[49], close: 140 };
  assert.equal(shortStates(cs).get(T0 + 49 * H4), MIXED);
  // Nedensellik: ek mum önceki durumları değiştirmez
  const w = bars4(Array.from({ length: 200 }, (_, k) => 100 + Math.sin(k / 7) * 5 + k * 0.02));
  const a = shortStates(w), b = shortStates([...w, { time: T0 + 200 * H4, open: 1, high: 1e9, low: 1, close: 1e6 }]);
  for (const [t, st] of a) assert.equal(b.get(t), st);
  // stateAt4h: τ anında yalnız τ'dan önce kapanan mumun durumu
  const m = new Map([[T0, UP], [T0 + H4, DOWN]]);
  assert.equal(stateAt4h(m, T0 + H4), UP); assert.equal(stateAt4h(m, T0 + H4 + 3600e3), UP);
  assert.equal(stateAt4h(m, T0 + 2 * H4), DOWN); assert.equal(stateAt4h(m, T0), null); assert.equal(stateAt4h(null, T0), null);
});

test('ht3Bars: pozisyon = önceki mum durumu, açılış → açılış, mum başına fonlama fund8h / 2, geçiş maliyetleri; brüt − net = maliyet + fonlama', () => {
  const cs = oc4([[100, 100], [100, 101], [110, 111], [121, 120], [110, 109], [99, 99], [99, 99]]);
  const st = new Map([[T0, UP], [T0 + H4, UP], [T0 + 2 * H4, DOWN], [T0 + 3 * H4, MIXED], [T0 + 4 * H4, DOWN]]);
  const { rows, start, end } = ht3Bars([{ coin: 'X', candles: cs, states: st }], RM_DEFAULTS);
  assert.equal(start, T0 + H4); assert.equal(end, T0 + 5 * H4); assert.equal(rows.length, 5);
  const f = 0.00075, fb = 0.00005; // %0,01 / 8 s → 4 saatte %0,005
  near(rows[0].net, 0.1 - f - fb); near(rows[0].fund, fb); near(rows[0].bh, 0.1); near(rows[0].bhF, 0.1 - fb); // boş → long
  near(rows[1].net, 0.1 - fb); // long sürer
  near(rows[2].net, 11 / 121 - 2 * f - fb); near(rows[2].long, -f); near(rows[2].short, 11 / 121 - f - fb); // long → short: 2 birim
  near(rows[3].net, -f); near(rows[3].short, -f); // short → boş
  near(rows[4].net, -f - fb); // boş → short, 99 → 99
  for (const r of rows) { near(r.gross - r.net, r.cost + r.fund); near(r.long + r.short, r.net); }
  near(rows[2].gross, 11 / 121); // brüt = maliyetsiz
  // İki varlık: Y hep KARIŞIK → yarı ağırlık
  const two = ht3Bars([{ coin: 'X', candles: cs, states: st }, { coin: 'Y', candles: cs, states: new Map([...st.keys()].map((t) => [t, MIXED])) }]).rows;
  near(two[0].net, (0.1 - f - fb) / 2);
  // Veri boşluğu: sonraki mum yok → o pay nakit (kapanış maliyeti)
  const gap = cs.filter((_, k) => k !== 3);
  const g = ht3Bars([{ coin: 'X', candles: gap, states: st }]).rows;
  near(g.find((r) => r.t === T0 + 2 * H4).gross, 0);
});

test('HT3 günlük ve haftalık toplama: gün = 6 mumun toplamı, hafta = pazartesi → pazar; shortSummary süre / devir', () => {
  const rows = [];
  for (let k = 0; k < 6 * 21; k++) rows.push({ t: T0 + 2 * H4 + k * H4, gross: 0.002, cost: 0, fund: 0.00005, long: 0.001, short: 0.00095, net: 0.00195, bh: 0.001, bhF: 0.00095 });
  const d = dailyOfBars(rows);
  assert.equal(d[0].day, T0); assert.equal(d[0].bars, 4); assert.equal(d[1].bars, 6);
  near(d[1].net, 6 * 0.00195); near(d[1].gross, 0.012);
  const wk = weeklyOf(d, 'net', T0 + DAY, d.at(-1).day - DAY); // ilk ve son gün eksik → dışarıda
  assert.equal(wk.length, 2); assert.equal(wk[0].start, T0 + WEEK); near(wk[0].v, 42 * 0.195, 1e-9);
  near(weeklyOf(d, 'gross', T0 + DAY, d.at(-1).day - DAY)[0].v, 42 * 0.2, 1e-9);
  // shortSummary: YUKARI 3, KARIŞIK 1, AŞAĞI 2, YUKARI 2 → 3 değişim; devir 1 + 1 + 2 = 4 birim
  const seq = [UP, UP, UP, MIXED, DOWN, DOWN, UP, UP];
  const ss = new Map(seq.map((x, k) => [T0 + k * H4, x]));
  const sm = shortSummary(ss, T0 + H4, T0 + 9 * H4);
  assert.equal(sm.bars, 8); assert.equal(sm.changes, 3); assert.equal(sm.turnoverUnits, 4);
  assert.equal(sm.runsBy[UP].runs, 2); assert.equal(sm.runsBy[UP].medianHours, 10); assert.equal(sm.runsBy[DOWN].medianHours, 8);
  near(sm.share[UP], 0.625, 1e-9);
  assert.equal(shortSummary(ss, T0 + 2 * H4, T0 + 9 * H4).bars, 7); // ilk durum (T0) T0 + 4 s'te geçerli → dışarıda
});

test('verdict3Of: HT1 ile aynı koşullar + plato 2/4/28 ve 6/12/84; < 52 hafta sonuçsuz', () => {
  const per = (m, lo, sh, short, weeks = 100) => ({ total: { weeks, meanPct: m, ci90: [lo, m + 1], sharpe: sh }, short: { meanPct: short } });
  const row = (I, K) => ({ periods: { indep: I, known: K } });
  const plat = (smas, a, b) => ({ smas, ...row({ total: { meanPct: a } }, { total: { meanPct: b } }) });
  const P = [plat([2, 4, 28], 0.1, 0.1), plat([6, 12, 84], 0.2, 0.05)];
  const ok = verdict3Of(row(per(0.5, 0.1, 0.8, 0.2), per(0.3, -0.2, 0.3, 0.1)), P);
  assert.equal(ok.verdict, VERDICT.pass);
  assert.deepEqual(Object.keys(ok.checks), ['indepWeeksEnough', 'indepMeanPos', 'indepCiLowPos', 'indepSharpe', 'indepShortPos', 'knownMeanPos', 'knownShortPos', 'plateau_2_4_28', 'plateau_6_12_84']);
  const v = (I, K, p = P) => verdict3Of(row(I, K), p);
  assert.equal(v(per(0.5, 0.1, 0.8, -0.1), per(0.3, 0, 0.3, 0.1)).verdict, VERDICT.fail);
  assert.equal(v(per(0.5, 0.1, 0.8, 0.2), per(0.3, 0, 0.3, -0.1)).checks.knownShortPos, false);
  assert.equal(v(per(0.5, 0.1, 0.4, 0.2), per(0.3, 0, 0.3, 0.1)).checks.indepSharpe, false);
  const q = v(per(0.5, 0.1, 0.8, 0.2), per(0.3, 0, 0.3, 0.1), [plat([2, 4, 28], 0.1, -0.01), P[1]]);
  assert.equal(q.checks.plateau_2_4_28, false); assert.equal(q.verdict, VERDICT.fail);
  assert.equal(v(per(0.5, 0.1, 0.8, 0.2, 51), per(0.3, 0, 0.3, 0.1)).verdict, VERDICT.inconclusive);
});

test('forwardCells: durum(t) → açılış(t + 1) → açılış(t + 7) kural yönünde (AŞAĞI işaret ters, KARIŞIK long), pencere dönem içinde', () => {
  const opens = Array.from({ length: 20 }, (_, k) => 100 + k); // açılış = kapanış = 100 + k
  const cs = bars4(opens);
  const st = new Map([[T0, UP], [T0 + H4, DOWN], [T0 + 2 * H4, MIXED], [T0 + 13 * H4, UP]]); // 13: t + 7 = 20 → mum yok
  const F = forwardCells([{ coin: 'X', candles: cs, states: st }], T0, Infinity, 6, { ...RM_DEFAULTS, reps: 50 });
  assert.equal(F.bars, 6);
  assert.equal(F[UP].n, 1); near(F[UP].meanPct, (107 / 101 - 1) * 100, 1e-3); assert.equal(F[UP].dir, 'long');
  assert.equal(F[DOWN].n, 1); near(F[DOWN].meanPct, -(108 / 102 - 1) * 100, 1e-3); assert.equal(F[DOWN].dir, 'short');
  assert.equal(F[MIXED].n, 1); near(F[MIXED].meanPct, (109 / 103 - 1) * 100, 1e-3);
  assert.equal(F.byCoin.X[UP].n, 1);
  // Çıkış sınırı: toExcl = açılış(t + 7) olan pencere girer, bir mum önce bitirilirse girmez
  assert.equal(forwardCells([{ coin: 'X', candles: cs, states: st }], T0, T0 + 7 * H4, 6, RM_DEFAULTS)[UP].n, 1);
  assert.equal(forwardCells([{ coin: 'X', candles: cs, states: st }], T0, T0 + 7 * H4 - 1, 6, RM_DEFAULTS)[UP].n, 0);
  assert.equal(forwardCells([{ coin: 'X', candles: cs, states: st }], T0 + 2 * H4, Infinity, 6, RM_DEFAULTS)[UP].n, 0); // giriş < from
});

test('shortAlignMap: karar anında coin\'in kendi kısa vade durumu × sinyal yönü', () => {
  const sA = new Map([[T0, UP], [T0 + H4, DOWN], [T0 + 2 * H4, MIXED]]), sB = new Map([[T0, DOWN]]);
  const tr = (coin, d, decided, R) => ({ coin, d, decided, A: { time: decided - H4, tf: '4H', d, outcome: R > 0 ? 'tp2' : 'stopped', R, waitBars: 1 } });
  const rows = [tr('A', 1, T0 + H4, 1), tr('A', -1, T0 + 2 * H4, 2), tr('A', 1, T0 + 2 * H4, -1), tr('A', -1, T0 + 3 * H4, -1), tr('B', -1, T0 + H4, 1), tr('B', 1, T0 + H4, -1), tr('C', 1, T0 + H4, 1), tr('A', 1, T0 + 9 * H4, 1)];
  const m = shortAlignMap(rows, new Map([['A', sA], ['B', sB]]));
  assert.equal(m.cells[ALIGN.same].signals, 3); // A long @ UP, A short @ DOWN, B short @ DOWN
  near(m.cells[ALIGN.same].avgR, 4 / 3, 1e-3);
  assert.equal(m.cells[ALIGN.against].signals, 2); // A long @ DOWN, B long @ DOWN
  assert.equal(m.cells[ALIGN.mixed].signals, 1); // A short @ MIXED
  assert.equal(m.noState, 2); // C (4H yok), A gün sonrası durumsuz
  assert.deepEqual(Object.keys(m.cells), Object.values(ALIGN));
  for (const c of Object.values(m.cells)) assert.deepEqual(Object.keys(c), ['signals', 'n', 'avgR', 'ci90', 'inconclusive']);
});

test('HT3 sentetik uçtan uca: kalıcı trendli 4H seride geçer, rastgele yürüyüşte geçmez; HT1 alanları 4H girdisinden bağımsız; veri yok', async () => {
  const n4 = Math.floor((Date.UTC(2026, 9, 1) - Date.UTC(2019, 0, 1)) / H4);
  const trendy4 = { BTC: synth4h({ n: n4, seed: 21, drift: regimeDrift(300, 0.0015), sigma: 0.012 }), ETH: synth4h({ n: n4, seed: 22, drift: regimeDrift(260, 0.0015), sigma: 0.014 }) };
  const daily = { BTC: synthDaily({ n: 2800, seed: 1, drift: regimeDrift(250, 0.004), sigma: 0.02 }), ETH: synthDaily({ n: 2800, seed: 2, drift: regimeDrift(220, 0.004), sigma: 0.025 }) };
  const a = await runRegimeMap({ daily, h4: trendy4, o: { reps: 200 } });
  assert.equal(a.ht3.verdict, VERDICT.pass, JSON.stringify(a.ht3.checks));
  assert.ok(Object.values(a.ht3.checks).every(Boolean));
  assert.deepEqual(Object.keys(a.ht3.plateaus), ['sma2_4_28', 'sma6_12_84']);
  assert.ok(!('_rows' in a.ht3.main));
  const I = a.ht3.main.periods.indep;
  assert.ok(I.gross.meanPct > I.total.meanPct && I.costPct > 0 && I.fundPct > 0); // brüt > net
  assert.ok(a.ht3.main.forward.indep[UP].meanPct > 0 && a.ht3.main.forward.indep[DOWN].meanPct > 0);
  assert.ok(a.ht3.main.states.BTC.indep.turnoverPerYear > 0);
  assert.equal(a.meta.data4h.start.BTC, Date.UTC(2019, 0, 1)); assert.equal(a.meta.data4h.bars.ETH, n4);
  assert.ok(a.ht3.periods.indep.to < RM_DEFAULTS.knownStart && a.ht3.periods.known.from >= RM_DEFAULTS.knownStart);
  // HT1 / HT2 / harita 4H girdisinden bağımsız
  const noH4 = await runRegimeMap({ daily, o: { reps: 200 } });
  assert.deepEqual(noH4.ht1, a.ht1); assert.deepEqual(noH4.map, a.map); assert.deepEqual(noH4.states, a.states);
  assert.equal(noH4.ht3.available, false); assert.match(noH4.ht3.reason, /^veri yok: /); assert.equal(noH4.ht3.verdict, VERDICT.inconclusive);
  // Rastgele yürüyüş: geçmez (maliyet brütü yer)
  const rw4 = { BTC: synth4h({ n: n4, seed: 31, sigma: 0.012 }), ETH: synth4h({ n: n4, seed: 32, sigma: 0.014 }) };
  const b = await runRegimeMap({ daily, h4: rw4, o: { reps: 200 } });
  assert.notEqual(b.ht3.verdict, VERDICT.pass);
  assert.ok(b.ht3.main.periods.indep.total.meanPct < b.ht3.main.periods.indep.gross.meanPct);
  // Kısa bağımsız dönem → sonuçsuz
  const t0 = RM_DEFAULTS.knownStart - 200 * DAY;
  const sh = { BTC: synth4h({ n: 6000, t0, seed: 21, drift: regimeDrift(300, 0.0015), sigma: 0.012 }), ETH: synth4h({ n: 6000, t0, seed: 22, drift: regimeDrift(260, 0.0015), sigma: 0.014 }) };
  assert.equal((await runRegimeMap({ daily, h4: sh, o: { reps: 100 } })).ht3.verdict, VERDICT.inconclusive);
  // Sinyal kırılımı: coin 4H verilirse byShortAlign, verilmezse gerekçe
  const sig = [{ coin: 'A', d: 1, decided: Date.UTC(2025, 0, 1, 4), A: { time: Date.UTC(2025, 0, 1), tf: '4H', d: 1, outcome: 'tp2', R: 1, waitBars: 1 } }];
  const c4 = synth4h({ n: 400, t0: Date.UTC(2024, 11, 1), seed: 5, drift: 0.003, sigma: 0.001 });
  const s = await runRegimeMap({ daily, signals: sig, coin4h: { A: c4 } });
  assert.equal(s.map.signals4h.byShortAlign[ALIGN.same].signals, 1); assert.equal(s.map.signals4h.byShortAlignNoState, 0);
  const s2 = await runRegimeMap({ daily, signals: sig });
  assert.equal(s2.map.signals4h.byShortAlign, null); assert.match(s2.map.signals4h.byShortAlignReason, /^veri yok: /);
  const base = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('byShortAlign')));
  assert.deepEqual(base(s2.map.signals4h), base(s.map.signals4h)); // mevcut hücreler coin 4H girdisinden bağımsız
});
