// Telegram Bot API: HTML biçimli mesaj. Kimlik bilgisi yoksa ya da hata olursa false döner, taramayı durdurmaz.
export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Geçici hata: 429 (Telegram `parameters.retry_after` saniye) ve 500/502/503 (sunucu işlemedi) ile isteğin hiç ulaşmadığı ağ
// hataları (bağlantı reddi / DNS) en fazla RETRY.max kez yeniden denenir. Zaman aşımı, bağlantı kopması ve 504'te mesaj
// gitmiş olabilir → yeniden denenmez (çift mesaj olmasın).
export const RETRY = { max: 2, waitMs: 2000, maxWaitMs: 30000 };
const RETRY_STATUS = new Set([500, 502, 503]);
const NO_DELIVERY = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** İsteği gönderir (attempt() her denemede yeni istek kurar) → { ok, retries, status, error }. */
async function withRetry(attempt, label, { sleep = sleepMs } = {}) {
  let retries = 0;
  for (;;) {
    let wait = null, status = null, error;
    try {
      const res = await attempt();
      if (res.ok) return { ok: true, retries, status: res.status };
      status = res.status;
      const body = await res.text().catch(() => '');
      error = `HTTP ${status}${body ? ` ${body.slice(0, 200)}` : ''}`;
      if (status === 429) { let ra = null; try { ra = JSON.parse(body)?.parameters?.retry_after; } catch { /* gövde yok */ } wait = Number.isFinite(+ra) && +ra > 0 ? +ra * 1000 + 250 : RETRY.waitMs; }
      else if (RETRY_STATUS.has(status)) wait = RETRY.waitMs;
    } catch (err) {
      const code = err?.cause?.code || err?.code || '';
      error = `${err?.message || err}${code ? ` (${code})` : ''}`;
      if (NO_DELIVERY.has(code)) wait = RETRY.waitMs;
    }
    if (wait == null || wait > RETRY.maxWaitMs || retries >= RETRY.max) { console.warn(label, error); return { ok: false, retries, status, error }; }
    retries++;
    console.warn(`${label} ${error} → ${Math.round(wait / 1000)} sn sonra yeniden deneme #${retries}`);
    await sleep(wait);
  }
}

/** Metin mesajı → { ok, retries, status, error } (kimlik yoksa ok: false, error 'kimlik yok'). */
export async function sendTelegramEx(text, { token, chatId, fetchImpl = fetch, sleep } = {}) {
  if (!token || !chatId) return { ok: false, retries: 0, status: null, error: 'kimlik yok', noCreds: true };
  return withRetry(() => fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }), 'Telegram', { sleep });
}
export async function sendTelegram(text, o = {}) { return (await sendTelegramEx(text, o)).ok; }

/** Fotoğraf (PNG Buffer) + kısa HTML açıklama → { ok, retries, status, error }. */
export async function sendTelegramPhotoEx(png, caption, { token, chatId, fetchImpl = fetch, sleep } = {}) {
  if (!token || !chatId || !png) return { ok: false, retries: 0, status: null, error: 'kimlik/görsel yok', noCreds: true };
  return withRetry(() => {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) { fd.append('caption', caption.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
    fd.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png');
    return fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd });
  }, 'Telegram foto', { sleep });
}
/** Fotoğraf; kimlik yoksa ya da hata olursa false. */
export async function sendTelegramPhoto(png, caption, o = {}) { return (await sendTelegramPhotoEx(png, caption, o)).ok; }

import { bybitOf, bybitPx } from '../src/data/bybit-symbols.js';
import { breakdownText } from '../src/ui/signals-lib.js';

/** Fiyat biçimi: büyüklüğe göre ondalık. */
export function fp(p) {
  if (!Number.isFinite(p)) return '–';
  const a = Math.abs(p);
  const dgt = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(10, Math.ceil(-Math.log10(a)) + 3);
  return p.toFixed(dgt);
}

/** Girişe göre yüzde uzaklık (+/− işaretsiz, 2 hane). */
export const pctFrom = (entry, p) => (Number.isFinite(entry) && Number.isFinite(p) && entry ? `%${(Math.abs(p - entry) / entry * 100).toFixed(2)}` : '–');
/** Kaldıraç tavanı: likidasyon stopun ≥ 1,5 katı uzakta kalsın → ⌊100 ÷ (stop % × 1,5)⌋, 1–20 arası (modül 03 kuralı; 20x üstü önerilmez). */
export function maxLeverage(entry, stop) {
  const sp = Math.abs(entry - stop) / entry * 100;
  return sp > 0 ? Math.max(1, Math.min(20, Math.floor(100 / (sp * 1.5)))) : null;
}

