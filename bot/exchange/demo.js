// Bybit DEMO köprüsü: botun 4H kâğıt planlarını demo hesabına emir olarak yansıtır ("borsa-yerel" akış) ve kâğıt takip ile
// borsadaki gerçekleşme arasındaki sapmaları kaydeder (docs/signals/demo.json). Gerçek hesaba emir gitmez: istemci (bybit.js)
// yalnız api-demo.bybit.com'a istek atabilir.
//
// Akış (iş = kâğıt plan kimliği `key|sentAt`):
//   pending  → yeni 4H plan (kâğıt 'waiting'): limit giriş + ekli tam pozisyon stopu (Full, Market, LastPrice); kaldıraç maxLeverage.
//              Kâğıt plan kapanır (expired / missed / knife / ...) ya da plan kaybolursa ve giriş dolmamışsa emir iptal.
//   open     → giriş doldu: çıkış kademeleri reduce-only limit (T1 erken hedef, T2 TP1 [3 kademe], T3 TP2 kalan). T1 dolunca stop
//              girişe (dolum fiyatı), T2 dolunca (midStop 'early') stop erken hedefe — trading-stop ile. Fiyat yeni stop seviyesinin
//              ötesindeyse stop taşınamaz → kalan piyasa emriyle (reduce-only) kapatılır.
//   closed   → pozisyon sıfır: kalan çıkış emirleri iptal, gerçekleşen K/Z (closed-pnl; alınamazsa dolumlardan tahmin) ve R.
//   cancelled / skipped → dolmadan iptal / hiç gönderilmedi (nedeni yazılır).
// Kâğıt "işlemsiz" (knife/expired/missed) derken borsada dolduysa pozisyona dokunulmaz; sapma olarak yazılır.
//
// decideDemo saftır (ağ yok): durum + kâğıt planlar + borsa görüntüsü → { state, actions }. runDemo görüntüyü toplar, eylemleri
// istemciyle yürütür (applyResult) ve dosyayı yazar. orderLinkId deterministiktir (plan kimliği + kademe) → aynı emir iki kez gitmez
// (Bybit 110072 "OrderLinkedID is duplicate" = zaten gönderilmiş sayılır).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bybitOf } from '../../src/data/bybit-symbols.js';
import { maxLeverage } from '../telegram.js';
import { midOk, CLOSED } from '../plan.js';
import { finalR } from '../../src/ui/signals-lib.js';

export const DEMO_DEFAULTS = { riskUsd: 10, tfs: ['4H'], maxNew: 3, maxPendingH: 48, legRetries: 3 };
const NO_TRADE = new Set(['expired', 'missed', 'knife']);
const TRADED = new Set(['done', 'stopped', 'be', 'timeout']);
const PAPER_FILLED = new Set(['active', 'tp1', 'early', ...TRADED]);
const OPEN_ST = new Set(['New', 'PartiallyFilled', 'Untriggered', 'Created', 'Active']);
const ACTIVE = new Set(['pending', 'open']);
const num = (x) => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);
const sideOf = (d) => (d === 1 ? 'Buy' : 'Sell');

/** Deterministik orderLinkId (≤ 36 karakter, harf/rakam/-): 'bd-' + plan kimliğinin sha256'sından 16 hex + '-' + kademe. */
export const linkOf = (planId, tag) => `bd-${crypto.createHash('sha256').update(String(planId)).digest('hex').slice(0, 16)}-${tag}`;

/** Adımın ondalık hanesi ('0.0000010' → 7, '100' → 0, '1e-7' → 7). */
export function decimalsOf(step) {
  const t = String(step);
  const e = /e-(\d+)$/i.exec(t); if (e) return +e[1];
  const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1;
}
/** Adıma yuvarlama: mode 'floor' | 'ceil' | 'nearest'; kayan nokta artığı olmadan (adımın ondalığıyla). */
export function roundStep(x, step, mode = 'nearest') {
  const s = +step; if (!(s > 0) || !Number.isFinite(x)) return null;
  const n = x / s, k = mode === 'floor' ? Math.floor(n + 1e-9) : mode === 'ceil' ? Math.ceil(n - 1e-9) : Math.round(n);
  return +(k * s).toFixed(decimalsOf(step));
}
export const fmtStep = (x, step) => (+x).toFixed(decimalsOf(step));

