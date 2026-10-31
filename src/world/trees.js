// 樹的程序化幾何：4 種（高針葉樹、矮松、樺樹、枯木）× 2 種結構變體，各有近景與遠景（LOD）版本。
// 樹幹、枝條是實際的圓柱幾何；葉叢是一層層不規則的團塊，有缺口，不是平滑圓錐。
// 葉叢的法線由團塊中心往外（團塊內部不畫摺邊線，團塊之間的深度落差才畫輪廓，所以看得出層次）。
// 幾何以公尺為單位、根部在原點；每個頂點帶：
//   aMaterial 材質 ID（樹幹與葉叢在同一個幾何裡，一種變體一次繪製呼叫）
//   aFlex     隨風擺動的權重（越高越大、葉叢比樹幹大；shader 依此位移）
import * as THREE from 'three';
import { hashU } from './heightField.js';

const UP = new THREE.Vector3(0, 1, 0);

function createBuilder(height) {
  const pos = [];
  const nor = [];
  const mat = [];
  const flex = [];
  return {
    // radial：{ center, scale }——以團塊中心往外的法線（橢球的梯度）
    push(geometry, materialId, flexScale, radial = null) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const p = g.attributes.position.array;
      const n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        pos.push(p[i], p[i + 1], p[i + 2]);
        if (radial) {
          const { center: c, scale: s } = radial;
          const nx = (p[i] - c.x) / (s.x * s.x);
          const ny = (p[i + 1] - c.y) / (s.y * s.y);
          const nz = (p[i + 2] - c.z) / (s.z * s.z);
          const l = Math.hypot(nx, ny, nz) || 1;
          nor.push(nx / l, ny / l, nz / l);
        } else {
          nor.push(n[i], n[i + 1], n[i + 2]);
        }
        mat.push(materialId);
        const t = Math.max(0, p[i + 1]) / height;
        flex.push(t * t * flexScale);
      }
    },
    build() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geometry.setAttribute('aMaterial', new THREE.Float32BufferAttribute(mat, 1));
      geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

// 從 a 到 b 的圓柱（樹幹、枝條），a 端半徑 r0、b 端 r1
function limb(a, b, r0, r1, sides) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// 不規則的葉叢團塊：多面體頂點依位置雜湊伸縮（同一頂點的重複副本伸縮相同，不會裂開）
function clump(seed, center, sx, sy, sz, ico = false) {
  const g = ico ? new THREE.IcosahedronGeometry(1, 0) : new THREE.OctahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = hashU(Math.round(x * 1000) + 5000, Math.round(y * 1000) * 7 + Math.round(z * 1000) * 13 + 5000, seed) / 4294967296;
    const k = 0.7 + 0.6 * h;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.scale(sx, sy, sz);
  g.translate(center.x, center.y, center.z);
  g.computeVertexNormals();
  return { geometry: g, radial: { center, scale: new THREE.Vector3(sx, sy, sz) } };
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- 四種樹 ----
// 每個 builder：(rng, ids, far) → BufferGeometry。ids：{ bark, foliage }
const SPECIES = {
  // 高針葉樹（黑杉）：筆直的樹幹，一層層下垂的枝條，每根枝條一團扁平的針葉；隨機缺枝形成缺口
  spruce: { height: 13, trunkRadius: 0.32, build: buildSpruce },
  // 矮松：彎曲的樹幹，枝條往上外伸，頂端幾朵不規則的雲狀樹冠
  pine: { height: 6, trunkRadius: 0.2, build: buildPine },
  // 樺樹：細長的白色樹幹，往上分叉的枝條，稀疏的小葉叢
  birch: { height: 10, trunkRadius: 0.16, build: buildBirch },
  // 枯木：灰白的樹幹與光禿的枝椏，頂端折斷
  dead: { height: 8, trunkRadius: 0.22, build: buildDead },
};

function buildSpruce(rng, ids, far) {
  const H = SPECIES.spruce.height;
  const b = createBuilder(H);
  const seed = rng.int(0, 1e9);
  if (far) {
    b.push(limb(v3(0, -0.3, 0), v3(0, H * 0.3, 0), 0.3, 0.2, 4), ids.bark, 0.2);
    for (const [y0, r, h] of [
      [0.18, 0.3, 0.45],
      [0.48, 0.22, 0.36],
      [0.74, 0.12, 0.26],
    ]) {
      const c = clump(seed + y0 * 100, v3(0, H * (y0 + h * 0.4), 0), H * r, H * h * 0.5, H * r);
      b.push(c.geometry, ids.foliage, 1.2, c.radial);
    }
    return b.build();
  }
  b.push(limb(v3(0, -0.3, 0), v3(0, H * 0.97, 0), SPECIES.spruce.trunkRadius, 0.04, 6), ids.bark, 0.5);
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const y = H * (0.2 + (0.72 * t) / tiers);
    const n = 4 + (rng.next() < 0.4 ? 1 : 0);
    const offset = rng.next() * Math.PI * 2;
    const L = (1 - y / H) * 0.32 * H * rng.range(0.85, 1.1) + 0.4;
    for (let k = 0; k < n; k++) {
      if (rng.next() < 0.2) continue; // 缺枝
      const a = offset + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const end = v3(Math.cos(a) * L, y - 0.18 * L, Math.sin(a) * L);
      b.push(limb(v3(0, y, 0), end, 0.06, 0.015, 3), ids.bark, 0.9);
      const mid = v3(Math.cos(a) * L * 0.62, y - 0.1 * L, Math.sin(a) * L * 0.62);
      const c = clump(seed + t * 31 + k, mid, L * 0.48, H * 0.045 + 0.25, L * 0.48);
      b.push(c.geometry, ids.foliage, 1.15, c.radial);
    }
  }
  const top = clump(seed + 999, v3(0, H * 0.9, 0), 0.45, H * 0.08, 0.45);
  b.push(top.geometry, ids.foliage, 1.2, top.radial);
  return b.build();
}

