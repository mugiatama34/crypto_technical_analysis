// Tek coin analizi (coin.html): seçilen zaman dilimlerinde seçilen analiz aileleri + BTC ilişkisi + kurallara dayalı
// Türkçe yorum. Saf modül (DOM yok); tarayıcıda ve testlerde aynı kod çalışır.
import { makeContext } from './context.js';
import { runDetectors } from './registry.js';
import { clusterSignals, multiTfAlignment } from './scoring.js';
import { horizonTrend } from './regime.js';
import { relativeStrength } from './relative.js';
import { inZone } from '../core/signal.js';

export const COIN_TFS = ['1D', '4H', '1H', '15m', '5m'];
export const DEFAULT_TFS = ['1D', '4H', '1H', '15m']; // 5m isteğe bağlı (varsayılan kapalı)
export const FAMILIES = [
  { id: 'pa', label: 'Price action / SMC', detectors: ['structure', 'fvg', 'orderblock', 'liquidity', 'candlesticks'] },
  { id: 'elliott', label: 'Elliott', detectors: ['elliott'] },
  { id: 'fib', label: 'Fibonacci + kesişim', detectors: ['fibonacci'] },
  { id: 'pattern', label: 'Formasyon', detectors: ['patterns', 'triangles'] },
  { id: 'harmonic', label: 'Harmonik', detectors: ['harmonic'] },
  { id: 'momentum', label: 'Momentum / indikatör', detectors: ['divergence', 'indicator'] },
  { id: 'wyckoff', label: 'Wyckoff', detectors: ['wyckoff'] },
];
export const detectorsFor = (familyIds) => [...new Set(FAMILIES.filter((f) => familyIds.includes(f.id)).flatMap((f) => f.detectors))];
const DET_OPTS = { fibonacci: { clusterKs: [2, 3, 4], bRetr: [0.382, 1.0] } };
const TF_W = { '1D': 3, '4H': 2, '1H': 1, '15m': 0.5, '5m': 0.25 };

/** Son iki tepe ve iki dibe göre yapı: up (HH+HL), down (LH+LL), mixed. Fiyat son dibin altına/tepenin üstüne çıktıysa kırılım. */
export function structureBias(ctx, k = 2) {
  const { pivots } = ctx.pivots(k);
  const H = pivots.filter((p) => p.type === 'H').slice(-2), L = pivots.filter((p) => p.type === 'L').slice(-2);
  if (H.length < 2 || L.length < 2) return null;
  const hh = H[1].price > H[0].price, hl = L[1].price > L[0].price;
  let label = hh && hl ? 'up' : !hh && !hl ? 'down' : 'mixed';
  let broke = null;
  if (ctx.price < L[1].price) { broke = 'down'; if (label === 'up') label = 'mixed'; }
  else if (ctx.price > H[1].price) { broke = 'up'; if (label === 'down') label = 'mixed'; }
  return { label, hh, hl, lastH: H[1].price, lastL: L[1].price, broke };
}

/** Son büyük swing tepe/dip arasındaki range ve fiyatın konumu (0 = dip, 1 = tepe). */
export function dealingRange(ctx, k = 4) {
  const { pivots } = ctx.pivots(k);
  const H = [...pivots].reverse().find((p) => p.type === 'H'), L = [...pivots].reverse().find((p) => p.type === 'L');
  if (!H || !L) return null;
  const from = Math.min(H.i, L.i);
  let hi = -Infinity, lo = Infinity;
  for (let i = from; i <= ctx.last; i++) { hi = Math.max(hi, ctx.highs[i]); lo = Math.min(lo, ctx.lows[i]); }
  if (ctx.live) { hi = Math.max(hi, ctx.live.high); lo = Math.min(lo, ctx.live.low); }
  if (!(hi > lo)) return null;
  return { hi, lo, pos: Math.max(0, Math.min(1, (ctx.price - lo) / (hi - lo))) };
}

