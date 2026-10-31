// 水面的漣漪與水上的小事件：
//
// 漣漪：以玩家為中心的方形格子（cell 公尺一格、size × size 格），解 2D 波動方程式
//   h' = 2h − h_prev + C²·∇²h（再乘上阻尼）。陸地與泡在水裡的木樁是牆（高度固定為 0），所以漣漪碰到岸邊、木樁會反射，
//   多個漣漪互相干涉。玩家走遠時格子跟著平移。每步把高度與速度寫進一張 RGBA8 貼圖給水面 shader：
//   R = 高度、G = 速度（h − h_prev）。shader 以「−∇h × 速度」得到波往外傳的方向，選出 ( ) - _ / \ 的漣漪字元。
// 觸發漣漪的事件（impulse）：馬蹄踏水（hoofEffects）、丟石頭（點水面）、雨滴（weather.rain）、魚跳出水面、
//   順著河流漂的木頭與葉子、被風吹到水面的蘆葉。
// 細線層：跳出水面的魚、飛出去的石頭、水花。漂流物是 InstancedMesh（木頭、葉子各一種材質）。
// 也提供倒影需要的水面高度（reflectionLevel）與「附近有沒有水」（hasWater）。
import * as THREE from 'three';

export function createWaterSurface(cfg, { terrain, heightField, riverWidth, physics, materials, rng, reeds, lineStyle }) {
  const R = cfg.ripples;
  const N = R.size;
  const cell = R.cell;
  const area = N * cell;
  let h = new Float32Array(N * N);
  let prev = new Float32Array(N * N);
  let next = new Float32Array(N * N);
  const wall = new Uint8Array(N * N);
  const pixels = new Uint8Array(N * N * 4);
  const texture = new THREE.DataTexture(pixels, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const shared = materials.shared;
  shared.uRipple.value = texture;

  const origin = { x: 0, z: 0 };
  let placed = false;
  let surface = terrain.waterLevel; // 這個範圍的水面高度
  let waterCells = 0;
  let clock = 0;
  let stepClock = 0;
  const stats = { cells: 0, impulses: 0, drift: 0, fish: 0 };

  // ---- 牆（陸地、木樁）----
  function buildWalls(i0, i1, j0, j1) {
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const x = origin.x + (i + 0.5) * cell;
        const z = origin.z + (j + 0.5) * cell;
        wall[j * N + i] = terrain.heightAt(x, z) > surface - 0.02 ? 1 : 0;
      }
    }
    // 泡在水裡的木樁（棧道、橋的支柱）
    physics.query(origin.x + i0 * cell, origin.z + j0 * cell, origin.x + i1 * cell, origin.z + j1 * cell, (c) => {
      if (c.platform || c.box || c.obb || c.y0 > surface + 0.1 || c.y1 < surface) return;
      const r = c.r + cell * 0.5;
      for (let j = Math.floor((c.z - r - origin.z) / cell); j <= Math.floor((c.z + r - origin.z) / cell); j++) {
        for (let i = Math.floor((c.x - r - origin.x) / cell); i <= Math.floor((c.x + r - origin.x) / cell); i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const x = origin.x + (i + 0.5) * cell;
          const z = origin.z + (j + 0.5) * cell;
          if (Math.hypot(x - c.x, z - c.z) < r) wall[j * N + i] = 1;
        }
      }
    });
    waterCells = 0;
    for (let k = 0; k < wall.length; k++) if (!wall[k]) waterCells++;
  }

  // 玩家離中心太遠時以整格平移（已有的漣漪留在原來的世界位置）
  function recenter(px, pz) {
    if (placed && Math.abs(px - (origin.x + area / 2)) < area / 4 && Math.abs(pz - (origin.z + area / 2)) < area / 4) return;
    const nx = Math.round((px - area / 2) / cell) * cell;
    const nz = Math.round((pz - area / 2) / cell) * cell;
    const di = placed ? Math.round((nx - origin.x) / cell) : N;
    const dj = placed ? Math.round((nz - origin.z) / cell) : N;
    for (const arr of [h, prev]) {
      next.fill(0);
      if (Math.abs(di) < N && Math.abs(dj) < N) {
        for (let j = 0; j < N; j++) {
          const sj = j + dj;
          if (sj < 0 || sj >= N) continue;
          for (let i = 0; i < N; i++) {
            const si = i + di;
            if (si >= 0 && si < N) next[j * N + i] = arr[sj * N + si];
          }
        }
      }
      arr.set(next);
    }
    origin.x = nx;
    origin.z = nz;
    placed = true;
    surface = terrain.waterSurfaceAt(px, pz);
    buildWalls(0, N, 0, N);
    shared.uRippleArea.value.set(origin.x, origin.z, area, 1);
  }

  // ---- 漣漪的來源 ----
  // 在 (x, z) 往下壓一個半徑 radius（公尺）的凹陷，strength 約等於高度（公尺）
  function impulse(x, z, strength, radius = 0.35) {
    const ci = (x - origin.x) / cell;
    const cj = (z - origin.z) / cell;
    const r = Math.max(1, radius / cell);
    if (ci < -r || cj < -r || ci > N + r || cj > N + r) return;
    stats.impulses++;
    for (let j = Math.floor(cj - r); j <= Math.ceil(cj + r); j++) {
      for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) {
        if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
        const k = j * N + i;
        if (wall[k]) continue;
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d < 1) h[k] -= strength * (0.5 + 0.5 * Math.cos(Math.PI * d));
      }
    }
  }
  const isWater = (x, z) => {
    const i = Math.floor((x - origin.x) / cell);
    const j = Math.floor((z - origin.z) / cell);
    return i > 0 && j > 0 && i < N - 1 && j < N - 1 && !wall[j * N + i];
  };

  // 河流的流向（m/s）：沿著河道中心線往下游（沿河距離 s 從湖端算起，越上游越大），湖裡沒有流
  function flowAt(x, z, out) {
    const [d, s] = heightField.riverInfo(x, z);
    const T = terrain;
    if (d > riverWidth * 1.3 || heightField.lakeDistance(x, z) < 1.05 || T.waterDepthAt(x, z) <= 0) return out.set(0, 0);
    const c = heightField.riverCenter(s);
    return out.set(-c.tx * cfg.flow.speed, -c.tz * cfg.flow.speed);
  }

  // 漂流物：木頭與葉子，順著河流漂，碰到岸就停住慢慢轉；漂出範圍就在上游重生
  const D = cfg.drift;
  const driftGeo = {
    log: new THREE.CylinderGeometry(0.12, 0.12, 1, 6).rotateZ(Math.PI / 2),
    leaf: new THREE.OctahedronGeometry(1, 0).scale(1, 0.25, 0.7),
  };
  const driftMeshes = {
    log: new THREE.InstancedMesh(driftGeo.log, materials.get('wood'), D.logs),
    leaf: new THREE.InstancedMesh(driftGeo.leaf, materials.get('floatLeaf'), D.leaves),
  };
  const drifters = [];
  for (const [kind, count] of [
    ['log', D.logs],
    ['leaf', D.leaves],
  ]) {
    driftMeshes[kind].frustumCulled = false;
    driftMeshes[kind].count = 0;
    for (let n = 0; n < count; n++) drifters.push({ kind, x: 0, z: 0, yaw: rng.range(0, Math.PI * 2), spin: rng.range(-0.3, 0.3), size: kind === 'log' ? rng.range(0.9, 1.6) : rng.range(0.05, 0.09), alive: false, ripple: 0 });
  }
  const flow = new THREE.Vector2();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function spawnDrifter(d, px, pz) {
    // 在範圍內隨機找有流的水面（試幾次）
    for (let tries = 0; tries < 12; tries++) {
      const x = px + rng.range(-area * 0.45, area * 0.45);
      const z = pz + rng.range(-area * 0.45, area * 0.45);
      if (!isWater(x, z) || flowAt(x, z, flow).lengthSq() < 0.01) continue;
      Object.assign(d, { x, z, alive: true });
      return;
    }
    d.alive = false;
  }

  function updateDrift(dt, px, pz) {
    const counts = { log: 0, leaf: 0 };
    for (const d of drifters) {
      if (!d.alive || Math.abs(d.x - px) > area * 0.5 || Math.abs(d.z - pz) > area * 0.5) {
        if (rng.next() < dt * 0.5) spawnDrifter(d, px, pz);
        if (!d.alive) continue;
      }
      flowAt(d.x, d.z, flow);
      const nx = d.x + flow.x * dt;
      const nz = d.z + flow.y * dt;
      if (isWater(nx, nz)) {
        d.x = nx;
        d.z = nz;
      } else d.spin += (rng.next() - 0.5) * dt; // 擱淺：慢慢轉
      d.yaw += d.spin * dt;
      // 木頭撥動水面
      d.ripple += dt;
      if (d.kind === 'log' && d.ripple > 0.35 && flow.lengthSq() > 0.01) {
        impulse(d.x, d.z, D.logRipple, 0.4);
        d.ripple = 0;
      } else if (d.kind === 'leaf' && d.ripple > 2.5 && rng.next() < 0.3) {
        impulse(d.x, d.z, D.leafRipple, 0.25);
        d.ripple = 0;
      }
      const y = surface + 0.03 + 0.02 * Math.sin(clock * 1.7 + d.x);
      pos.set(d.x, y, d.z);
      q.setFromAxisAngle(UP, d.yaw);
      if (d.kind === 'log') scl.set(d.size, 1, 1);
      else scl.set(d.size, d.size, d.size);
      driftMeshes[d.kind].setMatrixAt(counts[d.kind]++, m4.compose(pos, q, scl));
    }
    for (const kind of ['log', 'leaf']) {
      driftMeshes[kind].count = counts[kind];
      driftMeshes[kind].instanceMatrix.needsUpdate = true;
    }
    stats.drift = counts.log + counts.leaf;
  }

  // 魚：偶爾在深一點的水裡跳出水面，畫成一小段沿拋物線飛的細線，出水與入水各一個漣漪
  const fish = { active: false, t: 0, x: 0, z: 0, dx: 0, dz: 0, next: rng.range(...cfg.fish.every) };
  function updateFish(dt, px, pz) {
    if (!fish.active) {
      if ((fish.next -= dt) > 0 || waterCells < 200) return;
      fish.next = rng.range(...cfg.fish.every);
      for (let tries = 0; tries < 10; tries++) {
        const x = px + rng.range(-area * 0.4, area * 0.4);
        const z = pz + rng.range(-area * 0.4, area * 0.4);
        if (!isWater(x, z) || terrain.waterDepthAt(x, z) < cfg.fish.minDepth) continue;
        const a = rng.range(0, Math.PI * 2);
        Object.assign(fish, { active: true, t: 0, x, z, dx: Math.cos(a), dz: Math.sin(a) });
        impulse(x, z, cfg.fish.ripple, 0.3);
        stats.fish++;
        return;
      }
      return;
    }
    fish.t += dt / cfg.fish.duration;
    if (fish.t >= 1) {
      fish.active = false;
      impulse(fish.x + fish.dx * cfg.fish.distance, fish.z + fish.dz * cfg.fish.distance, cfg.fish.ripple * 1.2, 0.3);
      splash(fish.x + fish.dx * cfg.fish.distance, fish.z + fish.dz * cfg.fish.distance, 4, 1.2);
    }
  }

  // 丟石頭：從 from 飛到水面上的 to，落水時起漣漪、濺水花
  const stones = [];
  function throwStone(from, to) {
    stones.push({ ax: from.x, ay: from.y, az: from.z, bx: to.x, by: surface, bz: to.z, t: 0, duration: Math.max(0.35, from.distanceTo(to) / cfg.stone.speed) });
  }
  function updateStones(dt) {
    for (let k = stones.length - 1; k >= 0; k--) {
      const s = stones[k];
      s.t += dt / s.duration;
      if (s.t >= 1) {
        impulse(s.bx, s.bz, cfg.stone.ripple, 0.35);
        splash(s.bx, s.bz, 7, 2.2);
        stones.splice(k, 1);
      }
    }
  }

  // 水花：往上濺的短線，落回水面消失
  const drops = Array.from({ length: 48 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false }));
  function splash(x, z, count, speed) {
    for (let n = 0; n < count; n++) {
      const d = drops.find((p) => !p.alive);
      if (!d) return;
      const a = rng.range(0, Math.PI * 2);
      const out = rng.range(0.2, 0.6) * speed;
      Object.assign(d, { x, y: surface + 0.02, z, vx: Math.cos(a) * out, vy: speed * rng.range(0.7, 1.3), vz: Math.sin(a) * out, alive: true });
    }
  }
  function updateDrops(dt) {
    for (const d of drops) {
      if (!d.alive) continue;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < surface) d.alive = false;
    }
  }

  // ---- 每一步 ----
  function simulate(dt) {
    const C2 = (R.speed * dt) / cell;
    const k2 = C2 * C2;
    const damp = R.damping;
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if (wall[k]) {
          next[k] = 0;
          continue;
        }
        const lap = h[k - 1] + h[k + 1] + h[k - N] + h[k + N] - 4 * h[k];
        next[k] = (2 * h[k] - prev[k] + k2 * lap) * damp;
      }
    }
    const t = prev;
    prev = h;
    h = next;
    next = t;
  }

  function upload() {
    const s = R.encode;
    for (let k = 0, p = 0; k < h.length; k++, p += 4) {
      const v = h[k] - prev[k];
      pixels[p] = Math.max(0, Math.min(255, 128 + h[k] * s));
      pixels[p + 1] = Math.max(0, Math.min(255, 128 + v * s * R.velocityGain));
      pixels[p + 2] = wall[k] ? 255 : 0;
      pixels[p + 3] = 255;
    }
    texture.needsUpdate = true;
  }

  const reedPoint = new THREE.Vector2();
  function weatherRipples(dt, weather, px, pz) {
    // 雨滴：每秒 rain × rate 顆落在範圍內的水面上
    const rain = weather.rain ?? 0;
    let drops = rain * cfg.rain.rate * dt;
    while (drops > 0) {
      if (drops < 1 && rng.next() > drops) break;
      drops -= 1;
      const x = origin.x + rng.next() * area;
      const z = origin.z + rng.next() * area;
      if (isWater(x, z)) impulse(x, z, cfg.rain.ripple, 0.15);
    }
    // 蘆葉：風吹時，附近泡在水裡的蘆葦偶爾葉尖碰到水面
    if (reeds && weather.wind.strength > 0.3) {
      const chance = weather.wind.strength * cfg.reeds.rate * dt;
      for (const c of reeds.clumps) {
        if (Math.abs(c.x - px) > area * 0.45 || Math.abs(c.z - pz) > area * 0.45) continue;
        if (rng.next() > chance) continue;
        reedPoint.set(c.x + weather.wind.x * 0.4, c.z + weather.wind.z * 0.4);
        impulse(reedPoint.x, reedPoint.y, cfg.reeds.ripple, 0.18);
      }
    }
  }

  return {
    objects: [driftMeshes.log, driftMeshes.leaf],
    impulse,
    splash,
    throwStone,
    flowAt,
    get surface() {
      return surface;
    },
    // 範圍內有沒有水（倒影、漣漪只在附近有水時才做）
    get hasWater() {
      return waterCells > 0;
    },
    // (x, z) 是不是在範圍內的水面上
    isWater,
    update(dt, center, weather) {
      clock += dt;
      recenter(center.x, center.z);
      if (!waterCells) {
        shared.uRippleArea.value.w = 0;
        return;
      }
      shared.uRippleArea.value.w = 1;
      weatherRipples(dt, weather, center.x, center.z);
      updateDrift(dt, center.x, center.z);
      updateFish(dt, center.x, center.z);
      updateStones(dt);
      updateDrops(dt);
      stepClock += dt;
      let steps = 0;
      while (stepClock >= R.step && steps < 4) {
        simulate(R.step);
        stepClock -= R.step;
        steps++;
      }
      if (steps === 4) stepClock = 0;
      upload();
      stats.cells = waterCells;
    },
    // 細線層：魚、石頭、水花
    lines: {
      emit(push) {
        const style = lineStyle;
        if (fish.active) {
          const t = fish.t;
          const pt = (u) => {
            const k = Math.min(1, Math.max(0, u));
            return [fish.x + fish.dx * cfg.fish.distance * k, surface + 4 * cfg.fish.height * k * (1 - k), fish.z + fish.dz * cfg.fish.distance * k];
          };
          const a = pt(t - 0.12);
          const b = pt(t);
          push(a[0], a[1], a[2], b[0], b[1], b[2], style.fish, true);
        }
        for (const s of stones) {
          const pt = (u) => [s.ax + (s.bx - s.ax) * u, s.ay + (s.by - s.ay) * u + 4 * cfg.stone.arc * u * (1 - u), s.az + (s.bz - s.az) * u];
          const a = pt(Math.max(0, s.t - 0.05));
          const b = pt(s.t);
          push(a[0], a[1], a[2], b[0], b[1], b[2], style.stone, true);
        }
        for (const d of drops) {
          if (!d.alive) continue;
          push(d.x, d.y, d.z, d.x - d.vx * 0.04, d.y - d.vy * 0.04, d.z - d.vz * 0.04, style.splash, true);
        }
      },
    },
    stats,
  };
}
