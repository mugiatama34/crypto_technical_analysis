// Kanal dibi + fib kesişimi (kullanıcının kurulumu, 29.10.2026): yükselen (düşen) kanalda son itki P0→P1, ardından A–B
// düzeltmesi; C'nin 0,618 geri çekilme × A'nın B'den 1,272 uzantısı kesişimi kanalın alt (üst) çizgisiyle çakışır.
// Kanal: itkiden önceki aynı tip pivot + P0 (alt çizgi), önceki tepe + P1 (üst çizgi); HL/HH (LH/LL), eğimler aynı yönde
// ve kabaca paralel (oran 0,5–2), genişlik ≥ 2 ATR, A çizginin üstünde (long). Varyantlar:
//   p0    : kesişime limit, stop P0 ∓ 0,1 ATR (kullanıcının ONDO stopu: impuls başı = eşit dip havuzunun içi)
//   pool  : kesişime limit, stop P0 ∓ 0,5 ATR (havuzun altı)
//   sweep : P0 fitille süpürülüp kapanış geri içeride → piyasa girişi, stop süpürme fitili ∓ 0,2 ATR
// TP1 = P1 (itki ucu), TP2 = max(üst çizgi, P1 ± 0,236 L); TP1 < 1,5R ise işlem yok. Hesaplar i anına kadar kapanmış mumlarla.
import * as I from '../../src/data/indicators.js';
import { zigzag, fillAtr, pivotsAsOf } from '../../src/core/zigzag.js';
import { fibClusterOf } from '../../src/detectors/fibonacci.js';
import { dailyTrendAt } from '../../src/scan/regime.js';

export const CHAN_DEFAULTS = { ks: [2, 3, 4], clusterRetr: [0.618], clusterExt: [1.272], clusterTolAtr: 0.5, bRetr: [0.382, 1.0], minImpulseAtr: 3,
  lineTolAtr: 0.6, minWidthAtr: 2, slopeRatio: [0.5, 2], maxDistAtr: 6, minRR: 1.5, stop: 'p0', maxWait: 24, htf: null };
const r8 = (x) => +Number(x).toPrecision(8);
const lineAt = (a, b, i) => a.price + ((b.price - a.price) / (b.i - a.i)) * (i - a.i);

/** [Lp, Hp, P0, P1, A, B] (long: L,H,L,H,L,H) → kanal + kesişim; null = kurulum yok. */
export function channelSetup(w, i, atr, o = CHAN_DEFAULTS) {
  const [Lp, Hp, P0, P1, A, B] = w;
  const d = P1.price > P0.price ? 1 : -1;
  if (Lp.type !== P0.type || Hp.type !== P1.type || P0.type !== A.type || P1.type !== B.type) return null;
  // Kanal yönü: dipler ve tepeler işlem yönünde ilerliyor (long: HL + HH)
  if (d * (P0.price - Lp.price) <= 0 || d * (P1.price - Hp.price) <= 0) return null;
  const sLo = (P0.price - Lp.price) / (P0.i - Lp.i), sHi = (P1.price - Hp.price) / (P1.i - Hp.i);
  const ratio = sHi / sLo;
  if (!(ratio >= o.slopeRatio[0] && ratio <= o.slopeRatio[1])) return null;
  const base = (x) => lineAt(Lp, P0, x), top = (x) => lineAt(Hp, P1, x); // long: base = alt çizgi; short: base = üst çizgi
  const width = Math.abs(top(i) - base(i));
  if (width < o.minWidthAtr * atr) return null;
  if (d * (A.price - base(A.i)) < -0.3 * atr) return null; // A kanalı kırmamış olmalı
  const k = fibClusterOf([P0, P1, A, B], atr, o);
  if (!k) return null;
  if (Math.abs(k.mid - base(i)) > o.lineTolAtr * atr) return null; // kesişim kanal çizgisinde
  return { d, k, base: base(i), top: top(i), P0, P1, L: k.L };
}

const plan = (d, entry, stop, tp1, tp2, atr, inZone, extra) => ({ d, direction: d === 1 ? 'long' : 'short', entry: r8(entry), stop: r8(stop), tp1: r8(tp1), tp2: r8(tp2), inZone, atr: r8(atr), price: r8(entry), ...extra });

