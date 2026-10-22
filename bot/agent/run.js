// Ajan akışı: her koşuda profil başına → pozisyonları güncelle → (aday/pozisyon varsa) karar → uygula → yansıma →
// gözden geçirme (20 işlem / 7 gün) → bildir → yayınla (docs/agent/<profil>.json).
import fs from 'node:fs';
import path from 'node:path';
import { PROFILES } from './profiles.js';
import { newAccount, updatePositions, openPosition, closeManual, adjustPosition, endOfRun, markToMarket, statsOf, closeOrphanHedges, openPendingHedges } from './account.js';
import { decide, reflect, review, clampParams } from './manager.js';
import { esc, fp } from '../telegram.js';

const r2 = (x) => +Number(x).toFixed(2);

export function loadAgents(file, now) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* yeni */ }
  for (const id of Object.keys(PROFILES)) if (!st[id]) st[id] = newAccount(PROFILES[id], now);
  return st;
}
export function saveAgents(file, st) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(st)); }

/** Yayın dosyası (sayfa için): son 100 işlem, eğri, dersler, parametre geçmişi. */
export function publish(acct, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = { ...acct, trades: acct.trades.slice(-100), journal: acct.journal.slice(-50), stats: statsOf(acct), publishedAt: Date.now() };
  fs.writeFileSync(path.join(dir, `${acct.profile}.json`), JSON.stringify(out));
}

const EV_TR = { hedge_open: '⚖️ BTC hedge açıldı', hedge_close: '⚖️ BTC hedge kapandı', filled: '📥 Limit emir doldu', expired: '⌛ Limit emir süresi doldu', stop: '🛑 Stop', tp1_stop: '🟡 TP1 sonrası stop', tp1: '🎯 TP1 (yarı kapandı)', tp2: '🏁 TP2 (tam kapandı)', liq: '💀 LİKİDASYON', manual: '✂️ Elle kapanış' };

function fmtOpen(acct, pos, order, hedgeLeg = null) {
  const p = pos || order;
  const hedgeTxt = hedgeLeg ? `\n⚖️ BTC hedge: ${hedgeLeg.direction === 'long' ? 'LONG' : 'SHORT'} ${hedgeLeg.leverage}x marjin ${fp(hedgeLeg.margin)} USDT @ ${fp(hedgeLeg.entry)} (ana pozisyonla birlikte kapanır)` : p.hedge ? '\n⚖️ BTC hedge dolumda açılacak' : '';
  return `🤖 <b>Ajan [${esc(acct.label)}]</b> ${pos ? 'pozisyon açtı' : 'limit emir koydu'} — <b>${esc(p.coin)}</b> ${esc(p.tf || '')} ${p.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} ${p.leverage}x\nMarjin ${fp(p.margin)} USDT · ${pos ? `giriş ${fp(pos.entry)}` : `limit ${fp(order.price)}`} · stop ${fp(p.stop)} · TP1 ${fp(p.tp1)} · TP2 ${fp(p.tp2)} · lik. ${fp(pos?.liq ?? 0)}\n${esc(p.rationale)}${p.notes?.length ? `\n<i>Kırpıldı: ${esc(p.notes.join('; '))}</i>` : ''}${hedgeTxt}\nÖzsermaye ${fp(acct.equity)} USDT`;
}
function fmtEvent(acct, ev) {
  const p = ev.pos || ev.order;
  const head = `🤖 <b>Ajan [${esc(acct.label)}]</b> ${EV_TR[ev.type] || ev.type} — <b>${esc(p.coin)}</b> ${p.direction === 'long' ? 'LONG' : 'SHORT'} ${p.leverage}x`;
  if (ev.type === 'filled' || ev.type === 'expired') return `${head}${ev.price ? ` @ ${fp(ev.price)}` : ''}`;
  return `${head} @ ${fp(ev.price)} · K/Z ${ev.pnl >= 0 ? '+' : ''}${fp(ev.pnl)} USDT · özsermaye ${fp(acct.equity)} USDT`;
}
export function fmtDaily(acct, stats) {
  const open = acct.positions.map((p) => `• ${p.coin} ${p.direction.toUpperCase()} ${p.leverage}x ${p.unrealized >= 0 ? '+' : ''}${fp(p.unrealized)} USDT`).join('\n');
  const adverse = acct.trades.filter((t) => t.btcPct != null && ((t.direction === 'long' && t.btcPct < 0) || (t.direction === 'short' && t.btcPct > 0)));
  const btcLine = adverse.length ? `\nBTC ters giderken kapanan: ${adverse.length} işlem, ort ${(adverse.reduce((a, t) => a + t.R, 0) / adverse.length).toFixed(2)}R` : '';
  const lastLesson = acct.lessons[acct.lessons.length - 1];
  return `🤖 <b>Ajan [${esc(acct.label)}] günlük özet</b>\nÖzsermaye <b>${fp(acct.equity)}</b> USDT (${stats.returnPct >= 0 ? '+' : ''}${stats.returnPct}% başlangıçtan) · gün başı ${fp(acct.day.startEquity)}\nİşlem ${stats.trades} · kazanma %${(stats.winRate * 100).toFixed(0)} · ort ${stats.avgR}R · PF ${stats.profitFactor} · maks DD ${fp(stats.maxDD)} · likidasyon ${stats.liquidations}\n${open ? `Açık:\n${open}` : 'Açık pozisyon yok'}${btcLine}${lastLesson ? `\nSon ders: ${esc(lastLesson)}` : ''}`;
}

