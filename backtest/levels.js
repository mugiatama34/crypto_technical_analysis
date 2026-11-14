// Sahte seviye testi (14.11.2026; tanımlar docs/arastirma/on-kayit-seviye.md, bağlayıcı) — saf fonksiyonlar (ağ yok).
// Betik: backtest/levels.mjs. Strateji backtest'i DEĞİL: yalnız "inanılan seviyede tepki oranı − sahte seviyede tepki oranı".
//   S1: nedensel ATR zigzag bacaklarının Fibonacci geri çekilme seviyeleri (0,382 · 0,5 · 0,618) ↔ komşu sahte seviyeler (0,31 · 0,44 · 0,56 · 0,66)
//   S2: yuvarlak sayılar (s = 10^⌊log10 fiyat⌋ katları) ↔ k·s + 0,37 s ve k·s + 0,63 s
// Nedensellik: bacak yalnız tamamlanma mumuna kadarki veriyle belirlenir; seviyeler o anda sabitlenir; olay / sonuç SONRAKİ mumlardan.
import * as I from '../src/data/indicators.js';
import { seedOf } from './diag.js';
import { mulberry32 } from './report.js';
import { halfOf, HALF_A_START, HALF_B_START, DAY } from './screen.js';

export { HALF_A_START, HALF_B_START, DAY };
export const LEVELS_DEFAULTS = {
  atrPeriod: 14, revAtr: 2, minLegAtr: 10, // zigzag: uçtan ≥ 2 ATR ters hareket = bacak tamamlandı; bacak ≥ 10 ATR
  window: 60, horizon: 40, outcomeFrac: 0.10, // S1: tamamlanmadan sonra en çok 60 mumda ilk dokunuş; sonuç ±0,10 × bacak, 40 mum
  believed: [0.382, 0.5, 0.618], fake: [0.31, 0.44, 0.56, 0.66],
  neighbors: { 0.382: [0.31, 0.44], 0.5: [0.44, 0.56], 0.618: [0.56, 0.66] },
  s2: { roundOffsets: [0], fakeOffsets: [0.37, 0.63], armFrac: 0.25, outcomeFrac: 0.10, oslerFrac: 0.02, oslerBars: 6 },
  minEvents: 200, reps: 2000, level: 0.99, seed: 20261114,
};
export const VERDICT = { pass: 'seviye tepki çekiyor', fail: 'geçmedi', inconclusive: 'sonuçsuz' };
export const RES = { react: 'tepki', brk: 'kırılım', amb: 'belirsiz', none: 'sonuçsuz', horizon: 'ufuk' };

const rd = (x, n = 4) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(n));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const dayOf = (t) => Math.floor(t / DAY) * DAY;
export const levelKey = (r) => String(r);

// ---------------- Zigzag (nedensel, artımlı) ----------------
/**
 * Artımlı ATR zigzag. push(bar, atr) her mumda bir kez çağrılır; o mumda tamamlanan bacağı döner (yoksa null).
 * Kural: yön yukarıyken uç = en yüksek tepe; yeni tepe yapan mumda dönüş aranmaz (mum içi sıra bilinmez); sonraki mumlarda
 * dip ≤ uç − revAtr × ATR[i] → yukarı bacak (başlangıç pivotu → uç) i mumunda tamamlandı, yeni aşağı bacak uçtan başlar; uç = uçtan
 * sonraki (uç mumu hariç) mumların en düşük dibi. Aşağı yön simetrik. İlk bacak iki pivot arasında olmalı: başlangıçta yön yok,
 * ilk dönüş yalnız ilk pivotu belirler. eligible = |uç − başlangıç| ≥ minLegAtr × ATR[i].
 * Bacak: { dir (+1 yukarı / −1 aşağı), startIdx, start, tipIdx, tip, doneIdx, atr, size, eligible }
 */
export class ZigZag {
  constructor({ revAtr = LEVELS_DEFAULTS.revAtr, minLegAtr = LEVELS_DEFAULTS.minLegAtr } = {}) {
    Object.assign(this, { revAtr, minLegAtr, i: -1, dir: 0, bars: [] });
    this.hi = null; this.lo = null; // yön yokken: { p, idx }
    this.startP = null; this.startIdx = null; this.ext = null; this.extIdx = null;
  }

