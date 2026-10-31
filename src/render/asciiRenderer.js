// ASCII 渲染管線：
//   1. shadow   陽光陰影貼圖
//   2. reflect  附近有水時：鏡像鏡頭把水面以上的場景畫進另一張 G-buffer，水面 shader 取樣成倒影
//   2. scene    場景 → 「每個字元格 = 1 像素」的 MRT G-buffer（見 shaders.js 的通道配置）
//   3. readback 兩張附件讀回 CPU（sync／async，見 readback.js）
//   4. resolve  邊線偵測 + 每種材質的字元解析函式 → 字元與顏色層級
//   5. draw     2D canvas 以 drawImage 從字元圖集貼字
//   6. lines    細線層（鬃毛、草葉……），以讀回的場景深度逐段判斷遮擋
import * as THREE from 'three';
import { createShadowMap } from './shadowMap.js';
import { createReadback } from './readback.js';
import { createGlyphAtlas } from './glyphAtlas.js';
import { createGlyphPass } from './glyphPass.js';
import { createCellResolver } from './cellResolver.js';
import { createPresenter } from './presenter.js';
import { createDetailLines } from './detailLines.js';

const GBUFFER_CLEAR = new THREE.Color(0, 0, 1); // 材質 0（天空）、霧距離 1、深度 1
export const DEBUG_VIEWS = ['ascii', 'material', 'normal', 'depth', 'fog', 'extra', 'edges', 'ao'];

