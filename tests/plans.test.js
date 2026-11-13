import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { planMismatch, loadPlans, writePlansFile, readPlansFile } from '../backtest/plans.js';

const D = 86400e3, T0 = Date.UTC(2025, 10, 14);
const plans = (from, to, tfs) => { const out = []; for (let t = from; t <= to; t += 5 * D) for (const tf of tfs) out.push({ coin: 'BTC', tf, time: t, plan: {} }); return out; };
const meta = { from: T0, to: T0 + 300 * D, tfs: ['1H', '4H'], split: T0 + 200 * D };

test('planMismatch: aynı koşu → uyumlu; eski/farklı koşu → yakalanır', () => {
  assert.deepEqual(planMismatch(plans(T0, T0 + 300 * D, ['1H', '4H']), meta), []);
  const stale = planMismatch(plans(T0 + 160 * D, T0 + 295 * D, ['15m', '1H', '4H']), meta); // 08.11 olayı: kısa aralık + 15m
  assert.ok(stale.some((s) => s.includes('plan başı')));
  assert.ok(stale.some((s) => s.includes('15m')));
  assert.deepEqual(planMismatch(plans(T0, T0 + 10 * D, ['1H']), {}), []); // meta yoksa denetim yok
});

test('loadPlans: uyumsuzlukta hata, uyumluda bölünme results.json\'dan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ meta }));
  fs.writeFileSync(path.join(dir, 'plans.json.gz'), zlib.gzipSync(JSON.stringify(plans(T0, T0 + 300 * D, ['1H', '4H']))));
  assert.equal(loadPlans(dir).split, meta.split);
  fs.writeFileSync(path.join(dir, 'plans.json.gz'), zlib.gzipSync(JSON.stringify(plans(T0 + 160 * D, T0 + 295 * D, ['15m', '4H']))));
  assert.throws(() => loadPlans(dir), /aynı koşudan değil/);
});

test('writePlansFile / readPlansFile: satır satır, çok parçalı gzip; eski tek parça dosya da okunur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plansfile-'));
  const f = path.join(dir, 'plans.json.gz');
  const items = Array.from({ length: 25 }, (_, i) => ({ coin: `C${i}`, tf: '4H', time: T0 + i * D, R: i / 10, plan: { note: 'satır\nsonu, virgül, ] ve [ "tırnak" ₿', signals: [{ name: 'a,' }] }, ...(i % 3 ? {} : { cd: [{ time: T0 + i, plan: { entry: 1 } }] }) }));
  for (const chunk of [2000, 7, 1]) { writePlansFile(f, items, chunk); assert.deepEqual(readPlansFile(f), items); }
  assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()), items); // içerik geçerli JSON dizisi
  writePlansFile(f, []); assert.deepEqual(readPlansFile(f), []);
  writePlansFile(f, items.slice(0, 1)); assert.deepEqual(readPlansFile(f), items.slice(0, 1));
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(items))); assert.deepEqual(readPlansFile(f), items); // eski biçim
});
