#!/usr/bin/env node
// Düzenli tarama → aday planlar → Claude değerlendirmesi → Telegram. GitHub Actions'ta 15 dakikada bir koşar.
//
// Ortam değişkenleri:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   bildirim (yoksa yalnızca log)
//   ANTHROPIC_API_KEY                       beyin (yoksa Claude atlanır, yalnızca kural motoru planı gönderilir)
//   ACCOUNT_USDT                            isteğe bağlı: pozisyon büyüklüğü hesabı
//   SCAN_TFS=15m,1H,4H  TOP_N=100  MIN_SCORE=70  REQUIRE_MTF=1  MIN_RR=2  RISK_PCT=1  MAX_RISK_PCT=5
//   MAX_EVAL=8 (tur başına Claude'a giden aday)  MAX_ALERTS=3 (tur başına mesaj)  SEND_WAIT=high|medium|none  COOLDOWN_H=6
//   SUMMARY_HOUR_UTC=6  STATE_FILE=bot/state.json  DRY=1 (ağa yazma: Telegram/Claude yok, konsola yaz; durum kaydedilmez)
//   RESET_STATE=1 (koşu başında durum dosyasını sil: takip ve cooldown sıfırlanır)
import fs from 'node:fs';
import path from 'node:path';
import { runScan } from '../src/scan/scanner.js';
import { buildPlan, positionSize, trackPlan, onCooldown, CLOSED, PLAN_DEFAULTS } from './plan.js';
import { askBrain, validateDecision } from './brain.js';
import { sendTelegram, formatSetup, formatUpdate, formatSummary } from './telegram.js';

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
  tfs: env('SCAN_TFS', '15m,1H,4H').split(',').map((s) => s.trim()).filter(Boolean),
  topN: +env('TOP_N', 100),
  minScore: +env('MIN_SCORE', 70),
  requireMtf: env('REQUIRE_MTF', '1') === '1',
  maxEval: +env('MAX_EVAL', 8),
  sendWait: env('SEND_WAIT', 'high'),
  minRR: +env('MIN_RR', 2),
  riskPct: +env('RISK_PCT', 1),
  maxRiskPct: +env('MAX_RISK_PCT', 5),
  maxAlerts: +env('MAX_ALERTS', 3),
  cooldownHours: +env('COOLDOWN_H', 6),
  summaryHour: +env('SUMMARY_HOUR_UTC', 6),
  stateFile: env('STATE_FILE', 'bot/state.json'),
  dry: env('DRY', '') === '1' || process.argv.includes('--dry'),
  account: +env('ACCOUNT_USDT', 0),
  tg: { token: env('TELEGRAM_BOT_TOKEN', ''), chatId: env('TELEGRAM_CHAT_ID', '') },
  apiKey: env('ANTHROPIC_API_KEY', ''),
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState(file) {
  try { return { sent: [], stats: {}, lastSummary: 0, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return { sent: [], stats: {}, lastSummary: 0 }; }
}
function saveState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Kapalı planlardan 7 günden eskileri at
  const cutoff = Date.now() - 7 * 86400e3;
  st.sent = st.sent.filter((p) => !CLOSED.has(p.status) || p.sentAt >= cutoff);
  fs.writeFileSync(file, JSON.stringify(st, null, 1));
}

async function notify(text, state) {
  if (CFG.dry) { console.log('\n----- TELEGRAM (dry) -----\n' + text.replace(/<[^>]+>/g, '') + '\n'); return true; }
  const ok = await sendTelegram(text, CFG.tg);
  if (!ok) log('Telegram gönderilemedi (kimlik yok ya da hata)');
  return ok;
}

