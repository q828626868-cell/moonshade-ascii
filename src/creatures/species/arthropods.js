// 節肢類：夜網蛛、岩甲蟹。八隻腳各自用兩骨 IK 踩在地上（腳尖貼地），交錯的兩組四隻輪流邁步。
//   蜘蛛：膝蓋高高拱起、腳往外撐得很開；頭胸部 + 大腹部，八隻發光的眼睛與螯牙；吐網減速
//   蟹：寬扁的殼、腳往兩側伸，橫著走（身體一直面向玩家、往側面移動）；一對大螯；受重擊縮進殼裡，被雷劈裂殼
import { ellipsoid, limb, cone, v3 } from '../parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 八隻腳：angles 是各腳從身體往外的方向（0 = 正側面，正值往前）；r 腳根、膝、腳尖離身體中心的水平距離
function eightLegs(b, { root, y, cz, angles, r, kneeY, mat, thick }) {
  const legs = [];
  b.mirror((S, s) => {
    angles.forEach((a, i) => {
      const dx = Math.cos(a) * s;
      const dz = Math.sin(a);
      const p0 = [dx * r[0], y, cz + dz * r[0]];
      const p1 = [dx * r[1], kneeY, cz + dz * r[1]];
      const p2 = [dx * r[2], 0.03, cz + dz * r[2]];
      const up = b.bone(`coxa${S}${i}`, root, p0);
      const kn = b.bone(`knee${S}${i}`, `coxa${S}${i}`, p1);
      const tp = b.bone(`tip${S}${i}`, `knee${S}${i}`, p2);
      b.add(limb(up, kn, [[0, thick[0]], [0.5, thick[0] * 1.15], [1, thick[1]]], 7), `coxa${S}${i}`, mat, [root, up, kn, 0.05]);
      b.add(limb(kn, tp, [[0, thick[1]], [0.8, thick[2]], [1, thick[2] * 0.4]], 6), `knee${S}${i}`, mat, [`coxa${S}${i}`, kn, tp, 0.05]);
      legs.push({ upper: `coxa${S}${i}`, lower: `knee${S}${i}`, end: `tip${S}${i}`, group: (i + (s > 0 ? 0 : 1)) % 2 });
    });
  });
  return legs;
}

// ---------------------------------------------------------------- 夜網蛛
export const spider = {
  id: 'spider',
  define(b) {
    const m = 'spider';
    b.bone('body', null, [0, 0.75, 0.15]);
    b.bone('abdomen', 'body', [0, 0.82, -0.18]);
    b.bone('head', 'body', [0, 0.78, 0.45]);
    b.bone('fangs', 'head', [0, 0.68, 0.62]);
    const legs = eightLegs(b, { root: 'body', y: 0.72, cz: 0.15, angles: [0.75, 0.28, -0.22, -0.7], r: [0.2, 0.85, 1.6], kneeY: 1.3, mat: m, thick: [0.055, 0.045, 0.025] });
    // 頭胸部、細腰、大腹部（背上有花紋：腹部上半是另一種字元——用網的白色材質點綴）
    b.add(ellipsoid([0, 0.76, 0.18], [0.3, 0.2, 0.34]), 'body', m);
    b.add(ellipsoid([0, 0.84, -0.62], [0.45, 0.38, 0.56]), 'abdomen', m);
    b.add(limb(v3(0, 0.8, -0.1), v3(0, 0.84, -0.2), [[0, 0.1], [1, 0.12]], 8), 'abdomen', m);
    for (let i = 0; i < 4; i++) b.add(ellipsoid([0, 1.18 - i * 0.02, -0.38 - i * 0.17], [0.13 - i * 0.02, 0.03, 0.05]), 'abdomen', 'web'); // 背上的白色斑紋
    b.add(ellipsoid([0, 0.8, 0.47], [0.2, 0.15, 0.17]), 'head', m);
    // 八隻眼睛：前排四隻大、後排四隻小
    for (const [x, y, z, r] of [[0.05, 0.88, 0.62, 0.03], [-0.05, 0.88, 0.62, 0.03], [0.12, 0.86, 0.6, 0.022], [-0.12, 0.86, 0.6, 0.022], [0.07, 0.94, 0.55, 0.018], [-0.07, 0.94, 0.55, 0.018], [0.14, 0.92, 0.52, 0.015], [-0.14, 0.92, 0.52, 0.015]]) {
      b.add(ellipsoid([x, y, z], [r, r, r]), 'head', 'eye');
    }
    b.mirror((S, s) => {
      b.add(limb(v3(0.06 * s, 0.74, 0.6), v3(0.05 * s, 0.6, 0.68), [[0, 0.045], [1, 0.03]], 6), 'fangs', m);
      b.add(cone(v3(0.05 * s, 0.6, 0.68), v3(0.02 * s, 0.5, 0.64), 0.022, 4), 'fangs', 'ivory');
      // 觸肢
      b.add(limb(v3(0.12 * s, 0.72, 0.55), v3(0.2 * s, 0.6, 0.78), [[0, 0.03], [1, 0.02]], 5), 'head', m);
    });
    return { legs, legOpts: { stride: 0.95, height: 0.28, time: 0.22, lift: 0.03, minTime: 0.09 }, stride: 1.6, eye: 0.9, mark: 1.4, aim: 0.8, mouth: ['head', [0, 0.65, 0.7]] };
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const run = clamp(a.speed / 5, 0, 1);
    B.body.position.y += Math.sin(a.phase * Math.PI * 4) * 0.02 * run - a.windup * 0.12;
    B.abdomen.rotateX(Math.sin(k.time * 1.3 + a.seed) * 0.05 - run * 0.08);
    B.abdomen.rotateY(Math.sin(k.time * 0.9 + a.seed) * 0.06);
    B.head.rotateY(a.look * 0.35);
    // 吐網：前搖時腹部翹起、頭抬起；咬：前身壓低、螯牙張開再闔上
    if (a.attack === 'web') {
      B.body.rotateX(-0.25 * a.windup);
      B.abdomen.rotateX(-0.4 * a.windup);
    } else {
      B.body.rotateX(0.18 * a.windup - 0.1 * a.strike);
      B.fangs.rotateX(-0.5 * a.windup + 0.6 * a.strike);
    }
    B.fangs.rotateX(Math.sin(k.time * 6) * 0.05);
    B.body.rotateX(-a.flinch * 0.2);
  },
};

