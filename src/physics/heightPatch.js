// 地面高度的小片取樣（給 Web Worker 裡的布料與毛髮用：worker 拿不到地形的區塊快取）。
// 主執行緒在身體周圍取 n × n 個點（間距 step 公尺），worker 以雙線性內插查詢；範圍外取最近的邊。
// 不依賴 three.js（worker 裡沒有 import map）。

export function createHeightPatch(n = 17, step = 0.5) {
  return { n, step, x0: 0, z0: 0, h: new Float32Array(n * n) };
}

// 主執行緒：以 (cx, cz) 為中心重新取樣
export function fillHeightPatch(patch, cx, cz, heightAt) {
  const { n, step } = patch;
  const half = ((n - 1) * step) / 2;
  patch.x0 = cx - half;
  patch.z0 = cz - half;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) patch.h[j * n + i] = heightAt(patch.x0 + i * step, patch.z0 + j * step);
  }
  return patch;
}

export function patchHeight(patch, x, z) {
  const { n, step, h } = patch;
  let u = (x - patch.x0) / step;
  let v = (z - patch.z0) / step;
  u = u < 0 ? 0 : u > n - 1.001 ? n - 1.001 : u;
  v = v < 0 ? 0 : v > n - 1.001 ? n - 1.001 : v;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const a = h[j * n + i];
  const b = h[j * n + i + 1];
  const c = h[(j + 1) * n + i];
  const d = h[(j + 1) * n + i + 1];
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}
