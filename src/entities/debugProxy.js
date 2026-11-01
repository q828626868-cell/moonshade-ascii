// 玩家的物理身體（原本的開發替身）：外形是一根有「鼻子」的柱子，平常隱藏（畫面上是人物與馬）；
// ?set=player.showProxy:true 可以顯示。setTuning() 切換尺寸與手感：下馬、游泳、騎馬各一組。
//
// 移動模型（旅人控制器每步給「想往哪個方向（世界座標）、多快」）：
//   朝向轉向想走的方向，速度只沿著朝向——所以會先轉身再前進，不會橫著滑。
//   人：轉得很快（turnRate），方向差越大速度越低（往反方向時先停下轉身）。
//   馬（vehicle）：轉彎半徑隨速度變大（turnRadius：半徑 = a + b × 速度），幾乎停著時只能慢慢轉（pivotRate）；
//     方向差超過 uTurnAngle 時先減速到 turnSpeed 再轉身，不能原地轉 180°。
//   加速、減速是線性的；放開輸入時在 brakeTime 秒內停下（至少以 minBrake m/s² 減速）。
// 跳躍時傳 lift（身體離地的高度），碰撞只算比這更高的物件（可以跳過柵欄、倒木）。
// 碰撞（physics.moveBody 回傳的接觸法線）：
//   沿障礙物表面滑過去——下一步把速度中「往表面裡面」的分量去掉，只留沿著表面的分量（不會黏在牆上越走越慢）；
//   馬還會把頭轉向沿牆的方向（slideSteer）。正面撞上（方向與法線夾角小於 headOn）才停下，
//   速度超過 impactSpeed 時發出 impact（馬抬前腳、騎士往前晃）。身體是膠囊：capsule = 軸線半長（馬沿著身體方向）。
// 陡坡：坡度接近 maxSlope 時往上的分量被擋掉一部分；超過 maxSlope 就「失去立足點」——往上完全走不動、沿坡往下滑，
//   直到回到比 maxSlope 緩 slopeBlend 的地方才恢復（所以會慢慢滑回來，不會卡在坡上不動）。
import * as THREE from 'three';
import { lerpAngle } from '../core/mathx.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

