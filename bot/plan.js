// Aday plan çıkarma ve takip (saf fonksiyonlar, ağ yok).
// Tarama satırından (scanner.js Row) giriş bölgesi / stop / TP1 / TP2 / R:R üretir; risk kurallarını uygular;
// gönderilmiş planların durumunu (bekliyor → aktif → TP1 → tamam | stop | süresi doldu) mumlarla günceller.
import { TIMEFRAMES } from '../src/data/okx.js';

export const PLAN_DEFAULTS = {
  minScore: 50, // en iyi küme puanı
  minRR: 2, // TP2'ye göre R:R
  minRR1: 1, // TP1'e göre R:R
  riskPct: 1, // hesap yüzdesi
  stopPadAtr: 0.3, // stop: bölge kenarının bu × ATR ötesi
  minRiskAtr: 0.6, // giriş–stop en az bu × ATR
  maxRiskAtr: 3, // giriş–stop en fazla bu × ATR (daha uzak geçersizlik seviyeleri yok sayılır)
  maxRiskPct: 5, // giriş–stop fiyatın bu %'sinden fazlaysa plan üretilmez
  maxZoneAtr: 1.5, // giriş bölgesi bundan genişse fiyata yakın kenardan bu kadar dilim alınır
  maxDistAtr: 3, // fiyat bölgeye bundan uzaksa plan üretilmez
  requireMtf: false,
  expireHours: 24, // bekleyen plan bu kadar saatte dolmazsa düşer
  cooldownHours: 6, // aynı anahtar bu sürede tekrar gönderilmez
};

const dirSign = (d) => (d === 'long' ? 1 : -1);

/**
 * Kural birleştirme: genel (base) ← TF kuralı ← TF'nin yön alt kuralı (rules[tf].long / .short) ← shortRule (short için).
 * shortRule.scoreAdd TF eşiğine eklenir; ADX ve cooldown'da sıkı olan (büyük) korunur.
 */
export function mergeRule(tf, direction, rules = {}, shortRule = null, base = {}) {
  const { long: L, short: S, ...tfRule } = rules[tf] || {};
  const r = { ...base, ...tfRule, ...(direction === 'long' ? L : direction === 'short' ? S : {}) };
  if (direction !== 'short' || !shortRule) return r;
  const { scoreAdd = 0, ...sr } = shortRule;
  const out = { ...r, ...sr, minScore: (r.minScore || 0) + scoreAdd };
  if (r.trendAdxMin && sr.trendAdxMin) out.trendAdxMin = Math.max(r.trendAdxMin, sr.trendAdxMin);
  if (r.cooldownHours && sr.cooldownHours) out.cooldownHours = Math.max(r.cooldownHours, sr.cooldownHours);
  if (r.maxPerRun) out.maxPerRun = r.maxPerRun;
  return out;
}
const r4 = (x) => +x.toPrecision(6);

/** En iyi küme yalnız bir fib kesişimi (0,618×1,272) sinyalinden oluşuyorsa o sinyal; değilse null. */
export function fibSignalOf(best, direction) {
  const sigs = best?.signals || [];
  if (sigs.length !== 1) return null;
  const s = sigs[0];
  return String(s.id || '').startsWith('fib|cluster') && s.direction === direction && Number.isFinite(s.entry) && Number.isFinite(s.stop) && s.zone ? s : null;
}

