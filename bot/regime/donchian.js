// Rejim kuralı (kâğıt): BTC "G↑ · şok↑ devam" rejimindeyken Donchian 20 kırılımı long (ADX ≥ 25, +DI > −DI), stop 2 ATR,
// 2 ATR izleyen stop, en fazla 100 mum. Lab (30.10.2026, 24 ay, 1H/4H): bu hücre ham eğitim +0,35R / doğr. +0,84R,
// hedge'li +0,16R / +0,38R (4H long: hedge'li +0,46 / +0,69R). REGIME_DONCHIAN=1 ile açılır; varsayılan kapalı. Gerçek emir yok.
import fs from 'node:fs';
import path from 'node:path';
import * as I from '../../src/data/indicators.js';
import { getTopCoins, getCandles, TIMEFRAMES, instIdOf } from '../../src/data/okx.js';
import { regimeAt } from '../../src/scan/btcRegime.js';
import { esc, fp } from '../telegram.js';

export const RD_DEFAULTS = { regime: 'G↑ · şok↑ devam', tfs: ['4H', '1H'], top: 30, maxOpen: 6, adxMin: 25, stopAtr: 2, trailAtr: 2, maxBars: 100, feePct: 0.05 };

/** Son KAPANMIŞ mumda Donchian kırılımı long sinyali → { entry, stop, atr, time } | null (lab `donchian` ile aynı kural). */
export function donchianLong(candles, o = RD_DEFAULTS) {
  if (candles.length < 60) return null;
  const hi = candles.map((c) => c.high), lo = candles.map((c) => c.low), cl = candles.map((c) => c.close);
  const atr = I.atr(hi, lo, cl, 14), dx = I.adx(hi, lo, cl, 14), dc = I.donchian(hi, lo, 20);
  const i = candles.length - 1, c = candles[i], a = atr[i];
  if (a == null || dx.adx[i] == null || dc.upper[i] == null || dx.adx[i] < o.adxMin) return null;
  if (!(c.close > dc.upper[i] && dx.pdi[i] > dx.mdi[i])) return null;
  return { entry: c.close, stop: c.close - o.stopAtr * a, atr: a, time: c.time };
}

/** Açık pozisyonu kapanmış mumlarla ilerletir (izleyen stop / stop / süre). Kapanırsa { exit, outcome } döner. */
export function stepPosition(p, candles, o = RD_DEFAULTS) {
  for (const c of candles) {
    if (c.time <= p.lastTime) continue;
    p.bars++; p.lastTime = c.time;
    if (c.low <= p.stop) return { exit: p.stop, outcome: 'stopped', time: c.time };
    const ns = c.close - o.trailAtr * p.atr; if (ns > p.stop) p.stop = ns;
    if (p.bars >= o.maxBars) return { exit: c.close, outcome: 'timeout', time: c.time };
  }
  return null;
}
/** Ölçülmüş kural sinyalini ajan aday biçimine çevirir (bot/run.mjs adaylarıyla aynı alanlar). */
export function toAgentCand(coin, tf, s, label) {
  return { coin, tf, direction: 'long', d: 1, source: 'regime_donchian', score: null, mtf: null, price: s.entry, atr: +s.atr.toPrecision(6), zone: [s.entry, s.entry], inZone: true,
    entry: s.entry, stop: +s.stop.toPrecision(8), tp1: null, tp2: null, rr: null, rr1: null, riskPct: +(((s.entry - s.stop) / s.entry) * 100).toFixed(2), trend: { rsBtc: null, rsSide: null, adx: null },
    signals: [{ name: `Ölçülmüş kural: BTC ${label} → Donchian 20 kırılımı long (lab 24 ay: hedge'li doğr. +0,38R; stop 2 ATR, 2 ATR izleyen, hedef yok)`, group: 'trend', direction: 'long', strength: 1 }], htf: [] };
}

/** Ajanlar için yalnız ölçülmüş kenarı olan kural adayları: rejim aktifse ilk N coinde Donchian long. → { label, cands } */
export async function regimeCandidates({ now, provider, cfg = {}, log = () => {} }) {
  const o = { ...RD_DEFAULTS, ...cfg };
  const cand = async (coin, tf, n) => { const r = provider ? await provider.candles(instIdOf(coin), tf, n) : await getCandles(instIdOf(coin), TIMEFRAMES[tf], n); return r.candles; };
  const rg = regimeAt(await cand('BTC', '1H', 120), await cand('BTC', '1D', 120), now);
  const label = rg?.label || null, cands = [];
  if (label !== o.regime) return { label, cands };
  const top = provider ? await provider.topCoins(o.top) : await getTopCoins(o.top, {});
  for (const t of top) {
    for (const tf of o.tfs) {
      try { const s = donchianLong(await cand(t.coin, tf, 150), o); if (s) { cands.push(toAgentCand(t.coin, tf, s, label)); break; } } catch (e) { log(`Ölçülmüş aday ${t.coin} ${tf}: ${e.message}`); }
    }
    if (cands.length >= 10) break;
  }
  return { label, cands };
}

