// Bybit'te çok küçük fiyatlı coinler çarpanlı sözleşmeyle işlem görür (ör. PEPE → 1000PEPEUSDT, fiyat ×1000, adet ÷1000).
// Bot OKX fiyatıyla çalışır; mesaj ve sayfada Bybit karşılığı tam hassasiyetle (yuvarlanmış metinden değil) hesaplanır.
// Liste Bybit adlandırmasıyla elle tutulur (Bybit API Actions'tan coğrafi engelli); BYBIT_MULT (JSON) ile düzeltilebilir:
//   BYBIT_MULT={"PEPE":{"sym":"1000PEPEUSDT","mult":1000}}
export const BYBIT_MULT_DEFAULT = {
  PEPE: { sym: '1000PEPEUSDT', mult: 1000 },
  SHIB: { sym: 'SHIB1000USDT', mult: 1000 },
  BONK: { sym: '1000BONKUSDT', mult: 1000 },
  FLOKI: { sym: '1000FLOKIUSDT', mult: 1000 },
  LUNC: { sym: '1000LUNCUSDT', mult: 1000 },
  XEC: { sym: '1000XECUSDT', mult: 1000 },
  SATS: { sym: '1000SATSUSDT', mult: 1000 },
  RATS: { sym: '1000RATSUSDT', mult: 1000 },
  BTT: { sym: '1000BTTUSDT', mult: 1000 },
  CAT: { sym: '1000CATUSDT', mult: 1000 },
  NEIROCTO: { sym: '1000NEIROCTOUSDT', mult: 1000 },
  MOG: { sym: '1000000MOGUSDT', mult: 1e6 },
  BABYDOGE: { sym: '1000000BABYDOGEUSDT', mult: 1e6 },
  CHEEMS: { sym: '1000000CHEEMSUSDT', mult: 1e6 },
  LADYS: { sym: '10000LADYSUSDT', mult: 1e4 },
  WEN: { sym: '10000WENUSDT', mult: 1e4 },
};
let extra = {};
/** Ortamdan ek/düzeltme (bot: process.env.BYBIT_MULT). Hatalı JSON yok sayılır. */
export function setBybitOverrides(json) { try { extra = json ? JSON.parse(json) : {}; } catch { extra = {}; } }
/** Coin → { sym, mult } (çarpan yoksa { sym: COINUSDT, mult: 1 }). */
export function bybitOf(coin) {
  const m = extra[coin] || BYBIT_MULT_DEFAULT[coin];
  return m && m.mult > 1 ? { sym: m.sym, mult: m.mult } : { sym: `${coin}USDT`, mult: 1 };
}
/** Fiyatı Bybit'e çevir ve 6 anlamlı haneyle yaz (Bybit kendi adımına yuvarlar). */
export const bybitPx = (coin, p) => { const { mult } = bybitOf(coin); return Number.isFinite(p) ? +(p * mult).toPrecision(6) : null; };
