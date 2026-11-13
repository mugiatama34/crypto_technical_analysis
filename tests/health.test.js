import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HEALTH, recordRun, recordOkx, recordTelegram, recordAgent, recordError, windowSum, healthLine, healthAlerts, dailySummaryOf } from '../bot/health.js';
import { sendTelegramEx, sendTelegramPhotoEx, formatSummary } from '../bot/telegram.js';
import { newAccount, openPosition, closeManual } from '../bot/agent/account.js';
import { PROFILES } from '../bot/agent/profiles.js';
import { runAgents, saveAgents, publish, loadAgents, accountFromPublished } from '../bot/agent/run.js';
import { runMomentum, portfolioFromPublished } from '../bot/momentum/run.js';

const H = 3600e3;
const T0 = Date.UTC(2026, 10, 10, 6, 0); // saat başı
const runsEvery15 = (st, from, to) => { for (let t = from; t <= to; t += 15 * 60e3) recordRun(st, t); };

// ---- Sayaç penceresi
test('sağlık: 24 saatlik pencere kayar; eski kovalar atılır, beklenen koşu sayaç geçmişiyle sınırlı', () => {
  const st = {};
  recordRun(st, T0); recordOkx(st, { req: 100, err: 10 }, T0); recordTelegram(st, { ok: false, retries: 2 }, T0);
  let w = windowSum(st, T0);
  assert.equal(w.runs, 1); assert.equal(w.okxErr, 10); assert.equal(w.tgErr, 1); assert.equal(w.tgRetry, 2); assert.equal(w.expectedRuns, 1);
  recordRun(st, T0 + 23 * H);
  w = windowSum(st, T0 + 23 * H + 10 * 60e3);
  assert.equal(w.runs, 2, 'T0 kovası pencerede (23 saat önceki saat)');
  w = windowSum(st, T0 + 24 * H + 5 * 60e3);
  assert.equal(w.runs, 1, 'T0 kovası pencereden çıktı'); assert.equal(w.okxErr, 0); assert.equal(w.tgErr, 0);
  recordRun(st, T0 + 26 * H);
  assert.ok(st.health.buckets.every((b) => b.t >= T0 + 3 * H), 'pencere dışı kovalar silindi');
  // Tam 15 dakikada bir koşu: 24 saatte beklenenle aynı
  const s2 = {}; runsEvery15(s2, T0, T0 + 30 * H);
  const w2 = windowSum(s2, T0 + 30 * H);
  assert.equal(w2.runs, w2.expectedRuns); assert.equal(w2.runs, 93);
  // Eski durum (health yok): sıfırdan başlar
  const old = { sent: [], stats: {} }; recordRun(old, T0); assert.equal(windowSum(old, T0).runs, 1);
});

test('sağlık satırı: koşu/beklenen, OKX oranı, Telegram, ajan karar/hata, diğer hatalar, cron atlaması', () => {
  const st = {};
  runsEvery15(st, T0, T0 + 24 * H);
  recordOkx(st, { req: 1000, err: 4 }, T0 + 24 * H);
  recordAgent(st, 'temkinli', true, T0 + 24 * H); recordAgent(st, 'agresif', false, T0 + 24 * H, { error: 'x' });
  recordError(st, 'momentum', T0 + 24 * H);
  const line = healthLine(windowSum(st, T0 + 24 * H), PROFILES);
  assert.match(line, /^Sağlık 24s: 93\/93 koşu · OKX hata %0,4 · Telegram 0 · ajan karar T1\/A0 · hata T0\/A1 · diğer: momentum 1$/);
  const few = {}; runsEvery15(few, T0, T0 + 6 * H); for (let t = T0 + 6 * H; t <= T0 + 24 * H; t += H) recordRun(few, t);
  assert.match(healthLine(windowSum(few, T0 + 24 * H), {}), /koşu ⚠️ cron atlaması/);
});

