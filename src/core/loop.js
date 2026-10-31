// 主迴圈：固定步長模擬 + 每幀渲染（以 alpha 內插）。

export function createLoop({ fixedDt, maxSubSteps, maxFrameDt, profiler, beginFrame, fixedUpdate, render }) {
  let accumulator = 0;
  let last = 0;
  let raf = 0;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const frameDt = last ? Math.min((now - last) / 1000, maxFrameDt) : fixedDt;
    last = now;
    profiler.frame(frameDt * 1000);

    beginFrame(frameDt);

    const t = profiler.now();
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= fixedDt && steps < maxSubSteps) {
      fixedUpdate(fixedDt);
      accumulator -= fixedDt;
      steps++;
    }
    if (steps === maxSubSteps) accumulator = 0; // 追不上就放棄積壓，避免死亡螺旋
    profiler.record('sim', t);

    render(accumulator / fixedDt, frameDt);
  }

  return {
    start() {
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    },
  };
}
