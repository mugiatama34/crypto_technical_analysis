// Kesitsel momentum (portföy düzeyi): her hafta (pazar günlük kapanışı) coinler son L günlük getiriye göre sıralanır;
// en güçlü K coin (getirisi > 0: mutlak momentum) long tutulur, ls varyantında en zayıf K (getirisi < 0) short.
// Giriş/çıkış ertesi günün açılışında (+ kayma); listede kalan coin tutulmaya devam eder (yeniden komisyon yok);
// koruma: günlük kapanışlarla izleyen 3 ATR(14) stop (gün içi değerse stop fiyatından, boşlukta açılıştan çıkılır).
// R birimi = 3 ATR / giriş (başlangıç riski); ret = net yüzde getiri (komisyon iki taraf + fonlama dahil;
// fonlama ihtiyatlı olarak iki yöne de maliyet: gün × 3 × fundingPct8h).
// Dönem evreni (extra.pitN): geniş havuzdan (bugünün ilk N×3'ü) her yeniden dengelemede o tarihteki 30 günlük USDT
// hacmine göre ilk pitN seçilir → "bugünün kazananları" yanlılığı azalır (listeden kalkan coinler yine yok).
// Portföy getirisi basit toplamdır (bileşik değil).
import * as I from '../../src/data/indicators.js';
import { regimeUp } from '../../src/scan/regime.js';

const DAY = 86400e3;
export const XS_DEFAULTS = { lookback: 28, k: 5, stopAtr: 3, rebalanceDow: 0, minHistory: 20, side: 'long', btcRegime: false, volDays: 30, fundingPct8h: 0.01, rank: 'abs' }; // rank 'rel': getiri − BTC getirisi (BTC'ye göre fazla getiri)

/** USDT hacim (OKX volCcyQuote); yoksa hacim × kapanış. */
export const quoteVolOf = (x) => (Number.isFinite(x.quoteVol) && x.quoteVol > 0 ? x.quoteVol : x.volume * x.close);

/** Bir coinin i. (kapanmış) mumundaki momentum adayı: { coin, r, vol } ya da null (geçmiş yetersiz / ATR yok). */
export function momentumAt(coin, candles, i, atrArr, p, vol) {
  if (i == null || i < p.lookback + p.minHistory || !atrArr[i]) return null;
  return { coin, r: candles[i].close / candles[i - p.lookback].close - 1, vol };
}

/**
 * Ortak seçim kuralı (backtest ve canlı portföy aynı fonksiyonu kullanır).
 * ranks: [{ coin, r, vol }]. pitN: hacme göre ilk N ile sınırla. regimeOk: false ise long yok (btcRegime varyantı).
 * → { longs: coin[], shorts: coin[] } ya da null (evren 2K'dan küçük).
 */
export function selectAt(ranks, p, { pitN = null, regimeOk = true } = {}) {
  let R = ranks.filter(Boolean);
  if (pitN) R = [...R].sort((a, b) => b.vol - a.vol).slice(0, pitN);
  if (R.length < 2 * p.k) return null;
  R = [...R].sort((a, b) => b.r - a.r);
  let longs = p.side === 'short' ? [] : R.slice(0, p.k).filter((x) => x.r > 0).map((x) => x.coin);
  if (p.btcRegime && !regimeOk) longs = [];
  const shorts = p.side === 'ls' || p.side === 'short' ? R.slice(-p.k).filter((x) => x.r < 0).map((x) => x.coin) : [];
  return { longs, shorts };
}

