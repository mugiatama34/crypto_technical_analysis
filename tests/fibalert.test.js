import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fibAlerts, clustersOf, formatFibAlert, fibDigest } from '../bot/fibalert.js';
import { analyzeRow } from '../src/scan/scanner.js';
import { PRESET_MAP } from '../src/scan/presets.js';
import { makeContext } from '../src/scan/context.js';
import { detect } from '../src/detectors/fibonacci.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/xrp-1h-fib.json', import.meta.url)));
const toC = (a) => ({ time: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: a[5] ?? 0, confirmed: true });
const base = fx.base.map(toC), next = fx.next.map(toC);
const row = (candles) => ({ coin: 'XRP', tf: '1H', candles, live: null });
const T0 = base.at(-1).time;

test('fib uyarısı: XRP 1H (25.10 17:00) 0,618×1,272 long ≈ 1,2767 → "yeni", tekrar yok', () => {
  const cs = clustersOf(row(base));
  assert.equal(cs.length, 1);
  assert.equal(cs[0].sig.direction, 'long');
  assert.ok(Math.abs(cs[0].sig.entry - 1.2767) < 0.0015, `giriş ${cs[0].sig.entry}`);
  const state = {};
  const a1 = fibAlerts([row(base)], state, T0);
  assert.deepEqual(a1.map((a) => [a.coin, a.tf, a.stage]), [['XRP', '1H', 'new']]);
  assert.match(a1[0].text, /Fib kesişimi oluştu/);
  assert.match(a1[0].text, /işlem sinyali değil/);
  const a2 = fibAlerts([row(base)], state, T0 + 3600e3);
  assert.equal(a2.length, 0, 'aynı itki ikinci kez gönderilmez');
});

test('fib uyarısı: fiyat bölgeye gelince "bölgede" mesajı, bir kez', () => {
  const state = {};
  fibAlerts([row(base)], state, T0);
  let zone = null;
  for (let i = 1; i <= next.length && !zone; i++) {
    const out = fibAlerts([row([...base, ...next.slice(0, i)])], state, T0 + i * 3600e3);
    zone = out.find((a) => a.stage === 'zone') || null;
    if (!zone) assert.equal(out.filter((a) => a.stage === 'new' && a.key === Object.keys(state.fibAlerts)[0]).length, 0);
  }
  assert.ok(zone, 'fiyat 1,2723\'e inerken bölge uyarısı gelmeli');
  assert.match(zone.text, /fiyat bölgede/);
});

test('fib uyarısı: TF listesi dışı ve eski kayıtlar', () => {
  const state = { fibAlerts: { eski: { at: T0 - 100 * 3600e3, stages: ['new'] } } };
  assert.equal(fibAlerts([row(base)], state, T0, { tfs: ['4H'] }).length, 0);
  assert.ok(!state.fibAlerts.eski, '72 saatten eski kayıt silinir');
  const txt = formatFibAlert({ ...clustersOf(row(base))[0], stage: 'new' }, Date.UTC(2026, 9, 25, 17));
  assert.match(txt, /hafta sonu/);
});

test('fib uyarısı: tur özeti tek mesaj', () => {
  assert.equal(fibDigest([]), null);
  assert.equal(fibDigest([{ coin: 'A', tf: '1H', text: 'x' }]), 'x');
  const m = fibDigest([{ coin: 'A', tf: '1H', text: 'x' }, { coin: 'B', tf: '15m', text: 'y' }]);
  assert.match(m, /2 kurulum/); assert.match(m, /A 1H, B 15m/); assert.match(m, /x\n\ny$/);
});

test('fib kesişimi preseti: tek sinyal listede görünür (minScore ≤ oluşum puanı)', () => {
  const p = PRESET_MAP.fib_cluster;
  const r = analyzeRow({ coin: 'XRP', instId: 'XRP-USDT-SWAP', tf: '1H', candles: base, live: null }, { ids: p.detectors, weights: p.weights, settings: { detectorOpts: p.detectorOpts } });
  assert.ok(r.score > 0 && r.score >= p.minScore, `puan ${r.score} < minScore ${p.minScore}`);
});

test('fib detektörü: clusterKs verilmezse varsayılan davranış aynı (yalnız swingK)', () => {
  const ctx = makeContext({ candles: base, tf: '1H', symbol: 'XRP' });
  const a = detect(ctx).filter((s) => s.id.startsWith('fib|cluster'));
  const ctx2 = makeContext({ candles: base, tf: '1H', symbol: 'XRP', opts: { fibonacci: { clusterKs: [2] } } });
  const b = detect(ctx2).filter((s) => s.id.startsWith('fib|cluster'));
  assert.deepEqual(a.map((s) => s.entry), b.map((s) => s.entry));
});
