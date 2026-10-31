// 程式生成的馬（不用外部模型檔）：three.js Bone + SkinnedMesh，馬具與韁繩。
//
// 體型：中型騎乘馬，鬐甲高 1.6 m，身長（肩端到臀端）2.4 m，胸底離地約 0.9 m，頭長 0.62 m。
// 骨架（34 個關節）：骨盆、胸腔、頸 ×3、頭、下顎、左右耳、尾根；
//   每隻前腿：肩胛、上臂、前臂、砲骨、系部、蹄；每隻後腿：大腿、小腿、飛節、砲骨、系部、蹄。
//   前腿的腕關節（俗稱膝蓋）只往前凸（砲骨往後摺），後腿的飛節只往後凸（砲骨往前摺）。
// 表面：互相重疊的橢圓體（胸腔、腹、鬐甲、臀、肩、胸肌、臀肌、頭部各塊）與旋轉體（四肢、頸、尾），
//   靠近關節的一段與上一節骨頭混合權重。頸部左右扁、由鬐甲往頭部變細。
// 動畫：
//   步態（資料與曲線在 horseGait.js）依速度自動切換：慢步 → 快步 → 跑步 → 襲步，換步態時兩組曲線在 cfg.gaitBlend 秒內混合。
//   相位依移動的距離推進，步幅隨速度伸縮，支撐期蹄走過的距離等於身體前進的距離。
//   支撐期的蹄鎖在落地點（蹄 IK）：下半段的傾角由落地點與肩／髖的位置決定，上半段用兩骨 IK 接上（前：上臂–前臂，後：大腿–小腿），
//   所以蹄不會在地上滑，上下坡時順著地形；擺盪期照曲線摺腿，蹄不會穿進地面。身體隨地形前後傾斜。
//   身體依步態起伏、前後搖晃、伸縮；頸與頭點頭、襲步時前伸、轉彎時往內轉；耳朵各自轉動；尾巴隨速度抬起。
//   停著時隨機播放待機動作：低頭吃草、甩頭、甩尾、換腳、打鼻息（冷天呼出白霧）。
// 馬面向 +z，左側是 +x（與人物相同），原點在四蹄中間的地面。
import * as THREE from 'three';
import { v3, ellipsoid, limb, frustum, ring, blendFrom, buildSkinnedGeometry, buildBones } from './skinnedParts.js';
import { solveTwoBone, rotateBoneToward } from './ik.js';
import { GAITS, GAIT_ORDER, legPose, bodyCurve } from './horseGait.js';

export { GAITS };

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;

// 關節（靜止姿勢的世界座標，左側；右側鏡像）與父關節
const JOINTS = {
  pelvis: [null, 0, 1.42, -0.62],
  chest: ['pelvis', 0, 1.36, 0.32],
  neck1: ['chest', 0, 1.48, 0.82],
  neck2: ['neck1', 0, 1.7, 1.08],
  neck3: ['neck2', 0, 1.92, 1.28],
  head: ['neck3', 0, 2.06, 1.42], // 項頂（兩耳之間）
  jaw: ['head', 0, 1.97, 1.47], // 下顎關節
  tail: ['pelvis', 0, 1.5, -1.16],
  ear: ['head', 0.06, 2.14, 1.44],
  // 前腿
  scapula: ['chest', 0.14, 1.5, 0.62], // 肩胛上緣（鬐甲旁）
  humerus: ['scapula', 0.2, 1.17, 0.98], // 肩關節
  forearm: ['humerus', 0.2, 0.96, 0.74], // 肘
  fCannon: ['forearm', 0.19, 0.5, 0.79], // 腕關節（膝）
  fPastern: ['fCannon', 0.19, 0.2, 0.79], // 球節
  fHoof: ['fPastern', 0.19, 0.08, 0.85], // 蹄冠
  // 後腿
  femur: ['pelvis', 0.17, 1.3, -0.8], // 髖關節
  tibia: ['femur', 0.22, 0.98, -0.52], // 膝（後膝）
  hock: ['tibia', 0.18, 0.6, -1.04], // 飛節（約在臀端正下方）
  hCannon: ['hock', 0.18, 0.5, -1.01],
  hPastern: ['hCannon', 0.18, 0.21, -1.0],
  hHoof: ['hPastern', 0.18, 0.08, -0.95],
};
const CENTER = ['pelvis', 'chest', 'neck1', 'neck2', 'neck3', 'head', 'jaw', 'tail'];
const SIDED = ['ear', 'scapula', 'humerus', 'forearm', 'fCannon', 'fPastern', 'fHoof', 'femur', 'tibia', 'hock', 'hCannon', 'hPastern', 'hHoof'];
export const HORSE_BONES = [...CENTER, ...SIDED.flatMap((n) => [`${n}L`, `${n}R`])];
// 蹄底著地點（靜止姿勢）
const TOE = { f: v3(0.19, 0, 0.885), h: v3(0.18, 0, -0.91) };