  /** e+1..i aralığında (dahil) yöne göre karşı uç: dir +1 → en düşük dip, −1 → en yüksek tepe. */
  _counter(from, to, side) {
    let p = side < 0 ? Infinity : -Infinity, idx = -1;
    for (let k = from; k <= to; k++) { const b = this.bars[k]; const v = side < 0 ? b.low : b.high; if (side < 0 ? v < p : v > p) { p = v; idx = k; } }
    return { p, idx };
  }

  push(bar, atr) {
    const i = ++this.i;
    this.bars.push({ high: bar.high, low: bar.low });
    if (!(atr > 0)) { // ATR ısınması: yalnız uçları izle
      if (this.dir === 0) this._trackInit(bar, i);
      else this._extend(bar, i);
      return null;
    }
    const th = this.revAtr * atr;
    if (this.dir === 0) {
      if (this.hi == null) { this._trackInit(bar, i); return null; }
      const newHi = bar.high > this.hi.p, newLo = bar.low < this.lo.p;
      // Yeni uç yapılmayan tarafta dönüş: tepeden ≥ th aşağı → ilk pivot tepe (yön aşağı); dipten ≥ th yukarı → ilk pivot dip
      const downRev = !newHi && i > this.hi.idx && bar.low <= this.hi.p - th;
      const upRev = !newLo && i > this.lo.idx && bar.high >= this.lo.p + th;
      if (downRev && (!upRev || this.hi.idx > this.lo.idx)) {
        const c = this._counter(this.hi.idx + 1, i, -1);
        Object.assign(this, { dir: -1, startP: this.hi.p, startIdx: this.hi.idx, ext: c.p, extIdx: c.idx });
      } else if (upRev) {
        const c = this._counter(this.lo.idx + 1, i, +1);
        Object.assign(this, { dir: +1, startP: this.lo.p, startIdx: this.lo.idx, ext: c.p, extIdx: c.idx });
      } else this._trackInit(bar, i);
      return null;
    }
    if (this._extend(bar, i)) return null; // yeni uç: bu mumda dönüş yok
    const d = this.dir;
    const rev = d > 0 ? bar.low <= this.ext - th : bar.high >= this.ext + th;
    if (!rev) return null;
    const size = Math.abs(this.ext - this.startP);
    const leg = { dir: d, startIdx: this.startIdx, start: this.startP, tipIdx: this.extIdx, tip: this.ext, doneIdx: i, atr, size, eligible: size >= this.minLegAtr * atr };
    const c = this._counter(this.extIdx + 1, i, -d);
    Object.assign(this, { dir: -d, startP: this.ext, startIdx: this.extIdx, ext: c.p, extIdx: c.idx });
    return leg;
  }

  _trackInit(bar, i) {
    if (this.hi == null || bar.high > this.hi.p) this.hi = { p: bar.high, idx: i };
    if (this.lo == null || bar.low < this.lo.p) this.lo = { p: bar.low, idx: i };
  }

  /** Yönde yeni uç → true. */
  _extend(bar, i) {
    if (this.dir > 0 && bar.high > this.ext) { this.ext = bar.high; this.extIdx = i; return true; }
    if (this.dir < 0 && bar.low < this.ext) { this.ext = bar.low; this.extIdx = i; return true; }
    return false;
  }
}

/** Seri ATR'si (Wilder, src/data/indicators.js). */
export const atrOf = (candles, period = LEVELS_DEFAULTS.atrPeriod) => I.atr(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), period);

/** Tüm seri → tamamlanan bacaklar (uygun olsun olmasın). */
export function zigzagLegs(candles, p = LEVELS_DEFAULTS, atr = atrOf(candles, p.atrPeriod)) {
  const z = new ZigZag(p), out = [];
  for (let i = 0; i < candles.length; i++) { const leg = z.push(candles[i], atr[i]); if (leg) out.push(leg); }
  return out;
}

/** Geri çekilme seviyesi: 0 = uç, 1 = başlangıç. Yukarı bacak: uç − r × bacak; aşağı bacak: uç + r × bacak. */
export const fibPrice = (leg, r) => leg.tip - leg.dir * r * leg.size;