/** instruments-info satırı → enstrüman. */
export function parseInstrument(raw, coin, mult = 1) {
  if (!raw?.symbol) return null;
  return {
    coin, symbol: raw.symbol, mult, status: raw.status || null,
    tick: raw.priceFilter?.tickSize, qtyStep: raw.lotSizeFilter?.qtyStep,
    minQty: num(raw.lotSizeFilter?.minOrderQty) ?? 0, minNotional: num(raw.lotSizeFilter?.minNotionalValue) ?? 0,
    maxLev: num(raw.leverageFilter?.maxLeverage) ?? null,
  };
}

/** Sembol adayları: bilinen çarpan (bybit-symbols) ya da COINUSDT; o yoksa 1000COINUSDT (×1000). */
export function symbolCandidates(coin) {
  const b = bybitOf(coin);
  return b.mult > 1 ? [b] : [b, { sym: `1000${coin}USDT`, mult: 1000 }];
}

/**
 * Planın seviyeleri Bybit biriminde (fiyat × çarpan), tick'e yuvarlı: giriş en yakın; stop girişten UZAĞA (risk küçülmez);
 * hedefler girişe DOĞRU (dolma olasılığı düşmez). Risk sıfıra inerse null.
 */
export function levelsOf(plan, inst) {
  const d = plan.d ?? (plan.direction === 'long' ? 1 : -1), m = inst.mult || 1, t = inst.tick;
  const px = (p, mode) => (Number.isFinite(p) ? roundStep(p * m, t, mode) : null);
  // long: stop aşağı (uzağa), hedefler aşağı (girişe doğru) → ikisi de 'floor'; short ayna → 'ceil'
  const away = d === 1 ? 'floor' : 'ceil', toward = away;
  const lv = { d, entry: px(plan.entry, 'nearest'), stop: px(plan.stop, away), tp1: px(plan.tp1, toward), tp2: px(plan.tp2, toward), early: plan.early != null ? px(plan.early, toward) : null, earlyPortion: plan.early != null ? plan.earlyPortion ?? 0.8 : null, midPortion: plan.midPortion ?? 0, midStop: plan.midStop ?? null };
  if (!(lv.entry > 0) || !(d * (lv.entry - lv.stop) > 0)) return null;
  return lv;
}

/** Miktar = risk $ ÷ |giriş − stop| (Bybit biriminde), adıma aşağı yuvarlı; en az emir / en az değer altındaysa { ok:false, reason }. */
export function sizeOf(lv, inst, riskUsd) {
  const dist = Math.abs(lv.entry - lv.stop);
  const qty = roundStep(riskUsd / dist, inst.qtyStep, 'floor');
  if (!(qty > 0) || qty < inst.minQty) return { ok: false, reason: `miktar ${qty ?? 0} < en az emir ${inst.minQty} (risk ${riskUsd} $)` };
  if (inst.minNotional && qty * lv.entry < inst.minNotional) return { ok: false, reason: `değer ${(qty * lv.entry).toFixed(2)} $ < en az ${inst.minNotional} $` };
  return { ok: true, qty };
}

/**
 * Çıkış kademeleri (reduce-only limit): erken hedef varsa T1 = erken (%portion), T2 = TP1 (%mid; yalnız midOk), T3 = TP2 (kalan);
 * erken hedef yoksa T1 = TP1 (%50), T3 = TP2 (kalan). En az emrin altında kalan kademe sonrakine (sonuncusu öncekine) eklenir.
 */
export function legsOf(lv, qty, inst) {
  const fr = lv.early != null
    ? [['T1', lv.early, lv.earlyPortion ?? 0.8], ...(midOk({ d: lv.d, early: lv.early, tp1: lv.tp1, tp2: lv.tp2, midPortion: lv.midPortion }) ? [['T2', lv.tp1, lv.midPortion]] : []), ['T3', lv.tp2, null]]
    : [['T1', lv.tp1, 0.5], ['T3', lv.tp2, null]];
  const legs = fr.map(([tag, price, f]) => ({ tag, price, qty: f == null ? 0 : roundStep(qty * f, inst.qtyStep, 'floor') }));
  const used = legs.reduce((a, l) => a + l.qty, 0);
  legs[legs.length - 1].qty = roundStep(qty - used, inst.qtyStep, 'nearest');
  for (let i = 0; i < legs.length - 1; i++) if (legs[i].qty < inst.minQty) { legs[i + 1].qty = roundStep(legs[i + 1].qty + legs[i].qty, inst.qtyStep, 'nearest'); legs[i].qty = 0; }
  const last = legs[legs.length - 1], prev = legs.slice(0, -1).reverse().find((l) => l.qty > 0);
  if (last.qty < inst.minQty && prev) { prev.qty = roundStep(prev.qty + last.qty, inst.qtyStep, 'nearest'); last.qty = 0; }
  return legs.filter((l) => l.qty > 0);
}

