// 霜翼飛龍（世界王）：霜脛山脊最高處。
//   身體：長頸、長尾、兩隻後腳；一對翼（上臂、前臂、翼指三段骨，翼膜是兩面都看得到的薄片，各段跟著自己的骨頭）
//   行為：
//     · 停在山脊上（收翼、用後腳站著）；玩家靠近時抬頭吼叫，起飛
//     · 在玩家上空盤旋；停下來朝玩家吐冰息（地上一長條預告，冰息持續一段時間、每一小段判定一次）
//     · 每隔一陣子降落在玩家附近拍翼：大範圍風壓，打中會被吹飛
//     · 血量剩一半：飛到月影湖上空，之後在湖面上空盤旋、從湖上朝岸邊吐冰息（玩家得追到湖邊）
//     · 玩家跑太遠：飛回山脊、回滿血、回到第一階段
import * as THREE from 'three';
import { ellipsoid, limb, cone, v3 } from '../parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 薄片（兩面）：points 依序圍成的凸多邊形，以扇形三角化；正反兩面各一份，法線朝上／朝下
function membrane(points, thickness = 0.03) {
  const pos = [];
  const nor = [];
  const c = points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (const side of [1, -1]) {
      const off = new THREE.Vector3(0, (side * thickness) / 2, 0);
      const tri = side > 0 ? [c, a, b] : [c, b, a];
      const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
      for (const p of tri) {
        pos.push(p.x + off.x, p.y + off.y, p.z + off.z);
        nor.push(n.x, n.y, n.z);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export const wyvern = {
  id: 'wyvern',
  free: true,
  stopAt: 10,
  levelGrowth: 0,
  define(b) {
    const m = 'wyvern';
    const wm = 'wyvernWing';
    b.bone('body', null, [0, 2.2, 0]);
    b.bone('chest', 'body', [0, 2.35, 0.9]);
    b.bone('neck1', 'chest', [0, 2.65, 1.6]);
    b.bone('neck2', 'neck1', [0, 3.1, 2.25]);
    b.bone('head', 'neck2', [0, 3.4, 2.85]);
    b.bone('jaw', 'head', [0, 3.25, 3.0]);
    const tail = [[2.1, -1.0], [1.95, -2.0], [1.8, -3.0], [1.65, -4.0], [1.55, -5.0]];
    let parent = 'body';
    tail.forEach(([y, z], i) => {
      b.bone(`tail${i + 1}`, parent, [0, y, z]);
      parent = `tail${i + 1}`;
    });
    const J = b.joint;
    // 身體、胸、長頸、頭（角、發光的眼、牙）、長尾（尾端有冰刺）
    b.add(ellipsoid([0, 2.25, 0.1], [0.75, 0.7, 1.35]), 'body', m);
    b.add(ellipsoid([0, 2.4, 0.95], [0.65, 0.65, 0.75]), 'chest', m);
    b.add(limb(v3(0, 2.5, 1.3), J.neck2, [[0, 0.42], [1, 0.3]], 12), 'neck1', m, ['chest', v3(0, 2.5, 1.3), J.neck2, 0.25]);
    b.add(limb(J.neck2, J.head, [[0, 0.3], [1, 0.24]], 10), 'neck2', m, ['neck1', J.neck2, J.head, 0.2]);
    b.add(ellipsoid([0, 3.45, 2.95], [0.3, 0.27, 0.38]), 'head', m);
    b.add(limb(v3(0, 3.42, 3.1), v3(0, 3.3, 3.65), [[0, 0.22], [1, 0.12]], 10), 'head', m);
    b.add(limb(v3(0, 3.2, 3.05), v3(0, 3.15, 3.55), [[0, 0.16], [1, 0.08]], 8), 'jaw', m);
    b.mirror((S, s) => {
      b.add(ellipsoid([0.17 * s, 3.55, 3.15], [0.05, 0.035, 0.05]), 'head', 'eye');
      b.add(limb(v3(0.15 * s, 3.62, 2.85), v3(0.32 * s, 3.95, 2.35), [[0, 0.07], [1, 0.02]], 6), 'head', 'iceShard');
      b.add(limb(v3(0.08 * s, 3.6, 2.7), v3(0.15 * s, 3.75, 2.25), [[0, 0.05], [1, 0.015]], 5), 'head', 'iceShard');
      for (let i = 0; i < 3; i++) b.add(cone(v3(0.08 * s, 3.27, 3.25 + i * 0.12), v3(0.08 * s, 3.17, 3.27 + i * 0.12), 0.02, 4), 'head', 'ivory');
    });
    tail.slice(0, -1).forEach((t, i) => {
      const a = J[`tail${i + 1}`];
      const c = J[`tail${i + 2}`];
      const r0 = 0.55 * (1 - i / 5);
      b.add(limb(a, c, [[0, r0], [1, r0 * 0.8]], 10), `tail${i + 1}`, m, [i ? `tail${i}` : 'body', a, c, 0.2]);
      b.add(cone(v3(0, a.y + r0 * 0.8, a.z - 0.4), v3(0, a.y + r0 + 0.3, a.z - 0.7), 0.1, 4), `tail${i + 1}`, 'iceShard'); // 背上的冰刺
    });
    b.add(cone(J.tail5, v3(0, 1.5, -5.8), 0.18, 5), 'tail4', 'iceShard');
    for (let i = 0; i < 4; i++) b.add(cone(v3(0, 2.85 - i * 0.05, 0.9 - i * 0.6), v3(0, 3.25 - i * 0.05, 0.6 - i * 0.6), 0.12, 4), i < 2 ? 'chest' : 'body', 'iceShard');
    // 翼：三段骨（上臂、前臂、翼指）與三片翼膜
    b.mirror((S, s) => {
      const sh = b.bone(`wing${S}`, 'chest', [0.5 * s, 2.75, 0.9]);
      const el = b.bone(`wfore${S}`, `wing${S}`, [2.4 * s, 3.15, 0.55]);
      const wr = b.bone(`wtip${S}`, `wfore${S}`, [4.3 * s, 3.0, 0.15]);
      const tip = v3(6.4 * s, 2.7, -0.5);
      b.add(limb(sh, el, [[0, 0.17], [1, 0.12]], 8), `wing${S}`, wm, ['chest', sh, el, 0.2]);
      b.add(limb(el, wr, [[0, 0.12], [1, 0.08]], 8), `wfore${S}`, wm, [`wing${S}`, el, wr, 0.15]);
      b.add(limb(wr, tip, [[0, 0.07], [1, 0.03]], 6), `wtip${S}`, wm, [`wfore${S}`, wr, tip, 0.15]);
      b.add(cone(el, v3(2.55 * s, 3.4, 0.75), 0.06, 4), `wfore${S}`, 'ivory'); // 翼角的爪
      const tr1 = v3(0.5 * s, 2.4, -1.0);
      const tr2 = v3(2.2 * s, 2.75, -1.25);
      const tr3 = v3(3.9 * s, 2.8, -1.6);
      const tr4 = v3(5.3 * s, 2.7, -1.6);
      b.add(membrane([sh, el, tr2, tr1]), `wing${S}`, wm);
      b.add(membrane([el, wr, tr3, tr2]), `wfore${S}`, wm, [`wing${S}`, el, wr, 0.6]);
      b.add(membrane([wr, tip, tr4, tr3]), `wtip${S}`, wm, [`wfore${S}`, wr, tip, 0.6]);
      // 後腳：大腿、小腿、腳（三根爪）
      const th = b.bone(`thigh${S}`, 'body', [0.55 * s, 2.0, -0.35]);
      const kn = b.bone(`shin${S}`, `thigh${S}`, [0.65 * s, 1.1, 0.1]);
      const ft = b.bone(`foot${S}`, `shin${S}`, [0.65 * s, 0.15, -0.3]);
      b.add(limb(th, kn, [[0, 0.32], [1, 0.18]], 9), `thigh${S}`, m, ['body', th, kn, 0.2]);
      b.add(limb(kn, ft, [[0, 0.16], [1, 0.11]], 8), `shin${S}`, m, [`thigh${S}`, kn, ft, 0.12]);
      for (let i = -1; i <= 1; i++) b.add(cone(v3(ft.x + i * 0.12, 0.08, ft.z + 0.05), v3(ft.x + i * 0.18, 0.02, ft.z + 0.45), 0.05, 4), `foot${S}`, 'ivory');
    });
    const legs = [
      { upper: 'thighL', lower: 'shinL', end: 'footL', group: 0 },
      { upper: 'thighR', lower: 'shinR', end: 'footR', group: 1 },
    ];
    return { legs, legOpts: { stride: 1.6, height: 0.35, time: 0.45, lift: 0.15 }, stride: 3, eye: 3.4, mark: 4.4, aim: 2.4, mouth: ['head', [0, 3.3, 3.7]] };
  },
  homes(w, hf, deps) {
    // 山脊上最高的一點（沿山脊中心線找）
    const R = deps.ridgeCfg;
    let best = null;
    for (let t = 0.2; t <= 0.85; t += 0.01) {
      const x = R.from[0] + (R.to[0] - R.from[0]) * t;
      const z = R.from[1] + (R.to[1] - R.from[1]) * t;
      const h = hf.height(x, z);
      if (hf.normal(x, z)[1] > 0.75 && (!best || h > best.h)) best = { x, z, h };
    }
    return best ? [best] : [];
  },
  init(c, w) {
    c.alt = 0; // 離地高度（0 = 停在地上）
    c.altGoal = 0;
    c.phase2 = false;
    c.ridgeHome = c.ridgeHome ?? { x: c.home.x, z: c.home.z };
    c.home.x = c.ridgeHome.x;
    c.home.z = c.ridgeHome.z;
    c.territory = c.stats.territory;
    c.orbitA = 0;
    c.flap = 0;
    c.gustT = 8;
    c.away = 0;
  },
  // 在地上時才用腳（IK）
  canAttack(c, name, def) {
    if (def.land) return c.gustT <= 0 && !c.migrating;
    return c.alt > 3 && !c.migrating;
  },
  think(c, dt, w, ai) {
    const S = c.stats;
    const T = w.terrain;
    const player = w.combat.player;
    const p = player.pos;
    const surface = (x, z) => Math.max(T.heightAt(x, z), T.waterSurfaceAt(x, z));
    // 高度：往目標高度飛（起飛、降落）
    c.alt += clamp(c.altGoal - c.alt, -dt * 7, dt * 5);
    c.pos.y = surface(c.pos.x, c.pos.z) + c.alt;
    c.gustT -= dt;
    const dPlayer = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
    const lake = w.hf;
    const flyTo = (x, z, speed, stopAt = 1) => {
      const dx = x - c.pos.x;
      const dz = z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const want = d > stopAt ? speed * clamp(d / 8, 0.25, 1) : 0;
      const diff = wrap(Math.atan2(dx, dz) - c.heading);
      c.heading = wrap(c.heading + clamp(diff, -S.turn * dt, S.turn * dt));
      c.speed += clamp(want * Math.max(0.3, Math.cos(diff)) - c.speed, -dt * 10, dt * 6);
      ai.move(c, Math.sin(c.heading) * c.speed * dt, Math.cos(c.heading) * c.speed * dt);
      return d;
    };
    // 血量剩一半：飛到湖上
    if (!c.phase2 && c.hp <= c.maxHp * S.lakePhase && c.state !== 'return') {
      c.phase2 = true;
      c.migrating = true;
      if (c.atk) ai.endAttack(c);
      const L = w.lakeCenter;
      c.home.x = L.x;
      c.home.z = L.z;
      c.territory = w.lakeRadius * 1.6;
      ai.setState(c, 'chase');
      c.mark = 'alert';
      c.markT = 2;
    }
    switch (c.state) {
      case 'idle':
      case 'patrol': {
        c.altGoal = 0;
        ai.stop(c, dt);
        c.sees = player.alive && dPlayer < S.sight;
        if (c.sees) {
          ai.setState(c, 'alert');
          c.mark = 'alert';
          c.markT = 2.2;
        }
        return true;
      }
      case 'alert':
        // 抬頭吼叫，然後起飛
        ai.face(c, p.x, p.z, dt);
        if (c.t > 1.6) {
          c.altGoal = S.orbit.height;
          ai.setState(c, 'chase');
        }
        return true;
      case 'chase': {
        c.altGoal = S.orbit.height;
        // 遠離太久：回山脊、回血
        c.away = !player.alive || dPlayer > (c.migrating ? 400 : 140) ? c.away + dt : 0;
        if (c.away > 6) {
          ai.giveUp(c);
          return true;
        }
        if (c.migrating) {
          c.altGoal = 22;
          const d = flyTo(c.home.x, c.home.z, S.run * 1.2, 4);
          if (d < 8) c.migrating = false;
          return true;
        }
        // 盤旋的中心：第一階段是玩家頭上；第二階段是湖面上離玩家最近的一點
        let cx = p.x;
        let cz = p.z;
        if (c.phase2) {
          const L = w.lakeCenter;
          const dx = p.x - L.x;
          const dz = p.z - L.z;
          const d = Math.hypot(dx, dz) || 1;
          const r = Math.min(d, w.lakeRadius * 0.55);
          cx = L.x + (dx / d) * r;
          cz = L.z + (dz / d) * r;
        }
        // 拍翼風壓：先降落在玩家附近（只在第一階段；第二階段一直在湖上）
        if (!c.phase2 && c.gustT <= 0 && player.alive) {
          ai.setState(c, 'landing');
          return true;
        }
        c.orbitA += (S.orbit.speed / S.orbit.radius) * dt;
        const ox = cx + Math.sin(c.orbitA) * S.orbit.radius;
        const oz = cz + Math.cos(c.orbitA) * S.orbit.radius;
        flyTo(ox, oz, S.orbit.speed, 0.5);
        // 冰息：在空中停下、轉向玩家
        const dBreath = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        if (c.alt > S.orbit.height * 0.7) {
          const pick = ai.pickAttack(c, dBreath);
          if (pick && !pick[1].land) ai.startAttack(c, pick[0], pick[1]);
        }
        return true;
      }
      case 'landing': {
        // 飛到玩家旁邊、降落，再拍翼
        const a = Math.atan2(c.pos.x - p.x, c.pos.z - p.z);
        const lx = p.x + Math.sin(a) * 5;
        const lz = p.z + Math.cos(a) * 5;
        const d = flyTo(lx, lz, S.orbit.speed * 1.2, 0.8);
        c.altGoal = d < 10 ? 0 : S.orbit.height * 0.6;
        if ((d < 2.5 && c.alt < 0.8) || c.t > 8) {
          c.gustT = S.attacks.gust.cooldown;
          ai.startAttack(c, 'gust', S.attacks.gust);
        }
        return true;
      }
      case 'attack': {
        const A = c.atk;
        if (A?.def.land) {
          // 降落：前搖期間落地、張開雙翼
          c.altGoal = 0;
          if (A.phase === 'recover' && A.t > A.def.recover * 0.6) c.altGoal = S.orbit.height;
        } else {
          c.altGoal = Math.max(8, S.orbit.height - 3);
          // 盤旋中的慣性：慢慢停下
          c.speed *= Math.exp(-3 * dt);
          ai.move(c, Math.sin(c.heading) * c.speed * dt, Math.cos(c.heading) * c.speed * dt);
        }
        ai.updateAttack(c, dt);
        return true;
      }
      case 'return': {
        // 回山脊、回滿血、回到第一階段
        c.altGoal = 22;
        c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.08 * dt);
        const R = c.ridgeHome;
        const d = flyTo(R.x, R.z, S.run, 2);
        if (d < 4) {
          c.altGoal = 0;
          if (c.alt < 0.3) {
            c.hp = c.maxHp;
            c.phase2 = false;
            c.migrating = false;
            c.home.x = R.x;
            c.home.z = R.z;
            c.territory = S.territory;
            ai.setState(c, 'idle');
          }
        }
        return true;
      }
      case 'flee':
        ai.setState(c, 'chase');
        return true;
      default:
        return false;
    }
  },
  // 冰息的預告貼在地面（高空的飛龍正下方往前一長條）
  beginAttack(c, A, w) {
    if (A.def.breath) {
      A.tele.remove();
      const ox = c.pos.x + Math.sin(A.heading) * 3;
      const oz = c.pos.z + Math.cos(A.heading) * 3;
      A.x = ox;
      A.z = oz;
      A.tele = w.combat.telegraphs.create(A.def.shape, ox, oz, A.heading);
    }
  },
  strikeStep(c, A, dt, dmg, w) {
    const D = A.def;
    if (D.breath) {
      // 冰息：持續 breath 秒，每 1/ticks 判定一次
      A.tick = (A.tick ?? 0) - dt;
      const mouth = c.mouth(w.tmpFrom);
      const far = A.t / D.breath;
      for (let i = 0; i < 3; i++) {
        const u = w.rng.next();
        const tx = A.x + Math.sin(A.heading) * D.shape.length * u * Math.min(1, far * 2);
        const tz = A.z + Math.cos(A.heading) * D.shape.length * u * Math.min(1, far * 2);
        const ty = w.terrain.heightAt(tx, tz) + 0.3;
        w.combat.frost(mouth.x, mouth.y, mouth.z, (tx - mouth.x) * 0.25, (ty - mouth.y) * 0.25, (tz - mouth.z) * 0.25, 2);
      }
      if (A.tick <= 0) {
        A.tick = D.breath / D.ticks;
        w.brain.hitCheck(c, A, dmg);
        A.hit = false;
      }
      if (A.t >= D.breath) {
        A.phase = 'recover';
        A.t = 0;
      }
      return true;
    }
    if (D.land) {
      // 拍翼：風壓往外吹
      if (!A.blown) {
        A.blown = true;
        for (let i = 0; i < 4; i++) w.combat.gust(c.pos.x, c.pos.y + 0.5, c.pos.z, (i / 4) * Math.PI * 2, Math.PI / 2, D.shape.radius, 10);
        w.brain.hitCheck(c, A, dmg);
      }
      if (A.t > 0.3) {
        A.phase = 'recover';
        A.t = 0;
      }
      return true;
    }
    return false;
  },
  onDeath(c, w) {
    c.altGoal = 0;
  },
  deadThink(c, dt, w) {
    // 從空中掉下來
    if (c.alt > 0) {
      c.alt = Math.max(0, c.alt - dt * 12);
      c.pos.y = w.terrain.heightAt(c.pos.x, c.pos.z) + c.alt;
    }
  },
  deathRoll: 1.1,
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const air = clamp(c.alt / 3, 0, 1);
    a.air = air;
    if (c.legs) for (const leg of c.legs.legs) leg.weight = 1 - air;
    // 拍翅：空中一直拍（盤旋時慢、爬升時快）；地上收翼（往後摺、往上收）
    const flapRate = c.altGoal > c.alt + 1 ? 5.5 : 3.2;
    c.flap = (c.flap ?? 0) + k.dt * flapRate * air;
    const flap = Math.sin(c.flap * Math.PI * 2);
    const landing = c.atk?.def.land ? Math.max(a.windup, a.strike) : 0;
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      // 收翼：上臂往上往後、前臂往回摺
      const fold = (1 - air) * (1 - landing);
      B[`wing${S}`].rotateZ(s * (0.55 * flap * air + 0.9 * fold + landing * (0.6 - a.strike * 1.6)));
      B[`wing${S}`].rotateY(s * 0.9 * fold);
      B[`wfore${S}`].rotateY(-s * 1.9 * fold);
      B[`wfore${S}`].rotateZ(s * 0.25 * flap * air);
      B[`wtip${S}`].rotateY(s * 1.4 * fold);
      B[`wtip${S}`].rotateZ(s * 0.2 * Math.sin(c.flap * Math.PI * 2 - 0.6) * air);
      // 空中：後腳往後收
      B[`thigh${S}`].rotateX(-0.9 * air);
      B[`shin${S}`].rotateX(0.8 * air);
    }
    // 身體隨拍翅起伏；空中略微前傾
    B.body.position.y += -flap * 0.18 * air;
    c.model.object.rotation.x = 0.08 * air + clamp(a.speed * 0.01, 0, 0.15);
    c.model.object.rotation.z = clamp(-wrap(c.heading - (a.lastHeading ?? c.heading)) * 30, -0.4, 0.4) * air;
    a.lastHeading = c.heading;
    // 長頸、長尾的擺動
    for (let i = 1; i <= 4; i++) B[`tail${i}`].rotateY(Math.sin(k.time * 1.3 - i * 0.7 + a.seed) * 0.12);
    B.tail1.rotateX(0.15 * air);
    B.neck1.rotateY(a.look * 0.35);
    B.neck2.rotateY(a.look * 0.35);
    // 吼叫（警覺）：抬頭張嘴；冰息：頭往下對準地面、張嘴
    if (c.state === 'alert') {
      B.neck1.rotateX(-0.5);
      B.jaw.rotateX(0.6 * Math.min(1, c.t * 2));
    }
    const breath = c.atk?.def.breath ? Math.max(a.windup, a.strike) : 0;
    B.neck1.rotateX(0.5 * breath * air);
    B.head.rotateX(0.45 * breath);
    B.jaw.rotateX(0.55 * (c.atk?.def.breath ? a.strike : 0) + 0.1 * a.windup);
    B.chest.rotateX(-a.flinch * 0.08);
  },
};