// ---- Uyarılar
test('uyarı (a): ajan art arda 3 karar hatası; başarı sıfırlar; kredi hatası sayılmaz; 6 saat bastırma', () => {
  const st = {};
  recordRun(st, T0);
  for (let i = 0; i < 2; i++) recordAgent(st, 'agresif', false, T0, { error: 'Claude: HTTP 529' });
  assert.equal(healthAlerts(st, T0, { profiles: PROFILES }), null, '2 hata: uyarı yok');
  recordAgent(st, 'agresif', true, T0); recordAgent(st, 'agresif', false, T0, { error: 'e' }); recordAgent(st, 'agresif', false, T0, { error: 'e' });
  assert.equal(healthAlerts(st, T0, { profiles: PROFILES }), null, 'başarı sayacı sıfırladı');
  recordAgent(st, 'agresif', false, T0, { error: 'Claude JSON <ayrıştırılamadı>' });
  const a = healthAlerts(st, T0, { profiles: PROFILES });
  assert.match(a, /⚠️ <b>Sağlık<\/b>/); assert.match(a, /Ajan \[Agresif\]: art arda 3 karar denemesi/); assert.match(a, /&lt;ayrıştırılamadı&gt;/);
  recordAgent(st, 'agresif', false, T0 + H, { error: 'e' });
  assert.equal(healthAlerts(st, T0 + 5 * H, { profiles: PROFILES }), null, '6 saat dolmadan tekrar yok');
  assert.match(healthAlerts(st, T0 + 6 * H, { profiles: PROFILES }), /art arda 4/);
  const c = {}; for (let i = 0; i < 5; i++) recordAgent(c, 'temkinli', false, T0, { error: 'Claude: Your credit balance is too low' });
  assert.equal(healthAlerts(c, T0, { profiles: PROFILES }), null, 'kredi hatası ayrı uyarıda');
  assert.equal(windowSum(c, T0).agentErr.temkinli, 5, 'ama hata sayısına girer');
});

test('uyarı (b): bir turda OKX hata oranı > %20; 6 saat bastırma', () => {
  const st = {}; recordRun(st, T0);
  assert.equal(recordOkx(st, { req: 100, err: 20 }, T0), 0.2);
  assert.equal(healthAlerts(st, T0, { okxRate: 0.2, okxReq: 100, okxErr: 20 }), null, 'tam %20: uyarı yok');
  const a = healthAlerts(st, T0, { okxRate: 0.34, okxReq: 200, okxErr: 68 });
  assert.match(a, /OKX: bu turda hata oranı %34,0 \(68\/200 istek\)/);
  assert.equal(healthAlerts(st, T0 + 3 * H, { okxRate: 0.9, okxReq: 10, okxErr: 9 }), null);
  assert.ok(healthAlerts(st, T0 + 6 * H + 1, { okxRate: 0.9, okxReq: 10, okxErr: 9 }));
  assert.equal(recordOkx({}, { req: 0, err: 0 }, T0), 1, 'istek yoksa oran 1');
});

test('uyarı (c): 24 saatte koşu beklenenin yarısının altında; sayaç geçmişi 6 saatten kısaysa yok; 6 saat bastırma', () => {
  const st = {};
  recordRun(st, T0); recordRun(st, T0 + 5 * H);
  assert.equal(healthAlerts(st, T0 + 5 * H), null, 'geçmiş < 6 saat');
  for (let t = T0 + 6 * H; t <= T0 + 10 * H; t += H) recordRun(st, t);
  const a = healthAlerts(st, T0 + 10 * H);
  assert.match(a, /Koşu: son 10 saatte 7\/41/);
  assert.equal(healthAlerts(st, T0 + 15 * H), null);
  const ok = {}; runsEvery15(ok, T0, T0 + 24 * H); assert.equal(healthAlerts(ok, T0 + 24 * H), null, 'tam koşu: uyarı yok');
  // Yarısı tam sınırda değil: 60/93 > %50
  const half = {}; let k = 0; for (let t = T0; t <= T0 + 24 * H; t += 15 * 60e3) if (k++ % 3 !== 0) recordRun(half, t);
  assert.equal(healthAlerts(half, T0 + 24 * H + 1), null);
  assert.ok(HEALTH.runsMinFrac === 0.5 && HEALTH.alertEveryH === 6 && HEALTH.okxErrRate === 0.2 && HEALTH.agentFailStreak === 3);
});

