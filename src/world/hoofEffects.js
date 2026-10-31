// 馬蹄對地面的影響：每隻蹄落地時呼叫 step()。
//   蹄印：寫進以玩家為中心的世界座標遮罩（DataTexture），地形 shader 在泥地、沙、雪、泥土路上把那幾格換成蹄印字元；
//         遮罩值隨時間遞減，shader 以世界座標雜湊比較，越舊的蹄印剩下的格子越少，漸漸消失。玩家走遠時遮罩跟著平移。
//   草：壓彎落蹄處的草（與人、馬身共用 trample 欄位）。
//   揚塵：跑過沙地、泥土路、乾草地時，往後上方揚起幾小塊塵土（InstancedMesh，材質 dust，畫成點狀字元）。
//   踩水：濺起往上的水花細線，並在水面的漣漪格子（world/waterSurface.js）壓一下，漣漪往外擴散、反射。
import * as THREE from 'three';

export function createHoofEffects(cfg, { terrain, materials, trample, rng, splashStyle, water }) {
  // ---- 蹄印遮罩 ----
  const P = cfg.prints;
  const N = P.size;
  const area = N * P.texel;
  const data = new Uint8Array(N * N);
  const texture = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const origin = { x: 0, z: 0 }; // 遮罩左上角（最小 x、z），對齊格子
  let placed = false;
  const uniforms = materials.terrain().uniforms;
  uniforms.uPrints.value = texture;
  let dirty = false;
  let decayTimer = 0;
  let printCells = 0; // 遮罩中還看得到的格數（開發者面板）

  // 玩家離中心太遠時平移遮罩（以整格平移，已有的蹄印留在原來的世界位置）
  function recenter(px, pz) {
    const cx = origin.x + area / 2;
    const cz = origin.z + area / 2;
    if (placed && Math.abs(px - cx) < area / 4 && Math.abs(pz - cz) < area / 4) return;
    const nx = Math.round((px - area / 2) / P.texel) * P.texel;
    const nz = Math.round((pz - area / 2) / P.texel) * P.texel;
    const di = placed ? Math.round((nx - origin.x) / P.texel) : N;
    const dj = placed ? Math.round((nz - origin.z) / P.texel) : N;
    if (Math.abs(di) >= N || Math.abs(dj) >= N) data.fill(0);
    else data.set(shift(di, dj));
    origin.x = nx;
    origin.z = nz;
    placed = true;
    uniforms.uPrintArea.value.set(origin.x, origin.z, area, 1);
    dirty = true;
  }
  const scratch = new Uint8Array(N * N);
  function shift(di, dj) {
    scratch.fill(0);
    for (let j = 0; j < N; j++) {
      const sj = j + dj;
      if (sj < 0 || sj >= N) continue;
      for (let i = 0; i < N; i++) {
        const si = i + di;
        if (si >= 0 && si < N) scratch[j * N + i] = data[sj * N + si];
      }
    }
    return scratch;
  }

  function stampPrint(x, z) {
    const r = Math.round(P.radius / P.texel);
    const ci = Math.floor((x - origin.x) / P.texel);
    const cj = Math.floor((z - origin.z) / P.texel);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r + 0.5) continue;
        const a = ci + i;
        const b = cj + j;
        if (a >= 0 && a < N && b >= 0 && b < N) data[b * N + a] = 255;
      }
    }
    dirty = true;
  }

  function decay(dt) {
    decayTimer += dt;
    if (decayTimer < 0.5) return;
    const amount = Math.max(1, Math.round((255 * decayTimer) / P.life));
    decayTimer = 0;
    printCells = 0;
    for (let k = 0; k < data.length; k++) {
      const v = data[k];
      if (v) {
        printCells++;
        data[k] = v > amount ? v - amount : 0;
        dirty = true;
      }
    }
  }

  // ---- 揚塵 ----
  const D = cfg.dust;
  const dustMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), materials.get('dust'), D.max);
  dustMesh.name = 'hoof-dust';
  dustMesh.frustumCulled = false;
  dustMesh.count = 0;
  const dust = Array.from({ length: D.max }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 0 }));
  const m4 = new THREE.Matrix4();
  const range = ([a, b]) => rng.range(a, b);

  function kickDust(x, y, z, hx, hz, speed) {
    const n = Math.round(range(D.perStep));
    for (let k = 0; k < n; k++) {
      const p = dust.find((d) => d.age >= d.life);
      if (!p) return;
      const back = -0.25 * speed * rng.range(0.3, 1);
      Object.assign(p, {
        x: x + rng.range(-0.08, 0.08),
        y: y + 0.03,
        z: z + rng.range(-0.08, 0.08),
        vx: hx * back + rng.range(-0.4, 0.4),
        vy: rng.range(0.4, 1.1),
        vz: hz * back + rng.range(-0.4, 0.4),
        age: 0,
        life: range(D.life),
        size: range(D.size),
      });
    }
  }

  function updateDust(dt) {
    let count = 0;
    for (const p of dust) {
      if (p.age >= p.life) continue;
      p.age += dt;
      const drag = Math.exp(-3 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - 1.2 * dt; // 塵土很輕，慢慢落下
      p.x += p.vx * dt;
      p.y = Math.max(p.y + p.vy * dt, terrain.heightAt(p.x, p.z) + 0.02);
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const s = p.size * (0.6 + 0.8 * t) * (1 - t * t); // 散開、變淡
      if (s <= 0.005) continue;
      m4.makeScale(s, s * 0.7, s).setPosition(p.x, p.y, p.z);
      dustMesh.setMatrixAt(count++, m4);
    }
    dustMesh.count = count;
    dustMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 水花與漣漪 ----
  const S = cfg.splash;
  const drops = Array.from({ length: 64 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, floor: 0 }));

  function splash(x, z, speed) {
    const surface = terrain.waterSurfaceAt(x, z);
    water?.impulse(x, z, S.ripple * Math.min(1.5, 0.6 + speed / 5), 0.35);
    const n = Math.round(range(S.droplets) * Math.min(1.5, 0.5 + speed / 4));
    for (let k = 0; k < n; k++) {
      const d = drops.find((q) => q.age >= q.life);
      if (!d) return;
      const a = rng.range(0, Math.PI * 2);
      const out = rng.range(0.2, 0.7) * S.speed;
      Object.assign(d, {
        x,
        y: surface + 0.02,
        z,
        vx: Math.cos(a) * out,
        vy: S.speed * rng.range(0.6, 1.2) * Math.min(1.6, 0.6 + speed / 5),
        vz: Math.sin(a) * out,
        age: 0,
        life: 2,
        floor: surface,
      });
    }
  }

  function updateWater(dt) {
    for (const d of drops) {
      if (d.age >= d.life) continue;
      d.age += dt;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < d.floor) d.age = d.life; // 落回水面
    }
  }

  // 細線層：水花是沿速度方向的短線
  const lines = {
    emit(push) {
      for (const d of drops) {
        if (d.age >= d.life) continue;
        const k = 0.04;
        push(d.x, d.y, d.z, d.x - d.vx * k, d.y - d.vy * k, d.z - d.vz * k, splashStyle, true);
      }
    },
  };

  return {
    object: dustMesh,
    lines,
    // 一隻蹄落地：x、z 落點，heading 馬的朝向，speed 馬的速度（m/s），time 目前時間
    step(x, z, heading, speed, time) {
      const hx = Math.sin(heading);
      const hz = Math.cos(heading);
      const depth = terrain.waterDepthAt(x, z);
      if (depth > S.minDepth) {
        splash(x, z, speed);
        return;
      }
      trample.stamp(x, z, cfg.trampleRadius, speed > 0.3 ? hx : 0, speed > 0.3 ? hz : 0, time);
      const w = terrain.surfaceAt(x, z);
      if (w.mud + w.sand + w.snow + w.road > P.minWeight) stampPrint(x, z);
      if (speed > D.minSpeed && w.sand + w.road + w.dry > D.dryWeight) kickDust(x, terrain.heightAt(x, z), z, hx, hz, speed);
    },
    update(dt, center) {
      recenter(center.x, center.z);
      decay(dt);
      updateDust(dt);
      updateWater(dt);
      if (dirty) {
        texture.needsUpdate = true;
        dirty = false;
      }
    },
    get stats() {
      return { prints: printCells, dust: dustMesh.count, drops: drops.filter((d) => d.age < d.life).length };
    },
  };
}
