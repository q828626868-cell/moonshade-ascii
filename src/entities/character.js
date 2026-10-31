// 程式生成的人物（不用外部模型檔）：three.js Bone + SkinnedMesh。
//
// 比例：身高 1.75 m，頭高 = 身高 / 7.5（約 0.233 m）。關節位置依寫實人體測量：
//   肩峰寬約 0.40 m、胸寬 0.33 / 胸厚 0.23、腰寬 0.29 / 腰厚 0.21、臀寬 0.35 / 臀厚 0.24、
//   上臂 0.30、前臂 0.26、手 0.19、大腿 0.43、小腿 0.40、腳長 0.26。
// 骨架：骨盆、三節脊椎、頸、頭、左右鎖骨、上臂、前臂、手、大腿、小腿、腳，共 20 個關節。
//   靜止姿勢下所有骨頭都不帶旋轉，局部位移就是關節之間的座標差（之後做動畫時直接轉骨頭）。
// 表面：平滑的旋轉體（四肢依截面半徑輪廓旋轉成形，有肌肉起伏與收細）與橢圓體（軀幹、臀、胸、頭）組成，
//   接縫處互相重疊。四肢靠近關節的一段與上一節骨頭混合權重，彎曲時不會裂開。
// 臉部：鼻子、眉骨、下巴、顴骨、耳朵都有幾何起伏，ASCII 畫面裡看得出臉朝哪裡。
// 人物面向 +z，左側是 +x，原點在兩腳之間的地面。
import * as THREE from 'three';
import { UP, v3, ellipsoid, limb, cone, blendFrom, buildSkinnedGeometry, buildBones } from './skinnedParts.js';