/** Satırdan plan; uygun değilse { ok:false, reason }. opts.fibPlan: tek fib kesişimi kümesinde detektörün planı. */
export function buildPlan(row, opts = {}) {
  const o = { ...PLAN_DEFAULTS, ...opts };
  const b = row.best;
  if (!b || !row.direction || row.direction === 'neutral') return { ok: false, reason: 'yön yok' };
  const mtfOk = row.mtf && row.mtf.direction === row.direction && row.mtf.tfs.length > 1;
  const score = Math.max(row.score, mtfOk ? row.mtf.score : 0);
  if (score < o.minScore) return { ok: false, reason: `puan ${score} < ${o.minScore}` };
  if (o.requireMtf && !mtfOk) return { ok: false, reason: 'MTF uyumu yok' };
  const d = dirSign(row.direction), atr = row.atr, price = row.price;
  // Trend filtreleri (satırda scanner'ın eklediği trend alanı varsa)
  const t = row.trend || {};
  const aligned = t.pdi != null && t.mdi != null ? (d === 1 ? t.pdi > t.mdi : t.mdi > t.pdi) : null;
  const emaSide = t.ema200 != null ? (d * (price - t.ema200) > 0) : null;
  if (o.trendAdxMin) {
    if (t.adx == null || t.adx < o.trendAdxMin) return { ok: false, reason: `ADX ${t.adx?.toFixed?.(0) ?? '–'} < ${o.trendAdxMin}` };
    if (!aligned) return { ok: false, reason: 'DI yönü uyumsuz' };
  }
  if (o.trendEma && !emaSide) return { ok: false, reason: 'fiyat EMA200\'ün yanlış tarafında' };
  // BTC'ye göre göreli güç: 'with' → long yalnız BTC'den güçlü coinlerde (rsSide > 0 ve rs > 0), short yalnız zayıflarda
  if (o.rsBtc === 'with' && row.coin !== 'BTC') {
    if (t.rsBtc == null || t.rsSide == null) return { ok: false, reason: 'BTC göreli gücü bilinmiyor' };
    const strong = t.rsSide > 0 && t.rsBtc > 0, weak = t.rsSide < 0 && t.rsBtc < 0;
    if ((d === 1 && !strong) || (d === -1 && !weak)) return { ok: false, reason: d === 1 ? 'BTC\'ye göre zayıf' : 'BTC\'ye göre güçlü' };
  }
  // BTC rejimi: 'with' → long yalnız BTC yükseliş rejiminde, short yalnız düşüş rejiminde (o.regime: 'up'|'down'|null)
  if (o.btcRegime === 'with') {
    if (!o.regime) return { ok: false, reason: 'BTC rejimi bilinmiyor' };
    if ((d === 1) !== (o.regime === 'up')) return { ok: false, reason: 'BTC rejimi ters' };
  }
  // Fib kesişimi (fibPlan, tarayıcı): en iyi küme tek bir 0,618×1,272 kesişimiyse detektörün kendi planı —
  // giriş = kesişim seviyesi, stop = detektör stopu, TP1/TP2 = H1/H2. Grafik, takip ve check list aynı sayıları gösterir.
  const fib = o.fibPlan ? fibSignalOf(b, row.direction) : null;
  let lo, hi, inZone, entry, stop, risk, tp1, tp2;
  if (fib) {
    [lo, hi] = fib.zone;
    entry = fib.entry; stop = fib.stop; risk = d * (entry - stop);
    if (!(risk > 0)) return { ok: false, reason: 'fib stopu girişin yanlış tarafında' };
    inZone = price >= lo && price <= hi;
    const dist = d === 1 ? (price - hi) / atr : (lo - price) / atr;
    if (dist > o.maxDistAtr) return { ok: false, reason: `bölge ${dist.toFixed(1)}×ATR uzakta` };
    if (d * (price - stop) <= 0) return { ok: false, reason: 'fiyat stopun ötesinde' };
    if ((risk / entry) * 100 > o.maxRiskPct) return { ok: false, reason: `risk %${((risk / entry) * 100).toFixed(1)} > %${o.maxRiskPct}` };
    tp1 = Number.isFinite(fib.target) && d * (fib.target - entry) > 0 ? fib.target : entry + d * 1.5 * risk;
    const t2 = fib.meta?.target2;
    tp2 = Number.isFinite(t2) && d * (t2 - tp1) > 0 ? t2 : entry + d * Math.max(2, (d * (tp1 - entry)) / risk + 1) * risk;
  } else {
    [lo, hi] = entryZone(b, d, atr, o.maxZoneAtr);
    // Giriş: bölgenin fiyata yakın kenarı (long: üst kenar, short: alt kenar); fiyat bölgedeyse fiyat
    inZone = price >= lo && price <= hi;
    entry = inZone ? price : d === 1 ? hi : lo;
    const dist = d === 1 ? (price - hi) / atr : (lo - price) / atr; // fiyat bölgeye bu kadar uzak (ATR)
    if (dist > o.maxDistAtr) return { ok: false, reason: `bölge ${dist.toFixed(1)}×ATR uzakta` };
    if (dist < -0.5) return { ok: false, reason: 'fiyat bölgeyi geçmiş' };
    // Stop: her zaman bölge kenarının ötesi (kenar − pad). Kümedeki bir geçersizlik seviyesi daha UZAKTA ve
    // maxRiskAtr içindeyse stop oraya genişler (yapının arkası); bölgenin içine asla çekilmez.
    stop = d === 1 ? lo - o.stopPadAtr * atr : hi + o.stopPadAtr * atr;
    const invs = b.signals.map((s) => s.invalidation).filter((x) => Number.isFinite(x) && d * (entry - x) > 0);
    for (const inv of invs) {
      const cand = inv - d * 0.1 * atr;
      const risk = d * (entry - cand) / atr;
      if (risk <= o.maxRiskAtr && d * (stop - cand) > 0 && risk <= d * (entry - stop) / atr + 1.5) stop = cand; // en fazla 1,5 ATR daha geniş
    }
    risk = d * (entry - stop);
    if (risk < o.minRiskAtr * atr) { stop = entry - d * o.minRiskAtr * atr; risk = o.minRiskAtr * atr; }
    if (risk > o.maxRiskAtr * atr) return { ok: false, reason: `stop ${(risk / atr).toFixed(1)}×ATR uzakta` };
    if ((risk / entry) * 100 > o.maxRiskPct) return { ok: false, reason: `risk %${((risk / entry) * 100).toFixed(1)} > %${o.maxRiskPct}` };
    const R = (p) => (d * (p - entry)) / risk;
    // Hedefler: kümedeki hedefler + 2R/3R; TP1 ≥ minRR1, TP2 ≥ minRR
    const tgts = [...new Set(b.signals.map((s) => s.target).filter((x) => Number.isFinite(x) && d * (x - entry) > 0))].sort((a, c) => d * (a - c));
    tp1 = tgts.find((t) => R(t) >= o.minRR1 && R(t) < o.minRR) ?? entry + d * Math.max(o.minRR1, 1.5) * risk;
    tp2 = tgts.find((t) => R(t) >= o.minRR && R(t) >= R(tp1) + 0.5) ?? entry + d * Math.max(o.minRR, R(tp1) + 1) * risk;
  }
  const rr1 = (d * (tp1 - entry)) / risk, rr = (d * (tp2 - entry)) / risk;
  if (rr < o.minRR) return { ok: false, reason: `R:R ${rr.toFixed(1)} < ${o.minRR}` };
  // Fiyat zaten TP1'i geçmişse anlamsız
  if (d * (price - tp1) >= 0) return { ok: false, reason: fib ? 'fiyat H1 (itki ucu) ötesinde' : 'fiyat TP1 ötesinde' };
  const key = `${row.coin}|${row.tf}|${row.direction}|${Math.round(((lo + hi) / 2) / atr)}`;
  return {
    ok: true,
    key, coin: row.coin, instId: row.instId, tf: row.tf, direction: row.direction, d,
    score, clusterScore: row.score, mtf: mtfOk ? { tfs: row.mtf.tfs, score: row.mtf.score, conflicting: row.mtf.conflicting } : null,
    price: r4(price), atr: r4(atr), zone: [r4(lo), r4(hi)], inZone,
    entry: r4(entry), stop: r4(stop), tp1: r4(tp1), tp2: r4(tp2), risk: r4(risk), rr1: +rr1.toFixed(2), rr: +rr.toFixed(2),
    riskPct: +(risk / entry * 100).toFixed(2),
    signals: b.signals.map((s) => ({ name: s.name, detector: s.detector, group: s.group, direction: s.direction, strength: +s.strength.toFixed(2), status: s.status, zone: s.zone?.map(r4), note: s.note || '', invalidation: s.invalidation, target: s.target })),
    groups: [...b.groups],
    trend: { adx: t.adx != null ? +t.adx.toFixed(1) : null, aligned, emaSide, rsBtc: t.rsBtc ?? null, rsSide: t.rsSide ?? null },
    regime: o.regime ?? null,
    time: t.time ?? null,
    status: inZone ? 'active' : 'waiting',
  };
}

