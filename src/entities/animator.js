// 人物的程序式動畫：狀態機 + 狀態之間的混合過渡 + IK。
//
// 狀態：
//   idle      待機：呼吸、重心左右微移、偶爾轉頭看風景
//   walk      走路：骨盆左右旋轉與起伏、手臂與對側腳同步擺動、頭部抵銷軀幹的旋轉保持穩定、轉彎時身體傾斜
//   run       跑步：同上，幅度更大，上身前傾、手肘彎曲、有騰空的起伏
//   swim      游泳（水深過腰）：身體俯臥、蛙式划手、踢腿，頭抬起看前方
//   ride      騎乘：騎坐姿、雙手握韁繩、腳踩馬鐙；上身跟著馬的步態——快步起坐、跑步隨之搖擺、襲步前傾貼近馬頸
//   mount / dismount  上馬／下馬（約 1.2 秒，從馬的左側）：左腳踩鐙、撐起、右腳跨過馬背、坐進鞍；下馬為倒放
// 切換狀態時，從當下的姿勢在 cfg.blend 秒內以 slerp 混合到新狀態；IK 權重與骨盆位移也一起混合。
// IK（entities/ik.js）：腳貼合地形（上下坡時腳掌順著坡面、骨盆下降讓低的那隻腳踩得到）、騎乘時腳踩馬鐙、手握韁繩。
//
// 骨頭的旋轉方向（靜止姿勢下骨頭都沒有旋轉；人物面向 +z、左側 +x）：
//   四肢往前擺 = 繞 x 軸負轉；膝蓋往後彎 = 繞 x 正轉；軀幹前傾 = 繞 x 正轉
//   左臂往外張 = 繞 z 正轉（右臂相反）；骨盆往左轉 = 繞 y 正轉
import * as THREE from 'three';
import { solveTwoBone, rotateBoneToward } from './ik.js';

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;
const UP = new THREE.Vector3(0, 1, 0);

