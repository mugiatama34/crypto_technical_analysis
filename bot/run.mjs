#!/usr/bin/env node
// Düzenli tarama → aday planlar → Claude değerlendirmesi → Telegram. GitHub Actions'ta 15 dakikada bir koşar.
//
// Ortam değişkenleri:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   bildirim (yoksa yalnızca log)
//   ANTHROPIC_API_KEY                       beyin (yoksa Claude atlanır, yalnızca kural motoru planı gönderilir)
//   ACCOUNT_USDT                            isteğe bağlı: pozisyon büyüklüğü hesabı
//   SCAN_TFS=15m,1H,4H  TOP_N=100  MIN_SCORE=70  REQUIRE_MTF=1  MIN_RR=2  RISK_PCT=1  MAX_RISK_PCT=5
//   SEND_CLAUDE=0|1 (sinyal botunda Claude; vars. 0)  MAX_EVAL=8 (tur başına değerlendirilen aday)  MAX_ALERTS=3 (tur başına mesaj)
//   SEND_WAIT=high|medium|none (yalnız SEND_CLAUDE=1)  COOLDOWN_H=6
//   SUMMARY_HOUR_UTC=6  STATE_FILE=bot/state.json  DRY=1 (ağa yazma: Telegram/Claude yok, konsola yaz; durum kaydedilmez)
//   RESET_STATE=1 (koşu başında durum dosyasını sil: takip ve cooldown sıfırlanır)
//   MOMENTUM=1 MOMENTUM_VARIANT=ls|short|long  haftalık momentum kâğıt portföyü (docs/agent/momentum.json)
//   TF_RULES / SHORT_RULE (JSON): TF ve yön kurallarını ezer (README)
//   LIMIT_ONLY=1 (gönderimde bölgedeyse gönderme)  SKIP_WEEKEND=1 (Cmt/Paz UTC yeni sinyal yok)  TF kapatma: TF_RULES={"15m":{"off":true}}
//   HTF_TREND=with|notAgainst: coin'in kendi üst TF eğilimi (15m→1H, 1H→4H, 4H→1D) aynı yön / ters değil
//   EARLY_TP={"pct":1.2,"portion":0.8,"tfs":["4H"]}: erken hedefte %80 kapat, stop girişe (sinyal + ajan)
//   TIME_STOP=8 (ya da JSON {"bars":8,"minMfeR":0.5}): dolumdan N mum içinde TP1 yoksa kapat (sinyal + ajan)
//   KNIFE_GUARD=1 (ya da JSON): bölgeye hızlı gelen limit girişlerde teyit mumu bekle (sinyal takibi + ajan limitleri)
//   AGENT=1  AGENT_MODEL=claude-opus-5-5  AGENT_EVERY_MIN=15  AGENT_MIN_SCORE=60  AGENT_STATE_FILE=bot/agent-state.json
import fs from 'node:fs';
import path from 'node:path';
import { runScan } from '../src/scan/scanner.js';
import { buildPlan, positionSize, trackPlan, onCooldown, CLOSED, PLAN_DEFAULTS, mergeRule, knifeGuardOf, isWeekendUtc, timeStopOf, earlyTpOf, earlyPriceOf } from './plan.js';
import { askBrain, validateDecision } from './brain.js';
import { sendTelegram, formatSetup, formatUpdate, formatSummary } from './telegram.js';
import { runAgents } from './agent/run.js';
import { runMomentum } from './momentum/run.js';
import { featuresOf, modelProb } from '../backtest/features.js';
import { getCandles, instIdOf, TIMEFRAMES } from '../src/data/okx.js';
import { regimeNow, marketRead, regimeFor, horizonTrend, htfOk, UP_TF } from '../src/scan/regime.js';
import { atr as atrOf } from '../src/data/indicators.js';

