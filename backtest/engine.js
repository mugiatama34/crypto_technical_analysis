// Walk-forward backtest (saf): her adımda yalnızca o ana kadarki mumlarla analiz + plan; plan ileriye simüle edilir.
import { analyzeRow, barsFor } from '../src/scan/scanner.js';
import { buildPlan, onCooldown, knifeGuardOf, approachOf, isKnife, confirmsTurn, fillOrder } from '../bot/plan.js';
export { fillOrder };
import { TIMEFRAMES } from '../src/data/okx.js';

export const BT_DEFAULTS = {
  step: { '1m': 4, '5m': 2, '15m': 2, '1H': 1, '4H': 1, '1D': 1 }, // kaç mumda bir tarama
  feePct: 0.05, // komisyon % / taraf (taker)
  slipPct: 0.05, // piyasa/stop dolumunda aleyhe kayma %
  expireHours: 24,
  maxHoldBars: 200, // dolumdan sonra en fazla bu kadar mum; sonra kapanıştan çık
  cooldownHours: 6,
  tp1Portion: 0.5, // TP1'de kapatılan kısım; kalan TP2 ya da başabaş stop
  // Çıkış şeması: 'half_be' (TP1 yarı + başabaş, varsayılan) | 'half_nobe' (TP1 yarı, stop yerinde) |
  // 'single' (tek hedef tp2'de tam çıkış) | 'trail' (TP1 yarı, kalan ATR izleyen stop: trailAtr × ATR)
  // 'trail_only' (hedef yok; stop girişten itibaren trailAtr × ATR izler, stop'a kadar)
  tpScheme: 'half_be',
  trailAtr: 1.0,
  knifeGuard: null, // düşen bıçak koruması (bot/plan.js KNIFE_DEFAULTS); null = kapalı
  // Limit dolum mumunda hedef (TP1 / tek hedef): 'count' (varsayılan, iyimser: önce dolum sonra hedef varsayılır) |
  // 'skip' (kötümser: dolum mumunda hedef sayılmaz) | 'lower' (alt TF mumlarıyla sıra: o.lowerCandles, dolumdan SONRAKİ
  // alt mumlarda stop görülmeden hedef görülürse sayılır; dolumun alt mumunda stop varsa stop)
  fillBarTp: 'count',
  lowerCandles: null,
  timeStop: null, // zaman stopu { bars, minMfeR }: dolumdan bars mum içinde TP1 yoksa (ve MFE < minMfeR) kapanıştan çık
  plan: { minScore: 50, minRR: 2, maxRiskPct: 5 },
  detectors: null, weights: {},
};