export function createAnimator(cfg, character, terrain) {
  const B = character.bones;
  const names = Object.keys(B);
  const s = character.scale;
  const newPose = () => ({
    q: new Map(names.map((n) => [n, new THREE.Quaternion()])),
    rootX: 0,
    rootY: 0,
    ik: { groundL: 1, groundR: 1, stirrupL: 0, stirrupR: 0, rein: 0 },
  });
  const out = newPose();
  const from = newPose();
  const target = newPose();
  const e = new THREE.Euler();
  const set = (name, x, y = 0, z = 0) => target.q.get(name).setFromEuler(e.set(x, y, z, 'YXZ'));
  const restPelvis = B.pelvis.position.clone();

  let state = 'idle';
  let blend = 1;
  let phase = 0; // 走路／跑步的步態相位（弧度）
  let swimPhase = 0;
  let look = 0; // 待機時頭部的轉向
  let lookGoal = 0;
  let nextLook = 3;
  let seed = 7;
  const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

  function setState(next) {
    if (next === state) return;
    // 從當下輸出的姿勢開始混合
    for (const n of names) from.q.get(n).copy(out.q.get(n));
    from.rootX = out.rootX;
    from.rootY = out.rootY;
    Object.assign(from.ik, out.ik);
    state = next;
    blend = 0;
  }

  function reset() {
    for (const n of names) target.q.get(n).identity();
    target.rootX = 0;
    target.rootY = 0;
    Object.assign(target.ik, { groundL: 1, groundR: 1, stirrupL: 0, stirrupR: 0, rein: 0 });
  }

  // ---- 各狀態的姿勢 ----

  function idle(ctx) {
    const t = ctx.time;
    const breathe = Math.sin(t * 1.6);
    const shift = Math.sin(t * 0.33); // 重心左右移
    target.rootX = 0.02 * shift;
    target.rootY = -0.005 + 0.003 * breathe;
    set('pelvis', 0, 0, -0.03 * shift);
    set('spine1', 0.01, 0, 0.02 * shift);
    set('spine2', 0.015 * breathe);
    set('spine3', -0.02 * breathe);
    // 偶爾轉頭看風景
    nextLook -= ctx.dt;
    if (nextLook <= 0) {
      lookGoal = random() < 0.35 ? 0 : (random() - 0.5) * 1.4;
      nextLook = 3 + random() * 5;
    }
    look += (lookGoal - look) * (1 - Math.exp(-2 * ctx.dt));
    set('neck', 0, look * 0.35);
    set('head', 0.04 * Math.sin(t * 0.23), look * 0.65);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ]) {
      set(`upperArm${side}`, 0.03 * Math.sin(t * 0.9 + sign), 0, sign * 0.06);
      set(`forearm${side}`, -0.15 - 0.03 * breathe);
      set(`clavicle${side}`, 0, 0, sign * 0.01 * breathe);
    }
  }

  // 走路與跑步共用：run = 0（走）→ 1（跑）
  function locomotion(ctx, run) {
    const k = THREE.MathUtils.clamp(ctx.speed / (run ? 4 : 1.4), 0.3, 1.2);
    const sp = Math.sin(phase);
    const cp = Math.cos(phase);
    const thighAmp = lerp(0.42, 0.78, run) * k;
    const kneeAmp = lerp(0.75, 1.45, run) * k;
    const lean = THREE.MathUtils.clamp(-ctx.turnRate * ctx.speed * cfg.turnLean, -0.3, 0.3); // 轉彎時往內傾
    for (const [side, sign, off] of [
      ['L', 1, 0],
      ['R', -1, Math.PI],
    ]) {
      const ls = Math.sin(phase + off);
      const lc = Math.cos(phase + off);
      // 腿：往前擺時（lc > 0）膝蓋彎曲、腳尖上提；後蹬時腳掌下推
      set(`thigh${side}`, -thighAmp * ls - 0.05 * run, 0, sign * 0.02);
      set(`shin${side}`, 0.08 + kneeAmp * Math.max(0, lc) ** 1.3 + 0.15 * run);
      set(`foot${side}`, -0.25 * Math.max(0, lc) * k + 0.25 * Math.max(0, -ls) * k * (1 - lc * 0.5));
      // 手臂：與對側腳同步（左臂跟右腳一起往前）
      set(`upperArm${side}`, sign * lerp(0.32, 0.6, run) * k * sp, 0, sign * lerp(0.07, 0.12, run));
      set(`forearm${side}`, -lerp(0.25, 1.35, run) - 0.2 * Math.max(0, -sign * sp) * k);
    }
    // 骨盆：隨跨步左右旋轉、支撐腳那側略高、垂直起伏（雙腳交錯時最低）
    const pelvisYaw = -lerp(0.12, 0.08, run) * sp * k;
    set('pelvis', lerp(0.02, 0.1, run), pelvisYaw, 0.04 * Math.sin(phase * 2) * k + lean);
    target.rootY = -lerp(0.015, 0.05, run) + lerp(0.022, 0.05, run) * Math.cos(phase * 2) * k;
    // 軀幹：肩膀反向旋轉、跑步時前傾
    const chestYaw = lerp(0.18, 0.14, run) * sp * k;
    set('spine1', lerp(0.02, 0.18, run), -pelvisYaw * 0.4, -lean * 0.3);
    set('spine2', lerp(0.01, 0.06, run), chestYaw * 0.4);
    set('spine3', 0.01, chestYaw * 0.6, -lean * 0.3);
    // 頭：抵銷骨盆與軀幹的旋轉、前傾與起伏，保持看向前方
    set('neck', -lerp(0.02, 0.15, run), -(pelvisYaw + chestYaw) * 0.5);
    set('head', -lerp(0.02, 0.12, run) - 0.02 * Math.cos(phase * 2) * k, -(pelvisYaw + chestYaw) * 0.5, -lean * 0.5);
  }

  function swim(ctx) {
    const t = swimPhase;
    const stroke = (t / (Math.PI * 2)) % 1; // 0：手往前伸 → 0.5：往外往後划 → 1：收回
    const reach = Math.cos(t);
    set('pelvis', 1.35, 0, 0); // 俯臥
    set('spine1', -0.05);
    set('spine2', -0.08);
    set('spine3', -0.1);
    set('neck', -0.45);
    set('head', -0.55); // 抬頭看前方
    target.rootY = cfg.swimFloat; // 骨盆在水面下
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ]) {
      // 蛙式：手臂由頭前方往外、往後划，再收回往前伸
      const sweep = Math.sin(stroke * Math.PI);
      set(`upperArm${side}`, -2.6 + 1.1 * sweep, 0, sign * (0.25 + 0.9 * sweep));
      set(`forearm${side}`, -0.2 - 1.1 * Math.max(0, -reach));
      set(`thigh${side}`, 0.2 * Math.sin(t * 2 + (sign > 0 ? 0 : Math.PI)), 0, sign * 0.12);
      set(`shin${side}`, 0.35 + 0.3 * Math.sin(t * 2 + 1 + (sign > 0 ? 0 : Math.PI)));
      set(`foot${side}`, 0.6);
    }
    Object.assign(target.ik, { groundL: 0, groundR: 0 });
  }

  // 騎坐姿（不含 IK）：大腿往前、往外張開跨坐，小腿下垂
  function seat(rise = 0) {
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ]) {
      set(`thigh${side}`, -1.2 + rise * 1.6, 0, sign * 0.5);
      set(`shin${side}`, 1.35 - rise * 1.2);
      set(`foot${side}`, -0.1);
      set(`upperArm${side}`, -0.55, 0, sign * 0.08);
      set(`forearm${side}`, -0.9);
    }
  }

  function ride(ctx) {
    const g = ctx.gait;
    const w = g.phase * Math.PI * 2;
    const moving = Math.min(1, ctx.speed / 0.5);
    let rise = 0;
    let lean = 0.05;
    let headUp = 0;
    if (g.name === 'trot') {
      // 起坐：快步一個週期兩拍，騎手在其中一拍站起、另一拍坐下
      rise = cfg.posting * Math.max(0, Math.sin(w)) ** 0.8 * moving;
      lean = 0.18;
    } else if (g.name === 'canter') {
      lean = 0.12 + 0.06 * Math.cos(w);
    } else if (g.name === 'gallop') {
      // 襲步：離開鞍座（兩點式），上身前傾貼近馬頸，抬頭看前方
      rise = cfg.gallopRise;
      lean = 0.55;
      headUp = 0.55;
    }
    if (ctx.lurch >= 0) {
      // 馬正面撞上、抬前腳：騎士往前一晃，再慢慢坐回來
      const l = ctx.lurch / 0.15;
      lean += 0.8 * l * Math.exp(1 - l);
    }
    if (ctx.jump >= 0) {
      // 跳躍：跟襲步一樣離鞍前傾，讓馬背在底下起伏
      const b = Math.sin(Math.PI * ctx.jump);
      rise = Math.max(rise, cfg.gallopRise * 1.3 * b);
      lean = Math.max(lean, 0.6 * b);
      headUp = Math.max(headUp, 0.4 * b);
    }
    seat(rise / 0.12 * 0.15);
    target.rootY = rise;
    // 上身吸收馬的前後擺動（跑步時腰部隨之搖擺）
    set('pelvis', -g.pitch * 1.2, 0, 0.02 * Math.sin(w) * moving);
    set('spine1', lean * 0.5 + g.pitch * 0.8);
    set('spine2', lean * 0.3);
    set('spine3', lean * 0.2);
    set('neck', -headUp * 0.5);
    set('head', -headUp * 0.5 - g.pitch * 0.5);
    Object.assign(target.ik, { groundL: 0, groundR: 0, stirrupL: 1, stirrupR: 1, rein: 1 });
  }

  // 上馬：t 從 0 到 1（下馬為倒放）
  function mount(ctx, t) {
    const s1 = smooth(0, 0.25, t); // 左腳踩鐙、雙手扶鞍
    const s2 = smooth(0.25, 0.55, t); // 撐起身體、右腳往後
    const s3 = smooth(0.55, 0.85, t); // 右腳跨過馬背
    const s4 = smooth(0.85, 1, t); // 坐進鞍
    set('thighL', lerp(-1.1 * s1, -1.2, s3) + 0.7 * s2 * (1 - s3), 0, lerp(0, 0.5, s3));
    set('shinL', lerp(1.4 * s1, 1.35, s3) - 0.9 * s2 * (1 - s3));
    set('footL', -0.1 * s1);
    const over = Math.sin(Math.PI * s3); // 跨腿的弧線：先往外抬高、再落下
    set('thighR', 0.55 * s2 * (1 - s3) + lerp(0, -1.2, s3) - 0.3 * over, 0, -0.5 * s3 - 1.0 * over);
    set('shinR', 0.15 * s2 + lerp(0, 1.35, s4) + 0.4 * over);
    set('footR', 0.2 * s2 * (1 - s4));
    set('spine1', 0.45 * s2 * (1 - s4) + 0.05 * s4);
    set('spine2', 0.15 * s2 * (1 - s4));
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ]) {
      set(`upperArm${side}`, lerp(-1.4 * s1, -0.55, s4), 0, sign * 0.1);
      set(`forearm${side}`, lerp(-0.6 * s1, -0.9, s4));
    }
    set('head', -0.1 * s2 * (1 - s4));
    target.ik.groundL = 1 - smooth(0.1, 0.2, t);
    target.ik.groundR = 1 - smooth(0.45, 0.6, t);
    target.ik.stirrupL = smooth(0.15, 0.3, t);
    target.ik.stirrupR = smooth(0.8, 0.95, t);
    target.ik.rein = smooth(0.85, 1, t);
  }

  const POSES = {
    idle,
    walk: (ctx) => locomotion(ctx, 0),
    run: (ctx) => locomotion(ctx, 1),
    swim,
    ride,
    mount: (ctx) => mount(ctx, ctx.mountT),
    dismount: (ctx) => mount(ctx, 1 - ctx.mountT),
  };

  // ---- IK ----
  const _ankle = new THREE.Vector3();
  const _goal = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function footToGround(side, weight, rootGround) {
    if (weight <= 0) return;
    const foot = B[`foot${side}`];
    foot.getWorldPosition(_ankle);
    const ground = terrain.heightAt(_ankle.x, _ankle.z);
    const lift = _ankle.y - rootGround; // 動畫中腳踝離（平坦）地面的高度
    _goal.copy(_ankle);
    _goal.y = ground + Math.max(lift, cfg.ankleHeight * s);
    solveTwoBone(B[`thigh${side}`], B[`shin${side}`], foot, _goal, weight);
    // 支撐腳：腳掌順著坡面
    const stance = 1 - smooth(cfg.ankleHeight * s + 0.02, cfg.ankleHeight * s + 0.08, lift);
    if (stance > 0) {
      const [nx, ny, nz] = terrain.normalAt(_ankle.x, _ankle.z);
      _n.set(nx, ny, nz);
      foot.getWorldQuaternion(_q);
      _up.copy(UP).applyQuaternion(_q);
      rotateBoneToward(foot, _up, _n, weight * stance);
    }
  }

  // ctx：{ dt, time, speed, turnRate, mode, gait, mountT, waterDepth, stirrupL(out), stirrupR(out), reinL(out), reinR(out) }
  function update(ctx) {
    // 狀態選擇
    let next = state;
    if (ctx.mode === 'mounting') next = 'mount';
    else if (ctx.mode === 'dismounting') next = 'dismount';
    else if (ctx.mode === 'riding') next = 'ride';
    else if (ctx.swimming) next = 'swim';
    else if (ctx.speed < cfg.walkSpeed) next = 'idle';
    else if (ctx.speed < cfg.runSpeed) next = state === 'run' && ctx.speed > cfg.runSpeed - 0.4 ? 'run' : 'walk';
    else next = 'run';
    setState(next);

    // 步態相位：依移動的距離推進（一個週期兩步）
    const stride = state === 'run' ? cfg.runStride : cfg.walkStride;
    phase = (phase + ((Math.PI * 2 * ctx.speed) / stride) * ctx.dt) % (Math.PI * 2);
    swimPhase += ctx.dt * cfg.swimRate * Math.PI * 2;

    reset();
    POSES[state](ctx);

    // 混合
    blend = Math.min(1, blend + ctx.dt / cfg.blend);
    const w = blend * blend * (3 - 2 * blend);
    for (const n of names) out.q.get(n).slerpQuaternions(from.q.get(n), target.q.get(n), w);
    out.rootX = lerp(from.rootX, target.rootX, w);
    out.rootY = lerp(from.rootY, target.rootY, w);
    for (const k of Object.keys(out.ik)) out.ik[k] = lerp(from.ik[k], target.ik[k], w);

    for (const n of names) B[n].quaternion.copy(out.q.get(n));
    // 跳躍（下馬時）：空中收腿、手往上張；離地時腳不貼地
    if (ctx.mode === 'foot' && ctx.jump >= 0 && !ctx.swimming) {
      const b = Math.sin(Math.PI * ctx.jump);
      for (const [side, sign] of [
        ['L', 1],
        ['R', -1],
      ]) {
        B[`thigh${side}`].quaternion.multiply(_q.setFromEuler(e.set(-0.7 * b, 0, 0)));
        B[`shin${side}`].quaternion.multiply(_q.setFromEuler(e.set(1.2 * b, 0, 0)));
        B[`upperArm${side}`].quaternion.multiply(_q.setFromEuler(e.set(-0.5 * b, 0, sign * 0.35 * b)));
      }
      const ground = 1 - smooth(0, 0.1, ctx.jump) * (1 - smooth(0.9, 1, ctx.jump));
      out.ik.groundL = Math.min(out.ik.groundL, ground);
      out.ik.groundR = Math.min(out.ik.groundR, ground);
    }
    B.pelvis.position.set(restPelvis.x + out.rootX, restPelvis.y + out.rootY, restPelvis.z);
  }

  // 在人物的根節點放好之後呼叫：pelvisDrop 由主程式依兩腳的地面高度決定
  function applyIK(ctx) {
    character.object.updateMatrixWorld(true);
    const rootGround = character.object.position.y;
    footToGround('L', out.ik.groundL, rootGround);
    footToGround('R', out.ik.groundR, rootGround);
    if (out.ik.stirrupL > 0) solveTwoBone(B.thighL, B.shinL, B.footL, ctx.stirrupL, out.ik.stirrupL);
    if (out.ik.stirrupR > 0) solveTwoBone(B.thighR, B.shinR, B.footR, ctx.stirrupR, out.ik.stirrupR);
    if (out.ik.rein > 0) {
      solveTwoBone(B.upperArmL, B.forearmL, B.handL, ctx.reinL, out.ik.rein);
      solveTwoBone(B.upperArmR, B.forearmR, B.handR, ctx.reinR, out.ik.rein);
    }
    measure(ctx);
  }

  // 開發者面板用（公分）：IK 完全生效時——
  //   footL/R：每 1.5 秒內腳踝最低時離地多高（扣掉腳踝高度；0 = 每一步都踩實，負值 = 陷入地面）
  //   stirrup、rein：腳離馬鐙、手離韁繩的距離
  const error = { footL: 0, footR: 0, stirrup: 0, rein: 0 };
  const lowest = { L: Infinity, R: Infinity };
  let window = 0;
  function measure(ctx) {
    character.object.updateMatrixWorld(true);
    window += ctx.dt;
    const flush = window > 1.5;
    if (flush) window = 0;
    for (const side of ['L', 'R']) {
      B[`foot${side}`].getWorldPosition(_ankle);
      if (out.ik[`ground${side}`] > 0.99) lowest[side] = Math.min(lowest[side], (_ankle.y - terrain.heightAt(_ankle.x, _ankle.z) - cfg.ankleHeight * s) * 100);
      else lowest[side] = NaN;
      if (flush || !Number.isFinite(error[`foot${side}`])) error[`foot${side}`] = lowest[side];
      if (flush) lowest[side] = Infinity;
    }
    const dist = (bone, p) => bone.getWorldPosition(_ankle).distanceTo(p) * 100;
    const stirrupL = out.ik.stirrupL > 0.99 ? dist(B.footL, ctx.stirrupL) : NaN;
    const stirrupR = out.ik.stirrupR > 0.99 ? dist(B.footR, ctx.stirrupR) : NaN;
    error.stirrup = Number.isNaN(stirrupL) ? stirrupR : Number.isNaN(stirrupR) ? stirrupL : Math.max(stirrupL, stirrupR);
    error.rein = out.ik.rein > 0.99 ? Math.max(dist(B.handL, ctx.reinL), dist(B.handR, ctx.reinR)) : NaN;
  }

  // 兩腳地面相對於根節點的最低高度差（負值：骨盆要下降這麼多，低的那隻腳才踩得到）
  function groundDrop() {
    if (out.ik.groundL + out.ik.groundR <= 0) return 0;
    character.object.updateMatrixWorld(true);
    const y0 = character.object.position.y;
    let drop = 0;
    for (const side of ['L', 'R']) {
      B[`foot${side}`].getWorldPosition(_ankle);
      drop = Math.min(drop, terrain.heightAt(_ankle.x, _ankle.z) - y0);
    }
    return drop * Math.max(out.ik.groundL, out.ik.groundR);
  }

  return {
    update,
    applyIK,
    groundDrop,
    get state() {
      return state;
    },
    get blend() {
      return blend;
    },
    error,
  };
}
