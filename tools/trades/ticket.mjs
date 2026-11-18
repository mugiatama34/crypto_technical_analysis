// Emir fişi: botun son planını kullanıcının Bybit'e ELLE gireceği sayılara çevirir (emir GÖNDERMEZ; anahtar kullanmaz).
// Miktar = risk $ ÷ |giriş − stop|, Bybit adımına aşağı yuvarlı; kademeler demo köprüsüyle aynı (`legsOf`).
//   node tools/trades/ticket.mjs NEAR [--risk 0.5] [--tf 4H] [--dir short] [--local]
// Varsayılan risk (Deney B): long 1 $, short 0,5 $ (ilk işlem / hafta sonu da 0,5 $ → --risk 0.5).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bybitOf } from '../../src/data/bybit-symbols.js';
import { maxLeverage } from '../../bot/telegram.js';
import { CLOSED } from '../../bot/plan.js';
import { levelsOf, sizeOf, legsOf, parseInstrument, fmtStep } from '../../bot/exchange/demo.js';

export const RISK_DEFAULT = { long: 1, short: 0.5 };
const pct = (a, b) => Math.abs(a - b) / a * 100;

/** Coin için en yeni plan (isteğe bağlı TF / yön süzgeci). */
export function latestPlan(items, coin, { tf = '4H', dir = null } = {}) {
  const c = String(coin).toUpperCase().replace(/USDT$/, '');
  return items.filter((x) => x.coin === c && (!tf || x.tf === tf) && (!dir || x.direction === dir)).sort((a, b) => b.sentAt - a.sentAt)[0] || null;
}

/**
 * Plan + enstrüman → fiş. Saf işlev (ağ yok). `last` = Bybit son fiyatı (uyarılar için, isteğe bağlı).
 * Dönen: { ok, reason?, symbol, side, lv, qty, riskUsd, riskReal, stopPct, notional, lev, margin, legs[], stopMoves[], warns[] }
 */
export function ticketOf(plan, inst, { riskUsd = null, last = null, now = Date.now() } = {}) {
  if (!plan) return { ok: false, reason: 'plan bulunamadı' };
  if (!inst) return { ok: false, reason: 'Bybit enstrümanı bulunamadı' };
  const lv = levelsOf(plan, inst);
  if (!lv) return { ok: false, reason: 'plan seviyeleri geçersiz (giriş / stop)' };
  const side = lv.d === 1 ? 'long' : 'short';
  const risk = riskUsd > 0 ? riskUsd : RISK_DEFAULT[side];
  const size = sizeOf(lv, inst, risk);
  if (!size.ok) return { ok: false, reason: `${size.reason}; en küçük emirle (${inst.minQty}) risk ${(inst.minQty * Math.abs(lv.entry - lv.stop)).toFixed(2)} $ olur`, lv, symbol: inst.symbol, side };
  const qty = size.qty, dist = Math.abs(lv.entry - lv.stop), stopPct = pct(lv.entry, lv.stop);
  const lev = Math.min(maxLeverage(lv.entry, lv.stop) ?? 1, inst.maxLev || 20);
  const legs = legsOf(lv, qty, inst).map((l) => ({ ...l, value: l.qty * l.price, R: lv.d * (l.price - lv.entry) / dist }));
  const stopMoves = [];
  if (legs.length > 1) stopMoves.push({ after: legs[0].tag, to: lv.entry });
  if (legs.length > 2 && lv.midStop === 'early' && lv.early != null) stopMoves.push({ after: legs[1].tag, to: lv.early });
  const warns = [];
  if (plan.status && plan.status !== 'waiting') warns.push(CLOSED.has(plan.status) ? `plan kapanmış (${plan.status}); bu fiş geçersiz` : `plan artık beklemiyor (${plan.status}); sistem girişi çoktan doldu`);
  const ageH = (now - plan.sentAt) / 3600e3;
  if (ageH > 48) warns.push(`plan ${Math.round(ageH)} saat önce gönderildi`);
  if (stopPct < 1) warns.push(`stop mesafesi %${stopPct.toFixed(2)} < %1 (Deney B kuralı: girme)`);
  if (Number.isFinite(last)) {
    if (lv.d * (lv.entry - last) > 0) warns.push(`son fiyat ${last} girişin ${side === 'short' ? 'üstünde' : 'altında'}: limit emir hemen dolar`);
    if (lv.d * (last - (lv.early ?? lv.tp1)) >= 0) warns.push(`son fiyat ${last} ilk hedefi geçmiş: plan kaçmış olabilir`);
  }
  for (const l of legs) if (inst.minNotional && l.value < inst.minNotional) warns.push(`${l.tag} değeri ${l.value.toFixed(2)} $ < en az ${inst.minNotional} $: Bybit reddederse bu kademeyi sonrakiyle birleştir`);
  return { ok: true, symbol: inst.symbol, mult: inst.mult || 1, side, lv, qty, riskUsd: risk, riskReal: qty * dist, stopPct, notional: qty * lv.entry, lev, margin: qty * lv.entry / lev, legs, stopMoves, warns, inst, plan: { id: plan.id, tf: plan.tf, score: plan.score, sentAt: plan.sentAt, status: plan.status } };
}