// ---------------- Sonuç sınıflaması ----------------
/**
 * Dokunuş mumu j, seviye L, dir: tepki yönü (+1 = fiyat yukarıdan geldi, tepki yukarı; −1 tersi), d: hedef uzaklığı (fiyat).
 * Tepki = L + dir·d'ye, L − dir·d'ye (kırılım) gitmeden önce ulaşmak. Dokunuş mumunda: kırılım = uç L − dir·d'yi geçti (dokunuştan
 * sonra olduğu kesin); tepki yalnız mum içi sıra kesinse sayılır (kapanış ≥ hedef ya da açılış seviyenin ötesinde = dokunuş açılışta).
 * Sonraki mumlar j+1 … j+horizon: ikisi aynı mumda = belirsiz; hiçbiri = sonuçsuz; seri biterse = ufuk (ufku dolmadı, ayrı sayılır).
 * → { res, k } (k = sonucun mum indeksi)
 */
export function classify(c, j, L, dir, d, horizon = LEVELS_DEFAULTS.horizon) {
  const up = L + dir * d, dn = L - dir * d;
  const hitUp = (b) => (dir > 0 ? b.high >= up : b.low <= up);
  const hitDn = (b) => (dir > 0 ? b.low <= dn : b.high >= dn);
  const b0 = c[j];
  const brk0 = hitDn(b0);
  const rea0 = dir * (b0.close - up) >= 0 || (dir * (b0.open - L) <= 0 && hitUp(b0));
  if (brk0 && rea0) return { res: RES.amb, k: j };
  if (brk0) return { res: RES.brk, k: j };
  if (rea0) return { res: RES.react, k: j };
  for (let k = j + 1; k <= j + horizon; k++) {
    if (k >= c.length) return { res: RES.horizon, k: null };
    const u = hitUp(c[k]), b = hitDn(c[k]);
    if (u && b) return { res: RES.amb, k };
    if (b) return { res: RES.brk, k };
    if (u) return { res: RES.react, k };
  }
  return { res: RES.none, k: null };
}

// ---------------- S1 ----------------
/**
 * Bir bacağın seviye olayları. Bacak doneIdx'te sabitlenir; dokunuş doneIdx+1 … doneIdx+window mumlarında aranır.
 * - Tamamlanma anında seviye ÇOKTAN geçilmişse (uçtan sonraki mumlardan doneIdx dahil en derin nokta seviyeyi geçti): 'passed'.
 * - Bacağın ucu aşılırsa (yukarı bacakta tepe > uç) bacak kapanır: dokunulmamış seviyeler 'closed'; uç aşımı ile dokunuş aynı mumdaysa
 *   (sıra bilinmez) 'tipSameBar' (olay yok).
 * - Pencerede dokunuş yok: 'noTouch'; seri penceren önce biterse ve dokunuş yoksa 'noTouchTrunc'.
 * Her bacak kendi penceresinde bağımsız izlenir (sonraki bacağın tamamlanması öncekini kapatmaz).
 * → [{ r, status, j?, L }]
 */
export function legLevelTouches(c, leg, levels, p = LEVELS_DEFAULTS) {
  const d = leg.dir;
  let deepest = d > 0 ? Infinity : -Infinity; // uçtan sonra, doneIdx dahil
  for (let k = leg.tipIdx + 1; k <= leg.doneIdx; k++) deepest = d > 0 ? Math.min(deepest, c[k].low) : Math.max(deepest, c[k].high);
  const out = levels.map((r) => ({ r, L: fibPrice(leg, r), status: null }));
  for (const o of out) if (d > 0 ? deepest <= o.L : deepest >= o.L) o.status = 'passed';
  const end = leg.doneIdx + p.window;
  for (let k = leg.doneIdx + 1; k <= end; k++) {
    if (k >= c.length) { for (const o of out) if (!o.status) o.status = 'noTouchTrunc'; break; }
    const b = c[k], tipX = d > 0 ? b.high > leg.tip : b.low < leg.tip;
    for (const o of out) {
      if (o.status) continue;
      const touch = d > 0 ? b.low <= o.L : b.high >= o.L;
      if (touch && tipX) o.status = 'tipSameBar';
      else if (touch) { o.status = 'event'; o.j = k; }
    }
    if (tipX) { for (const o of out) if (!o.status) o.status = 'closed'; break; }
    if (out.every((o) => o.status)) break;
  }
  for (const o of out) if (!o.status) o.status = 'noTouch';
  return out;
}

