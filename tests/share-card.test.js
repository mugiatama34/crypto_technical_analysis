// Paylaşım kartı (src/ui/share-card.js): saf model — başlık, seviye satırları, R metinleri, grafik ölçeği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareCardModel, drawShareCard, fmtR, fmtUtc, CARD_FOOTER, CARD_W } from '../src/ui/share-card.js';
import { buildPlan } from '../bot/plan.js';
import { runScan } from '../src/scan/scanner.js';
import { fixtureProvider } from '../src/data/fixture.js';
import { build, mirror } from './helpers.js';

const NOW = Date.UTC(2026, 10, 21, 14, 30);
const sigs = ['FVG ↑', 'Order Block ↑', 'EQL', 'Fib 0,618', 'RSI uyumsuzluk', 'Çekiç', 'BOS ↑'].map((name) => ({ name }));
const longRow = { coin: 'BTC', tf: '4H', direction: 'long', score: 62, price: 101, candles: build([[0, 110], [60, 96], [120, 101]], { tfMs: 4 * 3600e3 }), live: null, best: { signals: sigs, zone: [99, 100] } };
const longPlan = { d: 1, tf: '4H', entry: 100, stop: 98, tp1: 103, tp2: 105, zone: [99, 100], inZone: false };
const keys = (m) => m.levels.map((l) => l.key);
const lv = (m, k) => m.levels.find((l) => l.key === k);
const covers = (m) => { const ps = [...m.chart.lines.map((l) => l.price), ...m.chart.candles.flatMap((c) => [c.h, c.l]), m.chart.lastPrice]; return ps.every((p) => p > m.chart.min && p < m.chart.max); };

test('paylaşım kartı: long + erken hedef → başlık, 5 seviye, R metinleri, dosya adı', () => {
  const m = shareCardModel(longRow, longPlan, { checklist: { n: 6, of: 8 }, now: NOW });
  assert.equal(m.header.dirText, 'LONG'); assert.equal(m.header.score, 62); assert.equal(m.header.check, '✓ 6/8');
  assert.equal(m.header.time, '21.11.2026 14:30 UTC');
  assert.deepEqual(keys(m), ['entry', 'stop', 'early', 'tp1', 'tp2']);
  assert.equal(lv(m, 'early').price, 101.2); // girişten %1,2 (WATCH_EARLY)
  assert.equal(lv(m, 'early').rText, '0,60R'); assert.equal(lv(m, 'tp1').rText, '1,50R'); assert.equal(lv(m, 'tp2').rText, '2,50R');
  assert.equal(lv(m, 'stop').rText, '−1,00R'); assert.match(lv(m, 'stop').note, /stop %2,00/);
  assert.match(lv(m, 'early').note, /%50 kapat/); assert.match(lv(m, 'tp1').note, /%25 kapat/); // 3 kademe
  assert.ok(m.planOk); assert.equal(m.noPlanText, '');
  assert.deepEqual(m.info.map(([k]) => k), ['Fiyat', 'Bölge']);
  assert.equal(m.signals.split(' · ').length, 6); // ilk 6 yapı
  assert.equal(m.footer, CARD_FOOTER);
  assert.equal(m.fileName, 'BTC-4H-long-20261121-1430.png');
  assert.match(m.shareText, /giriş .* stop .* erken .* TP1 .* TP2/);
  assert.equal(m.chart.candles.length, 90); assert.ok(covers(m));
});

test('paylaşım kartı: short (ayna) → R metinleri pozitif, grafik tüm seviyeleri kapsar', () => {
  const row = { ...longRow, direction: 'short', price: 99, candles: mirror(longRow.candles, 200), best: { signals: sigs.slice(0, 3), zone: [100, 101] } };
  const plan = { d: -1, tf: '4H', entry: 100, stop: 102, tp1: 97, tp2: 92, zone: [100, 101] };
  const m = shareCardModel(row, plan, { now: NOW });
  assert.equal(m.header.dirText, 'SHORT'); assert.equal(m.header.check, null);
  assert.deepEqual(keys(m), ['entry', 'stop', 'early', 'tp1', 'tp2']);
  assert.equal(lv(m, 'early').price, 98.8); assert.equal(lv(m, 'early').rText, '0,60R');
  assert.equal(lv(m, 'tp1').rText, '1,50R'); assert.equal(lv(m, 'tp2').rText, '4,00R');
  assert.equal(m.signals, 'FVG ↑ · Order Block ↑ · EQL');
  assert.ok(covers(m)); // seviyeler (TP2 92) mumların dışında da olsa eksen kapsar
  assert.ok(m.chart.min < 92 && m.chart.max > 102);
});

