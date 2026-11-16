// Sabah piyasa özeti metinleri (Telegram HTML). Sayılar Türkçe (binlik nokta, ondalık virgül); tarih Europe/Berlin.
import { esc } from '../telegram.js';
import { MONTHS, DAYS, DAY, diverges, evalWatch } from './core.js';

/** Fiyat: ≥ 1000 tam sayı (96.400), ≥ 100 bir ondalık, aksi iki ondalık. */
export function fpx(p) {
  if (!Number.isFinite(p)) return '–';
  const d = Math.abs(p) >= 1000 ? 0 : Math.abs(p) >= 100 ? 1 : 2;
  return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
/** Fark / aralık (≥ 10 ise tam sayı): "±44 $", "±1.378 $". */
export const fdelta = (v) => (Math.abs(v) >= 10 ? Math.round(v).toLocaleString('tr-TR') : fpx(v));
/** Yüzde (oran → "−%1,2" / "+%0,4"). */
export function fpct(r, dg = 1) {
  if (!Number.isFinite(r)) return '–';
  const v = Math.abs(r * 100).toLocaleString('tr-TR', { minimumFractionDigits: dg, maximumFractionDigits: dg });
  return `${r < 0 && /[1-9]/.test(v) ? '−' : '+'}%${v}`;
}
/** Bölge gösterimi: tek fiyat "97.800", bölge "95.100–95.300". */
export const fzone = (z) => (z.hi - z.lo > 0 && fpx(z.lo) !== fpx(z.hi) ? `${fpx(z.lo)}–${fpx(z.hi)}` : fpx(z.mid ?? z.lo));
const zoneTxt = (z) => `${fzone(z)} (${z.reasons.join(', ')})`;

/** Berlin yerel tarih parçaları. */
export function berlinParts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: wd };
}
/** "16 Kasım Pazartesi" */
export const berlinTitle = (ms) => { const b = berlinParts(ms); return `${b.day} ${MONTHS[b.month - 1]} ${DAYS[b.weekday]}`; };

// Türkçe bulunma eki (ay adının son ünlüsüne ve sert ünsüzüne göre): "4 Ekim'de", "12 Mart'ta"
const MONTH_LOC = ["'ta", "'ta", "'ta", "'da", "'ta", "'da", "'da", "'ta", "'de", "'de", "'da", "'ta"];
// yıl eki (son rakamın okunuşu; 2020 "yirmi" → 'de')
const YEAR_LOC = ["'de", "'de", "'de", "'te", "'te", "'te", "'da", "'de", "'de", "'da"];
/** "4 Ekim'de" ya da başka yılsa "4 Ekim 2025'te". */
export function dateLoc(t, nowMs) {
  const d = new Date(t), y = d.getUTCFullYear(), sameY = y === new Date(nowMs).getUTCFullYear();
  return sameY ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${MONTH_LOC[d.getUTCMonth()]}` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${y}${YEAR_LOC[y % 10]}`;
}

const DIR_TR = { up: 'YUKARI', down: 'AŞAĞI', flat: 'YATAY' };
/** "5 gündür" / "3 haftadır" */
export const durTxt = (n, unit) => `${n} ${unit === 'hafta' ? 'haftadır' : 'gündür'}`;
const dirTxt = (x, unit) => (x ? `${DIR_TR[x.dir]} (${durTxt(x.streak, unit)})` : 'veri yetersiz');
const dirWord = (x) => (x ? DIR_TR[x.dir] : 'veri yetersiz');

