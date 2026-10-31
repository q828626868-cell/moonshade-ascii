// 及膝的旅行披風：Verlet 布料（columns × rows 個節點）。
//   頂排固定在肩上：沿頸後與兩肩排成一道弧，以胸椎骨（spine3）為基準跟著身體移動
//   受重力、風（含陣風擾動）、阻尼影響；人物（或馬）移動時，節點的慣性讓披風自然飄動
//   約束：水平、垂直、對角線（抗剪）與隔一個節點的彎曲約束；越往下越寬（下擺展開）
//   碰撞：每一步把節點推出人物的碰撞體（胸、腰、臀的橢圓體，四肢與劍的膠囊），
//         再加上 extraColliders（騎乘時的馬背、馬頸）與地面——不穿模
// 模擬本身在 physics/clothSim.js（純數學），由 physics/softBodies.js 放在 Web Worker（或主執行緒）裡跑；
// 這裡負責：網格、掛點與碰撞體的世界座標（gather）、把結果寫回網格（apply）。
// 渲染：雙面的網格，頂點位置每次有新結果時更新、法線重算。
import * as THREE from 'three';
import { COLLIDER_STRIDE } from '../physics/clothSim.js';
import { createHeightPatch, fillHeightPatch } from '../physics/heightPatch.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function createCloak(cfg, character, materials, terrain) {
  const W = cfg.columns;
  const H = cfg.rows;
  const n = W * H;
  const pos = new Float32Array(n * 3);
  const s = character.scale;

  // 頂排掛點（靜止姿勢）：以頸後為中心、沿兩肩的弧
  const neck = character.joint.neck;
  const anchors = [];
  for (let i = 0; i < W; i++) {
    const u = i / (W - 1);
    const a = THREE.MathUtils.degToRad(-cfg.spread + 2 * cfg.spread * u); // 0 = 正後方
    const side = Math.abs(Math.sin(a));
    const rest = new THREE.Vector3(
      Math.sin(a) * cfg.shoulderWidth,
      neck.y - 0.015 - side * cfg.shoulderDrop,
      neck.z - Math.cos(a) * cfg.backDepth,
    );
    anchors.push(character.attach('spine3', rest));
  }
  const topWidth = (2 * cfg.spread * Math.PI) / 180 * ((cfg.shoulderWidth + cfg.backDepth) / 2) / (W - 1);
  const rowLength = cfg.length / (H - 1);
  const widthAt = (j) => topWidth * (1 + (cfg.flare * j) / (H - 1));

  // 約束 [i, j, 靜止長度]
  const constraints = [];
  const idx = (i, j) => j * W + i;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (i < W - 1) constraints.push(idx(i, j), idx(i + 1, j), widthAt(j));
      if (j < H - 1) constraints.push(idx(i, j), idx(i, j + 1), rowLength);
      if (i < W - 1 && j < H - 1) {
        const d = Math.hypot((widthAt(j) + widthAt(j + 1)) / 2, rowLength);
        constraints.push(idx(i, j), idx(i + 1, j + 1), d, idx(i + 1, j), idx(i, j + 1), d);
      }
      if (i < W - 2) constraints.push(idx(i, j), idx(i + 2, j), widthAt(j) * 2 * cfg.bend);
      if (j < H - 2) constraints.push(idx(i, j), idx(i, j + 2), rowLength * 2 * cfg.bend);
    }
  }

  // 幾何
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const index = [];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) index.push(idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i, j), idx(i + 1, j + 1), idx(i + 1, j));
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, materials.get('cloak'));
  mesh.name = 'cloak';
  mesh.frustumCulled = false;

  const extraColliders = []; // 騎乘時的馬背、馬頸：{ type: 'sphere', center: (out) => Vector3, r } 或 capsule
  // 給模擬的輸入（每次 gather 重新填）
  const input = {
    anchors: new Float32Array(W * 3),
    colliders: new Float32Array(32 * COLLIDER_STRIDE),
    count: 0,
    ground: createHeightPatch(13, 0.5),
    wind: { x: 0, z: 0, strength: 0 },
    time: 0,
    carry: null,
  };
  const ref = new THREE.Vector3(); // 結果對應的身體位置（worker 晚一幀回來時，用來補上這段時間的平移）

  // 第一次顯示前：整片從掛點直直垂下
  function reset() {
    character.object.updateMatrixWorld(true);
    for (let i = 0; i < W; i++) {
      anchors[i](_a);
      for (let j = 0; j < H; j++) {
        const o = idx(i, j) * 3;
        pos[o] = _a.x;
        pos[o + 1] = _a.y - j * rowLength;
        pos[o + 2] = _a.z;
      }
    }
    ref.copy(character.object.position);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // 整理這一次的輸入：掛點、碰撞體（目前骨頭的世界座標）、腳下的地面
  function gather(weather, time, carry) {
    for (let i = 0; i < W; i++) {
      anchors[i](_a);
      input.anchors[i * 3] = _a.x;
      input.anchors[i * 3 + 1] = _a.y;
      input.anchors[i * 3 + 2] = _a.z;
    }
    const list = [...character.colliders, ...extraColliders];
    if (list.length * COLLIDER_STRIDE > input.colliders.length) input.colliders = new Float32Array(list.length * COLLIDER_STRIDE);
    const C = input.colliders;
    list.forEach((c, k) => {
      const o = k * COLLIDER_STRIDE;
      if (c.type === 'ellipsoid') {
        c.center(_a);
        c.bone.getWorldQuaternion(_q);
        C.set([0, _a.x, _a.y, _a.z, _q.x, _q.y, _q.z, _q.w, c.radii.x, c.radii.y, c.radii.z], o);
      } else if (c.type === 'capsule') {
        c.a(_a);
        c.b(_b);
        C.set([1, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, c.r], o);
      } else {
        c.center(_a);
        C.set([2, _a.x, _a.y, _a.z, c.r], o);
      }
    });
    input.count = list.length;
    const root = character.object.position;
    fillHeightPatch(input.ground, root.x, root.z, terrain.heightAt);
    input.wind.x = weather.wind.x;
    input.wind.z = weather.wind.z;
    input.wind.strength = weather.wind.strength;
    input.time = time;
    input.carry = carry;
    return input;
  }

  // 模擬的結果寫回網格；at：結果對應的身體位置
  function apply(result, at) {
    pos.set(result);
    ref.copy(at);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  // 每幀（人物擺好姿勢之後）：結果若是幾幀前算的，整片跟著身體平移過去
  function follow() {
    mesh.position.subVectors(character.object.position, ref);
  }

  return {
    mesh,
    reset,
    gather,
    apply,
    follow,
    extraColliders,
    nodes: n,
    positions: pos,
    columns: W,
    rows: H,
    // 給 physics/clothSim.js
    layout: { W, H, constraints: Float32Array.from(constraints), rowLength, scale: s },
    get ref() {
      return ref;
    },
  };
}
