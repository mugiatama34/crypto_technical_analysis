// ★ Takip listesi yenileme mantığı (saf, DOM yok): hangi coin / TF için kaç mum gerekir ve gelen mumlarla kayıtların
// güncellenmesi. Sayfa (src/ui/app.js refreshWatch) ve uygulama kapalıyken çalışan takip bildirimi (bot/watch/) AYNI işlevleri
// kullanır ki ikisi ayrışmasın. watch.js sürümü (?v=) app.js'tekiyle aynı tutulmalı (tek modül örneği).
import { updateWatch, isOpen, watchEventText } from './watch.js?v=11';
import { barsFor } from '../scan/scanner.js';
import { TIMEFRAMES } from '../data/okx.js';

export const groupKey = (w) => `${w.instId}|${w.tf}`;

/**
 * Açık kayıtların mum grupları: [{ key, instId, tf, since, need }]. Geçmiş tarihli (elle) kayıtlar için kurulumdan bu yana
 * yetecek kadar mum (en fazla ~1400); en az taramadaki sayı (barsFor).
 */
export function watchGroups(list, now = Date.now()) {
  const open = list.filter(isOpen), out = [];
  for (const key of new Set(open.map(groupKey))) {
    const [instId, tf] = key.split('|');
    if (!TIMEFRAMES[tf]) continue; // bilinmeyen TF (bozuk kayıt) diğerlerini durdurmasın
    const since = Math.min(...open.filter((w) => groupKey(w) === key).map((w) => w.sentAt));
    const need = Math.min(1400, Math.max(barsFor(tf), Math.ceil((now - since) / TIMEFRAMES[tf].ms) + 5));
    out.push({ key, instId, tf, since, need });
  }
  return out;
}

/** Bir grubun mumlarıyla (kapanmış + canlı) o gruptaki açık kayıtları günceller → { list, events: [{ id, ev, item }] }. */
export function applyWatchCandles(list, key, cs, now = Date.now()) {
  const events = [];
  const next = list.map((w) => {
    if (groupKey(w) !== key || !isOpen(w)) return w;
    const { item, events: evs } = updateWatch(w, cs, now);
    for (const ev of evs) events.push({ id: w.id, ev, item });
    return item;
  });
  return { list: next, events };
}

/** Sayfa bildirimindeki satır: "BTC 15m LONG: Girildi". */
export const watchEventLine = (w, ev, item = w) => `${w.coin} ${w.tf} ${String(w.direction).toUpperCase()}: ${watchEventText(ev, item)}`;
