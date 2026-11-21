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
  { id: 'path', label: 'Giriş→TP1 yolunda ters FVG/OB yok', ev: 'zayıf +', hint: '✓/✗ yalnız giriş→TP1 arasındaki ters FVG / iFVG / OB / breaker\'a bakar. Canlı 4H içinde +0,19 / +0,01R (hedge\'li +0,13 / +0,06), n ≈ 70; tüm planlarda ≈ 0. Sonuçsuz. Ayrıntıda TP2\'ye kadarki tüm engeller (R uzaklığı, TP1 öncesi/sonrası) ve yol üstü alınmamış likidite (olası dönüş noktası, karara girmez) listelenir.' },
];

const DEAD = new Set(['mitigated', 'invalid', 'done']);

export const LIQ_WARN_R = 0.3; // hedef, likidite seviyesinin en fazla bu kadar R ötesindeyse uyarı
const fmtR = (x) => `${(Math.round(x * 10) / 10).toFixed(1).replace('.', ',')}R`;
const liqSide = (name = '') => (/^(EQH|PDH|PWH)/.test(name) ? 'H' : /^(EQL|PDL|PWL)/.test(name) ? 'L' : null);

/**
 * Giriş → TP2 yolundaki engeller ve likidite (saf; yalnız gösterim + gölge kayıt, ✓/✗ kararına girmez).
 * Engel  = ters yönlü (long'da short, short'ta long) ve ölü olmayan (mitigated / invalid / done değil) FVG, iFVG, Order Block, Breaker;
 *          bölgesi (giriş + 0,1 ATR, TP2) aralığıyla kesişen. Madde 8'in ✓/✗ kuralıyla aynı küme, yalnız TP2'ye uzatılmış.
 * Likidite = alınmamış havuz / seviye (detektörde direction 'neutral': "EQH/EQL (alınmamış)", "PDH/PDL/PWH/PWL yakın"); süpürülmüş /
 *          kırılmış olanlar (zaten alındı) sayılmaz. Yalnız işlem yönündeki taraf: long → tepe (EQH/PDH/PWH), short → dip (EQL/PDL/PWL);
 *          ters taraftaki seviye girişe dolum için inilirken alınır. Seviye (meta.level) giriş + 0,1 ATR ile TP2 arasında olmalı.
 * r = girişe uzaklık (R = |giriş − stop|): engelde bölgenin girişe yakın kenarı (bölge girişe taşıyorsa 0), likiditede seviye.
 * @returns {{ R, items: {kind:'engel'|'likidite', type, name, zone:[lo,hi], level?, r, beforeTp1}[], n1, n2, firstR, liq, warnings: string[] }}
 */
export function pathObstacles(plan, smc = []) {
  const d = plan.d === -1 ? -1 : 1, R = Math.abs(plan.entry - plan.stop), atr = Number.isFinite(plan.atr) ? plan.atr : 0;
  const tp1 = plan.tp1, tp2 = Number.isFinite(plan.tp2) ? plan.tp2 : tp1, oppo = d === 1 ? 'short' : 'long';
  const empty = { R, items: [], n1: 0, n2: 0, firstR: null, liq: 0, warnings: [] };
  if (!(R > 0) || !Number.isFinite(plan.entry) || !Number.isFinite(tp1)) return empty;
  const start = plan.entry + d * 0.1 * atr;
  const lo = Math.min(start, tp2), hi = Math.max(start, tp2); // engel kesişim aralığı (madde 8 kuralı, TP2'ye uzatılmış)
  const items = [];
  for (const s of Array.isArray(smc) ? smc : []) {
    if (!s || !Array.isArray(s.zone)) continue;
    const zl = Math.min(s.zone[0], s.zone[1]), zh = Math.max(s.zone[0], s.zone[1]);
    if ((s.type === 'fvg' || s.type === 'orderblock') && s.direction === oppo && !DEAD.has(s.status)) {
      if (!(zh > lo && zl < hi)) continue;
      const near = d === 1 ? zl : zh;
      items.push({ kind: 'engel', type: s.type, name: s.name || s.type, zone: [zl, zh], r: Math.max(0, (d * (near - plan.entry)) / R), beforeTp1: d === 1 ? zl < tp1 : zh > tp1 });
    } else if (s.type === 'liquidity' && s.direction === 'neutral') {
      const side = liqSide(s.name);
      if (side !== (d === 1 ? 'H' : 'L')) continue;
      const level = Number.isFinite(s.meta?.level) ? s.meta.level : (zl + zh) / 2;
      if (!(d * (level - start) > 0 && d * (tp2 - level) >= 0)) continue; // giriş + 0,1 ATR ötesi, TP2 dahil
      items.push({ kind: 'likidite', type: 'liquidity', name: s.name, zone: [zl, zh], level, r: (d * (level - plan.entry)) / R, beforeTp1: d * (level - tp1) <= 0 });
    }
  }
  items.sort((a, b) => a.r - b.r || (a.kind === 'engel' ? -1 : 1));
  const obs = items.filter((x) => x.kind === 'engel'), liqs = items.filter((x) => x.kind === 'likidite');
  const warnings = [];
  for (const [lab, t] of [['TP1', tp1], ['TP2', tp2]]) {
    if (lab === 'TP2' && t === tp1) continue;
    for (const l of liqs) {
      const past = (d * (t - l.level)) / R;
      if (past >= 0 && past <= LIQ_WARN_R) { warnings.push(past < 0.05 ? `${lab} likidite seviyesinde (${l.name})` : `${lab} likiditenin ${fmtR(past)} ötesinde (${l.name})`); break; }
    }
  }
  for (const x of items) x.r = +x.r.toFixed(2);
  return { R, items, n1: obs.filter((x) => x.beforeTp1).length, n2: obs.filter((x) => !x.beforeTp1).length, firstR: obs.length ? +obs[0].r.toFixed(2) : null, liq: liqs.length, warnings };
}

