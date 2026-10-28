// Ayarlar: localStorage (try/catch), preset → detektör seti + ağırlıklar.
import { DETECTORS } from '../scan/registry.js';
import { PRESET_MAP } from '../scan/presets.js';
import { TF_ORDER } from '../data/okx.js';
import { EW_UI_DEFAULTS } from './settingsPanel.js';

const KEY = 'cta-settings-v1';
export const UI_DEFAULTS = {
  timeframes: ['15m', '4H'],
  universe: '50',
  manualCoins: '',
  preset: 'ict',
  detectors: null, // null = preset'e göre
  weights: {},
  minScore: 30,
  dirFilter: 'all',
  sortBy: 'score',
  apiKey: '',
  showStructure: false, // grafikte HH/HL/LH/LL ve BOS/CHoCH katmanı
  ew: { ...EW_UI_DEFAULTS }, // Ayarlar bölmesi (Elliott dalga-3 + SMT)
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...UI_DEFAULTS };
    const s = { ...UI_DEFAULTS, ...JSON.parse(raw) };
    s.timeframes = (s.timeframes || []).filter((t) => TF_ORDER.includes(t));
    if (!s.timeframes.length) s.timeframes = [...UI_DEFAULTS.timeframes];
    s.ew = { ...EW_UI_DEFAULTS, ...(s.ew || {}) };
    return s;
  } catch { return { ...UI_DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* özel pencere vb. */ }
}

/** Ayarlar bölmesindeki Elliott/dalga-3 seçenekleri detektör seçeneklerine eklenir (preset'in elliott ayarları korunur). */
export function withEw(detectorOpts, ew) {
  if (!ew) return detectorOpts;
  const { ruleSet, ...w3 } = { ...EW_UI_DEFAULTS, ...ew };
  return { ...detectorOpts, elliott: { ...(detectorOpts.elliott || {}), ruleSet, w3: { ...w3, ruleSet } } };
}

/** Etkin detektör listesi ve ağırlıklar (preset ya da özel). */
export function effectiveDetectors(s) {
  const p = PRESET_MAP[s.preset];
  if (s.preset === 'custom' || !p) {
    const ids = s.detectors || DETECTORS.map((d) => d.id);
    return { ids, weights: s.weights || {}, detectorOpts: withEw({}, s.ew) };
  }
  return { ids: p.detectors || DETECTORS.map((d) => d.id), weights: p.weights || {}, detectorOpts: withEw(p.detectorOpts || {}, s.ew) };
}
