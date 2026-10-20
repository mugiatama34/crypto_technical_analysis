// "Beyin": aday planı ve sinyal özetini Claude'a verir, yapılandırılmış işlem değerlendirmesi alır,
// risk kurallarına göre doğrular. Proje bilinçli olarak bağımlılıksız (package.json yok); bu yüzden
// Anthropic SDK yerine ham HTTP (Node 22 fetch) kullanılır.

const API = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-opus-5-5';

export const SYSTEM = `Sen disiplinli bir kripto vadeli işlem analistisin. Otomatik bir tarayıcı, bir sembol için birden çok teknik analiz
yöntemiyle (ICT/SMC, Elliott Wave, Fibonacci, harmonik, klasik formasyon, uyumsuzluk, Wyckoff, indikatörler) bulduğu
sinyalleri ve kural motorunun önerdiği planı veriyor. Görevin: bu setup gerçekten girilmeye değer mi karar vermek.

Kurallar:
- Sinyaller birbirini TEYİT ediyor mu, yoksa aynı şeyi tekrar mı ediyor (ör. aynı bölgede üç fib seviyesi tek kanıt sayılır)?
- Yüksek zaman dilimi bağlamı (htf alanı) karşı yöndeyse ya da fiyat trendin tersine işlem öneriyorsa güven düşer.
- Stop, yapının arkasında olmalı (bölge/geçersizlik seviyesinin ötesi); hedefler ulaşılabilir likidite/yapı seviyeleri olmalı.
- "take" yalnızca: en az iki bağımsız yöntem aynı bölgeyi işaret ediyor, geçersizlik net, R:R (tp2) ≥ min_rr.
- "wait": setup iyi ama tetik yok (fiyat bölgeye gelmedi, kırılım onaylanmadı, mum teyidi yok).
- "skip": çelişkili, geç kalınmış, zayıf ya da yapısal olarak anlamsız.
- Seviyeleri verilen planın yakınında tut; değiştirirsen gerekçesini reason'da bir cümleyle söyle.
- Türkçe, somut, kısa; satış dili yok. Yatırım tavsiyesi değildir uyarısı yazma (sistem ekler).`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['trade', 'direction', 'entry_low', 'entry_high', 'stop', 'tp1', 'tp2', 'confidence', 'reason', 'invalidation', 'evidence'],
  properties: {
    trade: { type: 'string', enum: ['take', 'wait', 'skip'] },
    direction: { type: 'string', enum: ['long', 'short'] },
    entry_low: { type: 'number' }, entry_high: { type: 'number' },
    stop: { type: 'number' }, tp1: { type: 'number' }, tp2: { type: 'number' },
    confidence: { type: 'string', enum: ['düşük', 'orta', 'yüksek'] },
    reason: { type: 'string', description: '3–5 cümle: neden bu karar, hangi yapılar teyit ediyor, risk nerede' },
    invalidation: { type: 'string', description: 'Tek cümle: hangi fiyat davranışı planı iptal eder' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'En fazla 5 madde: teyit eden bağımsız kanıtlar' },
  },
};

/** Claude'a gidecek kullanıcı metni (JSON). */
export function buildPrompt(plan, context) {
  const payload = {
    symbol: `${plan.coin}USDT perp`, timeframe: plan.tf, direction: plan.direction,
    price: plan.price, atr: plan.atr, cluster_score: plan.clusterScore, mtf: plan.mtf,
    proposed_plan: { entry_zone: plan.zone, entry: plan.entry, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, rr_tp1: plan.rr1, rr_tp2: plan.rr, risk_pct_of_price: plan.riskPct, status: plan.status },
    rules: { min_rr: context.minRR, risk_per_trade_pct: context.riskPct },
    signals: plan.signals.map((s) => ({ name: s.name, group: s.group, dir: s.direction, strength: s.strength, status: s.status, zone: s.zone, note: s.note })),
    htf: context.htf || [], // [{tf, direction, score, top: [...]}]
    other_clusters: context.others || [],
  };
  return `Aşağıdaki setup'ı değerlendir ve şemaya uygun JSON döndür.\n\n${JSON.stringify(payload, null, 1)}`;
}

/**
 * Claude çağrısı. fetchImpl test için enjekte edilebilir.
 * @returns {Promise<object>} şemaya uygun karar
 */
export async function askBrain(plan, context, { apiKey, fetchImpl = fetch, model = MODEL, signal } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY yok');
  const body = {
    model,
    max_tokens: 3000,
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'medium' },
    messages: [{ role: 'user', content: buildPrompt(plan, context) }],
  };
  const res = await fetchImpl(API, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* yok */ }
    throw new Error(`Claude: ${msg}`);
  }
  const json = await res.json();
  if (json.stop_reason === 'refusal') throw new Error('Claude isteği reddetti');
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  out._usage = json.usage; out._model = json.model;
  return out;
}

/**
 * Karar doğrulama: yön, stop tarafı, R:R, giriş bölgesinin plana yakınlığı. Kural bozulursa
 * seviyeler kural motorununkine döner ve `adjusted` listesine yazılır.
 */
export function validateDecision(dec, plan, { minRR = 2, sendWait = 'high' } = {}) {
  const adjusted = [];
  const d = plan.d;
  const out = { ...dec };
  if (dec.direction !== plan.direction) { out.direction = plan.direction; adjusted.push('yön'); }
  let lo = Math.min(dec.entry_low, dec.entry_high), hi = Math.max(dec.entry_low, dec.entry_high);
  const near = (x, ref) => Math.abs(x - ref) <= 1.5 * plan.atr;
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || !near((lo + hi) / 2, (plan.zone[0] + plan.zone[1]) / 2)) { lo = plan.zone[0]; hi = plan.zone[1]; adjusted.push('giriş bölgesi'); }
  const entry = plan.inZone ? plan.price : d === 1 ? hi : lo;
  let stop = dec.stop;
  if (!Number.isFinite(stop) || d * (entry - stop) <= 0 || d * (entry - stop) > 4 * plan.atr) { stop = plan.stop; adjusted.push('stop'); }
  const risk = d * (entry - stop);
  let tp1 = dec.tp1, tp2 = dec.tp2;
  if (!Number.isFinite(tp1) || d * (tp1 - entry) <= 0) { tp1 = plan.tp1; adjusted.push('tp1'); }
  if (!Number.isFinite(tp2) || d * (tp2 - tp1) <= 0) { tp2 = plan.tp2; adjusted.push('tp2'); }
  let rr = (d * (tp2 - entry)) / risk;
  if (rr < minRR) { stop = plan.stop; tp1 = plan.tp1; tp2 = plan.tp2; adjusted.push('R:R'); rr = (d * (tp2 - entry)) / (d * (entry - stop)); }
  const rr1 = (d * (tp1 - entry)) / (d * (entry - stop));
  // sendWait: 'none' (yalnız take) | 'high' (wait yalnız yüksek güvenle) | 'medium' (orta ve yüksek)
  const waitOk = out.trade === 'wait' && (sendWait === 'medium' ? out.confidence !== 'düşük' : sendWait === 'high' ? out.confidence === 'yüksek' : false);
  const sendable = out.trade === 'take' || waitOk;
  return { ...out, entry_low: lo, entry_high: hi, entry, stop, tp1, tp2, rr: +rr.toFixed(2), rr1: +rr1.toFixed(2), adjusted, sendable, evidence: (dec.evidence || []).slice(0, 5) };
}
