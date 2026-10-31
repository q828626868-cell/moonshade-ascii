// 把 MRT render target 的每張附件讀回 CPU。three.js 內建的讀取只支援第一張附件，所以直接呼叫 GL。
//   'sync'  ：當幀讀取，畫面零延遲，但 CPU 要等 GPU 畫完
//   'async' ：讀進 PBO，等 fence 完成才取回，CPU 不等待，畫面晚 1–2 幀
//             （實驗性：在軟體模擬 GPU 上會卡住，尚未在實機驗證）
// 回傳 true 表示 outputs 內容是新的。

const RING = 3;
const MAX_STALE_FRAMES = 10;

export function createReadback(renderer) {
  const gl = renderer.getContext();
  let ring = [];
  let ringBytes = 0;
  let ringCount = 0;
  let sequence = 0;
  let staleFrames = 0;

  function bindTarget(target) {
    renderer.state.bindFramebuffer(gl.FRAMEBUFFER, renderer.properties.get(target).__webglFramebuffer);
  }

  function unbind() {
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    renderer.state.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function readSync(target, outputs) {
    bindTarget(target);
    outputs.forEach((out, i) => {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    });
    unbind();
    return true;
  }

  // 以 0 逾時輪詢，不會阻塞
  function signaled(fence) {
    const r = gl.clientWaitSync(fence, 0, 0);
    return r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED;
  }

  function resetRing(bytes, count) {
    for (const slot of ring) {
      slot.buffers.forEach((b) => gl.deleteBuffer(b));
      if (slot.fence) gl.deleteSync(slot.fence);
    }
    ring = Array.from({ length: RING }, () => ({
      buffers: Array.from({ length: count }, () => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        return b;
      }),
      fence: null,
      seq: -1,
    }));
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    ringBytes = bytes;
    ringCount = count;
  }

  function readAsync(target, outputs) {
    const bytes = outputs[0].byteLength;
    if (bytes !== ringBytes || outputs.length !== ringCount) resetRing(bytes, outputs.length);

    // 發出這一幀的讀取。環裡都還在等 GPU 時就跳過，不覆蓋未完成的讀取（否則 GPU 慢時永遠取不到）
    const slot = ring.find((s) => !s.fence);
    if (slot) {
      bindTarget(target);
      outputs.forEach((_, i) => {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffers[i]);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
        gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      unbind();
      slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      slot.seq = sequence++;
      gl.flush();
    }

    // 取回已完成的讀取中最新的一份
    let ready = null;
    for (const s of ring) {
      if (s.fence && (!ready || s.seq > ready.seq) && signaled(s.fence)) ready = s;
    }
    if (!ready) {
      // 有些環境（例如軟體模擬的 GPU）fence 遲遲不完成；太久沒資料就同步讀一次，畫面不會卡死
      if (++staleFrames > MAX_STALE_FRAMES) {
        staleFrames = 0;
        return readSync(target, outputs);
      }
      return false;
    }
    staleFrames = 0;
    ready.buffers.forEach((b, i) => {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, outputs[i]);
    });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    for (const s of ring) {
      if (s.fence && s.seq <= ready.seq) {
        gl.deleteSync(s.fence);
        s.fence = null;
      }
    }
    return true;
  }

  return {
    read(target, outputs, mode) {
      return mode === 'async' ? readAsync(target, outputs) : readSync(target, outputs);
    },
  };
}
