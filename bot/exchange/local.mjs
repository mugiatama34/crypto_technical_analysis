// Bybit DEMO köprüsünün yerel başlatıcısı. GitHub Actions'ın sunucuları (ABD) Bybit'e erişemediği için (HTTP 403, 17.11.2026 denemesi)
// demo adımı Actions'ta değil, Bybit'e erişebilen bir makinede (kullanıcının Mac'i ya da Avrupa'da bir sunucu) çalışır.
// Planları depodaki docs/signals/history.json'dan okur (bot her turda yazar), kaydı docs/signals/demo.json'a yazar.
//   node bot/exchange/local.mjs            → bir tur (emir gönderir; yalnız api-demo.bybit.com)
//   node bot/exchange/local.mjs --check    → yalnız bağlantı ve anahtar denemesi (emir yok, kayıt yok)
// Anahtarlar ortamdan ya da BYBIT_DEMO_ENV dosyasından (varsayılan ~/.config/kripto-demo/env; satırlar ANAHTAR=değer):
//   BYBIT_DEMO_KEY, BYBIT_DEMO_SECRET, BYBIT_DEMO_RISK (USD, varsayılan 10), BYBIT_DEMO_RISK_PCT (ör. 1 = her yeni emirde o anki demo
//   özsermayesinin %1'i; okunamazsa BYBIT_DEMO_RISK'e düşer); isteğe bağlı TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (hata satırı).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBybitDemo } from './bybit.js';
import { runDemo } from './demo.js';

/** ANAHTAR=değer satırlarını okur (# yorum, boş satır, tırnak; ortamda zaten varsa ortam kazanır). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    const k = l.slice(0, i).trim().replace(/^export\s+/, '');
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (/^[A-Z0-9_]+$/.test(k)) out[k] = v;
  }
  return out;
}

/** history.json içeriği → plan listesi (demo köprüsü yalnız kendi alanlarını kullanır; kapanmış planlar da gerekir). */
export function plansOf(history) {
  const items = Array.isArray(history) ? history : history?.items;
  return (items || []).filter((p) => p && p.key && Number.isFinite(p.sentAt) && p.status);
}

/** Yeni emirlerin dolar riski: yüzde tanımlıysa ve özsermaye okunabildiyse özsermaye × % (sente aşağı yuvarlı), yoksa sabit tutar. */
export function riskUsdOf({ riskUsd, riskPct, equity }) {
  if (riskPct > 0 && Number.isFinite(equity) && equity > 0) return Math.max(0.01, Math.floor(equity * riskPct) / 100);
  return riskUsd;
}

export function loadConfig(env = process.env, home = os.homedir()) {
  const file = env.BYBIT_DEMO_ENV || path.join(home, '.config', 'kripto-demo', 'env');
  let fromFile = {};
  try { fromFile = parseEnvFile(fs.readFileSync(file, 'utf8')); } catch { /* dosya yok: yalnız ortam */ }
  const get = (k, d = '') => env[k] || fromFile[k] || d;
  return { file, key: get('BYBIT_DEMO_KEY'), secret: get('BYBIT_DEMO_SECRET'), riskUsd: +get('BYBIT_DEMO_RISK', '10') || 10, riskPct: +get('BYBIT_DEMO_RISK_PCT', '0') || 0, tgToken: get('TELEGRAM_BOT_TOKEN'), tgChat: get('TELEGRAM_CHAT_ID') };
}

async function main() {
  const log = (m) => console.log(`${new Date().toISOString().slice(0, 19)}Z ${m}`);
  const cfg = loadConfig();
  if (!cfg.key || !cfg.secret) { log(`Bybit demo: anahtar yok (${cfg.file}) → atlandı`); process.exitCode = 2; return; }
  const client = createBybitDemo({ key: cfg.key, secret: cfg.secret });
  if (process.argv.includes('--check')) {
    const t = await client.ticker('BTCUSDT');
    log(`genel uç: ${t.ok ? 'tamam' : `HATA ${t.error}`}`);
    const p = await client.positions();
    log(`anahtar: ${p.ok ? `tamam (açık pozisyon ${(p.result?.list || []).filter((x) => +x.size > 0).length})` : `HATA ${p.error}`}`);
    process.exitCode = t.ok && p.ok ? 0 : 1;
    return;
  }
  const histFile = process.env.HISTORY_FILE || 'docs/signals/history.json';
  const plans = plansOf(JSON.parse(fs.readFileSync(histFile, 'utf8')));
  const notify = async (text) => {
    if (!cfg.tgToken || !cfg.tgChat) return;
    const { sendTelegram } = await import('../telegram.js');
    await sendTelegram(text, { token: cfg.tgToken, chatId: cfg.tgChat });
  };
  let equity = null;
  if (cfg.riskPct > 0) {
    const w = await client.wallet();
    equity = w.ok ? +w.result?.list?.[0]?.totalEquity : null;
    if (!(equity > 0)) log(`Bybit demo: özsermaye okunamadı (${w.error || 'boş'}) → sabit risk ${cfg.riskUsd} $`);
  }
  const riskUsd = riskUsdOf({ riskUsd: cfg.riskUsd, riskPct: cfg.riskPct, equity });
  if (cfg.riskPct > 0 && equity > 0) log(`Bybit demo: özsermaye ${equity.toFixed(2)} $ → yeni emir riski ${riskUsd} $ (%${cfg.riskPct})`);
  const { errors } = await runDemo({ client, plans, file: process.env.BYBIT_DEMO_FILE || 'docs/signals/demo.json', now: Date.now(), cfg: { riskUsd }, notify, log });
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
