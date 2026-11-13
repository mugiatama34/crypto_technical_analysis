// Gölge etiketler (yalnız kayıt): gönderilen her sinyalin geçmiş kaydına `shadow` nesnesi. Hiçbir filtre, puan, plan ya da
// mesaj kararında KULLANILMAZ; bir ay sonra hipotezleri canlı veriyle sınamak için birikir. Hesaplanamayan alan null; hiçbir
// fonksiyon hata fırlatmaz (run.mjs ayrıca try/catch ile sarar).
//   offMin            sinyalin kendi TF mumunun açılışından gönderime kadar geçen dakika (4H: 0–239)
//   openSame/openAll  gönderim anında state.sent'te açık (kapanmamış) planlardan aynı yöndekiler / tümü (bu sinyal hariç)
//   riskPct           |giriş − stop| / giriş × 100
//   rs/rsRank/rsN     BTC'ye göre güç (%), aynı turda aynı TF'de taranan coinler arasındaki yüzdelik sıra (0 en zayıf, 1 en güçlü), kaç coin
//   funding/fundingBtc  güncel fonlama oranı (%, OKX'in o coin için dönemi başına; fundingIntH = dönem saati, çıkarılabildiyse)
//   oiChg24h          açık pozisyonun ~24 saat öncesine göre % değişimi (state'teki saatlik görüntülerden; yoksa null)
import { CLOSED } from './plan.js';

const num = (x) => { if (x == null || x === '') return null; const v = typeof x === 'number' ? x : Number(x); return Number.isFinite(v) ? v : null; };
const round = (x, k) => (x == null ? null : +x.toFixed(k));

export const SHADOW_KEYS = ['offMin', 'openSame', 'openAll', 'riskPct', 'rs', 'rsRank', 'rsN', 'funding', 'fundingIntH', 'fundingBtc', 'oiChg24h'];
export const emptyShadow = () => Object.fromEntries(SHADOW_KEYS.map((k) => [k, null]));

/** Kendi TF mumunun açılışından bu yana dakika. Canlı mum varsa onun açılışı, yoksa UTC hizalı mum sınırı. */
export function offMinOf(now, tfMs, liveTime = null) {
  if (!(tfMs > 0) || !Number.isFinite(now)) return null;
  const lt = num(liveTime);
  if (lt != null && now >= lt && now - lt < tfMs) return Math.floor((now - lt) / 60e3);
  return Math.floor((((now % tfMs) + tfMs) % tfMs) / 60e3);
}

/** Açık (kapanmamış) plan sayısı: aynı yönde ve toplam. `exclude` = bu sinyalin anahtarı (key|sentAt) varsa hariç. */
export function openCounts(sent, d, exclude = null) {
  let same = 0, all = 0;
  for (const p of Array.isArray(sent) ? sent : []) {
    if (!p || !p.status || CLOSED.has(p.status)) continue;
    if (exclude && `${p.key}|${p.sentAt}` === exclude) continue;
    all++;
    const pd = p.d ?? (p.direction === 'long' ? 1 : p.direction === 'short' ? -1 : 0);
    if (pd === d) same++;
  }
  return { openSame: same, openAll: all };
}

export function riskPctOf(entry, stop) {
  const e = num(entry), s = num(stop);
  if (e == null || s == null || e === 0) return null;
  return round(Math.abs(e - s) / Math.abs(e) * 100, 2);
}

/** Yüzdelik sıra: 0 = en küçük, 1 = en büyük (eşitler ortalama sıra). n < 2 → null. */
export function pctRank(values, x) {
  const v = num(x); const xs = (values || []).map(num).filter((y) => y != null);
  if (v == null || xs.length < 2) return null;
  let less = 0, eq = 0;
  for (const y of xs) { if (y < v) less++; else if (y === v) eq++; }
  if (!eq) return null; // x kümede değil
  return round((less + (eq - 1) / 2) / (xs.length - 1), 3);
}

/** Aynı TF'de taranan satırlar arasında coin'in BTC'ye göre gücü ve sırası. */
export function rsRankOf(rows, tf, coin) {
  const same = (rows || []).filter((r) => r && !r.error && r.tf === tf && num(r.trend?.rsBtc) != null);
  const me = same.find((r) => r.coin === coin);
  const rs = me ? num(me.trend.rsBtc) : null;
  return { rs, rsRank: rs == null ? null : pctRank(same.map((r) => r.trend.rsBtc), rs), rsN: same.length || null };
}