/** Çarpanlı Bybit sözleşmesi varsa (PEPE → 1000PEPEUSDT) kopyalanabilir fiyat satırı; yoksa ''. */
export function bybitLine(coin, levels, qty) {
  const b = bybitOf(coin); if (b.mult === 1) return '';
  const f = (k, v) => (Array.isArray(v) ? `${k} <code>${bybitPx(coin, v[0])}</code> – <code>${bybitPx(coin, v[1])}</code>` : `${k} <code>${bybitPx(coin, v)}</code>`);
  return `<b>Bybit ${esc(b.sym)}</b> (fiyat ×${b.mult.toLocaleString('tr-TR')}): ${levels.filter(([, v]) => (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v))).map(([k, v]) => f(k, v)).join(' · ')}${qty ? ` · adet ${+(qty / b.mult).toPrecision(6)}` : ''}`;
}

/** Puan dökümü tek satır (HTML kaçışlı); plan.bd yoksa ''. Metin src/ui/signals-lib.js breakdownText ile tek kaynak. */
export function formatBreakdown(plan) { return esc(breakdownText(plan)); }

const CONF_ICON = { 'düşük': '○', 'orta': '◐', 'yüksek': '●' };

/** Yeni setup mesajı. */
export function formatSetup(plan, dec, size) {
  const dir = plan.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
  const head = (dec.trade === 'take' ? '✅ İŞLEM ADAYI' : '⏳ BEKLE') + (dec.source === 'rules' ? ' (kural motoru)' : '');
  const tv = `https://www.tradingview.com/chart/?symbol=OKX:${plan.coin}USDT.P`;
  const sigs = [...new Set(plan.signals.filter((s) => s.direction === plan.direction || s.direction === 'neutral').map((s) => s.name))].slice(0, 8).join(' · ');
  const lines = [
    `<b>${head}</b> — <b>${esc(plan.coin)}</b> ${esc(plan.tf)} ${dir}  ${CONF_ICON[dec.confidence] || ''} güven ${esc(dec.confidence)}`,
    `Puan ${plan.score}${plan.mtf ? ` · MTF ${esc(plan.mtf.tfs.join('+'))}` : ''} · fiyat ${fp(plan.price)}`,
    formatBreakdown(plan),
    '',
    `Giriş: <code>${fp(dec.entry_low)} – ${fp(dec.entry_high)}</code>${plan.inZone ? ' (fiyat bölgede)' : ''}`,
    `Stop: <code>${fp(dec.stop)}</code>  (${pctFrom(dec.entry, dec.stop)})`,
    `TP1: <code>${fp(dec.tp1)}</code> (${pctFrom(dec.entry, dec.tp1)} · ${dec.rr1}R)   TP2: <code>${fp(dec.tp2)}</code> (${pctFrom(dec.entry, dec.tp2)} · ${dec.rr}R)`,
    maxLeverage(dec.entry, dec.stop) ? `Kaldıraç: en fazla <b>${maxLeverage(dec.entry, dec.stop)}x</b> (likidasyon stopun ≥ 1,5 katı uzakta; izole marjin, kaldıraç yalnız teminatı belirler)` : '',
    size ? `Pozisyon (risk ${size.riskUsd} USDT): ${size.qty} ${esc(plan.coin)} ≈ ${size.notional} USDT` : '',
    bybitLine(plan.coin, [['giriş', [dec.entry_low, dec.entry_high]], ['stop', dec.stop], ...(plan.early ? [['erken', plan.early]] : []), ['TP1', dec.tp1], ['TP2', dec.tp2]], size?.qty),
    '',
    `<b>Yapılar:</b> ${esc(sigs)}`,
    dec.evidence?.length ? `<b>Kanıt:</b>\n${dec.evidence.map((e) => `• ${esc(e)}`).join('\n')}` : '',
    '',
    esc(dec.reason),
    `<b>Geçersiz:</b> ${esc(dec.invalidation)}`,
    dec.adjusted?.length ? `<i>Seviyeler kural motoruna göre düzeltildi: ${esc(dec.adjusted.join(', '))}</i>` : '',
    `<a href="${tv}">TradingView</a> · Yatırım tavsiyesi değildir.`,
  ];
  return lines.filter((l) => l !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}

const STATUS_TR = { active: '▶️ Giriş bölgesine geldi', tp1: '🎯 TP1 görüldü — stop girişe çekilebilir', done: '🏁 TP2 görüldü, plan tamamlandı', stopped: '🛑 Stop oldu', expired: '⌛ Süresi doldu (fiyat bölgeye gelmedi)', missed: '💨 Girişsiz gitti (TP1 bölgeye gelmeden görüldü)', confirming: '⚠️ Bölgeye çok hızlı geldi (düşen bıçak) — teyit mumu bekleniyor', knife: '🔪 Düşen bıçak: teyitten önce stop geçildi — plan iptal (işlem yok)', unconfirmed: '⌛ Hızlı dolum teyit edilmedi — plan iptal', time_stop: '⏱️ Zaman stopu: TP1 süresinde görülmedi — kapanıştan kapat', early: '⚡ Erken hedef görüldü — kısmi kapat, stopu girişe çek', mid: '🎯 TP1 görüldü (3 kademe) — ara kısmı kapat', be: '⚪ Kalan kısım stopta kapandı (erken kâr alındı)' };

/** Takip güncellemesi. */
export function formatUpdate(plan, event, price) {
  const dir = plan.direction === 'long' ? 'LONG' : 'SHORT';
  const conf = event === 'active' && plan.entryPlanned ? ` (teyit mumu kapanışı; plan ${fp(plan.entryPlanned)})` : '';
  const tsx = event === 'time_stop' && plan.exitPrice != null ? ` · çıkış ${fp(plan.exitPrice)} (${plan.exitR >= 0 ? '+' : ''}${plan.exitR}R)` : '';
  const spd = event === 'confirming' && plan.approachAtr != null ? ` · yaklaşma ${plan.approachAtr}×ATR, dolum mumu ${plan.fillBarAtr}×ATR` : '';
  const bl = bybitLine(plan.coin, [['giriş', plan.entry], ['stop', plan.stop], ...(plan.early ? [['erken', plan.early]] : [['TP1', plan.tp1]]), ['TP2', plan.tp2]]);
  return `${STATUS_TR[event] || event} — <b>${esc(plan.coin)}</b> ${esc(plan.tf)} ${dir}\nGiriş ${fp(plan.entry)}${conf}${spd}${tsx} · stop ${fp(plan.stop)} · ${plan.early ? `erken ${fp(plan.early)}` : `TP1 ${fp(plan.tp1)}`} · TP2 ${fp(plan.tp2)} · fiyat ${fp(price)}${bl ? `\n${bl}` : ''}`;
}

/**
 * Aynı turda birden çok takip olayı (ör. giriş + erken hedef): tek mesaj. Dolum mumunda sıra 15m mumlarla çözüldüyse
 * (plan.fillRes) bu belirtilir; aksi halde 15 dakikalık kontrol aralığında ikisi de olmuş demektir.
 */
export function formatUpdates(plan, events, price) {
  const dir = plan.direction === 'long' ? 'LONG' : 'SHORT';
  const head = events.map((ev) => STATUS_TR[ev] || ev).join('\n↳ ');
  const how = plan.fillRes ? ' (sıra 15m mumlarla doğrulandı)' : ' (son 15 dakikada sırayla)';
  const bl = bybitLine(plan.coin, [['giriş', plan.entry], ['stop', plan.stop], ...(plan.early ? [['erken', plan.early]] : [['TP1', plan.tp1]]), ['TP2', plan.tp2]]);
  return `${head}${how} — <b>${esc(plan.coin)}</b> ${esc(plan.tf)} ${dir}\nGiriş ${fp(plan.entry)} · stop ${fp(plan.stop)} · ${plan.early ? `erken ${fp(plan.early)}` : `TP1 ${fp(plan.tp1)}`} · TP2 ${fp(plan.tp2)} · fiyat ${fp(price)}${bl ? `\n${bl}` : ''}`;
}

const fR = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2).replace('.', ',')}R`;
/**
 * Günlük özet. stats: son 24 saatte gönderilen + durum sayıları (active, early, tp1, done, be, stopped, timeout, knife,
 * expired, missed). extra.dayR = { n, R } gün içinde kapanan işlemlerin toplam R'si (finalR; düzeltilmiş kayıtlar dahil),
 * extra.health = sağlık satırı (bot/health.js).
 */
export function formatSummary(stats, open, since, extra = {}) {
  const d = new Date(since).toLocaleDateString('tr-TR');
  const n = (k) => stats[k] || 0;
  const closed = [['Tamam', 'done'], ['BE', 'be'], ['Stop', 'stopped'], ['Zaman', 'timeout'], ['Bıçak', 'knife'], ['Süresi dolan', 'expired'], ['Kaçan', 'missed']];
  const lines = [
    `<b>📊 Günlük özet</b> (${d} sonrası)`,
    `Gönderilen ${n('sent')} · Aktif ${n('active')} · Erken alındı ${n('early')} · TP1 ${n('tp1')}`,
    `Kapanan: ${closed.map(([l, k]) => `${l} ${n(k)}`).join(' · ')}`,
  ];
  if (extra.dayR) lines.push(`Gün içinde kapanan ${extra.dayR.n} işlem: toplam ${extra.dayR.n ? fR(extra.dayR.R) : '0R'}`);
  if (open.length) lines.push('', '<b>Açık planlar:</b>', ...open.map((p) => `• ${esc(p.coin)} ${esc(p.tf)} ${p.direction.toUpperCase()} — ${p.status === 'waiting' ? 'bekliyor' : p.status === 'confirming' ? 'teyit bekliyor' : p.status === 'early' ? 'erken kâr alındı, kalan açık' : p.status === 'tp1' ? 'TP1 sonrası' : 'aktif'} (giriş ${fp(p.entry)}, stop ${fp(p.stop)})`));
  if (extra.health) lines.push('', extra.health);
  return lines.join('\n');
}
