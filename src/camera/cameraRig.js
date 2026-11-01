// 第三人稱鏡頭。yaw = 0 時鏡頭在目標 +Z 方向，往 -Z 看。
//   瞄準（setAim）：右鍵按住時拉近、看向右肩外一點、視野變窄，不自動回正；鎖定（track）：水平角慢慢轉向目標。
//   轉動：滑鼠拖曳、指標鎖定（點畫面後直接轉，Esc 退出）、右搖桿、觸控右半邊。
//   回正：放開後，若角色（或馬）在移動，延遲 recenterDelay 秒後約 2 秒內慢慢轉回身後（只轉水平方向，俯仰角保留）；靜止時不自動回正。
//   跟隨：目標點以彈簧阻尼（臨界阻尼）跟隨，水平與垂直各自的時間常數——不硬綁在角色上，
//     垂直跟得比較慢，所以不會跟著馬的步伐上下搖（目標用物理身體的位置，本來就不含步態起伏）。
//   速度感：越快鏡頭拉得越遠（speedDistance）、視野越寬（fov[0] → fov[1]）。
//   碰撞：往鏡頭方向打射線（樹、石頭、牆），並沿射線檢查地形高度，被擋住時立即拉近，離開遮擋後平滑退回。
//   縮放：滾輪，minDistance–maxDistance。
//   風景模式（toggleScenic）：拉得很遠、視野較寬，鏡頭繞著目標緩慢漂移（仍可手動轉）。
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/mathx.js';