/** Senkron etiketler (ağsız). Ağ alanları null kalır; collectShadowNet + applyShadowNet sonra doldurur. */
export function shadowBase({ now, tfMs, row, rec, sent, rows }) {
  const s = emptyShadow();
  const tryk = (fn) => { try { fn(); } catch { /* alan null kalır */ } };
  tryk(() => { s.offMin = offMinOf(now, tfMs, row?.live?.time); });
  tryk(() => { Object.assign(s, openCounts(sent, rec.d, rec.key != null ? `${rec.key}|${rec.sentAt}` : null)); });
  tryk(() => { s.riskPct = riskPctOf(rec.entry, rec.stop); });
  tryk(() => { Object.assign(s, rsRankOf(rows, rec.tf, rec.coin)); });
  return s;
}

/** Hata fırlatabilecek üreticiyi sarar: hata → boş gölge (tüm alanlar null). */
export function safeShadow(fn, onError) {
  try { const s = fn(); return s && typeof s === 'object' ? s : emptyShadow(); }
  catch (err) { onError?.(err); return emptyShadow(); }
}

// ---- Ağ yanıtları (OKX public). Alan adları: funding-rate → data[0].fundingRate (ondalık dize), fundingTime, nextFundingTime;
// open-interest → data[] { instId, oi (sözleşme), oiCcy (coin), oiUsd, ts }. Biçim beklenmedikse null.

export function parseFunding(data) {
  const x = Array.isArray(data) ? data[0] : null;
  if (!x || typeof x !== 'object') return null;
  const r = num(x.fundingRate);
  if (r == null) return null;
  const a = num(x.fundingTime), b = num(x.nextFundingTime);
  const intH = a != null && b != null && b > a ? round((b - a) / 3600e3, 2) : null;
  return { rate: round(r * 100, 5), intH: intH > 0 && intH <= 24 ? intH : null };
}

/** OI listesi → Map(coin → {v, k}); k = 'c' (oiCcy, coin adedi) ya da 'n' (oi, sözleşme; yalnız oiCcy yoksa). Yalnız -USDT-SWAP. */
export function parseOi(data, coins = null) {
  const out = new Map();
  if (!Array.isArray(data)) return out;
  for (const x of data) {
    if (!x || typeof x.instId !== 'string') continue;
    const [base, q, kind, extra] = x.instId.split('-');
    if (q !== 'USDT' || kind !== 'SWAP' || extra || !base) continue;
    if (coins && !coins.has(base)) continue;
    const c = num(x.oiCcy), n = num(x.oi);
    if (c != null && c > 0) out.set(base, { v: c, k: 'c' });
    else if (n != null && n > 0) out.set(base, { v: n, k: 'n' });
  }
  return out;
}

// Görüntü state'te tek dize olarak durur (JSON girintisi satır başına coin açmasın): "BTC=c1.2345e+6;ETH=n12345"
export function encodeSnap(map) { return [...map].map(([coin, { v, k }]) => `${coin}=${k}${+v.toPrecision(6)}`).join(';'); }
export function decodeSnap(str) {
  const out = new Map();
  if (typeof str !== 'string') return out;
  for (const part of str.split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    const k = part[i + 1], v = num(part.slice(i + 2));
    if ((k === 'c' || k === 'n') && v != null && v > 0) out.set(part.slice(0, i), { v, k });
  }
  return out;
}

export const OI_SNAP = { everyMs: 55 * 60e3, keepMs: 30 * 3600e3, targetMs: 24 * 3600e3, tolMs: 2 * 3600e3 };

/** Görüntü listesini günceller: son görüntüden ≥ everyMs geçtiyse yeni görüntü ekler; keepMs'den eskileri atar. Yeni dizi döner. */
export function updateOiSnaps(snaps, now, cur, o = OI_SNAP) {
  const list = (Array.isArray(snaps) ? snaps : []).filter((s) => s && Number.isFinite(s.t) && typeof s.d === 'string' && now - s.t <= o.keepMs && s.t <= now);
  const last = list.reduce((m, s) => Math.max(m, s.t), -Infinity);
  let added = false;
  if (cur && cur.size && now - last >= o.everyMs) { list.push({ t: now, d: encodeSnap(cur) }); added = true; }
  list.sort((a, b) => a.t - b.t);
  return { snaps: list, added };
}

/** ~24 saat öncesine (± tolMs) en yakın görüntüye göre % değişim. Görüntü yoksa / birim farklıysa null. */
export function oiChange(snaps, now, coin, curEntry, o = OI_SNAP) {
  if (!curEntry || !(curEntry.v > 0)) return null;
  const want = now - o.targetMs;
  let best = null;
  for (const s of Array.isArray(snaps) ? snaps : []) {
    if (!s || !Number.isFinite(s.t)) continue;
    const dt = Math.abs(s.t - want);
    if (dt <= o.tolMs && (!best || dt < Math.abs(best.t - want))) best = s;
  }
  if (!best) return null;
  const old = decodeSnap(best.d).get(coin);
  if (!old || old.k !== curEntry.k || !(old.v > 0)) return null;
  return round((curEntry.v / old.v - 1) * 100, 2);
}

