// 四足野怪：草原狼、鐵牙野豬、霜角熊、野兔。
// 共用的骨架：骨盆（根）– 脊椎 – 胸 – 頸 – 頭 – 下顎、尾巴、四條腿（上段、下段、掌）；
// 前腿的肘往後凸、後腿的膝往前凸。比例、零件與動作各自不同：
//   狼：細長、胸深腰細、長吻與豎耳、蓬鬆的尾巴與頸部鬃毛（另有細線毛髮），對角小跑
//   野豬：頭大、肩高臀低、短腿、獠牙、背上一排鬃毛，低頭蓄力衝撞
//   熊：龐大、肩峰隆起、短尾、頭上一對霜角，站起來揮爪、死前暴走
//   野兔：小、後腿長，一跳一跳地走
import * as THREE from 'three';
import { ellipsoid, limb, cone, v3 } from '../parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// P：hipY／chestY 腿根高度、hipZ／chestZ 腿根前後位置、track 左右腿距的一半、bendF／bendH 前肘、後膝凸出的量、
//    neck／head [y, z]、tail 尾巴各節 [y, z]、mat 材質、legR [上段粗, 上段細, 下段粗, 下段細]、paw 掌的半徑
function quadruped(b, P) {
  const m = P.mat;
  b.bone('hips', null, [0, P.hipY + P.hipLift, P.hipZ]);
  b.bone('spine', 'hips', [0, (P.hipY + P.chestY) / 2 + P.hipLift, (P.hipZ + P.chestZ) / 2]);
  b.bone('chest', 'spine', [0, P.chestY + P.hipLift, P.chestZ]);
  b.bone('neck', 'chest', [0, P.neck[0], P.neck[1]]);
  b.bone('head', 'neck', [0, P.head[0], P.head[1]]);
  b.bone('jaw', 'head', [0, P.head[0] - P.jawDrop, P.head[1] + P.jawFwd]);
  let parent = 'hips';
  P.tail.forEach((t, i) => {
    b.bone(`tail${i + 1}`, parent, [0, t[0], t[1]]);
    parent = `tail${i + 1}`;
  });
  const legs = [];
  b.mirror((S, s) => {
    const x = P.track * s;
    b.bone(`shoulder${S}`, 'chest', [x, P.chestY, P.chestZ]);
    b.bone(`elbow${S}`, `shoulder${S}`, [x, P.chestY * 0.5, P.chestZ - P.bendF]);
    b.bone(`paw${S}`, `elbow${S}`, [x, P.paw[1], P.chestZ + P.bendF * 0.25]);
    b.bone(`hip${S}`, 'hips', [x, P.hipY, P.hipZ]);
    b.bone(`knee${S}`, `hip${S}`, [x, P.hipY * 0.5, P.hipZ + P.bendH]);
    b.bone(`hpaw${S}`, `knee${S}`, [x, P.paw[1], P.hipZ - P.bendH * 0.4]);
    const J = b.joint;
    const [u0, u1, l0, l1] = P.legR;
    b.add(limb(J[`shoulder${S}`].clone().setY(P.chestY + 0.05), J[`elbow${S}`], [[0, u0], [0.5, u0 * 0.85], [1, u1]], 10), `shoulder${S}`, m, ['chest', J[`shoulder${S}`], J[`elbow${S}`], 0.1]);
    b.add(limb(J[`elbow${S}`], J[`paw${S}`], [[0, l0], [0.7, l1 * 1.1], [1, l1]], 8), `elbow${S}`, m, [`shoulder${S}`, J[`elbow${S}`], J[`paw${S}`], 0.06]);
    b.add(ellipsoid([x, P.paw[1] * 0.7, J[`paw${S}`].z + P.paw[0] * 0.5], [P.paw[0], P.paw[1] * 0.75, P.paw[0] * 1.35]), `paw${S}`, P.pawMat ?? m);
    b.add(limb(J[`hip${S}`].clone().setY(P.hipY + 0.05), J[`knee${S}`], [[0, u0 * 1.2], [0.5, u0], [1, u1]], 10), `hip${S}`, m, ['hips', J[`hip${S}`], J[`knee${S}`], 0.1]);
    b.add(limb(J[`knee${S}`], J[`hpaw${S}`], [[0, l0], [0.7, l1 * 1.1], [1, l1]], 8), `knee${S}`, m, [`hip${S}`, J[`knee${S}`], J[`hpaw${S}`], 0.06]);
    b.add(ellipsoid([x, P.paw[1] * 0.7, J[`hpaw${S}`].z + P.paw[0] * 0.5], [P.paw[0], P.paw[1] * 0.75, P.paw[0] * 1.35]), `hpaw${S}`, P.pawMat ?? m);
    legs.push({ upper: `shoulder${S}`, lower: `elbow${S}`, end: `paw${S}`, group: s > 0 ? 0 : 1 }, { upper: `hip${S}`, lower: `knee${S}`, end: `hpaw${S}`, group: s > 0 ? 1 : 0 });
  });
  // 前腿兩隻在前（索引 0、2 是前腿：L、R）
  return [legs[0], legs[2], legs[1], legs[3]];
}

