// Sayfa mantığı: araç çubuğu, tarama, sonuç listesi, ayrıntı paneli (grafik + sinyaller), screenshot paneli.
import { runScan, compareByScore, okxProvider, barsFor } from '../scan/scanner.js';
import { checklistOf } from '../scan/checklist.js';
import { makeContext } from '../scan/context.js';
import { runDetectors } from '../scan/registry.js';
import { UP_TF } from '../scan/regime.js';
import { buildPlan } from '../../bot/plan.js';
import { makeWatch, updateWatch, watchR, isOpen, loadWatch, saveWatch, mergeImport, WATCH_LABEL } from '../watch/watch.js';
import { DETECTORS, GROUPS } from '../scan/registry.js';
import { PRESETS, PRESET_MAP } from '../scan/presets.js';
import { TF_ORDER, TIMEFRAMES } from '../data/okx.js';
import { fixtureProvider } from '../data/fixture.js';
import { loadSettings, saveSettings, effectiveDetectors, UI_DEFAULTS } from './settings.js';
import { renderSettingsPanel, EW_UI_DEFAULTS } from './settingsPanel.js';
import { drawRow, destroyChart } from './chart.js';
import { analyzeScreenshot } from './screenshot.js';
import { fmtPrice, fmtTime, esc } from './format.js';

const $ = (s) => document.querySelector(s);
const PAGE = 40;
const FIXTURE = new URLSearchParams(location.search).get('fixture') === '1';

const state = {
  settings: loadSettings(),
  scan: null, rows: [], selected: null, busy: false, abort: null, page: 0,
  cache: new Map(), hiddenSignals: new Set(), showAllSignals: false,
  watch: loadWatch(),
};

// ------------------------------------------------------------------ araç çubuğu
function renderToolbar() {
  const s = state.settings;
  $('#tfChips').innerHTML = TF_ORDER.map((tf) => `<button type="button" class="chip" data-tf="${tf}" aria-pressed="${s.timeframes.includes(tf)}">${tf}</button>`).join('');
  $('#universe').value = s.universe;
  $('#manualCoins').value = s.manualCoins;
  $('#manualField').hidden = s.universe !== 'manual';
  $('#preset').innerHTML = [...PRESETS.map((p) => `<option value="${p.id}" title="${esc(p.desc)}">${esc(p.name)}</option>`), '<option value="custom">Özel</option>'].join('');
  $('#preset').value = s.preset;
  $('#dirFilter').value = s.dirFilter;
  $('#minScore').value = s.minScore;
  $('#sortBy').value = s.sortBy;
  $('#apiKey').value = s.apiKey || '';
  renderDetectors();
  renderSettings();
}

function renderSettings() {
  renderSettingsPanel($('#settings'), state.settings.ew, (patch) => {
    update({ ew: patch ? { ...state.settings.ew, ...patch } : { ...EW_UI_DEFAULTS } });
    if (!patch) renderSettings();
  });
}

function renderDetectors() {
  const { ids, weights } = effectiveDetectors(state.settings);
  $('#detGrid').innerHTML = DETECTORS.map((d) => `
    <label class="det">
      <input type="checkbox" data-det="${d.id}" ${ids.includes(d.id) ? 'checked' : ''}>
      <div><div class="lbl"><i class="gdot" style="background:${GROUPS[d.group].color}"></i>${esc(d.label)}</div><div class="desc">${esc(d.desc)}</div></div>
      <input class="w" type="number" step="0.1" min="0" max="3" data-w="${d.id}" value="${(weights[d.id] ?? d.weight).toFixed(1)}" aria-label="${esc(d.label)} ağırlığı">
    </label>`).join('');
}

function update(patch) {
  state.settings = { ...state.settings, ...patch };
  saveSettings(state.settings);
}

function customize() {
  // Detektör panelinden elle değişiklik → preset 'custom'
  const ids = [...document.querySelectorAll('[data-det]')].filter((x) => x.checked).map((x) => x.dataset.det);
  const weights = {};
  for (const w of document.querySelectorAll('[data-w]')) weights[w.dataset.w] = +w.value || 0;
  update({ preset: 'custom', detectors: ids, weights });
  $('#preset').value = 'custom';
}