export function createDebugProxy(cfg, physics, terrain, materials) {
  const pos = new THREE.Vector3(...cfg.spawn);
  pos.y = terrain.heightAt(pos.x, pos.z);
  const prev = pos.clone();
  const renderPos = pos.clone();
  let heading = cfg.heading;
  let prevHeading = heading;
  let renderHeading = heading;
  let speed = 0; // 實際移動的速度
  let forward = 0; // 沿朝向的速度（想要的）
  let brakeFrom = 0; // 放開輸入那一刻的速度
  let wishing = false;
  let tuning = cfg;
  let slideX = 0; // 陡坡往下滑的速度
  let slideZ = 0;
  let slipping = false; // 在太陡的坡上失去立足點
  let steepness = 0;
  const touch = { active: false, x: 0, z: 0, age: 0 }; // 最近碰到的表面
  let impact = 0; // 這一步正面撞上時的速度（m/s），沒有就是 0
  const axis = { x: 0, z: 0 };
  let knockX = 0; // 被野怪擊退的速度（m/s），指數衰減
  let dashT = 0; // 翻滾：剩下的秒數與速度（期間不理輸入、沿這個方向前進）
  let dashX = 0;
  let dashZ = 0;
  let facing = null; // 沒有移動輸入時轉向這個方向（瞄準、施法時面向準星；null = 不管）
  let knockZ = 0;

  const object = new THREE.Group();
  object.name = 'debug-proxy';
  const bodyGeo = new THREE.CylinderGeometry(cfg.radius * 0.8, cfg.radius, cfg.height, 8);
  bodyGeo.translate(0, cfg.height / 2, 0);
  const noseGeo = new THREE.BoxGeometry(cfg.radius * 0.6, cfg.radius * 0.6, cfg.radius);
  noseGeo.translate(0, cfg.height * 0.8, cfg.radius);
  object.add(new THREE.Mesh(bodyGeo, materials.get('wood')), new THREE.Mesh(noseGeo, materials.get('wood')));
  object.visible = !!cfg.showProxy;

  // move：{ dirX, dirZ（想走的方向，世界座標；0 = 沒有輸入）, speed（目標速度 m/s）,
  //         speedScale（水中、上坡放慢）, maxDepth（比這深的水走不進去）, lift（跳躍時離地的高度） }
  function fixedUpdate(dt, move) {
    const T = tuning;
    const wish = Math.hypot(move.dirX, move.dirZ) > 1e-3;
    if (wishing && !wish) brakeFrom = forward;
    wishing = wish;
    let target = wish ? move.speed * (move.speedScale ?? 1) : 0;
    prev.copy(pos);
    prevHeading = heading;

    if (wish) {
      const diff = wrap(Math.atan2(move.dirX, move.dirZ) - heading);
      let maxRate = T.turnRate;
      if (T.vehicle) {
        const v = Math.max(forward, 0);
        maxRate = Math.max(T.pivotRate, v / (T.turnRadius[0] + T.turnRadius[1] * v));
        if (Math.abs(diff) > T.uTurnAngle) target = Math.min(target, T.turnSpeed); // 反向：先減速再轉身
      } else {
        target *= Math.max(0, Math.cos(diff)) ** 2; // 人：方向差越大越慢，轉過來再走
      }
      heading = wrap(heading + clamp(diff * T.turnSharpness, -maxRate, maxRate) * dt);
    }

    if (target > forward) forward = Math.min(target, forward + T.acceleration * dt);
    else {
      const rate = wish ? T.deceleration : Math.max(T.minBrake, brakeFrom / T.brakeTime);
      forward = Math.max(target, forward - rate * dt);
    }

    if (!wish && facing !== null && !T.vehicle) heading = wrap(heading + clamp(wrap(facing - heading) * T.turnSharpness, -T.turnRate, T.turnRate) * dt);
    if (dashT > 0) {
      dashT -= dt;
      forward = 0;
      heading = Math.atan2(dashX, dashZ);
    }
    let vx = Math.sin(heading) * forward;
    let vz = Math.cos(heading) * forward;

    // 陡坡：往上的分量隨坡度擋掉；超過 maxSlope 往下滑
    // 坡度以 slopeSample 公尺的範圍量（地表細碎的起伏不算陡坡）；(gx, gz) = 往下坡的方向 × 坡度
    const e = T.slopeSample;
    const gx = (terrain.heightAt(pos.x - e, pos.z) - terrain.heightAt(pos.x + e, pos.z)) / (2 * e);
    const gz = (terrain.heightAt(pos.x, pos.z - e) - terrain.heightAt(pos.x, pos.z + e)) / (2 * e);
    const gl = Math.hypot(gx, gz);
    const steep = Math.atan(gl);
    steepness = steep;
    if (gl > 1e-6 && (move.lift ?? 0) < 0.05) {
      const dx = gx / gl; // 下坡方向
      const dz = gz / gl;
      if (!slipping && steep > T.maxSlope) slipping = true;
      else if (slipping && steep < T.maxSlope - T.slopeBlend) slipping = false;
      const block = slipping ? 1 : 0.7 * smooth(T.maxSlope - T.slopeBlend, T.maxSlope, steep);
      const up = -(vx * dx + vz * dz);
      if (up > 0) {
        vx += dx * up * block;
        vz += dz * up * block;
      }
      const a = Math.max(T.minSlide, 9.8 * (Math.sin(steep) - Math.cos(steep) * T.slopeFriction));
      if (slipping) {
        slideX += dx * a * dt;
        slideZ += dz * a * dt;
      }
    }
    if (!slipping) {
      const k = Math.exp(-6 * dt);
      slideX *= k;
      slideZ *= k;
    }
    const sl = Math.hypot(slideX, slideZ);
    if (sl > T.maxSlide) {
      slideX *= T.maxSlide / sl;
      slideZ *= T.maxSlide / sl;
    }
    vx += slideX;
    vz += slideZ;
    // 擊退：直接加在速度上，約 0.3 秒內衰減
    if (dashT > 0) {
      vx = dashX;
      vz = dashZ;
    }
    vx += knockX;
    vz += knockZ;
    const kd = Math.exp(-7 * dt);
    knockX *= kd;
    knockZ *= kd;

    // 沿著上一步碰到的表面滑：去掉往表面裡面的分量
    if (touch.active) {
      const into = vx * touch.x + vz * touch.z;
      if (into < 0) {
        vx -= touch.x * into;
        vz -= touch.z * into;
      }
    }

    axis.x = Math.sin(heading) * (T.capsule ?? 0);
    axis.z = Math.cos(heading) * (T.capsule ?? 0);
    const hit = physics.moveBody(pos, vx * dt, vz * dt, T.radius, T.height, move.maxDepth, move.lift ?? 0, T.capsule ? axis : null);
    const intended = Math.hypot(vx, vz);
    speed = Math.min(Math.hypot(pos.x - prev.x, pos.z - prev.z) / dt, intended); // 推出穿透的位移不算速度

    impact = 0;
    if (hit.push > 1e-6) {
      const head = -(Math.sin(heading) * hit.nx + Math.cos(heading) * hit.nz); // 1 = 正面撞上，0 = 擦過
      if (head > T.headOn) {
        if (!touch.active && forward > T.impactSpeed) impact = forward;
        forward = Math.min(forward, speed + 0.05);
      } else if (T.vehicle && head > 0.1 && intended > 0.5) {
        // 馬：頭轉向沿牆的方向
        heading = wrap(heading + clamp(wrap(Math.atan2(vx - hit.nx * (vx * hit.nx + vz * hit.nz), vz - hit.nz * (vx * hit.nx + vz * hit.nz)) - heading), -1, 1) * T.slideSteer * dt);
      }
      touch.active = true;
      touch.x = hit.nx;
      touch.z = hit.nz;
      touch.age = 0;
    } else if ((touch.age += dt) > 0.1) touch.active = false;
    // 卡在角落（幾乎動不了）：速度降下來
    if (intended > 0.5 && speed < 0.2 * intended) forward = Math.min(forward, speed + 0.3);
  }

  function interpolate(alpha) {
    renderPos.lerpVectors(prev, pos, alpha);
    renderHeading = lerpAngle(prevHeading, heading, alpha);
    object.position.copy(renderPos);
    object.rotation.y = renderHeading;
  }

  return {
    object,
    fixedUpdate,
    interpolate,
    position: renderPos, // 渲染用（內插後）
    simPosition: pos, // 固定步長中的實際位置
    setTuning(t) {
      if (tuning.source !== t) tuning = { ...cfg, ...t, source: t };
    },
    get tuning() {
      return tuning;
    },
    // 翻滾：seconds 秒內以 (vx, vz) 前進（仍有碰撞）
    dash(vx, vz, seconds) {
      dashX = vx;
      dashZ = vz;
      dashT = seconds;
    },
    get dashing() {
      return dashT > 0;
    },
    set facing(h) {
      facing = h;
    },
    // 擊退（野怪的攻擊）：加上一個往 (vx, vz) 的速度，很快衰減
    shove(vx, vz) {
      knockX += vx;
      knockZ += vz;
    },
    teleport(x, z, h) {
      pos.set(x, terrain.heightAt(x, z), z);
      prev.copy(pos);
      renderPos.copy(pos);
      heading = prevHeading = renderHeading = h;
      forward = speed = brakeFrom = slideX = slideZ = impact = knockX = knockZ = dashT = 0;
      slipping = false;
      touch.active = false;
    },
    get heading() {
      return renderHeading;
    },
    get simHeading() {
      return heading;
    },
    get speed() {
      return speed;
    },
    // 這一步正面撞上的速度（m/s，0 = 沒有）
    get impact() {
      return impact;
    },
    // 腳下地形的坡度（弧度）
    get steepness() {
      return steepness;
    },
    // 正在往下滑的速度（陡坡）
    get sliding() {
      return Math.hypot(slideX, slideZ);
    },
  };
}
