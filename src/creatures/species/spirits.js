// 會偽裝或只在夜裡活動的：苔蘚樹精、石像守衛、遊魂。
//   樹精：雙手高舉像樹枝、雙腿併攏像樹幹，靜止時就是一棵長滿苔蘚的樹；玩家走近才甦醒。樹根從地下冒出纏住玩家
//   石像：方塊狀的石頭巨人，白天雙臂貼身、低頭，就是古石環裡的一根石柱（符文是暗的、打不動）；入夜符文發光、甦醒。重拳、震波
//   遊魂：半透明（shader 抽掉一部分像素）、字元閃爍，飄在半空、穿牆，拖著長長的尾巴
import * as THREE from 'three';
import { ellipsoid, limb, cone, v3 } from '../parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const box = (c, s, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  g.rotateX(rx).rotateY(ry).rotateZ(rz);
  g.translate(c[0], c[1], c[2]);
  return g;
};

// 兩足的腳：IK 落點
function bipedLegs(b, P, mat, thick, foot) {
  const legs = [];
  b.mirror((S, s) => {
    const h = b.bone(`hip${S}`, P.pelvis, [P.hipX * s, P.hipY, 0]);
    const k = b.bone(`knee${S}`, `hip${S}`, [P.hipX * s * 1.05, P.hipY * 0.52, P.knee]);
    const f = b.bone(`foot${S}`, `knee${S}`, [P.hipX * s * 1.05, P.footY, 0]);
    b.add(limb(h, k, [[0, thick[0]], [1, thick[1]]], 8), `hip${S}`, mat, [P.pelvis, h, k, 0.12]);
    b.add(limb(k, f, [[0, thick[1]], [1, thick[2]]], 8), `knee${S}`, mat, [`hip${S}`, k, f, 0.1]);
    foot(S, s, f);
    legs.push({ upper: `hip${S}`, lower: `knee${S}`, end: `foot${S}`, group: s > 0 ? 0 : 1 });
  });
  return legs;
}