function bindToolbar() {
  $('#tfChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]'); if (!b) return;
    const tfs = new Set(state.settings.timeframes);
    if (tfs.has(b.dataset.tf)) { if (tfs.size > 1) tfs.delete(b.dataset.tf); } else tfs.add(b.dataset.tf);
    update({ timeframes: TF_ORDER.filter((t) => tfs.has(t)) });
    renderToolbar();
  });
  $('#universe').addEventListener('change', (e) => { update({ universe: e.target.value }); $('#manualField').hidden = e.target.value !== 'manual'; });
  $('#manualCoins').addEventListener('change', (e) => update({ manualCoins: e.target.value }));
  $('#preset').addEventListener('change', (e) => { update({ preset: e.target.value, detectors: null, weights: {} }); if (e.target.value !== 'custom') { const p = PRESET_MAP[e.target.value]; if (p) { update({ minScore: p.minScore }); $('#minScore').value = p.minScore; } } renderDetectors(); });
  $('#detGrid').addEventListener('change', customize);
  $('#dirFilter').addEventListener('change', (e) => { update({ dirFilter: e.target.value }); renderRows(); });
  $('#minScore').addEventListener('change', (e) => { update({ minScore: +e.target.value || 0 }); renderRows(); });
  $('#sortBy').addEventListener('change', (e) => { update({ sortBy: e.target.value }); renderRows(); });
  $('#search').addEventListener('input', () => { state.page = 0; renderRows(); });
  $('#scanBtn').addEventListener('click', scan);
  $('#cancelBtn').addEventListener('click', () => state.abort?.abort());
  $('#prevPage').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); renderRows(); });
  $('#nextPage').addEventListener('click', () => { state.page++; renderRows(); });
  $('#apiKey').addEventListener('change', (e) => update({ apiKey: e.target.value.trim() }));
}

// ------------------------------------------------------------------ tarama
function banner(msg, kind = '') {
  const el = $('#banner');
  el.hidden = !msg; el.className = `banner ${kind}`; el.textContent = msg || '';
}

async function scan() {
  if (state.busy) return;
  const s = state.settings;
  const { ids, weights, detectorOpts } = effectiveDetectors(s);
  const manual = s.universe === 'manual' ? s.manualCoins.split(/[\s,;]+/).filter(Boolean) : null;
  if (s.universe === 'manual' && !manual?.length) { banner('Elle liste boş: en az bir sembol yaz (örn. BTC, ETH).', 'err'); return; }
  state.busy = true; state.abort = new AbortController(); state.rows = []; state.selected = null;
  $('#scanBtn').disabled = true; $('#cancelBtn').hidden = false; $('#progress').hidden = false;
  banner('');
  $('#rows').innerHTML = '<p class="empty">Taranıyor…</p>';
  const t0 = Date.now();
  let retries = 0;
  try {
    const res = await runScan(
      { timeframes: s.timeframes, topN: s.universe === 'manual' ? 0 : +s.universe, manualCoins: manual, detectors: ids, weights, detectorOpts },
      {
        signal: state.abort.signal, cache: state.cache,
        provider: FIXTURE ? fixtureProvider : undefined,
        onProgress: ({ done, total, symbol, tf }) => {
          $('#progressBar').style.width = `${total ? (100 * done) / total : 0}%`;
          $('#progressText').textContent = `${done}/${total}${symbol ? ` · ${symbol} ${tf}` : ''}`;
        },
        onRetry: () => { retries++; },
        onResult: (row) => { state.rows.push(row); if (state.rows.length % 10 === 0) renderRows(); },
      },
    );
    state.scan = res; state.rows = res.rows;
    const errs = res.rows.filter((r) => r.error);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    $('#summary').innerHTML = [
      `<span class="pill">Taranan <b>${res.coins.length}</b> sembol × <b>${res.tfs.length}</b> TF</span>`,
      `<span class="pill">Süre <b>${secs} sn</b></span>`,
      `<span class="pill">Sinyal <b>${res.rows.reduce((n, r) => n + r.signals.length, 0)}</b></span>`,
      `<span class="pill">MTF uyumu <b>${new Set(res.rows.filter((r) => r.mtf?.tfs?.length > 1).map((r) => r.coin)).size}</b> sembol</span>`,
      errs.length ? `<span class="pill" style="color:var(--warning)">Hata <b>${errs.length}</b> (${esc(errs[0].error)})</span>` : '',
      retries ? `<span class="pill">Yeniden deneme <b>${retries}</b></span>` : '',
      `<span class="pill">${fmtTime(res.at)}</span>`,
      FIXTURE ? '<span class="pill" style="color:var(--warning)">FIXTURE verisi</span>' : '',
    ].join('');
    if (res.errors.length) console.warn('Detektör hataları', res.errors);
    if (errs.length === res.rows.length && res.rows.length) banner(`Hiç veri alınamadı: ${errs[0].error}. OKX'e erişim (CORS / bölge / internet) olmayabilir.`, 'err');
  } catch (err) {
    if (err.name === 'AbortError') banner('Tarama iptal edildi; alınan sonuçlar listelendi.');
    else { banner(`Tarama hatası: ${err.message}`, 'err'); console.error(err); }
  } finally {
    state.busy = false; state.abort = null;
    $('#scanBtn').disabled = false; $('#cancelBtn').hidden = true; $('#progress').hidden = true;
    refreshWatch();
    state.page = 0;
    renderRows();
  }
}

