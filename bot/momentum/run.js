// Momentum kâğıt portföyü turu: veri çek → fonlama → stop → (haftalık) yeniden dengeleme → bildirim → yayın.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, getCandles, TIMEFRAMES, instIdOf } from '../../src/data/okx.js';
import { MOM_DEFAULTS, newPortfolio, rebalanceDue, accrueFunding, checkStops, rebalance, markCurve, publishOf, equityOf, syncHedge, netExposure } from './portfolio.js';
import { esc, fp } from '../telegram.js';

/** Veri kaynağı: OKX ya da test/fixture sağlayıcısı ({ topCoins(n), candles(instId, tf, n) }). */
export function dataSource(provider) {
  if (provider) return { top: (n) => provider.topCoins(n), daily: (instId, n) => provider.candles(instId, '1D', n) };
  return { top: (n) => getTopCoins(n, {}), daily: (instId, n) => getCandles(instId, TIMEFRAMES['1D'], n) };
}

/**
 * Durum dosyası; yoksa (Actions önbelleği kaybı) yayınlanan <publishDir>/momentum.json'dan geri kurulur (rejim-Donchian'daki
 * yaklaşım), o da yoksa yeni portföy. Geri kurulduysa info.restored = { lost[] }.
 */
export function loadPortfolio(file, now, o, publishDir = null, info = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* yok */ }
  let pub = null;
  if (publishDir) { try { pub = JSON.parse(fs.readFileSync(path.join(publishDir, 'momentum.json'), 'utf8')); } catch { /* yok */ } }
  const r = portfolioFromPublished(pub);
  if (r) { info.restored = { lost: r.lost }; return r.pf; }
  return newPortfolio(now, o);
}

/**
 * Yayın nesnesinden (publishOf) portföy → { pf, lost } | null. Yayında olmayanlar: pozisyon adedi (qty = nominal ÷ giriş,
 * nominal 2 haneye yuvarlı), ilk stop (stop0) ve giriş riski (risk → kapanışta R yazılamaz), izleyen stop günü (trailDay:
 * son kapanmış mumla yeniden hesaplanır, stop yalnız ilerler), son fonlama tahakkuku (yayın zamanı alınır), 200'den eski
 * işlemler ve 12'den eski yeniden dengeleme kayıtları.
 */
export function portfolioFromPublished(pub) {
  if (!pub || typeof pub !== 'object' || !Array.isArray(pub.positions) || !Number.isFinite(pub.startEquity) || !Number.isFinite(pub.realized) || !Number.isFinite(pub.updatedAt)) return null;
  const positions = pub.positions.map((q) => ({
    coin: q.coin, instId: q.hedge ? 'BTC-USDT-SWAP' : instIdOf(q.coin), ...(q.hedge ? { hedge: true } : {}), d: q.direction === 'long' ? 1 : -1,
    entry: q.entry, qty: q.notional / q.entry, notional: q.notional, stop: q.stop ?? null, stop0: null, risk: null,
    stopPct: q.stopPct ?? null, riskUsd: q.riskUsd ?? 0, entryTime: q.entryTime, funding: q.funding || 0, trailDay: 0, lastPrice: q.price ?? q.entry,
  }));
  const trades = Array.isArray(pub.trades) ? [...pub.trades].reverse() : [];
  const pf = { version: 1, start: pub.start ?? pub.updatedAt, startEquity: pub.startEquity, realized: pub.realized, positions, trades, curve: Array.isArray(pub.curve) ? pub.curve : [],
    lastRebalance: pub.lastRebalance || 0, lastAccrual: pub.updatedAt, rebalances: Array.isArray(pub.rebalances) ? [...pub.rebalances].reverse() : [], btcStart: pub.btc?.start ?? null };
  const lost = [];
  if (positions.some((q) => !q.hedge)) lost.push('açık pozisyonların ilk stopu ve giriş riski (kapanışta R boş kalır; K/Z ve % tam)');
  const tradesLost = (pub.stats?.trades || 0) - trades.length;
  if (tradesLost > 0) lost.push(`${tradesLost} eski kapanan işlem kaydı (yayında son 200)`);
  if ((pub.rebalances || []).length >= 12) lost.push('12\'den eski yeniden dengeleme kayıtları');
  return { pf, lost };
}

