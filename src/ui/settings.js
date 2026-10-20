// Ayarlar: localStorage (try/catch), preset → detektör seti + ağırlıklar.
import { DETECTORS } from '../scan/registry.js';
import { PRESET_MAP } from '../scan/presets.js';
import { TF_ORDER } from '../data/okx.js';

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
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...UI_DEFAULTS };
    const s = { ...UI_DEFAULTS, ...JSON.parse(raw) };
    s.timeframes = (s.timeframes || []).filter((t) => TF_ORDER.includes(t));
    if (!s.timeframes.length) s.timeframes = [...UI_DEFAULTS.timeframes];
    return s;
  } catch { return { ...UI_DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* özel pencere vb. */ }
}

/** Etkin detektör listesi ve ağırlıklar (preset ya da özel). */
export function effectiveDetectors(s) {
  const p = PRESET_MAP[s.preset];
  if (s.preset === 'custom' || !p) {
    const ids = s.detectors || DETECTORS.map((d) => d.id);
    return { ids, weights: s.weights || {} };
  }
  return { ids: p.detectors || DETECTORS.map((d) => d.id), weights: p.weights || {} };
}
