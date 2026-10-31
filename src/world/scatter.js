// Poisson 圓盤取樣（Bridson 演算法），依區塊產生：每個區塊用自己的最小間距與固定種子，
// 但與已產生的鄰近區塊共用同一張格子，跨邊界也維持最小距離——物件不會擠在一起，也不會排成格子。
// 區塊依固定順序產生，所以結果與載入順序無關，每次都一樣。
// 同一種間距的點彼此至少相距該間距；不同間距的點（例如樹與倒木）之間至少相距較小的那個。
// 取樣後沒被採用的點用 remove() 移出格子，空出來的位置留給後面的物件。

export function createPoissonScatter(worldSize, chunkSize, minSpacing) {
  const half = worldSize / 2;
  const cell = minSpacing / Math.SQRT2; // 每格至多一個點
  const n = Math.ceil(worldSize / cell);
  const grid = new Int32Array(n * n).fill(-1);
  const xs = [];
  const zs = [];
  const rs = [];

  const gi = (v) => Math.min(n - 1, Math.max(0, Math.floor((v + half) / cell)));

  function fits(x, z, r) {
    const gx = gi(x);
    const gz = gi(z);
    const reach = Math.ceil(Math.max(r, minSpacing) / cell) + 1;
    for (let dz = -reach; dz <= reach; dz++) {
      const row = gz + dz;
      if (row < 0 || row >= n) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const col = gx + dx;
        if (col < 0 || col >= n) continue;
        const i = grid[row * n + col];
        if (i < 0) continue;
        const m = rs[i] === r ? r : Math.min(r, rs[i]);
        const ex = xs[i] - x;
        const ez = zs[i] - z;
        if (ex * ex + ez * ez < m * m) return false;
      }
    }
    return true;
  }

  function add(x, z, r) {
    const i = xs.length;
    xs.push(x);
    zs.push(z);
    rs.push(r);
    grid[gi(z) * n + gi(x)] = i;
    return i;
  }

  function remove(i) {
    const cellIndex = gi(zs[i]) * n + gi(xs[i]);
    if (grid[cellIndex] === i) grid[cellIndex] = -1;
  }

  // 在區塊 (cx, cz) 內以間距 r 取樣，回傳新點的 [x, z, index] 陣列。k：每個活躍點嘗試的候選數
  function chunk(cx, cz, r, rng, k = 18) {
    const x0 = cx * chunkSize - half;
    const z0 = cz * chunkSize - half;
    const inside = (x, z) => x >= x0 && x < x0 + chunkSize && z >= z0 && z < z0 + chunkSize;
    const out = [];
    const active = [];
    for (let t = 0; t < 12 && !active.length; t++) {
      const x = x0 + rng.next() * chunkSize;
      const z = z0 + rng.next() * chunkSize;
      if (fits(x, z, r)) {
        const i = add(x, z, r);
        active.push(i);
        out.push([x, z, i]);
      }
    }
    while (active.length) {
      const ai = Math.floor(rng.next() * active.length);
      const p = active[ai];
      let found = false;
      for (let j = 0; j < k; j++) {
        const a = rng.next() * Math.PI * 2;
        const d = r * (1 + rng.next());
        const x = xs[p] + Math.cos(a) * d;
        const z = zs[p] + Math.sin(a) * d;
        if (!inside(x, z) || !fits(x, z, r)) continue;
        const i = add(x, z, r);
        active.push(i);
        out.push([x, z, i]);
        found = true;
      }
      if (!found) {
        active[ai] = active[active.length - 1];
        active.pop();
      }
    }
    return out;
  }

  return { chunk, fits, add, remove };
}
