#!/usr/bin/env node
// ★ Takip listesi geçmişinden performans tablosu (özel depodaki watch.json'un tüm git sürümleri). Ayrıntı: README.
// Kullanım: node tools/watch/history.mjs --repo <sahip/ad> | --dir <yerel klon> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//           [--offline] [--json tools/watch/out/x.json] [--no-dedupe]      (ya da WATCH_REPO ortam değişkeni)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateWatch, watchR, isOpen } from '../../src/watch/watch.js';
import { rebuild, dedupe, diag, summarize, formatReport } from './history-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'tools', 'watch', 'out');
const TF_MS = { '5m': 300000, '15m': 900000, '1H': 3600000, '4H': 14400000 };
const USAGE = `Kullanım: node tools/watch/history.mjs --repo <sahip/ad> | --dir <yerel klon>
  [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--offline] [--json tools/watch/out/x.json] [--no-dedupe]
  Kaynak verilmezse WATCH_REPO ortam değişkeni (sahip/ad) kullanılır.`;

function parseArgs(argv) {
  const o = { offline: false, dedupe: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') o.offline = true;
    else if (a === '--no-dedupe') o.dedupe = false;
    else if (['--dir', '--repo', '--from', '--to', '--json'].includes(a)) o[a.slice(2)] = argv[++i];
    else { console.error(`Bilinmeyen seçenek: ${a}`); return null; }
  }
  return o;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayMs = (s, end) => { const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) ? t + (end ? 86400000 : 0) : null; };

function git(dir, args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }); }

function readVersions(dir) {
  const log = git(dir, ['log', '--format=%H,%ct', '--reverse', '--', 'watch.json']).split('\n').filter(Boolean);
  const versions = [];
  let skipped = 0;
  for (const line of log) {
    const [sha, ct] = line.split(',');
    try { versions.push({ time: +ct * 1000, json: JSON.parse(git(dir, ['show', `${sha}:watch.json`])) }); } catch { skipped++; }
  }
  return { versions, skipped };
}

async function fetchCandles(instId, bar, startMs, endMs) {
  const out = new Map();
  let after = endMs + 1;
  for (let page = 0; page < 60; page++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=100&after=${after}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX ${res.status}`);
    const data = (await res.json()).data || [];
    if (!data.length) break;
    let oldest = Infinity;
    for (const r of data) { const t = +r[0]; oldest = Math.min(oldest, t); out.set(t, { time: t, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }); }
    if (oldest <= startMs || oldest >= after) break;
    after = oldest;
    await sleep(120);
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const repo = o?.repo || process.env.WATCH_REPO;
  if (!o || (!o.dir && !repo)) { console.error(USAGE); process.exit(1); }

  let dir = o.dir, tmp = null;
  try {
    if (!dir) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-hist-'));
      dir = path.join(tmp, 'klon');
      execFileSync('gh', ['repo', 'clone', repo, dir, '--', '-q'], { stdio: ['ignore', 'ignore', 'inherit'] });
    }
    const { versions, skipped } = readVersions(dir);
    let recs = rebuild(versions);
    console.error(`Sürüm ${versions.length} (ayrıştırılamayan ${skipped}) · kayıt ${recs.length}`);
    const from = o.from ? dayMs(o.from) : null, to = o.to ? dayMs(o.to, true) : null;
    if (from != null || to != null) recs = recs.filter((r) => (from == null || r.last.addedAt >= from) && (to == null || r.last.addedAt < to));
    if (o.dedupe) { const d = dedupe(recs); recs = d.list; console.error(`Tekrar ayıklandı: ${d.dropped}`); }

    const now = Date.now();
    const need = recs.map((r) => {
      const w = r.last, step = TF_MS[w.tf];
      if (!step || !w.instId || o.offline) return null;
      const start = (w.sentAt ?? w.addedAt) - 3 * step;
      const closed = w.closedBar ?? w.closedAt;
      const end = !isOpen(w) && closed != null ? closed + 2 * step : now;
      return { key: `${w.instId}|${w.tf}`, instId: w.instId, tf: w.tf, start, end };
    });
    const groups = new Map();
    for (const n of need) if (n) { const g = groups.get(n.key); if (!g) groups.set(n.key, { ...n }); else { g.start = Math.min(g.start, n.start); g.end = Math.max(g.end, n.end); } }
    const cache = new Map();
    for (const [k, g] of groups) {
      try { cache.set(k, await fetchCandles(g.instId, g.tf, g.start, g.end)); }
      catch (e) { console.error(`Uyarı: ${k} mumları çekilemedi (${e.message})`); }
    }

    const rows = recs.map((r, i) => {
      let w = r.last, replayed = false;
      const n = need[i], all = n ? cache.get(n.key) : null;
      const cs = all ? all.filter((c) => c.time >= n.start && c.time <= n.end) : null;
      if (cs?.length && isOpen(w)) { w = updateWatch(w, cs, now).item; replayed = r.gone != null; }
      return { w, R: watchR(w), diag: diag(w, cs), replayed };
    }).sort((a, b) => a.w.addedAt - b.w.addedAt);

    const summary = summarize(rows);
    console.log(formatReport(summary, rows));
    if (o.json) {
      const p = path.resolve(o.json), rel = path.relative(ROOT, p);
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && !p.startsWith(OUT_DIR + path.sep)) throw new Error('--json repo içindeyse yalnız tools/watch/out/ altına yazılır');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ rows, summary }, null, 1));
      console.error(`JSON yazıldı: ${p}`);
    }
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(`Hata: ${e.message}`); process.exit(1); });
