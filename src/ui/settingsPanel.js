// "Ayarlar" bölmesi (klonnist/ew-setup-scanner'dan uyarlandı): konu başlıklarına ayrılmış form. Değerler s.ew'de saklanır
// ve taramada Elliott detektörüne gider (detectorOpts.elliott.w3). Bot bu alanı göndermez; bot davranışı değişmez.
import { DEFAULTS as W3 } from '../scan/wave3.js';
import { SMT_DEFAULTS } from '../scan/smt.js';
import { esc } from './format.js';

const PICK = ['sensitivities', 'w1Extend', 'minW1Atr', 'retrMin', 'retrMax', 'requireAbc', 'abcKinds', 'minTimeRatio', 'rsiMode', 'volume',
  'textbook', 'textbookMin', 'cleanW1Er', 'cleanW1Speed', 'stopMode', 'stopAtr', 'zoneCExt', 'zoneRetr', 'zoneEntry', 'zoneStop', 'perfectAtr',
  'zoneFrontAtr', 'onlyPerfect', 'zoneTime', 'targets', 'mainTarget'];
export const EW_UI_DEFAULTS = {
  ...Object.fromEntries(PICK.map((k) => [k, W3[k]])),
  ruleSet: 'course',
  cExtend: true, // tarayıcıda açık (C uzayınca / alt derecede bitince kurulum düşmez)
  minRR: 1.5, // Elliott detektörünün varsayılanı
  ...SMT_DEFAULTS,
  smtOnly: false,
};

