#!/usr/bin/env node
// Araştırmacı koşusu (backtest.yml mode=research, Pazar + denetçi isteği): kuyruk → sweep --variants --only → Claude →
// docs/agent/research.json + Telegram; kuyruk güncellenir.
//   node bot/research/run.mjs [--in docs/backtest] [--dir docs/agent] [--fixture] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildVariants, summarizeSweep, research, formatResearch, DEFAULT_HYPOTHESES } from './researcher.js';
import { sendTelegram } from '../telegram.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const IN = String(arg('in', 'docs/backtest')), DIR = String(arg('dir', 'docs/agent')), FIXTURE = arg('fixture', false) === true, DRY = arg('dry', false) === true || process.env.DRY === '1';
const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

async function main() {
  const now = Date.now();
  fs.mkdirSync(DIR, { recursive: true });
  const queue = readJson(path.join(DIR, 'research-queue.json'), { items: [] });
  const variants = buildVariants(queue);
  const vFile = path.join(DIR, 'research-variants.json');
  fs.writeFileSync(vFile, JSON.stringify(variants));
  log(`Araştırma: ${variants.length - 1} hipotez (${queue.items.filter((x) => x.status === 'pending').length} kuyruktan)`);
  const args = ['backtest/sweep.mjs', '--in', IN, '--out', DIR, '--outfile', 'research-sweep.json', '--variants', vFile, '--only', ...(FIXTURE ? ['--fixture'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`sweep başarısız (${r.status})`);
  const sweep = readJson(path.join(DIR, 'research-sweep.json'));
  const rows = summarizeSweep(sweep);
  const items = queue.items.filter((x) => x.status === 'pending');
  const asked = items.length ? items : DEFAULT_HYPOTHESES.map((d) => ({ ...d, rationale: 'standart komşu-eşik hipotezi' }));
  let rep;
  const apiKey = env('ANTHROPIC_API_KEY', '');
  if (DRY || !apiKey) rep = { summary: 'DRY: Claude çağrısı yapılmadı; tarama sonuçları kaydedildi.', results: rows.filter((x) => x.requestId !== 'base').map((x) => ({ requestId: x.requestId, verdict: 'inconclusive', note: `4H doğr. ${x.tf4h.valid?.avgR ?? '-'}R n${x.tf4h.valid?.n ?? 0}` })), proposals: [], nextQuestions: [] };
  else { rep = await research(rows, asked, { apiKey, model: env('RESEARCH_MODEL', 'claude-opus-5-5') }); log(`  Claude: ${rep._usage?.input_tokens || 0}+${rep._usage?.output_tokens || 0} tok`); }
  const report = { at: now, summary: rep.summary, results: rep.results, proposals: rep.proposals, nextQuestions: rep.nextQuestions, rows, split: sweep?.meta?.split ?? null, plans: sweep?.meta?.plans ?? null };
  const prev = readJson(path.join(DIR, 'research.json'), { reports: [] });
  fs.writeFileSync(path.join(DIR, 'research.json'), JSON.stringify({ latest: report, reports: [...prev.reports, { ...report, rows: undefined }].slice(-20), updatedAt: now }));
  const verdicts = new Map(rep.results.map((x) => [x.requestId, x.verdict]));
  for (const it of queue.items) if (it.status === 'pending' && verdicts.has(it.id)) { it.status = 'done'; it.verdict = verdicts.get(it.id); it.doneAt = now; }
  // Koşu sırasında denetçi kuyruğa yeni istek eklemiş olabilir: uzak daldaki kuyruğu alıp id ile birleştir (bizde olmayanlar eklenir)
  try {
    const branch = env('GITHUB_REF_NAME', '');
    if (branch && spawnSync('git', ['fetch', '-q', 'origin', branch]).status === 0) {
      const remote = spawnSync('git', ['show', `origin/${branch}:${path.posix.join(DIR, 'research-queue.json')}`], { encoding: 'utf8' });
      if (remote.status === 0) { const rq = JSON.parse(remote.stdout); let added = 0; for (const it of rq.items || []) if (!queue.items.some((x) => x.id === it.id)) { queue.items.push(it); added++; } if (added) log(`  kuyruk: uzaktan ${added} yeni istek eklendi`); }
    }
  } catch { /* yok */ }
  queue.updatedAt = now; fs.writeFileSync(path.join(DIR, 'research-queue.json'), JSON.stringify(queue));
  try { fs.unlinkSync(vFile); } catch { /* yok */ }
  const text = formatResearch(rep, rows);
  if (DRY) console.log('\n----- TELEGRAM (dry) -----\n' + text.replace(/<[^>]+>/g, '')); else if (!(await sendTelegram(text, { token: env('TELEGRAM_BOT_TOKEN', ''), chatId: env('TELEGRAM_CHAT_ID', '') }))) log('Telegram gönderilemedi');
  log('Bitti.');
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
