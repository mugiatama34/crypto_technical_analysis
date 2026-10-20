// Ekran görüntüsü yorumu: görsel + odak → Anthropic Messages API (tarayıcıdan doğrudan, kullanıcının kendi anahtarı).
// Statik sayfa (build yok) olduğu için SDK yerine ham HTTP + SSE akışı kullanılır.
const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';

const FOCUS_PROMPT = {
  all: 'Grafiği bütün teknik analiz yöntemleriyle değerlendir: piyasa yapısı, destek/direnç, trend, formasyonlar, Fibonacci, Elliott Wave sayımı, ICT/SMC (BOS/CHoCH, FVG, order block, likidite), uyumsuzluklar, mum formasyonları.',
  ict: 'ICT / Smart Money Concepts odaklı değerlendir: swing yapısı (HH/HL/LH/LL), BOS ve CHoCH, premium/discount, OTE, FVG ve order block bölgeleri, eşit tepe/dip likiditesi ve süpürmeler, olası giriş modeli.',
  ew: 'Elliott Wave odaklı değerlendir: en olası dalga sayımı (itki 1-2-3-4-5 ya da düzeltme ABC / WXY / üçgen / diagonal), kural ihlalleri, alternatif sayım, geçersizlik seviyesi ve Fibonacci hedefleri.',
  fib: 'Fibonacci ve harmonik odaklı değerlendir: anlamlı bacakların geri çekilme/uzantı seviyeleri, çakışmalar, olası XABCD (Gartley, Bat, Butterfly, Crab, Cypher, Shark) ya da AB=CD kalıpları ve PRZ bölgesi.',
  pattern: 'Klasik formasyon odaklı değerlendir: omuz-baş-omuz, ikili/üçlü tepe-dip, üçgenler, wedge, bayrak/flama, kanal, fincan-kulp; boyun çizgisi, kırılım şartı ve ölçülü hareket hedefi.',
};

const SYSTEM = `Sen deneyimli bir kripto teknik analistisin. Kullanıcı bir grafik ekran görüntüsü paylaşıyor. Türkçe yanıt ver.
Yanıt biçimi (başlıklar halinde, kısa ve somut):
1) Grafikte ne görüyorsun (sembol/zaman dilimi okunabiliyorsa belirt, trend ve yapı).
2) Tespit edilen yapılar: her biri için fiyat seviyesi/bölgesi ve neden.
3) Senaryo: yükseliş ve düşüş senaryosu, hangi seviye hangisini geçersiz kılar.
4) Olası plan: giriş bölgesi, stop, hedefler ve R:R (varsayımlarını söyle).
5) Güven düzeyi ve eksik bilgi (daha yüksek zaman dilimi, hacim vb.).
Seviyeleri grafikteki eksen değerlerinden oku; emin olmadığın yerde yaklaşık olduğunu söyle. Bu yatırım tavsiyesi değildir; bunu tek cümleyle sonda belirt.`;

/** Görseli (Blob) base64'e çevirir. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * @param {{ apiKey, blob, focus, question, onText(text) , signal }} p
 * @returns {Promise<string>} tam metin
 */
export async function analyzeScreenshot({ apiKey, blob, focus = 'all', question = '', onText, signal }) {
  if (!apiKey) throw new Error('API anahtarı gerekli.');
  const data = await blobToBase64(blob);
  const mediaType = blob.type && /^image\/(png|jpeg|webp|gif)$/.test(blob.type) ? blob.type : 'image/png';
  const body = {
    model: MODEL,
    max_tokens: 4000,
    stream: true,
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: `${FOCUS_PROMPT[focus] || FOCUS_PROMPT.all}${question ? `\n\nKullanıcının sorusu: ${question}` : ''}` },
      ],
    }],
  };
  const res = await fetch(API, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || msg; } catch { /* yok */ }
    if (res.status === 401) msg = 'API anahtarı geçersiz (401).';
    if (res.status === 429) msg = 'İstek limiti aşıldı (429); biraz sonra tekrar dene.';
    throw new Error(msg);
  }
  // SSE akışı
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; onText?.(text); }
        else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw new Error(ev.error?.message || 'Akış hatası');
      }
    }
  }
  if (stop === 'refusal' && !text) throw new Error('Model bu isteği yanıtlamayı reddetti.');
  if (stop === 'max_tokens') text += '\n\n[Yanıt uzunluk sınırında kesildi.]';
  return text;
}
