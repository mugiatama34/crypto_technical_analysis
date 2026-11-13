// Gölge etiketler (bot/shadow.js): yalnız kayıt; karar yolunu etkilemez.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  offMinOf, openCounts, riskPctOf, pctRank, rsRankOf, shadowBase, safeShadow, emptyShadow, SHADOW_KEYS,
  parseFunding, parseOi, encodeSnap, decodeSnap, updateOiSnaps, oiChange, collectShadowNet, applyShadowNet, OI_SNAP,
} from '../bot/shadow.js';

const H = 3600e3, H4 = 4 * H;

test('offMin: canlı mum açılışından, yoksa UTC sınırından; 4H için 0–239', () => {
  const t0 = Date.UTC(2026, 10, 13, 8); // 08:00 UTC 4H mum açılışı
  assert.equal(offMinOf(t0 + 37 * 60e3 + 5e3, H4, t0), 37);
  assert.equal(offMinOf(t0 + 239 * 60e3 + 59e3, H4), 239);
  assert.equal(offMinOf(t0, H4), 0);
  assert.equal(offMinOf(t0 + 90 * 60e3, H4, t0 - 10 * H4), 90); // eski/uyumsuz canlı mum → sınır
  assert.equal(offMinOf(t0, 0), null);
  assert.equal(offMinOf(NaN, H4), null);
});

test('openCounts: kapalı planlar ve bu sinyal hariç; aynı yön ayrı', () => {
  const sent = [
    { key: 'A', sentAt: 1, d: 1, status: 'waiting' }, { key: 'B', sentAt: 1, d: 1, status: 'active' },
    { key: 'C', sentAt: 1, d: -1, status: 'tp1' }, { key: 'D', sentAt: 1, direction: 'short', status: 'confirming' },
    { key: 'E', sentAt: 1, d: 1, status: 'done' }, { key: 'F', sentAt: 1, d: 1, status: 'stopped' }, { key: 'G', sentAt: 1, d: -1, status: 'be' },
    { key: 'X', sentAt: 9, d: 1, status: 'waiting' }, null, {},
  ];
  assert.deepEqual(openCounts(sent, 1, 'X|9'), { openSame: 2, openAll: 4 });
  assert.deepEqual(openCounts(sent, -1), { openSame: 2, openAll: 5 });
  assert.deepEqual(openCounts(null, 1), { openSame: 0, openAll: 0 });
});

test('riskPct ve yüzdelik sıra', () => {
  assert.equal(riskPctOf(100, 98.76), 1.24);
  assert.equal(riskPctOf('2', '2.1'), 5);
  assert.equal(riskPctOf(0, 1), null);
  assert.equal(riskPctOf(null, 1), null);
  assert.equal(pctRank([1, 2, 3, 4, 5], 1), 0);
  assert.equal(pctRank([1, 2, 3, 4, 5], 5), 1);
  assert.equal(pctRank([1, 2, 3, 4, 5], 3), 0.5);
  assert.equal(pctRank([1, 2, 2, 3], 2), 0.5); // eşitler ortalama
  assert.equal(pctRank([1], 1), null);
  assert.equal(pctRank([1, 2], 7), null);
  const rows = [
    { coin: 'BTC', tf: '4H', trend: { rsBtc: null } }, { coin: 'A', tf: '4H', trend: { rsBtc: -3 } }, { coin: 'B', tf: '4H', trend: { rsBtc: 1 } },
    { coin: 'C', tf: '4H', trend: { rsBtc: 4 } }, { coin: 'A', tf: '1H', trend: { rsBtc: 9 } }, { coin: 'D', tf: '4H', error: 'x', trend: { rsBtc: 99 } },
  ];
  assert.deepEqual(rsRankOf(rows, '4H', 'B'), { rs: 1, rsRank: 0.5, rsN: 3 });
  assert.deepEqual(rsRankOf(rows, '4H', 'C'), { rs: 4, rsRank: 1, rsN: 3 });
  assert.deepEqual(rsRankOf(rows, '4H', 'BTC'), { rs: null, rsRank: null, rsN: 3 });
  assert.deepEqual(rsRankOf(null, '4H', 'B'), { rs: null, rsRank: null, rsN: null });
});

