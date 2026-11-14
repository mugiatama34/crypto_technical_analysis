#!/usr/bin/env node
// Fonlama geliri (taşıma) ölçümü (14.11.2026; tanımlar docs/arastirma/on-kayit-fonlama.md, bağlayıcı): C1 betimsel, C2 kalıcılık,
// C3 R1–R3 (maliyet %0,30 bilgi + %0,39 verdict). Kâğıt / araştırma; gerçek emir yok. Hyperliquid'e yalnız herkese açık `info` okuma.
//   NODE_USE_ENV_PROXY=1 node backtest/carry.mjs [--out docs/backtest] [--cache backtest/cache/carry] [--coins docs/backtest/results.json]
//                                               [--okxDays 100] [--noOkx] [--refresh]
// Çıktı: docs/backtest/carry.json + konsolda tablolar. OKX çapraz denetimi yalnız OKX erişilebilirse (Actions); yoksa available: false.
import fs from 'node:fs';
import path from 'node:path';
import { runCarry, mapCoin, parseHlRows, mergeRows, COSTS, VERDICT_COST, CARRY_DEFAULTS, HALF_A_START, HALF_B_START, HOUR, DAY } from './carry.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const CFG = { out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/carry')), coinsFile: String(arg('coins', 'docs/backtest/results.json')), okxDays: +arg('okxDays', 100), noOkx: arg('noOkx', false) === true, refresh: arg('refresh', false) === true };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const HL_URL = 'https://api.hyperliquid.xyz/info';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nazik istek: aynı anda ≤ 3 (havuz), istek başlangıçları arası ≥ 350 ms, 429 / hata → artan bekleme, 6 deneme.
let nextSlot = 0;
async function hlPost(body) {
  for (let i = 0; i < 6; i++) {
    const now = Date.now(), wait = Math.max(0, nextSlot - now); nextSlot = Math.max(now, nextSlot) + 350;
    if (wait) await sleep(wait);
    try {
      const r = await fetch(HL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 5) throw e; await sleep(2000 * (i + 1)); }
  }
  throw new Error('yeniden deneme bitti');
}

