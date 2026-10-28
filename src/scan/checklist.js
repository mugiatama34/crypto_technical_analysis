// İşlem check list'i (kullanıcı onayı 28.10.2026): 8 madde (28.10: 'hedefte likidite' ve '≥ 2 yöntem' ölçümde bilgi vermediği için çıkarıldı), her biri ✓ / ✗ / ? (veri yok). ev = ölçüm sonucu (checklist.mjs,
// 28.10, 12 ay 1H/4H): sağlam / zayıf + / tutarsız / olumsuz / etkisiz. Madde sayısı ve ağırlıklı puan doğrulamada ayırt etmedi. Saf fonksiyonlar; veri dışarıdan.
import { regimeNow, horizonTrend } from './regime.js';
import { approachOf, isKnife, knifeGuardOf, isWeekendUtc } from '../../bot/plan.js';

export const MIN_STOP_PCT = 0.8; // madde 7: stop mesafesi ≥ %0,8 (komisyon R'nin < 0,15'i)

export const CHECKS = [
  { id: 'btc', label: 'BTC günlük rejimi aynı yönde', ev: 'tutarsız', hint: 'BTC günlük kapanışı EMA50 üstünde → long, altında → short. Ölçüm (12 ay, 47 bin işlem): eğitimde +0,15R, doğrulamada −0,11R, hedge\'li ≈ 0 → girişte BTC rejimi sonucu önceden söylemiyor.' },
  { id: 'htf', label: 'Coin\'in üst TF trendi aynı yönde', ev: 'tutarsız', hint: '15m→1H, 1H→4H, 4H→1D: EMA50 tarafı + eğimi + ADX/DI. Tüm planlarda eğitim +0,07R, doğrulama −0,09R; canlı 4H birleşiminin içinde filtre (orada ölçülemez).' },
  { id: 'rs', label: 'BTC\'ye göre güç işlem yönünde', ev: 'zayıf +', hint: 'Long: coin/BTC oranı EMA50 üstünde ve yükseliyor; short: tersi. Canlı 4H içinde +0,04 / +0,03R (hedge\'li +0,09 / +0,06), n ≈ 115; tüm planlarda ≈ 0.' },
  { id: 'limit', label: 'Limit giriş (fiyat bölgede değil)', ev: 'sağlam', hint: 'Fiyat bölgeye gelmeden emir. +0,04 / +0,07R, hedge\'li de (+0,05 / +0,06). Canlıda filtre.' },
  { id: 'slow', label: 'Bölgeye yavaş yaklaşıyor (düşen bıçak değil)', ev: 'zayıf +', hint: 'Son 3 mumda hareket < 2 ATR ve son mum < 1,5 ATR. Canlı 4H içinde +0,02 / +0,11R (hedge\'li +0,03 / +0,06); tüm planlarda tutarsız.' },
  { id: 'weekday', label: 'Hafta içi (UTC Cumartesi/Pazar değil)', ev: 'sağlam', hint: '+0,03 / +0,03R, hedge\'li +0,04 / +0,04. Canlıda filtre.' },
  { id: 'stop', label: `Stop mesafesi ≥ %${String(MIN_STOP_PCT).replace('.', ',')}`, ev: 'sağlam', hint: 'Dar stopta komisyon R\'yi yer. En güçlü madde: +0,22 / +0,22R, hedge\'li +0,32 / +0,32 (1H\'de belirleyici; 4H stopları zaten geniş).' },
  { id: 'path', label: 'Giriş→TP1 yolunda ters FVG/OB yok', ev: 'zayıf +', hint: 'Canlı 4H içinde +0,19 / +0,01R (hedge\'li +0,13 / +0,06), n ≈ 70; tüm planlarda ≈ 0. Sonuçsuz.' },
];

const DEAD = new Set(['mitigated', 'invalid', 'done']);