/**
 * Giriş bölgesi: kümenin çekirdek (en güçlü yönlü) sinyalinin bölgesi, onu kesen dar sinyallerle kesişim;
 * yine de maxZoneAtr'den genişse fiyata yakın kenardan o kadarlık dilim.
 */
export function entryZone(cluster, d, atr, maxZoneAtr) {
  const dirName = d === 1 ? 'long' : 'short';
  const core = cluster.signals.find((s) => s.direction === dirName && s.zone) || cluster.signals.find((s) => s.zone);
  let lo = core ? core.zone[0] : cluster.zone[0], hi = core ? core.zone[1] : cluster.zone[1];
  // Kesişim: çekirdekle çakışan ve ondan dar olan yönlü sinyaller bölgeyi daraltır (en az 0,4 ATR kalır)
  for (const s of cluster.signals) {
    if (!s.zone || s === core || s.direction !== dirName) continue;
    const ilo = Math.max(lo, s.zone[0]), ihi = Math.min(hi, s.zone[1]);
    if (ihi - ilo >= 0.4 * atr && ihi - ilo < hi - lo) { lo = ilo; hi = ihi; }
  }
  if (hi - lo > maxZoneAtr * atr) { if (d === 1) lo = hi - maxZoneAtr * atr; else hi = lo + maxZoneAtr * atr; }
  return [lo, hi];
}