function buildPine(rng, ids, far) {
  const H = SPECIES.pine.height;
  const b = createBuilder(H);
  const seed = rng.int(0, 1e9);
  const bend = v3(rng.range(-0.5, 0.5), H * 0.5, rng.range(-0.5, 0.5));
  const crown = v3(bend.x + rng.range(-0.4, 0.4), H * 0.82, bend.z + rng.range(-0.4, 0.4));
  b.push(limb(v3(0, -0.3, 0), bend, SPECIES.pine.trunkRadius, 0.13, far ? 4 : 6), ids.bark, 0.5);
  b.push(limb(bend, crown, 0.13, 0.06, far ? 3 : 5), ids.bark, 0.7);
  const clouds = far ? 2 : rng.int(4, 6);
  for (let k = 0; k < clouds; k++) {
    const a = rng.next() * Math.PI * 2;
    const d = k === 0 ? 0 : rng.range(0.8, 1.8);
    const y = H * rng.range(0.62, 0.95);
    const end = v3(crown.x + Math.cos(a) * d, y, crown.z + Math.sin(a) * d);
    if (!far && k > 0) b.push(limb(v3(bend.x, H * rng.range(0.5, 0.7), bend.z), end, 0.07, 0.025, 3), ids.bark, 0.9);
    const s = far ? 1.9 : rng.range(1.0, 1.6);
    const c = clump(seed + k, end, s, s * 0.45, s * rng.range(0.8, 1.1), !far);
    b.push(c.geometry, ids.foliage, 1.1, c.radial);
  }
  return b.build();
}