// ------------------------------------------------------------------ sonuç listesi
function filteredRows() {
  const s = state.settings;
  const q = $('#search').value.trim().toLowerCase();
  let rows = state.rows.filter((r) => !r.error && r.best);
  rows = rows.filter((r) => r.score >= s.minScore); // kartta görünen küme puanı (MTF puanı süzmeyi aşmaz)
  if (s.dirFilter !== 'all') rows = rows.filter((r) => r.direction === s.dirFilter);
  if (q) rows = rows.filter((r) => r.coin.toLowerCase().includes(q) || r.best.signals.some((x) => x.name.toLowerCase().includes(q)));
  const cmp = {
    score: compareByScore,
    mtf: (a, b) => ((b.mtf?.direction === b.direction ? b.mtf.score : 0) - (a.mtf?.direction === a.direction ? a.mtf.score : 0)) || compareByScore(a, b),
    signals: (a, b) => (b.best.signals.length - a.best.signals.length) || compareByScore(a, b),
    symbol: (a, b) => a.coin.localeCompare(b.coin) || TIMEFRAMES[a.tf].rank - TIMEFRAMES[b.tf].rank,
  }[s.sortBy] || compareByScore;
  return [...rows].sort(cmp);
}

const scoreClass = (x) => (x >= 60 ? 'hi' : x >= 40 ? 'mid' : 'lo');
const rowKey = (r) => `${r.coin}|${r.tf}`;

function badge(sig) {
  const g = GROUPS[sig.group] || GROUPS.indicator;
  return `<span class="badge ${sig.status === 'forming' || sig.status === 'mitigated' ? 'dim' : ''}" title="${esc(sig.note || '')}"><i style="background:${g.color}"></i>${esc(sig.name)}</span>`;
}