/** Hesap büyüklüğüne göre pozisyon: risk$ / (giriş − stop). */
export function positionSize(plan, accountUsdt, riskPct) {
  if (!(accountUsdt > 0)) return null;
  const riskUsd = (accountUsdt * riskPct) / 100;
  const qty = riskUsd / plan.risk;
  return { riskUsd: +riskUsd.toFixed(2), qty: +qty.toPrecision(4), notional: +(qty * plan.entry).toFixed(2), leverageFor1x: +((qty * plan.entry) / accountUsdt).toFixed(2) };
}

// "Düşen bıçak" koruması: limit emir çoğu zaman fiyat bölgeye en sert geldiğinde dolar (ters seçim). Bölgeye hızlı gelişte
// (son 3 mumda giriş yönüne ters hareket > maxApproachAtr × ATR ya da dolum mumu > maxFillBarAtr × ATR) emir dolmaz; sonraki
// confirmBars kapanmış mum içinde teyit mumu (long: kapanış bölge üst kenarı ya da önceki mumun tepesi üstünde) gelirse o
// mumun kapanışından girilir. Teyitten önce stop geçilirse plan iptal (knife, işlem yok). skip: teyit beklemeden iptal.
export const KNIFE_DEFAULTS = { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3, skip: false };

/** true | '1' | JSON | nesne → koruma ayarı; boş/'0' → null (kapalı). */
export function knifeGuardOf(v) {
  if (v == null || v === false || v === '' || v === '0' || v === 0) return null;
  if (v === true || v === '1' || v === 1) return { ...KNIFE_DEFAULTS };
  if (typeof v === 'string') { try { return { ...KNIFE_DEFAULTS, ...JSON.parse(v) }; } catch { return { ...KNIFE_DEFAULTS }; } }
  return { ...KNIFE_DEFAULTS, ...v };
}

/** Yaklaşma hızı: i (dolum mumu) dahil son `bars` mumda giriş yönüne ters en büyük hareket ÷ ATR ve dolum mumu boyu ÷ ATR. */
export function approachOf(candles, i, d, atr, bars = 3) {
  const c = candles[i];
  if (!c || !(atr > 0)) return null;
  let ext = d === 1 ? -Infinity : Infinity;
  for (let k = Math.max(0, i - bars + 1); k <= i; k++) { const x = candles[k]; if (x) ext = d === 1 ? Math.max(ext, x.high) : Math.min(ext, x.low); }
  const move = d === 1 ? ext - c.low : c.high - ext;
  return { approachAtr: +(move / atr).toFixed(2), fillBarAtr: +((c.high - c.low) / atr).toFixed(2) };
}

/** Zaman stopu ayarı: 8 | '8' | JSON {"bars":8,"minMfeR":0.5} → { bars, minMfeR } ya da null. */
export function timeStopOf(v) {
  if (v == null || v === '' || v === '0' || v === 0 || v === false) return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) return { bars: +v, minMfeR: Infinity };
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o.bars > 0 ? { minMfeR: Infinity, ...o } : null; } catch { return null; }
}

/**
 * Erken kâr al ayarı: JSON {"pct":1.2,"portion":0.8,"tfs":["4H"]} → nesne ya da null.
 * İsteğe bağlı 3 kademe (13.11): "mid":0.25 → plandaki TP1'de başlangıç adedinin %25'i daha kapanır; "midStop":"early" →
 * ondan sonra kalan için stop erken hedefe (vars. "entry" = girişte kalır). TP1 erken hedefin içindeyse ara kademe yok.
 */
export function earlyTpOf(v) {
  if (v == null || v === '' || v === '0' || v === false) return null;
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && o.pct > 0 ? { portion: 0.8, tfs: ['4H'], ...o } : null; } catch { return null; }
}
/** Erken hedef fiyatı (plan TF'si listedeyse), yoksa null. */
export const earlyPriceOf = (plan, entry, e) => (e && e.tfs.includes(plan.tf) ? +(entry * (1 + plan.d * e.pct / 100)).toPrecision(8) : null);

/** 3 kademe uygulanabilir mi: ara pay var ve TP1 erken hedefin ötesinde, TP2'nin berisinde. */
export const midOk = (p) => !!(p.midPortion > 0 && p.early != null && p.d * (p.tp1 - p.early) > 0 && p.d * (p.tp2 - p.tp1) > 0);