// ---------------------------------------------------------------- 苔蘚樹精
export const treant = {
  id: 'treant',
  define(b) {
    const bark = 'treantBark';
    const leaf = 'treant';
    b.bone('pelvis', null, [0, 1.1, 0]);
    b.bone('trunk', 'pelvis', [0, 1.75, 0]);
    b.bone('chest', 'trunk', [0, 2.35, 0]);
    b.bone('crown', 'chest', [0, 2.9, 0]);
    const legs = bipedLegs(b, { pelvis: 'pelvis', hipX: 0.24, hipY: 1.0, knee: 0.14, footY: 0.12 }, bark, [0.2, 0.17, 0.15], (S, s, f) => {
      // 樹根狀的腳：往四周伸出的根
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        b.add(cone(v3(f.x, 0.16, f.z), v3(f.x + Math.sin(a) * 0.45, 0.0, f.z + Math.cos(a) * 0.45), 0.09, 5), `foot${S}`, bark);
      }
    });
    // 樹幹（略彎）、樹皮的瘤、臉（發光的眼睛、裂開的嘴）
    b.add(limb(v3(0, 0.95, 0), v3(0, 1.8, 0.03), [[0, 0.36], [1, 0.3]], 12), 'trunk', bark, ['pelvis', v3(0, 0.95, 0), v3(0, 1.8, 0.03), 0.2]);
    b.add(limb(v3(0, 1.75, 0.03), v3(0, 2.75, -0.02), [[0, 0.3], [0.6, 0.31], [1, 0.24]], 12), 'chest', bark, ['trunk', v3(0, 1.75, 0.03), v3(0, 2.75, -0.02), 0.2]);
    b.add(ellipsoid([0.18, 1.45, 0.2], [0.12, 0.16, 0.1]), 'trunk', bark);
    b.add(ellipsoid([-0.2, 2.1, 0.18], [0.1, 0.14, 0.1]), 'chest', bark);
    b.mirror((S, s) => b.add(ellipsoid([0.1 * s, 2.45, 0.27], [0.04, 0.03, 0.02]), 'chest', 'eye'));
    b.add(ellipsoid([0, 2.25, 0.27], [0.1, 0.025, 0.02]), 'chest', 'wolfAlpha');
    // 樹冠：好幾團苔蘚與樹葉
    for (const [x, y, z, r] of [[0, 3.15, 0, 0.6], [0.4, 2.95, 0.1, 0.42], [-0.42, 3.0, -0.05, 0.45], [0.05, 2.9, -0.4, 0.4], [-0.1, 3.5, 0.05, 0.38]]) {
      b.add(ellipsoid([x, y, z], [r, r * 0.8, r], null, [10, 7]), 'crown', leaf);
    }
    // 手臂：樹枝，手是一叢葉子；肩上長著苔蘚
    b.mirror((S, s) => {
      const sh = b.bone(`arm${S}`, 'chest', [0.3 * s, 2.5, 0]);
      const el = b.bone(`fore${S}`, `arm${S}`, [0.85 * s, 2.05, 0.1]);
      const hd = b.bone(`hand${S}`, `fore${S}`, [1.05 * s, 1.4, 0.2]);
      b.add(limb(sh, el, [[0, 0.14], [1, 0.1]], 8), `arm${S}`, bark, ['chest', sh, el, 0.1]);
      b.add(limb(el, hd, [[0, 0.1], [1, 0.07]], 8), `fore${S}`, bark, [`arm${S}`, el, hd, 0.08]);
      for (let i = 0; i < 3; i++) b.add(cone(v3(hd.x, hd.y + 0.05, hd.z), v3(hd.x + s * (0.1 + i * 0.08), hd.y - 0.45, hd.z + (i - 1) * 0.18), 0.04, 4), `hand${S}`, bark);
      b.add(ellipsoid([hd.x, hd.y + 0.05, hd.z], [0.3, 0.26, 0.3], null, [10, 7]), `hand${S}`, leaf);
      b.add(ellipsoid([0.35 * s, 2.62, 0], [0.22, 0.14, 0.2], null, [10, 7]), 'chest', leaf);
      b.add(cone(v3(0.6 * s, 2.25, 0.05), v3(0.85 * s, 2.7, -0.1), 0.04, 4), `arm${S}`, bark); // 細枝
    });
    return { legs, legOpts: { stride: 0.85, height: 0.18, time: 0.55, lift: 0.12 }, stride: 1.7, eye: 2.4, mark: 3.7, aim: 2.0, mouth: ['chest', [0, 2.2, 0.4]] };
  },
  restState: () => 'dormant',
  init(c) {
    c.anim.awake = c.state === 'dormant' || c.state === 'idle' ? 0 : 1;
  },
  // 假裝是樹：玩家走近才甦醒
  dormantThink(c, dt, w, ai) {
    const p = w.combat.player.pos;
    if (w.combat.player.alive && Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < c.stats.wakeRange) ai.provoked(c);
  },
  wake(c) {
    c.wakeT = 0;
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const target = c.state === 'dormant' || (c.state === 'idle' && c.t > 6) ? 0 : 1;
    a.awake += (target - a.awake) * (1 - Math.exp(-(target > a.awake ? 2.2 : 0.8) * k.dt));
    const sleep = 1 - a.awake;
    // 樹的樣子：雙手往上舉成樹枝、往外張開；身體筆直；隨風輕擺
    const wind = Math.sin(k.time * 0.8 + a.seed) * 0.02;
    B.pelvis.rotateZ(wind * sleep);
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      B[`arm${S}`].rotateZ(s * (1.9 * sleep + 0.15));
      B[`fore${S}`].rotateZ(s * (-0.5 * sleep));
      B[`fore${S}`].rotateX(-0.2 * sleep);
    }
    // 甦醒時抖一下
    if (a.awake > 0.05 && a.awake < 0.9) B.chest.rotateZ(Math.sin(k.time * 25) * 0.03 * (1 - a.awake));
    // 走路：身體左右晃
    const run = clamp(a.speed / 2, 0, 1);
    B.trunk.rotateZ(Math.sin(a.phase * Math.PI * 2) * 0.06 * run);
    B.chest.rotateY(a.look * 0.5 * a.awake);
    // 攻擊：樹根——雙臂舉高、往地面砸；橫掃——單臂往前揮
    if (a.attack === 'roots') {
      for (const S of ['L', 'R']) B[`arm${S}`].rotateX(-1.8 * a.windup + 2.4 * a.strike);
      B.chest.rotateX(0.25 * a.strike);
    } else {
      B.armR.rotateX(-1.3 * a.windup + 1.9 * a.strike);
      B.armR.rotateY(0.8 * a.strike);
      B.chest.rotateY(-0.4 * a.windup + 0.5 * a.strike);
    }
    B.chest.rotateX(-a.flinch * 0.12);
    if (c.legs) for (const leg of c.legs.legs) leg.weight = 1;
  },
  strike(c, A, dmg, w) {
    // 樹根從預告的範圍裡冒出來；被纏住的玩家動不了
    if (A.name === 'roots') {
      w.combat.roots(A.x, A.z, A.def.shape.radius);
      w.brain.hitCheck(c, A, dmg);
      return true;
    }
    return false;
  },
};

