// Ajan akışı: her koşuda profil başına → pozisyonları güncelle → (aday/pozisyon varsa) karar → uygula → yansıma →
// gözden geçirme (20 işlem / 7 gün) → bildir → yayınla (docs/agent/<profil>.json).
import fs from 'node:fs';
import path from 'node:path';
import { PROFILES } from './profiles.js';
import { newAccount, updatePositions, openPosition, closeManual, closePartialManual, adjustPosition, endOfRun, markToMarket, statsOf, closeOrphanHedges, openPendingHedges, anchorToLive } from './account.js';
import { TIMEFRAMES } from '../../src/data/okx.js';
import { decide, reflect, review, clampParams, REVIEW_EVERY, REVIEW_FULL } from './manager.js';
import { agentVsSignal, finalR } from '../../src/ui/signals-lib.js';
import { esc, fp, pctFrom } from '../telegram.js';

const r2 = (x) => +Number(x).toFixed(2);

/**
 * Durum dosyası (yoksa ya da profil eksikse): önce yayınlanan docs/agent/<profil>.json'dan geri kurulur (Actions önbelleği
 * kaybında hesap sessizce 300 $'a dönmesin; rejim-Donchian'daki yaklaşım), o da yoksa yeni hesap. info.restored'a
 * { id, lost[] } yazılır (yayında olmayan, geri gelmeyen bilgiler).
 */
export function loadAgents(file, now, publishDir = null, info = {}) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* yeni */ }
  info.restored = [];
  for (const id of Object.keys(PROFILES)) {
    if (st[id]) continue;
    const r = publishDir ? accountFromPublished(readJson(path.join(publishDir, `${id}.json`)), id) : null;
    if (r) { st[id] = r.acct; info.restored.push({ id, lost: r.lost }); } else st[id] = newAccount(PROFILES[id], now);
  }
  return st;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const DERIVED_STATS = ['winRate', 'avgR', 'profitFactor', 'returnPct']; // statsOf'un eklediği türetilmiş alanlar
/**
 * Yayın dosyasından (publish: hesabın tamamı, ama işlemler son 100, günlük son 50, stats = statsOf) hesap → { acct, lost } | null.
 * Pozisyon/emir/eğri/dersler/parametreler/sayaçlar yayında tam; ham istatistikler (stats) tam olduğundan eksik işlem sayısı bilinir.
 */
export function accountFromPublished(pub, id) {
  if (!pub || typeof pub !== 'object' || pub.profile !== id || !Number.isFinite(pub.equity) || !Array.isArray(pub.trades) || !Array.isArray(pub.positions) || !Array.isArray(pub.orders) || !pub.stats) return null;
  const { publishedAt, ...acct } = pub;
  acct.stats = Object.fromEntries(Object.entries(pub.stats).filter(([k]) => !DERIVED_STATS.includes(k)));
  for (const k of ['journal', 'lessons', 'notes', 'curve', 'paramsHistory']) if (!Array.isArray(acct[k])) acct[k] = [];
  const lost = [];
  const tradesLost = (acct.stats.trades || 0) - acct.trades.length;
  if (tradesLost > 0) lost.push(`${tradesLost} eski işlem kaydı (yayında son 100; istatistikler tam)`);
  if (acct.journal.length >= 50) lost.push('günlüğün (journal) son 50 kaydından eskileri');
  return { acct, lost, publishedAt: publishedAt ?? null };
}
export function saveAgents(file, st) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(st)); }

/**
 * AGENT_RESET=<etiket>: etiket hesaptakinden farklıysa sıfırla. Özsermaye/işlemler/pozisyonlar/emirler/eğri başa döner;
 * dersler (lessons), parametreler ve geçmişleri, günlük (journal) korunur — öğrenme sürer. Önceki etiketler `resets`'te.
 */
