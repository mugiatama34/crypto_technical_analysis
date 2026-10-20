// İndikatör tabanlı sinyaller: EMA kesişimleri, EMA200 trendi, Bollinger/Keltner sıkışması (TTM squeeze) ve kırılımı,
// Supertrend dönüşü, Donchian kırılımı, Ichimoku bulut kırılımı, RSI aşırı bölge, MACD kesişimi, ADX,
// hacim patlaması, VWAP, hacim profili (POC / değer alanı), Andrews pitchfork.
import { signal } from '../core/signal.js';

export const MISC_DEFAULTS = { recent: 3, volSpike: 2.5 };

const crossUp = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1] <= b[i - 1] && a[i] > b[i];
const crossDn = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1] >= b[i - 1] && a[i] < b[i];

export function detect(ctx) {
  const o = { ...MISC_DEFAULTS, ...ctx.opts.misc };
  const out = [];
  const { closes, highs, lows, volumes, last, price, atrNow } = ctx;
  if (ctx.n < 50) return out;
  const near = (p) => [p - 0.25 * atrNow, p + 0.25 * atrNow];
  const add = (s) => out.push(signal({ type: 'indicator', group: 'indicator', index: last, status: 'active', ...s }));
  const inRecent = (fn) => { for (let i = last; i >= last - o.recent + 1 && i > 0; i--) if (fn(i)) return i; return -1; };

  // EMA kesişimleri
  const e9 = ctx.ema(9), e21 = ctx.ema(21), e50 = ctx.ema(50), e200 = ctx.ema(200);
  let i;
  if ((i = inRecent((k) => crossUp(e50, e200, k))) >= 0) add({ id: 'ema|golden', name: 'Golden cross (50/200)', direction: 'long', strength: 0.5, zone: near(e50[i]), index: i, note: 'EMA50, EMA200 üstüne çıktı.', draw: [] });
  if ((i = inRecent((k) => crossDn(e50, e200, k))) >= 0) add({ id: 'ema|death', name: 'Death cross (50/200)', direction: 'short', strength: 0.5, zone: near(e50[i]), index: i, note: 'EMA50, EMA200 altına indi.', draw: [] });
  if ((i = inRecent((k) => crossUp(e9, e21, k))) >= 0) add({ id: 'ema|9x21up', name: 'EMA 9/21 ↑', direction: 'long', strength: 0.3, zone: near(e21[i]), index: i, note: 'EMA9, EMA21 üstüne çıktı.', draw: [] });
  if ((i = inRecent((k) => crossDn(e9, e21, k))) >= 0) add({ id: 'ema|9x21dn', name: 'EMA 9/21 ↓', direction: 'short', strength: 0.3, zone: near(e21[i]), index: i, note: 'EMA9, EMA21 altına indi.', draw: [] });
  if (e200[last] != null) {
    const above = price > e200[last];
    const dist = Math.abs(price - e200[last]) / atrNow;
    add({ id: 'ema|200', name: above ? 'EMA200 üstü' : 'EMA200 altı', direction: above ? 'long' : 'short', strength: 0.2, zone: near(e200[last]), note: `Fiyat EMA200'ün ${above ? 'üstünde' : 'altında'} (${dist.toFixed(1)}×ATR).`, draw: [{ kind: 'hline', price: e200[last], color: '#a5a39a', label: 'EMA200', style: 'dotted' }] });
    if (dist <= 0.5) add({ id: 'ema|200touch', name: 'EMA200 testi', direction: above ? 'long' : 'short', strength: 0.4, zone: near(e200[last]), note: 'Fiyat EMA200 seviyesini test ediyor (dinamik destek/direnç).', draw: [] });
  }

  // Sıkışma: BB, Keltner içinde (TTM) ya da BB genişliği 100 mumun en düşüğü
  const bb = ctx.bb, kc = ctx.keltner;
  const sq = (k) => bb.upper[k] != null && kc.upper[k] != null && bb.upper[k] < kc.upper[k] && bb.lower[k] > kc.lower[k];
  const widths = bb.width.slice(-100).filter((x) => x != null);
  const minW = widths.length ? Math.min(...widths) : null;
  if (sq(last) || (minW != null && bb.width[last] != null && bb.width[last] <= minW * 1.05)) {
    add({ id: 'bb|squeeze', name: 'Bollinger sıkışması', direction: 'neutral', strength: 0.35, zone: [bb.lower[last], bb.upper[last]], note: 'Volatilite daraldı (BB Keltner içinde / genişlik 100 mumun dibi): kırılım beklenir.', draw: [] });
  }
  // Sıkışma kırılımı: son 3 mumda sıkışma bitti ve kapanış bandın dışında
  if ((i = inRecent((k) => sq(k - 1) && !sq(k))) >= 0) {
    const up = closes[i] > bb.mid[i];
    add({ id: 'bb|release', name: `Sıkışma kırılımı ${up ? '↑' : '↓'}`, direction: up ? 'long' : 'short', strength: 0.5, zone: near(closes[i]), index: i, note: 'Sıkışma bitti; momentum yönü ' + (up ? 'yukarı' : 'aşağı') + '.', draw: [] });
  }
  if (closes[last] > bb.upper[last]) add({ id: 'bb|above', name: 'BB üst bant dışı', direction: 'short', strength: 0.2, zone: near(bb.upper[last]), note: 'Kapanış üst Bollinger bandının dışında (aşırı uzama).', draw: [] });
  if (closes[last] < bb.lower[last]) add({ id: 'bb|below', name: 'BB alt bant dışı', direction: 'long', strength: 0.2, zone: near(bb.lower[last]), note: 'Kapanış alt Bollinger bandının dışında (aşırı uzama).', draw: [] });

  // Supertrend dönüşü
  const st = ctx.supertrend;
  if ((i = inRecent((k) => st.dir[k] != null && st.dir[k - 1] != null && st.dir[k] !== st.dir[k - 1])) >= 0) {
    const up = st.dir[i] === 1;
    add({ id: 'st|flip', name: `Supertrend ${up ? '↑' : '↓'}`, direction: up ? 'long' : 'short', strength: 0.4, zone: near(st.line[i]), index: i, note: `Supertrend ${up ? 'yükselişe' : 'düşüşe'} döndü.`, draw: [{ kind: 'hline', price: st.line[last], color: up ? '#199e70' : '#e66767', label: 'Supertrend', style: 'dotted' }] });
  }

  // Donchian 20 kırılımı
  const dc = ctx.donchian;
  if ((i = inRecent((k) => dc.upper[k] != null && closes[k] > dc.upper[k])) >= 0) add({ id: 'dc|up', name: 'Donchian 20 kırılımı ↑', direction: 'long', strength: 0.4, zone: near(dc.upper[i]), index: i, note: 'Kapanış son 20 mumun en yükseğinin üstünde.', draw: [] });
  if ((i = inRecent((k) => dc.lower[k] != null && closes[k] < dc.lower[k])) >= 0) add({ id: 'dc|dn', name: 'Donchian 20 kırılımı ↓', direction: 'short', strength: 0.4, zone: near(dc.lower[i]), index: i, note: 'Kapanış son 20 mumun en düşüğünün altında.', draw: [] });

  // Ichimoku bulut
  const ic = ctx.ichimoku;
  if (ic.senkouA[last] != null && ic.senkouB[last] != null) {
    const top = Math.max(ic.senkouA[last], ic.senkouB[last]), bot = Math.min(ic.senkouA[last], ic.senkouB[last]);
    const prevTop = (k) => Math.max(ic.senkouA[k], ic.senkouB[k]), prevBot = (k) => Math.min(ic.senkouA[k], ic.senkouB[k]);
    if ((i = inRecent((k) => ic.senkouA[k - 1] != null && closes[k - 1] <= prevTop(k - 1) && closes[k] > prevTop(k))) >= 0) add({ id: 'ichi|up', name: 'Kumo kırılımı ↑', direction: 'long', strength: 0.45, zone: [bot, top], index: i, note: 'Kapanış Ichimoku bulutunun üstüne çıktı.', draw: [] });
    if ((i = inRecent((k) => ic.senkouA[k - 1] != null && closes[k - 1] >= prevBot(k - 1) && closes[k] < prevBot(k))) >= 0) add({ id: 'ichi|dn', name: 'Kumo kırılımı ↓', direction: 'short', strength: 0.45, zone: [bot, top], index: i, note: 'Kapanış Ichimoku bulutunun altına indi.', draw: [] });
    if ((i = inRecent((k) => crossUp(ic.tenkan, ic.kijun, k))) >= 0) add({ id: 'ichi|tk', name: 'Tenkan/Kijun ↑', direction: 'long', strength: 0.3, zone: near(ic.kijun[i]), index: i, note: 'Tenkan, Kijun üstüne çıktı.', draw: [] });
    if ((i = inRecent((k) => crossDn(ic.tenkan, ic.kijun, k))) >= 0) add({ id: 'ichi|tkd', name: 'Tenkan/Kijun ↓', direction: 'short', strength: 0.3, zone: near(ic.kijun[i]), index: i, note: 'Tenkan, Kijun altına indi.', draw: [] });
  }

  // RSI / Stoch RSI
  const r = ctx.rsi[last];
  if (r != null) {
    if (r <= 30) add({ id: 'rsi|os', name: `RSI ${r.toFixed(0)} aşırı satım`, direction: 'long', strength: 0.3, zone: near(price), note: 'RSI 30 altında.', draw: [] });
    if (r >= 70) add({ id: 'rsi|ob', name: `RSI ${r.toFixed(0)} aşırı alım`, direction: 'short', strength: 0.3, zone: near(price), note: 'RSI 70 üstünde.', draw: [] });
  }
  const sr = ctx.stochRsi;
  if ((i = inRecent((k) => sr.k[k] != null && sr.k[k - 1] != null && sr.k[k - 1] <= 20 && crossUp(sr.k, sr.d, k))) >= 0) add({ id: 'srsi|up', name: 'Stoch RSI ↑ (aşırı satımdan)', direction: 'long', strength: 0.3, zone: near(price), index: i, note: 'Stoch RSI 20 altından yukarı kesti.', draw: [] });
  if ((i = inRecent((k) => sr.k[k] != null && sr.k[k - 1] != null && sr.k[k - 1] >= 80 && crossDn(sr.k, sr.d, k))) >= 0) add({ id: 'srsi|dn', name: 'Stoch RSI ↓ (aşırı alımdan)', direction: 'short', strength: 0.3, zone: near(price), index: i, note: 'Stoch RSI 80 üstünden aşağı kesti.', draw: [] });

  // MACD kesişimi
  const m = ctx.macd;
  if ((i = inRecent((k) => crossUp(m.macd, m.signal, k))) >= 0) add({ id: 'macd|up', name: 'MACD ↑', direction: 'long', strength: m.macd[i] < 0 ? 0.35 : 0.25, zone: near(price), index: i, note: `MACD sinyal çizgisini yukarı kesti${m.macd[i] < 0 ? ' (sıfırın altında)' : ''}.`, draw: [] });
  if ((i = inRecent((k) => crossDn(m.macd, m.signal, k))) >= 0) add({ id: 'macd|dn', name: 'MACD ↓', direction: 'short', strength: m.macd[i] > 0 ? 0.35 : 0.25, zone: near(price), index: i, note: `MACD sinyal çizgisini aşağı kesti${m.macd[i] > 0 ? ' (sıfırın üstünde)' : ''}.`, draw: [] });

  // ADX
  const ax = ctx.adx;
  if (ax.adx[last] != null && ax.adx[last] >= 25) {
    const up = ax.pdi[last] > ax.mdi[last];
    add({ id: 'adx|trend', name: `ADX ${ax.adx[last].toFixed(0)} trend ${up ? '↑' : '↓'}`, direction: up ? 'long' : 'short', strength: 0.25, zone: near(price), note: `Güçlü trend (ADX ≥ 25), ${up ? '+DI' : '−DI'} baskın.`, draw: [] });
  }

  // Hacim patlaması
  const av = ctx.avgVolume[last];
  if (av && volumes[last] >= o.volSpike * av) {
    const up = closes[last] > ctx.opens[last];
    add({ id: 'vol|spike', name: `Hacim ×${(volumes[last] / av).toFixed(1)}`, direction: up ? 'long' : 'short', strength: 0.35, zone: [lows[last], highs[last]], note: `Son mum hacmi 20 mum ortalamasının ${(volumes[last] / av).toFixed(1)} katı (${up ? 'yükseliş' : 'düşüş'} mumu).`, draw: [] });
  }

  // VWAP (gün içi)
  const vw = ctx.vwap[last];
  if (vw != null && ctx.tfInfo.ms < 86400e3) {
    const above = price > vw;
    const dist = Math.abs(price - vw) / atrNow;
    if (dist <= 0.4) add({ id: 'vwap|touch', name: 'VWAP testi', direction: above ? 'long' : 'short', strength: 0.35, zone: near(vw), note: 'Fiyat günlük VWAP seviyesinde.', draw: [{ kind: 'hline', price: vw, color: '#5ea3f0', label: 'VWAP', style: 'dotted' }] });
  }

  // Hacim profili
  const vp = ctx.volumeProfile;
  if (vp) {
    const dPoc = Math.abs(price - vp.poc) / atrNow;
    if (dPoc <= 0.5) add({ id: 'vp|poc', name: 'POC seviyesi', direction: 'neutral', strength: 0.3, zone: near(vp.poc), note: 'Fiyat hacim profilinin kontrol noktasında (POC).', draw: [{ kind: 'hline', price: vp.poc, color: '#c98500', label: 'POC', style: 'dotted' }] });
    if (Math.abs(price - vp.vah) / atrNow <= 0.4) add({ id: 'vp|vah', name: 'Değer alanı üstü (VAH)', direction: 'short', strength: 0.3, zone: near(vp.vah), note: 'Fiyat değer alanının üst sınırında.', draw: [{ kind: 'hline', price: vp.vah, color: '#c98500', label: 'VAH', style: 'dotted' }] });
    if (Math.abs(price - vp.val) / atrNow <= 0.4) add({ id: 'vp|val', name: 'Değer alanı altı (VAL)', direction: 'long', strength: 0.3, zone: near(vp.val), note: 'Fiyat değer alanının alt sınırında.', draw: [{ kind: 'hline', price: vp.val, color: '#c98500', label: 'VAL', style: 'dotted' }] });
  }

  // Andrews pitchfork: son 3 ana pivot (P1, P2, P3); medyan P1'den (P2+P3)/2'ye; üst/alt dişler P2 ve P3'ten paralel.
  const mp = ctx.major;
  if (mp.length >= 3) {
    const [p1, p2, p3] = mp.slice(-3);
    const midI = (p2.i + p3.i) / 2, midP = (p2.price + p3.price) / 2;
    const slope = (midP - p1.price) / (midI - p1.i || 1);
    const at = (base, i) => base.price + slope * (i - base.i);
    const upper = at(p2.type === 'H' ? p2 : p3, last), lower = at(p2.type === 'L' ? p2 : p3, last);
    const median = p1.price + slope * (last - p1.i);
    const hitU = Math.abs(price - upper) / atrNow <= 0.4, hitL = Math.abs(price - lower) / atrNow <= 0.4, hitM = Math.abs(price - median) / atrNow <= 0.3;
    if (hitU || hitL || hitM) {
      add({ id: 'fork|touch', name: `Pitchfork ${hitM ? 'medyan' : hitU ? 'üst diş' : 'alt diş'}`, direction: hitU ? 'short' : hitL ? 'long' : 'neutral', strength: 0.3, zone: near(hitM ? median : hitU ? upper : lower),
        note: 'Fiyat Andrews pitchfork çizgisinde.',
        draw: [
          { kind: 'line', points: [{ i: p1.i, price: p1.price }, { i: last, price: median }], color: '#9085e9', label: 'Medyan', style: 'dashed' },
          { kind: 'line', points: [{ i: p2.i, price: p2.price }, { i: last, price: at(p2, last) }], color: '#9085e9', label: '', style: 'dotted' },
          { kind: 'line', points: [{ i: p3.i, price: p3.price }, { i: last, price: at(p3, last) }], color: '#9085e9', label: '', style: 'dotted' },
        ] });
    }
  }
  return out;
}
