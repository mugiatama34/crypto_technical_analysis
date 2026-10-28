// Strateji laboratuvarı: farklı giriş-çıkış aileleri, aynı simülasyon ve rapor. Her strateji:
//   { id, label, tfs, needs?: ['1D'], exit: { tpScheme, trailAtr, maxHoldBars }, prepare(candles, tf, extra) → pre, signal(i, candles, pre) → plan|null }
//   extra.daily: günlük mumlar (needs '1D' içeriyorsa run.mjs çeker)
// Plan: { d, direction, entry (sinyal mumu kapanışı), stop, tp1, tp2, inZone:true, atr, price } — simulateTrade ile aynı.
import * as I from '../../src/data/indicators.js';
import { makeContext } from '../../src/scan/context.js';
import { equalLevels } from '../../src/detectors/liquidity.js';
import { analyzeRow, barsFor } from '../../src/scan/scanner.js';
import { buildPlan } from '../../bot/plan.js';
import { dailyTrendAt, regimeUp } from '../../src/scan/regime.js';
import { endingDiagonal, endingDiagonalWide, leadingDiagonal } from './diagonal.js';
import { XS_STRATEGIES } from './xsmom.js';
import { SMC_STRATEGIES } from './smc.js';
import { DIV_STRATEGIES } from './divergence.js';
import { zigzagC, expandedFlatC, zigzagC1hShort, expandedFlatCWide, fibClusterC, fibClusterCStrict, fibClusterG, fibClusterGP0 } from './corrections.js';
export { zigzagC, expandedFlatC, zigzagC1hShort, expandedFlatCWide };
export { endingDiagonal, endingDiagonalWide, leadingDiagonal };

const r6 = (x) => +Number(x).toPrecision(8);
const mk = (d, entry, stop, tp1, tp2, atr) => ({ d, direction: d === 1 ? 'long' : 'short', entry: r6(entry), stop: r6(stop), tp1: tp1 && r6(tp1), tp2: tp2 && r6(tp2), inZone: true, atr: r6(atr), price: r6(entry) });

function basics(candles) {
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  return { highs, lows, closes, atr: I.atr(highs, lows, closes, 14), adx: I.adx(highs, lows, closes, 14) };
}

/** 1) Donchian kırılımı + ADX, ATR izleyen stop. */
export const donchian = {
  id: 'donchian', label: 'Donchian 20 kırılımı + ADX ≥ 25, 2 ATR izleyen stop', tfs: ['1H', '4H'],
  exit: { tpScheme: 'trail_only', trailAtr: 2, maxHoldBars: 100 },
  prepare(candles) { const b = basics(candles); return { ...b, dc: I.donchian(b.highs, b.lows, 20) }; },
  signal(i, candles, p) {
    const c = candles[i], a = p.atr[i], ax = p.adx.adx[i];
    if (a == null || ax == null || ax < 25 || p.dc.upper[i] == null) return null;
    if (c.close > p.dc.upper[i] && p.adx.pdi[i] > p.adx.mdi[i]) return mk(1, c.close, c.close - 2 * a, null, null, a);
    if (c.close < p.dc.lower[i] && p.adx.mdi[i] > p.adx.pdi[i]) return mk(-1, c.close, c.close + 2 * a, null, null, a);
    return null;
  },
};

/** 2) Ortalamaya dönüş: EMA20'den ≥ 2 ATR sapma, EMA200 trendi yönünde, hedef EMA20. */
export const meanrev = {
  id: 'meanrev', label: 'EMA20 sapması ≥ 2 ATR, EMA200 yönünde, hedef EMA20', tfs: ['4H', '1H'],
  exit: { tpScheme: 'single', maxHoldBars: 20 },
  prepare(candles) { const b = basics(candles); return { ...b, e20: I.ema(b.closes, 20), e200: I.ema(b.closes, 200) }; },
  signal(i, candles, p) {
    const c = candles[i], a = p.atr[i], e20 = p.e20[i], e200 = p.e200[i];
    if (a == null || e20 == null || e200 == null) return null;
    const z = (c.close - e20) / a;
    if (z <= -2 && c.close > e200) return mk(1, c.close, c.close - 2 * a, null, e20, a);
    if (z >= 2 && c.close < e200) return mk(-1, c.close, c.close + 2 * a, null, e20, a);
    return null;
  },
};

