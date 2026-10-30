// Sinyal kalitesi dönemlere göre (her canlı ayar değişikliğinden sonra ne oldu?) ve haftalık Telegram raporu.
// Dönemler: 30.10.2026 öncesi Variables değişiklikleri repoda kayıtlı olmadığı için sinyal alanlarından çıkarıldı
// (TF dağılımı, rsBtc/regime, knife/confirming durumları, early/htfTrend alanları). 30.10'dan sonra her sinyal `cfg`
// etiketini taşır; yeni dönemler bu etiketin değiştiği andan otomatik başlar.
import { finalR, CLOSED } from './metrics.js';

const NOFILL = new Set(['waiting', 'expired', 'missed', 'confirming', 'knife']);
const H = 36e5, DAY = 24 * H;
export const PERIODS = [
  { from: Date.UTC(2026, 9, 20, 0), label: 'P1 · başlangıç', change: 'Tüm TF (15m/1H/4H), kural motoru varsayılanları' },
  { from: Date.UTC(2026, 9, 21, 6), label: 'P2 · 15m kısıldı', change: '15m eşikleri yükseldi (15m sinyali neredeyse yok), 1H + 4H' },
  { from: Date.UTC(2026, 9, 22, 9), label: 'P3 · BTC rejimi + göreli güç', change: 'Sinyale BTC rejimi ve BTC\'ye göre güç (rsBtc) şartı' },
  { from: Date.UTC(2026, 9, 23, 15), label: 'P4 · bıçak koruması', change: 'KNIFE_GUARD (+ LIMIT_ONLY): hızlı yaklaşımda onay bekleme' },
  { from: Date.UTC(2026, 9, 24, 9), label: 'P5 · yalnız 4H + erken kâr + üst TF', change: 'TF_RULES 15m/1H kapalı, SKIP_WEEKEND, EARLY_TP %1,2/%80, HTF_TREND=with', cfg: '4H · bıçak · limit · hs yok · erken %1.2/80 · üst TF with' },
];

/** Canlı ayarın kısa etiketi (her yeni sinyale `cfg` olarak yazılır). o: { tfs (açık TF'ler), knife, limitOnly, skipWeekend, earlyTp, htfTrend, timeStop } */
export function cfgLabel(o) {
  const e = o.earlyTp;
  return [o.tfs.join('+') || 'TF yok', o.knife ? 'bıçak' : null, o.limitOnly ? 'limit' : null, o.skipWeekend ? 'hs yok' : null,
    e ? `erken %${e.pct}/${Math.round(e.portion * 100)}` : null, o.htfTrend ? `üst TF ${o.htfTrend}` : null, o.timeStop ? `zaman ${o.timeStop.bars}` : null].filter(Boolean).join(' · ');
}

/** Bir sinyal listesinin kalite özeti: sıklık, dolum, kapanan, kazanma, ort./toplam R, TF dağılımı. */
export function qualityOf(list, days) {
  const Rs = list.map(finalR).filter((x) => x != null);
  const filled = list.filter((s) => !NOFILL.has(s.status)).length;
  const tf = {}; for (const s of list) tf[s.tf] = (tf[s.tf] || 0) + 1;
  const sum = Rs.reduce((a, b) => a + b, 0);
  return {
    n: list.length, perDay: days > 0 ? +(list.length / days).toFixed(1) : null, fillRate: list.length ? +(filled / list.length).toFixed(2) : null,
    closed: Rs.length, open: list.filter((s) => !CLOSED.has(s.status)).length,
    winRate: Rs.length ? +(Rs.filter((r) => r > 0).length / Rs.length).toFixed(2) : null,
    avgR: Rs.length ? +(sum / Rs.length).toFixed(3) : null, totalR: +sum.toFixed(2), tf,
  };
}

/** Hafta içi gün sayısı (hafta sonu sinyal yoksa sıklığı adil kıyaslamak için). */
const weekdays = (a, b) => { let n = 0; for (let t = a; t < b; t += DAY) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; } return Math.max(1, n); };