async function main() {
  const now = Date.now();
  if (env('RESET_STATE', '') === '1') { try { fs.unlinkSync(CFG.stateFile); } catch { /* yok */ } log('Durum sıfırlandı (RESET_STATE=1)'); }
  const state = loadState(CFG.stateFile);
  log(`Tarama: ${CFG.tfs.join(',')} × ilk ${CFG.topN}; minScore ${CFG.minScore}, MTF ${CFG.requireMtf ? 'zorunlu' : 'serbest'}, minRR ${CFG.minRR}, eval ${CFG.maxEval}, mesaj ${CFG.maxAlerts}, wait=${CFG.sendWait}${CFG.dry ? ' [DRY]' : ''}`);
  const provider = env('FIXTURE', '') === '1' ? (await import('../src/data/fixture.js')).fixtureProvider : undefined; // test: OKX yerine sentetik
  const res = await runScan({ timeframes: CFG.tfs, topN: CFG.topN }, {
    provider,
    onProgress: ({ done, total }) => { if (done % 50 === 0 || done === total) log(`  ${done}/${total}`); },
    onRetry: ({ path: p, attempt, wait }) => log(`  retry ${p} #${attempt} ${wait}ms`),
  });
  const errs = res.rows.filter((r) => r.error && r.error !== 'Yetersiz mum');
  const young = res.rows.filter((r) => r.error === 'Yetersiz mum');
  log(`Tamam: ${res.rows.length} satır, ${errs.length} hata, ${young.length} yetersiz mum (yeni listelenen), ${res.errors.length} detektör hatası`);
  if (errs.length) log('  ilk hata:', errs[0].coin, errs[0].tf, errs[0].error);
  const byKey = new Map(res.rows.map((r) => [`${r.coin}|${r.tf}`, r]));

  // 1) Açık planları güncelle
  for (const p of state.sent) {
    if (CLOSED.has(p.status)) continue;
    const row = byKey.get(`${p.coin}|${p.tf}`);
    if (!row || row.error) continue;
    const candles = row.live ? [...row.candles, row.live] : row.candles;
    const { status, events } = trackPlan(p, candles, now, { expireHours: PLAN_DEFAULTS.expireHours });
    if (events.length) {
      p.status = status; p.updatedAt = now;
      for (const ev of events) { state.stats[ev] = (state.stats[ev] || 0) + 1; await notify(formatUpdate(p, ev, row.price), state); }
      log(`  takip ${p.coin} ${p.tf} → ${events.join(',')}`);
    }
  }

  // 2) Adaylar
  const cands = [];
  for (const r of res.rows) {
    if (r.error) continue;
    const plan = buildPlan(r, { minScore: CFG.minScore, minRR: CFG.minRR, riskPct: CFG.riskPct, cooldownHours: CFG.cooldownHours, maxRiskPct: CFG.maxRiskPct, requireMtf: CFG.requireMtf });
    if (!plan.ok) continue;
    if (onCooldown(plan, state.sent, now, CFG.cooldownHours)) continue;
    cands.push(plan);
  }
  cands.sort((a, b) => (b.mtf ? 1 : 0) - (a.mtf ? 1 : 0) || b.score - a.score);
  log(`Aday: ${cands.length}` + (cands.length ? ' → ' + cands.slice(0, 10).map((p) => `${p.coin} ${p.tf} ${p.direction} ${p.score} r%${p.riskPct}`).join(' | ') : ''));

  // 3) Beyin + gönderim
  let sentNow = 0, evaluated = 0;
  const usedCoins = new Set();
  for (const plan of cands) {
    if (sentNow >= CFG.maxAlerts || evaluated >= CFG.maxEval) break;
    if (usedCoins.has(plan.coin)) continue; // aynı turda aynı coin için tek plan
    usedCoins.add(plan.coin); evaluated++;
    const htf = CFG.tfs.filter((t) => t !== plan.tf).map((t) => byKey.get(`${plan.coin}|${t}`)).filter((r) => r && !r.error && r.best)
      .map((r) => ({ tf: r.tf, direction: r.direction, score: r.score, top: r.best.signals.slice(0, 5).map((s) => s.name) }));
    const row = byKey.get(`${plan.coin}|${plan.tf}`);
    const others = row.clusters.slice(1, 3).map((c) => ({ direction: c.direction, score: c.score, zone: c.zone, top: c.signals.slice(0, 4).map((s) => s.name) }));
    let dec;
    if (CFG.apiKey && !CFG.dry) {
      try { dec = await askBrain(plan, { minRR: CFG.minRR, riskPct: CFG.riskPct, htf, others }, { apiKey: CFG.apiKey }); }
      catch (err) { log(`  Claude hatası ${plan.coin}: ${err.message}`); continue; }
      log(`  Claude ${plan.coin} ${plan.tf}: ${dec.trade} / ${dec.confidence} (${dec._usage?.input_tokens}+${dec._usage?.output_tokens} tok)`);
    } else {
      dec = { trade: 'take', direction: plan.direction, entry_low: plan.zone[0], entry_high: plan.zone[1], stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, confidence: plan.mtf ? 'orta' : 'düşük', reason: 'Claude değerlendirmesi yok (ANTHROPIC_API_KEY tanımlı değil ya da DRY); seviyeler kural motorundan.', invalidation: `${plan.direction === 'long' ? 'Stop altı' : 'Stop üstü'} kapanış planı iptal eder.`, evidence: [] };
    }
    const v = validateDecision(dec, plan, { minRR: CFG.minRR, sendWait: CFG.sendWait });
    if (!v.sendable) { log(`  ${plan.coin} ${plan.tf}: ${v.trade} (${v.confidence}) — gönderilmedi`); continue; }
    const size = positionSize({ ...plan, entry: v.entry, risk: Math.abs(v.entry - v.stop) }, CFG.account, CFG.riskPct);
    await notify(formatSetup(plan, v, size), state);
    state.sent.push({ key: plan.key, coin: plan.coin, tf: plan.tf, direction: plan.direction, d: plan.d, entry: v.entry, stop: v.stop, tp1: v.tp1, tp2: v.tp2, score: plan.score, trade: v.trade, confidence: v.confidence, sentAt: now, status: plan.inZone ? 'active' : 'waiting' });
    state.stats.sent = (state.stats.sent || 0) + 1;
    sentNow++;
  }
  log(`Değerlendirilen: ${evaluated}, gönderilen: ${sentNow}`);

  // 4) Günlük özet
  const h = new Date(now).getUTCHours();
  if (h === CFG.summaryHour && now - (state.lastSummary || 0) > 20 * 3600e3) {
    const since = now - 24 * 3600e3;
    const recent = state.sent.filter((p) => p.sentAt >= since || (p.updatedAt || 0) >= since);
    const stats = { sent: recent.filter((p) => p.sentAt >= since).length, active: 0, tp1: 0, done: 0, stopped: 0, expired: 0, missed: 0 };
    for (const p of recent) if (stats[p.status] != null) stats[p.status]++;
    await notify(formatSummary(stats, state.sent.filter((p) => !CLOSED.has(p.status)), since), state);
    state.lastSummary = now;
  }
  if (CFG.dry) log('DRY: durum kaydedilmedi'); else saveState(CFG.stateFile, state);
}

main().catch((err) => { console.error(err); process.exit(1); });
