// 旅人控制器：把玩家輸入、物理身體、人物動畫與馬連起來。
//   模式：foot（下馬）→ mounting → riding → dismounting → foot
//
// 操作以鏡頭為準：W 是往螢幕前方、A 是往螢幕左邊；身體先轉向那個方向再前進（物理身體的移動模型見 debugProxy.js）。
//   下馬：走路；按住 Shift 跑步；手把／觸控依推的深度連續變速。水中放慢，水深過腰改游泳。
//   騎馬：預設慢步；按住 Shift 快步，按住超過 canterHold 秒變跑步；連點兩下 Shift（並按住）襲步。
//     手把／觸控：推的深度決定慢步、快步、跑步；按下左搖桿（或觸控推到底）襲步。
//     襲步消耗耐力（stamina），用完自動降成跑步，恢復到 staminaRecover 以上才能再襲步。
//     放開移動鍵時馬在約 1.3 秒內自然停下。淺水與上坡變慢，水深超過 horseMaxDepth 就走不進去。
//   空白鍵跳躍：人原地跳；馬依速度跳得更高更遠，跑步以上能跳過柵欄，慢步也能跨過倒木。
//   E 上馬／下馬（從馬的左側，馬停下時才能下馬）；C 吹口哨，馬從遠處跑回身邊。
// 根節點（人物的 object）：下馬時在物理身體的位置（游泳時在水面），騎馬時在鞍座上，上下馬時沿弧線移動。
import * as THREE from 'three';

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const STOP = { dirX: 0, dirZ: 0, speed: 0 };
export const GAIT_NAMES = { walk: '慢步', trot: '快步', canter: '跑步', gallop: '襲步' };

