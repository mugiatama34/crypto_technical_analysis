#!/usr/bin/env node
// Ön kayıtlı ölçüm (Aşama A): "PSL AI" tarzı 8 ölçütlü puan ≥ 6 + 1D EMA50/169 uyumu, 4H (docs/arastirma/on-kayit-psl-ai.md)
// → docs/backtest/psl.json. Bugünün OKX hacminde ilk 50 USDT sürekli vadelisi, sinyal mumu kapanışı 20.11.2024–20.11.2026 UTC.
// Karar satırı + bilgi satırları (eşik 5 / 7, üst TF şartsız, long / short, 1H, yazarın muhasebesi, 4 hedef, kümelenme). Saf kısım: psl.js.
//   node backtest/psl.mjs                                                         (tam koşu, yerel)
//   node backtest/psl.mjs --clone                                                 (Aşama B klon: psl.json'a 'clone' anahtarı; Aşama A alanları aynen)
//   node backtest/psl.mjs --coins BTC,ETH --out /tmp/x --cache /tmp/c --no1h      (deneme; yorumlanmaz)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../src/data/okx.js';
import { getHistoryCached } from './data.js';
import zlib from 'node:zlib';
import { PSL, DAY, ROWS, indicatorsOf, dailyOf, runSeries, simFor, pslReport, CLONE, htfOf, runClone, cloneRecord, cloneValidation, cloneReport } from './psl.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${k}`) ? true : d); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export const UNSTATED = [
  'Dönem: sinyal mumunun KAPANIŞ zamanı [20.11.2024 00:00, 20.11.2026 00:00) UTC (bitiş hariç); eğitim / doğrulama sınırı kapanış zamanının takvim aralığının 2/3 noktası.',
  'Ölçüt aralıkları AÇIK: RSI (50, 70) / (30, 50), %K (50, 80) / (20, 50), CCI (0, 150) / (−150, 0); sınır değeri (ör. RSI tam 50, CCI tam 0) hiçbir tarafa oy vermez. Göreli hacim > 1,2 ve ADX > 20 kesin büyük. MACD = sinyal, kapanış = açılış, EMA50 = EMA169, DI+ = DI− → oy yok. Göstergesi henüz hesaplanmamış ölçüt oy vermez.',
  'Göreli hacim = bu mumun hacmi ÷ SMA20(hacim, bu mum dahil); hacim OKX "vol" alanı (sözleşme adedi; oran birimden bağımsız).',
  'Long > short eşitliği: eşit puanda sinyal yok (eşik ≥ 5 iken zaten imkânsız).',
  '1D uyumu: sinyal anında (4H mum kapanışı T) açılışı + 1 gün ≤ T olan son 1D mum (00:00 UTC\'de kapanan 4H mumunda o anda kapanan 1D mum dahil); o mumda ≥ 200 kapanmış 1D mum yoksa ya da EMA50 = EMA169 ise sinyal yok. 1D geçmişi coin\'in OKX\'teki ilk gününden indirildi (EMA169 tohumlama etkisi küçülsün).',
  'Isınma: 4H / 1H serisinin ilk 300 mumunda sinyal yok (sinyal mumundan önce ≥ 300 mum); 4H 200 gün, 1H 60 gün önceden indirildi. Üst TF şartsız satırda 1D ısınması aranmaz.',
  'Plan seviyeleri sinyal mumunun KAPANIŞINDAN: stop = kapanış ∓ 1,5 × ATR14 (sinyal mumu dahil, Wilder); TP1 / TP2 = kapanış ± 1 / 2 × (1,5 ATR). Dolum = sonraki mumun açılışı ± %0,05 kayma (motorun piyasa girişi); R gerçek dolum fiyatına göre (kayma TP mesafesini biraz kısaltır).',
  'Süre sınırı yok (motor maxHoldBars = ∞); veri sonunda açık kalan işlem son kapanmış mumun kapanışından (kayma dahil) kapatılır (openAtEnd sayısı raporda).',
  'Kilit: aynı coin + yönde işlem çıkış mumuna kadar açık sayılır; çıkış mumunun kapanışında yeni sinyal serbest. Ters yönde sinyal, açık işlemi kapatmadan ayrı işlem açar.',
  'Gerçekçi satırlarda TP1 mumunda girişe taşınan stop sonraki mumdan geçerli (motorla aynı); 4 hedef düzeninde de taşınan stop sonraki mumdan.',
  '4 hedef düzeni: kısmi çıkış yok; TP1 geçilince stop girişe, TPk geçilince TP(k−1)\'e; TP4\'te tam çıkış. Kendi kilidiyle (kendi işlem süreleri) — karar satırıyla aynı sinyal listesi değil. Hedge tam pozisyon için (tp1Bars yok).',
  'Yazarın muhasebesi: karar satırının sinyal listesi aynen; giriş sonraki mumun açılışı (kaymasız), hedef fitille ve mum içinde önce; stop yalnız kapanış stopun ötesindeyse, çıkış stop seviyesinden; aynı mumda TP1 + stop kapanışı → TP1 (+%50) ve kalan girişe taşınan stoptan (o kapanış girişin de ötesindeyse). Komisyon taraf başına %0,025; hedge bacağı da aynı oranla.',
  'Hedge\'li R: sweep.mjs hedgeOf aynen (BTC başlangıcı dolum mumunun kapanışı, bitiş çıkış mumunun kapanışı; açılıştan hedge hedgedOpenAvgR olarak bilgi). 1H satırında BTC 1H mumları.',
  'Evren: getTopCoins(50) koşu anındaki 24 s hacmi; dönemde ısınma sonrası 4H mumu olmayan coin atlanır.',
];