/** Zaman hizalı log getirilerin Pearson korelasyonu (son n bar). */
export function btcCorr(candles, btc, n = 100) {
  if (!candles?.length || !btc?.length) return null;
  const m = new Map(btc.map((c) => [c.time, c.close]));
  const pairs = [];
  for (let i = 1; i < candles.length; i++) {
    const a0 = candles[i - 1], a1 = candles[i], b0 = m.get(a0.time), b1 = m.get(a1.time);
    if (b0 > 0 && b1 > 0 && a0.close > 0 && a1.close > 0) pairs.push([Math.log(a1.close / a0.close), Math.log(b1 / b0)]);
  }
  const p = pairs.slice(-n);
  if (p.length < 30) return null;
  const mx = p.reduce((s, x) => s + x[0], 0) / p.length, my = p.reduce((s, x) => s + x[1], 0) / p.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx > 0 && syy > 0 ? +(sxy / Math.sqrt(sxx * syy)).toFixed(2) : null;
}

export const MAX_ZONE_ATR = 3; // bundan geniş çekirdek bölge "içinde/yaklaşıyor" yorumuna girmez
// Kümenin çekirdek bölgesi = en güçlü (tohum) sinyalin kendi bölgesi; birleşik küme bölgesi çok genişleyebiliyor.
const zoneInfo = (c, price, atr) => {
  if (!c) return null;
  const core = c.signals[0]?.zone || c.zone;
  const edge = price < core[0] ? core[0] : price > core[1] ? core[1] : price;
  const names = [...new Set([...c.signals].sort((a, b) => b.strength - a.strength).map((s) => s.name))].slice(0, 4);
  const widthAtr = atr ? (core[1] - core[0]) / atr : null;
  return { direction: c.direction, score: c.score, zone: core, clusterZone: c.zone, widthAtr, compact: widthAtr != null && widthAtr <= MAX_ZONE_ATR, distAtr: atr ? Math.abs(price - edge) / atr : null, distPct: Math.abs(price - edge) / price, inside: inZone(price, core), names, groups: [...c.groups], signals: c.signals };
};

/** Tek TF analizi. candles: kapanmış mumlar; live: canlı mum ya da null; btc: { candles, live } ya da null. */
export function analyzeTf({ coin, tf, candles, live = null, btc = null, ids }) {
  const ctx = makeContext({ candles, live, tf, symbol: coin, opts: DET_OPTS });
  if (ctx.n < 60) return { tf, error: 'Yetersiz mum' };
  const errors = [];
  const signals = runDetectors(ctx, ids, errors);
  const { clusters } = clusterSignals(signals, { atr: ctx.atrNow, price: ctx.price });
  const all = live ? [...candles, live] : candles;
  const btcAll = btc ? (btc.live ? [...btc.candles, btc.live] : btc.candles) : null;
  const isBtc = coin === 'BTC';
  return {
    tf, coin, price: ctx.price, atr: ctx.atrNow, candles, live, signals, clusters, errors,
    best: clusters[0] || null,
    bestLong: zoneInfo(clusters.find((c) => c.direction === 'long'), ctx.price, ctx.atrNow),
    bestShort: zoneInfo(clusters.find((c) => c.direction === 'short'), ctx.price, ctx.atrNow),
    trend: horizonTrend(candles),
    bias: structureBias(ctx),
    range: dealingRange(ctx),
    rsi: ctx.rsi[ctx.last] ?? null,
    rs: btcAll && !isBtc ? relativeStrength(all, btcAll) : null,
    corr: btcAll && !isBtc ? btcCorr(all, btcAll) : null,
    btcTrend: btc && !isBtc ? horizonTrend(btc.candles) : null,
    fibX: signals.filter((s) => s.id.startsWith('fib|cluster')),
  };
}

