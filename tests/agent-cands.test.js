// Ajan aday seçimi: açık olan tüm zaman dilimlerini kapsayan avoidTfs yasağı geçersiz; boşta aynı adaylar tekrar sorulmaz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, candSig, idleSame, IDLE_REASK_MS } from '../bot/agent/run.js';
import { decidePrompt } from '../bot/agent/manager.js';
import { PROFILES } from '../bot/agent/profiles.js';
import { newAccount, statsOf } from '../bot/agent/account.js';

const acctOf = (avoidTfs, positions = []) => ({ params: { avoidTfs }, positions, orders: [] });
const C = (coin, tf, direction = 'short') => ({ coin, tf, direction, key: `${coin}|${tf}|${direction}` });

test('avoidTfs açık olan tek zaman dilimini kapsıyorsa geçersiz sayılır (Agresif 4H yasağı)', () => {
  const r = candidatesFor(acctOf(['4H']), [C('DOGE', '4H'), C('BTC', '4H')], ['4H']);
  assert.deepEqual(r.cands.map((p) => p.coin), ['DOGE', 'BTC']);
  assert.deepEqual(r.avoidOverride, ['4H']);
});

test('kısmi yasak aynen uygulanır: açık TF\'lerden biri serbestse yasak geçerli', () => {
  const r = candidatesFor(acctOf(['4H']), [C('DOGE', '4H'), C('ETH', '1H')], ['1H', '4H']);
  assert.deepEqual(r.cands.map((p) => p.coin), ['ETH']);
  assert.equal(r.avoidOverride, null);
});

test('yasak yoksa ve pozisyonu olan coin: değişiklik yok; liveTfs boşsa adayların TF\'leri esas alınır', () => {
  const a = acctOf([], [{ coin: 'DOGE' }]);
  assert.deepEqual(candidatesFor(a, [C('DOGE', '4H'), C('BTC', '4H')], ['4H']).cands.map((p) => p.coin), ['BTC']);
  const r = candidatesFor(acctOf(['4H', '1H']), [C('DOGE', '4H')], []);
  assert.equal(r.cands.length, 1); assert.deepEqual(r.avoidOverride, ['4H']);
  assert.deepEqual(candidatesFor(acctOf(['4H']), [], ['4H']), { cands: [], avoidOverride: ['4H'] });
});

test('boşta aynı adaylar: 4 saat içinde tekrar sorulmaz; aday değişirse, pozisyon/emir varsa ya da süre dolunca sorulur', () => {
  const now = Date.UTC(2026, 10, 13, 12), sig = candSig([C('DOGE', '4H'), C('BTC', '4H')]);
  assert.equal(sig, candSig([C('BTC', '4H'), C('DOGE', '4H')])); // sıra bağımsız
  const a = { positions: [], orders: [], lastDecision: now - 3600e3, lastCandSig: sig };
  assert.equal(idleSame(a, sig, now), true);
  assert.equal(idleSame(a, candSig([C('DOGE', '4H')]), now), false);
  assert.equal(idleSame({ ...a, positions: [{ coin: 'X' }] }, sig, now), false);
  assert.equal(idleSame({ ...a, orders: [{ coin: 'X' }] }, sig, now), false);
  assert.equal(idleSame({ ...a, lastDecision: now - IDLE_REASK_MS }, sig, now), false);
  assert.equal(idleSame({ positions: [], orders: [] }, sig, now), false); // hiç karar verilmemiş
});

test('karar isteminde yasağın uygulanmadığı ajana bildirilir (yalnız geçersiz sayıldığında)', () => {
  const profile = PROFILES.agresif, acct = newAccount(profile, Date.UTC(2026, 10, 13));
  const withNote = decidePrompt(acct, profile, [], statsOf(acct), { avoidOverride: ['4H'] });
  assert.match(withNote, /systemNote/); assert.match(withNote, /4H yasağı uygulanmadı/);
  assert.doesNotMatch(decidePrompt(acct, profile, [], statsOf(acct), {}), /systemNote/);
});
