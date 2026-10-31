// 馬的鬃毛、前髮與尾巴：每根毛是一條 Verlet 鏈，畫在細線層。
//
// 每根毛有一個「靜止的樣子」（lay）：沿著頸側垂下的鬃毛、順著額頭垂下的前髮、從尾根往後再往下垂的尾巴，
//   以靜止姿勢的座標記錄在所屬骨頭的局部空間，跟著骨頭移動。
// 每個固定步長：
//   根部固定在骨頭上；其餘節點受重力、風與空氣阻力（相對於空氣的速度：馬跑得越快，毛越往後飄；
//   急停時毛保有原本的速度而往前甩）；長度約束；往靜止樣子拉回一點（根部最強、尖端幾乎沒有，讓毛有點彈性）；
//   與馬的頸、頭、身體、後腿（膠囊）、騎士披風的下緣（球）與地面碰撞。
// 濕：毛浸到水面以下就開始變濕，離開水後慢慢乾。濕的毛變重、阻尼大、不太被風吹，
//   而且被拉回靜止樣子的力變強（貼在身上），尾巴不再散開；顏色變深。
// 顏色：細線層依所在格的光照亮度分四級上色（sceneLight）；每根毛分三段，越往尖端越細越淡。
// 距離：離鏡頭遠時只畫一部分的毛，超過 lod.simDistance 就不模擬也不畫。
// 模擬本身在 physics/hairSim.js，由 physics/softBodies.js 放在 Web Worker（或主執行緒）裡跑；這裡建毛的配置、整理輸入、畫細線。
import * as THREE from 'three';
import { createHeightPatch, fillHeightPatch } from '../physics/heightPatch.js';

const _a = new THREE.Vector3();

