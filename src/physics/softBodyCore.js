// 披風與馬毛的固定步長迴圈（純數學，不依賴 three.js）：Web Worker 與主執行緒共用。
// 每次收到一批輸入（這段時間 frameDt、身體的平移 carry），以 fixedDt 跑若干步：先布料、再毛髮（尾巴要碰披風下緣）。
// 一步都沒跑到（畫面更新比 fixedDt 快）時，平移累積到下一批，不會弄丟。
import { createClothSim } from './clothSim.js';
import { createHairSim } from './hairSim.js';

export function createSoftBodyCore(init) {
  const cloth = createClothSim(init.clothCfg, init.clothLayout);
  const hair = createHairSim(init.hairCfg, init.hairLayout);
  const { fixedDt, maxSubSteps } = init.sim;
  const { W, H } = init.clothLayout;
  let clock = 0;
  const pending = { cloth: emptyCarry(), hair: emptyCarry() };

  function emptyCarry() {
    return { dx: 0, dy: 0, dz: 0, vx: 0, vz: 0, teleport: false };
  }
  function accumulate(into, c) {
    into.dx += c.dx;
    into.dy += c.dy;
    into.dz += c.dz;
    into.vx = c.vx;
    into.vz = c.vz;
    into.teleport = into.teleport || c.teleport;
  }

  // msg：{ frameDt, cloth: 輸入, hair: 輸入 | null（太遠，不模擬）}；回傳這次跑了幾步
  function step(msg) {
    clock += msg.frameDt;
    accumulate(pending.cloth, msg.cloth.carry);
    if (msg.hair) accumulate(pending.hair, msg.hair.carry);
    else {
      hair.sleep();
      pending.hair = emptyCarry();
    }
    let steps = 0;
    while (clock >= fixedDt && steps < maxSubSteps) {
      const first = steps === 0;
      msg.cloth.carry = first ? pending.cloth : { ...pending.cloth, dx: 0, dy: 0, dz: 0, teleport: false };
      cloth.step(fixedDt, msg.cloth, first);
      if (msg.hair) {
        msg.hair.carry = first ? pending.hair : { ...pending.hair, dx: 0, dy: 0, dz: 0, teleport: false };
        msg.hair.cloak = { positions: cloth.pos, columns: W, rows: H };
        hair.step(fixedDt, msg.hair, first);
      }
      clock -= fixedDt;
      steps++;
    }
    if (steps === maxSubSteps) clock = 0;
    if (steps > 0) {
      pending.cloth = emptyCarry();
      pending.hair = emptyCarry();
    }
    return steps;
  }

  return {
    step,
    cloth: cloth.pos,
    hair: hair.groups.map((g) => g.pos),
    wet: hair.groups.map((g) => g.wet),
  };
}
