// 字元畫面的 WebGL 輸出：一次繪製畫完所有字元格（取代 2D canvas 每格一次 drawImage）。
//   每格的字元與調色盤編號放進一張 cols × rows 的小貼圖（R 字元、G／B 調色盤編號的低／高位元組），
//   片段 shader 依像素所在的格子與格內位置，從字元圖集貼圖取樣，疊在背景色上。
//   結果畫在 WebGL 自己的畫布上，再由 presenter 整張貼到顯示用的 2D canvas（細線層之後畫在上面）。
// 為什麼：每幀上萬次 drawImage 光送指令就要幾十毫秒，而且 GPU 要逐一執行；
//   G-buffer 同步讀回時必須等這些都做完，所以連讀回也被拖慢。一次繪製就沒有這些成本。
import * as THREE from 'three';
import { hexToRgb } from '../core/mathx.js';

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uCells;   // cols × rows：R 字元、G 調色盤低位元組、B 調色盤高位元組
uniform sampler2D uAtlas;   // 字元圖集（不翻轉：第 0 列是畫布最上面）
uniform vec2 uGrid;         // cols, rows
uniform vec2 uCell;         // 字元格的像素大小 cw, ch
uniform vec2 uOffset;       // 格子區域左上角 ox, oy（畫布像素，y 向下）
uniform float uHeight;      // 畫布高度（像素）
uniform float uPerColumn;   // 圖集每欄幾個調色盤（列）
uniform float uColumnWidth; // 圖集每欄的寬度（像素）
uniform vec3 uBackground;
layout(location = 0) out vec4 outColor;

void main() {
  // 畫布像素座標（y 向下，與 2D canvas 相同）
  vec2 px = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  vec2 local = px - uOffset;
  vec2 cell = floor(local / uCell);
  outColor = vec4(uBackground, 1.0);
  if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, uGrid))) return;
  // 格子陣列的第 0 列在畫面最下面
  vec4 c = texelFetch(uCells, ivec2(int(cell.x), int(uGrid.y - 1.0 - cell.y)), 0);
  float glyph = floor(c.r * 255.0 + 0.5);
  if (glyph < 0.5) return;
  float palette = floor(c.g * 255.0 + 0.5) + floor(c.b * 255.0 + 0.5) * 256.0;
  float column = floor(palette / uPerColumn);
  float row = palette - column * uPerColumn;
  vec2 inCell = floor(local - cell * uCell);
  ivec2 texel = ivec2(int(column * uColumnWidth + glyph * uCell.x + inCell.x), int(row * uCell.y + inCell.y));
  vec4 g = texelFetch(uAtlas, texel, 0);
  outColor = vec4(mix(uBackground, g.rgb, g.a), 1.0);
}
`;

export function createGlyphPass(renderer, renderCfg) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let cellData = new Uint8Array(4);
  let cellTex = null;
  const atlasTex = new THREE.Texture();
  atlasTex.flipY = false;
  atlasTex.generateMipmaps = false;
  atlasTex.minFilter = atlasTex.magFilter = THREE.NearestFilter;
  let atlasVersion = -1;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCells: { value: null },
      uAtlas: { value: atlasTex },
      uGrid: { value: new THREE.Vector2() },
      uCell: { value: new THREE.Vector2() },
      uOffset: { value: new THREE.Vector2() },
      uHeight: { value: 1 },
      uPerColumn: { value: 1 },
      uColumnWidth: { value: 1 },
      uBackground: { value: new THREE.Vector3(...hexToRgb(renderCfg.background)) },
    },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  return {
    // 版面改變時：格子貼圖重新配置，WebGL 畫布改成顯示畫布的大小
    resize(layout) {
      cellTex?.dispose();
      cellData = new Uint8Array(layout.cols * layout.rows * 4);
      cellTex = new THREE.DataTexture(cellData, layout.cols, layout.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      cellTex.minFilter = cellTex.magFilter = THREE.NearestFilter;
      cellTex.generateMipmaps = false;
      const u = material.uniforms;
      u.uCells.value = cellTex;
      u.uGrid.value.set(layout.cols, layout.rows);
      u.uCell.value.set(layout.cw, layout.ch);
      u.uOffset.value.set(layout.ox, layout.oy);
      u.uHeight.value = layout.height;
      renderer.setSize(layout.width, layout.height, false);
    },
    // 畫出這一幀的字元；回傳 WebGL 的畫布（presenter 整張貼上）
    render(glyph, color, atlas) {
      if (atlas.version !== atlasVersion) {
        atlasVersion = atlas.version;
        atlasTex.image = atlas.canvas;
        atlasTex.needsUpdate = true;
      }
      const u = material.uniforms;
      u.uPerColumn.value = atlas.layout.rowsPerColumn;
      u.uColumnWidth.value = atlas.chars.length * atlas.layout.cw;
      const n = glyph.length;
      for (let i = 0, o = 0; i < n; i++, o += 4) {
        const p = color[i];
        cellData[o] = glyph[i];
        cellData[o + 1] = p & 255;
        cellData[o + 2] = p >> 8;
      }
      cellTex.needsUpdate = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return renderer.domElement;
    },
  };
}