// 共用的動作：步態起伏、頭轉向玩家、前搖時壓低身體、出手時張嘴
function quadPose(c, k, o) {
  const B = c.model.bones;
  const a = c.anim;
  const run = clamp(a.speed / o.runSpeed, 0, 1);
  const ph = a.phase * Math.PI * 2;
  B.hips.position.y += Math.sin(ph * 2) * o.bob * (0.25 + run);
  B.spine.rotateX(Math.sin(ph * 2) * 0.04 * run);
  B.chest.rotateX(-Math.sin(ph * 2) * 0.03 * run);
  // 前搖：壓低前身、低頭；出手：頭往前伸、張嘴
  B.hips.position.y -= a.windup * o.crouch;
  B.hips.rotateX(a.windup * 0.1);
  B.neck.rotateX(a.windup * o.headDown - a.strike * 0.25);
  B.jaw.rotateX(a.strike * o.bite + (o.pant ?? 0) * (0.5 + 0.5 * Math.sin(k.time * 9)) * run);
  // 頭轉向玩家
  B.neck.rotateY(a.look * 0.45);
  B.head.rotateY(a.look * 0.45);
  // 受傷：頭往後一縮
  B.neck.rotateX(-a.flinch * 0.3);
  // 待機：低頭嗅聞
  if (c.state === 'idle' || c.state === 'dormant') B.neck.rotateX(o.sniff * Math.max(0, Math.sin(k.time * 0.5 + a.seed)) ** 3);
}

function tailPose(c, k, segs, up, wagSpeed, wag) {
  const B = c.model.bones;
  for (let i = 1; i <= segs; i++) {
    const t = B[`tail${i}`];
    t.rotateX((up / segs) * (i === 1 ? 1.6 : 0.7));
    t.rotateY(Math.sin(k.time * wagSpeed + c.anim.seed - i * 0.6) * wag);
  }
}