const dirTxt = (d) => (d === 1 ? '🟢 long' : '🔴 short');

export async function runMomentum({ now, cfg = {}, notify, log, stateFile, publishDir, provider, summaryDue = false }) {
  const o = { ...MOM_DEFAULTS, ...(cfg.variant ? { side: cfg.variant } : {}), ...(cfg.rank ? { rank: cfg.rank } : {}), ...(cfg.hedge != null ? { hedge: !!cfg.hedge } : {}) };
  const src = dataSource(provider);
  const info = {};
  const pf = loadPortfolio(stateFile, now, o, publishDir, info);
  const fresh = !pf.lastRebalance && !pf.positions.length && !pf.trades.length;
  const due = rebalanceDue(pf, now);
  // Evren: yeniden dengelemede o günün hacimde ilk N'i (canlıda sağ kalanlık yanlılığı yok); aksi halde yalnız açık pozisyonlar
  const top = await src.top(due ? cfg.universe || o.universe : 0).catch((e) => { log(`Momentum: evren alınamadı: ${e.message}`); return []; });
  const coins = new Map(top.map((t) => [t.coin, t.instId]));
  for (const q of pf.positions) coins.set(q.coin, q.instId || instIdOf(q.coin));
  coins.set('BTC', instIdOf('BTC'));
  const daily = {}, prices = {};
  for (const [coin, instId] of coins) {
    try {
      const r = await src.daily(instId, 70);
      daily[coin] = r;
      const last = r.live || r.candles[r.candles.length - 1];
      if (last) prices[coin] = last.close;
    } catch (e) { log(`Momentum: ${coin} 1D: ${e.message}`); }
  }
  if (pf.btcStart == null && prices.BTC) pf.btcStart = prices.BTC;
  accrueFunding(pf, now, o);
  const msgs = [];
  const stopped = checkStops(pf, daily, prices, now, o);
  for (const t of stopped) msgs.push(`🛑 Momentum stop: <b>${esc(t.coin)}</b> ${t.direction} ${fp(t.entry)} → ${fp(t.exit)} · ${t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (%${t.pct})`);
  // Hedge her turda eşitlenir (yeniden dengeleme turunda rebalance() içinde yapılır): ayar sonradan açılınca ya da
  // stop/fiyat sürüklenmesiyle net maruziyet kayınca hedge yoksa açılır, sapma resizeTol'u aşarsa hedefe çekilir.
  if (!due) {
    const hs = syncHedge(pf, prices, now, o);
    if (hs) {
      const h = pf.positions.find((q) => q.hedge);
      msgs.push(`⚖️ BTC hedge ${hs.action === 'open' ? `açıldı: ${h ? dirTxt(h.d) : ''} ${hs.notional} USDT @ ${fp(h?.entry)}` : hs.action === 'close' ? 'kapandı' : `${hs.from} → ${hs.notional} USDT`} (alt net maruziyet ${netExposure(pf, prices).toFixed(0)} USDT)`);
    }
  }
  if (due) {
    const universe = top.map((t) => ({ coin: t.coin, instId: t.instId, candles: daily[t.coin]?.candles || [], live: daily[t.coin]?.live }));
    if (!universe.some((u) => u.coin === 'BTC') && daily.BTC) universe.push({ coin: 'BTC', instId: instIdOf('BTC'), candles: daily.BTC.candles, live: daily.BTC.live });
    const { exits, entries, resized, hedge, sel } = rebalance(pf, universe, prices, now, o);
    if (sel) {
      log(`Momentum yeniden dengeleme: long ${sel.longs.join(',') || '–'} | short ${sel.shorts.join(',') || '–'} | çıkan ${exits.length}, giren ${entries.length}, yeniden boyutlanan ${resized.length}`);
      const lines = [`🔄 <b>Momentum portföyü — haftalık yeniden dengeleme</b> (kâğıt, ${o.side === 'ls' ? 'long-short' : o.side}${o.rank === 'rel' ? ', BTC\'ye göre sıralama' : ''}${o.hedge ? ', BTC hedge\'li' : ''})`,
        `Özsermaye: ${equityOf(pf, prices).toFixed(2)} USDT (başlangıç ${pf.startEquity})`];
      if (exits.length) lines.push('', '<b>Çıkan</b>', ...exits.map((t) => `${esc(t.coin)} ${t.direction}: ${t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (%${t.pct})`));
      if (resized.length) lines.push('', '<b>Yeniden boyutlanan</b> (eşit risk)', ...resized.map((r) => `${esc(r.coin)} nominal ${r.from} → ${r.to} USDT`));
      if (entries.length) lines.push('', '<b>Giren</b>', ...entries.map((q) => `${esc(q.coin)} ${dirTxt(q.d)} @ ${fp(q.entry)} · stop ${fp(q.stop)} (%${q.stopPct}) · ${q.notional} USDT · risk ${q.riskUsd} USDT`));
      if (o.hedge) { const h = pf.positions.find((q) => q.hedge); lines.push('', `⚖️ <b>BTC hedge</b>: ${h ? `${dirTxt(h.d)} ${h.notional} USDT @ ${fp(h.entry)}` : 'yok'}${hedge ? ` (${hedge.action === 'open' ? 'açıldı' : hedge.action === 'close' ? 'kapandı' : `${hedge.from} → ${hedge.notional}`})` : ''} · alt net maruziyet ${netExposure(pf, prices).toFixed(0)} USDT`); }
      lines.push('', `Tutulan: ${pf.positions.filter((q) => !q.hedge).map((q) => `${q.coin}${q.d === 1 ? '↑' : '↓'}`).join(' ') || '–'}`, `Her pozisyon stop'a kadar özsermayenin %${o.riskPct}'sini riske eder. Sanal portföy; gerçek emir yoktur.`);
      msgs.push(lines.join('\n'));
    } else log('Momentum: evren yetersiz, yeniden dengeleme atlandı');
  }
  const eq = markCurve(pf, prices, now, o);
  if (info.restored) {
    log(`Momentum: durum dosyası yok → yayından geri kuruldu${info.restored.lost.length ? ` (kayıp: ${info.restored.lost.join('; ')})` : ''}`);
    msgs.unshift(`♻️ <b>Momentum durumu yayından geri kuruldu</b> (önbellek yok)\nÖzsermaye ${eq.toFixed(2)} USDT · açık ${pf.positions.filter((q) => !q.hedge).length}${pf.positions.some((q) => q.hedge) ? ' + BTC hedge' : ''} · kapanan ${pf.trades.length}${info.restored.lost.length ? `\nGeri gelmeyen: ${esc(info.restored.lost.join('; '))}` : ''}`);
  }
  if (fresh) msgs.unshift(`📈 Momentum kâğıt portföyü başladı: ${pf.startEquity} USDT sanal sermaye, ${o.side === 'ls' ? 'en güçlü 5 long + en zayıf 5 short' : o.side === 'short' ? 'en zayıf 5 short' : 'en güçlü 5 long'}, haftalık yeniden dengeleme.`);
  if (summaryDue) msgs.push(`📈 Momentum portföyü: ${eq.toFixed(2)} USDT (%${(((eq / pf.startEquity) - 1) * 100).toFixed(2)}) · açık ${pf.positions.filter((q) => !q.hedge).length}${o.hedge ? ` + BTC hedge ${pf.positions.find((q) => q.hedge)?.notional ?? 0} USDT` : ''} · kapanan ${pf.trades.length}`);
  for (const m of msgs) await notify(m);
  log(`Momentum: özsermaye ${eq.toFixed(2)} USDT, açık ${pf.positions.length}, kapanan ${pf.trades.length}${due ? ' (yeniden dengelendi)' : ''}`);
  if (!cfg.dry) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(pf));
    fs.mkdirSync(publishDir, { recursive: true });
    fs.writeFileSync(path.join(publishDir, 'momentum.json'), JSON.stringify(publishOf(pf, prices, now, o, prices.BTC)));
  }
  return pf;
}
