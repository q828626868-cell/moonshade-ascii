// CPU 端的字元格解析：解碼 G-buffer → 環境遮蔽 → 偵測邊線 → 霧的抽格 → 呼叫材質解析函式 → 字元與顏色陣列。
// 格座標 y = 0 在畫面最下方（與 readPixels、視空間 y 向上一致）。
// 霧的抽格、抖動門檻、AO 取樣核的選擇都取自 G-buffer 的世界座標雜湊（extra bit0–3），
// 不用螢幕座標的 Bayer 矩陣——那樣圖樣會固定在螢幕上，鏡頭一動就像紗窗一樣在世界上滑動。
import { createResolvers, EDGE_NONE, EDGE_SILHOUETTE, EDGE_CREASE } from './resolvers.js';
import { SHADE_LIT } from './glyphAtlas.js';

// 世界雜湊（0–15）→ 門檻。霧抽格與抖動用不同的排列，兩者才不會相關（否則留下來的格子都偏亮）
const FOG_THRESHOLD = Float32Array.from({ length: 16 }, (_, h) => (h + 0.5) / 16);
const DITHER_THRESHOLD = Float32Array.from({ length: 16 }, (_, h) => ((h * 7 + 3) % 16 + 0.5) / 16 - 0.5);

// 環境遮蔽的取樣核：球面上均勻分布的方向，長度由短到長（近處取樣較密）。
// 4 組依世界雜湊輪流使用（繞視線旋轉），把規律的條紋打散成細碎的雜點。
function buildKernels(count) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const base = Array.from({ length: count }, (_, k) => {
    const y = 1 - ((k + 0.5) / count) * 2;
    const r = Math.sqrt(1 - y * y);
    const len = 0.25 + 0.75 * ((k + 1) / count) ** 2;
    return [Math.cos(golden * k) * r * len, y * len, Math.sin(golden * k) * r * len];
  });
  return [0, 1, 2, 3].map((q) => {
    const a = (q * Math.PI) / 2 + 0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return Float32Array.from(base.flatMap(([x, y, z]) => [x * c - y * s, x * s + y * c, z]));
  });
}
// 8 鄰居的 (dx, dy)，扁平陣列避免每格配置
const OFF8 = Int8Array.from([-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1]);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createCellResolver(config, atlas, materials, weather) {
  const table = createResolvers(config, atlas, materials.ids);
  const reflectionId = materials.ids.reflection; // 水面倒影用這個材質的顏色
  const resolverById = materials.names.map((name, id) => {
    if (id === 0) return null;
    if (!table[name]) throw new Error(`Material "${name}" has no resolver in resolvers.js`);
    return table[name];
  });
  const ownsCrease = Uint8Array.from(materials.names, (name, id) =>
    id === 0 ? 0 : config.materials[name].ownsCreases === false ? 0 : 1,
  );
  const E = atlas.edge;

  let cols = 0;
  let rows = 0;
  let cw = 1;
  let ch = 1;
  let diagLo = 0;
  let diagHi = 0;
  let lum, mat, fogd, extra, nx, ny, nz, iz, ao, edgeKind, glyph, color;
  let kernels = buildKernels(config.ao.samples);
  let tanX = 1;
  let tanY = 1;

  const out = { glyph: 0, level: 0, shade: 0 };
  const at = (x, y) => (y < 0 ? 0 : y >= rows ? rows - 1 : y) * cols + (x < 0 ? 0 : x >= cols ? cols - 1 : x);
  const nb = {
    x: 0,
    y: 0,
    edge: -1,
    edgeKind: EDGE_NONE,
    dither: 0,
    depth: 0,
    nx: 0,
    mat: (dx, dy) => mat[at(nb.x + dx, nb.y + dy)],
    lum: (dx, dy) => lum[at(nb.x + dx, nb.y + dy)],
  };

  function resize(c, r, cellW, cellH) {
    cols = c;
    rows = r;
    cw = cellW;
    ch = cellH;
    const n = cols * rows;
    lum = new Float32Array(n);
    mat = new Uint8Array(n);
    fogd = new Float32Array(n);
    extra = new Uint8Array(n);
    nx = new Float32Array(n);
    ny = new Float32Array(n);
    nz = new Float32Array(n);
    iz = new Float32Array(n);
    ao = new Float32Array(n);
    edgeKind = new Uint8Array(n);
    glyph = new Uint8Array(n);
    color = new Uint16Array(n);
    // 斜線字元的實際視覺角度取決於格子長寬比（7×12 時約 60°），分界線取其與水平／垂直的中點
    const diag = Math.atan2(ch, cw);
    diagLo = diag / 2;
    diagHi = (diag + Math.PI / 2) / 2;
  }

  function decode(surf, geo) {
    for (let i = 0, p = 0; i < mat.length; i++, p += 4) {
      const m = surf[p + 1];
      lum[i] = surf[p] / 255;
      mat[i] = m;
      fogd[i] = surf[p + 2] / 255;
      extra[i] = surf[p + 3];
      const x = geo[p] / 127.5 - 1;
      const y = geo[p + 1] / 127.5 - 1;
      nx[i] = x;
      ny[i] = y;
      nz[i] = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      iz[i] = m === 0 ? 1 : 65535 / Math.max(1, geo[p + 2] * 256 + geo[p + 3]);
    }
  }

  // 螢幕空間環境遮蔽：以深度還原每格的視空間位置，沿法線半球取樣，
  // 取樣點被畫面中更靠近鏡頭的表面擋住就算被遮蔽。物件交界、地面腳下會變暗。
  // 同材質且法線相近的表面不算遮蔽物（平面不會遮住自己；字元格很粗，斜看的地面容易誤判）。
  function ambientOcclusion(x, y, i) {
    const C = config.ao;
    const far = config.render.far;
    const z = far / iz[i];
    if (z > C.fadeDistance) return 1;
    const px = (((x + 0.5) / cols) * 2 - 1) * z * tanX;
    const py = (((y + 0.5) / rows) * 2 - 1) * z * tanY;
    const ax = nx[i];
    const ay = ny[i];
    const az = nz[i];
    const k = kernels[(extra[i] >> 2) & 3];
    const bias = C.bias + z * C.relBias;
    let occluded = 0;
    let total = 0;
    for (let s = 0; s < k.length; s += 3) {
      let vx = k[s];
      let vy = k[s + 1];
      let vz = k[s + 2];
      if (vx * ax + vy * ay + vz * az < 0) {
        vx = -vx;
        vy = -vy;
        vz = -vz;
      }
      const sx = px + vx * C.radius;
      const sy = py + vy * C.radius;
      const sd = z - vz * C.radius; // 取樣點深度（視空間 z 朝鏡頭為正）
      if (sd <= 0.05) continue;
      const cx = Math.floor((sx / (sd * tanX) + 1) * 0.5 * cols);
      const cy = Math.floor((sy / (sd * tanY) + 1) * 0.5 * rows);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      total++;
      const j = cy * cols + cx;
      if (mat[j] === 0 || j === i) continue;
      if (mat[j] === mat[i] && ax * nx[j] + ay * ny[j] + az * nz[j] > 0.9) continue;
      const diff = sd - far / iz[j];
      if (diff > bias && diff < C.range) occluded++;
    }
    if (!total) return 1;
    const fade = 1 - Math.max(0, (z - C.fadeDistance * 0.5) / (C.fadeDistance * 0.5));
    return 1 - (occluded / total) * C.strength * fade;
  }

  // 線條方向 (lx, ly)（像素空間）→ 邊線字元。down：水平線時另一側在下方 → '_'
  function classify(lx, ly, down) {
    const a = Math.atan2(Math.abs(ly), Math.abs(lx));
    if (a < diagLo) return down ? E.bottom : E.horizontal;
    if (a > diagHi) return E.vertical;
    return lx * ly > 0 ? E.slash : E.backslash;
  }

  // 輪廓：曲面的輪廓上，法線 xy 正好垂直於輪廓線 → 直接用法線決定方向。
  // 平面的輪廓（法線朝向鏡頭，xy 沒有方向資訊）改看 5×5 鄰域中「同一物件」的格子
  // （深度連續，且材質相同或法線相近）：輪廓外側 = 遠離其重心的方向。
  // （看「較遠的格」會被斜看的地面帶偏，越上方的地面越遠。）
  function silhouette(x, y, i, threshold) {
    let gx;
    let gy;
    if (nz[i] < config.ascii.edges.contourNz) {
      gx = nx[i];
      gy = ny[i];
    } else {
      gx = 0;
      gy = 0;
      const z = iz[i];
      const limit = config.ascii.edges.normalThreshold;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const j = at(x + dx, y + dy);
          if (mat[j] === 0 || Math.abs(iz[j] - z) >= threshold) continue;
          if (mat[j] !== mat[i] && nx[i] * nx[j] + ny[i] * ny[j] + nz[i] * nz[j] < limit) continue;
          const w = 1 / (dx * dx + dy * dy);
          gx -= dx * cw * w;
          gy -= dy * ch * w;
        }
      }
    }
    return classify(-gy, gx, gy < 0);
  }

  // 摺邊：深度連續但法線轉折。線條方向 = 兩個面法線的外積（投影到螢幕）。
  // 兩側都會偵測到，只讓一側畫：地面／水面讓給物件；否則由「另一面在下方或左方」的一側畫。
  function crease(x, y, i, threshold) {
    const z = iz[i];
    const ax = nx[i];
    const ay = ny[i];
    const az = nz[i];
    const limit = config.ascii.edges.normalThreshold;
    let ox = 0;
    let oy = 0;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let yields = false;
    for (let k = 0; k < 16; k += 2) {
      const dx = OFF8[k];
      const dy = OFF8[k + 1];
      const j = at(x + dx, y + dy);
      if (mat[j] === 0 || Math.abs(iz[j] - z) >= threshold) continue;
      if (ax * nx[j] + ay * ny[j] + az * nz[j] >= limit) continue;
      ox += dx;
      oy += dy;
      bx += nx[j];
      by += ny[j];
      bz += nz[j];
      if (!ownsCrease[mat[j]]) yields = true;
    }
    if (!ox && !oy && !bx && !by) return -1;
    const own = ownsCrease[mat[i]];
    const owner = own && (yields || oy < -0.5 || (Math.abs(oy) <= 0.5 && ox < -0.5));
    if (!owner) return -1;
    // 鄰格分布給出的交界方向（垂直於「另一面」所在的方向）
    const px = -oy * ch;
    const py = ox * cw;
    let lx = ay * bz - az * by;
    let ly = az * bx - ax * bz;
    // 兩面在 3D 的交線不一定就是畫面上的交界：例如方塊正面與地面的交線是底邊（水平），
    // 但在方塊側邊，兩者在畫面上的交界是垂直的。外積方向與鄰格分布差太多時改用分布。
    const lc = Math.hypot(lx, ly);
    const lp = Math.hypot(px, py);
    if (lc < 1e-2 || (lp > 0 && Math.abs(lx * px + ly * py) < 0.5 * lc * lp)) {
      lx = px;
      ly = py;
    }
    return classify(lx, ly, oy < 0);
  }

  function detectEdge(x, y, i) {
    const z = iz[i];
    const threshold = config.ascii.edges.depthThreshold * z;
    // 1/z 在平面上對螢幕座標是線性的，二階差分只在深度跳變處為大負值（本格是近側）
    const xl = x > 0 ? i - 1 : i;
    const xr = x < cols - 1 ? i + 1 : i;
    const yd = y > 0 ? -cols : 0;
    const yu = y < rows - 1 ? cols : 0;
    const lap =
      Math.min(iz[xl] + iz[xr], iz[i + yd] + iz[i + yu], iz[xl + yd] + iz[xr + yu], iz[xr + yd] + iz[xl + yu]) - 2 * z;
    if (lap < -threshold) {
      nb.edgeKind = EDGE_SILHOUETTE;
      return silhouette(x, y, i, threshold);
    }
    const g = crease(x, y, i, threshold);
    if (g >= 0) nb.edgeKind = EDGE_CREASE;
    return g;
  }

  function resolve(surf, geo, camera) {
    decode(surf, geo);
    tanY = Math.tan((camera.fov * Math.PI) / 360);
    tanX = tanY * camera.aspect;
    if (kernels[0].length !== config.ao.samples * 3) kernels = buildKernels(config.ao.samples);
    const fog = weather.fog; // 隨區域氣候變化
    const fogStart = fog.start / fog.end;
    const edgesOn = config.ascii.edges.enabled;
    const aoOn = config.ao.enabled;
    let drawn = 0;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const m = mat[i];
        edgeKind[i] = EDGE_NONE;
        glyph[i] = 0;
        ao[i] = 1;
        if (m === 0) continue;
        const f = smoothstep(fogStart, 1, fogd[i]);
        const h = extra[i] & 15;
        if (FOG_THRESHOLD[h] < f * fog.sparsity) continue; // 遠處變疏
        if ((extra[i] & 192) === 192) {
          // 水面上的倒影（shaders.js 以 bit6 + bit7 標記）：被倒映物件的字元、倒影的顏色；不畫邊線、不做環境遮蔽
          nb.x = x;
          nb.y = y;
          nb.edge = -1;
          nb.edgeKind = EDGE_NONE;
          nb.dither = DITHER_THRESHOLD[h];
          nb.depth = config.render.far / iz[i];
          resolverById[m](lum[i], f, h, nb, out);
          glyph[i] = out.glyph;
          color[i] = atlas.paletteIndex(reflectionId, SHADE_LIT, out.level);
          if (out.glyph) drawn++;
          continue;
        }
        if (aoOn) ao[i] = ambientOcclusion(x, y, i);
        nb.x = x;
        nb.y = y;
        nb.edgeKind = EDGE_NONE;
        nb.dither = DITHER_THRESHOLD[h];
        nb.depth = config.render.far / iz[i];
        nb.nx = nx[i];
        nb.edge = edgesOn ? detectEdge(x, y, i) : -1;
        resolverById[m](lum[i] * ao[i], f, extra[i], nb, out);
        glyph[i] = out.glyph;
        color[i] = atlas.paletteIndex(m, out.shade, out.level);
        edgeKind[i] = out.glyph ? nb.edgeKind : EDGE_NONE;
        if (out.glyph) drawn++;
      }
    }
    return drawn;
  }

  // 開發用：把指定通道畫成 RGBA（列由上往下）
  function debugImage(view, data) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const p = ((rows - 1 - y) * cols + x) * 4;
        let r = 0;
        let g = 0;
        let b = 0;
        if (mat[i] !== 0) {
          if (view === 'material') {
            const v = lum[i] * 255;
            r = v * (0.4 + 0.6 * ((mat[i] * 0.37) % 1));
            g = v * (0.4 + 0.6 * ((mat[i] * 0.61) % 1));
            b = v * (0.4 + 0.6 * ((mat[i] * 0.83) % 1));
          } else if (view === 'normal') {
            r = (nx[i] * 0.5 + 0.5) * 255;
            g = (ny[i] * 0.5 + 0.5) * 255;
            b = nz[i] * 255;
          } else if (view === 'depth') {
            r = g = b = 255 * (1 - Math.min(1, Math.sqrt(1 / iz[i])));
          } else if (view === 'fog') {
            r = g = b = 255 * (1 - fogd[i]);
          } else if (view === 'extra') {
            r = extra[i] >= 128 ? 255 : 0;
            g = (extra[i] & 15) * 17;
            b = ((extra[i] >> 4) & 7) * 36;
          } else if (view === 'ao') {
            r = g = b = 255 * ao[i];
          } else if (view === 'edges') {
            r = edgeKind[i] === EDGE_SILHOUETTE ? 255 : 40;
            g = edgeKind[i] === EDGE_CREASE ? 255 : 40;
            b = 40;
          }
        }
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
  }

  // 場景查詢（給細線層做遮擋）：格座標 y = 0 在最下方
  const depthAt = (cx, cy) => {
    const i = cy * cols + cx;
    return mat[i] === 0 ? Infinity : config.render.far / iz[i];
  };
  const matAt = (cx, cy) => mat[cy * cols + cx];
  const shadowAt = (cx, cy) => extra[cy * cols + cx] >= 128;
  const lumAt = (cx, cy) => lum[cy * cols + cx]; // 光照亮度（細線依所在格的光照上色）

  return {
    resize,
    resolve,
    debugImage,
    depthAt,
    matAt,
    shadowAt,
    lumAt,
    get glyph() {
      return glyph;
    },
    get color() {
      return color;
    },
  };
}