/** Bir seri → S1 olayları ve sayımlar. events: [{ key, t, day, res, coin }]. */
export function s1Series({ coin, candles }, p = LEVELS_DEFAULTS) {
  const atr = atrOf(candles, p.atrPeriod);
  const legs = zigzagLegs(candles, p, atr);
  const levels = [...p.believed, ...p.fake].sort((a, b) => a - b);
  const events = [], status = {};
  const legStats = { total: legs.length, eligible: 0, up: 0, down: 0, byHalf: { pre: 0, A: 0, B: 0 } };
  for (const leg of legs) {
    if (!leg.eligible) continue;
    legStats.eligible++; leg.dir > 0 ? legStats.up++ : legStats.down++;
    legStats.byHalf[halfOf(candles[leg.doneIdx].time) || 'pre']++;
    for (const o of legLevelTouches(candles, leg, levels, p)) {
      const k = levelKey(o.r);
      const st = (status[k] ||= {});
      if (o.status !== 'event') { st[o.status] = (st[o.status] || 0) + 1; continue; }
      const t = candles[o.j].time;
      if (!halfOf(t)) { st.preHalfA = (st.preHalfA || 0) + 1; continue; }
      const { res } = classify(candles, o.j, o.L, leg.dir, p.outcomeFrac * leg.size, p.horizon);
      events.push({ key: k, t, day: dayOf(t), res, coin });
    }
  }
  return { events, status, legStats };
}

// ---------------- S2 ----------------
/** Adım: s = 10^⌊log10(fiyat)⌋ (kayan nokta düzeltmeli). */
export function stepOf(price) {
  if (!(price > 0)) return null;
  let e = Math.floor(Math.log10(price));
  if (10 ** (e + 1) <= price) e++;
  else if (10 ** e > price) e--;
  return { e, s: 10 ** e };
}

/**
 * S2 olayları (seviye başına durum makinesi). Her j ≥ 1 mumunda s = adım(önceki kapanış) (olay anındaki s). Mumun [dip, tepe]
 * aralığındaki tüm seviyeler (k + ofset) · s; seviye "kurulu" ise dokunuş = olay; olaydan sonra kurulum düşer. Kurulum: önceki
 * mumlardan birinde (dokunuş mumundan SONRA) tepe ≥ L + 0,25 s ya da dip ≤ L − 0,25 s (fiyat 0,25 s uzaklaştı). Hiç dokunulmamış seviye:
 * önceki mumların herhangi birinde aynı uzaklık (koşan en yüksek tepe / en düşük dip ile). Mum içinde önce dokunuş, sonra yeniden kurma
 * değerlendirilir. Yaklaşma yönü: önceki kapanış seviyenin üstündeyse yukarıdan (tepki yönü +1), altındaysa aşağıdan (−1); eşitse atlanır.
 * Bilgi amaçlı Osler ölçüsü: dokunuş mumundan itibaren horizon içinde seviye yaklaşma yönünde 0,02 s aşılırsa (ilk aşım mumu m), aşım
 * noktası X = L ∓ 0,02 s; devam = −dir · (kapanış[m + 6] − X) / s (pozitif = aşım yönünde devam).
 * → { events: [{ key: 'round'|'fake', t, day, res, dir, coin, cont? }], counts }
 */
