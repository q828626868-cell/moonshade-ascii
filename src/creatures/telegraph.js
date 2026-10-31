// 攻擊範圍預告：貼在地面（或水面）上的網格，材質 telegraph 畫成紅色的 ! ! !（shader 抽掉一部分像素，看得到下面的地面）。
// 前搖期間由中心往外（長方形由近往遠）慢慢填滿：三角形依「離起點的距離」排序，用 drawRange 只畫前面一部分。
// 外框（telegraphEdge）一開始就整圈畫出，讓玩家知道範圍。
// 形狀（局部座標：x 右、z 前，heading 轉到世界座標）：
//   circle { radius, offset? }、cone { radius, angle }、rect { length, width }、ring { radius }（震波：見 shockwave）
import * as THREE from 'three';

const UP = [0, 1, 0];

// 形狀內的點（給命中判定）：(px, pz) 是相對於起點的世界座標差
export function shapeContains(shape, heading, px, pz, pad = 0) {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const lx = px * c - pz * s; // 局部 x（右）
  const lz = px * s + pz * c; // 局部 z（前）
  switch (shape.type) {
    case 'circle':
      return Math.hypot(lx, lz - (shape.offset ?? 0)) <= shape.radius + pad;
    case 'cone': {
      const d = Math.hypot(lx, lz);
      return d <= shape.radius + pad && (d < 0.6 || Math.abs(Math.atan2(lx, lz)) <= shape.angle / 2 + pad / Math.max(d, 1));
    }
    case 'rect':
      return lz >= -pad && lz <= shape.length + pad && Math.abs(lx) <= shape.width / 2 + pad;
    default:
      return false;
  }
}