// 臨界阻尼彈簧（Unity 的 SmoothDamp）：回傳新的值，速度存在 state.v
function smoothDamp(current, target, state, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

export function createCameraRig(cfg, renderCfg, physics, terrain) {
  const camera = new THREE.PerspectiveCamera(cfg.fov[0], 1, renderCfg.near, renderCfg.far);
  const pivot = new THREE.Vector3();
  const springs = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };
  const dir = new THREE.Vector3();
  const probe = new THREE.Vector3();

  let yaw = cfg.yaw;
  let pitch = cfg.pitch;
  let yawGoal = yaw;
  let pitchGoal = pitch;
  let distance = cfg.distance;
  let distanceGoal = distance;
  let actualDistance = distance;
  let idle = Infinity;
  let snapped = false;
  let pivotHeight = cfg.pivotHeight;
  let scale = 1;
  let speedFactor = 0;
  let scenic = false;
  let scenicBlend = 0;
  let aiming = false; // 右鍵按住瞄準：拉近、鏡頭移到右肩後、視野變窄
  let aimBlend = 0;
  let trackYaw = null; // Tab 鎖定時：鏡頭慢慢轉向目標（null = 不追）
  const right = new THREE.Vector3();
  const look = new THREE.Vector3();
  let shakeAmp = 0; // 鏡頭搖晃（公尺），很快衰減
  let shakeTime = 0;
  const shakeLook = new THREE.Vector3();

  // 沿射線檢查地形：回傳射線碰到地形（加上餘裕）前的距離
  function terrainHit(from, d, maxDist) {
    const step = cfg.terrainStep;
    for (let s = step; s <= maxDist; s += step) {
      probe.copy(from).addScaledVector(d, s);
      if (probe.y < terrain.heightAt(probe.x, probe.z) + cfg.minHeightAboveGround) return s - step * 0.5;
    }
    return Infinity;
  }

  // target：目標點（地面上，或游泳時的水面）；heading：角色或馬的朝向；speed：m/s；
  // pivotGoal：鏡頭看向目標上方多高；distanceScale：距離的倍數（騎馬時拉遠）
  function update(dt, input, target, heading, speed, pivotGoal = cfg.pivotHeight, distanceScale = 1) {
    pivotHeight = damp(pivotHeight, pivotGoal, 4, dt);
    scale = damp(scale, distanceScale, 3, dt);
    speedFactor = damp(speedFactor, clamp(speed / cfg.speedReference, 0, 1), 2, dt);
    scenicBlend = damp(scenicBlend, scenic ? 1 : 0, 1.5, dt);
    aimBlend = damp(aimBlend, aiming ? 1 : 0, 12, dt);

    if (input.lookX || input.lookY) {
      yawGoal -= input.lookX * cfg.lookSensitivity;
      const sy = cfg.invertY ? -1 : 1;
      pitchGoal = clamp(pitchGoal + input.lookY * cfg.lookSensitivity * sy, cfg.minPitch, cfg.maxPitch);
      idle = 0;
    } else {
      idle += dt;
    }
    if (trackYaw !== null && !scenic) {
      // 鎖定：轉向目標（滑鼠仍可微調）
      yawGoal = dampAngle(yawGoal, trackYaw, 6, dt);
    } else     if (scenic) {
      // 風景模式：繞著目標緩慢漂移
      yawGoal += cfg.scenic.drift * dt;
      if (idle > cfg.recenterDelay) pitchGoal = damp(pitchGoal, cfg.scenic.pitch, 0.5, dt);
    } else if (!aiming && idle > cfg.recenterDelay && speed > cfg.recenterMinSpeed) {
      // 移動中：慢慢轉回身後（只轉水平方向；俯仰角保留玩家自己調的，不會被拉回往下看；靜止時不回正）
      yawGoal = dampAngle(yawGoal, heading + Math.PI, cfg.recenterSharpness, dt);
    }
    if (input.zoom) distanceGoal = clamp(distanceGoal * Math.exp(input.zoom * cfg.zoomSpeed), cfg.minDistance, cfg.maxDistance);

    yaw = dampAngle(yaw, yawGoal, cfg.rotateSharpness, dt);
    pitch = damp(pitch, pitchGoal, cfg.rotateSharpness, dt);
    distance = damp(distance, distanceGoal, cfg.zoomSharpness, dt);

    // 彈簧阻尼跟隨（水平快、垂直慢）
    const gx = target.x;
    const gy = target.y + pivotHeight;
    const gz = target.z;
    if (!snapped) {
      pivot.set(gx, gy, gz);
      snapped = true;
    } else {
      pivot.x = smoothDamp(pivot.x, gx, springs.x, cfg.followTime[0], dt);
      pivot.z = smoothDamp(pivot.z, gz, springs.z, cfg.followTime[0], dt);
      pivot.y = smoothDamp(pivot.y, gy, springs.y, cfg.followTime[1], dt);
    }

    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // 瞄準：看向右肩前方一點（準星在畫面中央，不會被角色擋住），距離拉近
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    look.copy(pivot).addScaledVector(right, cfg.aim.shoulder * aimBlend);
    look.y += cfg.aim.lift * aimBlend;
    const want = THREE.MathUtils.lerp(distance * scale * (1 + cfg.speedDistance * speedFactor) * (1 - (1 - cfg.aim.distance) * aimBlend), cfg.scenic.distance, scenicBlend);
    const hit = cfg.collision ? Math.min(physics.raycast(look, dir, want + cfg.collisionPadding) - cfg.collisionPadding, terrainHit(look, dir, want)) : Infinity;
    const allowed = Math.max(0.3, Math.min(want, hit));
    // 被擋住時立即拉近，離開遮擋後再平滑退回
    actualDistance = allowed < actualDistance ? allowed : damp(actualDistance, allowed, cfg.zoomSharpness, dt);

    camera.position.copy(look).addScaledVector(dir, actualDistance);
    const floor = terrain.heightAt(camera.position.x, camera.position.z) + cfg.minHeightAboveGround;
    if (camera.position.y < floor) camera.position.y = floor;
    // 搖晃：位置與視線一起抖（幾個不同頻率的正弦，不用亂數）
    shakeTime += dt;
    shakeAmp *= Math.exp(-5 * dt);
    shakeLook.copy(look);
    if (shakeAmp > 0.002) {
      const a = Math.min(shakeAmp, 1.6);
      const t = shakeTime;
      const ox = (Math.sin(t * 41.3) + Math.sin(t * 23.1 + 2)) * 0.5 * a;
      const oy = (Math.sin(t * 37.7 + 1) + Math.sin(t * 19.9)) * 0.5 * a;
      const oz = (Math.sin(t * 31.1 + 4) + Math.sin(t * 27.3 + 3)) * 0.5 * a;
      camera.position.x += ox;
      camera.position.y += oy;
      camera.position.z += oz;
      shakeLook.x += ox * 0.4;
      shakeLook.y += oy * 0.4;
      shakeLook.z += oz * 0.4;
    }
    camera.lookAt(shakeLook);

    // 視野：越快越寬；風景模式另有視野
    const fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(cfg.fov[0], cfg.fov[1], speedFactor) * (1 - (1 - cfg.aim.fov) * aimBlend), cfg.scenic.fov, scenicBlend);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    camera,
    update,
    // 直接指定鏡頭角度（平滑轉過去）；之後若沒有手動轉動，照常自動回到身後
    setAngles(newYaw, newPitch) {
      yawGoal = newYaw;
      pitchGoal = clamp(newPitch, cfg.minPitch, cfg.maxPitch);
      idle = 0;
    },
    // 搖晃（地獄業火的蓄力、爆炸）：取較大的那個，很快衰減
    shake(amount) {
      shakeAmp = Math.max(shakeAmp, amount);
    },
    // 右鍵瞄準
    setAim(on) {
      aiming = on;
      if (on) idle = 0;
    },
    get aiming() {
      return aiming;
    },
    // 鎖定目標：鏡頭的水平角慢慢轉向 yaw（null = 停止）
    track(yaw) {
      trackYaw = yaw;
      if (yaw !== null) idle = 0;
    },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    toggleScenic() {
      scenic = !scenic;
      pitchGoal = scenic ? cfg.scenic.pitch : cfg.pitch;
      return scenic;
    },
    get scenic() {
      return scenic;
    },
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    get distance() {
      return actualDistance;
    },
  };
}