// ---------------------------------------------------------------- 石像守衛
export const golem = {
  id: 'golem',
  keepVariant: true,
  variants: { pillar: { golemRune: 'golem' } }, // 白天：符文是暗的石頭
  define(b) {
    const m = 'golem';
    const rune = 'golemRune';
    b.bone('pelvis', null, [0, 1.35, 0]);
    b.bone('torso', 'pelvis', [0, 1.95, 0]);
    b.bone('chest', 'torso', [0, 2.5, 0]);
    b.bone('head', 'chest', [0, 3.05, 0.05]);
    const legs = bipedLegs(b, { pelvis: 'pelvis', hipX: 0.36, hipY: 1.25, knee: 0.1, footY: 0.12 }, m, [0.24, 0.2, 0.2], (S, s, f) => {
      b.add(box([f.x, 0.1, f.z + 0.08], [0.42, 0.2, 0.62]), `foot${S}`, m);
    });
    // 方塊狀的身體：骨盆、腰、寬闊的胸、肩甲；胸口與手臂上的發光符文
    b.add(box([0, 1.35, 0], [0.95, 0.4, 0.6]), 'pelvis', m);
    b.add(box([0, 1.85, 0], [0.75, 0.6, 0.5], 0, 0.1), 'torso', m);
    b.add(box([0, 2.5, 0], [1.4, 0.85, 0.8]), 'chest', m);
    b.add(box([0, 2.7, -0.15], [1.0, 0.5, 0.6], 0.15), 'chest', m);
    b.add(box([0.2, 2.55, 0.41], [0.12, 0.4, 0.04]), 'chest', rune);
    b.add(box([-0.15, 2.45, 0.41], [0.3, 0.08, 0.04], 0, 0, 0.5), 'chest', rune);
    b.add(box([0, 2.25, 0.41], [0.45, 0.06, 0.04]), 'chest', rune);
    // 頭：小、埋在肩膀間；一條發光的眼縫
    b.add(box([0, 3.05, 0.05], [0.45, 0.42, 0.45]), 'head', m);
    b.add(box([0, 3.08, 0.28], [0.32, 0.06, 0.03]), 'head', rune);
    b.mirror((S, s) => {
      const sh = b.bone(`arm${S}`, 'chest', [0.78 * s, 2.65, 0]);
      const el = b.bone(`fore${S}`, `arm${S}`, [0.95 * s, 1.95, 0.05]);
      const fs = b.bone(`fist${S}`, `fore${S}`, [1.0 * s, 1.2, 0.12]);
      b.add(box([0.85 * s, 2.85, 0], [0.6, 0.35, 0.65], 0, 0, -0.2 * s), `arm${S}`, m); // 肩甲
      b.add(box([(sh.x + el.x) / 2, (sh.y + el.y) / 2, 0], [0.36, 0.8, 0.38]), `arm${S}`, m);
      b.add(box([(el.x + fs.x) / 2, (el.y + fs.y) / 2, 0.08], [0.42, 0.75, 0.42]), `fore${S}`, m);
      b.add(box([fs.x, fs.y - 0.1, fs.z], [0.55, 0.5, 0.55]), `fist${S}`, m);
      b.add(box([(el.x + fs.x) / 2 + 0.22 * s, (el.y + fs.y) / 2, 0.08], [0.03, 0.5, 0.08]), `fore${S}`, rune);
    });
    return { legs, legOpts: { stride: 0.9, height: 0.16, time: 0.6, lift: 0.1 }, stride: 1.8, eye: 3, mark: 3.5, aim: 2.1 };
  },
  // 白天是石柱（dormant），入夜甦醒
  restState(c, w) {
    return w.clock.night ? 'idle' : 'dormant';
  },
  homes(w, hf, deps) {
    // 古石環裡、正對拱門的兩側
    const S = deps.stonesCfg;
    const r = deps.circleCfg.ringRadius - 4;
    return [0.6, 0.6 + Math.PI].map((a) => ({ x: S.center[0] + Math.cos(a) * r, z: S.center[1] + Math.sin(a) * r }));
  },
  init(c) {
    c.wakeT = 0;
  },
  think(c, dt, w, ai) {
    const night = w.clock.night;
    if (c.state === 'dormant') {
      c.model.setVariant('pillar');
      if (night) {
        // 入夜：符文亮起、慢慢站起來
        c.wakeT += dt;
        if (c.wakeT > 2.2) {
          c.wakeT = 0;
          c.model.setVariant('base');
          ai.setState(c, 'idle');
        }
      } else c.wakeT = 0;
      ai.stop(c, dt);
      return true;
    }
    c.model.setVariant('base');
    // 天亮：回到原位變回石柱
    if (!night && (c.state === 'idle' || c.state === 'patrol' || c.state === 'return')) {
      if (Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z) < 1.5) {
        ai.setState(c, 'dormant');
        c.heading = c.homeHeading ?? c.heading;
        return true;
      }
      if (c.state !== 'return') ai.setState(c, 'return');
    }
    return false;
  },
  // 白天的石柱打不動、也打不醒
  stayDormant: (c, w) => !w.clock.night,
  damageScale(c) {
    return c.state === 'dormant' ? 0 : 1;
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    // 石柱：雙臂貼身、低頭縮進肩膀、雙腿併攏；甦醒時慢慢舒展
    const pillar = c.state === 'dormant' ? 1 - clamp((c.wakeT ?? 0) / 2.2, 0, 1) : 0;
    a.pillar = (a.pillar ?? pillar) + (pillar - (a.pillar ?? pillar)) * (1 - Math.exp(-3 * k.dt));
    const p = a.pillar;
    B.pelvis.position.y -= 0.35 * p;
    B.head.position.y -= 0.25 * p;
    B.head.rotateX(0.3 * p);
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      B[`arm${S}`].rotateZ(-0.12 * s * p);
      B[`arm${S}`].position.x -= 0.12 * s * p;
    }
    if (c.wakeT > 0) B.chest.rotateZ(Math.sin(k.time * 30) * 0.015);
    // 走路：沉重地左右晃
    const run = clamp(a.speed / 2, 0, 1);
    B.torso.rotateZ(Math.sin(a.phase * Math.PI * 2) * 0.05 * run);
    B.chest.rotateY(a.look * 0.4);
    // 重拳：右拳往後拉再往前打；震波：雙拳舉高砸地
    if (a.attack === 'quake') {
      for (const S of ['L', 'R']) {
        B[`arm${S}`].rotateX(-2.6 * a.windup + 3.0 * a.strike);
        B[`fore${S}`].rotateX(-0.4 * a.windup);
      }
      B.chest.rotateX(-0.2 * a.windup + 0.45 * a.strike);
      B.pelvis.position.y -= 0.3 * a.strike;
    } else {
      B.armR.rotateX(0.6 * a.windup - 1.6 * a.strike);
      B.foreR.rotateX(-1.2 * a.windup + 1.0 * a.strike);
      B.chest.rotateY(0.5 * a.windup - 0.6 * a.strike);
    }
    B.chest.rotateX(-a.flinch * 0.06);
    if (c.legs) for (const leg of c.legs.legs) leg.weight = 1 - p * 0.5;
  },
  strike(c, A, dmg, w) {
    if (A.name === 'quake') w.combat.sparks(c.pos.x + Math.sin(c.heading) * 1.4, c.pos.y + 0.2, c.pos.z + Math.cos(c.heading) * 1.4, 18, 'spark', 5);
    return false;
  },
};

