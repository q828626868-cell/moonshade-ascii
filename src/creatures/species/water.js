// 月影湖：湖妖、沼澤蛙。
//   湖妖：潛在水下，水面上只看得到牠游動時的漣漪（world/waterSurface.js 的波動方程式）；玩家靠近水邊時浮出水面，
//         上半身是瘦長的人形、長臂利爪、垂到水裡的水草頭髮，下半身是蛇一樣的尾巴。在水裡時免疫火，怕雷（全身濕透）
//   沼澤蛙：矮胖、頭寬、眼睛長在頭頂、喉囊會鼓起；一跳一跳地走，跳躍撲擊，吐酸液在地上留下毒池
import { ellipsoid, limb, cone, v3 } from '../parts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- 湖妖
export const lakeHag = {
  id: 'lakeHag',
  free: true,
  stopAt: 6,
  define(b) {
    const m = 'lakeHag';
    b.bone('hips', null, [0, 1.0, 0]);
    b.bone('spine', 'hips', [0, 1.5, 0]);
    b.bone('chest', 'spine', [0, 2.0, 0]);
    b.bone('neck', 'chest', [0, 2.35, 0.05]);
    b.bone('head', 'neck', [0, 2.55, 0.1]);
    b.bone('tail1', 'hips', [0, 0.65, -0.45]);
    b.bone('tail2', 'tail1', [0, 0.4, -1.1]);
    b.bone('tail3', 'tail2', [0, 0.25, -1.8]);
    b.bone('tail4', 'tail3', [0, 0.2, -2.5]);
    const J = b.joint;
    // 瘦長的軀幹、肋骨、蛇尾
    b.add(limb(v3(0, 0.9, 0), v3(0, 1.6, 0.02), [[0, 0.3], [1, 0.22]], 12), 'spine', m, ['hips', v3(0, 0.9, 0), v3(0, 1.6, 0.02), 0.15]);
    b.add(ellipsoid([0, 2.0, 0], [0.32, 0.36, 0.22]), 'chest', m);
    for (let i = 0; i < 3; i++) b.add(ellipsoid([0, 1.95 - i * 0.12, 0.14], [0.26 - i * 0.03, 0.025, 0.08]), 'chest', 'hagHair');
    b.add(limb(J.hips, J.tail1, [[0, 0.32], [1, 0.28]], 10), 'hips', m);
    b.add(limb(J.tail1, J.tail2, [[0, 0.28], [1, 0.2]], 10), 'tail1', m, ['hips', J.tail1, J.tail2, 0.12]);
    b.add(limb(J.tail2, J.tail3, [[0, 0.2], [1, 0.13]], 8), 'tail2', m);
    b.add(limb(J.tail3, J.tail4, [[0, 0.13], [1, 0.03]], 8), 'tail3', m);
    b.add(limb(J.chest, J.neck, [[0, 0.1], [1, 0.08]], 8), 'neck', m);
    // 頭：長臉、凹陷發光的眼睛、裂到耳邊的嘴；水草頭髮垂到背後與胸前
    b.add(ellipsoid([0, 2.62, 0.12], [0.15, 0.2, 0.16]), 'head', m);
    b.add(ellipsoid([0, 2.48, 0.22], [0.1, 0.02, 0.05]), 'head', 'wolfAlpha');
    b.mirror((S, s) => {
      b.add(ellipsoid([0.06 * s, 2.66, 0.25], [0.03, 0.022, 0.02]), 'head', 'eye');
      for (let i = 0; i < 4; i++) {
        const a = 0.35 + i * 0.4;
        b.add(limb(v3(Math.sin(a) * 0.14 * s, 2.72, 0.1 - Math.cos(a) * 0.12), v3(Math.sin(a) * 0.3 * s, 1.85 - i * 0.12, -0.05 - Math.cos(a) * 0.3), [[0, 0.04], [1, 0.012]], 5), 'head', 'hagHair');
      }
    });
    // 長臂、利爪
    b.mirror((S, s) => {
      const sh = b.bone(`arm${S}`, 'chest', [0.34 * s, 2.15, 0]);
      const el = b.bone(`fore${S}`, `arm${S}`, [0.8 * s, 1.75, 0.2]);
      const hd = b.bone(`hand${S}`, `fore${S}`, [1.0 * s, 1.25, 0.55]);
      b.add(limb(sh, el, [[0, 0.08], [1, 0.06]], 7), `arm${S}`, m, ['chest', sh, el, 0.08]);
      b.add(limb(el, hd, [[0, 0.06], [1, 0.045]], 7), `fore${S}`, m, [`arm${S}`, el, hd, 0.06]);
      b.add(ellipsoid([hd.x, hd.y, hd.z], [0.07, 0.05, 0.09]), `hand${S}`, m);
      for (let i = -1; i <= 1; i++) b.add(cone(v3(hd.x + i * 0.035, hd.y - 0.02, hd.z + 0.06), v3(hd.x + i * 0.05, hd.y - 0.15, hd.z + 0.25), 0.015, 4), `hand${S}`, 'ivory');
    });
    return { eye: 2.6, mark: 2.95, aim: 1.9 };
  },
  init(c) {
    c.sub = 1; // 1 = 完全潛在水下，0 = 浮出水面
    c.subGoal = 1;
    c.ripT = 0;
    c.surfacedFor = 0;
    c.attacks = 0;
    c.maxDepth = Infinity;
  },
  homeOk(x, z, w) {
    return w.terrain.waterDepthAt(x, z) > 3 && w.hf.lakeDistance(x, z) < 0.75;
  },
  validPoint(c, x, z, w) {
    return w.terrain.waterDepthAt(x, z) > 2.2 && w.hf.lakeDistance(x, z) < 0.95;
  },
  // 在水裡（潛著）免疫火；雷永遠 ×2
  damageScale(c, element) {
    if (element === 'fire' && c.sub > 0.3) return c.stats.immuneSubmerged.fire;
    return 1;
  },
  think(c, dt, w, ai) {
    const T = w.terrain;
    const level = T.waterLevel;
    const player = w.combat.player;
    const p = player.pos;
    // 浮上／潛下
    c.sub += clamp(c.subGoal - c.sub, -dt / 1.1, dt / 1.1);
    c.pos.y = level - 1.05 - c.sub * 2.4 + Math.sin(w.time * 1.4 + c.anim.seed) * 0.06 * (1 - c.sub);
    // 漣漪：潛著游動時水面上只看得到這個
    c.ripT -= dt;
    if (c.ripT <= 0 && (c.speed > 0.4 || c.sub < 0.9)) {
      c.ripT = c.sub > 0.5 ? 0.16 : 0.45;
      w.water.impulse(c.pos.x - Math.sin(c.heading) * 0.8, c.pos.z - Math.cos(c.heading) * 0.8, c.sub > 0.5 ? 0.05 : 0.08, c.sub > 0.5 ? 0.7 : 1.2);
    }
    const dPlayer = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
    // 離玩家最近、夠深的水
    const toward = () => {
      const a = Math.atan2(p.x - c.pos.x, p.z - c.pos.z);
      let x = c.pos.x;
      let z = c.pos.z;
      for (let d = 0; d < dPlayer; d += 1) {
        const nx = c.pos.x + Math.sin(a) * d;
        const nz = c.pos.z + Math.cos(a) * d;
        if (!lakeHag.validPoint(c, nx, nz, w)) break;
        x = nx;
        z = nz;
      }
      return { x, z };
    };
    const swim = (x, z, speed) => {
      const px = c.pos.x;
      const pz = c.pos.z;
      ai.steer(c, x, z, speed, dt, { stopAt: 0.5 });
      if (!lakeHag.validPoint(c, c.pos.x, c.pos.z, w)) {
        c.pos.x = px;
        c.pos.z = pz;
        c.speed *= 0.5;
      }
    };
    switch (c.state) {
      case 'idle':
      case 'patrol': {
        c.subGoal = 1;
        if (player.alive && dPlayer < c.stats.hearing) {
          // 玩家在水邊（或在水裡游泳）：潛過去
          const near = toward();
          if (Math.hypot(near.x - p.x, near.z - p.z) < 12) {
            ai.setState(c, 'chase');
            c.mark = 'alert';
            c.markT = 1.2;
            return true;
          }
        }
        if (c.state === 'idle') {
          ai.stop(c, dt);
          if (c.t > c.wait) {
            c.goal = ai.wanderPoint(c);
            ai.setState(c, 'patrol');
          }
        } else {
          swim(c.goal.x, c.goal.z, c.stats.walk);
          if (Math.hypot(c.goal.x - c.pos.x, c.goal.z - c.pos.z) < 1.5 || c.t > 25) {
            ai.setState(c, 'idle');
            c.wait = w.rng.range(3, 8);
          }
        }
        return true;
      }
      case 'chase': {
        const near = toward();
        const gap = Math.hypot(near.x - p.x, near.z - p.z);
        // 玩家離水太遠太久：放棄、潛回湖心
        c.away = gap > 14 || !player.alive ? (c.away ?? 0) + dt : 0;
        if (c.away > 4 || Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z) > c.territory * 2) {
          c.subGoal = 1;
          ai.giveUp(c);
          return true;
        }
        const close = Math.hypot(near.x - c.pos.x, near.z - c.pos.z) < 2;
        // 到了水邊：浮出水面再攻擊；連續攻擊幾次就潛下去換位置
        if (close && dPlayer < 11) {
          c.subGoal = 0;
          ai.stop(c, dt);
          ai.face(c, p.x, p.z, dt, 2);
          if (c.sub < 0.15) {
            c.surfacedFor += dt;
            const pick = ai.pickAttack(c, dPlayer);
            if (pick && c.surfacedFor > 0.4) {
              c.attacks++;
              ai.startAttack(c, pick[0], pick[1]);
            }
            if (c.attacks >= 3 && !c.atk) {
              c.attacks = 0;
              c.subGoal = 1;
              c.surfacedFor = 0;
              c.goal = ai.wanderPoint(c);
              c.repositionT = 3;
            }
          }
        } else {
          if (c.repositionT > 0 && c.goal) {
            c.repositionT -= dt;
            swim(c.goal.x, c.goal.z, c.stats.run);
          } else swim(near.x, near.z, c.stats.run);
          if (dPlayer > 6) c.subGoal = 1;
          c.surfacedFor = 0;
        }
        return true;
      }
      case 'attack':
        ai.updateAttack(c, dt);
        if (!c.atk && c.state === 'attack') ai.setState(c, 'chase');
        return true;
      case 'return':
        c.subGoal = 1;
        c.hp = Math.min(c.maxHp, c.hp + c.maxHp * w.cfg.returnRegen * dt);
        swim(c.home.x, c.home.z, c.stats.run);
        if (Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z) < 3 || c.t > 40) {
          c.hp = c.maxHp;
          ai.setState(c, 'idle');
        }
        return true;
      case 'flee':
        ai.setState(c, 'return');
        return true;
      default:
        return false;
    }
  },
  onHurt(c, dmg, element) {
    // 被重擊就潛下去
    if (dmg > c.maxHp * 0.12 && c.sub < 0.5 && !c.atk) {
      c.attacks = 3;
    }
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    // 尾巴：游動時左右擺動
    const swim = clamp(a.speed / 3, 0.2, 1);
    for (let i = 1; i <= 3; i++) B[`tail${i}`].rotateY(Math.sin(k.time * 3 - i * 0.9 + a.seed) * 0.35 * swim);
    // 潛著時身體往前趴（像魚雷）、浮上來時直起上半身
    B.hips.rotateX(1.3 * c.sub);
    B.chest.rotateY(a.look * 0.5);
    B.head.rotateY(a.look * 0.3);
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      // 待機：雙臂在水面上划動；抓：舉高再往前撲；浪：雙臂張開往下拍
      B[`arm${S}`].rotateZ(s * (0.2 + Math.sin(k.time * 1.6 + s) * 0.1 * (1 - c.sub)));
      if (a.attack === 'wave') {
        B[`arm${S}`].rotateZ(s * (1.3 * a.windup - 0.6 * a.strike));
        B[`arm${S}`].rotateX(-0.4 * a.windup + 1.0 * a.strike);
      } else {
        B[`arm${S}`].rotateX(-1.9 * a.windup + 2.4 * a.strike);
        B[`fore${S}`].rotateX(-0.6 * a.windup);
      }
    }
    B.spine.rotateX(-0.25 * a.windup + 0.5 * a.strike);
    B.spine.rotateX(-a.flinch * 0.2);
  },
  strike(c, A, dmg, w) {
    // 拍水：水花與一圈漣漪
    w.water.impulse(c.pos.x, c.pos.z, 0.18, 2.5);
    w.water.splash(c.pos.x + Math.sin(c.heading) * 1.2, c.pos.z + Math.cos(c.heading) * 1.2, 10, 3);
    return false;
  },
};

