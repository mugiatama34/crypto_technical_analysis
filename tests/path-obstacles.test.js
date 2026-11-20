// Yol engelleri (src/scan/checklist.js pathObstacles): giriş→TP2 arası ters FVG / OB ve alınmamış likidite. Yalnız gösterim + gölge
// kayıt; madde 8'in ✓/✗ değeri eski kuralla birebir aynı kalmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistOf, pathObstacles, pathDetail, pathOverlay, LIQ_WARN_R } from '../src/scan/checklist.js';
import { pathShadowOf, shadowBase, SHADOW_KEYS, emptyShadow } from '../bot/shadow.js';
import { build } from './helpers.js';

const long = { d: 1, atr: 1, entry: 100, stop: 99, tp1: 103, tp2: 105, inZone: false, riskPct: 1, trend: {} };
const short = { d: -1, atr: 1, entry: 100, stop: 102, tp1: 96, tp2: 92, inZone: false, riskPct: 2, trend: {} };
const fvg = (direction, zone, status = 'active', name = direction === 'short' ? 'FVG ↓' : 'FVG ↑') => ({ type: 'fvg', direction, status, name, zone });
const ob = (direction, zone, status = 'active', name = direction === 'short' ? 'Order Block ↓' : 'Order Block ↑') => ({ type: 'orderblock', direction, status, name, zone });
const liq = (name, level, atr = 1) => ({ type: 'liquidity', direction: 'neutral', status: 'forming', name, zone: [level - 0.2 * atr, level + 0.2 * atr], meta: { level } });

test('pathObstacles long: engel / likidite sınıfı, R uzaklığı (yakın kenar), sıralama, TP1 öncesi/sonrası', () => {
  const smc = [
    ob('short', [103.9, 104.3]), // TP1 sonrası
    fvg('short', [100.8, 101.2]), // 0,8R, TP1 öncesi
    liq('EQH (alınmamış)', 101.9), // 1,9R likidite
    { ...fvg('short', [102, 102.5]), name: 'iFVG ↓' }, // iFVG = engel
    ob('short', [102.6, 102.9], 'active', 'Breaker ↓'), // breaker = engel
    fvg('long', [101, 101.5]), // aynı yön: engel değil
  ];
  const po = pathObstacles(long, smc);
  assert.equal(po.R, 1);
  assert.deepEqual(po.items.map((x) => [x.kind, x.name, x.r, x.beforeTp1]), [
    ['engel', 'FVG ↓', 0.8, true], ['likidite', 'EQH (alınmamış)', 1.9, true], ['engel', 'iFVG ↓', 2, true],
    ['engel', 'Breaker ↓', 2.6, true], ['engel', 'Order Block ↓', 3.9, false],
  ]);
  assert.equal(po.n1, 3); assert.equal(po.n2, 1); assert.equal(po.firstR, 0.8); assert.equal(po.liq, 1);
  assert.deepEqual(po.items[0].zone, [100.8, 101.2]);
  const det = pathDetail(po);
  assert.match(det, /^0,8R FVG ↓ · 1,9R EQH|^0,8R FVG ↓ · 2,0R iFVG/);
  assert.match(det, /3,9R Order Block ↓ \(TP1 sonrası\)/);
  assert.match(det, /likidite: 1,9R EQH \(alınmamış\)/);
});

test('pathObstacles short: yön aynalı; bölge girişe taşıyorsa 0R, giriş + 0,1 ATR içindeki sayılmaz', () => {
  const smc = [
    fvg('long', [97.5, 98]), // yakın kenar 98 → 1R
    ob('long', [93, 94]), // yakın kenar 94 → 3R, TP1 (96) sonrası
    fvg('long', [99.5, 100.3]), // girişe taşıyor → 0R
    fvg('long', [99.95, 100.5]), // giriş − 0,1 ATR'ye ulaşmıyor → yok
    fvg('short', [97, 97.5]), // aynı yön
    liq('PDL yakın', 96.4), // 1,8R likidite
    liq('EQH (alınmamış)', 97), // ters taraf: short'ta tepe likiditesi yolda sayılmaz
  ];
  const po = pathObstacles(short, smc);
  assert.deepEqual(po.items.map((x) => [x.kind, x.name, x.r, x.beforeTp1]), [
    ['engel', 'FVG ↑', 0, true], ['engel', 'FVG ↑', 1, true], ['likidite', 'PDL yakın', 1.8, true], ['engel', 'Order Block ↑', 3, false],
  ]);
  assert.equal(po.n1, 2); assert.equal(po.n2, 1); assert.equal(po.firstR, 0);
});

