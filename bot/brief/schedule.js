// Gönderim zamanı: her sabah 06:00 Europe/Berlin (yaz / kış saati fark etmez). Actions cron UTC'dir → 04:00 ve 05:00 UTC'de
// tetiklenir; doğru olanı burada seçilir. Cron gecikmesine dayanıklı: Berlin saati 06:00–11:59 arasında ve o Berlin günü
// henüz gönderilmemişse gönderir (durum dosyası `daily.lastDate`). Pazartesi ayrıca haftalık sürüm (`weekly.lastDate`).
import { berlinParts } from './format.js';

export const SEND_FROM_H = 6, SEND_UNTIL_H = 12;

/**
 * → { daily, weekly, reason } . flag: MARKET_BRIEF açık mı; force: bayrak / saat / çift gönderim korumasını aşar (günlük);
 * weekly: haftalık sürümü zorla (bayrak / saat / gün bakmadan).
 */
export function planRun({ nowMs, state = {}, flag = false, force = false, weekly = false }) {
  const b = berlinParts(nowMs), monday = b.weekday === 1;
  if (force || weekly) return { daily: !!force, weekly: !!weekly || (force && monday), forced: true, reason: 'elle tetiklendi', berlin: b };
  if (!flag) return { daily: false, weekly: false, reason: 'MARKET_BRIEF kapalı', berlin: b };
  if (b.hour < SEND_FROM_H) return { daily: false, weekly: false, reason: `Berlin ${b.hour}:${String(b.minute).padStart(2, '0')} — henüz 06:00 değil`, berlin: b };
  if (b.hour >= SEND_UNTIL_H) return { daily: false, weekly: false, reason: `Berlin ${b.hour}:${String(b.minute).padStart(2, '0')} — sabah penceresi geçti`, berlin: b };
  const daily = state.daily?.lastDate !== b.date, wk = monday && state.weekly?.lastDate !== b.date;
  return { daily, weekly: wk, reason: daily || wk ? 'sabah gönderimi' : 'bugün zaten gönderildi', berlin: b };
}

/** Altın gönderilir mi? Spot piyasa hafta sonu (Berlin Cumartesi / Pazar sabahı) ve 25 Aralık / 1 Ocak kapalı; son veri 6 saatten eskiyse bayat. */
export function goldOpen(nowMs, lastDataMs, { maxAgeH = 6 } = {}) {
  const b = berlinParts(nowMs);
  if (b.weekday === 0 || b.weekday === 6) return { open: false, reason: 'hafta sonu (spot altın kapalı)' };
  if ((b.month === 12 && b.day === 25) || (b.month === 1 && b.day === 1)) return { open: false, reason: 'tatil (spot altın kapalı)' };
  if (!Number.isFinite(lastDataMs) || nowMs - lastDataMs > maxAgeH * 3600e3) return { open: false, reason: 'veri bayat' };
  return { open: true };
}
