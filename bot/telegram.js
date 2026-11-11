// Telegram Bot API: HTML biçimli mesaj. Kimlik bilgisi yoksa ya da hata olursa false döner, taramayı durdurmaz.
export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function sendTelegram(text, { token, chatId, fetchImpl = fetch } = {}) {
  if (!token || !chatId) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) { console.warn('Telegram', res.status, await res.text().catch(() => '')); return false; }
    return true;
  } catch (err) { console.warn('Telegram hata', err.message); return false; }
}

/** Fotoğraf (PNG Buffer) + kısa HTML açıklama. Kimlik yoksa ya da hata olursa false. */
export async function sendTelegramPhoto(png, caption, { token, chatId, fetchImpl = fetch } = {}) {
  if (!token || !chatId || !png) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) { fd.append('caption', caption.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
    fd.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png');
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd });
    if (!res.ok) { console.warn('Telegram foto', res.status, await res.text().catch(() => '')); return false; }
    return true;
  } catch (err) { console.warn('Telegram foto hata', err.message); return false; }
}

import { bybitOf, bybitPx } from '../src/data/bybit-symbols.js';

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

const STATUS_TR = { active: '▶️ Giriş bölgesine geldi', tp1: '🎯 TP1 görüldü — stop girişe çekilebilir', done: '🏁 TP2 görüldü, plan tamamlandı', stopped: '🛑 Stop oldu', expired: '⌛ Süresi doldu (fiyat bölgeye gelmedi)', missed: '💨 Girişsiz gitti (TP1 bölgeye gelmeden görüldü)', confirming: '⚠️ Bölgeye çok hızlı geldi (düşen bıçak) — teyit mumu bekleniyor', knife: '🔪 Düşen bıçak: teyitten önce stop geçildi — plan iptal (işlem yok)', unconfirmed: '⌛ Hızlı dolum teyit edilmedi — plan iptal', time_stop: '⏱️ Zaman stopu: TP1 süresinde görülmedi — kapanıştan kapat', early: '⚡ Erken hedef görüldü — %80 kapat, stopu girişe çek', be: '⚪ Kalan kısım başabaşta kapandı (erken kâr alındı)' };

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

/** Günlük özet. */
export function formatSummary(stats, open, since) {
  const d = new Date(since).toLocaleDateString('tr-TR');
  const lines = [
    `<b>📊 Günlük özet</b> (${d} sonrası)`,
    `Gönderilen: ${stats.sent} · Aktif: ${stats.active} · TP1: ${stats.tp1} · Tamam: ${stats.done} · Stop: ${stats.stopped} · Süresi dolan: ${stats.expired} · Kaçan: ${stats.missed}`,
  ];
  if (open.length) lines.push('', '<b>Açık planlar:</b>', ...open.map((p) => `• ${esc(p.coin)} ${esc(p.tf)} ${p.direction.toUpperCase()} — ${p.status === 'waiting' ? 'bekliyor' : p.status === 'confirming' ? 'teyit bekliyor' : p.status === 'early' ? 'erken kâr alındı, kalan açık' : p.status === 'tp1' ? 'TP1 sonrası' : 'aktif'} (giriş ${fp(p.entry)}, stop ${fp(p.stop)})`));
  return lines.join('\n');
}