export function createHorse(cfg, materials, terrain) {
  const ids = materials.ids;
  const M = { coat: ids.horseCoat, hair: ids.horseHair, hoof: ids.hoof, tack: ids.saddle, pad: ids.saddlePad, steel: ids.steel };

  const joint = {};
  for (const name of CENTER) joint[name] = v3(...JOINTS[name].slice(1));
  for (const name of SIDED) {
    const [, x, y, z] = JOINTS[name];
    joint[`${name}L`] = v3(x, y, z);
    joint[`${name}R`] = v3(-x, y, z);
  }
  const parentOf = (name) => {
    const sided = /[LR]$/.test(name) && SIDED.includes(name.slice(0, -1));
    const p = JOINTS[sided ? name.slice(0, -1) : name][0];
    if (!p) return null;
    return SIDED.includes(p) ? p + name.slice(-1) : p;
  };

  const parts = [];
  const add = (geometry, bone, material, blend = null) => parts.push({ geometry, bone, material, blend, mesh: 'body', flex: null });
  const mid = (a, b, t = 0.5) => a.clone().lerp(b, t);
  const dir = (a, b) => new THREE.Vector3().subVectors(b, a).normalize();
  const arr = (v) => v.toArray();

  // ---- 軀幹 ----
  add(ellipsoid([0, 1.27, 0.2], [0.28, 0.34, 0.55], null, [24, 16]), 'chest', M.coat); // 胸腔（桶狀）
  add(ellipsoid([0, 1.12, -0.06], [0.265, 0.24, 0.5], null, [24, 16]), 'chest', M.coat); // 腹
  add(ellipsoid([0, 1.46, 0.52], [0.1, 0.14, 0.28]), 'chest', M.coat); // 鬐甲（最高 1.60）
  add(ellipsoid([0, 1.4, 0.08], [0.2, 0.12, 0.38]), 'chest', M.coat); // 背（鞍座處，略低）
  add(ellipsoid([0, 1.43, -0.42], [0.22, 0.12, 0.3]), 'pelvis', M.coat); // 腰
  add(ellipsoid([0, 1.25, -0.5], [0.27, 0.3, 0.42], null, [24, 16]), 'pelvis', M.coat); // 腹脅
  add(ellipsoid([0, 1.48, -1.04], [0.1, 0.08, 0.12]), 'pelvis', M.coat); // 尾根上方
  add(ellipsoid([0, 1.13, 0.98], [0.16, 0.2, 0.17]), 'chest', M.coat); // 前胸
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.12, 1.42, -0.78], [0.17, 0.16, 0.34], null, [20, 14]), 'pelvis', M.coat); // 臀（圓潤）
    add(ellipsoid([s * 0.1, 1.0, 0.94], [0.1, 0.16, 0.12]), 'chest', M.coat); // 胸肌（粗壯的胸部）
  }

  // ---- 頸（左右扁，由鬐甲往頭部變細）----
  const n1 = joint.neck1;
  const n2 = joint.neck2;
  const n3 = joint.neck3;
  const poll = joint.head;
  add(ellipsoid([0, 1.43, 0.86], [0.17, 0.32, 0.3], dir(n1, n2)), 'neck1', M.coat, blendFrom('chest', v3(0, 1.3, 0.62), n2, 0.35)); // 頸根（最粗）
  add(ellipsoid([0, 1.68, 1.08], [0.125, 0.25, 0.2], dir(n2, n3)), 'neck2', M.coat, blendFrom('neck1', n1, n3, 0.25));
  add(ellipsoid([0, 1.89, 1.28], [0.095, 0.2, 0.14], dir(n3, poll)), 'neck3', M.coat, blendFrom('neck2', n2, poll, 0.2)); // 喉部（最細）
  {
    // 頸上緣（鬃脊）略微隆起
    const d = dir(n1, n3);
    const up = v3(0, d.z, -d.y); // 垂直於頸、朝上後方
    add(ellipsoid(arr(mid(n1, n3).addScaledVector(up, 0.11)), [0.07, 0.34, 0.07], d), 'neck2', M.coat, blendFrom('neck1', n1, n3, 0.3));
  }

  // ---- 頭：H(u, v, x) = 項頂 + 頭軸方向 u + 臉面方向 v + 左右 x ----
  const axis = v3(0, -0.42, 0.36).normalize(); // 往前下方（往口鼻）
  const face = v3(0, axis.z, -axis.y); // 額頭與鼻梁那一面的法線（往前上方）
  const H = (u, v, x = 0) => poll.clone().addScaledVector(axis, u).addScaledVector(face, v).add(v3(x, 0, 0));
  add(ellipsoid(arr(H(0.1, -0.05)), [0.11, 0.13, 0.11], axis), 'head', M.coat); // 顱
  add(ellipsoid(arr(H(0.17, 0.03)), [0.11, 0.13, 0.05], axis), 'head', M.coat); // 額頭（寬而平）
  add(limb(H(0.2, 0.0), H(0.5, -0.01), [[0, 0.075], [0.5, 0.064], [1, 0.058]], 12, 0.85), 'head', M.coat); // 鼻梁
  add(ellipsoid(arr(H(0.55, -0.04)), [0.075, 0.07, 0.075], axis), 'head', M.coat); // 口鼻
  for (const s of [-1, 1]) {
    add(ellipsoid(arr(H(0.575, 0.01, s * 0.04)), [0.024, 0.036, 0.024], axis), 'head', M.coat); // 鼻孔（外緣）
    add(ellipsoid(arr(H(0.595, 0.016, s * 0.043)), [0.012, 0.022, 0.01], axis), 'head', M.hair); // 鼻孔（暗）
    add(ellipsoid(arr(H(0.14, 0.025, s * 0.088)), [0.03, 0.04, 0.032], axis), 'head', M.coat); // 眉骨（眼窩上緣）
    add(ellipsoid(arr(H(0.165, -0.012, s * 0.1)), [0.012, 0.024, 0.018], axis), 'head', M.hair); // 眼
    add(ellipsoid(arr(H(0.2, -0.13, s * 0.062)), [0.05, 0.13, 0.12], axis), 'jaw', M.coat, blendFrom('head', H(0.05, -0.05), H(0.3, -0.15), 0.06)); // 下顎（圓的頰）
  }
  add(limb(H(0.14, -0.17), H(0.5, -0.1), [[0, 0.05], [1, 0.04]], 10, 0.9), 'jaw', M.coat); // 下顎骨下緣
  add(ellipsoid(arr(H(0.56, -0.1)), [0.05, 0.04, 0.04], axis), 'jaw', M.coat); // 下唇
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const base = joint[`ear${side}`];
    add(limb(base, v3(s * 0.085, 2.3, 1.48), [[0, 0.03], [0.4, 0.036], [1, 0.006]], 8, 0.65), `ear${side}`, M.coat); // 耳（前後扁）
  }

  // ---- 鬃毛與尾巴的根部（毛本身是細線，見 entities/horseHair.js）：頸上緣一條細的鬃根、尾根 ----
  // crestAt(t)：鬃毛根部的線（t = 0 在項頂、1 在鬐甲），horseHair 沿這條線種毛
  const crestAt = (t) => v3(-0.03, 0.01, -0.04).add(poll.clone().lerp(v3(0, 1.6, 0.56), t));
  {
    const spans = [
      [0, 0.36, 'neck3', 'neck2'],
      [0.32, 0.7, 'neck2', 'neck1'],
      [0.66, 1, 'neck1', 'chest'],
    ];
    for (const [t0, t1, bone, prev] of spans) {
      const a = crestAt(t0);
      const b = crestAt(t1);
      add(limb(a, b, [[0, 0.03], [0.5, 0.04], [1, 0.03]], 10, 0.45), bone, M.hair, blendFrom(prev, b, a, 0.08));
    }
  }
  {
    const root = joint.tail;
    add(limb(root, v3(0, 1.27, -1.3), [[0, 0.06], [1, 0.045]], 10), 'tail', M.coat); // 尾根
  }

  // ---- 四肢（左右鏡像）----
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const J = (n) => joint[`${n}${side}`];
    const B = (n) => `${n}${side}`;
    const toe = (k) => v3(s * TOE[k].x, 0.012, TOE[k].z);
    // 前腿：肩、上臂（三頭肌）、肘端、前臂、腕、砲骨、球節、系部、蹄
    add(ellipsoid(arr(mid(J('scapula'), J('humerus'))), [0.075, 0.27, 0.14], dir(J('scapula'), J('humerus'))), B('scapula'), M.coat, blendFrom('chest', J('scapula'), J('humerus'), 0.1));
    add(ellipsoid([s * 0.19, 1.18, 1.05], [0.095, 0.11, 0.12]), B('humerus'), M.coat, blendFrom(B('scapula'), v3(s * 0.19, 1.3, 0.92), J('humerus'), 0.12)); // 肩端
    add(ellipsoid(arr(mid(J('humerus'), J('forearm')).add(v3(0, 0, -0.03))), [0.095, 0.19, 0.14], dir(J('humerus'), J('forearm'))), B('humerus'), M.coat, blendFrom(B('scapula'), J('humerus'), J('forearm'), 0.1));
    add(ellipsoid([s * 0.19, 0.98, 0.66], [0.06, 0.075, 0.06]), B('forearm'), M.coat); // 肘端
    add(limb(J('forearm'), J('fCannon'), [[0, 0.085], [0.3, 0.072], [0.75, 0.05], [1, 0.043]]), B('forearm'), M.coat, blendFrom(B('humerus'), J('forearm'), J('fCannon'), 0.12));
    add(ellipsoid(arr(J('fCannon')), [0.05, 0.065, 0.055]), B('fCannon'), M.coat, blendFrom(B('forearm'), v3(J('fCannon').x, 0.56, 0.79), J('fPastern'), 0.06)); // 腕
    add(limb(J('fCannon'), J('fPastern'), [[0, 0.042], [0.5, 0.035], [1, 0.04]], 10, 0.85), B('fCannon'), M.coat); // 砲骨（細）
    add(ellipsoid(arr(J('fPastern').clone().add(v3(0, 0, -0.01))), [0.045, 0.05, 0.055]), B('fPastern'), M.coat, blendFrom(B('fCannon'), v3(J('fPastern').x, 0.26, 0.79), J('fHoof'), 0.06)); // 球節
    add(limb(J('fPastern'), J('fHoof'), [[0, 0.037], [1, 0.04]], 10), B('fPastern'), M.coat); // 系部
    add(frustum(J('fHoof'), toe('f'), 0.048, 0.06), B('fHoof'), M.hoof); // 蹄
    // 後腿：大腿（股四頭肌）、臀端（半腱肌）、後膝、小腿（脛）、飛節與飛節端、砲骨、球節、系部、蹄
    add(ellipsoid([s * 0.19, 1.15, -0.64], [0.125, 0.25, 0.19], dir(J('femur'), J('tibia'))), B('femur'), M.coat, blendFrom('pelvis', J('femur'), J('tibia'), 0.12));
    add(ellipsoid([s * 0.13, 1.2, -1.03], [0.13, 0.26, 0.17]), B('femur'), M.coat, blendFrom('pelvis', v3(s * 0.13, 1.42, -1.0), v3(s * 0.13, 0.95, -1.0), 0.15)); // 臀端
    add(ellipsoid(arr(J('tibia')), [0.07, 0.08, 0.075]), B('tibia'), M.coat, blendFrom(B('femur'), v3(s * 0.21, 1.06, -0.55), J('hock'), 0.08)); // 後膝
    add(limb(J('tibia'), J('hock'), [[0, 0.1], [0.3, 0.088], [0.75, 0.058], [1, 0.05]]), B('tibia'), M.coat, blendFrom(B('femur'), J('tibia'), J('hock'), 0.1)); // 小腿
    add(ellipsoid([s * 0.18, 0.86, -0.93], [0.07, 0.17, 0.085], dir(J('tibia'), J('hock'))), B('tibia'), M.coat, blendFrom(B('femur'), J('tibia'), J('hock'), 0.15)); // 腓腸肌（臀端到飛節的後緣）
    add(ellipsoid(arr(J('hock')), [0.05, 0.07, 0.06]), B('hock'), M.coat, blendFrom(B('tibia'), v3(s * 0.18, 0.68, -1.02), J('hCannon'), 0.06)); // 飛節
    add(ellipsoid([s * 0.18, 0.64, -1.1], [0.035, 0.055, 0.045]), B('hock'), M.coat); // 飛節端（往後凸）
    add(limb(J('hock'), J('hCannon'), [[0, 0.05], [1, 0.045]], 10), B('hock'), M.coat);
    add(limb(J('hCannon'), J('hPastern'), [[0, 0.045], [0.5, 0.037], [1, 0.042]], 10, 0.85), B('hCannon'), M.coat);
    add(ellipsoid(arr(J('hPastern').clone().add(v3(0, 0, -0.01))), [0.045, 0.05, 0.055]), B('hPastern'), M.coat, blendFrom(B('hCannon'), v3(J('hPastern').x, 0.27, -1.0), J('hHoof'), 0.06));
    add(limb(J('hPastern'), J('hHoof'), [[0, 0.037], [1, 0.04]], 10), B('hPastern'), M.coat);
    add(frustum(J('hHoof'), toe('h'), 0.046, 0.058), B('hHoof'), M.hoof);
  }

  // ---- 馬具：鞍墊、馬鞍（座、前橋、後橋、側翼）、肚帶、鐙皮與馬鐙；籠頭（項革、額革、鼻革、頰革、喉革）與馬銜 ----
  add(ellipsoid([0, 1.36, 0.12], [0.31, 0.21, 0.4], null, [24, 14]), 'chest', M.pad); // 鞍墊：露出鞍下與兩側
  add(ellipsoid([0, 1.5, 0.1], [0.2, 0.12, 0.3]), 'chest', M.tack); // 座
  add(ellipsoid([0, 1.62, 0.34], [0.11, 0.07, 0.07]), 'chest', M.tack); // 前橋
  add(ellipsoid([0, 1.64, -0.16], [0.14, 0.07, 0.05]), 'chest', M.tack); // 後橋
  add(ring(v3(0, 1.27, 0.32), v3(0, 0, 1), 0.287, 0.347, 0.022), 'chest', M.tack); // 肚帶
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.285, 1.34, 0.15], [0.03, 0.16, 0.17]), 'chest', M.tack); // 側翼（蓋住騎手的腿與肚帶扣）
    add(limb(v3(s * 0.29, 1.48, 0.12), v3(s * 0.31, 1.11, 0.12), [[0, 0.012], [1, 0.012]], 6, 0.4), 'chest', M.tack); // 鐙皮
    add(ring(v3(s * 0.31, 1.04, 0.12), v3(0, 0, 1), 0.055, 0.06, 0.009, Math.PI), 'chest', M.steel); // 馬鐙（拱）
    add(new THREE.BoxGeometry(0.11, 0.012, 0.045).translate(s * 0.31, 1.04, 0.12), 'chest', M.steel); // 踏板
  }
  add(ring(H(0.02, -0.04), axis, 0.115, 0.11, 0.014), 'head', M.tack); // 項革（耳後）
  add(limb(H(0.07, 0.065, -0.1), H(0.07, 0.065, 0.1), [[0, 0.011], [1, 0.011]], 6), 'head', M.tack); // 額革
  add(ring(H(0.38, -0.045), axis, 0.083, 0.088, 0.014), 'head', M.tack); // 鼻革
  for (const s of [-1, 1]) {
    add(limb(H(0.03, -0.04, s * 0.108), H(0.47, -0.065, s * 0.078), [[0, 0.011], [1, 0.011]], 6, 0.5), 'head', M.tack); // 頰革
    add(limb(H(0.04, -0.05, s * 0.1), H(0.12, -0.23, s * 0.01), [[0, 0.01], [1, 0.01]], 6), 'head', M.tack); // 喉革
    add(ring(H(0.5, -0.07, s * 0.083), v3(1, 0, 0), 0.028, 0.028, 0.006), 'head', M.steel); // 馬銜環
  }

  // ---- 網格與骨架 ----
  const boneIndex = Object.fromEntries(HORSE_BONES.map((n, i) => [n, i]));
  const { geometry, triangles } = buildSkinnedGeometry(parts, boneIndex, 'body');
  const { bones } = buildBones(HORSE_BONES, joint, parentOf);
  const mesh = new THREE.SkinnedMesh(geometry, materials.vertexMaterial(0));
  mesh.name = 'horse';
  mesh.add(bones.pelvis);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(HORSE_BONES.map((n) => bones[n])));
  mesh.frustumCulled = false;

  const object = new THREE.Group(); // 地面上的位置、朝向、隨地形前後傾斜
  object.name = 'horse';
  object.rotation.order = 'YXZ';
  const body = new THREE.Group(); // 隨步態起伏、前後擺動（繞身體中心）
  body.position.set(0, 1.3, 0);
  mesh.position.set(0, -1.3, 0);
  body.add(mesh);
  object.add(body);

  // 掛點：靜止姿勢的座標 → 跟著骨頭移動的世界座標
  const attach = (bone, rest) => {
    const local = rest.clone().sub(joint[bone]);
    return (out) => out.copy(local).applyMatrix4(bones[bone].matrixWorld);
  };

  // ---- 動畫狀態 ----
  const position = new THREE.Vector3();
  let heading = 0;
  let prevHeading = 0;
  let speed = 0;
  let moving = 0;
  let turn = 0;
  let pitch = 0;
  let time = 0;
  let seed = 11;
  const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  // 步態：gait.name 是目前的步態，fromGait 是正在淡出的；blend 0 → 1（cfg.gaitBlend 秒）
  const gait = { name: 'walk', phase: 0, bob: 0, pitch: 0 };
  let fromGait = 'walk';
  let blend = 1;
  const restChest = bones.chest.position.clone();
  const ears = [0, 1].map(() => ({ yaw: 0, tilt: 0, yawGoal: 0, tiltGoal: 0, next: 1 + random() * 3 }));
  let tailSway = 0;

  // 四條腿（順序與 horseGait 相同：左後、左前、右後、右前）
  const LEGS = ['L', 'L', 'R', 'R'].map((side, i) => {
    const front = i % 2 === 1;
    const k = front ? 'f' : 'h';
    const names = front ? ['scapula', 'humerus', 'forearm', 'fCannon', 'fPastern', 'fHoof'] : [null, 'femur', 'tibia', 'hock', 'hPastern', 'hHoof'];
    const [top, upper, lower, end, pastern, hoof] = names.map((n) => (n ? bones[`${n}${side}`] : null));
    const toe = v3((side === 'L' ? 1 : -1) * TOE[k].x, 0, TOE[k].z);
    return {
      front,
      top,
      upper,
      lower,
      end,
      pastern,
      hoof,
      toeLocal: toe.clone().sub(joint[`${names[5]}${side}`]), // 蹄底相對於蹄骨
      plant: new THREE.Vector3(),
      pose: { angle: 0, knee: 0, fetlock: 0, upper: 0, lock: 0, stance: false },
      a: {},
      b: {},
      stance: false,
      weight: 0,
    };
  });

  // 依速度選步態（往上換要超過門檻 + 遲滯，往下換要低於門檻 − 遲滯，避免在門檻附近來回切換）
  function gaitFor(v, current) {
    const t = cfg.gaitSpeeds;
    const up = [t.trot, t.canter, t.gallop];
    let k = GAIT_ORDER.indexOf(current);
    while (k < 3 && v > up[k] + cfg.gaitHysteresis) k++;
    while (k > 0 && v < up[k - 1] - cfg.gaitHysteresis) k--;
    return GAIT_ORDER[k];
  }
  // 步幅隨速度略為伸縮（真實的馬加速時步幅與步頻都增加）
  const strideFor = (name, v) => GAITS[name].stride * THREE.MathUtils.clamp(Math.sqrt(Math.max(v, 0.3) / GAITS[name].nominal), 0.7, 1.2);

  // 一隻腳在某步態下的姿勢（已乘上擺角與移動程度）
  function evalLeg(name, i, out) {
    legPose(name, i, gait.phase, out);
    const A = Math.min(0.65, (strideFor(name, speed) * GAITS[name].duty) / 2.4) * moving; // 支撐期蹄走過的距離 = 身體前進的距離
    out.angle = out.limb * A;
    out.knee *= moving;
    out.fetlock *= moving;
    out.upper *= moving;
    out.lock = out.stance ? smooth(0, 0.08, out.s) * (1 - smooth(0.88, 1, out.s)) : 0; // 落地後漸入、翻蹄時漸出
    return out;
  }
  const mixGait = (fn) => lerp(fn(fromGait), fn(gait.name), smooth(0, 1, blend));

  const e = new THREE.Euler();
  const setRot = (bone, x, y = 0, z = 0) => bone.quaternion.setFromEuler(e.set(x, y, z, 'YXZ'));
  const _q = new THREE.Quaternion();
  const _pq = new THREE.Quaternion();
  const _rx = new THREE.Quaternion();
  const _keep = new THREE.Quaternion();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const X = v3(1, 0, 0);

  // 讓骨頭在世界中的朝向 = 馬身（object）的朝向再繞馬的左右軸轉 angle（weight < 1 時與目前的姿勢混合）
  function blendOrient(bone, angle, weight) {
    _keep.copy(bone.quaternion);
    object.getWorldQuaternion(_q).multiply(_rx.setFromAxisAngle(X, angle));
    bone.parent.getWorldQuaternion(_pq).invert();
    bone.quaternion.copy(_pq.multiply(_q));
    if (weight < 1) bone.quaternion.slerpQuaternions(_keep, _q.copy(bone.quaternion), weight);
    bone.updateMatrixWorld(true);
  }

  // ---- 待機動作（停著時隨機播放）：低頭吃草、甩頭、甩尾、換腳（休息一隻後腳）、打鼻息 ----
  const IDLE_LENGTH = { graze: [6, 11], toss: [1.4, 1.6], swish: [2, 2.6], shift: [5, 9], snort: [1.3, 1.3] };
  const idle = { name: null, t: 0, dur: 0, side: 0, wait: 2.5, fade: 0, puff: 3, snorted: false };
  function pickIdle() {
    if (cfg.idleForce) return cfg.idleForce; // 測試用：固定播某個動作
    const w = cfg.idleWeights;
    let r = random() * Object.values(w).reduce((a, b) => a + b, 0);
    for (const [name, weight] of Object.entries(w)) {
      r -= weight;
      if (r <= 0) return name;
    }
    return 'swish';
  }
  function updateIdle(dt) {
    const standing = moving < 0.03;
    idle.fade += ((standing ? 1 : 0) - idle.fade) * (1 - Math.exp(-(standing ? 2 : 6) * dt));
    if (!idle.name) {
      if (standing && (idle.wait -= dt) <= 0) {
        idle.name = pickIdle();
        const [lo, hi] = IDLE_LENGTH[idle.name];
        idle.dur = lo + random() * (hi - lo);
        idle.t = 0;
        idle.side = random() < 0.5 ? 0 : 2; // 換腳：休息左後或右後
        idle.snorted = false;
      }
      return 0;
    }
    idle.t += dt;
    if (idle.t > idle.dur || (!standing && idle.fade < 0.05)) {
      idle.name = null;
      idle.wait = 2 + random() * 5;
      return 0;
    }
    return smooth(0, 0.6, idle.t) * (1 - smooth(idle.dur - 0.7, idle.dur, idle.t)) * idle.fade;
  }

  // 吃草：頸與頭用 CCD 把口鼻帶到前方的草上
  const NECK = [bones.head, bones.neck3, bones.neck2, bones.neck1];
  const savedNeck = NECK.map(() => new THREE.Quaternion());
  const muzzle = attach('head', H(0.58, -0.05));
  function aimMuzzle(target, weight) {
    if (weight <= 0.001) return;
    NECK.forEach((b, i) => savedNeck[i].copy(b.quaternion));
    for (let it = 0; it < 5; it++) {
      for (const bone of NECK) {
        bone.getWorldPosition(_a);
        muzzle(_b);
        _c.subVectors(_b, _a).normalize();
        _d.subVectors(target, _a).normalize();
        rotateBoneToward(bone, _c, _d, 0.5);
      }
    }
    NECK.forEach((b, i) => b.quaternion.slerpQuaternions(savedNeck[i], _q.copy(b.quaternion), weight));
    bones.neck1.updateMatrixWorld(true);
  }

  // 呼氣的白霧（冷天）：鼻孔噴出的短線，往前飄散、變短消失（細線層）
  const puffs = Array.from({ length: 24 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1 }));
  const nostrilL = attach('head', H(0.65, 0.01, 0.045));
  const nostrilR = attach('head', H(0.65, 0.01, -0.045));
  const nose = attach('head', H(0.85, -0.06));
  function puff(count, strength) {
    for (const nostril of [nostrilL, nostrilR]) {
      nostril(_a);
      nose(_b);
      _c.subVectors(_b, muzzle(_d)).normalize();
      for (let n = 0; n < count; n++) {
        const p = puffs.find((q) => q.age >= q.life);
        if (!p) return;
        const s = strength * (0.6 + 0.4 * random());
        Object.assign(p, {
          x: _a.x,
          y: _a.y,
          z: _a.z,
          vx: _c.x * s + (random() - 0.5) * 0.25,
          vy: _c.y * s + 0.1 + random() * 0.1,
          vz: _c.z * s + (random() - 0.5) * 0.25,
          age: 0,
          life: 0.8 + random() * 0.7,
        });
      }
    }
  }
  function updatePuffs(dt) {
    for (const p of puffs) {
      if (p.age >= p.life) continue;
      p.age += dt;
      const drag = Math.exp(-2.5 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + 0.15 * dt; // 暖氣往上飄
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
  }

  // 依移動速度更新步態與姿勢；p、h：馬的位置與朝向，v：速度；
  // lift：跳躍時離地的高度，jumpT：跳躍的進度 0–1（-1 = 沒有在跳）
  function update(dt, p, h, v, lift = 0, jumpT = -1) {
    time += dt;
    // 正面撞上：抬前腳（約 1.1 秒）
    rearT = Math.min(1, rearT + dt / 1.1);
    const rearing = rearT < 1 ? Math.sin(Math.PI * rearT) : 0;
    position.copy(p);
    let dh = h - prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    prevHeading = h;
    heading = h;
    speed = v;
    moving = smooth(0.05, 0.6, v);
    turn += (dh / Math.max(dt, 1e-4) - turn) * (1 - Math.exp(-6 * dt));

    // 步態切換與混合；相位依移動距離推進（步幅與速度同步）
    const next = gaitFor(v, gait.name);
    if (next !== gait.name) {
      fromGait = blend < 0.5 ? fromGait : gait.name;
      gait.name = next;
      blend = 0;
    }
    blend = Math.min(1, blend + dt / cfg.gaitBlend);
    const stride = mixGait((n) => strideFor(n, v));
    gait.phase = (gait.phase + (v / stride) * dt) % 1;
    const curve = (channel) => mixGait((n) => bodyCurve(n, channel, gait.phase)) * moving;
    gait.bob = curve('bob');
    gait.pitch = curve('pitch');

    // 位置、朝向、隨地形的前後傾斜；身體起伏、前後搖晃、伸縮；快的步態重心較低
    // 前後傾斜由前後蹄下的地面高度差決定（蹄的位置用上一幀的落點；第一幀還沒有落點時在身體前後取樣）
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    let hf;
    let hb;
    let span = 1.75;
    if (planted) {
      const ground = (leg) => terrain.heightAt(leg.plant.x, leg.plant.z);
      hf = (ground(LEGS[1]) + ground(LEGS[3])) / 2;
      hb = (ground(LEGS[0]) + ground(LEGS[2])) / 2;
      const dx = (LEGS[1].plant.x + LEGS[3].plant.x - LEGS[0].plant.x - LEGS[2].plant.x) / 2;
      const dz = (LEGS[1].plant.z + LEGS[3].plant.z - LEGS[0].plant.z - LEGS[2].plant.z) / 2;
      span = THREE.MathUtils.clamp(dx * fx + dz * fz, 1.2, 2.6);
    } else {
      hf = terrain.heightAt(p.x + fx * 0.85, p.z + fz * 0.85);
      hb = terrain.heightAt(p.x - fx * 0.85, p.z - fz * 0.85);
    }
    const slope = THREE.MathUtils.clamp(-Math.atan2(hf - hb, span), -0.4, 0.4);
    pitch += (slope - pitch) * (1 - Math.exp(-12 * dt));
    // 上坡（pitch < 0）：頭頸往前伸；下坡（pitch > 0）：重心往後坐，後腿彎曲（IK 會讓後腿多彎一點才踩得到）
    uphill = smooth(0, 0.3, -pitch);
    downhill = smooth(0, 0.3, pitch);
    object.position.set(p.x, (hf + hb) / 2 + lift + 0.22 * rearing, p.z);
    object.rotation.set(pitch, h, 0);
    // 跳躍：起跳時前高、落地時前低；頸往前伸
    const air = jumpT >= 0 ? smooth(0, 0.12, jumpT) * (1 - smooth(0.85, 1, jumpT)) : 0;
    const crouch = mixGait((n) => ({ walk: 0, trot: 0.01, canter: 0.025, gallop: 0.05 })[n]) * moving;
    body.position.y = 1.3 + gait.bob - crouch - 0.06 * downhill;
    body.rotation.x = gait.pitch - 0.07 * downhill - (jumpT >= 0 ? 0.3 * Math.sin(2 * Math.PI * jumpT) : 0) - 0.5 * rearing;
    bones.chest.position.z = restChest.z + curve('stretch');

    // 頸與頭：點頭、襲步時往前伸、轉彎時往內轉
    const nod = curve('nod');
    const reach = mixGait((n) => GAITS[n].reach) * moving + 0.25 * uphill - 0.08 * downhill + 0.25 * air;
    const bend = THREE.MathUtils.clamp(turn * 0.12, -0.25, 0.25);
    setRot(bones.neck1, reach + nod * 0.5, bend * 0.4);
    setRot(bones.neck2, reach * 0.4 + nod * 0.3, bend * 0.35);
    setRot(bones.neck3, nod * 0.2, bend * 0.25);
    setRot(bones.head, -reach * 0.7 - nod * 0.2 + 0.03 * Math.sin(time * 0.4) * (1 - moving));
    if (rearing > 0) {
      // 抬前腳時頭頸往上揚
      bones.neck1.quaternion.multiply(_q.setFromEuler(e.set(-0.35 * rearing, 0, 0)));
      bones.head.quaternion.multiply(_q.setFromEuler(e.set(0.25 * rearing, 0, 0)));
    }
    setRot(bones.jaw, 0);
    // 尾巴：越快抬得越高，隨步伐左右擺
    const tailLift = mixGait((n) => ({ walk: 0.08, trot: 0.25, canter: 0.4, gallop: 0.6 })[n]) * moving;
    tailSway = 0.12 * moving * Math.sin(gait.phase * Math.PI * 2);
    let tailX = tailLift + 0.05 * Math.sin(time * 0.7);
    let tailZ = tailSway;

    // ---- 待機動作 ----
    const env = updateIdle(dt);
    let earYaw = null;
    let earTilt = null;
    let restLeg = -1;
    let restAmount = 0;
    if (idle.name === 'graze') {
      // 前方的草（約高 12 cm），口鼻慢慢左右移動
      object.updateMatrixWorld(true);
      _t.set(0.12 * Math.sin(time * 0.4), 0.12, 1.1 + 0.08 * Math.sin(time * 0.27)).applyMatrix4(object.matrixWorld);
      _t.y = terrain.heightAt(_t.x, _t.z) + 0.12;
      aimMuzzle(_t, env);
      setRot(bones.jaw, env > 0.7 ? 0.08 * Math.max(0, Math.sin(time * 7)) : 0); // 嚼草
      earYaw = -0.6;
      earTilt = -0.1;
    } else if (idle.name === 'toss') {
      const b = Math.sin((Math.PI * idle.t) / idle.dur) * env;
      bones.neck2.quaternion.multiply(_q.setFromEuler(e.set(-0.35 * b, 0, 0)));
      bones.neck3.quaternion.multiply(_q.setFromEuler(e.set(-0.25 * b, 0.1 * b * Math.sin(time * 9), 0)));
      bones.head.quaternion.multiply(_q.setFromEuler(e.set(0.1 * b, 0.35 * b * Math.sin(time * 13), 0.15 * b * Math.sin(time * 13 + 1))));
      earYaw = -0.9;
      earTilt = -0.3;
    } else if (idle.name === 'swish') {
      tailZ += 0.7 * env * Math.sin(idle.t * 6.5);
      tailX += 0.15 * env;
    } else if (idle.name === 'shift') {
      // 換腳：一隻後腳放鬆休息（飛節與球節微彎、蹄尖點地），那一側的臀部下沉
      restLeg = idle.side;
      restAmount = env;
      setRot(bones.pelvis, 0, 0, (restLeg === 0 ? -1 : 1) * 0.035 * env);
    } else if (idle.name === 'snort') {
      // 打鼻息：頭往下一頓、鼻孔噴出一團白霧、頸部抖一下
      const k = Math.exp(-(((idle.t - 0.3) / 0.12) ** 2));
      bones.head.quaternion.multiply(_q.setFromEuler(e.set(0.18 * k * env, 0, 0)));
      bones.neck2.quaternion.multiply(_q.setFromEuler(e.set(0.02 * Math.sin(time * 40) * env, 0, 0)));
      if (!idle.snorted && idle.t > 0.3) {
        puff(6, 1.4);
        idle.snorted = true;
      }
    }
    if (idle.name !== 'shift') setRot(bones.pelvis, 0);
    // 停著時的呼吸：每隔幾秒呼出一小團白霧
    if (idle.fade > 0.5 && idle.name !== 'graze' && (idle.puff -= dt) <= 0) {
      puff(2, 0.5);
      idle.puff = 3.5 + random() * 2;
    }
    updatePuffs(dt);
    setRot(bones.tail, tailX, 0, tailZ);

    // 耳朵：各自隨機轉向（往前、往側、往後聽），跑快時朝前，襲步時略往後貼；待機動作可以指定
    ears.forEach((ear, i) => {
      ear.next -= dt;
      if (ear.next <= 0) {
        const r = random();
        ear.yawGoal = r < 0.45 ? 0 : r < 0.8 ? -0.9 * random() : -1.5;
        ear.tiltGoal = ear.yawGoal < -1 ? -0.35 : 0.1 * random();
        ear.next = 1.5 + random() * 4;
      }
      const fast = smooth(2, 6, v);
      let yawGoal = lerp(ear.yawGoal, gait.name === 'gallop' ? -0.3 : 0, fast);
      let tiltGoal = lerp(ear.tiltGoal, gait.name === 'gallop' ? -0.3 : 0.15, fast);
      if (earYaw !== null) {
        yawGoal = lerp(yawGoal, earYaw, env);
        tiltGoal = lerp(tiltGoal, earTilt, env);
      }
      ear.yaw += (yawGoal - ear.yaw) * (1 - Math.exp(-6 * dt));
      ear.tilt += (tiltGoal - ear.tilt) * (1 - Math.exp(-6 * dt));
      const s = i === 0 ? 1 : -1;
      setRot(bones[i === 0 ? 'earL' : 'earR'], ear.tilt, s * ear.yaw, s * 0.1);
    });

    // ---- 腿：FK（兩個步態的曲線混合）----
    const w = smooth(0, 1, blend);
    LEGS.forEach((leg, i) => {
      const A = evalLeg(fromGait, i, leg.a);
      const B = evalLeg(gait.name, i, leg.b);
      const P = leg.pose;
      for (const key of ['angle', 'knee', 'fetlock', 'upper', 'lock']) P[key] = lerp(A[key], B[key], w);
      const stance = w < 0.5 ? A.stance : B.stance;
      leg.enter = stance && !leg.stance;
      leg.stance = stance;
      if (air > 0) {
        // 跳躍：前腿腕關節摺到最緊；後腿先往後蹬直，再收到腹下
        const t = jumpT;
        if (leg.front) {
          P.angle = lerp(P.angle, -0.35, air);
          P.knee = lerp(P.knee, 1.7, air);
          P.upper = lerp(P.upper, 0.9, air);
          P.fetlock = lerp(P.fetlock, 1, air);
        } else {
          const tuck = smooth(0.2, 0.5, t);
          P.angle = lerp(P.angle, lerp(0.55, -0.15, tuck), air);
          P.knee = lerp(P.knee, lerp(0.1, 1.0, tuck), air);
          P.upper = lerp(P.upper, lerp(0, 0.8, tuck), air);
          P.fetlock = lerp(P.fetlock, lerp(0.2, 0.9, tuck), air);
        }
      }
      if (rearing > 0 && leg.front) {
        // 抬前腳：前腿離地往前摺起
        P.angle = lerp(P.angle, -0.45, rearing);
        P.knee = lerp(P.knee, 1.5, rearing);
        P.upper = lerp(P.upper, 1.0, rearing);
        P.fetlock = lerp(P.fetlock, 1, rearing);
      }
      if (i === restLeg) {
        // 休息的後腳
        const r = restAmount;
        P.angle += 0.05 * r;
        P.knee += 0.4 * r;
        P.upper += 0.45 * r;
        P.fetlock += 0.85 * r;
      }
      if (leg.front) {
        setRot(leg.top, 0.3 * P.angle);
        setRot(leg.upper, 0.7 * P.angle - 0.3 * P.upper);
        setRot(leg.lower, -0.55 * P.upper);
        setRot(leg.end, P.knee); // 腕關節往前凸、砲骨往後摺
      } else {
        setRot(leg.upper, P.angle - 0.35 * P.upper);
        setRot(leg.lower, 0.45 * P.upper + 0.1 * P.knee);
        setRot(leg.end, -P.knee); // 飛節往後凸、砲骨往前摺
      }
      setRot(leg.pastern, P.fetlock);
      setRot(leg.hoof, 0.5 * P.fetlock + (i === restLeg ? 0.9 * restAmount : 0));
    });
    object.updateMatrixWorld(true);

    // ---- 腿：IK ----
    //   支撐期：蹄鎖在落地點（plant），下半段的傾角由落地點與肩／髖的相對位置決定，上半段用兩骨 IK 接上；
    //   停著時四蹄順著地形；擺盪期蹄不會穿進地面。
    _f.set(0, 0, 1).applyQuaternion(object.getWorldQuaternion(_q));
    _u.set(0, 1, 0).applyQuaternion(_q);
    let slipNow = 0;
    LEGS.forEach((leg, i) => {
      const toeWorld = (out) => out.copy(leg.toeLocal).applyMatrix4(leg.hoof.matrixWorld);
      if (leg.enter || moving < 0.02 || !leg.stance) {
        toeWorld(leg.plant);
        leg.plant.y = terrain.heightAt(leg.plant.x, leg.plant.z);
        // 蹄落地：蹄印、壓草、揚塵、水花（world/hoofEffects.js）
        if (leg.enter && moving > 0.1 && air === 0 && stepHandler) stepHandler(leg.plant.x, leg.plant.z, h, v, time);
      }
      let target = leg.stance ? Math.max(leg.pose.lock, 1 - moving) : 1 - moving;
      target *= 1 - air; // 跳躍時蹄不鎖在地上
      if (leg.front) target *= 1 - rearing;
      if (i === restLeg) target *= 1 - restAmount;
      // 鎖定立即生效（曲線本身已有漸入）；放開時平滑一點（換步態時支撐期可能突然結束）
      leg.weight = target >= leg.weight ? target : leg.weight + (target - leg.weight) * (1 - Math.exp(-40 * dt));
      const wt = leg.weight;
      if (wt > 0.002) {
        leg.upper.getWorldPosition(_a);
        _d.subVectors(_a, leg.plant);
        const geo = Math.atan2(_d.dot(_f), _d.dot(_u)) * 0.85;
        const angle = lerp(leg.pose.angle, geo, wt);
        // 前腿：肩胛跟著轉（肩關節往蹄的方向移），腿伸到最遠時才搆得到
        if (leg.top) {
          setRot(leg.top, 0.3 * angle);
          leg.top.updateMatrixWorld(true);
        }
        blendOrient(leg.end, angle, wt);
        blendOrient(leg.hoof, 0, wt);
        // 末端（腕／飛節）的目標 = 落地點 + 目前「末端 → 蹄底」的反向量
        leg.end.getWorldPosition(_b);
        toeWorld(_c);
        _t.subVectors(_b, _c).add(leg.plant);
        solveTwoBone(leg.upper, leg.lower, leg.end, _t, wt);
        blendOrient(leg.end, angle, wt);
        blendOrient(leg.hoof, 0, wt);
        if (leg.stance && wt > 0.99 && moving > 0.5) slipNow = Math.max(slipNow, toeWorld(_c).distanceTo(leg.plant));
      }
      // 擺盪期（或休息的腳）：蹄低於地面時把整隻腳抬上來
      toeWorld(_c);
      const ground = terrain.heightAt(_c.x, _c.z);
      if (_c.y < ground && wt < 0.99) {
        leg.end.getWorldPosition(_t).y += ground - _c.y;
        solveTwoBone(leg.upper, leg.lower, leg.end, _t, 1);
      }
    });
    planted = true;
    // 開發者面板：每 1.5 秒內鎖住的蹄最大的滑動距離（公分）
    slipWindow += dt;
    slipMax = Math.max(slipMax, slipNow * 100);
    if (slipWindow > 1.5) {
      slip = slipMax;
      slipMax = 0;
      slipWindow = 0;
    }
  }
  let slip = 0;
  let slipMax = 0;
  let slipWindow = 0;
  let planted = false; // 四蹄的落點已經算過（第一幀之後）
  let uphill = 0;
  let downhill = 0;
  let stepHandler = null;
  let rearT = 1; // 抬前腳的進度（1 = 沒有）

  // ---- 給騎手與其他系統的介面（座標以靜止姿勢定義，跟著骨頭移動）----
  const saddle = attach('chest', v3(0, 1.72, 0.1));
  const stirrupL = attach('chest', v3(0.31, 1.05, 0.12));
  const stirrupR = attach('chest', v3(-0.31, 1.05, 0.12));
  const reinL = attach('chest', v3(0.12, 1.95, 0.38));
  const reinR = attach('chest', v3(-0.12, 1.95, 0.38));
  const reinGallopL = attach('chest', v3(0.1, 1.95, 0.58)); // 襲步時手往前貼近馬頸
  const reinGallopR = attach('chest', v3(-0.1, 1.95, 0.58));
  const bitL = attach('head', H(0.5, -0.07, 0.083));
  const bitR = attach('head', H(0.5, -0.07, -0.083));
  const restL = attach('neck2', v3(0.16, 1.76, 1.02)); // 沒人騎時，韁繩繞過頸部
  const restR = attach('neck2', v3(-0.16, 1.76, 1.02));
  const crest = attach('neck2', v3(0, 1.88, 0.96));
  const mountPoint = (out) => out.set(0.95, 0, 0.15).applyMatrix4(object.matrixWorld); // 左側、鞍旁的地面

  // 給披風的碰撞體：馬背與馬頸
  const capsule = (boneA, a, boneB, b, r) => ({ type: 'capsule', a: attach(boneA, a), b: attach(boneB, b), r });
  const colliders = [capsule('pelvis', v3(0, 1.32, -0.7), 'chest', v3(0, 1.32, 0.7), 0.38), capsule('neck1', v3(0, 1.55, 0.75), 'neck2', v3(0, 1.85, 1.12), 0.2)];

  // 細線層的韁繩：馬銜 → 騎手的雙手（hands(side, out) 回傳 false = 沒人騎）。
  // 長度固定（cfg.reinLength）：兩端距離比繩長短時下垂（拋物線），拉直時繃緊
  function reins(styleId, hands) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const top = new THREE.Vector3();
    const segments = 8;
    function sagging(push, from, to, length, first) {
      const d = from.distanceTo(to);
      const sag = d < length ? Math.sqrt((3 / 8) * d * (length - d)) : 0;
      let px = from.x;
      let py = from.y;
      let pz = from.z;
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const x = lerp(from.x, to.x, t);
        const y = lerp(from.y, to.y, t) - 4 * sag * t * (1 - t);
        const z = lerp(from.z, to.z, t);
        push(px, py, pz, x, y, z, styleId, first && i === 1);
        px = x;
        py = y;
        pz = z;
      }
    }
    return {
      emit(push) {
        for (const side of ['L', 'R']) {
          (side === 'L' ? bitL : bitR)(a);
          if (hands(side, b)) {
            sagging(push, a, b, cfg.reinLength, true);
          } else {
            // 沒人騎：從馬銜沿頸側到鬃脊上，兩條在頸上會合
            (side === 'L' ? restL : restR)(c);
            crest(top);
            sagging(push, a, c, a.distanceTo(c) * 1.03, true);
            sagging(push, c, top, c.distanceTo(top) * 1.02, false);
          }
        }
      },
    };
  }

  // 細線層的白霧：每團是一小段沿飄動方向的線，越老越短
  function breath(styleId) {
    return {
      emit(push) {
        for (const p of puffs) {
          if (p.age >= p.life) continue;
          const k = 0.2 * (1 - p.age / p.life);
          push(p.x, p.y, p.z, p.x + p.vx * k, p.y + p.vy * k, p.z + p.vz * k, styleId, true);
        }
      },
    };
  }

  return {
    object,
    mesh,
    bones,
    // 給毛髮（horseHair.js）：靜止姿勢的關節位置、頭部座標系、鬃根的線
    joint,
    headPoint: H,
    headAxis: axis,
    headFace: face,
    crestAt,
    position,
    get heading() {
      return heading;
    },
    get speed() {
      return speed;
    },
    gait,
    update,
    saddle,
    stirrupL,
    stirrupR,
    reinL,
    reinR,
    reinGallopL,
    reinGallopR,
    bitL,
    bitR,
    mountPoint,
    colliders,
    reins,
    breath,
    get slip() {
      return slip; // 公分
    },
    get idle() {
      return idle.name ?? '—';
    },
    get blend() {
      return blend;
    },
    // 地形的前後傾斜（弧度，正 = 前低，也就是下坡）
    get slope() {
      return pitch;
    },
    // 正面撞上障礙物時：抬前腳
    rear() {
      if (rearT >= 1) rearT = 0;
    },
    // 每隻蹄落地時呼叫 fn(x, z, heading, speed, time)
    onStep(fn) {
      stepHandler = fn;
    },
    boneCount: HORSE_BONES.length,
    triangles,
  };
}
