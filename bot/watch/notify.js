// ⭐ Takip bildirimi (uygulama kapalıyken): kullanıcının ÖZEL depodaki takip belgesi (watch.json, src/sync/cloud.js) okunur,
// açık kayıtlar sayfayla AYNI mantıkla (src/watch/refresh.js → updateWatch / trackPlan) güncellenir, yeni olaylar kişisel
// Telegram sohbetine yazılır ve belge geri yazılır. Saf çekirdek + enjekte edilen ağ (test: tests/watch-notify.test.js).
//
// Çift bildirim engeli: belgenin meta.watchNotify.sent alanında kayıt başına bildirilmiş "kilometre taşları" (confirming,
// active, early, tp1, close) tutulur. Olay = kaydın durumunda olup defterde olmayan taş; kaydı sayfa ilerletmiş olsa da yakalanır.
// Sıra: önce defter yazılır (sha kilidiyle), sonra gönderilir; gönderim kesin başarısızsa defter geri alınır.
// Gizlilik: ana depo (ve Actions logu) herkese açık → log yalnız sayı ve hata sınıfı içerir; coin / seviye / not / depo adı yok.
import { pull, push, validRepo } from '../../src/sync/cloud.js';
import { CLOUD_PATH, WATCH_LABEL, watchEventText } from '../../src/watch/watch.js?v=11';
import { watchGroups, applyWatchCandles } from '../../src/watch/refresh.js?v=1';
import { CLOSED } from '../plan.js';
import { esc } from '../telegram.js';

export const STALE_MS = 12 * 3600e3; // bundan eski taş sessizce işaretlenir (bayrak uzun süre kapalı kaldıysa toplu eski mesaj gitmesin)
const MILESTONES = ['confirming', 'active', 'early', 'tp1', 'close'];
const NEVER_FILLED = new Set(['waiting', 'confirming', 'expired', 'missed', 'knife']);
/** trackPlan olayı → kilometre taşı. */
const EV_KEY = { confirming: 'confirming', active: 'active', early: 'early', tp1: 'tp1', mid: 'tp1' };
const evKey = (ev) => EV_KEY[ev] || 'close';

/** Kaydın ulaştığı taşlar → { anahtar: zaman (ms) }. */
export function milestonesOf(w) {
  const out = {};
  if (w.knifeAt != null) out.confirming = w.knifeAt;
  if (w.activeAt != null && !NEVER_FILLED.has(w.status)) out.active = w.filledAt ?? w.activeAt;
  if (w.earlyAt != null) out.early = w.earlyAt;
  if (w.tp1At != null) out.tp1 = w.tp1At;
  if (CLOSED.has(w.status)) out.close = w.closedAt ?? w.updatedAt ?? 0;
  return out;
}

/** Taşın bildirim metni (sayfanın WATCH_LABEL / watchEventText metinleri). */
export function milestoneText(k, w) {
  if (k === 'confirming') return WATCH_LABEL.confirming;
  if (k === 'active') return WATCH_LABEL.active;
  if (k === 'early') return watchEventText('early', w);
  if (k === 'tp1') return w.early != null ? watchEventText('mid', w) : WATCH_LABEL.tp1;
  return watchEventText(w.status, w);
}

// Bildirime konu alanlar değişmeden yalnız son fiyat değiştiyse kayıt "değişmedi" sayılır (gereksiz yazma olmasın).
const material = (a, b) => JSON.stringify({ ...a, lastPrice: 0, updatedAt: 0 }) !== JSON.stringify({ ...b, lastPrice: 0, updatedAt: 0 });

/**
 * Bir adım (saf): belge + grup mumları (Map key → mum dizisi; eksik grup atlanır) → { doc, notes, changed, counts }.
 * - Botun güncellediği kayıtta updatedAt yalnız 1 ms artar: telefonda sonradan yapılan her düzenleme (not, etiket) birleştirmede
 *   kazanır; durum gerilerse sonraki koşu yeniden ilerletir (defter sayesinde ikinci mesaj gitmez).
 * - İlk koşu (defter yok): mevcut taşlar sessizce deftere yazılır.
 * - Defterde olmayan (yeni) kayıt: yalnız bu koşuda botun kendi gördüğü geçişler bildirilir (eklenmeden önceki geçmiş değil).
 * - Silinen (deleted) kayıt yazılmaz, defterden düşer.
 */
