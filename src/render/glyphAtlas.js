// 字元圖集：每格都以實際字元格的裝置像素大小預先畫好，繪製時 drawImage 1:1 貼上，不縮放、不每格 fillText。
// 調色盤：材質 × {受光, 陰影, 暖光} × 層級，索引見 paletteIndex()。
//   受光：材質色 × 主光源顏色 × (colorFloor → colorTop)
//   陰影：材質色與天空色混合 × (shadow.colorFloor → shadow.colorTop) → 偏暗、偏藍
//   暖光：材質色與點光源顏色混合 × (warm.colorFloor → warm.colorTop) → 窗光、火把照到的地方
// 版面：每個調色盤一列（一整排字元）；列數太多時折成好幾欄，畫布高度不超過 MAX_HEIGHT（手機的畫布尺寸限制）。
import { hexToRgb } from '../core/mathx.js';

export const SHADE_LIT = 0;
export const SHADE_SHADOW = 1;
export const SHADE_WARM = 2;
const SHADES = 3;
const MAX_HEIGHT = 4096;

export function createGlyphAtlas(config, materialNames) {
  const A = config.ascii;
  const S = config.shadow;
  const W = config.lights;
  const M = config.materials;
  const chars = [' '];
  const index = new Map([[' ', 0]]);
  const add = (ch) => {
    if (!index.has(ch)) {
      index.set(ch, chars.length);
      chars.push(ch);
    }
    return index.get(ch);
  };

  for (const name of materialNames.slice(1)) {
    for (const ch of M[name].chars + (M[name].shadowChars ?? '') + (M[name].extraChars ?? '')) add(ch);
  }
  for (const ch of S.chars) add(ch);
  for (const ch of config.hoofEffects.prints.chars) add(ch); // 蹄印（resolvers 換字元用）
  const edge = {};
  for (const [key, ch] of Object.entries(A.edges.glyphs)) edge[key] = add(ch);

  const levels = A.colorLevels;
  const paletteCount = (materialNames.length - 1) * SHADES * levels;
  const canvas = document.createElement('canvas');
  const layout = { rowsPerColumn: 1, columns: 1, cw: 1, ch: 1 };
  let signature = '';
  let version = 0; // 每次重畫加一（WebGL 輸出據此重新上傳圖集貼圖）

  function colorOf(name, shade, k, weather) {
    const base = hexToRgb(M[name].color);
    const f = k / Math.max(1, levels - 1);
    let rgb;
    if (shade === SHADE_LIT) {
      // 光色正規化到最亮通道 = 1，只改變色調不改變亮度
      const sun = hexToRgb(weather.sun.color);
      const peak = Math.max(...sun, 1e-3);
      const t = A.colorFloor + (A.colorTop - A.colorFloor) * f;
      rgb = base.map((c, i) => c * (sun[i] / peak) * t);
    } else if (shade === SHADE_SHADOW) {
      const sky = hexToRgb(weather.sky.color);
      const t = S.colorFloor + (S.colorTop - S.colorFloor) * f;
      rgb = base.map((c, i) => (c * (1 - S.tintMix) + sky[i] * S.tintMix) * t);
    } else {
      const warm = hexToRgb(W.color);
      const t = W.colorFloor + (W.colorTop - W.colorFloor) * f;
      rgb = base.map((c, i) => (c * (1 - W.tintMix) + warm[i] * W.tintMix) * t);
    }
    const [r, g, b] = rgb.map((c) => Math.min(255, Math.round(c * 255)));
    return `rgb(${r},${g},${b})`;
  }

  function paletteIndex(materialId, shade, level) {
    return ((materialId - 1) * SHADES + shade) * levels + level;
  }

  // 字元格大小、光色或材質顏色改變時才重畫（例如換裝選單換了披風顏色）
  function build(cw, ch, weather) {
    let sig = `${cw}x${ch}|${weather.sun.color}|${weather.sky.color}|${W.color}`;
    for (let i = 1; i < materialNames.length; i++) sig += M[materialNames[i]].color;
    if (sig === signature) return;
    signature = sig;
    version++;
    layout.rowsPerColumn = Math.max(1, Math.floor(MAX_HEIGHT / ch));
    layout.columns = Math.ceil(paletteCount / layout.rowsPerColumn);
    layout.cw = cw;
    layout.ch = ch;
    canvas.width = cw * chars.length * layout.columns;
    canvas.height = ch * Math.min(paletteCount, layout.rowsPerColumn);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fontSize = Math.min(ch * A.fontScale, cw / 0.6);
    ctx.font = `${A.fontWeight} ${fontSize}px ${A.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    materialNames.slice(1).forEach((name, m) => {
      for (let shade = 0; shade < SHADES; shade++) {
        for (let k = 0; k < levels; k++) {
          const p = paletteIndex(m + 1, shade, k);
          const col = Math.floor(p / layout.rowsPerColumn);
          const row = p - col * layout.rowsPerColumn;
          ctx.fillStyle = colorOf(name, shade, k, weather);
          const x0 = col * chars.length * cw;
          const y = row * ch + ch / 2;
          for (let c = 1; c < chars.length; c++) ctx.fillText(chars[c], x0 + c * cw + cw / 2, y);
        }
      }
    });
  }
  return {
    canvas,
    chars,
    get version() {
      return version;
    },
    edge,
    levels,
    layout,
    build,
    paletteIndex,
    // 字串 → 圖集欄索引陣列
    compile: (str) => Uint8Array.from([...str], (ch) => index.get(ch) ?? 0),
    glyph: (ch) => index.get(ch) ?? 0,
  };
}
