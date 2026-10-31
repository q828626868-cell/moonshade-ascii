// 近處草葉（細線層的來源）：玩家周圍 radius 內，以世界格座標的雜湊決定每根草的位置、高度與傾斜
// （固定種子，每次都一樣，走開再回來也是同一批草），以世界空間的線條筆劃畫出。
//   風：沿風向傳遞的波讓草彎曲
//   踩踏：讀取 trample 場，被踩過的草往倒向壓低，隨時間恢復
//   遠近：thinFrom 以外逐漸減少（細線淡出、地表字元接手，見 resolvers.js 的 grass）
// 每根草是兩段線（彎曲），只有根部落在「畫面上是草地的格」才畫，水池、路、物件底下自動排除。

// 整數座標 → [0, 1) 的雜湊
function hash(a, b, c) {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// meadowAt(x, z)：0–1，北境草原的程度——越高草越高、擺動越大
// trample：world/trample.js（可選）
export function createGrassBlades(cfg, seed, terrain, styleId, meadowAt = () => 0, trample = null, trampleCfg = null) {
  let fx = 0;
  let fz = 0;
  let time = 0;
  let windX = 0;
  let windZ = 0;
  let windStrength = 0;
  let count = 0;

  return {
    get count() {
      return count;
    },

    update(t, focus, weather) {
      time = t;
      fx = focus.x;
      fz = focus.z;
      windX = weather.wind.x;
      windZ = weather.wind.z;
      windStrength = weather.wind.strength;
    },

    emit(push) {
      count = 0;
      if (!cfg.enabled) return;
      const cs = cfg.cellSize;
      const r = cfg.radius;
      const gx0 = Math.floor((fx - r) / cs);
      const gx1 = Math.floor((fx + r) / cs);
      const gz0 = Math.floor((fz - r) / cs);
      const gz1 = Math.floor((fz + r) / cs);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let k = 0; k < cfg.perCell; k++) {
            const salt = seed + k * 7919;
            const x = (gx + hash(gx, gz, salt)) * cs;
            const z = (gz + hash(gz, gx, salt + 1)) * cs;
            const dx = x - fx;
            const dz = z - fz;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > r) continue;
            // 遠處逐漸減少（每根草固定一個門檻，所以減少的是固定的那幾根，不會閃爍）
            if (d > cfg.thinFrom) {
              const keep = 1 - ((d - cfg.thinFrom) / (r - cfg.thinFrom)) * (1 - cfg.thinTo);
              if (hash(salt + 5, gz, gx) > keep) continue;
            }
            const meadow = meadowAt(x, z);
            let h =
              (cfg.minHeight + (cfg.maxHeight - cfg.minHeight) * hash(gx, salt + 2, gz)) *
              (1 + (cfg.meadowHeightScale - 1) * meadow);
            const lean = hash(salt + 3, gx, gz) * Math.PI * 2;
            const phase = hash(gz, salt + 4, gx) * Math.PI * 2;
            // 風：沿風向傳遞的波，加上每根草自己的相位
            const wave = Math.sin(time * cfg.swaySpeed + phase * 0.3 + (x * windX + z * windZ) * cfg.waveScale);
            let bend = windStrength * cfg.sway * (1 + (cfg.meadowSwayScale - 1) * meadow) * (0.6 + 0.4 * wave);
            let ox = (Math.cos(lean) * cfg.lean + windX * bend) * h;
            let oz = (Math.sin(lean) * cfg.lean + windZ * bend) * h;
            let tipY = h * (1 - 0.25 * Math.min(1, bend));
            // 踩踏：往倒向壓低，風的影響也跟著變小
            if (trample) {
              const t = trample.sample(x, z, time);
              if (t.amount > 0.02) {
                const a = t.amount;
                ox = ox * (1 - a) + t.dx * h * a * 0.9;
                oz = oz * (1 - a) + t.dz * h * a * 0.9;
                tipY *= 1 - trampleCfg.flatten * a;
                h *= 1 - trampleCfg.flatten * a * 0.7;
              }
            }
            const y = terrain.heightAt(x, z);
            // 彎曲：中段只偏移三成，尖端偏移全部
            const mx = x + ox * 0.3;
            const my = y + Math.min(h * 0.55, tipY * 0.8);
            const mz = z + oz * 0.3;
            push(x, y, z, mx, my, mz, styleId, true);
            push(mx, my, mz, x + ox, y + tipY, z + oz, styleId, false);
            count++;
          }
        }
      }
    },
  };
}
