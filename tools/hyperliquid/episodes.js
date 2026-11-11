// Hyperliquid dolumlarından pozisyon (düz → düz) çıkarımı. Yön değiştiren dolum (Long > Short) bölünür;
// pencereden önce açılmış pozisyon atlanır; spot (@n, X/Y) ve Settlement dolumları alınmaz.
export function episodes(fills) {
  fills = fills.filter((f) => !f.coin.startsWith('@') && !f.coin.includes('/') && /Long|Short/.test(f.dir) && f.dir !== 'Settlement').sort((a, b) => a.time - b.time);
  const open = {}, eps = [];
  for (const f of fills) {
    const s = (f.side === 'B' ? 1 : -1) * +f.sz, p0 = +f.startPosition, p1 = p0 + s, px = +f.px, fee = +f.fee, cp = +f.closedPnl;
    let e = open[f.coin];
    if (!e && Math.abs(p0) > 1e-12) continue; // pencereden önce açılmış
    const flip = Math.abs(p0) > 1e-12 && Math.abs(p1) > 1e-12 && Math.sign(p0) !== Math.sign(p1);
    if (!e) { e = open[f.coin] = { coin: f.coin, d: Math.sign(p1), t0: f.time, pnl: 0, fee: 0, maxN: 0, inQ: 0, inV: 0, fills: 0, adds: 0, taker: 0, liq: false }; }
    const closeFrac = flip ? Math.abs(p0) / Math.abs(s) : 1;
    e.fills++; e.pnl += cp; e.fee += fee * closeFrac; if (f.crossed) e.taker++; if (/^Liquidated/.test(f.dir)) e.liq = true;
    if (!flip && Math.abs(p1) > Math.abs(p0)) { e.inQ += Math.abs(s); e.inV += Math.abs(s) * px; if (e.fills > 1) e.adds++; }
    e.maxN = Math.max(e.maxN, Math.abs(flip ? p0 : p1) * px);
    if (Math.abs(p1) < 1e-12 || flip) {
      e.t1 = f.time; e.net = e.pnl - e.fee; e.entry = e.inV / e.inQ; eps.push(e); delete open[f.coin];
      if (flip) open[f.coin] = { coin: f.coin, d: Math.sign(p1), t0: f.time, pnl: 0, fee: fee * (1 - closeFrac), maxN: Math.abs(p1) * px, inQ: Math.abs(p1), inV: Math.abs(p1) * px, fills: 1, adds: 0, taker: f.crossed ? 1 : 0, liq: false };
    }
  }
  return eps;
}
