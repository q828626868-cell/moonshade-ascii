// 共用小工具。damp 系列以指數趨近實作，與幀率無關。

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const damp = (from, to, sharpness, dt) => from + (to - from) * (1 - Math.exp(-sharpness * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export const dampAngle = (from, to, sharpness, dt) =>
  from + wrapAngle(to - from) * (1 - Math.exp(-sharpness * dt));

export const lerpAngle = (from, to, t) => from + wrapAngle(to - from) * t;

// '#rrggbb' → [r, g, b]（0–1，不做色彩空間轉換）
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
