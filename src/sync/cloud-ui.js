// ☁ Bulut kaydı ayar formu (index takip listesi + sinyal sayfası ortak). DOM içerir; mantık cloud.js'te.
import { loadCloud, saveCloud, testCloud, validRepo } from './cloud.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** el: kapsayıcı; onChange(cfg|null): kaydedildi/kaldırıldı. */
export function mountCloudForm(el, onChange) {
  const draw = (msg = '') => {
    const c = loadCloud();
    el.innerHTML = `<details class="cloud"><summary>☁ Bulut kaydı: ${c ? `<b>açık</b> (${esc(c.repo)})` : 'kapalı (veri yalnız bu tarayıcıda)'}</summary>
      <div class="cloud-body">
        <p class="note">Takip listesi ve gerçek işlemler <b>senin özel GitHub deponda</b> saklanır; telefon, iş ve ev bilgisayarında aynı görünür. Her cihazda bir kez gir. Token: GitHub → Settings → Developer settings → Fine-grained tokens → yalnız bu depo, <i>Contents: Read and write</i>.</p>
        <label>Depo <input type="text" id="cRepo" placeholder="kullanici/depo-adi" value="${esc(c?.repo || '')}" autocomplete="off"></label>
        <label>Token <input type="password" id="cToken" placeholder="github_pat_…" value="${esc(c?.token || '')}" autocomplete="off"></label>
        <div class="set-actions"><button type="button" class="btn" id="cSave">Kaydet ve eşitle</button>${c ? '<button type="button" class="btn" id="cOff">Bu cihazda kapat</button>' : ''}</div>
        <p class="note" id="cMsg">${esc(msg)}</p>
      </div></details>`;
    el.querySelector('#cSave').addEventListener('click', async () => {
      const cfg = { repo: el.querySelector('#cRepo').value.trim(), token: el.querySelector('#cToken').value.trim() };
      const m = el.querySelector('#cMsg');
      if (!validRepo(cfg.repo) || !cfg.token) { m.textContent = 'Depo "kullanici/depo" biçiminde ve token dolu olmalı.'; return; }
      m.textContent = 'Deneniyor…';
      try {
        const t = await testCloud(cfg);
        if (!t.private) { m.textContent = 'Bu depo HERKESE AÇIK — kişisel veri için özel (private) depo kullan.'; return; }
        if (!t.push) { m.textContent = 'Token bu depoya yazamıyor (Contents: Read and write gerekli).'; return; }
        saveCloud(cfg); draw('Bağlandı; eşitleniyor…'); el.querySelector('details').open = true; onChange?.(cfg);
      } catch (e) { m.textContent = `Olmadı: ${e.message}`; }
    });
    el.querySelector('#cOff')?.addEventListener('click', () => { saveCloud(null); draw('Bu cihazda kapatıldı (bulut verisi silinmedi).'); onChange?.(null); });
  };
  draw();
  return { status: (msg) => { const m = el.querySelector('#cMsg'); if (m) m.textContent = msg; } };
}