/** seriesByCoin: [{ coin, candles }] (1D). o: { feePct, slipPct }. extra: { btcDaily }. → trades[] */
export function runXsMom(seriesByCoin, o, extra = {}, params = {}) {
  const p = { ...XS_DEFAULTS, ...params };
  const fee = (o.feePct ?? 0.05) / 100, slip = (o.slipPct ?? 0.05) / 100;
  const S = seriesByCoin.map((s) => {
    const c = s.candles;
    const atr = I.atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14);
    // USDT hacim (OKX volCcyQuote); yoksa hacim × kapanış. Kümülatif toplam: son N günlük hacim O(1).
    const qv = c.map(quoteVolOf);
    const cum = [0]; for (const v of qv) cum.push(cum[cum.length - 1] + (v || 0));
    return { coin: s.coin, c, atr, cum, idx: new Map(c.map((x, i) => [x.time, i])) };
  });
  const volAt = (s, i, n) => s.cum[i + 1] - s.cum[Math.max(0, i + 1 - n)];
  const days = [...new Set(S.flatMap((s) => s.c.map((x) => x.time)))].sort((a, b) => a - b);
  const pos = new Map(); // coin → { d, entry, entryTime, signalTime, stop, risk, bars }
  const trades = [];
  const close = (s, q, price, outcome, time) => {
    const exit = price * (1 - q.d * slip);
    // Fonlama: tutulan gün × 3 × fundingPct8h, ihtiyatlı olarak iki yöne de maliyet
    const funding = (Math.max(0, time - q.entryTime) / DAY) * 3 * (p.fundingPct8h / 100);
    const ret = (q.d * (exit - q.entry)) / q.entry - 2 * fee - funding;
    trades.push({ coin: s.coin, tf: '1D', direction: q.d === 1 ? 'long' : 'short', time: q.signalTime, entryTime: q.entryTime, exitTime: time, entry: +q.entry.toPrecision(8), stop: +q.stop0.toPrecision(8), exit: +exit.toPrecision(8), R: +(ret / q.risk).toFixed(3), ret: +ret.toFixed(5), outcome, bars: q.bars });
    pos.delete(s.coin);
  };
  let pending = null; // { exits:Set, entries:[{coin,d}] } — ertesi gün açılışında uygulanır
  for (const T of days) {
    // 1) Bekleyen yeniden dengeleme: bu günün açılışında çıkış/giriş
    if (pending) {
      for (const s of S) {
        const i = s.idx.get(T); if (i == null) continue;
        const q = pos.get(s.coin);
        if (q && pending.exits.has(s.coin)) close(s, q, s.c[i].open, 'timeout', T);
      }
      for (const e of pending.entries) {
        const s = S.find((x) => x.coin === e.coin); const i = s.idx.get(T);
        if (i == null || pos.has(e.coin)) continue;
        const a = s.atr[i - 1]; if (!a) continue;
        const entry = s.c[i].open * (1 + e.d * slip);
        const stop = entry - e.d * p.stopAtr * a;
        pos.set(e.coin, { d: e.d, entry, entryTime: T, signalTime: e.signalTime, stop, stop0: stop, risk: (p.stopAtr * a) / entry, bars: 0 });
      }
      pending = null;
    }
    // 2) Gün içi stop + kapanışta izleyen stop güncellemesi
    for (const s of S) {
      const i = s.idx.get(T); const q = pos.get(s.coin); if (i == null || !q) continue;
      const c = s.c[i];
      const hit = q.d === 1 ? c.low <= q.stop : c.high >= q.stop;
      if (hit) { const px = q.d === 1 ? Math.min(c.open, q.stop) : Math.max(c.open, q.stop); close(s, q, px, 'stopped', T); continue; }
      q.bars++;
      const a = s.atr[i];
      if (a) { const ns = c.close - q.d * p.stopAtr * a; if (q.d * (ns - q.stop) > 0) q.stop = ns; }
    }
    // 3) Yeniden dengeleme kararı: bu günün kapanışında (yalnız ≤ T kapanışlar)
    if (new Date(T).getUTCDay() !== p.rebalanceDow || (extra.startMs && T < extra.startMs)) continue; // ısınma döneminde işlem yok
    let ranks = S.map((s) => { const i = s.idx.get(T); return i == null ? null : momentumAt(s.coin, s.c, i, s.atr, p, volAt(s, i, p.volDays)); });
    if (p.rank === 'rel') {
      const b = ranks.find((x) => x && x.coin === 'BTC');
      if (!b) continue; // BTC getirisi yoksa sıralama yapılamaz
      ranks = ranks.map((x) => (x && x.coin !== 'BTC' ? { ...x, r: x.r - b.r } : null));
    }
    // Dönem evreni: o tarihteki son volDays günlük USDT hacmine göre ilk pitN coin (bugünün sıralaması değil)
    const sel = selectAt(ranks, p, { pitN: extra.pitN, regimeOk: !p.btcRegime || regimeUp(extra.btcDaily, T + DAY) });
    if (!sel) continue;
    const { longs, shorts } = sel;
    const want = new Map([...longs.map((c) => [c, 1]), ...shorts.map((c) => [c, -1])]);
    const exits = new Set([...pos.entries()].filter(([c, q]) => want.get(c) !== q.d).map(([c]) => c));
    const entries = [...want.entries()].filter(([c, d]) => !pos.has(c) || exits.has(c)).map(([coin, d]) => ({ coin, d, signalTime: T }));
    pending = { exits, entries };
  }
  // Dönem sonu: açık pozisyonlar son kapanıştan
  for (const s of S) { const q = pos.get(s.coin); if (q) close(s, q, s.c[s.c.length - 1].close, 'timeout', s.c[s.c.length - 1].time); }
  return trades.sort((a, b) => a.time - b.time);
}

