// klonnist/ew-setup-scanner (MIT) src/scan/smt.js kopyası.
// SMT (Smart Money Technique): kalıbın bittiği uç bir önceki ucu süpürdü mü, aynı anda korele grafik (BTC; BTC için ETH)
// aynı süpürmeyi yaptı mı? Biri süpürüp diğeri süpüremezse süpürme büyük ihtimalle stop avıdır → dönüş onayı.
// Önce sayım, sonra SMT: karşılaştırılan iki uç kalıptan gelir; korele grafik yalnızca onaydır.
// Gelecek veri kullanılmaz: referans grafikte yalnızca kalıbın görüldüğü mumun kapanışına kadarki mumlara bakılır.

export const SMT_DEFAULTS = {
  smtRef: 'BTC', // 'BTC' | 'ETH' | 'off' — coinin kendisi referanssa diğeri kullanılır
  smtWin: 2, // referans grafikte uç noktanın ±kaç mum çevresine bakılır
};

export const SMT_LABEL = {
  smt: 'SMT ✓',
  both: 'SMT yok',
  ref: 'Ters SMT',
  none: 'Süpürme yok',
};

export const SMT_HELP = {
  smt: 'Kalıp önceki ucu süpürdü, referans grafik aynı süpürmeyi yapamadı (stop avı → dönüş onayı).',
  both: 'İki grafik de önceki ucu birlikte geçti; süpürme gerçek hareket olabilir.',
  ref: 'Referans grafik önceki ucu geçti, bu coin geçmedi (coin daha güçlü/zayıf; klasik SMT değil).',
  none: 'İki grafik de önceki ucun gerisinde kaldı.',
};

/** Coin için referans sembol (BTC'nin referansı ETH). null: kapalı. */
export function refCoinFor(coin, ref = SMT_DEFAULTS.smtRef) {
  if (!ref || ref === 'off') return null;
  if (coin === ref) return ref === 'BTC' ? 'ETH' : 'BTC';
  return ref;
}

/**
 * Kalıbın karşılaştırılacak iki ucu: { prev, last } (i: mum indeksi, price).
 * Dalga 3: dalga 2'nin A ucu ↔ C ucu · ABCDE: C ↔ E · Ending diagonal: 3 ↔ 5 · Diagonal dalga 4: 2 ↔ 4.
 * Leading diagonal ve üçgen kırılımında süpürülen bir uç yok → null.
 */
export function smtPoints(s) {
  const P = s.points || {};
  if (s.kind === 'abcde') return P.C && P.E ? { prev: P.C, last: P.E } : null;
  if (s.kind === 'diagonal') {
    if (s.type === 'ending') return P.p3 && P.p5 ? { prev: P.p3, last: P.p5 } : null;
    if (s.type === 'w4') return P.p2 && P.p4 ? { prev: P.p2, last: P.p4 } : null;
    return null;
  }
  if (s.kind === 'triangle') return null;
  const last = P.p2 || P.cNow;
  return s.abc?.A && last ? { prev: s.abc.A, last } : null;
}

/**
 * Etiket yalnızca dalga-3 limit bölge LONG kurulumunda gösterilir (dalga 2 sürerken, C oluşuyor).
 * 1 yıllık 4H backtestte yalnızca burada tutarlı fark çıktı; short, B kırılımı, ABCDE ve diagonalde çıkmadı.
 */
export function smtApplies(s) {
  return !s.kind && s.phase === 'forming' && !!s.zone && s.d === 1;
}

/** time → indeks haritası (referans mumlar için bir kez kurulur). */
export function timeIndex(candles) {
  const m = new Map();
  for (let i = 0; i < candles.length; i++) m.set(candles[i].time, i);
  return m;
}

/**
 * @param subject  kalıbın bulunduğu mumlar (pivot indeksleri bu diziye göre)
 * @param ref      { candles, index: timeIndex(candles) }
 * @param pts      { prev, last } (smtPoints)
 * @param d        işlem yönü: 1 long (dipler karşılaştırılır), -1 short (tepeler)
 * @returns 'smt' | 'both' | 'ref' | 'none' | null (veri yok)
 */
export function smtCheck(subject, ref, pts, d, win = SMT_DEFAULTS.smtWin) {
  if (!ref || !pts || !subject.length) return null;
  const asOf = subject[subject.length - 1].time;
  const swept = (a, b) => (d === 1 ? b < a : b > a); // b, a'nın ötesine geçti mi
  const subjSwept = swept(pts.prev.price, pts.last.price);
  const rPrev = refExtreme(subject, ref, pts.prev.i, d, win, asOf);
  const rLast = refExtreme(subject, ref, pts.last.i, d, win, asOf);
  if (rPrev == null || rLast == null) return null;
  const refSwept = swept(rPrev, rLast);
  if (subjSwept) return refSwept ? 'both' : 'smt';
  return refSwept ? 'ref' : 'none';
}

// Referans grafikte, subject'in i. mumunun zamanı ±win mum aralığındaki en düşük dip (long) / en yüksek tepe (short).
function refExtreme(subject, ref, i, d, win, asOf) {
  const t = subject[Math.max(0, Math.min(subject.length - 1, i))]?.time;
  const j = ref.index.get(t);
  if (j == null) return null;
  let x = null;
  for (let k = Math.max(0, j - win); k <= Math.min(ref.candles.length - 1, j + win); k++) {
    const c = ref.candles[k];
    if (c.time > asOf) break;
    const v = d === 1 ? c.low : c.high;
    if (x == null || (d === 1 ? v < x : v > x)) x = v;
  }
  return x;
}

/** Setup listesine smt alanı yazar (yerinde). ref null ise alan null olur. */
export function tagSmt(setups, subject, ref, opts = {}) {
  for (const s of setups) {
    const pts = smtApplies(s) ? smtPoints(s) : null;
    s.smt = pts ? smtCheck(subject, ref, pts, s.d, opts.smtWin ?? SMT_DEFAULTS.smtWin) : null;
  }
  return setups;
}
