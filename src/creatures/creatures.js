// 野怪：生成規則、模擬範圍、重生、受傷與元素倍率、每幀的姿勢（程序式動畫 + 腳的 IK）、頭上的 ! ? *、狼的細線毛髮。
//
// 生成規則（固定種子，每次都一樣）：
//   · 每種野怪在自己的區域（CONFIG.creatures.species[*].region）裡找地盤中心，村莊平台與道路附近不刷怪
//   · 離灰燼村越遠等級越高（hp、傷害依等級放大）
//   · nightOnly 的只在夜裡出現（夜網蛛在黑杉林深處的陰暗處白天也在）；白天在玩家看不到時消失
//   · 死亡後 respawnSeconds 秒，在玩家看不到的地方（夠遠，或在鏡頭的視野外）重生
// AI 的狀態機在 ai.js；每種野怪的模型、姿勢與特殊行為在 species/*.js。
import * as THREE from 'three';
import { REGION } from '../world/heightField.js';
import { buildTemplate, instantiate, createLegs } from './body.js';
import { createBrain } from './ai.js';
import { shapeContains } from './telegraph.js';
import { SPECIES } from './species/index.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCreatures(cfg, deps) {
  const { terrain, heightField: hf, physics, materials, combat, clock, rng, plateau, lineStyle, water } = deps;
  const group = new THREE.Group();
  group.name = 'creatures';
  const material = materials.vertexMaterial(0);
  const list = [];
  const packs = [];
  const templates = {};
  let hud = null;
  let camera = null;
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const stats = { total: 0, active: 0, visible: 0, dead: 0, byState: {} };

  // ---- 世界資訊（給 AI 與各種野怪的掛勾）----
  const w = {
    terrain,
    physics,
    combat,
    clock,
    rng,
    hf,
    water,
    cfg,
    dt: 1 / 60,
    time: 0,
    tmpFrom: new THREE.Vector3(),
    tmpTo: new THREE.Vector3(),
    list,
    lakeCenter: { x: deps.lakeCfg.center[0], z: deps.lakeCfg.center[1] },
    lakeRadius: deps.lakeCfg.radius,
    // 最近的某種野怪（活著、在場）
    nearestOf(id, x, z, within) {
      let best = null;
      let bd = within;
      for (const c of list) {
        if (c.sp.id !== id || !c.alive || !c.present || !c.active) continue;
        const d = Math.hypot(c.pos.x - x, c.pos.z - z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    },
    regionWeight(x, z, region) {
      return hf.regionWeights(x, z)[REGION[region]];
    },
  };
  const brain = createBrain(cfg, w);
  w.brain = brain;

  // ---- 地盤：能不能在這裡刷怪 ----
  const N = cfg.noSpawn;
  function baseOk(x, z) {
    if (Math.hypot(x - plateau.center[0], z - plateau.center[1]) < plateau.radius + plateau.falloff + N.villageMargin) return false; // 村莊
    if (hf.roadDistance(x, z) < N.roadClearance) return false; // 道路
    return true;
  }
  function landOk(x, z) {
    return terrain.waterDepthAt(x, z) <= 0.02 && hf.normal(x, z)[1] > N.maxSlope;
  }
  function levelAt(x, z) {
    const d = Math.hypot(x - plateau.center[0], z - plateau.center[1]);
    return Math.max(1, Math.min(cfg.level.max, 1 + Math.floor(d / cfg.level.per)));
  }

  function template(sp) {
    if (!templates[sp.id]) templates[sp.id] = buildTemplate(sp.define, materials, sp.variants ?? {});
    return templates[sp.id];
  }

  // ---- 建立一隻 ----
  const markGeometry = new THREE.PlaneGeometry(0.55, 1);
  const markMaterials = { alert: materials.get('alert'), lost: materials.get('alertLost'), stun: materials.get('stun') };
  function spawnCreature(sp, S, x, z, opts = {}) {
    const T = template(sp);
    const meta = T.meta;
    const model = instantiate(T, material);
    // 視錐剔除：模板（靜止姿勢）的包圍球放大一些，涵蓋站起來、張開翅膀等姿勢；主畫面、陰影、倒影都會剔除
    const bound = T.geometries.base.boundingSphere;
    model.mesh.boundingSphere = bound.clone();
    model.mesh.boundingSphere.radius *= 1.5;
    model.mesh.frustumCulled = true;
    const level = levelAt(x, z);
    const L = cfg.level;
    const alpha = !!opts.alpha;
    const scale = (opts.scale ?? 1) * (alpha ? S.alpha.scale : 1) * (1 + (sp.levelGrowth ?? 0.03) * (level - 1));
    model.object.scale.setScalar(scale);
    const maxHp = Math.round(S.hp * (1 + L.hp * (level - 1)) * (alpha ? S.alpha.hp : 1));
    const c = {
      id: list.length,
      sp,
      stats: S,
      name: alpha ? `${S.name}王` : S.name,
      level,
      alive: true,
      present: true,
      active: false,
      visible: false,
      hp: maxHp,
      maxHp,
      damage: S.damage * (1 + L.damage * (level - 1)) * (alpha ? S.alpha.damage : 1),
      pos: new THREE.Vector3(x, terrain.heightAt(x, z), z),
      prev: new THREE.Vector3(),
      draw: new THREE.Vector3(),
      heading: rng.next() * Math.PI * 2,
      prevHeading: 0,
      drawHeading: 0,
      speed: 0,
      vx: 0,
      vz: 0,
      home: { x: opts.homeX ?? x, z: opts.homeZ ?? z },
      territory: S.territory,
      radius: S.radius * scale,
      maxDepth: sp.maxDepth ?? 0.7,
      eyeHeight: (meta.eye ?? 1) * scale,
      markHeight: (meta.mark ?? 1.5) * scale,
      aimHeight: (meta.aim ?? 0.8) * scale,
      stopAt: (sp.stopAt ?? 1.3) + S.radius * scale,
      scale,
      state: 'idle',
      t: 0,
      wait: rng.range(1, 6),
      goal: null,
      cooldown: Object.fromEntries(Object.keys(S.attacks).map((k) => [k, rng.range(0, 1.5)])),
      mark: null,
      markT: 0,
      markMesh: null,
      senseT: rng.next() * 0.2,
      sees: false,
      lastSeen: 99,
      pack: opts.pack ?? null,
      isAlpha: alpha,
      flank: opts.flank ?? 0,
      model,
      legs: meta.legs ? createLegs(model, meta.legs, meta.legOpts) : null,
      meta,
      anim: { phase: rng.next(), look: 0, flinch: 0, windup: 0, strike: 0, ground: 0, pitch: 0, roll: 0, seed: rng.next() * 100, dead: 0 },
      deadT: 0,
      slow: 0,
      slowT: 0,
      lastHitT: 99,
      lastFrame: new THREE.Vector3(x, 0, z),
      fvx: 0,
      fvz: 0,
      poseDt: 0,
      boundR: 0,
      boundY: 0,
      mouth(out) {
        return c.mouthPoint ? c.mouthPoint(out) : out.set(c.pos.x + Math.sin(c.heading) * c.radius, c.pos.y + c.aimHeight, c.pos.z + Math.cos(c.heading) * c.radius);
      },
      aimPoint(out) {
        return out.set(c.pos.x, c.pos.y + c.aimHeight, c.pos.z);
      },
    };
    c.boundR = bound.radius * 1.5 * scale;
    c.boundY = bound.center.y * scale;
    c.prev.copy(c.pos);
    c.draw.copy(c.pos);
    if (alpha) model.setVariant('alpha');
    if (meta.mouth) {
      const m = model.attach(meta.mouth[0], new THREE.Vector3(...meta.mouth[1]));
      c.mouthPoint = (out) => m(out);
    }
    sp.init?.(c, w);
    c.state = sp.restState?.(c, w) ?? 'idle';
    model.object.visible = false;
    group.add(model.object);
    list.push(c);
    return c;
  }

  // ---- 地盤的配置 ----
  function place() {
    const occupied = [];
    const world = 470;
    for (const [id, S] of Object.entries(cfg.species)) {
      const sp = SPECIES[id];
      if (!sp) throw new Error(`creatures.species.${id} has no model in creatures/species`);
      const fixed = sp.homes?.(w, hf, deps) ?? null; // 固定的地盤（石像、飛龍）
      let placed = 0;
      const tryHome = (x, z) => {
        if (fixed === null) {
          if (Math.abs(x) > world || Math.abs(z) > world || !baseOk(x, z)) return false;
          if (sp.homeOk ? !sp.homeOk(x, z, w) : !(landOk(x, z) && w.regionWeight(x, z, S.region) > 0.8)) return false;
          const spacing = sp.critter ? 25 : 45;
          if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < (o.id === id ? spacing : 18))) return false;
        }
        occupied.push({ x, z, id });
        const n = rng.int(S.pack[0], S.pack[1]);
        const pack = n > 1 || S.alpha ? { members: [], alpha: null, broken: false, attackers: new Set() } : null;
        const flanks = [0, 1.75, -1.75, 2.7, -2.7, 1.1, -1.1];
        for (let i = 0; i < n; i++) {
          let mx = x;
          let mz = z;
          for (let k = 0; k < 6 && i > 0; k++) {
            const a = rng.next() * Math.PI * 2;
            const r = rng.range(1.5, 4);
            const tx = x + Math.cos(a) * r;
            const tz = z + Math.sin(a) * r;
            if (sp.homeOk ? sp.homeOk(tx, tz, w) : landOk(tx, tz)) {
              mx = tx;
              mz = tz;
              break;
            }
          }
          const c = spawnCreature(sp, S, mx, mz, { pack, alpha: !!S.alpha && i === 0, flank: flanks[i % flanks.length], homeX: x, homeZ: z });
          if (pack) {
            pack.members.push(c);
            if (c.isAlpha) pack.alpha = c;
          }
        }
        if (pack) packs.push(pack);
        placed++;
        return true;
      };
      if (fixed) {
        for (const h of fixed.slice(0, S.groups)) tryHome(h.x, h.z);
        continue;
      }
      for (let attempt = 0; attempt < 6000 && placed < S.groups; attempt++) tryHome(rng.range(-world, world), rng.range(-world, world));
    }
    stats.total = list.length;
  }

  // ---- 看不看得到（重生、白天消失都要在玩家看不到的地方）----
  const sphere = new THREE.Sphere();
  function hiddenAt(x, y, z, r = 2) {
    if (!camera) return true;
    const pp = combat.player.pos;
    if (Math.hypot(x - pp.x, z - pp.z) < cfg.respawnMinDistance) return false;
    const d = camera.position.distanceTo(sphere.center.set(x, y + r * 0.5, z));
    if (d > cfg.respawnHiddenBeyond) return true;
    sphere.radius = r + 1;
    return !frustum.intersectsSphere(sphere);
  }

  function shouldBePresent(c) {
    if (c.sp.present) return c.sp.present(c, w);
    const S = c.stats;
    if (!S.nightOnly || clock.night) return true;
    // 夜網蛛：黑杉林深處的陰暗處白天也在
    return S.darkForest !== undefined && hf.forestDistance(c.home.x, c.home.z) < S.darkForest;
  }

  function respawn(c) {
    for (let k = 0; k < 6; k++) {
      const a = rng.next() * Math.PI * 2;
      const r = k === 0 ? 0 : rng.range(2, c.territory * 0.5);
      const x = c.home.x + Math.cos(a) * r;
      const z = c.home.z + Math.sin(a) * r;
      if (k > 0 && !(c.sp.homeOk ? c.sp.homeOk(x, z, w) : landOk(x, z))) continue;
      const y = terrain.heightAt(x, z);
      if (!hiddenAt(x, y, z, c.radius * 3)) continue;
      reset(c, x, z);
      return true;
    }
    return false;
  }
  function reset(c, x, z) {
    c.alive = true;
    c.hp = c.maxHp;
    c.pos.set(x, terrain.heightAt(x, z), z);
    c.prev.copy(c.pos);
    c.draw.copy(c.pos);
    c.deadT = 0;
    c.anim.dead = 0;
    c.rage = false;
    c.lastSeen = 99;
    c.sees = false;
    c.mark = null;
    c.slowT = 0;
    c.model.object.rotation.set(0, c.heading, 0);
    if (c.atk) brain.endAttack(c);
    brain.setState(c, c.sp.restState?.(c, w) ?? 'idle');
    c.sp.init?.(c, w);
    if (c.isAlpha) c.model.setVariant('alpha');
    else if (c.model.variant !== 'base' && !c.sp.keepVariant) c.model.setVariant('base');
    c.legs?.plant(c.model.object, terrain.heightAt);
    c.planted = false;
    if (c.pack && c.isAlpha) c.pack.broken = false;
  }

  // ---- 受傷 ----
  function multiplier(c, element) {
    const S = c.stats;
    let m = S.weak[element] ?? S.resist[element] ?? 1;
    if (c.sp.damageScale) m *= c.sp.damageScale(c, element, w);
    return m;
  }
  function hurt(c, amount, element, opts = {}) {
    if (!c.alive || !c.present) return 0;
    const m = multiplier(c, element);
    const dmg = Math.round(amount * m);
    const kind = m === 0 ? 'immune' : m > 1.01 ? 'weak' : m < 0.99 ? 'resist' : 'normal';
    hud?.number(c.aimPoint(new THREE.Vector3()), dmg, kind, element);
    c.lastHitT = 0;
    focus = c;
    if (dmg <= 0) {
      brain.provoked(c);
      return 0;
    }
    c.hp -= dmg;
    c.anim.flinch = 1;
    combat.sparks(c.pos.x, c.pos.y + c.aimHeight, c.pos.z, kind === 'weak' ? 7 : 3, element === 'fire' ? 'ember' : element === 'ice' ? 'frost' : 'spark', 3);
    c.sp.onHurt?.(c, dmg, element, w, brain, opts);
    if (c.hp <= 0) {
      die(c);
      return dmg;
    }
    // 擊退（怕風的被吹得更遠）
    if (opts.knock && !c.stats.boss) {
      const k = opts.knock * (element === 'wind' ? c.stats.knockback ?? 1 : 1) * (m > 0 ? Math.min(m, 1.5) : 0) * 0.3;
      const a = Math.atan2(c.pos.x - combat.player.pos.x, c.pos.z - combat.player.pos.z);
      if (k > 0) {
        brain.move(c, Math.sin(a) * k, Math.cos(a) * k);
        if (element === 'wind' && (c.stats.knockback ?? 1) > 1 && c.state === 'attack') {
          brain.endAttack(c);
          brain.stun(c, 0.8);
        }
      }
    }
    if (opts.slow) {
      c.slow = opts.slow;
      c.slowT = opts.slowSeconds ?? 3;
    }
    // 狼怕火：被火燒到會逃開
    if (element === 'fire' && c.stats.fearsFire && !c.isAlpha) brain.flee(c, combat.player.pos.x, combat.player.pos.z, 1.6);
    else if (c.state !== 'return') brain.provoked(c);
    // 狼：受重傷的會逃
    if (c.pack && !c.isAlpha && c.hp < c.maxHp * 0.2 && c.state !== 'flee') brain.flee(c, combat.player.pos.x, combat.player.pos.z, 6);
    return dmg;
  }
  function die(c) {
    c.alive = false;
    c.hp = 0;
    c.deadT = 0;
    if (c.atk) brain.endAttack(c);
    brain.setState(c, 'dead');
    c.mark = null;
    c.sp.onDeath?.(c, w);
    hud?.killed(c);
    // 狼王死掉：剩下的逃跑
    if (c.pack && c.isAlpha) {
      c.pack.broken = true;
      for (const m of c.pack.members) if (m.alive) brain.flee(m, combat.player.pos.x, combat.player.pos.z, 10);
    }
  }

  let focus = null;

  // ---- 每個固定步長 ----
  function fixedUpdate(dt) {
    w.dt = dt;
    w.time += dt;
    const p = combat.player.pos;
    const counts = {};
    stats.active = stats.dead = 0;
    for (const c of list) {
      c.prev.copy(c.pos);
      c.prevHeading = c.heading;
      c.lastHitT += dt;
      if (c.slowT > 0 && (c.slowT -= dt) <= 0) c.slow = 0;
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      const near = d < cfg.activeRadius;
      if (!c.alive) {
        stats.dead++;
        c.deadT += dt;
        if (c.deadT > cfg.respawnSeconds && Math.floor(c.deadT * 2) !== Math.floor((c.deadT - dt) * 2)) respawn(c);
        if (near) c.sp.deadThink?.(c, dt, w);
        continue;
      }
      // 出沒時間：白天消失（在玩家看不到時；戰鬥中的不會）
      const want = shouldBePresent(c);
      if (want !== c.present && c.state !== 'chase' && c.state !== 'attack') {
        if (want) {
          if (!near || hiddenAt(c.home.x, terrain.heightAt(c.home.x, c.home.z), c.home.z)) {
            c.present = true;
            reset(c, c.home.x, c.home.z);
          }
        } else if (!near || hiddenAt(c.pos.x, c.pos.y, c.pos.z) || c.stats.ghost) {
          if (c.stats.ghost && near) combat.sparks(c.pos.x, c.pos.y + 1, c.pos.z, 10, 'frost', 1.5); // 遊魂天亮時消散
          c.present = false;
        }
      }
      if (!c.present) continue;
      if (!near) {
        // 離開模擬範圍：戰鬥中的直接回家
        if (c.active && c.state !== 'idle' && c.state !== 'dormant' && c.state !== 'patrol') reset(c, c.home.x, c.home.z);
        c.active = false;
        continue;
      }
      c.active = true;
      stats.active++;
      brain.think(c, dt);
      counts[c.state] = (counts[c.state] ?? 0) + 1;
    }
    stats.byState = counts;
    separate();
  }

  // 互相推開（同一群）與不和玩家重疊
  function separate() {
    const p = combat.player.pos;
    const pr = combat.player.riding ? 1 : 0.45;
    for (const c of list) {
      if (!c.alive || !c.active || !c.present || c.stats.flying || c.airborne) continue;
      const dx = c.pos.x - p.x;
      const dz = c.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = c.radius + pr;
      if (d < min && combat.player.alive) {
        // 重疊在同一點（例如跳撲落在玩家身上）：往自己的後方推
        const ux = d > 1e-4 ? dx / d : -Math.sin(c.heading);
        const uz = d > 1e-4 ? dz / d : -Math.cos(c.heading);
        brain.move(c, ux * (min - d), uz * (min - d));
      }
      if (!c.pack) continue;
      for (const o of c.pack.members) {
        if (o === c || !o.alive || o.id < c.id) continue;
        const ex = o.pos.x - c.pos.x;
        const ez = o.pos.z - c.pos.z;
        const e = Math.hypot(ex, ez);
        const m = c.radius + o.radius;
        if (e < m) {
          const k = (m - e) * 0.5;
          const ux = e > 1e-4 ? ex / e : 1;
          const uz = e > 1e-4 ? ez / e : 0;
          brain.move(o, ux * k, uz * k);
          brain.move(c, -ux * k, -uz * k);
        }
      }
    }
  }

  // ---- 每幀：姿勢 ----
  const LOD = cfg.lod;
  let frameNo = 0;
  const ground = (x, z) => terrain.heightAt(x, z);
  const _v = new THREE.Vector3();
  function frame(alpha, dt, cam, layout) {
    camera = cam;
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    stats.visible = 0;
    stats.drawn = 0;
    frameNo++;
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    const k = { dt, time: w.time, w };
    for (const c of list) {
      const show = c.present && c.active && (c.alive || c.deadT < cfg.corpseSeconds + 1.5);
      const obj = c.model.object;
      obj.visible = show;
      if (c.markMesh) c.markMesh.visible = false;
      if (!show) continue;
      stats.visible++;
      c.draw.lerpVectors(c.prev, c.pos, alpha);
      c.drawHeading = c.prevHeading + wrap(c.heading - c.prevHeading) * alpha;
      // 每幀的速度（腳的步伐、步態相位用）
      const fvx = (c.draw.x - c.lastFrame.x) / Math.max(dt, 1e-4);
      const fvz = (c.draw.z - c.lastFrame.z) / Math.max(dt, 1e-4);
      const teleported = Math.hypot(c.draw.x - c.lastFrame.x, c.draw.z - c.lastFrame.z) > 5;
      c.fvx += ((teleported ? 0 : fvx) - c.fvx) * (1 - Math.exp(-12 * dt));
      c.fvz += ((teleported ? 0 : fvz) - c.fvz) * (1 - Math.exp(-12 * dt));
      c.lastFrame.copy(c.draw);
      // 距離分級：比半格還小就不畫；在鏡頭視野外不畫（也不投影子）；遠處的姿勢隔幾幀才更新、不做腳的 IK
      const d = cam.position.distanceTo(c.draw);
      const cell = (2 * d * tanHalf) / Math.max(1, layout.rows);
      sphere.center.set(c.draw.x, c.draw.y + c.boundY, c.draw.z);
      sphere.radius = c.boundR;
      if ((c.alive && c.markHeight < LOD.minCells * cell) || !frustum.intersectsSphere(sphere)) {
        obj.visible = false;
        c.planted = false;
        continue;
      }
      stats.drawn++;
      c.poseDt += dt;
      const every = d < LOD.half ? 1 : d < LOD.third ? 2 : 3;
      if (!teleported && (frameNo + c.id) % every !== 0) {
        // 這幀不更新姿勢：只把根移到內插後的位置
        obj.position.set(c.draw.x, c.stats.flying || c.sp.free || c.airborne ? c.draw.y : ground(c.draw.x, c.draw.z) + c.anim.ground, c.draw.z);
        obj.rotation.y = c.drawHeading;
      } else {
        k.dt = c.poseDt;
        animate(c, c.poseDt, k, teleported, d < LOD.ik);
        c.poseDt = 0;
      }
      updateMark(c, cam, layout);
    }
    focusUpdate();
  }

  function animate(c, dt, k, teleported, ik = true) {
    const a = c.anim;
    const m = c.model;
    const obj = m.object;
    m.reset();
    const speed = Math.hypot(c.fvx, c.fvz);
    a.speed = speed;
    a.phase = (a.phase + (speed * dt) / ((c.meta.stride ?? 1.2) * c.scale)) % 1;
    a.flinch = Math.max(0, a.flinch - dt * 4);
    // 頭轉向玩家（警覺之後）
    const p = combat.player.pos;
    const engaged = c.state === 'alert' || c.state === 'chase' || c.state === 'attack';
    const want = engaged ? Math.max(-0.9, Math.min(0.9, wrap(Math.atan2(p.x - c.draw.x, p.z - c.draw.z) - c.drawHeading))) : 0;
    a.look += (want - a.look) * (1 - Math.exp(-6 * dt));
    const A = c.atk;
    const wind = A && A.phase === 'windup' ? Math.min(1, A.t / A.def.windup) : 0;
    const strikeK = A && A.phase === 'strike' ? 1 : A && A.phase === 'recover' ? Math.max(0, 1 - A.t / Math.max(0.2, A.def.recover * 0.6)) : 0;
    a.windup += (wind - a.windup) * (1 - Math.exp(-14 * dt));
    a.strike += (strikeK - a.strike) * (1 - Math.exp(-(strikeK > a.strike ? 30 : 8) * dt));
    a.attack = A?.name ?? a.attack;

    // 根：位置、朝向；地面上的四足依前後腳的地面高度傾斜
    obj.position.copy(c.draw);
    if (!c.stats.flying && !c.sp.free && !c.airborne) {
      if (c.legs) a.ground += (c.legs.groundOffset * 0.6 - a.ground) * (1 - Math.exp(-8 * dt));
      obj.position.y = ground(c.draw.x, c.draw.z) + a.ground;
      const len = (c.meta.length ?? 0) * c.scale;
      if (len > 0) {
        const fx = Math.sin(c.drawHeading) * len * 0.5;
        const fz = Math.cos(c.drawHeading) * len * 0.5;
        const pitch = -Math.atan2(ground(c.draw.x + fx, c.draw.z + fz) - ground(c.draw.x - fx, c.draw.z - fz), len);
        a.pitch += (pitch - a.pitch) * (1 - Math.exp(-8 * dt));
      }
    }
    obj.rotation.set(a.pitch, c.drawHeading, 0);
    // 死亡：倒向一側，幾秒後沉進地面
    if (!c.alive) {
      a.dead = Math.min(1, a.dead + dt / 0.7);
      obj.rotation.z = (c.sp.deathRoll ?? 1.35) * (1 - (1 - a.dead) ** 2);
      obj.position.y -= Math.max(0, c.deadT - cfg.corpseSeconds) * 0.6 * c.scale;
    }
    c.sp.pose(c, k);
    obj.updateMatrixWorld(true);
    if (c.legs) {
      if (teleported || !c.planted) {
        c.legs.plant(obj, ground);
        c.planted = true;
      }
      if (!ik) c.planted = false; // 太遠：腳維持靜止姿勢，靠近時重新踩地
      else {
        if (c.alive || a.dead < 1) c.legs.update(dt, obj, c.fvx, c.fvz, c.legGround ?? ground, c.scale);
        if (c.alive) c.legs.solve(c.scale);
      }
      c.sp.afterIK?.(c, k);
    }
  }

  // 頭上的 !（警覺）、?（跟丟了）、*（暈眩）：面向鏡頭的小片，遠處放大到固定格數
  function updateMark(c, cam, layout) {
    if (!c.mark || !c.alive) return;
    if (!c.markMesh) {
      c.markMesh = new THREE.Mesh(markGeometry, markMaterials.alert);
      c.markMesh.layers.set(1);
      c.markMesh.frustumCulled = false;
      group.add(c.markMesh);
    }
    const mesh = c.markMesh;
    mesh.material = markMaterials[c.mark];
    mesh.visible = true;
    const head = c.headPoint ? c.headPoint(_v) : _v.set(c.draw.x, c.model.object.position.y + c.markHeight, c.draw.z);
    const d = cam.position.distanceTo(head);
    const cell = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, layout.rows);
    const size = Math.max(0.5, cfg.alertMarkCells * cell);
    mesh.position.copy(head);
    mesh.position.y += size * 0.6 + 0.2 + Math.sin(w.time * 6) * 0.04;
    mesh.quaternion.copy(cam.quaternion);
    mesh.scale.set(size, size, 1);
  }

  // HUD 上顯示的目標：最近被玩家打的，或正在追玩家、離玩家最近的
  function focusUpdate() {
    if (focus && (!focus.present || (focus.lastHitT > 8 && focus.state !== 'chase' && focus.state !== 'attack') || (!focus.alive && focus.deadT > 2.5))) focus = null;
    if (!focus) {
      let best = null;
      let bd = 30;
      for (const c of list) {
        if (!c.alive || !c.present || !c.active || (c.state !== 'chase' && c.state !== 'attack')) continue;
        const d = Math.hypot(c.pos.x - combat.player.pos.x, c.pos.z - combat.player.pos.z) - (c.stats.boss ? 40 : 0);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      focus = best;
    }
  }

  // ---- 玩家的攻擊用 ----
  // 鏡頭前方 cone 內、range 內的野怪：角度小的優先
  function pickTarget(origin, ax, az, range, cone) {
    const heading = Math.atan2(ax, az);
    let best = null;
    let score = Infinity;
    for (const c of list) {
      if (!c.alive || !c.present || !c.active || !c.model.object.visible) continue;
      const dx = c.pos.x - origin.x;
      const dz = c.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + c.radius) continue;
      const da = Math.abs(wrap(Math.atan2(dx, dz) - heading));
      if (da > cone + Math.atan2(c.radius, Math.max(d, 0.1))) continue;
      const s = da * 6 + d * 0.05 - (c === focus ? 0.3 : 0);
      if (s < score) {
        score = s;
        best = c;
      }
    }
    return best;
  }
  // 範圍攻擊：shape 以 origin、heading 為準；opts.y 給定時要在高度範圍內（地面上的爆炸打不到天上的飛龍）
  function hitArea(origin, heading, shape, damage, element, opts = {}) {
    let n = 0;
    const py = opts.y ?? combat.player.pos.y + 1;
    for (const c of list) {
      if (!c.alive || !c.present || !c.active) continue;
      if (!shapeContains(shape, heading, c.pos.x - origin.x, c.pos.z - origin.z, c.radius)) continue;
      const top = c.pos.y + c.aimHeight * 2 + 1;
      if (!opts.vertical && (py < c.pos.y - 1.5 || py > top + 1.5)) continue;
      hurt(c, damage, element, opts);
      n++;
    }
    return n;
  }

  // 玩家倒下：追擊中的全部放棄
  function playerDown() {
    for (const c of list) if (c.alive && (c.state === 'chase' || c.state === 'attack' || c.state === 'alert')) brain.giveUp(c);
  }

  // ---- 狼的細線毛髮：沿背脊、頸部的鬃毛與尾巴，跟著骨頭移動，被風與動作往後吹 ----
  const furLines = {
    emit(push) {
      if (!camera) return;
      for (const c of list) {
        const fur = c.meta.fur;
        if (!fur || !c.model.object.visible) continue;
        if (camera.position.distanceTo(c.draw) > 26) continue;
        if (!c.furPoints) c.furPoints = fur.map((f) => ({ ...f, at: c.model.attach(f.bone, f.root), dir: f.dir.clone() }));
        const style = c.isAlpha ? lineStyle.wolfAlphaFur : lineStyle.wolfFur;
        const bone = c.model.bones;
        const wind = deps.weather.wind;
        for (const f of c.furPoints) {
          f.at(_v);
          const q = bone[f.bone].getWorldQuaternion(_q);
          _d.copy(f.dir).applyQuaternion(q).multiplyScalar(f.len * c.scale);
          const sway = Math.sin(w.time * 3 + f.phase) * 0.25;
          const bx = _v.x + _d.x - c.fvx * 0.012 + wind.x * wind.strength * 0.015 * (1 + sway);
          const by = _v.y + _d.y;
          const bz = _v.z + _d.z - c.fvz * 0.012 + wind.z * wind.strength * 0.015 * (1 + sway);
          const mx = (_v.x + bx) / 2 + _d.x * 0.15;
          const my = (_v.y + by) / 2 + _d.y * 0.15;
          const mz = (_v.z + bz) / 2 + _d.z * 0.15;
          push(_v.x, _v.y, _v.z, mx, my, mz, style, true);
          push(mx, my, mz, bx, by, bz, style, false);
        }
      }
    },
  };
  const _q = new THREE.Quaternion();
  const _d = new THREE.Vector3();

  // 其他野怪的細線（熊暴走的白氣、飛龍的冰息…）：species 的 emit(c, push, lineStyle)
  const speciesLines = {
    emit(push) {
      for (const c of list) if (c.model.object.visible && c.sp.emit) c.sp.emit(c, push, lineStyle, w);
    },
  };

  if (cfg.enabled) place();

  return {
    group,
    list,
    stats,
    lines: [furLines, speciesLines],
    bindHud(h) {
      hud = h;
    },
    get focus() {
      return focus;
    },
    fixedUpdate,
    frame,
    pickTarget,
    hitArea,
    hurt,
    playerDown,
    multiplier,
  };
}