// ---- Telegram yeniden deneme
const resp = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
test('Telegram 429: retry_after kadar bekleyip yeniden dener (çift mesaj yok); en fazla 2 yeniden deneme', async () => {
  const calls = [], waits = [];
  const seq = [resp(429, JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 3 } })), resp(200, '{"ok":true}')];
  const r = await sendTelegramEx('x', { token: 't', chatId: 'c', fetchImpl: async (u, o) => { calls.push(o.body); return seq.shift(); }, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual([r.ok, r.retries, calls.length], [true, 1, 2]); assert.equal(waits[0], 3250);
  const always = await sendTelegramEx('x', { token: 't', chatId: 'c', fetchImpl: async () => { calls.push(1); return resp(429, '{"parameters":{"retry_after":1}}'); }, sleep: async () => {} });
  assert.deepEqual([always.ok, always.retries], [false, 2]); assert.equal(calls.length, 2 + 3);
  // Çok uzun retry_after (> 30 sn) beklenmez; 504 / bağlantı kopması (mesaj gitmiş olabilir) yeniden denenmez; 400 denenmez
  for (const f of [async () => resp(429, '{"parameters":{"retry_after":120}}'), async () => resp(504), async () => resp(400, 'Bad Request'), async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; }]) {
    let n = 0; const x = await sendTelegramEx('x', { token: 't', chatId: 'c', fetchImpl: async () => { n++; return f(); }, sleep: async () => {} });
    assert.deepEqual([x.ok, x.retries, n], [false, 0, 1]);
  }
  // Hiç ulaşmayan istek (DNS) ve 502 yeniden denenir
  let n = 0; const seq2 = [() => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }, () => resp(502), () => resp(200)];
  const y = await sendTelegramEx('x', { token: 't', chatId: 'c', fetchImpl: async () => seq2[n++](), sleep: async () => {} });
  assert.deepEqual([y.ok, y.retries, n], [true, 2, 3]);
  // Fotoğraf: her denemede yeni gövde
  const bodies = []; const s3 = [resp(429, '{"parameters":{"retry_after":1}}'), resp(200)];
  const ph = await sendTelegramPhotoEx(Buffer.from([1, 2]), 'c', { token: 't', chatId: 'c', fetchImpl: async (u, o) => { bodies.push(o.body); return s3.shift(); }, sleep: async () => {} });
  assert.ok(ph.ok); assert.equal(bodies.length, 2); assert.notEqual(bodies[0], bodies[1]);
  // Kimlik yoksa istek yok, hata sayılmaz işareti
  const nc = await sendTelegramEx('x', {}); assert.ok(!nc.ok && nc.noCreds);
  // Sayaca işlenir
  const st = {}; recordTelegram(st, always, T0); recordTelegram(st, r, T0);
  assert.deepEqual([windowSum(st, T0).tgErr, windowSum(st, T0).tgRetry], [1, 3]);
});

