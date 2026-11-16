#!/usr/bin/env node
// Sabah piyasa özeti (Telegram): BTC (ETH ile) + altın (ons, dolar); Pazartesi ayrıca haftalık sürüm. Harita, tahmin değil.
// Tamamen kodla üretilir (model / API çağrısı yok). Veri: OKX (BTC/ETH-USDT-SWAP, altın XAU-USDT-SWAP), anahtarsız.
//
//   node bot/brief/run.mjs                      zamanlanmış koşu (MARKET_BRIEF=1, Berlin 06:00–11:59, günde bir kez)
//   node bot/brief/run.mjs --dry --out <klasör> [--weekly] [--now 2026-11-16T05:00:00Z]
//                                               Telegram'a GÖNDERMEZ; metinleri (.txt) ve grafikleri (.png) klasöre yazar
// Ortam: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MARKET_BRIEF=1, FORCE=1 (bayrak / saat / çift gönderim korumasını aş),
//        WEEKLY=1 (haftalık sürümü zorla), BRIEF_STATE=docs/brief/state.json, CHROME_BIN (PNG için başsız Chrome)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCandles, instIdOf, TIMEFRAMES } from '../../src/data/okx.js';
import { renderPng } from '../chart.js';
import { sendTelegramEx, sendTelegramPhotoEx } from '../telegram.js';
import { analyze, weekdaysOnly, DAY } from './core.js';
import { dailyText, weeklyText, evalWatchLine, visibleLen, berlinTitle } from './format.js';
import { planRun, goldOpen } from './schedule.js';
import { briefChartSvg } from './chart.js';

export const STATE_FILE = 'docs/brief/state.json';
const CAPTION_MAX = 1000; // Telegram sınırı 1024; sendTelegramPhotoEx 1000'de keser

