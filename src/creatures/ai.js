// 野怪的 AI：狀態機
//   idle 待機 → patrol 巡邏（地盤內隨機走）→ alert 警覺（頭上出現 !，轉向玩家）→ chase 追擊 → attack 攻擊
//   （前搖：地上出現紅色 ! ! ! 的範圍預告 → 出手 → 收招）→ flee 逃跑 → return 回歸（回家、回血）
//   另有 dormant（樹精假裝是樹、石像白天是石柱）、stunned（暈眩）、dead。
// 追出地盤太遠（territory × (1 + leash)）或太久看不到玩家就放棄：頭上出現 ?，跑回家，路上回血、不理玩家。
// 懼怕：狼不敢靠近火堆（玩家站在火邊時只在外圍打轉），被火燒到會逃開；野兔看到狼或玩家會逃。
// 狼群：狼王在正面，其他狼繞到玩家的兩側與背後包夾，同時最多 maxAttackers 隻出手；狼王死掉，剩下的逃跑。
// 各種野怪的特殊行為（湖妖潛水、飛龍盤旋、蛙跳、蟹縮殼…）在 species/*.js 的 think／strike 等掛勾裡。
import { shapeContains } from './telegraph.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createBrain(cfg, w) {
  const { physics, combat, rng } = w;
  const player = combat.player;

  // ---- 感知：聽得到（很近）或看得到（視野內、沒被房屋擋住）----
  const eye = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: 0 };
  function sense(c) {
    if (!player.alive) return false;
    const S = c.stats;
    const dx = player.pos.x - c.pos.x;
    const dz = player.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < S.hearing * (player.riding ? 1.3 : 1)) return true;
    if (d > S.sight) return false;
    if (Math.abs(wrap(Math.atan2(dx, dz) - c.heading)) > S.fov / 2) return false;
    eye.x = c.pos.x;
    eye.y = c.pos.y + c.eyeHeight;
    eye.z = c.pos.z;
    const ty = player.pos.y + 1.2;
    const l = Math.hypot(dx, ty - eye.y, dz);
    dir.x = dx / l;
    dir.y = (ty - eye.y) / l;
    dir.z = dz / l;
    return physics.raycast(eye, dir, l) >= l - 0.5;
  }

  // ---- 移動 ----
  // 轉向想去的方向，沿朝向前進（方向差越大越慢：先轉身再走）。strafe：不轉身，直接往那裡移（蟹的橫行）
  function steer(c, tx, tz, speed, dt, opts = {}) {
    const dx = tx - c.pos.x;
    const dz = tz - c.pos.z;
    const d = Math.hypot(dx, dz);
    const stopAt = opts.stopAt ?? 0.3;
    let want = d > stopAt ? speed * clamp((d - stopAt) / 1.2 + 0.25, 0, 1) : 0;
    const desired = Math.atan2(dx, dz);
    if (c.sp.strafe && !opts.forward) return strafe(c, dx / (d || 1), dz / (d || 1), want, dt, opts.face ?? c.sp.strafeFace?.(c, desired, w));
    if (d > 1e-3 || opts.face !== undefined) {
      const goal = opts.face ?? desired;
      const diff = wrap(goal - c.heading);
      c.heading = wrap(c.heading + clamp(diff, -c.stats.turn * dt, c.stats.turn * dt));
      if (opts.face === undefined) want *= Math.max(0, Math.cos(diff)) ** 2;
    }
    accelerate(c, want, dt);
    move(c, Math.sin(c.heading) * c.speed * dt, Math.cos(c.heading) * c.speed * dt);
  }
  function strafe(c, ux, uz, want, dt, face) {
    if (face !== undefined) {
      const diff = wrap(face - c.heading);
      c.heading = wrap(c.heading + clamp(diff, -c.stats.turn * dt, c.stats.turn * dt));
    }
    accelerate(c, want, dt);
    c.moveDir = Math.atan2(ux, uz);
    move(c, ux * c.speed * dt, uz * c.speed * dt);
  }
  function accelerate(c, want, dt) {
    if (c.slowT > 0) want *= 1 - c.slow; // 被冰錐減速
    const rate = want > c.speed ? c.stats.run * 2.2 : c.stats.run * 3;
    c.speed = want > c.speed ? Math.min(want, c.speed + rate * dt) : Math.max(want, c.speed - rate * dt);
  }
  function stop(c, dt) {
    accelerate(c, 0, dt);
    if (c.speed > 0) move(c, Math.sin(c.moveDir ?? c.heading) * c.speed * dt, Math.cos(c.moveDir ?? c.heading) * c.speed * dt);
  }
  function face(c, x, z, dt, rate = 1) {
    const diff = wrap(Math.atan2(x - c.pos.x, z - c.pos.z) - c.heading);
    c.heading = wrap(c.heading + clamp(diff, -c.stats.turn * rate * dt, c.stats.turn * rate * dt));
    return Math.abs(diff);
  }
  // 位移；地面野怪走物理（樹、石頭、房屋擋路，深水走不進去），飛行與遊魂直接穿過
  function move(c, dx, dz) {
    const px = c.pos.x;
    const pz = c.pos.z;
    if (c.stats.flying || c.sp.free) {
      c.pos.x += dx;
      c.pos.z += dz;
      c.contact = 0;
    } else {
      const hit = physics.moveBody(c.pos, dx, dz, c.radius, 1, c.maxDepth);
      c.contact = hit.push > 1e-4 ? hit.push : 0;
      c.contactX = hit.nx;
      c.contactZ = hit.nz;
    }
    c.vx = (c.pos.x - px) / Math.max(w.dt, 1e-4);
    c.vz = (c.pos.z - pz) / Math.max(w.dt, 1e-4);
  }

  // 地盤內隨機一點（避開深水）
  function wanderPoint(c) {
    for (let i = 0; i < 8; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * c.territory * 0.7;
      const x = c.home.x + Math.cos(a) * r;
      const z = c.home.z + Math.sin(a) * r;
      if (c.sp.validPoint ? c.sp.validPoint(c, x, z, w) : w.terrain.waterDepthAt(x, z) < c.maxDepth * 0.8) return { x, z };
    }
    return { x: c.home.x, z: c.home.z };
  }

  function setState(c, s) {
    if (c.state === 'attack' && s !== 'attack') endAttack(c);
    c.state = s;
    c.t = 0;
  }

  // 放棄：頭上出現 ?，跑回家
  function giveUp(c) {
    setState(c, 'return');
    c.mark = 'lost';
    c.markT = 1.6;
    if (c.pack) c.pack.attackers.delete(c);
  }

  function alertPack(c) {
    if (!c.pack) return;
    for (const m of c.pack.members) {
      if (m === c || !m.alive || m.state === 'return' || m.state === 'flee' || m.state === 'chase' || m.state === 'attack') continue;
      setState(m, 'alert');
      m.t = -rng.range(0.1, 0.4);
      m.mark = 'alert';
      m.markT = cfg.alertSeconds + 0.4;
    }
  }

  // 被打（ai 以外也會呼叫）：沒發現玩家的直接進入追擊
  function provoked(c) {
    if (c.state === 'dormant' && c.sp.stayDormant?.(c, w)) return; // 白天的石柱打不醒
    if (c.sp.critter) {
      flee(c, player.pos.x, player.pos.z, 4);
      return;
    }
    if (c.state === 'idle' || c.state === 'patrol' || c.state === 'dormant' || c.state === 'alert') {
      if (c.sp.wake) c.sp.wake(c, w);
      setState(c, 'chase');
      c.mark = 'alert';
      c.markT = 0.8;
      alertPack(c);
    }
    c.lastSeen = 0;
  }

  function flee(c, fromX, fromZ, seconds) {
    if (c.state === 'attack') endAttack(c);
    c.state = 'flee';
    c.t = 0;
    c.fleeT = seconds;
    c.threat = { x: fromX, z: fromZ };
    if (c.pack) c.pack.attackers.delete(c);
  }

  // ---- 攻擊 ----
  function rangeOk(range, d) {
    return Array.isArray(range) ? d >= range[0] && d <= range[1] : d <= range;
  }
  function pickAttack(c, d) {
    const list = [];
    for (const [name, def] of Object.entries(c.stats.attacks)) {
      if (c.cooldown[name] > 0 || !rangeOk(def.range, d)) continue;
      if (c.sp.canAttack && !c.sp.canAttack(c, name, def, w)) continue;
      list.push([name, def]);
    }
    return list.length ? list[Math.floor(rng.next() * list.length)] : null;
  }

  function startAttack(c, name, def) {
    setState(c, 'attack');
    const p = player.pos;
    c.heading = Math.atan2(p.x - c.pos.x, p.z - c.pos.z);
    const at = def.at === 'target';
    const A = { name, def, phase: 'windup', t: 0, x: at ? p.x : c.pos.x, z: at ? p.z : c.pos.z, heading: c.heading, tele: null, hit: false, travelled: 0 };
    // 預告：震波的整個範圍；其他就是攻擊的形狀
    const shape = def.shape.type === 'ring' ? { type: 'circle', radius: def.shape.radius } : def.shape;
    A.tele = combat.telegraphs.create(shape, A.x, A.z, A.heading, c.sp.telegraphY?.(c, A, w) ?? null);
    c.atk = A;
    c.sp.beginAttack?.(c, A, w);
  }
  function endAttack(c) {
    if (c.atk?.tele) c.atk.tele.remove();
    c.atk = null;
    if (c.pack) c.pack.attackers.delete(c);
  }

  // 出手的瞬間：判定命中（玩家還在預告的範圍裡就被打中）
  function strike(c) {
    const A = c.atk;
    const D = A.def;
    A.phase = 'strike';
    A.t = 0;
    A.tele.remove();
    c.cooldown[A.name] = D.cooldown * rng.range(0.85, 1.2);
    const dmg = c.damage * (D.damage ?? 1) * (c.rage ? c.stats.rage.damage : 1);
    if (c.sp.strike?.(c, A, dmg, w)) return;
    if (D.projectile) {
      const from = c.mouth(w.tmpFrom);
      const to = w.tmpTo.set(A.x, w.terrain.heightAt(A.x, A.z), A.z);
      combat.launch({
        from: from.clone(),
        to: to.clone(),
        speed: D.projectile.speed,
        arc: D.projectile.arc,
        material: D.hazard === 'acid' ? 'acid' : 'web',
        size: 1.5,
        owner: c,
        trail: D.hazard === 'acid' ? null : 'webLine',
        onLand(x, y, z) {
          if (Math.hypot(player.pos.x - x, player.pos.z - z) < D.shape.radius) combat.damagePlayer(dmg, { source: c, slow: D.slow, slowSeconds: D.slowSeconds });
          if (D.hazard) combat.addHazard(D.hazard, x, z, c);
        },
      });
      return;
    }
    if (D.shape.type === 'ring') {
      combat.shockwave(A.x, A.z, D.shape, dmg, c, D.knock ?? 0);
      return;
    }
    if (D.leap || D.speed || D.breath || D.land) return; // 跳躍、衝撞、冰息、拍翼：在 strike 階段每步判定
    hitCheck(c, A, dmg);
  }
  function hitCheck(c, A, dmg) {
    const D = A.def;
    if (shapeContains(D.shape, A.heading, player.pos.x - A.x, player.pos.z - A.z, player.riding ? 0.5 : 0.25)) {
      if (combat.damagePlayer(dmg, { source: c, knock: D.knock ?? (D.lunge ? 2 : 0), from: c.pos, root: D.root, slow: D.slow, slowSeconds: D.slowSeconds })) A.hit = true;
    }
  }

  function updateAttack(c, dt) {
    const A = c.atk;
    const D = A.def;
    A.t += dt;
    if (A.phase === 'windup') {
      A.tele.progress(A.t / D.windup);
      c.speed = 0;
      // 前搖期間朝向鎖住（預告的方向不會跟著玩家轉，躲得掉）
      if (A.t >= D.windup) strike(c);
      return;
    }
    if (A.phase === 'strike') {
      const dmg = c.damage * (D.damage ?? 1) * (c.rage ? c.stats.rage.damage : 1);
      if (c.sp.strikeStep?.(c, A, dt, dmg, w)) return;
      if (D.speed) {
        // 衝撞：沿預告的方向直線衝，撞到玩家（一次）、撞到樹（暈眩）或衝完全程就停
        const step = D.speed * dt;
        move(c, Math.sin(A.heading) * step, Math.cos(A.heading) * step);
        A.travelled += step;
        c.speed = D.speed;
        if (!A.hit && Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z) < c.radius + 0.9) {
          A.hit = combat.damagePlayer(dmg, { source: c, knock: D.knock, from: c.pos }) || true;
        }
        if (c.contact > step * 0.4 && A.travelled > 1) {
          // 撞到樹：暈眩
          c.speed = 0;
          combat.sparks(c.pos.x + Math.sin(A.heading) * c.radius, c.pos.y + 0.6, c.pos.z + Math.cos(A.heading) * c.radius, 12, 'spark', 5);
          endAttack(c);
          stun(c, c.stats.stunSeconds ?? 2);
          return;
        }
        if (A.travelled >= D.shape.length) {
          A.phase = 'recover';
          A.t = 0;
        }
        return;
      }
      if (D.leap) {
        // 跳到預告的位置：拋物線，落地時判定
        if (!A.leap) {
          // 落在預告中心的前面一點（不會疊在玩家身上），範圍判定仍以預告為準
          const lx = A.x - c.pos.x;
          const lz = A.z - c.pos.z;
          const l = Math.hypot(lx, lz) || 1;
          const back = Math.min(l, c.radius + 0.5);
          A.leap = { fx: c.pos.x, fz: c.pos.z, tx: A.x - (lx / l) * back, tz: A.z - (lz / l) * back, d: 0.6 };
        }
        const k = Math.min(1, A.t / A.leap.d);
        c.pos.x = A.leap.fx + (A.leap.tx - A.leap.fx) * k;
        c.pos.z = A.leap.fz + (A.leap.tz - A.leap.fz) * k;
        c.pos.y = w.terrain.heightAt(c.pos.x, c.pos.z) + 4 * 1.6 * k * (1 - k);
        c.airborne = k < 1;
        if (k >= 1) {
          c.airborne = false;
          physics.moveBody(c.pos, 0, 0, c.radius, 1, c.maxDepth);
          hitCheck(c, A, dmg);
          combat.sparks(c.pos.x, c.pos.y + 0.1, c.pos.z, 6, 'spark', 2.5);
          A.phase = 'recover';
          A.t = 0;
        }
        return;
      }
      if (D.lunge) {
        const k = Math.min(1, A.t / 0.2);
        const step = (D.lunge * dt) / 0.2;
        if (k < 1 && Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z) > c.radius + 0.5) move(c, Math.sin(A.heading) * step, Math.cos(A.heading) * step);
      }
      if (A.t > 0.22) {
        A.phase = 'recover';
        A.t = 0;
      }
      return;
    }
    // 收招
    stop(c, dt);
    if (A.t >= D.recover) {
      endAttack(c);
      setState(c, 'chase');
    }
  }

  function stun(c, seconds) {
    setState(c, 'stunned');
    c.stunT = seconds;
    c.mark = 'stun';
    c.markT = seconds;
  }

  // ---- 狼群的包夾位置：狼王在玩家正面，其他狼繞到兩側與背後 ----
  function flankPoint(c) {
    const pack = c.pack;
    const ref = pack.alpha?.alive ? pack.alpha : c;
    const base = Math.atan2(ref.pos.x - player.pos.x, ref.pos.z - player.pos.z);
    const a = base + c.flank;
    const r = c.isAlpha ? 2.6 : 3.6;
    return { x: player.pos.x + Math.sin(a) * r, z: player.pos.z + Math.cos(a) * r };
  }

  // ---- 每個固定步長 ----
  function think(c, dt) {
    const S = c.stats;
    c.t += dt;
    for (const k in c.cooldown) c.cooldown[k] = Math.max(0, c.cooldown[k] - dt);
    if (c.markT > 0 && (c.markT -= dt) <= 0) c.mark = null;
    c.vx = c.vz = 0;

    if (c.state === 'stunned') {
      stop(c, dt);
      if ((c.stunT -= dt) <= 0) {
        c.mark = null;
        setState(c, 'chase');
      }
      return;
    }
    if (c.sp.think?.(c, dt, w, api)) return;

    // 感知（每 0.2 秒一次）
    if ((c.senseT -= dt) <= 0) {
      c.senseT = 0.18 + rng.next() * 0.08;
      c.sees = sense(c);
    }
    if (c.sees) {
      c.lastSeen = 0;
    } else c.lastSeen += dt;
    const dxp = player.pos.x - c.pos.x;
    const dzp = player.pos.z - c.pos.z;
    const dPlayer = Math.hypot(dxp, dzp);
    const dHome = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);

    // 小動物：看到狼或玩家就逃
    if (c.sp.critter) {
      if (c.state !== 'flee') {
        const wolf = w.nearestOf('wolf', c.pos.x, c.pos.z, S.fearsWolves);
        if (wolf) flee(c, wolf.pos.x, wolf.pos.z, rng.range(3, 5));
        else if (player.alive && dPlayer < S.fearsPlayer * (player.riding ? 1.6 : 1)) flee(c, player.pos.x, player.pos.z, rng.range(2, 4));
      }
    } else if (S.fearsFire && c.state !== 'flee' && c.state !== 'return') {
      // 狼：太靠近火就逃開
      const f = combat.nearestFire(c.pos.x, c.pos.z, cfg.fearFireRadius * 0.55);
      if (f) flee(c, f.fire.x, f.fire.z, rng.range(1.2, 2));
    }

    switch (c.state) {
      case 'dormant':
        c.speed = 0;
        if (c.sp.dormantThink) c.sp.dormantThink(c, dt, w, api);
        break;
      case 'idle':
        stop(c, dt);
        if (c.sees && !c.sp.critter) {
          setState(c, 'alert');
          c.mark = 'alert';
          c.markT = cfg.alertSeconds + 0.4;
          alertPack(c);
        } else if (c.t > c.wait) {
          c.goal = wanderPoint(c);
          setState(c, 'patrol');
        }
        break;
      case 'patrol':
        if (c.sees && !c.sp.critter) {
          setState(c, 'alert');
          c.mark = 'alert';
          c.markT = cfg.alertSeconds + 0.4;
          alertPack(c);
          break;
        }
        // 狼群一起走：其他狼跟著狼王
        if (c.pack?.alpha && c.pack.alpha !== c && c.pack.alpha.alive && c.pack.alpha.state === 'patrol') {
          const a = c.pack.alpha;
          const off = c.flank;
          c.goal = { x: a.pos.x + Math.sin(a.heading + Math.PI + off * 0.4) * 2.5, z: a.pos.z + Math.cos(a.heading + Math.PI + off * 0.4) * 2.5 };
          steer(c, c.goal.x, c.goal.z, Math.min(S.walk * 1.3, Math.hypot(c.goal.x - c.pos.x, c.goal.z - c.pos.z) > 4 ? S.run * 0.5 : S.walk * 1.1), dt, { stopAt: 0.8 });
          if (c.t > 25) setState(c, 'idle');
          break;
        }
        steer(c, c.goal.x, c.goal.z, S.walk, dt, { stopAt: 0.6 });
        if (Math.hypot(c.goal.x - c.pos.x, c.goal.z - c.pos.z) < 0.9 || c.t > 20) {
          setState(c, 'idle');
          c.wait = rng.range(2, 7);
        }
        break;
      case 'alert':
        stop(c, dt);
        face(c, player.pos.x, player.pos.z, dt, 1.5);
        if (c.t > cfg.alertSeconds) setState(c, 'chase');
        break;
      case 'chase': {
        if (!player.alive || c.lastSeen > cfg.loseSightSeconds || dHome > c.territory * (1 + cfg.leash)) {
          giveUp(c);
          break;
        }
        // 狼王死了：狼群潰散
        if (c.pack?.broken) {
          flee(c, player.pos.x, player.pos.z, 10);
          break;
        }
        // 怕火：玩家在火邊時只在外圍打轉，不靠近
        if (S.fearsFire) {
          const f = combat.nearestFire(player.pos.x, player.pos.z, cfg.fearFireRadius);
          if (f) {
            const fire = f.fire;
            const a = Math.atan2(c.pos.x - fire.x, c.pos.z - fire.z) + dt * 0.4 * (c.flank >= 0 ? 1 : -1);
            const r = cfg.fearFireRadius + fire.radius + 2.5;
            steer(c, fire.x + Math.sin(a) * r, fire.z + Math.cos(a) * r, S.walk * 1.4, dt, { stopAt: 0.3 });
            c.hesitate = true;
            break;
          }
          c.hesitate = false;
        }
        const pick = pickAttack(c, dPlayer);
        const canSwing = !c.pack || c.pack.attackers.size < cfg.maxAttackers || c.pack.attackers.has(c);
        if (pick && canSwing) {
          if (c.pack) c.pack.attackers.add(c);
          startAttack(c, pick[0], pick[1]);
          break;
        }
        // 目標位置：狼群繞到包夾的位置（輪到出手時才直接撲向玩家）；遠程的保持距離
        let tx = player.pos.x;
        let tz = player.pos.z;
        let stopAt = c.stopAt;
        if (c.pack && c.pack.members.length > 1 && !(c.pack.attackers.size < cfg.maxAttackers && dPlayer < 6)) {
          const f = flankPoint(c);
          tx = f.x;
          tz = f.z;
          stopAt = 0.4;
        }
        if (c.sp.chaseTarget) {
          const t = c.sp.chaseTarget(c, w);
          if (t) {
            tx = t.x;
            tz = t.z;
            stopAt = t.stopAt ?? stopAt;
          }
        }
        const fast = c.rage ? S.run * S.rage.speed : S.run;
        steer(c, tx, tz, dPlayer > 4 ? fast : Math.max(S.walk * 1.5, fast * 0.6), dt, { stopAt, face: dPlayer < c.stopAt + 1 ? Math.atan2(dxp, dzp) : undefined });
        break;
      }
      case 'attack':
        updateAttack(c, dt);
        break;
      case 'flee': {
        const t = c.threat;
        const a = Math.atan2(c.pos.x - t.x, c.pos.z - t.z);
        steer(c, c.pos.x + Math.sin(a) * 8, c.pos.z + Math.cos(a) * 8, S.run, dt, { stopAt: 0 });
        if (c.t > c.fleeT) {
          if (c.sp.critter) setState(c, 'idle');
          else if (c.pack?.broken) setState(c, 'return');
          else setState(c, Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z) < S.sight && player.alive && c.hp > c.maxHp * 0.25 ? 'chase' : 'return');
          c.wait = rng.range(1, 3);
        }
        break;
      }
      case 'return':
        // 回家回血，路上不理玩家
        c.hp = Math.min(c.maxHp, c.hp + c.maxHp * cfg.returnRegen * dt);
        steer(c, c.home.x, c.home.z, S.run * 0.75, dt, { stopAt: 0.8 });
        if (dHome < 2 || c.t > 40) {
          c.hp = c.maxHp;
          c.lastSeen = 99;
          c.sees = false;
          c.wait = rng.range(2, 5);
          if (c.pack?.broken && c.pack.members.every((m) => !m.alive || m.state === 'idle' || m.state === 'return')) c.pack.broken = false;
          setState(c, c.sp.restState?.(c, w) ?? 'idle');
        }
        break;
      default:
        break;
    }
  }

  const api = { setState, steer, strafe, stop, face, move, startAttack, endAttack, pickAttack, giveUp, flee, stun, provoked, alertPack, sense, hitCheck, wanderPoint, updateAttack };
  return { think, ...api };
}
