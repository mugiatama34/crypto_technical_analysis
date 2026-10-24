// Denetçi ajan: kâğıt sistemin günlük denetimi. Yalnız gözlem ve öneri üretir; kural değiştirme yetkisi yoktur.
// Öneriler test edilebilir varyant olarak (taramanın bildiği alanlar) araştırmacıya kuyruklanır.
import { call } from '../agent/manager.js';

/** Araştırmacının taramaya aktarabildiği güvenli alanlar (backtest/sweep.mjs passes/rebuild/evaluate). */
export const VARIANT_FIELDS = ['tfs', 'minScore', 'onlyLimit', 'skipWeekend', 'hoursUtc', 'excludeHoursUtc', 'trend', 'adxMin', 'mtf', 'knifeGuard', 'timeStop', 'tp1Pct', 'tp1R', 'tp1Portion', 'keepTp2', 'tpScheme', 'trailAtr', 'stopPadAtr', 'minRiskAtr', 'htfTrend', 'excludeGroups', 'excludeDetectors', 'requireAnyGroup'];

export const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'health', 'findings', 'researchRequests', 'varsSuggestion'],
  properties: {
    summary: { type: 'string', description: '3–5 cümle: sistem bugün ne yaptı, beklentiye göre nerede, dikkat gereken şey' },
    health: { type: 'string', enum: ['ok', 'watch', 'alert'] },
    findings: { type: 'array', description: 'en fazla 6 bulgu', items: { type: 'object', additionalProperties: false, required: ['area', 'severity', 'evidence', 'action'], properties: { area: { type: 'string', enum: ['signals', 'agents', 'momentum', 'rules', 'data'] }, severity: { type: 'string', enum: ['info', 'warn', 'high'] }, evidence: { type: 'string', description: 'sayıyla: n, ort. R, oran' }, action: { type: 'string', description: 'izle / araştır / kullanıcıya öner' } } } },
    researchRequests: { type: 'array', description: 'araştırmacı için test edilebilir hipotezler (en fazla 3; yoksa boş)', items: { type: 'object', additionalProperties: false, required: ['id', 'question', 'variantSpec', 'rationale', 'urgent'], properties: { id: { type: 'string', description: 'kısa kebab-case kimlik, ör. early-pct-1.5' }, question: { type: 'string' }, variantSpec: { type: 'string', description: `JSON nesnesi (metin olarak); yalnız şu alanlar: ${VARIANT_FIELDS.join(', ')}` }, rationale: { type: 'string' }, urgent: { type: 'boolean', description: 'true = haftalık koşuyu bekleme (yalnız high bulguda)' } } } },
    varsSuggestion: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['name', 'value', 'why'], properties: { name: { type: 'string' }, value: { type: 'string' }, why: { type: 'string' } } }], description: 'yalnız araştırmacı tarafından doğrulanmış bir değişiklik varsa; aksi halde null' },
  },
};

export const SYSTEM_AUDIT = `Sen bir kripto kâğıt-işlem sisteminin bağımsız denetçisisin. Sistem: 4H sinyal botu (filtreler: düşen bıçak koruması, hafta sonu yok,
yalnız limit giriş, coin'in günlük trendiyle aynı yön; yönetim: +%1,2'de %80 kapat, kalan başabaşta TP2'ye), iki kâğıt ajan (temkinli/agresif,
300 USDT), haftalık kesitsel momentum portföyü (short, BTC'ye göre sıralama, BTC hedge'li). Hepsi sanal para; gerçek emir yok.
Görevin: günlük veriyi beklentiyle (12 aylık backtest: 4H düzeni doğrulamada ort. +0,08R, kazanma ~%79; hedge'li +0,08R) karşılaştırmak,
anormallikleri ve veri sorunlarını (dolum yok, hata, takip tutarsızlığı) bulmak, test edilebilir hipotez üretmek.
Kurallar:
- Kural değiştirme yetkin yok; yalnız öneri. Önerin her zaman test edilebilir bir tarama varyantı (variantSpec) olmalı.
- Küçük örneklemden iddia üretme: n < 30 kapanan işlemde "beklentiden sapma" deme, "izle" de. Günlük R dalgalanması normaldir.
- Aşırı uyum tuzağına düşme: dün kaybettiren tek bir filtreyi kaldırmayı önerme; hipotezin mantığı önceden savunulabilir olmalı.
- researchRequests yalnız gerçekten yeni ve değerli soru için; çoğu gün boş liste doğru cevaptır.
- varsSuggestion yalnız son araştırma raporunda 'confirmed' bir sonuç varsa ve henüz uygulanmamışsa.
- Türkçe, somut, sayılarla. Bahane ve süsleme yok.`;