const rOf = (p, exit, o) => +(((exit - p.entry) - (o.feePct / 100) * 2 * p.entry) / (p.entry - p.stop0)).toFixed(3);

export async function runRegimeDonchian({ now, cfg = {}, notify, log, stateFile, publishDir, provider }) {
  const o = { ...RD_DEFAULTS, ...cfg };
  const cand = async (coin, tf, n) => { const r = provider ? await provider.candles(instIdOf(coin), tf, n) : await getCandles(instIdOf(coin), TIMEFRAMES[tf], n); return r.candles; };
  // Durum: önce yerel dosya; yoksa (Actions önbelleği yok) yayınlanan docs/agent/regime.json'dan kurulur. Önbellek yol listesine
  // eklenmez: listeyi değiştirmek actions/cache sürümünü değiştirir ve tüm bot durumunu (ajanlar, momentum) sıfırlar (30.10 olayı).
  let st; try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {
    try { const pub = JSON.parse(fs.readFileSync(path.join(publishDir || 'docs/agent', 'regime.json'), 'utf8')); st = { open: pub.open || [], closed: pub.closed || [], lastRegime: pub.regime ?? null }; }
    catch { st = { open: [], closed: [], lastRegime: null }; }
  }
  const btc1h = await cand('BTC', '1H', 120), btcD = await cand('BTC', '1D', 120);
  const rg = regimeAt(btc1h, btcD, now);
  const label = rg?.label || null;
  const msgs = [];
  if (label !== st.lastRegime) { log(`Rejim: ${st.lastRegime || '–'} → ${label || '–'}`); if (label === o.regime || st.lastRegime === o.regime) msgs.push(`🧭 BTC rejimi: <b>${esc(label || '–')}</b>${label === o.regime ? ' → Donchian long kuralı AKTİF (kâğıt)' : ' → kural pasif'}`); st.lastRegime = label; }
  // 1) Açık pozisyonlar
  for (const p of [...st.open]) {
    try {
      const done = stepPosition(p, await cand(p.coin, p.tf, 150), o);
      if (done) { const R = rOf(p, done.exit, o); st.open = st.open.filter((x) => x !== p); st.closed.push({ ...p, exit: done.exit, outcome: done.outcome, exitTime: done.time, R }); msgs.push(`${R >= 0 ? '✅' : '🛑'} Rejim-Donchian kapandı: <b>${esc(p.coin)}</b> ${p.tf} ${fp(p.entry)} → ${fp(done.exit)} · ${R >= 0 ? '+' : ''}${R}R (${done.outcome === 'stopped' ? 'izleyen stop' : 'süre'})`); }
    } catch (e) { log(`Rejim-Donchian ${p.coin}: ${e.message}`); }
  }
  // 2) Yeni girişler (yalnız rejim aktifken)
  if (label === o.regime && st.open.length < o.maxOpen) {
    const top = provider ? await provider.topCoins(o.top) : await getTopCoins(o.top, {});
    for (const t of top) {
      if (st.open.length >= o.maxOpen) break;
      for (const tf of o.tfs) {
        if (st.open.some((p) => p.coin === t.coin && p.tf === tf)) continue;
        try {
          const cs = await cand(t.coin, tf, 150), s = donchianLong(cs, o);
          if (!s || st.closed.some((p) => p.coin === t.coin && p.tf === tf && p.signalTime === s.time)) continue;
          const p = { coin: t.coin, tf, entry: s.entry, stop: s.stop, stop0: s.stop, atr: s.atr, signalTime: s.time, lastTime: s.time, bars: 0, openedAt: now, regime: label };
          st.open.push(p);
          msgs.push(`🚀 Rejim-Donchian long (kâğıt): <b>${esc(t.coin)}</b> ${tf} giriş ${fp(p.entry)} · stop ${fp(p.stop)} (2 ATR, izleyen) · BTC ${esc(label)}`);
          break;
        } catch (e) { log(`Rejim-Donchian ${t.coin} ${tf}: ${e.message}`); }
      }
    }
  }
  if (!cfg.dry) {
    fs.writeFileSync(stateFile, JSON.stringify(st));
    const done = st.closed.filter((x) => x.R != null), n = done.length, sum = done.reduce((a, x) => a + x.R, 0);
    if (publishDir) fs.writeFileSync(path.join(publishDir, 'regime.json'), JSON.stringify({ updatedAt: now, regime: label, rule: o, open: st.open, closed: st.closed.slice(-200), stats: { n, totalR: +sum.toFixed(2), avgR: n ? +(sum / n).toFixed(3) : 0 } }));
  }
  for (const m of msgs) await notify(m);
  log(`Rejim-Donchian: rejim ${label || '–'} · açık ${st.open.length} · kapanan ${st.closed.length}`);
  return st;
}
