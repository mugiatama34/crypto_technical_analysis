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
  // 'be_trail' (13.11): TP1/erken hedefte kısım kapanır + stop girişe; kalan, en iyi kapanışın trailAtr × ATR gerisinden izlenir
  // (yalnız MFE ≥ trailActR olunca başlar, stop yalnız lehe gider). trailKeepTp2: TP2'de yine tam çıkış.
  trailActR: 0,
  // Ara hedef (13.11): plan.tpMid varsa ilk kısmi çıkıştan sonra orada midPortion (başlangıç adedinin payı) kapanır
  midPortion: 0.25,
  midStopToTp1: false, // ara hedef görülünce stop ilk kısmi çıkış fiyatına (erken hedef) çekilir
  trailKeepTp2: false,
  knifeGuard: null, // düşen bıçak koruması (bot/plan.js KNIFE_DEFAULTS); null = kapalı
  // Bıçak kararının girdisi (13.11): 'touch' (varsayılan, canlı gibi: dolum mumunun yalnız girişe dokunma anına kadarki kısmı;
  // o.lowerCandles varsa dokunma anı alt TF'den) | 'full' (eski: tam dolum mumu, dokunmadan sonraki dip de karara girer → iyimser)
  // | 'lowerBar' (13.11, K1): üst mumun başından girişe ilk dokunan alt TF mumunun SONUNA kadar (o alt mum tam dahil; 15 dk'lık
  // turdaki bot dokunan 15m mum kapanınca bunu görür). Alt TF 15m ise canlıyla aynı; 1H ise dokunmadan sonraki ≤ 1 saati de
  // görür → canlıya göre hafif iyimser. Alt TF yoksa 'touch' gibi. Varsayılan 'touch' (kötümser sınır) kalır.
  knifeBar: 'touch',
  // Limit dolum mumunda hedef (TP1 / tek hedef): 'count' (varsayılan, iyimser: önce dolum sonra hedef varsayılır) |
  // 'skip' (kötümser: dolum mumunda hedef sayılmaz) | 'lower' (alt TF mumlarıyla sıra: o.lowerCandles, dolumdan SONRAKİ
  // alt mumlarda stop görülmeden hedef görülürse sayılır; dolumun alt mumunda stop varsa stop)
  fillBarTp: 'count',
  lowerCandles: null,
  timeStop: null, // zaman stopu { bars, minMfeR }: dolumdan bars mum içinde TP1 yoksa (ve MFE < minMfeR) kapanıştan çık
  plan: { minScore: 50, minRR: 2, maxRiskPct: 5 },
  detectors: null, weights: {},
};

/**
 * Dolum mumunun girişe dokunma anına kadarki kısmı (canlı bot 15 dk'lık turda bu yarım mumla bıçak kararı verir).
 * Long: dip = min(giriş, açılış) (dokunmadan sonraki düşüş bilinmez); tepe = dokunmadan önceki en yüksek. Short ayna.
 * Alt TF mumları (lower) varsa: dokunmadan önceki alt mumların tepesi + dokunan alt mumun açılışı ya da (açılış girişin
 * berisindeyse) tepesi. Alt TF yoksa dokunan mumun tepesi tamamı sayılır: dokunmadan sonraki tepki de bıçak saydırabilir →
 * korumaya karşı kötümser, iyimser değil. Açılış girişin ötesindeyse (boşluk) dokunma açılışta: tepe = dip = açılış.
 */
export function touchBar(plan, d, c, ms, lower) {
  const e = plan.entry, gap = (x) => (d === 1 ? x.open <= e : x.open >= e);
  const part = (x, pre) => { // x: dokunan mum; pre: dokunmadan önceki uç (yoksa null)
    if (gap(x)) { const p = pre == null ? x.open : d === 1 ? Math.max(pre, x.open) : Math.min(pre, x.open); return d === 1 ? { high: p, low: x.open } : { high: x.open, low: p }; }
    const far = d === 1 ? x.high : x.low, p = pre == null ? far : d === 1 ? Math.max(pre, far) : Math.min(pre, far);
    return d === 1 ? { high: p, low: e } : { high: e, low: p };
  };
  if (lower?.length && ms) {
    let lo = 0, hi = lower.length - 1, s0 = lower.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (lower[m].time >= c.time) { s0 = m; hi = m - 1; } else lo = m + 1; }
    if (s0 < lower.length && lower[s0].time === c.time) { // alt TF mumu üst mumun başından itibaren var
      let pre = null;
      for (let j = s0; j < lower.length && lower[j].time < c.time + ms; j++) {
        const x = lower[j];
        if (d === 1 ? x.low <= e : x.high >= e) return { time: c.time, open: c.open, close: e, ...part(x, pre) };
        pre = pre == null ? (d === 1 ? x.high : x.low) : d === 1 ? Math.max(pre, x.high) : Math.min(pre, x.low);
      }
    }
  }
  return { time: c.time, open: c.open, close: e, ...part(c, null) };
}

