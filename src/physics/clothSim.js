// 披風的 Verlet 布料（純數學，不依賴 three.js）：在主執行緒或 Web Worker（softBodyWorker.js）裡跑同一份程式。
// 輸入每次由主執行緒整理好（entities/cloak.js 的 gather）：頂排掛點、打包好的碰撞體、腳下的地面高度、風、身體的平移與速度。
// 演算法與原本相同：積分 → 頂排釘在肩上 → 每次迭代做約束與碰撞。
import { patchHeight } from './heightPatch.js';

// 碰撞體打包：每個 COLLIDER_STRIDE 個數
//   橢圓體 [0, cx, cy, cz, qx, qy, qz, qw, rx, ry, rz]（q：骨頭的世界旋轉）
//   膠囊   [1, ax, ay, az, bx, by, bz, r]
//   球     [2, cx, cy, cz, r]
export const COLLIDER_STRIDE = 11;

// 以四元數 (x, y, z, w) 旋轉向量 v（就地）；inverse 時用共軛
function rotate(v, qx, qy, qz, qw, inverse) {
  if (inverse) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
  }
  const [x, y, z] = v;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  v[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  v[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  v[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
}

// layout：{ W, H, constraints: Float32Array（[a, b, 靜止長度] × n）, rowLength, scale }
export function createClothSim(cfg, layout) {
  const { W, H, rowLength } = layout;
  const s = layout.scale;
  const n = W * H;
  const pos = new Float32Array(n * 3);
  const prev = new Float32Array(n * 3);
  const C = layout.constraints;
  const nc = C.length / 3;
  const p = [0, 0, 0];
  const b = [0, 0, 0];
  let initialized = false;

  function reset(anchors) {
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < H; j++) {
        const o = (j * W + i) * 3;
        pos[o] = prev[o] = anchors[i * 3];
        pos[o + 1] = prev[o + 1] = anchors[i * 3 + 1] - j * rowLength;
        pos[o + 2] = prev[o + 2] = anchors[i * 3 + 2];
      }
    }
    initialized = true;
  }

  // 把 p 推出第 k 個碰撞體
  function collide(cols, k) {
    const o = k * COLLIDER_STRIDE;
    const m = cfg.margin * s;
    const type = cols[o];
    if (type === 0) {
      const qx = cols[o + 4];
      const qy = cols[o + 5];
      const qz = cols[o + 6];
      const qw = cols[o + 7];
      b[0] = p[0] - cols[o + 1];
      b[1] = p[1] - cols[o + 2];
      b[2] = p[2] - cols[o + 3];
      rotate(b, qx, qy, qz, qw, true);
      const rx = cols[o + 8] * s + m;
      const ry = cols[o + 9] * s + m;
      const rz = cols[o + 10] * s + m;
      const kk = Math.hypot(b[0] / rx, b[1] / ry, b[2] / rz);
      if (kk < 1 && kk > 1e-6) {
        b[0] /= kk;
        b[1] /= kk;
        b[2] /= kk;
        rotate(b, qx, qy, qz, qw, false);
        p[0] = cols[o + 1] + b[0];
        p[1] = cols[o + 2] + b[1];
        p[2] = cols[o + 3] + b[2];
      }
      return;
    }
    let ax = cols[o + 1];
    let ay = cols[o + 2];
    let az = cols[o + 3];
    let bx = ax;
    let by = ay;
    let bz = az;
    let r = cols[o + 4];
    if (type === 1) {
      bx = cols[o + 4];
      by = cols[o + 5];
      bz = cols[o + 6];
      r = cols[o + 7];
    }
    r = r * s + m;
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const len2 = ex * ex + ey * ey + ez * ez;
    let t = len2 > 0 ? (ex * (p[0] - ax) + ey * (p[1] - ay) + ez * (p[2] - az)) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const cz = az + ez * t;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < r && d > 1e-6) {
      p[0] = cx + (dx * r) / d;
      p[1] = cy + (dy * r) / d;
      p[2] = cz + (dz * r) / d;
    }
  }

  // input：{ anchors（W × 3）, colliders, count, ground（heightPatch）, wind: { x, z, strength }, time, carry: { dx, dy, dz, vx, vz, teleport } }
  // firstStep：這一批的第一步（平移只做一次）
  function step(dt, input, firstStep) {
    const { anchors, carry } = input;
    if (!initialized || (firstStep && carry.teleport)) reset(anchors);
    else if (firstStep && (carry.dx || carry.dy || carry.dz)) {
      for (let k = W; k < n; k++) {
        const o = k * 3;
        pos[o] += carry.dx;
        prev[o] += carry.dx;
        pos[o + 1] += carry.dy;
        prev[o + 1] += carry.dy;
        pos[o + 2] += carry.dz;
        prev[o + 2] += carry.dz;
      }
    }
    const dt2 = dt * dt;
    const w = input.wind;
    const damping = cfg.damping;
    const airX = -carry.vx * cfg.airDrag;
    const airZ = -carry.vz * cfg.airDrag;
    const time = input.time;

    // 積分（頂排除外）
    for (let j = 1; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 3;
        // 陣風擾動：每個節點略有不同，越往下擺動越大
        const flutter = 1 + cfg.flutter * Math.sin(time * 3.7 + i * 0.9 + j * 0.7) * Math.sin(time * 1.3 + j);
        const wind = cfg.windResponse * w.strength * flutter * (j / (H - 1));
        const ax = w.x * wind + airX * (j / (H - 1));
        const az = w.z * wind + airZ * (j / (H - 1));
        const vx = (pos[o] - prev[o]) * damping;
        const vy = (pos[o + 1] - prev[o + 1]) * damping;
        const vz = (pos[o + 2] - prev[o + 2]) * damping;
        prev[o] = pos[o];
        prev[o + 1] = pos[o + 1];
        prev[o + 2] = pos[o + 2];
        pos[o] += vx + ax * dt2;
        pos[o + 1] += vy - cfg.gravity * dt2;
        pos[o + 2] += vz + az * dt2;
      }
    }
    // 頂排釘在肩上
    for (let i = 0; i < W * 3; i++) pos[i] = prev[i] = anchors[i];

    const cols = input.colliders;
    const count = input.count;
    for (let it = 0; it < cfg.iterations; it++) {
      for (let c = 0; c < nc; c++) {
        const a = C[c * 3];
        const bb = C[c * 3 + 1];
        const rest = C[c * 3 + 2];
        const oa = a * 3;
        const ob = bb * 3;
        const dx = pos[ob] - pos[oa];
        const dy = pos[ob + 1] - pos[oa + 1];
        const dz = pos[ob + 2] - pos[oa + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - rest * s) / d;
        // 頂排不動，另一端承擔全部修正
        const wa = a < W ? 0 : bb < W ? 1 : 0.5;
        const wb = 1 - wa;
        pos[oa] += dx * diff * wa;
        pos[oa + 1] += dy * diff * wa;
        pos[oa + 2] += dz * diff * wa;
        pos[ob] -= dx * diff * wb;
        pos[ob + 1] -= dy * diff * wb;
        pos[ob + 2] -= dz * diff * wb;
      }
      // 碰撞（每次迭代都做，約束不會把布料拉回身體裡）
      for (let k = W; k < n; k++) {
        const o = k * 3;
        p[0] = pos[o];
        p[1] = pos[o + 1];
        p[2] = pos[o + 2];
        for (let c = 0; c < count; c++) collide(cols, c);
        const floor = patchHeight(input.ground, p[0], p[2]) + 0.02;
        if (p[1] < floor) p[1] = floor;
        pos[o] = p[0];
        pos[o + 1] = p[1];
        pos[o + 2] = p[2];
      }
    }
  }

  return { pos, step, reset };
}