function renderRows() {
  const rows = filteredRows();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const slice = rows.slice(state.page * PAGE, (state.page + 1) * PAGE);
  $('#listTitle').textContent = `Sonuçlar (${total})`;
  if (!state.rows.length) { $('#rows').innerHTML = `<p class="empty">${state.busy ? 'Taranıyor…' : 'Henüz tarama yok.'}</p>`; $('#pager').hidden = true; return; }
  if (!total) { $('#rows').innerHTML = '<p class="empty">Filtreye uyan sonuç yok. Min puanı düşür ya da yön filtresini kaldır.</p>'; $('#pager').hidden = true; return; }
  $('#rows').innerHTML = slice.map((r) => {
    const b = r.best;
    const mtf = r.mtf && r.mtf.direction === r.direction && r.mtf.tfs.length > 1 ? `<span class="mtf" title="Aynı yön: ${r.mtf.tfs.join(', ')}${r.mtf.conflicting.length ? ` · çelişen: ${r.mtf.conflicting.join(', ')}` : ''}">MTF ${r.mtf.tfs.join('+')} · ${r.mtf.score}</span>` : '';
    const inv = b.signals.map((x) => x.invalidation).filter(Number.isFinite);
    const tgt = b.signals.map((x) => x.target).filter(Number.isFinite);
    const invP = inv.length ? (r.direction === 'long' ? Math.min(...inv) : Math.max(...inv)) : null;
    const tgtP = tgt.length ? (r.direction === 'long' ? Math.min(...tgt.filter((t) => t > r.price)) : Math.max(...tgt.filter((t) => t < r.price))) : null;
    const rs = r.trend?.rsBtc != null ? `<span class="mtf rs ${r.trend.rsSide > 0 ? 'rs-up' : 'rs-down'}" title="BTC'ye göre göreli güç: coin/BTC oranının son 20 bardaki değişimi; ${r.trend.rsSide > 0 ? 'oran EMA50 üstünde (güçlü)' : 'oran EMA50 altında (zayıf)'}">vs BTC ${r.trend.rsBtc > 0 ? '+' : ''}${r.trend.rsBtc}%</span>` : '';
    return `<article class="row ${state.selected === rowKey(r) ? 'sel' : ''}" data-key="${rowKey(r)}" tabindex="0">
      <div class="row-top"><span class="row-sym">${esc(r.coin)}</span><span class="row-tf">${r.tf}</span><span class="dir ${r.direction}">${r.direction.toUpperCase()}</span>${mtf}${rs}<span class="score ${scoreClass(r.score)}">${r.score}</span></div>
      <div class="badges">${b.signals.slice(0, 8).map(badge).join('')}${b.signals.length > 8 ? `<span class="badge dim">+${b.signals.length - 8}</span>` : ''}</div>
      <div class="row-grid">
        <div><span>Fiyat</span> <b>${fmtPrice(r.price)}</b></div>
        <div><span>Bölge</span> <b>${fmtPrice(b.zone[0], r.price)} – ${fmtPrice(b.zone[1], r.price)}</b></div>
        <div><span>Geçersiz</span> <b>${invP != null && Number.isFinite(invP) ? fmtPrice(invP, r.price) : '–'}</b></div>
        <div><span>Hedef</span> <b>${tgtP != null && Number.isFinite(tgtP) ? fmtPrice(tgtP, r.price) : '–'}</b></div>
      </div>
    </article>`;
  }).join('');
  $('#pager').hidden = pages <= 1;
  $('#pageInfo').textContent = `${state.page + 1} / ${pages}`;
  $('#prevPage').disabled = state.page === 0; $('#nextPage').disabled = state.page >= pages - 1;
}

function bindRows() {
  const pick = (el) => { const r = state.rows.find((x) => rowKey(x) === el.dataset.key); if (r) select(r); };
  $('#rows').addEventListener('click', (e) => { const el = e.target.closest('.row'); if (el) pick(el); });
  $('#rows').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const el = e.target.closest('.row'); if (el) { e.preventDefault(); pick(el); } } });
}

