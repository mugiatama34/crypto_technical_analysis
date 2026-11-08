// Tarayıcı birebir tekrar oynatma (kullanıcı sorusu 08.11): "Son 1 haftada tarayıcıda puanı > 10 çıkan her 0,618×1,272 fib
// kesişimine girseydim?" Her mumda tarayıcının kendi analizi (analyzeRow, preset fib_cluster_618, son 300 kapanmış mum)
// çalıştırılır; puan eşiği geçen ilk görünüşte plan: fiyat bölgedeyse (status active) piyasa, değilse bölge ortasına limit;
// stop / H1 (itki ucu) / H2 (+0,272) tarayıcının gösterdiği seviyeler. Her itki (P0,P1) bir kez. Yalnız son `sinceDays` gün.
import { analyzeRow } from '../../src/scan/scanner.js';
import { PRESET_MAP } from '../../src/scan/presets.js';

const r8 = (x) => +Number(x).toPrecision(8);

export function makeFibScan(id, label, { minScore = 10, sinceDays = 7, win = 300 } = {}) {
  const P = PRESET_MAP.fib_cluster_618;
  const since = Date.now() - sinceDays * 864e5;
  return {
    id, label, tfs: ['5m', '15m', '1H', '4H'], exit: { tpScheme: 'half_be', maxHoldBars: 120 }, o: { minScore, sinceDays, win },
    prepare(candles, tf) { return { tf, seen: new Set() }; },
    signal(i, candles, p) {
      if (candles[i].time < since || i < win) return null;
      const row = analyzeRow({ coin: 'X', tf: p.tf, candles: candles.slice(i - win + 1, i + 1), live: null }, { ids: P.detectors, weights: P.weights, settings: { detectorOpts: P.detectorOpts } });
      if (!row.best || row.score <= minScore) return null;
      const s = row.signals.find((x) => x.id.startsWith('fib|cluster'));
      if (!s) return null;
      const off = i - win + 1, pts = s.meta.points;
      const key = `${candles[off + pts[0].i]?.time}|${candles[off + pts[1].i]?.time}`;
      if (p.seen.has(key)) return null;
      p.seen.add(key);
      const d = s.direction === 'long' ? 1 : -1, inZone = s.status === 'active';
      return { d, direction: s.direction, entry: r8(inZone ? candles[i].close : s.entry), stop: r8(s.stop), tp1: r8(s.target), tp2: r8(s.meta.target2), inZone, zone: s.zone, atr: r8(row.atr), price: r8(candles[i].close), tags: { score: row.score } };
    },
  };
}

export const FIBSCAN_STRATEGIES = [makeFibScan('fib_scan_week', 'Tarayıcı tekrar: son 7 gün, puan > 10, 0,618×1,272 (tarayıcının giriş/stop/H1/H2)')];