// [anahtar, etiket, tür, ek]; ek.group: general | wave3, ek.sub: alt başlık
const FIELDS = [
  ['ruleSet', 'Elliott kural seti', 'select', { group: 'general', options: [['course', 'Kurs (Rules.docx) — en katı'], ['fp', 'Frost & Prechter'], ['neely', 'Neely']], hint: 'Dalga-3 ve genel sayımlar için.' }],
  ['smtRef', 'SMT referansı', 'select', { group: 'general', options: [['BTC', 'BTC (BTC için ETH)'], ['ETH', 'ETH (ETH için BTC)'], ['off', 'Kapalı']], hint: "Yalnız dalga-3 limit bölge LONG: C, A dibini süpürdü mü, referans aynı anda süpürdü mü? Yalnız etiket. Lab (24 ay, 4H, 50 coin): SMT ✓ olanlar diğerlerinden iyi değil." }],
  ['smtWin', 'SMT penceresi (± mum)', 'number', { group: 'general', step: 1, min: 0 }],
  ['smtOnly', "Sadece SMT'li limit bölge long'ları (diğer kurulumlar etkilenmez)", 'bool', { group: 'general' }],

  ['cExtend', 'C uzaması: C uzayınca / alt derecede bitince kurulum kalsın', 'bool', { group: 'wave3', sub: 'Dalga yapısı', hint: 'Kapalı = botun kullandığı eski kural (yalnız iki iç dönüş + oluşan C).' }],
  ['sensitivities', 'ZigZag duyarlılığı (× ATR)', 'list', { group: 'wave3', sub: 'Dalga yapısı', hint: 'Her değer bir dalga derecesi. Küçük = kısa dalgalar.' }],
  ['w1Extend', 'Dalga 1 başlangıcı', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [[0, 'Son dönüş noktası'], [1, '1 iç dalgalanma geri'], [2, '2 iç dalgalanma geri'], [99, 'En geniş dalga 1']], num: true }],
  ['minW1Atr', 'Min. dalga 1 boyu (× ATR)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.5, min: 0 }],
  ['retrMin', 'Dalga 2 geri çekilme min', 'pct', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['retrMax', 'Dalga 2 geri çekilme max', 'pct', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['requireAbc', 'Dalga 2 ABC zorunlu', 'bool', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['abcKinds', 'ABC tipi', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [['both', 'Zigzag veya flat'], ['zigzag', 'Sadece zigzag'], ['flat', 'Sadece flat']] }],
  ['minTimeRatio', 'Süre(2) / Süre(1) en az (>)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.1, min: 0 }],
  ['rsiMode', 'RSI filtresi (Ders 3)', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [['score', 'Skora ekle'], ['require', 'Zorunlu'], ['off', 'Kapalı']], hint: "C'de A'ya göre uyumsuzluk / dalga 1'de RSI ≥ 60 (short: ≤ 40)." }],
  ['volume', 'Hacim filtresi (W1 > W2 hacmi skora +)', 'bool', { group: 'wave3', sub: 'Dalga yapısı' }],

  ['textbook', 'Sadece ders kitabı şekli', 'bool', { group: 'wave3', sub: 'Ders kitabı şekli', hint: "Şablon: net dalga 1 · orantılı ABC (a = dalga 1'in %30–60'ı, b = a'nın %45–90'ı, c = a'nın 1–1,4 katı) · ★ çakışma · süre(2) ≤ 2,5 × süre(1). Kartta 📐 x/4 her zaman görünür. Lab: 3/4 ve 4/4 filtreleri kenar vermedi." }],
  ['textbookMin', 'En az şablon uyumu', 'select', { group: 'wave3', sub: 'Ders kitabı şekli', options: [[3, '3/4 ve üstü (biri eksik olabilir)'], [4, 'Sadece 4/4 (dört şart da)']], num: true }],
  ['cleanW1Er', 'Dalga 1 verimi en az', 'number', { group: 'wave3', sub: 'Ders kitabı şekli', step: 0.05, min: 0, hint: 'Net hareket ÷ mumların gidip geldiği toplam yol. 1 = dümdüz itki, 0 = testere.' }],
  ['cleanW1Speed', 'Dalga 1 hızı en az (ATR / mum)', 'number', { group: 'wave3', sub: 'Ders kitabı şekli', step: 0.05, min: 0 }],

  ['zoneCExt', 'Bölge kenarı: C = ? × A', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.001, min: 0.5, hint: "B'den ölçülür. Varsayılan 1,272." }],
  ['zoneRetr', 'Bölge kenarı: dalga 2 geri çekilme', 'pct', { group: 'wave3', sub: 'Limit bölge' }],
  ['zoneEntry', 'Bölge girişi', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['mid', 'Kademeli: yarısı yakın, yarısı uzak kenar'], ['near', 'Yakın kenar'], ['far', 'Uzak kenar'], ['r618', 'Sadece %61,8 seviyesi'], ['c127', 'Sadece C = 1,272A seviyesi']] }],
  ['zoneStop', 'Stop yeri', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['w0', 'Dalga 1 başı (0 noktası)'], ['r886', 'Dalga 2 = %88,6']] }],
  ['perfectAtr', '★ Mükemmel: iki kenar farkı ≤ ? × ATR', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.05, min: 0 }],
  ['zoneFrontAtr', 'Limit emri seviyenin önüne (× ATR)', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.05, min: 0, hint: 'Fiyat seviyeye birkaç tik kala dönse de emir dolsun. 0 = tam seviye.' }],
  ['onlyPerfect', 'Sadece ★ mükemmel bölgeler', 'bool', { group: 'wave3', sub: 'Limit bölge' }],
  ['zoneTime', 'Süre koşulu', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['require', 'Emir, süre(2) > süre(1) olunca aktif'], ['ignore', 'Süreye bakma']] }],

  ['stopMode', 'Stop yeri', 'select', { group: 'wave3', sub: 'B kırılımı', options: [['w2', 'Dalga 2 ucu'], ['w0', '0 noktası (geçersizlik)']] }],
  ['stopAtr', 'Stop tamponu (× ATR)', 'number', { group: 'wave3', sub: 'B kırılımı', step: 0.05, min: 0, hint: 'İki giriş tipinde de stop bu kadar ötesine konur.' }],

  ['targets', 'Hedefler (× dalga 1)', 'list', { group: 'wave3', sub: 'Hedef ve R:R' }],
  ['mainTarget', 'R:R için hedef', 'select', { group: 'wave3', sub: 'Hedef ve R:R', options: [[0, 'Hedef 1'], [1, 'Hedef 2'], [2, 'Hedef 3']], num: true }],
  ['minRR', 'Min. R:R', 'number', { group: 'wave3', sub: 'Hedef ve R:R', step: 0.25, min: 0 }],
];
const GROUPS = [{ id: 'general', title: 'Genel' }, { id: 'wave3', title: 'Elliott dalga-3 setup' }];
const openState = new Map();
const nums = (v) => String(v).split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);