async function main() {
  const t0 = Date.now();
  const CFG = {
    top: +arg('top', PSL.top), out: String(arg('out', 'docs/backtest')), cacheDir: String(arg('cache', 'backtest/cache/psl')),
    coins: arg('coins', '') ? String(arg('coins')).split(',').map((c) => c.trim().toUpperCase()) : null, no1h: !!arg('no1h', false),
  };
  const trial = !!(CFG.coins || CFG.top !== PSL.top || CFG.no1h);
  if (trial && path.resolve(CFG.out) === path.resolve('docs/backtest')) { console.error('Deneme koşusu docs/backtest\'e yazmaz: --out <geçici klasör> ver.'); process.exit(2); }
  const period = PSL.period, now = Date.now();
  const coins = CFG.coins ? CFG.coins.map((c) => ({ coin: c, instId: instIdOf(c) })) : await getTopCoins(CFG.top, {});
  log(`PSL Aşama A: ${coins.length} coin${trial ? ' (DENEME)' : ''}`);
  const ranges = { '1D': [Date.UTC(2017, 0, 1), now], '4H': [period.from - 200 * DAY, now], '1H': [period.from - 60 * DAY, now] };
  const get = (instId, tf) => getHistoryCached(instId, tf, ...ranges[tf], { cacheDir: CFG.cacheDir, onRetry: (r) => log('retry', r.path, r.attempt) });
  const btc = { '4H': await get(instIdOf('BTC'), '4H'), '1H': CFG.no1h ? null : await get(instIdOf('BTC'), '1H') };
  const rows = Object.fromEntries(Object.keys(ROWS).filter((k) => !ROWS[k].of).map((k) => [k, []]));
  const coverage = {}, skipped = {};
  for (const c of coins) {
    const tc = Date.now();
    let daily, c4;
    try { daily = await get(c.instId, '1D'); c4 = c.coin === 'BTC' ? btc['4H'] : await get(c.instId, '4H'); } catch (e) { log(`  ${c.coin}: ${e.message}`); skipped[c.coin] = e.message; continue; }
    const inP = (cs, tf) => cs.filter((x, i) => i >= PSL.warmBars && x.time + TIMEFRAMES[tf].ms >= period.from && x.time + TIMEFRAMES[tf].ms < period.to).length;
    if (inP(c4, '4H') === 0) { log(`  ${c.coin}: ${c4.length} 4H mum, ısınma sonrası dönemde mum yok (atlandı)`); skipped[c.coin] = `${c4.length} 4H mum`; continue; }
    const D = dailyOf(daily), ind4 = indicatorsOf(c4);
    const base = { coin: c.coin, daily: D, period };
    const per = {};
    for (const [k, def] of Object.entries(ROWS)) {
      if (def.of || def.tf !== '4H' || def.sameSignalsAs) continue;
      per[k] = runSeries(c4, { ...base, tf: '4H', ind: ind4, threshold: def.threshold, requireTrend: def.requireTrend, sim: simFor(def.sim, c4, '4H'), btc: btc['4H'] });
      rows[k].push(...per[k].trades);
    }
    const au = runSeries(c4, { ...base, tf: '4H', ind: ind4, signals: per.primary.signals, sim: simFor('author', c4, '4H'), btc: btc['4H'], hedgeFee: PSL.authorCost.fee });
    rows.author.push(...au.trades);
    let n1 = 0, c1len = 0;
    if (!CFG.no1h) {
      try {
        const c1 = c.coin === 'BTC' ? btc['1H'] : await get(c.instId, '1H');
        c1len = c1.length;
        if (inP(c1, '1H') > 0) {
          const r1 = runSeries(c1, { ...base, tf: '1H', ind: indicatorsOf(c1), threshold: ROWS.h1.threshold, requireTrend: true, sim: simFor('engine', c1, '1H'), btc: btc['1H'] });
          rows.h1.push(...r1.trades); n1 = r1.trades.length;
        }
      } catch (e) { log(`  ${c.coin} 1H: ${e.message}`); skipped[`${c.coin} 1H`] = e.message; }
    }
    coverage[c.coin] = { d1: daily.length, d1From: daily[0]?.time ?? null, h4: c4.length, h4From: c4[0].time, h4To: c4[c4.length - 1].time, h1: c1len, inPeriod4h: inP(c4, '4H'),
      signals: Object.fromEntries(Object.entries(per).map(([k, r]) => [k, r.trades.length])), h1Signals: n1 };
    log(`  ${c.coin.padEnd(8)} 1D ${String(daily.length).padStart(4)} · 4H ${String(c4.length).padStart(5)} · 1H ${String(c1len).padStart(6)} → karar ${per.primary.trades.length} sinyal (${Math.round((Date.now() - tc) / 1000)} sn)`);
  }
  const rep = pslReport(rows, period);
  const out = {
    meta: {
      prereg: PSL.prereg, trial, period, tf: PSL.tf, infoTf: PSL.infoTf, top: CFG.top, coins: coins.map((c) => c.coin), threshold: PSL.threshold, infoThresholds: PSL.infoThresholds,
      indicators: PSL.ind, warmBars: PSL.warmBars, warmDays: PSL.warmDays, plan: { stopAtr: PSL.stopAtr, tpR: PSL.tpR, tp1Portion: PSL.tp1Portion, ladderR: PSL.ladderR, scheme: 'half_be (motor simulateTrade, piyasa girişi)' },
      cost: { ...PSL.cost, fundingPct8h: 0 }, authorCost: PSL.authorCost, fetch: ranges,
      criterion: 'karar satırı (4H, puan ≥ 6, 1D uyumu, gerçekçi): eğitim ve doğrulamada ort. R > 0, PF > 1,1, hedge\'li R > 0; dilim başına dolan n ≥ 100 (yoksa sonuçsuz)',
      generatedAt: null,
    },
    unstatedChoices: UNSTATED,
    series: Object.keys(coverage).length, skipped, coverage, btcBars: { '4H': btc['4H']?.length || 0, '1H': btc['1H']?.length || 0 },
    ...rep,
  };
  if (trial) out.meta.warning = 'DENEME KOŞUSU: biçim kontrolü; sayılar yorumlanmaz.';
  out.meta.generatedAt = Date.now(); out.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  const file = path.join(CFG.out, 'psl.json');
  fs.mkdirSync(CFG.out, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const p = out.groups.primary;
  log(`Bitti: ${out.meta.elapsedSec} sn → ${file}; karar n eğ ${p.train.n} / doğr ${p.valid.n} → ${out.result}`);
}

export const CLONE_UNSTATED = [
  'Üst TF mumları: haftalık (Pazartesi 00:00 UTC) ve aylık (takvim ayı UTC) mumlar OKX 1D mumlarından toplandı (açılış ilk gün, tepe / dip uç, kapanış son gün, hacim toplam); yalnız kapanışı ≤ sinyal anı olan mum kullanılır. Coin\'in ilk (kısmi) haftası / ayı da mum sayılır. 1D: açılışı + 1 gün ≤ T.',
  'Üst TF yönü: o mumda 8 ölçütlü puanın long > short → AL, short > long → SAT; eşitse uyumlu değil. Hesaplanamayan ölçüt (ör. aylıkta EMA169) oy vermez; Aşama A\'nın sınır kuralları (açık aralıklar) aynen. Üst TF\'de eşik yok (yalnız büyük taraf).',
  '"Yön terse dönerse": madde 1\'e göre ters yön sinyali (ters taraf ≥ 6 ve büyük). Puanın 6\'nın altına inmesi planı iptal etmez. "Uyum bozulursa": üç üst TF\'den biri plan yönünde değil. Plana süre sınırı yok.',
  'Bir mumda sıra: önce iptal kontrolü, sonra tetik (kapanış seviyenin ötesinde → o kapanıştan giriş); iptal edilen mumda koşullar sağlanıyorsa yeni plan aynı mumda oluşabilir. Plan oluştuğu mumda tetiklenemez (seviye o mumu içerir).',
  'Durum makinesi her coinde ısınmadan (ilk 300 mum) sonra tüm seri boyunca koşar; dönem filtresi tetik mumunun KAPANIŞINA (= giriş) uygulanır [20.11.2024, 20.11.2026). Bölme 2/3, tetik kapanışına göre.',
  'Açık işlem çıkış mumuna kadar coinde yeni plan engeller (kilit KARAR muhasebesinin çıkışına göre); çıkış mumunun kapanışında yeni plan serbest. Yazarın muhasebesi satırı aynı işlemleri (aynı tetikler) kendi çıkışıyla yazar.',
  'Hedefler fitille, sırayla; bir mumda birden çok hedef geçilebilir. Bizim muhasebe: önce mum başındaki stopa göre kapanış (aynı mumda hedef + stop → stop); hedefler stopu taşıdıktan sonra kapanış taşınmış stopun ötesindeyse de o kapanıştan çıkış (dokunuş kapanıştan önce olduğu için nedensel). Yazar: hedefler önce, kapanış taşınmış stopun ötesindeyse stop seviyesinden.',
  'Kayma: giriş (tetik kapanışı) ve stop çıkışı (kapanış) aleyhe %0,05; hedef çıkışları limit, kaymasız. Komisyon 2 × fee × giriş. R birimi |seviye − geçersiz| = 2 ATR (gerçek giriş seviyenin ötesinde olduğundan stopta kayıp genelde > 1R).',
  'Hedge\'li R: sweep.mjs hedgeOf aynen; BTC başlangıcı tetik mumunun kapanışı (= giriş), bitiş çıkış mumunun kapanışı; kısmi çıkış yok (tam pozisyon); R birimine çevirmek için hedgeOf\'a stop = giriş ∓ 2 ATR verilir. Yazar satırında hedge komisyonu %0,025.',
  'Veri sonunda açık kalan işlem son kapanmış mumun kapanışından (kayma dahil). Aşama A ile aynı evren (psl.json meta.coins) ve aynı önbellek mumları.',
  'Doğrulama: betik tablosundaki saatler (UTC+3) mum AÇILIŞI sayıldı → UTC; klonun tetik mumu açılışıyla aynı yön ve ± 1 mum içinde eşleşme (tek tek, en yakın). Fazladan işlem = [ilk − 1 mum, son + 1 mum] aralığında eşleşmeyen klon tetikleri. Panel karşılaştırması: önbellekteki BTC 4H serisinin son 3000 mumunda tetiklenen işlemler ve TP1\'e (fitil) ulaşanların payı (betik görüntüsünün alındığı an bilinmiyor; OKX ↔ Bitget fitil farkı).',
];

const loadCached = (dir, instId, tf) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, `${instId}_${tf}.json.gz`))).toString()).candles; } catch { return null; } };