/** Bir coinin tüm fonlama geçmişi (önbellek + kaldığı yerden sayfalama; startTime = son kayıt + 1 ms). */
async function hlFunding(hl, from, end) {
  const f = path.join(CFG.cacheDir, `${hl}.json`);
  let rows = [];
  if (!CFG.refresh) try { rows = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { rows = []; }
  let t = rows.length ? rows[rows.length - 1].time + HOUR : from, pages = 0;
  while (t < end - HOUR) {
    const page = await hlPost({ type: 'fundingHistory', coin: hl, startTime: t });
    pages++;
    if (!Array.isArray(page) || !page.length) break;
    rows = mergeRows(rows, parseHlRows(page));
    const lastRaw = Math.max(...page.map((x) => Number(x.time)).filter(Number.isFinite));
    if (page.length < 500 || !(lastRaw + 1 > t)) break;
    t = lastRaw + 1;
  }
  fs.writeFileSync(f, JSON.stringify(rows));
  return { rows, pages };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}

const d10 = (t) => (t == null ? '—' : new Date(t).toISOString().slice(0, 10));
const f = (x, w = 7) => String(x == null ? '—' : x).padStart(w);

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(CFG.cacheDir, { recursive: true });
  const res = JSON.parse(fs.readFileSync(CFG.coinsFile, 'utf8'));
  const requested = res?.meta?.coins || [];
  if (!requested.length) throw new Error(`${CFG.coinsFile} meta.coins boş`);
  const meta = await hlPost({ type: 'meta' });
  const listed = (meta?.universe || []).filter((u) => !u.isDelisted).map((u) => u.name);
  const delisted = new Set((meta?.universe || []).filter((u) => u.isDelisted).map((u) => u.name));
  const mapping = {}, unmapped = [];
  for (const c of requested) { const m = mapCoin(c, listed); if (m) mapping[c] = m; else unmapped.push(delisted.has(c) ? `${c} (HL'de listeden kalkmış)` : c); }
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  log(`İstenen ${requested.length} coin · HL'de ${Object.keys(mapping).length} · eşlenemeyen ${unmapped.length}: ${unmapped.join(', ')}`);

  const coins = Object.keys(mapping);
  let done = 0;
  const fetched = await pool(coins, 3, async (c) => {
    let r = null;
    try { r = await hlFunding(mapping[c], HALF_A_START, end); } catch (e) { log(`  ${c}: ${e.message}`); }
    if (++done % 5 === 0) log(`  ${done}/${coins.length} coin`);
    return r;
  });
  const series = coins.map((c, i) => ({ coin: c, hl: mapping[c], rows: (fetched[i]?.rows || []).filter((x) => x.time >= HALF_A_START && x.time < end) })).filter((s) => s.rows.length);
  const failed = coins.filter((c, i) => !fetched[i]?.rows?.length);
  const dataEnd = Math.max(...series.map((s) => s.rows[s.rows.length - 1].time)) + HOUR;
  log(`HL veri: ${series.length} coin, ${series.reduce((a, s) => a + s.rows.length, 0)} kayıt, ${d10(Math.min(...series.map((s) => s.rows[0].time)))} → ${d10(dataEnd)}`);

  // OKX çapraz denetim: önce BTC dene; olmazsa (yerel koşu) atla
  let okx = null, okxNote = null;
  if (!CFG.noOkx) {
    try {
      const { fetchFunding } = await import('./mom-diag.mjs');
      const { instIdOf } = await import('../src/data/okx.js');
      const since = end - CFG.okxDays * DAY;
      const btc = await Promise.race([fetchFunding(instIdOf('BTC'), since), sleep(60000).then(() => { throw new Error('zaman aşımı (60 s)'); })]);
      if (!btc) throw new Error('BTC fonlama boş');
      okx = { BTC: btc };
      for (const s of series) if (s.coin !== 'BTC') { try { const r = await fetchFunding(instIdOf(s.coin), since); if (r) okx[s.coin] = r; } catch { /* coin OKX'te yok / hata */ } }
      log(`OKX fonlama: ${Object.keys(okx).length} coin`);
    } catch (e) { okx = null; okxNote = `OKX erişilemedi: ${e.message}`; log(okxNote); }
  } else okxNote = '--noOkx';

  const top10 = requested.filter((c) => series.some((s) => s.coin === c)).slice(0, 10);
  const rep = runCarry({ series, okx, top10, end: dataEnd });
  if (!rep.crossCheck.available && okxNote) rep.crossCheck.note = okxNote;
  rep.meta = {
    generatedAt: Date.now(), runtimeSec: Math.round((Date.now() - t0) / 1000), preReg: 'docs/arastirma/on-kayit-fonlama.md',
    source: { funding: 'Hyperliquid info fundingHistory (saatlik; 2023-06 başında ~1 hafta 8 saatlik)', coins: `${CFG.coinsFile} meta.coins (son tam koşunun OKX hacimde ilk ${requested.length}'i, generatedAt ${d10(res.meta.generatedAt)})`, okx: okx ? `OKX funding-rate-history (son ${CFG.okxDays} gün)` : null },
    period: { from: d10(rep.period.from), to: d10(rep.period.to), weeks: rep.period.weeks, halfA: `${d10(HALF_A_START)} → ${d10(HALF_B_START)}`, halfB: `${d10(HALF_B_START)} → ${d10(rep.period.to)}` },
    coins: { requested: requested.length, foundOnHl: Object.keys(mapping).length, withData: series.length, unmapped, fetchFailed: failed, top10 },
    nameMap: Object.fromEntries(Object.entries(mapping).filter(([a, b]) => a !== b)),
    params: { ...CARRY_DEFAULTS, costs: COSTS, verdictCost: VERDICT_COST, annualization: 'oran toplamı ÷ kapsanan saat × 8760; haftalık getiri yıllığı = ort. × 365,25/7 (bileşiksiz)', weekHalf: 'hafta başlangıcı 01.03.2025 öncesi → A', thr8h: '8 s eşdeğeri > %0,01 (kesin büyük; HL taban faizi tam %0,01 eşik geçmez)' },
  };
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(path.join(CFG.out, 'carry.json'), JSON.stringify(rep));
  print(rep);
  log(`Yazıldı: ${path.join(CFG.out, 'carry.json')} (${rep.meta.runtimeSec} s)`);
}

