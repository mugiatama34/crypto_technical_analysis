// Öğrenilen puan için ortak özellik çıkarımı (bot ve backtest aynı fonksiyonu kullanır). Bağımlılıksız, saf.
import { DETECTORS, GROUPS } from '../src/scan/registry.js';

const DET_IDS = DETECTORS.map((d) => d.id);
const GROUP_IDS = Object.keys(GROUPS);
const TFS = ['15m', '1H', '4H'];

export const FEATURE_NAMES = [
  ...DET_IDS.map((d) => `det:${d}`),
  ...GROUP_IDS.map((g) => `grp:${g}`),
  'sigCount/10', 'score/100', 'riskPct/5',
  ...TFS.map((t) => `tf:${t}`), 'tf:other',
  'dir:long', 'inZone',
  'adx:<20', 'adx:20-35', 'adx:>35', 'adx:aligned', 'adx:aligned&>35',
  'ema200:side', 'mtf',
  'hour:0-5', 'hour:6-11', 'hour:12-17', 'hour:18-23',
];

/**
 * @param plan  { signals:[{detector,group}], score, riskPct, tf, direction, inZone, time }
 * @param ctx   { adx, pdi, mdi, ema200, price, mtf:boolean }
 * @returns number[] (FEATURE_NAMES sırasıyla)
 */
export function featuresOf(plan, ctx = {}) {
  const dets = new Set((plan.signals || []).map((s) => s.detector));
  const grps = new Set((plan.signals || []).map((s) => s.group));
  const d = plan.direction === 'long' ? 1 : -1;
  const adx = ctx.adx ?? null;
  const aligned = ctx.pdi != null && ctx.mdi != null ? (d === 1 ? ctx.pdi > ctx.mdi : ctx.mdi > ctx.pdi) : false;
  const emaSide = ctx.ema200 != null && ctx.price != null ? d * (ctx.price - ctx.ema200) > 0 : false;
  const hour = plan.time ? new Date(plan.time).getUTCHours() : 12;
  const f = [
    ...DET_IDS.map((x) => (dets.has(x) ? 1 : 0)),
    ...GROUP_IDS.map((g) => (grps.has(g) ? 1 : 0)),
    Math.min(3, (plan.signals?.length || 0) / 10), Math.min(1.5, (plan.score || 0) / 100), Math.min(2, (plan.riskPct || 0) / 5),
    ...TFS.map((t) => (plan.tf === t ? 1 : 0)), TFS.includes(plan.tf) ? 0 : 1,
    d === 1 ? 1 : 0, plan.inZone ? 1 : 0,
    adx != null && adx < 20 ? 1 : 0, adx != null && adx >= 20 && adx <= 35 ? 1 : 0, adx != null && adx > 35 ? 1 : 0, aligned ? 1 : 0, aligned && adx > 35 ? 1 : 0,
    emaSide ? 1 : 0, ctx.mtf ? 1 : 0,
    hour < 6 ? 1 : 0, hour >= 6 && hour < 12 ? 1 : 0, hour >= 12 && hour < 18 ? 1 : 0, hour >= 18 ? 1 : 0,
  ];
  return f;
}

/** Lojistik model olasılığı. model = { weights:number[], bias:number } */
export function modelProb(model, x) {
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += (model.weights[i] || 0) * x[i];
  return 1 / (1 + Math.exp(-z));
}

/**
 * L2 cezalı lojistik regresyon (tam yığın gradient descent).
 * @returns {{ weights, bias, loss }}
 */
export function trainLogistic(X, y, { epochs = 400, lr = 0.2, l2 = 1e-3, weightPos = 1 } = {}) {
  const n = X.length, m = X[0]?.length || 0;
  const w = new Array(m).fill(0); let b = 0;
  let loss = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(m).fill(0); let gb = 0; loss = 0;
    for (let i = 0; i < n; i++) {
      const x = X[i]; let z = b; for (let j = 0; j < m; j++) z += w[j] * x[j];
      const p = 1 / (1 + Math.exp(-z));
      const wt = y[i] ? weightPos : 1;
      const err = (p - y[i]) * wt;
      for (let j = 0; j < m; j++) gw[j] += err * x[j];
      gb += err;
      loss += -wt * (y[i] ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
    }
    for (let j = 0; j < m; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
    loss /= n;
  }
  return { weights: w.map((v) => +v.toFixed(5)), bias: +b.toFixed(5), loss: +loss.toFixed(4) };
}
