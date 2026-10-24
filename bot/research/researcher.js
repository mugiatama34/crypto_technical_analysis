// Araştırmacı ajan: denetçinin hipotezlerini (ya da standart komşu-eşik setini) tarama varyantına çevirir, sweep sonucunu
// sıkı ölçütle değerlendirir ve öneri üretir. Kural değiştirmez; yalnız rapor.
import { call } from '../agent/manager.js';

/** Canlı 4H düzeni (tarama adlarıyla aynı anlam): araştırma varyantları bunun üstüne kurulur. */
export const BASE_LAYOUT = { knifeGuard: { maxApproachAtr: 2, maxFillBarAtr: 1.5, confirmBars: 3 }, skipWeekend: true, onlyLimit: true, tfs: ['1H', '4H'], tp1Pct: 1.2, tp1Portion: 0.8, keepTp2: true, htfTrend: 'with' };

/** Kuyruk boşken denenen standart hipotezler (düzenin eşik komşuları). */
export const DEFAULT_HYPOTHESES = [
  { id: 'early-pct-1.0', question: 'Erken hedef %1,0 daha mı iyi?', spec: { tp1Pct: 1.0 } },
  { id: 'early-pct-1.5', question: 'Erken hedef %1,5 daha mı iyi?', spec: { tp1Pct: 1.5 } },
  { id: 'early-portion-0.7', question: 'Erken kapanış %70 (daha fazla koşucu) daha mı iyi?', spec: { tp1Portion: 0.7 } },
  { id: 'early-portion-0.9', question: 'Erken kapanış %90 daha mı iyi?', spec: { tp1Portion: 0.9 } },
  { id: 'htf-not-against', question: 'Üst TF yalnız ters değil (yatay dahil) daha mı iyi?', spec: { htfTrend: 'notAgainst' } },
  { id: 'knife-1.5', question: 'Düşen bıçak eşiği 1,5 ATR daha mı iyi?', spec: { knifeGuard: { maxApproachAtr: 1.5, maxFillBarAtr: 1.2, confirmBars: 3 } } },
];

/** Kuyruk + varsayılanlar → sweep --variants dosyası (temel düzen satırı + her hipotez). */
export function buildVariants(queue, defaults = DEFAULT_HYPOTHESES) {
  const pending = (queue?.items || []).filter((x) => x.status === 'pending');
  const list = pending.length ? pending : defaults.map((d) => ({ ...d, status: 'default' }));
  return [{ name: 'canlı 4H düzeni (temel)', requestId: 'base', ...BASE_LAYOUT }, ...list.map((h) => ({ name: `${h.id}: ${h.question}`, requestId: h.id, ...BASE_LAYOUT, ...h.spec }))];
}

export const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'results', 'proposals', 'nextQuestions'],
  properties: {
    summary: { type: 'string', description: '3–5 cümle' },
    results: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['requestId', 'verdict', 'note'], properties: { requestId: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'rejected', 'inconclusive'] }, note: { type: 'string', description: 'sayılarla: eğitim/doğrulama R, hedge\'li R, n' } } } },
    proposals: { type: 'array', description: 'yalnız confirmed sonuçlardan; kullanıcı uygular', items: { type: 'object', additionalProperties: false, required: ['varsName', 'value', 'evidence', 'risk'], properties: { varsName: { type: 'string' }, value: { type: 'string' }, evidence: { type: 'string' }, risk: { type: 'string' } } } },
    nextQuestions: { type: 'array', items: { type: 'string' }, description: 'en fazla 3' },
  },
};

export const SYSTEM_RESEARCH = `Sen bir kripto sinyal sisteminin araştırmacısısın. Denetçinin hipotezlerini backtest taramasıyla sınarsın. Ölçüt sıkı:
- 'confirmed' yalnız: 4H diliminde eğitim VE doğrulama ort. R temel düzenden yüksek, hedge'li (BTC'den bağımsız) doğrulama R > 0, doğrulama n ≥ 100.
- n < 100 ya da dilimler çelişiyorsa 'inconclusive'. Temelden kötüyse 'rejected'.
- Birçok varyanttan en iyisini seçmenin iyimserlik yarattığını her raporda hatırlat; farkı 0,02R'den küçük olanı 'inconclusive' say.
- proposals yalnız confirmed sonuçlardan ve kullanıcıya 'Variables'a şunu yaz' biçiminde (EARLY_TP, HTF_TREND, KNIFE_GUARD, TIME_STOP, TF_RULES ...).
- Türkçe, kısa, sayılarla.`;

/** Sweep çıktısından araştırma satırlarını (requestId'li) özetler. */
export function summarizeSweep(sweep) {
  const rows = (sweep?.results || []).filter((v) => v.requestId);
  const pick = (s) => (s ? { n: s.n, avgR: s.avgR, PF: s.profitFactor, win: s.winRate } : null);
  return rows.map((v) => ({ requestId: v.requestId, name: v.name, train: pick(v.train), valid: pick(v.valid), tf4h: { train: pick(v.byTf?.train?.['4H']), valid: pick(v.byTf?.valid?.['4H']), hedgedValid: pick(v.hedgedByTf?.valid?.['4H']), hedgedTrain: pick(v.hedgedByTf?.train?.['4H']) }, tf1h: { valid: pick(v.byTf?.valid?.['1H']) } }));
}

export const research = (rows, queueItems, opts) => call({ ...opts, system: SYSTEM_RESEARCH, user: `Hipotezler: ${JSON.stringify(queueItems.map((q) => ({ id: q.id, question: q.question, spec: q.spec, rationale: q.rationale })))}\n\nTarama sonuçları (requestId 'base' = canlı düzen): ${JSON.stringify(rows)}\n\nRaporu yaz.`, schema: RESEARCH_SCHEMA, maxTokens: 3000 });

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function formatResearch(r, rows) {
  const V = { confirmed: '✅', rejected: '❌', inconclusive: '➖' };
  const lines = ['🔬 <b>Araştırmacı raporu</b>', esc(r.summary), ''];
  for (const x of r.results) { const row = rows.find((q) => q.requestId === x.requestId); lines.push(`${V[x.verdict] || ''} <b>${esc(x.requestId)}</b>: ${esc(x.note)}${row?.tf4h?.valid ? ` (4H doğr. n${row.tf4h.valid.n} ${row.tf4h.valid.avgR}R)` : ''}`); }
  if (r.proposals?.length) lines.push('', '<b>Öneriler (sen karar ver):</b>', ...r.proposals.map((p) => `• <code>${esc(p.varsName)}=${esc(p.value)}</code> — ${esc(p.evidence)}; risk: ${esc(p.risk)}`));
  if (r.nextQuestions?.length) lines.push('', '<b>Sonraki sorular:</b>', ...r.nextQuestions.map((q) => `• ${esc(q)}`));
  return lines.join('\n');
}
