// Canlı-backtest eşleştirme koşusu: docs/signals/history.json → gerçek mumlarla yeniden oynatma → docs/backtest/replay.json
//   node backtest/replay.mjs [--fee 0] [--slip 0] [--knife-since <ms>] [--fixture]
// Ücret/kayma varsayılan 0: canlı R hesabı (finalR) komisyonsuz; aynı birimle karşılaştırılır.
import fs from 'node:fs';
import path from 'node:path';
import { TIMEFRAMES, instIdOf } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import { knifeGuardOf } from '../bot/plan.js';
import { replayItem, summarize } from './replay.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { fee: +arg('fee', 0), slip: +arg('slip', 0), history: String(arg('history', 'docs/signals/history.json')), out: String(arg('out', 'docs/backtest/replay.json')), cacheDir: String(arg('cache', 'backtest/cache')), fixture: arg('fixture', false) === true, knifeSince: arg('knife-since', null) };
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  const now = Date.now();
  const items = JSON.parse(fs.readFileSync(CFG.history, 'utf8')).items.filter((s) => TIMEFRAMES[s.tf] && s.entry && s.stop);
  let ruleSince = null;
  try { ruleSince = JSON.parse(fs.readFileSync('docs/agent/review.json', 'utf8')).latest?.metrics?.rules?.since ?? null; } catch { /* yok */ }
  // Düşen bıçak koruması canlıda ne zaman açıldı: yaklaşma ölçüsü yalnız koruma açıkken yazılır
  const guarded = items.filter((s) => s.approachAtr != null || s.status === 'knife').map((s) => s.sentAt);
  const knifeSince = CFG.knifeSince != null ? +CFG.knifeSince : guarded.length ? Math.min(...guarded) : Infinity;
  const guard = knifeGuardOf('1');

  const groups = new Map();
  for (const s of items) { const k = `${s.coin}|${s.tf}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(s); }
  log(`${items.length} kayıt, ${groups.size} coin×TF; bıçak koruması ${Number.isFinite(knifeSince) ? new Date(knifeSince).toISOString() : 'yok'}'dan beri`);

  const fixture = CFG.fixture ? (await import('../src/data/fixture.js')).fixtureProvider : null;
  const rows = [], errors = [];
  let done = 0;
  for (const [k, list] of groups) {
    const [coin, tf] = k.split('|'), ms = TIMEFRAMES[tf].ms;
    const start = Math.min(...list.map((s) => s.sentAt)) - 5 * ms;
    let candles;
    try {
      candles = fixture ? (await fixture.candles(instIdOf(coin), tf, 400)).candles : await getHistoryCached(instIdOf(coin), tf, start, now, { cacheDir: CFG.cacheDir });
    } catch (err) { errors.push({ key: k, error: err.message }); continue; }
    for (const s of list) rows.push({ ...replayItem(s, candles, now, { knifeGuard: s.sentAt >= knifeSince ? guard : null, feePct: CFG.fee, slipPct: CFG.slip }), regime: ruleSince && s.sentAt >= ruleSince ? 'current' : 'legacy', orphan: !!s.orphan });
    if (++done % 25 === 0) log(`  ${done}/${groups.size}`);
  }

  const by = (f) => { const o = {}; for (const r of rows) (o[f(r)] ??= []).push(r); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, summarize(v)])); };
  const mismatches = rows.filter((r) => r.match === false).map((r) => ({ id: r.id, tf: r.tf, direction: r.direction, market: r.market, sentAt: new Date(r.sentAt).toISOString().slice(0, 16), recorded: r.recorded, track: r.track, engine: r.engine }));
  const report = {
    meta: { generatedAt: now, fee: CFG.fee, slip: CFG.slip, ruleSince, knifeSince: Number.isFinite(knifeSince) ? knifeSince : null, items: items.length, errors },
    note: 'recorded = canlıda kaydedilen sonuç (finalR); track = canlı takip kodu tam mum verisiyle; engine = backtest motoru aynı planla (komisyonsuz). recorded ≈ track ≠ engine → kural farkı; recorded ≠ track → canlı takip/veri sorunu.',
    all: summarize(rows), byRegime: by((r) => r.regime), byRegimeDir: by((r) => `${r.regime} ${r.direction}`), byTf: by((r) => `${r.regime} ${r.tf}`),
    statusPairs: Object.entries(rows.reduce((a, r) => { const k = `${r.recorded.status}→${r.track.status}`; a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]),
    mismatches: mismatches.slice(0, 200), rows,
  };
  fs.mkdirSync(path.dirname(CFG.out), { recursive: true });
  fs.writeFileSync(CFG.out, JSON.stringify(report));
  const f = (s) => `n ${s.n} · kayıt ${s.recorded.avgR} (n ${s.recorded.n}, %${Math.round((s.recorded.win ?? 0) * 100)}) · takip ${s.track.avgR} (n ${s.track.n}) · motor ${s.engine.avgR} (n ${s.engine.n}) · durum eşleşmesi ${s.statusMatch} / ${s.compared}`;
  log('Tümü:', f(report.all));
  for (const [k, s] of Object.entries(report.byRegimeDir)) log(`  ${k}:`, f(s));
  log('Durum çiftleri (kayıt→takip):', report.statusPairs.slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
  if (errors.length) log(`${errors.length} hata, ilki:`, errors[0]);
}

main().catch((err) => { console.error(err); process.exit(1); });
