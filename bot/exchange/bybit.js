// Bybit v5 DEMO istemcisi (ince; bağımlılıksız). YALNIZ api-demo.bybit.com: ana makine adı sabittir, parametreyle değiştirilemez;
// yol '/v5/...' biçiminde olmak zorunda ve kurulan URL'nin host'u her istekte yeniden denetlenir (tests/bybit-demo.test.js kilitler).
// Gerçek hesaba (api.bybit.com) emir gitmesi kod düzeyinde imkânsız: başka host'a giden istek fetch'e hiç ulaşmaz.
//
// İmza (v5 belgesi, "Integration guidance"): HMAC-SHA256, küçük harf hex; imzalanan metin
//   timestamp + apiKey + recvWindow + (GET: sorgu dizgisi | POST: JSON gövdesi)
// Başlıklar: X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW.
// Hiçbir çağrı fırlatmaz: { ok, retCode, retMsg, result, status, error } döner (retCode ≠ 0 ya da ağ hatası → ok: false).
import crypto from 'node:crypto';

export const BYBIT_DEMO_HOST = 'api-demo.bybit.com';
const BASE = `https://${BYBIT_DEMO_HOST}`;

/** İmza: HMAC-SHA256(secret, timestamp + apiKey + recvWindow + payload) → küçük harf hex. */
export function signOf(secret, { timestamp, apiKey, recvWindow, payload = '' }) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}${apiKey}${recvWindow}${payload}`).digest('hex');
}

/** Sorgu dizgisi (ekleme sırasıyla; tanımsız / null alanlar atlanır). İmzalanan dizgi ile gönderilen aynıdır. */
export function queryOf(params = {}) {
  return Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/**
 * Demo URL'si; yol '/v5/' ile başlamalı, yalnız harf/rakam/-/_ ve '/' (tekrarsız) içerebilir. Kurulan URL'nin host'u
 * BYBIT_DEMO_HOST değilse hata fırlatır (istemci bunu yakalar ve isteği göndermez).
 */
export function demoUrl(p, query = '') {
  if (typeof p !== 'string' || !/^\/v5(\/[A-Za-z0-9_-]+)+$/.test(p)) throw new Error(`geçersiz Bybit yolu: ${String(p).slice(0, 60)}`);
  const u = new URL(BASE + p + (query ? `?${query}` : ''));
  if (u.protocol !== 'https:' || u.hostname !== BYBIT_DEMO_HOST || u.port !== '' || u.username || u.password) throw new Error(`host kilidi: ${u.host}`);
  return u.toString();
}

const fail = (error, status = null) => ({ ok: false, retCode: null, retMsg: '', result: null, status, error });

/**
 * İstemci. key/secret yoksa özel uçlar { ok:false, error:'anahtar yok' } döner (genel market uçları çalışır).
 * @param {{ key?: string, secret?: string, fetchImpl?: Function, now?: () => number, recvWindow?: number, timeoutMs?: number }} o
 */
export function createBybitDemo({ key = '', secret = '', fetchImpl = globalThis.fetch, now = Date.now, recvWindow = 5000, timeoutMs = 10000 } = {}) {
  async function request(method, p, params = {}, { auth = true } = {}) {
    let url, body = null, payload;
    try {
      if (method === 'GET') { payload = queryOf(params); url = demoUrl(p, payload); }
      else { body = JSON.stringify(params); payload = body; url = demoUrl(p); }
      if (new URL(url).hostname !== BYBIT_DEMO_HOST) return fail('host kilidi'); // ikinci denetim (fetch'e ulaşmadan)
    } catch (err) { return fail(err.message); }
    if (auth && (!key || !secret)) return fail('anahtar yok');
    const headers = { 'content-type': 'application/json' };
    if (auth) {
      const timestamp = String(now());
      Object.assign(headers, { 'X-BAPI-API-KEY': key, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': String(recvWindow), 'X-BAPI-SIGN': signOf(secret, { timestamp, apiKey: key, recvWindow, payload }) });
    }
    try {
      const init = { method, headers, redirect: 'error', ...(body != null ? { body } : {}) }; // yönlendirme izlenmez (başka host'a gidemez)
      if (timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutMs);
      const res = await fetchImpl(url, init);
      const text = await res.text().catch(() => '');
      let j = null; try { j = JSON.parse(text); } catch { /* JSON değil (ör. 403 coğrafi engel sayfası) */ }
      if (!j || typeof j !== 'object') return fail(`HTTP ${res.status}${text ? ` ${text.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`, res.status);
      const retCode = Number(j.retCode);
      return { ok: res.ok !== false && retCode === 0, retCode, retMsg: j.retMsg || '', result: j.result ?? null, status: res.status, error: retCode === 0 ? null : `${retCode} ${j.retMsg || ''}`.trim() };
    } catch (err) { return fail(`${err?.name === 'TimeoutError' ? 'zaman aşımı' : err?.message || err}`); }
  }
  const lin = (o) => ({ category: 'linear', ...o });
  return {
    host: BYBIT_DEMO_HOST,
    hasKeys: !!(key && secret),
    request,
    get: (p, q, o) => request('GET', p, q, o),
    post: (p, b, o) => request('POST', p, b, o),
    // Genel (imzasız) uçlar
    instrument: (symbol) => request('GET', '/v5/market/instruments-info', lin({ symbol }), { auth: false }),
    ticker: (symbol) => request('GET', '/v5/market/tickers', lin({ symbol }), { auth: false }),
    // Özel uçlar
    positions: (q = { settleCoin: 'USDT' }) => request('GET', '/v5/position/list', lin({ limit: 200, ...q })),
    openOrders: (q = { settleCoin: 'USDT' }) => request('GET', '/v5/order/realtime', lin({ limit: 50, ...q })),
    orderByLink: (orderLinkId) => request('GET', '/v5/order/realtime', lin({ orderLinkId })),
    orderHistoryByLink: (orderLinkId) => request('GET', '/v5/order/history', lin({ orderLinkId })),
    closedPnl: (symbol, startTime) => request('GET', '/v5/position/closed-pnl', lin({ symbol, startTime, limit: 50 })),
    createOrder: (o) => request('POST', '/v5/order/create', lin(o)),
    cancelOrder: (symbol, orderLinkId) => request('POST', '/v5/order/cancel', lin({ symbol, orderLinkId })),
    setTradingStop: (o) => request('POST', '/v5/position/trading-stop', lin({ tpslMode: 'Full', positionIdx: 0, ...o })),
    setLeverage: (symbol, lev) => request('POST', '/v5/position/set-leverage', lin({ symbol, buyLeverage: String(lev), sellLeverage: String(lev) })),
  };
}