test('pathObstacles: ölü bölgeler, süpürülmüş / kırılmış likidite ve TP2 ötesi sayılmaz', () => {
  const smc = [
    fvg('short', [101, 102], 'mitigated'), ob('short', [101, 102], 'invalid'), fvg('short', [101, 102], 'done'),
    fvg('short', [105.5, 106]), // TP2 ötesi
    { type: 'liquidity', direction: 'short', status: 'active', name: 'BSL süpürüldü', zone: [101.75, 102.25], meta: { level: 102 } },
    { type: 'liquidity', direction: 'long', status: 'active', name: 'EQH kırıldı', zone: [101.8, 102.2], meta: { level: 102 } },
    liq('EQH (alınmamış)', 105.5), // TP2 ötesi
    liq('EQL (alınmamış)', 102), // long'da dip likiditesi sayılmaz
  ];
  const po = pathObstacles(long, smc);
  assert.equal(po.items.length, 0); assert.equal(po.n1, 0); assert.equal(po.firstR, null); assert.equal(po.liq, 0);
  assert.equal(pathDetail(po), "yol temiz (TP2'ye kadar engel yok)");
  assert.deepEqual(pathObstacles({ ...long, stop: 100 }, [fvg('short', [101, 102])]).items, []); // R = 0 → boş
});

test('pathObstacles: hedef likiditenin hemen ötesindeyse uyarı (≤ 0,3R)', () => {
  assert.equal(LIQ_WARN_R, 0.3);
  const po = pathObstacles(long, [liq('EQH (alınmamış)', 102.8), liq('PWH yakın', 104.5)]);
  assert.deepEqual(po.warnings, ['TP1 likiditenin 0,2R ötesinde (EQH (alınmamış))']); // TP2 104,5'in 0,5R ötesinde → uyarı yok
  assert.match(pathDetail(po), /⚠ TP1 likiditenin 0,2R ötesinde/);
  const at = pathObstacles(long, [liq('PDH yakın', 105)]);
  assert.deepEqual(at.warnings, ['TP2 likidite seviyesinde (PDH yakın)']);
  assert.equal(at.items[0].beforeTp1, false);
  const s = pathObstacles(short, [liq('EQL (alınmamış)', 96.4)]); // TP1 96, seviye 96,4 → 0,2R öte
  assert.deepEqual(s.warnings, ['TP1 likiditenin 0,2R ötesinde (EQL (alınmamış))']);
});

// Eski madde 8 kuralı (değişmemeli): giriş + 0,1 ATR ile TP1 arasında, ters yönlü, ölü olmayan FVG / OB yoksa ✓
const DEAD = new Set(['mitigated', 'invalid', 'done']);
function oldOk(plan, smc) {
  const d = plan.d, atr = plan.atr, oppo = d === 1 ? 'short' : 'long';
  const lo = Math.min(plan.entry + d * 0.1 * atr, plan.tp1), hi = Math.max(plan.entry + d * 0.1 * atr, plan.tp1);
  return !smc.find((s) => (s.type === 'fvg' || s.type === 'orderblock') && s.direction === oppo && !DEAD.has(s.status) && s.zone && s.zone[1] > lo && s.zone[0] < hi);
}

test('madde 8 ✓/✗ eski kuralla birebir aynı; n1 = 0 ⇔ ✓ (rastgele 3000 durum)', () => {
  let seed = 12345; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // mulberry32
  const types = ['fvg', 'orderblock', 'liquidity'], dirs = ['long', 'short', 'neutral'], sts = ['active', 'triggered', 'mitigated', 'invalid', 'done', 'forming'];
  let oks = 0;
  for (let k = 0; k < 3000; k++) {
    const plan = rnd() < 0.5 ? long : short;
    const smc = Array.from({ length: Math.floor(rnd() * 6) }, () => {
      const a = 93 + rnd() * 13, w = rnd() * 1.5;
      return { type: types[Math.floor(rnd() * 3)], direction: dirs[Math.floor(rnd() * 3)], status: sts[Math.floor(rnd() * 6)], name: 'X', zone: [a, a + w], meta: { level: a + w / 2 } };
    });
    const item = checklistOf({ plan, candles: [], smc, now: Date.UTC(2026, 10, 18, 12) }).items.find((x) => x.id === 'path');
    assert.equal(item.ok, oldOk(plan, smc), `durum ${k}`);
    assert.equal(item.obstacles.n1 === 0, item.ok, `n1 ↔ ok ${k}`);
    if (item.ok) oks++;
  }
  assert.ok(oks > 300 && 3000 - oks >= 200, `✓ sayısı ${oks}`); // iki tarafta da yeterli durum
});

