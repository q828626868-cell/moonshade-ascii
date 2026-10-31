// 世界場函式：地形高度、生態區域權重、地表材質。JS 與 GLSL 各一份，由同一份 CONFIG 產生，
// 結構逐段對應——改一邊必須同步改另一邊。
//   JS   ：騎馬貼地、物件擺放、水深、區域判定（氣候、音效、區域名稱）
//   GLSL ：地形網格頂點位移、地表材質、水深著色
// 一致性：雜湊用 32 位元整數運算（JS Math.imul ↔ GLSL uint），兩邊位元完全相同；值噪聲在格點上連續，
// float32 與 float64 的捨入差異只造成極小的高度誤差。高度只用乘法與 sqrt（不用 pow／sin，GPU 版是近似值）。
// 啟動時 render/terrainVerify.js 會實測並顯示在開發者面板。
//
// 高度 = 基準 + 多層噪聲（大尺度山丘、中尺度起伏、小尺度凹凸）
//      + 山脊 + 外圍山 → 古石環山丘（頂部壓平）→ 村莊平台 → 湖泊盆地 → 湖心島 → 河道（含瀑布落差與淺灘）
import { hashString } from '../core/rng.js';

const OFFSET = 65536; // 格點座標加上偏移，避免負數轉 uint
const ROAD_CHUNK = 16; // GLSL 道路距離：每組幾段線段共用一個包圍盒

