// Eşlik (parity) testi (13.11.2026): canlı takip (bot/plan.js trackPlan) ile ölçüm motoru (backtest/engine.js simulateTrade)
// sessizce ayrışmasın. Bugüne dek bulunan dört ayrışmanın (dolum mumu sırası, 'kaçtı' erken hedefe göre, dolum öncesi
// mumların yeniden işlenmesi, bıçak kararı tam mumla) her biri ölçümü ya da canlı kaydı iyimser şişirmişti.
//
// Rastgele (sabit tohumlu PRNG, Math.random yok) 15m fiyat yolları üretilir; 4H mumlar 15m'den toplanır (tohum 1…800 normal,
// 801…1200 sık/büyük sıçramalı EL yolları). Her yolda:
//  (a) tek geçiş: trackPlan bir kez (bekleyen emir süresi 24 saat duvar saati olduğundan önce süre penceresi; dolarsa
//      özgün planla tüm mumlarda TEK çağrı),
//  (b) artımlı, 4H kapanışlarında tur: her turda o ana kadarki kapanmış mumlar; durum + patch botun yaptığı gibi
//      (bot/run.mjs: yalnız olay varsa patch yazılır, activeAt/tp1At/midAt = tur saati; alt TF yalnız waiting/active ve
//      fillRes yokken),
//  (c) artımlı, 15m kapanışlarında tur (botun gerçek hali): kapanmış 4H mumlar + kapanmamış 4H mumun o ana kadarki hali
//      + o ana kadarki 15m mumları,
//  motor: replay.js replayEngine ile aynı eşleme (erken hedef → tp1, plandaki TP1 → missTp ve tpMid, earlyPortion →
//      tp1Portion, midPortion, midStop 'early' → midStopToTp1), ücret/kayma 0, fillBarTp 'lower' + aynı 15m mumları;
//      bıçak kararı knifeBar 'lowerBar' (e, = 15m tur), 'touch' (et, varsayılan, bilgi) ve 'full' (ef, = 4H tur).
//
// Sonuç sınıfı eşlemesi (motor outcome ↔ canlı status):
//   sınıf     | motor (simulateTrade)                     | canlı (trackPlan status, finalR)
//   dolmadi   | expired (knifeWait: teyitsiz dahil)        | expired (olay 'expired' ya da 'unconfirmed')
//   kacti     | missed                                    | missed
//   bicak     | knife                                     | knife
//   stop      | stopped                                   | stopped (erkenli: her zaman −1R; erkensiz: tp1At yok)
//   tp1_bb    | tp1_be (erkensiz: TP1'de %50 + başa baş)   | stopped + tp1At (erkensiz; finalR 0,5·rr1)
//   erken_bb  | tp1_be (erkenli: plan tp1 = erken hedef)   | be
//   tam       | tp2                                       | done
//   acik      | timeout / tp1_timeout (veri sonu)          | kapanmamış (active / tp1 / early / confirming)
// R: motor R (3 ondalık) ↔ canlı finalR. Tolerans 0,0011; teyitli girişte 0,006 (canlı rr1/rr 2 ondalığa yuvarlar).
//
// Bilinen GERÇEK farklar ayrı todo testlerinde (yeşil kısım onları adıyla dışlar; dışlama sayısı diagnostic'te):
//   NB  erkensiz düzen: TP1 sonrası canlı stop özgün stopta kalır (finalR kalanı 0 sayar), motor stopu girişe çeker
//   F1  erkensiz, dolum mumunda TP1 sonrası stop: tek geçiş görmez, artımlı tur dolum mumunu 'tp1' durumuyla yeniden işler
// Düzeltilen (13.11; sınıflar artık ayrı yeşil testte, dışlama değil):
//   MR  midStop 'early' geriye dönüktü (earlyAt–midAt arası mumlara erken hedef stopu)
//   CE  teyitli girişte motor planlanan erken hedefi kullanıyordu → motor da yeni girişe aynı % uzaklıkla taşır (canlı A2)
//   K1  bıçak ölçüsü: motor 'touch' dibi = giriş; 15m turdaki bot dokunan 15m mumun tamamını görür → knifeBar 'lowerBar'
//   K2  bıçak mumunda dokunmadan SONRA stop: 15m turdaki bot görmüyordu (mum atlanıyordu), teyitle giriyordu → artık iptal
//   EL  erken hedef kapanmamış mumda yazılınca sonraki 15m turları o mumun kalanını atlıyordu (TP1/TP2 görülmüyordu)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPlan, CLOSED, earlyPriceOf, isKnife, midOk, KNIFE_DEFAULTS } from '../bot/plan.js';
import { finalR } from '../bot/review/metrics.js';
import { simulateTrade, BT_DEFAULTS } from '../backtest/engine.js';