/** Fiş → düz metin (Bybit uygulamasındaki alan adlarıyla). */
export function formatTicket(t) {
  if (!t.ok) return `Fiş üretilemedi: ${t.reason}`;
  const P = (x) => fmtStep(x, t.inst.tick), Q = (x) => fmtStep(x, t.inst.qtyStep), btn = t.side === 'short' ? 'Short' : 'Long', close = t.side === 'short' ? 'Long' : 'Short';
  const lastLeg = t.legs[t.legs.length - 1];
  const L = [];
  L.push(`${t.symbol} ${t.side.toUpperCase()} · ${t.plan.tf} · puan ${t.plan.score ?? '–'} · ${new Date(t.plan.sentAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · durum ${t.plan.status ?? '–'}`);
  if (t.mult > 1) L.push(`(Bybit sözleşmesi ×${t.mult}: fiyatlar çarpanlı yazıldı)`);
  L.push(`Risk ${t.riskReal.toFixed(2)} $ (hedef ${t.riskUsd} $) · stop %${t.stopPct.toFixed(2)} · değer ${t.notional.toFixed(2)} $ · kaldıraç ≤ ${t.lev}x (izole) · teminat ≈ ${t.margin.toFixed(2)} $`);
  L.push('', `A) GİRİŞ (Limit, Reduce-Only işaretsiz) → ${btn}`);
  L.push(`   Price ${P(t.lv.entry)} · Qty ${Q(t.qty)} · TP/SL: Take Profit ${P(lastLeg.price)} · Stop Loss ${P(t.lv.stop)}`);
  const pre = t.legs.slice(0, -1);
  if (pre.length) {
    L.push('', `B) DOLDUKTAN SONRA (Limit, TP/SL işaretsiz, Reduce-Only işaretli) → ${close}`);
    for (const l of pre) L.push(`   ${l.tag}: Price ${P(l.price)} · Qty ${Q(l.qty)}  (${l.R >= 0 ? '+' : ''}${l.R.toFixed(2)}R)`);
    L.push(`   Kalan ${Q(lastLeg.qty)} A'daki Take Profit ile kapanır (${lastLeg.R >= 0 ? '+' : ''}${lastLeg.R.toFixed(2)}R).`);
  }
  if (t.stopMoves.length) {
    L.push('', 'C) STOP TAŞIMA (pozisyon kartı → Set TP/SL → Entire Position)');
    for (const m of t.stopMoves) L.push(`   ${m.after} dolunca Stop Loss → ${P(m.to)}`);
  }
  if (t.warns.length) { L.push('', 'UYARI'); for (const w of t.warns) L.push(`   - ${w}`); }
  return L.join('\n');
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Güncel history.json: önce uzak daldan (bot 15 dakikada bir yazar), olmazsa yerel dosya. */
function readHistory(local) {
  if (!local) {
    try {
      const branch = execFileSync('git', ['-C', REPO, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
      execFileSync('git', ['-C', REPO, 'fetch', '-q', 'origin', branch], { stdio: 'ignore', timeout: 30000 });
      return { src: `origin/${branch}`, data: JSON.parse(execFileSync('git', ['-C', REPO, 'show', `origin/${branch}:docs/signals/history.json`], { encoding: 'utf8', maxBuffer: 64 << 20 })) };
    } catch { /* yerel dosyaya düş */ }
  }
  return { src: 'yerel dosya', data: JSON.parse(fs.readFileSync(path.join(REPO, 'docs/signals/history.json'), 'utf8')) };
}
const getJson = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); return r.ok ? await r.json() : null; } catch { return null; } };

async function main(argv) {
  const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const coin = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) || argv[0];
  if (!coin || coin.startsWith('--')) { console.log('Kullanım: node tools/trades/ticket.mjs <COIN> [--risk 0.5] [--tf 4H] [--dir short|long] [--local]'); process.exit(1); }
  const { src, data } = readHistory(argv.includes('--local'));
  const plan = latestPlan(data.items || [], coin, { tf: arg('--tf', '4H'), dir: arg('--dir') });
  if (!plan) { console.log(`Fiş üretilemedi: ${coin.toUpperCase()} için ${arg('--tf', '4H')} planı yok (${src}).`); process.exit(2); }
  const b = bybitOf(plan.coin);
  const base = 'https://api.bybit.com/v5/market';
  const [ii, tk] = await Promise.all([getJson(`${base}/instruments-info?category=linear&symbol=${b.sym}`), getJson(`${base}/tickers?category=linear&symbol=${b.sym}`)]);
  const inst = parseInstrument(ii?.result?.list?.[0], plan.coin, b.mult);
  const last = +tk?.result?.list?.[0]?.lastPrice;
  const t = ticketOf(plan, inst, { riskUsd: +arg('--risk', 0) || null, last: Number.isFinite(last) && last > 0 ? last : null });
  console.log(formatTicket(t));
  console.log(`\nKaynak: ${src} · Bybit son fiyat ${Number.isFinite(last) && last > 0 ? last : 'alınamadı'} · bu araç emir göndermez.`);
  process.exit(t.ok ? 0 : 2);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