test('shadowBase: tüm anahtarlar var, ağ alanları null; bozuk girdide hata fırlatmaz', () => {
  const now = Date.UTC(2026, 10, 13, 9, 15);
  const rec = { key: 'B|4H|long|1', coin: 'B', tf: '4H', d: 1, entry: 50, stop: 49, sentAt: now };
  const s = shadowBase({ now, tfMs: H4, row: { live: { time: Date.UTC(2026, 10, 13, 8) } }, rec, sent: [{ d: 1, status: 'waiting' }, { d: -1, status: 'active' }], rows: [{ coin: 'B', tf: '4H', trend: { rsBtc: 2 } }, { coin: 'C', tf: '4H', trend: { rsBtc: 1 } }] });
  assert.deepEqual(Object.keys(s).sort(), [...SHADOW_KEYS].sort());
  assert.equal(s.offMin, 75); assert.equal(s.openSame, 1); assert.equal(s.openAll, 2); assert.equal(s.riskPct, 2);
  assert.equal(s.rs, 2); assert.equal(s.rsRank, 1); assert.equal(s.rsN, 2);
  for (const k of ['funding', 'fundingBtc', 'fundingIntH', 'oiChg24h']) assert.equal(s[k], null);
  const bad = shadowBase({ now: NaN, tfMs: undefined, row: null, rec: { get d() { throw new Error('x'); } }, sent: 5, rows: 'x' });
  assert.deepEqual(Object.keys(bad).sort(), [...SHADOW_KEYS].sort());
  let seen = null;
  assert.deepEqual(safeShadow(() => { throw new Error('boom'); }, (e) => { seen = e.message; }), emptyShadow());
  assert.equal(seen, 'boom');
});

test('fonlama ve açık pozisyon ayrıştırma savunmacı', () => {
  assert.deepEqual(parseFunding([{ fundingRate: '0.000125', fundingTime: '1794600000000', nextFundingTime: String(1794600000000 + 8 * H) }]), { rate: 0.0125, intH: 8 });
  assert.deepEqual(parseFunding([{ fundingRate: '-0.0003' }]), { rate: -0.03, intH: null });
  for (const x of [null, [], [null], [{}], [{ fundingRate: '' }], [{ fundingRate: 'abc' }], { fundingRate: '1' }, 'x']) assert.equal(parseFunding(x), null);
  const m = parseOi([
    { instId: 'BTC-USDT-SWAP', oi: '100', oiCcy: '2.5' }, { instId: 'ETH-USDT-SWAP', oi: '300' }, { instId: 'X-USDT-SWAP', oiCcy: 'nan' },
    { instId: 'BTC-USD-SWAP', oiCcy: '9' }, { instId: 'SOL-USDT-250101', oiCcy: '1' }, { instId: 'Z-USDT-SWAP', oiCcy: '7' }, null, { oiCcy: '1' },
  ], new Set(['BTC', 'ETH', 'X']));
  assert.deepEqual([...m], [['BTC', { v: 2.5, k: 'c' }], ['ETH', { v: 300, k: 'n' }]]);
  assert.equal(parseOi(null).size, 0);
  assert.equal(parseOi({ data: [] }).size, 0);
  assert.deepEqual([...decodeSnap(encodeSnap(m))], [...m]);
  assert.equal(decodeSnap('BTC=c;=c1;ETH=q3;SOL=c-1').size, 0);
  assert.equal(decodeSnap(null).size, 0);
});

