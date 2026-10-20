// Ajan profilleri: kodda sabit sert sınırlar + başlangıç parametreleri (ajan bunları sınır içinde değiştirebilir).
export const PROFILES = {
  temkinli: {
    id: 'temkinli', label: 'Temkinli', startEquity: 300,
    guards: { maxLeverage: 10, maxMarginPct: 40, maxPositions: 3, dailyLossPct: 15, minMargin: 10 },
    params: { riskAppetite: 'medium', preferredLeverage: [2, 5], maxMarginPctPerTrade: 25, avoidTfs: [], avoidDetectors: [], notes: 'Başlangıç: orta risk, 2–5x, pozisyon başına özsermayenin en fazla %25 marjini.' },
  },
  agresif: {
    id: 'agresif', label: 'Agresif', startEquity: 300,
    guards: { maxLeverage: 20, maxMarginPct: 60, maxPositions: 5, dailyLossPct: 15, minMargin: 10 },
    params: { riskAppetite: 'high', preferredLeverage: [5, 12], maxMarginPctPerTrade: 40, avoidTfs: [], avoidDetectors: [], notes: 'Başlangıç: yüksek risk, 5–12x, pozisyon başına en fazla %40 marjin.' },
  },
};
export const FEES = { takerPct: 0.05, slipPct: 0.05, mmrPct: 0.5 }; // komisyon/taraf, kayma, bakım marjini
