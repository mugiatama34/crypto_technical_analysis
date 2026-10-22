// Ajan "beyni": karar (pozisyon aç/kapat/ayarla), yansıma (kapanan işlemden ders) ve gözden geçirme (dersleri süz,
// parametreleri güncelle). Ham HTTP (proje bağımlılıksız); şemalar json_schema ile zorlanır.
const API = 'https://api.anthropic.com/v1/messages';

const SYSTEM_DECIDE = `Sen sanal 300 USDT ile başlamış bir kripto vadeli işlem portföy yöneticisisin. Amacın hesabı büyütmek; ama hesabı
sıfırlamak oyunun sonudur, bu yüzden hayatta kalmak her zaman öncelik. Kararların tamamen sana ait: hangi adaya girileceği,
marjin (USDT), kaldıraç, piyasa mı limit mi, stop ve hedefler. Kodda sert sınırlar var (profile.guards); aşarsan kırpılır.
Girdide: hesap durumu, açık pozisyonlar (gerçekleşmemiş K/Z, likidasyon uzaklığı), bekleyen emirler, kural motorunun
adayları (sinyaller + plan), son işlemlerin ve yansımaların, derslerin, kendi parametrelerin, istatistiklerin.
İlkeler:
- Likidasyon mesafesi stop'tan daha yakınsa o kaldıraç yanlıştır. Stop her zaman likidasyonun içinde kalmalı.
- Korelasyonlu pozisyonlar (aynı yön, benzer coinler) riski katlar; toplam maruziyeti düşün.
- Derslerin ve istatistiklerin seni bağlar: kötü sonuç veren kalıpları tekrar etme, iyi olanları öne al.
- Açık pozisyonları da yönet: stop'u yapının arkasına taşı, hedefe yaklaşınca kısmi kapat, tez bozulduysa kapat.
- Aday yoksa ya da hiçbiri yeterince iyi değilse hiçbir şey yapma ('hold'); işlem yapmak zorunda değilsin.
- Piyasa bağlamı verilir: BTC rejimi (günlük kapanış vs EMA50) ve her adayın BTC'ye göre göreli gücü (rsBtc: oranın
  20 bardaki % değişimi; rsSide +1 güçlü / −1 zayıf). BTC düşüş rejiminde long'larda, yükseliş rejiminde short'larda
  ekstra ihtiyatlı ol; BTC'ye göre zayıf coinde long, güçlü coinde short için daha güçlü gerekçe iste.
- hedge=true ile açarsan aynı anda eşit nominalde TERS BTC bacağı açılır (aynı kaldıraç, stop yok, ana pozisyon kapanınca
  birlikte kapanır; marjin iki kat kullanılır, pozisyon sayısına girmez). Laboratuvar bulgusu: 4H kurulumlarının kazancı
  BTC'nin yönünden geliyordu; hedge BTC bahsini kaldırıp yalnız coin seçimine oynar. BTC'nin yönünden emin değilsen ya da
  coin BTC'ye göre güçlü/zayıf olduğu için seçiyorsan hedge'i düşün; BTC yönüne bilinçli oynuyorsan hedge'siz aç.
- Piyasa okuması (market.btcRead): BTC'nin günlük, 4H ve 1H eğilimi, ADX'leri, 4 ve 24 saatlik getirisi. BTC 4H/1H ufukta
  yön tutuyorsa en temiz ifade BTC'nin kendisinde pozisyondur: adaylarda source "btc_trend" (stop 2 ATR, hedef yok; stopu
  izleyerek yönet). BTC 4H düşüşteyken altcoin long açmak laboratuvarda ve bu hesabın istatistiğinde (dirStats.longWhileBtcDown)
  kaybettirdi; aynı mantıkla BTC 4H yükselişteyken altcoin short'a şüpheyle bak. Laboratuvar BTC 1H/4H trend takibini henüz
  doğrulamadı: küçük marjin ve izleyen stopla dene, sonuçlarından öğren.
- Her eylem için bir cümle gerekçe. Türkçe, kısa.`;

