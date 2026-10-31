// Web Worker：在另一個 CPU 核心跑披風與馬毛的模擬（softBodyCore.js），主執行緒不必等。
// 訊息：{ type: 'init', ...} 建立模擬；{ type: 'step', frameDt, cloth, hair, clothRef, hairRef } 跑一批，
// 回傳 { cloth, hair, wet, clothRef, hairRef, steps }（節點座標的複本，以 transferable 傳回）。
import { createSoftBodyCore } from './softBodyCore.js';

let core = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    core = createSoftBodyCore(m);
    return;
  }
  if (m.type !== 'step' || !core) return;
  const steps = core.step(m);
  const cloth = core.cloth.slice();
  const hair = core.hair.map((p) => p.slice());
  const wet = core.wet.map((p) => p.slice());
  self.postMessage({ cloth, hair, wet, clothRef: m.clothRef, hairRef: m.hairRef, hasHair: !!m.hair, steps }, [cloth.buffer, ...hair.map((p) => p.buffer), ...wet.map((p) => p.buffer)]);
};