const argOf = (args, k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

/** Bir varlığın günlük mumları → analiz girdisi. weekdays: yalnız hafta içi (altın). */
export function prepare(raw, nowMs, { weekdays = false } = {}) {
  const closed = weekdays ? weekdaysOnly(raw.candles) : raw.candles;
  const live = raw.live || null;
  const price = live ? live.close : closed[closed.length - 1].close;
  return { daily: closed, live, price, nowMs };
}

/** Önceki mesajın İzle koşulları → "↩️" satırı girdisi (yoksa null). */
export function prevOf(st, closed, nowMs) {
  if (!st?.watch?.length || !Number.isFinite(st.barTime) || nowMs - st.barTime > 8 * DAY) return null;
  const bars = closed.filter((c) => c.time >= st.barTime);
  return bars.length ? { bars, watch: st.watch } : null;
}

/** Tek varlık için mesaj + grafik paketleri. */
export function buildAsset(key, a, nowMs, { prev = null, eth = null, weekly = false } = {}) {
  const daily = { text: dailyText(key, a, nowMs, { prev: prev ? evalWatchLine(prev, nowMs) : null, eth }), svg: null };
  const name = key === 'XAU' ? 'Altın (ons, $)' : key;
  const candles = a.live ? [...a.closed, a.live] : a.closed;
  daily.svg = briefChartSvg(candles, { levels: a.d.levels, price: a.d.price, title: `${name} · günlük`, subtitle: `${berlinTitle(nowMs)} · OKX ${key}-USDT-SWAP · mesajdaki destek / direnç` });
  const out = { daily };
  if (weekly) {
    const wc = a.wLive ? [...a.wClosed, a.wLive] : a.wClosed;
    out.weekly = {
      text: weeklyText(key, a, nowMs, { eth }),
      svg: briefChartSvg(wc, { levels: a.w.levels, price: a.w.price, title: `${name} · haftalık`, subtitle: `${berlinTitle(nowMs)} · haftalık mumlar · mesajdaki destek / direnç`, weekly: true }),
    };
  }
  return out;
}

async function fetchDaily(coin) {
  return getCandles(instIdOf(coin), TIMEFRAMES['1D'], 800);
}

/** Telegram: grafik + alt yazı (sığmazsa grafik kısa başlıkla, metin ayrı). PNG yoksa yalnız metin. */
async function sendPack(pack, title, creds) {
  const png = pack.svg ? renderPng(pack.svg) : null;
  if (!png) return sendTelegramEx(pack.text, creds);
  if (visibleLen(pack.text) <= CAPTION_MAX && pack.text.length <= 4000) return sendTelegramPhotoEx(png, pack.text, creds);
  const r = await sendTelegramPhotoEx(png, `<b>${title}</b>`, creds);
  const t = await sendTelegramEx(pack.text, creds);
  return { ok: r.ok && t.ok, error: r.error || t.error };
}

export async function main(args = process.argv.slice(2)) {
  const dry = args.includes('--dry'), outDir = argOf(args, '--out');
  const nowMs = argOf(args, '--now') ? Date.parse(argOf(args, '--now')) : Date.now();
  const stateFile = argOf(args, '--state') || process.env.BRIEF_STATE || STATE_FILE;
  if (!process.env.CHROME_BIN && process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) process.env.CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* ilk koşu */ }
  const plan = dry
    ? { daily: true, weekly: args.includes('--weekly'), forced: true, reason: 'kuru koşu' }
    : planRun({ nowMs, state, flag: process.env.MARKET_BRIEF === '1', force: process.env.FORCE === '1', weekly: process.env.WEEKLY === '1' });
  console.log(`brief: ${plan.reason} → günlük ${plan.daily ? 'evet' : 'hayır'}, haftalık ${plan.weekly ? 'evet' : 'hayır'}`);
  if (!plan.daily && !plan.weekly) return { sent: 0, plan };

  const [btcR, ethR, xauR, xauH] = await Promise.all([fetchDaily('BTC'), fetchDaily('ETH'), fetchDaily('XAU'), getCandles(instIdOf('XAU'), TIMEFRAMES['1H'], 3)]);
  const btc = analyze(prepare(btcR, nowMs)), eth = analyze(prepare(ethR, nowMs));
  const gold = goldOpen(nowMs, xauH.live ? xauH.live.time : (xauH.candles.at(-1)?.time ?? NaN) + 3600e3);
  const xau = gold.open || dry ? analyze(prepare(xauR, nowMs, { weekdays: true })) : null;
  if (!gold.open) console.log(`brief: altın atlandı (${gold.reason})${dry ? ' — kuru koşuda yine de yazılır' : ''}`);

  const packs = [];
  const st = state.assets || {};
  packs.push(['BTC', buildAsset('BTC', btc, nowMs, { prev: prevOf(st.BTC, btc.closed, nowMs), eth, weekly: plan.weekly })]);
  if (xau && (gold.open || dry)) packs.push(['XAU', buildAsset('XAU', xau, nowMs, { prev: prevOf(st.XAU, xau.closed, nowMs), weekly: plan.weekly })]);

  const order = [];
  if (plan.daily) for (const [k, p] of packs) order.push([`${k.toLowerCase()}-daily`, p.daily, `${k === 'XAU' ? '🟡 Altın' : '₿ BTC'} — günlük`]);
  if (plan.weekly) for (const [k, p] of packs) if (p.weekly) order.push([`${k.toLowerCase()}-weekly`, p.weekly, `${k === 'XAU' ? '🟡 Altın' : '₿ BTC'} — haftalık`]);

  if (dry) {
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
    for (const [name, pack] of order) {
      console.log(`\n=== ${name} (${visibleLen(pack.text)} karakter)\n${pack.text}`);
      if (!outDir) continue;
      fs.writeFileSync(path.join(outDir, `${name}.txt`), `${pack.text}\n`);
      const png = renderPng(pack.svg);
      if (png) fs.writeFileSync(path.join(outDir, `${name}.png`), png); else fs.writeFileSync(path.join(outDir, `${name}.svg`), pack.svg);
    }
    return { sent: 0, plan, order };
  }

  const creds = { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
  let sent = 0;
  for (const [name, pack, title] of order) {
    const r = await sendPack(pack, title, creds);
    console.log(`brief: ${name} → ${r.ok ? 'gönderildi' : `HATA ${r.error}`}`);
    if (r.ok) sent++;
  }
  // durum: İzle koşulları (ertesi sabahın "↩️" satırı) + çift gönderim koruması (elle tetiklemede tarih yazılmaz)
  if (sent) {
    const assets = { ...st };
    if (plan.daily) for (const [k, a] of [['BTC', btc], ['XAU', xau]]) if (a && packs.some(([pk]) => pk === k)) assets[k] = { date: plan.berlin.date, barTime: a.live ? a.live.time : a.d.last.time + DAY, watch: a.d.watch };
    const next = { ...state, assets };
    if (!plan.forced && plan.daily) next.daily = { lastDate: plan.berlin.date, at: new Date(nowMs).toISOString() };
    if (!plan.forced && plan.weekly) next.weekly = { lastDate: plan.berlin.date, at: new Date(nowMs).toISOString() };
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, `${JSON.stringify(next, null, 1)}\n`);
  }
  return { sent, plan };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
