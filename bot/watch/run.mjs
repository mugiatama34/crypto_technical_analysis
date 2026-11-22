#!/usr/bin/env node
// ⭐ Takip bildirimi koşusu (.github/workflows/watch.yml; dış zamanlayıcı 1–2 dk'da bir workflow_dispatch ile tetikler).
// Ortam: WATCH_NOTIFY=1 (değilse hiçbir şey yapmadan 0 ile çıkar), WATCH_REPO (owner/ad, özel depo), WATCH_TOKEN,
//        TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (kişisel sohbet, sabah özetiyle aynı), DRY=1 (yazmaz, göndermez; yalnız sayılar).
// Log herkese açık: yalnız sayılar ve hata sınıfı (bkz. notify.js).
import { runWatchNotify } from './notify.js';
import { getCandles, TIMEFRAMES } from '../../src/data/okx.js';
import { sendTelegramEx } from '../telegram.js';

const env = process.env;
const timed = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(15000) });
const res = await runWatchNotify(env, {
  fetchImpl: timed,
  candles: (instId, tf, need) => getCandles(instId, TIMEFRAMES[tf], need),
  send: (text) => sendTelegramEx(text, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }),
  run: env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}` : undefined,
});
process.exitCode = res.code;
