// coin.html: tek coin analizi arayüzü. Veri OKX'ten (tarayıcı), analiz src/scan/coin.js, grafik src/ui/chart.js.
import { getCandles, getTopCoins, instIdOf, TIMEFRAMES } from '../data/okx.js';
import { barsFor } from '../scan/scanner.js';
import { analyzeCoin, COIN_TFS, DEFAULT_TFS, FAMILIES } from '../scan/coin.js';
import { drawRow } from './chart.js';
import { fmtPrice, esc } from './format.js';

const $ = (s) => document.querySelector(s);
// Testlerde window.__COIN_PROVIDER__ ile sahte veri verilebilir.
const provider = window.__COIN_PROVIDER__ || {
  candles: (coin, tf) => getCandles(instIdOf(coin), TIMEFRAMES[tf], barsFor(tf)),
  topCoins: (n) => getTopCoins(n),
};
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok */ } } };
const S = { tfs: new Set(store.get('coin.tfs', DEFAULT_TFS)), fams: new Set(store.get('coin.fams', FAMILIES.map((f) => f.id))), view: null, result: null, busy: false };
const clean = (s) => String(s || '').toUpperCase().replace(/USDT.*$/, '').replace(/[^A-Z0-9]/g, '').slice(0, 15);

function chip(label, pressed, onClick, small = false) {
  const b = document.createElement('button');
  b.className = 'chip' + (small ? ' small' : ''); b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(!!pressed));
  b.addEventListener('click', onClick); return b;
}
function renderControls() {
  const tfs = $('#tfs'); tfs.innerHTML = '';
  for (const tf of COIN_TFS) tfs.append(chip(tf === '1D' ? '1G' : tf, S.tfs.has(tf), () => { S.tfs.has(tf) ? S.tfs.delete(tf) : S.tfs.add(tf); if (!S.tfs.size) S.tfs.add(tf); store.set('coin.tfs', [...S.tfs]); renderControls(); }));
  const fams = $('#fams'); fams.innerHTML = '';
  const allOn = FAMILIES.every((f) => S.fams.has(f.id));
  fams.append(chip('Tümü', allOn, () => { S.fams = new Set(allOn ? ['pa'] : FAMILIES.map((f) => f.id)); store.set('coin.fams', [...S.fams]); renderControls(); }));
  for (const f of FAMILIES) fams.append(chip(f.label, S.fams.has(f.id), () => { S.fams.has(f.id) ? S.fams.delete(f.id) : S.fams.add(f.id); if (!S.fams.size) S.fams.add(f.id); store.set('coin.fams', [...S.fams]); renderControls(); }));
}
function banner(msg, err = false) { const b = $('#banner'); b.hidden = !msg; b.className = 'banner' + (err ? ' err' : ''); b.textContent = msg || ''; }

async function loadCoins() {
  try {
    const top = await provider.topCoins(150);
    $('#coins').innerHTML = top.map((c) => `<option value="${esc(c.coin)}">`).join('');
    const q = $('#quick'); q.innerHTML = '';
    for (const c of top.slice(0, 12)) q.append(chip(c.coin, false, () => { $('#coin').value = c.coin; run(); }, true));
  } catch { /* liste olmadan da elle girilebilir */ }
}

async function run() {
  const coin = clean($('#coin').value);
  if (!coin) { banner('Bir coin yaz (ör. ARB).', true); return; }
  if (S.busy) return;
  S.busy = true; $('#go').disabled = true;
  $('#coin').value = coin;
  try { history.replaceState(null, '', '#' + coin); } catch { /* yok */ }
  const tfs = COIN_TFS.filter((t) => S.tfs.has(t));
  banner(`${coin} yükleniyor: ${tfs.join(', ')}${coin !== 'BTC' ? ' + BTC' : ''}…`);
  try {
    const get = async (c) => Object.fromEntries(await Promise.all(tfs.map(async (tf) => [tf, await provider.candles(c, tf)])));
    const [perTf, btcPerTf] = await Promise.all([get(coin), coin === 'BTC' ? Promise.resolve({}) : get('BTC').catch(() => ({}))]);
    const r = analyzeCoin({ coin, perTf, btcPerTf, families: [...S.fams] });
    if (!r.tfs.length) throw new Error('Yeterli mum yok');
    S.result = r; S.view = r.tfs.includes(S.view) ? S.view : (r.tfs.includes('4H') ? '4H' : r.tfs[0]);
    banner('');
    render();
  } catch (err) {
    banner(/51001|exist|bulunamadı|Instrument/i.test(err.message) ? `${coin} OKX'te USDT perp olarak bulunamadı.` : `Veri alınamadı: ${err.message}`, true);
  } finally { S.busy = false; $('#go').disabled = false; }
}