/** Tüm TF'ler: perTf = { tf: { candles, live } }, btcPerTf aynı biçim (BTC için boş olabilir). */
export function analyzeCoin({ coin, perTf, btcPerTf = {}, families = FAMILIES.map((f) => f.id), now = Date.now() }) {
  const ids = detectorsFor(families);
  const tfs = COIN_TFS.filter((tf) => perTf[tf]?.candles?.length);
  const res = {};
  for (const tf of tfs) res[tf] = analyzeTf({ coin, tf, candles: perTf[tf].candles, live: perTf[tf].live || null, btc: btcPerTf[tf] || null, ids });
  const okTfs = tfs.filter((tf) => !res[tf].error);
  const mtf = multiTfAlignment(Object.fromEntries(okTfs.map((tf) => [tf, { best: res[tf].best }])));
  const out = { coin, at: now, families, tfs: okTfs, res, mtf };
  out.comment = commentary(out, now);
  return out;
}

const TR_TREND = { up: 'yükseliş', down: 'düşüş', flat: 'yatay' };
const TR_BIAS = { up: 'yükselen tepe/dip', down: 'alçalan tepe/dip', mixed: 'karışık' };
const TFN = { '1D': 'günlük', '4H': '4H', '1H': '1H', '15m': '15m', '5m': '5m' };
const pct = (x, d = 1) => `%${(x * 100).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const num = (x, d = 1) => x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fp = (p, ref = p) => { const a = Math.abs(ref), d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(8, Math.ceil(-Math.log10(a)) + 3); return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const zoneTxt = (z, ref) => `${fp(z.zone[0], ref)}–${fp(z.zone[1], ref)}`;
const dirTxt = (d) => (d === 'long' ? 'long' : 'short');
const dirOf = (t) => (t === 'up' ? 1 : t === 'down' ? -1 : 0);

/** Kurallara dayalı yorum: { headline, bullets: string[], verdict: string, tone: 'long'|'short'|'wait' } */
export function commentary(a, now = Date.now()) {
  const R = a.res, tfs = a.tfs, coin = a.coin;
  if (!tfs.length) return { headline: 'Yeterli veri yok.', bullets: [], verdict: '', tone: 'wait' };
  const ref = R[tfs[0]].price;
  const bullets = [];
  // 1) Yön
  let w = 0, wsum = 0;
  for (const tf of tfs) { const d = dirOf(R[tf].trend?.dir); w += d * TF_W[tf]; wsum += TF_W[tf]; }
  const overall = w / wsum >= 0.34 ? 'up' : w / wsum <= -0.34 ? 'down' : 'mixed';
  const trendLine = tfs.map((tf) => `${TFN[tf]} ${TR_TREND[R[tf].trend?.dir] || '—'}`).join(' · ');
  const biasTf = ['4H', '1D', '1H', '15m'].find((tf) => R[tf]?.bias);
  bullets.push(`<b>Yön:</b> ${trendLine}. Genel eğilim <b>${overall === 'up' ? 'yukarı' : overall === 'down' ? 'aşağı' : 'karışık'}</b>${biasTf ? `; ${TFN[biasTf]} yapısı ${TR_BIAS[R[biasTf].bias.label]}${R[biasTf].bias.broke ? ` (son ${R[biasTf].bias.broke === 'down' ? 'dip' : 'tepe'} kırılmış)` : ''}` : ''}.`);
  // 2) BTC ilişkisi
  const htf = ['4H', '1H', '1D', '15m'].find((tf) => R[tf] && !R[tf].error);
  if (coin !== 'BTC' && htf) {
    const r = R[htf], c = r.corr, bt = r.btcTrend?.dir;
    const corrTxt = c == null ? 'ölçülemedi' : c >= 0.7 ? `güçlü (r ${num(c, 2)})` : c >= 0.4 ? `orta (r ${num(c, 2)})` : `zayıf (r ${num(c, 2)})`;
    const same = bt && r.trend?.dir && bt !== 'flat' && r.trend.dir !== 'flat' ? (bt === r.trend.dir ? 'aynı yönde' : 'ters yönde') : null;
    const rsTxt = r.rs ? (r.rs.rs >= 2 ? `son 20 mumda BTC'den güçlü (${r.rs.rs > 0 ? '+' : ''}${num(r.rs.rs, 1)}%)` : r.rs.rs <= -2 ? `son 20 mumda BTC'den zayıf (${num(r.rs.rs, 1)}%)` : `son 20 mumda BTC ile benzer (${num(r.rs.rs, 1)}%)`) : null;
    bullets.push(`<b>BTC ile ilişki (${TFN[htf]}):</b> bağlantı ${corrTxt}. BTC ${TR_TREND[bt] || '—'}${same ? `, ${coin} ${same}` : ''}${rsTxt ? `; ${rsTxt}` : ''}.${c != null && c >= 0.7 && bt && bt !== 'flat' ? ` Bağlantı güçlü olduğu için BTC'nin yönü belirleyici olur.` : ''}`);
  }
  // 3) Konum
  const posParts = tfs.filter((tf) => R[tf].range).slice(0, 3).map((tf) => { const p = R[tf].range.pos; return `${TFN[tf]} range'in ${pct(p, 0)}'inde (${p >= 0.5 ? 'premium' : 'discount'})`; });
  if (posParts.length) bullets.push(`<b>Konum:</b> ${posParts.join(', ')}. 0 dip, %100 tepe; long için discount, short için premium tercih edilir.`);
  // 4) Bölgeler: içinde olunan / yaklaşılan / en yakın
  const zones = [];
  for (const tf of tfs) for (const z of [R[tf].bestLong, R[tf].bestShort]) if (z?.compact) zones.push({ ...z, tf });
  const inside = zones.filter((z) => z.inside && z.score >= 20).sort((x, y) => y.score - x.score || TF_W[y.tf] - TF_W[x.tf]);
  const near = zones.filter((z) => !z.inside && z.distAtr != null && z.distAtr <= 1.5 && z.distPct <= 0.03 && z.score >= 20).sort((x, y) => x.distAtr - y.distAtr);
  for (const z of inside.slice(0, 2)) bullets.push(`<b>Bölgede:</b> fiyat ${TFN[z.tf]} <b>${dirTxt(z.direction)}</b> bölgesinin içinde (${zoneTxt(z, ref)}; ${z.names.join(' + ')}; puan ${z.score}).`);
  for (const z of near.slice(0, 2)) bullets.push(`<b>Yaklaşıyor:</b> ${TFN[z.tf]} ${dirTxt(z.direction)} bölgesi ${zoneTxt(z, ref)} fiyata ${pct(z.distPct, 2)} (${num(z.distAtr, 1)} ATR) uzakta; ${z.names.join(' + ')}; puan ${z.score}.`);
  if (!inside.length && !near.length) {
    const pick = (dir) => zones.filter((z) => z.direction === dir).sort((x, y) => x.distPct - y.distPct)[0];
    const L = pick('long'), S = pick('short');
    const where = (z, side) => (z.inside ? `fiyat içinde ama zayıf, puan ${z.score}` : `${pct(z.distPct, 1)} ${side}, puan ${z.score}`);
    const parts = [L && `long ${TFN[L.tf]} ${zoneTxt(L, ref)} (${where(L, 'aşağıda')})`, S && `short ${TFN[S.tf]} ${zoneTxt(S, ref)} (${where(S, 'yukarıda')})`].filter(Boolean);
    bullets.push(`<b>Bölgeler:</b> fiyat şu an güçlü bir bölgede değil.${parts.length ? ` En yakınlar: ${parts.join('; ')}.` : ''}`);
  }
  // 5) Fib kesişimi
  const fx = tfs.flatMap((tf) => R[tf].fibX.map((s) => ({ s, tf }))).filter(({ s }) => s.meta?.retr === 0.618 && s.meta?.ext === 1.272);
  for (const { s, tf } of fx.slice(0, 2)) bullets.push(`<b>Fib kesişimi 0,618×1,272:</b> ${TFN[tf]} ${dirTxt(s.direction)} bölgesi ${fp(s.entry, ref)} (${s.status === 'active' ? 'fiyat bölgede' : `fiyata ${pct(Math.abs(R[tf].price - s.entry) / R[tf].price, 2)}`}); stop önerisi ${fp(s.stop, ref)}, hedef ${fp(s.target, ref)}.`);
  // 6) Elliott
  const ew = tfs.flatMap((tf) => R[tf].signals.filter((s) => s.detector === 'elliott').map((s) => ({ s, tf }))).sort((x, y) => TF_W[y.tf] - TF_W[x.tf] || y.s.strength - x.s.strength);
  if (ew.length) bullets.push(`<b>Elliott:</b> ${ew.slice(0, 2).map(({ s, tf }) => `${TFN[tf]} ${s.name}${s.direction !== 'neutral' ? ` (${dirTxt(s.direction)})` : ''}`).join('; ')}.`);
  // 7) Momentum
  const mom = [];
  for (const tf of tfs) { const r = R[tf].rsi; if (r != null && r >= 70) mom.push(`${TFN[tf]} RSI ${num(r, 0)} aşırı alım`); else if (r != null && r <= 30) mom.push(`${TFN[tf]} RSI ${num(r, 0)} aşırı satım`); }
  const div = tfs.flatMap((tf) => R[tf].signals.filter((s) => s.detector === 'divergence' && s.status !== 'invalid').map((s) => `${TFN[tf]} ${s.name}`));
  if (mom.length || div.length) bullets.push(`<b>Momentum:</b> ${[...mom, ...div.slice(0, 3)].join('; ')}.`);
  // Karar notu
  const htfDir = dirOf(R['4H']?.trend?.dir) || dirOf(R['1D']?.trend?.dir);
  const cand = [...inside, ...near.filter((z) => z.distAtr <= 1)].filter((z) => z.score >= 35).sort((x, y) => (x.inside ? 0 : 1) - (y.inside ? 0 : 1) || y.score - x.score)[0];
  let verdict, tone = 'wait';
  if (cand) {
    const d = cand.direction === 'long' ? 1 : -1;
    const btcAgainst = coin !== 'BTC' && R[cand.tf]?.corr >= 0.6 && dirOf(R[cand.tf]?.btcTrend?.dir) === -d;
    if (htfDir === d) { verdict = `${TFN[cand.tf]} ${dirTxt(cand.direction)} bölgesi üst dilim yönüyle uyumlu ve fiyat ${cand.inside ? 'bölgede' : 'bölgeye yakın'}. 15m'de süpürme + MSS teyidi gelirse işlem düşünülebilir; stop bölgenin ötesine, risk %1.`; tone = cand.direction; }
    else if (htfDir === -d) { verdict = `${TFN[cand.tf]} ${dirTxt(cand.direction)} bölgesi üst dilime (4H/günlük) ters. Ancak teyitle ve yarım riskle (%0,5) düşünülebilir.`; tone = cand.direction; }
    else { verdict = `${TFN[cand.tf]} ${dirTxt(cand.direction)} bölgesi var, üst dilim yönü belirsiz. Teyit olmadan girme; risk %0,5–1.`; tone = cand.direction; }
    if (btcAgainst) verdict += ` BTC bu yöne ters gidiyor ve bağlantı güçlü; dikkat.`;
  } else verdict = `Şu an alınabilir bir bölgede değil. Yukarıdaki en yakın bölgelere alarm kur ve fiyat gelince 15m'de teyit bekle.`;
  if ([0, 6].includes(new Date(now).getUTCDay())) verdict += ' Hafta sonu: hacim düşük, kural gereği işlem yok.';
  const headline = `${coin}: genel eğilim ${overall === 'up' ? 'yukarı' : overall === 'down' ? 'aşağı' : 'karışık'}${a.mtf ? ` · dilimler arası uyum ${a.mtf.direction === 'long' ? 'long' : 'short'} (${a.mtf.tfs.join(', ')})` : ''}${cand ? ` · ${cand.inside ? 'bölgede' : 'bölgeye yakın'}: ${TFN[cand.tf]} ${dirTxt(cand.direction)}` : ' · bölge dışında'}`;
  return { headline, bullets, verdict, tone };
}
