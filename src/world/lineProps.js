// 以細線層畫的區域細節（見 render/detailLines.js）：
//   蘆葦（月影湖岸、石溪河谷的淺水處）、瀑布水流、霜脛山脊的降雪
// 蘆葦根部常在水面下：細線層以讀回的深度比對，水面以下的部分自然被水面遮住。

// 依格子分桶，只取玩家附近的
function bucketize(items, size) {
  const map = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return {
    near(x, z, radius, fn) {
      const r = Math.ceil(radius / size);
      const cx = Math.floor(x / size);
      const cz = Math.floor(z / size);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const list = map.get(`${cx + dx},${cz + dz}`);
          if (list) for (const it of list) fn(it);
        }
      }
    },
  };
}

export function createReeds(cfg, { heightField: hf, terrainCfg, rng, styleId }) {
  const wl = terrainCfg.waterLevel;
  const L = terrainCfg.lake;
  const river = terrainCfg.river;
  const clumps = [];

  function tryClump(x, z) {
    const h = hf.height(x, z);
    const depth = wl - h;
    if (depth < cfg.depth[0] - 0.15 || depth > cfg.depth[1] || rng.next() > cfg.density) return;
    const n = rng.int(cfg.perClump[0], cfg.perClump[1]);
    const blades = [];
    for (let k = 0; k < n; k++) {
      blades.push({
        x: x + rng.range(-0.35, 0.35),
        z: z + rng.range(-0.35, 0.35),
        h: rng.range(cfg.height[0], cfg.height[1]),
        lean: rng.next() * Math.PI * 2,
        phase: rng.next() * Math.PI * 2,
      });
    }
    clumps.push({ x, z, y: h, blades });
  }

  // 湖岸的淺水帶
  const ext = L.radius * 1.4;
  for (let gz = -ext; gz < ext; gz += cfg.lakeSpacing) {
    for (let gx = -ext; gx < ext; gx += cfg.lakeSpacing) {
      const x = L.center[0] + gx + rng.next() * cfg.lakeSpacing;
      const z = L.center[1] + gz + rng.next() * cfg.lakeSpacing;
      const dd = hf.lakeDistance(x, z);
      if (dd > 0.8 && dd < 1.25) tryClump(x, z);
    }
  }
  // 河道兩側（瀑布以下）
  for (let s = 0; s < river.fall.at; s += cfg.riverSpacing) {
    const c = hf.riverCenter(s);
    for (const side of [-1, 1]) {
      const d = side * rng.range(0.55, 0.95) * river.width;
      tryClump(c.x - c.tz * d, c.z + c.tx * d);
    }
  }
  const grid = bucketize(clumps, 32);

  let fx = 0;
  let fz = 0;
  let time = 0;
  let wind = { x: 1, z: 0, strength: 1 };

  return {
    clumps, // { x, z, y, blades }：給水面（蘆葉被風吹到水面時起漣漪）
    count: clumps.length,
    update(t, focus, weather) {
      time = t;
      fx = focus.x;
      fz = focus.z;
      wind = weather.wind;
    },
    emit(push) {
      grid.near(fx, fz, cfg.drawRadius, (c) => {
        if (Math.hypot(c.x - fx, c.z - fz) > cfg.drawRadius) return;
        for (const b of c.blades) {
          const sway = wind.strength * 0.18 * (0.7 + 0.3 * Math.sin(time * 1.7 + b.phase));
          const ox = (Math.cos(b.lean) * 0.08 + wind.x * sway) * b.h;
          const oz = (Math.sin(b.lean) * 0.08 + wind.z * sway) * b.h;
          const mx = b.x + ox * 0.35;
          const my = c.y + b.h * 0.55;
          const mz = b.z + oz * 0.35;
          push(b.x, c.y, b.z, mx, my, mz, styleId, true);
          push(mx, my, mz, b.x + ox, c.y + b.h, b.z + oz, styleId, false);
        }
      });
    },
  };
}

