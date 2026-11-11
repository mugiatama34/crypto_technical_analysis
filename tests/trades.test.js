import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClosedPnl, parseTime, dailyTrades } from '../src/trades/bybit.js';

test('parseTime: farklı biçimler', () => {
  const t = Date.UTC(2026, 10, 10, 18, 32);
  assert.equal(parseTime('18:32 2026-11-10'), t); assert.equal(parseTime('2026-11-10 18:32:00'), t); assert.equal(parseTime('10-11-2026 18:32'), t);
});
test('parseClosedPnl: başlıktan sütun bulur, günlük $ ve R toplar', () => {
  const csv = 'Contracts,Qty,Entry Price,Exit Price,Opening Fee,Closing Fee,Funding Fee,Closing Direction,Leverage,Trade Type,Closed P&L,Trade Time(UTC+0)\n'
    + 'SANDUSDT,100,0.2,0.21,0.01,0.01,0,Long,10,Trade,"1.50",10:00 2026-11-10\n'
    + 'BCHUSDT,1,500,505,0.1,0.1,0,Short,5,Liquidation,-2.25,23:59 2026-11-10\n'
    + 'FILUSDT,10,2,2.1,0,0,0,Long,5,Trade,0.5,00:10 2026-11-11\n';
  const r = parseClosedPnl(csv);
  assert.equal(r.length, 3); assert.equal(r[0].sym, 'SAND'); assert.equal(r[0].pnl, 1.5); assert.ok(r[1].liq);
  const d = dailyTrades(r, 0.5);
  assert.equal(d['2026-11-10'].usd, -0.75); assert.equal(d['2026-11-10'].R, -1.5); assert.equal(d['2026-11-10'].n, 2); assert.equal(d['2026-11-11'].win, 1);
});
