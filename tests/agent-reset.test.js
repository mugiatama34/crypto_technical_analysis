import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newAccount, openPosition, closeManual } from '../bot/agent/account.js';
import { PROFILES } from '../bot/agent/profiles.js';
import { resetAccount, needsReset, archiveAccount, safeLabel, runAgents, saveAgents } from '../bot/agent/run.js';
import { agentVsSignal } from '../src/ui/signals-lib.js';

const P = PROFILES.temkinli;
const req = (over = {}) => ({ coin: 'ETH', tf: '4H', direction: 'long', margin: 50, leverage: 5, order: 'market', price: 100, stop: 97, tp1: 104, tp2: 108, rationale: 't', ...over });

test('işlem sinyal anahtarını taşır', () => {
  const a = newAccount(P, 1000);
  const r = openPosition(a, req({ signalKey: 'ETH|4H|long|7' }), 1000, P.guards);
  assert.equal(r.position.signalKey, 'ETH|4H|long|7');
  closeManual(a, r.position.id, 102, 2000, 'x');
  assert.equal(a.trades[0].signalKey, 'ETH|4H|long|7');
});

test('resetAccount: özsermaye/işlemler sıfır, dersler/parametreler korunur', () => {
  const a = newAccount(P, 1000);
  const r = openPosition(a, req(), 1000, P.guards); closeManual(a, r.position.id, 95, 2000, 'x');
  a.lessons = ['ders 1']; a.params = { ...a.params, riskAppetite: 'low' };
  assert.ok(needsReset(a, '2026-11-13')); assert.ok(!needsReset(a, ''));
  const prev = resetAccount(a, P, '2026-11-13', 3000);
  assert.equal(prev.trades, 1); assert.ok(prev.stats.avgR < 0);
  assert.equal(a.equity, 300); assert.equal(a.trades.length, 0); assert.equal(a.positions.length, 0);
  assert.deepEqual(a.lessons, ['ders 1']); assert.equal(a.params.riskAppetite, 'low');
  assert.equal(a.resetLabel, '2026-11-13'); assert.equal(a.resets.length, 1);
  assert.ok(!needsReset(a, '2026-11-13'));
  assert.equal(safeLabel('../x y'), '__x_y'); // yol dışına çıkamaz
});

test('runAgents: AGENT_RESET arşivler, bir kez sıfırlar; boş hesap arşivi ezmez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agr-'));
  const stateFile = path.join(dir, 'state.json'), pub = path.join(dir, 'pub');
  const a = newAccount(P, 1000); const r = openPosition(a, req(), 1000, P.guards); closeManual(a, r.position.id, 95, 2000, 'x');
  saveAgents(stateFile, { temkinli: a });
  const msgs = [];
  const ctx = { rows: [], candidates: [], prices: {}, now: 5000, cfg: { reset: 'r1' }, notify: async (t) => msgs.push(t), log: () => {}, llm: {}, stateFile, publishDir: pub };
  const st = await runAgents(ctx);
  assert.equal(st.temkinli.trades.length, 0); assert.equal(st.temkinli.equity, 300);
  const arch = JSON.parse(fs.readFileSync(path.join(pub, 'archive', 'r1', 'temkinli.json'), 'utf8'));
  assert.equal(arch.trades.length, 1);
  assert.equal(msgs.filter((m) => m.includes('sıfırlandı')).length, 1); // agresif boştu → yalnız etiketlendi
  assert.equal(st.agresif.resetLabel, 'r1');
  await runAgents({ ...ctx, now: 6000 }); // aynı etiket: tekrar yok
  assert.equal(msgs.filter((m) => m.includes('sıfırlandı')).length, 1);
  assert.equal(archiveAccount(newAccount(P, 1), path.join(pub, 'archive', 'r1')), false); // var olan arşiv korunur
});

test('agentVsSignal: aynı sinyal, atlanan, sinyal dışı', () => {
  const items = [
    { id: 'A|1', key: 'A', sentAt: 100, status: 'done', entry: 10, stop: 9, rr1: 1.5, rr: 3 }, // +2,25R
    { id: 'B|1', key: 'B', sentAt: 100, status: 'stopped', entry: 10, stop: 9 }, // −1R, atlandı
    { id: 'C|1', key: 'C', sentAt: 100, status: 'expired', entry: 10, stop: 9 }, // işlemsiz
    { id: 'Z|1', key: 'Z', sentAt: 10, status: 'stopped', entry: 10, stop: 9 }, // başlangıçtan önce
  ];
  const trades = [{ signalKey: 'A', openedAt: 200, R: 1 }, { signalKey: null, openedAt: 200, R: -0.5 }, { hedgeOf: 'x', openedAt: 200, R: 5 }];
  const c = agentVsSignal(trades, items, 50);
  assert.equal(c.taken.n, 1); assert.equal(c.taken.agentR, 1); assert.equal(c.taken.signalR, 2.25);
  assert.equal(c.skipped.n, 1); assert.equal(c.skipped.avgR, -1);
  assert.equal(c.agentOnly.n, 1); assert.equal(c.agentOnly.avgR, -0.5);
});
