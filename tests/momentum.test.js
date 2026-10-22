import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MOM_DEFAULTS, newPortfolio, lastWeekClose, rebalanceDue, rebalance, checkStops, accrueFunding, equityOf, publishOf } from '../bot/momentum/portfolio.js';
import { runMomentum } from '../bot/momentum/run.js';

const DAY = 86400e3;
const MON = Date.UTC(2026, 9, 19); // pazartesi 00:00 UTC
const mkDaily = (coin, drift, n = 80, end = MON) => {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) { const open = p; p = p * (1 + drift + Math.sin(i * 0.7 + drift * 900) * 0.01); out.push({ time: end - (n - i) * DAY, open, high: Math.max(open, p) * 1.005, low: Math.min(open, p) * 0.995, close: p, volume: 1, quoteVol: 1e6 }); }
  return out;
};
const universe = () => Array.from({ length: 12 }, (_, i) => ({ coin: `C${i}`, instId: `C${i}-USDT-SWAP`, candles: mkDaily(`C${i}`, (i - 6) * 0.003) }));
const pricesOf = (u) => Object.fromEntries(u.map((x) => [x.coin, x.candles.at(-1).close]));

test('lastWeekClose: haftanın pazartesi 00:00 UTC; yeniden dengeleme haftada bir', () => {
  assert.equal(lastWeekClose(MON + 5 * 3600e3), MON);
  assert.equal(lastWeekClose(MON + 6 * DAY + 23 * 3600e3), MON); // pazar gece
  assert.equal(lastWeekClose(MON - 1), MON - 7 * DAY);
  const pf = newPortfolio(MON);
  assert.ok(rebalanceDue(pf, MON + 60e3));
  pf.lastRebalance = MON + 60e3;
  assert.ok(!rebalanceDue(pf, MON + 3 * DAY));
  assert.ok(rebalanceDue(pf, MON + 7 * DAY + 60e3));
});

test('rebalance: long-short 10 slot, eşit nominal; listeden çıkan kapanır; stop ve fonlama', () => {
  const o = { ...MOM_DEFAULTS, k: 3, side: 'ls' };
  const pf = newPortfolio(MON, o);
  const u = universe(), px = pricesOf(u);
  accrueFunding(pf, MON + 60e3, o); // run.js sırası: önce tahakkuk, sonra yeniden dengeleme
  const r = rebalance(pf, u, px, MON + 60e3, o);
  assert.equal(r.entries.length, 6);
  assert.deepEqual(r.sel.longs, ['C11', 'C10', 'C9']);
  assert.ok(r.sel.shorts.every((c) => ['C0', 'C1', 'C2'].includes(c)));
  assert.ok(pf.positions.every((q) => Math.abs(q.notional - 300 / 6) < 0.01));
  assert.ok(Math.abs(equityOf(pf, px) - 300) < 0.5);
  // fonlama: 8 saat → nominal × %0,01
  accrueFunding(pf, MON + 60e3 + 8 * 3600e3, o);
  assert.ok(Math.abs(pf.positions[0].funding - pf.positions[0].notional * 0.0001) < 1e-9);
  // stop: C11 fiyatı stop altına
  const q = pf.positions.find((x) => x.coin === 'C11');
  const closed = checkStops(pf, {}, { ...px, C11: q.stop * 0.99 }, MON + DAY, o);
  assert.equal(closed.length, 1); assert.equal(closed[0].reason, 'stop'); assert.ok(closed[0].pnl < 0);
  // gelecek hafta C10 listeden düşerse kapanır
  const u2 = u.map((x) => (x.coin === 'C10' ? { ...x, candles: mkDaily('C10', -0.02) } : x));
  const r2 = rebalance(pf, u2, pricesOf(u2), MON + 7 * DAY + 60e3, o);
  assert.ok(r2.exits.some((t) => t.coin === 'C10' && t.reason === 'rebalance'));
  const pub = publishOf(pf, pricesOf(u2), MON + 7 * DAY + 120e3, o);
  assert.ok(r2.sel.shorts.includes('C10')); // çöken C10 artık en zayıflar arasında: short'a döner
  assert.equal(pub.positions.length, 6);
  assert.equal(pub.stats.trades, pub.trades.length); assert.ok(pub.trades.length >= 2);
  assert.equal(pub.nextRebalance, MON + 14 * DAY);
});

test('checkStops: pozisyon bugün açıldıysa bugünkü canlı mumun eski dibi stop saymaz', () => {
  const o = { ...MOM_DEFAULTS, k: 3 };
  const pf = newPortfolio(MON, o);
  const u = universe(), px = pricesOf(u);
  rebalance(pf, u, px, MON + 3600e3, o);
  const q = pf.positions[0];
  const live = { time: MON, open: q.entry, high: q.entry * 1.01, low: q.stop * 0.9, close: q.entry };
  assert.equal(checkStops(pf, { [q.coin]: { candles: u.find((x) => x.coin === q.coin).candles, live } }, px, MON + 2 * 3600e3, o).length, 0);
});

