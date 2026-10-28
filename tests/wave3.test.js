// klonnist/ew-setup-scanner (MIT) dalga-3 testlerinden uyarlandı: C uzaması (cExtend), cExt etiketi, dalga 1 kalitesi, ders kitabı şablonu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { findWave3Setups, w1Quality, textbookOf, tbMissing, DEFAULTS } from '../src/scan/wave3.js';
import { fillAtr } from '../src/core/zigzag.js';
import { atr } from '../src/data/indicators.js';

const HEAD = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110]];
const O = { sensitivities: [4.5], subDivisors: [2], minRR: 0, entryType: 'both' };
const forming = (path, o = {}) => findWave3Setups(build(path), { ...O, cExtend: true, ...o }).find((x) => x.phase === 'forming');

test('wave3 cExtend: C alt derecede bitip fiyat dönünce kurulum kalır (cDone); kapalıyken eski davranış (düşer)', () => {
  const before = forming(HEAD), after = forming([...HEAD, [74, 115]]);
  assert.ok(before && !before.cDone);
  assert.ok(after, "C'den dönüşte kurulum kaybolmamalı");
  assert.equal(after.cDone, true);
  assert.equal(after.points.cNow.price, before.points.cNow.price);
  assert.ok(Math.abs(after.zone.entry - before.zone.entry) < 0.01);
  assert.equal(forming([...HEAD, [74, 115]], { cExtend: false }), undefined);
  assert.equal(DEFAULTS.cExtend, false, 'bot varsayılanı eski davranış');
});

test('wave3 cExtend: C uzayınca kurulum kalır, C en derin dip; tepki B\'yi geçerse ABC değil; cExt etiketi', () => {
  const H = [...HEAD, [74, 115]];
  const before = forming(H), ext = forming([...H, [80, 106]]);
  assert.ok(ext, "uzayan C'de kurulum kaybolmamalı");
  assert.equal(ext.cDone, false);
  assert.ok(ext.points.cNow.price < 107);
  assert.ok(Math.abs(ext.zone.entry - before.zone.entry) < 0.05);
  assert.equal(forming([...H, [80, 106], [83, 110]]).cDone, true);
  assert.equal(forming([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 124], [82, 106]]), undefined);
  assert.equal(before.cExt, false);
  assert.equal(ext.cExt, true);
});

test('wave3 dalga 1 kalitesi: düz itki yüksek verim, testere düşük; şablon filtresi kapalıyken her kurulum puan taşır', () => {
  const q = (path, i0, i1) => {
    const c = build(path);
    const a = fillAtr(atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14));
    return w1Quality(c, a, { i: i0, price: c[i0].low }, { i: i1, price: c[i1].high });
  };
  const straight = q([[0, 100], [20, 100.5], [30, 120], [40, 110]], 20, 29);
  const saw = [[0, 100], [20, 100.5]];
  for (let b = 22, p = 100.5; b <= 60; b += 2) { p += (b / 2) % 2 ? 3 : -2.5; saw.push([b, p]); }
  const choppy = q([...saw, [70, 105]], 20, 59);
  assert.ok(straight.er > 0.9 && straight.speed > choppy.speed);
  assert.ok(choppy.er < 0.2);
  const path = [...HEAD, [74, 115]];
  const off = findWave3Setups(build(path), { ...O, cExtend: true });
  assert.ok(off.length && off.every((s) => s.w1q && s.textbook));
  assert.equal(findWave3Setups(build(path), { ...O, cExtend: true, textbook: true, textbookMin: 4, cleanW1Er: 2 }).length, 0);
});

test('wave3 ders kitabı şablonu: ideal 4/4, minicik ABC ve uzun dalga 2 eksik', () => {
  const base = { P0: { price: 100 }, P1: { price: 130 }, A: { price: 116 }, B: { price: 125 }, C: 107.5, w1q: { er: 0.7, speed: 0.6 }, zone: { perfect: true }, timeRatio: 1.6, atr: 2 };
  assert.equal(textbookOf(base, DEFAULTS).n, 4);
  assert.equal(textbookOf({ ...base, A: { price: 129 }, B: { price: 129.6 }, C: 128.8 }, DEFAULTS).checks.abc, false);
  const slow = textbookOf({ ...base, timeRatio: 4, zone: { perfect: false } }, DEFAULTS);
  assert.equal(slow.n, 2);
  assert.deepEqual(tbMissing(slow), ['★ yok', 'dalga 2 çok uzun']);
});