test('paylaşım kartı: erken hedefsiz (TP1 erken hedeften önce / eski takip kaydı) → 4 seviye', () => {
  const near = shareCardModel(longRow, { ...longPlan, stop: 50, tp1: 101, tp2: 110 }, { now: NOW }); // %1,2 > TP1
  assert.deepEqual(keys(near), ['entry', 'stop', 'tp1', 'tp2']);
  assert.match(lv(near, 'tp1').note, /%50 kapat · stop girişe/); assert.equal(lv(near, 'tp1').rText, '0,02R');
  const old = shareCardModel(longRow, longPlan, { now: NOW, computeEarly: false }); // takip kaydı, early alanı yok
  assert.deepEqual(keys(old), ['entry', 'stop', 'tp1', 'tp2']);
  const rec = shareCardModel(longRow, { ...longPlan, early: 101.5, earlyPortion: 0.5, midPortion: 0.25 }, { now: NOW, computeEarly: false });
  assert.equal(lv(rec, 'early').price, 101.5); assert.equal(lv(rec, 'early').rText, '0,75R'); // kayıttaki erken hedef
});

test('paylaşım kartı: plan yok → seviye yok, "plan kurulamadı", grafik + yapılar yine var', () => {
  const m = shareCardModel(longRow, null, { now: NOW, noPlanReason: 'fiyat TP1 ötesinde' });
  assert.equal(m.planOk, false); assert.deepEqual(m.levels, []);
  assert.equal(m.noPlanText, 'Plan kurulamadı (fiyat TP1 ötesinde)');
  assert.ok(m.chart && m.chart.lines.length === 0 && covers(m));
  assert.ok(m.signals.length > 0); assert.equal(m.shareText, 'BTC 4H LONG');
  const bare = shareCardModel({ coin: 'X', tf: '1H', direction: 'long', score: null, price: NaN, candles: [], signalNames: ['elle · kendi'] }, null, { now: NOW });
  assert.equal(bare.chart, null); assert.equal(bare.signals, ''); // kişisel etiket ("elle · kendi") yazılmaz
});

test('paylaşım kartı: biçim yardımcıları', () => {
  assert.equal(fmtR(1.5), '1,50R'); assert.equal(fmtR(-1), '−1,00R');
  assert.equal(fmtUtc(Date.UTC(2026, 0, 2, 3, 4)), '02.01.2026 03:04 UTC');
});

test('paylaşım kartı: fixture taramasındaki gerçek satırlar (buildPlan) → model kurulur, eksen tüm seviyeleri kapsar', async () => {
  const res = await runScan({ timeframes: ['1H', '4H'], topN: 10 }, { provider: fixtureProvider });
  let n = 0;
  for (const r of res.rows.filter((x) => x.best && x.direction)) {
    const p = buildPlan(r, { minScore: 0, minRR: 0, minRR1: 0, maxDistAtr: 99, fibPlan: true });
    const m = shareCardModel(r, p.ok ? p : null, { now: NOW, noPlanReason: p.reason });
    assert.ok(m.chart && covers(m), `${r.coin} ${r.tf}`);
    if (p.ok) { n++; assert.ok(m.levels.length >= 4); assert.ok(m.levels.every((l) => l.priceText !== '–')); }
  }
  assert.ok(n > 0, 'en az bir planlı satır');
});

test('paylaşım kartı: çizim (sahte canvas) hatasız, metinler kartın içinde', () => {
  const texts = [];
  const ctx = new Proxy({ font: '30px x' }, {
    get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (t) => ({ width: String(t).length * (parseFloat(/(\d+)px/.exec(o.font)?.[1]) || 30) * 0.55 }) : k === 'fillText' ? (t, x, y) => texts.push({ t, x, y }) : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const canvas = { getContext: () => ctx };
  for (const [row, plan] of [[longRow, longPlan], [longRow, null], [{ ...longRow, candles: [] }, longPlan]]) {
    texts.length = 0;
    const c = drawShareCard(shareCardModel(row, plan, { checklist: { n: 5, of: 8 }, now: NOW }), canvas);
    assert.equal(c.width, CARD_W); assert.ok(c.height > 900 && c.height < 1500, `yükseklik ${c.height}`);
    assert.ok(texts.every(({ x, y }) => x >= 0 && x <= CARD_W && y >= 0 && y <= c.height));
    assert.ok(texts.some(({ t }) => t === CARD_FOOTER));
    if (plan) assert.ok(texts.some(({ t }) => t === '1,50R')); else assert.ok(texts.some(({ t }) => /Plan kurulamadı/.test(t)));
  }
});