test('runMomentum: sahte kaynakla tur; durum ve yayın yazılır; ikinci tur aynı hafta yeniden dengelemez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mom-'));
  const u = universe();
  const provider = {
    topCoins: async (n) => u.slice(0, n || 0).map((x) => ({ coin: x.coin, instId: x.instId })),
    candles: async (instId) => { const coin = instId.split('-')[0]; const x = u.find((y) => y.coin === coin) || { candles: mkDaily('BTC', 0.001) }; return { candles: x.candles, live: null }; },
  };
  const msgs = [];
  const args = { cfg: { dry: false, variant: 'ls' }, notify: async (m) => msgs.push(m), log: () => {}, stateFile: path.join(dir, 'st.json'), publishDir: dir, provider };
  const pf1 = await runMomentum({ ...args, now: MON + 60e3 });
  assert.equal(pf1.positions.length, 10);
  assert.ok(msgs.some((m) => m.includes('başladı')) && msgs.some((m) => m.includes('yeniden dengeleme')));
  const pub = JSON.parse(fs.readFileSync(path.join(dir, 'momentum.json'), 'utf8'));
  assert.equal(pub.positions.length, 10); assert.ok(pub.btc);
  msgs.length = 0;
  await runMomentum({ ...args, now: MON + 2 * 3600e3 });
  assert.ok(!msgs.some((m) => m.includes('yeniden dengeleme')));
  // Hedge sonradan açılırsa (net short portföy): yeniden dengeleme olmadan, aynı turda hedge açılır ve bildirilir;
  // sonraki turda sapma küçükse tekrar mesaj yok. (long-short zaten nötr olduğu için ayrı, yalnız-short durum dosyası.)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mom2-'));
  const args2 = { ...args, stateFile: path.join(dir2, 'st.json'), publishDir: dir2 };
  msgs.length = 0;
  await runMomentum({ ...args2, cfg: { dry: false, variant: 'short', hedge: false }, now: MON + 60e3 });
  assert.ok(!msgs.some((m) => m.includes('BTC hedge')));
  msgs.length = 0;
  const pf3 = await runMomentum({ ...args2, cfg: { dry: false, variant: 'short', hedge: true }, now: MON + 3 * 3600e3 });
  const h = pf3.positions.find((q) => q.hedge);
  assert.ok(h && h.coin === 'BTC' && h.d === 1, 'hedge bacağı (BTC long) açılmalı');
  assert.ok(msgs.some((m) => m.includes('BTC hedge açıldı')) && !msgs.some((m) => m.includes('yeniden dengeleme')));
  msgs.length = 0;
  await runMomentum({ ...args2, cfg: { dry: false, variant: 'short', hedge: true }, now: MON + 4 * 3600e3 });
  assert.ok(!msgs.some((m) => m.includes('BTC hedge')), 'sapma küçük: yeni hedge mesajı yok');
});

test('eşit risk: oynak coinin nominali küçük, ikisi aynı riski taşır; pitN 30 günlük hacimle süzer', async () => {
  const { targetNotional, rebalance, newPortfolio, MOM_DEFAULTS } = await import('../bot/momentum/portfolio.js');
  const o = { ...MOM_DEFAULTS, k: 2, side: 'short' };
  assert.equal(targetNotional(300, 0.25, o), 24); // %2 × 300 / %25
  assert.equal(targetNotional(300, 0.01, o), 150); // üst sınır: 300 / 2 slot
  // C0 en zayıf ve çok oynak, C1 de zayıf ama sakin; C2 zayıf ama 30 günlük hacmi çok düşük (pitN dışı)
  const mk = (coin, drift, amp, vol) => { const out = []; let p = 100; for (let i = 0; i < 80; i++) { const open = p; p = p * (1 + drift); out.push({ time: MON - (80 - i) * DAY, open, high: Math.max(open, p) * (1 + amp), low: Math.min(open, p) * (1 - amp), close: p, volume: 1, quoteVol: vol }); } return { coin, instId: coin, candles: out }; };
  const u = [mk('C0', -0.01, 0.15, 1e7), mk('C1', -0.008, 0.005, 1e7), mk('C2', -0.02, 0.005, 1), ...Array.from({ length: 5 }, (_, i) => mk(`U${i}`, 0.002 * (i + 1), 0.01, 1e7))];
  const px = Object.fromEntries(u.map((x) => [x.coin, x.candles.at(-1).close]));
  const pf = newPortfolio(MON, o);
  const r = rebalance(pf, u, px, MON + 60e3, { ...o, pitN: 7 });
  assert.deepEqual(r.sel.shorts.sort(), ['C0', 'C1']); // C2 hacimde ilk 7'de değil
  const q0 = pf.positions.find((q) => q.coin === 'C0'), q1 = pf.positions.find((q) => q.coin === 'C1');
  assert.ok(q0.notional < q1.notional, 'oynak coin daha küçük');
  assert.ok(Math.abs(q0.riskUsd - 6) < 0.2, `risk ${q0.riskUsd}`); // %2 × 300
  assert.ok(Math.abs(q1.riskUsd - 6) < 0.2 && q1.notional <= 150); // ikisi de aynı riski taşır
});