export function s2Series({ coin, candles: c }, p = LEVELS_DEFAULTS) {
  const o = p.s2, events = [], counts = { skippedEqual: 0, preHalfA: 0, notArmed: 0 };
  const offs = [...o.roundOffsets.map((x) => ({ off: x, key: 'round' })), ...o.fakeOffsets.map((x) => ({ off: x, key: 'fake' }))];
  const state = new Map(); // anahtar → { armed, touchBar, L, s }
  const disarmed = new Set();
  let maxHigh = -Infinity, minLow = Infinity; // önceki mumların koşan uçları
  for (let j = 0; j < c.length; j++) {
    const b = c[j];
    if (j >= 1) {
      const st = stepOf(c[j - 1].close);
      if (st) {
        const { e, s } = st, arm = o.armFrac * s;
        for (const { off, key } of offs) {
          const k0 = Math.ceil(b.low / s - off - 1e-12), k1 = Math.floor(b.high / s - off + 1e-12);
          for (let k = k0; k <= k1; k++) {
            const L = (k + off) * s;
            if (!(L > 0) || L < b.low || L > b.high) continue;
            const id = `${e}|${k}|${off}`;
            let S = state.get(id);
            if (!S) {
              S = { armed: maxHigh >= L + arm || minLow <= L - arm, touchBar: j, L, s }; state.set(id, S);
              if (!S.armed) disarmed.add(id); // ilk görüşte kurulu değil: bundan sonra 0,25 s uzaklaşınca kurulur
            }
            if (!S.armed) { counts.notArmed++; continue; }
            S.armed = false; S.touchBar = j; disarmed.add(id);
            const pc = c[j - 1].close;
            if (pc === L) { counts.skippedEqual++; continue; }
            if (!halfOf(b.time)) { counts.preHalfA++; continue; }
            const dir = pc > L ? 1 : -1;
            const { res } = classify(c, j, L, dir, o.outcomeFrac * s, p.horizon);
            const ev = { key, t: b.time, day: dayOf(b.time), res, dir, coin };
            const cont = oslerCont(c, j, L, dir, s, o, p.horizon);
            if (cont != null) ev.cont = cont;
            events.push(ev);
          }
        }
      }
    }
    // yeniden kurma: dokunuş mumundan sonraki mumlar
    for (const id of disarmed) {
      const S = state.get(id);
      if (j <= S.touchBar) continue;
      if (b.high >= S.L + o.armFrac * S.s || b.low <= S.L - o.armFrac * S.s) { S.armed = true; disarmed.delete(id); }
    }
    if (b.high > maxHigh) maxHigh = b.high;
    if (b.low < minLow) minLow = b.low;
  }
  return { events, counts };
}

/** Osler devam ölçüsü (s biriminde) ya da null (aşım yok / ufuk dolmadı). */
export function oslerCont(c, j, L, dir, s, o = LEVELS_DEFAULTS.s2, horizon = LEVELS_DEFAULTS.horizon) {
  const X = L - dir * o.oslerFrac * s;
  for (let m = j; m <= j + horizon && m < c.length; m++) {
    if (dir > 0 ? c[m].low <= X : c[m].high >= X) {
      const e = m + o.oslerBars;
      return e < c.length ? -dir * (c[e].close - X) / s : null;
    }
  }
  return null;
}

// ---------------- Özet + bootstrap ----------------
/** Olaylar → anahtar başına sayım: { n, react, brk, amb, none, horizon, resolved, rate, ambShare, noneShare }. */
export function tally(events, keys) {
  const out = {};
  for (const k of keys) out[k] = { n: 0, react: 0, brk: 0, amb: 0, none: 0, horizon: 0 };
  const F = { [RES.react]: 'react', [RES.brk]: 'brk', [RES.amb]: 'amb', [RES.none]: 'none', [RES.horizon]: 'horizon' };
  for (const e of events) { const x = out[e.key]; if (!x) continue; x.n++; x[F[e.res]]++; }
  for (const x of Object.values(out)) {
    x.resolved = x.react + x.brk;
    x.rate = x.resolved ? rd(x.react / x.resolved) : null;
    x.ambShare = x.n ? rd(x.amb / x.n) : null;
    x.noneShare = x.n ? rd(x.none / x.n) : null;
  }
  return out;
}

/**
 * Gün bloklu bootstrap (yerine koyarak, blok = dokunuş günü UTC). blocks: Map gün → Float64Array(w) (toplanabilir sayılar);
 * stat(tot: Float64Array) → sayı dizisi. → her bileşen için [alt, üst] (%level aralık; NaN örnekler atılır) ya da null.
 */
export function bootstrapBlocks(blocks, w, stat, { reps, seed, level }) {
  const B = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]), D = B.length;
  if (D < 2) return null;
  const rnd = mulberry32(seed), tot = new Float64Array(w), samples = [];
  for (let r = 0; r < reps; r++) {
    tot.fill(0);
    for (let j = 0; j < D; j++) { const b = B[(rnd() * D) | 0]; for (let q = 0; q < w; q++) tot[q] += b[q]; }
    samples.push(stat(tot));
  }
  const m = samples[0].length, lo = (1 - level) / 2;
  return Array.from({ length: m }, (_, q) => {
    const v = samples.map((x) => x[q]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const at = (pp) => v[Math.min(v.length - 1, Math.max(0, Math.floor(pp * v.length)))];
    return [rd(at(lo)), rd(at(1 - lo))];
  });
}