export const emptyDemoState = (now) => ({ version: 1, startedAt: now, updatedAt: now, jobs: {}, insts: {}, events: [], lastError: null });

const paperSnap = (p) => ({ status: p.status, entry: p.entry, filledAt: p.filledAt ?? p.activeAt ?? null, confirmedAt: p.confirmedAt ?? null, closedAt: p.closedAt ?? null, R: CLOSED.has(p.status) ? finalR(p) : null });
function addDev(job, kind, data, now) {
  job.deviations ??= [];
  if (job.deviations.some((x) => x.kind === kind)) return false;
  job.deviations.push({ kind, at: now, ...data }); return true;
}
const ev = (st, now, job, e, extra = {}) => { st.events.push({ at: now, id: job.id, symbol: job.symbol ?? null, ev: e, ...extra }); };
const hasDev = (job, kind) => (job.deviations || []).some((x) => x.kind === kind);
/** "OKX'te doldu, Bybit'te henüz değil" satırı: Bybit son fiyatı ve girişe kalan uzaklık (son fiyat yoksa yalnız durum). */
export function pendingNote(job, last) {
  const e = job.lv?.entry ?? job.paper?.entry, head = `⏳ ${job.coin} ${job.direction}: OKX'te giriş doldu, Bybit demoda henüz dolmadı (giriş ${e}).`;
  if (!(last > 0) || !(e > 0)) return `${head} Emir bekliyor.`;
  const gap = job.d * (last - e); // > 0: fiyat girişe henüz ulaşmadı (long'da üstünde, short'ta altında)
  return `${head} Bybit son ${last} · girişe ${Math.abs(gap).toPrecision(2)} (%${(Math.abs(gap) / e * 100).toFixed(2)}) ${gap > 0 ? 'uzak' : 'geçti, sırada bekliyor'}. Emir bekliyor.`;
}
const entryBody = (job) => ({ symbol: job.symbol, side: sideOf(job.d), orderType: 'Limit', qty: fmtStep(job.qty, job.inst.qtyStep), price: fmtStep(job.lv.entry, job.inst.tick), timeInForce: 'GTC', positionIdx: 0, orderLinkId: linkOf(job.id, 'E'), stopLoss: fmtStep(job.lv.stop, job.inst.tick), tpslMode: 'Full', slTriggerBy: 'LastPrice', slOrderType: 'Market' });
const exitBody = (job, tag, price, qty, type = 'Limit') => ({ symbol: job.symbol, side: sideOf(-job.d), orderType: type, qty: fmtStep(qty, job.inst.qtyStep), ...(type === 'Limit' ? { price: fmtStep(price, job.inst.tick), timeInForce: 'GTC' } : {}), positionIdx: 0, reduceOnly: true, orderLinkId: linkOf(job.id, tag) });

function newJob(p, id, ex, now, cfg, busy, actions) {
  const base = { id, coin: p.coin, tf: p.tf, direction: p.direction, d: p.d ?? (p.direction === 'long' ? 1 : -1), sentAt: p.sentAt, createdAt: now, paper: paperSnap(p), orders: {}, stops: [], deviations: [] };
  const skip = (reason) => ({ ...base, phase: 'skipped', reason });
  const inst = ex.insts?.[p.coin];
  if (inst === undefined) return null; // enstrüman bilgisi bu tur alınamadı → sonraki tur
  if (!inst) return skip('Bybit\'te linear USDT sözleşmesi yok');
  Object.assign(base, { symbol: inst.symbol, mult: inst.mult, inst: { tick: inst.tick, qtyStep: inst.qtyStep, minQty: inst.minQty } });
  if (inst.status && inst.status !== 'Trading') return skip(`Bybit sözleşme durumu ${inst.status}`);
  if (busy.has(inst.symbol)) return skip('aynı sembolde açık demo işi var');
  if (ex.positions?.[inst.symbol]?.size > 0) return skip('borsada bu sembolde pozisyon var (demo işi değil)');
  if ((ex.openOrders || []).some((o) => o.symbol === inst.symbol)) return skip('borsada bu sembolde bekleyen emir var (demo işi değil)');
  const lv = levelsOf(p, inst);
  if (!lv) return skip('seviyeler tick\'e yuvarlanınca risk sıfır');
  const last = ex.tickers?.[inst.symbol];
  if (!(last > 0)) return null; // fiyat alınamadı → sonraki tur
  if (base.d * (last - lv.entry) <= 0) return skip(`Bybit fiyatı ${last} girişin (${lv.entry}) ötesinde: limit anında dolardı`);
  const sz = sizeOf(lv, inst, cfg.riskUsd);
  if (!sz.ok) return skip(sz.reason);
  const lev = Math.max(1, Math.min(maxLeverage(lv.entry, lv.stop) ?? 1, inst.maxLev ?? 20));
  const job = { ...base, phase: 'pending', lv, qty: sz.qty, riskUsd: +(sz.qty * Math.abs(lv.entry - lv.stop)).toFixed(4), riskTarget: cfg.riskUsd, leverage: lev, lastAtCreate: last };
  actions.push({ type: 'leverage', jobId: id, symbol: job.symbol, lev }, { type: 'create', jobId: id, tag: 'E', body: entryBody(job) });
  return job;
}

