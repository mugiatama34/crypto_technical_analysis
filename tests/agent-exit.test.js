import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newAccount, openPosition, updatePositions, exitPlanOf, closePartialManual } from '../bot/agent/account.js';
import { PROFILES } from '../bot/agent/profiles.js';
import { decideSchema, DECIDE_SCHEMA } from '../bot/agent/manager.js';
import { reviewDue, botPlanOf, runAgents, saveAgents } from '../bot/agent/run.js';

const P = PROFILES.temkinli;
const k = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const req = (over = {}) => ({ coin: 'ETH', tf: '4H', direction: 'long', margin: 50, leverage: 5, order: 'market', price: 100, stop: 97, tp1: 104.5, tp2: 109, rationale: 't', ...over });

test('exitPlanOf: sınırlar ve paylar', () => {
  const x = exitPlanOf({ early_pct: 1.2, early_portion: 0.95, tp1_portion: 0.5, after_tp1_stop: 'early', trail_atr: 0 });
  assert.equal(x.earlyPortion, 0.9); assert.ok(Math.abs(x.tp1Portion - 0.1) < 1e-9); assert.equal(x.afterTp1, 'early');
  assert.equal(exitPlanOf({ early_pct: 0, early_portion: 0.5, tp1_portion: 0.5, after_tp1_stop: 'x' }).earlyPortion, 0);
});

test('ajan çıkış planı: erken %50 → TP1 %25 → stop erken hedefe → kalan stopta', () => {
  const a = newAccount(P, 0);
  const r = openPosition(a, req({ exit: { early_pct: 1.2, early_portion: 0.5, tp1_portion: 0.25, after_tp1_stop: 'early', trail_atr: 0 }, atr: 1 }), 0, P.guards);
  const pos = r.position, e = pos.entry, q0 = pos.qty0;
  const ev = updatePositions(a, { ETH: [k(1, e, e * 1.013, e * 0.999, e * 1.01), k(2, e * 1.01, 104.8, e * 1.005, 104), k(3, 104, 104.1, e * 1.005, e * 1.006)] }, 10, { earlyTp: { pct: 1.2, portion: 0.8, tfs: ['4H'] } });
  assert.deepEqual(ev.map((x) => x.type), ['early', 'tp1', 'tp1_stop']); // botun EARLY_TP'si (%80) ajanın planını ezmez
  assert.ok(Math.abs(ev[0].qty - 0.5 * q0) < 1e-6 && Math.abs(ev[1].qty - 0.25 * q0) < 1e-6);
  assert.ok(Math.abs(ev[2].price - e * 1.012 * (1 - 0.0005)) < 1e-3); // kalan erken hedeften (kaymalı) çıktı
  assert.equal(a.trades[0].exit.afterTp1, 'early');
});

test('kısmi elle kapatma ve şema', () => {
  const a = newAccount(P, 0);
  const pos = openPosition(a, req(), 0, P.guards).position, q = pos.qty;
  const ev = closePartialManual(a, pos.id, 0.3, 101, 5, 'kâr al');
  assert.ok(Math.abs(ev.qty - 0.3 * q) < 1e-6); assert.equal(a.positions.length, 1);
  const sch = decideSchema(true).properties.actions.items;
  assert.ok(sch.required.includes('exit') && sch.properties.type.enum.includes('partial'));
  assert.equal(decideSchema(false), DECIDE_SCHEMA);
});

test('reviewDue: her 10 kapanışta ara, 30\'da tam', () => {
  assert.equal(reviewDue({ closedSinceReview: 9, closedSinceFull: 9 }), null);
  assert.equal(reviewDue({ closedSinceReview: 10, closedSinceFull: 10 }), 'interim');
  assert.equal(reviewDue({ closedSinceReview: 10, closedSinceFull: 30 }), 'full');
});

test('botPlanOf: aynı sinyalde botun R\'si', () => {
  const items = [{ key: 'A', sentAt: 100, status: 'done', entry: 10, stop: 9, rr1: 1.5, rr: 3, tp1: 11.5, tp2: 13 }];
  const bp = botPlanOf({ signalKey: 'A', openedAt: 200 }, items);
  assert.equal(bp.R, 2.25); assert.equal(botPlanOf({ signalKey: 'B', openedAt: 200 }, items), null);
});

const fakeLlm = (out) => ({ apiKey: 'x', model: 'm', fetchImpl: async () => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(out) }] }) }) });
test('ara değerlendirme: önemli bulgu yoksa kurallar değişmez, varsa değişir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-'));
  const stateFile = path.join(dir, 's.json');
  const a = newAccount(P, 0); a.closedSinceReview = 10; a.closedSinceFull = 10; a.lessons = ['eski'];
  saveAgents(stateFile, { temkinli: a, agresif: newAccount(PROFILES.agresif, 0) });
  const params = { riskAppetite: 'low', preferredLeverage: [2, 3], maxMarginPctPerTrade: 10, avoidTfs: [], avoidDetectors: [], notes: 'n' };
  const base = { rows: [], candidates: [], prices: {}, now: 1000, cfg: {}, log: () => {}, stateFile, publishDir: path.join(dir, 'pub'), history: [] };
  let st = await runAgents({ ...base, notify: async () => {}, llm: fakeLlm({ summary: 's', lessons: ['yeni'], params, strong_finding: false, evidence: '' }) });
  assert.deepEqual(st.temkinli.lessons, ['eski']); assert.equal(st.temkinli.params.riskAppetite, 'medium'); assert.equal(st.temkinli.closedSinceReview, 0); assert.equal(st.temkinli.closedSinceFull, 10);
  st.temkinli.closedSinceReview = 10; saveAgents(stateFile, st);
  st = await runAgents({ ...base, notify: async () => {}, llm: fakeLlm({ summary: 's', lessons: ['yeni'], params, strong_finding: true, evidence: '6 işlemde 2 likidasyon, ort. −1,4R' }) });
  assert.deepEqual(st.temkinli.lessons, ['yeni']); assert.equal(st.temkinli.params.riskAppetite, 'low');
});

import { stepThreeReminder } from '../bot/agent/run.js';
test('3. adım hatırlatması yalnız ilk ara değerlendirmede', () => {
  assert.match(stepThreeReminder([{}]), /adım 3/); assert.equal(stepThreeReminder([{}, {}]), ''); assert.equal(stepThreeReminder([]), '');
});