function fieldHtml([key, label, type, ex = {}], s) {
  const id = `set-${key}`;
  const hint = ex.hint ? `<small>${esc(ex.hint)}</small>` : '';
  if (type === 'bool') return `<div class="check"><label class="ck" for="${id}"><input type="checkbox" id="${id}"${s[key] ? ' checked' : ''}><span>${esc(label)}</span></label>${hint}</div>`;
  let input;
  if (type === 'select') input = `<select id="${id}">${ex.options.map(([v, t]) => `<option value="${esc(v)}"${String(s[key]) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else if (type === 'pct') input = `<input type="number" id="${id}" step="0.1" min="0" max="100" value="${+(s[key] * 100).toFixed(1)}">`;
  else if (type === 'list') input = `<input type="text" id="${id}" value="${esc(s[key].join(', '))}">`;
  else input = `<input type="number" id="${id}" step="${ex.step}" min="${ex.min}" value="${s[key]}">`;
  return `<label class="field" for="${id}"><span>${esc(label)}${type === 'pct' ? ' (%)' : ''}</span>${input}${hint}</label>`;
}

/** Değer dönüşümü (formdan): pct → oran, list → sayı listesi (boşsa varsayılan), select num → sayı. */
export function parseField(key, raw, checked) {
  const f = FIELDS.find((x) => x[0] === key); if (!f) return undefined;
  const [, , type, ex = {}] = f;
  if (type === 'bool') return !!checked;
  if (type === 'pct') return Math.max(0, Number(raw)) / 100;
  if (type === 'list') { const v = nums(raw); return v.length ? v : EW_UI_DEFAULTS[key]; }
  if (type === 'select') return ex.num ? Number(raw) : raw;
  return Number(raw);
}

/** Ayarlar bölmesini çizer; onChange(patch | null) (null = varsayılanlara dön). */
export function renderSettingsPanel(root, ew, onChange) {
  const s = { ...EW_UI_DEFAULTS, ...ew };
  root.innerHTML = GROUPS.map((g) => {
    const subs = [];
    for (const f of FIELDS.filter((x) => x[3].group === g.id)) {
      const sub = f[3].sub || '';
      let blk = subs.find((x) => x.sub === sub); if (!blk) subs.push((blk = { sub, items: [] }));
      blk.items.push(fieldHtml(f, s));
    }
    const open = openState.has(g.id) ? openState.get(g.id) : true;
    return `<details class="set-group" data-group="${g.id}"${open ? ' open' : ''}><summary>${esc(g.title)}</summary>
      ${subs.map((b) => `${b.sub ? `<h4>${esc(b.sub)}</h4>` : ''}<div class="set-grid">${b.items.join('')}</div>`).join('')}</details>`;
  }).join('') + '<div class="set-actions"><button type="button" class="btn" id="set-reset">Varsayılanlara dön</button><span class="note">Değişiklik bir sonraki "Tara"da uygulanır.</span></div>';
  for (const d of root.querySelectorAll('details.set-group')) d.addEventListener('toggle', () => openState.set(d.dataset.group, d.open));
  for (const [key] of FIELDS) {
    const el = root.querySelector(`#set-${key}`);
    el.addEventListener('change', () => onChange({ [key]: parseField(key, el.value, el.checked) }));
  }
  root.querySelector('#set-reset').addEventListener('click', () => onChange(null));
}
