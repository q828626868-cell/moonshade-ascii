// 草被踩倒的記錄：世界空間的格子，記錄每格被踩的程度與倒向，隨時間恢復。
// 馬（目前是開發替身）每個固定步長在腳下蓋章；草葉細線讀取根部的值，往倒向壓低。

export function createTrampleField(cfg) {
  const cells = new Map(); // key → { a: 程度（蓋章當下）, dx, dz, t: 蓋章時間 }
  const size = cfg.cellSize;
  const out = { amount: 0, dx: 0, dz: 0 };
  let lastPrune = 0;

  const keyOf = (gx, gz) => gx * 73856093 + gz * 19349663;
  const decayed = (c, now) => c.a * Math.exp(-(now - c.t) / cfg.recoverySeconds);

  return {
    get size() {
      return cells.size;
    },

    // 在 (x, z) 半徑 radius 內蓋章；(mx, mz)：移動方向（單位向量，靜止時為 0）
    stamp(x, z, radius, mx, mz, now) {
      const r = Math.ceil(radius / size);
      const gx0 = Math.floor(x / size);
      const gz0 = Math.floor(z / size);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = (gx0 + dx + 0.5) * size;
          const cz = (gz0 + dz + 0.5) * size;
          const ox = cx - x;
          const oz = cz - z;
          const d = Math.hypot(ox, oz);
          if (d > radius) continue;
          const strength = 1 - 0.5 * (d / radius);
          const key = keyOf(gx0 + dx, gz0 + dz);
          const c = cells.get(key);
          const current = c ? decayed(c, now) : 0;
          if (current >= strength) continue;
          // 倒向：往外推，再順著移動方向
          let fx = ox / (d || 1) + mx * 0.8;
          let fz = oz / (d || 1) + mz * 0.8;
          const l = Math.hypot(fx, fz) || 1;
          fx /= l;
          fz /= l;
          if (c) Object.assign(c, { a: strength, dx: fx, dz: fz, t: now });
          else cells.set(key, { a: strength, dx: fx, dz: fz, t: now });
        }
      }
      if (now - lastPrune > 5) {
        lastPrune = now;
        for (const [k, c] of cells) if (decayed(c, now) < 0.02) cells.delete(k);
      }
    },

    // 回傳共用物件 { amount 0–1, dx, dz }
    sample(x, z, now) {
      const c = cells.get(keyOf(Math.floor(x / size), Math.floor(z / size)));
      if (!c) {
        out.amount = 0;
        return out;
      }
      out.amount = decayed(c, now);
      out.dx = c.dx;
      out.dz = c.dz;
      return out;
    },
  };
}
