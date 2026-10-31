// 地形：世界切成 chunkSize 的正方形區塊。
//   近景：玩家周圍 (2r+1)² 塊「載入」——在 CPU 上以高度函式取樣成高度快取，以高精度網格繪製
//   遠景：其餘在 viewDistance 內的區塊以低精度網格繪製
// 網格是共用的平面格子，高度在 GPU 頂點 shader 以同一個高度函式（GLSL 版）位移，
// 近景與遠景各是一個 InstancedMesh，各一次繪製呼叫。不同 LOD 之間的裂縫由裙邊遮住。
//
// heightAt() 回傳「畫出來的地面」高度：載入的區塊用高度快取，以與 GPU 網格相同的三角形切法內插，
// 騎馬貼地、草葉、物件擺放都對齊畫面上的地面；未載入處退回解析高度函式。
import * as THREE from 'three';

// size × size 的平面格子（局部座標 0..size），加四邊裙邊（y = -1 標記，shader 中往下延伸）。
// 每格對角線由 (0,0) 到 (1,1)，三角形 (00, 01, 11) 與 (00, 11, 10)——heightAt 依此內插。
function buildChunkGeometry(size, segments) {
  const n1 = segments + 1;
  const step = size / segments;
  const positions = [];
  const index = [];
  for (let j = 0; j < n1; j++) {
    for (let i = 0; i < n1; i++) positions.push(i * step, 0, j * step);
  }
  const at = (i, j) => j * n1 + i;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      index.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
    }
  }
  // 裙邊：沿四邊各一排往下的頂點
  const edges = [
    Array.from({ length: n1 }, (_, i) => at(i, 0)),
    Array.from({ length: n1 }, (_, j) => at(segments, j)),
    Array.from({ length: n1 }, (_, i) => at(segments - i, segments)),
    Array.from({ length: n1 }, (_, j) => at(0, segments - j)),
  ];
  for (const edge of edges) {
    const base = positions.length / 3;
    for (const v of edge) positions.push(positions[v * 3], -1, positions[v * 3 + 2]);
    for (let k = 0; k < edge.length - 1; k++) {
      index.push(edge[k], base + k, base + k + 1, edge[k], base + k + 1, edge[k + 1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

export function createTerrain(cfg, worldCfg, materials, heightField) {
  const CS = cfg.chunkSize;
  const half = worldCfg.size / 2;
  const N = Math.round(worldCfg.size / CS);
  const R = cfg.loadRadius;
  const seg = cfg.lod.near.segments;
  const n1 = seg + 1;
  const step = CS / seg;

  const material = materials.terrain();
  const nearMesh = new THREE.InstancedMesh(buildChunkGeometry(CS, seg), material, (2 * R + 1) ** 2);
  const farMesh = new THREE.InstancedMesh(buildChunkGeometry(CS, cfg.lod.far.segments), material, N * N);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(worldCfg.size, worldCfg.size, 8, 8), materials.get('water'));
  water.rotation.x = -Math.PI / 2;
  water.position.y = cfg.waterLevel;
  const group = new THREE.Group();
  group.name = 'terrain';
  for (const mesh of [nearMesh, farMesh, water]) {
    mesh.frustumCulled = false; // 頂點在 GPU 位移，CPU 端的包圍體不可靠
    mesh.layers.set(1); // 不畫進陰影貼圖（地形只接收影子）
    group.add(mesh);
  }
  nearMesh.count = 0;
  farMesh.count = 0;

  const loaded = new Map(); // key → { cx, cz, x0, z0, heights }
  let wanted = new Set();
  let queue = [];
  let centerKey = -1;
  let layoutDirty = true;
  const stats = { loaded: 0, near: 0, far: 0, pending: 0 };
  const matrix = new THREE.Matrix4();

  const keyOf = (cx, cz) => cz * N + cx;
  const chunkOf = (v) => Math.min(N - 1, Math.max(0, Math.floor((v + half) / CS)));

  function load(cx, cz) {
    const x0 = cx * CS - half;
    const z0 = cz * CS - half;
    const heights = new Float32Array(n1 * n1);
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) heights[j * n1 + i] = heightField.height(x0 + i * step, z0 + j * step);
    }
    loaded.set(keyOf(cx, cz), { cx, cz, x0, z0, heights });
    layoutDirty = true;
  }

  function rebuildInstances(focus) {
    layoutDirty = false;
    let near = 0;
    for (const c of loaded.values()) {
      matrix.makeTranslation(c.x0, 0, c.z0);
      nearMesh.setMatrixAt(near++, matrix);
    }
    let far = 0;
    const limit = cfg.viewDistance + CS * 0.71; // 區塊中心到最遠角的距離
    for (let cz = 0; cz < N; cz++) {
      for (let cx = 0; cx < N; cx++) {
        if (loaded.has(keyOf(cx, cz))) continue;
        const x0 = cx * CS - half;
        const z0 = cz * CS - half;
        if (Math.hypot(x0 + CS / 2 - focus.x, z0 + CS / 2 - focus.z) > limit) continue;
        matrix.makeTranslation(x0, 0, z0);
        farMesh.setMatrixAt(far++, matrix);
      }
    }
    nearMesh.count = near;
    farMesh.count = far;
    nearMesh.instanceMatrix.needsUpdate = true;
    farMesh.instanceMatrix.needsUpdate = true;
    stats.near = near;
    stats.far = far;
  }

  // 每幀呼叫。進入新區塊時重算要載入的範圍；每幀最多載入 loadPerFrame 塊，避免卡頓。
  // sync = true 時一次載完（開場用）。
  function update(focus, sync = false) {
    const fcx = chunkOf(focus.x);
    const fcz = chunkOf(focus.z);
    const key = keyOf(fcx, fcz);
    if (key !== centerKey) {
      centerKey = key;
      wanted = new Set();
      const list = [];
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const cx = fcx + dx;
          const cz = fcz + dz;
          if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
          wanted.add(keyOf(cx, cz));
          if (!loaded.has(keyOf(cx, cz))) list.push([cx, cz, dx * dx + dz * dz]);
        }
      }
      for (const k of loaded.keys()) {
        if (!wanted.has(k)) {
          loaded.delete(k);
          layoutDirty = true;
        }
      }
      queue = list.sort((a, b) => a[2] - b[2]); // 近的先載
      layoutDirty = true;
    }
    let budget = sync ? Infinity : cfg.loadPerFrame;
    while (queue.length && budget-- > 0) {
      const [cx, cz] = queue.shift();
      if (wanted.has(keyOf(cx, cz)) && !loaded.has(keyOf(cx, cz))) load(cx, cz);
    }
    if (layoutDirty) rebuildInstances(focus);
    stats.loaded = loaded.size;
    stats.pending = queue.length;
  }

  // 畫出來的地面高度（見檔頭）
  function heightAt(x, z) {
    const c = loaded.get(keyOf(chunkOf(x), chunkOf(z)));
    if (!c) return heightField.height(x, z);
    const lx = (x - c.x0) / step;
    const lz = (z - c.z0) / step;
    const i = Math.min(seg - 1, Math.max(0, Math.floor(lx)));
    const j = Math.min(seg - 1, Math.max(0, Math.floor(lz)));
    const fx = lx - i;
    const fz = lz - j;
    const h = c.heights;
    const h00 = h[j * n1 + i];
    const h10 = h[j * n1 + i + 1];
    const h01 = h[(j + 1) * n1 + i];
    const h11 = h[(j + 1) * n1 + i + 1];
    return fz >= fx ? h00 + (h11 - h01) * fx + (h01 - h00) * fz : h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }

  // 水面高度：瀑布以上的河段有自己的（較高的）水面，其餘為全域水位
  const upperReach = cfg.river.width * 1.3 + 3;
  function waterSurfaceAt(x, z) {
    const [d, s] = heightField.riverInfo(x, z);
    return d < upperReach && s > cfg.river.fall.at ? cfg.waterLevel + cfg.river.fall.height : cfg.waterLevel;
  }

  return {
    group,
    stats,
    update,
    heightAt,
    exactHeightAt: heightField.height,
    normalAt: heightField.normal,
    surfaceAt: heightField.surfaceWeights, // 地表材質的權重 { rock, snow, sand, mud, dry, grass, road }
    waterLevel: cfg.waterLevel,
    waterSurfaceAt,
    // 水深（公尺，0 表示沒有水）
    waterDepthAt: (x, z) => Math.max(0, waterSurfaceAt(x, z) - heightAt(x, z)),
  };
}
