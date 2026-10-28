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

/** Satırdan plan; uygun değilse { ok:false, reason }. */
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
  const [lo, hi] = entryZone(b, d, atr, o.maxZoneAtr);
  // Giriş: bölgenin fiyata yakın kenarı (long: üst kenar, short: alt kenar); fiyat bölgedeyse fiyat
  const inZone = price >= lo && price <= hi;
  const entry = inZone ? price : d === 1 ? hi : lo;
  const dist = d === 1 ? (price - hi) / atr : (lo - price) / atr; // fiyat bölgeye bu kadar uzak (ATR)
  if (dist > o.maxDistAtr) return { ok: false, reason: `bölge ${dist.toFixed(1)}×ATR uzakta` };
  if (dist < -0.5) return { ok: false, reason: 'fiyat bölgeyi geçmiş' };
  // Stop: her zaman bölge kenarının ötesi (kenar − pad). Kümedeki bir geçersizlik seviyesi daha UZAKTA ve
  // maxRiskAtr içindeyse stop oraya genişler (yapının arkası); bölgenin içine asla çekilmez.
  let stop = d === 1 ? lo - o.stopPadAtr * atr : hi + o.stopPadAtr * atr;
  const invs = b.signals.map((s) => s.invalidation).filter((x) => Number.isFinite(x) && d * (entry - x) > 0);
  for (const inv of invs) {
    const cand = inv - d * 0.1 * atr;
    const risk = d * (entry - cand) / atr;
    if (risk <= o.maxRiskAtr && d * (stop - cand) > 0 && risk <= d * (entry - stop) / atr + 1.5) stop = cand; // en fazla 1,5 ATR daha geniş
  }
  let risk = d * (entry - stop);
  if (risk < o.minRiskAtr * atr) { stop = entry - d * o.minRiskAtr * atr; risk = o.minRiskAtr * atr; }
  if (risk > o.maxRiskAtr * atr) return { ok: false, reason: `stop ${(risk / atr).toFixed(1)}×ATR uzakta` };
  if ((risk / entry) * 100 > o.maxRiskPct) return { ok: false, reason: `risk %${((risk / entry) * 100).toFixed(1)} > %${o.maxRiskPct}` };
  // Hedefler: kümedeki hedefler + 2R/3R; TP1 ≥ minRR1, TP2 ≥ minRR
  const tgts = [...new Set(b.signals.map((s) => s.target).filter((x) => Number.isFinite(x) && d * (x - entry) > 0))].sort((a, c) => d * (a - c));
  const R = (p) => (d * (p - entry)) / risk;
  const tp1 = tgts.find((t) => R(t) >= o.minRR1 && R(t) < o.minRR) ?? entry + d * Math.max(o.minRR1, 1.5) * risk;
  const tp2 = tgts.find((t) => R(t) >= o.minRR && R(t) >= R(tp1) + 0.5) ?? entry + d * Math.max(o.minRR, R(tp1) + 1) * risk;
  const rr1 = R(tp1), rr = R(tp2);
  if (rr < o.minRR) return { ok: false, reason: `R:R ${rr.toFixed(1)} < ${o.minRR}` };
  // Fiyat zaten TP1'i geçmişse anlamsız
  if (d * (price - tp1) >= 0) return { ok: false, reason: 'fiyat TP1 ötesinde' };
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

/** Erken kâr al ayarı: JSON {"pct":1.2,"portion":0.8,"tfs":["4H"]} → nesne ya da null. */
export function earlyTpOf(v) {
  if (v == null || v === '' || v === '0' || v === false) return null;
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && o.pct > 0 ? { portion: 0.8, tfs: ['4H'], ...o } : null; } catch { return null; }
}
/** Erken hedef fiyatı (plan TF'si listedeyse), yoksa null. */
export const earlyPriceOf = (plan, entry, e) => (e && e.tfs.includes(plan.tf) ? +(entry * (1 + plan.d * e.pct / 100)).toPrecision(8) : null);

export const isKnife = (a, g) => !!(g && a && (a.approachAtr > g.maxApproachAtr || a.fillBarAtr > g.maxFillBarAtr));

/** Teyit mumu: long kapanış giriş bölgesinin üst kenarı (bölge yoksa giriş) ya da önceki mumun tepesi üstünde; short ayna. */
export function confirmsTurn(c, prev, plan) {
  const d = plan.d;
  const edge = plan.zone ? (d === 1 ? Math.max(...plan.zone) : Math.min(...plan.zone)) : plan.entry;
  return d === 1 ? c.close > edge || !!(prev && c.close > prev.high) : c.close < edge || !!(prev && c.close < prev.low);
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
  const knifeAt = () => patch.knifeAt ?? plan.knifeAt;
  for (let j = 0; j < candles.length; j++) {
    const c = candles[j];
    if (!c || c.time <= plan.sentAt) continue;
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
      if (c.time <= knifeAt()) continue;
      if (hitStop) { status = 'knife'; events.push('knife'); break; }
      if (ms && c.time + ms > now) continue; // teyit yalnız kapanmış mumla
      if (confirmsTurn(c, candles[j - 1], plan)) {
        const risk = d * (c.close - plan.stop);
        if (d * (plan.tp1 - c.close) <= 0 || !(risk > 0)) { status = 'missed'; events.push('missed'); break; }
        Object.assign(patch, { confirmedAt: c.time, entry: c.close, entryPlanned: plan.entry, rr1: +((d * (plan.tp1 - c.close)) / risk).toFixed(2), rr: +((d * (plan.tp2 - c.close)) / risk).toFixed(2) });
        status = 'active'; events.push('active'); continue;
      }
      if (ms && Math.round((c.time - knifeAt()) / ms) >= g.confirmBars) { status = 'expired'; events.push('unconfirmed'); break; }
      continue;
    }
    // Erken kâr al (plan.early): %portion erken hedefte kapanır, stop girişe; kalan TP2 (done) ya da girişe dönüş (be)
    if (status === 'early') {
      if (c.time <= (patch.earlyAt ?? plan.earlyAt)) continue;
      const hitBe = d === 1 ? c.low <= plan.entry : c.high >= plan.entry;
      if (hitBe) { status = 'be'; events.push('be'); break; }
      if (hitTp2) { status = 'done'; events.push('done'); break; }
      continue;
    }
    if (status === 'active' && plan.early) {
      if (plan.confirmedAt && c.time <= plan.confirmedAt) continue;
      if (hitStop) { status = 'stopped'; events.push('stopped'); break; }
      if (d === 1 ? c.high >= plan.early : c.low <= plan.early) { status = 'early'; events.push('early'); patch.earlyAt = c.time; if (hitTp2) { status = 'done'; events.push('done'); break; } }
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
        const risk = d * (plan.entry - plan.stop);
        if (risk > 0) mfe = Math.max(mfe, (d * ((d === 1 ? c.high : c.low) - plan.entry)) / risk);
        const n = Math.round((c.time - start) / ms) + ((patch.confirmedAt ?? plan.confirmedAt) ? 0 : 1);
        if (c.time + ms <= now && n >= ts.bars && mfe < ts.minMfeR) {
          Object.assign(patch, { exitPrice: c.close, exitR: risk > 0 ? +((d * (c.close - plan.entry)) / risk).toFixed(2) : 0 });
          status = 'timeout'; events.push('time_stop'); break;
        }
      }
    }
  }
  if (status === 'waiting' && now - plan.sentAt > o.expireHours * 3600e3) { status = 'expired'; events.push('expired'); }
  return { status, events, patch };
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