/**
 * @param plan       botun buildPlan çıktısı (ok) — giriş/stop/TP, inZone, riskPct, groups, trend (rsSide/rsBtc)
 * @param candles    satırın mumları (kapanmış + canlı), son mum = şimdi
 * @param btcDaily   BTC 1D mumları (yoksa madde 1 = ?)
 * @param upCandles  coin'in üst TF mumları (yoksa madde 2 = ?)
 * @param smc        aynı seride fvg / orderblock / liquidity detektör sinyalleri (preset'ten bağımsız)
 * @returns {{ items: {id,label,ev,hint,ok,detail}[], n, known, of }}
 */
export function checklistOf({ plan, candles, btcDaily = null, upCandles = null, smc = [], coin = '', now = Date.now() }) {
  const d = plan.d, dir = d === 1 ? 'up' : 'down', atr = plan.atr, oppo = d === 1 ? 'short' : 'long';
  const res = {};
  // 1) BTC günlük rejimi
  const reg = btcDaily?.length ? regimeNow(btcDaily, now) : null;
  res.btc = reg ? { ok: reg === dir, detail: `BTC rejimi ${reg === 'up' ? 'yükseliş' : 'düşüş'}` } : { ok: null, detail: 'BTC günlük verisi yok' };
  // 2) Üst TF trendi
  const ht = upCandles?.length ? horizonTrend(upCandles) : null;
  res.htf = ht ? { ok: ht.dir === dir, detail: `üst TF: ${ht.dir === 'up' ? 'yükseliş' : ht.dir === 'down' ? 'düşüş' : 'yatay'}` } : { ok: null, detail: 'üst TF verisi yok' };
  // 3) BTC'ye göre güç
  const t = plan.trend || {};
  if (coin === 'BTC') res.rs = { ok: null, detail: 'BTC için yok' };
  else if (t.rsSide == null || t.rsBtc == null) res.rs = { ok: null, detail: 'göreli güç bilinmiyor (BTC taranmadı)' };
  else { const strong = t.rsSide > 0 && t.rsBtc > 0, weak = t.rsSide < 0 && t.rsBtc < 0; res.rs = { ok: d === 1 ? strong : weak, detail: `vs BTC ${t.rsBtc > 0 ? '+' : ''}${t.rsBtc}% (${t.rsSide > 0 ? 'güçlü' : 'zayıf'})` }; }
  // 4) Limit giriş
  res.limit = { ok: !plan.inZone, detail: plan.inZone ? 'fiyat bölgede (piyasa girişi)' : 'bölge bekleniyor' };
  // 5) Yaklaşma hızı (son mum)
  const a = candles?.length ? approachOf(candles, candles.length - 1, d, atr) : null;
  res.slow = a ? { ok: !isKnife(a, knifeGuardOf('1')), detail: `son 3 mum ${a.approachAtr}×ATR, son mum ${a.fillBarAtr}×ATR` } : { ok: null, detail: 'mum yok' };
  // 6) Hafta içi
  res.weekday = { ok: !isWeekendUtc(now), detail: isWeekendUtc(now) ? 'hafta sonu (UTC)' : 'hafta içi' };
  // 7) Stop mesafesi
  res.stop = { ok: plan.riskPct >= MIN_STOP_PCT, detail: `stop %${String(plan.riskPct).replace('.', ',')}` };
  // 8) Yolda ters FVG/OB (giriş ile TP1 arası, girişten 0,1 ATR öte)
  const lo = Math.min(plan.entry + d * 0.1 * atr, plan.tp1), hi = Math.max(plan.entry + d * 0.1 * atr, plan.tp1);
  const block = smc.find((s) => (s.type === 'fvg' || s.type === 'orderblock') && s.direction === oppo && !DEAD.has(s.status) && s.zone && s.zone[1] > lo && s.zone[0] < hi);
  res.path = { ok: !block, detail: block ? `yolda: ${block.name}` : 'yol temiz' };
  const items = CHECKS.map((c) => ({ ...c, ...res[c.id] }));
  return { items, n: items.filter((x) => x.ok === true).length, known: items.filter((x) => x.ok != null).length, of: items.length };
}
