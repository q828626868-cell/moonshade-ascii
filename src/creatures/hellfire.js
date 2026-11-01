// 地獄業火（連按兩下 1 的彩蛋）：三幕的演出。
//   一、蓄力（13 秒）：腳下浮現旋轉的六芒星魔法陣；天色越來越暗、地面越震越厲害；火焰從四周捲進頭上的火球，
//       火球從拳頭大長到 6 m，三道火環繞著它轉；後段有閃電劈向地面；蓄到 1/3、2/3 時各爆出一圈震波；低沉的轟鳴越來越大
//   二、發射：後座力把人往後推、腳下爆出一圈衝擊波、畫面一閃、一聲呼嘯；火球壓縮成一半大小（能量凝聚），緩緩飛出，沿路在地上留下一道火
//   三、爆炸：白光一閃；火球膨脹成整個爆炸範圍的火焰穹頂；三道震波往外掃過 30 m；火柱沖天、頂端翻成蕈狀雲；
//       幾百顆火星與碎石噴飛；鏡頭劇烈搖晃（離越近越強）、低沉的爆炸聲；地上留下一片火海，煙柱很久才散
// spells.js 管引導（能不能放、中斷、魔力），這裡只管演出、飛行與爆炸的傷害。
import * as THREE from 'three';

const ease = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export function createHellfire(cfg, deps) {
  const { combat, creatures, terrain, physics, rng, character, materials, rig, audio, proxy, camera } = deps;
  const tele = combat.telegraphs;
  const style = combat.lineStyle;
  const group = combat.group;
  const mat = (name) => materials.get(name);
  const noShadow = (m) => {
    m.layers.set(1);
    m.frustumCulled = false;
    return m;
  };

  // 火球：內核（fireBolt）+ 外層會轉的尖刺殼（flame）
  const ball = new THREE.Group();
  const core = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat('fireBolt')));
  const shell = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(1.12, 0), mat('flame')));
  ball.add(core, shell);
  ball.visible = false;
  group.add(ball);
  const light = { x: 0, y: 0, z: 0, radius: 8, power: 1.5, flicker: 0.3, phase: 0, fire: true };
  const flashLight = { x: 0, y: 0, z: 0, radius: 50, power: 0, flicker: 0.1, phase: 1, fire: true };

  let charging = false;
  let k = 0; // 蓄力進度 0–1
  let pulses = 0; // 已經爆過幾次震波（1/3、2/3）
  let arcT = 0;
  let spin = 0;
  let size = 0.5;
  let shot = null; // 飛行中的火球
  const blasts = []; // 爆炸的演出
  const bursts = []; // 往外擴散的環
  let flash = 0; // 天色：負值 = 變亮（爆炸的白光）
  let shakeHold = 0;
  const v = new THREE.Vector3();

  const ground = (x, z) => Math.max(terrain.heightAt(x, z), terrain.waterSurfaceAt(x, z));
  function ring(x, z, radius, material, seconds, width = 1.2) {
    bursts.push({ x, z, radius, seconds, width, t: 0, mesh: tele.ringMesh(material) });
  }
  function addLight(l) {
    if (!combat.lights.includes(l)) combat.lights.push(l);
  }
  function removeLight(l) {
    const i = combat.lights.indexOf(l);
    if (i >= 0) combat.lights.splice(i, 1);
  }
  // 鏡頭離某點越近搖得越厲害
  function shakeAt(x, z, amp, range) {
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    rig.shake(amp * Math.max(0.12, 1 - d / range));
  }

  // ---- 一、蓄力 ----
  function start() {
    charging = true;
    k = 0;
    pulses = 0;
    size = 0.5;
    ball.visible = true;
    addLight(light);
  }
  function cancel() {
    if (!charging) return;
    charging = false;
    ball.visible = false;
    removeLight(light);
    audio.charge(-1);
    combat.sparks(ball.position.x, ball.position.y, ball.position.z, 30, 'ember', 5);
  }
  // 每個固定步長（spells.js 的引導）：progress 0–1
  function charge(progress) {
    k = progress;
    // 1/3、2/3：腳下爆出一圈震波
    const beat = Math.floor(k * 3);
    if (beat > pulses && beat < 3) {
      pulses = beat;
      const p = character.object.position;
      ring(p.x, p.z, 9 + 4 * beat, 'flame', 0.6, 1.4);
      combat.sparks(p.x, p.y + 0.3, p.z, 40, 'ember', 7);
      rig.shake(0.35 + 0.2 * beat);
      combat.hud?.message(beat === 1 ? '大地開始震動……' : '魔力匯聚到極限……');
    }
    // 後段：閃電劈向地面
    if (k > 0.45 && (arcT -= 1 / 60) <= 0) {
      arcT = 0.15 + (1 - k) * 0.6 * rng.next();
      const a = rng.next() * Math.PI * 2;
      const r = rng.range(2, 7);
      const p = ball.position;
      const gx = p.x + Math.cos(a) * r;
      const gz = p.z + Math.sin(a) * r;
      const gy = ground(gx, gz);
      combat.arc(p.x + Math.cos(a) * size * 0.8, p.y, p.z + Math.sin(a) * size * 0.8, gx, gy, gz);
      combat.sparks(gx, gy + 0.1, gz, 6, 'lightning', 3);
    }
  }

  // ---- 二、發射 ----
  function launch(aim) {
    charging = false;
    removeLight(light);
    audio.charge(-1);
    audio.launch();
    const from = ball.position.clone();
    // 瞄準地面時讓火球的底部（不是中心）落在準星上：飛行中的半徑約 size × 0.55
    const target = aim.point.clone();
    if (!aim.creature) target.y += size * 0.55;
    const dir = new THREE.Vector3().subVectors(target, from);
    if (dir.lengthSq() < 0.01) dir.set(aim.dirX, -0.2, aim.dirZ);
    dir.normalize();
    // 發射時火球壓縮成一半大小（能量凝聚），飛行中的半徑約 3 m，底部離地夠高，會飛到準星附近才落地
    shot = { pos: from, dir, travelled: 0, trail: 0, from: size, t: 0 };
    addLight(light);
    // 後座力、衝擊波、白光
    proxy.shove(-dir.x * 7, -dir.z * 7);
    const p = character.object.position;
    ring(p.x, p.z, 14, 'flame', 0.45, 1.6);
    ring(p.x, p.z, 8, 'fireBolt', 0.3, 1);
    combat.sparks(from.x, from.y, from.z, 80, 'ember', 10);
    rig.shake(0.8);
    flash = Math.min(flash, -0.45);
  }

  // ---- 每個固定步長：飛行 ----
  function fixedUpdate(dt) {
    if (!shot) return;
    const step = cfg.speed * dt;
    let hitT = step;
    let water = false;
    let hit = false; // 撞到東西（不能用 hitT < step 判斷：撞在這一步的終點時 hitT 不會變）
    // 火球的實際半徑（內核 = size，外層火焰再大一點）：邊緣碰到東西就爆，不會沉進地面
    shot.t += dt;
    size = shot.from * (1 - 0.5 * Math.min(1, shot.t / 0.25));
    const radius = size * 1.1;
    const pick = creatures.rayPick(shot.pos, shot.dir, step, 0, radius * 0.9);
    if (pick) {
      hitT = pick.t;
      hit = true;
    }
    const wall = physics.raycast(shot.pos, shot.dir, hitT);
    if (wall < hitT) {
      hitT = wall;
      hit = true;
    }
    // 地面：沿這一步的路徑每 0.5 m 取一點，一定包含這一步的終點（每步只走 0.27 m，從 0.5 m 開始取樣的話永遠查不到）
    const samples = Math.max(1, Math.ceil(hitT / 0.5));
    for (let i = 1; i <= samples; i++) {
      const s = (hitT * i) / samples;
      const x = shot.pos.x + shot.dir.x * s;
      const y = shot.pos.y + shot.dir.y * s - radius;
      const z = shot.pos.z + shot.dir.z * s;
      const g = terrain.heightAt(x, z);
      const w = terrain.waterSurfaceAt(x, z);
      if (y < Math.max(g, w)) {
        hitT = s;
        water = w > g;
        hit = true;
        break;
      }
    }
    shot.pos.addScaledVector(shot.dir, hitT);
    shot.travelled += hitT;
    // 沿路在地上留下一道火
    shot.trail += hitT;
    if (shot.trail > 2.5) {
      shot.trail = 0;
      const gx = shot.pos.x;
      const gz = shot.pos.z;
      if (shot.pos.y - terrain.heightAt(gx, gz) < 7 && terrain.waterDepthAt(gx, gz) < 0.05) combat.addFire(gx, gz, rng.range(3, 6), 0.8, true);
    }
    if (hit || shot.travelled >= cfg.range) {
      // 爆炸點：火球底部碰到的地面（打到野怪或障礙物時就是火球的位置）
      const at = shot.pos.clone();
      const g = ground(at.x, at.z);
      if (at.y - g < radius * 1.2) at.y = g;
      explode(at, water);
    }
  }

  // ---- 三、爆炸 ----
  function explode(at, water) {
    shot = null;
    ball.visible = false;
    removeLight(light);
    const { x, y, z } = at;
    const H = cfg;
    creatures.hitArea({ x, z, y }, 0, { type: 'circle', radius: H.radius }, H.damage, 'fire', {
      y,
      vertical: true,
      knock: H.knock,
      onHit: (c) => creatures.burn(c, H.burn.seconds, H.burn.dps),
    });
    combat.burnWebs(x, z, H.radius);
    // 白光、爆炸聲、鏡頭搖晃（離越近越強）
    flash = -1.5;
    Object.assign(flashLight, { x, y: y + 4, z, power: 9 });
    addLight(flashLight);
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    audio.boom(Math.max(0.25, 1 - d / 140));
    shakeAt(x, z, 1.6, 110);
    // 三道震波
    ring(x, z, 30, 'flame', 1.3, 2.2);
    ring(x, z, 22, 'fireBolt', 1.0, 1.6);
    ring(x, z, 15, 'telegraphEdge', 0.7, 1.2);
    // 火星、碎石、電光
    combat.sparks(x, y + 1, z, 220, 'ember', 18);
    combat.sparks(x, y + 0.5, z, 70, 'spark', 13);
    combat.sparks(x, y + 2, z, 30, 'lightning', 9);
    if (water) combat.sparks(x, y + 1, z, 120, 'frost', 10); // 打在水上：大片蒸氣
    // 火海
    if (!water) {
      for (let i = 0; i < H.fires; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = i === 0 ? 0 : Math.sqrt(rng.next()) * H.radius * 0.9;
        const fx = x + Math.cos(a) * r;
        const fz = z + Math.sin(a) * r;
        if (terrain.waterDepthAt(fx, fz) < 0.05) combat.addFire(fx, fz, H.groundFire * rng.range(0.7, 1.2), 1.4, true);
      }
    }
    // 穹頂、內核、火柱、蕈狀雲頂
    const dome = noShadow(new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat('flame')));
    const inner = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat('fireBolt')));
    const column = noShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1, 1, 12), mat('flame')));
    const cap = noShadow(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat('fireBolt')));
    const gy = terrain.heightAt(x, z);
    for (const m of [dome, inner, column, cap]) {
      m.position.set(x, gy, z);
      m.scale.setScalar(0.001);
      group.add(m);
    }
    blasts.push({ x, z, gy, t: 0, dome, inner, column, cap });
  }

  // ---- 每幀：演出 ----
  function frame(dt) {
    spin += dt * (0.6 + 2.4 * k);
    // 蓄力中的火球
    if (charging || shot) {
      if (charging) {
        size = 0.5 + (cfg.size - 0.5) * k ** 1.4;
        const top = character.object.position;
        ball.position.set(top.x, top.y + 2.2 * character.scale + 0.6 + size * 0.9, top.z);
        // 火焰從四周捲進來（越後面越多）
        for (let i = 0; i < 2 + Math.round(12 * k); i++) {
          const a = rng.next() * Math.PI * 2;
          const r = rng.range(5, 15);
          const sx = ball.position.x + Math.cos(a) * r;
          const sz = ball.position.z + Math.sin(a) * r;
          const sy = ground(sx, sz) + rng.range(0.2, 3);
          const life = rng.range(0.5, 0.9);
          const tx = -Math.sin(a) * r * 0.8; // 旋轉的切線速度
          const tz = Math.cos(a) * r * 0.8;
          combat.effect({ kind: 'spark', style: style.ember, x: sx, y: sy, z: sz, vx: (ball.position.x - sx) / life + tx, vy: (ball.position.y - sy) / life, vz: (ball.position.z - sz) / life + tz, t: 0, life, long: 0.07 });
        }
        shakeHold = 0.03 + 0.2 * k * k;
        rig.shake(shakeHold);
        audio.charge(k);
        Object.assign(light, { x: ball.position.x, y: ball.position.y, z: ball.position.z, radius: 8 + 20 * k, power: 1.5 + 4 * k });
      } else {
        ball.position.copy(shot.pos);
        Object.assign(light, { x: shot.pos.x, y: shot.pos.y, z: shot.pos.z, radius: 26, power: 5 });
        // 火焰拖尾
        for (let i = 0; i < 10; i++) {
          combat.effect({ kind: 'spark', style: i % 3 ? style.ember : style.spark, x: shot.pos.x + rng.range(-1, 1) * size * 0.5, y: shot.pos.y + rng.range(-1, 1) * size * 0.5, z: shot.pos.z + rng.range(-1, 1) * size * 0.5, vx: -shot.dir.x * 8 + rng.range(-2, 2), vy: rng.range(-1, 3), vz: -shot.dir.z * 8 + rng.range(-2, 2), t: 0, life: rng.range(0.3, 0.7), long: 0.08 });
        }
        shakeAt(shot.pos.x, shot.pos.z, 0.25, 40);
      }
      const pulse = 1 + (0.06 + 0.1 * k) * Math.sin(performance.now() / (60 - 35 * k));
      core.scale.setScalar(size * pulse);
      shell.scale.setScalar(size * (1.05 + 0.08 * Math.sin(performance.now() / 33)));
      shell.rotation.set(spin * 1.3, spin * 2.1, spin * 0.7);
      core.rotation.y = -spin;
    }
    // 往外擴散的環
    for (const b of [...bursts]) {
      b.t += dt;
      const t = Math.min(1, b.t / b.seconds);
      b.mesh.set(b.x, b.z, b.radius * ease(t), b.width * (1 - t) + 0.25);
      if (b.t > b.seconds + 0.1) {
        b.mesh.remove();
        bursts.splice(bursts.indexOf(b), 1);
      }
    }
    // 爆炸
    for (const e of [...blasts]) {
      e.t += dt;
      const t = e.t;
      const R = cfg.radius;
      // 穹頂：0.35 秒膨脹到整個爆炸範圍，接著一邊上升一邊收縮成蕈狀雲
      const grow = ease(t / 0.35);
      const shrink = Math.max(0, (t - 0.6) / 2.2);
      const domeR = R * grow * (1 - 0.65 * Math.min(1, shrink)) * (t < 3.5 ? 1 : Math.max(0, 1 - (t - 3.5) / 0.8));
      e.dome.scale.set(domeR, domeR * (0.75 - 0.25 * Math.min(1, shrink)), domeR);
      e.dome.position.y = e.gy + domeR * 0.15 + 9 * Math.min(1, shrink) ** 1.5;
      e.dome.rotation.y += dt * 0.6;
      const innerR = R * 0.7 * ease(t / 0.2) * Math.max(0, 1 - t / 1.3);
      e.inner.scale.setScalar(Math.max(0.001, innerR));
      e.inner.position.y = e.gy + innerR * 0.4;
      // 火柱：往上沖到 24 m，再慢慢變細消失
      const h = 24 * ease((t - 0.15) / 1.2);
      const colR = 2.6 * Math.max(0, 1 - Math.max(0, t - 1.4) / 3) * (t > 0.15 ? 1 : 0);
      e.column.scale.set(Math.max(0.001, colR), Math.max(0.001, h), Math.max(0.001, colR));
      e.column.position.y = e.gy + h / 2;
      // 蕈狀雲頂：火柱頂端翻開
      const capK = ease((t - 0.5) / 1.4) * Math.max(0, 1 - Math.max(0, t - 4) / 1.2);
      e.cap.scale.set(Math.max(0.001, R * 0.6 * capK), Math.max(0.001, R * 0.28 * capK), Math.max(0.001, R * 0.6 * capK));
      e.cap.position.y = e.gy + h + R * 0.12 * capK;
      e.cap.rotation.y -= dt * 0.8;
      // 煙柱：往上飄散的白煙（8 秒）
      if (t < 8) {
        for (let i = 0; i < 4; i++) {
          const a = rng.next() * Math.PI * 2;
          const r = rng.next() * 3;
          combat.effect({ kind: 'spark', style: style.rageSteam, x: e.x + Math.cos(a) * r, y: e.gy + rng.range(2, Math.max(3, h)), z: e.z + Math.sin(a) * r, vx: rng.range(-1, 1), vy: rng.range(2, 5), vz: rng.range(-1, 1), t: 0, life: rng.range(1, 2), long: 0.12 });
        }
        // 前兩秒：火星繼續從火柱噴出
        if (t < 2) combat.sparks(e.x, e.gy + h * rng.next(), e.z, 4, 'ember', 8);
      }
      if (t > 9) {
        for (const m of [e.dome, e.inner, e.column, e.cap]) {
          group.remove(m);
          m.geometry.dispose();
        }
        blasts.splice(blasts.indexOf(e), 1);
      }
    }
    // 白光漸漸退去
    flash *= Math.exp(-2.2 * dt);
    if (flashLight.power > 0) {
      flashLight.power = Math.max(0, flashLight.power - dt * 6);
      if (flashLight.power === 0) removeLight(flashLight);
    }
  }

  // ---- 細線：腳下的魔法陣、火球周圍的火環 ----
  const lines = {
    emit(push) {
      if (!charging) return;
      const c = character.object.position;
      const grow = 0.6 + 0.4 * ease(k * 3);
      const R1 = 3.4 * grow;
      const R2 = 4.9 * grow;
      const at = (r, a, out) => {
        out[0] = c.x + Math.cos(a) * r;
        out[2] = c.z + Math.sin(a) * r;
        out[1] = ground(out[0], out[2]) + 0.08;
        return out;
      };
      const A = [0, 0, 0];
      const B = [0, 0, 0];
      const seg = (r1, a1, r2, a2, st, first) => {
        at(r1, a1, A);
        at(r2, a2, B);
        push(A[0], A[1], A[2], B[0], B[1], B[2], st, first);
      };
      const N = 40;
      // 內外兩圈
      for (const r of [R1, R2]) for (let i = 0; i < N; i++) seg(r, (i / N) * Math.PI * 2, r, ((i + 1) / N) * Math.PI * 2, style.ember, i === 0);
      // 六芒星（兩個三角形），慢慢轉
      const starStyle = k > 0.66 ? style.lightning : style.ember;
      for (let tri = 0; tri < 2; tri++) {
        for (let i = 0; i < 3; i++) {
          const a1 = spin * 0.5 + tri * (Math.PI / 3) + (i / 3) * Math.PI * 2;
          const a2 = spin * 0.5 + tri * (Math.PI / 3) + ((i + 1) / 3) * Math.PI * 2;
          seg(R1, a1, R1, a2, starStyle, true);
        }
      }
      // 兩圈之間的符文刻痕，反方向轉
      for (let i = 0; i < 16; i++) {
        const a = -spin * 0.8 + (i / 16) * Math.PI * 2;
        seg(R1 + 0.25, a, R2 - 0.25, a + 0.12, style.ember, true);
      }
      // 火球周圍三道傾斜的火環
      const p = ball.position;
      const rr = size * 1.45;
      for (let ringI = 0; ringI < 3; ringI++) {
        const tilt = 0.5 + ringI * 0.55;
        const yaw = spin * (1 + ringI * 0.6) + ringI * 2.1;
        const st = ringI === 1 && k > 0.5 ? style.lightning : style.ember;
        let prev = null;
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          v.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
          v.applyAxisAngle(X_AXIS, tilt).applyAxisAngle(Y_AXIS, yaw);
          const q = [p.x + v.x, p.y + v.y, p.z + v.z];
          if (prev) push(prev[0], prev[1], prev[2], q[0], q[1], q[2], st, i === 1);
          prev = q;
        }
      }
    },
  };
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  return {
    start,
    cancel,
    charge,
    launch,
    fixedUpdate,
    frame,
    lines,
    // 天色：蓄力時越來越暗；爆炸的白光是負值（變亮）
    get dim() {
      return charging ? 0.55 * k : 0;
    },
    get flash() {
      return flash;
    },
    get busy() {
      return charging || !!shot;
    },
  };
}
