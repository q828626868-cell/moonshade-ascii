// 物理：
//   碰撞體：軸對齊盒子、定向盒子、垂直圓柱。身體在 XZ 平面是膠囊（人：圓柱；馬：沿身體的膠囊），
//   被推出的方向回傳成接觸法線，讓移動模型沿著障礙物表面滑過去。
//   平台：可走上去的定向矩形頂面（橋面、棧道）；高出地面不超過 stepHeight 就能踏上。
//   深水：水深超過 maxWadeDepth 的地方走不進去（平台上除外），角色沿岸滑動。
//   射線：給鏡頭用，回傳最近的命中距離。
// 碰撞體放進 gridSize 的空間格，查詢只看附近的格（世界裡有數千棵樹）。

export function createPhysics(cfg, worldCfg, terrain) {
  const half = worldCfg.size / 2;
  const G = cfg.gridSize;
  const grid = new Map(); // key → colliders[]
  const platforms = [];
  let stamp = 0; // 查詢去重用
  // 開發者面板：靜態碰撞體數、空間格數、本幀的查詢次數與實際檢查的碰撞體數（resetStats 每幀歸零）
  const stats = { colliders: 0, queries: 0, tested: 0 };

  const keyOf = (gx, gz) => gz * 4096 + gx;
  function insert(c, minX, minZ, maxX, maxZ) {
    stats.colliders++;
    for (let gz = Math.floor((minZ + half) / G); gz <= Math.floor((maxZ + half) / G); gz++) {
      for (let gx = Math.floor((minX + half) / G); gx <= Math.floor((maxX + half) / G); gx++) {
        const k = keyOf(gx, gz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  function addBox(min, max) {
    const c = { box: true, min, max, mark: 0 };
    insert(c, min[0], min[2], max[0], max[2]);
    return c;
  }

  function addCylinder(x, z, r, y0, y1) {
    const c = { box: false, x, z, r, y0, y1, mark: 0 };
    insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  // 定向盒子（房屋、柵欄、攤位）：中心 (x, z)、長軸方向 (ux, uz)、半長、半寬、y0–y1
  function addOrientedBox({ x, z, ux, uz, halfLength, halfWidth, y0, y1 }) {
    const c = { obb: true, x, z, ux, uz, halfLength, halfWidth, y0, y1, mark: 0 };
    const r = Math.hypot(halfLength, halfWidth);
    insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  // 定向矩形平台：中心 (x, z)、長軸方向 (ux, uz)（單位向量）、半長、半寬、頂面高度
  function addPlatform({ x, z, ux, uz, halfLength, halfWidth, top }) {
    const p = { x, z, ux, uz, halfLength, halfWidth, top, mark: 0, platform: true };
    platforms.push(p);
    const r = Math.hypot(halfLength, halfWidth);
    insert(p, x - r, z - r, x + r, z + r);
    return p;
  }

  // 會移動的碰撞體（例如停著的馬）：不進空間格，每次查詢都檢查；設 disabled = true 可暫時停用，noCamera = true 不擋鏡頭
  const dynamic = [];
  function addDynamic(c) {
    dynamic.push(c);
    return c;
  }

  // 收集 (minX..maxX, minZ..maxZ) 範圍內的碰撞體，每個只回呼一次
  function each(minX, minZ, maxX, maxZ, fn) {
    stamp++;
    stats.queries++;
    for (const c of dynamic) if (!c.disabled) fn(c);
    for (let gz = Math.floor((minZ + half) / G); gz <= Math.floor((maxZ + half) / G); gz++) {
      for (let gx = Math.floor((minX + half) / G); gx <= Math.floor((maxX + half) / G); gx++) {
        const list = grid.get(keyOf(gx, gz));
        if (!list) continue;
        for (const c of list) {
          if (c.mark === stamp) continue;
          c.mark = stamp;
          stats.tested++;
          fn(c);
        }
      }
    }
  }

  function platformTop(p, x, z) {
    const dx = x - p.x;
    const dz = z - p.z;
    const along = dx * p.ux + dz * p.uz;
    const across = -dx * p.uz + dz * p.ux;
    return Math.abs(along) <= p.halfLength && Math.abs(across) <= p.halfWidth ? p.top : -Infinity;
  }

  // 腳下的高度：地面，或腳邊夠得著的平台頂面
  function groundAt(x, z, feetY) {
    let h = terrain.heightAt(x, z);
    each(x, z, x, z, (c) => {
      if (!c.platform) return;
      const top = platformTop(c, x, z);
      if (top > h && feetY >= top - cfg.stepHeight) h = top;
    });
    return h;
  }

  function onPlatform(x, z, feetY) {
    let on = false;
    each(x, z, x, z, (c) => {
      if (c.platform && Math.abs(platformTop(c, x, z) - feetY) < cfg.stepHeight) on = true;
    });
    return on;
  }

  const tooDeep = (x, z, feetY, maxDepth) => terrain.waterDepthAt(x, z) > maxDepth && !onPlatform(x, z, feetY);

  // 身體：XZ 平面上的膠囊（中心 pos、軸線 pos ± (ax, az)、半徑 radius；軸長 0 時就是圓柱）。
  // 對每個碰撞體找身體軸線上離它最近的點，穿透就把整個身體推出去；推出的位移累積成接觸法線（給沿牆滑動用）。
  const contact = { nx: 0, nz: 0, push: 0 };
  let sumX = 0;
  let sumZ = 0;
  function pushBody(pos, wx, wz) {
    pos.x += wx;
    pos.z += wz;
    sumX += wx;
    sumZ += wz;
  }
  // 線段 A→B（局部座標）與以原點為中心、半邊長 hx × hz 的矩形：最近點交替投影（凸形狀，幾次就收斂）
  const seg = { px: 0, pz: 0, qx: 0, qz: 0 };
  function segmentBox(ax0, az0, bx0, bz0, hx, hz) {
    const ex = bx0 - ax0;
    const ez = bz0 - az0;
    const ll = ex * ex + ez * ez;
    let t = 0.5;
    for (let n = 0; n < 4; n++) {
      const px = ax0 + ex * t;
      const pz = az0 + ez * t;
      const qx = Math.min(Math.max(px, -hx), hx);
      const qz = Math.min(Math.max(pz, -hz), hz);
      if (ll < 1e-12) break;
      t = Math.min(1, Math.max(0, ((qx - ax0) * ex + (qz - az0) * ez) / ll));
    }
    seg.px = ax0 + ex * t;
    seg.pz = az0 + ez * t;
    seg.qx = Math.min(Math.max(seg.px, -hx), hx);
    seg.qz = Math.min(Math.max(seg.pz, -hz), hz);
  }

  function resolve(pos, radius, height, ax, az) {
    const ext = radius + Math.hypot(ax, az);
    for (let iter = 0; iter < cfg.iterations; iter++) {
      each(pos.x - ext, pos.z - ext, pos.x + ext, pos.z + ext, (c) => {
        if (c.platform) return;
        if (c.obb || c.box) {
          // 盒子：轉到盒子的局部座標（定向盒子有自己的長軸）
          let cx, cz, hx, hz, ux, uz;
          if (c.obb) {
            if (pos.y >= c.y1 || pos.y + height <= c.y0) return;
            cx = c.x;
            cz = c.z;
            hx = c.halfLength;
            hz = c.halfWidth;
            ux = c.ux;
            uz = c.uz;
          } else {
            if (pos.y >= c.max[1] || pos.y + height <= c.min[1]) return;
            cx = (c.min[0] + c.max[0]) / 2;
            cz = (c.min[2] + c.max[2]) / 2;
            hx = (c.max[0] - c.min[0]) / 2;
            hz = (c.max[2] - c.min[2]) / 2;
            ux = 1;
            uz = 0;
          }
          const lx = (wx, wz) => (wx - cx) * ux + (wz - cz) * uz;
          const lz = (wx, wz) => -(wx - cx) * uz + (wz - cz) * ux;
          segmentBox(lx(pos.x - ax, pos.z - az), lz(pos.x - ax, pos.z - az), lx(pos.x + ax, pos.z + az), lz(pos.x + ax, pos.z + az), hx, hz);
          const ox = seg.px - seg.qx;
          const oz = seg.pz - seg.qz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= radius * radius) return;
          let px = 0;
          let pz = 0;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2);
            px = (ox / d) * (radius - d);
            pz = (oz / d) * (radius - d);
          } else {
            // 軸線已經在盒內：沿穿透最淺的軸推出
            const ex = hx - Math.abs(seg.px) + radius;
            const ez = hz - Math.abs(seg.pz) + radius;
            if (ex < ez) px = Math.sign(seg.px || 1) * ex;
            else pz = Math.sign(seg.pz || 1) * ez;
          }
          pushBody(pos, px * ux - pz * uz, px * uz + pz * ux);
          return;
        }
        // 垂直圓柱：軸線上離圓心最近的點
        if (pos.y >= c.y1 || pos.y + height <= c.y0) return;
        const ex = 2 * ax;
        const ez = 2 * az;
        const ll = ex * ex + ez * ez;
        const sx = pos.x - ax;
        const sz = pos.z - az;
        const t = ll > 1e-12 ? Math.min(1, Math.max(0, ((c.x - sx) * ex + (c.z - sz) * ez) / ll)) : 0;
        const dx = sx + ex * t - c.x;
        const dz = sz + ez * t - c.z;
        const d = Math.hypot(dx, dz);
        const min = radius + c.r;
        if (d >= min) return;
        if (d > 1e-6) pushBody(pos, (dx / d) * (min - d), (dz / d) * (min - d));
        else pushBody(pos, min, 0);
      });
    }
  }
  // 位移後就地修正 pos（Vector3）。過長的位移切成子步避免穿透。
  // maxDepth：比這更深的水走不進去（人會游泳，傳 Infinity；馬用預設值）
  // lift：跳躍時身體離地的高度，頂端比身體底部低的物件（柵欄、倒木）不擋
  // axis：膠囊軸線的半長向量 { x, z }（馬沿著身體方向；人傳 null = 圓柱）
  // 回傳 contact：{ nx, nz 被推出的方向（單位向量）, push 推出的總距離 }——沒碰到東西時 push = 0
  function moveBody(pos, dx, dz, radius, height, maxDepth = cfg.maxWadeDepth, lift = 0, axis = null) {
    sumX = sumZ = 0;
    const ax = axis ? axis.x : 0;
    const az = axis ? axis.z : 0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / cfg.maxStep));
    for (let i = 0; i < steps; i++) {
      const px = pos.x;
      const pz = pos.z;
      pos.x += dx / steps;
      pos.z += dz / steps;
      pos.y += lift;
      resolve(pos, radius, height, ax, az);
      pos.y -= lift;
      // 走進深水：分別試著只保留 x 或 z 方向的位移（沿岸滑動），都不行就退回
      if (tooDeep(pos.x, pos.z, pos.y, maxDepth)) {
        if (!tooDeep(pos.x, pz, pos.y, maxDepth)) pos.z = pz;
        else if (!tooDeep(px, pos.z, pos.y, maxDepth)) pos.x = px;
        else {
          pos.x = px;
          pos.z = pz;
        }
      }
      pos.y = groundAt(pos.x, pos.z, pos.y);
    }
    const limit = half - radius;
    pos.x = Math.min(Math.max(pos.x, -limit), limit);
    pos.z = Math.min(Math.max(pos.z, -limit), limit);
    pos.y = groundAt(pos.x, pos.z, pos.y);
    contact.push = Math.hypot(sumX, sumZ);
    contact.nx = contact.push > 1e-9 ? sumX / contact.push : 0;
    contact.nz = contact.push > 1e-9 ? sumZ / contact.push : 0;
    return contact;
  }

  // 回傳最近命中距離；未命中回傳 maxDist。dir 需為單位向量。
  function raycast(origin, dir, maxDist) {
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    let best = maxDist;
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    each(Math.min(o[0], ex), Math.min(o[2], ez), Math.max(o[0], ex), Math.max(o[2], ez), (c) => {
      if (c.platform || c.noCamera) return;
      const t = c.obb ? rayOrientedBox(o, d, c, best) : c.box ? rayBox(o, d, c, best) : rayCylinder(o, d, c, best);
      if (t < best) best = t;
    });
    return best;
  }

  // 射線轉到盒子的局部座標後做軸對齊測試
  function rayOrientedBox(o, d, c, maxDist) {
    const dx = o[0] - c.x;
    const dz = o[2] - c.z;
    const lo = [dx * c.ux + dz * c.uz, o[1], -dx * c.uz + dz * c.ux];
    const ld = [d[0] * c.ux + d[2] * c.uz, d[1], -d[0] * c.uz + d[2] * c.ux];
    return rayBox(lo, ld, { min: [-c.halfLength, c.y0, -c.halfWidth], max: [c.halfLength, c.y1, c.halfWidth] }, maxDist);
  }

  function rayBox(o, d, b, maxDist) {
    let tmin = 0;
    let tmax = maxDist;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < b.min[a] || o[a] > b.max[a]) return maxDist;
      } else {
        let t1 = (b.min[a] - o[a]) / d[a];
        let t2 = (b.max[a] - o[a]) / d[a];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return maxDist;
      }
    }
    return tmin;
  }

  // 射線對有限垂直圓柱（側面 + 上下蓋）
  function rayCylinder(o, d, c, maxDist) {
    let best = maxDist;
    const ox = o[0] - c.x;
    const oz = o[2] - c.z;
    const a = d[0] * d[0] + d[2] * d[2];
    if (a > 1e-9) {
      const b = 2 * (ox * d[0] + oz * d[2]);
      const k = ox * ox + oz * oz - c.r * c.r;
      const disc = b * b - 4 * a * k;
      if (disc >= 0) {
        const t = k < 0 ? 0 : (-b - Math.sqrt(disc)) / (2 * a);
        const y = o[1] + d[1] * t;
        if (t >= 0 && t < best && y >= c.y0 && y <= c.y1) best = t;
      }
    }
    if (Math.abs(d[1]) > 1e-9) {
      for (const cap of [c.y0, c.y1]) {
        const t = (cap - o[1]) / d[1];
        if (t < 0 || t >= best) continue;
        const px = ox + d[0] * t;
        const pz = oz + d[2] * t;
        if (px * px + pz * pz <= c.r * c.r) best = t;
      }
    }
    return best;
  }

  return {
    addBox,
    addCylinder,
    addOrientedBox,
    addPlatform,
    addDynamic,
    moveBody,
    raycast,
    groundAt,
    // 範圍內的碰撞體（每個只回呼一次），例如水面找出泡在水裡的木樁
    query: each,
    get stats() {
      return { ...stats, cells: grid.size };
    },
    resetStats() {
      stats.queries = stats.tested = 0;
    },
  };
}