// 瀑布水流：水幕前方一道道往下落的水線
export function createWaterfallLines(cfg, { heightField: hf, terrainCfg, rng, styleId }) {
  const river = terrainCfg.river;
  const fall = river.fall;
  const top = terrainCfg.waterLevel + fall.height;
  const bottom = terrainCfg.waterLevel;
  const W = hf.riverCenter(fall.at - 0.9);
  const width = river.width * 1.4;
  const streaks = Array.from({ length: cfg.streaks }, (_, k) => ({
    t: (k / (cfg.streaks - 1) - 0.5) * width + rng.range(-0.2, 0.2),
    phase: rng.next() * fall.height,
    speed: cfg.speed * rng.range(0.8, 1.2),
  }));
  let time = 0;
  let near = false;

  return {
    update(t, focus) {
      time = t;
      near = Math.hypot(W.x - focus.x, W.z - focus.z) < cfg.drawRadius;
    },
    emit(push) {
      if (!near) return;
      const H = top - bottom;
      for (const s of streaks) {
        const x = W.x - W.tz * s.t;
        const z = W.z + W.tx * s.t;
        for (let j = 0; j < 3; j++) {
          const y = top - ((time * s.speed + s.phase + (j * H) / 3) % H);
          push(x, y, z, x, Math.max(bottom, y - cfg.streakLength), z, styleId, true);
        }
      }
    },
  };
}

// 炊煙：每個煙囪幾縷往上飄的煙，越高越散、順著風飄，一縷是兩段彎曲的線
export function createChimneySmoke(cfg, { chimneys, rng, styleId }) {
  const puffs = chimneys.map((c) => ({
    ...c,
    list: Array.from({ length: cfg.puffs }, (_, k) => ({ phase: (k / cfg.puffs) * cfg.height + rng.range(0, 0.4), swirl: rng.next() * 6.28 })),
  }));
  let time = 0;
  let fx = 0;
  let fz = 0;
  let wind = { x: 1, z: 0, strength: 1 };
  return {
    update(t, focus, weather) {
      time = t;
      fx = focus.x;
      fz = focus.z;
      wind = weather.wind;
    },
    emit(push) {
      for (const c of puffs) {
        if (Math.hypot(c.x - fx, c.z - fz) > cfg.drawRadius) continue;
        for (const p of c.list) {
          const life = (time * cfg.speed + p.phase) % cfg.height; // 0 → height
          const k = life / cfg.height;
          const drift = life * cfg.drift * wind.strength;
          const wobble = Math.sin(time * 1.3 + p.swirl + life) * 0.3 * k;
          const x = c.x + wind.x * drift + wobble;
          const z = c.z + wind.z * drift + Math.cos(time * 1.1 + p.swirl) * 0.3 * k;
          const y = c.y + life;
          const s = 0.25 + k * 0.6; // 越高越散
          push(x, y, z, x + s * 0.5, y + s * 0.4, z, styleId, true);
          push(x + s * 0.5, y + s * 0.4, z, x - s * 0.2, y + s * 0.9, z + s * 0.2, styleId, false);
        }
      }
    },
  };
}

// 降雪：玩家周圍一個會跟著移動的盒子裡的雪花，量由天氣的 snow（0–1）決定
export function createSnowfall(cfg, { rng, styleId, groundAt }) {
  const n = cfg.flakes;
  const R = cfg.radius;
  const pos = new Float32Array(n * 3);
  const speed = Float32Array.from({ length: n }, () => cfg.speed * rng.range(0.7, 1.3));
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng.range(-R, R);
    pos[i * 3 + 1] = rng.range(0, cfg.height);
    pos[i * 3 + 2] = rng.range(-R, R);
  }
  let amount = 0;
  let wind = { x: 0, z: 0, strength: 0 };

  return {
    update(dt, focus, weather) {
      amount = weather.snow;
      wind = weather.wind;
      if (amount < 0.01) return;
      // 以玩家高度為準（不用腳下的地面：斜坡上坡側的雪花會整片埋進地裡）
      const base = Math.max(focus.y, groundAt(focus.x, focus.z)) - 3;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        pos[o] += wind.x * wind.strength * cfg.drift * dt;
        pos[o + 1] -= speed[i] * dt;
        pos[o + 2] += wind.z * wind.strength * cfg.drift * dt;
        // 跟著玩家：超出盒子就從另一側繞回來
        if (pos[o] - focus.x > R) pos[o] -= 2 * R;
        else if (pos[o] - focus.x < -R) pos[o] += 2 * R;
        if (pos[o + 2] - focus.z > R) pos[o + 2] -= 2 * R;
        else if (pos[o + 2] - focus.z < -R) pos[o + 2] += 2 * R;
        if (pos[o + 1] < base - 1) pos[o + 1] += cfg.height;
        else if (pos[o + 1] > base + cfg.height) pos[o + 1] -= cfg.height;
      }
    },
    emit(push) {
      const count = Math.floor(n * amount);
      const dx = wind.x * wind.strength * 0.04;
      const dz = wind.z * wind.strength * 0.04;
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        push(pos[o], pos[o + 1], pos[o + 2], pos[o] + dx, pos[o + 1] - cfg.flakeLength, pos[o + 2] + dz, styleId, true);
      }
    },
  };
}