/** Süre sınırlı söz: süre dolunca null ile çözülür (asla reddetmez). */
function withBudget(p, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, err: 'zaman aşımı' }), ms);
    Promise.resolve().then(() => p).then((v) => { clearTimeout(t); resolve({ ok: true, v }); }, (e) => { clearTimeout(t); resolve({ ok: false, err: e?.message || String(e) }); });
  });
}

/**
 * Ağ kısmı: sinyal coinleri + BTC için fonlama (coin başına bir çağrı), tüm swap'lar için TEK açık pozisyon çağrısı (yalnız gerekiyorsa:
 * bu turda sinyal var ya da görüntü zamanı geldi). Toplam süre `budgetMs` ile sınırlı; hiçbir durumda hata fırlatmaz.
 * @param get (path, params, {signal}) → data dizisi (okxGet uyumlu)
 * @returns {{ funding: Map, oiCur: Map, snaps: Array, added: boolean, line: string }}
 */
export async function collectShadowNet({ get, sigCoins = [], scanned = null, snaps = [], now, budgetMs = 4000, o = OI_SNAP }) {
  const funding = new Map(); let oiCur = new Map(); let outSnaps = Array.isArray(snaps) ? snaps : []; let added = false;
  const notes = [];
  try {
    const coins = [...new Set(sigCoins.length ? [...sigCoins, 'BTC'] : [])];
    const last = outSnaps.reduce((m, s) => Math.max(m, Number.isFinite(s?.t) ? s.t : -Infinity), -Infinity);
    const needOi = sigCoins.length > 0 || now - last >= o.everyMs;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const call = (path, params) => { try { return get(path, params, { signal: ctrl?.signal, lane: 'other' }); } catch (e) { return Promise.reject(e); } };
    const jobs = coins.map((c) => call('/api/v5/public/funding-rate', { instId: `${c}-USDT-SWAP` }));
    const oiJob = needOi ? call('/api/v5/public/open-interest', { instType: 'SWAP' }) : null;
    const all = await withBudget(Promise.allSettled([...jobs, ...(oiJob ? [oiJob] : [])]), budgetMs);
    if (!all.ok) { ctrl?.abort(); notes.push(all.err); }
    const res = all.ok ? all.v : [];
    let fOk = 0;
    coins.forEach((c, i) => { const r = res[i]; const f = r?.status === 'fulfilled' ? parseFunding(r.value) : null; if (f) { funding.set(c, f); fOk++; } });
    let oiNote = needOi ? 'açık pozisyon alınamadı' : 'açık pozisyon atlandı (görüntü taze)';
    if (oiJob) {
      const r = res[coins.length];
      if (r?.status === 'fulfilled') { oiCur = parseOi(r.value, scanned); oiNote = `açık pozisyon ${oiCur.size} coin`; }
      else if (r?.status === 'rejected') notes.push(`OI: ${r.reason?.message || r.reason}`);
    }
    const u = updateOiSnaps(outSnaps, now, oiCur, o); outSnaps = u.snaps; added = u.added;
    return { funding, oiCur, snaps: outSnaps, added, line: `Gölge etiket: fonlama ${fOk}/${coins.length} ok · ${oiNote} · görüntü ${outSnaps.length}${added ? ' (+1)' : ''}${notes.length ? ' · ' + notes.join('; ') : ''}` };
  } catch (err) {
    return { funding, oiCur, snaps: outSnaps, added, line: `Gölge etiket: hata (${err?.message || err}) · görüntü ${outSnaps.length}` };
  }
}

/** Ağ sonuçlarını bu turun gölge nesnelerine yazar (yerinde). items: [{coin, shadow}] */
export function applyShadowNet(items, net, now, o = OI_SNAP) {
  const btc = net?.funding?.get('BTC') || null;
  for (const it of items || []) {
    const s = it?.shadow; if (!s) continue;
    try {
      const f = net?.funding?.get(it.coin) || null;
      s.funding = f ? f.rate : null; s.fundingIntH = f ? f.intH : null;
      s.fundingBtc = btc ? btc.rate : null;
      s.oiChg24h = net?.oiCur ? oiChange(net.snaps, now, it.coin, net.oiCur.get(it.coin), o) : null;
    } catch { /* alanlar null kalır */ }
  }
  return items;
}
