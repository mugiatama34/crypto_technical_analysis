// Ölçüm dürüstlüğü (13.11): tarama (sweep.html) ve laboratuvar (lab.html) sayfalarında ort. R'nin yanında %90 güven aralığı,
// "sonuçsuz" (n < 100) etiketi, "iyimser dolum mumu" rozeti ve sıkı ölçüt özeti. Saf fonksiyonlar (node testinde de çalışır).
// Eski sweep.json / lab.json'da yeni alanlar yok: aralık gösterilmez, sonuçsuz n'den türetilir, rozet çıkmaz, özet yoksa boş.
export const MIN_N = 100;
export const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }) : (x === Infinity ? '∞' : '–'));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Dilim n < 100 mü (alan varsa o, yoksa n'den). */
export const isInconclusive = (s) => !!s && (s.inconclusive ?? (Number.isFinite(s.n) && s.n < MIN_N));

/** Ort. R hücresinin altına küçük satır: "%90 a…b" ve/veya "sonuçsuz". Hücreyi genişletmemek için iki kısa satır. */
export function ciNote(s) {
  if (!s) return '';
  const parts = [];
  if (Array.isArray(s.ci90) && s.ci90.length === 2) parts.push(`%90 ${fmt(s.ci90[0], 2)}…${fmt(s.ci90[1], 2)}`);
  if (isInconclusive(s) && s.n > 0) parts.push('sonuçsuz');
  return parts.length ? `<br><small class="ci${isInconclusive(s) ? ' inc' : ''}" title="%90 güven aralığı: giriş gününe göre bloklu bootstrap. Sonuçsuz: dilimde n < ${MIN_N}.">${parts.join(' · ')}</small>` : '';
}

/** Ort. R değeri + aralık notu (td içeriği). */
export const rWithCi = (s, d = 3) => `${fmt(s?.avgR, d)}${ciNote(s)}`;

/** Satır rozetleri: iyimser dolum mumu (realistic === false) → ölçüt dışı; sıkı ölçütü gerçekçi geçen → "sıkı ✓". */
export function measureBadges(v) {
  if (!v) return '';
  let out = '';
  if (v.realistic === false) out += `<span class="badge opt" title="Limit dolduğu mumda hedef görülürse 'önce dolum, sonra hedef' sayıldı (fillBarTp count). Sıkı ölçüt dışı.">iyimser dolum mumu</span>`;
  if (v.strict === true) out += '<span class="badge strict" title="İki dilimde n ≥ 100, ort. R > 0, PF > 1,1; gerçekçi dolum mumu">sıkı ✓</span>';
  return out;
}

/** Satır sınıfı: iyimser satırlar soluk (ölçüt dışı). */
export const rowClass = (v) => (v?.realistic === false ? 'opt' : '');

/** Rapor üstü özet: sıkı ölçütü kaç satır gerçekçi / yalnız iyimser geçti; kaç varyant arasından seçim. */
export function strictSummary(r, noun = 'varyant') {
  const p = r?.strictPass;
  if (!p) return '';
  const sel = `${p.variants} ${noun} arasından seçim: en iyi satır şansla da iyi görünebilir (çok deneme = iyimserlik).`;
  return `<p class="note strictsum"><b>Sıkı ölçüt</b> (iki dilimde n ≥ ${MIN_N}, ort. R &gt; 0, PF &gt; 1,1; gerçekçi dolum mumu): <b>${p.realistic}</b> satır geçti${p.optimisticOnly ? ` · ${p.optimisticOnly} satır yalnız <span class="badge opt">iyimser dolum mumu</span> varsayımıyla geçti (sayılmaz)` : ''}. ${esc(sel)} Ort. R altındaki küçük yazı %90 güven aralığıdır (aynı gün açılan işlemler birlikte örneklenir); aralık 0'ı içeriyorsa sonuç sıfırdan ayırt edilemez.</p>`;
}

/** Sayfalara eklenen küçük stil (rozet ve aralık metni). */
export const MEASURE_CSS = `
  small.ci { display: inline-block; font-size: 10.5px; color: var(--ink-dim); font-weight: 400; line-height: 1.2; }
  small.ci.inc { color: #d9a441; }
  .badge.opt { background: rgba(217,164,65,.16); color: #d9a441; border-color: rgba(217,164,65,.4); margin-left: 6px; }
  .badge.strict { background: rgba(94,163,240,.18); color: #5ea3f0; margin-left: 6px; }
  tr.opt td { opacity: .62; }
`;