function print(rep) {
  const g = rep.c1.groups;
  console.log(`\n=== C1 yıllık fonlama % (short alır) · pozitif saat payı ===`);
  const years = Object.keys(g.all.byYear);
  console.log(`grup      tümü     A        B        ${years.map((y) => y.padStart(7)).join(' ')}   poz.pay`);
  for (const k of ['BTC', 'ETH', 'top10', 'all']) console.log(`${k.padEnd(8)}${f(g[k].all?.annPct, 8)} ${f(g[k].A?.annPct, 8)} ${f(g[k].B?.annPct, 8)} ${years.map((y) => f(g[k].byYear[y]?.annPct)).join(' ')}   ${f(g[k].all?.posShare, 6)}`);
  console.log(`coin medyanı (tüm dönem): %${rep.c1.coinMedianAnnPct}`);
  console.log(`\n=== C2 kalıcılık (hafta) ===`);
  for (const h of ['A', 'B', 'all']) { const c = rep.c2[h]; if (c) console.log(`${h.padEnd(4)} hafta ${c.weeks} coin ${c.avgCoins} · ρ ${c.rhoMean} [${c.rhoCi90}] · ilk-5 %${c.top5AnnPct} vs evren %${c.universeAnnPct} → fark %${c.diffAnnPct} [${c.diffCi90Pct}] · ilk-5 önde ${c.top5BeatShare}`); }
  for (const [label, c] of Object.entries(rep.c3)) {
    console.log(`\n=== C3 maliyet %${c.costPct}${label === VERDICT_COST ? ' (verdict)' : ' (bilgi)'} — net yıllık % nominal / sermaye · en kötü 4 hf (sermaye) · eksi hf · devir/yıl · boşta ===`);
    for (const [k, v] of Object.entries(c.rules)) for (const sc of ['unscaled', 'scaled']) {
      if (!v[sc]) continue;
      for (const h of ['A', 'B', 'all']) { const s = v[sc][h]; if (s) console.log(`${k} ${sc === 'scaled' ? 'ölç.' : 'ham '} ${h.padEnd(3)} n${f(s.weeks, 4)}  net ${f(s.nominal.netAnnPct)} / ${f(s.capital.netAnnPct)}  brüt ${f(s.nominal.grossAnnPct)}  en kötü 4hf ${f(s.capital.worst4wPct)}  eksi ${f(s.negWeekShare, 5)}  devir ${f(s.turnoverPerYear, 6)}  boşta ${f(s.idleShare, 5)}`); }
    }
  }
  const cc = rep.crossCheck;
  console.log(`\nÇapraz denetim: ${cc.available ? `${cc.coins} coin, HL/OKX havuz ${cc.pooledRatioTotal}, coin medyanı ${cc.medianCoinRatioTotal} (medyan-gün ${cc.medianCoinRatioMedian}); kullanılan ${JSON.stringify(cc.ratioUsed)}` : `yok (${cc.note || ''})`}`);
  const v = rep.verdict;
  console.log(`verdict (maliyet %${v.costPct}): ham → ${v.unscaled?.result} [${v.unscaled?.passing}] · ölçeklenmiş → ${v.scaled ? `${v.scaled.result} [${v.scaled.passing}]` : 'null'} · bilgi %0,30 ham → ${v.infoPreRegCost?.result}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e); process.exit(1); });