export const isKnife = (a, g) => !!(g && a && (a.approachAtr > g.maxApproachAtr || a.fillBarAtr > g.maxFillBarAtr));

/** Teyit mumu: long kapanış giriş bölgesinin üst kenarı (bölge yoksa giriş) ya da önceki mumun tepesi üstünde; short ayna. */
export function confirmsTurn(c, prev, plan) {
  const d = plan.d;
  const edge = plan.zone ? (d === 1 ? Math.max(...plan.zone) : Math.min(...plan.zone)) : plan.entry;
  return d === 1 ? c.close > edge || !!(prev && c.close > prev.high) : c.close < edge || !!(prev && c.close < prev.low);
}

/**
 * Limit dolum mumunun içinde sıra (alt TF): [t0, t0 + ms) aralığındaki alt mumlarda ilk giriş dokunuşu; o alt mumda stop →
 * 'stop'; sonraki alt mumlarda önce stop → 'stop', önce hedef → 'tp'; hiçbiri ya da veri yok → 'none'.
 */
export function fillOrder(plan, d, t0, ms, lower, target) {
  if (!lower?.length) return 'none';
  let lo = 0, hi = lower.length - 1, s0 = lower.length;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (lower[m].time >= t0) { s0 = m; hi = m - 1; } else lo = m + 1; }
  let filled = false;
  for (let j = s0; j < lower.length && lower[j].time < t0 + ms; j++) {
    const c = lower[j];
    const stopHit = d === 1 ? c.low <= plan.stop : c.high >= plan.stop;
    if (!filled) {
      if (d === 1 ? c.low <= plan.entry : c.high >= plan.entry) { filled = true; if (stopHit) return 'stop'; }
      continue;
    }
    if (stopHit) return 'stop';
    if (d === 1 ? c.high >= target : c.low <= target) return 'tp';
  }
  return 'none';
}

/**
 * Tura dolmuş başlayan planın dolum / erken hedef mumları. Durum dosyasında filledAt / confirmedAt / earlyAt varsa onlar;
 * yoksa (önbellek kaybı, eski geçmiş kaydı) mumlardan yeniden bulunur: dolum = gönderimden sonra activeAt (duvar saati) mumuna
 * kadar girişe ilk dokunan mum (bekleme durumundaki kuralın aynısı); bulunamazsa (bölge içinde gönderim) atlama yok.
 * Erken hedef = dolum mumundan (fillRes 'none' ise sonrakinden) tp1At'e kadar erken hedefe ilk dokunan mum.
 * @returns {{ fillAt: number|null, earlyAt: number|null }} fillAt: bundan önceki mumlar işlenmez (teyitte teyit mumu dahil atlanır)
 */
export function filledBarsOf(plan, candles) {
  const d = plan.d;
  let fillAt = plan.confirmedAt != null ? plan.confirmedAt + 1 : plan.filledAt ?? null;
  if (fillAt == null) {
    const until = plan.activeAt ?? Infinity;
    const c = candles.find((x) => x && x.time > plan.sentAt && x.time <= until && (d === 1 ? x.low <= plan.entry : x.high >= plan.entry));
    fillAt = c ? c.time : null;
  }
  let earlyAt = plan.earlyAt ?? null;
  if (earlyAt == null && plan.status === 'early' && plan.early != null) {
    const from = plan.confirmedAt != null ? plan.confirmedAt + 1 : fillAt ?? -Infinity, until = plan.tp1At ?? Infinity;
    const c = candles.find((x) => x && x.time > plan.sentAt && x.time >= from && x.time <= until && !(x.time === fillAt && plan.fillRes === 'none') && (d === 1 ? x.high >= plan.early : x.low <= plan.early));
    earlyAt = c ? c.time : null;
  }
  return { fillAt, earlyAt };
}

/**
 * Açık planı yeni mumlarla günceller. candles: sentAt'tan sonraki mumlar (eskiden yeniye) + canlı.
 * opts.knifeGuard: düşen bıçak koruması (knifeGuardOf); açıkken waiting → confirming → active | knife | expired.
 * @returns {{ status, events: string[], patch: object }} patch: plana yazılacak alanlar (yaklaşma ölçüsü, teyitli giriş)
 */