function buildBirch(rng, ids, far) {
  const H = SPECIES.birch.height;
  const b = createBuilder(H);
  const seed = rng.int(0, 1e9);
  // 微微彎曲的細長樹幹（3 段）
  let prev = v3(0, -0.3, 0);
  let r = SPECIES.birch.trunkRadius;
  const trunk = [];
  for (let k = 1; k <= 3; k++) {
    const next = v3(rng.range(-0.25, 0.25), (H * 0.92 * k) / 3, rng.range(-0.25, 0.25));
    b.push(limb(prev, next, r, r * 0.7, far ? 3 : 6), ids.bark, 0.5 + k * 0.15);
    trunk.push(next);
    prev = next;
    r *= 0.7;
  }
  const branches = far ? 3 : rng.int(4, 6);
  for (let k = 0; k < branches; k++) {
    const from = trunk[k % 2 === 0 ? 0 : 1].clone().lerp(trunk[1], rng.next());
    const a = rng.next() * Math.PI * 2;
    const L = rng.range(1.6, 2.8);
    const end = v3(from.x + Math.cos(a) * L * 0.7, from.y + L * 0.7, from.z + Math.sin(a) * L * 0.7);
    if (!far) b.push(limb(from, end, 0.05, 0.015, 3), ids.bark, 0.9);
    // 枝端與沿途的小葉叢，稀疏、有缺口
    const leaves = far ? 1 : rng.int(2, 3);
    for (let j = 0; j < leaves; j++) {
      const t = 0.55 + 0.45 * (j / Math.max(1, leaves - 1));
      const c = from.clone().lerp(end, t).add(v3(rng.range(-0.4, 0.4), rng.range(-0.2, 0.4), rng.range(-0.4, 0.4)));
      const s = far ? 1.6 : rng.range(0.6, 1.1);
      const g = clump(seed + k * 7 + j, c, s, s * 0.75, s);
      b.push(g.geometry, ids.foliage, 1.25, g.radial);
    }
  }
  const top = clump(seed + 77, v3(prev.x, H * 0.95, prev.z), far ? 1.4 : 0.9, far ? 1.2 : 0.8, far ? 1.4 : 0.9);
  b.push(top.geometry, ids.foliage, 1.25, top.radial);
  return b.build();
}

function buildDead(rng, ids, far) {
  const H = SPECIES.dead.height;
  const b = createBuilder(H);
  const mid = v3(rng.range(-0.3, 0.3), H * 0.5, rng.range(-0.3, 0.3));
  const top = v3(mid.x + rng.range(-0.4, 0.4), H * rng.range(0.85, 0.95), mid.z + rng.range(-0.4, 0.4)); // 折斷的頂端
  b.push(limb(v3(0, -0.3, 0), mid, SPECIES.dead.trunkRadius, 0.14, far ? 4 : 6), ids.bark, 0.3);
  b.push(limb(mid, top, 0.14, 0.07, far ? 3 : 5), ids.bark, 0.4);
  const branches = far ? 3 : rng.int(5, 7);
  for (let k = 0; k < branches; k++) {
    const from = v3(0, -0.3, 0).lerp(top, rng.range(0.35, 0.9));
    from.x += mid.x * 0.5;
    from.z += mid.z * 0.5;
    const a = rng.next() * Math.PI * 2;
    const L = rng.range(1.2, 2.6) * (1 - from.y / H + 0.4);
    const end = v3(from.x + Math.cos(a) * L, from.y + L * rng.range(0.3, 0.9), from.z + Math.sin(a) * L);
    b.push(limb(from, end, 0.07, 0.02, 3), ids.bark, 0.6);
    if (far) continue;
    // 細枝
    for (let j = 0; j < 2; j++) {
      if (rng.next() < 0.3) continue;
      const s = from.clone().lerp(end, rng.range(0.4, 0.8));
      const a2 = a + rng.range(-1.2, 1.2);
      const L2 = L * rng.range(0.3, 0.5);
      b.push(limb(s, v3(s.x + Math.cos(a2) * L2, s.y + L2 * 0.6, s.z + Math.sin(a2) * L2), 0.03, 0.01, 3), ids.bark, 0.8);
    }
  }
  return b.build();
}

// 建立全部變體：{ [species]: [{ near, far }, ...] }
export function buildTreeVariants(cfg, materials, rng) {
  const ids = {
    spruce: { bark: materials.ids.wood, foliage: materials.ids.spruce },
    pine: { bark: materials.ids.wood, foliage: materials.ids.pine },
    birch: { bark: materials.ids.birch, foliage: materials.ids.birchLeaf },
    dead: { bark: materials.ids.deadwood, foliage: materials.ids.deadwood },
  };
  const out = {};
  for (const [name, species] of Object.entries(SPECIES)) {
    out[name] = Array.from({ length: cfg.variants }, (_, v) => {
      const seed = rng.fork(`${name}-${v}`);
      return {
        near: species.build(seed.fork('near'), ids[name], false),
        far: species.build(seed.fork('near'), ids[name], true), // 同一顆種子：遠景的大致輪廓與近景一致
        height: species.height,
        trunkRadius: species.trunkRadius,
      };
    });
  }
  return out;
}
