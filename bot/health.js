// Bot sağlığı: son 24 saat için hafif sayaçlar (durumda, saatlik kovalar) + günlük özet satırı + "⚠️ Sağlık" uyarısı.
// Saf fonksiyonlar (ağ yok); bot/run.mjs çağırır. Eski durumda `health` yoksa sayaçlar sıfırdan başlar.
// Eşikler burada sabit (env bayrağı yok).
import { esc } from './telegram.js';
import { isCreditError } from './agent/manager.js';
import { closedTrades, finalR } from '../src/ui/signals-lib.js';

export const HEALTH = {
  windowH: 24, // sayaç penceresi (saat; saatlik kova, şu anki saat dahil)
  everyMin: 15, // beklenen koşu aralığı (scan.yml cron */15)
  okxErrRate: 0.2, // (b) bir turda OKX hata oranı bunun üstündeyse uyarı
  agentFailStreak: 3, // (a) bir ajan art arda bu kadar karar denemesinde hata verirse uyarı
  runsMinFrac: 0.5, // (c) 24 saatteki koşu sayısı beklenenin bu oranının altındaysa uyarı
  runsWarnFrac: 0.8, // özet satırında "cron atlaması" işareti
  minCoverageH: 6, // (c) için en az bu kadar saatlik sayaç geçmişi (önbellek kaybından hemen sonra yanlış alarm olmasın)
  alertEveryH: 6, // aynı uyarı en fazla bu aralıkla
};
const H = 3600e3;
const hourOf = (t) => Math.floor(t / H) * H;
const windowStart = (now) => hourOf(now) - (HEALTH.windowH - 1) * H;

/** Durumdaki sağlık nesnesi (yoksa kurulur). */
export function healthOf(state, now) {
  const h = (state.health && typeof state.health === 'object') ? state.health : (state.health = {});
  if (!Number.isFinite(h.since)) h.since = now;
  if (!Array.isArray(h.buckets)) h.buckets = [];
  if (!h.agentStreak || typeof h.agentStreak !== 'object') h.agentStreak = {};
  if (!h.alertAt || typeof h.alertAt !== 'object') h.alertAt = {};
  return h;
}
/** Şu anki saatin kovası; pencere dışındaki kovalar atılır. */
function bucket(state, now) {
  const h = healthOf(state, now), t = hourOf(now), w0 = windowStart(now);
  h.buckets = h.buckets.filter((b) => b && b.t >= w0 && b.t <= t);
  let b = h.buckets.find((x) => x.t === t);
  if (!b) { b = { t }; h.buckets.push(b); h.buckets.sort((x, y) => x.t - y.t); }
  return b;
}
const inc = (o, k, n = 1) => { if (n) o[k] = (o[k] || 0) + n; };

export function recordRun(state, now) { inc(bucket(state, now), 'runs'); }
/** Tur OKX sayımı → bu turun hata oranı (istek yoksa 1: hiç veri gelmedi). */
export function recordOkx(state, { req = 0, err = 0, retry = 0 } = {}, now) {
  const b = bucket(state, now); inc(b, 'okxReq', req); inc(b, 'okxErr', err); inc(b, 'okxRetry', retry);
  return req > 0 ? err / req : 1;
}
/** Telegram gönderim sonucu ({ ok, retries }). */
export function recordTelegram(state, r, now) {
  const b = bucket(state, now); inc(b, 'tgRetry', r?.retries || 0); if (!r?.ok) inc(b, 'tgErr');
}
/**
 * Ajan sonucu. kind 'decide': başarı art arda hata sayacını sıfırlar, hata artırır (kredi hatası artırmaz: ayrı uyarısı var).
 * Diğer türler (reflect, review) yalnız 24 saatlik hata sayısına girer.
 */
export function recordAgent(state, id, ok, now, { kind = 'decide', error = '' } = {}) {
  const b = bucket(state, now), h = state.health;
  if (ok) { if (kind === 'decide') { (b.agentOk ||= {}); inc(b.agentOk, id); h.agentStreak[id] = { n: 0 }; } return; }
  (b.agentErr ||= {}); inc(b.agentErr, id);
  if (kind === 'decide' && !isCreditError(error)) { const s = h.agentStreak[id] || { n: 0 }; h.agentStreak[id] = { n: (s.n || 0) + 1, last: String(error || '').slice(0, 160), at: now }; }
}
/** Bilinen diğer hata türleri (modül hatası, eksik yayın vb.): etiket → sayı. */
export function recordError(state, label, now, n = 1) { const b = bucket(state, now); (b.errors ||= {}); inc(b.errors, label, n); }