test('OI görüntüsü: saatte en çok bir, ~30 saat tutulur; 24s ± 2s değişim', () => {
  const t0 = Date.UTC(2026, 10, 1);
  let snaps = [];
  let adds = 0;
  // 40 saat boyunca 15 dakikada bir tur: BTC OI her saat %1 artar
  for (let k = 0; k <= 40 * 4; k++) {
    const now = t0 + k * 15 * 60e3;
    const cur = new Map([['BTC', { v: 1000 * 1.01 ** (k / 4), k: 'c' }], ['ETH', { v: 50, k: 'n' }]]);
    const u = updateOiSnaps(snaps, now, cur); snaps = u.snaps; if (u.added) adds++;
    assert.ok(snaps.every((s) => now - s.t <= OI_SNAP.keepMs));
    for (let i = 1; i < snaps.length; i++) assert.ok(snaps[i].t - snaps[i - 1].t >= OI_SNAP.everyMs);
  }
  assert.ok(snaps.length <= 31, `görüntü ${snaps.length}`);
  assert.ok(adds >= 40 && adds <= 42, `eklenen ${adds}`);
  assert.ok(JSON.stringify(snaps).length < 31 * 200);
  const now = t0 + 40 * H;
  const chg = oiChange(snaps, now, 'BTC', { v: 1000 * 1.01 ** 40, k: 'c' });
  assert.ok(Math.abs(chg - (1.01 ** 24 - 1) * 100) < 0.2, `chg ${chg}`);
  assert.equal(oiChange(snaps, now, 'ETH', { v: 50, k: 'c' }), null); // birim farklı
  assert.equal(oiChange(snaps, now, 'ETH', { v: 55, k: 'n' }), 10);
  assert.equal(oiChange(snaps, now, 'SOL', { v: 5, k: 'c' }), null); // coin yok
  assert.equal(oiChange(snaps, now, 'BTC', null), null);
  // yetersiz geçmiş: yalnız son 20 saat → 24s ± 2s görüntüsü yok
  assert.equal(oiChange(snaps.filter((s) => now - s.t <= 20 * H), now, 'BTC', { v: 1, k: 'c' }), null);
  // boş/bozuk görüntü listesi, boş güncel veri → eklenmez
  assert.deepEqual(updateOiSnaps('x', now, new Map()), { snaps: [], added: false });
  assert.equal(updateOiSnaps([{ t: 'a' }, null, { t: now - 31 * H, d: '' }], now, new Map([['A', { v: 1, k: 'c' }]])).snaps.length, 1);
});

test('collectShadowNet: iyi yanıt, bozuk yanıt, hata fırlatan getter ve zaman aşımı hata fırlatmaz', async () => {
  const now = Date.UTC(2026, 10, 13, 9);
  const good = async (p, params) => (p.endsWith('funding-rate') ? [{ fundingRate: params.instId.startsWith('BTC') ? '0.0001' : '-0.0002' }] : [{ instId: 'AVAX-USDT-SWAP', oiCcy: '110' }, { instId: 'BTC-USDT-SWAP', oiCcy: '5' }]);
  const prev = [{ t: now - 24 * H, d: 'AVAX=c100' }];
  const net = await collectShadowNet({ get: good, sigCoins: ['AVAX'], scanned: new Set(['AVAX', 'BTC']), snaps: prev, now });
  assert.match(net.line, /^Gölge etiket: fonlama 2\/2 ok · açık pozisyon 2 coin · görüntü 2 \(\+1\)$/);
  const items = applyShadowNet([{ coin: 'AVAX', shadow: emptyShadow() }], net, now);
  assert.equal(items[0].shadow.funding, -0.02); assert.equal(items[0].shadow.fundingBtc, 0.01); assert.equal(items[0].shadow.oiChg24h, 10);

  const bads = [
    async () => ({ weird: true }), async () => null, async () => [[1, 2]], () => { throw new Error('senkron'); },
    async () => { throw new Error('ağ'); }, () => new Promise(() => {}), // asla dönmeyen
  ];
  for (const get of bads) {
    const t = Date.now();
    const r = await collectShadowNet({ get, sigCoins: ['AVAX'], scanned: new Set(['AVAX']), snaps: prev, now, budgetMs: 200 });
    assert.ok(Date.now() - t < 1000);
    assert.match(r.line, /^Gölge etiket: fonlama 0\/2 ok/);
    assert.equal(r.added, false);
    const it = applyShadowNet([{ coin: 'AVAX', shadow: emptyShadow() }], r, now)[0].shadow;
    for (const k of ['funding', 'fundingBtc', 'oiChg24h']) assert.equal(it[k], null);
  }
  // sinyal yok, görüntü taze → OI çağrısı da yok
  let calls = 0;
  const r2 = await collectShadowNet({ get: async () => { calls++; return []; }, sigCoins: [], snaps: [{ t: now - 10 * 60e3, d: 'A=c1' }], now });
  assert.equal(calls, 0); assert.match(r2.line, /atlandı/);
  // sinyal yok, görüntü zamanı geldi → yalnız tek OI çağrısı
  const r3 = await collectShadowNet({ get: async (p) => { calls++; assert.ok(p.endsWith('open-interest')); return [{ instId: 'A-USDT-SWAP', oiCcy: '1' }]; }, sigCoins: [], snaps: [], now });
  assert.equal(calls, 1); assert.equal(r3.added, true);
});

