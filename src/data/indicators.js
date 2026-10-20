// Teknik göstergeler (saf fonksiyonlar). rsi/atr/rma rsi-divergence-signals/js/indicators.js'ten uyarlandı,
// kalanı bu proje için eklendi. Tüm fonksiyonlar girdiyle aynı uzunlukta dizi döndürür; ısınma indekslerinde değer null'dır.

/** Wilder yumuşatması (RMA): ilk değer SMA, sonrası (önceki × (n − 1) + değer) / n. */
export function rma(values, period) {
  const out = new Array(values.length).fill(null);
  if (!(period > 0) || values.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

const rsiFromAverages = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));

/** RSI — Wilder yöntemi (TradingView ta.rsi ile aynı). */
export function rsi(closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (!(period > 0) || n <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (ch > 0 ? ch : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

/** Gerçek aralık: max(H − L, |H − önceki C|, |L − önceki C|). */
export function trueRange(high, low, close) {
  return high.map((h, i) => {
    const hl = h - low[i];
    if (i === 0) return hl;
    const pc = close[i - 1];
    return Math.max(hl, Math.abs(h - pc), Math.abs(low[i] - pc));
  });
}

/** ATR — gerçek aralığın Wilder yumuşatması. */
export function atr(high, low, close, period = 14) {
  return rma(trueRange(high, low, close), period);
}

/** Basit hareketli ortalama. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (!(period > 0)) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Üstel hareketli ortalama (TradingView ta.ema: ilk değer SMA). */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!(period > 0) || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const zipNull = (a, b, f) => a.map((x, i) => (x == null || b[i] == null ? null : f(x, b[i])));

/** MACD: { macd, signal, hist } — null ısınma dahil. */
export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const line = zipNull(ema(closes, fast), ema(closes, slow), (a, b) => a - b);
  const first = line.findIndex((x) => x != null);
  const sigArr = new Array(closes.length).fill(null);
  if (first >= 0) {
    const s = ema(line.slice(first), sig);
    for (let i = 0; i < s.length; i++) sigArr[first + i] = s[i];
  }
  const hist = zipNull(line, sigArr, (a, b) => a - b);
  return { macd: line, signal: sigArr, hist };
}

/** Standart sapma (popülasyon), period penceresi. */
export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  const m = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - m[i]) ** 2;
    out[i] = Math.sqrt(s / period);
  }
  return out;
}

/** Bollinger bantları: { mid, upper, lower, width } (width = (üst−alt)/orta). */
export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period), sd = stdev(closes, period);
  const upper = zipNull(mid, sd, (m, s) => m + mult * s);
  const lower = zipNull(mid, sd, (m, s) => m - mult * s);
  const width = zipNull(upper, lower, (u, l) => u - l).map((w, i) => (w == null || !mid[i] ? null : w / mid[i]));
  return { mid, upper, lower, width };
}

/** Keltner kanalı: EMA ± mult × ATR. */
export function keltner(high, low, close, period = 20, mult = 1.5) {
  const mid = ema(close, period), a = atr(high, low, close, period);
  return { mid, upper: zipNull(mid, a, (m, x) => m + mult * x), lower: zipNull(mid, a, (m, x) => m - mult * x) };
}

/** Donchian kanalı: period penceresinin en yükseği / en düşüğü (mevcut mum hariç, kırılım tespiti için). */
export function donchian(high, low, period = 20) {
  const upper = new Array(high.length).fill(null), lower = new Array(high.length).fill(null);
  for (let i = period; i < high.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) { if (high[j] > hi) hi = high[j]; if (low[j] < lo) lo = low[j]; }
    upper[i] = hi; lower[i] = lo;
  }
  return { upper, lower };
}

/** Stokastik %K / %D (TradingView ta.stoch). */
export function stoch(high, low, close, kPeriod = 14, dPeriod = 3, smooth = 3) {
  const raw = new Array(close.length).fill(null);
  for (let i = kPeriod - 1; i < close.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { if (high[j] > hi) hi = high[j]; if (low[j] < lo) lo = low[j]; }
    raw[i] = hi === lo ? 50 : ((close[i] - lo) / (hi - lo)) * 100;
  }
  const k = smaNull(raw, smooth);
  const d = smaNull(k, dPeriod);
  return { k, d };
}

/** Stokastik RSI: RSI'ın stokastiği. */
export function stochRsi(closes, rsiPeriod = 14, stochPeriod = 14, k = 3, d = 3) {
  const r = rsi(closes, rsiPeriod);
  const raw = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (i < rsiPeriod + stochPeriod - 1) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) { if (r[j] == null) { hi = null; break; } if (r[j] > hi) hi = r[j]; if (r[j] < lo) lo = r[j]; }
    if (hi == null) continue;
    raw[i] = hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
  }
  const kk = smaNull(raw, k);
  return { k: kk, d: smaNull(kk, d) };
}

/** null'ları atlayarak SMA (ısınma sonrası pencere). */
function smaNull(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    let s = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) { if (values[j] == null) { ok = false; break; } s += values[j]; }
    if (ok) out[i] = s / period;
  }
  return out;
}