// ---------------------------------------------------------------- 草原狼
const wolfP = {
  mat: 'wolf', hipY: 0.6, chestY: 0.62, hipLift: 0.06, hipZ: -0.36, chestZ: 0.3, track: 0.11, bendF: 0.08, bendH: 0.1,
  neck: [0.8, 0.46], head: [0.94, 0.62], jawDrop: 0.05, jawFwd: 0.05,
  tail: [[0.7, -0.5], [0.58, -0.72], [0.47, -0.92], [0.4, -1.08]],
  legR: [0.06, 0.04, 0.034, 0.024], paw: [0.04, 0.05],
};
export const wolf = {
  id: 'wolf',
  variants: { alpha: { wolf: 'wolfAlpha' } },
  define(b) {
    const legs = quadruped(b, wolfP);
    const m = 'wolf';
    // 深胸、細腰、窄臀
    b.add(ellipsoid([0, 0.7, 0.2], [0.14, 0.2, 0.27]), 'chest', m);
    b.add(ellipsoid([0, 0.73, -0.06], [0.11, 0.14, 0.26]), 'spine', m);
    b.add(ellipsoid([0, 0.7, -0.34], [0.12, 0.14, 0.18]), 'hips', m);
    b.add(ellipsoid([0, 0.82, 0.4], [0.15, 0.18, 0.15]), 'neck', m); // 頸部的鬃毛
    b.add(limb(v3(0, 0.76, 0.36), v3(0, 0.93, 0.6), [[0, 0.11], [1, 0.08]], 10), 'neck', m, ['chest', v3(0, 0.76, 0.36), v3(0, 0.93, 0.6), 0.1]);
    // 頭：顱、長吻、鼻頭、下顎、豎耳、發光的眼睛、尖牙
    b.add(ellipsoid([0, 0.97, 0.64], [0.095, 0.09, 0.115]), 'head', m);
    b.add(limb(v3(0, 0.95, 0.7), v3(0, 0.915, 0.88), [[0, 0.058], [1, 0.03]], 10), 'head', m);
    b.add(ellipsoid([0, 0.92, 0.885], [0.022, 0.02, 0.02]), 'head', 'wolfAlpha');
    b.add(limb(v3(0, 0.885, 0.7), v3(0, 0.875, 0.86), [[0, 0.036], [1, 0.02]], 8), 'jaw', m);
    b.mirror((S, s) => {
      b.add(cone(v3(0.05 * s, 1.03, 0.6), v3(0.065 * s, 1.15, 0.58), 0.038, 5), 'head', m);
      b.add(ellipsoid([0.05 * s, 0.995, 0.72], [0.017, 0.012, 0.012]), 'head', 'eye');
      b.add(cone(v3(0.022 * s, 0.9, 0.84), v3(0.022 * s, 0.872, 0.845), 0.009, 4), 'head', 'ivory');
    });
    // 蓬鬆的尾巴
    const J = b.joint;
    b.add(limb(J.tail1, J.tail2, [[0, 0.05], [1, 0.07]], 8), 'tail1', m, ['hips', J.tail1, J.tail2, 0.05]);
    b.add(limb(J.tail2, J.tail3, [[0, 0.07], [1, 0.06]], 8), 'tail2', m);
    b.add(limb(J.tail3, J.tail4, [[0, 0.06], [1, 0.02]], 8), 'tail3', m);
    // 細線毛髮的根部：背脊、頸部一圈、尾巴
    const fur = [];
    const rng = mulberry(7);
    for (let z = -0.44; z <= 0.36; z += 0.055) {
      for (const x of [-0.06, 0, 0.06]) {
        const bone = z < -0.18 ? 'hips' : z < 0.1 ? 'spine' : 'chest';
        const top = z < -0.18 ? 0.83 : z < 0.1 ? 0.86 : 0.9;
        fur.push({ bone, root: v3(x + (rng() - 0.5) * 0.02, top - Math.abs(x) * 0.6, z), dir: v3(x * 3, 0.55, -1).normalize(), len: 0.09 + rng() * 0.06, phase: rng() * 6 });
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 1.6 - Math.PI * 0.8;
      fur.push({ bone: 'neck', root: v3(Math.sin(a) * 0.15, 0.82 + Math.cos(a) * 0.17, 0.42), dir: v3(Math.sin(a), Math.cos(a), -0.8).normalize(), len: 0.11 + rng() * 0.05, phase: rng() * 6 });
    }
    for (const [bone, t] of [['tail1', 0.5], ['tail2', 0.5], ['tail3', 0.5]]) {
      const A = J[bone];
      const B = J[bone.replace(/\d/, (d) => String(+d + 1))];
      for (let i = 0; i < 6; i++) {
        const p = A.clone().lerp(B, rng());
        const a = rng() * Math.PI * 2;
        fur.push({ bone, root: p.add(v3(Math.sin(a) * 0.05, Math.cos(a) * 0.05, 0)), dir: v3(Math.sin(a), Math.cos(a), -1.2).normalize(), len: 0.07 + rng() * 0.05, phase: rng() * 6 });
      }
    }
    return { legs, legOpts: { stride: 0.8, height: 0.13, time: 0.3, lift: 0.05 }, stride: 1.5, length: 0.66, eye: 0.95, mark: 1.15, aim: 0.65, fur, mouth: ['head', [0, 0.92, 0.88]] };
  },
  pose(c, k) {
    quadPose(c, k, { runSpeed: 6, bob: 0.022, crouch: 0.1, headDown: 0.3, bite: 0.6, sniff: 0.5, pant: 0.12 });
    // 尾巴：警覺時翹起、逃跑時夾著、走路時輕擺
    const up = c.state === 'flee' ? -0.9 : c.state === 'chase' || c.state === 'attack' || c.state === 'alert' ? 0.3 : -0.1;
    tailPose(c, k, 3, up, c.state === 'idle' ? 1.5 : 4, 0.18);
    // 怕火時壓低身體、往後縮
    if (c.hesitate) {
      c.model.bones.hips.position.y -= 0.06;
      c.model.bones.neck.rotateX(0.25);
    }
  },
};

// ---------------------------------------------------------------- 鐵牙野豬
const boarP = {
  mat: 'boar', hipY: 0.42, chestY: 0.5, hipLift: 0.08, hipZ: -0.45, chestZ: 0.32, track: 0.16, bendF: 0.05, bendH: 0.07,
  neck: [0.7, 0.5], head: [0.66, 0.72], jawDrop: 0.1, jawFwd: 0.06,
  tail: [[0.62, -0.68], [0.5, -0.76]],
  legR: [0.08, 0.05, 0.045, 0.032], paw: [0.05, 0.05], pawMat: 'ivory',
};
export const boar = {
  id: 'boar',
  define(b) {
    const legs = quadruped(b, boarP);
    const m = 'boar';
    // 肩高臀低的桶狀身體、肩上的肉峰
    b.add(ellipsoid([0, 0.66, 0.2], [0.26, 0.3, 0.38]), 'chest', m);
    b.add(ellipsoid([0, 0.62, -0.2], [0.24, 0.26, 0.36]), 'spine', m);
    b.add(ellipsoid([0, 0.58, -0.5], [0.2, 0.22, 0.2]), 'hips', m);
    b.add(ellipsoid([0, 0.85, 0.32], [0.16, 0.14, 0.24]), 'chest', m);
    // 大頭：楔形的顱、長鼻、圓鼻盤、小眼、尖耳、往上彎的獠牙
    b.add(ellipsoid([0, 0.68, 0.6], [0.17, 0.2, 0.2]), 'neck', m);
    b.add(limb(v3(0, 0.7, 0.66), v3(0, 0.55, 1.0), [[0, 0.15], [0.6, 0.09], [1, 0.07]], 12), 'head', m);
    b.add(ellipsoid([0, 0.545, 1.01], [0.075, 0.06, 0.025]), 'head', 'wolfAlpha');
    b.add(limb(v3(0, 0.52, 0.74), v3(0, 0.47, 0.93), [[0, 0.06], [1, 0.035]], 8), 'jaw', m);
    b.mirror((S, s) => {
      b.add(cone(v3(0.09 * s, 0.82, 0.66), v3(0.15 * s, 0.94, 0.6), 0.05, 5), 'head', m);
      b.add(ellipsoid([0.1 * s, 0.75, 0.78], [0.018, 0.014, 0.014]), 'head', 'eye');
      b.add(limb(v3(0.07 * s, 0.53, 0.9), v3(0.11 * s, 0.66, 0.95), [[0, 0.022], [1, 0.006]], 6), 'jaw', 'ivory'); // 獠牙
    });
    // 背上一排鬃毛（小錐）
    for (let i = 0; i < 9; i++) {
      const z = 0.45 - i * 0.11;
      const bone = z > 0.05 ? 'chest' : z > -0.35 ? 'spine' : 'hips';
      const y = 0.97 - Math.abs(z - 0.25) * 0.35;
      b.add(cone(v3(0, y - 0.05, z), v3(0, y + 0.08, z - 0.06), 0.035, 4), bone, m);
    }
    const J = b.joint;
    b.add(limb(J.tail1, J.tail2, [[0, 0.025], [1, 0.012]], 5), 'tail1', m);
    return { legs, legOpts: { stride: 0.6, height: 0.1, time: 0.26, lift: 0.05 }, stride: 1.1, length: 0.8, eye: 0.75, mark: 1.15, aim: 0.6, mouth: ['head', [0, 0.55, 1.0]] };
  },
  pose(c, k) {
    const B = c.model.bones;
    quadPose(c, k, { runSpeed: 5, bob: 0.03, crouch: 0.06, headDown: 0.45, bite: 0.35, sniff: 0.45 });
    tailPose(c, k, 1, 0.4, 7, 0.4);
    const A = c.atk;
    // 衝撞的前搖：低頭、後腿蓄力、全身微微發抖
    if (A?.name === 'charge' && A.phase === 'windup') {
      B.hips.position.y -= 0.05;
      B.hips.position.x += Math.sin(k.time * 40) * 0.01;
      B.neck.rotateX(0.2);
    }
    if (A?.name === 'charge' && A.phase === 'strike') B.neck.rotateX(0.35);
    // 暈眩：頭左右晃
    if (c.state === 'stunned') {
      B.neck.rotateZ(Math.sin(k.time * 5) * 0.25);
      B.neck.rotateX(0.3);
    }
  },
};

// ---------------------------------------------------------------- 霜角熊
const bearP = {
  mat: 'frostBear', hipY: 0.8, chestY: 0.85, hipLift: 0.12, hipZ: -0.7, chestZ: 0.5, track: 0.28, bendF: 0.08, bendH: 0.12,
  neck: [1.15, 0.85], head: [1.15, 1.12], jawDrop: 0.12, jawFwd: 0.1,
  tail: [[1.05, -1.0], [0.95, -1.08]],
  legR: [0.17, 0.12, 0.1, 0.085], paw: [0.11, 0.08], pawMat: 'frostBear',
};
export const bear = {
  id: 'bear',
  variants: { rage: { frostBear: 'frostBearRage' } },
  define(b) {
    const legs = quadruped(b, bearP);
    const m = 'frostBear';
    // 龐大的身體、肩峰隆起
    b.add(ellipsoid([0, 1.1, 0.35], [0.42, 0.5, 0.55]), 'chest', m);
    b.add(ellipsoid([0, 1.05, -0.25], [0.4, 0.45, 0.55]), 'spine', m);
    b.add(ellipsoid([0, 1.0, -0.7], [0.36, 0.4, 0.34]), 'hips', m);
    b.add(ellipsoid([0, 1.42, 0.45], [0.26, 0.2, 0.32]), 'chest', m); // 肩峰
    b.add(limb(v3(0, 1.2, 0.72), v3(0, 1.18, 1.05), [[0, 0.28], [1, 0.2]], 12), 'neck', m, ['chest', v3(0, 1.2, 0.72), v3(0, 1.18, 1.05), 0.12]);
    // 頭：寬顱、短吻、圓耳、一對往後彎的霜角
    b.add(ellipsoid([0, 1.2, 1.15], [0.22, 0.2, 0.22]), 'head', m);
    b.add(limb(v3(0, 1.14, 1.25), v3(0, 1.08, 1.46), [[0, 0.12], [1, 0.08]], 10), 'head', m);
    b.add(ellipsoid([0, 1.09, 1.47], [0.045, 0.035, 0.03]), 'head', 'wolfAlpha');
    b.add(limb(v3(0, 1.0, 1.24), v3(0, 0.98, 1.42), [[0, 0.08], [1, 0.05]], 8), 'jaw', m);
    b.mirror((S, s) => {
      b.add(ellipsoid([0.16 * s, 1.36, 1.08], [0.06, 0.06, 0.035]), 'head', m);
      b.add(ellipsoid([0.1 * s, 1.24, 1.32], [0.025, 0.02, 0.02]), 'head', 'eye');
      b.add(limb(v3(0.12 * s, 1.36, 1.15), v3(0.24 * s, 1.58, 0.98), [[0, 0.045], [1, 0.03]], 6), 'head', 'iceShard');
      b.add(limb(v3(0.24 * s, 1.58, 0.98), v3(0.3 * s, 1.62, 0.8), [[0, 0.03], [1, 0.008]], 6), 'head', 'iceShard');
      // 前掌的爪
      for (let i = -1; i <= 1; i++) b.add(cone(v3(0.28 * s + i * 0.04, 0.05, 0.58), v3(0.28 * s + i * 0.04, 0.02, 0.68), 0.015, 4), `paw${S}`, 'ivory');
    });
    const J = b.joint;
    b.add(ellipsoid([J.tail1.x, J.tail1.y, J.tail1.z], [0.08, 0.08, 0.08]), 'tail1', m);
    return { legs, legOpts: { stride: 0.9, height: 0.16, time: 0.38, lift: 0.08 }, stride: 1.9, length: 1.2, eye: 1.25, mark: 1.85, aim: 1.1, mouth: ['head', [0, 1.08, 1.46]] };
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    quadPose(c, k, { runSpeed: 6, bob: 0.04, crouch: 0.05, headDown: 0.2, bite: 0.55, sniff: 0.35 });
    // 站起來揮爪：前搖時用後腿站起（身體繞骨盆往上轉），前掌舉高；出手時往下揮
    const rear = a.attack === 'swipe' ? Math.max(a.windup, a.strike) : 0;
    a.rear = (a.rear ?? 0) + (rear - (a.rear ?? 0)) * (1 - Math.exp(-10 * k.dt));
    const r = a.rear;
    if (c.legs) for (const leg of c.legs.legs.slice(0, 2)) leg.weight = 1 - clamp(r * 1.6, 0, 1);
    if (r > 0.01) {
      B.hips.rotateX(-1.15 * r);
      B.hips.position.y += 0.25 * r;
      B.neck.rotateX(0.7 * r);
      for (const S of ['L', 'R']) {
        const swing = a.strike > 0.05 ? -1.6 * a.windup + 1.9 * a.strike : -1.6 * r;
        B[`shoulder${S}`].rotateX(swing);
        B[`shoulder${S}`].rotateZ((S === 'L' ? 0.35 : -0.35) * r);
        B[`elbow${S}`].rotateX(-0.6 * r);
      }
    }
  },
  afterIK(c) {
    // 暴走：喘著白氣
    if (c.rage) c.anim.steam = (c.anim.steam ?? 0) + 1;
  },
  onHurt(c, dmg, element, w) {
    // 死前暴走：血量低於一定比例時變快、變痛、毛色轉紅
    if (!c.rage && c.hp < c.maxHp * c.stats.rage.below) {
      c.rage = true;
      c.model.setVariant('rage');
      c.mark = 'alert';
      c.markT = 1;
      w.combat.sparks(c.pos.x, c.pos.y + 1.6, c.pos.z, 14, 'rageSteam', 3);
    }
  },
  emit(c, push, style, w) {
    if (!c.rage || !c.alive) return;
    const t = w.time * 2.2 + c.anim.seed;
    const p = c.mouth(w.tmpFrom);
    for (let i = 0; i < 3; i++) {
      const k = (t + i / 3) % 1;
      const s = Math.sin(c.heading);
      const co = Math.cos(c.heading);
      const x = p.x + s * k * 0.6 + Math.sin(t * 3 + i) * 0.05 * k;
      const y = p.y + k * 0.35;
      const z = p.z + co * k * 0.6;
      push(x, y, z, x + s * 0.12, y + 0.06, z + co * 0.12, style.rageSteam, true);
    }
  },
};

// ---------------------------------------------------------------- 野兔
const hareP = {
  mat: 'hare', hipY: 0.16, chestY: 0.14, hipLift: 0.04, hipZ: -0.08, chestZ: 0.1, track: 0.05, bendF: 0.02, bendH: 0.06,
  neck: [0.26, 0.14], head: [0.3, 0.19], jawDrop: 0.03, jawFwd: 0.02,
  tail: [[0.2, -0.17]],
  legR: [0.03, 0.018, 0.015, 0.012], paw: [0.018, 0.018],
};
export const hare = {
  id: 'hare',
  critter: true,
  define(b) {
    quadruped(b, hareP);
    const m = 'hare';
    b.add(ellipsoid([0, 0.2, 0.05], [0.07, 0.08, 0.1]), 'chest', m);
    b.add(ellipsoid([0, 0.2, -0.07], [0.085, 0.095, 0.11]), 'hips', m);
    b.add(ellipsoid([0, 0.3, 0.2], [0.045, 0.048, 0.06]), 'head', m);
    b.add(ellipsoid([0, 0.2, -0.18], [0.03, 0.03, 0.03]), 'tail1', 'ivory');
    b.mirror((S, s) => {
      b.add(ellipsoid([0.022 * s, 0.4, 0.17], [0.012, 0.075, 0.025], 0.15 * s), 'head', m); // 長耳
      b.add(ellipsoid([0.035 * s, 0.315, 0.235], [0.008, 0.008, 0.008]), 'head', 'eye');
      b.add(ellipsoid([0.05 * s, 0.11, -0.06], [0.03, 0.06, 0.08]), `hip${S}`, m); // 大腿
      b.add(ellipsoid([0.05 * s, 0.015, -0.06], [0.018, 0.012, 0.06]), `hpaw${S}`, m); // 長腳掌
    });
    return { stride: 0.7, length: 0.22, eye: 0.3, mark: 0.45, aim: 0.2 };
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const moving = a.speed > 0.15;
    // 一跳一跳：每個週期一次騰空，後腿蹬直、前腳往前伸
    const hop = moving ? Math.abs(Math.sin(a.phase * Math.PI)) : 0;
    c.model.object.position.y += hop * clamp(a.speed / 3, 0.3, 1) * 0.22;
    const s = Math.sin(a.phase * Math.PI * 2);
    for (const S of ['L', 'R']) {
      B[`hip${S}`].rotateX(moving ? -0.7 * s : 0.4);
      B[`knee${S}`].rotateX(moving ? 0.5 * s : -0.6);
      B[`shoulder${S}`].rotateX(moving ? 0.6 * s : 0);
    }
    B.hips.rotateX(moving ? 0.15 * s : 0);
    // 待機：耳朵與鼻子動一動、偶爾站起來張望
    if (!moving) {
      const look = Math.max(0, Math.sin(k.time * 0.3 + a.seed)) ** 6;
      B.hips.rotateX(-0.5 * look);
      B.head.rotateY(Math.sin(k.time * 1.3 + a.seed) * 0.4);
      B.head.rotateX(Math.sin(k.time * 7) * 0.03);
    }
  },
};

// 定義毛髮位置用的小亂數（固定種子）
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