// ---- Bot uçtan uca (fixture, ağ yok): gölge toplayıcı hata verse / yanıt bozuk olsa da kayıt yazılır ve seçilen planlar aynıdır
function runBot(dir, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, FIXTURE: '1', AGENT: '0', MOMENTUM: '0', AUDIT: '0', FIB_ALERT: '0', SIGNAL_CHART: '0', DRY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', ANTHROPIC_API_KEY: '',
    STATE_FILE: path.join(dir, 'state.json'), HISTORY_FILE: path.join(dir, 'history.json'), AGENT_PUBLISH_DIR: path.join(dir, 'agent'), ...extra };
  const out = execFileSync('node', ['bot/run.mjs'], { env, encoding: 'utf8' });
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  return { out, items: h.items, state: JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) };
}
const pick = (x) => ({ coin: x.coin, tf: x.tf, direction: x.direction, entry: x.entry, stop: x.stop, tp1: x.tp1, tp2: x.tp2, score: x.score, status: x.status, zone: x.zone, signals: x.signals });

test('bot fixture: gölge etiket hatası / bozuk yanıt sinyal kaydını ve seçimi değiştirmez', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-'));
  const base = runBot(path.join(root, 'a'));
  assert.ok(base.items.length > 0, 'fixture sinyal üretmeli');
  assert.match(base.out, /Gölge etiket: \d+ kayıt · ağ atlandı \(fixture\)/);
  for (const x of base.items) { assert.ok(x.shadow); assert.ok(x.shadow.riskPct > 0); assert.ok(x.shadow.offMin >= 0 && x.shadow.offMin < 240); assert.equal(x.shadow.funding, null); }

  const thrown = runBot(path.join(root, 'b'), { SHADOW_FIXTURE: 'throw' });
  assert.match(thrown.out, /Gölge etiket hatası \(yerel\)/);
  assert.deepEqual(thrown.items.map(pick), base.items.map(pick));
  for (const x of thrown.items) assert.deepEqual(x.shadow, emptyShadow());

  const badFile = path.join(root, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify({ funding: { BTC: [{ fundingRate: 'x' }], AVAX: 'yok' }, oi: { data: 1 } }));
  const bad = runBot(path.join(root, 'c'), { SHADOW_FIXTURE: badFile });
  assert.deepEqual(bad.items.map(pick), base.items.map(pick));
  assert.match(bad.out, /Gölge etiket: fonlama 0\/\d+ ok/);
  for (const x of bad.items) { assert.equal(x.shadow.funding, null); assert.equal(x.shadow.oiChg24h, null); assert.equal(x.shadow.riskPct, base.items.find((y) => y.coin === x.coin).shadow.riskPct); }

  const goodFile = path.join(root, 'good.json');
  const coins = base.items.map((x) => x.coin);
  fs.writeFileSync(goodFile, JSON.stringify({ funding: Object.fromEntries([...coins, 'BTC'].map((c) => [c, [{ fundingRate: '0.0001' }]])), oi: coins.map((c) => ({ instId: `${c}-USDT-SWAP`, oiCcy: '1000', ts: '1' })) }));
  const good = runBot(path.join(root, 'd'), { SHADOW_FIXTURE: goodFile });
  assert.deepEqual(good.items.map(pick), base.items.map(pick));
  for (const x of good.items) { assert.equal(x.shadow.funding, 0.01); assert.equal(x.shadow.fundingBtc, 0.01); assert.equal(x.shadow.oiChg24h, null); }
  assert.equal(good.state.oiSnap.length, 1);
  assert.ok(!('shadow' in good.state.sent[0]), 'gölge state.sent\'e yazılmaz');
  fs.rmSync(root, { recursive: true, force: true });
});
