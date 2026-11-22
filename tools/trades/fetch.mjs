// Bybit gerçek hesap → CSV (yalnız OKUMA): Closed P&L + Order History, rtable.mjs / replay.mjs'in beklediği sütun düzeninde.
// Anahtar Mac anahtar zincirinden okunur (servis `bybit-readonly`, hesaplar `api_key` / `api_secret`; salt-okuma, IPv4 kısıtlı);
// anahtar ekrana / dosyaya yazılmaz. Emir GÖNDERMEZ: yalnız iki GET uç noktası çağrılır. Yalnız yerelde çalışır (bulut Bybit'e erişemez).
//   node --dns-result-order=ipv4first tools/trades/fetch.mjs [--from 2026-11-10] [--to 2026-11-22] [--out tools/trades] [--merge <eski orders.csv>]
// Çıktı: <out>/pnl-<bugün>.csv, <out>/orders-<bugün>.csv (klasör .gitignore'da; repo herkese açık).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = 'https://api.bybit.com', DAY = 86400e3, WINDOW = 7 * DAY; // iki uç nokta da en çok 7 günlük aralık kabul eder
export const ALLOWED = ['/v5/position/closed-pnl', '/v5/order/history']; // başka yol çağrılamaz (testle kilitli)

const hm = (ms) => { const d = new Date(+ms).toISOString(); return `${d.slice(11, 16)} ${d.slice(0, 10)}`; }; // "HH:MM YYYY-MM-DD" (UTC)
const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s ?? ''));
const num = (s) => (s === '' || s == null || +s === 0 ? '' : String(s));

/** closed-pnl satırı → rtable sütunları: Market,Qty,Entry,Exit,OpenFee,CloseFee,Funding,x,y,Type,PnL,Time. PnL net (ücret dahil).
 * Zaman = updatedTime (kapanışın gerçekleştiği an, UTC); createdTime koşullu emirde emrin verildiği andır. Fonlama API'de yok → 0. */
export function pnlRow(r) {
  const type = /bust|liq/i.test(r.execType || '') ? 'Liquidation' : (r.execType || 'Trade');
  return [r.symbol, r.closedSize ?? r.qty, r.avgEntryPrice, r.avgExitPrice, r.openFee ?? 0, r.closeFee ?? 0, 0, '', '', type, r.closedPnl, hm(r.updatedTime || r.createdTime)];
}

/** order/history satırı → Bybit "Order History" dışa aktarım sütunları (19). Yön: Buy → Long, Sell → Short. Kimlik = orderId'nin SON 8 karakteri
 * (site dışa aktarımıyla aynı); zaman = emrin verildiği an (koşullu emirde tetiklenme değil), site dışa aktarımı da böyle. */
export function orderRow(o) {
  const fee = +o.cumExecFee ? JSON.stringify({ USDT: String(o.cumExecFee) }) : '';
  const t = hm(o.createdTime);
  return [o.symbol, o.qty, o.price, +o.avgPrice ? o.avgPrice : 0, num(o.triggerPrice), o.cumExecQty, fee, o.side === 'Buy' ? 'Long' : 'Short', o.orderType, o.orderStatus,
    ` ${String(o.orderId).slice(-8)}`, t, o.timeInForce, t, '', '', 'Price', '', ''];
}

/**
 * Giriş emrine ekli stop (API `stopLoss` alanı; site dışa aktarımında YOK) → rtable'ın "ilk stop" olarak okuyacağı yapay satır:
 * ters yön, tetik = stop, durum Deactivated, zaman = giriş emrinin zamanı, kimlik "sl:" önekli. Stop sonradan taşınsa / iptal edilse de
 * plan stopu kaybolmaz. Uygun değilse (kapanış emri, dolmamış, stopsuz) null.
 */
export function slRow(o) {
  if (o.reduceOnly || o.stopOrderType || !(+o.cumExecQty > 0) || !(+o.stopLoss > 0)) return null;
  const t = hm(o.createdTime);
  return [o.symbol, o.qty, 0, 0, o.stopLoss, 0, '', o.side === 'Buy' ? 'Short' : 'Long', 'Market', 'Deactivated', ` sl:${String(o.orderId).slice(-8)}`, t, 'IOC', t, '', '', 'Price', '', ''];
}

export const PNL_HEAD = 'Market,Qty,Entry,Exit,OpenFee,CloseFee,Funding,x,y,Type,PnL,Time';
export const ORD_HEAD = 'Market,Order Quantity,Order Price,Filled Price,Trigger Price,Filled Quantity,feeInfo,Direction,Order Type,Order Status,Order ID,Order Time(UTC+0),Time In Force,Create Time,Max Slippage,Max Slippage Type,Limit Tpsl Strategy,Bbo Side Type,Bbo Level';
export const toCsv = (head, rows) => [head, ...rows.map((r) => r.map(q).join(','))].join('\n') + '\n';