/** Gün blokları: her anahtar için [tepki, çözülmüş] (+ isteğe bağlı ek alanlar). */
function dayBlocks(events, keys, extra = null) {
  const w = keys.length * 2 + (extra ? extra.w : 0), m = new Map();
  const ix = new Map(keys.map((k, q) => [k, q]));
  for (const e of events) {
    let b = m.get(e.day); if (!b) { b = new Float64Array(w); m.set(e.day, b); }
    const q = ix.get(e.key);
    if (q != null && (e.res === RES.react || e.res === RES.brk)) { b[2 * q + 1]++; if (e.res === RES.react) b[2 * q]++; }
    if (extra) extra.add(b, e, keys.length * 2);
  }
  return { m, w };
}

/** S1 istatistiği: totaller → [fark_0,382, fark_0,5, fark_0,618, birincil]. Birincil = farkların inanılan seviye çözülmüş olay sayısıyla ağırlıklı ortalaması. */
export function s1Stat(tot, keys, p = LEVELS_DEFAULTS) {
  const ix = new Map(keys.map((k, q) => [k, q]));
  const rate = (r) => { const q = ix.get(levelKey(r)); return tot[2 * q + 1] > 0 ? tot[2 * q] / tot[2 * q + 1] : NaN; };
  const diffs = p.believed.map((b) => { const [f1, f2] = p.neighbors[b]; return rate(b) - (rate(f1) + rate(f2)) / 2; });
  const ws = p.believed.map((b) => tot[2 * ix.get(levelKey(b)) + 1]);
  return [...diffs, weightedPrimary(diffs, ws)];
}

/** Ağırlıklı ortalama (NaN farklar atılır; ağırlık toplamı 0 → NaN). */
export function weightedPrimary(diffs, ws) {
  let s = 0, w = 0;
  diffs.forEach((d, q) => { if (Number.isFinite(d) && ws[q] > 0) { s += d * ws[q]; w += ws[q]; } });
  return w > 0 ? s / w : NaN;
}

/** Bir yarının S1 hücresi. */
export function s1Cell(events, p = LEVELS_DEFAULTS, seedKey = 's1') {
  const keys = [...p.believed, ...p.fake].sort((a, b) => a - b).map(levelKey);
  const levels = tally(events, keys);
  const { m, w } = dayBlocks(events, keys);
  const tot = new Float64Array(w); for (const b of m.values()) for (let q = 0; q < w; q++) tot[q] += b[q];
  const st = s1Stat(tot, keys, p);
  const ci = bootstrapBlocks(m, w, (t) => s1Stat(t, keys, p), { reps: p.reps, seed: seedOf(seedKey, p.seed), level: p.level });
  const diffs = Object.fromEntries(p.believed.map((b, q) => [levelKey(b), { vs: p.neighbors[b], diff: rd(st[q]), ci99: ci?.[q] ?? null, weight: levels[levelKey(b)].resolved }]));
  const nBelieved = p.believed.reduce((a, b) => a + levels[levelKey(b)].resolved, 0);
  const nFake = p.fake.reduce((a, b) => a + levels[levelKey(b)].resolved, 0);
  return { levels, diffs, diff: rd(st[3]), ci99: ci?.[3] ?? null, nBelieved, nFake, days: m.size, inconclusive: nBelieved < p.minEvents };
}

/** S2 istatistiği: [yuvarlak oran − sahte oran, Osler devam farkı (yuvarlak − sahte)]. */
function s2Stat(tot) {
  const rr = tot[1] > 0 ? tot[0] / tot[1] : NaN, rf = tot[3] > 0 ? tot[2] / tot[3] : NaN;
  const cr = tot[5] > 0 ? tot[4] / tot[5] : NaN, cf = tot[7] > 0 ? tot[6] / tot[7] : NaN;
  return [rr - rf, cr - cf];
}