// ------------------------------------------------------------------ ayrıntı
function select(r) {
  state.selected = rowKey(r); state.hiddenSignals = new Set();
  for (const el of document.querySelectorAll('.row')) el.classList.toggle('sel', el.dataset.key === state.selected);
  renderDetail(r);
  if (window.innerWidth < 1100) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDetail(r) {
  const b = r.best;
  const shown = (state.showAllSignals ? r.signals : b.signals).filter((s) => !state.hiddenSignals.has(s.id));
  const others = r.clusters.slice(1).filter((c) => c.score >= state.settings.minScore).sort((a, b) => b.score - a.score).slice(0, 3);
  const tv = `https://www.tradingview.com/chart/?symbol=OKX:${encodeURIComponent(r.coin + 'USDT.P')}`;
  const stats = [
    ['Fiyat', fmtPrice(r.price)], ['ATR', fmtPrice(r.atr, r.price)], ['Küme puanı', `${r.score}`],
    ['MTF', r.mtf ? `${r.mtf.direction === r.direction ? r.mtf.tfs.join('+') : 'çelişkili'} · ${r.mtf.score}` : '–'],
    ['vs BTC (20 bar)', r.trend?.rsBtc != null ? `${r.trend.rsBtc > 0 ? '+' : ''}${r.trend.rsBtc}% · ${r.trend.rsSide > 0 ? 'güçlü' : 'zayıf'}` : '–'],
  ];
  $('#detail').innerHTML = `
    <div class="detail-head"><h3>${esc(r.coin)} <small class="row-tf">${r.tf}</small></h3><span class="dir ${r.direction}">${r.direction.toUpperCase()}</span>
      <button type="button" class="btn" id="watchBtn" title="Giriş / stop / hedefleri dondur ve sonraki mumlarla izle">${state.watch.some((w) => w.coin === r.coin && w.tf === r.tf && w.direction === r.direction && isOpen(w)) ? '★ Takipte' : '☆ Takibe al'}</button>
      <a class="btn" href="${tv}" target="_blank" rel="noopener">TradingView ↗</a>
      <label class="chip small" style="margin-left:auto"><input type="checkbox" id="showAll" ${state.showAllSignals ? 'checked' : ''}> tüm sinyaller</label></div>
    <div class="chart" id="chart"></div>
    <div class="legend">${[...new Set(shown.map((s) => s.group))].map((g) => `<span><i style="background:${GROUPS[g].color}"></i>${esc(GROUPS[g].label)}</span>`).join('')}</div>
    <div class="stat-strip">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
    <div id="checklist" class="checklist"><p class="note">Check list hesaplanıyor…</p></div>
    <h2>${state.showAllSignals ? `Tüm sinyaller (${r.signals.length})` : `En iyi küme (${b.signals.length} sinyal, bölge ${fmtPrice(b.zone[0], r.price)} – ${fmtPrice(b.zone[1], r.price)})`}</h2>
    <div class="sig-list">${(state.showAllSignals ? r.signals : b.signals).map((s) => sigCard(s, r)).join('')}</div>
    ${others.length ? `<h2 style="margin-top:12px">Diğer kümeler</h2><div class="sig-list">${others.map((c) => `<div class="sig"><div class="sig-head"><span class="dir ${c.direction}">${c.direction.toUpperCase()}</span><span class="sig-name">Puan ${c.score}</span><span class="sig-str">${fmtPrice(c.zone[0], r.price)} – ${fmtPrice(c.zone[1], r.price)}</span></div><div class="sig-note">${c.signals.map((s) => esc(s.name)).join(' · ')}</div></div>`).join('')}</div>` : ''}
  `;
  drawRow($('#chart'), r.candles, r.live, shown, r.price);
  $('#showAll').addEventListener('change', (e) => { state.showAllSignals = e.target.checked; renderDetail(r); });
  $('#watchBtn').addEventListener('click', () => addWatch(r));
  checklistFor(r).then((cl) => { if (state.selected === rowKey(r)) renderChecklist(cl); });
  $('#detail').querySelectorAll('[data-sig]').forEach((cb) => cb.addEventListener('change', (e) => {
    if (e.target.checked) state.hiddenSignals.delete(e.target.dataset.sig); else state.hiddenSignals.add(e.target.dataset.sig);
    const show = (state.showAllSignals ? r.signals : b.signals).filter((s) => !state.hiddenSignals.has(s.id));
    drawRow($('#chart'), r.candles, r.live, show, r.price);
    e.target.closest('.sig').classList.toggle('off', !e.target.checked);
  }));
}

function sigCard(s, r) {
  const g = GROUPS[s.group] || GROUPS.indicator;
  const lv = [
    s.zone ? `bölge ${fmtPrice(s.zone[0], r.price)}–${fmtPrice(s.zone[1], r.price)}` : '',
    Number.isFinite(s.entry) ? `giriş ${fmtPrice(s.entry, r.price)}` : '',
    Number.isFinite(s.stop) ? `stop ${fmtPrice(s.stop, r.price)}` : '',
    Number.isFinite(s.invalidation) ? `geçersiz ${fmtPrice(s.invalidation, r.price)}` : '',
    Number.isFinite(s.target) ? `hedef ${fmtPrice(s.target, r.price)}` : '',
    s.index != null && r.candles[s.index] ? fmtTime(r.candles[s.index].time) : '',
  ].filter(Boolean).join(' · ');
  const st = { active: 'aktif', forming: 'oluşuyor', triggered: 'tetiklendi', mitigated: 'dokunulmuş', done: 'eski', invalid: 'geçersiz' }[s.status] || s.status;
  return `<div class="sig ${state.hiddenSignals.has(s.id) ? 'off' : ''}">
    <div class="sig-head"><label><input type="checkbox" data-sig="${esc(s.id)}" ${state.hiddenSignals.has(s.id) ? '' : 'checked'}> <i class="gdot" style="background:${g.color}"></i><span class="sig-name">${esc(s.name)}</span></label>
      <span class="dir ${s.direction}">${s.direction === 'neutral' ? 'NÖTR' : s.direction.toUpperCase()}</span><span class="badge dim">${st}</span><span class="sig-str">güç ${(s.strength * 100).toFixed(0)}</span></div>
    ${s.note ? `<div class="sig-note">${esc(s.note)}</div>` : ''}
    ${lv ? `<div class="sig-lv">${esc(lv)}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ screenshot
function bindScreenshot() {
  const drop = $('#drop'), file = $('#file'), out = $('#ssOut'), btn = $('#ssBtn');
  let blob = null, abort = null;
  const setImage = (b) => {
    if (!b || !b.type.startsWith('image/')) return;
    blob = b;
    const url = URL.createObjectURL(b);
    drop.innerHTML = `<img src="${url}" alt="Yüklenen grafik"><span>Başka görsel için tıkla / yapıştır</span>`;
    btn.disabled = false;
  };
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => setImage(file.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); setImage(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
    if (it) { setImage(it.getAsFile()); $('#screenshot').scrollIntoView({ behavior: 'smooth' }); }
  });
  btn.addEventListener('click', async () => {
    if (abort) { abort.abort(); return; }
    const apiKey = $('#apiKey').value.trim();
    update({ apiKey });
    if (!apiKey) { out.hidden = false; out.textContent = 'API anahtarı gerekli. Anahtar yoksa görseli Claude sohbetine yapıştırabilirsin.'; return; }
    if (!blob) return;
    abort = new AbortController(); btn.textContent = 'Durdur'; out.hidden = false; out.textContent = 'Yorumlanıyor…';
    try {
      await analyzeScreenshot({ apiKey, blob, focus: $('#ssFocus').value, question: $('#ssQuestion').value.trim(), signal: abort.signal, onText: (t) => { out.textContent = t; } });
    } catch (err) {
      out.textContent = err.name === 'AbortError' ? `${out.textContent}\n\n[Durduruldu]` : `Hata: ${err.message}`;
    } finally { abort = null; btn.textContent = 'Yorumla'; }
  });
}

// ------------------------------------------------------------------ check list
/** Mumlar (tarama önbelleği tazeyse ondan, değilse indir). */
async function candlesOf(instId, tf, count) {
  const key = `${instId}|${tf}`, now = Date.now();
  let data = state.cache.get(key);
  if (!data || now - data.at > TIMEFRAMES[tf].ms / 4) {
    const provider = FIXTURE ? fixtureProvider : okxProvider;
    const r = await provider.candles(instId, tf, count || barsFor(tf)); data = { candles: r.candles, live: r.live, at: now }; state.cache.set(key, data);
  }
  return data;
}

/** Satırın check list'i: plan (botun buildPlan'ı, gevşek), BTC 1D, coin'in üst TF'si, FVG/OB/likidite (preset'ten bağımsız). */
async function checklistFor(r) {
  const plan = buildPlan(r, { minScore: 0, minRR: 0, minRR1: 0, maxDistAtr: 99 });
  if (!plan.ok) return { error: plan.reason };
  const safe = (p) => p.catch(() => null);
  const up = UP_TF[r.tf];
  const [btc, upData] = await Promise.all([safe(candlesOf('BTC-USDT-SWAP', '1D', 120)), up ? safe(candlesOf(r.instId, up, up === '1D' ? 120 : barsFor(up))) : null]);
  const ctx = makeContext({ candles: r.candles, live: r.live, tf: r.tf, symbol: r.coin, opts: {} });
  let smc = [];
  try { smc = runDetectors(ctx, ['fvg', 'orderblock', 'liquidity']); } catch { smc = []; }
  return checklistOf({ plan, candles: r.live ? [...r.candles, r.live] : r.candles, btcDaily: btc?.candles || null, upCandles: upData?.candles || null, smc, coin: r.coin });
}

function renderChecklist(cl) {
  const el = $('#checklist'); if (!el) return;
  if (cl.error) { el.innerHTML = `<p class="note">Check list yok: ${esc(cl.error)}</p>`; return; }
  el.innerHTML = `<h2>Check list <b>${cl.n}/${cl.of}</b>${cl.known < cl.of ? ` <small>(${cl.of - cl.known} madde verisiz)</small>` : ''}</h2>
    <p class="note">Madde sayısı başarı olasılığı değildir; maddeler eşit ağırlıkta değil (kazancın çoğu BTC yönünden). "ölçülmedi" maddeler görüş.</p>
    <ul class="cl">${cl.items.map((x) => `<li class="${x.ok === true ? 'ok' : x.ok === false ? 'no' : 'na'}" title="${esc(x.hint)}"><span class="mk">${x.ok === true ? '✓' : x.ok === false ? '✗' : '?'}</span><span class="lb">${esc(x.label)} <small class="ev ${x.ev === 'ölçüldü' ? 'm' : ''}">${esc(x.ev)}</small><br><small>${esc(x.detail || '')}</small></span></li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ ★ takip listesi
async function addWatch(r) {
  const w = makeWatch(r);
  if (w.error) { banner(`Takibe alınamadı: ${w.error}`, 'err'); return; }
  try { const cl = await checklistFor(r); if (!cl.error) w.checklist = { n: cl.n, of: cl.of, items: cl.items.map((x) => ({ id: x.id, ok: x.ok })) }; } catch { /* check list'siz */ }
  state.watch = [w, ...state.watch]; saveWatch(state.watch); $('#watchPanel').open = true;
  banner(`★ ${r.coin} ${r.tf} ${r.direction.toUpperCase()} takipte: giriş ${fmtPrice(w.entry)}, stop ${fmtPrice(w.stop)}, TP1 ${fmtPrice(w.tp1)}, TP2 ${fmtPrice(w.tp2)}.`);
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* yok */ }
  renderWatch(); renderDetail(r);
}

function notifyWatch(msg) {
  banner(msg);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Takip listesi', { body: msg }); } catch { /* yok */ }
}

/** Açık kayıtları güncel mumlarla günceller (tarama önbelleği tazeyse ondan, değilse indirir). */
async function refreshWatch() {
  const open = state.watch.filter(isOpen);
  if (!open.length) { renderWatch(); return; }
  const provider = FIXTURE ? fixtureProvider : okxProvider;
  const now = Date.now(), msgs = [];
  for (const key of new Set(open.map((w) => `${w.instId}|${w.tf}`))) {
    const [instId, tf] = key.split('|');
    let data = state.cache.get(key);
    if (!data || now - data.at > TIMEFRAMES[tf].ms / 4) {
      try { const r = await provider.candles(instId, tf, barsFor(tf)); data = { candles: r.candles, live: r.live, at: now }; state.cache.set(key, data); } catch { continue; }
    }
    const cs = data.live ? [...data.candles, data.live] : data.candles;
    state.watch = state.watch.map((w) => {
      if (`${w.instId}|${w.tf}` !== key || !isOpen(w)) return w;
      const { item, events } = updateWatch(w, cs, now);
      for (const ev of events) msgs.push(`${w.coin} ${w.tf} ${w.direction.toUpperCase()}: ${WATCH_LABEL[ev === 'tp1' ? 'tp1' : item.status] || ev}`);
      return item;
    });
  }
  saveWatch(state.watch);
  if (msgs.length) notifyWatch(`★ ${msgs.join(' · ')}`);
  renderWatch();
}

function renderWatch() {
  const list = state.watch;
  $('#watchTitle').textContent = `★ Takip listem (${list.filter(isOpen).length} açık / ${list.length})`;
  if (!list.length) { $('#watchList').innerHTML = '<p class="empty">Henüz takip yok. Bir satır seçip ayrıntıda "☆ Takibe al"a bas.</p>'; return; }
  $('#watchList').innerHTML = list.map((w) => {
    const R = watchR(w);
    const st = w.status === 'stopped' && w.tp1At ? 'TP1 sonrası başa baş' : WATCH_LABEL[w.status] || w.status;
    return `<article class="watch ${isOpen(w) ? '' : 'closed'}" data-id="${esc(w.id)}">
      <div class="row-top"><span class="row-sym">${esc(w.coin)}</span><span class="row-tf">${w.tf}</span><span class="dir ${w.direction}">${w.direction.toUpperCase()}</span>
        <span class="badge">${esc(st)}</span>${w.checklist ? `<span class="badge" title="Takibe alındığı andaki check list">✓ ${w.checklist.n}/${w.checklist.of}</span>` : ''}${R != null ? `<span class="score ${R >= 0 ? 'hi' : 'lo'}">${R >= 0 ? '+' : ''}${R.toFixed(2)}R${isOpen(w) ? ' anlık' : ''}</span>` : ''}
        <button type="button" class="btn small" data-del="${esc(w.id)}" aria-label="Takipten çıkar" style="margin-left:auto">✕</button></div>
      <div class="row-grid">
        <div><span>Giriş</span> <b>${fmtPrice(w.entry)}</b></div><div><span>Stop</span> <b>${fmtPrice(w.stop)}</b></div>
        <div><span>TP1</span> <b>${fmtPrice(w.tp1)}</b> <small>${w.rr1}R</small></div><div><span>TP2</span> <b>${fmtPrice(w.tp2)}</b> <small>${w.rr}R</small></div>
        <div><span>Son fiyat</span> <b>${fmtPrice(w.lastPrice)}</b></div><div><span>Eklendi</span> <b>${fmtTime(w.addedAt)}</b></div>
      </div>
      <div class="sig-note">${esc(w.signals.join(' · '))}</div>
      <input type="text" class="watch-note" data-note="${esc(w.id)}" value="${esc(w.note || '')}" placeholder="Not (ör. Bybit'te açtım, 0,5 risk)">
    </article>`;
  }).join('');
}

function bindWatch() {
  $('#watchList').addEventListener('click', (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del; if (!id) return;
    state.watch = state.watch.filter((w) => w.id !== id); saveWatch(state.watch); renderWatch();
  });
  $('#watchList').addEventListener('change', (e) => {
    const id = e.target.dataset.note; if (!id) return;
    state.watch = state.watch.map((w) => (w.id === id ? { ...w, note: e.target.value } : w)); saveWatch(state.watch);
  });
  $('#watchRefresh').addEventListener('click', refreshWatch);
  $('#watchClear').addEventListener('click', () => { state.watch = state.watch.filter(isOpen); saveWatch(state.watch); renderWatch(); });
  $('#watchExport').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.watch, null, 1)], { type: 'application/json' }));
    a.download = `takip-listesi-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#watchImport').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { state.watch = mergeImport(state.watch, await f.text()); saveWatch(state.watch); renderWatch(); banner('Takip listesi içe aktarıldı.'); }
    catch (err) { banner(`İçe aktarılamadı: ${err.message}`, 'err'); }
    e.target.value = '';
  });
  setInterval(() => { if (!state.busy && state.watch.some(isOpen) && document.visibilityState === 'visible') refreshWatch(); }, 5 * 60e3);
}

// ------------------------------------------------------------------ başlat
renderToolbar();
bindToolbar();
bindRows();
bindScreenshot();
bindWatch();
if (state.watch.length) $('#watchPanel').open = true;
refreshWatch();
if (FIXTURE) banner('Fixture modu: OKX yerine sentetik veri kullanılıyor.');
window.addEventListener('beforeunload', destroyChart);
window.__cta = { state, scan, UI_DEFAULTS };
