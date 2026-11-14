// Rejim haritası + trend testi (backtest/regime-map.js; ön kayıt docs/arastirma/on-kayit-rejim.md): trend / oynaklık / fonlama durumları,
// nedensellik, HT1 getiri ve maliyet aritmetiği, bacaklar, haftalık toplama, verdict / checks, Parça 2 hücre ataması, sentetik uçtan uca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  smaArr, trendOf, trendStates, stateAt, levelOf, volStates, fundingStates, dayReturn, ht1Days, ht2Days, weeklyOf, verdictOf, alignOf,
  signalsMap, weeklyMap, runRegimeMap, synthDaily, regimeDrift, mondayOf, RM_DEFAULTS, UP, DOWN, MIXED, HIGH, MID, LOW, ALIGN, VERDICT, DAY, WEEK,
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
  assert.equal(a.meta.missing.length, 4);
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