export const DECIDE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessment', 'actions'],
  properties: {
    assessment: { type: 'string', description: 'Piyasa ve hesap durumuna 1–3 cümle bakış' },
    actions: { type: 'array', description: 'En fazla 8 eylem', items: {
      type: 'object', additionalProperties: false,
      required: ['type', 'coin', 'direction', 'margin_usdt', 'leverage', 'order', 'limit_price', 'stop', 'tp1', 'tp2', 'position_id', 'hedge', 'rationale'],
      properties: {
        type: { type: 'string', enum: ['open', 'close', 'adjust', 'hold'] },
        coin: { type: 'string' }, direction: { type: 'string', enum: ['long', 'short', 'none'] },
        margin_usdt: { type: 'number' }, leverage: { type: 'number' },
        order: { type: 'string', enum: ['market', 'limit', 'none'] }, limit_price: { type: 'number' },
        stop: { type: 'number' }, tp1: { type: 'number' }, tp2: { type: 'number' },
        position_id: { type: 'string', description: 'close/adjust için; yoksa boş' },
        hedge: { type: 'boolean', description: 'open için: true ise aynı anda eşit nominalde ters BTC bacağı açılır (BTC bahsini kaldırır); diğer eylemlerde false' },
        rationale: { type: 'string' },
      } } },
  },
};
export const REFLECT_SCHEMA = { type: 'object', additionalProperties: false, required: ['lesson', 'tags'], properties: { lesson: { type: 'string', description: '2–3 cümle: ne oldu, neden, bir dahaki sefere ne farklı' }, tags: { type: 'array', items: { type: 'string' }, description: 'en fazla 4 etiket' } } };
export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lessons', 'params', 'summary'],
  properties: {
    summary: { type: 'string', description: 'Dönemin 2–4 cümlelik değerlendirmesi' },
    lessons: { type: 'array', description: 'en fazla 10 madde', items: { type: 'string' } },
    params: { type: 'object', additionalProperties: false, required: ['riskAppetite', 'preferredLeverage', 'maxMarginPctPerTrade', 'avoidTfs', 'avoidDetectors', 'notes'],
      properties: { riskAppetite: { type: 'string', enum: ['low', 'medium', 'high'] }, preferredLeverage: { type: 'array', items: { type: 'number' }, description: 'tam iki sayı: [min, max]' }, maxMarginPctPerTrade: { type: 'number' }, avoidTfs: { type: 'array', items: { type: 'string' } }, avoidDetectors: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } },
  },
};