/**
 * @param ctx { rows (tarama), candidates (plan listesi, htf dahil), prices {coin: fiyat}, now, cfg, notify(text), log, llm {apiKey, model, fetchImpl}, stateFile, publishDir, summaryDue }
 */
export async function runAgents(ctx) {
  const { now, cfg, notify, log } = ctx;
  const st = loadAgents(ctx.stateFile, now);
  const candlesByCoin = {};
  for (const r of ctx.rows) { if (r.error || r.tf !== ctx.trackTf) continue; candlesByCoin[r.coin] = r.live ? [...r.candles, r.live] : r.candles; }
  for (const id of Object.keys(PROFILES)) {
    const profile = PROFILES[id], acct = st[id];
    Object.defineProperty(acct, '_btcPrice', { value: ctx.market?.btcPrice ?? ctx.prices?.BTC ?? null, enumerable: false, configurable: true, writable: true }); // kapanış kayıtları için (yayınlanmaz)
    // 1) Güncelle
    const btcPx = ctx.market?.btcPrice ?? ctx.prices?.BTC ?? null;
    const events = updatePositions(acct, candlesByCoin, now);
    for (const h of openPendingHedges(acct, btcPx, now)) events.push({ type: 'hedge_open', pos: h, price: h.entry });
    events.push(...closeOrphanHedges(acct, btcPx, now).map((e) => ({ ...e, type: 'hedge_close' })));
    markToMarket(acct, ctx.prices);
    for (const ev of events) {
      await notify(fmtEvent(acct, ev));
      if (['stop', 'tp1_stop', 'tp2', 'liq', 'manual'].includes(ev.type)) {
        const trade = acct.trades[acct.trades.length - 1];
        if (trade && !trade.reflection && ctx.llm.apiKey && !cfg.dry) {
          try { const r = await reflect(trade, acct, ctx.llm); trade.reflection = r.lesson; acct.journal.push({ at: now, tradeId: trade.id, lesson: r.lesson, tags: r.tags }); } catch (err) { log(`  ajan ${id} yansıma hatası: ${err.message}`); }
        }
      }
    }
    // 2) Karar
    const cands = ctx.candidates.filter((p) => !acct.params.avoidTfs?.includes(p.tf) && !acct.positions.some((x) => x.coin === p.coin)).slice(0, 10);
    const dueDecision = (cands.length || acct.positions.length) && (!acct.lastDecision || now - acct.lastDecision >= (cfg.agentEveryMin || 15) * 60e3 - 60e3);
    if (dueDecision && ctx.llm.apiKey && !cfg.dry) {
      try {
        const stats = statsOf(acct);
        const dec = await decide(acct, profile, cands, stats, ctx.llm, ctx.market || {});
        acct.lastDecision = now; acct.lastAssessment = dec.assessment;
        log(`  ajan ${id}: ${dec.actions.length} eylem (${dec._usage?.input_tokens}+${dec._usage?.output_tokens} tok) — ${dec.assessment.slice(0, 120)}`);
        for (const a of dec.actions) {
          if (a.type === 'hold') continue;
          if (a.type === 'open') {
            const cand = cands.find((p) => p.coin === a.coin) || null;
            const price = ctx.prices[a.coin];
            if (!price) { log(`  ajan ${id}: ${a.coin} fiyat yok, atlandı`); continue; }
            const res = openPosition(acct, { coin: a.coin, tf: cand?.tf || '', direction: a.direction, margin: a.margin_usdt, leverage: a.leverage, order: a.order === 'limit' ? 'limit' : 'market', limit_price: a.limit_price, price, stop: a.stop, tp1: a.tp1, tp2: a.tp2, hedge: !!a.hedge, rationale: a.rationale, signals: cand?.signals.slice(0, 8).map((s) => s.name) || [], source: cand?.source || 'scanner', btcPrice: btcPx }, now, profile.guards);
            if (!res.ok) { log(`  ajan ${id}: ${a.coin} açılmadı — ${res.reason}`); acct.notes.push({ at: now, text: `${a.coin} ${a.direction} reddedildi: ${res.reason}` }); continue; }
            await notify(fmtOpen(acct, res.position, res.order, res.hedgeLeg));
          } else if (a.type === 'close') {
            const ev = closeManual(acct, a.position_id, ctx.prices[a.coin] || acct.positions.find((p) => p.id === a.position_id)?.lastPrice, now, a.rationale);
            if (ev) await notify(fmtEvent(acct, ev));
            for (const h of closeOrphanHedges(acct, btcPx, now)) await notify(fmtEvent(acct, { ...h, type: 'hedge_close' }));
          } else if (a.type === 'adjust') {
            const r = adjustPosition(acct, a.position_id, { stop: a.stop || null, tp1: a.tp1 || null, tp2: a.tp2 || null });
            log(`  ajan ${id}: ayar ${a.coin} → ${r.ok ? r.notes.join(', ') : r.reason}`);
          }
        }
      } catch (err) { log(`  ajan ${id} karar hatası: ${err.message}`); }
    }
    // 3) Gözden geçirme
    if (ctx.llm.apiKey && !cfg.dry && (acct.closedSinceReview >= 20 || (now - acct.lastReview > 7 * 86400e3 && acct.closedSinceReview >= 5))) {
      try {
        const stats = statsOf(acct);
        const rv = await review(acct, profile, stats, ctx.llm);
        acct.lessons = rv.lessons.slice(0, 10);
        acct.params = clampParams(rv.params, profile.guards);
        acct.paramsHistory.push({ at: now, params: acct.params, reason: rv.summary });
        acct.closedSinceReview = 0; acct.lastReview = now;
        await notify(`🤖 <b>Ajan [${esc(acct.label)}] gözden geçirme</b>\n${esc(rv.summary)}\nYeni parametreler: risk ${acct.params.riskAppetite}, kaldıraç ${acct.params.preferredLeverage.join('–')}x, marjin ≤ %${acct.params.maxMarginPctPerTrade}${acct.params.avoidDetectors.length ? `, kaçın: ${esc(acct.params.avoidDetectors.join(', '))}` : ''}`);
      } catch (err) { log(`  ajan ${id} gözden geçirme hatası: ${err.message}`); }
    }
    // 4) Koşu sonu
    endOfRun(acct, ctx.prices, now, profile.guards);
    if (ctx.summaryDue) await notify(fmtDaily(acct, statsOf(acct)));
    log(`  ajan ${id}: özsermaye ${r2(acct.equity)} USDT, ${acct.positions.length} pozisyon, ${acct.orders.length} emir, ${acct.trades.length} işlem`);
    if (!cfg.dry) publish(acct, ctx.publishDir);
  }
  if (!cfg.dry) saveAgents(ctx.stateFile, st);
  return st;
}