function closeJob(st, job, plan, ex, now, actions) {
  for (const [tag, o] of Object.entries(job.orders)) if (tag !== 'E' && OPEN_ST.has(o.status)) actions.push({ type: 'cancel', jobId: job.id, tag, symbol: job.symbol, link: o.link });
  const filledLegs = (job.legs || []).filter((l) => job.orders[l.tag]?.status === 'Filled').map((l) => l.tag);
  const recs = ex.closedPnl?.[job.id];
  const f = job.fill, risk = f.qty * Math.abs(f.price - job.lv.stop);
  let pnl, src;
  if (Array.isArray(recs) && recs.length) { pnl = recs.reduce((a, r) => a + (num(r.closedPnl) ?? 0), 0); src = 'closed-pnl'; }
  else { // tahmin: dolan kademeler kendi fiyatından, kalan son stop seviyesinden (ücretsiz)
    let left = f.qty; pnl = 0;
    for (const l of job.legs || []) { const o = job.orders[l.tag]; if (o?.status === 'Filled') { const q = o.cumExecQty ?? l.qty; pnl += job.d * ((o.avgPrice ?? l.price) - f.price) * q; left -= q; } }
    for (const [tag, o] of Object.entries(job.orders)) if (tag.startsWith('X') && o.status === 'Filled' && o.cumExecQty) { pnl += job.d * ((o.avgPrice ?? f.price) - f.price) * o.cumExecQty; left -= o.cumExecQty; }
    if (left > 0) pnl += job.d * ((job.stopLevel ?? job.lv.stop) - f.price) * left;
    src = 'tahmin';
  }
  const forced = Object.entries(job.orders).some(([t, o]) => t.startsWith('X') && o.status === 'Filled');
  const exitBy = filledLegs.includes('T3') ? 'TP2' : forced ? 'piyasa (stop taşınamadı)' : (job.stopLevel != null && job.stopLevel !== job.lv.stop ? 'taşınmış stop' : 'stop');
  job.closed = { at: now, pnl: +pnl.toFixed(4), pnlSrc: src, R: risk > 0 ? +(pnl / risk).toFixed(3) : null, exitBy, legs: filledLegs, paperStatus: plan?.status ?? null };
  job.phase = 'closed';
  ev(st, now, job, 'kapanış', { R: job.closed.R, exitBy });
}

/** Kâğıt ↔ borsa karşılaştırması (her turda; sapma türü başına bir kayıt). */
function compare(job, plan, now) {
  const p = job.paper;
  if (!p) return;
  if (job.fill && NO_TRADE.has(p.status)) addDev(job, 'borsa_doldu_kagit_islemsiz', { paper: p.status, fillAt: job.fill.at }, now);
  if (job.closed && p.R != null && TRADED.has(p.status) && job.closed.R != null) {
    const diff = +(job.closed.R - p.R).toFixed(3);
    if (Math.abs(diff) >= 0.05) addDev(job, 'sonuc_farki', { exchangeR: job.closed.R, paperR: +p.R.toFixed(3), diff, paper: p.status, exchange: job.closed.exitBy }, now);
  }
  if (job.fill && p.filledAt && !job.fillLag) job.fillLag = { exchangeAt: job.fill.at, paperAt: p.filledAt, minutes: Math.round((p.filledAt - job.fill.at) / 60e3) };
  if (job.phase === 'closed' && (!plan || CLOSED.has(p.status))) job.paperDone = true;
}