/** Kapanmış son mumun adı: dün ya da gün adı (altında Pazartesi → "Cuma"). */
function prevDayName(t, nowMs) {
  const today = Math.floor(nowMs / DAY) * DAY, ago = Math.round((today - t) / DAY);
  return ago === 1 ? 'dün' : DAYS[new Date(t).getUTCDay()];
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Bu bölge" / aralık satırı. unit: 'gün' | 'hafta'. */
export function zoneLine(z, nowMs, { unit = 'gün', fwdTxt = 'sonraki 7 günde' } = {}) {
  if (!z) return '';
  if (z.kind === 'range') {
    const dur = unit === 'gün' && z.N >= 14 ? durTxt(Math.floor(z.N / 7), 'hafta') : durTxt(z.N, unit);
    return `↔️ Salınım: ${dur} ${fpx(z.lo)}–${fpx(z.hi)} arasında.`;
  }
  if (z.kind === 'zone') {
    if (z.never) return `🕰 Bu bölge: eldeki veride (${dateLoc(z.since, nowMs).replace(/'.*$/, '')} sonrası) bu fiyat hiç görülmedi.`;
    const f = z.fwd == null ? '' : `; ${fwdTxt} ${fpct(z.fwd)} (tek örnek)`;
    return `🕰 Bu bölge: en son ${dateLoc(z.bar.time, nowMs)} buradaydı${f}.`;
  }
  const where = z.pos >= 0.67 ? 'üst üçte birinde' : z.pos <= 0.33 ? 'alt üçte birinde' : 'ortasında';
  return `↔️ Son ${z.n} ${unit}: ${fpx(z.lo)}–${fpx(z.hi)} aralığı; fiyat ${where}.`;
}

/** İzle satırları. closeWord: 'günlük' | 'haftalık'. */
export function watchLines(watch, closeWord = 'günlük') {
  if (!watch.length) return [];
  const one = (w) => `${fpx(w.level)} ${w.side === 'down' ? 'altı' : 'üstü'} ${closeWord} kapanış → ${w.next ? `${fzone(w.next)} açılır` : 'listede sonraki seviye yok'}.`;
  return watch.map((w, i) => (i === 0 ? `👀 İzle: ${one(w)}` : `   ${one(w)}`));
}

/** Önceki mesajın İzle koşullarının sonucu. ev: evalWatch çıktısı; label: 'Dün' | 'Cuma' | 'Son mesajdan beri'. */
export function prevLine(ev, label) {
  if (!ev?.length) return '';
  const parts = ev.map((e) => {
    const cond = `"${fpx(e.level)} ${e.side === 'down' ? 'altı' : 'üstü'}"`;
    if (e.hit) return `${cond} GELDİ (kapanış ${fpx(e.hitClose)})`;
    if (e.touched) return `${cond} gelmedi (fitil ${fpx(e.ext)}, kapanış ${fpx(e.close)})`;
    return `${cond} gelmedi (${e.side === 'down' ? 'dip' : 'tepe'} ${fpx(e.ext)})`;
  });
  return `↩️ ${label}: ${parts.join(' · ')}.`;
}

const ASSET = { BTC: { icon: '₿', name: 'BTC' }, XAU: { icon: '🟡', name: 'Altın (ons)' }, ETH: { icon: 'Ξ', name: 'ETH' } };

/** Varlığın günlük mesajı. a: analyze() çıktısı; extra: { prev: { ev, label }, eth: analyze() çıktısı (BTC'de) } */
export function dailyText(key, a, nowMs, extra = {}) {
  const d = a.d, A = ASSET[key], pd = prevDayName(d.last.time, nowMs);
  const half = d.atr / 2;
  const L = [
    `<b>${A.icon} ${esc(A.name)} — ${berlinTitle(nowMs)}</b>`,
    `${fpx(d.price)} $ · ${pd} ${fpct(d.ret1)} · hafta ${fpct(d.ret7)}`,
    `Yön: günlük ${dirTxt(d.dir, 'gün')}, haftalık ${dirWord(d.dirW)}`,
    `Bugün beklenen oynama: ±${fdelta(half)} $ (ortalama gün aralığı ${fdelta(d.atr)} $, ${fpct(d.atr / d.price).replace('+', '')})`,
    '',
    `🔺 Direnç: ${d.levels.res.length ? d.levels.res.map(zoneTxt).map(esc).join(' · ') : 'yakında yok'}`,
    `🔻 Destek: ${d.levels.sup.length ? d.levels.sup.map(zoneTxt).map(esc).join(' · ') : 'yakında yok'}`,
    '',
    esc(zoneLine(d.zone, nowMs)),
    ...watchLines(d.watch, 'günlük').map(esc),
  ];
  if (extra.prev?.ev) L.push(esc(prevLine(extra.prev.ev, extra.prev.label)));
  if (extra.eth) L.push(...ethLines(a, extra.eth, nowMs, 'd'));
  return L.filter((l, i, arr) => !(l === '' && (arr[i - 1] === '' || i === arr.length - 1))).join('\n').replace(/\n+$/, '');
}

/** ETH satırı: BTC ile aynıysa tek satır, ayrışıyorsa 1 destek + 1 dirençle 3 satır. mode 'd' | 'w'. */
export function ethLines(btc, eth, nowMs, mode = 'd') {
  const b = mode === 'd' ? btc.d : btc.w, e = mode === 'd' ? eth.d : eth.w;
  const rl = mode === 'd' ? prevDayName(e.last.time, nowMs) : 'geçen hafta', unit = mode === 'd' ? 'gün' : 'hafta';
  const bx = { dir: b.dir?.dir, ret1: b.ret1 }, ex = { dir: e.dir?.dir, ret1: e.ret1 };
  if (!diverges(bx, ex)) return [`ETH: BTC ile aynı yönde (${fpx(e.price)} $, ${rl} ${fpct(e.ret1)}).`];
  const why = bx.dir !== ex.dir ? `BTC ${dirWord(b.dir)}` : `getiri farkı ${fpct(e.ret1 - b.ret1)}`;
  const r = e.levels.res[0], s = e.levels.sup[0];
  return [
    `<b>Ξ ETH</b> ${fpx(e.price)} $ · ${rl} ${fpct(e.ret1)} — BTC'den ayrışıyor (${esc(why)})`,
    `Yön: ${mode === 'd' ? 'günlük' : 'haftalık'} ${dirTxt(e.dir, unit)}`,
    `🔺 ${r ? esc(zoneTxt(r)) : 'yakında yok'} · 🔻 ${s ? esc(zoneTxt(s)) : 'yakında yok'}`,
  ];
}

/** Varlığın haftalık mesajı (Pazartesi; günlük mesaja ek). */
export function weeklyText(key, a, nowMs, extra = {}) {
  const w = a.w, A = ASSET[key];
  const L = [
    `<b>${A.icon} ${esc(A.name)} — haftalık · ${berlinTitle(nowMs).replace(/ \S+$/, '')} haftası</b>`,
    `${fpx(w.price)} $ · geçen hafta ${fpct(w.ret1)} · 4 hafta ${fpct(w.ret4)}`,
    `Yön: haftalık ${dirTxt(w.dir, 'hafta')}, günlük ${dirWord(w.dirD)}`,
    w.atr ? `Bu hafta beklenen oynama: ±${fdelta(w.atr / 2)} $ (ortalama hafta aralığı ${fdelta(w.atr)} $, ${fpct(w.atr / w.price).replace('+', '')})` : '',
    '',
    `🔺 Direnç: ${w.levels.res.length ? w.levels.res.map(zoneTxt).map(esc).join(' · ') : 'yakında yok'}`,
    `🔻 Destek: ${w.levels.sup.length ? w.levels.sup.map(zoneTxt).map(esc).join(' · ') : 'yakında yok'}`,
    '',
    esc(zoneLine(w.zone, nowMs, { unit: 'hafta', fwdTxt: 'sonraki 4 haftada' })),
    ...watchLines(w.watch, 'haftalık').map(esc),
  ];
  const rv = reviewLine(w.review);
  if (rv) L.push(esc(rv));
  if (extra.eth) L.push(...ethLines(a, extra.eth, nowMs, 'w'));
  return L.filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i !== arr.length - 1)).join('\n').replace(/\n+$/, '');
}

