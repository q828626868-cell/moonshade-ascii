// 第三人稱鏡頭。yaw = 0 時鏡頭在目標 +Z 方向，往 -Z 看。
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

    if (input.lookX || input.lookY) {
      yawGoal -= input.lookX * cfg.lookSensitivity;
      const sy = cfg.invertY ? -1 : 1;
      pitchGoal = clamp(pitchGoal + input.lookY * cfg.lookSensitivity * sy, cfg.minPitch, cfg.maxPitch);
      idle = 0;
    } else {
      idle += dt;
    }
    if (scenic) {
      // 風景模式：繞著目標緩慢漂移
      yawGoal += cfg.scenic.drift * dt;
      if (idle > cfg.recenterDelay) pitchGoal = damp(pitchGoal, cfg.scenic.pitch, 0.5, dt);
    } else if (idle > cfg.recenterDelay && speed > cfg.recenterMinSpeed) {
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
    const want = THREE.MathUtils.lerp(distance * scale * (1 + cfg.speedDistance * speedFactor), cfg.scenic.distance, scenicBlend);
    const hit = cfg.collision ? Math.min(physics.raycast(pivot, dir, want + cfg.collisionPadding) - cfg.collisionPadding, terrainHit(pivot, dir, want)) : Infinity;
    const allowed = Math.max(0.3, Math.min(want, hit));
    // 被擋住時立即拉近，離開遮擋後再平滑退回
    actualDistance = allowed < actualDistance ? allowed : damp(actualDistance, allowed, cfg.zoomSharpness, dt);

    camera.position.copy(pivot).addScaledVector(dir, actualDistance);
    const floor = terrain.heightAt(camera.position.x, camera.position.z) + cfg.minHeightAboveGround;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(pivot);

    // 視野：越快越寬；風景模式另有視野
    const fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(cfg.fov[0], cfg.fov[1], speedFactor), cfg.scenic.fov, scenicBlend);
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