/** Portföy getirisi (basit toplam, her slot 1/slots; long-short'ta slots = 2K, brüt kaldıraç 1): tüm / eğitim / doğrulama (%). */
export function portfolioOf(trades, k, split) {
  const sum = (arr) => +((arr.reduce((a, t) => a + t.ret, 0) / k) * 100).toFixed(1);
  return { totalPct: sum(trades), trainPct: sum(trades.filter((t) => t.time < split)), validPct: sum(trades.filter((t) => t.time >= split)) };
}

/** Kıyas: BTC al-tut ve evren eşit ağırlık al-tut (%), from→split ve split→to. */
export function benchmarks(seriesByCoin, from, split, to) {
  const at = (c, t) => { let v = null; for (const x of c) { if (x.time <= t) v = x.close; else break; } return v; };
  const ret = (c, a, b) => { const x = at(c, a), y = at(c, b); return x && y ? y / x - 1 : null; };
  const pack = (c) => ({ train: ret(c, from, split), valid: ret(c, split, to), total: ret(c, from, to) });
  const pct = (x) => (x == null ? null : +(x * 100).toFixed(1));
  const btc = seriesByCoin.find((s) => s.coin === 'BTC');
  const ew = { train: [], valid: [], total: [] };
  for (const s of seriesByCoin) { const r = pack(s.candles); for (const k of Object.keys(ew)) if (r[k] != null && s.candles[0].time <= (k === 'valid' ? split : from)) ew[k].push(r[k]); }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const b = btc ? pack(btc.candles) : {};
  return { btc: { train: pct(b.train), valid: pct(b.valid), total: pct(b.total) }, ew: { train: pct(mean(ew.train)), valid: pct(mean(ew.valid)), total: pct(mean(ew.total)) } };
}

const mkXs = (id, label, params) => ({
  id, label, tfs: ['1D'], kind: 'portfolio', params: { ...XS_DEFAULTS, ...params }, needs: params.btcRegime ? ['BTC1D'] : [],
  exit: { tpScheme: 'xsmom', trailAtr: XS_DEFAULTS.stopAtr, maxHoldBars: null },
  run(seriesByCoin, o, extra) { return runXsMom(seriesByCoin, o, extra, { ...this.params, ...(o.fundingPct8h != null ? { fundingPct8h: o.fundingPct8h } : {}) }); },
});

export const xsmomL28 = mkXs('xsmom_l28_k5', 'Kesitsel momentum: 28 gün getirisi en yüksek 5 coin long, haftalık', { lookback: 28 });
export const xsmomL14 = mkXs('xsmom_l14_k5', 'Kesitsel momentum: 14 gün getirisi en yüksek 5 coin long, haftalık', { lookback: 14 });
export const xsmomL28Btc = mkXs('xsmom_l28_k5_btc', 'Kesitsel momentum 28 gün, yalnız BTC günlük EMA50 üstündeyken', { lookback: 28, btcRegime: true });
export const xsmomL28Ls = mkXs('xsmom_l28_k5_ls', 'Kesitsel momentum 28 gün: en güçlü 5 long + en zayıf 5 short', { lookback: 28, side: 'ls' });
export const xsmomL28Short = mkXs('xsmom_l28_k5_short', 'Kesitsel momentum 28 gün: yalnız en zayıf 5 short', { lookback: 28, side: 'short' });
export const xsmomL28ShortRel = mkXs('xsmom_l28_k5_short_rel', 'Kesitsel momentum 28 gün, BTC\'ye göre fazla getiri: en zayıf 5 short', { lookback: 28, side: 'short', rank: 'rel' });
export const xsmomL28LsRel = mkXs('xsmom_l28_k5_ls_rel', 'Kesitsel momentum 28 gün, BTC\'ye göre fazla getiri: 5 long + 5 short', { lookback: 28, side: 'ls', rank: 'rel' });
export const XS_STRATEGIES = [xsmomL28, xsmomL14, xsmomL28Btc, xsmomL28Ls, xsmomL28Short, xsmomL28ShortRel, xsmomL28LsRel];
export const slotsOf = (p) => p.k * (p.side === 'ls' ? 2 : 1);