async function cloneMain() {
  const t0 = Date.now();
  const file = String(arg('file', 'docs/backtest/psl.json')), cacheDir = String(arg('cache', 'backtest/cache/psl'));
  const raw = fs.readFileSync(file, 'utf8'), base = JSON.parse(raw);
  const coins = base.meta.coins;
  const get = async (instId, tf) => loadCached(cacheDir, instId, tf) || getHistoryCached(instId, tf, tf === '1D' ? Date.UTC(2017, 0, 1) : PSL.period.from - 200 * DAY, Date.now(), { cacheDir });
  const btc4 = await get(instIdOf('BTC'), '4H');
  const recs = { real: [], author: [] }, coverage = {}, skipped = {};
  let validation = null;
  for (const coin of coins) {
    const instId = instIdOf(coin);
    let daily, c4;
    try { daily = await get(instId, '1D'); c4 = coin === 'BTC' ? btc4 : await get(instId, '4H'); } catch (e) { skipped[coin] = e.message; continue; }
    if (!daily?.length || !c4 || c4.length <= PSL.warmBars) { skipped[coin] = `${c4?.length || 0} 4H mum`; continue; }
    const htf = htfOf(daily), ind = indicatorsOf(c4);
    const r = runClone(c4, { tf: '4H', ind, htf, accts: ['real', 'author'] });
    const real = r.trades.map((x) => cloneRecord(c4, coin, '4H', x, 'real', btc4));
    const au = r.trades.map((x) => cloneRecord(c4, coin, '4H', x, 'author', btc4));
    recs.real.push(...real); recs.author.push(...au);
    coverage[coin] = { h4: c4.length, d1: daily.length, trades: r.trades.length, cancelled: r.cancelled, pending: !!r.pending };
    if (coin === 'BTC') {
      const v = cloneValidation(real);
      const last = real.filter((t) => t.trigTime >= c4[Math.max(0, c4.length - CLONE.panel.bars)].time);
      v.panel = { script: CLONE.panel, clone: { bars: CLONE.panel.bars, from: c4[Math.max(0, c4.length - CLONE.panel.bars)].time, to: c4[c4.length - 1].time, trades: last.length, tp1Reached: last.filter((t) => t.tp1Reached).length, tp1Rate: last.length ? +(last.filter((t) => t.tp1Reached).length / last.length).toFixed(3) : null } };
      v.threshold = 8; v.presentAs = v.matched >= v.threshold ? 'betiğin kendisi (örtüşme ≥ 8 / 10)' : 'betikten esinlenen kural (örtüşme < 8 / 10)';
      validation = v;
      log(`  doğrulama BTC: ${v.matched} / ${v.of} eşleşti, aralıkta klon ${v.cloneInWindow} işlem (${v.extra} fazladan); son 3000 mum ${last.length} işlem`);
    }
    log(`  ${coin.padEnd(8)} ${String(r.trades.length).padStart(4)} işlem (iptal ${r.cancelled})`);
  }
  const rep = cloneReport(recs);
  const clone = {
    meta: { prereg: PSL.prereg, section: '## Aşama B — klon', tf: '4H', coins: coins.length, params: { threshold: CLONE.threshold, levelBars: CLONE.levelBars, invAtr: CLONE.invAtr, tpX: CLONE.tpX, cost: { ...CLONE.cost, fundingPct8h: 0 }, authorCost: CLONE.authorCost },
      htfSource: '1G = OKX 1D; 1H(afta) / 1A = 1D mumlarından toplandı', criterion: 'karar = klon, bizim muhasebe: eğitim ve doğrulamada ort. R > 0, PF > 1,1, hedge\'li R > 0; dilim başına n ≥ 100', generatedAt: Date.now(), elapsedSec: null },
    validation, unstatedChoices: CLONE_UNSTATED, series: Object.keys(coverage).length, skipped, coverage, ...rep,
  };
  clone.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
  const out = { ...base, clone };
  const before = JSON.stringify(base);
  fs.writeFileSync(file, JSON.stringify(out));
  const check = JSON.parse(fs.readFileSync(file, 'utf8')); delete check.clone;
  if (JSON.stringify(check) !== before) throw new Error('Aşama A alanları değişti!');
  const p = rep.groups.primary;
  log(`Klon bitti: ${clone.meta.elapsedSec} sn → ${file}; karar n eğ ${p.train.n} / doğr ${p.valid.n} → ${rep.result}; Aşama A alanları aynen`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) (process.argv.includes('--clone') ? cloneMain : main)().catch((e) => { console.error(e); process.exit(1); });
