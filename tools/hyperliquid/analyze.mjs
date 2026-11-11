// node analyze.mjs <dir> → <dir>/metrics.json ; dolumlardan pozisyon (düz→düz) çıkarır, metrikler
import fs from 'fs';
import { episodes } from './episodes.js';
const dir = process.argv[2]; // NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=... ile çalıştır (bulut proxy)
const port = JSON.parse(fs.readFileSync(dir + '/portfolio.json'));
const post = async (b) => { for (let i = 0; i < 6; i++) { try { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(30000) }); if (r.status === 429) { await new Promise((s) => setTimeout(s, 5000 * (i + 1))); continue; } return await r.json(); } catch { await new Promise((s) => setTimeout(s, 3000)); } } return null; };
fs.mkdirSync(dir + '/candles', { recursive: true });
const candleCache = {};
async function candles(coin, iv) {
  const k = coin + '_' + iv; if (candleCache[k]) return candleCache[k];
  const f = `${dir}/candles/${k.replace(/[^\w]/g, '_')}.json`;
  if (fs.existsSync(f)) return (candleCache[k] = JSON.parse(fs.readFileSync(f)));
  const end = Date.now(), start = end - (iv === '1d' ? 260 : 200) * 864e5;
  const r = await post({ type: 'candleSnapshot', req: { coin, interval: iv, startTime: start, endTime: end } });
  await new Promise((s) => setTimeout(s, 300));
  const c = Array.isArray(r) ? r.map((x) => ({ t: x.t, T: x.T, o: +x.o, h: +x.h, l: +x.l, c: +x.c })) : [];
  fs.writeFileSync(f, JSON.stringify(c)); return (candleCache[k] = c);
}
const ema = (arr, n) => { const k = 2 / (n + 1); let e = null; return arr.map((v) => (e = e == null ? v : v * k + e * (1 - k))); };
function ctxAt(c, t) { // son kapanmış mum indeksi
  let lo = 0, hi = c.length - 1, idx = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].T < t) { idx = m; lo = m + 1; } else hi = m - 1; } return idx;
}
const prep = (c) => { if (c._p) return c; const cl = c.map((x) => x.c); c._e20 = ema(cl, 20); c._e50 = ema(cl, 50); c._p = 1; return c; };
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sum = (a) => a.reduce((s, x) => s + x, 0);
const avAt = (av, t) => { let v = null; for (const [ts, x] of av) { if (ts <= t) v = +x; else break; } return v; };
const out = [];
const btc = prep(await candles('BTC', '1d'));
for (const fn of fs.readdirSync(dir + '/fills')) {
  const a = fn.replace('.json', ''); const fills = JSON.parse(fs.readFileSync(`${dir}/fills/${fn}`));
  if (fills.length < 50) continue;
  const eps = episodes(fills); if (eps.length < 30) continue;
  const av = (port[a]?.av || []).map(([t, v]) => [t, +v]);
  for (const e of eps) {
    e.hold = (e.t1 - e.t0) / 36e5; const A = avAt(av, e.t0); e.lev = A > 0 ? e.maxN / A : null;
    const bi = ctxAt(btc, e.t0); e.btcUp = bi >= 20 ? btc[bi].c > btc._e20[bi] : null; e.withBtc = e.btcUp == null ? null : (e.btcUp ? 1 : -1) === e.d;
  }
  // giriş sınıfı (4H) — en çok işlem yapılan 15 coin için mum çek
  const coins = Object.entries(eps.reduce((m, e) => ((m[e.coin] = (m[e.coin] || 0) + 1), m), {})).sort((x, y) => y[1] - x[1]);
  for (const [coin] of coins.slice(0, 15)) {
    const c = prep(await candles(coin, '4h')); if (c.length < 60) continue;
    for (const e of eps.filter((e) => e.coin === coin)) {
      const i = ctxAt(c, e.t0); if (i < 55) continue;
      const hh = Math.max(...c.slice(i - 19, i + 1).map((x) => x.h)), ll = Math.min(...c.slice(i - 19, i + 1).map((x) => x.l));
      const up = c[i].c > c._e50[i], px = e.entry;
      if (e.d > 0) e.cls = px > hh ? 'kırılım' : !up ? 'ters' : px <= c._e20[i] ? 'geri çekilme' : 'trend';
      else e.cls = px < ll ? 'kırılım' : up ? 'ters' : px >= c._e20[i] ? 'geri çekilme' : 'trend';
    }
  }
  const W = eps.filter((e) => e.net > 0), L = eps.filter((e) => e.net <= 0);
  const unit = sum(L.map((e) => -e.net)) / L.length || 1; // "R" vekili: ortalama kayıp
  const tot = sum(eps.map((e) => e.net)); const sorted = [...eps].sort((x, y) => y.net - x.net);
  const days = (Math.max(...eps.map((e) => e.t1)) - Math.min(...eps.map((e) => e.t0))) / 864e5;
  const grp = (f) => { const g = eps.filter(f); return { n: g.length, R: g.length ? sum(g.map((e) => e.net)) / unit / g.length : null, win: g.length ? g.filter((e) => e.net > 0).length / g.length : null }; };
  const avNow = av.length ? av[av.length - 1][1] : null;
  out.push({
    a, fills: fills.length, capped: fills.length >= 9990, n: eps.length, perWeek: eps.length / (days / 7), days,
    tot, avNow, win: W.length / eps.length, payoff: sum(W.map((e) => e.net)) / W.length / (sum(L.map((e) => -e.net)) / L.length),
    pf: sum(W.map((e) => e.net)) / sum(L.map((e) => -e.net)), avgR: tot / unit / eps.length,
    lossP90: q(L.map((e) => -e.net), 0.9) / unit, lossMax: Math.max(...L.map((e) => -e.net)) / unit, winMed: med(W.map((e) => e.net)) / unit,
    top1: sorted[0].net / tot, exTop3: tot - sum(sorted.slice(0, 3).map((e) => e.net)),
    holdW: med(W.map((e) => e.hold)), holdL: med(L.map((e) => e.hold)), hold: med(eps.map((e) => e.hold)),
    levMed: med(eps.map((e) => e.lev).filter((x) => x != null)), levP90: q(eps.map((e) => e.lev).filter((x) => x != null), 0.9),
    nMed: med(eps.map((e) => e.maxN)), nP90: q(eps.map((e) => e.maxN), 0.9), nP10: q(eps.map((e) => e.maxN), 0.1),
    long: grp((e) => e.d > 0), short: grp((e) => e.d < 0), withBtc: grp((e) => e.withBtc === true), vsBtc: grp((e) => e.withBtc === false),
    cls: Object.fromEntries(['trend', 'geri çekilme', 'kırılım', 'ters'].map((k) => [k, grp((e) => e.cls === k)])),
    hold1: grp((e) => e.hold < 1), hold6: grp((e) => e.hold >= 1 && e.hold < 6), hold24: grp((e) => e.hold >= 6 && e.hold < 24), holdD: grp((e) => e.hold >= 24),
    liq: eps.filter((e) => e.liq).length, hip3: eps.filter((e) => e.coin.includes(':')).length / eps.length, feeShare: sum(eps.map((e) => e.fee)) / sum(eps.map((e) => Math.abs(e.pnl))), lossMed: med(L.map((e) => -e.net)) / unit, btcEth: eps.filter((e) => ['BTC', 'ETH'].includes(e.coin)).length / eps.length, coins: coins.length,
    adds: eps.filter((e) => e.adds > 0).length / eps.length, taker: sum(eps.map((e) => e.taker)) / sum(eps.map((e) => e.fills)),
  });
  console.log(a.slice(0, 10), eps.length);
}
fs.writeFileSync(dir + '/metrics.json', JSON.stringify(out, null, 1));