/** Tek plan simülasyonu. candles: tüm seri; from: planın oluştuğu mumdan sonraki ilk indeks. */
export function simulateTrade(plan, candles, from, tf, o = BT_DEFAULTS) {
  const d = plan.d, ms = TIMEFRAMES[tf].ms;
  const expireBars = Math.ceil((o.expireHours * 3600e3) / ms);
  const slip = o.slipPct / 100, fee = o.feePct / 100;
  let i = from, entry = null, fillI = -1, mkt = !!plan.inZone, appr = null;
  // Dolum
  if (plan.inZone) { // piyasa: sonraki mumun açılışı + kayma
    if (i >= candles.length) return { outcome: 'expired', R: 0 };
    entry = candles[i].open * (1 + d * slip); fillI = i;
  } else {
    const g = knifeGuardOf(o.knifeGuard);
    for (; i < candles.length && i < from + expireBars; i++) {
      const c = candles[i];
      const touched = d === 1 ? c.low <= plan.entry : c.high >= plan.entry;
      if (touched) {
        appr = approachOf(candles, i, d, plan.atr || Math.abs(plan.entry - plan.stop));
        if (!isKnife(appr, g)) { entry = plan.entry; fillI = i; break; }
        // Hızlı yaklaşma: emir dolmaz; teyit mumu beklenir (kapanışından giriş), teyitten önce stop = iptal
        const stopOf = (x) => (d === 1 ? x.low <= plan.stop : x.high >= plan.stop);
        if (g.skip || stopOf(c)) return { outcome: 'knife', R: 0, ...appr };
        for (let k = i + 1; k <= i + g.confirmBars && k < candles.length; k++) {
          const x = candles[k];
          if (stopOf(x)) return { outcome: 'knife', R: 0, ...appr };
          if (confirmsTurn(x, candles[k - 1], plan)) {
            if (d * (plan.tp1 - x.close) <= 0) return { outcome: 'missed', R: 0, ...appr };
            entry = x.close * (1 + d * slip); fillI = k + 1; mkt = true; break;
          }
        }
        if (entry == null) return { outcome: 'expired', R: 0, knifeWait: true, ...appr };
        if (fillI >= candles.length) return { outcome: 'expired', R: 0, ...appr };
        break;
      }
      const tp1Hit = d === 1 ? c.high >= plan.tp1 : c.low <= plan.tp1;
      if (tp1Hit) return { outcome: 'missed', R: 0 };
    }
    if (entry == null) return { outcome: 'expired', R: 0 };
  }
  const risk = d * (entry - plan.stop);
  if (!(risk > 0)) return { outcome: 'invalid', R: 0 };
  const Rof = (p) => (d * (p - entry)) / risk;
  const feeR = (fee * 2 * entry) / risk; // giriş + çıkış komisyonu (birim başına)
  let stop = plan.stop, portion = 1, R = 0, mfe = 0, mae = 0, outcome = 'timeout', exitI = fillI, tp1Bars = null;
  const ts = o.timeStop && o.timeStop.bars > 0 ? { minMfeR: Infinity, ...o.timeStop } : null;
  const stopFill = (s) => s * (1 - d * slip);
  const scheme = o.tpScheme || 'half_be';
  const single = scheme === 'single', trailOnly = scheme === 'trail_only';
  const atr = plan.atr || Math.abs(entry - plan.stop);
  // Dolum mumunda hedefe izin (limit dolum): count → evet, skip → hayır, lower → alt TF sırası
  const fb = mkt ? 'count' : (o.fillBarTp || 'count');
  const fillRes = fb === 'lower' ? fillOrder(plan, d, candles[fillI].time, ms, o.lowerCandles, single || trailOnly ? plan.tp2 : plan.tp1) : null;
  const fillTpOk = fb === 'count' || fillRes === 'tp';
  for (let k = fillI; k < candles.length && k < fillI + o.maxHoldBars; k++) {
    const c = candles[k];
    const hiR = Rof(d === 1 ? c.high : c.low), loR = Rof(d === 1 ? c.low : c.high);
    if (hiR > mfe) mfe = hiR; if (loR < mae) mae = loR;
    const stopHit = d === 1 ? c.low <= stop : c.high >= stop;
    const tp1Hit = !single && !trailOnly && (d === 1 ? c.high >= plan.tp1 : c.low <= plan.tp1);
    const tp2Hit = !trailOnly && (d === 1 ? c.high >= plan.tp2 : c.low <= plan.tp2);
    // Dolum mumunda (piyasa girişte) stop ve hedef aynı mumdaysa stop sayılır (sıra bilinmez)
    if (stopHit && (k > fillI || mkt || fillRes === 'stop' || !fillTpOk || !(tp1Hit || (single && tp2Hit)))) { R += portion * Rof(stopFill(stop)); outcome = portion === 1 ? 'stopped' : 'tp1_be'; exitI = k; portion = 0; break; }
    if (portion === 1 && tp1Hit && (k > fillI || fillTpOk)) {
      R += o.tp1Portion * Rof(plan.tp1); portion -= o.tp1Portion; tp1Bars = k - fillI + 1;
      if (scheme === 'half_be') stop = entry; // başabaş
      if (scheme === 'trail') stop = d === 1 ? Math.max(stop, c.close - o.trailAtr * atr) : Math.min(stop, c.close + o.trailAtr * atr);
      if (tp2Hit && scheme !== 'trail') { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
      continue;
    }
    if (portion < 1 && portion > 0) {
      if (scheme === 'trail') { const ns = d === 1 ? c.close - o.trailAtr * atr : c.close + o.trailAtr * atr; if (d * (ns - stop) > 0) stop = ns; }
      else if (tp2Hit) { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
    }
    if (single && tp2Hit && (k > fillI || fillTpOk)) { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
    if (trailOnly) { const ns = d === 1 ? c.close - o.trailAtr * atr : c.close + o.trailAtr * atr; if (d * (ns - stop) > 0) stop = ns; }
    exitI = k;
    // Zaman stopu: TP1 görülmeden bars mum doldu (ve ilerleme yetersiz) → mum kapanışından çık
    if (ts && portion === 1 && k - fillI + 1 >= ts.bars && mfe < ts.minMfeR) { R += Rof(c.close * (1 - d * slip)); outcome = 'time_stop'; portion = 0; break; }
  }
  if (portion > 0) { const c = candles[Math.min(exitI, candles.length - 1)]; R += portion * Rof(c.close * (1 - d * slip)); outcome = portion === 1 ? 'timeout' : 'tp1_timeout'; }
  R -= feeR;
  return { outcome, R: +R.toFixed(3), mfe: +mfe.toFixed(2), mae: +mae.toFixed(2), bars: exitI - fillI, tp1Bars, waitBars: fillI - from + 1, entryFill: +entry.toPrecision(6), approachAtr: appr?.approachAtr ?? null, fillBarAtr: appr?.fillBarAtr ?? null, confirmed: mkt && !plan.inZone };
}

/** Bir sembol+TF serisini baştan sona tarar; planları simüle eder. */
export function simulateSeries({ coin, instId, tf, candles }, o = BT_DEFAULTS, hooks = {}) {
  const W = barsFor(tf), step = o.step[tf] || 1;
  const trades = [], sent = [];
  for (let t = W; t < candles.length - 1; t += step) {
    const window = candles.slice(t - W + 1, t + 1);
    const row = analyzeRow({ coin, instId, tf, candles: window, live: null }, { ids: o.detectors, weights: o.weights });
    if (row.error || !row.best) continue;
    const plan = buildPlan(row, o.plan);
    if (!plan.ok) continue;
    const now = candles[t].time;
    if (onCooldown(plan, sent, now, o.cooldownHours)) continue;
    sent.push({ key: plan.key, coin, direction: plan.direction, tf, sentAt: now });
    const sim = simulateTrade(plan, candles, t + 1, tf, o);
    trades.push({
      coin, tf, direction: plan.direction, time: now, score: plan.score, rr: plan.rr, rr1: plan.rr1, riskPct: plan.riskPct, inZone: plan.inZone,
      groups: plan.groups, detectors: [...new Set(plan.signals.map((s) => s.detector))], names: [...new Set(plan.signals.map((s) => s.name))],
      entry: plan.entry, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, zone: plan.zone, price: plan.price, atr: plan.atr,
      ...sim, plan: { ...plan, signals: plan.signals.map((s) => ({ name: s.name, group: s.group, detector: s.detector, direction: s.direction, strength: s.strength, status: s.status, zone: s.zone, note: s.note })) },
    });
    hooks.onTrade?.(trades[trades.length - 1]);
  }
  return trades;
}