// ---- Günlük özet
test('günlük özet: be/early/knife/timeout sayıları ve gün içinde kapananların toplam R\'si (düzeltilmiş kayıt dahil)', () => {
  const now = T0 + 30 * H, since = now - 24 * H;
  const P = (status, over = {}) => ({ key: status, coin: 'X', tf: '4H', direction: 'long', sentAt: since - 48 * H, updatedAt: now - H, status, entry: 100, stop: 99, rr1: 1.5, rr: 2.5, ...over });
  const sent = [P('be', { early: 101.2, earlyPortion: 0.8 }), P('be', { early: 101.2, earlyPortion: 0.8 }), P('early', { early: 101.2 }), P('knife'), P('timeout', { exitR: -0.4 }), P('stopped'), P('done'), P('waiting', { sentAt: now - H }), P('expired', { updatedAt: since - H })];
  const items = sent.map((p, i) => ({ ...p, id: `i${i}`, closedAt: p.updatedAt }));
  items.push({ ...P('done'), id: 'old', closedAt: since - H }); // dünden: sayılmaz
  const { stats, dayR } = dailySummaryOf(sent, items, since);
  assert.deepEqual({ sent: stats.sent, be: stats.be, early: stats.early, knife: stats.knife, timeout: stats.timeout, stopped: stats.stopped, done: stats.done, expired: stats.expired }, { sent: 1, be: 2, early: 1, knife: 1, timeout: 1, stopped: 1, done: 1, expired: 0 });
  // be: 0,8 × 1,2 = 0,96 (×2), timeout −0,4, stop −1, done 0,75 + 1,25 = 2 → 2,52
  assert.equal(dayR.n, 5); assert.ok(Math.abs(dayR.R - 2.52) < 1e-9, String(dayR.R));
  // Yeniden puanlanmış kayıt (rescored.R) finalR'ı ezer
  const re = dailySummaryOf(sent, items.map((s) => (s.id === 'i6' ? { ...s, rescored: { R: -1 } } : s)), since);
  assert.ok(Math.abs(re.dayR.R - (2.52 - 3)) < 1e-9);
  const text = formatSummary(stats, [], since, { dayR, health: 'Sağlık 24s: 93/93 koşu' });
  assert.match(text, /Gönderilen 1 · Aktif 0 · Erken alındı 1 · TP1 0/);
  assert.match(text, /Kapanan: Tamam 1 · BE 2 · Stop 1 · Zaman 1 · Bıçak 1 · Süresi dolan 0 · Kaçan 0/);
  assert.match(text, /Gün içinde kapanan 5 işlem: toplam \+2,52R/);
  assert.ok(text.trim().endsWith('Sağlık 24s: 93/93 koşu'));
  assert.match(formatSummary(stats, [], since, { dayR: { n: 1, R: -1 } }), /toplam −1,00R/);
  assert.ok(text.split('\n').length <= 7, 'kısa');
  // Geriye uyumlu çağrı (eski 3 argüman)
  assert.ok(formatSummary({ sent: 0 }, [], since).includes('Gönderilen 0'));
});

// ---- Ajan geri kurma
const TP = PROFILES.temkinli;
const req = (over = {}) => ({ coin: 'ETH', tf: '4H', direction: 'long', margin: 50, leverage: 5, order: 'market', price: 100, stop: 97, tp1: 104, tp2: 108, rationale: 't', ...over });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ctxOf = (dir, over = {}) => ({ rows: [], candidates: [], prices: {}, now: 5000, cfg: {}, notify: async () => {}, log: () => {}, llm: {}, stateFile: path.join(dir, 'state.json'), publishDir: path.join(dir, 'pub'), ...over });