export function resetAccount(acct, profile, label, now) {
  const fresh = newAccount(profile, now);
  const prev = { label: acct.resetLabel || null, at: now, equity: r2(acct.equity), trades: acct.trades.length, stats: statsOf(acct) };
  const keep = { lessons: acct.lessons || [], params: acct.params || fresh.params, paramsHistory: [...(acct.paramsHistory || []), { at: now, params: acct.params || fresh.params, reason: `sıfırlama (${label}): özsermaye ${profile.startEquity} USDT'ye döndü, dersler korundu` }], journal: acct.journal || [], resets: [...(acct.resets || []), prev] };
  for (const k of Object.keys(acct)) delete acct[k];
  Object.assign(acct, fresh, keep, { resetLabel: label, resetAt: now });
  return prev;
}
export const safeLabel = (l) => String(l).replace(/[^\w.-]/g, '_').replace(/^\.+/, '_').slice(0, 40);
export const needsReset = (acct, label) => !!label && acct.resetLabel !== label;

/** Aynı sinyalde botun planı (history kaydı): durum ve R (kapanmadıysa null). */
export function botPlanOf(trade, items = []) {
  if (!trade.signalKey) return null;
  const s = items.filter((x) => x.key === trade.signalKey && x.sentAt <= (trade.openedAt || trade.closedAt) + 3600e3).sort((a, b) => b.sentAt - a.sentAt)[0];
  if (!s) return null;
  const R = finalR(s);
  return { status: s.status, R: R == null ? null : +R.toFixed(2), entry: s.entry, stop: s.stop, early: s.early ?? null, tp1: s.tp1, tp2: s.tp2, exits: s.early ? `erken %${Math.round((s.earlyPortion ?? 0.8) * 100)}${s.midPortion ? ` · TP1 %${Math.round(s.midPortion * 100)}${s.midStop === 'early' ? ' · stop erkene' : ''}` : ''} → TP2` : 'TP1 yarı → TP2' };
}
/** İlk ara değerlendirmede (10 işlem) kullanıcıya bekleyen 3. adımı hatırlat (ilerleme.md §4). */
export const stepThreeReminder = (reviews = []) => (reviews.length === 1 ? '\n📌 Hatırlatma: 10 işlem doldu — ilerleme planı §4 adım 3 (ajanın ek bilgi isteyebilmesi) değerlendirilecek. Claude oturumunda "devam edelim" yaz.' : '');
/** Ara (her REVIEW_EVERY kapanış) ya da tam (REVIEW_FULL'a ulaşınca) gözden geçirme gerekli mi → 'interim' | 'full' | null. */
export function reviewDue(acct) {
  const since = acct.closedSinceReview || 0;
  if (since < REVIEW_EVERY) return null;
  return (acct.closedSinceFull ?? since) >= REVIEW_FULL ? 'full' : 'interim';
}

