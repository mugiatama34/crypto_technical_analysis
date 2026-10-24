// Denetçi koşusu: günlük özet anında ölçümleri toplar, Claude'a denetletir, Telegram + docs/agent/review.json yazar,
// araştırma isteklerini docs/agent/research-queue.json'a kuyruklar; acil istekte bot/research-request.flag bırakır.
import fs from 'node:fs';
import path from 'node:path';
import { metricsOf } from './metrics.js';
import { audit, enqueue, formatAudit } from './auditor.js';

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/**
 * @param ctx { now, cfg: { dry, model, config (aktif kurallar özeti) }, llm: { apiKey }, notify, log, historyFile, publishDir, sweepFile, lastRejects, flagFile }
 */
export async function runAudit(ctx) {
  const { now, cfg, llm, notify, log } = ctx;
  const dir = ctx.publishDir;
  const history = readJson(ctx.historyFile, { items: [] });
  const agents = { temkinli: readJson(path.join(dir, 'temkinli.json')), agresif: readJson(path.join(dir, 'agresif.json')) };
  const momentum = readJson(path.join(dir, 'momentum.json'));
  const sweep = readJson(ctx.sweepFile);
  const research = readJson(path.join(dir, 'research.json'));
  const prev = readJson(path.join(dir, 'review.json'), { reports: [] });
  const metrics = metricsOf({ history, agents, momentum, sweep, now, lastRejects: ctx.lastRejects });
  let a;
  if (cfg.dry || !llm.apiKey) {
    a = { summary: 'DRY: Claude çağrısı yapılmadı; ölçümler toplandı.', health: 'ok', findings: [], researchRequests: [], varsSuggestion: [] };
  } else {
    a = await audit(metrics, cfg.config, research?.latest || null, prev.reports.at(-1) || null, { apiKey: llm.apiKey, model: cfg.model });
    log(`  denetçi: ${a.health} (${a._usage?.input_tokens || 0}+${a._usage?.output_tokens || 0} tok) — ${a.summary.slice(0, 120)}`);
  }
  const report = { at: now, health: a.health, summary: a.summary, findings: a.findings, researchRequests: a.researchRequests, varsSuggestion: (Array.isArray(a.varsSuggestion) ? a.varsSuggestion[0] : a.varsSuggestion) || null, metrics };
  const out = { latest: report, reports: [...prev.reports.filter((r) => r.at !== now), { ...report, metrics: undefined }].slice(-30), updatedAt: now };
  const queue = enqueue(readJson(path.join(dir, 'research-queue.json'), { items: [] }), a.researchRequests, now);
  if (!cfg.dry) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(out));
    fs.writeFileSync(path.join(dir, 'research-queue.json'), JSON.stringify(queue));
    if (ctx.flagFile && (a.researchRequests || []).some((r) => r.urgent)) { fs.mkdirSync(path.dirname(ctx.flagFile), { recursive: true }); fs.writeFileSync(ctx.flagFile, String(now)); }
  }
  await notify(formatAudit(a, metrics));
  return { report, queue };
}