export function trackPlan(plan, candles, now = Date.now(), opts = {}) {
  const o = { ...PLAN_DEFAULTS, ...opts };
  const g = knifeGuardOf(o.knifeGuard), ts = timeStopOf(o.timeStop);
  const ms = TIMEFRAMES[plan.tf]?.ms;
  let mfe = 0; // zaman stopu için (R)
  const d = plan.d;
  let status = plan.status;
  const events = [], patch = {};
  let P = plan; // teyitli girişten sonra aynı turda yeni giriş / erken hedef (plan + patch)
  const knifeAt = () => patch.knifeAt ?? plan.knifeAt;
  // Tura dolmuş olarak başlayan plan (active/tp1/early): dolumdan ÖNCEKİ mumlar işlenmez (limit long'da fiyat girişe
  // yukarıdan iner; o mumların tepesi erken hedefi geçmiş olabilir → sahte 'early'). Dolum mumu (fillRes / alt TF) işlenir.
  const bars = plan.status === 'active' || plan.status === 'tp1' || plan.status === 'early' ? filledBarsOf(plan, candles) : null;
  let lastT = null; // kapanışın görüldüğü mum (geç takipte gerçek kapanış zamanı)
  for (let j = 0; j < candles.length; j++) {
    const c = candles[j];
    if (!c || c.time <= plan.sentAt) continue;
    if (bars?.fillAt != null && c.time < bars.fillAt && (candles[j + 1]?.time ?? Infinity) <= bars.fillAt) continue; // mum dolumdan önce bitti (geç takipte üst TF mumu dolumu içerebilir)
    lastT = c.time;
    const touchEntry = d === 1 ? c.low <= plan.entry : c.high >= plan.entry;
    const hitStop = d === 1 ? c.low <= plan.stop : c.high >= plan.stop;
    const hitTp1 = d === 1 ? c.high >= plan.tp1 : c.low <= plan.tp1;
    const hitTp2 = d === 1 ? c.high >= plan.tp2 : c.low <= plan.tp2;
    if (status === 'waiting') {
      if (touchEntry) {
        const a = g ? approachOf(candles, j, d, plan.atr || Math.abs(plan.entry - plan.stop)) : null;
        if (a) Object.assign(patch, a);
        if (isKnife(a, g)) {
          if (g.skip || hitStop) { status = 'knife'; events.push('knife'); break; }
          status = 'confirming'; events.push('confirming'); patch.knifeAt = c.time; continue;
        }
        status = 'active'; events.push('active'); patch.filledAt = c.time;
      } else if (hitTp1) { status = 'missed'; events.push('missed'); break; }
      else continue;
    }
    if (status === 'confirming') {
      if (c.time < knifeAt()) continue;
      // Bıçak mumunun dokunmadan SONRAKİ kısmı da izlenir (13.11 K2): 15 dk'lık turda bıçak kapanmamış mumda tespit edilir;
      // mumun kalanında stop geçilirse teyitten önce stop = iptal (long'da stop girişin altında → dokunmadan sonradır).
      // Kapanmış mumla karar verilen turda bu mumda stop zaten 'knife' sayılmıştır (değişiklik yok). Teyit yalnız sonraki mumlarda.
      if (hitStop) { status = 'knife'; events.push('knife'); break; }
      if (c.time === knifeAt()) continue;
      if (ms && c.time + ms > now) continue; // teyit yalnız kapanmış mumla
      if (confirmsTurn(c, candles[j - 1], plan)) {
        const risk = d * (c.close - plan.stop);
        if (d * (plan.tp1 - c.close) <= 0 || !(risk > 0)) { status = 'missed'; events.push('missed'); break; }
        Object.assign(patch, { confirmedAt: c.time, entry: c.close, entryPlanned: plan.entry, rr1: +((d * (plan.tp1 - c.close)) / risk).toFixed(2), rr: +((d * (plan.tp2 - c.close)) / risk).toFixed(2) });
        // Erken hedef yeni girişe göre (aynı % uzaklık; earlyPriceOf ile aynı kural): planlanan girişe göre kalırsa kapanış
        // onu geçmiş olabilir → hedef girişin yanlış tarafında, ilk mumda sahte 'early'.
        if (plan.early) Object.assign(patch, { early: +(c.close * (plan.early / plan.entry)).toPrecision(8), earlyPlanned: plan.early });
        P = { ...plan, ...patch };
        status = 'active'; events.push('active'); continue;
      }
      if (ms && Math.round((c.time - knifeAt()) / ms) >= g.confirmBars) { status = 'expired'; events.push('unconfirmed'); break; }
      continue;
    }
    // Dolum mumunda sıra (opts.lower: alt TF mumları, ör. 15m): aynı mumda giriş + hedef/stop görüldüyse hangisi önce?
    // Sonuç mum kapanınca plana yazılır (fillRes) ki sonraki turlarda alt TF verisi kaysa da aynı kalsın.
    // Alt TF yokken (geç takip) dolum mumunda daha önce kaydedilmiş sıra sonucu (fillRes) korunur: 'none' → bu mumda hedef yok
    if (status === 'active' && !o.lower && plan.fillRes && (patch.filledAt ?? plan.filledAt) === c.time) {
      if (plan.fillRes === 'stop') { status = 'stopped'; events.push('stopped'); break; }
      if (plan.fillRes === 'none') continue;
    }
    if ((status === 'active') && o.lower && ms && (patch.filledAt ?? plan.filledAt) === c.time && !(patch.confirmedAt ?? plan.confirmedAt)) {
      const target = P.early ?? plan.tp1;
      const hitTarget = d === 1 ? c.high >= target : c.low <= target;
      if (hitTarget || hitStop) {
        let res = plan.fillRes ?? patch.fillRes;
        if (!res) {
          res = fillOrder(plan, d, c.time, ms, o.lower, target);
          if (c.time + ms <= now && o.lower[0]?.time <= c.time) patch.fillRes = res;
        }
        if (res === 'stop') { status = 'stopped'; events.push('stopped'); break; }
        if (res === 'none') continue; // alt TF'de dolumdan sonra hedef görülmedi: bu mumda hedef sayılmaz
        if (P.early) { status = 'early'; events.push('early'); patch.earlyAt = c.time; continue; }
        status = 'tp1'; events.push('tp1'); continue;
      }
    }
    // Erken kâr al (P.early): %portion erken hedefte kapanır, stop girişe; kalan TP2 (done) ya da girişe dönüş (be).
    // 3 kademe (plan.midPortion): TP1'de ara kapanış (midAt); midStop 'early' ise sonra stop erken hedefe.
    if (status === 'early') {
      const eAt = patch.earlyAt ?? P.earlyAt ?? bars?.earlyAt;
      if (c.time < eAt) continue;
      const midAt = patch.midAt ?? plan.midAt;
      if (c.time === eAt) {
        // Erken hedef mumu (13.11 EL): erken hedef önceki turda kapanmamış mumda yazıldıysa mumun kalanında TP1 (ara kademe) ve
        // TP2 de görülür — tek geçişin kuralı (active dalı: erken hedef mumunda mid + TP2 sayılır, girişe dönüş sayılmaz).
        // Dolum mumu = erken hedef mumu ise (alt TF sırası, fillRes) tek geçiş o mumda mid/TP2 saymaz: atlanır.
        if (eAt === bars?.fillAt) continue;
        if (!midAt && midOk(P) && hitTp1) { patch.midAt = c.time; events.push('mid'); }
        if (hitTp2) { if (midOk(P) && !(patch.midAt ?? plan.midAt)) patch.midAt = c.time; status = 'done'; events.push('done'); break; }
        continue;
      }
      // Stop erken hedefe yalnız mid mumundan SONRA (13.11 MR): midAt önceki turda yazıldıysa earlyAt–midAt arası mumlarda
      // stop hâlâ girişteydi; mid mumunun kendisinde de giriş (sıra bilinmez → stop önce, motor midStopToTp1 ile aynı).
      const lvl = midAt != null && c.time > midAt && plan.midStop === 'early' ? P.early : P.entry;
      const hitBe = d === 1 ? c.low <= lvl : c.high >= lvl;
      if (hitBe) { status = 'be'; events.push('be'); break; } // aynı mumda hedef + stop: stop (kötümser)
      if (!midAt && midOk(P) && hitTp1) { patch.midAt = c.time; events.push('mid'); }
      if (hitTp2) { if (midOk(P) && !(patch.midAt ?? plan.midAt)) patch.midAt = c.time; status = 'done'; events.push('done'); break; }
      continue;
    }
    if (status === 'active' && P.early) {
      if (plan.confirmedAt && c.time <= plan.confirmedAt) continue;
      if (hitStop) { status = 'stopped'; events.push('stopped'); break; }
      if (d === 1 ? c.high >= P.early : c.low <= P.early) { status = 'early'; events.push('early'); patch.earlyAt = c.time; if (midOk(P) && hitTp1) { patch.midAt = c.time; events.push('mid'); } if (hitTp2) { status = 'done'; events.push('done'); break; } }
      continue;
    }
    if (status === 'active' || status === 'tp1') {
      if (plan.confirmedAt && c.time <= plan.confirmedAt) continue; // teyitli girişten (kapanış) önceki mumlar
      // Aynı mumda hem stop hem hedef: kötü olan (stop) sayılır
      if (hitStop) { status = 'stopped'; events.push('stopped'); break; }
      if (status === 'active' && hitTp1) { status = 'tp1'; events.push('tp1'); }
      if (status === 'tp1' && hitTp2) { status = 'done'; events.push('done'); break; }
      // Zaman stopu: dolumdan bars kapanmış mum içinde TP1 görülmedi (ve MFE < minMfeR) → kapanıştan kapat
      const start = patch.confirmedAt ?? plan.confirmedAt ?? patch.filledAt ?? plan.filledAt ?? plan.activeAt;
      if (ts && status === 'active' && ms && start != null && c.time >= start) {
        const risk = d * (P.entry - plan.stop);
        if (risk > 0) mfe = Math.max(mfe, (d * ((d === 1 ? c.high : c.low) - P.entry)) / risk);
        const n = Math.round((c.time - start) / ms) + ((patch.confirmedAt ?? plan.confirmedAt) ? 0 : 1);
        if (c.time + ms <= now && n >= ts.bars && mfe < ts.minMfeR) {
          Object.assign(patch, { exitPrice: c.close, exitR: risk > 0 ? +((d * (c.close - P.entry)) / risk).toFixed(2) : 0 });
          status = 'timeout'; events.push('time_stop'); break;
        }
      }
    }
  }
  if (status === 'waiting' && now - plan.sentAt > o.expireHours * 3600e3) { status = 'expired'; events.push('expired'); }
  else if (CLOSED.has(status) && events.length && lastT != null) patch.closedBar = lastT;
  return { status, events, patch };
}