const H4 = 4 * 3600e3, M15 = 15 * 60e3, T0 = Date.UTC(2026, 0, 5);
const PRE = 3, BARS = 36, N = 800; // gönderim öncesi 3 mum (yaklaşma ölçüsü için), sonra 36 × 4H (motor maxHoldBars 200'ün altında)
const NEL = 400; // EL yolları (tohum N+1…N+NEL): sık ve büyük sıçrama → erken hedef mum ortasında, aynı 4H mumda sonra TP1/TP2
const KNIFE = { ...KNIFE_DEFAULTS };

// ---- PRNG ve yol üretici ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (x) => Math.round(x * 100) / 100;
const agg = (xs) => ({ time: xs[0].time, open: xs[0].open, high: Math.max(...xs.map((x) => x.high)), low: Math.min(...xs.map((x) => x.low)), close: xs[xs.length - 1].close, volume: xs.length });

/**
 * Tohumdan yol + plan. Giriş 100, ATR 1; risk 1,5–3; rr1 1,5|2, rr = rr1 + 1|1,5 (rr1/rr 2 ondalıkta tam).
 * Gönderim fiyatı giriş ile TP1 arasında (buildPlan kuralı: fiyat TP1 ötesindeyse plan yok). Varyant = tohum % 4:
 * 0 erkensiz · 1 erken %1,2 / %80 · 2 erken %50 + TP1'de %25 + stop erkene (canlı 3 kademe) · 3 aynı, stop girişte.
 * Yön: (tohum >> 2) % 2 (long üretilir, short için 200 − fiyat aynası). Ara sıra sert düşüş/yükseliş (bıçak).
 */
