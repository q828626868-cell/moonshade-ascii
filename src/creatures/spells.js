// 法術（快捷鍵 1–5，手機是右下角的技能鈕）：每招有冷卻與魔力消耗，騎馬時也能施放（引導技「雷暴」除外）。
//   1 火球術：朝準星飛出，撞到野怪、地面或障礙物爆炸（半徑 3 m），被炸到的燃燒；按住蓄力，火球與爆炸變大
//     快速連按兩下：地獄業火——引導 13 秒，頭上的火球越來越大，時間到自動朝準星發射，爆炸範圍很大、留下一片火海
//   2 連鎖雷法：瞬間打中準星下（或鎖定）的敵人，再跳到 8 m 內最多 4 個敵人；打到濕的目標傷害 ×2
//   3 冰霜新星：以自己為中心爆開的冰環，凍住範圍內的敵人 2 秒（菁英、世界王比較短）
//   4 風刃：前方扇形的風壓，擊退敵人、打斷蓄力中的攻擊
//   5 雷暴（大招）：指定區域天空轉暗，5 秒內隨機落下 12 道閃電（下雨時 ×2）；引導期間走得慢、不能放其他招，翻滾或上馬就中斷
// 另外：翻滾迴避（無敵 0.3 秒）、Tab 鎖定最近的敵人。
// 操作的流程：begin（按下：開始蓄力、選範圍，或手機上開始拖曳瞄準）→ release（放開：施放）；cancel 取消。
// 瞄準（aim）由 main.js 每幀算好傳進來：{ point（世界座標）, creature（瞄到的野怪或 null）, dirX, dirZ（水平方向）}
import * as THREE from 'three';
import { createHellfire } from './hellfire.js';

const KINDS = ['fireball', 'chain', 'nova', 'wind', 'storm'];