/** 3) Likidite süpürmesi + geri alma (onaylı pivotlarla, geleceğe bakmaz). */
export const sweepReclaim = {
  id: 'sweep_reclaim', label: 'Eşit dip/tepe süpürmesi + kapanışla geri alma', tfs: ['1H', '4H'], // 15m: 1. turda PF 0,57, çıkarıldı
  exit: { tpScheme: 'half_be', maxHoldBars: 60 },
  prepare(candles, tf) { return { ...basics(candles), tf, W: barsFor(tf) }; },
  signal(i, candles, p) {
    if (i < 80) return null;
    const c = candles[i], a = p.atr[i];
    if (a == null) return null;
    const win = candles.slice(Math.max(0, i - p.W + 1), i); // sinyal mumu HARİÇ: pivotlar önceki mumlardan
    const ctx = makeContext({ candles: win, live: null, tf: p.tf });
    if (ctx.n < 60) return null;
    const levels = equalLevels(ctx.minor.filter((x) => ctx.last - x.i <= 150), ctx.atr, 0.2);
    for (const lv of levels) {
      if (lv.type === 'L' && c.low < lv.level && c.close > lv.level && (lv.level - c.low) <= 1.5 * a) {
        const stop = c.low - 0.2 * a, risk = c.close - stop;
        const above = levels.filter((x) => x.type === 'H' && x.level > c.close + risk).sort((x, y) => x.level - y.level)[0];
        const tp1 = above && (above.level - c.close) / risk < 3 ? above.level : c.close + 2 * risk;
        return mk(1, c.close, stop, tp1, c.close + 3 * risk, a);
      }
      if (lv.type === 'H' && c.high > lv.level && c.close < lv.level && (c.high - lv.level) <= 1.5 * a) {
        const stop = c.high + 0.2 * a, risk = stop - c.close;
        const below = levels.filter((x) => x.type === 'L' && x.level < c.close - risk).sort((x, y) => y.level - x.level)[0];
        const tp1 = below && (c.close - below.level) / risk < 3 ? below.level : c.close - 2 * risk;
        return mk(-1, c.close, stop, tp1, c.close - 3 * risk, a);
      }
    }
    return null;
  },
};

/** 4) Kontrol: mevcut motor + geniş stop (2 ATR) + izleyen çıkış, piyasa giriş, ADX uyumlu. */
export const engineWide = {
  id: 'engine_wide', label: 'Mevcut motor (puan ≥ 60, ADX ≥ 25) + 2 ATR stop + 2 ATR izleyen', tfs: ['1H', '4H'],
  exit: { tpScheme: 'trail_only', trailAtr: 2, maxHoldBars: 100 },
  prepare(candles, tf) { return { ...basics(candles), tf, W: barsFor(tf) }; },
  signal(i, candles, p) {
    if (i < p.W || (i % 2)) return null; // iki mumda bir (maliyet)
    const win = candles.slice(i - p.W + 1, i + 1);
    const row = analyzeRow({ coin: 'X', instId: 'X', tf: p.tf, candles: win, live: null }, { ids: null });
    if (row.error || !row.best) return null;
    const plan = buildPlan(row, { minScore: 60, minRR: 1, trendAdxMin: 25 });
    if (!plan.ok) return null;
    const c = candles[i], a = p.atr[i];
    return mk(plan.d, c.close, c.close - plan.d * 2 * a, null, null, a);
  },
};

/** 5) Donchian yalnız 4H, yalnız long, kapanış > EMA200. */
export const donchian4hLong = {
  id: 'donchian_4h_long', label: 'Donchian 20 kırılımı, yalnız 4H long, EMA200 üstü, ADX ≥ 25', tfs: ['4H'],
  exit: donchian.exit,
  prepare(candles) { const b = basics(candles); return { ...b, dc: I.donchian(b.highs, b.lows, 20), e200: I.ema(b.closes, 200) }; },
  signal(i, candles, p) {
    const c = candles[i];
    if (p.e200[i] == null || c.close <= p.e200[i]) return null;
    const sig = donchian.signal(i, candles, p);
    return sig && sig.d === 1 ? sig : null;
  },
};

export { dailyTrendAt };

/** 6) 5 + günlük trend (günlük kapanış > günlük EMA50). */
export const donchian4hLongHtf = {
  id: 'donchian_4h_long_htf', label: 'Donchian 4H long + günlük EMA50 üstü', tfs: ['4H'], needs: ['1D'],
  exit: donchian.exit,
  prepare(candles, tf, extra) { return { ...donchian4hLong.prepare(candles), daily: extra?.daily || null }; },
  signal(i, candles, p) {
    const dt = dailyTrendAt(p.daily, candles[i].time);
    if (!dt || !dt.up) return null;
    return donchian4hLong.signal(i, candles, p);
  },
};

/** 7) Kontrol: mevcut motor yalnız 4H. */
export const engineWide4h = { ...engineWide, id: 'engine_wide_4h', label: 'Mevcut motor yalnız 4H + 2 ATR stop + izleyen', tfs: ['4H'] };

/** 8) Ortalamaya dönüş yalnız long. */
export const meanrevLong = {
  ...meanrev, id: 'meanrev_long', label: 'EMA20 sapması ≥ 2 ATR, yalnız long (EMA200 üstü), hedef EMA20', tfs: ['1H', '4H'],
  signal(i, candles, p) { const sig = meanrev.signal(i, candles, p); return sig && sig.d === 1 ? sig : null; },
};

