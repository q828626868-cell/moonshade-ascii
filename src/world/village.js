// 灰燼村：村莊平台上的木造房屋（斜頂、煙囪、發光的窗）、井、馬廄與圍欄、市集攤位、火把。
// 全部以固定種子產生；房屋圍著廣場、正面朝向廣場，避開道路。
// 靜態幾何依材質合併成少數幾個 Mesh（整個村子十來次繪製呼叫）。
// 回傳：group、點光源清單（窗光、火把）、煙囪頂（給 lineProps 的炊煙）。
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

function transform(x, y, z, yaw = 0, pitch = 0, roll = 0) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _one);
}

function mergeNonIndexed(geometries) {
  const pos = [];
  const nor = [];
  for (const g0 of geometries) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createVillage(cfg, { terrainCfg, heightField: hf, terrain, physics, materials, rng }) {
  const group = new THREE.Group();
  group.name = 'village';
  const [cx, cz] = terrainCfg.plateau.center;
  const roadClear = terrainCfg.roads.width + cfg.roadClearance;
  const parts = new Map(); // 材質名稱 → 幾何
  const lights = [];
  const chimneys = [];
  const buildings = []; // { x, z, r }：佔地的包圍圓，避免重疊

  function put(material, geometry, ...matrices) {
    for (const m of matrices) geometry.applyMatrix4(m);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry);
  }

  // 建築的局部座標系：原點在 (x, z) 的地面，局部 +z 是正面；yaw 依朝向
  function frame(x, z, yaw) {
    const y = terrain.heightAt(x, z);
    const m = transform(x, y, z, yaw);
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    return {
      x,
      z,
      y,
      yaw,
      ux,
      uz,
      box(material, w, h, d, lx, ly, lz, pitch = 0, roll = 0) {
        put(material, new THREE.BoxGeometry(w, h, d), transform(lx, ly, lz, 0, pitch, roll), m);
      },
      mesh(material, geometry, lx, ly, lz, yaw2 = 0, pitch = 0, roll = 0) {
        put(material, geometry, transform(lx, ly, lz, yaw2, pitch, roll), m);
      },
      world(lx, ly, lz) {
        return new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
      },
      // 定向碰撞盒：halfLength 沿局部 x、halfWidth 沿局部 z
      collide(lx, lz, halfLength, halfWidth, y0, y1) {
        const p = new THREE.Vector3(lx, 0, lz).applyMatrix4(m);
        physics.addOrientedBox({ x: p.x, z: p.z, ux, uz, halfLength, halfWidth, y0: y + y0, y1: y + y1 });
      },
    };
  }

  const clearOfRoads = (points) => points.every(([x, z]) => hf.roadDistance(x, z) > roadClear);
  const clearOfBuildings = (x, z, r) => buildings.every((b) => Math.hypot(b.x - x, b.z - z) > b.r + r);
  // 佔地四角（世界座標）
  const footprint = (x, z, yaw, w, d) => {
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => [x + (ux * sx * w) / 2 - (uz * sz * d) / 2, z + (uz * sx * w) / 2 + (ux * sz * d) / 2]);
  };
  const facing = (x, z) => Math.atan2(cx - x, cz - z); // 局部 +z 朝向廣場

  // ---- 木屋：石地基、木牆、斜頂與山牆、煙囪、門、發光的窗 ----
  function house(x, z, w, d, wallH, pitch) {
    const f = frame(x, z, facing(x, z));
    const base = 0.5;
    const top = base + wallH;
    const half = w / 2 + 0.35; // 含屋簷
    const rise = (w / 2) * Math.tan(pitch);
    f.box('foundation', w + 0.4, 0.7, d + 0.4, 0, 0.15, 0);
    f.box('timber', w, wallH, d, 0, base + wallH / 2, 0);
    // 屋頂：兩片斜板，屋脊沿深度方向
    const slab = half / Math.cos(pitch);
    f.box('roof', slab, 0.16, d + 0.7, -half / 2, top + (half / 2) * Math.tan(pitch), 0, 0, pitch);
    f.box('roof', slab, 0.16, d + 0.7, half / 2, top + (half / 2) * Math.tan(pitch), 0, 0, -pitch);
    // 山牆（前後兩片三角形）
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    const gable = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    f.mesh('timber', gable, 0, top, -d / 2);
    // 煙囪
    const chimney = new THREE.Vector3(w * 0.25 * (rng.next() < 0.5 ? -1 : 1), top + rise * 0.5 + 0.6, -d * 0.2);
    f.box('foundation', 0.6, 1.8, 0.6, chimney.x, chimney.y, chimney.z);
    chimneys.push(f.world(chimney.x, chimney.y + 0.9, chimney.z));
    // 門與窗
    f.box('door', 1, 1.9, 0.1, 0, base + 0.95, d / 2 + 0.05);
    for (const sx of [-1, 1]) {
      f.box('window', 0.9, 0.75, 0.08, sx * w * 0.3, base + 1.5, d / 2 + 0.04);
      if (rng.next() < 0.7) f.box('window', 0.08, 0.75, 0.9, sx * (w / 2 + 0.04), base + 1.5, rng.range(-d * 0.2, d * 0.2));
    }
    // 窗光：照亮屋前的地面
    const glow = f.world(0, base + 1.6, d / 2 + 1.4);
    lights.push({ x: glow.x, y: glow.y, z: glow.z, radius: cfg.windowLight.radius, power: cfg.windowLight.power * rng.range(0.8, 1.1), flicker: 0.04, phase: rng.next() * 10 });
    f.collide(0, 0, (w + 0.4) / 2, (d + 0.4) / 2, -0.5, top + rise);
  }

  // ---- 柵欄：木樁 + 兩根橫木；gaps：哪幾段留空（門口）----
  function fence(points, gaps = []) {
    for (let i = 0; i < points.length - 1; i++) {
      if (gaps.includes(i)) continue;
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(-(bz - az), bx - ax);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const f = frame(mx, mz, yaw);
      const n = Math.max(1, Math.round(len / 2));
      for (let k = 0; k <= n; k++) f.box('timber', 0.14, 1.2, 0.14, -len / 2 + (len * k) / n, 0.5, 0);
      for (const h of [0.55, 1]) f.box('fence', len, 0.09, 0.06, 0, h, 0);
      f.collide(0, 0, len / 2, 0.12, 0, 1.2);
    }
  }

  // ---- 馬廄：三面牆、單斜屋頂、隔間、乾草；旁邊是圍欄圍起的放牧場 ----
  function stable(x, z) {
    const S = cfg.stable;
    const f = frame(x, z, facing(x, z));
    const { width: w, depth: d, height: h } = S;
    f.box('timber', w, h, 0.25, 0, h / 2, -d / 2);
    for (const sx of [-1, 1]) f.box('timber', 0.25, h, d, (sx * w) / 2, h / 2, 0);
    for (let k = 0; k <= 4; k++) f.box('timber', 0.25, h, 0.25, -w / 2 + (w * k) / 4, h / 2, d / 2);
    for (const px of [-w / 4, 0, w / 4]) f.box('fence', 0.12, 1.4, d * 0.7, px, 0.7, -d * 0.1);
    const slope = Math.atan2(0.9, d);
    f.box('roof', w + 0.6, 0.16, (d + 0.8) / Math.cos(slope), 0, h + 0.45, 0, slope);
    for (let k = 0; k < 3; k++) f.box('hay', 1.1, 0.6, 0.7, -w / 2 + 1 + k * 1.3, 0.3, -d / 2 + 0.6, 0, 0);
    f.collide(0, -d / 2, w / 2, 0.15, 0, h);
    for (const sx of [-1, 1]) f.collide((sx * w) / 2, 0, 0.15, d / 2, 0, h);
    const lantern = f.world(0, h - 0.3, d / 2 + 0.6);
    lights.push({ x: lantern.x, y: lantern.y, z: lantern.z, radius: cfg.torchLight.radius * 0.8, power: cfg.torchLight.power * 0.8, flicker: 0.15, phase: rng.next() * 10 });
    // 放牧場：在馬廄的一側（局部 +x），門開在正面
    const side = w / 2 + 1;
    const corners = [
      [side, -d / 2],
      [side + S.paddock[0], -d / 2],
      [side + S.paddock[0], -d / 2 + S.paddock[1]],
      [side + S.paddock[0] * 0.6, -d / 2 + S.paddock[1]],
      [side + S.paddock[0] * 0.35, -d / 2 + S.paddock[1]],
      [side, -d / 2 + S.paddock[1]],
      [side, -d / 2],
    ].map(([lx, lz]) => {
      const p = f.world(lx, 0, lz);
      return [p.x, p.z];
    });
    fence(corners, [3]);
  }

  // ---- 井：石砌井圈、兩根木柱、橫樑與小屋頂 ----
  function well(x, z) {
    const f = frame(x, z, 0);
    f.mesh('foundation', new THREE.CylinderGeometry(0.95, 1.05, 0.9, 12), 0, 0.45, 0);
    for (const sx of [-1, 1]) f.box('timber', 0.15, 2.1, 0.15, sx * 0.85, 1.05, 0);
    f.box('timber', 2, 0.15, 0.15, 0, 2.05, 0);
    for (const sx of [-1, 1]) f.box('roof', 0.9, 0.08, 1.5, sx * 0.4, 2.35, 0, 0, -sx * 0.55);
    f.box('wood', 0.3, 0.3, 0.3, 0.2, 1.4, 0);
    physics.addCylinder(x, z, 1.1, f.y, f.y + 1);
  }

  // ---- 市集攤位：四根柱子、櫃台、斜布篷、木箱 ----
  function stall(x, z, cloth) {
    const f = frame(x, z, facing(x, z));
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      f.box('timber', 0.12, 2.2 - (sz > 0 ? 0.3 : 0), 0.12, sx * 1.3, 1.1 - (sz > 0 ? 0.15 : 0), sz * 0.8);
    }
    f.box('wood', 2.4, 0.9, 0.7, 0, 0.45, 0.6);
    f.box(cloth, 2.9, 0.06, 2, 0, 2.05, 0, 0.18);
    for (let k = 0; k < 3; k++) {
      const s = rng.range(0.4, 0.6);
      f.box('wood', s, s, s, rng.range(-1.6, 1.6), s / 2, rng.range(-1.4, -0.9), 0, 0);
    }
    f.collide(0, 0, 1.4, 0.9, 0, 2.2);
  }

  // ---- 火把：木柱 + 發光的火焰 + 會閃爍的點光源 ----
  const flameGeometry = () => new THREE.OctahedronGeometry(0.2, 0);
  function torch(x, z) {
    const f = frame(x, z, 0);
    f.box('timber', 0.12, 1.9, 0.12, 0, 0.95, 0);
    f.mesh('flame', flameGeometry().scale(1, 1.6, 1), 0, 2.05, 0);
    lights.push({ x, y: f.y + 2.1, z, radius: cfg.torchLight.radius, power: cfg.torchLight.power, flicker: 0.25, phase: rng.next() * 10, fire: true });
    physics.addCylinder(x, z, 0.2, f.y, f.y + 2);
  }

  // ---- 配置 ----
  well(cx, cz);
  buildings.push({ x: cx, z: cz, r: 2 });

  // 廣場四角的火把（落在路上就左右微調角度）
  for (let k = 0; k < 4; k++) {
    for (const offset of [0, 0.25, -0.25, 0.5, -0.5]) {
      const a = Math.PI / 4 + (k * Math.PI) / 2 + offset;
      const x = cx + Math.cos(a) * cfg.plazaRadius;
      const z = cz + Math.sin(a) * cfg.plazaRadius;
      if (hf.roadDistance(x, z) > terrainCfg.roads.width + 0.5) {
        torch(x, z);
        break;
      }
    }
  }

  // 市集攤位：廣場邊緣、避開道路
  {
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < cfg.stalls; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const r = cfg.plazaRadius + rng.range(2, 4);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const yaw = facing(x, z);
      if (!clearOfRoads(footprint(x, z, yaw, 3, 2.2)) || !clearOfBuildings(x, z, 2)) continue;
      stall(x, z, placed % 2 ? 'clothTeal' : 'clothRed');
      buildings.push({ x, z, r: 2 });
      placed++;
    }
  }

  // 馬廄（含放牧場的佔地）與房屋：圍著廣場的環帶，避開道路與彼此
  const ring = cfg.ring;
  const tryPlace = (w, d, extra, build) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const r = rng.range(ring[0], ring[1]);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const yaw = facing(x, z);
      const reach = Math.hypot(w + extra, d + extra) / 2;
      if (!clearOfBuildings(x, z, reach) || !clearOfRoads(footprint(x, z, yaw, w + extra, d + extra))) continue;
      build(x, z);
      buildings.push({ x, z, r: reach });
      return true;
    }
    return false;
  };
  tryPlace(cfg.stable.width + cfg.stable.paddock[0] * 2 + 2, cfg.stable.depth + cfg.stable.paddock[1], 1, (x, z) => stable(x, z));
  const target = rng.int(cfg.houses[0], cfg.houses[1]);
  let houses = 0;
  for (let k = 0; k < target * 3 && houses < target; k++) {
    const w = rng.range(cfg.houseWidth[0], cfg.houseWidth[1]);
    const d = rng.range(cfg.houseDepth[0], cfg.houseDepth[1]);
    const wallH = rng.range(cfg.wallHeight[0], cfg.wallHeight[1]);
    const pitch = (rng.range(cfg.roofPitch[0], cfg.roofPitch[1]) * Math.PI) / 180;
    if (tryPlace(w, d, 1.5, (x, z) => house(x, z, w, d, wallH, pitch))) houses++;
  }

  // 道路出村處的火把（路兩旁各一）
  for (const road of hf.roads) {
    const p = road.points;
    for (const ends of [p, [...p].reverse()]) {
      const i = ends.findIndex(([x, z]) => Math.hypot(x - cx, z - cz) > cfg.gateRadius);
      if (i <= 0 || Math.hypot(ends[0][0] - cx, ends[0][1] - cz) > cfg.gateRadius) continue;
      const [x, z] = ends[i];
      const [px, pz] = ends[i - 1];
      const l = Math.hypot(x - px, z - pz) || 1;
      const ax = -(z - pz) / l;
      const az = (x - px) / l;
      const off = terrainCfg.roads.width + 1;
      torch(x + ax * off, z + az * off);
      torch(x - ax * off, z - az * off);
    }
  }

  for (const [name, list] of parts) {
    const mesh = new THREE.Mesh(mergeNonIndexed(list), materials.get(name));
    mesh.name = `village:${name}`;
    group.add(mesh);
  }

  return { group, lights, chimneys, stats: { houses, lights: lights.length } };
}