// 區域索引（與 CONFIG.regions 的順序一致）
export const REGION = { meadow: 0, forest: 1, lake: 2, river: 3, stones: 4, ridge: 5 };
export const REGION_COUNT = 6;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// GLSL 浮點數／uint 常數
const glf = (v) => {
  const s = String(Number(v));
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
const glu = (v) => `${v >>> 0}u`;

export function hashU(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const hash01 = (x, y, seed) => (hashU(x, y, seed) >>> 8) / 16777216;

// 值噪聲 [0, 1]，五次平滑插值
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const cx = ix + OFFSET;
  const cy = iy + OFFSET;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash01(cx, cy, seed);
  const b = hash01(cx + 1, cy, seed);
  const c = hash01(cx, cy + 1, seed);
  const d = hash01(cx + 1, cy + 1, seed);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

// 點到線段的距離與投影參數 t
function segment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  const ex = px - (ax + dx * t);
  const ez = pz - (az + dz * t);
  return [Math.sqrt(ex * ex + ez * ez), t];
}

export function createHeightField(cfg, regionsCfg, worldSeed) {
  const seedOf = (name) => (hashString(name) ^ Math.imul(worldSeed >>> 0, 0x9e3779b1)) >>> 0;
  const layers = cfg.layers.map((l, i) => ({ ...l, seed: seedOf(`terrain-layer-${i}`) }));
  const S = {
    ridge: seedOf('terrain-ridge'),
    lake: seedOf('terrain-lake'),
    warpX: seedOf('terrain-river-x'),
    warpZ: seedOf('terrain-river-z'),
    moisture: seedOf('terrain-moisture'),
    dry: seedOf('terrain-dry'),
    snow: seedOf('terrain-snow'),
    forest: seedOf('region-forest'),
    moss: seedOf('surface-moss'),
    hoof: seedOf('surface-hoof'),
  };
  const wl = cfg.waterLevel;
  const { ridge, plateau, lake, river, rim, stones, island } = cfg;
  const { fall, ford } = river;
  const R = regionsCfg;
  const forestCfg = R.forest.area;

  // 河道折線：每段長度與累積長度（s = 從湖端起算的河道距離）
  const rp = river.points;
  const segLen = [];
  const cum = [0];
  for (let i = 0; i < rp.length - 1; i++) {
    segLen.push(Math.hypot(rp[i + 1][0] - rp[i][0], rp[i + 1][1] - rp[i][1]));
    cum.push(cum[i] + segLen[i]);
  }
  const riverLength = cum[cum.length - 1];

  function layer(x, z, l) {
    let sum = 0;
    let f = l.frequency;
    let a = l.amplitude;
    for (let o = 0; o < l.octaves; o++) {
      sum += a * (valueNoise(x * f, z * f, (l.seed + o) >>> 0) * 2 - 1);
      f *= 2;
      a *= 0.5;
    }
    return sum;
  }

  // 河道蜿蜒：查詢點先依噪聲偏移，再量到折線的距離
  function riverWarp(x, z) {
    const f = river.warpFrequency;
    return [
      river.warp * (valueNoise(x * f, z * f, S.warpX) * 2 - 1),
      river.warp * (valueNoise(x * f, z * f, S.warpZ) * 2 - 1),
    ];
  }

  // [到河道中心的距離, 沿河距離 s]
  function riverInfo(x, z) {
    const [ox, oz] = riverWarp(x, z);
    const wx = x + ox;
    const wz = z + oz;
    let d = 1e9;
    let s = 0;
    for (let i = 0; i < rp.length - 1; i++) {
      const [di, t] = segment(wx, wz, rp[i][0], rp[i][1], rp[i + 1][0], rp[i + 1][1]);
      if (di < d) {
        d = di;
        s = cum[i] + t * segLen[i];
      }
    }
    return [d, s];
  }

  // 河面高度：瀑布處往上游抬高 fall.height
  const riverLevel = (s) => wl + fall.height * smoothstep(fall.at - fall.length / 2, fall.at + fall.length / 2, s);
  // 河床深度：淺灘處變淺
  const riverDepth = (s) => river.depth * (1 - ford.strength * (1 - smoothstep(0, ford.length, Math.abs(s - ford.at))));

  // 到湖心的距離 / 湖的半徑（湖岸以噪聲擾動）
  function lakeDistance(x, z) {
    const dx = x - lake.center[0];
    const dz = z - lake.center[1];
    const f = lake.wobbleFrequency;
    const wob = 1 + lake.wobble * (valueNoise(x * f, z * f, S.lake) * 2 - 1);
    return Math.sqrt(dx * dx + dz * dz) / (lake.radius * wob);
  }

  function height(x, z) {
    let h = cfg.baseHeight;
    for (const l of layers) h += layer(x, z, l);

    // 山脊：沿線段隆起，兩端收細，頂部以 ridged 噪聲做出嶙峋感
    {
      const [d, t] = segment(x, z, ridge.from[0], ridge.from[1], ridge.to[0], ridge.to[1]);
      const profile = 1 - smoothstep(0, ridge.width, d);
      const bell = 4 * t * (1 - t);
      const taper = 1 - (1 - bell) * (1 - bell);
      const f = ridge.noiseFrequency;
      const rn = 1 - Math.abs(valueNoise(x * f, z * f, S.ridge) * 2 - 1);
      h += ridge.height * profile * profile * taper * (1 - ridge.roughness + ridge.roughness * rn);
    }

    // 外圍山：圍住世界邊界
    {
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += rim.height * smoothstep(rim.start, rim.end, e);
    }

    // 古石環山丘：平緩隆起，頂部壓平成固定高度
    {
      const dx = x - stones.center[0];
      const dz = z - stones.center[1];
      const m = 1 - smoothstep(stones.topRadius, stones.hillRadius, Math.sqrt(dx * dx + dz * dz));
      h = h + (stones.topHeight - h) * m * m * (3 - 2 * m);
    }

    // 村莊平台：壓平到固定高度
    {
      const dx = x - plateau.center[0];
      const dz = z - plateau.center[1];
      const m = 1 - smoothstep(plateau.radius, plateau.radius + plateau.falloff, Math.sqrt(dx * dx + dz * dz));
      h = h + (plateau.height - h) * m;
    }

    // 湖泊盆地：周圍降到湖岸高度，內部挖成碗狀
    {
      const dd = lakeDistance(x, z);
      const bank = 1 - smoothstep(1, lake.bankWidth, dd);
      h = h + (wl + lake.shoreHeight - h) * bank;
      const inner = 1 - smoothstep(0.8, 1, dd);
      h = h + (wl - lake.depth * (1 - dd * dd) - h) * inner;
    }

    // 湖心島
    {
      const dx = x - island.center[0];
      const dz = z - island.center[1];
      const d = Math.sqrt(dx * dx + dz * dz) / island.radius;
      const m = 1 - smoothstep(0.5, 1, d);
      h = h + (wl + island.height * (1 - d * d) - h) * m;
    }

    // 河道：河谷只往下壓到河岸高度，河床切到河面以下（河面在瀑布處有落差，淺灘處河床變淺）
    {
      const [d, s] = riverInfo(x, z);
      const level = riverLevel(s);
      const valley = 1 - smoothstep(river.width, river.width * river.valleyWidth, d);
      h = h + (Math.min(h, level + river.bankHeight) - h) * valley;
      const channel = 1 - smoothstep(river.width * 0.4, river.width, d);
      h = h + (level - riverDepth(s) - h) * channel;
    }

    return h;
  }

  // 與 GLSL 相同的有限差分法線
  function normal(x, z, e = cfg.normalStep) {
    const h0 = height(x, z);
    const nx = h0 - height(x + e, z);
    const nz = h0 - height(x, z + e);
    const len = Math.hypot(nx, e, nz);
    return [nx / len, e / len, nz / len];
  }

  // 生態區域權重（總和為 1）。優先序：古石環 > 山脊 > 湖 > 河谷 > 黑杉林 > 草原（其餘全部）
  function forestDistance(x, z) {
    const dx = x - forestCfg.center[0];
    const dz = z - forestCfg.center[1];
    const f = forestCfg.wobbleFrequency;
    const wob = 1 + forestCfg.wobble * (valueNoise(x * f, z * f, S.forest) * 2 - 1);
    return Math.sqrt(dx * dx + dz * dz) / (forestCfg.radius * wob);
  }

  const regionOut = new Float32Array(REGION_COUNT);
  function regionWeights(x, z, h = height(x, z), out = regionOut) {
    const sdx = x - stones.center[0];
    const sdz = z - stones.center[1];
    const wStones = 1 - smoothstep(R.stones.area.inner, R.stones.area.outer, Math.sqrt(sdx * sdx + sdz * sdz));
    const wRidge = smoothstep(R.ridge.area.heightFrom, R.ridge.area.heightTo, h);
    const wLake = 1 - smoothstep(R.lake.area.inner, R.lake.area.outer, lakeDistance(x, z));
    const wRiver = 1 - smoothstep(river.width * R.river.area.inner, river.width * R.river.area.outer, riverInfo(x, z)[0]);
    const wForest = 1 - smoothstep(R.forest.area.inner, 1, forestDistance(x, z));
    let rest = 1;
    out[REGION.stones] = wStones * rest;
    rest -= out[REGION.stones];
    out[REGION.ridge] = wRidge * rest;
    rest -= out[REGION.ridge];
    out[REGION.lake] = wLake * rest;
    rest -= out[REGION.lake];
    out[REGION.river] = wRiver * rest;
    rest -= out[REGION.river];
    out[REGION.forest] = wForest * rest;
    rest -= out[REGION.forest];
    out[REGION.meadow] = rest;
    return out;
  }

  // 河道上沿河距離 s 處的實際河心（折線點再扣掉蜿蜒偏移，以定點迭代反解）與流向
  function riverCenter(s) {
    let i = 0;
    while (i < segLen.length - 1 && cum[i + 1] < s) i++;
    const t = clamp01((s - cum[i]) / segLen[i]);
    const qx = rp[i][0] + (rp[i + 1][0] - rp[i][0]) * t;
    const qz = rp[i][1] + (rp[i + 1][1] - rp[i][1]) * t;
    let cx = qx;
    let cz = qz;
    for (let k = 0; k < 4; k++) {
      const [ox, oz] = riverWarp(cx, cz);
      cx = qx - ox;
      cz = qz - oz;
    }
    const tx = (rp[i + 1][0] - rp[i][0]) / segLen[i];
    const tz = (rp[i + 1][1] - rp[i][1]) / segLen[i];
    return { x: cx, z: cz, tx, tz, level: riverLevel(s) };
  }

  // ---- 道路網：泥土路，以 Catmull-Rom 樣條連接各區域（只影響地表與擺設，不改高度）----
  // 路線以「錨點」與控制點定義；錨點由地標算出，路一定接得上橋頭、棧道、淺灘：
  //   village / stones：樞紐，路從其邊緣（hubRadius）開始，朝下一個控制點
  //   bridgeSouth / bridgeNorth：石橋兩端；fordSouth / fordNorth：淺灘兩岸；boardwalk：棧道的岸邊；falls：瀑布旁
  const RD = cfg.roads;

  // 木棧道的岸邊：從湖心沿 angle 往外，第一個高出水面的點（biomes.js 也用這個點蓋棧道）
  const boardwalkShore = (() => {
    const dx = Math.cos(cfg.boardwalk.angle);
    const dz = Math.sin(cfg.boardwalk.angle);
    for (let d = lake.radius * 0.5; d < lake.radius * 1.6; d += 1) {
      const x = lake.center[0] + dx * d;
      const z = lake.center[1] + dz * d;
      if (height(x, z) > wl + 0.2) return { x, z, dx, dz, d };
    }
    return null;
  })();

  // 河道 s 處兩岸、距河心 offset 的兩點：[南側, 北側]
  function banks(s, offset) {
    const c = riverCenter(s);
    const a = [c.x - c.tz * offset, c.z + c.tx * offset];
    const b = [c.x + c.tz * offset, c.z - c.tx * offset];
    return a[1] > b[1] ? [a, b] : [b, a];
  }
  const [bridgeSouth, bridgeNorth] = banks(cfg.bridge.at, cfg.bridge.span / 2 + 0.5);
  const [fordSouth, fordNorth] = banks(ford.at, river.width * 1.8);
  const anchors = {
    bridgeSouth,
    bridgeNorth,
    fordSouth,
    fordNorth,
    falls: banks(fall.at - 20, river.width * 2.2)[1],
    boardwalk: boardwalkShore ? [boardwalkShore.x + boardwalkShore.dx * 3, boardwalkShore.z + boardwalkShore.dz * 3] : lake.center,
  };
  const hubs = { village: plateau.center, stones: stones.center };

  function resolvePath(path) {
    const pts = path.map((p) => (typeof p === 'string' ? anchors[p] ?? hubs[p] : p));
    for (const [i, j] of [
      [0, 1],
      [path.length - 1, path.length - 2],
    ]) {
      if (typeof path[i] === 'string' && hubs[path[i]]) {
        const [cx, cz] = hubs[path[i]];
        const dx = pts[j][0] - cx;
        const dz = pts[j][1] - cz;
        const l = Math.hypot(dx, dz) || 1;
        pts[i] = [cx + (dx / l) * RD.hubRadius[path[i]], cz + (dz / l) * RD.hubRadius[path[i]]];
      }
    }
    return pts;
  }

  // Catmull-Rom 樣條，約每 step 公尺取一點
  function spline(pts, step) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    return out;
  }

  const roads = RD.paths.map((path) => {
    const points = spline(resolvePath(path), RD.sampleStep);
    const len = [];
    const cumLen = [0];
    for (let i = 0; i < points.length - 1; i++) {
      len.push(Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
      cumLen.push(cumLen[i] + len[i]);
    }
    const pad = RD.width + 1;
    const min = [Math.min(...points.map((p) => p[0])) - pad, Math.min(...points.map((p) => p[1])) - pad];
    const max = [Math.max(...points.map((p) => p[0])) + pad, Math.max(...points.map((p) => p[1])) + pad];
    return { points, len, cum: cumLen, min, max };
  });

  // 每 ROAD_CHUNK 段一組的包圍盒（GLSL 用來跳過遠處的線段）：[起點索引, 終點索引, min, max]
  function roadChunks(r) {
    const out = [];
    const pad = RD.width + 1;
    for (let i0 = 0; i0 < r.len.length; i0 += ROAD_CHUNK) {
      const i1 = Math.min(r.len.length, i0 + ROAD_CHUNK);
      const pts = r.points.slice(i0, i1 + 1);
      out.push([
        i0,
        i1,
        [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad],
        [Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad],
      ]);
    }
    return out;
  }

  // [到最近道路中心線的距離, 沿路距離]
  function roadInfo(x, z) {
    let d = 1e9;
    let s = 0;
    for (const r of roads) {
      if (x < r.min[0] - 50 || z < r.min[1] - 50 || x > r.max[0] + 50 || z > r.max[1] + 50) continue;
      for (let i = 0; i < r.len.length; i++) {
        const p = r.points[i];
        const q = r.points[i + 1];
        const [di, t] = segment(x, z, p[0], p[1], q[0], q[1]);
        if (di < d) {
          d = di;
          s = r.cum[i] + t * r.len[i];
        }
      }
    }
    return [d, s];
  }
  const roadDistance = (x, z) => roadInfo(x, z)[0];

  // 地表材質的權重（與 GLSL 的 hfSurface 逐段對應，但不做隨機挑選、不分黑杉林的針葉與苔蘚）：
  // 給 JS 端判斷腳下是什麼地面（馬蹄揚塵、之後的腳步聲）。回傳的物件會重複使用
  const surfaceOut = { rock: 0, snow: 0, sand: 0, mud: 0, dry: 0, grass: 0, road: 0 };
  function surfaceWeights(x, z) {
    const sc = cfg.surface;
    const h = height(x, z);
    const ny = normal(x, z)[1];
    const above = h - wl;
    let wet = Math.max(
      1 - smoothstep(0, sc.moistureRange, above),
      Math.max(1 - smoothstep(river.width, river.width * sc.moistureRiver, riverInfo(x, z)[0]), 1 - smoothstep(1, sc.moistureLake, lakeDistance(x, z))),
    );
    wet = Math.min(1, Math.max(0, wet + (valueNoise(x * sc.moistureNoiseFrequency, z * sc.moistureNoiseFrequency, S.moisture) - 0.5) * sc.moistureNoise));
    const rock = 1 - smoothstep(sc.rockSlope - sc.rockBlend, sc.rockSlope + sc.rockBlend, ny);
    const snowJitter = (valueNoise(x * sc.snowNoiseFrequency, z * sc.snowNoiseFrequency, S.snow) - 0.5) * sc.snowNoise;
    const snow = smoothstep(sc.snowLine - sc.snowBlend, sc.snowLine + sc.snowBlend, h + snowJitter) * smoothstep(sc.snowFlat[0], sc.snowFlat[1], ny);
    const sand = (1 - smoothstep(sc.beachHeight * 0.4, sc.beachHeight, above)) * smoothstep(0.7, 0.85, ny);
    const mud = smoothstep(sc.mudWet[0], sc.mudWet[1], wet);
    const dry = (1 - smoothstep(sc.dryWet[0], sc.dryWet[1], wet)) * smoothstep(sc.dryNoise[0], sc.dryNoise[1], valueNoise(x * sc.dryNoiseFrequency, z * sc.dryNoiseFrequency, S.dry));
    const o = surfaceOut;
    let rest = 1 - rock;
    o.rock = rock;
    o.snow = snow * rest;
    rest -= o.snow;
    o.sand = sand * rest;
    rest -= o.sand;
    o.mud = mud * rest;
    rest -= o.mud;
    o.dry = dry * rest;
    rest -= o.dry;
    o.grass = rest;
    // 道路：岩壁、雪、沙以外的地方，中心線附近是泥土路
    const road = 1 - smoothstep(RD.width * 0.55, RD.width, roadDistance(x, z));
    o.road = road * (1 - o.rock - o.snow - o.sand);
    return o;
  }

  // ---- GLSL：與上面逐段對應 ----
  const s = cfg.surface;
  const layerGlsl = layers
    .map(
      (l, i) => /* glsl */ `
float hfLayer${i}(vec2 p) {
  float sum = 0.0;
  float f = ${glf(l.frequency)};
  float a = ${glf(l.amplitude)};
  for (int o = 0; o < ${l.octaves}; o++) {
    sum += a * (hfNoise(p * f, ${glu(l.seed)} + uint(o)) * 2.0 - 1.0);
    f *= 2.0;
    a *= 0.5;
  }
  return sum;
}`,
    )
    .join('\n');
  const n = rp.length;
  const vec2s = (list) => list.map(([x, z]) => `vec2(${glf(x)}, ${glf(z)})`).join(', ');
  const floats = (list) => list.map(glf).join(', ');
  const surfaceIndex = Object.fromEntries(cfg.surfaces.map((name, i) => [name, i]));
  const si = (name) => {
    if (!(name in surfaceIndex)) throw new Error(`terrain.surfaces is missing "${name}"`);
    return surfaceIndex[name];
  };

  const glsl = /* glsl */ `
uint hfHash(ivec2 c, uint seed) {
  uvec2 q = uvec2(c);
  uint h = (q.x * 0x27d4eb2du) ^ (q.y * 0x165667b1u) ^ (seed * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
float hfHash01(ivec2 c, uint seed) { return float(hfHash(c, seed) >> 8u) / 16777216.0; }
float hfNoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 c = ivec2(i) + ${OFFSET};
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hfHash01(c, seed);
  float b = hfHash01(c + ivec2(1, 0), seed);
  float cc = hfHash01(c + ivec2(0, 1), seed);
  float d = hfHash01(c + ivec2(1, 1), seed);
  float ab = a + (b - a) * u.x;
  float cd = cc + (d - cc) * u.x;
  return ab + (cd - ab) * u.y;
}
vec2 hfSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return vec2(length(p - (a + ab * t)), t);
}
${layerGlsl}
const vec2 HF_RIVER[${n}] = vec2[${n}](${vec2s(rp)});
const float HF_RIVER_CUM[${n}] = float[${n}](${floats(cum)});
const float HF_RIVER_LEN[${n - 1}] = float[${n - 1}](${floats(segLen)});
vec2 hfRiver(vec2 p) {
  float f = ${glf(river.warpFrequency)};
  vec2 w = p + ${glf(river.warp)} * vec2(hfNoise(p * f, ${glu(S.warpX)}) * 2.0 - 1.0, hfNoise(p * f, ${glu(S.warpZ)}) * 2.0 - 1.0);
  float d = 1e9;
  float s = 0.0;
  for (int i = 0; i < ${n - 1}; i++) {
    vec2 st = hfSegment(w, HF_RIVER[i], HF_RIVER[i + 1]);
    if (st.x < d) {
      d = st.x;
      s = HF_RIVER_CUM[i] + st.y * HF_RIVER_LEN[i];
    }
  }
  return vec2(d, s);
}
${roads
  .map(
    (r, k) => `const vec2 HF_ROAD${k}[${r.points.length}] = vec2[${r.points.length}](${vec2s(r.points)});
const float HF_ROAD${k}_CUM[${r.points.length}] = float[${r.points.length}](${floats(r.cum)});`,
  )
  .join('\n')}
// 道路：vec2(到最近道路中心線的距離, 沿路距離)。每條路切成每 ${ROAD_CHUNK} 段一組，各組先以包圍盒排除
// （所有路都從村子出發，只看整條路的包圍盒的話，村子裡每個像素都要測過全部的線段）
vec2 hfRoad(vec2 p) {
  float d = 1e9;
  float s = 0.0;
${roads
  .flatMap((r, k) => roadChunks(r).map(([i0, i1, min, max]) => `  if (p.x > ${glf(min[0])} && p.y > ${glf(min[1])} && p.x < ${glf(max[0])} && p.y < ${glf(max[1])}) {
    for (int i = ${i0}; i < ${i1}; i++) {
      vec2 st = hfSegment(p, HF_ROAD${k}[i], HF_ROAD${k}[i + 1]);
      if (st.x < d) {
        d = st.x;
        s = HF_ROAD${k}_CUM[i] + st.y * (HF_ROAD${k}_CUM[i + 1] - HF_ROAD${k}_CUM[i]);
      }
    }
  }`))
  .join('\n')}
  return vec2(d, s);
}
float hfRiverLevel(float s) {
  return ${glf(wl)} + ${glf(fall.height)} * smoothstep(${glf(fall.at - fall.length / 2)}, ${glf(fall.at + fall.length / 2)}, s);
}
float hfRiverDepth(float s) {
  return ${glf(river.depth)} * (1.0 - ${glf(ford.strength)} * (1.0 - smoothstep(0.0, ${glf(ford.length)}, abs(s - ${glf(ford.at)}))));
}
float hfLakeDistance(vec2 p) {
  float wob = 1.0 + ${glf(lake.wobble)} * (hfNoise(p * ${glf(lake.wobbleFrequency)}, ${glu(S.lake)}) * 2.0 - 1.0);
  return length(p - vec2(${glf(lake.center[0])}, ${glf(lake.center[1])})) / (${glf(lake.radius)} * wob);
}
float hfForestDistance(vec2 p) {
  float wob = 1.0 + ${glf(forestCfg.wobble)} * (hfNoise(p * ${glf(forestCfg.wobbleFrequency)}, ${glu(S.forest)}) * 2.0 - 1.0);
  return length(p - vec2(${glf(forestCfg.center[0])}, ${glf(forestCfg.center[1])})) / (${glf(forestCfg.radius)} * wob);
}
float hfHeight(vec2 p) {
  float h = ${glf(cfg.baseHeight)};
  ${layers.map((_, i) => `h += hfLayer${i}(p);`).join('\n  ')}
  {
    vec2 st = hfSegment(p, vec2(${glf(ridge.from[0])}, ${glf(ridge.from[1])}), vec2(${glf(ridge.to[0])}, ${glf(ridge.to[1])}));
    float profile = 1.0 - smoothstep(0.0, ${glf(ridge.width)}, st.x);
    float bell = 4.0 * st.y * (1.0 - st.y);
    float taper = 1.0 - (1.0 - bell) * (1.0 - bell);
    float rn = 1.0 - abs(hfNoise(p * ${glf(ridge.noiseFrequency)}, ${glu(S.ridge)}) * 2.0 - 1.0);
    h += ${glf(ridge.height)} * profile * profile * taper * (${glf(1 - ridge.roughness)} + ${glf(ridge.roughness)} * rn);
  }
  {
    float e = max(abs(p.x), abs(p.y));
    h += ${glf(rim.height)} * smoothstep(${glf(rim.start)}, ${glf(rim.end)}, e);
  }
  {
    float m = 1.0 - smoothstep(${glf(stones.topRadius)}, ${glf(stones.hillRadius)}, length(p - vec2(${glf(stones.center[0])}, ${glf(stones.center[1])})));
    h = h + (${glf(stones.topHeight)} - h) * m * m * (3.0 - 2.0 * m);
  }
  {
    float m = 1.0 - smoothstep(${glf(plateau.radius)}, ${glf(plateau.radius + plateau.falloff)}, length(p - vec2(${glf(plateau.center[0])}, ${glf(plateau.center[1])})));
    h = h + (${glf(plateau.height)} - h) * m;
  }
  {
    float dd = hfLakeDistance(p);
    float bank = 1.0 - smoothstep(1.0, ${glf(lake.bankWidth)}, dd);
    h = h + (${glf(wl + lake.shoreHeight)} - h) * bank;
    float inner = 1.0 - smoothstep(0.8, 1.0, dd);
    h = h + (${glf(wl)} - ${glf(lake.depth)} * (1.0 - dd * dd) - h) * inner;
  }
  {
    float d = length(p - vec2(${glf(island.center[0])}, ${glf(island.center[1])})) / ${glf(island.radius)};
    float m = 1.0 - smoothstep(0.5, 1.0, d);
    h = h + (${glf(wl)} + ${glf(island.height)} * (1.0 - d * d) - h) * m;
  }
  {
    vec2 ds = hfRiver(p);
    float level = hfRiverLevel(ds.y);
    float valley = 1.0 - smoothstep(${glf(river.width)}, ${glf(river.width * river.valleyWidth)}, ds.x);
    h = h + (min(h, level + ${glf(river.bankHeight)}) - h) * valley;
    float channel = 1.0 - smoothstep(${glf(river.width * 0.4)}, ${glf(river.width)}, ds.x);
    h = h + (level - hfRiverDepth(ds.y) - h) * channel;
  }
  return h;
}

// 生態區域權重：0 草原 1 黑杉林 2 湖 3 河谷 4 古石環 5 山脊
void hfRegions(vec2 p, float h, float riverD, out float w[${REGION_COUNT}]) {
  float wStones = 1.0 - smoothstep(${glf(R.stones.area.inner)}, ${glf(R.stones.area.outer)}, length(p - vec2(${glf(stones.center[0])}, ${glf(stones.center[1])})));
  float wRidge = smoothstep(${glf(R.ridge.area.heightFrom)}, ${glf(R.ridge.area.heightTo)}, h);
  float wLake = 1.0 - smoothstep(${glf(R.lake.area.inner)}, ${glf(R.lake.area.outer)}, hfLakeDistance(p));
  float wRiver = 1.0 - smoothstep(${glf(river.width * R.river.area.inner)}, ${glf(river.width * R.river.area.outer)}, riverD);
  float wForest = 1.0 - smoothstep(${glf(R.forest.area.inner)}, 1.0, hfForestDistance(p));
  float rest = 1.0;
  w[4] = wStones * rest; rest -= w[4];
  w[5] = wRidge * rest; rest -= w[5];
  w[2] = wLake * rest; rest -= w[2];
  w[3] = wRiver * rest; rest -= w[3];
  w[1] = wForest * rest; rest -= w[1];
  w[0] = rest;
}

// 地表材質：依高度、坡度（法線 y）、濕度、區域決定各材質的權重，再以世界座標雜湊 rnd 隨機挑一種，
// 所以交界處兩種字元自然交錯混合，不會硬切。回傳 terrain.surfaces 的索引。
//   黑杉林：草地換成針葉地面與苔蘚；草原：近處偶有野花（rnd2 決定）；道路：泥土路，邊緣與周圍混合（rnd3）
int hfSurface(vec2 p, float h, float ny, float rnd, float rnd2, float rnd3, float viewZ, out float forest) {
  float riverD = hfRiver(p).x;
  float rw[${REGION_COUNT}];
  hfRegions(p, h, riverD, rw);
  forest = rw[1];
  float above = h - ${glf(wl)};
  float wet = max(1.0 - smoothstep(0.0, ${glf(s.moistureRange)}, above),
              max(1.0 - smoothstep(${glf(river.width)}, ${glf(river.width * s.moistureRiver)}, riverD),
                  1.0 - smoothstep(1.0, ${glf(s.moistureLake)}, hfLakeDistance(p))));
  wet = clamp(wet + (hfNoise(p * ${glf(s.moistureNoiseFrequency)}, ${glu(S.moisture)}) - 0.5) * ${glf(s.moistureNoise)}, 0.0, 1.0);
  float rock = 1.0 - smoothstep(${glf(s.rockSlope - s.rockBlend)}, ${glf(s.rockSlope + s.rockBlend)}, ny);
  float snowJitter = (hfNoise(p * ${glf(s.snowNoiseFrequency)}, ${glu(S.snow)}) - 0.5) * ${glf(s.snowNoise)};
  float snow = smoothstep(${glf(s.snowLine - s.snowBlend)}, ${glf(s.snowLine + s.snowBlend)}, h + snowJitter)
             * smoothstep(${glf(s.snowFlat[0])}, ${glf(s.snowFlat[1])}, ny);
  float sand = (1.0 - smoothstep(${glf(s.beachHeight * 0.4)}, ${glf(s.beachHeight)}, above)) * smoothstep(0.7, 0.85, ny);
  float mud = smoothstep(${glf(s.mudWet[0])}, ${glf(s.mudWet[1])}, wet);
  float dry = (1.0 - smoothstep(${glf(s.dryWet[0])}, ${glf(s.dryWet[1])}, wet))
            * smoothstep(${glf(s.dryNoise[0])}, ${glf(s.dryNoise[1])}, hfNoise(p * ${glf(s.dryNoiseFrequency)}, ${glu(S.dry)}));
  // 優先序：岩壁 > 雪 > 沙 > 泥 > 乾草 > 草，各自只分到前面剩下的份量，總和為 1
  float wRock = rock;
  float rest = 1.0 - wRock;
  float wSnow = snow * rest; rest -= wSnow;
  float wSand = sand * rest; rest -= wSand;
  float wMud = mud * rest; rest -= wMud;
  float wDry = dry * rest; rest -= wDry;
  float wGrass = rest;
  // 黑杉林：草與乾草的份量改給針葉地面，其中一部分是苔蘚斑塊
  float floorShare = (wDry + wGrass) * forest;
  wDry *= 1.0 - forest;
  wGrass *= 1.0 - forest;
  float moss = smoothstep(${glf(s.mossNoise[0])}, ${glf(s.mossNoise[1])}, hfNoise(p * ${glf(s.mossNoiseFrequency)}, ${glu(S.moss)}));
  float wMoss = floorShare * moss;
  float wNeedles = floorShare - wMoss;
  int pick = ${si('grass')};
  float c = wRock;
  if (rnd < c) pick = ${si('rock')};
  else if (rnd < (c += wSnow)) pick = ${si('snow')};
  else if (rnd < (c += wSand)) pick = ${si('sand')};
  else if (rnd < (c += wMud)) pick = ${si('mud')};
  else if (rnd < (c += wNeedles)) pick = ${si('needles')};
  else if (rnd < (c += wMoss)) pick = ${si('moss')};
  else if (rnd < (c += wDry)) pick = ${si('dryGrass')};
  // 道路：岩壁、雪與水邊以外，中心線附近一律是泥土路，邊緣逐漸混入原本的地表。
  // 近處的路面有兩道車轍與中間的蹄印（遠處小於一個字元格，不畫）
  vec2 rd = hfRoad(p);
  float road = 1.0 - smoothstep(${glf(RD.width * 0.55)}, ${glf(RD.width)}, rd.x);
  if (pick != ${si('rock')} && pick != ${si('snow')} && pick != ${si('sand')} && rnd3 < road) {
    float near = 1.0 - smoothstep(${glf(RD.detailFade[0])}, ${glf(RD.detailFade[1])}, viewZ);
    if (rnd2 < near) {
      if (abs(rd.x - ${glf(RD.ruts.offset)}) < ${glf(RD.ruts.width)}) return ${si('rut')};
      float k = floor(rd.y / ${glf(RD.hoof.step)});
      float f = rd.y / ${glf(RD.hoof.step)} - k;
      float lane = ${glf(RD.hoof.lane)} * hfHash01(ivec2(int(k) + ${OFFSET}, 17), ${glu(S.hoof)});
      if (abs(rd.x - lane) < ${glf(RD.hoof.size)} && abs(f - 0.5) < ${glf(RD.hoof.length)}) return ${si('hoofprint')};
    }
    return ${si('path')};
  }
  // 草原的野花：只開在草上，近處才看得到
  float flowers = rw[0] * ${glf(s.flowerDensity)} * (1.0 - smoothstep(${glf(s.flowerFade[0])}, ${glf(s.flowerFade[1])}, viewZ));
  if ((pick == ${si('grass')} || pick == ${si('dryGrass')}) && rnd2 < flowers) {
    float k = rnd2 / flowers;
    pick = k < 0.4 ? ${si('flowerRed')} : k < 0.75 ? ${si('flowerGold')} : ${si('flowerViolet')};
  }
  return pick;
}
`;

  return {
    height,
    normal,
    riverInfo,
    riverCenter,
    riverLength,
    lakeDistance,
    forestDistance,
    roadDistance,
    roadInfo,
    surfaceWeights,
    roads,
    anchors,
    boardwalkShore,
    regionWeights,
    glsl,
  };
}