// Öğrenilen puan modeli (backtest/learn.mjs kabul ettiyse src/scan/learned.json vardır). MODEL_MIN_PROB=0 kapatır,
// >0 eşiği ezer; tanımsızsa modelin kendi eşiği.
const MODEL = (() => { try { return JSON.parse(fs.readFileSync('src/scan/learned.json', 'utf8')); } catch { return null; } })();

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
  tfs: env('SCAN_TFS', '15m,1H,4H').split(',').map((s) => s.trim()).filter(Boolean),
  topN: +env('TOP_N', 100),
  minScore: +env('MIN_SCORE', 70),
  requireMtf: env('REQUIRE_MTF', '1') === '1',
  maxEval: +env('MAX_EVAL', 8),
  sendWait: env('SEND_WAIT', 'high'),
  sendClaude: env('SEND_CLAUDE', '0') === '1', // sinyal botunda Claude değerlendirmesi (örneklemde değer katmadı; vars. kapalı)
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
  agent: env('AGENT', '1') === '1',
  agentModel: env('AGENT_MODEL', 'claude-opus-5-5'),
  agentEveryMin: +env('AGENT_EVERY_MIN', 15),
  agentMinScore: +env('AGENT_MIN_SCORE', 60),
  agentStateFile: env('AGENT_STATE_FILE', 'bot/agent-state.json'),
  momentum: env('MOMENTUM', '0') === '1', // haftalık kesitsel momentum kâğıt portföyü (bot/momentum)
  momentumVariant: env('MOMENTUM_VARIANT', 'ls'), // ls | short | long
  momentumRank: env('MOMENTUM_RANK', 'abs'), // abs | rel (BTC'ye göre fazla getiri)
  limitOnly: env('LIMIT_ONLY', '0') === '1', // gönderimde fiyat zaten bölgedeyse gönderme (yalnız limit giriş)
  skipWeekend: env('SKIP_WEEKEND', '0') === '1', // UTC Cumartesi/Pazar yeni sinyal yok
  knifeGuard: knifeGuardOf(env('KNIFE_GUARD', '0')), // düşen bıçak koruması: 1 ya da JSON {maxApproachAtr,maxFillBarAtr,confirmBars,skip}
  htfTrend: ['with', 'notAgainst'].includes(env('HTF_TREND', '')) ? env('HTF_TREND', '') : null, // coin'in üst TF eğilimi: with | notAgainst
  earlyTp: earlyTpOf(env('EARLY_TP', '')), // erken kâr al: {"pct":1.2,"portion":0.8,"tfs":["4H"]}
  timeStop: timeStopOf(env('TIME_STOP', '')), // zaman stopu: N mum (ya da JSON {bars,minMfeR}) içinde TP1 yoksa kapat
  momentumHedge: env('MOMENTUM_HEDGE', '0') === '1', // alt net maruziyete eşit ters BTC bacağı (piyasa-nötr)
  momentumStateFile: env('MOMENTUM_STATE_FILE', 'bot/momentum-state.json'),
  agentPublishDir: env('AGENT_PUBLISH_DIR', 'docs/agent'),
  historyFile: env('HISTORY_FILE', 'docs/signals/history.json'),
  modelMinProb: env('MODEL_MIN_PROB', '') === '' ? (MODEL?.threshold ?? 0) : +env('MODEL_MIN_PROB', 0),
};
/** Plana model olasılığı ekler; eşik altındaysa false döner. */
function modelGate(plan, row, allRows) {
  if (!MODEL) return true;
  const up = { '15m': '1H', '1H': '4H' }[plan.tf];
  const upRow = up ? allRows.get(`${plan.coin}|${up}`) : null;
  const mtf = !!(upRow && !upRow.error && upRow.direction === plan.direction);
  plan.modelProb = +modelProb(MODEL, featuresOf({ ...plan, time: row.trend?.time }, { ...row.trend, price: row.price, mtf })).toFixed(3);
  return !(CFG.modelMinProb > 0) || plan.modelProb >= CFG.modelMinProb;
}
// Zaman dilimine göre kurallar (TF_RULES ile JSON olarak ezilebilir). 15m sıkı: yüksek puan, MTF, güçlü trend, EMA200
// tarafı, 12 saat cooldown ve tur başına en fazla 1 mesaj.
// Kurallar: genel ← TF ← yön (TF_RULES[tf].long / .short) ← SHORT_RULE (tüm TF'lerde short için, TF'nin short'u ezer).
// Laboratuvar (5 tur): short her ailede negatif, 15m en kötü TF → kapatılmadı, ama girişler sıkı.
// btcRegime 'with': long yalnız BTC günlük kapanışı > günlük EMA50, short yalnız altında.
const TF_RULES_DEFAULT = {
  '15m': { minScore: 80, requireMtf: true, trendAdxMin: 35, trendEma: true, btcRegime: 'with', cooldownHours: 12, maxPerRun: 1 },
  '1H': { minScore: 70, requireMtf: true, trendAdxMin: 25, trendEma: true },
  '4H': { minScore: 65, requireMtf: false },
};
const SHORT_RULE_DEFAULT = { scoreAdd: 10, requireMtf: true, trendAdxMin: 30, trendEma: true, btcRegime: 'with', cooldownHours: 12 };
const TF_RULES = (() => { try { return { ...TF_RULES_DEFAULT, ...JSON.parse(env('TF_RULES', '{}')) }; } catch { return TF_RULES_DEFAULT; } })();
const SHORT_RULE = (() => { try { return { ...SHORT_RULE_DEFAULT, ...JSON.parse(env('SHORT_RULE', '{}')) }; } catch { return SHORT_RULE_DEFAULT; } })();
const ruleFor = (tf, direction) => mergeRule(tf, direction, TF_RULES, SHORT_RULE, { minScore: CFG.minScore, requireMtf: CFG.requireMtf, cooldownHours: CFG.cooldownHours, ...(CFG.limitOnly ? { limitOnly: true } : {}), ...(CFG.skipWeekend ? { skipWeekend: true } : {}), ...(CFG.htfTrend ? { htfTrend: CFG.htfTrend } : {}) });
const fmtRule = (r) => r.off ? 'kapalı (sinyal gönderilmez)' : `puan ≥ ${r.minScore}, MTF ${r.requireMtf ? 'zorunlu' : 'serbest'}${r.trendAdxMin ? `, ADX ≥ ${r.trendAdxMin} yön uyumlu` : ''}${r.trendEma ? ', EMA200 tarafı' : ''}${r.btcRegime === 'with' ? ', BTC rejimiyle aynı yön' : ''}${r.rsBtc === 'with' ? ', BTC\'ye göre göreli güç yönünde' : ''}, cooldown ${r.cooldownHours}s${r.maxPerRun ? `, tur başına ≤ ${r.maxPerRun}` : ''}${r.limitOnly ? ', yalnız limit giriş' : ''}${r.skipWeekend ? ', hafta sonu yok' : ''}${r.htfTrend ? (r.htfTrend === 'with' ? ', üst TF eğilimi aynı yön' : ', üst TF eğilimi ters değil') : ''}`;
// Rejim TF'ye göre: 15m/1H → BTC 4H eğilimi, 4H → günlük (regimeFor); read yoksa günlük rejim
const planOpts = (rule, read, tf) => ({ trendAdxMin: rule.trendAdxMin, trendEma: rule.trendEma, btcRegime: rule.btcRegime, rsBtc: rule.rsBtc, regime: read ? regimeFor(tf, read) : null });

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