/**
 * knifeBar 'lowerBar': üst mumun başından girişe ilk dokunan alt TF mumunun sonuna kadarki kısım (tepe/dip o aralığın uçları,
 * kapanış o alt mumun kapanışı). Canlı bot 15 dk'lık turda kapanmamış 4H mumu tam bu haliyle görüp karar verir.
 * Alt TF mumları üst mumun başından yoksa ya da hiçbiri girişe dokunmuyorsa touchBar (yedek kural).
 */
export function lowerBar(plan, d, c, ms, lower) {
  const e = plan.entry;
  if (lower?.length && ms) {
    let lo = 0, hi = lower.length - 1, s0 = lower.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (lower[m].time >= c.time) { s0 = m; hi = m - 1; } else lo = m + 1; }
    if (s0 < lower.length && lower[s0].time === c.time) {
      let h = -Infinity, l = Infinity;
      for (let j = s0; j < lower.length && lower[j].time < c.time + ms; j++) {
        const x = lower[j];
        h = Math.max(h, x.high); l = Math.min(l, x.low);
        if (d === 1 ? x.low <= e : x.high >= e) return { time: c.time, open: c.open, high: h, low: l, close: x.close };
      }
    }
  }
  return touchBar(plan, d, c, ms, lower);
}

/** Tek plan simülasyonu. candles: tüm seri; from: planın oluştuğu mumdan sonraki ilk indeks. */
export function simulateTrade(plan, candles, from, tf, o = BT_DEFAULTS) {
  const d = plan.d, ms = TIMEFRAMES[tf].ms;
  // plan.expireBars: planın kendi limit süresi (ör. fib kesişiminde C dalgasının zaman sınırı); genel süreyi aşamaz
  const expireBars = Math.min(Math.ceil((o.expireHours * 3600e3) / ms), plan.expireBars ?? Infinity);
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
        const aAtr = plan.atr || Math.abs(plan.entry - plan.stop);
        appr = o.knifeBar === 'full' ? approachOf(candles, i, d, aAtr)
          : approachOf([candles[i - 2], candles[i - 1], (o.knifeBar === 'lowerBar' ? lowerBar : touchBar)(plan, d, c, ms, o.lowerCandles)], 2, d, aAtr);
        if (!isKnife(appr, g)) { entry = plan.entry; fillI = i; break; }
        // Hızlı yaklaşma: emir dolmaz; teyit mumu beklenir (kapanışından giriş), teyitten önce stop = iptal
        const stopOf = (x) => (d === 1 ? x.low <= plan.stop : x.high >= plan.stop);
        if (g.skip || stopOf(c)) return { outcome: 'knife', R: 0, ...appr };
        for (let k = i + 1; k <= i + g.confirmBars && k < candles.length; k++) {
          const x = candles[k];
          if (stopOf(x)) return { outcome: 'knife', R: 0, ...appr };
          if (confirmsTurn(x, candles[k - 1], plan)) {
            if (d * ((plan.missTp ?? plan.tp1) - x.close) <= 0) return { outcome: 'missed', R: 0, ...appr };
            entry = x.close * (1 + d * slip); fillI = k + 1; mkt = true;
            // CE (13.11): erken hedefli planda (plan.tp1 = erken hedef, missTp = özgün TP1) erken hedef yeni girişe aynı %
            // uzaklıkla taşınır (canlı A2: kapanış × erken / planlanan giriş). Ara kademe (tpMid = özgün TP1) taşınmaz; taşınan
            // erken hedef onu geçtiyse ara kademe yok (canlı midOk). Erken hedefsiz planda (missTp yok) tp1 özgün TP1: dokunulmaz.
            if (plan.missTp != null) {
              const tp1 = +(x.close * (plan.tp1 / plan.entry)).toPrecision(8);
              plan = { ...plan, tp1, ...(plan.tpMid && !(d * (plan.tpMid - tp1) > 0) ? { tpMid: null } : {}) };
            }
            break;
          }
        }
        if (entry == null) return { outcome: 'expired', R: 0, knifeWait: true, ...appr };
        if (fillI >= candles.length) return { outcome: 'expired', R: 0, ...appr };
        break;
      }
      const missAt = plan.missTp ?? plan.tp1; // canlı takip gibi: 'kaçtı' plandaki özgün TP1'e göre (erken hedefe göre değil)
      const tp1Hit = d === 1 ? c.high >= missAt : c.low <= missAt;
      if (tp1Hit) return { outcome: 'missed', R: 0 };
    }
    if (entry == null) return { outcome: 'expired', R: 0 };
  }
  const risk = d * (entry - plan.stop);
  if (!(risk > 0)) return { outcome: 'invalid', R: 0 };
  const Rof = (p) => (d * (p - entry)) / risk;
  const feeR = (fee * 2 * entry) / risk; // giriş + çıkış komisyonu (birim başına)
  let stop = plan.stop, portion = 1, R = 0, mfe = 0, mae = 0, outcome = 'timeout', exitI = fillI, tp1Bars = null, midDone = false;
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
      if (scheme === 'half_be' || scheme === 'be_trail') stop = entry; // başabaş
      if (scheme === 'trail') stop = d === 1 ? Math.max(stop, c.close - o.trailAtr * atr) : Math.min(stop, c.close + o.trailAtr * atr);
      if (plan.tpMid && portion > 0 && (d === 1 ? c.high >= plan.tpMid : c.low <= plan.tpMid)) { const q = Math.min(o.midPortion, portion); R += q * Rof(plan.tpMid); portion -= q; midDone = true; if (o.midStopToTp1) stop = plan.tp1; }
      if (tp2Hit && scheme !== 'trail' && (scheme !== 'be_trail' || o.trailKeepTp2)) { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
      continue;
    }
    if (portion < 1 && portion > 0 && plan.tpMid && !midDone && (d === 1 ? c.high >= plan.tpMid : c.low <= plan.tpMid)) { const q = Math.min(o.midPortion, portion); R += q * Rof(plan.tpMid); portion -= q; midDone = true; if (o.midStopToTp1) stop = plan.tp1; if (portion <= 1e-9) { outcome = 'tp2'; exitI = k; portion = 0; break; } }
    if (portion < 1 && portion > 0) {
      if (scheme === 'trail') { const ns = d === 1 ? c.close - o.trailAtr * atr : c.close + o.trailAtr * atr; if (d * (ns - stop) > 0) stop = ns; }
      else if (scheme === 'be_trail') {
        if (o.trailKeepTp2 && tp2Hit) { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
        if (mfe >= (o.trailActR || 0)) { const ns = d === 1 ? c.close - o.trailAtr * atr : c.close + o.trailAtr * atr; if (d * (ns - stop) > 0) stop = ns; }
      } else if (tp2Hit) { R += portion * Rof(plan.tp2); outcome = 'tp2'; exitI = k; portion = 0; break; }
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

/** plans.json.gz'ye yazılan plan: sinyaller kısaltılmış (yalnız ad/grup/detektör/yön/güç/durum/bölge/not). */
export const slimPlan = (plan) => ({ ...plan, signals: plan.signals.map((s) => ({ name: s.name, group: s.group, detector: s.detector, direction: s.direction, strength: s.strength, status: s.status, zone: s.zone, note: s.note })) });

/**
 * Bir sembol+TF serisini baştan sona tarar; planları simüle eder.
 * hooks.onTrade(trade): her simüle edilen plan; hooks.onCooldownSkip({ plan, time }): bekleme süresi (cooldown) yüzünden
 * atlanan geçerli plan (simüle edilmez; 13.11: taramada canlı cooldown sırasını yeniden kurmak için saklanır, run.mjs).
 */
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
    if (onCooldown(plan, sent, now, o.cooldownHours)) { hooks.onCooldownSkip?.({ plan, time: now }); continue; }
    sent.push({ key: plan.key, coin, direction: plan.direction, tf, sentAt: now });
    const sim = simulateTrade(plan, candles, t + 1, tf, o);
    trades.push({
      coin, tf, direction: plan.direction, time: now, score: plan.score, rr: plan.rr, rr1: plan.rr1, riskPct: plan.riskPct, inZone: plan.inZone,
      groups: plan.groups, detectors: [...new Set(plan.signals.map((s) => s.detector))], names: [...new Set(plan.signals.map((s) => s.name))],
      entry: plan.entry, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, zone: plan.zone, price: plan.price, atr: plan.atr,
      ...sim, plan: slimPlan(plan),
    });
    hooks.onTrade?.(trades[trades.length - 1]);
  }
  return trades;
}
