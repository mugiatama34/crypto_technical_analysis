// Fib kesişimi izleme uyarısı (arkadaşın kuralı: itkinin 0,618 geri çekilmesi × düzeltme bacağının 1,272 uzantısı).
// İşlem sinyali DEĞİL: 24 ay backtestte bu aile kenar vermedi; Telegram'a "bak" mesajı gider. Botun zaten çektiği
// 15m/1H/4H mumlarını kullanır (ek API çağrısı yok). Her itki için en fazla iki mesaj: "yeni" (fiyat bölgeye
// nearAtr × ATR içindeyken ilk görüldüğünde) ve "bölgede" (fiyat bölgeye 0,35 ATR yaklaştığında).
import { makeContext } from '../src/scan/context.js';
import { detect } from '../src/detectors/fibonacci.js';

export const FIB_ALERT_DEFAULTS = {
  tfs: ['15m', '1H', '4H'],
  nearAtr: 4, // "yeni" uyarısı için fiyat bölgeye en fazla bu × ATR uzakta olmalı
  zoneAtr: 0.35, // "bölgede" eşiği
  max: 6, // tur başına en fazla mesaj
  keepHours: 72, // durum kaydı ömrü
  ks: [2, 3, 4], // ZigZag eşikleri (15m gürültüsü için birden çok)
};
const TF_RANK = { '15m': 1, '1H': 2, '4H': 3 };

const fmtP = (p) => {
  if (!Number.isFinite(p)) return '–';
  const a = Math.abs(p), d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(8, Math.ceil(-Math.log10(a)) + 3);
  return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
};

/** Bir satırın (coin × TF) 0,618×1,272 kesişimleri: [{ key, sig, dist, pts }]. */
export function clustersOf(row, o = FIB_ALERT_DEFAULTS) {
  const ctx = makeContext({ candles: row.candles, live: row.live || null, tf: row.tf, symbol: row.coin, opts: { fibonacci: { only: 'cluster', clusterKs: o.ks, clusterRetr: [0.618], clusterExt: [1.272] } } });
  if (ctx.n < 50 || !(ctx.atrNow > 0)) return [];
  return detect(ctx).filter((s) => s.id.startsWith('fib|cluster')).map((s) => {
    const pts = s.meta.points.map((p) => ({ price: p.price, time: ctx.candles[p.i]?.time }));
    return { key: `${row.coin}|${row.tf}|${s.direction}|${pts[0].time}|${pts[1].time}`, sig: s, dist: Math.abs(ctx.price - s.entry) / ctx.atrNow, pts, price: ctx.price, atr: ctx.atrNow };
  });
}

/**
 * Tarama satırlarından gönderilecek uyarılar. state.fibAlerts = { [key]: { at, stages: [] } } (yerinde güncellenir).
 * @returns {{ coin, tf, stage: 'new'|'zone', text }[]}
 */
export function fibAlerts(rows, state, now, opts = {}) {
  const o = { ...FIB_ALERT_DEFAULTS, ...opts };
  const st = (state.fibAlerts ||= {});
  for (const [k, v] of Object.entries(st)) if (now - (v.at || 0) > o.keepHours * 3600e3) delete st[k];
  const out = [];
  for (const row of rows) {
    if (!row || row.error || !o.tfs.includes(row.tf) || !row.candles?.length) continue;
    for (const c of clustersOf(row, o)) {
      const rec = st[c.key] || { at: now, stages: [] };
      const stage = c.dist <= o.zoneAtr ? 'zone' : c.dist <= o.nearAtr ? 'new' : null;
      if (!stage || rec.stages.includes(stage)) continue;
      if (stage === 'new' && rec.stages.includes('zone')) continue;
      out.push({ ...c, coin: row.coin, tf: row.tf, stage, rec });
    }
  }
  out.sort((a, b) => (a.stage === 'zone' ? 0 : 1) - (b.stage === 'zone' ? 0 : 1) || (TF_RANK[b.tf] || 0) - (TF_RANK[a.tf] || 0) || a.dist - b.dist);
  const sent = out.slice(0, o.max);
  for (const a of sent) { a.rec.stages.push(a.stage); if (a.stage === 'zone' && !a.rec.stages.includes('new')) a.rec.stages.push('new'); a.rec.at = now; st[a.key] = a.rec; delete a.rec; }
  return sent.map((a) => ({ coin: a.coin, tf: a.tf, stage: a.stage, key: a.key, text: formatFibAlert(a, now) }));
}

/** Bir turun uyarılarını tek Telegram mesajında birleştirir (telefon tur başına bir kez titrer). */
export function fibDigest(alerts) {
  if (!alerts.length) return null;
  if (alerts.length === 1) return alerts[0].text;
  return [`📐 <b>Fib kesişimi: ${alerts.length} kurulum</b> (${alerts.map((a) => `${a.coin} ${a.tf}`).join(', ')})`, ...alerts.map((a) => a.text)].join('\n\n');
}

export function formatFibAlert(a, now = Date.now()) {
  const s = a.sig, long = s.direction === 'long', [P0, P1, A, B] = a.pts;
  const wk = [0, 6].includes(new Date(now).getUTCDay()) ? ' · hafta sonu' : '';
  const head = a.stage === 'zone' ? '📐🎯 <b>Fib kesişimi: fiyat bölgede</b>' : '📐 <b>Fib kesişimi oluştu</b>';
  const pct = (Math.abs(a.price - s.entry) / a.price) * 100;
  return [
    `${head} — <b>${a.coin}</b> ${a.tf} ${long ? '🟢 LONG' : '🔴 SHORT'}${wk}`,
    `Bölge <b>${fmtP(s.entry)}</b> (0,618 × 1,272) · fiyat ${fmtP(a.price)} · uzaklık %${pct.toFixed(2)} (${a.dist.toFixed(1)} ATR)`,
    `İtki ${fmtP(P0.price)} → ${fmtP(P1.price)} · A ${fmtP(A.price)} · B ${fmtP(B.price)}`,
    `Stop önerisi ${fmtP(s.stop)} (itki başı ${fmtP(s.invalidation)}) · H1 ${fmtP(s.target)} · H2 ${fmtP(s.meta.target2)}`,
    `<i>İzleme uyarısı, işlem sinyali değil (24 ay testte bu kural tek başına kenar vermedi). Bölgede alt dilimde teyit ara; risk %0,5–1.</i>`,
  ].join('\n');
}
