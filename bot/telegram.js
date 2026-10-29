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

/** Fiyat biçimi: büyüklüğe göre ondalık. */
export function fp(p) {
  if (!Number.isFinite(p)) return '–';
  const a = Math.abs(p);
  const dgt = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(10, Math.ceil(-Math.log10(a)) + 3);
  return p.toFixed(dgt);
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
    `Stop: <code>${fp(dec.stop)}</code>  (risk %${(Math.abs(dec.entry - dec.stop) / dec.entry * 100).toFixed(2)})`,
    `TP1: <code>${fp(dec.tp1)}</code> (${dec.rr1}R)   TP2: <code>${fp(dec.tp2)}</code> (${dec.rr}R)`,
    size ? `Pozisyon (risk ${size.riskUsd} USDT): ${size.qty} ${esc(plan.coin)} ≈ ${size.notional} USDT` : '',
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
  return `${STATUS_TR[event] || event} — <b>${esc(plan.coin)}</b> ${esc(plan.tf)} ${dir}\nGiriş ${fp(plan.entry)}${conf}${spd}${tsx} · stop ${fp(plan.stop)} · ${plan.early ? `erken ${fp(plan.early)}` : `TP1 ${fp(plan.tp1)}`} · TP2 ${fp(plan.tp2)} · fiyat ${fp(price)}`;
}

/**
 * Aynı turda birden çok takip olayı (ör. giriş + erken hedef): tek mesaj. Dolum mumunda sıra 15m mumlarla çözüldüyse
 * (plan.fillRes) bu belirtilir; aksi halde 15 dakikalık kontrol aralığında ikisi de olmuş demektir.
 */
export function formatUpdates(plan, events, price) {
  const dir = plan.direction === 'long' ? 'LONG' : 'SHORT';
  const head = events.map((ev) => STATUS_TR[ev] || ev).join('\n↳ ');
  const how = plan.fillRes ? ' (sıra 15m mumlarla doğrulandı)' : ' (son 15 dakikada sırayla)';
  return `${head}${how} — <b>${esc(plan.coin)}</b> ${esc(plan.tf)} ${dir}\nGiriş ${fp(plan.entry)} · stop ${fp(plan.stop)} · ${plan.early ? `erken ${fp(plan.early)}` : `TP1 ${fp(plan.tp1)}`} · TP2 ${fp(plan.tp2)} · fiyat ${fp(price)}`;
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