/** Dönem tablosu: önce sabit PERIODS, sonra `cfg` etiketi değiştikçe yeni dönemler. */
export function periodReport(items, now = Date.now()) {
  const sorted = [...items].sort((a, b) => a.sentAt - b.sentAt);
  const bounds = PERIODS.map((p) => ({ ...p }));
  for (const s of sorted) {
    if (!s.cfg) continue;
    const cur = bounds.filter((b) => b.from <= s.sentAt).at(-1);
    if (cur && cur.cfg !== s.cfg) bounds.push({ from: s.sentAt, label: `P${bounds.length + 1} · ${s.cfg}`, change: `Canlı ayar: ${s.cfg}`, cfg: s.cfg });
  }
  return bounds.map((b, i) => {
    const to = bounds[i + 1]?.from ?? now;
    const list = sorted.filter((s) => s.sentAt >= b.from && s.sentAt < to);
    return { label: b.label, change: b.change, from: b.from, to, ...qualityOf(list, weekdays(b.from, to)) };
  }).filter((p) => p.n);
}

const sgn = (x) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
const pct = (x) => (x == null ? '–' : `%${Math.round(x * 100)}`);

/** Haftalık rapor metni (Telegram HTML): geçen hafta gönderilen sinyallerin bugünkü sonucu + önceki hafta + dönem ortalaması. */
export function weeklyReport(items, now = Date.now()) {
  const wkEnd = now, wkStart = now - 7 * DAY, prevStart = now - 14 * DAY;
  const week = items.filter((s) => s.sentAt >= wkStart && s.sentAt < wkEnd), prev = items.filter((s) => s.sentAt >= prevStart && s.sentAt < wkStart);
  const q = qualityOf(week, 5), p = qualityOf(prev, 5);
  const periods = periodReport(items, now), cur = periods.at(-1);
  const byDir = (d) => qualityOf(week.filter((s) => s.direction === d), 5);
  const L = byDir('long'), S = byDir('short');
  const best = week.map((s) => ({ s, R: finalR(s) })).filter((x) => x.R != null).sort((a, b) => b.R - a.R);
  const lines = [
    '📊 <b>Haftalık sinyal raporu</b> (son 7 gün)',
    `Sinyal ${q.n} (günde ${q.perDay}) · dolan ${pct(q.fillRate)} · kapanan ${q.closed} · açık ${q.open}`,
    `Kazanma ${pct(q.winRate)} · ort. ${sgn(q.avgR)}R · toplam ${sgn(q.totalR)}R`,
    `Long ${L.n} (${sgn(L.avgR)}R, kapanan ${L.closed}) · Short ${S.n} (${sgn(S.avgR)}R, kapanan ${S.closed})`,
    `Önceki hafta: sinyal ${p.n} · kapanan ${p.closed} · ort. ${sgn(p.avgR)}R · toplam ${sgn(p.totalR)}R`,
    cur ? `Bu dönem (${cur.label}, ${new Date(cur.from).toISOString().slice(0, 10)}'den beri): sinyal ${cur.n} · kapanan ${cur.closed} · kazanma ${pct(cur.winRate)} · ort. ${sgn(cur.avgR)}R` : null,
    best.length ? `En iyi: ${best.slice(0, 2).map((x) => `${x.s.coin} ${x.s.tf} ${sgn(x.R)}R`).join(', ')} · En kötü: ${best.slice(-2).map((x) => `${x.s.coin} ${x.s.tf} ${sgn(x.R)}R`).join(', ')}` : null,
    q.closed < 30 ? `<i>Not: kapanan ${q.closed} sinyal; n &lt; 30 ile kalite iddiası yok, eğilim olarak oku.</i>` : null,
  ].filter(Boolean);
  return { text: lines.join('\n'), week: q, prev: p, current: cur || null };
}