/** Bir yarının S2 hücresi. */
export function s2Cell(events, p = LEVELS_DEFAULTS, seedKey = 's2') {
  const keys = ['round', 'fake'];
  const levels = tally(events, keys);
  const { m, w } = dayBlocks(events, keys, { w: 4, add: (b, e, o) => { if (e.cont == null) return; const q = e.key === 'round' ? 0 : 2; b[o + q] += e.cont; b[o + q + 1]++; } });
  const tot = new Float64Array(w); for (const b of m.values()) for (let q = 0; q < w; q++) tot[q] += b[q];
  const st = s2Stat(tot);
  const ci = bootstrapBlocks(m, w, s2Stat, { reps: p.reps, seed: seedOf(seedKey, p.seed), level: p.level });
  const osler = {
    def: `seviye yaklaşma yönünde ${p.s2.oslerFrac} s aşıldıktan sonra ${p.s2.oslerBars} mumda aynı yönde devam (s biriminde; bilgi amaçlı)`,
    round: { n: tot[5], mean: tot[5] ? rd(tot[4] / tot[5]) : null }, fake: { n: tot[7], mean: tot[7] ? rd(tot[6] / tot[7]) : null }, diff: rd(st[1]), ci99: ci?.[1] ?? null,
  };
  const dirs = Object.fromEntries(keys.map((k) => [k, { fromAbove: tally(events.filter((e) => e.dir > 0), keys)[k], fromBelow: tally(events.filter((e) => e.dir < 0), keys)[k] }]));
  return { levels, byApproach: dirs, diff: rd(st[0]), ci99: ci?.[0] ?? null, nBelieved: levels.round.resolved, nFake: levels.fake.resolved, days: m.size, inconclusive: levels.round.resolved < p.minEvents, osler };
}

/** Ön kayıt ölçütü: iki yarıda da fark > 0 ve %99 alt uç > 0; yarı başına inanılan seviyelerde ≥ minEvents çözülmüş olay (değilse sonuçsuz). */
export function verdictOf(A, B) {
  const chk = (c) => ({ diff: !!(c && c.diff > 0), ciLo: !!(c && c.ci99 && c.ci99[0] > 0), n: !!(c && !c.inconclusive) });
  const checks = { A: chk(A), B: chk(B) };
  if (!A || !B || A.inconclusive || B.inconclusive) return { verdict: VERDICT.inconclusive, checks };
  const ok = ['A', 'B'].every((h) => checks[h].diff && checks[h].ciLo);
  return { verdict: ok ? VERDICT.pass : VERDICT.fail, checks };
}

const sumObj = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = typeof v === 'object' && v ? sumObj(a[k] || {}, v) : (a[k] || 0) + v; return a; };
const byHalf = (events, h) => events.filter((e) => halfOf(e.t) === h);

/** Bir zaman dilimi (seriler aynı TF) → { s1, s2, legs }. */
export function runTf(series, p = LEVELS_DEFAULTS, tag = '4H') {
  const s1e = [], s2e = [], s1status = {}, legs = {}, s2counts = {};
  const perCoin = [];
  for (const s of series) {
    if (!s.candles?.length) continue;
    const a = s1Series(s, p), b = s2Series(s, p);
    s1e.push(...a.events); s2e.push(...b.events);
    sumObj(s1status, a.status); sumObj(legs, a.legStats); sumObj(s2counts, b.counts);
    perCoin.push({ coin: s.coin, candles: s.candles.length, legsEligible: a.legStats.eligible, s1Events: a.events.length, s2Events: b.events.length });
  }
  const s1 = { A: s1Cell(byHalf(s1e, 'A'), p, `s1|${tag}|A`), B: s1Cell(byHalf(s1e, 'B'), p, `s1|${tag}|B`) };
  const s2 = { A: s2Cell(byHalf(s2e, 'A'), p, `s2|${tag}|A`), B: s2Cell(byHalf(s2e, 'B'), p, `s2|${tag}|B`) };
  return {
    s1: { ...s1, ...verdictOf(s1.A, s1.B), eventsTotal: s1e.length, touchStatus: s1status },
    s2: { ...s2, ...verdictOf(s2.A, s2.B), eventsTotal: s2e.length, counts: s2counts },
    legs, perCoin,
  };
}