function genPath(seed, { el = seed > N } = {}) {
  const rnd = mulberry32(seed);
  const gauss = () => { let u = 0; while (!u) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const entry = 100, atr = 1;
  const risk = [1.5, 2, 2.5, 3][Math.floor(rnd() * 4)];
  const rr1 = [1.5, 2][Math.floor(rnd() * 2)], rr = rr1 + [1, 1.5][Math.floor(rnd() * 2)];
  const variant = seed % 4, dir = (seed >> 2) % 2 === 0 ? 1 : -1;
  const dist = 0.2 + rnd() * (Math.min(3.5, 0.9 * rr1 * risk) - 0.2);
  const sigma = 0.07 + rnd() * 0.1;
  let px = entry + dist; const raw = [];
  for (let b = 0; b < PRE + BARS; b++) {
    const crash = b >= PRE && rnd() < 0.08 ? -(1.5 + rnd() * 2) / 16 : 0;
    const pump = b >= PRE && rnd() < (el ? 0.15 : 0.05) ? ((el ? 3 : 1.5) + rnd() * (el ? 3 : 2)) / 16 : 0;
    const drift = (rnd() - 0.5) * 0.08 + crash + pump - (b < PRE + 3 ? 0.025 : 0);
    for (let q = 0; q < 16; q++) {
      const o = r2(px); let hi = o, lo = o, p = o;
      for (let s = 0; s < 3; s++) { p += drift / 3 + (gauss() * sigma) / 1.7; hi = Math.max(hi, p); lo = Math.min(lo, p); }
      const c = r2(p);
      raw.push({ time: T0 + b * H4 + q * M15, open: o, high: r2(Math.max(hi, c)), low: r2(Math.min(lo, c)), close: c, volume: 1 });
      px = c;
    }
  }
  const m = (x) => r2(200 - x);
  const lower = dir === 1 ? raw : raw.map((c) => ({ ...c, open: m(c.open), high: m(c.low), low: m(c.high), close: m(c.close) }));
  const bars = [];
  for (let b = 0; b < PRE + BARS; b++) bars.push(agg(lower.slice(b * 16, b * 16 + 16)));
  const plan = {
    key: `P${seed}`, coin: 'X', tf: '4H', direction: dir === 1 ? 'long' : 'short', d: dir, entry, stop: entry - dir * risk,
    tp1: entry + dir * rr1 * risk, tp2: entry + dir * rr * risk, atr, zone: dir === 1 ? [entry - 0.5, entry] : [entry, entry + 0.5],
    sentAt: T0 + PRE * H4 - 1, // sinyal mumu kapanışında gönderildi: sonraki mumun tamamı takipte
    status: 'waiting', inZone: false, rr1, rr,
  };
  if (variant > 0) {
    plan.early = earlyPriceOf(plan, entry, { pct: 1.2, tfs: ['4H'] });
    plan.earlyPortion = variant >= 2 ? 0.5 : 0.8;
    if (variant >= 2) { plan.midPortion = 0.25; plan.midStop = variant === 2 ? 'early' : 'entry'; }
  }
  return { seed, variant, plan, bars, lower };
}

// ---- canlı takip: botun tur başına yaptığı (bot/run.mjs 265–290) ----
function apply(p, r, now) {
  if (!r.events.length) return p; // bot yalnız olay varsa patch yazar
  const q = { ...p, ...r.patch, status: r.status };
  for (const ev of r.events) {
    if (ev === 'active') q.activeAt = now; else if (ev === 'tp1' || ev === 'early') q.tp1At = now;
    else if (ev === 'mid') q.midAt = q.midAt ?? now; else if (ev !== 'confirming') q.closedAt = now;
  }
  return q;
}
const lowerFor = (p, lw) => (lw && ['waiting', 'active'].includes(p.status) && !p.fillRes ? lw : null); // run.mjs lowerOf
const before = (lw, t) => lw && lw.filter((c) => c.time < t);

/** (a) tek geçiş. Süre penceresi: gönderimden sonra 6 kapanmış 4H mum (24 saat); dolmadıysa expired, dolduysa tek çağrı. */
function liveSingle(P, { lower = true, knife = null } = {}) {
  const lw = lower ? P.lower : null, endWin = T0 + (PRE + 6) * H4;
  const r1 = trackPlan(P.plan, P.bars.slice(0, PRE + 6), endWin + 30e3, { knifeGuard: knife, lower: before(lw, endWin) });
  if (r1.status === 'expired' || r1.status === 'waiting') return apply(P.plan, r1, endWin + 30e3);
  const now = T0 + P.bars.length * H4 + 30e3;
  return apply(P.plan, trackPlan(P.plan, P.bars, now, { knifeGuard: knife, lower: lw }), now);
}
/** (b) 4H kapanışlarında tur. */
function liveBars(P, { lower = true, knife = null } = {}) {
  let p = { ...P.plan };
  for (let k = PRE; k < P.bars.length && !CLOSED.has(p.status); k++) {
    const end = T0 + (k + 1) * H4, lo = lowerFor(p, lower ? P.lower : null);
    p = apply(p, trackPlan(p, P.bars.slice(0, k + 1), end + 30e3, { knifeGuard: knife, lower: before(lo, end) }), end + 30e3);
  }
  return p;
}
/** (c) 15m kapanışlarında tur: son eleman kapanmamış 4H mumun o ana kadarki hali. */
function live15(P, { knife = null } = {}) {
  let p = { ...P.plan };
  for (let q = PRE * 16; q < P.lower.length && !CLOSED.has(p.status); q++) {
    const b = Math.floor(q / 16), now = P.lower[q].time + M15 + 30e3;
    const cs = q % 16 === 15 ? P.bars.slice(0, b + 1) : [...P.bars.slice(0, b), agg(P.lower.slice(b * 16, q + 1))];
    const lo = lowerFor(p, P.lower);
    p = apply(p, trackPlan(p, cs, now, { knifeGuard: knife, lower: lo ? P.lower.slice(0, q + 1) : null }), now);
  }
  return p;
}
/** Motor: replayEngine (backtest/replay.js) eşlemesinin kopyası + alt TF sırası. */
function engine(P, { knife = null, knifeBar = 'touch' } = {}) {
  const { plan, bars } = P;
  const mid = !!(plan.early && plan.midPortion > 0 && plan.d * (plan.tp1 - plan.early) > 0 && plan.d * (plan.tp2 - plan.tp1) > 0);
  const p = { ...plan, ...(plan.early ? { tp1: plan.early, missTp: plan.tp1 } : {}), ...(mid ? { tpMid: plan.tp1 } : {}) };
  const o = {
    ...BT_DEFAULTS, feePct: 0, slipPct: 0, knifeGuard: knife, knifeBar, tpScheme: 'half_be', tp1Portion: plan.early ? plan.earlyPortion : 0.5,
    ...(mid ? { midPortion: plan.midPortion, midStopToTp1: plan.midStop === 'early' } : {}), fillBarTp: 'lower', lowerCandles: P.lower,
  };
  return simulateTrade(p, bars, bars.findIndex((c) => c.time > plan.sentAt), plan.tf, o);
}

// ---- sınıf eşlemesi ----
const NOTRADE = new Set(['dolmadi', 'kacti', 'bicak', 'acik']);
function liveClass(p) {
  const s = p.status;
  if (!CLOSED.has(s)) return 'acik';
  if (s === 'stopped') return !p.early && p.tp1At ? 'tp1_bb' : 'stop';
  return { expired: 'dolmadi', missed: 'kacti', knife: 'bicak', be: 'erken_bb', done: 'tam', timeout: 'zaman' }[s] ?? s;
}
const ENG = { expired: 'dolmadi', missed: 'kacti', knife: 'bicak', stopped: 'stop', tp2: 'tam', timeout: 'acik', tp1_timeout: 'acik', invalid: 'gecersiz' };
const engClass = (r, plan) => (r.outcome === 'tp1_be' ? (plan.early ? 'erken_bb' : 'tp1_bb') : ENG[r.outcome] ?? r.outcome);
const liveRes = (p) => { const c = liveClass(p); return { c, R: NOTRADE.has(c) ? null : finalR(p) }; };
const engRes = (r, plan) => { const c = engClass(r, plan); return { c, R: NOTRADE.has(c) ? null : r.R }; };
const same = (x, y, tol = 0.0011) => x.c === y.c && (x.R == null ? y.R == null : y.R != null && Math.abs(x.R - y.R) < tol);
const fmt = (x) => `${x.c}${x.R == null ? '' : ` ${x.R.toFixed(3)}`}`;
const sameLive = (x, y) => same(liveRes(x), liveRes(y), 1e-9);

// ---- dışlama sınıflarının yol özelliğinden tespiti ----
const hitsLevel = (P, b, lvl, adverse) => (P.plan.d === 1) === adverse ? b.low <= lvl : b.high >= lvl; // adverse: long'da aşağı
/** MR: midStop 'early'; bir koşuda earlyAt < mum ≤ midAt aralığında fiyat erken hedefe geri dönmüş (geriye dönük seviye). */
const isMR = (P, runs) => P.plan.midStop === 'early' && runs.some((r) => r.midAt && r.earlyAt != null && P.bars.some((b) => b.time > r.earlyAt && b.time <= r.midAt && hitsLevel(P, b, P.plan.early, true)));
/** NB: erkensiz ve motor TP1 sonrası başa baş çıkışı gördü (canlı stop özgün stopta). */
const isNB = (P, engs) => !P.plan.early && engs.some((e) => e.outcome === 'tp1_be');
/** CE: bıçak teyidiyle giriş + erken hedef. */
const isCE = (P, engs, runs) => !!P.plan.early && (engs.some((e) => e.confirmed) || runs.some((r) => r.confirmedAt != null));
/** K1: 15m turdaki bot ile motorun (touch) bıçak ölçüsü farklı karara varıyor. */
const isK1 = (c, e) => c.approachAtr != null && e.approachAtr != null && isKnife(c, KNIFE) !== isKnife(e, KNIFE);
/** K2: 15m turda teyit beklemeye geçildi ve bıçak mumunun tamamı stopa değdi. */
const isK2 = (P, c) => { const kb = c.knifeAt != null ? P.bars.find((x) => x.time === c.knifeAt) : null; return !!(kb && hitsLevel(P, kb, P.plan.stop, true)); };

/**
 * EL: 15m turunda erken hedef kapanmamış 4H mumda yazıldı (dolum mumu değil) ve aynı 4H mumda erken hedefin ilk görüldüğü 15m
 * mumundan SONRA TP2 ya da (3 kademede) TP1 geliyor — eski kural o mumun kalanını atlıyordu.
 */
function isEL(P, r) {
  if (r.earlyAt == null || r.earlyAt === r.filledAt) return false;
  const b = Math.round((r.earlyAt - T0) / H4), lw = P.lower.slice(b * 16, b * 16 + 16);
  const q = lw.findIndex((x) => hitsLevel(P, x, r.early, false));
  if (q < 0 || q === 15) return false; // son 15m mumda: mum kapanmıştı
  return lw.slice(q + 1).some((x) => hitsLevel(P, x, P.plan.tp2, false) || (midOk(r) && hitsLevel(P, x, P.plan.tp1, false)));
}

// ---- tüm yollar bir kez ----
let ALL = null;
function all() {
  if (ALL) return ALL;
  ALL = [];
  for (let s = 1; s <= N + NEL; s++) {
    const P = genPath(s), row = { P };
    for (const [k, knife] of [['off', null], ['on', 1]]) {
      const x = {
        a: liveSingle(P, { knife }), b: liveBars(P, { knife }), c: live15(P, { knife }),
        an: liveSingle(P, { knife, lower: false }), bn: liveBars(P, { knife, lower: false }),
        e: engine(P, { knife, knifeBar: 'lowerBar' }), et: engine(P, { knife }), ef: engine(P, { knife, knifeBar: 'full' }),
      };
      const runs = [x.a, x.b, x.c, x.an, x.bn], engs = [x.e, x.ef];
      x.tags = { MR: isMR(P, runs), NB: isNB(P, engs), CE: !!knife && isCE(P, engs, runs), K1: !!knife && isK1(x.c, x.e), K2: !!knife && isK2(P, x.c), EL: isEL(P, x.c) };
      row[k] = x;
    }
    ALL.push(row);
  }
  return ALL;
}

/** Karşılaştırma: dışlama nedenleri sırayla; eşit olmayanların ilk 3'ü mesajda. */
function compare(t, { mode, reasons, pair, tol = () => 0.0011, min = 0.5 }) {
  const rows = all(), excl = {}, bad = [], classes = {};
  let n = 0;
  for (const row of rows) {
    const x = row[mode];
    const why = reasons.find((r) => x.tags[r]);
    if (why) { excl[why] = (excl[why] || 0) + 1; continue; }
    const [L, R, name] = pair(x, row.P);
    n++; classes[L.c] = (classes[L.c] || 0) + 1;
    if (!same(L, R, tol(x, row.P))) bad.push(`tohum ${row.P.seed} (v${row.P.variant} ${row.P.plan.direction}): ${name[0]} ${fmt(L)} ≠ ${name[1]} ${fmt(R)}`);
  }
  t.diagnostic(`${rows.length} yol, karşılaştırılan ${n}, dışlanan ${JSON.stringify(excl)}, sınıflar ${JSON.stringify(classes)}`);
  assert.ok(n >= rows.length * min, `dışlananlar çok: karşılaştırılan ${n}/${rows.length}`);
  assert.ok(Object.keys(classes).length >= 4, `sınıf çeşitliliği az: ${JSON.stringify(classes)}`);
  assert.equal(bad.length, 0, `${bad.length} ayrışma:\n${bad.slice(0, 3).join('\n')}`);
  return { n, excl, classes };
}

// ================= üretici =================
test('üretici: deterministik; long + short, 4 varyant; dolum öncesi mumu erken hedefin ötesinde olan yollar var', (t) => {
  assert.deepEqual(genPath(7), genPath(7));
  const rows = all();
  const dirs = new Set(rows.map((r) => r.P.plan.direction)), vars = new Set(rows.map((r) => r.P.variant));
  assert.equal(dirs.size, 2); assert.equal(vars.size, 4);
  // (3) numaralı düzeltmenin kapsandığı: erkenli, dolan ve gönderim ile dolum arasında bir mumu erken hedefin ötesinde olan yollar
  const pre = rows.filter(({ P, off }) => P.plan.early && off.a.filledAt != null && P.bars.some((b) => b.time > P.plan.sentAt && b.time < off.a.filledAt && hitsLevel(P, b, P.plan.early, false)));
  const fillBarToo = rows.filter(({ P, off }) => P.plan.early && off.a.filledAt != null && hitsLevel(P, P.bars.find((b) => b.time === off.a.filledAt), P.plan.early, false));
  t.diagnostic(`${rows.length} yolun ${pre.length}'inde dolum öncesi mum erken hedefin ötesinde; ${fillBarToo.length}'inde dolum mumu da erken hedefe değiyor (alt TF sırası)`);
  assert.ok(pre.length >= 40, `dolum öncesi erken-hedef-ötesi yol az: ${pre.length}`);
  // bu yollar A değişmezinde (artımlı = tek geçiş) gerçekten karşılaştırılıyor ve eşit
  const cmp = pre;
  assert.ok(cmp.length >= 40);
  for (const { P, off } of cmp) assert.ok(sameLive(off.a, off.b) && sameLive(off.a, off.c), `tohum ${P.seed}`);
});

// ================= A: artımlı = tek geçiş (trackPlan kendi içinde) =================
for (const knife of ['off', 'on']) {
  test(`A (b): 4H turları = tek geçiş, alt TF ile — bıçak ${knife}`, (t) => {
    compare(t, { mode: knife, reasons: [], pair: (x) => [liveRes(x.b), liveRes(x.a), ['4H tur', 'tek']], tol: () => 1e-9 });
  });
  test(`A (b): 4H turları = tek geçiş, alt TF yok — bıçak ${knife}`, (t) => {
    compare(t, { mode: knife, reasons: [], pair: (x) => [liveRes(x.bn), liveRes(x.an), ['4H tur', 'tek']], tol: () => 1e-9 });
  });
}
test('A (c): 15m turları (kapanmamış 4H mum + 15m) = tek geçiş — bıçak kapalı', (t) => {
  compare(t, { mode: 'off', reasons: [], pair: (x) => [liveRes(x.c), liveRes(x.a), ['15m tur', 'tek']], tol: () => 1e-9 });
  // Bıçak açıkken (c) tek geçişle karşılaştırılmaz: kapanmış mumda karar tam mumla, 15m turda dokunan 15m mum kapanınca o ana
  // kadarki yarım mumla verilir (motorda knifeBar 'full' ↔ 'lowerBar'). Kaç yolda farklı olduğu bilgi için:
  const d = all().filter(({ on }) => !sameLive(on.a, on.c)).length;
  t.diagnostic(`bıçak açık: ${d}/${all().length} yolda 15m tur ≠ tek geçiş (tasarım: karar anındaki veri farklı)`);
});

// ================= B: motor = canlı takip =================
test('B: motor (lower) = tek geçiş ve 4H turları — bıçak kapalı', (t) => {
  compare(t, { mode: 'off', reasons: ['NB'], pair: (x, P) => [engRes(x.e, P.plan), liveRes(x.a), ['motor', 'tek']] });
  compare(t, { mode: 'off', reasons: ['NB'], pair: (x, P) => [engRes(x.e, P.plan), liveRes(x.b), ['motor', '4H tur']] });
});
test('B: motor (lower) = 15m turları — bıçak kapalı', (t) => {
  compare(t, { mode: 'off', reasons: ['NB'], pair: (x, P) => [engRes(x.e, P.plan), liveRes(x.c), ['motor', '15m tur']] });
});
const confTol = (x) => (x.e.confirmed || x.ef.confirmed || x.b.confirmedAt || x.c.confirmedAt ? 0.006 : 0.0011);
test('B: motor (knifeBar full) = 4H turları — bıçak açık (kapanmış mumla karar)', (t) => {
  compare(t, { mode: 'on', reasons: ['NB'], pair: (x, P) => [engRes(x.ef, P.plan), liveRes(x.b), ['motor full', '4H tur']], tol: confTol });
});
test('B: motor (knifeBar lowerBar, 15m) = 15m turları — bıçak açık (dokunan 15m mum kapanınca karar)', (t) => {
  compare(t, { mode: 'on', reasons: ['NB'], pair: (x, P) => [engRes(x.e, P.plan), liveRes(x.c), ['motor lowerBar', '15m tur']], tol: confTol });
  // varsayılan 'touch' (dokunma anındaki yarım mum, kötümser sınır) kaç yolda 15m turdan farklı karar veriyor (bilgi)
  const d = all().filter(({ on }) => isK1(on.c, on.et)).length;
  t.diagnostic(`knifeBar touch: ${d}/${all().length} yolda bıçak kararı 15m turdan farklı (lowerBar: 0)`);
});

// MR (13.11 düzeltildi): stop erken hedefe yalnız mid mumundan sonra; eskiden artımlı turda earlyAt–midAt arası mumlara da
// uygulanıyordu (tohum 210: 4H tur erken_bb +0,675R ≠ tek tam +1,200R). Sınıf yolları artık her karşılaştırmada eşit olmalı.
test('MR: midStop early — erken hedef stopu yalnız mid mumundan sonra (artımlı = tek = motor)', (t) => {
  const rows = all().filter((r) => r.off.tags.MR || r.on.tags.MR), bad = [];
  for (const { P, off, on } of rows) {
    const pairs = [[off.b, off.a, '4H tur/tek'], [off.c, off.a, '15m tur/tek'], [off.bn, off.an, '4H tur/tek (alt TF yok)'], [on.b, on.a, '4H tur/tek bıçak']].map(([x, y, n]) => [liveRes(x), liveRes(y), n]);
    pairs.push([engRes(off.e, P.plan), liveRes(off.a), 'motor/tek']);
    pairs.push([engRes(on.ef, P.plan), liveRes(on.b), 'motor full/4H tur bıçak']);
    for (const [L, R, n] of pairs) if (!same(L, R, n === 'motor full/4H tur bıçak' ? confTol(on) : n.startsWith('motor') ? 0.0011 : 1e-9)) bad.push(`tohum ${P.seed} ${n}: ${fmt(L)} ≠ ${fmt(R)}`);
  }
  t.diagnostic(`MR: ${rows.length} yol`);
  assert.ok(rows.length >= 5, `MR sınıfı az: ${rows.length}`);
  assert.equal(bad.length, 0, bad.slice(0, 3).join('\n'));
});

// ================= bilinen gerçek farklar (todo) =================
/** Sınıftaki yollarda iki tarafın farkı: sayı, ilk örnek, ort. R farkı (işlemsiz = 0, açık kalanlar hariç). */
function todoClass(t, { mode, tag, pair, overlapOk = [] }) {
  const rows = all().filter((r) => r[mode].tags[tag]);
  const diffs = [];
  for (const row of rows) { const [L, R, name] = pair(row[mode], row.P); if (!same(L, R, 0.006)) diffs.push({ row, L, R, name }); }
  // yön: yalnız bu etiketi taşıyan (overlapOk dışında başka sınıfla örtüşmeyen) ve iki tarafı da kapanmış yollar
  const pure = diffs.filter((d) => Object.entries(d.row[mode].tags).every(([k, v]) => !v || k === tag || overlapOk.includes(k)) && d.L.c !== 'acik' && d.R.c !== 'acik');
  const avg = pure.length ? pure.reduce((s, d) => s + (d.L.R ?? 0) - (d.R.R ?? 0), 0) / pure.length : 0;
  const ex = pure[0] ?? diffs[0];
  if (diffs.length) t.diagnostic(`${tag}: ${rows.length} yolun ${diffs.length}'inde fark; saf+kapanmış n ${pure.length}, ort. (${ex.name[0]} − ${ex.name[1]}) ${avg.toFixed(3)}R; örnek: tohum ${ex.row.P.seed} ${fmt(ex.L)} ≠ ${fmt(ex.R)}; açık kalan fark ${diffs.filter((d) => d.L.c === 'acik' || d.R.c === 'acik').length}`);
  assert.ok(rows.length > 0, `${tag} sınıfı üretilmedi`);
  assert.equal(diffs.length, 0, `${tag}: ${diffs.length} fark`);
}

test('NB: erkensiz — TP1 sonrası canlı stop özgün stopta, motor girişte', { todo: 'trackPlan tp1 durumunda plan.stop; finalR kalanı 0 sayar' }, (t) => {
  todoClass(t, { mode: 'off', tag: 'NB', pair: (x, P) => [liveRes(x.a), engRes(x.e, P.plan), ['canlı', 'motor']] });
});
// ================= kapatılan farklar (13.11) =================
/** Sınıf yollarında çiftler eşit; sınıf en az `min` yol. */
function fixedClass(t, { tag, min, modes = ['on'], pairs }) {
  const rows = all().filter((r) => modes.some((m) => r[m].tags[tag])), bad = [];
  for (const row of rows) for (const m of modes) {
    if (!row[m].tags[tag]) continue;
    for (const [L, R, name, tol = 0.006] of pairs(row[m], row.P, m)) if (!same(L, R, tol)) bad.push(`tohum ${row.P.seed} (${m}) ${name}: ${fmt(L)} ≠ ${fmt(R)}`);
  }
  t.diagnostic(`${tag}: ${rows.length} yol`);
  assert.ok(rows.length >= min, `${tag} sınıfı az: ${rows.length}`);
  assert.equal(bad.length, 0, `${bad.length} fark:\n${bad.slice(0, 3).join('\n')}`);
  return rows;
}
// CE: teyitli girişte motor da erken hedefi yeni girişe aynı % uzaklıkla taşır (eski: planlanan erken hedef; tohum 42 motor
// erken_bb −0,132 ≠ 4H tur +0,122). Erken hedefsiz planda (missTp yok) TP1 taşınmaz.
test('CE: bıçak teyitli giriş + erken hedef — motor erken hedefi yeni girişe taşır (= canlı A2)', (t) => {
  fixedClass(t, { tag: 'CE', min: 50, pairs: (x, P) => [[engRes(x.ef, P.plan), liveRes(x.b), 'motor full/4H tur'], [engRes(x.e, P.plan), liveRes(x.c), 'motor lowerBar/15m tur']] });
});
// K1: knifeBar 'lowerBar' (alt TF 15m) = 15m turdaki botun bıçak ölçüsü; 'touch' kötümser (dokunmadan sonraki dip yok sayılır).
test('K1: bıçak ölçüsü — motor lowerBar = 15m turdaki bot (yaklaşma ölçüsü ve karar aynı)', (t) => {
  const rows = all().filter(({ on }) => isK1(on.c, on.et)), bad = [];
  for (const { P, on } of all()) {
    if (on.c.approachAtr != null && on.e.approachAtr != null && (on.c.approachAtr !== on.e.approachAtr || on.c.fillBarAtr !== on.e.fillBarAtr)) bad.push(`tohum ${P.seed}: ölçü ${on.c.approachAtr}/${on.c.fillBarAtr} ≠ ${on.e.approachAtr}/${on.e.fillBarAtr}`);
  }
  for (const { P, on } of rows) { const L = engRes(on.e, P.plan), R = liveRes(on.c); if (!on.tags.NB && !same(L, R, 0.006)) bad.push(`tohum ${P.seed}: motor ${fmt(L)} ≠ 15m tur ${fmt(R)}`); }
  t.diagnostic(`K1 (touch ≠ 15m tur kararı): ${rows.length} yol (sonuç karşılaştırmasında NB hariç: ${rows.filter((r) => r.on.tags.NB).length})`);
  assert.ok(rows.length >= 20, `K1 sınıfı az: ${rows.length}`);
  assert.equal(bad.length, 0, bad.slice(0, 3).join('\n'));
});
// K2: bıçak mumunun dokunmadan sonraki kısmında stop → 15m turdaki bot da 'knife' (eski: atlıyor, teyitle giriyordu; tohum 109).
test('K2: bıçak mumunda dokunmadan sonra stop — 15m turdaki bot iptal eder (= motor, = 4H tur)', (t) => {
  fixedClass(t, { tag: 'K2', min: 15, pairs: (x, P) => [[liveRes(x.c), { c: 'bicak', R: null }, '15m tur/bıçak'], [engRes(x.e, P.plan), liveRes(x.c), 'motor/15m tur'], [liveRes(x.b), liveRes(x.c), '4H tur/15m tur', 1e-9]] });
});
// EL: erken hedef kapanmamış mumda yazıldıysa sonraki 15m turları o mumun kalanında TP1 (ara kademe) ve TP2'yi görür
// (eski: mum tümüyle atlanıyordu). Tek geçişin kuralı: erken hedef mumunda mid + TP2 sayılır, girişe dönüş sayılmaz.
// Sınıf + R çoğu yolda eski kuralda da tutuyordu (fiyat sonraki mumda TP1/TP2'yi yine geçer): ayrıca mid ve kapanış MUMU karşılaştırılır.
const exitBarOf = (r, P) => (r.bars == null || r.waitBars == null ? null : P.bars[P.bars.findIndex((c) => c.time > P.plan.sentAt) + r.waitBars - 1 + r.bars]?.time ?? null);
test('EL: erken hedef mumu ortasında yazıldı, aynı mumda sonra TP1/TP2 — 15m turları = tek geçiş = motor (sonuç, mid ve kapanış mumu)', (t) => {
  const tm = (x) => ({ c: `${x.midAt ?? '-'}|${CLOSED.has(x.status) ? x.closedBar : '-'}`, R: null });
  const rows = fixedClass(t, { tag: 'EL', min: 20, modes: ['off', 'on'], pairs: (x, P, m) => {
    const L = engRes(x.e, P.plan), R = liveRes(x.c);
    const out = [[L, R, 'motor/15m tur', m === 'on' ? 0.006 : 0.0011]];
    if (m === 'off') out.push([R, liveRes(x.a), '15m tur/tek', 1e-9], [tm(x.c), tm(x.a), '15m tur/tek mid|kapanış mumu']);
    if (CLOSED.has(x.c.status) && !NOTRADE.has(R.c)) out.push([{ c: String(exitBarOf(x.e, P)), R: null }, { c: String(x.c.closedBar), R: null }, 'motor/15m tur kapanış mumu']);
    return out;
  } });
  t.diagnostic(`EL: ${rows.filter((r) => r.off.tags.EL).length} yol bıçak kapalı, ${rows.filter((r) => r.on.tags.EL).length} yol açık; erken hedef mumunda kapanan (tam) ${rows.filter((r) => r.off.tags.EL && r.off.a.closedBar === r.off.a.earlyAt).length}`);
});

// F1: üretici neredeyse hiç üretmez (dolum mumu TP1 ve stopu birlikte kapsamalı, ≥ 2,5R boy); elle en küçük örnek
test('F1: erkensiz, dolum mumunda TP1 sonra stop — tek geçiş açık der, 4H turu dolum mumunu tp1 durumuyla yeniden işler', { todo: 'trackPlan tp1 durumunda dolum mumu yeniden işlenir (filledBarsOf yalnız öncesini atlar)' }, () => {
  const q = (i, o, hi, lo, c) => ({ time: T0 + H4 + i * M15, open: o, high: hi, low: lo, close: c });
  const lower = [q(0, 101, 101.1, 100.5, 100.6), q(1, 100.6, 100.7, 99.9, 100.1), q(2, 100.1, 102.4, 100, 102.3), q(3, 102.3, 102.3, 98.4, 98.6)];
  const bars = [{ time: T0, open: 101, high: 101.2, low: 100.8, close: 101 }, { time: T0 + H4, open: 101, high: 102.4, low: 98.4, close: 98.6 }, { time: T0 + 2 * H4, open: 98.6, high: 99.4, low: 98.6, close: 99.2 }];
  const plan = { key: 'F1', coin: 'X', tf: '4H', d: 1, direction: 'long', entry: 100, stop: 98.5, tp1: 102.25, tp2: 104.5, atr: 1, zone: [99.5, 100], sentAt: T0 + H4 - 1, status: 'waiting', inZone: false, rr1: 1.5, rr: 3 };
  const single = trackPlan(plan, bars, T0 + 3 * H4 + 30e3, { lower });
  const r1 = trackPlan(plan, bars.slice(0, 2), T0 + 2 * H4 + 30e3, { lower });
  const r2 = trackPlan(apply(plan, r1, T0 + 2 * H4 + 30e3), bars, T0 + 3 * H4 + 30e3, {});
  assert.equal(single.status, 'tp1'); // tek geçiş: dolum mumunda TP1, sonra stop görülmez → açık
  assert.equal(r2.status, single.status); // artımlı: 'stopped' (dolum mumundaki 98,4 tp1 durumunda yeniden sayılır)
});