/**
 * Taranmayan (TF kapalı / coin listeden düştü) açık plan için mum seçimi: plan TF'si ya da gönderimden bu yana
 * `max` mumu aşmayan ilk üst TF (OKX /market/candles en fazla ~1440 mum verir). Hiçbiri yetmezse null.
 */
export function catchUpTf(tf, sentAt, now, max = 1400) {
  const order = ['15m', '1H', '4H', '1D'];
  for (const t of order.slice(Math.max(0, order.indexOf(tf)))) {
    const n = Math.ceil((now - sentAt) / TIMEFRAMES[t].ms) + 3;
    if (n <= max) return { tf: t, count: Math.max(n, 50) };
  }
  return null;
}

/**
 * AGENT_SOURCE=signals: ajan adayları = canlı Telegram kurallarının tümünden geçen planlar (long + short; bekleme süresi
 * hariç — kurulum geçerli kaldıkça görünür) + ölçülmüş kural adayları (rejim-Donchian). Coin başına tek aday, en fazla n.
 */
export function mergeAgentCands(signals, measured = [], n = 10) {
  const seen = new Set(), out = [];
  const sorted = [...signals].sort((a, b) => (b.mtf ? 1 : 0) - (a.mtf ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0));
  for (const p of [...sorted.map((x) => ({ ...x, source: x.source || 'signal' })), ...measured]) {
    if (out.length >= n || seen.has(p.coin)) continue;
    seen.add(p.coin); out.push(p);
  }
  return out;
}