function stepJob(st, job, plan, ex, orderOf, now, cfg, actions) {
  if (plan) job.paper = paperSnap(plan);
  for (const o of Object.values(job.orders)) {
    const x = orderOf(o.link);
    if (x) Object.assign(o, { status: x.orderStatus, cumExecQty: num(x.cumExecQty), avgPrice: num(x.avgPrice) || null, updatedAt: num(x.updatedTime) });
  }
  if (job.phase === 'closed') { compare(job, plan, now); return; }
  const pos = ex.positions?.[job.symbol];
  if (pos?.size > 0 && pos.side !== sideOf(job.d)) { addDev(job, 'ters_pozisyon', { side: pos.side, size: pos.size }, now); return; }
  const posSize = pos?.size > 0 ? pos.size : 0;

  if (job.phase === 'pending') {
    const E = job.orders.E;
    const paperGone = !plan || CLOSED.has(plan.status), tooOld = now - job.createdAt > cfg.maxPendingH * 3600e3;
    if (!E) { // giriş önceki turda gönderilemedi (ağ) → yeniden (aynı orderLinkId)
      if (paperGone || tooOld || plan.status !== 'waiting') { job.phase = 'cancelled'; job.reason = `giriş gönderilemeden kâğıt ${plan?.status ?? 'plan yok'}`; ev(st, now, job, 'iptal'); return; }
      actions.push({ type: 'leverage', jobId: job.id, symbol: job.symbol, lev: job.leverage }, { type: 'create', jobId: job.id, tag: 'E', body: entryBody(job) });
      return;
    }
    if (!E.status) return; // durumu henüz okunamadı
    if (OPEN_ST.has(E.status)) {
      if (plan && PAPER_FILLED.has(plan.status) && addDev(job, 'kagit_doldu_borsa_dolmadi', { paper: plan.status, paperFilledAt: plan.filledAt ?? plan.activeAt ?? null, last: ex.tickers?.[job.symbol] ?? null }, now))
        ev(st, now, job, 'bybit_bekliyor', { msg: pendingNote(job, ex.tickers?.[job.symbol]) });
      if (paperGone || tooOld) {
        job.cancelWhy = tooOld ? `${cfg.maxPendingH} saatte dolmadı` : plan ? `kâğıt ${plan.status}` : 'kâğıt plan durumdan düştü';
        actions.push({ type: 'cancel', jobId: job.id, tag: 'E', symbol: job.symbol, link: E.link });
      }
      return;
    }
    const filledQty = posSize || E.cumExecQty || 0;
    if (!(E.cumExecQty > 0)) { job.phase = 'cancelled'; job.reason = job.cancelWhy ?? `giriş emri ${E.status}`; job.closedAt = now; ev(st, now, job, 'iptal', { why: job.reason, ...(hasDev(job, 'kagit_doldu_borsa_dolmadi') ? { msg: `✖️ ${job.coin} ${job.direction}: Bybit demoda hiç dolmadı, emir iptal (${job.reason}). Kâğıt kayıt OKX fiyatıyla sürüyor.` } : {}) }); return; }
    job.fill = { price: E.avgPrice ?? job.lv.entry, qty: filledQty, at: E.updatedAt ?? now, paperStatus: plan?.status ?? null };
    job.phase = 'open';
    const late = (job.deviations || []).find((x) => x.kind === 'kagit_doldu_borsa_dolmadi');
    ev(st, now, job, 'dolum', { price: job.fill.price, qty: job.fill.qty, paper: plan?.status ?? null, ...(late ? { msg: `✅ ${job.coin} ${job.direction}: Bybit demoda da doldu (${job.fill.price})${late.paperFilledAt ? `, OKX'ten ≈ ${Math.max(0, Math.round((job.fill.at - late.paperFilledAt) / 60e3))} dk sonra` : ''}.` } : {}) });
    if (plan?.status === 'waiting') addDev(job, 'borsa_doldu_kagit_bekliyor', { paper: 'waiting' }, now);
    else if (plan?.status === 'confirming') addDev(job, 'borsa_doldu_kagit_teyit', { paper: 'confirming', knifeAt: plan.knifeAt ?? null }, now);
  }

  // open
  if (posSize === 0) { closeJob(st, job, plan, ex, now, actions); compare(job, plan, now); return; }
  const tick = job.inst.tick;
  if (!job.legs) job.legs = legsOf(job.lv, posSize, job.inst);
  job.legFails ??= {};
  for (const l of job.legs) if (!job.orders[l.tag] && (job.legFails[l.tag] || 0) < cfg.legRetries) actions.push({ type: 'create', jobId: job.id, tag: l.tag, body: exitBody(job, l.tag, l.price, l.qty) });
  // Stop hedefi: T1 doldu → giriş (dolum fiyatı); T2 doldu ve midStop 'early' → erken hedef
  const filled = (tag) => job.legs.some((l) => l.tag === tag) && job.orders[tag]?.status === 'Filled';
  let target = job.lv.stop, why = 'ilk stop';
  if (filled('T1')) { target = roundStep(job.fill.price, tick, 'nearest'); why = job.lv.early != null ? 'erken hedef doldu → stop girişe' : 'TP1 doldu → stop girişe'; }
  if (filled('T2') && job.lv.midStop === 'early') { target = job.lv.early; why = 'TP1 (ara kademe) doldu → stop erken hedefe'; }
  const cur = pos.stopLoss > 0 ? pos.stopLoss : job.stopLevel ?? job.lv.stop;
  if (Math.abs(cur - target) > +tick / 2) {
    const last = ex.tickers?.[job.symbol];
    if (last > 0 && job.d * (last - target) <= 0) {
      const xs = Object.keys(job.orders).filter((t) => t.startsWith('X'));
      const pendingX = xs.some((t) => !job.orders[t].status || OPEN_ST.has(job.orders[t].status));
      if (!pendingX) {
        actions.push({ type: 'create', jobId: job.id, tag: `X${xs.length + 1}`, body: exitBody(job, `X${xs.length + 1}`, null, posSize, 'Market') });
        addDev(job, 'stop_tasinamadi_piyasa', { target, last, why }, now);
      }
    } else actions.push({ type: 'stop', jobId: job.id, symbol: job.symbol, price: fmtStep(target, tick), level: target, why });
  }
  compare(job, plan, now);
}

/**
 * Saf karar. state: demo.json içeriği; plans: botun durumundaki planlar (state.sent; bu turun takibi uygulanmış);
 * ex: { positions: {SYM: {side,size,avgPrice,stopLoss}}, openOrders: [...], byLink: {link: order}, tickers: {SYM: last},
 *       insts: {COIN: inst | null}, closedPnl: {jobId: [...]} }; cfg: DEMO_DEFAULTS üzerine.
 * @returns {{ state: object, actions: object[] }}
 */
export function decideDemo({ state, plans = [], ex = {}, now = Date.now(), cfg = {} }) {
  const c = { ...DEMO_DEFAULTS, ...cfg };
  const st = structuredClone(state || emptyDemoState(now));
  st.jobs ??= {}; st.events ??= []; st.insts ??= {};
  const actions = [];
  const byId = new Map(plans.filter(Boolean).map((p) => [`${p.key}|${p.sentAt}`, p]));
  const openByLink = new Map((ex.openOrders || []).map((o) => [o.orderLinkId, o]));
  const orderOf = (link) => openByLink.get(link) ?? ex.byLink?.[link] ?? null;
  for (const job of Object.values(st.jobs)) {
    if (!ACTIVE.has(job.phase) && !(job.phase === 'closed' && !job.paperDone)) continue;
    stepJob(st, job, byId.get(job.id) ?? null, ex, orderOf, now, c, actions);
  }
  const busy = new Set(Object.values(st.jobs).filter((j) => ACTIVE.has(j.phase)).map((j) => j.symbol));
  let n = 0;
  for (const [id, p] of byId) {
    if (st.jobs[id] || !c.tfs.includes(p.tf) || p.status !== 'waiting') continue;
    if (n >= c.maxNew) break;
    const job = newJob(p, id, ex, now, c, busy, actions);
    if (!job) continue;
    st.jobs[id] = job;
    if (job.phase === 'pending') { busy.add(job.symbol); n++; ev(st, now, job, 'emir', { qty: job.qty, entry: job.lv.entry, stop: job.lv.stop, lev: job.leverage }); }
    else ev(st, now, job, 'atlandı', { why: job.reason });
  }
  return { state: st, actions };
}

/** Eylem sonucunu işe yazar (yerinde). Hata varsa kısa metin döner (bildirim için), yoksa null. */
export function applyResult(st, a, res, now) {
  const job = st.jobs[a.jobId];
  const code = res?.retCode;
  if (a.type === 'leverage') return res.ok || code === 110043 ? null : `kaldıraç ${res.error}`;
  if (!job) return null;
  if (a.type === 'create') {
    if (res.ok || code === 110072) { job.orders[a.tag] = { link: a.body.orderLinkId, at: now, qty: +a.body.qty, price: a.body.price != null ? +a.body.price : null, type: a.body.orderType }; return null; }
    if (code == null) return `emir ${a.tag} ${res.error}`; // ağ: sonraki turda aynı orderLinkId ile yeniden
    if (a.tag === 'E') { job.phase = 'skipped'; job.reason = `giriş emri reddedildi: ${res.error}`; ev(st, now, job, 'atlandı', { why: job.reason }); }
    else { job.legFails ??= {}; job.legFails[a.tag] = (job.legFails[a.tag] || 0) + 1; if (job.legFails[a.tag] >= DEMO_DEFAULTS.legRetries) addDev(job, `cikis_emri_reddedildi_${a.tag}`, { error: res.error }, now); }
    return `emir ${a.tag} reddedildi: ${res.error}`;
  }
  if (a.type === 'cancel') {
    if (res.ok || code === 110001 || code === 110008) { if (job.orders[a.tag]) job.orders[a.tag].cancelAt = now; return null; }
    return `iptal ${a.tag} ${res.error}`;
  }
  if (a.type === 'stop') {
    if (res.ok || code === 34040) { job.stopLevel = a.level; job.stops.push({ price: a.level, at: now, why: a.why }); ev(st, now, job, 'stop', { price: a.level, why: a.why }); return null; }
    job.stopFail = { price: a.level, at: now, error: res.error };
    return `stop taşıma ${res.error}`;
  }
  return null;
}

const listOf = (r) => (Array.isArray(r?.result?.list) ? r.result.list : []);

/** Borsa görüntüsü (yalnız okuma). Pozisyon / açık emir okunamazsa fırlatır: o görüntüyle karar verilmez. */
export async function gatherDemo(client, { state, plans, now, cfg }) {
  const c = { ...DEMO_DEFAULTS, ...cfg };
  const ex = { positions: {}, openOrders: [], byLink: {}, tickers: {}, insts: {}, closedPnl: {} };
  const pr = await client.positions();
  if (!pr.ok) throw new Error(`pozisyonlar okunamadı: ${pr.error}`);
  for (const p of listOf(pr)) { const size = num(p.size) || 0; if (size > 0) ex.positions[p.symbol] = { side: p.side, size, avgPrice: num(p.avgPrice), stopLoss: num(p.stopLoss) || null }; }
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const r = await client.openOrders({ settleCoin: 'USDT', ...(cursor ? { cursor } : {}) });
    if (!r.ok) throw new Error(`açık emirler okunamadı: ${r.error}`);
    ex.openOrders.push(...listOf(r));
    cursor = r.result?.nextPageCursor || ''; if (!cursor) break;
  }
  const open = new Set(ex.openOrders.map((o) => o.orderLinkId));
  const jobs = Object.values(state?.jobs || {}).filter((j) => ACTIVE.has(j.phase));
  // Açık listede olmayan ve son durumu bilinmeyen emirler: orderLinkId ile (önce realtime, boşsa history)
  for (const j of jobs) for (const o of Object.values(j.orders || {})) {
    if (open.has(o.link) || (o.status && !OPEN_ST.has(o.status))) continue;
    let r = await client.orderByLink(o.link), x = listOf(r)[0];
    if (!x) { r = await client.orderHistoryByLink(o.link); x = listOf(r)[0]; }
    if (x) ex.byLink[o.link] = x;
  }
  // Kapanmış olabilecek işler: pozisyon yok ve giriş açık değil → closed-pnl
  for (const j of jobs) {
    if (ex.positions[j.symbol] || !j.orders?.E || open.has(j.orders.E.link)) continue;
    const start = (j.orders.E.at ?? now) - 60e3;
    const r = await client.closedPnl(j.symbol, now - start < 7 * 864e5 ? start : undefined);
    if (r.ok) ex.closedPnl[j.id] = listOf(r).filter((x) => (num(x.updatedTime) ?? 0) >= start);
  }
  // Yeni adaylar: enstrüman (24 saat önbellek, durum dosyasında) + son fiyat; açık işler için son fiyat
  const cand = (plans || []).filter((p) => p && c.tfs.includes(p.tf) && p.status === 'waiting' && !state?.jobs?.[`${p.key}|${p.sentAt}`]).slice(0, c.maxNew * 3);
  const cache = state?.insts || {};
  for (const p of cand) {
    const hit = cache[p.coin];
    if (hit && now - hit.at < 864e5) { ex.insts[p.coin] = hit.inst; continue; }
    let inst = null, okAny = false;
    for (const s of symbolCandidates(p.coin)) {
      const r = await client.instrument(s.sym);
      if (r.retCode == null) continue; // ağ / HTTP hatası: bilinmiyor
      okAny = true; // Bybit yanıt verdi: olmayan sembolde retCode 10001 "params error: symbol invalid" (17.11 demo host'ta denendi)
      const raw = r.ok ? listOf(r)[0] : null;
      if (raw) { inst = parseInstrument(raw, p.coin, s.mult); break; }
    }
    if (okAny) { ex.insts[p.coin] = inst; cache[p.coin] = { at: now, inst }; } // ağ hatasında tanımsız kalır → sonraki tur
  }
  const syms = new Set([...cand.map((p) => ex.insts[p.coin]?.symbol).filter(Boolean), ...jobs.filter((j) => j.phase === 'open' || j.phase === 'pending').map((j) => j.symbol)]); // bekleyen: "OKX'te doldu, Bybit'te değil" satırındaki uzaklık için
  for (const s of syms) { const r = await client.ticker(s); const t = num(listOf(r)[0]?.lastPrice); if (t) ex.tickers[s] = t; }
  return ex;
}

export function loadDemo(file, now) { try { return { ...emptyDemoState(now), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return emptyDemoState(now); } }
export function saveDemo(file, st, now) {
  const cut = now - 90 * 864e5;
  const ent = Object.entries(st.jobs).filter(([, j]) => ACTIVE.has(j.phase) || (j.createdAt ?? 0) >= cut).slice(-1500);
  st.jobs = Object.fromEntries(ent); st.events = st.events.slice(-300); st.updatedAt = now;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st, null, 1));
}

/** Hata bildirimi: aynı hata 24 saatte bir (anahtar = sembolsüz ilk hata metni). */
export function errorNotice(st, errors, now) {
  if (!errors.length) { st.lastError = null; return null; }
  const key = errors[0].replace(/\b[A-Z0-9]{2,}USDT\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const prev = st.lastError;
  const due = !prev || prev.key !== key || now - (prev.notifiedAt || 0) > 864e5;
  st.lastError = { key, at: now, notifiedAt: due ? now : prev.notifiedAt, n: (prev?.key === key ? prev.n || 1 : 0) + 1 };
  return due ? `⚠️ Bybit demo: ${errors[0].slice(0, 200)}${errors.length > 1 ? ` (+${errors.length - 1} hata)` : ''}` : null;
}

/**
 * Tur: görüntü → karar → eylemler → dosya. Kendi hatalarını yakalar (fırlatmaz); hata ana sohbete kısa satır (tekrarsız).
 * @param {{ client, plans, file, now, cfg, notify?: (t: string) => Promise<any>, log?: Function, save?: boolean }} o
 */
export async function runDemo({ client, plans, file, now = Date.now(), cfg = {}, notify = async () => {}, log = () => {}, save = true }) {
  const st0 = loadDemo(file, now);
  let st = st0, errors = [], nAct = 0;
  try {
    const ex = await gatherDemo(client, { state: st0, plans, now, cfg });
    const out = decideDemo({ state: st0, plans, ex, now, cfg });
    st = out.state; // gatherDemo enstrüman önbelleğini st0.insts'e yazar; decideDemo onu kopyalar
    for (const a of out.actions) {
      const job = st.jobs[a.jobId];
      const res = a.type === 'leverage' ? await client.setLeverage(a.symbol, a.lev)
        : a.type === 'create' ? await client.createOrder(a.body)
          : a.type === 'cancel' ? await client.cancelOrder(a.symbol, a.link)
            : a.type === 'stop' ? await client.setTradingStop({ symbol: a.symbol, stopLoss: a.price, slTriggerBy: 'LastPrice' }) : { ok: true };
      nAct++;
      const e = applyResult(st, a, res, now);
      if (e) errors.push(`${job?.symbol ?? a.symbol ?? ''} ${e}`.trim());
    }
    const ph = {}; for (const j of Object.values(st.jobs)) ph[j.phase] = (ph[j.phase] || 0) + 1;
    log(`Bybit demo: ${nAct} eylem · işler ${Object.entries(ph).map(([k, v]) => `${k} ${v}`).join(', ') || 'yok'}${errors.length ? ` · ${errors.length} hata (${errors[0]})` : ''}`);
  } catch (err) { errors.push(String(err?.message || err)); log(`Bybit demo hatası: ${errors[0]}`); }
  const notes = (st.events || []).filter((e) => e.at === now && e.msg).map((e) => e.msg); // bu turun teyit satırları (OKX ↔ Bybit dolum farkı)
  if (notes.length) { try { await notify(notes.join('\n')); } catch { /* bildirim hatası turu etkilemez */ } }
  const msg = errorNotice(st, errors, now);
  if (msg) { try { await notify(msg); } catch { /* bildirim hatası turu etkilemez */ } }
  if (save) saveDemo(file, st, now);
  return { state: st, errors };
}