/** "📋 Geçen hafta: aralık 92.800–97.100, kapanış 96.400. Tutan: … · Kırılan: …" */
export function reviewLine(rv) {
  if (!rv) return '';
  const b = rv.bar, nm = (x) => `${fzone(x.z)} ${x.side === 'res' ? 'direnç' : 'destek'}`;
  const held = rv.items.filter((x) => x.out === 'tuttu').map(nm), broke = rv.items.filter((x) => x.out === 'kırıldı').map(nm);
  const parts = [`📋 Geçen hafta: ${fpx(b.low)}–${fpx(b.high)}, kapanış ${fpx(b.close)}`];
  if (held.length) parts.push(`tutan: ${held.join(', ')}`);
  if (broke.length) parts.push(`kırılan: ${broke.join(', ')}`);
  if (!held.length && !broke.length) parts.push('haftaya çizilen seviyelere uğranmadı');
  return `${parts.join(' · ')}.`;
}

/** Telegram HTML'inden görünen metin uzunluğu (etiketler ve kaçışlar düşülür). */
export const visibleLen = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;|&gt;|&amp;/g, '.').length;
export const prevLabel = (bars, nowMs) => (bars.length === 1 ? cap(prevDayName(bars[0].time, nowMs)) : 'Son mesajdan beri');

/** prevOf() çıktısı → dailyText'in `prev` girdisi { ev, label }. */
export const evalWatchLine = (prev, nowMs) => ({ ev: evalWatch(prev.watch, prev.bars), label: prevLabel(prev.bars, nowMs) });