/** 9) Kontrol yalnız 4H, yalnız long (2. turda 4H long n86 +0,24R PF 1,57; short negatif). */
export const engineWide4hLong = {
  ...engineWide4h, id: 'engine_wide_4h_long', label: 'Mevcut motor yalnız 4H long + 2 ATR stop + izleyen',
  signal(i, candles, p) { const sig = engineWide4h.signal(i, candles, p); return sig && sig.d === 1 ? sig : null; },
};

/** 10) Ortalamaya dönüş yalnız 4H long (2. turda n46 +0,12R PF 1,30). */
export const meanrev4hLong = { ...meanrevLong, id: 'meanrev_4h_long', label: 'EMA20 sapması ≥ 2 ATR, yalnız 4H long, hedef EMA20', tfs: ['4H'] };

/** BTC rejimi: BTC günlük kapanışı (o ana kadar kapanmış son gün) günlük EMA50 üstünde mi. Karar anında bilinir. */
export { regimeUp };

/** Rejim sarmalayıcı: yalnız BTC yükseliş rejiminde sinyal; rejim verisi yoksa sinyal yok. */
export function withBtcRegime(base, id, label) {
  return {
    ...base, id, label, needs: [...(base.needs || []), 'BTC1D'],
    prepare(candles, tf, extra) { return { ...base.prepare(candles, tf, extra), btcDaily: extra?.btcDaily || null }; },
    signal(i, candles, p) { return regimeUp(p.btcDaily, candles[i].time) ? base.signal(i, candles, p) : null; },
  };
}

/** 11–12) 5. tur: 12 ay 4H koşusunda long aileleri eğitimde sıfır/eksi, doğrulamada Ağustos'la pozitifti → rejim filtresi. */
export const engineWide4hLongBtc = withBtcRegime(engineWide4hLong, 'engine_wide_4h_long_btc', 'Mevcut motor 4H long, yalnız BTC günlük EMA50 üstündeyken');
export const donchian4hLongBtc = withBtcRegime(donchian4hLong, 'donchian_4h_long_btc', 'Donchian 4H long, yalnız BTC günlük EMA50 üstündeyken');

/** BTC/ETH zaman serisi momentumu: EMA50 tarafı + EMA50 eğimi + ADX ≥ 20 DI uyumlu + Donchian 20 kırılımı; iki yön. */
const mkTsmom = (id, tf, maxHold) => ({
  id, label: `BTC/ETH ${tf} trend takibi: EMA50 tarafı + eğim + ADX ≥ 20 + Donchian 20, 2 ATR izleyen`, tfs: [tf], coins: ['BTC', 'ETH'],
  exit: { tpScheme: 'trail_only', trailAtr: 2, maxHoldBars: maxHold },
  prepare(candles) { const b = basics(candles); return { ...b, dc: I.donchian(b.highs, b.lows, 20), e50: I.ema(b.closes, 50) }; },
  signal(i, candles, p) {
    const c = candles[i], a = p.atr[i], ax = p.adx.adx[i], e = p.e50[i], e0 = p.e50[i - 10];
    if (a == null || ax == null || e == null || e0 == null || p.dc.upper[i] == null || ax < 20) return null;
    const side = c.close > e ? 1 : -1, slope = e > e0 ? 1 : e < e0 ? -1 : 0, di = p.adx.pdi[i] > p.adx.mdi[i] ? 1 : -1;
    if (side !== slope || slope !== di) return null;
    if (side === 1 && c.close > p.dc.upper[i]) return mk(1, c.close, c.close - 2 * a, null, null, a);
    if (side === -1 && c.close < p.dc.lower[i]) return mk(-1, c.close, c.close + 2 * a, null, null, a);
    return null;
  },
});
export const btcTsmom1h = mkTsmom('btc_tsmom_1h', '1H', 200);
export const btcTsmom4h = mkTsmom('btc_tsmom_4h', '4H', 100);

export const STRATEGIES = [btcTsmom1h, btcTsmom4h, donchian, donchian4hLong, donchian4hLongHtf, donchian4hLongBtc, meanrev, meanrevLong, meanrev4hLong, sweepReclaim, engineWide, engineWide4h, engineWide4hLong, engineWide4hLongBtc, endingDiagonal, endingDiagonalWide, leadingDiagonal, zigzagC, expandedFlatC, zigzagC1hShort, expandedFlatCWide, fibClusterC, fibClusterCStrict, fibClusterG, fibClusterGP0, ...SMC_STRATEGIES, ...DIV_STRATEGIES, ...XS_STRATEGIES];
export const STRATEGY_MAP = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
