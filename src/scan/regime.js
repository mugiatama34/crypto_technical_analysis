// Piyasa rejimi: BTC günlük kapanışı günlük EMA50'nin üstünde mi (yükseliş) / altında mı (düşüş).
// Yalnız verilen zamana kadar KAPANMIŞ günlere bakar (geleceğe bakmaz). Laboratuvar ve canlı bot ortak kullanır.
import { ema } from '../data/indicators.js';

const DAY = 86400e3;

/** time anına kadar kapanmış son günün kapanışı ve EMA50'si; veri yetmezse null. */
export function dailyTrendAt(daily, time) {
  if (!daily || !daily.length) return null;
  if (!daily._e50) Object.defineProperty(daily, '_e50', { value: ema(daily.map((c) => c.close), 50), enumerable: false });
  let k = -1;
  for (let j = 0; j < daily.length; j++) { if (daily[j].time + DAY <= time) k = j; else break; }
  if (k < 0 || daily._e50[k] == null) return null;
  return { close: daily[k].close, ema50: daily._e50[k], up: daily[k].close > daily._e50[k], time: daily[k].time };
}

/** true: yükseliş rejimi; veri yoksa false. */
export const regimeUp = (daily, time) => dailyTrendAt(daily, time)?.up === true;

/** Canlı: 'up' | 'down' | null (veri yok). */
export function regimeNow(daily, now = Date.now()) {
  const t = dailyTrendAt(daily, now);
  return t ? (t.up ? 'up' : 'down') : null;
}