export function createHorseHair(cfg, { horse, terrain, rng, lineStyle }) {
  const B = horse.bones;
  const J = horse.joint;
  const H = horse.headPoint;
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const range = ([a, b]) => rng.range(a, b);

  // ---- 每根毛的靜止樣子（靜止姿勢的世界座標）----
  // 回傳 { bone, points: Vector3[] }
  function maneStrand() {
    const t = rng.range(0.02, 1);
    const root = horse.crestAt(t).add(v3(rng.range(-0.015, 0.012), 0, rng.range(-0.02, 0.02)));
    const bone = t < 0.36 ? 'neck3' : t < 0.7 ? 'neck2' : t < 0.92 ? 'neck1' : 'chest';
    const len = range(cfg.mane.length) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 1.2))); // 中段最長
    const dir = v3(-0.55 + rng.range(-0.1, 0.1), -0.82, 0.12 + rng.range(-0.08, 0.08)).normalize(); // 往右側垂下
    return line(bone, root, dir, len, cfg.mane.nodes, (p, s) => p.add(v3(0, 0.04 * Math.sin(Math.PI * s), 0))); // 根部先略為隆起
  }
  function forelockStrand() {
    const root = H(rng.range(0.02, 0.07), 0.075, rng.range(-0.035, 0.035));
    const dir = horse.headAxis.clone().addScaledVector(horse.headFace, 0.12).add(v3(rng.range(-0.08, 0.08), 0, 0)).normalize();
    return line('head', root, dir, range(cfg.forelock.length), cfg.forelock.nodes);
  }
  const dockA = J.tail.clone();
  const dockB = v3(0, 1.27, -1.3);
  const dockDir = dockB.clone().sub(dockA).normalize();
  const dockSide = v3(1, 0, 0);
  const dockUp = dockSide.clone().cross(dockDir).normalize().negate(); // 垂直於尾根、朝上後方
  function tailStrand() {
    const u = rng.range(0, 1);
    const angle = rng.range(-1.9, 1.9); // 尾根的上方與兩側長毛
    const out = dockUp.clone().multiplyScalar(Math.cos(angle)).addScaledVector(dockSide, Math.sin(angle));
    const root = dockA.clone().lerp(dockB, u).addScaledVector(out, 0.045);
    const len = range(cfg.tail.length) * (1 - 0.25 * u);
    const nodes = Math.round(range(cfg.tail.nodes));
    const pts = [];
    for (let i = 0; i < nodes; i++) {
      const s = (i / (nodes - 1)) * len;
      const along = Math.min(s, 0.12); // 先順著尾根往後，再往下垂
      const p = root.clone().addScaledVector(dockDir, along).add(v3(0, -Math.max(0, s - 0.12), 0));
      p.addScaledVector(out, s * cfg.tail.spread); // 往外散開
      pts.push(p);
    }
    return { bone: 'tail', points: pts, out };
  }
  function line(bone, root, dir, len, nodeRange, bend) {
    const nodes = Math.round(range(nodeRange));
    const pts = [];
    for (let i = 0; i < nodes; i++) {
      const s = i / (nodes - 1);
      const p = root.clone().addScaledVector(dir, s * len);
      pts.push(bend ? bend(p, s) : p);
    }
    return { bone, points: pts };
  }

  // ---- 打包成連續陣列 ----
  const groups = [];
  function buildGroup(name, count, make, def) {
    const strands = Array.from({ length: count }, make);
    const total = strands.reduce((n, s) => n + s.points.length, 0);
    const g = {
      name,
      def,
      count,
      start: new Int32Array(count),
      len: new Int32Array(count),
      seg: new Float32Array(count),
      bone: strands.map((s) => B[s.bone]),
      out: strands.map((s) => s.out ?? null),
      local: new Float32Array(total * 3), // 靜止樣子，骨頭局部座標
      pos: new Float32Array(total * 3),
      wet: new Float32Array(count),
      total,
      colliders: [],
      styles: null,
    };
    let k = 0;
    strands.forEach((s, i) => {
      g.start[i] = k;
      g.len[i] = s.points.length;
      g.seg[i] = s.points[0].distanceTo(s.points[1]);
      const j = J[s.bone];
      for (const p of s.points) {
        g.local[k * 3] = p.x - j.x;
        g.local[k * 3 + 1] = p.y - j.y;
        g.local[k * 3 + 2] = p.z - j.z;
        k++;
      }
    });
    // 三段（根、中、尖）× 乾／濕 的線條樣式：越往尖端越細越淡
    const L = cfg.lines;
    g.styles = [false, true].map((wet) =>
      [0, 1, 2].map((part) =>
        lineStyle({
          color: wet ? def.wetColor : def.color,
          width: L.width[part] * def.width,
          opacity: L.opacity[part],
          fadeStart: L.fadeStart,
          fadeEnd: L.fadeEnd,
          sceneLight: true,
          lightRange: L.lightRange,
        }),
      ),
    );
    groups.push(g);
    return g;
  }
  const mane = buildGroup('mane', cfg.mane.count, maneStrand, cfg.mane);
  const forelock = buildGroup('forelock', cfg.forelock.count, forelockStrand, cfg.forelock);
  const tail = buildGroup('tail', cfg.tail.count, tailStrand, cfg.tail);

  // ---- 碰撞體：膠囊 { a, b, r }（端點每步由骨頭更新）----
  const capsule = (boneA, pa, boneB, pb, r) => {
    const la = pa.clone().sub(J[boneA]);
    const lb = pb.clone().sub(J[boneB]);
    return { a: new THREE.Vector3(), b: new THREE.Vector3(), r, update: (c) => (c.a.copy(la).applyMatrix4(B[boneA].matrixWorld), c.b.copy(lb).applyMatrix4(B[boneB].matrixWorld)) };
  };
  const neck = [
    capsule('neck1', v3(0, 1.38, 0.72), 'neck2', J.neck2, 0.17),
    capsule('neck2', J.neck2, 'neck3', J.neck3, 0.13),
    capsule('neck3', J.neck3, 'head', H(0.08, -0.05), 0.1),
    capsule('chest', v3(0, 1.3, 0.55), 'chest', v3(0, 1.3, 0.1), 0.3),
  ];
  const head = [capsule('head', H(0.06, -0.05), 'head', H(0.55, -0.04), 0.1)];
  const legs = [];
  for (const s of ['L', 'R']) {
    legs.push(
      capsule(`femur${s}`, J[`femur${s}`], `tibia${s}`, J[`tibia${s}`], 0.13),
      capsule(`tibia${s}`, J[`tibia${s}`], `hock${s}`, J[`hock${s}`], 0.08),
      capsule(`hock${s}`, J[`hock${s}`], `hPastern${s}`, J[`hPastern${s}`], 0.05),
      capsule('pelvis', v3((s === 'L' ? 1 : -1) * 0.13, 1.3, -0.95), 'pelvis', v3((s === 'L' ? 1 : -1) * 0.13, 1.05, -1.05), 0.15), // 臀端
    );
  }
  const rump = [capsule('pelvis', v3(0, 1.32, -0.45), 'pelvis', v3(0, 1.35, -0.95), 0.3), ...legs];
  mane.colliders = neck;
  forelock.colliders = head;
  tail.colliders = rump;

  // ---- 模擬：physics/hairSim.js（純數學，放在 Web Worker 或主執行緒裡跑，見 physics/softBodies.js）----
  // 這裡負責整理輸入（骨頭矩陣、碰撞膠囊、地面）與保存結果（每根毛的節點、濕的程度）
  const boneList = [...new Set(groups.flatMap((g) => g.bone))];
  const boneIndex = new Map(boneList.map((b, i) => [b, i]));
  const layout = {
    groups: groups.map((g) => ({
      count: g.count,
      start: g.start,
      len: g.len,
      seg: g.seg,
      bone: Int32Array.from(g.bone, (b) => boneIndex.get(b)),
      local: g.local,
      stiffness: g.def.stiffness,
      tail: g === tail,
    })),
  };
  const input = {
    bones: new Float32Array(boneList.length * 16),
    capsules: groups.map((g) => new Float32Array(g.colliders.length * 7)),
    root: [0, 0, 0],
    ground: createHeightPatch(17, 0.5),
    groundY: 0,
    surface: 0,
    riding: false,
    wind: { x: 0, z: 0, strength: 0 },
    carry: null,
  };
  let ready = false; // 有結果可以畫
  let cameraDistance = 0;
  const ref = new THREE.Vector3(); // 結果對應的馬的位置（worker 晚一幀回來時補上這段時間的平移）
  const offset = new THREE.Vector3();

  // 整理這一次的輸入；馬離鏡頭太遠時回傳 null（不模擬也不畫）
  function gather(weather, cameraPos, riding, carry) {
    horse.object.getWorldPosition(_a);
    cameraDistance = cameraPos ? _a.distanceTo(cameraPos) : 0;
    if (cameraDistance > cfg.lod.simDistance) {
      ready = false;
      return null;
    }
    boneList.forEach((b, i) => input.bones.set(b.matrixWorld.elements, i * 16));
    groups.forEach((g, gi) => {
      g.colliders.forEach((c, k) => {
        c.update(c);
        input.capsules[gi].set([c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r], k * 7);
      });
    });
    input.root[0] = _a.x;
    input.root[1] = _a.y;
    input.root[2] = _a.z;
    fillHeightPatch(input.ground, _a.x, _a.z, terrain.heightAt);
    input.groundY = terrain.heightAt(_a.x, _a.z);
    input.surface = terrain.waterSurfaceAt(_a.x, _a.z);
    input.riding = riding;
    input.wind.x = weather.wind.x;
    input.wind.z = weather.wind.z;
    input.wind.strength = weather.wind.strength;
    input.carry = carry;
    return input;
  }

  // 結果：每組的節點座標與濕的程度；at：結果對應的馬的位置
  function apply(positions, wet, at) {
    groups.forEach((g, gi) => {
      g.pos.set(positions[gi]);
      g.wet.set(wet[gi]);
    });
    ref.copy(at);
    ready = true;
  }

  // ---- 細線 ----
  const lines = {
    emit(push) {
      if (!ready || cameraDistance > cfg.lod.simDistance) return;
      // 結果若是幾幀前算的，整體跟著馬平移過去
      horse.object.getWorldPosition(offset).sub(ref);
      const ox = offset.x;
      const oy = offset.y;
      const oz = offset.z;
      const L = cfg.lod;
      const stride = cameraDistance < L.half ? 1 : cameraDistance < L.quarter ? 2 : 4; // 每幾根畫一根
      const step = cameraDistance < L.full ? 1 : 2; // 每段跨幾節
      for (const g of groups) {
        const { pos } = g;
        for (let s = 0; s < g.count; s += stride) {
          const start = g.start[s];
          const n = g.len[s];
          const styles = g.styles[g.wet[s] > 0.5 ? 1 : 0];
          for (let i = 0; i < n - 1; i += step) {
            const j = Math.min(n - 1, i + step);
            const a = (start + i) * 3;
            const b = (start + j) * 3;
            const part = i < (n - 1) * 0.4 ? 0 : i < (n - 1) * 0.75 ? 1 : 2;
            push(pos[a] + ox, pos[a + 1] + oy, pos[a + 2] + oz, pos[b] + ox, pos[b + 1] + oy, pos[b + 2] + oz, styles[part], i === 0);
          }
        }
      }
    },
  };

  return {
    layout,
    gather,
    apply,
    lines,
    get stats() {
      const wet = groups.reduce((m, g) => Math.max(m, ...g.wet), 0);
      return {
        strands: groups.reduce((n, g) => n + g.count, 0),
        nodes: groups.reduce((n, g) => n + g.total, 0),
        wet,
        distance: cameraDistance,
      };
    },
  };
}