test('yeniden boyutlama: listede kalan pozisyon hedefe çekilir, yalnız azaltılan kısmın K/Z ve komisyonu gerçekleşir', async () => {
  const { resizePos, newPortfolio, MOM_DEFAULTS } = await import('../bot/momentum/portfolio.js');
  const o = { ...MOM_DEFAULTS, feePct: 0.1, slipPct: 0 };
  const pf = newPortfolio(MON, o);
  const q = { coin: 'X', d: -1, entry: 100, qty: 0.6, notional: 60, stop: 160, funding: 0.06 };
  pf.positions.push(q);
  assert.equal(resizePos(pf, q, 100, 55, MON, o), null); // %9 sapma: dokunma
  const r = resizePos(pf, q, 90, 21, MON, o);
  assert.equal(r.from, 60); assert.ok(Math.abs(q.qty - 21 / 90) < 1e-9);
  const cut = 0.6 - 21 / 90;
  const expected = cut * 10 - (100 * cut + 90 * cut) * 0.001 - 0.06 * (cut / 0.6);
  assert.ok(Math.abs(pf.realized - expected) < 1e-9, `${pf.realized} vs ${expected}`);
  assert.equal(q.stop, 160);
  // büyütme: ortalama giriş ağırlıklı
  const q2 = { coin: 'Y', d: 1, entry: 10, qty: 1, notional: 10, stop: 8, funding: 0 };
  resizePos(pf, q2, 12, 24, MON, o);
  assert.ok(Math.abs(q2.qty - 2) < 1e-9 && Math.abs(q2.entry - 11) < 1e-9);
});

test('BTC hedge: net maruziyet ≈ 0; stop sonrası hedge küçülür; altlar kapanınca hedge kapanır; checkStops hedge\'i atlar', async () => {
  const { MOM_DEFAULTS, newPortfolio, rebalance, syncHedge, netExposure, checkStops, publishOf } = await import('../bot/momentum/portfolio.js');
  const o = { ...MOM_DEFAULTS, k: 3, side: 'short', rank: 'rel', hedge: true, pitN: null, feePct: 0, slipPct: 0 };
  const u = universe(); u.push({ coin: 'BTC', instId: 'BTC-USDT-SWAP', candles: mkDaily('BTC', 0.004) });
  const px = pricesOf(u);
  const pf = newPortfolio(MON, o);
  const r = rebalance(pf, u, px, MON + 60e3, o);
  assert.ok(r.sel.shorts.length === 3 && !r.sel.shorts.includes('BTC'));
  const h = pf.positions.find((q) => q.hedge);
  assert.ok(h && h.coin === 'BTC' && h.d === 1 && h.stop == null, 'alt net short → BTC long hedge');
  assert.ok(Math.abs(netExposure(pf, px) + h.qty * px.BTC) < 1e-6, 'hedge net maruziyeti sıfırlar');
  assert.equal(r.hedge.action, 'open');
  // bir alt stop olur → hedge küçülür
  const q = pf.positions.find((x) => !x.hedge);
  const closed = checkStops(pf, {}, { ...px, [q.coin]: q.stop * 1.01 }, MON + DAY, o);
  assert.equal(closed.length, 1);
  const hs = syncHedge(pf, { ...px, [q.coin]: q.stop * 1.01 }, MON + DAY, o);
  assert.equal(hs.action, 'resize'); assert.ok(hs.notional < hs.from);
  // hedge stop'a tabi değil
  assert.equal(checkStops(pf, {}, { ...px, BTC: 1 }, MON + 2 * DAY, o).length, 0);
  // tüm altlar kapanınca hedge kapanır
  for (const x of pf.positions.filter((p) => !p.hedge)) closed.push(...checkStops(pf, {}, { ...px, [x.coin]: x.stop * 1.01 }, MON + 3 * DAY, o));
  const hc = syncHedge(pf, px, MON + 3 * DAY, o);
  assert.equal(hc.action, 'close'); assert.equal(pf.positions.length, 0);
  assert.ok(pf.trades.some((t) => t.hedge && t.reason === 'hedge' && t.R == null));
  const pub = publishOf(pf, px, MON + 3 * DAY, o);
  assert.equal(pub.hedge, true); assert.equal(pub.hedgeNotional, 0);
});
