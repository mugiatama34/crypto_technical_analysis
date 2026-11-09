// Planları (plans.json.gz) ve tam koşu meta'sını (results.json) birlikte yükler; ikisi aynı koşudan değilse durur.
// Neden: 08.11 araştırmacı koşusu önbellek yokken git geçmişindeki 20.10 planlarını (6 ay, 15m/1H/4H) 24.10 koşusunun
// bölünmesiyle (12 ay, 1H/4H) karıştırdı → 4H eğitim dilimi boş, rapor geçersiz.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