/** Son 24 saatin toplamı + beklenen koşu (pencere ∩ sayaç geçmişi). */
export function windowSum(state, now) {
  const h = healthOf(state, now), w0 = windowStart(now);
  const s = { runs: 0, okxReq: 0, okxErr: 0, okxRetry: 0, tgErr: 0, tgRetry: 0, agentOk: {}, agentErr: {}, errors: {} };
  for (const b of h.buckets) {
    if (!b || b.t < w0 || b.t > now) continue;
    for (const k of ['runs', 'okxReq', 'okxErr', 'okxRetry', 'tgErr', 'tgRetry']) s[k] += b[k] || 0;
    for (const k of ['agentOk', 'agentErr', 'errors']) for (const [id, n] of Object.entries(b[k] || {})) inc(s[k], id, n);
  }
  const from = Math.max(w0, h.since);
  s.coverageH = Math.max(0, (now - from) / H);
  s.expectedRuns = Math.max(1, Math.round((now - from) / (HEALTH.everyMin * 60e3)) + 1); // bu koşu dahil
  return s;
}

const pct = (x) => `%${(x * 100).toFixed(1).replace('.', ',')}`;
/** Profil kısaltması: etiketin ilk harfi (Temkinli → T). */
const abbr = (profiles, id) => esc(String(profiles?.[id]?.label || id).slice(0, 1).toUpperCase());

/** Günlük özetin son satırı. profiles: { id: { label } } (ajan kapalıysa boş). */
export function healthLine(s, profiles = {}) {
  const ids = Object.keys(profiles);
  const parts = [`${s.runs}/${s.expectedRuns} koşu${s.coverageH >= HEALTH.minCoverageH && s.runs < s.expectedRuns * HEALTH.runsWarnFrac ? ' ⚠️ cron atlaması' : ''}`];
  parts.push(`OKX hata ${s.okxReq ? pct(s.okxErr / s.okxReq) : '–'}`);
  parts.push(`Telegram ${s.tgErr}${s.tgRetry ? ` (${s.tgRetry} yeniden deneme)` : ''}`);
  if (ids.length) parts.push(`ajan karar ${ids.map((id) => `${abbr(profiles, id)}${s.agentOk[id] || 0}`).join('/')} · hata ${ids.map((id) => `${abbr(profiles, id)}${s.agentErr[id] || 0}`).join('/')}`);
  const other = Object.entries(s.errors).filter(([, n]) => n > 0);
  if (other.length) parts.push(`diğer: ${other.map(([k, n]) => `${esc(k)} ${n}`).join(', ')}`);
  return `Sağlık 24s: ${parts.join(' · ')}`;
}

/**
 * Uyarı denetimi (koşu sonunda). (a) ajan art arda hata, (b) bu turun OKX hata oranı, (c) 24 saatte koşu sayısı.
 * Her uyarı türü (ajan başına ayrı) en fazla HEALTH.alertEveryH saatte bir; gönderilecek metin ya da null. alertAt'i günceller.
 */
export function healthAlerts(state, now, { okxRate = 0, okxReq = 0, okxErr = 0, profiles = {} } = {}) {
  const h = healthOf(state, now), lines = [];
  const due = (key) => { if (h.alertAt[key] && now - h.alertAt[key] < HEALTH.alertEveryH * H) return false; h.alertAt[key] = now; return true; };
  for (const [id, s] of Object.entries(h.agentStreak)) {
    if ((s?.n || 0) >= HEALTH.agentFailStreak && due(`agent:${id}`)) lines.push(`• Ajan [${esc(profiles[id]?.label || id)}]: art arda ${s.n} karar denemesi hata verdi${s.last ? ` (son: ${esc(s.last)})` : ''}`);
  }
  if (okxRate > HEALTH.okxErrRate && due('okx')) lines.push(`• OKX: bu turda hata oranı ${pct(okxRate)}${okxReq ? ` (${okxErr}/${okxReq} istek)` : ' (veri gelmedi)'}`);
  const w = windowSum(state, now);
  if (w.coverageH >= HEALTH.minCoverageH && w.runs < w.expectedRuns * HEALTH.runsMinFrac && due('runs')) lines.push(`• Koşu: son ${Math.round(Math.min(HEALTH.windowH, w.coverageH))} saatte ${w.runs}/${w.expectedRuns} (cron atlaması ya da çöken/kaydedilemeyen koşular)`);
  return lines.length ? `⚠️ <b>Sağlık</b>\n${lines.join('\n')}` : null;
}

export const SUMMARY_KEYS = ['active', 'early', 'tp1', 'done', 'be', 'stopped', 'timeout', 'knife', 'expired', 'missed'];
/**
 * Günlük özet sayıları: sent = durumdaki planlar (son 24 saatte gönderilen ya da güncellenen, şu anki durumlarıyla),
 * items = geçmiş (applyRescore uygulanmış) → gün içinde KAPANAN işlemlerin toplam R'si (finalR, tek kaynak signals-lib).
 */
export function dailySummaryOf(sent, items, since) {
  const recent = sent.filter((p) => p.sentAt >= since || (p.updatedAt || 0) >= since);
  const stats = { sent: recent.filter((p) => p.sentAt >= since).length, ...Object.fromEntries(SUMMARY_KEYS.map((k) => [k, 0])) };
  for (const p of recent) if (stats[p.status] != null) stats[p.status]++;
  const closed = closedTrades(items || []).filter((s) => (s.closedAt || s.updatedAt || 0) >= since);
  const R = closed.reduce((a, s) => a + finalR(s), 0);
  return { stats, dayR: { n: closed.length, R: +R.toFixed(3) } };
}