export const PATH_COLORS = { engel: '#ff6d3a', engelSonra: '#ffb74d', likidite: '#4dd0e1' };
const shortName = (n = '') => n.replace('Order Block', 'OB').replace(/ \(alınmamış\)| yakın$/, '');

/** Grafik için sözde sinyal: engeller kutu (TP1 öncesi koyu turuncu, sonrası açık), likidite kesikli yatay çizgi (camgöbeği). */
export function pathOverlay(po, lastI, bars = 25) {
  const draw = [];
  for (const x of po?.items || []) {
    if (x.kind === 'engel') draw.push({ kind: 'box', from: Math.max(0, lastI - bars), to: lastI, lo: x.zone[0], hi: x.zone[1], color: x.beforeTp1 ? PATH_COLORS.engel : PATH_COLORS.engelSonra, label: `Engel ${fmtR(x.r)} ${shortName(x.name)}` });
    else draw.push({ kind: 'hline', price: x.level, color: PATH_COLORS.likidite, style: 'dashed', label: `Lik ${fmtR(x.r)} ${shortName(x.name)}` });
  }
  return { id: 'path-obstacles', type: 'path', group: 'smc', name: 'Yol engelleri', direction: 'neutral', strength: 0, zone: null, index: lastI, status: 'active',
    note: 'Giriş→TP2 yolundaki ters FVG / OB (kutu) ve alınmamış likidite (kesikli çizgi); yalnız gösterim.', draw };
}

/** Madde 8 ayrıntı metni: "0,8R FVG ↓ · 1,9R OB ↓ (TP1 sonrası) · likidite: 1,2R EQH (alınmamış) · ⚠ TP1 likiditenin 0,2R ötesinde". */
export function pathDetail(po) {
  const obs = po.items.filter((x) => x.kind === 'engel'), liqs = po.items.filter((x) => x.kind === 'likidite');
  const parts = [];
  if (!obs.length) parts.push('yol temiz (TP2\'ye kadar engel yok)');
  else { if (!po.n1) parts.push('TP1\'e kadar temiz'); parts.push(...obs.map((x) => `${fmtR(x.r)} ${x.name}${x.beforeTp1 ? '' : ' (TP1 sonrası)'}`)); }
  if (liqs.length) parts.push(`likidite: ${liqs.map((x) => `${fmtR(x.r)} ${x.name}${x.beforeTp1 ? '' : ' (TP1 sonrası)'}`).join(', ')}`);
  for (const w of po.warnings) parts.push(`⚠ ${w}`);
  return parts.join(' · ');
}

/**
 * @param plan       botun buildPlan çıktısı (ok) — giriş/stop/TP, inZone, riskPct, groups, trend (rsSide/rsBtc)
 * @param candles    satırın mumları (kapanmış + canlı), son mum = şimdi
 * @param btcDaily   BTC 1D mumları (yoksa madde 1 = ?)
 * @param upCandles  coin'in üst TF mumları (yoksa madde 2 = ?)
 * @param smc        aynı seride fvg / orderblock / liquidity detektör sinyalleri (preset'ten bağımsız)
 * @returns {{ items: {id,label,ev,hint,ok,detail}[], n, known, of }}  (path maddesinde ayrıca `obstacles` = pathObstacles çıktısı)
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
  // Ayrıntı: TP2'ye kadarki tüm engeller + likidite (✓/✗ yukarıdaki kuraldan; liste karara girmez)
  let po = null;
  try { po = pathObstacles(plan, smc); } catch { po = null; }
  res.path = { ok: !block, detail: po ? pathDetail(po) : block ? `yolda: ${block.name}` : 'yol temiz', obstacles: po };
  const items = CHECKS.map((c) => ({ ...c, ...res[c.id] }));
  return { items, n: items.filter((x) => x.ok === true).length, known: items.filter((x) => x.ok != null).length, of: items.length };
}

/** Check list süzgeci (saf): min <= 0 -> geçer; kayıt yok / hatalı (plansız) -> geçmez; değilse n >= min. */
export function passesMinCheck(entry, min) {
  if (!(min > 0)) return true;
  if (!entry || entry.error || !Number.isFinite(entry.n)) return false;
  return entry.n >= min;
}
