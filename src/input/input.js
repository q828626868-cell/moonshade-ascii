// 輸入：鍵盤、滑鼠（指標鎖定或拖曳）、觸控（左半邊搖桿、右半邊轉視角）、手把（Gamepad API）。
// 每幀呼叫 sample() 取得快照；視角與縮放的累積量取樣後歸零。
// 手把：左搖桿移動（推的深度 = 速度，analog）、右搖桿轉視角；按鍵對應到鍵盤的按鍵（cfg.gamepad.buttons），
//   所以 onPress 與按住的判斷都和鍵盤共用。

export function createInput(element, cfg) {
  const held = new Set();
  const pressHandlers = new Map();
  const releaseHandlers = new Map();
  const gameKeys = new Set(Object.values(cfg.bindings).flat());
  const frame = { moveX: 0, moveY: 0, sprint: false, analog: false, lookX: 0, lookY: 0, zoom: 0 };
  let lookX = 0;
  let lookY = 0;
  let zoom = 0;
  let mouseDrag = false;
  let joystick = null; // { id, x0, y0, x, y }
  let lookPointer = null; // { id, x, y }
  const touches = new Map(); // 目前按著的觸控指標：pointerId → { x, y }
  let pinchDist = 0; // 雙指縮放上一幀的兩指距離（px）

  function pointDistance() {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  const padPrev = new Map(); // 手把按鍵上一幀是否按著
  let lastSample = performance.now();

  function emit(code) {
    const list = pressHandlers.get(code);
    if (list) for (const fn of list) fn();
  }
  function emitRelease(code) {
    const list = releaseHandlers.get(code);
    if (list) for (const fn of list) fn();
  }
  // 放開按住的按鍵（視窗失焦時全部放開，蓄力中的法術不會卡住）
  function releaseKey(code) {
    if (held.delete(code)) emitRelease(code);
  }

  window.addEventListener('keydown', (e) => {
    if (gameKeys.has(e.code)) e.preventDefault();
    if (!e.repeat) emit(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => releaseKey(e.code));
  window.addEventListener('blur', () => {
    for (const code of [...held]) releaseKey(code);
    joystick = lookPointer = null;
    touches.clear();
    mouseDrag = false;
  });

  // 滑鼠按鍵 → Mouse0（左）、Mouse2（右），和鍵盤共用按下／放開／按住的判斷。
  // 用 mousedown 而不是 pointerdown：按住一個鍵時再按另一個，pointerdown 不會再觸發。
  // 指標還沒鎖定時的第一下左鍵只用來鎖定滑鼠，不算攻擊
  element.addEventListener('mousedown', (e) => {
    if (e.button === 0 && cfg.pointerLock && document.pointerLockElement !== element) return;
    const code = `Mouse${e.button}`;
    if (held.has(code)) return;
    held.add(code);
    emit(code);
  });
  window.addEventListener('mouseup', (e) => releaseKey(`Mouse${e.button}`));

  element.addEventListener('pointerdown', (e) => {
    // 滑鼠已經鎖定在畫面上時，瀏覽器不讓再捕捉指標（會丟 InvalidStateError），不影響操作
    try {
      element.setPointerCapture(e.pointerId);
    } catch {}
    if (e.pointerType === 'mouse') {
      mouseDrag = true;
      if (cfg.pointerLock && document.pointerLockElement !== element) {
        element.requestPointerLock?.()?.catch?.(() => {});
      }
      return;
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // 兩根手指進入雙指縮放：先取消它們原本的搖桿或視角
      for (const id of touches.keys()) {
        if (joystick?.id === id) joystick = null;
        if (lookPointer?.id === id) lookPointer = null;
      }
      pinchDist = pointDistance();
      return;
    }
    if (touches.size > 2) return;
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
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // 張開為拉近、捏合為拉遠，與滾輪方向一致
        const d = pointDistance();
        zoom -= (d - pinchDist) * cfg.touch.pinchScale;
        pinchDist = d;
        return;
      }
      if (joystick?.id === e.pointerId) {
        joystick.x = e.clientX;
        joystick.y = e.clientY;
      } else if (lookPointer?.id === e.pointerId) {
        lookX += (e.clientX - lookPointer.x) * cfg.touch.lookScale;
        lookY += (e.clientY - lookPointer.y) * cfg.touch.lookScale;
        lookPointer.x = e.clientX;
        lookPointer.y = e.clientY;
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
    touches.delete(e.pointerId);
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
      else if (padPrev.get(index)) releaseKey(code);
      padPrev.set(index, pressed);
    }
    return padOut;
  }

  return {
    onPress(code, fn) {
      if (!pressHandlers.has(code)) pressHandlers.set(code, []);
      pressHandlers.get(code).push(fn);
    },
    onRelease(code, fn) {
      if (!releaseHandlers.has(code)) releaseHandlers.set(code, []);
      releaseHandlers.get(code).push(fn);
    },
    isHeld: (code) => held.has(code),

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
