#!/usr/bin/env node
// Claude katmanı örneklemi: plans.json.gz'den rastgele N plan seçer, Claude'a değerlendirtir, kararı sonuçla kıyaslar.
//   ANTHROPIC_API_KEY=... node backtest/brain-sample.mjs --n 250 [--seed 7] [--out docs/backtest]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { askBrain, validateDecision } from '../bot/brain.js';
import { stats } from './report.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const N = +arg('n', 250), SEED = +arg('seed', 7), OUT = String(arg('out', 'docs/backtest'));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY gerekli'); process.exit(1); }
const rng = (seed) => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };

async function main() {
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'plans.json.gz'))).toString());
  const traded = all.filter((t) => ['stopped', 'tp1_be', 'tp2', 'timeout', 'tp1_timeout'].includes(t.outcome));
  const r = rng(SEED);
  const sample = [...traded].sort(() => r() - 0.5).slice(0, N);
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'claude-sample.json'), 'utf8')).items; } catch { return []; } })();
  const done = new Map(prev.map((x) => [`${x.coin}|${x.tf}|${x.time}`, x]));
  const items = [];
  let usage = { input: 0, output: 0 };
  for (const [i, t] of sample.entries()) {
    const key = `${t.coin}|${t.tf}|${t.time}`;
    if (done.has(key)) { items.push(done.get(key)); continue; }
    try {
      const dec = await askBrain(t.plan, { minRR: 2, riskPct: 1, htf: [], others: [] }, { apiKey });
      const v = validateDecision(dec, t.plan, { minRR: 2 });
      usage.input += dec._usage?.input_tokens || 0; usage.output += dec._usage?.output_tokens || 0;
      items.push({ coin: t.coin, tf: t.tf, time: t.time, outcome: t.outcome, R: t.R, trade: v.trade, confidence: v.confidence, adjusted: v.adjusted, reason: v.reason });
      console.log(`${i + 1}/${sample.length} ${t.coin} ${t.tf} → ${v.trade}/${v.confidence} (gerçek: ${t.outcome} ${t.R}R)`);
      fs.writeFileSync(path.join(OUT, 'claude-sample.json'), JSON.stringify({ items, usage }, null, 1)); // ara kayıt
    } catch (err) { console.log(`${i + 1} ${t.coin}: hata ${err.message}`); }
  }
  const byDecision = Object.fromEntries(['take', 'wait', 'skip'].map((k) => [k, stats(items.filter((x) => x.trade === k))]));
  const byConf = Object.fromEntries(['yüksek', 'orta', 'düşük'].map((k) => [k, stats(items.filter((x) => x.confidence === k))]));
  const summary = { n: items.length, all: stats(items), byDecision, byConf, usage, generatedAt: Date.now() };
  fs.writeFileSync(path.join(OUT, 'claude-sample.json'), JSON.stringify({ summary, items }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
