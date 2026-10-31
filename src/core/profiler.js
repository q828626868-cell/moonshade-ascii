// 各階段耗時（CPU 端）。渲染階段量到的是送出指令的時間，不是 GPU 實際執行時間。

export function createProfiler(smoothing = 0.1) {
  const stages = new Map(); // name -> { ms }
  let frameMs = 0;
  let worstMs = 0;
  let windowWorst = 0;
  let windowTime = 0;

  const now = () => performance.now();

  return {
    now,

    record(name, startTime) {
      const ms = now() - startTime;
      const stage = stages.get(name);
      if (stage) stage.ms += (ms - stage.ms) * smoothing;
      else stages.set(name, { ms });
    },

    frame(dtMs) {
      frameMs = frameMs ? frameMs + (dtMs - frameMs) * smoothing : dtMs;
      windowWorst = Math.max(windowWorst, dtMs);
      windowTime += dtMs;
      if (windowTime >= 1000) {
        worstMs = windowWorst;
        windowWorst = 0;
        windowTime = 0;
      }
    },

    snapshot() {
      return { fps: frameMs ? 1000 / frameMs : 0, frameMs, worstMs, stages };
    },
  };
}
