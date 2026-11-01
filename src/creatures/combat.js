// 戰鬥：玩家的血量與狀態（減速、被纏住、擊退、倒下）、玩家的劍（法術在 spells.js）、
// 野怪的投射物（蛛網、酸液）、地上的危險區（蛛網、毒池）、震波、火（火堆、火球燒過的地面），以及這些的細線特效。
// 攻擊範圍預告見 telegraph.js；野怪本身見 creatures.js。
import * as THREE from 'three';
import { createTelegraphs } from './telegraph.js';

export const ELEMENT_NAMES = { physical: '物理', fire: '火', thunder: '雷', ice: '冰', wind: '風' };

export function createCombat(cfg, deps) {
  const { terrain, materials, physics, proxy, rng, lineStyle, spawn } = deps;
  const group = new THREE.Group();
  group.name = 'combat';
  const telegraphs = createTelegraphs({ terrain, materials, parent: group });
  let creatures = null; // bind() 之後才有
  let hud = null;
  let time = 0;

  // ---- 玩家 ----
  const player = {
    hp: cfg.hp,
    maxHp: cfg.hp,
    alive: true,
    invulnerable: 0,
    sinceHurt: 99,
    slow: 0, // 減速的比例（0–1）與剩下的秒數
    slowT: 0,
    rootT: 0, // 被樹根纏住
    downT: 0, // 倒下後的計時
    lift: 0, // 跳躍時離地的高度（震波）
    riding: false,
    moveScale: 1, // 引導法術（雷暴）時的移動倍率（spells.js 設定）
    pos: proxy.simPosition,
    lastHit: null, // 最後打中玩家的野怪
  };
  const status = { speedScale: 1 }; // 給旅人控制器（entities/traveler.js）
  const cooldowns = { sword: 0 };

  // ---- 火：村裡的火把、野外的火堆、火球燒過的地面（狼不敢靠近；蛛網會燒掉）----
  const fires = []; // { x, z, radius, t（剩幾秒，Infinity = 一直燒）, mesh?, light? }
  const lights = []; // 給 main.js 的點光源（燒著的地面）
  const flameGeometry = new THREE.OctahedronGeometry(0.22, 0).scale(1, 1.7, 1);
  function addFire(x, z, seconds = Infinity, radius = 1, withMesh = false) {
    const f = { x, z, radius, t: seconds, mesh: null, light: null };
    if (withMesh) {
      f.mesh = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(flameGeometry, materials.get('flame'));
        m.position.set(rng.range(-0.4, 0.4), 0.2, rng.range(-0.4, 0.4));
        m.scale.setScalar(rng.range(0.7, 1.2));
        f.mesh.add(m);
      }
      f.mesh.position.set(x, terrain.heightAt(x, z), z);
      group.add(f.mesh);
      f.light = { x, y: f.mesh.position.y + 0.8, z, radius: 6, power: 1.4, flicker: 0.35, phase: rng.next() * 10, fire: true };
      lights.push(f.light);
    }
    fires.push(f);
    return f;
  }
  function removeFire(f) {
    fires.splice(fires.indexOf(f), 1);
    if (f.mesh) group.remove(f.mesh);
    if (f.light) lights.splice(lights.indexOf(f.light), 1);
  }
  // 最近的火（距離、方向）；沒有回傳 null
  const nearFire = { fire: null, d: 0 };
  function nearestFire(x, z, within) {
    nearFire.fire = null;
    nearFire.d = within;
    for (const f of fires) {
      const d = Math.hypot(f.x - x, f.z - z) - f.radius;
      if (d < nearFire.d) {
        nearFire.d = d;
        nearFire.fire = f;
      }
    }
    return nearFire.fire ? nearFire : null;
  }

  // ---- 地上的危險區：蛛網（減速）、毒池（持續傷害）----
  const hazards = [];
  function addHazard(type, x, z, source) {
    const H = cfg.hazards[type];
    const deco = telegraphs.disk(type === 'web' ? 'web' : 'acid', x, z, H.radius);
    hazards.push({ type, x, z, radius: H.radius, t: H.seconds, deco, source });
  }
  function removeHazard(h) {
    hazards.splice(hazards.indexOf(h), 1);
    h.deco.remove();
  }
  // 火燒掉附近的蛛網，也燒掉纏在身上的網
  function burnWebs(x, z, r) {
    for (const h of [...hazards]) {
      if (h.type === 'web' && Math.hypot(h.x - x, h.z - z) < h.radius + r) {
        removeHazard(h);
        sparks(h.x, terrain.heightAt(h.x, h.z) + 0.2, h.z, 10, 'ember');
      }
    }
    if (Math.hypot(player.pos.x - x, player.pos.z - z) < r + 1 && player.slowT > 0) player.slowT = 0;
  }

  // ---- 玩家受傷 ----
  // opts：{ source（野怪）, knock（m/s，從 from 往外推）, from: {x, z}, slow, slowSeconds, root（秒）}
  function damagePlayer(amount, opts = {}) {
    if (!player.alive || player.invulnerable > 0 || amount <= 0) return false;
    player.hp = Math.max(0, player.hp - amount);
    player.invulnerable = cfg.invulnerable;
    player.sinceHurt = 0;
    player.lastHit = opts.source ?? null;
    if (opts.knock) {
      const from = opts.from ?? opts.source?.pos ?? player.pos;
      let dx = player.pos.x - from.x;
      let dz = player.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      proxy.shove((dx / l) * opts.knock, (dz / l) * opts.knock);
    }
    if (opts.slow) {
      player.slow = Math.max(player.slow, opts.slow);
      player.slowT = Math.max(player.slowT, opts.slowSeconds ?? 3);
    }
    if (opts.root) player.rootT = Math.max(player.rootT, opts.root);
    hud?.hurt(amount, player.hp / player.maxHp);
    if (player.hp <= 0) {
      player.alive = false;
      player.downT = 0;
      hud?.down(true);
      creatures?.playerDown();
    }
    return true;
  }

  // ---- 投射物（野怪吐的網、酸液；玩家的火球、冰錐）----
  const projectiles = [];
  const projectileGeometry = new THREE.IcosahedronGeometry(0.22, 0);
  function launch(p) {
    // p：{ from: Vector3, to: Vector3（落點）或 dir, speed, arc, material, onLand(x, y, z), owner: 'player' | creature, target? }
    const mesh = new THREE.Mesh(projectileGeometry, materials.get(p.material));
    mesh.layers.set(1);
    mesh.scale.setScalar(p.size ?? 1);
    group.add(mesh);
    const dist = p.from.distanceTo(p.to);
    projectiles.push({ ...p, mesh, t: 0, duration: Math.max(0.15, dist / p.speed), pos: p.from.clone(), prev: p.from.clone() });
  }

  // ---- 震波：往外擴散的環，經過時沒跳起來就受傷 ----
  const waves = [];
  function shockwave(x, z, shape, damage, source, knock) {
    waves.push({ x, z, r: 0.5, max: shape.radius, speed: shape.speed, width: shape.width, damage, source, knock, hit: false, mesh: telegraphs.ringMesh() });
  }

  // ---- 樹精的樹根：從預告的範圍裡竄出地面，停一下再縮回去 ----
  const roots = [];
  const rootGeometry = new THREE.ConeGeometry(0.12, 1.4, 5).translate(0, 0.7, 0);
  function spawnRoots(x, z, radius) {
    const g = new THREE.Group();
    const n = Math.round(radius * 5);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * radius;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const m = new THREE.Mesh(rootGeometry, materials.get('roots'));
      m.position.set(px, terrain.heightAt(px, pz) - 1.4, pz);
      m.rotation.set(rng.range(-0.5, 0.5), rng.next() * 6, rng.range(-0.5, 0.5));
      m.scale.setScalar(rng.range(0.7, 1.4));
      m.userData.ground = terrain.heightAt(px, pz);
      g.add(m);
    }
    group.add(g);
    roots.push({ g, t: 0 });
    sparks(x, terrain.heightAt(x, z) + 0.2, z, 12, 'spark', 3);
  }

  // ---- 細線特效：雷、風、冰息、火花、揮劍 ----
  const fx = []; // { kind, t, life, ... }
  function sparks(x, y, z, n, kind = 'spark', speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const up = rng.range(0.3, 1);
      fx.push({ kind: 'spark', style: lineStyle[kind], x, y, z, vx: Math.cos(a) * speed * rng.range(0.4, 1), vy: up * speed, vz: Math.sin(a) * speed * rng.range(0.4, 1), t: 0, life: rng.range(0.25, 0.6) });
    }
  }
  function bolt(x, y, z) {
    // 從天上劈下來的鋸齒狀閃電（幾段折線），0.3 秒內閃兩次
    const pts = [];
    let px = x + rng.range(-2, 2);
    let pz = z + rng.range(-2, 2);
    const top = y + 16;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push([px + (x - px) * k + (i < n ? rng.range(-0.7, 0.7) : 0), top + (y - top) * k, pz + (z - pz) * k + (i < n ? rng.range(-0.7, 0.7) : 0)]);
    }
    fx.push({ kind: 'bolt', pts, t: 0, life: 0.35 });
    sparks(x, y + 0.2, z, 8, 'lightning', 5);
  }
  // 兩點之間的鋸齒閃電（連鎖雷法的跳躍），0.25 秒
  function arc(ax, ay, az, bx, by, bz) {
    const pts = [];
    const n = Math.max(3, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.8));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = i === 0 || i === n ? 0 : 0.35;
      pts.push([ax + (bx - ax) * k + rng.range(-j, j), ay + (by - ay) * k + rng.range(-j, j), az + (bz - az) * k + rng.range(-j, j)]);
    }
    fx.push({ kind: 'bolt', pts, t: 0, life: 0.25 });
  }

  // 從 (x, z) 往 heading 方向吹的風（幾條往前飛的短線）
  function gust(x, y, z, heading, spread, range, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = heading + rng.range(-spread / 2, spread / 2);
      const sp = range / 0.45;
      fx.push({ kind: 'spark', style: lineStyle.wind, x: x + Math.sin(a) * 0.6, y: y + rng.range(-0.3, 0.9), z: z + Math.cos(a) * 0.6, vx: Math.sin(a) * sp, vy: 0, vz: Math.cos(a) * sp, t: 0, life: rng.range(0.3, 0.45), long: 0.08 });
    }
  }
  function frost(ax, ay, az, bx, by, bz, n = 6) {
    for (let i = 0; i < n; i++) {
      const k = rng.next();
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      fx.push({ kind: 'spark', style: lineStyle.frost, x: ax, y: ay, z: az, vx: dx * rng.range(1.6, 2.2) + rng.range(-2, 2), vy: dy * rng.range(1.6, 2.2) + rng.range(-1, 1), vz: dz * rng.range(1.6, 2.2) + rng.range(-2, 2), t: k * 0.05, life: 0.5, long: 0.05 });
    }
  }
  function swingArc(x, y, z, heading, radius, angle) {
    fx.push({ kind: 'arc', x, y, z, heading, radius, angle, t: 0, life: 0.2 });
  }

  // ---- 玩家的劍 ----
  // aim：{ x, z（揮劍的水平方向）}
  function attack(kind, aim) {
    if (kind !== 'sword' || !player.alive || cooldowns.sword > 0 || !creatures) return false;
    const heading = Math.atan2(aim.x, aim.z);
    const S = cfg.sword;
    cooldowns.sword = S.cooldown;
    const reach = S.range + (player.riding ? 0.8 : 0);
    creatures.hitArea(player.pos, heading, { type: 'cone', radius: reach, angle: S.angle }, S.damage, 'physical', { knock: 2 });
    swingArc(player.pos.x, player.pos.y + (player.riding ? 1.9 : 1.1), player.pos.z, heading, reach * 0.8, S.angle);
    return true;
  }

  // ---- 每個固定步長 ----
  function fixedUpdate(dt, ctx) {
    time += dt;
    player.lift = ctx.lift;
    player.riding = ctx.riding;
    for (const k of Object.keys(cooldowns)) cooldowns[k] = Math.max(0, cooldowns[k] - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.sinceHurt += dt;

    // 倒下：幾秒後在灰燼村醒來（血量回滿、狀態清掉）
    if (!player.alive) {
      player.downT += dt;
      status.speedScale = 0;
      if (player.downT > cfg.respawnSeconds) {
        player.alive = true;
        player.hp = player.maxHp;
        player.slowT = player.rootT = 0;
        hud?.down(false);
        spawn();
      }
      return;
    }
    if (player.sinceHurt > cfg.regenDelay) player.hp = Math.min(player.maxHp, player.hp + cfg.regen * dt);

    // 地上的蛛網與毒池
    let webSlow = 0;
    for (const h of [...hazards]) {
      h.t -= dt;
      if (h.t <= 0) {
        removeHazard(h);
        continue;
      }
      if (Math.hypot(player.pos.x - h.x, player.pos.z - h.z) > h.radius || player.lift > 0.3) continue;
      if (h.type === 'web') webSlow = cfg.hazards.web.slow;
      else if (h.type === 'acid' && player.invulnerable <= 0) {
        // 毒池：每 0.5 秒一次小傷害（不觸發無敵時間）
        h.tick = (h.tick ?? 0) + dt;
        if (h.tick > 0.5) {
          h.tick = 0;
          const dmg = (h.source?.damage ?? 8) * cfg.hazards.acid.dps * 0.5;
          player.hp = Math.max(1, player.hp - dmg);
          player.sinceHurt = 0;
          hud?.hurt(dmg, player.hp / player.maxHp, true);
        }
      }
    }
    player.slowT = Math.max(0, player.slowT - dt);
    player.rootT = Math.max(0, player.rootT - dt);
    if (player.slowT <= 0) player.slow = 0;
    status.speedScale = player.rootT > 0 ? 0 : (1 - Math.max(player.slow, webSlow)) * player.moveScale;

    // 投射物
    for (const p of [...projectiles]) {
      p.t += dt / p.duration;
      // 玩家的火球、冰錐：追著目標修正落點
      if (p.homing?.alive) p.homing.aimPoint(p.to);
      const k = Math.min(1, p.t);
      p.prev.copy(p.pos);
      p.pos.lerpVectors(p.from, p.to, k);
      p.pos.y += 4 * p.arc * k * (1 - k);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.set(time * 9, time * 7, 0);
      if (p.trail && rng.next() < 0.7) fx.push({ kind: 'spark', style: lineStyle[p.trail], x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rng.range(-0.5, 0.5), vy: rng.range(0, 0.8), vz: rng.range(-0.5, 0.5), t: 0, life: 0.25, long: 0.12 });
      // 撞到地面就提早落地
      const ground = terrain.heightAt(p.pos.x, p.pos.z);
      if (k >= 1 || (k > 0.2 && p.pos.y < ground)) {
        group.remove(p.mesh);
        projectiles.splice(projectiles.indexOf(p), 1);
        p.onLand(p.pos.x, Math.max(p.pos.y, ground), p.pos.z);
      }
    }

    // 震波
    for (const w of [...waves]) {
      const before = w.r;
      w.r += w.speed * dt;
      const d = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
      // 環帶掃過玩家時沒有跳起來就受傷
      if (!w.hit && d > before - w.width && d < w.r + w.width / 2 && player.lift < cfg.jumpDodge) {
        w.hit = true;
        damagePlayer(w.damage, { source: w.source, knock: w.knock, from: w });
      }
      if (w.r > w.max) {
        w.mesh.remove();
        waves.splice(waves.indexOf(w), 1);
      }
    }

    // 燒著的地面
    for (const f of [...fires]) {
      if (f.t === Infinity) continue;
      f.t -= dt;
      if (f.t <= 0) removeFire(f);
    }
  }

  // ---- 每幀（畫面）----
  function frameUpdate(dt) {
    for (const w of waves) w.mesh.set(w.x, w.z, w.r, w.width);
    // 樹根：0.15 秒竄出、停留、再慢慢縮回地下
    for (const r of [...roots]) {
      r.t += dt;
      const up = Math.min(1, r.t / 0.15) * (1 - Math.max(0, (r.t - 1.6) / 0.8));
      for (const m of r.g.children) m.position.y = m.userData.ground - 1.4 * (1 - up) * m.scale.y;
      if (r.t > 2.4) {
        group.remove(r.g);
        roots.splice(roots.indexOf(r), 1);
      }
    }
    for (const f of fires) {
      if (!f.mesh) continue;
      f.mesh.children.forEach((m, i) => {
        m.scale.y = 1 + 0.35 * Math.sin(time * 11 + i * 2.1);
      });
    }
    for (const e of [...fx]) {
      e.t += dt;
      if (e.t > e.life) fx.splice(fx.indexOf(e), 1);
      else if (e.kind === 'spark') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.z += e.vz * dt;
        if (!e.long) e.vy -= 9.8 * dt;
      }
    }
  }

  const lines = {
    emit(push) {
      for (const e of fx) {
        if (e.t < 0) continue;
        if (e.kind === 'spark') {
          const l = e.long ?? 0.05;
          push(e.x, e.y, e.z, e.x - e.vx * l, e.y - e.vy * l, e.z - e.vz * l, e.style, true);
        } else if (e.kind === 'bolt') {
          // 閃兩下
          const on = e.t < 0.1 || (e.t > 0.17 && e.t < 0.27);
          if (!on) continue;
          for (let i = 0; i + 1 < e.pts.length; i++) {
            const a = e.pts[i];
            const b = e.pts[i + 1];
            push(a[0], a[1], a[2], b[0], b[1], b[2], lineStyle.lightning, i === 0);
          }
        } else if (e.kind === 'arc') {
          // 揮劍：從右往左掃過的弧線（越晚越長）
          const k = Math.min(1, e.t / e.life);
          const n = 8;
          const a0 = e.heading + e.angle / 2;
          for (let i = 0; i < n; i++) {
            const u0 = (i / n) * k;
            const u1 = ((i + 1) / n) * k;
            const b0 = a0 - e.angle * u0;
            const b1 = a0 - e.angle * u1;
            push(e.x + Math.sin(b0) * e.radius, e.y - u0 * 0.4, e.z + Math.cos(b0) * e.radius, e.x + Math.sin(b1) * e.radius, e.y - u1 * 0.4, e.z + Math.cos(b1) * e.radius, lineStyle.swing, i === 0);
          }
        }
      }
    },
  };

  // 野外的火堆：草原上、離村莊有一段距離、不在路上與水裡（狼不敢靠近）
  function placeCampfires(hf, plateau) {
    const C = cfg.campfires;
    let placed = 0;
    for (let attempt = 0; attempt < 600 && placed < C.count; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const r = rng.range(C.minVillage, 330);
      const x = plateau.center[0] + Math.cos(a) * r;
      const z = plateau.center[1] + Math.sin(a) * r;
      const w = hf.regionWeights(x, z);
      if (w[0] < 0.8 || terrain.waterDepthAt(x, z) > 0 || hf.normal(x, z)[1] < 0.9) continue;
      const road = hf.roadDistance(x, z);
      if (road < 5 || road > 25) continue; // 路邊的營火
      if (fires.some((f) => Math.hypot(f.x - x, f.z - z) < 60)) continue;
      const f = addFire(x, z, Infinity, C.radius, true);
      f.light.radius = C.light.radius;
      f.light.power = C.light.power;
      f.light.flicker = C.light.flicker;
      // 圍著火的石頭（碰撞：一個矮圓柱）
      const ring = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), materials.get('stone'));
        const b = (i / 7) * Math.PI * 2;
        s.position.set(Math.cos(b) * 0.55, 0.05, Math.sin(b) * 0.55);
        ring.add(s);
      }
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5), materials.get('wood'));
        log.rotation.set(Math.PI / 2 - 0.35, (i / 3) * Math.PI * 2, 0, 'YXZ');
        log.position.y = 0.12;
        ring.add(log);
      }
      ring.position.copy(f.mesh.position);
      group.add(ring);
      physics.addCylinder(x, z, 0.6, f.mesh.position.y - 0.2, f.mesh.position.y + 0.4);
      placed++;
    }
    return placed;
  }

  return {
    group,
    player,
    status,
    cooldowns,
    fires,
    lights,
    telegraphs,
    lines,
    bind(c, h) {
      creatures = c;
      hud = h;
    },
    addFire,
    nearestFire,
    placeCampfires,
    burnWebs,
    damagePlayer,
    launch,
    addHazard,
    shockwave,
    roots: spawnRoots,
    sparks,
    bolt,
    arc,
    gust,
    frost,
    get hud() {
      return hud;
    },
    // 細線特效的樣式（spells.js 用）
    lineStyle,
    // 加一個細線特效（spells.js 用）：{ kind: 'spark' | 'bolt' | 'arc', ... }
    effect(e) {
      fx.push(e);
    },
    attack,
    fixedUpdate,
    frameUpdate,
    get stats() {
      return { projectiles: projectiles.length, hazards: hazards.length, telegraphs: telegraphs.count, waves: waves.length, fires: fires.length, fx: fx.length };
    },
  };
}
