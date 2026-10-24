import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalR, signalStats, metricsOf, expectedOf } from '../bot/review/metrics.js';
import { enqueue, parseVariantSpec, formatAudit, AUDIT_SCHEMA, auditPrompt } from '../bot/review/auditor.js';
import { buildVariants, summarizeSweep, BASE_LAYOUT, RESEARCH_SCHEMA, formatResearch } from '../bot/research/researcher.js';

const H = 3600e3, now = Date.parse('2026-10-24T06:00:00Z');
const sig = (o) => ({ coin: 'X', tf: '4H', direction: 'long', entry: 100, stop: 97, tp1: 104, tp2: 108, rr: 2.67, rr1: 1.33, sentAt: now - 5 * H, ...o });

test('metrics: finalR erken kâr/stop/zaman stopu; dönem istatistikleri; BTC ters', () => {
  assert.ok(Math.abs(finalR(sig({ early: 101.2, earlyPortion: 0.8, status: 'be' })) - 0.8 * 0.4) < 1e-9);
  assert.ok(Math.abs(finalR(sig({ early: 101.2, status: 'done' })) - (0.8 * 0.4 + 0.2 * 2.67)) < 1e-9);
  assert.equal(finalR(sig({ early: 101.2, status: 'stopped' })), -1);
  assert.equal(finalR(sig({ status: 'timeout', exitR: 0.3 })), 0.3);
  assert.equal(finalR(sig({ status: 'waiting' })), null);
  const items = [sig({ status: 'be', early: 101.2, closedAt: now - H, btcAtSend: 100, btcAtClose: 99 }), sig({ status: 'stopped', closedAt: now - H, sentAt: now - 10 * 86400e3 }), sig({ status: 'knife' }), sig({ status: 'waiting' })];
  const m = metricsOf({ history: { items }, now });
  assert.equal(m.periods.d1.sent, 3); assert.equal(m.periods.d1.closed, 1); assert.equal(m.periods.d1.knife, 1); assert.equal(m.periods.d1.open, 1);
  assert.equal(m.periods.d30.closed, 2); assert.equal(m.periods.d30.stopped, 1);
  assert.equal(m.periods.d1.btcAdverse.n, 1); assert.equal(m.recentClosed.length, 2); assert.equal(m.openSignals.length, 1);
  assert.equal(expectedOf(null), null);
  assert.equal(expectedOf({ results: [{ targeted: true, name: 'x + elle yönetim: a + üst TF eğilimi aynı yön', valid: { n: 1, avgR: 0.02, winRate: 0.7 }, byTf: { valid: { '4H': { n: 293, avgR: 0.082, winRate: 0.81 } } }, hedgedByTf: { valid: { '4H': { avgR: 0.079 } } } }] }).tf4h.n, 293);
});

test('auditor: variantSpec güvenli alanlara indirgenir; kuyruk tekil; rapor metni; prompt gizli alan taşımaz', () => {
  assert.deepEqual(parseVariantSpec('{"tp1Pct":1.5,"apiKey":"x","tfs":["4H"]}'), { tp1Pct: 1.5, tfs: ['4H'] });
  assert.equal(parseVariantSpec('{"apiKey":"x"}'), null); assert.equal(parseVariantSpec('bozuk'), null);
  let q = enqueue({ items: [] }, [{ id: 'a', question: 'q', variantSpec: '{"tp1Pct":1}', rationale: 'r', urgent: false }, { id: 'b', question: 'q', variantSpec: 'bozuk' }], now);
  assert.equal(q.items.length, 1); assert.equal(q.items[0].status, 'pending');
  q = enqueue(q, [{ id: 'a', question: 'tekrar', variantSpec: '{"tp1Pct":2}' }], now);
  assert.equal(q.items.length, 1);
  const m = metricsOf({ history: { items: [] }, now });
  const txt = formatAudit({ summary: 'özet', health: 'watch', findings: [{ area: 'signals', severity: 'warn', evidence: 'n 3', action: 'izle' }], researchRequests: [{ id: 'a', question: 'soru', urgent: true }], varsSuggestion: [{ name: 'X', value: '1', why: 'y' }] }, m);
  assert.match(txt, /Denetçi günlük rapor/); assert.match(txt, /\[warn\] signals/); assert.match(txt, /a \(acil\)/); assert.match(txt, /X=1/);
  const p = auditPrompt(m, { tfs: ['4H'] }, null, null);
  assert.doesNotMatch(p, /TELEGRAM|API_KEY|token/i);
  assert.deepEqual(AUDIT_SCHEMA.required, ['summary', 'health', 'findings', 'researchRequests', 'varsSuggestion']);
  assert.ok(RESEARCH_SCHEMA.required.includes('proposals'));
});

test('researcher: varyantlar temel düzen üstüne kurulur; kuyruk boşsa varsayılanlar; sweep özeti ve rapor', () => {
  const v = buildVariants({ items: [{ id: 'h1', question: 's', spec: { tp1Pct: 1.5 }, status: 'pending' }, { id: 'h0', spec: {}, status: 'done' }] });
  assert.equal(v.length, 2); assert.equal(v[0].requestId, 'base'); assert.equal(v[1].requestId, 'h1'); assert.equal(v[1].tp1Pct, 1.5); assert.equal(v[1].htfTrend, BASE_LAYOUT.htfTrend);
  assert.ok(buildVariants({ items: [] }).length > 3);
  const rows = summarizeSweep({ results: [{ requestId: 'base', name: 'b', train: { n: 1, avgR: 0.06, profitFactor: 1.2, winRate: 0.7 }, valid: { n: 1, avgR: 0.08 }, byTf: { train: { '4H': { n: 300, avgR: 0.09 } }, valid: { '4H': { n: 290, avgR: 0.08 } } }, hedgedByTf: { valid: { '4H': { n: 290, avgR: 0.07 } } } }, { name: 'tek', train: {}, valid: {} }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].tf4h.hedgedValid.avgR, 0.07);
  const t = formatResearch({ summary: 's', results: [{ requestId: 'base', verdict: 'inconclusive', note: 'n' }], proposals: [{ varsName: 'EARLY_TP', value: '{}', evidence: 'e', risk: 'r' }], nextQuestions: ['q'] }, rows);
  assert.match(t, /Araştırmacı raporu/); assert.match(t, /EARLY_TP=/); assert.match(t, /4H doğr\. n290/);
});