async function call({ apiKey, model, system, user, schema, maxTokens = 3000, fetchImpl = fetch, effort = 'medium' }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY yok');
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, fallbacks: 'default', system, output_config: { format: { type: 'json_schema', schema }, effort }, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json())?.error?.message || m; } catch { /* yok */ } throw new Error(`Claude: ${m}`); }
  const j = await res.json();
  if (j.stop_reason === 'refusal') throw new Error('Claude reddetti');
  const out = JSON.parse((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  out._usage = j.usage; return out;
}

const posView = (p) => ({ id: p.id, coin: p.coin, tf: p.tf, direction: p.direction, hedgeOf: p.hedgeOf || null, hedged: !!p.hedge, leverage: p.leverage, margin: p.margin, entry: p.entry, last: p.lastPrice, unrealized: p.unrealized, unrealizedPct: p.margin ? +((p.unrealized / p.margin) * 100).toFixed(1) : 0, stop: p.stop, tp1: p.tp1, tp2: p.tp2, liq: p.liq, liqDistPct: p.lastPrice ? +((Math.abs(p.lastPrice - p.liq) / p.lastPrice) * 100).toFixed(2) : null, tp1Done: p.tp1Done, ageHours: +(((Date.now() - p.openedAt) / 3600e3).toFixed(1)), rationale: p.rationale });

/** Hesabın yön istatistiği: long/short kapanan işlem sayısı ve ort. R; BTC ters giderken long'ların ort. R'si. */
export function dirStatsOf(acct) {
  const T = acct.trades.filter((t) => !t.hedgeOf);
  const agg = (l) => ({ n: l.length, avgR: l.length ? +(l.reduce((a, t) => a + t.R, 0) / l.length).toFixed(2) : null, winRate: l.length ? +(l.filter((t) => t.pnl > 0).length / l.length).toFixed(2) : null });
  const longs = T.filter((t) => t.direction === 'long'), shorts = T.filter((t) => t.direction === 'short');
  const longBtcDown = longs.filter((t) => t.btcPct != null && t.btcPct < 0), longBtcUp = longs.filter((t) => t.btcPct != null && t.btcPct >= 0);
  return { long: agg(longs), short: agg(shorts), longWhileBtcDown: agg(longBtcDown), longWhileBtcUp: agg(longBtcUp) };
}

export function decidePrompt(acct, profile, candidates, stats, market = {}) {
  const payload = {
    profile: { id: profile.id, guards: profile.guards },
    market: { btcRegimeDaily: market.regime === 'up' ? 'yükseliş' : market.regime === 'down' ? 'düşüş' : 'bilinmiyor', btcPrice: market.btcPrice ?? null, btcRead: market.read ? { daily: market.read.daily, h4: market.read.h4, h1: market.read.h1, adx4h: market.read.adx4h, adx1h: market.read.adx1h, ret4h: market.read.ret4h, ret24h: market.read.ret24h, summary: market.read.summary } : null },
    dirStats: dirStatsOf(acct),
    account: { equity: acct.equity, cash: acct.cash, startEquity: acct.startEquity, returnPct: stats.returnPct, dayHalted: acct.day.halted, openPositions: acct.positions.length, pendingOrders: acct.orders.length },
    stats: { trades: stats.trades, winRate: stats.winRate, avgR: stats.avgR, profitFactor: stats.profitFactor, maxDD: stats.maxDD, liquidations: stats.liquidations },
    params: acct.params, lessons: acct.lessons,
    positions: acct.positions.map(posView),
    orders: acct.orders.map((o) => ({ id: o.id, coin: o.coin, direction: o.direction, price: o.price, margin: o.margin, leverage: o.leverage, stop: o.stop, expiresAt: new Date(o.expiresAt).toISOString() })),
    recentTrades: acct.trades.slice(-15).map((t) => ({ coin: t.coin, tf: t.tf, direction: t.direction, leverage: t.leverage, outcome: t.outcome, R: t.R, pnl: t.pnl, reflection: t.reflection })),
    candidates: candidates.map((p) => ({ coin: p.coin, tf: p.tf, direction: p.direction, source: p.source || 'scanner', score: p.score, mtf: p.mtf?.tfs || null, price: p.price, atr: p.atr, zone: p.zone, inZone: p.inZone, plan: { entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, rr: p.rr, riskPct: p.riskPct }, rsBtc: p.trend?.rsBtc ?? null, rsSide: p.trend?.rsSide ?? null, adx: p.trend?.adx ?? null, signals: p.signals.map((s) => `${s.name} (${s.group}, ${s.direction}, güç ${s.strength})`), htf: p.htf || [] })),
    time: new Date().toISOString(),
  };
  return `Durumu değerlendir ve eylemleri şemaya göre döndür. Pozisyon açarken coin, direction, margin_usdt, leverage, order (market|limit), limit_price (limit ise), stop, tp1, tp2, hedge (true/false) doldur; close/adjust için position_id. Kullanılmayan sayısal alanlara 0, metin alanlara "" ver.\n\n${JSON.stringify(payload, null, 1)}`;
}

export const decide = (acct, profile, candidates, stats, opts, market = {}) => call({ ...opts, system: SYSTEM_DECIDE, user: decidePrompt(acct, profile, candidates, stats, market), schema: DECIDE_SCHEMA, maxTokens: 4000 });

export const reflect = (trade, acct, opts) => call({
  ...opts, system: 'Sen kendi işlemlerini dürüstçe değerlendiren bir trader\'sın. Türkçe, kısa, somut; bahane değil ders.',
  user: `Kapanan işlem:\n${JSON.stringify({ coin: trade.coin, tf: trade.tf, direction: trade.direction, leverage: trade.leverage, margin: trade.margin, entry: trade.entry, stop: trade.stop, tp1: trade.tp1, tp2: trade.tp2, outcome: trade.outcome, R: trade.R, pnl: trade.pnl, pnlPct: trade.pnlPct, holdHours: +(((trade.closedAt - trade.openedAt) / 3600e3).toFixed(1)), btcPctDuringTrade: trade.btcPct ?? null, rationale: trade.rationale, signals: trade.signals, notes: trade.notes }, null, 1)}\n\nMevcut dersler: ${JSON.stringify(acct.lessons)}\nBu işlemden çıkan dersi yaz.`,
  schema: REFLECT_SCHEMA, maxTokens: 800, effort: 'low',
});

export const review = (acct, profile, stats, opts) => call({
  ...opts, system: 'Sen kendi performansını gözden geçirip kurallarını güncelleyen bir portföy yöneticisisin. Sert sınırları (guards) aşan parametre öneremezsin. Türkçe, somut.',
  user: `Profil ve sınırlar: ${JSON.stringify({ id: profile.id, guards: profile.guards })}\nİstatistik: ${JSON.stringify(stats)}\nMevcut parametreler: ${JSON.stringify(acct.params)}\nMevcut dersler: ${JSON.stringify(acct.lessons)}\nSon işlemler ve yansımalar: ${JSON.stringify(acct.trades.slice(-30).map((t) => ({ coin: t.coin, tf: t.tf, direction: t.direction, leverage: t.leverage, outcome: t.outcome, R: t.R, pnlPct: t.pnlPct, btcPct: t.btcPct ?? null, hedged: !!t.hedge, hedgeLeg: !!t.hedgeOf, signals: t.signals?.slice(0, 5), reflection: t.reflection })))}\n\nDersleri süz (en fazla 10, tekrarları birleştir, kanıtsızları at), parametreleri güncelle (riskAppetite, preferredLeverage [min,max] ≤ guards.maxLeverage, maxMarginPctPerTrade ≤ guards.maxMarginPct, avoidTfs, avoidDetectors, notes) ve dönemi özetle.`,
  schema: REVIEW_SCHEMA, maxTokens: 2500,
});

/** Review çıktısını sert sınırlara göre kırpar. */
export function clampParams(params, guards) {
  const p = { ...params };
  p.preferredLeverage = [Math.max(1, Math.min(guards.maxLeverage, Math.round(p.preferredLeverage?.[0] || 1))), Math.max(1, Math.min(guards.maxLeverage, Math.round(p.preferredLeverage?.[1] || 1)))].sort((a, b) => a - b);
  p.maxMarginPctPerTrade = Math.max(1, Math.min(guards.maxMarginPct, +p.maxMarginPctPerTrade || guards.maxMarginPct));
  p.avoidTfs = (p.avoidTfs || []).slice(0, 3); p.avoidDetectors = (p.avoidDetectors || []).slice(0, 6);
  return p;
}
