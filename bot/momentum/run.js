// Momentum kâğıt portföyü turu: veri çek → fonlama → stop → (haftalık) yeniden dengeleme → bildirim → yayın.
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, getCandles, TIMEFRAMES, instIdOf } from '../../src/data/okx.js';
import { MOM_DEFAULTS, newPortfolio, rebalanceDue, accrueFunding, checkStops, rebalance, markCurve, publishOf, equityOf } from './portfolio.js';
import { esc, fp } from '../telegram.js';

/** Veri kaynağı: OKX ya da test/fixture sağlayıcısı ({ topCoins(n), candles(instId, tf, n) }). */
export function dataSource(provider) {
  if (provider) return { top: (n) => provider.topCoins(n), daily: (instId, n) => provider.candles(instId, '1D', n) };
  return { top: (n) => getTopCoins(n, {}), daily: (instId, n) => getCandles(instId, TIMEFRAMES['1D'], n) };
}

export function loadPortfolio(file, now, o) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return newPortfolio(now, o); }
}

const dirTxt = (d) => (d === 1 ? '🟢 long' : '🔴 short');

export async function runMomentum({ now, cfg = {}, notify, log, stateFile, publishDir, provider, summaryDue = false }) {
  const o = { ...MOM_DEFAULTS, ...(cfg.variant ? { side: cfg.variant } : {}) };
  const src = dataSource(provider);
  const pf = loadPortfolio(stateFile, now, o);
  const fresh = !pf.lastRebalance && !pf.positions.length && !pf.trades.length;
  const due = rebalanceDue(pf, now);
  // Evren: yeniden dengelemede o günün hacimde ilk N'i (canlıda sağ kalanlık yanlılığı yok); aksi halde yalnız açık pozisyonlar
  const top = await src.top(due ? cfg.universe || 50 : 0).catch((e) => { log(`Momentum: evren alınamadı: ${e.message}`); return []; });
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
  for (const t of checkStops(pf, daily, prices, now, o)) msgs.push(`🛑 Momentum stop: <b>${esc(t.coin)}</b> ${t.direction} ${fp(t.entry)} → ${fp(t.exit)} · ${t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (%${t.pct})`);
  if (due) {
    const universe = top.map((t) => ({ coin: t.coin, instId: t.instId, candles: daily[t.coin]?.candles || [], live: daily[t.coin]?.live }));
    const { exits, entries, sel } = rebalance(pf, universe, prices, now, o);
    if (sel) {
      log(`Momentum yeniden dengeleme: long ${sel.longs.join(',') || '–'} | short ${sel.shorts.join(',') || '–'} | çıkan ${exits.length}, giren ${entries.length}`);
      const lines = [`🔄 <b>Momentum portföyü — haftalık yeniden dengeleme</b> (kâğıt, ${o.side === 'ls' ? 'long-short' : o.side})`,
        `Özsermaye: ${equityOf(pf, prices).toFixed(2)} USDT (başlangıç ${pf.startEquity})`];
      if (exits.length) lines.push('', '<b>Çıkan</b>', ...exits.map((t) => `${esc(t.coin)} ${t.direction}: ${t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (%${t.pct})`));
      if (entries.length) lines.push('', '<b>Giren</b>', ...entries.map((q) => `${esc(q.coin)} ${dirTxt(q.d)} @ ${fp(q.entry)} · stop ${fp(q.stop)} · ${q.notional} USDT`));
      lines.push('', `Tutulan: ${pf.positions.map((q) => `${q.coin}${q.d === 1 ? '↑' : '↓'}`).join(' ') || '–'}`, 'Sanal portföy; gerçek emir yoktur.');
      msgs.push(lines.join('\n'));
    } else log('Momentum: evren yetersiz, yeniden dengeleme atlandı');
  }
  const eq = markCurve(pf, prices, now, o);
  if (fresh) msgs.unshift(`📈 Momentum kâğıt portföyü başladı: ${pf.startEquity} USDT sanal sermaye, ${o.side === 'ls' ? 'en güçlü 5 long + en zayıf 5 short' : o.side === 'short' ? 'en zayıf 5 short' : 'en güçlü 5 long'}, haftalık yeniden dengeleme.`);
  if (summaryDue) msgs.push(`📈 Momentum portföyü: ${eq.toFixed(2)} USDT (%${(((eq / pf.startEquity) - 1) * 100).toFixed(2)}) · açık ${pf.positions.length} · kapanan ${pf.trades.length}`);
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
