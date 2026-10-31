// 輸入：鍵盤、滑鼠（指標鎖定或拖曳）、觸控（左半邊搖桿、右半邊轉視角）、手把（Gamepad API）。
// 每幀呼叫 sample() 取得快照；視角與縮放的累積量取樣後歸零。
// 手把：左搖桿移動（推的深度 = 速度，analog）、右搖桿轉視角；按鍵對應到鍵盤的按鍵（cfg.gamepad.buttons），
//   所以 onPress 與按住的判斷都和鍵盤共用。

export function createInput(element, cfg) {
  const held = new Set();
  const pressHandlers = new Map();
  const gameKeys = new Set(Object.values(cfg.bindings).flat());
  const frame = { moveX: 0, moveY: 0, sprint: false, analog: false, lookX: 0, lookY: 0, zoom: 0 };
  let lookX = 0;
  let lookY = 0;
  let zoom = 0;
  let mouseDrag = false;
  let joystick = null; // { id, x0, y0, x, y }
  let lookPointer = null; // { id, x, y }
  const padPrev = new Map(); // 手把按鍵上一幀是否按著
  let lastSample = performance.now();

  function emit(code) {
    const list = pressHandlers.get(code);
    if (list) for (const fn of list) fn();
  }

  window.addEventListener('keydown', (e) => {
    if (gameKeys.has(e.code)) e.preventDefault();
    if (!e.repeat) emit(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => {
    held.clear();
    joystick = lookPointer = null;
    mouseDrag = false;
  });

  element.addEventListener('pointerdown', (e) => {
    element.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') {
      mouseDrag = true;
      if (cfg.pointerLock && document.pointerLockElement !== element) {
        element.requestPointerLock?.()?.catch?.(() => {});
      }
      return;
    }
    if (e.clientX < element.clientWidth / 2 && !joystick) {
      joystick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    } else if (!lookPointer) {
      lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });

  element.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      if (mouseDrag || document.pointerLockElement === element) {
        lookX += e.movementX;
        lookY += e.movementY;
      }
    } else if (joystick?.id === e.pointerId) {
      joystick.x = e.clientX;
      joystick.y = e.clientY;
    } else if (lookPointer?.id === e.pointerId) {
      lookX += (e.clientX - lookPointer.x) * cfg.touch.lookScale;
      lookY += (e.clientY - lookPointer.y) * cfg.touch.lookScale;
      lookPointer.x = e.clientX;
      lookPointer.y = e.clientY;
    }
  });

  const release = (e) => {
    if (e.pointerType === 'mouse') mouseDrag = false;
    if (joystick?.id === e.pointerId) joystick = null;
    if (lookPointer?.id === e.pointerId) lookPointer = null;
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  element.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    },
    { passive: false },
  );
  element.addEventListener('touchstart', (e) => emit(`Touch${e.touches.length}`), { passive: true });
  element.addEventListener('contextmenu', (e) => e.preventDefault());

  const anyHeld = (codes) => codes.some((c) => held.has(c));

  // 手把：回傳左搖桿 { x, y }（沒有手把時回傳 null）；右搖桿直接累積到視角；按鍵 → 鍵盤按鍵
  const G = cfg.gamepad;
  const axis = (v) => (Math.abs(v) < G.deadzone ? 0 : (v - Math.sign(v) * G.deadzone) / (1 - G.deadzone));
  const padOut = { x: 0, y: 0 };
  function readGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) gp = gp ?? p;
    if (!gp) return null;
    padOut.x = axis(gp.axes[0] ?? 0);
    padOut.y = -axis(gp.axes[1] ?? 0);
    lookX += axis(gp.axes[2] ?? 0) * G.lookSpeed * dt;
    lookY += axis(gp.axes[3] ?? 0) * G.lookSpeed * dt;
    for (const [index, code] of Object.entries(G.buttons)) {
      const pressed = !!gp.buttons[index]?.pressed;
      if (pressed && !padPrev.get(index)) emit(code);
      if (pressed) held.add(code);
      else if (padPrev.get(index)) held.delete(code);
      padPrev.set(index, pressed);
    }
    return padOut;
  }

  return {
    onPress(code, fn) {
      if (!pressHandlers.has(code)) pressHandlers.set(code, []);
      pressHandlers.get(code).push(fn);
    },

    sample() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastSample) / 1000);
      lastSample = now;
      const pad = readGamepad(dt);
      const b = cfg.bindings;
      let x = (anyHeld(b.right) ? 1 : 0) - (anyHeld(b.left) ? 1 : 0);
      let y = (anyHeld(b.forward) ? 1 : 0) - (anyHeld(b.back) ? 1 : 0);
      let sprint = anyHeld(b.sprint);
      let analog = false; // 觸控搖桿：推的距離就是速度
      if (joystick) {
        const r = cfg.touch.joystickRadius;
        const jx = (joystick.x - joystick.x0) / r;
        const jy = -(joystick.y - joystick.y0) / r;
        const m = Math.hypot(jx, jy);
        if (m > cfg.touch.deadzone) {
          analog = true;
          x += jx;
          y += jy;
        }
        if (m > cfg.touch.sprintBeyond) sprint = true;
      }
      if (pad) {
        x += pad.x;
        y += pad.y;
        analog = analog || pad.x !== 0 || pad.y !== 0;
      }
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      frame.moveX = x;
      frame.moveY = y;
      frame.sprint = sprint;
      frame.analog = analog;
      frame.lookX = lookX;
      frame.lookY = lookY;
      frame.zoom = zoom;
      lookX = lookY = zoom = 0;
      return frame;
    },
  };
}