// status（可省略）：{ speedScale }——被蛛網減速、被樹根纏住（0）時由戰鬥模組設定
export function createTraveler(cfg, { character, animator, horse, proxy, physics, terrain, cloak, audio, status = { speedScale: 1 } }) {
  let mode = 'foot';
  let mountT = 0;
  let swimming = false;
  let prevHeading = proxy.heading;
  let turnRate = 0;
  let drop = 0;
  const scale = character.scale;
  const G = cfg.horseGaits;

  // 騎乘的步態控制
  let shiftHeld = 0; // 按住 Shift 的秒數
  let lastTap = -Infinity;
  let gallopLatch = false; // 連點兩下 Shift（或按左搖桿）後的襲步
  let stamina = 1;
  let exhausted = false;
  let wantGait = 'walk';
  let forced = null; // 測試用：固定某個步態
  let clock = 0;
  let lurch = Infinity; // 正面撞上之後經過的秒數（騎士往前晃）

  // 跳躍：progress 0 → 1，apex 最高點（公尺），duration 秒
  const jump = { active: false, t: 0, duration: 0, apex: 0, lift: 0 };

  // 停著的馬：位置、朝向、速度（被叫來時會跑），以及擋住人的碰撞盒（騎乘、被叫來跑動時停用）
  const parked = { x: cfg.horseSpawn[0], z: cfg.horseSpawn[2], heading: cfg.horseHeading, speed: 0, called: false, stuck: 0 };
  const parkedPos = new THREE.Vector3(parked.x, 0, parked.z);
  const capsuleAxis = { x: 0, z: 0 };
  const horseCollider = physics.addDynamic({ obb: true, x: 0, z: 0, ux: 1, uz: 0, halfLength: 0.38, halfWidth: 1.0, y0: -10, y1: 10, mark: 0, noCamera: true });
  function parkCollider() {
    const y = terrain.heightAt(parked.x, parked.z);
    // 盒子的長軸（halfWidth）沿馬身：局部 x 軸是馬的左右
    Object.assign(horseCollider, {
      x: parked.x,
      z: parked.z,
      ux: Math.cos(parked.heading),
      uz: -Math.sin(parked.heading),
      y0: y,
      y1: y + 2,
      disabled: false,
    });
  }
  parkCollider();

  const start = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const ctx = {
    dt: 0,
    time: 0,
    speed: 0,
    turnRate: 0,
    mode,
    gait: horse.gait,
    mountT: 0,
    swimming: false,
    jump: -1,
    lurch: -1,
    stirrupL: new THREE.Vector3(),
    stirrupR: new THREE.Vector3(),
    reinL: new THREE.Vector3(),
    reinR: new THREE.Vector3(),
  };

  function nearHorse() {
    horse.mountPoint(tmp);
    return Math.hypot(tmp.x - proxy.simPosition.x, tmp.z - proxy.simPosition.z) < cfg.mountRange;
  }

  // 輸入 → 世界座標的方向與推的深度（以鏡頭為準）
  const move = { dirX: 0, dirZ: 0, speed: 0, speedScale: 1, maxDepth: Infinity, lift: 0 };
  function aim(input, yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    move.dirX = rx * input.moveX + fx * input.moveY;
    move.dirZ = rz * input.moveX + fz * input.moveY;
    return Math.min(1, Math.hypot(input.moveX, input.moveY));
  }

  // 騎乘時想要的步態
  function chooseGait(input, depth, dt) {
    if (forced) return forced;
    if (input.analog) {
      if (gallopLatch || input.sprint) return 'gallop';
      return depth < G.analog[0] ? 'walk' : depth < G.analog[1] ? 'trot' : 'canter';
    }
    if (!input.sprint) {
      gallopLatch = false;
      shiftHeld = 0;
      return 'walk';
    }
    shiftHeld += dt;
    if (gallopLatch) return 'gallop';
    return shiftHeld < G.canterHold ? 'trot' : 'canter';
  }

  function startJump(apex, duration) {
    Object.assign(jump, { active: true, t: 0, duration, apex, lift: 0 });
  }

  // ---- 叫馬：停著的馬朝玩家跑過來，停在玩家身旁 ----
  function updateCalled(dt) {
    const px = proxy.simPosition.x;
    const pz = proxy.simPosition.z;
    let dx = px - parked.x;
    let dz = pz - parked.z;
    let dist = Math.hypot(dx, dz);
    // 太遠（聽不到口哨的地方）：先移到玩家附近的遠處再跑過來
    if (dist > cfg.call.teleportBeyond) {
      const a = Math.atan2(-dx, -dz);
      parked.x = px + Math.sin(a) * cfg.call.arriveFrom;
      parked.z = pz + Math.cos(a) * cfg.call.arriveFrom;
      parked.heading = Math.atan2(px - parked.x, pz - parked.z);
      dx = px - parked.x;
      dz = pz - parked.z;
      dist = cfg.call.arriveFrom;
    }
    const remaining = dist - cfg.call.stopDistance;
    // 依距離選速度，接近時煞車（v² = 2as）
    const want = remaining > 40 ? G.speeds.gallop : remaining > 15 ? G.speeds.canter : remaining > 5 ? G.speeds.trot : G.speeds.walk;
    const target = remaining <= 0 ? 0 : Math.min(want, Math.sqrt(2 * cfg.call.brake * remaining));
    parked.speed = target > parked.speed ? Math.min(target, parked.speed + cfg.horseTuning.acceleration * dt) : Math.max(target, parked.speed - cfg.call.brake * dt);
    // 轉向（同樣受轉彎半徑限制）
    const T = cfg.horseTuning;
    const diff = wrap(Math.atan2(dx, dz) - parked.heading);
    const maxRate = Math.max(T.pivotRate, parked.speed / (T.turnRadius[0] + T.turnRadius[1] * parked.speed));
    parked.heading = wrap(parked.heading + clamp(diff * T.turnSharpness, -maxRate, maxRate) * dt);
    parkedPos.set(parked.x, 0, parked.z);
    const before = parkedPos.clone();
    capsuleAxis.x = Math.sin(parked.heading) * T.capsule;
    capsuleAxis.z = Math.cos(parked.heading) * T.capsule;
    physics.moveBody(parkedPos, Math.sin(parked.heading) * parked.speed * dt, Math.cos(parked.heading) * parked.speed * dt, T.radius, T.height, cfg.horseMaxDepth, 0, capsuleAxis);
    parked.x = parkedPos.x;
    parked.z = parkedPos.z;
    // 卡住（撞牆、深水）太久就放棄
    const moved = before.distanceTo(parkedPos) / dt;
    parked.stuck = parked.speed > 1 && moved < 0.3 ? parked.stuck + dt : 0;
    if ((remaining <= 0 && parked.speed < 0.05) || parked.stuck > cfg.call.giveUp) {
      parked.called = false;
      parked.speed = 0;
      parkCollider();
    }
  }

  return {
    get mode() {
      return mode;
    },
    // 跳躍時離地的高度（公尺；震波經過時跳起來就躲得過）
    get lift() {
      return jump.active ? jump.lift : 0;
    },
    get swimming() {
      return swimming;
    },
    get canMount() {
      return mode === 'foot' && !swimming && !parked.called && nearHorse();
    },
    get gait() {
      return wantGait;
    },
    get stamina() {
      return stamina;
    },
    get exhausted() {
      return exhausted;
    },
    get horseCalled() {
      return parked.called;
    },
    // 停著（或被叫來）的馬離玩家多遠
    get horseDistance() {
      return mode === 'foot' ? Math.hypot(parked.x - proxy.simPosition.x, parked.z - proxy.simPosition.z) : 0;
    },
    get jumping() {
      return jump.active;
    },

    // E 鍵
    interact() {
      if (mode === 'foot' && !swimming && !parked.called && !jump.active && nearHorse()) {
        mode = 'mounting';
        mountT = 0;
        horseCollider.disabled = true;
      } else if (mode === 'riding' && proxy.speed < cfg.dismountSpeed && !jump.active) {
        mode = 'dismounting';
        mountT = 0;
      }
    },

    // Shift 每按一次（連點兩下 = 襲步）
    sprintTap() {
      if (mode !== 'riding') return;
      if (clock - lastTap < G.doubleTap && !exhausted) gallopLatch = true;
      lastTap = clock;
    },
    // 手把的左搖桿按鍵：切換襲步
    toggleGallop() {
      if (mode === 'riding') gallopLatch = !gallopLatch && !exhausted;
    },

    // 空白鍵
    jump() {
      if (jump.active) return;
      if (mode === 'foot' && !swimming) startJump(cfg.jump.foot.apex, cfg.jump.foot.duration);
      else if (mode === 'riding') {
        // 越快跳得越高越遠（跑步以上能跳過約 1.2 m 的柵欄）
        const k = clamp(proxy.speed / G.speeds.canter, 0, 1);
        startJump(THREE.MathUtils.lerp(cfg.jump.horse.apex[0], cfg.jump.horse.apex[1], k), THREE.MathUtils.lerp(cfg.jump.horse.duration[0], cfg.jump.horse.duration[1], k));
      }
    },

    // C 鍵：吹口哨叫馬
    callHorse() {
      if (mode !== 'foot') return;
      audio?.whistle();
      if (Math.hypot(parked.x - proxy.simPosition.x, parked.z - proxy.simPosition.z) < cfg.call.stopDistance + 0.5) return;
      parked.called = true;
      parked.stuck = 0;
      horseCollider.disabled = true;
    },

    // 測試用：固定步態（null 恢復）
    forceGait(name) {
      forced = name;
    },

    fixedUpdate(dt, input, cameraYaw) {
      clock += dt;
      // 跳躍
      if (jump.active) {
        jump.t += dt / jump.duration;
        if (jump.t >= 1) {
          jump.active = false;
          jump.lift = 0;
        } else jump.lift = 4 * jump.apex * jump.t * (1 - jump.t);
      }
      move.lift = jump.lift;

      if (mode === 'foot') {
        const depth = terrain.waterDepthAt(proxy.simPosition.x, proxy.simPosition.z);
        const waist = cfg.swimDepth * scale;
        swimming = swimming ? depth > waist - cfg.swimHysteresis : depth > waist;
        // 水中放慢（越深越慢），游泳另有速度
        const slow = 1 - cfg.waterSlow * smooth(0.15, waist, depth);
        const T = swimming ? cfg.swimTuning : cfg.footTuning;
        const push = aim(input, cameraYaw);
        // 鍵盤：走或跑；手把、觸控：推的深度連續變速（推到底就是跑）
        move.speed = input.analog ? T.runSpeed * push ** 1.3 : input.sprint ? T.runSpeed : T.walkSpeed;
        move.speedScale = (swimming ? 1 : slow) * status.speedScale;
        move.maxDepth = Infinity;
        proxy.setTuning(T);
        proxy.fixedUpdate(dt, move);
        if (parked.called) updateCalled(dt);
      } else if (mode === 'riding') {
        const push = aim(input, cameraYaw);
        wantGait = chooseGait(input, push, dt);
        // 耐力：襲步時消耗，用完降成跑步；其他時候恢復（停著或慢步恢復得快）
        const galloping = wantGait === 'gallop' && proxy.speed > G.speeds.canter;
        if (wantGait === 'gallop' && exhausted) wantGait = 'canter';
        if (galloping && !exhausted) {
          stamina = Math.max(0, stamina - dt / G.staminaDrain);
          if (stamina === 0) {
            exhausted = true;
            gallopLatch = false;
          }
        } else {
          const rest = proxy.speed < G.speeds.trot ? 2 : 1;
          stamina = Math.min(1, stamina + (rest * dt) / G.staminaRegen);
          if (exhausted && stamina >= G.staminaRecover) exhausted = false;
        }
        // 淺水越深越慢、超過 horseMaxDepth 就走不進去；上坡變慢
        const depth = terrain.waterDepthAt(proxy.simPosition.x, proxy.simPosition.z);
        const wade = 1 - cfg.horseWaterSlow * smooth(0.1, cfg.horseMaxDepth, depth);
        const climb = 1 - cfg.horseUphillSlow * clamp(-horse.slope / 0.46, 0, 1);
        move.speed = G.speeds[wantGait];
        move.speedScale = wade * climb * status.speedScale;
        move.maxDepth = cfg.horseMaxDepth;
        proxy.setTuning(cfg.horseTuning);
        proxy.fixedUpdate(dt, move);
        // 高速正面撞上：馬抬前腳、騎士往前晃
        if (proxy.impact > 0) {
          horse.rear();
          lurch = 0;
        }
      } else {
        proxy.fixedUpdate(dt, { ...STOP, maxDepth: cfg.horseMaxDepth });
        mountT = cfg.freezeMount >= 0 ? cfg.freezeMount : mountT + dt / cfg.mountSeconds;
        if (mountT >= 1) {
          if (mode === 'mounting') {
            // 物理身體移到馬的位置，之後由它帶著馬走
            mode = 'riding';
            wantGait = 'walk';
            proxy.setTuning(cfg.horseTuning);
            proxy.teleport(parked.x, parked.z, parked.heading);
          } else {
            // 下馬完成：馬停在原地，物理身體回到馬的左側
            mode = 'foot';
            parked.x = proxy.simPosition.x;
            parked.z = proxy.simPosition.z;
            parked.heading = proxy.heading;
            parked.speed = 0;
            parkCollider();
            horse.mountPoint(tmp);
            proxy.setTuning(cfg.footTuning);
            proxy.teleport(tmp.x, tmp.z, parked.heading - Math.PI / 2);
          }
          mountT = 0;
        }
      }
      if (mode !== 'riding') {
        gallopLatch = false;
        stamina = Math.min(1, stamina + dt / G.staminaRegen);
        if (exhausted && stamina >= G.staminaRecover) exhausted = false;
      }
      // 披風：騎乘時與馬背、馬頸碰撞
      cloak.extraColliders.length = 0;
      if (mode !== 'foot') cloak.extraColliders.push(...horse.colliders);
    },

    // 每幀：馬、人物的根節點、動畫與 IK
    update(dt, time) {
      const horseJump = mode === 'riding' && jump.active ? jump.t : -1;
      // 馬
      if (mode === 'riding' || mode === 'dismounting') horse.update(dt, proxy.position, proxy.heading, mode === 'riding' ? proxy.speed : 0, horseJump >= 0 ? jump.lift : 0, horseJump);
      else horse.update(dt, tmp.set(parked.x, 0, parked.z), parked.heading, parked.speed, 0, -1);

      // 轉向速率（轉彎時身體傾斜用）
      const h = mode === 'foot' ? proxy.heading : horse.heading;
      let dh = h - prevHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      prevHeading = h;
      turnRate += (dh / Math.max(dt, 1e-4) - turnRate) * (1 - Math.exp(-8 * dt));

      // 根節點
      const root = character.object;
      horse.saddle(seat);
      seat.y -= character.joint.pelvis.y * scale; // 鞍座上的骨盆 → 根節點
      if (mode === 'foot') {
        const p = proxy.position;
        const ground = terrain.heightAt(p.x, p.z);
        const surface = terrain.waterSurfaceAt(p.x, p.z);
        root.position.set(p.x, (swimming ? surface : ground) + jump.lift, p.z);
        root.rotation.y = proxy.heading;
      } else if (mode === 'riding') {
        root.position.copy(seat);
        root.rotation.y = horse.heading;
      } else {
        // 上下馬：從左側的地面沿弧線移到鞍上；先面向馬身，跨腿時轉向前方
        const t = mode === 'mounting' ? mountT : 1 - mountT;
        horse.mountPoint(start);
        start.y = terrain.heightAt(start.x, start.z);
        const k = smooth(0.25, 0.9, t);
        root.position.lerpVectors(start, seat, k);
        root.position.y += 0.25 * Math.sin(Math.PI * k);
        root.rotation.y = horse.heading - (Math.PI / 2) * (1 - smooth(0.5, 0.85, t));
      }

      ctx.dt = dt;
      ctx.time = time;
      ctx.speed = mode === 'riding' ? horse.speed : mode === 'foot' ? proxy.speed : 0;
      ctx.turnRate = turnRate;
      ctx.mode = mode;
      ctx.mountT = mountT;
      ctx.swimming = swimming;
      ctx.jump = jump.active ? jump.t : -1;
      lurch += dt;
      ctx.lurch = mode === 'riding' && lurch < 1.5 ? lurch : -1;
      animator.update(ctx);

      // 骨盆下降：讓踩在較低地面的那隻腳也踩得到（平滑；跳躍時不做）
      root.updateMatrixWorld(true);
      drop += (animator.groundDrop() - drop) * (1 - Math.exp(-12 * dt));
      if (mode === 'foot' && !swimming && !jump.active) root.position.y += drop;

      // IK 目標：馬鐙（腳踝在鐙上方一點）、韁繩
      horse.stirrupL(ctx.stirrupL).y += 0.07 * scale;
      horse.stirrupR(ctx.stirrupR).y += 0.07 * scale;
      const forward = (horse.gait.name === 'gallop' || horseJump >= 0) && mode === 'riding' ? 1 : 0;
      horse.reinL(ctx.reinL).lerp(horse.reinGallopL(tmp), forward);
      horse.reinR(ctx.reinR).lerp(horse.reinGallopR(tmp), forward);
      animator.applyIK(ctx);
    },

    // 韁繩握在哪裡（給 horse.reins）：騎乘與上下馬的後段握在手中；回傳 false = 韁繩掛在馬頸上
    hand(side, out) {
      const holding = mode === 'riding' || (mode !== 'foot' && (mode === 'mounting' ? mountT : 1 - mountT) > 0.85);
      if (!holding) return false;
      character.bones[`hand${side}`].getWorldPosition(out);
      return true;
    },

    // 直接坐上馬（展示模式用，不播上馬動畫）
    seat() {
      if (mode !== 'foot') return;
      mode = 'riding';
      parked.called = false;
      horseCollider.disabled = true;
      proxy.setTuning(cfg.horseTuning);
      proxy.teleport(parked.x, parked.z, parked.heading);
    },
  };
}
