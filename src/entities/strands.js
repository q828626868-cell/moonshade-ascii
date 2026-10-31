// 繩狀物理（verlet 鏈），細線層的來源：每條一端固定在掛點，受重力、風與阻尼影響，會被地面擋住。
// 之後的鬃毛、尾巴、頭髮、披風邊緣都用它；目前掛在開發替身背後當圍巾展示遮擋。
// 在固定步長中更新，掛點與朝向由擁有者每步傳入。

export function createStrands(cfg, rng, terrain, styleId) {
  const n = cfg.nodes;
  const total = cfg.count * n;
  const pos = new Float32Array(total * 3);
  const prev = new Float32Array(total * 3);
  // 每條的橫向位置與長度略有不同（固定種子）
  const offsets = Float32Array.from({ length: cfg.count }, (_, s) => (s - (cfg.count - 1) / 2) * cfg.spread);
  const segLen = Float32Array.from({ length: cfg.count }, () => (cfg.length * rng.range(0.8, 1.1)) / (n - 1));
  let initialized = false;
  let time = 0;

  // anchor：掛點世界座標；heading：擁有者朝向（前方 = (sin h, cos h)）
  function update(dt, anchor, heading, weather) {
    time += dt;
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    const dt2 = dt * dt;
    const w = weather.wind;

    for (let s = 0; s < cfg.count; s++) {
      const base = s * n * 3;
      const rootX = anchor.x + rx * offsets[s];
      const rootY = anchor.y;
      const rootZ = anchor.z + rz * offsets[s];

      if (!initialized) {
        for (let i = 0; i < n; i++) {
          const o = base + i * 3;
          pos[o] = prev[o] = rootX;
          pos[o + 1] = prev[o + 1] = rootY - i * segLen[s];
          pos[o + 2] = prev[o + 2] = rootZ;
        }
      }
      pos[base] = prev[base] = rootX;
      pos[base + 1] = prev[base + 1] = rootY;
      pos[base + 2] = prev[base + 2] = rootZ;

      // 積分
      for (let i = 1; i < n; i++) {
        const o = base + i * 3;
        const gust = cfg.windResponse * w.strength * (0.6 + 0.4 * Math.sin(time * 3.1 + s * 1.7 + i * 0.6));
        for (let a = 0; a < 3; a++) {
          const vel = (pos[o + a] - prev[o + a]) * cfg.damping;
          prev[o + a] = pos[o + a];
          const acc = a === 1 ? -cfg.gravity : (a === 0 ? w.x : w.z) * gust;
          pos[o + a] += vel + acc * dt2;
        }
      }

      // 長度約束（根部固定），再擋住地面
      for (let it = 0; it < cfg.iterations; it++) {
        for (let i = 1; i < n; i++) {
          const a = base + (i - 1) * 3;
          const b = base + i * 3;
          const dx = pos[b] - pos[a];
          const dy = pos[b + 1] - pos[a + 1];
          const dz = pos[b + 2] - pos[a + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const k = (d - segLen[s]) / d;
          const wa = i === 1 ? 0 : 0.5;
          const wb = 1 - wa;
          pos[a] += dx * k * wa;
          pos[a + 1] += dy * k * wa;
          pos[a + 2] += dz * k * wa;
          pos[b] -= dx * k * wb;
          pos[b + 1] -= dy * k * wb;
          pos[b + 2] -= dz * k * wb;
        }
      }
      for (let i = 1; i < n; i++) {
        const o = base + i * 3;
        const floor = terrain.heightAt(pos[o], pos[o + 2]) + 0.02;
        if (pos[o + 1] < floor) pos[o + 1] = floor;
      }
    }
    initialized = true;
  }

  function emit(push) {
    if (!cfg.enabled || !initialized) return;
    for (let s = 0; s < cfg.count; s++) {
      const base = s * n * 3;
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 3;
        push(pos[a], pos[a + 1], pos[a + 2], pos[a + 3], pos[a + 4], pos[a + 5], styleId, i === 0);
      }
    }
  }

  return { update, emit };
}