export function stepDoc(doc, candles, now, { run = '', staleMs = STALE_MS } = {}) {
  const del = new Set(doc?.deleted || []);
  const orig = (doc?.items || []).filter((it) => it && it.id && !del.has(it.id));
  const groups = watchGroups(orig, now);
  let list = orig, missing = 0;
  const fresh = new Map();
  for (const g of groups) {
    const cs = candles.get(g.key);
    if (!cs?.length) { missing++; continue; }
    const r = applyWatchCandles(list, g.key, cs, now);
    list = r.list;
    for (const e of r.events) { if (!fresh.has(e.id)) fresh.set(e.id, new Set()); fresh.get(e.id).add(evKey(e.ev)); }
  }
  const byId = new Map(orig.map((w) => [w.id, w]));
  let itemsChanged = false;
  list = list.map((w) => {
    const o = byId.get(w.id);
    if (w === o || !material(o, w)) return o;
    itemsChanged = true;
    return { ...w, updatedAt: (o.updatedAt || 0) + 1 };
  });
  const old = doc?.meta?.watchNotify, first = !old || typeof old.sent !== 'object' || !old.sent;
  const sent = {}, notes = [];
  for (const w of list) {
    const ms = milestonesOf(w), keys = MILESTONES.filter((k) => k in ms);
    const had = first ? null : old.sent[w.id];
    let neu = [];
    if (!first) {
      if (!had) neu = keys.filter((k) => fresh.get(w.id)?.has(k));
      else neu = keys.filter((k) => !had.includes(k) && (fresh.get(w.id)?.has(k) || now - ms[k] <= staleMs));
    }
    sent[w.id] = [...new Set([...(had || []), ...keys])];
    if (neu.length) notes.push({ id: w.id, coin: w.coin, tf: w.tf, direction: w.direction, keys: neu, texts: neu.map((k) => milestoneText(k, w)) });
  }
  const changed = !!doc && (itemsChanged || notes.length > 0 || first);
  const out = { ...doc, items: list, deleted: doc?.deleted || [], meta: { ...(doc?.meta || {}), watchNotify: { v: 1, at: now, run, sent } }, updatedAt: now };
  return { doc: out, notes, changed, first, counts: { items: orig.length, open: orig.filter((w) => !CLOSED.has(w.status)).length, groups: groups.length, missing, events: notes.reduce((s, n) => s + n.keys.length, 0) } };
}

/** Telegram metni (HTML): kayıt başına bir satır; bot sinyallerinden ayırt edilsin diye "⭐ Takip ·" başlığı. */
export function formatNotes(notes) {
  return notes.map((n) => `⭐ <b>Takip</b> · ${esc(n.coin)} ${esc(n.tf)} ${esc(String(n.direction).toUpperCase())} — ${n.texts.map(esc).join(' · ')}`).join('\n');
}

/** Hata sınıfı (loga güvenli: URL, depo adı, içerik yok). */
export function errClass(e) {
  if (e?.conflict) return 'çakışma';
  const m = String(e?.message || '');
  if (/^Token/.test(m)) return 'yetki';
  const s = /GitHub (\d{3})/.exec(m);
  if (s) return `HTTP ${s[1]}`;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'zaman aşımı';
  if (e?.name === 'SyntaxError') return 'belge çözülemedi';
  return 'ağ';
}
// Telegram gönderimi kesin ulaşmadı mı (sunucu hata döndü / bağlantı hiç kurulmadı)? Belirsizse (zaman aşımı) geri alınmaz.
const notDelivered = (r) => r.noCreds || r.status != null || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(r.error || '');

/**
 * Tek koşu. deps: { fetchImpl (GitHub), candles(instId, tf, need) → { candles, live }, send(text) → { ok, status, error },
 * now() , log(satır), run (koşu belirteci) }. → { code, ... } (code: süreç çıkış kodu).
 */
