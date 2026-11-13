// Planları (plans.json.gz) ve tam koşu meta'sını (results.json) birlikte yükler; ikisi aynı koşudan değilse durur.
// Neden: 08.11 araştırmacı koşusu önbellek yokken git geçmişindeki 20.10 planlarını (6 ay, 15m/1H/4H) 24.10 koşusunun
// bölünmesiyle (12 ay, 1H/4H) karıştırdı → 4H eğitim dilimi boş, rapor geçersiz.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { analyzeRow, barsFor } from '../src/scan/scanner.js';
import { multiTfAlignment } from '../src/scan/scoring.js';
import { TIMEFRAMES } from '../src/data/okx.js';
import { simulateSeries, slimPlan } from './engine.js';

const DAY = 86400e3;

/** Plan dizisi meta ile uyumlu mu? Uyumsuzlukları dizi olarak döndürür (boş = uyumlu). meta boşsa denetim yok. */
export function planMismatch(all, meta, tolDays = 3) {
  if (!meta || meta.from == null || meta.to == null || !all.length) return [];
  const out = [];
  let tMin = Infinity, tMax = -Infinity;
  const tfs = new Set();
  for (const t of all) { if (t.time < tMin) tMin = t.time; if (t.time > tMax) tMax = t.time; tfs.add(t.tf); }
  const d = (a) => new Date(a).toISOString().slice(0, 10);
  if (Math.abs(tMin - meta.from) > tolDays * DAY) out.push(`plan başı ${d(tMin)} ≠ results.json ${d(meta.from)}`);
  if (Math.abs(tMax - meta.to) > tolDays * DAY) out.push(`plan sonu ${d(tMax)} ≠ results.json ${d(meta.to)}`);
  if (Array.isArray(meta.tfs)) { const extra = [...tfs].filter((tf) => !meta.tfs.includes(tf)); if (extra.length) out.push(`planlarda fazladan TF: ${extra.join(',')} (results.json: ${meta.tfs.join(',')})`); }
  if (meta.split != null && (meta.split <= tMin || meta.split >= tMax)) out.push(`bölünme ${d(meta.split)} plan aralığının dışında`);
  return out;
}

/** plans.json.gz + results.json meta → { all, meta, times, split }. Uyumsuzlukta hata fırlatır. */
export function loadPlans(dir) {
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'plans.json.gz'))).toString());
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).meta || {}; } catch { return {}; } })();
  const bad = planMismatch(all, meta);
  if (bad.length) throw new Error(`plans.json.gz ile results.json aynı koşudan değil: ${bad.join('; ')} → önce mode=full koş`);
  const times = all.map((t) => t.time).sort((a, b) => a - b);
  const split = meta.split || times[Math.floor((times.length * 2) / 3)];
  return { all, meta, times, split };
}

/**
 * Karar anındaki çoklu TF uyumu (13.11, canlıya eşit tarama). Canlı karşılığı: src/scan/scanner.js runScan → multiTfAlignment
 * (taranan tüm TF'lerin en iyi kümesi), bot/plan.js buildPlan mtfOk / puan = max(küme, MTF). Planın kendi TF'si için en iyi küme
 * = planın kendisi (yön, küme puanı); diğer TF'ler karar anına (decidedMs) kadar KAPANMIŞ mumlarla yeniden analiz edilir
 * (geleceğe bakmaz). others: { tf: mumlar } (yalnız tam koşuda yüklenen TF'ler; canlı 15m+1H+4H tarar, tam koşu çoğu zaman
 * 1H+4H → 15m eksik: canlıdan sıkı, alt küme). Karar anında hiç kapanmış mumu olmayan TF bakılmamış sayılır.
 * → { tfs: [bakılan TF'ler, planınki dahil], align: { direction, tfs, score } | null }
 */
export function mtfAt(plan, tf, decidedMs, others, o = {}) {
  const perTf = { [tf]: { best: { direction: plan.direction, score: plan.clusterScore ?? plan.score } } };
  for (const [tf2, cs] of Object.entries(others || {})) {
    if (tf2 === tf || !cs?.length || !TIMEFRAMES[tf2]) continue;
    const ms = TIMEFRAMES[tf2].ms;
    let lo = 0, hi = cs.length - 1, k = -1; // karar anında kapanmış son mum: time + ms ≤ decidedMs
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].time + ms <= decidedMs) { k = m; lo = m + 1; } else hi = m - 1; }
    if (k < 0) continue;
    const window = cs.slice(Math.max(0, k - barsFor(tf2) + 1), k + 1);
    const row = analyzeRow({ coin: plan.coin, instId: plan.instId, tf: tf2, candles: window, live: null }, { ids: o.detectors ?? null, weights: o.weights || {} });
    perTf[tf2] = { best: row.error ? null : row.best };
  }
  const a = multiTfAlignment(perTf);
  const tfs = Object.keys(perTf).sort((x, y) => (TIMEFRAMES[x]?.rank ?? 0) - (TIMEFRAMES[y]?.rank ?? 0));
  return { tfs, align: a ? { direction: a.direction, tfs: a.tfs, score: a.score } : null };
}

/** Plan dosyasındaki bekleme süresi yüzünden atlanmış planlar (girdinin cd alanı) düz liste: { coin, tf, time, plan, mtfBt, cd: true }. */
export const cooldownSkippedOf = (all) => all.flatMap((t) => (t.cd || []).map((c) => ({ coin: t.coin, tf: t.tf, time: c.time, plan: c.plan, ...(c.mtfBt ? { mtfBt: c.mtfBt } : {}), cd: true })));

/**
 * Tam koşu (run.mjs) için seri simülasyonu + canlıya eşit tarama alanları: others verilirse her plana (ve atlanan plana) mtfBt;
 * bekleme süresi yüzünden atlanan geçerli planlar, onu atlatan aynı yöndeki son planın kaydına cd: [{ time, plan, mtfBt? }]
 * olarak eklenir (simüle edilmez). Simüle edilen planlar ve sonuçları simulateSeries ile aynıdır (yalnız ek alanlar).
 */
export function simulateWithExtras(job, o, others = null) {
  const ms = TIMEFRAMES[job.tf].ms;
  const mtfOf = (plan, time) => (others && Object.keys(others).length ? mtfAt(plan, job.tf, time + ms, others, o) : null);
  const last = {};
  return simulateSeries(job, o, {
    onTrade: (t) => { const m = mtfOf(t.plan, t.time); if (m) t.mtfBt = m; last[t.direction] = t; },
    onCooldownSkip: ({ plan, time }) => { const host = last[plan.direction]; if (!host) return; const m = mtfOf(plan, time); (host.cd ||= []).push({ time, plan: slimPlan(plan), ...(m ? { mtfBt: m } : {}) }); },
  });
}