/** Sıfırlama öncesi yayın biçiminde tam kopya (tüm işlemler) → <dir>/<profil>.json. */
export function archiveAccount(acct, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${acct.profile}.json`);
  if (fs.existsSync(f)) return false; // aynı etiketle ikinci kez: ilk arşivi koru
  fs.writeFileSync(f, JSON.stringify({ ...acct, stats: statsOf(acct), archivedAt: Date.now() }));
  return true;
}

/** Yayın dosyası (sayfa için): son 100 işlem, eğri, dersler, parametre geçmişi. */
export function publish(acct, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = { ...acct, trades: acct.trades.slice(-100), journal: acct.journal.slice(-50), stats: statsOf(acct), publishedAt: Date.now() };
  fs.writeFileSync(path.join(dir, `${acct.profile}.json`), JSON.stringify(out));
}

const EV_TR = { hedge_open: '⚖️ BTC hedge açıldı', hedge_close: '⚖️ BTC hedge kapandı', filled: '📥 Limit emir doldu', expired: '⌛ Limit emir süresi doldu', confirming: '⚠️ Bölgeye çok hızlı geldi (düşen bıçak) — limit dolmadı, teyit mumu bekleniyor', knife: '🔪 Düşen bıçak: teyitten önce stop geçildi — emir iptal (işlem yok)', knife_expired: '⌛ Hızlı dolum teyit edilmedi — emir iptal', stop: '🛑 Stop', tp1_stop: '🟡 TP1 sonrası stop', tp1: '🎯 TP1 (yarı kapandı)', tp2: '🏁 TP2 (tam kapandı)', liq: '💀 LİKİDASYON', manual: '✂️ Elle kapanış', partial: '✂️ Kısmi kapanış', time: '⏱️ Zaman stopu (TP1 süresinde gelmedi)', early: '⚡ Erken hedef (%80 kapandı, stop girişe)' };

function fmtOpen(acct, pos, order, hedgeLeg = null) {
  const p = pos || order, e0 = pos ? pos.entry : order.price;
  const hedgeTxt = hedgeLeg ? `\n⚖️ BTC hedge: ${hedgeLeg.direction === 'long' ? 'LONG' : 'SHORT'} ${hedgeLeg.leverage}x marjin ${fp(hedgeLeg.margin)} USDT @ ${fp(hedgeLeg.entry)} (ana pozisyonla birlikte kapanır)` : p.hedge ? '\n⚖️ BTC hedge dolumda açılacak' : '';
  return `🤖 <b>Ajan [${esc(acct.label)}]</b> ${pos ? 'pozisyon açtı' : 'limit emir koydu'} — <b>${esc(p.coin)}</b> ${esc(p.tf || '')} ${p.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} ${p.leverage}x\nMarjin ${fp(p.margin)} USDT · ${pos ? `giriş ${fp(pos.entry)}` : `limit ${fp(order.price)}`} · stop ${fp(p.stop)} (${pctFrom(e0, p.stop)}) · ${p.trail && !p.tp1 && !p.tp2 ? `hedef yok, izleyen stop ${p.trail.mult} ATR (≈ ${fp(p.trail.mult * p.trail.atr)}, ${pctFrom(e0, e0 + p.trail.mult * p.trail.atr)}), en fazla ${p.trail.maxBars} mum` : `TP1 ${fp(p.tp1)} (${pctFrom(e0, p.tp1)}) · TP2 ${fp(p.tp2)} (${pctFrom(e0, p.tp2)})`} · lik. ${fp(pos?.liq ?? 0)}${pos?.liq ? ` (${pctFrom(e0, pos.liq)})` : ''}\n${esc(p.rationale)}${p.notes?.length ? `\n<i>Kırpıldı: ${esc(p.notes.join('; '))}</i>` : ''}${hedgeTxt}\nÖzsermaye ${fp(acct.equity)} USDT`;
}
function fmtEvent(acct, ev) {
  const p = ev.pos || ev.order;
  const head = `🤖 <b>Ajan [${esc(acct.label)}]</b> ${EV_TR[ev.type] || ev.type} — <b>${esc(p.coin)}</b> ${p.direction === 'long' ? 'LONG' : 'SHORT'} ${p.leverage}x`;
  if (['filled', 'expired', 'confirming', 'knife', 'knife_expired'].includes(ev.type)) return `${head}${ev.price ? ` @ ${fp(ev.price)}` : ''}${ev.confirmed ? ' (teyit mumu kapanışı)' : ''}`;
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
 * @param ctx { rows (tarama), candidates (plan listesi, htf dahil), prices {coin: fiyat}, now, cfg, notify(text), log, llm {apiKey, model, fetchImpl}, stateFile, publishDir, summaryDue,
 *   health(id, ok, { kind: 'decide'|'reflect'|'review', error }) isteğe bağlı sağlık sayacı }
 */
export async function runAgents(ctx) {
  const { now, cfg, notify, log } = ctx;
  const info = {};
  const st = loadAgents(ctx.stateFile, now, ctx.publishDir, info);
  const health = (id, ok, kind, err) => { try { ctx.health?.(id, ok, { kind, error: err?.message || '' }); } catch { /* sayaç hatası akışı durdurmaz */ } };
  const candlesByCoin = {};
  for (const r of ctx.rows) { if (r.error || r.tf !== ctx.trackTf) continue; candlesByCoin[r.coin] = r.live ? [...r.candles, r.live] : r.candles; }
  // Takip mumu süresi: son mum canlıysa kısmi işlenir, lastTime yalnız kapanmış mumla ilerler (account.updatePositions)
  const barMs = TIMEFRAMES[ctx.trackTf]?.ms || 0;
  const anchor = (x) => x && anchorToLive(x, candlesByCoin[x.coin], now, barMs); // yeni pozisyon/emir: açıldığı canlı mumun kalanı izlenir
  for (const id of Object.keys(PROFILES)) {
    const profile = PROFILES[id], acct = st[id];
    const rest = info.restored.find((r) => r.id === id);
    if (rest) {
      log(`  ajan ${id}: durum dosyası yok → yayından geri kuruldu (özsermaye ${r2(acct.equity)} USDT, ${acct.positions.length} pozisyon, ${acct.orders.length} emir)${rest.lost.length ? `; kayıp: ${rest.lost.join('; ')}` : ''}`);
      await notify(`♻️ <b>Ajan [${esc(acct.label)}] durumu yayından geri kuruldu</b> (önbellek yok)\nÖzsermaye ${fp(acct.equity)} USDT · ${acct.positions.length} pozisyon · ${acct.orders.length} emir · ${acct.trades.length} işlem kaydı${rest.lost.length ? `\nGeri gelmeyen: ${esc(rest.lost.join('; '))}` : ''}`);
    }
    if (needsReset(acct, cfg.reset)) {
      const label = safeLabel(cfg.reset);
      if (!acct.trades.length && !acct.positions.length && !acct.orders.length) { acct.resetLabel = cfg.reset; acct.resetAt = now; } // boş hesap (ör. önbellek kaybı): yalnız etiketle, arşivi ezme
      else {
        if (!cfg.dry) archiveAccount(acct, path.join(ctx.publishDir, 'archive', label));
        const prev = resetAccount(acct, profile, cfg.reset, now);
        log(`  ajan ${id}: sıfırlandı (${label}) — önceki özsermaye ${prev.equity} USDT, ${prev.trades} işlem arşivlendi; ${acct.lessons.length} ders korundu`);
        await notify(`🤖 <b>Ajan [${esc(acct.label)}] sıfırlandı</b> (${esc(label)})\nÖnceki: özsermaye ${fp(prev.equity)} USDT · ${prev.trades} işlem · ort ${prev.stats.avgR}R → arşiv\nYeni başlangıç ${fp(acct.equity)} USDT · ${acct.lessons.length} ders ve parametreler korundu`);
      }
    }
    Object.defineProperty(acct, '_btcPrice', { value: ctx.market?.btcPrice ?? ctx.prices?.BTC ?? null, enumerable: false, configurable: true, writable: true }); // kapanış kayıtları için (yayınlanmaz)
    // 1) Güncelle
    const btcPx = ctx.market?.btcPrice ?? ctx.prices?.BTC ?? null;
    const events = updatePositions(acct, candlesByCoin, now, { barMs, knifeGuard: cfg.knifeGuard, timeStop: cfg.timeStop, earlyTp: cfg.earlyTp });
    for (const h of openPendingHedges(acct, btcPx, now)) { anchor(h); events.push({ type: 'hedge_open', pos: h, price: h.entry }); }
    events.push(...closeOrphanHedges(acct, btcPx, now).map((e) => ({ ...e, type: 'hedge_close' })));
    markToMarket(acct, ctx.prices);
    for (const ev of events) {
      await notify(fmtEvent(acct, ev));
      if (['stop', 'tp1_stop', 'tp2', 'liq', 'manual', 'time'].includes(ev.type)) {
        const trade = acct.trades[acct.trades.length - 1];
        if (trade && !trade.botPlan) { const bp = botPlanOf(trade, ctx.history || []); if (bp) trade.botPlan = bp; }
        if (trade && !trade.reflection && ctx.llm.apiKey && !cfg.dry) {
          try { const r = await reflect(trade, acct, ctx.llm); trade.reflection = r.lesson; acct.journal.push({ at: now, tradeId: trade.id, lesson: r.lesson, tags: r.tags }); } catch (err) { log(`  ajan ${id} yansıma hatası: ${err.message}`); health(id, false, 'reflect', err); }
        }
      }
    }
    // 2) Karar
    const cands = ctx.candidates.filter((p) => !acct.params.avoidTfs?.includes(p.tf) && !acct.positions.some((x) => x.coin === p.coin)).slice(0, 10);
    const dueDecision = (cands.length || acct.positions.length) && (!acct.lastDecision || now - acct.lastDecision >= (cfg.agentEveryMin || 15) * 60e3 - 60e3);
    if (!cands.length && ctx.candidates.length && !acct.positions.length && acct.params.avoidTfs?.length) log(`  ajan ${id}: ${ctx.candidates.length} adayın tümü avoidTfs (${acct.params.avoidTfs.join(',')}) ile elendi → karar çağrılmadı`);
    if (dueDecision && ctx.llm.apiKey && !cfg.dry) {
      try {
        const stats = statsOf(acct);
        const vs = ctx.history ? agentVsSignal(acct.trades, ctx.history, acct.resetAt || 0) : null;
        const dec = await decide(acct, profile, cands, stats, ctx.llm, { ...(ctx.market || {}), exitOn: !!cfg.agentExit, vsSignal: vs ? { sameSignal: vs.taken, skippedSignals: vs.skipped, nonSignal: vs.agentOnly } : null });
        acct.lastDecision = now; acct.lastAssessment = dec.assessment;
        health(id, true, 'decide');
        log(`  ajan ${id}: ${dec.actions.length} eylem (${dec._usage?.input_tokens}+${dec._usage?.output_tokens} tok) — ${dec.assessment.slice(0, 120)}`);
        for (const a of dec.actions) {
          if (a.type === 'hold') continue;
          if (a.type === 'open') {
            const cand = cands.find((p) => p.coin === a.coin) || null;
            const price = ctx.prices[a.coin];
            if (!price) { log(`  ajan ${id}: ${a.coin} fiyat yok, atlandı`); continue; }
            const res = openPosition(acct, { coin: a.coin, tf: cand?.tf || '', direction: a.direction, margin: a.margin_usdt, leverage: a.leverage, order: a.order === 'limit' ? 'limit' : 'market', limit_price: a.limit_price, price, stop: a.stop, tp1: a.tp1, tp2: a.tp2, hedge: !!a.hedge, rationale: a.rationale, signals: cand?.signals.slice(0, 8).map((s) => s.name) || [], source: cand?.source || 'scanner', signalKey: cand?.key ?? null, ...(cfg.agentExit ? { exit: a.exit, atr: cand?.atr ?? null } : {}), btcPrice: btcPx, ...(cand?.source === 'regime_donchian' && cand.atr ? { trail: { atr: cand.atr, mult: 2, maxBars: 100 } } : {}) }, now, profile.guards);
            if (!res.ok) { log(`  ajan ${id}: ${a.coin} açılmadı — ${res.reason}`); acct.notes.push({ at: now, text: `${a.coin} ${a.direction} reddedildi: ${res.reason}` }); continue; }
            anchor(res.position); anchor(res.hedgeLeg); anchor(res.order);
            await notify(fmtOpen(acct, res.position, res.order, res.hedgeLeg));
          } else if (a.type === 'close') {
            const ev = closeManual(acct, a.position_id, ctx.prices[a.coin] || acct.positions.find((p) => p.id === a.position_id)?.lastPrice, now, a.rationale);
            if (ev) await notify(fmtEvent(acct, ev));
            for (const h of closeOrphanHedges(acct, btcPx, now)) await notify(fmtEvent(acct, { ...h, type: 'hedge_close' }));
          } else if (a.type === 'partial' && cfg.agentExit) {
            const ev = closePartialManual(acct, a.position_id, +a.portion, ctx.prices[a.coin] || acct.positions.find((p) => p.id === a.position_id)?.lastPrice, now, a.rationale);
            if (ev) await notify(fmtEvent(acct, { ...ev, type: 'partial' }));
            for (const h of closeOrphanHedges(acct, btcPx, now)) await notify(fmtEvent(acct, { ...h, type: 'hedge_close' }));
          } else if (a.type === 'adjust') {
            const r = adjustPosition(acct, a.position_id, { stop: a.stop || null, tp1: a.tp1 || null, tp2: a.tp2 || null });
            log(`  ajan ${id}: ayar ${a.coin} → ${r.ok ? r.notes.join(', ') : r.reason}`);
          }
        }
      } catch (err) { log(`  ajan ${id} karar hatası: ${err.message}`); health(id, false, 'decide', err); }
    }
    // 3) Gözden geçirme
    // 3) Gözden geçirme: her 10 kapanışta ara (kurallar yalnız çok önemli bulguda değişir), 30'da tam
    const mode = reviewDue(acct);
    if (mode && ctx.llm.apiKey && !cfg.dry) {
      try {
        const stats = statsOf(acct);
        const vs = ctx.history ? agentVsSignal(acct.trades, ctx.history, acct.resetAt || 0) : null;
        for (const t of acct.trades.slice(-30)) if (t.signalKey && (!t.botPlan || t.botPlan.R == null)) { const bp = botPlanOf(t, ctx.history || []); if (bp) t.botPlan = bp; } // bot planı sonradan kapanmış olabilir
        const rv = await review(acct, profile, stats, { ...ctx.llm, vsSignal: vs ? { sameSignal: vs.taken, skippedSignals: vs.skipped, nonSignal: vs.agentOnly } : null }, mode);
        const apply = mode === 'full' || (rv.strong_finding && String(rv.evidence || '').trim().length > 10);
        if (apply) {
          acct.lessons = rv.lessons.slice(0, 10);
          acct.params = clampParams(rv.params, profile.guards);
          acct.paramsHistory.push({ at: now, params: acct.params, reason: `${mode === 'full' ? 'tam' : 'ara (önemli bulgu)'}: ${rv.summary}${rv.evidence ? ` | kanıt: ${rv.evidence}` : ''}` });
        }
        (acct.reviews ||= []).push({ at: now, mode, applied: apply, summary: rv.summary, evidence: rv.evidence || '' });
        const remind = stepThreeReminder(acct.reviews);
        acct.closedSinceReview = 0; acct.lastReview = now;
        acct.closedSinceFull = mode === 'full' ? 0 : (acct.closedSinceFull || 0);
        await notify(`🤖 <b>Ajan [${esc(acct.label)}] ${mode === 'full' ? 'tam gözden geçirme (30 işlem)' : 'ara değerlendirme (10 işlem)'}</b>\n${esc(rv.summary)}${apply ? `\n${mode === 'full' ? 'Kurallar güncellendi' : `⚠️ Önemli bulgu — kurallar beklemeden güncellendi: ${esc(rv.evidence)}`}: risk ${acct.params.riskAppetite}, kaldıraç ${acct.params.preferredLeverage.join('–')}x, marjin ≤ %${acct.params.maxMarginPctPerTrade}${acct.params.avoidDetectors.length ? `, kaçın: ${esc(acct.params.avoidDetectors.join(', '))}` : ''}` : '\nKurallar değişmedi (plan: 30 işlemde tam gözden geçirme).'}${remind}`);
      } catch (err) { log(`  ajan ${id} gözden geçirme hatası: ${err.message}`); health(id, false, 'review', err); }
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