export async function runWatchNotify(env, deps = {}) {
  if (env.WATCH_NOTIFY !== '1') return { code: 0, skipped: true };
  const log = deps.log || console.log, now = deps.now || Date.now, f = deps.fetchImpl || fetch;
  const dry = env.DRY === '1';
  const cfg = { repo: String(env.WATCH_REPO || '').trim(), token: env.WATCH_TOKEN || '' };
  if (!validRepo(cfg.repo) || !cfg.token) { log('takip: hata — WATCH_REPO / WATCH_TOKEN eksik ya da geçersiz'); return { code: 1, error: 'ayar' }; }
  if (!dry && (!deps.send || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)) { log('takip: hata — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID eksik'); return { code: 1, error: 'ayar' }; }
  const run = deps.run || `${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cache = new Map();
  let candleErr = 0;
  const loadCandles = async (groups) => {
    for (const g of groups) {
      if (cache.has(g.key)) continue;
      try { const r = await deps.candles(g.instId, g.tf, g.need); cache.set(g.key, r.live ? [...r.candles, r.live] : r.candles); } catch { cache.set(g.key, null); candleErr++; }
    }
  };
  const line = (c, tail) => `takip: kayıt ${c.items}, açık ${c.open}, grup ${c.groups}, mum alınamayan ${c.missing}, olay ${c.events} — ${tail}`;

  let step = null, wrote = false, conflicts = 0;
  for (let i = 0; i < 4 && !wrote; i++) {
    let doc, sha;
    try { ({ doc, sha } = await pull(cfg, CLOUD_PATH, f)); } catch (e) { log(`takip: hata — belge okunamadı (${errClass(e)})${step ? '; yazılmış olabilir, gönderilmedi' : ''}`); return { code: 1, error: 'okuma' }; }
    if (!doc) { log('takip: belge yok (0 kayıt)'); return { code: 0, notes: [] }; }
    if (step && doc.meta?.watchNotify?.run === run) { wrote = true; break; } // önceki yazma yanıtı kayboldu ama yazılmış
    const t = now();
    const del = new Set(doc.deleted || []);
    await loadCandles(watchGroups((doc.items || []).filter((it) => it && it.id && !del.has(it.id)), t));
    step = stepDoc(doc, new Map([...cache].filter(([, v]) => v)), t, { run });
    if (!step.changed) { log(line(step.counts, 'değişiklik yok, yazılmadı')); return { code: 0, notes: [], counts: step.counts }; }
    if (dry) { log(line(step.counts, 'DRY: yazılmadı, gönderilmedi')); return { code: 0, notes: step.notes, counts: step.counts, dry: true, text: formatNotes(step.notes) }; }
    try { await push(cfg, CLOUD_PATH, step.doc, sha, f); wrote = true; } catch (e) {
      if (e.conflict) { conflicts++; continue; } // telefon araya girdi: yeniden oku, yeniden hesapla
      if (errClass(e) === 'yetki') { log('takip: hata — yazma izni yok (yetki); gönderilmedi'); return { code: 1, error: 'yazma' }; }
      log(`takip: uyarı — yazma hatası (${errClass(e)}), yeniden okunuyor`); // belirsiz: belirteçle kontrol edilir
    }
  }
  if (!wrote) { log(line(step.counts, `yazılamadı (çakışma ${conflicts}); gönderilmedi, sonraki koşuda yeniden denenir`)); return { code: 1, error: 'yazma' }; }
  if (!step.notes.length) { log(line(step.counts, step.first ? 'ilk koşu: defter kuruldu' : 'yazıldı')); return { code: 0, notes: [], counts: step.counts }; }

  const r = await deps.send(formatNotes(step.notes));
  if (r.ok) { log(line(step.counts, 'yazıldı, gönderildi')); return { code: 0, notes: step.notes, counts: step.counts, sent: true }; }
  if (!notDelivered(r)) { log(line(step.counts, `yazıldı; gönderim belirsiz (${r.status ?? 'ağ'}), geri alınmadı`)); return { code: 1, error: 'gönderim', notes: step.notes }; }
  // Gönderilemedi → defterden geri al ki sonraki koşu yeniden denesin (mesajı kaçırmaktansa)
  for (let i = 0; i < 3; i++) {
    try {
      const { doc, sha } = await pull(cfg, CLOUD_PATH, f);
      const wn = doc?.meta?.watchNotify;
      if (!wn?.sent) break;
      const sent = { ...wn.sent };
      for (const n of step.notes) if (sent[n.id]) sent[n.id] = sent[n.id].filter((k) => !n.keys.includes(k));
      await push(cfg, CLOUD_PATH, { ...doc, meta: { ...doc.meta, watchNotify: { ...wn, sent } }, updatedAt: now() }, sha, f);
      log(line(step.counts, `gönderilemedi (${r.status ?? 'ağ'}); defter geri alındı, sonraki koşuda yeniden denenir`));
      return { code: 1, error: 'gönderim', rolledBack: true };
    } catch (e) { if (!e.conflict) break; }
  }
  log(line(step.counts, `gönderilemedi (${r.status ?? 'ağ'}); defter geri alınamadı, bu olaylar kaçmış olabilir`));
  return { code: 1, error: 'gönderim', rolledBack: false };
}
