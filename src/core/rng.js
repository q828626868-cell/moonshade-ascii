// 固定種子亂數。所有程序生成都必須從這裡取亂數，不得使用 Math.random。
// fork(name) 依「原始種子 + 名稱」派生，與呼叫順序無關，新增模組不會改變既有模組的結果。

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  const origin = seed >>> 0;
  let state = origin;

  // mulberry32
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: origin,
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    fork: (name) => createRng(hashString(name) ^ Math.imul(origin, 0x9e3779b1)),
  };
}
