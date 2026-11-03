// Senaryo okları (Telegram grafiği, tarayıcı ve coin sayfası ortak): plandan "ana" ve "alternatif" yol. Noktalar son mumdan
// itibaren mum adımı (k) ile verilir; zaman yalnız çizim içindir, tahmin değildir. Ana = giriş bölgesi → TP1 → TP2;
// alternatif = stop tarafında stopa yakın alınmamış likidite varsa "süpürme → stop", yoksa "tutunmaz → stop → iptal".

/** plan: { direction, entry, stop, tp1, tp2, zone? } · price: şimdiki fiyat · hunt: { label, price } | null → { main, alt, inZone } */
export function scenarioPaths(plan, price, hunt = null) {
  const d = plan.direction === 'short' ? -1 : 1, risk = Math.abs(plan.entry - plan.stop);
  const inZone = plan.zone ? price >= Math.min(...plan.zone) && price <= Math.max(...plan.zone) : false;
  const start = [{ k: 0, price }], ent = inZone ? [] : [{ k: 3, price: plan.entry, label: 'giriş', above: d === -1 }];
  const main = [...start, ...ent];
  if (plan.tp1 != null) main.push({ k: 12, price: plan.tp1, label: 'TP1', above: d === 1 });
  if (plan.tp2 != null) main.push({ k: 22, price: plan.tp2, label: 'TP2', above: d === 1 });
  const alt = hunt
    ? [...start, ...ent, { k: 9, price: hunt.price - d * 0.1 * risk, label: `${hunt.label} süpürme`, above: d === -1 }, { k: 15, price: plan.entry, label: 'dönüş?', above: d === 1 }]
    : [...start, ...ent, { k: 9, price: plan.stop, label: 'stop', above: d === -1 }, { k: 13, price: plan.stop - d * 0.5 * risk, label: 'iptal', above: d === -1 }];
  return { main, alt, inZone };
}

/** Lightweight Charts çizimi için sözde sinyal: iki 'path' talimatı (indeks = son mum + k). */
export function scenarioSignal(plan, lastI, price, hunt = null) {
  const s = scenarioPaths(plan, price, hunt);
  const pts = (arr) => arr.map((p) => ({ i: lastI + p.k, price: p.price, label: p.label || '', above: !!p.above }));
  return {
    id: 'scenario', type: 'scenario', group: 'smc', name: 'Senaryo', direction: plan.direction, strength: 0, zone: null, index: lastI, status: 'active',
    note: 'Ana (yeşil) ve alternatif (kırmızı) yol; tahmin değil, plan senaryosu.',
    draw: [
      { kind: 'path', points: pts(s.alt), color: '#ef5350', style: 'dashed', width: 2 },
      { kind: 'path', points: pts(s.main), color: '#4caf50', style: 'dashed', width: 3 },
    ],
  };
}