/** ADX / +DI / −DI (Wilder). */
export function adx(high, low, close, period = 14) {
  const n = high.length;
  const plusDM = new Array(n).fill(0), minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = rma(trueRange(high, low, close), period);
  const pdi = zipNull(rma(plusDM, period), tr, (a, t) => (t ? (100 * a) / t : 0));
  const mdi = zipNull(rma(minusDM, period), tr, (a, t) => (t ? (100 * a) / t : 0));
  const dx = zipNull(pdi, mdi, (p, m) => (p + m ? (100 * Math.abs(p - m)) / (p + m) : 0));
  const first = dx.findIndex((x) => x != null);
  const out = new Array(n).fill(null);
  if (first >= 0) {
    const a = rma(dx.slice(first), period);
    for (let i = 0; i < a.length; i++) out[first + i] = a[i];
  }
  return { adx: out, pdi, mdi };
}

/** On-Balance Volume. */
export function obv(close, volume) {
  const out = new Array(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    out[i] = out[i - 1] + (close[i] > close[i - 1] ? volume[i] : close[i] < close[i - 1] ? -volume[i] : 0);
  }
  return out;
}

/**
 * VWAP — ya tüm pencere boyunca kümülatif ya da `sessionOf(time)` ile oturum/günlük sıfırlama.
 * @param sessionOf  (ms) => anahtar; anahtar değişince kümülatif sıfırlanır (null = sıfırlama yok)
 */
export function vwap(candles, sessionOf = null) {
  const out = new Array(candles.length).fill(null);
  let pv = 0, v = 0, key = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const k = sessionOf ? sessionOf(c.time) : null;
    if (sessionOf && k !== key) { pv = 0; v = 0; key = k; }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume; v += c.volume;
    out[i] = v > 0 ? pv / v : null;
  }
  return out;
}

/** Supertrend: { line, dir } (dir 1 yükseliş, −1 düşüş). */
export function supertrend(high, low, close, period = 10, mult = 3) {
  const n = close.length;
  const a = atr(high, low, close, period);
  const line = new Array(n).fill(null), dir = new Array(n).fill(null);
  let upper = null, lower = null, trend = 1;
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const hl2 = (high[i] + low[i]) / 2;
    let ub = hl2 + mult * a[i], lb = hl2 - mult * a[i];
    if (lower != null && (lb > lower || close[i - 1] < lower)) lower = lb; else if (lower != null) lb = lower; else lower = lb;
    if (upper != null && (ub < upper || close[i - 1] > upper)) upper = ub; else if (upper != null) ub = upper; else upper = ub;
    lower = lb; upper = ub;
    if (dir[i - 1] == null) trend = close[i] > ub ? 1 : -1;
    else if (trend === 1 && close[i] < lb) trend = -1;
    else if (trend === -1 && close[i] > ub) trend = 1;
    dir[i] = trend;
    line[i] = trend === 1 ? lb : ub;
  }
  return { line, dir };
}

/** Ichimoku: tenkan, kijun, senkouA, senkouB (ileri kaydırılmamış, aynı indekste), chikou yok. */
export function ichimoku(high, low, tenkanP = 9, kijunP = 26, senkouP = 52) {
  const mid = (p) => {
    const out = new Array(high.length).fill(null);
    for (let i = p - 1; i < high.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++) { if (high[j] > hi) hi = high[j]; if (low[j] < lo) lo = low[j]; }
      out[i] = (hi + lo) / 2;
    }
    return out;
  };
  const tenkan = mid(tenkanP), kijun = mid(kijunP), senkouB = mid(senkouP);
  const senkouA = zipNull(tenkan, kijun, (a, b) => (a + b) / 2);
  return { tenkan, kijun, senkouA, senkouB };
}

/** Heikin-Ashi mumları. */
export function heikinAshi(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: c.time, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close), volume: c.volume });
  }
  return out;
}

/** Hacim profili: fiyat aralığını `bins` kovaya böler, her mumun hacmini H-L aralığına eşit dağıtır. POC / VAH / VAL (%70). */
export function volumeProfile(candles, bins = 40) {
  if (!candles.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);
  for (const c of candles) {
    const b0 = Math.max(0, Math.floor((c.low - lo) / step)), b1 = Math.min(bins - 1, Math.floor((c.high - lo) / step));
    const share = c.volume / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) vol[b] += share;
  }
  const total = vol.reduce((s, x) => s + x, 0);
  let poc = 0;
  for (let b = 1; b < bins; b++) if (vol[b] > vol[poc]) poc = b;
  // Değer alanı: POC'tan iki yana genişleyerek %70 hacim
  let a = poc, z = poc, acc = vol[poc];
  while (acc < 0.7 * total && (a > 0 || z < bins - 1)) {
    const up = z < bins - 1 ? vol[z + 1] : -1, dn = a > 0 ? vol[a - 1] : -1;
    if (up >= dn) { z++; acc += up; } else { a--; acc += dn; }
  }
  const price = (b) => lo + (b + 0.5) * step;
  return { poc: price(poc), vah: lo + (z + 1) * step, val: lo + a * step, bins: vol.map((v, b) => ({ price: price(b), volume: v })), step };
}