test('ajan: durum yok + yayın var → yayından geri kurulur (pozisyon/özsermaye/etiket), bir kez bildirilir; kayıp işlemler raporlanır', async () => {
  const dir = tmp('agh-'), pub = path.join(dir, 'pub');
  const a = newAccount(TP, 1000); a.resetLabel = 'r1'; a.resetAt = 1000; a.lastDecision = 1500;
  for (let i = 0; i < 3; i++) { const r = openPosition(a, req({ coin: `C${i}` }), 1000, TP.guards); closeManual(a, r.position.id, 95, 2000, 'x'); }
  openPosition(a, req({ coin: 'SOL' }), 3000, TP.guards);
  a.trades = a.trades.slice(-1); // yayın son N işlemi taşır (burada 1; ham istatistik 3)
  publish(a, pub);
  const msgs = [];
  const st = await runAgents(ctxOf(dir, { cfg: { reset: 'r1' }, notify: async (t) => msgs.push(t) }));
  const t = st.temkinli;
  assert.equal(t.positions.length, 1); assert.equal(t.positions[0].coin, 'SOL'); assert.equal(t.resetLabel, 'r1'); assert.equal(t.lastDecision, 1500);
  assert.ok(t.equity < 300, 'kayıplı işlemler özsermayede'); assert.equal(t.stats.trades, 3); assert.equal(t.stats.avgR, undefined, 'türetilmiş alan atıldı');
  assert.equal(msgs.filter((m) => m.includes('yayından geri kuruldu')).length, 1, 'yalnız temkinli (agresif yayını yok)');
  assert.match(msgs.find((m) => m.includes('geri kuruldu')), /2 eski işlem kaydı/);
  assert.ok(!msgs.some((m) => m.includes('sıfırlandı')), 'etiket aynı: sıfırlama yok');
  assert.equal(st.agresif.equity, 300); assert.equal(st.agresif.resetLabel, 'r1');
  msgs.length = 0;
  await runAgents(ctxOf(dir, { now: 6000, cfg: { reset: 'r1' }, notify: async (t) => msgs.push(t) }));
  assert.ok(!msgs.some((m) => m.includes('geri kuruldu')), 'ikinci koşu durum dosyasından: mesaj yok');
});