// ---------------------------------------------------------------- 沼澤蛙
export const frog = {
  id: 'frog',
  maxDepth: 1,
  define(b) {
    const m = 'frog';
    b.bone('body', null, [0, 0.38, 0]);
    b.bone('head', 'body', [0, 0.48, 0.32]);
    b.bone('jaw', 'head', [0, 0.38, 0.4]);
    // 矮胖的身體、寬頭、頭頂的大眼睛、喉囊、背上的疣
    b.add(ellipsoid([0, 0.4, -0.05], [0.38, 0.27, 0.42]), 'body', m);
    b.add(ellipsoid([0, 0.47, 0.35], [0.33, 0.17, 0.25]), 'head', m);
    b.add(ellipsoid([0, 0.33, 0.42], [0.25, 0.08, 0.17]), 'jaw', m);
    b.add(ellipsoid([0, 0.3, 0.3], [0.2, 0.12, 0.14]), 'jaw', 'acid'); // 喉囊（會鼓起）
    for (const [x, z] of [[0.15, -0.1], [-0.18, 0.05], [0.05, -0.3], [-0.12, -0.25], [0.22, 0.12]]) b.add(ellipsoid([x, 0.66, z], [0.045, 0.035, 0.045]), 'body', 'hagHair');
    b.mirror((S, s) => {
      b.add(ellipsoid([0.17 * s, 0.62, 0.38], [0.08, 0.08, 0.08]), 'head', m);
      b.add(ellipsoid([0.19 * s, 0.65, 0.42], [0.04, 0.045, 0.04]), 'head', 'eye');
      // 後腿：大腿、小腿、長蹼足（摺疊著）；前腿短
      const th = b.bone(`thigh${S}`, 'body', [0.25 * s, 0.32, -0.25]);
      const sh = b.bone(`shin${S}`, `thigh${S}`, [0.45 * s, 0.2, 0.05]);
      const ft = b.bone(`foot${S}`, `shin${S}`, [0.38 * s, 0.05, -0.32]);
      b.add(limb(th, sh, [[0, 0.13], [1, 0.07]], 8), `thigh${S}`, m, ['body', th, sh, 0.08]);
      b.add(limb(sh, ft, [[0, 0.07], [1, 0.05]], 7), `shin${S}`, m);
      b.add(ellipsoid([0.4 * s, 0.03, -0.18], [0.1, 0.025, 0.2]), `foot${S}`, m);
      const ar = b.bone(`arm${S}`, 'body', [0.2 * s, 0.3, 0.25]);
      const hd = b.bone(`hand${S}`, `arm${S}`, [0.26 * s, 0.04, 0.4]);
      b.add(limb(ar, hd, [[0, 0.06], [1, 0.04]], 6), `arm${S}`, m);
      b.add(ellipsoid([0.27 * s, 0.025, 0.45], [0.07, 0.02, 0.07]), `hand${S}`, m);
    });
    return { stride: 1.3, length: 0.6, eye: 0.6, mark: 0.95, aim: 0.4, mouth: ['head', [0, 0.42, 0.6]] };
  },
  homeOk(x, z, w) {
    // 湖岸邊（不在水裡，但離水不遠）
    return w.terrain.waterDepthAt(x, z) < 0.05 && w.hf.lakeDistance(x, z) > 0.95 && w.hf.lakeDistance(x, z) < 1.3 && w.hf.normal(x, z)[1] > 0.8;
  },
  pose(c, k) {
    const B = c.model.bones;
    const a = c.anim;
    const o = c.model.object;
    const moving = a.speed > 0.2;
    // 一跳一跳：後腿蹬直、身體往上拋
    const hop = moving ? Math.abs(Math.sin(a.phase * Math.PI)) : 0;
    o.position.y += hop * 0.35 * clamp(a.speed / 3, 0.4, 1);
    const air = c.airborne ? 1 : hop;
    // 喉囊鼓起
    const croak = Math.max(0, Math.sin(k.time * 1.1 + a.seed)) ** 8;
    B.jaw.scale.setScalar(1 + croak * 0.25);
    for (const S of ['L', 'R']) {
      B[`thigh${S}`].rotateX(-0.9 * air + 0.2 * a.windup);
      B[`shin${S}`].rotateX(0.9 * air - 0.3 * a.windup);
      B[`foot${S}`].rotateX(0.5 * air);
      B[`arm${S}`].rotateX(-0.5 * air);
    }
    // 跳撲的前搖：壓低身體；吐酸：頭往後仰再往前吐
    B.body.position.y -= a.windup * 0.12;
    if (a.attack === 'spit') {
      B.head.rotateX(0.4 * a.windup - 0.5 * a.strike);
      B.jaw.rotateX(0.6 * a.strike);
    } else B.body.rotateX(-0.3 * air);
    B.head.rotateY(a.look * 0.4);
    B.body.rotateX(-a.flinch * 0.2);
  },
};

