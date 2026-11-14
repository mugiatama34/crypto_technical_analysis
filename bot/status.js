// Piyasa durum satırı (günlük özet mesajı için; YALNIZ GÖSTERİM — hiçbir filtre / puan / plan / sinyal kararını etkilemez).
// Saf fonksiyonlar, ağ yok. Tanımlar backtest/regime-map.js ile tek kaynaktan (trend, SMA, oynaklık).
import { trendStates, trendOf, smaArr, volStates, levelOf, UP, DOWN, MIXED, HIGH, MID, LOW, RM_DEFAULTS } from '../backtest/regime-map.js';

const DAY = 86400e3, HOUR = 3600e3;
const fmtTr = (x, d) => x.toFixed(d).replace('.', ',');

/** BTC günlük trendi (50/200 SMA): son kapanmış günlük mumun durumu; 200 mumdan az → null. */
export function trendState(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length < RM_DEFAULTS.slow) return null;
  const m = trendStates(dailyCandles);
  return m.get(dailyCandles[dailyCandles.length - 1].time) ?? null;
}

/** Kısa vade (4H): kapanış > SMA3 > SMA6 > SMA42 → YUKARI; kapanış < SMA3 < SMA6 < SMA42 → AŞAĞI; aksi KARIŞIK; 42 mumdan az → null. */
export function shortState(h4Candles) {
  if (!Array.isArray(h4Candles) || h4Candles.length < 42) return null;
  const c = h4Candles.map((x) => x.close), i = c.length - 1;
  const a = smaArr(c, 3)[i], b = smaArr(c, 6)[i], d = smaArr(c, 42)[i], x = c[i];
  if (a == null || b == null || d == null) return null;
  if (x > a && a > b && b > d) return UP;
  if (x < a && a < b && b < d) return DOWN;
  return MIXED;
}

/** Oynaklık: 30 günlük getiri std ÷ 365 günlük medyanı (volStates ile aynı tanım, son gün). */
export function volState(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length < 2) return { state: null, ratio: null };
  const { states, ratio } = volStates(dailyCandles);
  const t = dailyCandles[dailyCandles.length - 1].time;
  const s = states.get(t) ?? null, r = ratio.get(t);
  return s == null ? { state: null, ratio: null } : { state: s, ratio: r };
}

/** Fonlama: rows = [{ time(ms), rate(ondalık), intervalH }]; son 7 gün, 8 saatlik eşdeğer ortalama (%). < 5 günde veri → null. */
export function fundingState(rows, now = Date.now()) {
  const none = { state: null, avg8hPct: null };
  if (!Array.isArray(rows)) return none;
  const w = rows.filter((r) => r && r.time > now - 7 * DAY && r.time <= now && Number.isFinite(r.rate) && r.intervalH > 0);
  if (new Set(w.map((r) => Math.floor(r.time / DAY))).size < 5) return none;
  const avg = (w.reduce((s, r) => s + (r.rate * 8) / r.intervalH, 0) / w.length) * 100;
  return { state: levelOf(avg, 0.010, 0.0033), avg8hPct: avg };
}

/** OKX funding-rate-history ham verisi → [{ time, rate, intervalH }] (eskiden yeniye; aralık ardışık farktan, yoksa 8). Savunmacı. */
export function fundingRowsOf(data) {
  if (!Array.isArray(data)) return [];
  const m = new Map();
  for (const x of data) {
    if (!x || typeof x !== 'object') continue;
    const t = Number(x.fundingTime), rr = x.realizedRate, rrN = rr === '' || rr == null ? NaN : Number(rr);
    const r = Number.isFinite(rrN) ? rrN : (x.fundingRate === '' || x.fundingRate == null ? NaN : Number(x.fundingRate));
    if (Number.isFinite(t) && t > 0 && Number.isFinite(r)) m.set(t, r);
  }
  const s = [...m.entries()].sort((a, b) => a[0] - b[0]);
  return s.map(([time, rate], i) => {
    const gap = i > 0 ? (time - s[i - 1][0]) / HOUR : (s.length > 1 ? (s[1][0] - time) / HOUR : 8);
    return { time, rate, intervalH: gap > 0 && gap <= 24 ? gap : 8 };
  });
}

/** Tek satır düz metin; null parça "—"; hepsi null → ''. */
export function statusLine({ trend = null, short = null, vol = null, funding = null } = {}) {
  const v = vol?.state ? vol : null, f = funding?.state ? funding : null;
  if (!trend && !short && !v && !f) return '';
  const p = [
    trend ? `BTC trend ${trend} (50/200 günlük)` : 'BTC trend —',
    short ? `kısa vade ${short} (4H: 12s/1g/1h)` : 'kısa vade —',
    v ? `oynaklık ${v.state} (×${fmtTr(v.ratio, 2)})` : 'oynaklık —',
    f ? `fonlama ${f.state} (%${fmtTr(f.avg8hPct, 4)} / 8s, 7 gün)` : 'fonlama —',
  ];
  return `Durum: ${p.join(' · ')}`;
}
