// 細線層：鬃毛、尾巴、頭髮、披風邊緣、近處草葉——不用字元，以全解析度細線畫在字元畫面之上。
//
// 遮擋：讀回 CPU 的場景深度（G-buffer 的 16 位元線性深度，每個字元格一個值）就是這裡的深度緩衝。
//       每段線條切成約一格長的小段，逐段比對該點的場景深度，被擋住的小段不畫。
//       深度解析度與字元格相同，所以線條被遮住的邊界和字元畫面裡物件的邊界一致。
// 外觀：寬度與透明度依距離遞減；太細時改以透明度表現。同外觀的小段合併成一條 path 一次 stroke。
//
// 線條來源（source）實作 emit(push)：push(ax, ay, az, bx, by, bz, styleId, groupStart)，世界座標。
// groupStart 標示一組線段（例如一根草）的開頭；樣式有 anchorMaterialId 時，該組只在
// 起點落在該材質、且起點本身沒被擋住時才畫（例如草葉只長在畫面上是草地的格）。
import { hexToRgb } from '../core/mathx.js';

const MAX_PIECES = 16;
const WIDTH_STEPS = 6;
const ALPHA_STEPS = 8;
const VARIANTS = 4; // 每種樣式的顏色變體：sceneShade 用 0／1（受光／陰影），sceneLight 用 0–3（暗 → 亮）
const LIGHT_SCALE = [0.4, 0.62, 0.84, 1.05];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createDetailLines(config) {
  const C = config.lines;
  const styles = [];
  const sources = new Set();
  const buckets = new Map();
  const stats = { segments: 0, pieces: 0, hidden: 0 };
  const pts = new Float32Array((MAX_PIECES + 1) * 3); // 每個切點：螢幕 x, 螢幕 y, 深度（公尺）

  let cap = 4096;
  let seg = new Float32Array(cap * 6);
  let segStyle = new Uint16Array(cap);
  let segGroup = new Uint8Array(cap);
  let count = 0;

  function grow() {
    cap *= 2;
    const s = new Float32Array(cap * 6);
    s.set(seg);
    seg = s;
    const st = new Uint16Array(cap);
    st.set(segStyle);
    segStyle = st;
    const g = new Uint8Array(cap);
    g.set(segGroup);
    segGroup = g;
  }

  function push(ax, ay, az, bx, by, bz, styleId, groupStart) {
    if (count === cap) grow();
    const o = count * 6;
    seg[o] = ax;
    seg[o + 1] = ay;
    seg[o + 2] = az;
    seg[o + 3] = bx;
    seg[o + 4] = by;
    seg[o + 5] = bz;
    segStyle[count] = styleId;
    segGroup[count] = groupStart ? 1 : 0;
    count++;
  }

  // def：color、shadowColor（sceneShade 時用於陰影區）、width（CSS px，referenceDistance 內的寬度）、
  //      fadeStart / fadeEnd（公尺，可選）、nearFade [開始, 結束]（公尺，可選：離鏡頭太近也淡出）、
  //      anchorMaterialId（可選）、sceneShade（依所在格是否在陰影換色）、opacity（0–1，可選）、
  //      sceneLight（依所在格的光照亮度分四級上色；lightRange [暗, 亮] 是亮度的對應範圍，畫在天空上時用 skyLevel 級）
  function style(def) {
    const toRgb = (hex) => hexToRgb(hex).map((c) => Math.round(c * 255));
    const base = toRgb(def.color);
    const rgb = def.sceneLight
      ? LIGHT_SCALE.map((k) => base.map((c) => Math.min(255, Math.round(c * k))))
      : [base, toRgb(def.shadowColor ?? def.color), base, base];
    styles.push({ lightRange: [0.05, 0.6], skyLevel: 2, opacity: 1, ...def, rgb });
    return styles.length - 1;
  }

  function bucketFor(styleId, variant, wb, ab) {
    const key = ((styleId * VARIANTS + variant) * WIDTH_STEPS + wb) * ALPHA_STEPS + ab;
    let b = buckets.get(key);
    if (!b) {
      const [r, g, bl] = styles[styleId].rgb[variant];
      b = { styleId, wb, path: [], color: `rgba(${r},${g},${bl},${((ab + 0.5) / ALPHA_STEPS).toFixed(3)})` };
      buckets.set(key, b);
    }
    return b;
  }

  function draw(ctx, camera, layout, scene) {
    count = 0;
    for (const source of sources) source.emit(push);
    stats.segments = count;
    stats.pieces = 0;
    stats.hidden = 0;
    for (const b of buckets.values()) b.path.length = 0;

    const v = camera.matrixWorldInverse.elements;
    const p = camera.projectionMatrix.elements;
    const { cols, rows, cw, ch, ox, oy, pixelRatio } = layout;
    const gridW = cols * cw;
    const gridH = rows * ch;
    const near = camera.near;
    const minW = C.minWidth * pixelRatio;
    const pieceLen = C.pieceLength * Math.min(cw, ch);
    let groupVisible = true;
    let sx = 0;
    let sy = 0;

    // 視空間 → 螢幕像素（結果放在 sx, sy）
    const project = (x, y, z) => {
      const w = p[3] * x + p[7] * y + p[11] * z + p[15];
      sx = ox + ((p[0] * x + p[4] * y + p[8] * z + p[12]) / w * 0.5 + 0.5) * gridW;
      sy = oy + (0.5 - ((p[1] * x + p[5] * y + p[9] * z + p[13]) / w) * 0.5) * gridH;
    };
    // 螢幕像素 → 該處場景深度；畫面外回傳 -1
    const sceneDepth = (x, y) => {
      const cx = Math.floor((x - ox) / cw);
      const cyTop = Math.floor((y - oy) / ch);
      if (cx < 0 || cyTop < 0 || cx >= cols || cyTop >= rows) return -1;
      return scene.depthAt(cx, rows - 1 - cyTop);
    };
    const cellOf = (x, y) => [Math.floor((x - ox) / cw), rows - 1 - Math.floor((y - oy) / ch)];
    const hidden = (depth, sceneD) => depth > sceneD + C.depthBias + depth * C.relBias;

    for (let s = 0; s < count; s++) {
      if (segGroup[s]) groupVisible = true;
      if (!groupVisible) continue;
      const st = styles[segStyle[s]];
      const o = s * 6;

      // 世界 → 視空間（鏡頭看向 -z）
      const wx0 = seg[o], wy0 = seg[o + 1], wz0 = seg[o + 2];
      const wx1 = seg[o + 3], wy1 = seg[o + 4], wz1 = seg[o + 5];
      let ax = v[0] * wx0 + v[4] * wy0 + v[8] * wz0 + v[12];
      let ay = v[1] * wx0 + v[5] * wy0 + v[9] * wz0 + v[13];
      let az = v[2] * wx0 + v[6] * wy0 + v[10] * wz0 + v[14];
      let bx = v[0] * wx1 + v[4] * wy1 + v[8] * wz1 + v[12];
      let by = v[1] * wx1 + v[5] * wy1 + v[9] * wz1 + v[13];
      let bz = v[2] * wx1 + v[6] * wy1 + v[10] * wz1 + v[14];

      // 近平面裁切
      if (az > -near && bz > -near) continue;
      if (az > -near) {
        const t = (-near - az) / (bz - az);
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        az = -near;
      } else if (bz > -near) {
        const t = (-near - bz) / (az - bz);
        bx += (ax - bx) * t;
        by += (ay - by) * t;
        bz = -near;
      }

      // 依距離決定寬度與透明度
      const dist = -(az + bz) / 2;
      let alpha = st.opacity * (1 - smoothstep(st.fadeStart ?? C.fadeStart, st.fadeEnd ?? C.fadeEnd, dist));
      // 貼著鏡頭的線（例如鏡頭腳下的草）會被投影成整片畫面那麼長，近處也淡出
      if (st.nearFade) alpha *= smoothstep(st.nearFade[0], st.nearFade[1], dist);
      let width = st.width * pixelRatio * Math.min(1, C.referenceDistance / dist);
      if (width < minW) {
        alpha *= width / minW;
        width = minW;
      }
      const ab = Math.min(ALPHA_STEPS - 1, Math.floor(alpha * ALPHA_STEPS));
      if (ab <= 0) continue;
      const maxW = Math.max(minW, st.width * pixelRatio);
      const wb = maxW > minW ? Math.min(WIDTH_STEPS - 1, Math.floor(((width - minW) / (maxW - minW)) * WIDTH_STEPS)) : 0;

      // 切成約一格長的小段（視空間線性內插再投影，透視正確）
      project(ax, ay, az);
      const x0 = sx;
      const y0 = sy;
      project(bx, by, bz);
      const n = Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.hypot(sx - x0, sy - y0) / pieceLen)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const z = az + (bz - az) * t;
        project(ax + (bx - ax) * t, ay + (by - ay) * t, z);
        pts[k * 3] = sx;
        pts[k * 3 + 1] = sy;
        pts[k * 3 + 2] = -z;
      }

      if (segGroup[s] && st.anchorMaterialId !== undefined) {
        const d = sceneDepth(pts[0], pts[1]);
        const [cx, cy] = cellOf(pts[0], pts[1]);
        if (d < 0 || scene.matAt(cx, cy) !== st.anchorMaterialId || hidden(pts[2], d)) {
          groupVisible = false;
          continue;
        }
      }

      let prev = null;
      for (let k = 0; k < n; k++) {
        const i = k * 3;
        const mx = (pts[i] + pts[i + 3]) / 2;
        const my = (pts[i + 1] + pts[i + 4]) / 2;
        const d = sceneDepth(mx, my);
        if (d < 0 || hidden((pts[i + 2] + pts[i + 5]) / 2, d)) {
          if (d >= 0) stats.hidden++;
          prev = null;
          continue;
        }
        let variant = 0;
        if (st.sceneShade) {
          const [cx, cy] = cellOf(mx, my);
          variant = scene.shadowAt(cx, cy) ? 1 : 0;
        } else if (st.sceneLight) {
          const [cx, cy] = cellOf(mx, my);
          if (scene.matAt(cx, cy) === 0) variant = st.skyLevel;
          else {
            const l = (scene.lumAt(cx, cy) - st.lightRange[0]) / (st.lightRange[1] - st.lightRange[0]);
            variant = l <= 0 ? 0 : l >= 1 ? VARIANTS - 1 : Math.floor(l * VARIANTS);
          }
        }
        const b = bucketFor(segStyle[s], variant, wb, ab);
        if (b !== prev) b.path.push(1, pts[i], pts[i + 1]);
        b.path.push(0, pts[i + 3], pts[i + 4]);
        prev = b;
        stats.pieces++;
      }
    }

    ctx.lineCap = 'round';
    for (const b of buckets.values()) {
      if (!b.path.length) continue;
      const maxW = Math.max(minW, styles[b.styleId].width * pixelRatio);
      ctx.lineWidth = minW + ((maxW - minW) * (b.wb + 0.5)) / WIDTH_STEPS;
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      const path = b.path;
      for (let i = 0; i < path.length; i += 3) {
        if (path[i]) ctx.moveTo(path[i + 1], path[i + 2]);
        else ctx.lineTo(path[i + 1], path[i + 2]);
      }
      ctx.stroke();
    }
  }

  return {
    stats,
    style,
    draw,
    add: (source) => sources.add(source),
    remove: (source) => sources.delete(source),
  };
}