// ---------------------------------------------------------------- 遊魂
export const wisp = {
  id: 'wisp',
  free: true, // 不受碰撞：穿牆、穿樹
  define(b) {
    const m = 'wisp';
    b.bone('core', null, [0, 1.6, 0]);
    b.bone('head', 'core', [0, 1.88, 0.05]);
    b.bone('tail1', 'core', [0, 1.35, -0.12]);
    b.bone('tail2', 'tail1', [0, 1.05, -0.35]);
    b.bone('tail3', 'tail2', [0, 0.8, -0.65]);
    b.bone('tail4', 'tail3', [0, 0.62, -1.0]);
    // 頭、軀幹（往下收成尾巴）、空洞發光的眼睛、細長的手臂
    b.add(ellipsoid([0, 1.92, 0.05], [0.2, 0.24, 0.2]), 'head', m);
    b.mirror((S, s) => b.add(ellipsoid([0.07 * s, 1.94, 0.22], [0.035, 0.05, 0.02]), 'head', 'eye'));
    b.add(ellipsoid([0, 1.58, 0], [0.24, 0.28, 0.2]), 'core', m);
    const J = b.joint;
    b.add(limb(J.tail1, J.tail2, [[0, 0.2], [1, 0.15]], 10), 'tail1', m, ['core', J.tail1, J.tail2, 0.1]);
    b.add(limb(J.tail2, J.tail3, [[0, 0.15], [1, 0.09]], 8), 'tail2', m);
    b.add(limb(J.tail3, J.tail4, [[0, 0.09], [1, 0.02]], 8), 'tail3', m);
    b.mirror((S, s) => {
      const sh = b.bone(`arm${S}`, 'core', [0.2 * s, 1.72, 0.02]);
      const hd = b.bone(`hand${S}`, `arm${S}`, [0.5 * s, 1.35, 0.2]);
      b.add(limb(sh, hd, [[0, 0.06], [0.7, 0.035], [1, 0.015]], 6), `arm${S}`, m);
    });
    return { eye: 0.3, mark: 2.25, aim: 1.6 };
  },
  think(c, dt, w) {
    // 飄在離地 flying 公尺的高度（不受地形碰撞）
    const ground = Math.max(w.terrain.heightAt(c.pos.x, c.pos.z), w.terrain.waterSurfaceAt(c.pos.x, c.pos.z));
    c.pos.y += (ground + c.stats.flying - 1.6 - c.pos.y) * (1 - Math.exp(-4 * dt));
    return false;
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const o = c.model.object;
    o.position.y += Math.sin(k.time * 1.7 + a.seed) * 0.12;
    o.rotation.x = clamp(a.speed * 0.06, 0, 0.4); // 往前飄時前傾
    for (let i = 1; i <= 3; i++) {
      B[`tail${i}`].rotateY(Math.sin(k.time * 2.4 + a.seed - i * 0.9) * 0.3);
      B[`tail${i}`].rotateX(Math.sin(k.time * 1.9 + a.seed - i * 0.7) * 0.15 + a.speed * 0.04);
    }
    // 尖嘯：張開雙臂、往後仰；出手時往前撲
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      B[`arm${S}`].rotateZ(s * (0.3 + 0.8 * a.windup) + Math.sin(k.time * 2 + s) * 0.1);
      B[`arm${S}`].rotateX(-1.2 * a.strike);
    }
    B.core.rotateX(-0.3 * a.windup + 0.4 * a.strike);
    B.head.rotateY(a.look * 0.6);
  },
};
