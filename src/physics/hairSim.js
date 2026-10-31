// 馬的鬃毛、前髮、尾巴的 Verlet 鏈（純數學，不依賴 three.js）：在主執行緒或 Web Worker 裡跑同一份程式。
// 毛的配置（每根的起點、節數、段長、所屬骨頭、靜止樣子的骨頭局部座標）在 entities/horseHair.js 建好後傳進來；
// 每次的輸入：骨頭的世界矩陣、各組的碰撞膠囊、地面、水面、披風下緣（尾巴用）、風、馬的平移與速度。
// 演算法與原本相同：根部固定 → 重力與空氣阻力 → 長度約束 → 往靜止樣子拉回、碰撞、地面 → 變濕／變乾。
import { patchHeight } from './heightPatch.js';

export const CAPSULE_STRIDE = 7; // [ax, ay, az, bx, by, bz, r]

// layout.groups[i]：{ count, start, len, seg, bone（每根毛的骨頭索引）, local, stiffness, tail（是否為尾巴） }
export function createHairSim(cfg, layout) {
  const groups = layout.groups.map((g) => {
    const total = g.local.length / 3;
    return { ...g, total, rest: new Float32Array(total * 3), pos: new Float32Array(total * 3), prev: new Float32Array(total * 3), wet: new Float32Array(g.count) };
  });
  let initialized = false;
  let time = 0;
  const lastRoot = [0, 0, 0];

  function updateRest(g, bones) {
    for (let s = 0; s < g.count; s++) {
      const e = g.bone[s] * 16;
      const end = g.start[s] + g.len[s];
      for (let k = g.start[s]; k < end; k++) {
        const o = k * 3;
        const x = g.local[o];
        const y = g.local[o + 1];
        const z = g.local[o + 2];
        g.rest[o] = bones[e] * x + bones[e + 4] * y + bones[e + 8] * z + bones[e + 12];
        g.rest[o + 1] = bones[e + 1] * x + bones[e + 5] * y + bones[e + 9] * z + bones[e + 13];
        g.rest[o + 2] = bones[e + 2] * x + bones[e + 6] * y + bones[e + 10] * z + bones[e + 14];
      }
    }
  }

  // 膠囊：把點推到半徑外
  function pushOut(pos, o, c, k) {
    const q = k * CAPSULE_STRIDE;
    const ax = c[q];
    const ay = c[q + 1];
    const az = c[q + 2];
    const abx = c[q + 3] - ax;
    const aby = c[q + 4] - ay;
    const abz = c[q + 5] - az;
    const px = pos[o] - ax;
    const py = pos[o + 1] - ay;
    const pz = pos[o + 2] - az;
    const ll = abx * abx + aby * aby + abz * abz;
    let t = ll > 0 ? (px * abx + py * aby + pz * abz) / ll : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - abx * t;
    const dy = py - aby * t;
    const dz = pz - abz * t;
    const d2 = dx * dx + dy * dy + dz * dz;
    const r = c[q + 6] + cfg.margin;
    if (d2 >= r * r || d2 < 1e-12) return;
    const kk = r / Math.sqrt(d2);
    pos[o] = ax + abx * t + dx * kk;
    pos[o + 1] = ay + aby * t + dy * kk;
    pos[o + 2] = az + abz * t + dz * kk;
  }

  // 披風下緣的節點當作小球（只給尾巴用；披風在馬背上時才會碰到）
  function cloakSpheres(pos, o, P, W, rows) {
    const r = cfg.cloakRadius;
    for (let j = rows - 3; j < rows; j++) {
      for (let i = 0; i < W; i++) {
        const q = (j * W + i) * 3;
        const dx = pos[o] - P[q];
        const dy = pos[o + 1] - P[q + 1];
        const dz = pos[o + 2] - P[q + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-12) continue;
        const k = r / Math.sqrt(d2);
        pos[o] = P[q] + dx * k;
        pos[o + 1] = P[q + 1] + dy * k;
        pos[o + 2] = P[q + 2] + dz * k;
      }
    }
  }

  // input：{ bones, capsules（每組一個 Float32Array）, root: [x, y, z]（馬的位置）, ground（heightPatch）, groundY, surface,
  //          cloak: { positions, columns, rows } | null, riding, wind, carry }
  function step(dt, input, firstStep) {
    time += dt;
    for (const g of groups) updateRest(g, input.bones);
    const carry = input.carry;
    const [rx, ry, rz] = input.root;
    const jump = Math.hypot(rx - lastRoot[0], ry - lastRoot[1], rz - lastRoot[2]);
    // 第一次、或馬瞬間移動（停放、上下馬）時直接回到靜止樣子
    if (!initialized || (firstStep && (carry.teleport || jump > 2 + Math.hypot(carry.dx, carry.dz)))) {
      for (const g of groups) {
        g.pos.set(g.rest);
        g.prev.set(g.rest);
      }
      initialized = true;
      lastRoot[0] = rx;
      lastRoot[1] = ry;
      lastRoot[2] = rz;
      return;
    }
    lastRoot[0] = rx;
    lastRoot[1] = ry;
    lastRoot[2] = rz;
    if (firstStep && (carry.dx || carry.dy || carry.dz)) {
      for (const g of groups) {
        for (let k = 0; k < g.total; k++) {
          const o = k * 3;
          g.pos[o] += carry.dx;
          g.prev[o] += carry.dx;
          g.pos[o + 1] += carry.dy;
          g.prev[o + 1] += carry.dy;
          g.pos[o + 2] += carry.dz;
          g.prev[o + 2] += carry.dz;
        }
      }
    }
    const hvx = carry.vx * dt;
    const hvz = carry.vz * dt;
    const dt2 = dt * dt;
    const w = input.wind;
    const { surface, groundY } = input;
    const cloak = input.riding ? input.cloak : null;
    groups.forEach((g, gi) => {
      const { pos, prev, rest } = g;
      const caps = input.capsules[gi];
      const nCaps = caps.length / CAPSULE_STRIDE;
      for (let s = 0; s < g.count; s++) {
        const start = g.start[s];
        const n = g.len[s];
        const wet = g.wet[s];
        const gravity = cfg.gravity * (1 + cfg.wet.weight * wet);
        const damping = cfg.damping - cfg.wet.damping * wet;
        const drag = cfg.drag * (1 - cfg.wet.dragLoss * wet);
        const gust = 0.6 + 0.4 * Math.sin(time * 2.7 + s * 1.31);
        const windX = w.x * w.strength * cfg.wind * gust;
        const windZ = w.z * w.strength * cfg.wind * gust;
        const stiff = g.stiffness + cfg.wet.cling * wet;
        // 根部固定
        const r0 = start * 3;
        pos[r0] = prev[r0] = rest[r0];
        pos[r0 + 1] = prev[r0 + 1] = rest[r0 + 1];
        pos[r0 + 2] = prev[r0 + 2] = rest[r0 + 2];
        // 積分：重力 + 空氣阻力（相對於風的速度；vx…是相對於馬的位移，對空氣的速度要加上馬的速度）
        for (let i = 1; i < n; i++) {
          const o = (start + i) * 3;
          const vx = pos[o] - prev[o];
          const vy = pos[o + 1] - prev[o + 1];
          const vz = pos[o + 2] - prev[o + 2];
          prev[o] = pos[o];
          prev[o + 1] = pos[o + 1];
          prev[o + 2] = pos[o + 2];
          pos[o] += vx * damping + drag * (windX * dt - vx - hvx) * dt;
          pos[o + 1] += vy * damping - gravity * dt2 - drag * vy * dt;
          pos[o + 2] += vz * damping + drag * (windZ * dt - vz - hvz) * dt;
        }
        // 長度約束（根部固定）
        const seg = g.seg[s];
        for (let it = 0; it < cfg.iterations; it++) {
          for (let i = 1; i < n; i++) {
            const a = (start + i - 1) * 3;
            const b = a + 3;
            const dx = pos[b] - pos[a];
            const dy = pos[b + 1] - pos[a + 1];
            const dz = pos[b + 2] - pos[a + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
            const k = (d - seg) / d;
            const wa = i === 1 ? 0 : 0.5;
            pos[a] += dx * k * wa;
            pos[a + 1] += dy * k * wa;
            pos[a + 2] += dz * k * wa;
            pos[b] -= dx * k * (1 - wa);
            pos[b + 1] -= dy * k * (1 - wa);
            pos[b + 2] -= dz * k * (1 - wa);
          }
        }
        // 往靜止樣子拉回（根部最強）、碰撞、地面
        let submerged = false;
        for (let i = 1; i < n; i++) {
          const o = (start + i) * 3;
          const t = i / (n - 1);
          const k = stiff * (1 - t) * (1 - t) + cfg.wet.cling * wet * 0.3;
          if (k > 0) {
            pos[o] += (rest[o] - pos[o]) * k;
            pos[o + 1] += (rest[o + 1] - pos[o + 1]) * k;
            pos[o + 2] += (rest[o + 2] - pos[o + 2]) * k;
          }
          for (let c = 0; c < nCaps; c++) pushOut(pos, o, caps, c);
          if (cloak && g.tail && i < n * 0.6) cloakSpheres(pos, o, cloak.positions, cloak.columns, cloak.rows);
          if (pos[o + 1] < groundY + 0.4) {
            const floor = patchHeight(input.ground, pos[o], pos[o + 2]) + 0.01;
            if (pos[o + 1] < floor) pos[o + 1] = floor;
          }
          if (pos[o + 1] < surface) submerged = true;
        }
        // 濕：泡在水裡很快濕透，離開水後慢慢乾
        g.wet[s] = submerged ? Math.min(1, wet + dt / cfg.wet.soak) : Math.max(0, wet - dt / cfg.wet.dry);
      }
    });
  }

  return {
    groups,
    step,
    // 太遠時停止模擬；下次靠近時直接回到靜止樣子
    sleep() {
      initialized = false;
    },
  };
}