export function createAsciiRenderer(canvas, config, weather, materials) {
  const rc = config.render;

  // WebGL 只畫到 render target，自己的畫布不顯示
  const gl = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  gl.setPixelRatio(1);
  gl.setSize(1, 1, false);
  gl.info.autoReset = false;

  const scene = new THREE.Scene();
  const gbuffer = new THREE.WebGLRenderTarget(1, 1, {
    count: 2,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
  });
  // 倒影：與 G-buffer 同大小；鏡像鏡頭在水面下（位置、視線對水面鏡射）
  const reflectTarget = new THREE.WebGLRenderTarget(1, 1, {
    count: 2,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
  });
  const mirror = new THREE.PerspectiveCamera();
  const reflection = { enabled: false, level: 0 }; // 由主程式依附近有沒有水設定
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const _v = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const shadow = createShadowMap(gl, config.shadow, materials.shared);
  const readback = createReadback(gl);
  const atlas = createGlyphAtlas(config, materials.names);
  const cells = createCellResolver(config, atlas, materials, weather);
  const presenter = createPresenter(canvas, rc);
  const glyphPass = createGlyphPass(gl, rc); // 字元畫面以 WebGL 一次畫完（config.ascii.present）
  const lines = createDetailLines(config);

  const layout = { cols: 0, rows: 0, cw: 0, ch: 0, ox: 0, oy: 0, width: 0, height: 0, pixelRatio: 1 };
  const stats = { drawn: 0, fresh: true };
  let surface = new Uint8Array(4);
  let geometry = new Uint8Array(4);
  let aspect = 1;
  let dirty = true;
  const resizeListeners = [];
  window.addEventListener('resize', () => (dirty = true));

  function resize() {
    dirty = false;
    const dpr = Math.min(window.devicePixelRatio || 1, rc.maxPixelRatio);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    // 字元格取整數裝置像素，圖集才能 1:1 貼上
    let cw = Math.max(2, Math.round(rc.cellWidth * dpr));
    let ch = Math.max(3, Math.round(rc.cellHeight * dpr));
    if (Math.floor(width / cw) > rc.maxCols) {
      const s = width / rc.maxCols / cw;
      cw = Math.ceil(cw * s);
      ch = Math.round(ch * s);
    }
    const cols = Math.max(1, Math.floor(width / cw));
    const rows = Math.max(1, Math.floor(height / ch));
    Object.assign(layout, {
      cols,
      rows,
      cw,
      ch,
      ox: (width - cols * cw) >> 1,
      oy: (height - rows * ch) >> 1,
      width,
      height,
      pixelRatio: dpr,
    });

    gbuffer.setSize(cols, rows);
    reflectTarget.setSize(cols, rows);
    surface = new Uint8Array(cols * rows * 4);
    geometry = new Uint8Array(cols * rows * 4);
    cells.resize(cols, rows, cw, ch);
    presenter.resize(layout);
    glyphPass.resize(layout);

    aspect = (cols * cw) / (rows * ch);
    for (const fn of resizeListeners) fn(aspect, layout);
  }

  function syncUniforms(time, camera) {
    const s = materials.shared;
    // 距離 1 公尺處一個字元格的高度（公尺）：世界座標雜湊依此決定格子大小
    s.uCellFootprint.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, layout.rows);
    s.uSunDir.value.copy(weather.sunDir);
    s.uSunIntensity.value = weather.sun.intensity;
    s.uSkyIntensity.value = weather.sky.intensity;
    s.uGroundIntensity.value = weather.ground.intensity;
    s.uSelfShadowNdl.value = config.shadow.selfShadowNdl;
    s.uFar.value = rc.far;
    s.uFogRange.value = weather.fog.end;
    s.uTime.value = time;
    s.uWindDir.value.set(weather.wind.x, weather.wind.z);
    s.uWindStrength.value = weather.wind.strength;
    // 鏡頭在水平面上的右方與前方（漣漪的方向換成螢幕方向）
    camera.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() > 1e-6) {
      _v.normalize();
      s.uCamForward.value.set(_v.x, _v.z);
      s.uCamRight.value.set(-_v.z, _v.x);
    }
  }

  function renderReflection(camera) {
    const s = materials.shared;
    if (!reflection.enabled || !config.water.reflection.enabled) {
      s.uReflectOn.value = 0;
      return;
    }
    const L = reflection.level;
    camera.updateMatrixWorld();
    mirror.copy(camera);
    mirror.position.set(camera.position.x, 2 * L - camera.position.y, camera.position.z);
    camera.getWorldDirection(_v);
    _t.copy(camera.position).add(_v);
    _t.y = 2 * L - _t.y;
    mirror.up.set(0, 1, 0);
    mirror.lookAt(_t);
    mirror.updateMatrixWorld();
    s.uReflectMatrix.value.copy(BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    // 只畫水面以上（水面本身也不畫），樹葉變稀疏在鏡像裡不用
    const occluder = s.uOccluder.value.w;
    s.uOccluder.value.w = 0;
    s.uClipY.value.set(1, L - 0.02);
    s.uReflect.value = null; // 不能一邊畫進這張貼圖、一邊取樣它
    s.uReflectOn.value = 0;
    gl.setRenderTarget(reflectTarget);
    gl.setClearColor(GBUFFER_CLEAR, 1);
    gl.render(scene, mirror);
    s.uClipY.value.set(0, 0);
    s.uOccluder.value.w = occluder;
    s.uReflect.value = reflectTarget.textures[0];
    s.uReflectOn.value = 1;
  }

  function render(camera, focus, time, profiler) {
    if (dirty) resize();
    gl.info.reset();
    syncUniforms(time, camera);
    atlas.build(layout.cw, layout.ch, weather); // 光色改變時重畫圖集

    let t = profiler.now();
    shadow.render(scene, focus, weather.sunDir);
    profiler.record('shadow', t);

    t = profiler.now();
    renderReflection(camera);
    profiler.record('reflect', t);

    t = profiler.now();
    gl.setRenderTarget(gbuffer);
    gl.setClearColor(GBUFFER_CLEAR, 1);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    profiler.record('scene', t);

    t = profiler.now();
    stats.fresh = readback.read(gbuffer, [surface, geometry], config.ascii.readback);
    profiler.record('readback', t);

    // async 模式下資料沒更新就沿用上一幀的畫面
    t = profiler.now();
    if (stats.fresh) stats.drawn = cells.resolve(surface, geometry, camera);
    profiler.record('resolve', t);

    t = profiler.now();
    if (stats.fresh) {
      if (rc.debugView === 'ascii') {
        if (config.ascii.present === 'canvas') presenter.draw(cells.glyph, cells.color, atlas);
        else presenter.blit(glyphPass.render(cells.glyph, cells.color, atlas));
      }
      else presenter.drawDebug((data) => cells.debugImage(rc.debugView, data));
    }
    profiler.record('draw', t);

    t = profiler.now();
    if (stats.fresh && rc.debugView === 'ascii' && config.lines.enabled) {
      lines.draw(presenter.ctx, camera, layout, cells);
    }
    profiler.record('lines', t);
  }

  resize();

  return {
    scene,
    layout,
    stats,
    cells, // 解析後的字元格（測試用的文字截圖）
    info: gl.info,
    renderer: gl,
    atlas,
    lines,
    reflection,
    render,
    get aspect() {
      return aspect;
    },
    onResize(fn) {
      resizeListeners.push(fn);
      fn(aspect, layout);
    },
  };
}