// ---------------------------------------------------------------- 岩甲蟹
export const crab = {
  id: 'crab',
  strafe: true,
  keepVariant: false,
  variants: { cracked: { crab: 'crabCracked' } },
  define(b) {
    const m = 'crab';
    b.bone('body', null, [0, 0.55, 0]);
    b.bone('eyes', 'body', [0, 0.72, 0.42]);
    const legs = eightLegs(b, { root: 'body', y: 0.45, cz: -0.08, angles: [0.45, 0.15, -0.15, -0.45], r: [0.55, 1.0, 1.42], kneeY: 0.85, mat: m, thick: [0.07, 0.055, 0.03] });
    // 寬扁的殼（邊緣有瘤）、下腹
    b.add(ellipsoid([0, 0.62, -0.02], [0.8, 0.3, 0.58]), 'body', m);
    b.add(ellipsoid([0, 0.45, -0.02], [0.62, 0.15, 0.45]), 'body', m);
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI - Math.PI / 2;
      b.add(cone(v3(Math.sin(a) * 0.68, 0.72, Math.cos(a) * 0.45 - 0.05), v3(Math.sin(a) * 0.78, 0.82, Math.cos(a) * 0.52 - 0.05), 0.07, 4), 'body', m);
    }
    for (const [x, z] of [[0.25, 0.1], [-0.25, 0.1], [0, -0.2], [0.35, -0.25], [-0.35, -0.25]]) b.add(cone(v3(x, 0.84, z), v3(x, 0.97, z), 0.08, 5), 'body', m);
    // 眼柄
    b.mirror((S, s) => {
      b.add(limb(v3(0.12 * s, 0.68, 0.45), v3(0.15 * s, 0.9, 0.5), [[0, 0.025], [1, 0.02]], 5), 'eyes', m);
      b.add(ellipsoid([0.15 * s, 0.93, 0.5], [0.04, 0.04, 0.04]), 'eyes', 'eye');
    });
    // 一對大螯：上臂、前臂、鉗（固定的一半 + 會動的一指）
    b.mirror((S, s) => {
      const a0 = b.bone(`arm${S}`, 'body', [0.45 * s, 0.5, 0.42]);
      const a1 = b.bone(`fore${S}`, `arm${S}`, [0.68 * s, 0.6, 0.78]);
      const a2 = b.bone(`claw${S}`, `fore${S}`, [0.6 * s, 0.6, 1.02]);
      b.bone(`pincer${S}`, `claw${S}`, [0.62 * s, 0.56, 1.1]);
      b.add(limb(a0, a1, [[0, 0.08], [1, 0.07]], 7), `arm${S}`, m);
      b.add(limb(a1, a2, [[0, 0.08], [1, 0.11]], 7), `fore${S}`, m);
      b.add(ellipsoid([0.6 * s, 0.62, 1.12], [0.12, 0.13, 0.17]), `claw${S}`, m);
      b.add(cone(v3(0.58 * s, 0.66, 1.2), v3(0.54 * s, 0.68, 1.48), 0.06, 5), `claw${S}`, m);
      b.add(cone(v3(0.62 * s, 0.53, 1.15), v3(0.57 * s, 0.5, 1.44), 0.05, 5), `pincer${S}`, m);
    });
    return { legs, legOpts: { stride: 0.7, height: 0.18, time: 0.2, lift: 0.04, minTime: 0.1 }, stride: 1.1, eye: 0.9, mark: 1.25, aim: 0.65, mouth: ['body', [0, 0.6, 0.6]] };
  },
  // 橫著走：移動時身體朝向移動方向的側面；追擊時一直面向玩家
  strafeFace(c, moveAngle, w) {
    const p = w.combat.player.pos;
    if (c.state === 'chase' || c.state === 'attack' || c.state === 'alert') return Math.atan2(p.x - c.pos.x, p.z - c.pos.z);
    const a = moveAngle + Math.PI / 2;
    const b = moveAngle - Math.PI / 2;
    const da = Math.abs(Math.atan2(Math.sin(a - c.heading), Math.cos(a - c.heading)));
    const db = Math.abs(Math.atan2(Math.sin(b - c.heading), Math.cos(b - c.heading)));
    return da < db ? a : b;
  },
  // 追擊：繞到玩家側面一點再橫著靠近
  chaseTarget(c, w) {
    const p = w.combat.player.pos;
    const a = Math.atan2(c.pos.x - p.x, c.pos.z - p.z) + 0.6 * Math.sin(w.time * 0.7 + c.anim.seed);
    return { x: p.x + Math.sin(a) * 1.8, z: p.z + Math.cos(a) * 1.8, stopAt: 0.3 };
  },
  init(c) {
    c.shellT = 0;
    c.shellCd = 0;
    c.cracked = false;
    c.recent = 0;
  },
  // 縮在殼裡：不動，計時結束才出來
  think(c, dt, w, ai) {
    c.shellCd = Math.max(0, c.shellCd - dt);
    c.recent = Math.max(0, c.recent - dt * c.maxHp * 0.15);
    if (c.shellT <= 0) return false;
    c.shellT -= dt;
    ai.stop(c, dt);
    if (c.shellT <= 0) {
      c.shellCd = c.stats.shell.cooldown;
      if (c.state !== 'chase') ai.setState(c, 'chase');
    }
    return true;
  },
  damageScale(c, element) {
    if (c.shellT > 0 && element !== 'thunder') return c.stats.shell.damage; // 殼裡幾乎不吃傷害
    if (c.cracked && element !== 'thunder') return 1.3; // 殼裂了
    return 1;
  },
  onHurt(c, dmg, element, w, ai) {
    // 雷：殼裂開，暈一下
    if (element === 'thunder' && !c.cracked) {
      c.cracked = true;
      c.shellT = 0;
      c.model.setVariant('cracked');
      w.combat.sparks(c.pos.x, c.pos.y + 0.9, c.pos.z, 14, 'spark', 4);
      ai.stun(c, 1.5);
      return;
    }
    c.recent += dmg;
    const S = c.stats.shell;
    if (!c.cracked && c.shellT <= 0 && c.shellCd <= 0 && c.recent > c.maxHp * S.trigger) {
      c.shellT = S.seconds;
      c.recent = 0;
      if (c.atk) ai.endAttack(c);
    }
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    // 縮殼：腳收到殼下（關掉 IK）、身體貼地、眼柄縮進去
    a.shell = (a.shell ?? 0) + ((c.shellT > 0 ? 1 : 0) - (a.shell ?? 0)) * (1 - Math.exp(-10 * k.dt));
    const sh = a.shell;
    if (c.legs) for (const leg of c.legs.legs) leg.weight = 1 - sh;
    B.body.position.y -= sh * 0.38;
    B.eyes.position.y -= sh * 0.18;
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      for (let i = 0; i < 4; i++) {
        B[`coxa${S}${i}`].rotateZ(-0.9 * sh * s);
        B[`knee${S}${i}`].rotateZ(-1.2 * sh * s);
      }
      B[`arm${S}`].rotateY(0.9 * sh * s);
    }
    B.body.position.y += Math.sin(a.phase * Math.PI * 4) * 0.015;
    B.eyes.rotateY(Math.sin(k.time * 1.7 + a.seed) * 0.3);
    // 螯：待機時一開一闔；夾擊的前搖把螯舉高張開，出手時往前夾
    const snap = Math.max(0, Math.sin(k.time * 2.2 + a.seed)) ** 4;
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      B[`arm${S}`].rotateX(-0.6 * a.windup + 0.7 * a.strike);
      B[`arm${S}`].rotateY(-0.25 * s * a.strike);
      B[`fore${S}`].rotateX(-0.3 * a.windup);
      B[`pincer${S}`].rotateX(0.45 * Math.max(snap, a.windup) - 0.2 * a.strike);
    }
    B.body.rotateZ(-a.flinch * 0.15);
  },
};