test('check list madde 8: detail okunur liste, yapısal liste item.obstacles üzerinde', () => {
  const smc = [fvg('short', [103.9, 104.3]), liq('EQH (alınmamış)', 101.2)];
  const it = checklistOf({ plan: long, candles: [], smc, now: Date.UTC(2026, 10, 18, 12) }).items.find((x) => x.id === 'path');
  assert.equal(it.ok, true); // engel TP1 sonrası → ✓ değişmez
  assert.equal(it.detail, "TP1'e kadar temiz · 3,9R FVG ↓ (TP1 sonrası) · likidite: 1,2R EQH (alınmamış)");
  assert.equal(it.obstacles.items.length, 2);
  // takip listesi özeti biçimi (id, ok) değişmez
  const cl = checklistOf({ plan: long, candles: [], smc, now: Date.UTC(2026, 10, 18, 12) });
  assert.deepEqual(Object.keys({ n: cl.n, of: cl.of, items: cl.items.map((x) => ({ id: x.id, ok: x.ok })) }.items[0]), ['id', 'ok']);
});

test('pathOverlay: engel kutu (TP1 öncesi/sonrası farklı renk), likidite kesikli yatay çizgi', () => {
  const po = pathObstacles(long, [fvg('short', [100.8, 101.2]), ob('short', [103.9, 104.3]), liq('EQH (alınmamış)', 101.9)]);
  const s = pathOverlay(po, 100);
  assert.equal(s.draw.length, 3);
  const [a, l, b] = s.draw;
  assert.equal(a.kind, 'box'); assert.equal(a.lo, 100.8); assert.equal(a.to, 100); assert.equal(a.from, 75); assert.match(a.label, /Engel 0,8R FVG/);
  assert.equal(b.kind, 'box'); assert.notEqual(a.color, b.color); assert.match(b.label, /OB/);
  assert.equal(l.kind, 'hline'); assert.equal(l.price, 101.9); assert.equal(l.style, 'dashed'); assert.equal(l.label, 'Lik 1,9R EQH');
});

test('gölge etiket: pathN1 / pathN2 / pathFirstR / pathLiq; veri yoksa null, hata yutulur', () => {
  for (const k of ['pathN1', 'pathN2', 'pathFirstR', 'pathLiq']) assert.ok(SHADOW_KEYS.includes(k));
  const rec = { coin: 'X', tf: '4H', d: 1, entry: 100, stop: 99, tp1: 103, tp2: 105, atr: 1 };
  const smc = [fvg('short', [100.8, 101.2]), ob('short', [103.9, 104.3]), liq('EQH (alınmamış)', 101.9)];
  assert.deepEqual(pathShadowOf(rec, null, smc), { pathN1: 1, pathN2: 1, pathFirstR: 0.8, pathLiq: 1 });
  assert.deepEqual(pathShadowOf(rec, null, []), { pathN1: 0, pathN2: 0, pathFirstR: null, pathLiq: 0 });
  assert.deepEqual(pathShadowOf(rec, null), { pathN1: null, pathN2: null, pathFirstR: null, pathLiq: null }); // satır / mum yok
  assert.deepEqual(pathShadowOf({ ...rec, stop: 100 }, null, smc), { pathN1: null, pathN2: null, pathFirstR: null, pathLiq: null });
  // gerçek detektörlerle (sentetik mumlar): sayılar sayı, hata yok
  const candles = build([[0, 120], [40, 100], [70, 115], [100, 98], [130, 104]], { tfMs: 4 * 3600e3 });
  const row = { coin: 'X', tf: '4H', candles, live: null };
  const s = shadowBase({ now: candles.at(-1).time + 60e3, tfMs: 4 * 3600e3, row, rec: { ...rec, entry: 103, stop: 101, tp1: 107, tp2: 110, atr: 1.5 }, sent: [], rows: [] });
  for (const k of ['pathN1', 'pathN2', 'pathLiq']) assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `${k} ${s[k]}`);
  // bozuk satır → alanlar null, diğer alanlar etkilenmez
  const bad = shadowBase({ now: 0, tfMs: 4 * 3600e3, row: { candles: [{ time: 0 }] }, rec, sent: [], rows: [] });
  assert.equal(bad.riskPct, 1);
  assert.deepEqual(Object.keys(emptyShadow()), SHADOW_KEYS);
});