// 關節（世界座標，左側；右側鏡像）與父關節
const JOINTS = {
  pelvis: [null, 0, 0.95, 0],
  spine1: ['pelvis', 0, 1.03, -0.005],
  spine2: ['spine1', 0, 1.16, -0.01],
  spine3: ['spine2', 0, 1.3, -0.01],
  neck: ['spine3', 0, 1.455, -0.02],
  head: ['neck', 0, 1.565, -0.005],
  clavicle: ['spine3', 0.025, 1.43, 0],
  upperArm: ['clavicle', 0.195, 1.425, -0.015],
  forearm: ['upperArm', 0.225, 1.13, -0.03],
  hand: ['forearm', 0.24, 0.885, 0.035],
  thigh: ['pelvis', 0.09, 0.91, 0],
  shin: ['thigh', 0.095, 0.48, 0.01],
  foot: ['shin', 0.1, 0.085, -0.01],
};
const CENTER = ['pelvis', 'spine1', 'spine2', 'spine3', 'neck', 'head'];
const SIDED = ['clavicle', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
export const BONE_NAMES = [...CENTER, ...SIDED.flatMap((n) => [`${n}L`, `${n}R`])];

export function createCharacter(cfg, materials) {
  const ids = materials.ids;
  const M = {
    skin: ids.skin,
    tunic: ids.tunic,
    trousers: ids.trousers,
    boots: ids.boots,
    hair: ids.hair,
    hat: ids.hat,
    leather: ids.leather,
    belt: ids.belt,
    pouch: ids.pouch,
    scabbard: ids.scabbard,
    steel: ids.steel,
    lanternFrame: ids.lanternFrame,
    lanternGlass: ids.lanternGlass,
  };

  // 關節世界座標
  const joint = {};
  for (const name of CENTER) joint[name] = v3(...JOINTS[name].slice(1));
  for (const name of SIDED) {
    const [, x, y, z] = JOINTS[name];
    joint[`${name}L`] = v3(x, y, z);
    joint[`${name}R`] = v3(-x, y, z);
  }
  const parentOf = (name) => {
    const base = name.replace(/[LR]$/, '');
    const side = name.endsWith('L') && SIDED.includes(base) ? 'L' : name.endsWith('R') && SIDED.includes(base) ? 'R' : '';
    const p = JOINTS[side ? base : name][0];
    if (!p) return null;
    return SIDED.includes(p) ? `${p}${side}` : p;
  };

  // ---- 表面零件：{ geometry, bone, material, blend?: { bone, from: 起點, axis: 方向, length }, mesh, flex } ----
  // mesh：放進哪個網格（'body'，或可以單獨開關的 'hat'）；flex(p)：該頂點隨風抖動的權重（帽緣）
  const parts = [];
  const add = (geometry, bone, material, blend = null, extra = {}) =>
    parts.push({ geometry, bone, material, blend, mesh: extra.mesh ?? 'body', flex: extra.flex ?? null });
  // 軀幹：自下而上重疊的橢圓體
  add(ellipsoid([0, 0.93, -0.005], [0.17, 0.115, 0.115]), 'pelvis', M.trousers); // 臀（寬 0.34、厚 0.23）
  for (const s of [-1, 1]) add(ellipsoid([s * 0.07, 0.9, -0.055], [0.08, 0.09, 0.07]), 'pelvis', M.trousers); // 臀部後側
  add(ellipsoid([0, 1.06, 0], [0.145, 0.125, 0.105]), 'spine1', M.tunic); // 腰腹（寬 0.29、厚 0.21）
  add(ellipsoid([0, 1.19, 0], [0.155, 0.11, 0.11]), 'spine2', M.tunic);
  add(ellipsoid([0, 1.31, -0.005], [0.165, 0.135, 0.115]), 'spine3', M.tunic); // 胸廓（寬 0.33、厚 0.23）
  for (const s of [-1, 1]) add(ellipsoid([s * 0.065, 1.3, 0.065], [0.075, 0.06, 0.05]), 'spine3', M.tunic); // 胸肌
  add(ellipsoid([0, 1.36, -0.05], [0.13, 0.09, 0.07]), 'spine3', M.tunic); // 上背（肩胛）
  for (const s of [-1, 1]) add(ellipsoid([s * 0.1, 1.43, -0.025], [0.09, 0.035, 0.055], -s * 0.3), 'spine3', M.tunic); // 斜方肌
  // ---- 服裝：皮革胸甲、腰帶與扣環、腰包、斜揹的劍、腰間的油燈 ----
  add(ellipsoid([0, 1.27, -0.004], [0.176, 0.165, 0.126]), 'spine3', M.leather); // 胸甲（前後兩片包住胸廓）
  add(ellipsoid([0, 1.13, 0.002], [0.162, 0.08, 0.117]), 'spine2', M.leather); // 胸甲下緣
  for (const s of [-1, 1]) add(ellipsoid([s * 0.15, 1.4, -0.01], [0.075, 0.05, 0.08], -s * 0.35), 'spine3', M.leather); // 肩上的皮革
  {
    const belt = new THREE.TorusGeometry(0.15, 0.02, 6, 28);
    belt.rotateX(Math.PI / 2);
    belt.scale(1, 1, 0.76);
    belt.translate(0, 0.985, 0);
    add(belt, 'spine1', M.belt);
    add(new THREE.BoxGeometry(0.05, 0.045, 0.02).translate(0, 0.985, 0.118), 'spine1', M.steel); // 扣環
  }
  // 腰包（右前方）
  add(new THREE.BoxGeometry(0.1, 0.09, 0.05).rotateY(0.5).translate(-0.12, 0.935, 0.085), 'pelvis', M.pouch);
  add(new THREE.BoxGeometry(0.105, 0.03, 0.055).rotateY(0.5).translate(-0.12, 0.985, 0.087), 'pelvis', M.belt); // 蓋子
  // 背後斜揹的劍：劍柄在右肩後上方，劍鞘斜向左臀；胸前一條揹帶
  const swordTop = v3(-0.17, 1.55, -0.15);
  const swordTip = v3(0.17, 0.86, -0.17);
  const swordDir = new THREE.Vector3().subVectors(swordTip, swordTop).normalize();
  const along = (t) => swordTop.clone().addScaledVector(swordDir, t);
  const orient = (g, center) => {
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, swordDir));
    g.translate(center.x, center.y, center.z);
    return g;
  };
  add(orient(new THREE.BoxGeometry(0.06, 0.78, 0.025), along(0.12 + 0.39)), 'spine3', M.scabbard); // 劍鞘
  add(orient(new THREE.BoxGeometry(0.075, 0.05, 0.035), along(0.12)), 'spine3', M.steel); // 鞘口
  add(orient(new THREE.BoxGeometry(0.2, 0.025, 0.03), along(0.1)), 'spine3', M.steel); // 護手
  add(orient(new THREE.CylinderGeometry(0.014, 0.016, 0.16, 6), along(0.01)), 'spine3', M.belt); // 握柄
  add(ellipsoid(along(-0.08).toArray(), [0.024, 0.024, 0.024]), 'spine3', M.steel); // 劍首
  add(limb(v3(0.15, 1.45, 0.06), v3(-0.13, 0.99, 0.1), [[0, 0.013], [1, 0.013]], 6), 'spine2', M.belt); // 揹帶
  // 左腰的油燈：提把、框、發光的玻璃、頂蓋
  const lantern = v3(0.195, 0.85, 0.035);
  add(new THREE.TorusGeometry(0.03, 0.005, 4, 10, Math.PI).translate(lantern.x, lantern.y + 0.09, lantern.z), 'pelvis', M.lanternFrame);
  add(new THREE.BoxGeometry(0.06, 0.08, 0.06).translate(lantern.x, lantern.y, lantern.z), 'pelvis', M.lanternGlass);
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    add(new THREE.BoxGeometry(0.01, 0.1, 0.01).translate(lantern.x + dx * 0.032, lantern.y, lantern.z + dz * 0.032), 'pelvis', M.lanternFrame);
  }
  add(new THREE.ConeGeometry(0.048, 0.04, 6).translate(lantern.x, lantern.y + 0.06, lantern.z), 'pelvis', M.lanternFrame);
  add(new THREE.BoxGeometry(0.07, 0.012, 0.07).translate(lantern.x, lantern.y - 0.046, lantern.z), 'pelvis', M.lanternFrame);

  // 寬邊旅行帽（獨立的網格，可以單獨開關）：帽冠 + 微微下垂的帽緣；帽緣越外圈越會隨風抖動
  {
    const crown = new THREE.LatheGeometry(
      [[0.087, 0], [0.086, 0.06], [0.08, 0.1], [0.06, 0.122], [0.001, 0.128]].map(([r, y]) => new THREE.Vector2(r, y)),
      16,
    );
    crown.scale(1, 1, 1.18); // 頭是前後較長的橢圓
    crown.translate(0, 1.695, -0.012);
    add(crown, 'head', M.hat, null, { mesh: 'hat' });
    const brim = new THREE.LatheGeometry(
      [[0.08, 0.006], [0.15, 0], [0.205, -0.018], [0.207, -0.03], [0.15, -0.012], [0.08, -0.006]].map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    );
    brim.translate(0, 1.7, -0.012);
    const hatCenter = v3(0, 1.7, -0.012);
    add(brim, 'head', M.hat, null, {
      mesh: 'hat',
      flex: (q) => Math.max(0, (Math.hypot(q.x - hatCenter.x, q.z - hatCenter.z) - 0.09) / 0.12),
    });
    add(new THREE.CylinderGeometry(0.089, 0.089, 0.022, 16, 1, true).translate(0, 1.712, -0.012), 'head', M.belt, null, { mesh: 'hat' }); // 帽帶
  }

  // 頸與頭
  add(limb(v3(0, 1.43, -0.02), v3(0, 1.575, 0), [[0, 0.056], [1, 0.05]]), 'neck', M.skin, blendFrom('spine3', v3(0, 1.43, -0.02), v3(0, 1.575, 0), 0.05));
  add(ellipsoid([0, 1.655, -0.005], [0.078, 0.098, 0.1]), 'head', M.skin); // 顱（寬 0.156、深 0.20）
  add(ellipsoid([0, 1.585, 0.03], [0.064, 0.065, 0.072]), 'head', M.skin); // 臉與下顎
  add(ellipsoid([0, 1.535, 0.07], [0.028, 0.022, 0.024]), 'head', M.skin); // 下巴
  add(cone(v3(0, 1.618, 0.094), v3(0, 1.594, 0.128), 0.017), 'head', M.skin); // 鼻子（往前下方突出）
  add(limb(v3(-0.047, 1.662, 0.084), v3(0.047, 1.662, 0.084), [[0, 0.016], [0.5, 0.017], [1, 0.016]], 8), 'head', M.skin); // 眉骨
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.045, 1.602, 0.072], [0.026, 0.02, 0.02]), 'head', M.skin); // 顴骨
    add(ellipsoid([s * 0.078, 1.612, -0.005], [0.012, 0.03, 0.02]), 'head', M.skin); // 耳朵
  }
  add(ellipsoid([0, 1.682, -0.02], [0.084, 0.085, 0.104]), 'head', M.hair); // 頭髮（頭頂、髮際線在眉骨上方）
  add(ellipsoid([0, 1.62, -0.05], [0.08, 0.075, 0.066]), 'head', M.hair); // 後腦的頭髮

  // 四肢（左右鏡像）
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const J = (name) => joint[`${name}${side}`];
    const shoulder = J('upperArm');
    const elbow = J('forearm');
    const wrist = J('hand');
    const hip = J('thigh');
    const knee = J('shin');
    const ankle = J('foot');

    // 肩（三角肌）、上臂、前臂、手
    add(ellipsoid([s * 0.2, 1.41, -0.01], [0.062, 0.075, 0.068]), `upperArm${side}`, M.tunic);
    add(limb(shoulder, elbow, [[0, 0.05], [0.3, 0.049], [0.65, 0.044], [1, 0.038]]), `upperArm${side}`, M.tunic, blendFrom(`clavicle${side}`, shoulder, elbow, 0.05));
    add(limb(elbow, wrist, [[0, 0.04], [0.25, 0.041], [0.7, 0.032], [1, 0.027]]), `forearm${side}`, M.skin, blendFrom(`upperArm${side}`, elbow, wrist));
    add(ellipsoid([wrist.x + s * 0.004, wrist.y - 0.06, wrist.z + 0.004], [0.022, 0.06, 0.045]), `hand${side}`, M.skin); // 手掌（掌心朝內）
    add(ellipsoid([wrist.x + s * 0.002, wrist.y - 0.135, wrist.z + 0.006], [0.018, 0.048, 0.04]), `hand${side}`, M.skin); // 手指
    add(limb(v3(wrist.x + s * 0.004, wrist.y - 0.02, wrist.z + 0.035), v3(wrist.x - s * 0.004, wrist.y - 0.08, wrist.z + 0.056), [[0, 0.013], [1, 0.011]], 8), `hand${side}`, M.skin); // 拇指

    // 大腿、小腿（含小腿肚）、靴筒、腳
    const hipTop = v3(hip.x, hip.y + 0.03, hip.z);
    add(limb(hipTop, knee, [[0, 0.085], [0.3, 0.08], [0.7, 0.064], [1, 0.052]]), `thigh${side}`, M.trousers, blendFrom('pelvis', hipTop, knee, 0.08));
    add(limb(knee, ankle, [[0, 0.05], [0.25, 0.054], [0.6, 0.042], [1, 0.031]]), `shin${side}`, M.trousers, blendFrom(`thigh${side}`, knee, ankle));
    add(ellipsoid([knee.x + s * 0.002, 0.36, -0.03], [0.045, 0.1, 0.04]), `shin${side}`, M.trousers); // 小腿肚
    // 長靴：靴筒到膝下，頂端反摺的靴口較寬
    add(limb(v3(ankle.x, 0.06, ankle.z), v3(ankle.x - s * 0.002, 0.45, ankle.z + 0.012), [[0, 0.043], [0.35, 0.05], [0.75, 0.058], [1, 0.058]]), `shin${side}`, M.boots);
    add(limb(v3(ankle.x - s * 0.002, 0.41, ankle.z + 0.012), v3(ankle.x - s * 0.002, 0.47, ankle.z + 0.014), [[0, 0.064], [1, 0.064]], 12), `shin${side}`, M.boots);
    add(ellipsoid([ankle.x, 0.045, 0.055], [0.045, 0.045, 0.13]), `foot${side}`, M.boots); // 腳掌（腳尖朝前）
    add(ellipsoid([ankle.x, 0.05, -0.04], [0.035, 0.045, 0.045]), `foot${side}`, M.boots); // 腳跟
  }

  // ---- 合併成帶骨架權重的幾何（每個網格一個）與骨架 ----
  const boneIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const body = buildSkinnedGeometry(parts, boneIndex, 'body');
  const hatBuilt = buildSkinnedGeometry(parts, boneIndex, 'hat');
  const geometry = body.geometry;
  const hatGeometry = hatBuilt.geometry;
  const triangles = body.triangles + hatBuilt.triangles;
  const { bones } = buildBones(BONE_NAMES, joint, parentOf);
  const mesh = new THREE.SkinnedMesh(geometry, materials.vertexMaterial(0));
  mesh.name = 'character';
  mesh.add(bones.pelvis);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  mesh.bind(skeleton);
  mesh.frustumCulled = false; // 姿勢改變後靜止的包圍體不準
  // 帽子：同一副骨架的另一個網格（換裝時單獨開關）；帽緣頂點帶擺動權重，shader 依風力抖動
  const hat = new THREE.SkinnedMesh(hatGeometry, materials.vertexMaterial(cfg.hatBrimSway));
  hat.name = 'character-hat';
  hat.bind(skeleton, mesh.bindMatrix);
  hat.frustumCulled = false;

  const object = new THREE.Group();
  object.name = 'character-root';
  object.add(mesh, hat);
  object.scale.setScalar(cfg.height / 1.75);

  // ---- 給披風與油燈用：掛點、碰撞體（以靜止姿勢的座標定義，跟著骨頭移動）----
  // attach(bone, restPoint) → (out) => 該點目前的世界座標
  const attach = (bone, rest) => {
    const local = rest.clone().sub(joint[bone]);
    return (out) => out.copy(local).applyMatrix4(bones[bone].matrixWorld);
  };
  const capsule = (boneA, a, boneB, b, r) => ({ type: 'capsule', a: attach(boneA, a), b: attach(boneB, b), r });
  const ellipsoidCollider = (bone, center, radii) => ({
    type: 'ellipsoid',
    bone: bones[bone],
    center: attach(bone, v3(...center)),
    radii: v3(...radii),
  });
  const colliders = [
    ellipsoidCollider('spine3', [0, 1.29, -0.005], [0.205, 0.215, 0.15]), // 胸（含胸甲）
    ellipsoidCollider('spine1', [0, 1.06, 0], [0.175, 0.15, 0.135]),
    ellipsoidCollider('pelvis', [0, 0.92, -0.01], [0.2, 0.145, 0.165]), // 臀
    capsule('spine3', swordTop, 'spine3', swordTip, 0.045), // 劍（披風蓋在劍上）
  ];
  for (const side of ['L', 'R']) {
    const J = (n) => joint[`${n}${side}`];
    colliders.push(
      capsule(`thigh${side}`, J('thigh'), `shin${side}`, J('shin'), 0.1),
      capsule(`shin${side}`, J('shin'), `foot${side}`, J('foot'), 0.07),
      capsule(`upperArm${side}`, J('upperArm'), `forearm${side}`, J('forearm'), 0.068),
      capsule(`forearm${side}`, J('forearm'), `hand${side}`, J('hand'), 0.052),
    );
  }
  const lanternLight = attach('pelvis', lantern);

  // 待機動作：呼吸、頭部緩慢張望、手臂微微擺動（驗證骨架與權重正常）
  function update(time) {
    const breathe = Math.sin(time * 1.6);
    bones.spine2.rotation.x = 0.015 * breathe;
    bones.spine3.rotation.x = -0.02 * breathe;
    bones.head.rotation.y = 0.25 * Math.sin(time * 0.37);
    bones.head.rotation.x = 0.05 * Math.sin(time * 0.23);
    for (const [side, s] of [
      ['L', 1],
      ['R', -1],
    ]) {
      bones[`upperArm${side}`].rotation.x = 0.04 * Math.sin(time * 0.9 + (s > 0 ? 0 : Math.PI));
      bones[`forearm${side}`].rotation.x = -0.12 - 0.03 * breathe;
    }
  }

  return {
    object,
    mesh,
    hat,
    bones,
    joint, // 靜止姿勢的關節世界座標（披風掛點用）
    attach,
    colliders,
    lanternLight,
    scale: cfg.height / 1.75,
    boneCount: BONE_NAMES.length,
    triangles,
    update,
  };
}
