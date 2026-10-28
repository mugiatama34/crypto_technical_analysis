// İşlem check list'i (kullanıcı onayı 28.10.2026): 10 madde, her biri ✓ / ✗ / ? (veri yok). Madde sayısı başarı olasılığı
// DEĞİLDİR: maddeler eşit ağırlıkta değil (kazancın çoğu BTC yönünden) ve 8–10 ölçülmedi. Saf fonksiyonlar; veri dışarıdan.
import { regimeNow, horizonTrend } from './regime.js';
import { approachOf, isKnife, knifeGuardOf, isWeekendUtc } from '../../bot/plan.js';

export const MIN_STOP_PCT = 0.8; // madde 7: stop mesafesi ≥ %0,8 (komisyon R'nin < 0,15'i)

export const CHECKS = [
  { id: 'btc', label: 'BTC günlük rejimi aynı yönde', ev: 'ölçüldü', hint: 'BTC günlük kapanışı EMA50 üstünde → long, altında → short. Kazancın ana kaynağı.' },
  { id: 'htf', label: 'Coin\'in üst TF trendi aynı yönde', ev: 'ölçüldü', hint: '15m→1H, 1H→4H, 4H→1D: EMA50 tarafı + eğimi + ADX/DI. Canlıda filtre.' },
  { id: 'rs', label: 'BTC\'ye göre güç işlem yönünde', ev: 'ölçüldü', hint: 'Long: coin/BTC oranı EMA50 üstünde ve yükseliyor; short: tersi. Zayıf pozitif.' },
  { id: 'limit', label: 'Limit giriş (fiyat bölgede değil)', ev: 'ölçüldü', hint: 'Fiyat bölgeye gelmeden emir. Canlıda filtre.' },
  { id: 'slow', label: 'Bölgeye yavaş yaklaşıyor (düşen bıçak değil)', ev: 'ölçüldü', hint: 'Son 3 mumda hareket < 2 ATR ve son mum < 1,5 ATR. +0,02R.' },
  { id: 'weekday', label: 'Hafta içi (UTC Cumartesi/Pazar değil)', ev: 'ölçüldü', hint: 'Hafta sonu girişleri her TF\'de daha kötü. Canlıda filtre.' },
  { id: 'stop', label: `Stop mesafesi ≥ %${String(MIN_STOP_PCT).replace('.', ',')}`, ev: 'kural', hint: 'Dar stopta komisyon R\'yi yer (SUI 27.10: komisyon 0,28R).' },
  { id: 'path', label: 'Giriş→TP1 yolunda ters FVG/OB yok', ev: 'ölçülmedi', hint: 'Yolda ters yönlü, dokunulmamış FVG ya da order block fiyatı durdurabilir.' },
  { id: 'magnet', label: 'Hedef yakınında likidite mıknatısı var', ev: 'ölçülmedi', hint: 'TP1/TP2 çevresinde (±1 ATR) ya da aralarında alınmamış eşit tepe/dip, önceki gün/hafta ucu.' },
  { id: 'confl', label: 'Kümede en az 2 farklı yöntem', ev: 'ölçülmedi', hint: 'Aynı bölgede ör. yapı/SMC + fib/Elliott (mum formasyonu ve indikatör sayılmaz: teyit, yöntem değil). Puanın parçası, tek başına ölçülmedi.' },
];

const lvlOf = (s) => s.meta?.level ?? (s.zone ? (s.zone[0] + s.zone[1]) / 2 : null);
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
  // 9) Hedef yakınında likidite (alınmamış havuz / önceki gün-hafta ucu)
  const pools = smc.filter((s) => s.type === 'liquidity' && s.direction === 'neutral').map((s) => ({ s, lv: lvlOf(s) })).filter((x) => x.lv != null && d * (x.lv - plan.entry) > 0);
  const near = pools.find(({ lv }) => Math.abs(lv - plan.tp1) <= atr || Math.abs(lv - plan.tp2) <= atr || (d * (lv - plan.tp1) >= 0 && d * (plan.tp2 - lv) >= 0));
  res.magnet = { ok: !!near, detail: near ? `hedefte: ${near.s.name}` : (pools.length ? 'havuz var ama hedeften uzak' : 'yakında likidite havuzu görülmedi') };
  // 10) Çakışma: en iyi kümede ≥ 2 farklı grup
  const groups = [...new Set(plan.groups || [])].filter((g) => g !== 'candle' && g !== 'indicator');
  res.confl = { ok: groups.length >= 2, detail: `${groups.length} grup${groups.length ? `: ${groups.join(', ')}` : ''}` };

  const items = CHECKS.map((c) => ({ ...c, ...res[c.id] }));
  return { items, n: items.filter((x) => x.ok === true).length, known: items.filter((x) => x.ok != null).length, of: items.length };
}
