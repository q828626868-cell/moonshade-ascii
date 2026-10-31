// 披風與馬毛的模擬放在哪裡跑：
//   Web Worker（CONFIG.sim.physicsWorker，預設）：主執行緒每幀整理好輸入送過去就繼續做別的事，結果下一幀回來；
//     晚到的這一幀用「身體目前的位置 − 結果對應的位置」整體平移補上（cloak.follow、馬毛的細線）。
//     上一批還沒回來時不送新的，這段時間與身體的平移累積到下一批（不會越積越多）。
//   主執行緒（worker 不能用、出錯時自動退回）：與 worker 同一份程式（softBodyCore.js），當幀算完當幀用。
import * as THREE from 'three';
import { createSoftBodyCore } from './softBodyCore.js';

export function createSoftBodies(simCfg, { cloak, horseHair, cloakCfg, hairCfg, horse, character }) {
  const init = {
    type: 'init',
    sim: { fixedDt: simCfg.fixedDt, maxSubSteps: simCfg.maxSubSteps },
    clothCfg: cloakCfg,
    clothLayout: cloak.layout,
    hairCfg,
    hairLayout: horseHair.layout,
  };
  let worker = null;
  let local = null;
  let busy = false;
  let pendingDt = 0;
  const pendingCarry = { cloth: carryZero(), hair: carryZero() };
  const stats = { mode: 'main', steps: 0, waits: 0 };
  const clothRef = new THREE.Vector3();
  const hairRef = new THREE.Vector3();

  function carryZero() {
    return { dx: 0, dy: 0, dz: 0, vx: 0, vz: 0, teleport: false };
  }
  function add(into, c) {
    into.dx += c.dx;
    into.dy += c.dy;
    into.dz += c.dz;
    into.vx = c.vx;
    into.vz = c.vz;
    into.teleport = into.teleport || c.teleport;
  }
  // 結構化複製時只帶需要的欄位（輸入物件裡沒有函式，可以直接送）
  const plainCarry = (c) => ({ dx: c.dx, dy: c.dy, dz: c.dz, vx: c.vx, vz: c.vz, teleport: c.teleport });

  function useLocal(reason) {
    if (reason) console.warn('Soft body worker unavailable, simulating on the main thread:', reason);
    worker?.terminate();
    worker = null;
    busy = false;
    local = createSoftBodyCore(init);
    stats.mode = 'main';
  }

  if (simCfg.physicsWorker && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./softBodyWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const r = e.data;
        busy = false;
        stats.steps = r.steps;
        cloak.apply(r.cloth, clothRef.fromArray(r.clothRef));
        if (r.hasHair) horseHair.apply(r.hair, r.wet, hairRef.fromArray(r.hairRef));
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        useLocal(e.message || 'worker error');
      };
      worker.postMessage(init);
      stats.mode = 'worker';
    } catch (err) {
      useLocal(err.message);
    }
  } else useLocal(null);
  cloak.reset();

  return {
    stats,
    // 每幀（人物與馬擺好姿勢之後）：ctx = { weather, time, cameraPos, riding, carryCloak, carryHair }
    step(frameDt, ctx) {
      pendingDt += frameDt;
      add(pendingCarry.cloth, ctx.carryCloak);
      add(pendingCarry.hair, ctx.carryHair);
      if (worker && busy) {
        stats.waits++; // 上一批還沒回來
        return;
      }
      const cloth = cloak.gather(ctx.weather, ctx.time, plainCarry(pendingCarry.cloth));
      const hair = horseHair.gather(ctx.weather, ctx.cameraPos, ctx.riding, plainCarry(pendingCarry.hair));
      const msg = { type: 'step', frameDt: pendingDt, cloth, hair, clothRef: character.object.position.toArray(), hairRef: horse.object.getWorldPosition(new THREE.Vector3()).toArray() };
      pendingDt = 0;
      pendingCarry.cloth = carryZero();
      pendingCarry.hair = carryZero();
      if (worker) {
        busy = true;
        worker.postMessage(msg);
        return;
      }
      stats.steps = local.step(msg);
      cloak.apply(local.cloth, clothRef.fromArray(msg.clothRef));
      if (hair) horseHair.apply(local.hair, local.wet, hairRef.fromArray(msg.hairRef));
    },
  };
}