export function createTelegraphs({ terrain, materials, parent }) {
  const fillMaterial = materials.get('telegraph');
  const edgeMaterial = materials.get('telegraphEdge');
  const active = new Set();
  const lift = 0.1;

  // 局部座標的三角形（依距離排序的 key），轉成世界座標並貼在地面／水面上
  function drape(tris, x0, z0, heading, y0 = null) {
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    const pos = new Float32Array(tris.length * 9);
    const nor = new Float32Array(tris.length * 9);
    let o = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const [lx, lz] = t.p[k];
        const x = x0 + lx * c + lz * s;
        const z = z0 - lx * s + lz * c;
        const ground = y0 ?? Math.max(terrain.heightAt(x, z), terrain.waterSurfaceAt(x, z));
        pos[o] = x;
        pos[o + 1] = ground + lift;
        pos[o + 2] = z;
        nor.set(UP, o);
        o += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    return g;
  }

  // 由 (a0, a1) 角度範圍、半徑 r0 → r1 的扇環切成三角形（逆時針朝上）；key = 外緣半徑
  function sector(tris, r0, r1, a0, a1, segs, key = r1) {
    for (let i = 0; i < segs; i++) {
      const b0 = a0 + ((a1 - a0) * i) / segs;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const p = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];
      tris.push({ key, p: [p(r0, b0), p(r1, b0), p(r1, b1)] });
      if (r0 > 1e-4) tris.push({ key, p: [p(r0, b0), p(r1, b1), p(r0, b1)] });
    }
  }

  function quad(tris, ax, az, bx, bz, w, key) {
    // 從 a 到 b、寬 w 的長條
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (dz / l) * w * 0.5;
    const nz = (-dx / l) * w * 0.5;
    const A = [ax - nx, az - nz];
    const B = [ax + nx, az + nz];
    const C = [bx + nx, bz + nz];
    const D = [bx - nx, bz - nz];
    tris.push({ key, p: [A, C, B] }, { key, p: [A, D, C] });
  }

  function build(shape) {
    const fill = [];
    const edge = [];
    const step = 0.55;
    if (shape.type === 'circle' || shape.type === 'cone') {
      const R = shape.radius;
      const half = shape.type === 'cone' ? shape.angle / 2 : Math.PI;
      const off = shape.offset ?? 0;
      const rings = Math.max(2, Math.ceil(R / step));
      const segs = Math.max(8, Math.ceil(((half * 2 * R) / step) * 0.8));
      for (let i = 0; i < rings; i++) sector(fill, (R * i) / rings, (R * (i + 1)) / rings, -half, half, segs);
      sector(edge, R - 0.22, R + 0.05, -half, half, segs);
      if (shape.type === 'cone') {
        for (const a of [-half, half]) quad(edge, 0, 0, Math.sin(a) * R, Math.cos(a) * R, 0.25, 0);
      }
      if (off) for (const list of [fill, edge]) for (const t of list) for (const p of t.p) p[1] += off;
      return { fill, edge, max: R };
    }
    if (shape.type === 'rect') {
      const L = shape.length;
      const W = shape.width;
      const rows = Math.max(2, Math.ceil(L / step));
      const cols = Math.max(2, Math.ceil(W / step));
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const z0 = (L * i) / rows;
          const z1 = (L * (i + 1)) / rows;
          const x0 = -W / 2 + (W * j) / cols;
          const x1 = -W / 2 + (W * (j + 1)) / cols;
          fill.push({ key: z1, p: [[x0, z0], [x0, z1], [x1, z1]] }, { key: z1, p: [[x0, z0], [x1, z1], [x1, z0]] });
        }
      }
      for (const sx of [-1, 1]) {
        for (let i = 0; i < rows; i++) quad(edge, (sx * W) / 2, (L * i) / rows, (sx * W) / 2, (L * (i + 1)) / rows, 0.22, 0);
      }
      quad(edge, -W / 2, L, W / 2, L, 0.22, 0);
      return { fill, edge, max: L };
    }
    throw new Error(`Unknown telegraph shape ${shape.type}`);
  }

  // 新的預告：回傳 { progress(t), remove() }；y0 給定時貼在這個高度的平面上（例如水面）
  function create(shape, x, z, heading, y0 = null) {
    const { fill, edge, max } = build(shape);
    fill.sort((a, b) => a.key - b.key);
    const keys = fill.map((t) => t.key / max);
    const fillMesh = new THREE.Mesh(drape(fill, x, z, heading, y0), fillMaterial);
    const edgeMesh = new THREE.Mesh(drape(edge, x, z, heading, y0), edgeMaterial);
    for (const m of [fillMesh, edgeMesh]) {
      m.frustumCulled = false;
      m.layers.set(1); // 不投影子
      parent.add(m);
    }
    fillMesh.geometry.setDrawRange(0, 0);
    const handle = {
      shape,
      x,
      z,
      heading,
      progress(t) {
        // 至少先畫出一小圈，讓預告一出現就看得到
        const k = Math.max(0.12, Math.min(1, t));
        let n = 0;
        while (n < keys.length && keys[n] <= k + 1e-6) n++;
        fillMesh.geometry.setDrawRange(0, n * 3);
      },
      remove() {
        if (!active.has(handle)) return;
        active.delete(handle);
        for (const m of [fillMesh, edgeMesh]) {
          parent.remove(m);
          m.geometry.dispose();
        }
      },
    };
    active.add(handle);
    handle.progress(0);
    return handle;
  }

  // 平貼在地面上的圓盤（蛛網、毒池、樹根的範圍）：一般材質，不是預告
  function disk(material, x, z, radius) {
    const tris = [];
    const rings = Math.max(2, Math.ceil(radius / 0.5));
    for (let i = 0; i < rings; i++) sector(tris, (radius * i) / rings, (radius * (i + 1)) / rings, -Math.PI, Math.PI, 20);
    const mesh = new THREE.Mesh(drape(tris, x, z, 0), materials.get(material));
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    mesh.position.y = -0.04; // 比預告低一點
    parent.add(mesh);
    return {
      mesh,
      remove() {
        parent.remove(mesh);
        mesh.geometry.dispose();
      },
    };
  }

  // 震波：往外擴散的一圈（每幀重建，只有一條環帶）
  function ringMesh() {
    const segs = 72;
    const pos = new Float32Array(segs * 18);
    const nor = new Float32Array(segs * 18);
    for (let i = 0; i < nor.length; i += 3) nor.set(UP, i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const mesh = new THREE.Mesh(g, edgeMaterial);
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    parent.add(mesh);
    return {
      set(x0, z0, r, w) {
        let o = 0;
        const put = (a, rr) => {
          const x = x0 + Math.sin(a) * rr;
          const z = z0 + Math.cos(a) * rr;
          pos[o++] = x;
          pos[o++] = Math.max(terrain.heightAt(x, z), terrain.waterSurfaceAt(x, z)) + lift + 0.05;
          pos[o++] = z;
        };
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          const r0 = Math.max(0, r - w / 2);
          const r1 = r + w / 2;
          put(a0, r0);
          put(a0, r1);
          put(a1, r1);
          put(a0, r0);
          put(a1, r1);
          put(a1, r0);
        }
        g.attributes.position.needsUpdate = true;
        g.computeBoundingSphere();
      },
      remove() {
        parent.remove(mesh);
        g.dispose();
      },
    };
  }

  return { create, disk, ringMesh, get count() {
    return active.size;
  } };
}