export function makeChannel(id, label, over = {}) {
  const o = { ...CHAN_DEFAULTS, ...over };
  return {
    id, label, tfs: ['5m', '15m', '1H', '4H'], exit: { tpScheme: 'half_be', maxHoldBars: 120 }, needs: o.htf ? ['1D'] : [], o,
    prepare(candles, tf, extra = {}) {
      const atr = I.atr(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14), filled = fillAtr(atr);
      return { atr, zz: o.ks.map((k) => zigzag(candles, filled, k)), seen: new Set(), armed: [], daily: extra.daily || null };
    },
    signal(i, candles, p) {
      if (i < 60) return null;
      const a = p.atr[i]; if (!a) return null;
      const c = candles[i];
      // Süpürme varyantı: kurulmuş kurulumlarda P0 süpürmesi bekle
      if (o.stop === 'sweep' && p.armed.length) {
        // geçerli kalır: süre dolmadı, kapanış P0'ın 0,3 ATR ötesine kırılmadı, fiyat henüz P1'e (TP1) varmadı
        p.armed = p.armed.filter((s) => i - s.at <= o.maxWait && s.d * (c.close - (s.P0.price - s.d * 0.3 * a)) > 0 && (s.d === 1 ? c.high < s.P1.price : c.low > s.P1.price));
        for (const s of p.armed) {
          const swept = s.d === 1 ? c.low < s.P0.price && c.close > s.P0.price : c.high > s.P0.price && c.close < s.P0.price;
          if (!swept) continue;
          const stop = (s.d === 1 ? c.low : c.high) - s.d * 0.2 * a, risk = s.d * (c.close - stop);
          p.armed = p.armed.filter((x) => x !== s);
          if (!(risk > 0) || s.d * (s.tp1 - c.close) / risk < o.minRR) return null;
          return plan(s.d, c.close, stop, s.tp1, s.tp2, a, true, { kind: 'channel_fib_sweep', rr1: +((s.d * (s.tp1 - c.close)) / risk).toFixed(2) });
        }
      }
      for (let z = 0; z < p.zz.length; z++) {
        const { pivots } = pivotsAsOf(p.zz[z], candles, i);
        if (pivots.length < 6) continue;
        const w = pivots.slice(-6);
        const key = `${z}:${w.map((q) => q.i).join('-')}`;
        if (p.seen.has(key)) continue;
        const s = channelSetup(w, i, a, o);
        if (!s) continue;
        const { d, k } = s;
        if (d * (c.close - k.mid) <= 0 || d * (c.close - k.mid) > o.maxDistAtr * a) continue; // fiyat bölgeye gelmemiş, çok uzak değil
        if (o.htf === 'with' && p.daily) { const t = dailyTrendAt(p.daily, c.time); if (!t || (t.up ? 1 : -1) !== d) { p.seen.add(key); continue; } }
        p.seen.add(key);
        const tp1 = s.P1.price, tp2 = d === 1 ? Math.max(s.top, tp1 + 0.236 * s.L) : Math.min(s.top, tp1 - 0.236 * s.L);
        if (o.stop === 'sweep') { p.armed.push({ d, P0: s.P0, P1: s.P1, tp1, tp2, at: i }); continue; }
        const stop = s.P0.price - d * (o.stop === 'pool' ? 0.5 : 0.1) * a, risk = d * (k.mid - stop);
        if (!(risk > 0) || d * (tp1 - k.mid) / risk < o.minRR) continue;
        return { ...plan(d, k.mid, stop, tp1, tp2, a, false, { kind: 'channel_fib', rr1: +((d * (tp1 - k.mid)) / risk).toFixed(2) }), zone: [r8(k.mid - 0.25 * a), r8(k.mid + 0.25 * a)], price: c.close };
      }
      return null;
    },
  };
}

export const chanFibP0 = makeChannel('chan_fib_p0', 'Kanal + 0,618×1,272 kesişimine limit, stop itki başı ∓ 0,1 ATR (kullanıcının stopu)');
export const chanFibPool = makeChannel('chan_fib_pool', 'Kanal + 0,618×1,272 kesişimine limit, stop itki başı ∓ 0,5 ATR (havuzun ötesi)', { stop: 'pool' });
export const chanFibSweep = makeChannel('chan_fib_sweep', 'Kanal + 0,618×1,272 kurulumu, itki başı süpürülüp geri kapanınca giriş, stop fitil ∓ 0,2 ATR', { stop: 'sweep' });
export const chanFibP0Htf = makeChannel('chan_fib_p0_htf', 'Kanal + 0,618×1,272, stop itki başı, yalnız günlük trend yönünde', { htf: 'with' });
export const CHAN_STRATEGIES = [chanFibP0, chanFibPool, chanFibSweep, chanFibP0Htf];