/** UTC Cumartesi/Pazar mı? (tarama: hafta sonu girişleri her TF'de ve iki dilimde daha kötü) */
export const isWeekendUtc = (ms) => { const d = new Date(ms).getUTCDay(); return d === 0 || d === 6; };

export const CLOSED = new Set(['done', 'stopped', 'expired', 'missed', 'knife', 'timeout', 'be']);

/**
 * Sahipsiz kayıtlar: geçmişte açık görünen ama bot durumunda (state.sent) olmayan planlar. Durum önbelleği
 * kaybolunca/sıfırlanınca bu kayıtlar hiç güncellenmez (süre dolumu dahil); yeniden takibe alınmaları için kopyaları.
 */
export function orphansOf(items, sent) {
  const ids = new Set(sent.map((p) => `${p.key}|${p.sentAt}`));
  return items.filter((x) => x.status && !CLOSED.has(x.status) && !ids.has(`${x.key}|${x.sentAt}`)).map(({ id, ...p }) => ({ ...p, orphan: true }));
}

/** Aynı anahtar ya da aynı coin+yön son `cooldownHours` içinde gönderilmiş mi? */
export function onCooldown(plan, sent, now, cooldownHours) {
  const since = now - cooldownHours * 3600e3;
  return sent.some((p) => p.sentAt >= since && (p.key === plan.key || (p.coin === plan.coin && p.direction === plan.direction && p.tf === plan.tf)));
}
