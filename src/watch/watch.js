// ★ Takip listesi (klonnist/ew-setup-scanner fikri): taramadaki kurulum dondurulur (giriş / stop / TP1 / TP2, botun buildPlan'ı)
// ve sonraki mumlarla botun trackPlan'ı ile izlenir: bekliyor → girildi → TP1 → tamam | stop | süre doldu | kaçtı.
// Saf fonksiyonlar + tarayıcı deposu (localStorage; yalnız bu tarayıcı). DOM yok.
import { buildPlan, trackPlan, CLOSED, PLAN_DEFAULTS } from '../../bot/plan.js';

const KEY = 'cta-watch-v1';

export const WATCH_LABEL = {
  waiting: 'Bekliyor', active: 'Girildi', tp1: 'TP1 görüldü', done: 'TP2 — tamam', stopped: 'Stop oldu', be: 'Başa baş',
  expired: 'Süre doldu (girişe gelmedi)', missed: 'Kaçtı (girişsiz TP1)', knife: 'Düşen bıçak', timeout: 'Zaman stopu', confirming: 'Teyit bekleniyor',
};

/** Taramadaki satırdan takip kaydı; plan kurulamazsa { error }. Eşikler gevşek: kullanıcı ne gördüyse onu dondurur. */
export function makeWatch(row, now = Date.now()) {
  const p = buildPlan(row, { minScore: 0, minRR: 0, minRR1: 0, maxDistAtr: 99 });
  if (!p.ok) return { error: p.reason };
  return {
    id: `${p.key}|${now}`, key: p.key, coin: p.coin, instId: p.instId, tf: p.tf, direction: p.direction, d: p.d,
    entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, rr1: p.rr1, rr: p.rr, zone: p.zone, atr: p.atr, score: p.score,
    priceAtAdd: p.price, sentAt: now, addedAt: now, status: p.status, activeAt: p.inZone ? now : null,
    signals: p.signals.slice(0, 6).map((s) => s.name), note: '', updatedAt: now, lastPrice: p.price,
  };
}

/** Güncelle: candles (kapanmış + canlı) ile durum; değişen olaylar döner. Kapalı kayıtlar değişmez. */
export function updateWatch(item, candles, now = Date.now()) {
  if (CLOSED.has(item.status) || !candles?.length) return { item, events: [] };
  const r = trackPlan(item, candles, now, { expireHours: PLAN_DEFAULTS.expireHours });
  const next = { ...item, ...r.patch, status: r.status, lastPrice: candles[candles.length - 1].close, updatedAt: now };
  for (const ev of r.events) {
    if (ev === 'active') next.activeAt = r.patch.filledAt ?? now;
    else if (ev === 'tp1') next.tp1At = now;
    else next.closedAt = now;
  }
  return { item: next, events: r.events };
}

/** Anlık / sonuç R'si (TP1'de yarı + başa baş varsayımı, bot ile aynı). Bekleyen ve girişsiz kapananlar null. */
export function watchR(w) {
  const risk = w.d * (w.entry - w.stop);
  if (!(risk > 0)) return null;
  const rr1 = (w.d * (w.tp1 - w.entry)) / risk, rr2 = (w.d * (w.tp2 - w.entry)) / risk;
  if (w.status === 'stopped') return w.tp1At ? 0.5 * rr1 : -1;
  if (w.status === 'done') return 0.5 * rr1 + 0.5 * rr2;
  if (w.status === 'active') return (w.d * (w.lastPrice - w.entry)) / risk;
  if (w.status === 'tp1') return 0.5 * rr1 + (0.5 * (w.d * (w.lastPrice - w.entry))) / risk;
  return null;
}

export const isOpen = (w) => !CLOSED.has(w.status);

export function loadWatch() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
export function saveWatch(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* özel pencere vb. */ }
}

/** İçe aktar: JSON dizi; aynı id'liler atlanır. → birleşik liste. */
export function mergeImport(list, text) {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('Dosya bir takip listesi değil');
  const ids = new Set(list.map((w) => w.id));
  return [...list, ...arr.filter((w) => w && w.id && w.coin && w.tf && Number.isFinite(w.entry) && !ids.has(w.id))];
}
