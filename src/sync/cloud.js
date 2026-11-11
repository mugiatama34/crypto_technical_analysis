// ☁ Bulut kaydı: kullanıcının ÖZEL GitHub deposu (REST contents API) — takip listesi, gerçek işlemler gibi kişisel veri
// cihazlar arasında (telefon / iş / ev) aynı kalsın diye. Ana repo herkese açık olduğu için veri ona girmez.
// Ayar (repo + ince taneli token: yalnız o depoya Contents okuma/yazma) yalnız bu tarayıcının localStorage'ında durur.
// Belge biçimi: { items: [{ id, updatedAt, ... }], deleted: [id], updatedAt }. Birleştirme: id başına yeni updatedAt kazanır,
// silinenler (deleted) her iki taraftan düşer. Saf kısımlar test edilir (tests/cloud.test.js).
const CFG_KEY = 'cta-cloud-v1';
const API = 'https://api.github.com';

export function loadCloud() {
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return c && c.repo && c.token ? c : null; } catch { return null; }
}
export function saveCloud(cfg) {
  try { if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); else localStorage.removeItem(CFG_KEY); } catch { /* özel pencere */ }
}
export const validRepo = (r) => /^[\w.-]+\/[\w.-]+$/.test(String(r || '').trim());

const b64enc = (str) => { let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/** İki belgeyi birleştir (değişmez): id başına büyük updatedAt; silinenler birleşimi düşülür. */
export function mergeDocs(a, b) {
  const deleted = [...new Set([...(a?.deleted || []), ...(b?.deleted || [])])];
  const del = new Set(deleted), m = new Map();
  for (const it of [...(b?.items || []), ...(a?.items || [])]) {
    if (!it || !it.id || del.has(it.id)) continue;
    const cur = m.get(it.id);
    if (!cur || (it.updatedAt || 0) >= (cur.updatedAt || 0)) m.set(it.id, it);
  }
  const meta = { ...(b?.meta || {}), ...(a?.meta || {}) };
  return { items: [...m.values()].sort((x, y) => (y.addedAt || y.t || 0) - (x.addedAt || x.t || 0)), deleted: deleted.slice(-2000), meta };
}
const same = (x, y) => JSON.stringify({ i: x.items, d: x.deleted, m: x.meta }) === JSON.stringify({ i: y.items, d: y.deleted, m: y.meta });

const headers = (cfg) => ({ Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const url = (cfg, path) => `${API}/repos/${cfg.repo.trim()}/contents/${encodeURIComponent(path)}`;

/** Dosyayı oku → { doc, sha } (yoksa doc null). */
export async function pull(cfg, path, f = fetch) {
  const r = await f(`${url(cfg, path)}?t=${Date.now()}`, { headers: headers(cfg), cache: 'no-store' });
  if (r.status === 404) return { doc: null, sha: null };
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Token geçersiz ya da bu depoya izni yok' : `GitHub ${r.status}`);
  const j = await r.json();
  return { doc: JSON.parse(b64dec(j.content || '') || 'null'), sha: j.sha };
}
/** Yaz → yeni sha. Çakışma (409/422: başka cihaz önce yazdı) → err.conflict. */
export async function push(cfg, path, doc, sha, f = fetch) {
  const body = { message: `${path} güncellendi`, content: b64enc(JSON.stringify(doc)), ...(sha ? { sha } : {}) };
  const r = await f(url(cfg, path), { method: 'PUT', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) { const e = new Error('çakışma'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Token geçersiz ya da yazma izni yok' : `GitHub ${r.status}`);
  return (await r.json()).content?.sha;
}
/** Yerel belgeyi buluttakiyle birleştir, gerekiyorsa yaz; birleşik belgeyi döndür. Çakışmada 3 kez yeniden dener. */
export async function syncDoc(cfg, path, local, f = fetch) {
  for (let i = 0; i < 3; i++) {
    const { doc: remote, sha } = await pull(cfg, path, f);
    const merged = mergeDocs(local, remote);
    if (remote && same(merged, mergeDocs(remote, null))) return merged; // bulut zaten güncel
    try { await push(cfg, path, { ...merged, updatedAt: Date.now() }, sha, f); return merged; } catch (e) { if (!e.conflict) throw e; }
  }
  throw new Error('Bulut çakışması çözülemedi, birazdan tekrar dene');
}
/** Bağlantı testi: depo okunabiliyor mu (ve özel mi)? */
export async function testCloud(cfg, f = fetch) {
  const r = await f(`${API}/repos/${cfg.repo.trim()}`, { headers: headers(cfg) });
  if (!r.ok) throw new Error(r.status === 404 ? 'Depo bulunamadı (adı ya da token izni yanlış)' : `GitHub ${r.status}`);
  const j = await r.json();
  return { private: !!j.private, push: !!j.permissions?.push };
}
