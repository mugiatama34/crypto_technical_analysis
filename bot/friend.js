// Arkadaşın "Hasanwavebot" (Elliott dalga, 4H) herkese açık kâğıt hesap dosyasındaki yeni SHORT pozisyonları
// Telegram'a ayrı etiketle aktarmak için SAF (ağsız, dosyasız) yardımcılar: durum eşitleme + mesaj biçimi.
// Ağ çağrısı ve kalıcı kayıt bot/run.mjs tarafında yapılır. İlk çalıştırmada açık pozisyonlar yalnız "görüldü"
// sayılır (bildirim yağmaz); BUY pozisyonlar hiç bildirilmez. Bizim sinyal kaydına ve demoya dahil değildir.
import { fp, pctFrom } from './telegram.js';

export const FRIEND_URL = 'https://raw.githubusercontent.com/klonnist/Hasanwavebot/main/data/4h/account_state.json';

const SEEN_TTL_MS = 90 * 24 * 3600 * 1000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'XRP/USDT:USDT' → 'XRP' (biçim uymazsa null). */
export function friendCoin(symbol) {
  if (typeof symbol !== 'string') return null;
  const m = /^([A-Za-z0-9]+)\/[A-Za-z0-9]+(?::[A-Za-z0-9]+)?$/.exec(symbol.trim());
  return m ? m[1].toUpperCase() : null;
}

export const friendId = (pos) => `${friendCoin(pos?.symbol)}|${Date.parse(pos?.open_time)}`;

const emptyState = (now) => ({ version: 1, startedAt: now, seen: {}, items: [] });

export function syncFriend(prev, state, { now = Date.now(), maxAgeH = 6 } = {}) {
  if (!state || typeof state !== 'object' || !state.open_positions || typeof state.open_positions !== 'object' || Array.isArray(state.open_positions)) {
    return { next: prev ?? emptyState(now), opened: [], closed: [] };
  }
  const first = !prev;
  const next = first ? emptyState(now) : { ...prev, seen: { ...(prev.seen || {}) }, items: (prev.items || []).map((i) => ({ ...i })) };
  const opened = [];
  const closed = [];
  const open = state.open_positions;
  const openIds = new Set();

  for (const pos of Object.values(open)) {
    if (!pos || typeof pos !== 'object') continue;
    const coin = friendCoin(pos.symbol);
    const id = friendId(pos);
    openIds.add(id);
    if (next.seen[id] != null) continue;
    next.seen[id] = now;
    if (first || pos.side !== 'SELL') continue;
    const { entry, sl, tp } = pos;
    if (![entry, sl, tp].every(Number.isFinite) || !(sl > entry && entry > tp)) continue;
    const openTime = Date.parse(pos.open_time);
    if (!((now - openTime) <= maxAgeH * 3600 * 1000)) continue;
    const item = {
      id, coin, symbol: pos.symbol, direction: 'short', source: 'hasanwave', tf: '4H',
      entry, stop: sl, tp, openTime, seenAt: now, lastPrice: pos.last_price ?? null, status: 'open',
    };
    next.items.push(item);
    opened.push(item);
  }

  const history = Array.isArray(state.history) ? state.history : [];
  for (const item of next.items) {
    if (item.status !== 'open' || opened.includes(item)) continue;
    if (openIds.has(item.id)) {
      const pos = Object.values(open).find((p) => p && friendId(p) === item.id);
      if (!pos) continue;
      item.lastPrice = pos.last_price ?? item.lastPrice ?? null;
      item.unrealizedR = pos.unrealized_r;
      item.breakeven = pos.breakeven_done;
      item.partialDone = pos.partial_tp_done;
      continue;
    }
    const h = history.find((x) => x && x.symbol === item.symbol && Date.parse(x.open_time) === item.openTime);
    if (h) {
      Object.assign(item, {
        status: 'closed', exit: h.exit, result: h.result, r: h.r_multiple, pnl: h.pnl,
        partial: h.partial_taken, closeTime: Date.parse(h.close_time),
      });
      closed.push(item);
    } else item.status = 'gone';
  }

  for (const [id, t] of Object.entries(next.seen)) if (now - t > SEEN_TTL_MS) delete next.seen[id];
  next.updatedAt = now;
  return { next, opened, closed };
}

const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatFriendOpen(item, { price } = {}) {
  const r = (item.entry - item.tp) / (item.stop - item.entry);
  const cur = price ?? item.lastPrice;
  const now = Number.isFinite(cur) ? `Şu an <code>${fp(cur)}</code> · ` : '';
  return [
    `<b>🌊 ARKADAŞ SİSTEMİ</b> (Elliott dalga 4H) — <b>${esc(item.coin)}</b> 🔴 SHORT`,
    `📍 Giriş  <code>${fp(item.entry)}</code>  (onların giriş fiyatı, piyasa emri)`,
    `🛑 Stop  <code>${fp(item.stop)}</code>  (${pctFrom(item.entry, item.stop)})`,
    `🏁 Hedef  <code>${fp(item.tp)}</code>  (${pctFrom(item.entry, item.tp)} · ${r.toFixed(2)}R)`,
    `${now}açılış ${fmtTime(item.openTime)}`,
    'Kaynak: Hasanwavebot kâğıt hesabı. Bizim sinyal kaydına ve demoya dahil değil. <a href="https://klonnist.github.io/Hasanwavebot/">kayıt</a> · Yatırım tavsiyesi değildir.',
  ].join('\n');
}

export function formatFriendClose(item) {
  const r = Number.isFinite(item.r) ? `${item.r < 0 ? '-' : '+'}${Math.abs(item.r).toFixed(2)}R` : '–';
  return `🌊 Arkadaş sistemi — <b>${esc(item.coin)}</b> SHORT kapandı: ${esc(item.result ?? '–')} · çıkış <code>${fp(item.exit)}</code> · ${r}${item.partial ? ' · kısmi kâr alınmıştı' : ''}`;
}
