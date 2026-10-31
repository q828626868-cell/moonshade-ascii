// 程式生成蒙皮網格的共用零件（人物與馬）：橢圓體、旋轉體、圓錐、圓台、環，
// 以及把零件合併成帶骨架權重的幾何（每個頂點一個材質 ID，給 VERTEX_MATERIAL 的 shader）。
// 零件：{ geometry, bone, material, blend?: { bone, from, axis, length }, mesh, flex }
//   blend：沿零件方向離起點越近，越受上一節骨頭影響（起點處各半），關節彎曲時不會裂開
//   mesh：放進哪個網格；flex(p)：該頂點隨風抖動的權重
import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// 把幾何的 from 軸轉到 dir。dir 在 yz 平面上時是繞 x 軸轉，局部 x（左右寬度）不變
function orient(g, from, dir) {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize()));
  return g;
}

// 橢圓體：中心 c、三軸半徑 r。rot：數字 = 繞 z 軸轉（弧度）；Vector3 = 把 y 半徑的方向轉到這個方向
export function ellipsoid(c, r, rot = null, detail = [16, 12]) {
  const g = new THREE.SphereGeometry(1, detail[0], detail[1]);
  g.scale(r[0], r[1], r[2]);
  if (typeof rot === 'number') g.rotateZ(rot);
  else if (rot) orient(g, UP, rot);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// 旋轉體：從 a 到 b，profile = [[t, 半徑], ...]（t 為 0–1），兩端加半球形的蓋。squash：左右寬度的比例
export function limb(a, b, profile, segments = 14, squash = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const pts = [];
  const r0 = profile[0][1];
  const r1 = profile[profile.length - 1][1];
  for (let i = 0; i <= 4; i++) {
    const t = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r0 * Math.cos(t), r0 * Math.sin(t)));
  }
  for (const [t, r] of profile.slice(1, -1)) pts.push(new THREE.Vector2(r, t * len));
  for (let i = 0; i <= 4; i++) {
    const t = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(t)), len + r1 * Math.sin(t)));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  if (squash !== 1) g.scale(squash, 1, 1);
  orient(g, UP, dir);
  g.translate(a.x, a.y, a.z);
  return g;
}

// 圓錐：底面中心 a、尖端 b
export function cone(a, b, radius, segments = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.ConeGeometry(radius, dir.length(), segments);
  g.translate(0, dir.length() / 2, 0);
  orient(g, UP, dir);
  g.translate(a.x, a.y, a.z);
  return g;
}

// 圓台（平底，例如蹄）：上端 a 半徑 ra、下端 b 半徑 rb
export function frustum(a, b, ra, rb, segments = 12) {
  const dir = new THREE.Vector3().subVectors(a, b);
  const g = new THREE.CylinderGeometry(ra, rb, dir.length(), segments);
  g.translate(0, dir.length() / 2, 0);
  orient(g, UP, dir);
  g.translate(b.x, b.y, b.z);
  return g;
}

// 環（帶子繞一圈，例如籠頭、肚帶）：中心 c、環面的法線 axis、兩軸半徑 rx（左右）× ry、帶子粗細 tube
export function ring(c, axis, rx, ry, tube, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(1, tube / Math.max(rx, ry), 5, 28, arc);
  g.scale(rx, ry, 1);
  orient(g, Z, axis);
  g.translate(c.x, c.y, c.z);
  return g;
}

export const blendFrom = (bone, a, b, length = 0.07) => ({ bone, from: a.clone(), axis: new THREE.Vector3().subVectors(b, a).normalize(), length });

// 零件 → 帶 skinIndex／skinWeight／aMaterial／aFlex 的幾何
export function buildSkinnedGeometry(parts, boneIndex, meshName) {
  const pos = [];
  const nor = [];
  const skinIndex = [];
  const skinWeight = [];
  const mat = [];
  const flex = [];
  const p = new THREE.Vector3();
  for (const part of parts) {
    if (part.mesh !== meshName) continue;
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array;
    const N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) {
      p.set(P[i], P[i + 1], P[i + 2]);
      pos.push(p.x, p.y, p.z);
      nor.push(N[i], N[i + 1], N[i + 2]);
      mat.push(part.material);
      flex.push(part.flex ? part.flex(p) : 0);
      let w = 1;
      if (part.blend) {
        const t = p.clone().sub(part.blend.from).dot(part.blend.axis);
        w = 0.5 + 0.5 * THREE.MathUtils.smoothstep(t, 0, part.blend.length);
      }
      skinIndex.push(boneIndex[part.bone], part.blend ? boneIndex[part.blend.bone] : 0, 0, 0);
      skinWeight.push(w, 1 - w, 0, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setAttribute('aMaterial', new THREE.Float32BufferAttribute(mat, 1));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.computeBoundingSphere();
  return { geometry, triangles: pos.length / 9 };
}

// 骨架：joint（名稱 → 靜止姿勢的世界座標）、parentOf(name)。靜止姿勢下骨頭都不帶旋轉
export function buildBones(names, joint, parentOf) {
  const bones = {};
  for (const name of names) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones[name] = bone;
  }
  let root = null;
  for (const name of names) {
    const parent = parentOf(name);
    const offset = parent ? joint[name].clone().sub(joint[parent]) : joint[name].clone();
    bones[name].position.copy(offset);
    if (parent) bones[parent].add(bones[name]);
    else root = bones[name];
  }
  return { bones, root };
}