// ---- Sinyal geçmişi (sayfa için; append-only, en fazla 3000 kayıt)
function loadHistory(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { items: [] }; } }
function saveHistory(file, h) { fs.mkdirSync(path.dirname(file), { recursive: true }); h.items = h.items.slice(-3000); h.updatedAt = Date.now(); fs.writeFileSync(file, JSON.stringify(h)); }
const histId = (p) => `${p.key}|${p.sentAt}`;
function historyAdd(h, p, extra = {}) { if (!h.items.some((x) => x.id === histId(p))) h.items.push({ id: histId(p), ...p, ...extra }); }
function historyUpdate(h, p) { const x = h.items.find((i) => i.id === histId(p)); if (x) Object.assign(x, { status: p.status, updatedAt: p.updatedAt, activeAt: p.activeAt, tp1At: p.tp1At, closedAt: p.closedAt, entry: p.entry, rr1: p.rr1, rr: p.rr, ...(p.approachAtr != null ? { approachAtr: p.approachAtr, fillBarAtr: p.fillBarAtr } : {}), ...(p.entryPlanned ? { entryPlanned: p.entryPlanned, confirmedAt: p.confirmedAt } : {}), ...(p.exitPrice != null ? { exitPrice: p.exitPrice, exitR: p.exitR } : {}), ...(p.early ? { early: p.early, earlyPortion: p.earlyPortion } : {}), ...(p.btcAtClose ? { btcAtClose: p.btcAtClose } : {}) }); }

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
  const history = loadHistory(CFG.historyFile);
  if (!history.items.length && state.sent.length) for (const p of state.sent) historyAdd(history, p); // ilk koşu: mevcut kayıtları aktar
  log(`Tarama: ${CFG.tfs.join(',')} × ilk ${CFG.topN}; minRR ${CFG.minRR}, eval ${CFG.maxEval}, mesaj ${CFG.maxAlerts}, wait=${CFG.sendWait}${CFG.dry ? ' [DRY]' : ''}`);
  for (const tf of CFG.tfs) log(`  ${tf} long: ${fmtRule(ruleFor(tf, 'long'))}\n  ${tf} short: ${fmtRule(ruleFor(tf, 'short'))}`);
  const provider = env('FIXTURE', '') === '1' ? (await import('../src/data/fixture.js')).fixtureProvider : undefined; // test: OKX yerine sentetik
  // BTC günlük mumları (rejim: günlük kapanış vs EMA50); 4H/1H eğilimi tarama sonrası byKey'den okunur (marketRead)
  let btcDaily = null;
  try { btcDaily = provider ? (await provider.candles(instIdOf('BTC'), '1D', 120)).candles : (await getCandles(instIdOf('BTC'), TIMEFRAMES['1D'], 120)).candles; }
  catch (err) { log(`BTC günlük mumları alınamadı: ${err.message}`); }
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
  const btcPrice = (() => { for (const tf of CFG.tfs) { const b = byKey.get(`BTC|${tf}`); if (b && !b.error && b.price) return b.price; } return null; })();
  // Çok ufuklu BTC okuması: günlük (EMA50), 4H ve 1H eğilimi (EMA50 + eğim + ADX/DI), 4s/24s getiri
  const btcRow = (tf) => { const b = byKey.get(`BTC|${tf}`); return b && !b.error ? b.candles : null; };
  const read = marketRead({ daily: btcDaily, h4: btcRow('4H'), h1: btcRow('1H'), now });
  const regime = read.daily; // günlük rejim (geriye uyumlu alan)
  log(read.summary + ` → 15m/1H rejimi: ${regimeFor('1H', read) || 'yok (yatay)'}, 4H rejimi: ${regimeFor('4H', read) || 'yok'}`);

  // 1) Açık planları güncelle
  for (const p of state.sent) {
    if (CLOSED.has(p.status)) continue;
    const row = byKey.get(`${p.coin}|${p.tf}`);
    if (!row || row.error) continue;
    const candles = row.live ? [...row.candles, row.live] : row.candles;
    const { status, events, patch } = trackPlan(p, candles, now, { expireHours: PLAN_DEFAULTS.expireHours, knifeGuard: CFG.knifeGuard, timeStop: CFG.timeStop });
    if (events.length) {
      Object.assign(p, patch); p.status = status; p.updatedAt = now;
      for (const ev of events) {
        state.stats[ev] = (state.stats[ev] || 0) + 1;
        if (ev === 'active') p.activeAt = now; else if (ev === 'tp1' || ev === 'early') p.tp1At = now; else if (ev !== 'confirming') p.closedAt = now;
        await notify(formatUpdate(p, ev, row.price), state);
      }
      if (CLOSED.has(p.status) && btcPrice) p.btcAtClose = btcPrice;
      historyUpdate(history, p);
      log(`  takip ${p.coin} ${p.tf} → ${events.join(',')}`);
    }
  }

  // Üst TF eğilimi: 15m→1H ve 1H→4H taramadan (kapanmış mumlar); 4H→1D adaylar için günlük indirilir (tur başına ≤ 10)
  const dailyCache = new Map(); let dailyFetches = 0;
  const htfDirOf = async (r) => {
    const up = UP_TF[r.tf]; if (!up) return null;
    const row = byKey.get(`${r.coin}|${up}`);
    if (row && !row.error) return horizonTrend(row.candles)?.dir ?? null;
    if (up !== '1D') return null;
    if (!dailyCache.has(r.coin)) {
      if (dailyFetches >= 10) return null;
      dailyFetches++;
      try { dailyCache.set(r.coin, (provider ? await provider.candles(instIdOf(r.coin), '1D', 120) : await getCandles(instIdOf(r.coin), TIMEFRAMES['1D'], 120)).candles); } catch { dailyCache.set(r.coin, null); }
    }
    return horizonTrend(dailyCache.get(r.coin))?.dir ?? null;
  };

  // 2) Adaylar
  const cands = [];
  const rejects = {};
  for (const r of res.rows) {
    if (r.error) continue;
    const rule = ruleFor(r.tf, r.direction);
    const reject = (k) => { rejects[k] = (rejects[k] || 0) + 1; };
    if (rule.off) { reject('TF kapalı'); continue; }
    if (rule.skipWeekend && isWeekendUtc(now)) { reject('hafta sonu'); continue; }
    const plan = buildPlan(r, { minScore: rule.minScore, minRR: CFG.minRR, riskPct: CFG.riskPct, cooldownHours: rule.cooldownHours, maxRiskPct: CFG.maxRiskPct, requireMtf: rule.requireMtf, ...planOpts(rule, read, r.tf) });
    if (!plan.ok) { const k = plan.reason.replace(/[\d.,–-]+/g, '#'); rejects[k] = (rejects[k] || 0) + 1; continue; }
    if (rule.limitOnly && plan.inZone) { reject('bölgede (yalnız limit)'); continue; }
    if (rule.htfTrend) { // coin'in kendi üst TF eğilimi (15m→1H, 1H→4H, 4H→1D), kapanmış mumlarla
      const dir = await htfDirOf(r);
      plan.htfTrend = dir;
      if (!htfOk(rule.htfTrend, dir, plan.d)) { reject(dir ? 'üst TF eğilimi ters/yatay' : 'üst TF verisi yok'); continue; }
    }
    if (!modelGate(plan, r, byKey)) { rejects['model olasılığı düşük'] = (rejects['model olasılığı düşük'] || 0) + 1; continue; }
    if (onCooldown(plan, state.sent, now, rule.cooldownHours)) continue;
    plan.rule = rule;
    cands.push(plan);
  }
  if (MODEL) log(`Öğrenilen model aktif (eşik ${CFG.modelMinProb || 'yok'}, kabul ${new Date(MODEL.acceptedAt).toISOString().slice(0, 10)})`);
  log(`Elenme nedenleri: ${Object.entries(rejects).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
  cands.sort((a, b) => (b.mtf ? 1 : 0) - (a.mtf ? 1 : 0) || b.score - a.score);
  log(`Aday: ${cands.length}` + (cands.length ? ' → ' + cands.slice(0, 10).map((p) => `${p.coin} ${p.tf} ${p.direction} ${p.score} r%${p.riskPct}`).join(' | ') : ''));

  // 3) Beyin + gönderim
  let sentNow = 0, evaluated = 0;
  const usedCoins = new Set(), sentPerTf = {};
  for (const plan of cands) {
    if (sentNow >= CFG.maxAlerts || evaluated >= CFG.maxEval) break;
    if (usedCoins.has(plan.coin)) continue; // aynı turda aynı coin için tek plan
    const cap = plan.rule?.maxPerRun;
    if (cap && (sentPerTf[plan.tf] || 0) >= cap) continue;
    usedCoins.add(plan.coin); evaluated++;
    const htf = CFG.tfs.filter((t) => t !== plan.tf).map((t) => byKey.get(`${plan.coin}|${t}`)).filter((r) => r && !r.error && r.best)
      .map((r) => ({ tf: r.tf, direction: r.direction, score: r.score, top: r.best.signals.slice(0, 5).map((s) => s.name) }));
    const row = byKey.get(`${plan.coin}|${plan.tf}`);
    const others = row.clusters.slice(1, 3).map((c) => ({ direction: c.direction, score: c.score, zone: c.zone, top: c.signals.slice(0, 4).map((s) => s.name) }));
    let dec;
    if (CFG.sendClaude && CFG.apiKey && !CFG.dry) {
      try { dec = await askBrain(plan, { minRR: CFG.minRR, riskPct: CFG.riskPct, htf, others }, { apiKey: CFG.apiKey }); }
      catch (err) { log(`  Claude hatası ${plan.coin}: ${err.message}`); continue; }
      dec.source = 'claude';
      log(`  Claude ${plan.coin} ${plan.tf}: ${dec.trade} / ${dec.confidence} (${dec._usage?.input_tokens}+${dec._usage?.output_tokens} tok)`);
    } else {
      // Kural motoru kararı: güven = MTF + trend uyumu; gerekçe = yapılar + trend özeti
      const tr = plan.trend || {};
      const strong = plan.mtf && tr.aligned;
      const htfTxt = htf.length ? ` Üst/alt TF: ${htf.map((h) => `${h.tf} ${h.direction || '–'} ${h.score}`).join(', ')}.` : '';
      dec = { source: 'rules', trade: 'take', direction: plan.direction, entry_low: plan.zone[0], entry_high: plan.zone[1], stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2,
        confidence: strong ? 'orta' : 'düşük',
        reason: `Kural motoru planı: ${plan.signals.slice(0, 4).map((s) => s.name).join(', ')} aynı bölgede${plan.mtf ? `; ${plan.mtf.tfs.join('+')} aynı yön` : ''}${tr.adx != null ? `; ADX ${tr.adx}${tr.aligned ? ' yön uyumlu' : ''}` : ''}${tr.emaSide != null ? `; fiyat EMA200'ün ${tr.emaSide ? 'doğru' : 'ters'} tarafında` : ''}; ${read.summary}${tr.rsBtc != null ? `; BTC'ye göre 20 bar: ${tr.rsBtc > 0 ? '+' : ''}${tr.rsBtc}%${tr.rsSide != null ? (tr.rsSide > 0 ? ' (güçlü)' : ' (zayıf)') : ''}` : ''}.${htfTxt}`,
        invalidation: `${plan.direction === 'long' ? 'Stop altı' : 'Stop üstü'} kapanış planı iptal eder.`, evidence: [] };
    }
    const v = validateDecision(dec, plan, { minRR: CFG.minRR, sendWait: CFG.sendWait });
    if (!v.sendable) { log(`  ${plan.coin} ${plan.tf}: ${v.trade} (${v.confidence}) — gönderilmedi`); continue; }
    const size = positionSize({ ...plan, entry: v.entry, risk: Math.abs(v.entry - v.stop) }, CFG.account, CFG.riskPct);
    const early = earlyPriceOf(plan, v.entry, CFG.earlyTp);
    await notify(formatSetup(plan, v, size) + (early ? `\n⚡ Erken hedef ${early} (+%${CFG.earlyTp.pct}) → %${Math.round(CFG.earlyTp.portion * 100)} kapat, stopu girişe çek; kalan TP2` : ''), state);
    const rec = { key: plan.key, coin: plan.coin, tf: plan.tf, direction: plan.direction, d: plan.d, entry: v.entry, stop: v.stop, tp1: v.tp1, tp2: v.tp2, rr1: v.rr1, rr: v.rr, score: plan.score, mtf: plan.mtf?.tfs || null, trade: v.trade, confidence: v.confidence, atr: plan.atr, zone: [v.entry_low, v.entry_high], ...(early ? { early, earlyPortion: CFG.earlyTp.portion } : {}), htfTrend: plan.htfTrend ?? null, sentAt: now, status: plan.inZone ? 'active' : 'waiting', activeAt: plan.inZone ? now : null };
    state.sent.push(rec);
    historyAdd(history, rec, { zone: [v.entry_low, v.entry_high], signals: plan.signals.slice(0, 10).map((s) => s.name), reason: v.reason, adx: plan.trend?.adx ?? null, modelProb: plan.modelProb ?? null, btcAtSend: btcPrice, rsBtc: plan.trend?.rsBtc ?? null, regime: plan.regime ?? null, btcRead: { daily: read.daily, h4: read.h4, h1: read.h1, ret24h: read.ret24h } });
    state.stats.sent = (state.stats.sent || 0) + 1;
    sentNow++; sentPerTf[plan.tf] = (sentPerTf[plan.tf] || 0) + 1;
  }
  log(`Değerlendirilen: ${evaluated}, gönderilen: ${sentNow}`);

  // 4) Günlük özet
  const h = new Date(now).getUTCHours();
  const summaryDue = h === CFG.summaryHour && now - (state.lastSummary || 0) > 20 * 3600e3;
  // 5) Kâğıt-işlem ajanları (kendi, daha gevşek aday eşiği; MTF zorunlu değil)
  if (CFG.agent) {
    try {
      const agentCands = [];
      for (const r of res.rows) {
        if (r.error) continue;
        const rule = ruleFor(r.tf, r.direction);
        const plan = buildPlan(r, { minScore: Math.min(CFG.agentMinScore, rule.minScore - 10), minRR: 1.5, riskPct: CFG.riskPct, maxRiskPct: CFG.maxRiskPct, requireMtf: false, ...planOpts(rule, read, r.tf) });
        if (!plan.ok) continue;
        plan.htf = CFG.tfs.filter((t) => t !== plan.tf).map((t) => byKey.get(`${plan.coin}|${t}`)).filter((x) => x && !x.error && x.best).map((x) => ({ tf: x.tf, direction: x.direction, score: x.score }));
        agentCands.push(plan);
      }
      agentCands.sort((a, b) => (b.mtf ? 1 : 0) - (a.mtf ? 1 : 0) || b.score - a.score);
      const seenCoin = new Set();
      const uniq = agentCands.filter((p) => !seenCoin.has(p.coin) && seenCoin.add(p.coin)).slice(0, 10);
      // BTC trend adayı: yalnız 4H eğilimi ile günlük rejim AYNI yöndeyken (laboratuvar: BTC 1H/4H trend takibi tek başına
      // kenar vermedi; çelişkili ufuklarda aday sunulmaz). BTC'nin kendisinde pozisyon: stop 2 ATR, hedef yok, izleyen.
      for (const tf of ['4H']) {
        const dir = read.h4;
        const b = byKey.get(`BTC|${tf}`);
        if (!b || b.error || !(dir === 'up' || dir === 'down') || dir !== read.daily || uniq.some((p) => p.coin === 'BTC')) continue;
        const cs = b.candles, a = atrOf(cs.map((c) => c.high), cs.map((c) => c.low), cs.map((c) => c.close), 14).at(-1);
        if (!a || !b.price) continue;
        const d = dir === 'up' ? 1 : -1, stop = +(b.price - d * 2 * a).toPrecision(8);
        uniq.push({ coin: 'BTC', tf, direction: d === 1 ? 'long' : 'short', d, source: 'btc_trend', score: null, mtf: null, price: b.price, atr: +a.toPrecision(6), zone: [b.price, b.price], inZone: true, entry: b.price, stop, tp1: null, tp2: null, rr: null, rr1: null, riskPct: +((2 * a / b.price) * 100).toFixed(2), trend: { rsBtc: null, rsSide: null, adx: tf === '4H' ? read.adx4h : read.adx1h }, signals: [{ name: `BTC ${tf} trend ${d === 1 ? '↑' : '↓'} (EMA50 eğimi + ADX ${tf === '4H' ? read.adx4h : read.adx1h} DI uyumlu)`, group: 'trend', direction: d === 1 ? 'long' : 'short', strength: 1 }], htf: [] });
        break; // tek BTC adayı: 4H öncelikli
      }
      const prices = {};
      for (const r of res.rows) if (!r.error && r.price) prices[r.coin] = r.price;
      const trackTf = CFG.tfs.includes('15m') ? '15m' : CFG.tfs[0];
      await runAgents({ rows: res.rows, trackTf, candidates: uniq, prices, now, market: { regime, btcPrice, read }, cfg: { dry: CFG.dry, agentEveryMin: CFG.agentEveryMin, knifeGuard: CFG.knifeGuard, timeStop: CFG.timeStop, earlyTp: CFG.earlyTp }, notify: (t) => notify(t, state), log, llm: { apiKey: CFG.apiKey, model: CFG.agentModel }, stateFile: CFG.agentStateFile, publishDir: CFG.agentPublishDir, summaryDue });
    } catch (err) { log(`Ajan hatası: ${err.message}`); console.error(err); }
  }
  // 6) Momentum kâğıt portföyü (haftalık yeniden dengeleme; her turda stop/fonlama)
  if (CFG.momentum) {
    try { await runMomentum({ now, cfg: { dry: CFG.dry, variant: CFG.momentumVariant, rank: CFG.momentumRank, hedge: CFG.momentumHedge }, notify: (t) => notify(t, state), log, stateFile: CFG.momentumStateFile, publishDir: CFG.agentPublishDir, provider, summaryDue }); }
    catch (err) { log(`Momentum hatası: ${err.message}`); console.error(err); }
  }
  if (summaryDue) {
    const since = now - 24 * 3600e3;
    const recent = state.sent.filter((p) => p.sentAt >= since || (p.updatedAt || 0) >= since);
    const stats = { sent: recent.filter((p) => p.sentAt >= since).length, active: 0, tp1: 0, done: 0, stopped: 0, expired: 0, missed: 0 };
    for (const p of recent) if (stats[p.status] != null) stats[p.status]++;
    await notify(formatSummary(stats, state.sent.filter((p) => !CLOSED.has(p.status)), since), state);
    state.lastSummary = now;
  }
  if (CFG.dry) log('DRY: durum kaydedilmedi'); else { saveState(CFG.stateFile, state); saveHistory(CFG.historyFile, history); }
}

main().catch((err) => { console.error(err); process.exit(1); });