/** [from, to) aralığını en çok 7 günlük pencerelere böler. */
export function windows(from, to, size = WINDOW) { const out = []; for (let a = from; a < to; a += size) out.push([a, Math.min(a + size, to) - 1]); return out; }

/** Bybit v5 GET imzası: HMAC_SHA256(secret, timestamp + apiKey + recvWindow + queryString). */
export const sign = (secret, ts, key, recv, qs) => crypto.createHmac('sha256', secret).update(`${ts}${key}${recv}${qs}`).digest('hex');

async function get(pathname, params, cred) {
  if (!ALLOWED.includes(pathname)) throw new Error(`izinli olmayan yol: ${pathname}`);
  const qs = new URLSearchParams(params).toString(), ts = Date.now(), recv = 10000;
  const res = await fetch(`${HOST}${pathname}?${qs}`, { headers: { 'X-BAPI-API-KEY': cred.key, 'X-BAPI-TIMESTAMP': String(ts), 'X-BAPI-RECV-WINDOW': String(recv), 'X-BAPI-SIGN': sign(cred.secret, ts, cred.key, recv, qs) } });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.retCode !== 0) throw new Error(`${pathname}: HTTP ${res.status} retCode ${j?.retCode} ${j?.retMsg || ''}`);
  return j.result;
}

async function all(pathname, base, from, to, cred) {
  const out = [];
  for (const [a, b] of windows(from, to)) {
    let cursor = '';
    for (let page = 0; page < 200; page++) {
      const r = await get(pathname, { ...base, startTime: a, endTime: b, ...(cursor ? { cursor } : {}) }, cred);
      out.push(...(r.list || []));
      cursor = r.nextPageCursor || '';
      if (!cursor || !(r.list || []).length) break;
      await new Promise((ok) => setTimeout(ok, 120));
    }
  }
  return out;
}

const keychain = (account) => execFileSync('security', ['find-generic-password', '-s', 'bybit-readonly', '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const to = arg('to') ? Date.parse(`${arg('to')}T00:00:00Z`) + DAY : Date.now();
  const from = Date.parse(`${arg('from', new Date(to - 30 * DAY).toISOString().slice(0, 10))}T00:00:00Z`);
  const out = arg('out', path.dirname(fileURLToPath(import.meta.url)));
  const cred = { key: keychain('api_key'), secret: keychain('api_secret') };
  const pnl = await all('/v5/position/closed-pnl', { category: 'linear', limit: 100 }, from, to, cred);
  // Varsayılan süzgeç yalnız normal emirleri verir; koşullu ve TP/SL emirleri (stopun okunduğu satırlar) ayrı süzgeçle gelir.
  const ord = [];
  for (const orderFilter of ['Order', 'StopOrder', 'tpslOrder']) ord.push(...await all('/v5/order/history', { category: 'linear', limit: 50, orderFilter }, from, to, cred));
  const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
  const P = uniq(pnl, (r) => `${r.orderId}|${r.updatedTime}|${r.closedSize}`).sort((a, b) => b.updatedTime - a.updatedTime);
  const O = uniq(ord, (o) => o.orderId).sort((a, b) => b.createdTime - a.createdTime);
  if (arg('raw')) fs.writeFileSync(arg('raw'), JSON.stringify({ pnl: P, orders: O })); // hata ayıklama: ham yanıt (kişisel veri; repo dışına yaz)
  // API iptal / devre dışı (Cancelled, Deactivated) emirleri yalnız son ≈ 2–3 gün için verir (22.11.2026'da ölçüldü: 20.11'den eskisi yok).
  // Taşınan / iptal edilen ilk stoplar bu satırlardadır → eski site dışa aktarımı --merge ile eklenir (kimliği yeni dosyada olmayan satırlar).
  let merged = [];
  if (arg('merge')) {
    const have = new Set(O.map((o) => String(o.orderId).slice(-8)));
    merged = fs.readFileSync(arg('merge'), 'utf8').trim().split('\n').slice(1).filter((l) => { const id = (l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[10] || '').trim(); return id && !have.has(id); });
  }
  const tag = new Date().toISOString().slice(0, 10);
  const fp = path.join(out, `pnl-${tag}.csv`), fo = path.join(out, `orders-${tag}.csv`);
  fs.writeFileSync(fp, toCsv(PNL_HEAD, P.map(pnlRow))); const SL = O.map(slRow).filter(Boolean);
  fs.writeFileSync(fo, toCsv(ORD_HEAD, [...SL, ...O.map(orderRow)]) + (merged.length ? merged.join('\n') + '\n' : ''));
  console.log(`aralık ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to - 1).toISOString().slice(0, 10)} · kapanış ${P.length} → ${fp} · emir ${O.length} (+ ekli stop ${SL.length})${merged.length ? ` + eski dosyadan ${merged.length}` : ''} → ${fo}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`HATA: ${e.message}`); process.exit(1); });