test('ajan: geri kurulan hesabın etiketi eskiyse AGENT_RESET arşivler ve sıfırlar; ikisi de yoksa yeni hesap, geri kurma yok', async () => {
  const dir = tmp('agh2-'), pub = path.join(dir, 'pub');
  const a = newAccount(TP, 1000); a.resetLabel = 'r0';
  const r = openPosition(a, req(), 1000, TP.guards); closeManual(a, r.position.id, 95, 2000, 'x');
  publish(a, pub);
  const msgs = [];
  const st = await runAgents(ctxOf(dir, { cfg: { reset: 'r1' }, notify: async (t) => msgs.push(t) }));
  assert.ok(msgs.some((m) => m.includes('geri kuruldu')) && msgs.some((m) => m.includes('sıfırlandı')));
  assert.equal(st.temkinli.equity, 300); assert.equal(st.temkinli.resetLabel, 'r1'); assert.equal(st.temkinli.resets.at(-1).label, 'r0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(pub, 'archive', 'r1', 'temkinli.json'), 'utf8')).trades.length, 1, 'geri kurulan hesap arşivlendi');
  // İkisi de yok
  const d2 = tmp('agh3-'), m2 = [];
  const s2 = await runAgents(ctxOf(d2, { cfg: { reset: 'r1' }, notify: async (t) => m2.push(t) }));
  assert.equal(m2.length, 0); assert.equal(s2.temkinli.equity, 300); assert.equal(s2.temkinli.resetLabel, 'r1');
  // Durum dosyası varsa yayına bakılmaz; bozuk/yanlış profilli yayın kullanılmaz
  const d3 = tmp('agh4-'); fs.mkdirSync(path.join(d3, 'pub'));
  fs.writeFileSync(path.join(d3, 'pub', 'temkinli.json'), JSON.stringify({ profile: 'agresif', equity: 1, trades: [], positions: [], orders: [], stats: {} }));
  const info = {}; const s3 = loadAgents(path.join(d3, 'state.json'), 1, path.join(d3, 'pub'), info);
  assert.equal(info.restored.length, 0); assert.equal(s3.temkinli.equity, 300);
  assert.equal(accountFromPublished(null, 'temkinli'), null);
  saveAgents(path.join(d3, 'state.json'), { temkinli: newAccount(TP, 1) });
  const i2 = {}; loadAgents(path.join(d3, 'state.json'), 1, pub, i2); assert.ok(!i2.restored.some((x) => x.id === 'temkinli'));
});

test('ajan: karar hatası sağlık kancasına işlenir (profil başına, kind decide)', async () => {
  const dir = tmp('agh5-'), seen = [];
  const cand = { coin: 'ETH', tf: '4H', direction: 'long', d: 1, score: 70, zone: [99, 100], entry: 100, stop: 97, tp1: 104, tp2: 108, rr: 2.6, rr1: 1.3, riskPct: 3, signals: [], htf: [], trend: {} };
  await runAgents(ctxOf(dir, { candidates: [cand], prices: { ETH: 100 }, llm: { apiKey: 'k', model: 'm', fetchImpl: async () => resp(500, '{"error":{"message":"boom"}}') }, health: (id, ok, o) => seen.push([id, ok, o.kind]) }));
  const ag = seen.filter((x) => x[0] === 'agresif');
  assert.deepEqual(seen.find((x) => x[0] === 'temkinli'), ['temkinli', false, 'decide']);
  assert.ok(ag.length === 0 || ag[0][1] === false, 'agresif (avoidTfs yoksa) da hata');
});

// ---- Momentum geri kurma
const DAY = 86400e3, MON = Date.UTC(2026, 9, 19);
const mkDaily = (drift, n = 80) => { const out = []; let p = 100; for (let i = 0; i < n; i++) { const open = p; p = p * (1 + drift + Math.sin(i * 0.7 + drift * 900) * 0.01); out.push({ time: MON - (n - i) * DAY, open, high: Math.max(open, p) * 1.005, low: Math.min(open, p) * 0.995, close: p, volume: 1, quoteVol: 1e6 }); } return out; };
const U = Array.from({ length: 12 }, (_, i) => ({ coin: `C${i}`, instId: `C${i}-USDT-SWAP`, candles: mkDaily((i - 6) * 0.003) }));
const provider = { topCoins: async (n) => U.slice(0, n || 0).map((x) => ({ coin: x.coin, instId: x.instId })), candles: async (instId) => ({ candles: (U.find((y) => y.coin === instId.split('-')[0]) || { candles: mkDaily(0.001) }).candles, live: null }) };

test('momentum: durum yok + yayın var → yayından geri kurulur, bir kez bildirilir; ikisi de yoksa yeni portföy', async () => {
  const dir = tmp('momh-'), msgs = [];
  const args = { cfg: { dry: false, variant: 'short', hedge: true }, notify: async (m) => msgs.push(m), log: () => {}, stateFile: path.join(dir, 'st.json'), publishDir: dir, provider };
  const pf1 = await runMomentum({ ...args, now: MON + 60e3 });
  assert.ok(msgs.some((m) => m.includes('başladı'))); assert.ok(!msgs.some((m) => m.includes('geri kuruldu')));
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'momentum.json'), 'utf8'));
  fs.unlinkSync(args.stateFile); msgs.length = 0;
  const pf2 = await runMomentum({ ...args, now: MON + 2 * 3600e3 });
  assert.equal(msgs.filter((m) => m.includes('Momentum durumu yayından geri kuruldu')).length, 1);
  assert.ok(!msgs.some((m) => m.includes('başladı') || m.includes('yeniden dengeleme')), 'aynı hafta: yeniden dengeleme yok');
  assert.match(msgs[0], /ilk stopu ve giriş riski/);
  assert.equal(pf2.positions.length, pf1.positions.length);
  assert.deepEqual(pf2.positions.map((q) => [q.coin, q.d, !!q.hedge]), pf1.positions.map((q) => [q.coin, q.d, !!q.hedge]));
  assert.equal(pf2.lastRebalance, pf1.lastRebalance); assert.equal(pf2.btcStart, before.btc.start);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'momentum.json'), 'utf8'));
  assert.ok(Math.abs(after.equity - before.equity) < 0.05, `özsermaye korunur (${before.equity} → ${after.equity})`);
  msgs.length = 0;
  await runMomentum({ ...args, now: MON + 3 * 3600e3 });
  assert.ok(!msgs.some((m) => m.includes('geri kuruldu')), 'sonraki tur durum dosyasından');
  assert.equal(portfolioFromPublished(null), null); assert.equal(portfolioFromPublished({ positions: [] }), null);
});