/** Uçtan uca: series4h, series1d ([{ coin, candles }]) → { meta, s1, s2, info1d? }. */
export function runLevels({ series4h, series1d = [], now = Date.now(), p: pIn = {}, meta = {} }) {
  const p = { ...LEVELS_DEFAULTS, ...pIn, s2: { ...LEVELS_DEFAULTS.s2, ...(pIn.s2 || {}) } };
  const r4 = runTf(series4h, p, '4H');
  const ends = series4h.filter((s) => s.candles?.length).map((s) => s.candles.at(-1).time);
  const dataEnd = ends.length ? Math.max(...ends) : null;
  const out = {
    meta: {
      ...meta, generatedAt: now, tf: '4H', dataEnd,
      period: `${iso(HALF_A_START)} → ${dataEnd ? iso(dataEnd) : '—'}`,
      halves: { A: `${iso(HALF_A_START)} → ${iso(HALF_B_START)} (hariç)`, B: `${iso(HALF_B_START)} → ${dataEnd ? iso(dataEnd) : '—'}`, rule: 'dokunuş mumunun zamanına göre; A öncesi dokunuşlar (ısınma) sayılmaz' },
      coins: series4h.filter((s) => s.candles?.length).length,
      params: { atrPeriod: p.atrPeriod, revAtr: p.revAtr, minLegAtr: p.minLegAtr, window: p.window, horizon: p.horizon, outcomeFrac: p.outcomeFrac, believed: p.believed, fake: p.fake, neighbors: p.neighbors, s2: p.s2, minEvents: p.minEvents, seed: p.seed, bootstrap: { reps: p.reps, level: p.level, block: 'dokunuş günü (UTC)' } },
      legs: r4.legs, perCoin: r4.perCoin,
      choices: CHOICES,
    },
    s1: r4.s1, s2: r4.s2,
  };
  const d1 = series1d.filter((s) => s.candles?.length);
  if (d1.length) {
    const r1 = runTf(d1, p, '1D');
    out.info1d = { info: 'bilgi amaçlı 1D sürümü (aynı parametreler mum cinsinden); karara girmez', coins: d1.length, legs: r1.legs, s1: r1.s1, s2: r1.s2 };
  }
  return out;
}

export const CHOICES = [
  'zigzag: yeni uç yapan mumda dönüş aranmaz (mum içi sıra bilinmez); dönüş = uçtan sonraki bir mumun ucu ≥ 2 × ATR(14)[o mum] ters; bacak başlangıcı önceki pivot (ilk dönüş yalnız ilk pivotu belirler)',
  'S1 "zaten geçilmiş": uçtan sonraki mumlar (tamamlanma mumu dahil) seviyeyi geçmişse olay yok (touchStatus.passed)',
  'S1 bacaklar bağımsız: her bacak kendi 60 mumluk penceresinde izlenir; sonraki bacağın tamamlanması öncekini kapatmaz; uç aşılınca kapanır (closed); uç aşımı ve dokunuş aynı mumdaysa olay yok (tipSameBar)',
  'sonuç: dokunuş mumunda kırılım (uç seviye ∓ 0,10 geçti) sayılır; tepki yalnız mum içi sıra kesinse (kapanış hedefte ya da açılış seviyenin ötesinde); sonra 40 mum (dokunuş mumu hariç); seri biterse "ufuk" (ayrı, hariç)',
  'tepki oranı = tepki ÷ (tepki + kırılım); "olay sayısı" (200 eşiği ve birincil ağırlık) = çözülmüş olaylar (tepki + kırılım)',
  'S2: s = 10^⌊log10(önceki kapanış)⌋; yaklaşma yönü önceki kapanışa göre; kurulum = dokunuş mumundan sonraki bir mumun ucu seviyeden ≥ 0,25 s uzak (hiç dokunulmamış seviye: önceki herhangi bir mumda); mum içinde önce dokunuş, sonra yeniden kurma; s değişince seviye durumu ayrı tutulur (anahtar = üs | k | ofset)',
  'Osler: aşım dokunuş mumundan itibaren 40 mum içinde ilk kez seviye ∓ 0,02 s; devam = aşım mumundan 6 mum sonraki kapanış − aşım noktası (s biriminde, aşım yönünde pozitif)',
  'bootstrap: dokunuş günleri (UTC) yerine koyarak, istatistik yeniden örneklenen toplam sayılardan; %99 yüzdelik aralık',
];
