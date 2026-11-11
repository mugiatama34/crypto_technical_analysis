// node fills.mjs <dir> <addr1,addr2,...>  → <dir>/fills/<addr>.json (son 180 gün, en fazla 10000 dolum)
import fs from 'fs';
const [dir, list] = process.argv.slice(2);
fs.mkdirSync(dir + '/fills', { recursive: true });
const post = async (b) => { for (let i = 0; i < 6; i++) { try { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(30000) }); if (r.status === 429) { await new Promise((s) => setTimeout(s, 5000 * (i + 1))); continue; } return await r.json(); } catch { await new Promise((s) => setTimeout(s, 3000)); } } return null; };
const end = Date.now(), start = end - 180 * 864e5;
for (const a of list.split(',')) {
  const f = `${dir}/fills/${a}.json`; if (fs.existsSync(f)) continue;
  let t = start, all = [];
  for (let k = 0; k < 6; k++) {
    const r = await post({ type: 'userFillsByTime', user: a, startTime: t, endTime: end, aggregateByTime: true });
    await new Promise((s) => setTimeout(s, 600));
    if (!Array.isArray(r) || !r.length) break;
    all.push(...r); if (r.length < 2000) break; t = r[r.length - 1].time + 1;
  }
  const seen = new Set(); all = all.filter((x) => { const k = x.tid ?? x.hash + x.time + x.sz; if (seen.has(k)) return false; seen.add(k); return true; });
  fs.writeFileSync(f, JSON.stringify(all)); console.log(a.slice(0, 10), all.length);
}
