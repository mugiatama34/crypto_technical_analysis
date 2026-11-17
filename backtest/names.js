// Sinyal adı aralıkları (saf; tarayıcıda da çalışır): ADX ve hacim değerleri aralıklara toplanır.
const ADX_RE = /^ADX (\d+(?:[.,]\d+)?) trend ([↑↓])$/;
const VOL_RE = /^Hacim ×(\d+(?:[.,]\d+)?)$/;
const num = (s) => Number(String(s).replace(',', '.'));

/** Sayı içeren adı aralığa çevirir; alt sınır dahil, üst hariç. Diğer adlar aynen döner. */
export function bucketName(name) {
  let m = ADX_RE.exec(name);
  if (m) {
    const n = num(m[1]), a = m[2];
    const r = n < 25 ? '<25' : n < 30 ? '25–30' : n < 40 ? '30–40' : n < 50 ? '40–50' : '50+';
    return `ADX ${r} trend ${a}`;
  }
  m = VOL_RE.exec(name);
  if (m) {
    const x = num(m[1]);
    const r = x < 2 ? '<2' : x < 3 ? '2–3' : x < 4 ? '3–4' : x < 6 ? '4–6' : '6+';
    return `Hacim ×${r}`;
  }
  return name;
}

/** byName nesnesini bucketName ile birleştirir (n, signals, totalR toplanır; diğerleri n ağırlıklı; maxDD '–' = null). Sıralama: ort. R azalan. */
export function mergeByName(byName) {
  const groups = new Map();
  for (const [k, s] of Object.entries(byName || {})) {
    const b = bucketName(k);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push([k, s]);
  }
  const out = [];
  for (const [b, list] of groups) {
    if (list.length === 1) { out.push([b, list[0][1]]); continue; }
    const n = list.reduce((s, [, x]) => s + x.n, 0);
    const signals = list.reduce((s, [, x]) => s + x.signals, 0);
    const totalR = list.reduce((s, [, x]) => s + x.totalR, 0);
    const w = (f) => (n ? list.reduce((s, [, x]) => s + x.n * x[f], 0) / n : 0);
    const pf = list.some(([, x]) => !Number.isFinite(x.profitFactor)) ? Infinity : w('profitFactor');
    out.push([b, {
      n, signals, totalR: +totalR.toFixed(1), avgR: n ? +(totalR / n).toFixed(3) : 0,
      winRate: +w('winRate').toFixed(3), fillRate: signals ? +(n / signals).toFixed(2) : 0,
      profitFactor: pf === Infinity ? pf : +pf.toFixed(2), maxDD: null,
    }]);
  }
  return Object.fromEntries(out.sort((a, b) => b[1].avgR - a[1].avgR));
}