export function auditPrompt(metrics, config, lastResearch, lastAudit) {
  return `Tarih: ${new Date(metrics.at).toISOString()}\n\nAktif kurallar (ortam değişkenleri): ${JSON.stringify(config)}\n\nÖlçümler: ${JSON.stringify(metrics)}\n\nSon araştırma raporu (özet): ${JSON.stringify(lastResearch ? { at: lastResearch.at, summary: lastResearch.summary, results: lastResearch.results?.slice(0, 8), proposals: lastResearch.proposals } : null)}\n\nÖnceki denetim: ${JSON.stringify(lastAudit ? { at: lastAudit.at, health: lastAudit.health, summary: lastAudit.summary, openRequests: lastAudit.researchRequests?.map((r) => r.id) } : null)}\n\nDenetimi yaz.`;
}

export const audit = (metrics, config, lastResearch, lastAudit, opts) => call({ ...opts, system: SYSTEM_AUDIT, user: auditPrompt(metrics, config, lastResearch, lastAudit), schema: AUDIT_SCHEMA, maxTokens: 3000 });

/** variantSpec metnini güvenli alanlara indirger; geçersizse null. */
export function parseVariantSpec(text) {
  try {
    const o = typeof text === 'string' ? JSON.parse(text) : text;
    if (!o || typeof o !== 'object') return null;
    const out = {}; for (const k of Object.keys(o)) if (VARIANT_FIELDS.includes(k)) out[k] = o[k];
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/** Kuyruğa yeni istekleri ekler (id ile tekil); done olanlar korunur. */
export function enqueue(queue, requests, now = Date.now()) {
  const q = { items: [...(queue?.items || [])] };
  for (const r of requests || []) {
    const spec = parseVariantSpec(r.variantSpec); if (!spec) continue;
    if (q.items.some((x) => x.id === r.id)) continue;
    q.items.push({ id: r.id, question: r.question, spec, rationale: r.rationale, urgent: !!r.urgent, status: 'pending', createdAt: now });
  }
  q.items = q.items.slice(-40); q.updatedAt = now;
  return q;
}

const H = { ok: '🟢', watch: '🟡', alert: '🔴' };
export function formatAudit(a, m) {
  const d1 = m.periods.d1, d30 = m.periods.d30;
  const lines = [`🕵️ <b>Denetçi günlük rapor</b> ${H[a.health] || ''} ${a.health}`, esc(a.summary), '',
    `Son 24s: ${d1.sent} sinyal, ${d1.closed} kapanan${d1.avgR != null ? `, ort ${d1.avgR}R` : ''} · 30 gün: ${d30.sent} sinyal, ${d30.closed} kapanan${d30.avgR != null ? `, ort ${d30.avgR}R, kazanma %${Math.round(d30.winRate * 100)}` : ''}`];
  if (a.findings?.length) lines.push('', '<b>Bulgular:</b>', ...a.findings.map((f) => `• [${f.severity}] ${esc(f.area)}: ${esc(f.evidence)} → ${esc(f.action)}`));
  if (a.researchRequests?.length) lines.push('', '<b>Araştırmacıya:</b>', ...a.researchRequests.map((r) => `• ${esc(r.id)}${r.urgent ? ' (acil)' : ''}: ${esc(r.question)}`));
  if (a.varsSuggestion) lines.push('', `<b>Öneri (sen karar ver):</b> Variables → <code>${esc(a.varsSuggestion.name)}=${esc(a.varsSuggestion.value)}</code> — ${esc(a.varsSuggestion.why)}`);
  return lines.join('\n');
}
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