export function createSpells(cfg, deps) {
  const { combat, creatures, terrain, physics, weather, rng, proxy, traveler, character, materials } = deps;
  // 地獄業火的演出、飛行與爆炸（creatures/hellfire.js）
  const hell = createHellfire(cfg.hellfire, { combat, creatures, terrain, physics, rng, character, materials, proxy, rig: deps.rig, camera: deps.rig.camera, audio: deps.audio });
  let dimBase = 0; // 天色（不含爆炸的白光）
  const player = combat.player;
  const tele = combat.telegraphs;
  const state = {
    mp: cfg.mp,
    cooldowns: Object.fromEntries([...KINDS, 'hellfire'].map((k) => [k, 0])),
    tap: null, // 點一下火球：等一下看會不會按第二下（地獄業火）；{ aim, t }
    lastAim: { point: new THREE.Vector3(), creature: null, dirX: 0, dirZ: -1 }, // 最新的瞄準（引導結束時朝這裡發射）
    pending: null, // 按住中的法術：{ kind, t }（火球的蓄力時間、雷暴選範圍、手機拖曳）
    channel: null, // 雷暴：{ x, z, t, times[], next }
    lock: null, // Tab 鎖定的野怪
    roll: { t: -1, cooldown: 0 },
    castT: 99, // 上次施放後經過的秒數（人物面向準星、舉手的動作）
    lastCast: null,
  };
  const msg = (text) => combat.hud?.message(text);
  const hand = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // ---- 瞄準：鏡頭中央的射線 → 第一個碰到的野怪、地面、水面或障礙物 ----
  const ray = new THREE.Vector3();
  function resolveAim(camera, out) {
    camera.getWorldDirection(ray);
    const o = camera.position;
    // 從玩家附近開始算（鏡頭與人物之間的東西不算）
    const minT = Math.max(0, (player.pos.x - o.x) * ray.x + (player.pos.y + 1 - o.y) * ray.y + (player.pos.z - o.z) * ray.z);
    const maxT = minT + cfg.aimRange;
    let t = maxT;
    let creature = null;
    if (state.lock && valid(state.lock)) creature = state.lock;
    else {
      const pick = creatures.rayPick(o, ray, maxT, minT, 0.4);
      if (pick) {
        creature = pick.c;
        t = pick.t;
      }
    }
    // 地面與水面
    for (let s = minT; s < t; s += 0.6) {
      const x = o.x + ray.x * s;
      const y = o.y + ray.y * s;
      const z = o.z + ray.z * s;
      if (y < Math.max(terrain.heightAt(x, z), terrain.waterSurfaceAt(x, z))) {
        t = s;
        creature = state.lock && valid(state.lock) ? state.lock : null;
        break;
      }
    }
    // 樹、石頭、房屋
    tmp.copy(o).addScaledVector(ray, minT);
    const hit = physics.raycast(tmp, ray, t - minT);
    if (hit < t - minT) {
      t = minT + hit;
      if (!(state.lock && valid(state.lock))) creature = null;
    }
    if (creature) creature.aimPoint(out.point);
    else out.point.copy(o).addScaledVector(ray, t);
    out.creature = creature;
    horizontal(out);
    return out;
  }
  // 手機：從技能鈕拖曳出來的水平方向與距離（0–1 的比例）
  function dragAim(dirX, dirZ, k, range, out) {
    const p = player.pos;
    const d = Math.max(2, k * range);
    out.point.set(p.x + dirX * d, 0, p.z + dirZ * d);
    out.point.y = Math.max(terrain.heightAt(out.point.x, out.point.z), terrain.waterSurfaceAt(out.point.x, out.point.z)) + 0.5;
    // 方向附近的敵人（鎖定的優先）
    let best = state.lock && valid(state.lock) ? state.lock : null;
    if (!best) {
      let score = 0.45;
      for (const c of creatures.hostilesNear(p.x, p.z, range)) {
        const dx = c.pos.x - p.x;
        const dz = c.pos.z - p.z;
        const a = Math.abs(Math.atan2(dirX * dz - dirZ * dx, dirX * dx + dirZ * dz));
        if (a < score) {
          score = a;
          best = c;
        }
      }
    }
    out.creature = best;
    if (best && k > 0.05) best.aimPoint(out.point);
    horizontal(out);
    return out;
  }
  function horizontal(out) {
    const dx = out.point.x - player.pos.x;
    const dz = out.point.z - player.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    out.dirX = dx / l;
    out.dirZ = dz / l;
    out.dist = l;
  }
  const valid = (c) => c.alive && c.present && c.active && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < cfg.lockRange * 1.3;

  // ---- 能不能放 ----
  function check(kind, cost) {
    if (!player.alive) return false;
    if (state.channel) {
      msg(`引導${cfg[state.channel.kind].name}中，不能施放其他法術`);
      return false;
    }
    if (state.cooldowns[kind] > 0) {
      msg(`${cfg[kind].name}冷卻中（${state.cooldowns[kind].toFixed(1)} 秒）`);
      return false;
    }
    if (cfg[kind].channel && player.riding) {
      msg(`騎馬時不能施放${cfg[kind].name}（引導技）`);
      return false;
    }
    if (state.mp < cost) {
      msg('魔力不足');
      return false;
    }
    return true;
  }
  function spend(kind, cost) {
    state.mp -= cost;
    state.cooldowns[kind] = cfg[kind].cooldown;
    state.castT = 0;
    state.lastCast = kind;
  }
  function handPoint(out) {
    character.bones.handR.getWorldPosition(out);
    return out;
  }

  // ---- 1 火球術 ----
  const fireballs = [];
  const ballGeometry = new THREE.IcosahedronGeometry(0.35, 1);
  function chargeOf(t) {
    const C = cfg.fireball.charge;
    return Math.min(1, t / C.seconds);
  }
  function castFireball(aim, t) {
    const F = cfg.fireball;
    let k = chargeOf(t);
    // 魔力不夠蓄滿：蓄到夠用的程度
    if (state.mp < F.cost + F.charge.cost * k) k = Math.max(0, (state.mp - F.cost) / F.charge.cost);
    spend('fireball', F.cost + F.charge.cost * k);
    const from = handPoint(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(aim.point, from);
    if (dir.lengthSq() < 0.01) dir.set(aim.dirX, 0, aim.dirZ);
    dir.normalize();
    const size = 1 + (F.charge.size - 1) * k;
    const mesh = new THREE.Mesh(ballGeometry, materials.get('fireBolt'));
    mesh.scale.setScalar(size);
    mesh.layers.set(1);
    mesh.position.copy(from);
    combat.group.add(mesh);
    fireballs.push({
      pos: from,
      prev: from.clone(),
      dir,
      size,
      speed: F.speed,
      range: F.range,
      radius: F.radius + (F.charge.radius - F.radius) * k,
      damage: F.damage * (1 + (F.charge.damage - 1) * k),
      burnSeconds: F.burn.seconds,
      burnDps: F.burn.dps * (1 + k),
      travelled: 0,
      mesh,
    });
  }

  // ---- 地獄業火（連按兩下 1）----
  function hellfireReady(quiet) {
    const H = cfg.hellfire;
    const why = !player.alive ? '' : state.channel ? '引導中' : player.riding ? `騎馬時不能施放${H.name}（引導技）` : state.cooldowns.hellfire > 0 ? `${H.name}冷卻中（${Math.ceil(state.cooldowns.hellfire)} 秒）` : state.mp < H.cost ? `魔力不足（${H.name}需要 ${H.cost}）` : null;
    if (why && !quiet) msg(why);
    return why === null;
  }
  let lastFireballPress = -1e9; // 上次按下火球的時間（連按兩下）
  function startHellfire() {
    const H = cfg.hellfire;
    hell.start();
    state.channel = { kind: 'hellfire', t: 0, guide: null, key: '', launched: false };
    player.moveScale = H.moveScale;
    msg(`${H.name}：蓄力 ${H.charge} 秒（翻滾會中斷）`);
  }
  function castHellfire(aim) {
    const H = cfg.hellfire;
    state.mp -= H.cost;
    state.cooldowns.hellfire = H.cooldown;
    state.castT = 0;
    state.lastCast = 'hellfire';
    state.channel.launched = true;
    hell.launch(aim);
    msg(`${H.name}！`);
  }
  function stepFireballs(dt) {
    const F = cfg.fireball;
    for (const b of [...fireballs]) {
      const step = b.speed * dt;
      b.prev.copy(b.pos);
      let hitT = step;
      let water = false;
      let hit = false; // 撞到東西（撞在這一步的終點時 hitT 不會變，所以另外記）
      // 野怪
      const pick = creatures.rayPick(b.pos, b.dir, step, 0, 0.3 * b.size);
      if (pick) {
        hitT = pick.t;
        hit = true;
      }
      // 樹、石頭、房屋
      const wall = physics.raycast(b.pos, b.dir, hitT);
      if (wall < hitT) {
        hitT = wall;
        hit = true;
      }
      // 地面、水面（逐段檢查）
      const samples = Math.max(1, Math.ceil(hitT / 0.4)); // 一定包含這一步的終點
      for (let i = 1; i <= samples; i++) {
        const s = (hitT * i) / samples;
        const x = b.pos.x + b.dir.x * s;
        const y = b.pos.y + b.dir.y * s;
        const z = b.pos.z + b.dir.z * s;
        const ground = terrain.heightAt(x, z);
        const surface = terrain.waterSurfaceAt(x, z);
        if (y < Math.max(ground, surface)) {
          hitT = s;
          water = surface > ground && y < surface;
          hit = true;
          break;
        }
      }
      b.pos.addScaledVector(b.dir, hitT);
      b.travelled += hitT;
      if (b.travelled >= b.range) hit = true;
      if (rng.next() < 0.8) combat.effect({ kind: 'spark', style: combat.lineStyle.ember, x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: rng.range(-0.6, 0.6), vy: rng.range(0, 1), vz: rng.range(-0.6, 0.6), t: 0, life: 0.3, long: 0.15 });
      if (hit) explode(b, water);
    }
  }
  function explode(b, water) {
    const F = cfg.fireball;
    combat.group.remove(b.mesh);
    fireballs.splice(fireballs.indexOf(b), 1);
    const { x, y, z } = b.pos;
    if (water) {
      // 落進水裡：一陣白煙，沒有爆炸
      combat.sparks(x, y, z, 12, 'frost', 2);
      return;
    }
    creatures.hitArea({ x, z, y }, 0, { type: 'circle', radius: b.radius }, b.damage, 'fire', {
      y,
      onHit: (c) => creatures.burn(c, b.burnSeconds, b.burnDps),
    });
    combat.sparks(x, y, z, 24 + Math.round(b.size * 10), 'ember', 4 + b.size * 2);
    burst(x, z, b.radius, 'fireBolt', 0.3);
    combat.burnWebs(x, z, b.radius);
    if (y - terrain.heightAt(x, z) < 1.5) combat.addFire(x, z, F.groundFire, 1, true);
  }

  // 往外擴散的一圈（爆炸、冰霜新星）
  const bursts = [];
  function burst(x, z, radius, material, seconds) {
    bursts.push({ x, z, radius, t: 0, seconds, mesh: tele.ringMesh(material) });
  }

  // ---- 2 連鎖雷法 ----
  function castChain(aim) {
    const C = cfg.chain;
    let first = aim.creature;
    if (first && Math.hypot(first.pos.x - player.pos.x, first.pos.z - player.pos.z) > C.range) first = null;
    if (!first) {
      msg('準星下沒有敵人');
      return false;
    }
    spend('chain', C.cost);
    const hits = [first];
    while (hits.length <= C.jumps) {
      const last = hits[hits.length - 1];
      const next = creatures.hostilesNear(last.pos.x, last.pos.z, C.jumpRange).find((c) => !hits.includes(c));
      if (!next) break;
      hits.push(next);
    }
    let from = handPoint(new THREE.Vector3());
    hits.forEach((c, i) => {
      const to = c.aimPoint(new THREE.Vector3());
      combat.arc(from.x, from.y, from.z, to.x, to.y, to.z);
      combat.sparks(to.x, to.y, to.z, 6, 'lightning', 3);
      creatures.hurt(c, C.damage * C.falloff ** i, 'thunder', { wetBonus: C.wet });
      from = to;
    });
    return true;
  }

  // ---- 3 冰霜新星 ----
  function castNova() {
    const N = cfg.nova;
    spend('nova', N.cost);
    const p = player.pos;
    burst(p.x, p.z, N.radius, 'iceShard', N.expand);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      combat.effect({ kind: 'spark', style: combat.lineStyle.frost, x: p.x + Math.sin(a) * 0.6, y: p.y + 0.4, z: p.z + Math.cos(a) * 0.6, vx: (Math.sin(a) * N.radius) / N.expand, vy: 0.5, vz: (Math.cos(a) * N.radius) / N.expand, t: 0, life: N.expand, long: 0.06 });
    }
    creatures.hitArea(p, 0, { type: 'circle', radius: N.radius }, N.damage, 'ice', {
      onHit: (c) => {
        if (!c.alive || creatures.multiplier(c, 'ice') === 0) return;
        creatures.freeze(c, c.stats.boss ? N.bossFreeze : c.stats.elite ? N.eliteFreeze : N.freeze);
      },
    });
  }

  // ---- 4 風刃 ----
  function castWind(aim) {
    const W = cfg.wind;
    spend('wind', W.cost);
    const heading = Math.atan2(aim.dirX, aim.dirZ);
    combat.gust(player.pos.x, player.pos.y + 1, player.pos.z, heading, W.angle, W.range, 22);
    creatures.hitArea(player.pos, heading, { type: 'cone', radius: W.range, angle: W.angle }, W.damage, 'wind', {
      knock: W.knock,
      onHit: (c) => {
        if (creatures.interrupt(c, W.interruptStun)) msg(`打斷了${c.name}的攻擊`);
      },
    });
  }

  // ---- 5 雷暴（引導技）----
  function stormPoint(aim, out) {
    const S = cfg.storm;
    const dx = aim.point.x - player.pos.x;
    const dz = aim.point.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    const k = d > S.range ? S.range / d : 1;
    out.x = player.pos.x + dx * k;
    out.z = player.pos.z + dz * k;
    return out;
  }
  function castStorm(aim) {
    const S = cfg.storm;
    spend('storm', S.cost);
    const c = stormPoint(aim, { x: 0, z: 0 });
    const count = Math.round(S.bolts * (weather.rain > 0.05 ? S.rainMultiplier : 1));
    const times = Array.from({ length: count }, () => rng.range(0.25, S.seconds)).sort((a, b) => a - b);
    state.channel = { kind: 'storm', x: c.x, z: c.z, t: 0, times, next: 0, guide: tele.guide({ type: 'circle', radius: S.radius }, c.x, c.z, 0) };
    player.moveScale = S.moveScale;
    msg(count > S.bolts ? `雷暴（下雨，${count} 道閃電）` : '雷暴');
  }
  function endChannel() {
    const ch = state.channel;
    if (!ch) return;
    ch.guide?.remove();
    if (ch.kind === 'hellfire' && !ch.launched) hell.cancel();
    state.channel = null;
    player.moveScale = 1;
  }
  function stepChannel(dt) {
    const ch = state.channel;
    const S = cfg.storm;
    // 翻滾、上馬、倒下：中斷
    if (!player.alive || traveler.mode !== 'foot') {
      msg(ch.kind === 'hellfire' ? `${cfg.hellfire.name}中斷了` : '雷暴中斷了');
      endChannel();
      return;
    }
    ch.t += dt;
    if (ch.kind === 'hellfire') {
      hell.charge(Math.min(1, ch.t / cfg.hellfire.charge));
      if (ch.t >= cfg.hellfire.charge) {
        castHellfire(state.lastAim);
        endChannel();
      }
      return;
    }
    while (ch.next < ch.times.length && ch.times[ch.next] <= ch.t) {
      ch.next++;
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * S.radius;
      const x = ch.x + Math.cos(a) * r;
      const z = ch.z + Math.sin(a) * r;
      const y = Math.max(terrain.heightAt(x, z), terrain.waterSurfaceAt(x, z));
      combat.bolt(x, y, z);
      creatures.hitArea({ x, z, y }, 0, { type: 'circle', radius: S.boltRadius }, S.damage, 'thunder', { y, vertical: true, wetBonus: cfg.chain.wet });
    }
    if (ch.t >= S.seconds) endChannel();
  }

  // ---- 按下／放開 ----
  // 火球：按住蓄力；雷暴：按住選範圍；其他：手機上按住時預覽範圍，鍵盤上按下就放（main.js 連著呼叫 begin、release）
  function begin(kind) {
    // 連按兩下 1：地獄業火（不管普通火球是不是在冷卻）
    if (kind === 'fireball') {
      const now = performance.now();
      const double = now - lastFireballPress < cfg.hellfire.doubleTap * 1000;
      lastFireballPress = double ? -1e9 : now;
      if (double) {
        state.tap = null;
        if (state.pending?.kind === 'fireball') cancel();
        if (hellfireReady(false)) startHellfire();
        return false;
      }
    }
    if (state.pending) cancel();
    const cost = cfg[kind].cost;
    if (!check(kind, cost)) return false;
    state.pending = { kind, t: 0, guide: null, key: '' };
    return true;
  }
  function release(kind, aim) {
    const p = state.pending;
    if (!p || p.kind !== kind) return false;
    clearGuide();
    state.pending = null;
    if (!check(kind, cfg[kind].cost)) return false;
    if (kind === 'fireball') {
      if (p.t < 0.2 && hellfireReady(true)) {
        state.tap = { aim: { point: aim.point.clone(), creature: aim.creature, dirX: aim.dirX, dirZ: aim.dirZ }, t: 0 };
        return true;
      }
      castFireball(aim, p.t);
    }
    else if (kind === 'chain') return castChain(aim);
    else if (kind === 'nova') castNova();
    else if (kind === 'wind') castWind(aim);
    else if (kind === 'storm') castStorm(aim);
    return true;
  }
  function cancel() {
    clearGuide();
    state.pending = null;
  }
  function clearGuide() {
    state.pending?.guide?.remove();
    if (state.pending) state.pending.guide = null;
  }

  // ---- 翻滾迴避 ----
  function roll(dirX, dirZ) {
    const R = cfg.roll;
    if (!player.alive || player.riding || traveler.swimming || state.roll.cooldown > 0 || proxy.dashing) return false;
    if (state.channel) {
      msg('翻滾中斷了雷暴');
      endChannel();
    }
    const l = Math.hypot(dirX, dirZ) || 1;
    const speed = R.distance / R.seconds;
    proxy.dash((dirX / l) * speed, (dirZ / l) * speed, R.seconds);
    player.invulnerable = Math.max(player.invulnerable, R.invulnerable);
    state.roll.t = 0;
    state.roll.cooldown = R.cooldown;
    return true;
  }

  // ---- 鎖定 ----
  function lockNext() {
    const list = creatures.hostilesNear(player.pos.x, player.pos.z, cfg.lockRange).filter((c) => c.model.object.visible);
    if (!list.length) {
      state.lock = null;
      msg('附近沒有敵人');
      return;
    }
    const i = state.lock ? list.indexOf(state.lock) : -1;
    if (i >= 0 && list.length === 1) state.lock = null; // 只有一隻：再按一下解除
    else state.lock = list[(i + 1) % list.length];
  }

  // ---- 每個固定步長 ----
  function fixedUpdate(dt) {
    state.mp = Math.min(cfg.mp, state.mp + cfg.mpRegen * dt);
    for (const k in state.cooldowns) state.cooldowns[k] = Math.max(0, state.cooldowns[k] - dt);
    state.roll.cooldown = Math.max(0, state.roll.cooldown - dt);
    if (state.roll.t >= 0 && (state.roll.t += dt) > cfg.roll.seconds) state.roll.t = -1;
    state.castT += dt;
    if (state.pending) state.pending.t += dt;
    // 點一下的火球：沒等到第二下就照常發射
    if (state.tap && (state.tap.t += dt) > cfg.hellfire.doubleTap) {
      const tap = state.tap;
      state.tap = null;
      if (check('fireball', cfg.fireball.cost)) castFireball(tap.aim, 0);
    }
    if (state.lock && !valid(state.lock)) state.lock = null;
    if (!player.alive) {
      cancel();
      endChannel();
      state.lock = null;
    }
    stepFireballs(dt);
    if (state.channel) stepChannel(dt);
    hell.fixedUpdate(dt);
  }

  // ---- 每幀：火球的位置、擴散的環、瞄準時地上的範圍、雷暴的天色與雨 ----
  function frame(dt, aim) {
    for (const b of fireballs) {
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y += dt * 8;
      b.mesh.scale.setScalar(b.size * (1 + 0.12 * Math.sin(performance.now() / 50)));
    }
    for (const r of [...bursts]) {
      r.t += dt;
      const k = Math.min(1, r.t / r.seconds);
      r.mesh.set(r.x, r.z, r.radius * (0.15 + 0.85 * k), 0.8 * (1 - k) + 0.3);
      if (r.t > r.seconds + 0.15) {
        r.mesh.remove();
        bursts.splice(bursts.indexOf(r), 1);
      }
    }
    updateGuide(aim);
    state.lastAim.point.copy(aim.point);
    state.lastAim.creature = aim.creature;
    state.lastAim.dirX = aim.dirX;
    state.lastAim.dirZ = aim.dirZ;
    const ch = state.channel;
    hell.frame(dt);
    if (ch?.kind === 'hellfire') {
      // 地上的爆炸範圍跟著準星
      const key = `${Math.round(aim.point.x * 3)},${Math.round(aim.point.z * 3)}`;
      if (key !== ch.key) {
        ch.key = key;
        ch.guide?.remove();
        ch.guide = tele.guide({ type: 'circle', radius: cfg.hellfire.radius }, aim.point.x, aim.point.z, 0);
      }
    }
    // 雷暴：天色轉暗、區域裡下著雨
    dimBase += ((ch?.kind === 'storm' ? cfg.storm.dim : 0) + hell.dim - dimBase) * (1 - Math.exp(-3 * dt));
    weather.dim = dimBase + hell.flash;
    if (ch?.kind === 'storm') {
      const S = cfg.storm;
      for (let i = 0; i < 6; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * S.radius;
        const x = state.channel.x + Math.cos(a) * r;
        const z = state.channel.z + Math.sin(a) * r;
        combat.effect({ kind: 'spark', style: combat.lineStyle.wind, x, y: terrain.heightAt(x, z) + rng.range(2, 9), z, vx: weather.wind.x * 2, vy: -16, vz: weather.wind.z * 2, t: 0, life: 0.35, long: 0.05 });
      }
    }
  }
  // 地上的範圍（只在範圍或位置改變時重建）
  function updateGuide(aim) {
    const p = state.pending;
    if (!p) return;
    let shape = null;
    let x = 0;
    let z = 0;
    let heading = 0;
    if (p.kind === 'fireball') {
      const F = cfg.fireball;
      shape = { type: 'circle', radius: F.radius + (F.charge.radius - F.radius) * chargeOf(p.t) };
      x = aim.point.x;
      z = aim.point.z;
    } else if (p.kind === 'storm') {
      shape = { type: 'circle', radius: cfg.storm.radius };
      const c = stormPoint(aim, { x: 0, z: 0 });
      x = c.x;
      z = c.z;
    } else if (p.kind === 'nova') {
      shape = { type: 'circle', radius: cfg.nova.radius };
      x = player.pos.x;
      z = player.pos.z;
    } else if (p.kind === 'wind') {
      shape = { type: 'cone', radius: cfg.wind.range, angle: cfg.wind.angle };
      x = player.pos.x;
      z = player.pos.z;
      heading = Math.atan2(aim.dirX, aim.dirZ);
    } else return;
    const key = `${Math.round(x * 5)},${Math.round(z * 5)},${Math.round(heading * 20)},${shape.radius.toFixed(1)}`;
    if (key === p.key) return;
    p.key = key;
    p.guide?.remove();
    p.guide = tele.guide(shape, x, z, heading);
  }

  return {
    state,
    kinds: KINDS,
    resolveAim,
    dragAim,
    begin,
    release,
    cancel,
    roll,
    lockNext,
    fixedUpdate,
    frame,
    lines: hell.lines, // 地獄業火的魔法陣與火環（細線層）
    // 給 HUD 與手機按鈕
    get charge() {
      return state.pending?.kind === 'fireball' ? chargeOf(state.pending.t) : -1;
    },
    get channel() {
      const ch = state.channel;
      return ch ? ch.t / (ch.kind === 'hellfire' ? cfg.hellfire.charge : cfg.storm.seconds) : -1;
    },
    // 引導中的法術（HUD 的引導條）：'storm' | 'hellfire' | null
    get channelKind() {
      return state.channel?.kind ?? null;
    },
    get rolling() {
      return state.roll.t >= 0 ? state.roll.t / cfg.roll.seconds : -1;
    },
    get stats() {
      return { fireballs: fireballs.length, bursts: bursts.length };
    },
  };
}