const TR = { up: '<span class="up">↑ yükseliş</span>', down: '<span class="down">↓ düşüş</span>', flat: '<span class="flat">→ yatay</span>' };
const BIAS = { up: '<span class="up">HH/HL</span>', down: '<span class="down">LH/LL</span>', mixed: '<span class="flat">karışık</span>' };
const num = (x, d = 1) => (Number.isFinite(x) ? x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const zTxt = (z, ref) => (z ? `${fmtPrice(z.zone[0], ref)}–${fmtPrice(z.zone[1], ref)}<br><span class="flat">${z.inside ? 'içinde' : `%${num(z.distPct * 100, 1)}`} · puan ${z.score}${z.compact ? '' : ' · geniş'}</span>` : '–');

function render() {
  const r = S.result, R = r.res, ref = R[r.tfs[0]].price;
  $('#out').hidden = false;
  $('#h-coin').textContent = r.coin;
  $('#h-px').textContent = fmtPrice(ref);
  const h1 = R['1H'] || R['15m'];
  if (h1) { const all = h1.live ? [...h1.candles, h1.live] : h1.candles; const k = h1.tf === '1H' ? 24 : 96; const c0 = all[all.length - 1 - k]; const ch = c0 ? (h1.price / c0.close - 1) * 100 : null; $('#h-chg').innerHTML = ch == null ? '' : `<span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${num(ch, 2)}% · 24s</span>`; } else $('#h-chg').textContent = '';
  $('#headline').textContent = r.comment.headline;
  const rows = r.tfs.map((tf) => {
    const x = R[tf];
    return `<tr><td><b>${tf === '1D' ? '1G' : tf}</b></td><td>${TR[x.trend?.dir] || '–'}${x.trend ? ` <span class="flat">ADX ${num(x.trend.adx, 0)}</span>` : ''}</td><td>${x.bias ? BIAS[x.bias.label] : '–'}</td><td>${x.range ? `%${num(x.range.pos * 100, 0)} <span class="flat">${x.range.pos >= 0.5 ? 'premium' : 'discount'}</span>` : '–'}</td><td>${num(x.rsi, 0)}</td><td>${x.corr == null ? '–' : num(x.corr, 2)}</td><td>${x.rs ? `<span class="${x.rs.rs >= 0 ? 'up' : 'down'}">${x.rs.rs >= 0 ? '+' : ''}${num(x.rs.rs, 1)}%</span>` : '–'}</td><td>${zTxt(x.bestLong, ref)}</td><td>${zTxt(x.bestShort, ref)}</td></tr>`;
  }).join('');
  $('#tftable').innerHTML = `<thead><tr><th>Dilim</th><th>Eğilim</th><th>Yapı</th><th>Range konumu</th><th>RSI</th><th>BTC r</th><th>BTC'ye göre</th><th>En iyi long</th><th>En iyi short</th></tr></thead><tbody>${rows}</tbody>`;
  const tabs = $('#tftabs'); tabs.innerHTML = '';
  for (const tf of r.tfs) tabs.append(chip(tf === '1D' ? '1G' : tf, tf === S.view, () => { S.view = tf; render(); }));
  renderTf();
  $('#bullets').innerHTML = r.comment.bullets.map((b) => `<li>${b}</li>`).join('');
  const v = $('#verdict'); v.className = 'verdict ' + r.comment.tone; v.innerHTML = `<b>Karar notu:</b> ${r.comment.verdict}`;
}

function renderTf() {
  const x = S.result.res[S.view], ref = x.price;
  const top = x.clusters.slice(0, 4);
  const sigs = $('#allsig').checked ? x.signals : [...new Map([x.bestLong, x.bestShort].filter(Boolean).flatMap((z) => z.signals).map((s) => [s.id, s])).values()];
  requestAnimationFrame(() => drawRow($('#chart'), x.candles, x.live, sigs, ref));
  $('#clusters').innerHTML = top.length ? top.map((c) => {
    const core = c.signals[0]?.zone || c.zone;
    return `<div class="cl"><div class="t"><span class="dir ${c.direction}">${c.direction === 'long' ? 'LONG' : 'SHORT'}</span><b>${fmtPrice(core[0], ref)} – ${fmtPrice(core[1], ref)}</b><span class="flat">puan ${c.score} · ${c.signals.length} sinyal</span></div><div class="badges">${[...new Set(c.signals.map((s) => `${s.name}${s.status && s.status !== 'active' ? ` · ${s.status === 'forming' ? 'oluşuyor' : s.status}` : ''}`))].slice(0, 8).map((n) => `<span class="badge">${esc(n)}</span>`).join('')}</div></div>`;
  }).join('') : '<p class="empty">Bu dilimde seçili analizlerle küme yok.</p>';
}

$('#go').addEventListener('click', run);
$('#coin').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
$('#allsig').addEventListener('change', () => S.result && renderTf());
renderControls();
loadCoins();
const h = clean(decodeURIComponent((location.hash || '').slice(1)));
if (h) { $('#coin').value = h; run(); }
