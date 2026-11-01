// 手機的技能鈕：右下角，劍（大的）在角落，五個法術沿圓弧排在旁邊，翻滾在最左邊。
// 法術鈕：按住開始（地上顯示範圍），拖曳調整方向（往上 = 鏡頭前方，拖得越遠，雷暴放得越遠），放開施放；
//   拖曳太短就當作直接點：瞄準畫面中央（或 Tab 鎖定的目標）。
// 只在觸控裝置上顯示（同時隱藏桌面版的技能列）。

export function createTouchSkills(defs, handlers) {
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const root = document.createElement('div');
  root.id = 'touch-skills';
  root.hidden = !touch;
  document.body.appendChild(root);
  if (touch) document.body.classList.add('touch');
  const buttons = {};
  const DRAG = 90; // px：拖到這麼遠算 100%

  // 位置：以右下角為中心的圓弧（CSS px，從右、從下算）
  const corner = { right: 78, bottom: 78 };
  const arc = 112;
  const place = (b, dx, dy, size) => {
    b.style.width = b.style.height = `${size}px`;
    b.style.right = `${corner.right - dx - size / 2}px`;
    b.style.bottom = `${corner.bottom + dy - size / 2}px`;
  };

  function make(def, x, y, size) {
    const b = document.createElement('div');
    b.className = `skill ${def.kind}`;
    b.innerHTML = `<span class="name">${def.short}</span><div class="knob"></div>`;
    place(b, x, y, size);
    root.appendChild(b);
    buttons[def.kind] = b;
    const knob = b.querySelector('.knob');
    let start = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        b.setPointerCapture(e.pointerId); // 拖出按鈕外也繼續收到移動
      } catch {}
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      b.classList.add('held');
      handlers.begin(def.kind);
    });
    b.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const len = Math.hypot(dx, dy);
      const k = Math.min(1, len / DRAG);
      knob.style.transform = `translate(${(len > 0 ? (dx / len) * k * size * 0.45 : 0).toFixed(0)}px, ${(len > 0 ? (dy / len) * k * size * 0.45 : 0).toFixed(0)}px)`;
      handlers.drag(def.kind, len > 12 ? { x: dx / len, y: dy / len, k } : null);
    });
    const end = (cancelled) => (e) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      b.classList.remove('held');
      knob.style.transform = '';
      if (cancelled) handlers.cancel(def.kind);
      else handlers.release(def.kind);
    };
    b.addEventListener('pointerup', end(false));
    b.addEventListener('pointercancel', end(true));
  }

  // 劍與翻滾：點一下
  function tap(def, x, y, size, fn) {
    const b = document.createElement('div');
    b.className = `skill ${def.kind}`;
    b.innerHTML = `<span class="name">${def.short}</span>`;
    place(b, x, y, size);
    root.appendChild(b);
    buttons[def.kind] = b;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('held');
      fn();
    });
    const up = () => b.classList.remove('held');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  const spells = defs.filter((d) => d.spell);
  spells.forEach((d, i) => {
    const a = Math.PI - (i / (spells.length - 1)) * (Math.PI / 2); // 左 → 上
    make(d, Math.cos(a) * arc, Math.sin(a) * arc, 58);
  });
  const sword = defs.find((d) => d.kind === 'sword');
  if (sword) tap(sword, 0, 0, 78, handlers.sword);
  const roll = defs.find((d) => d.kind === 'roll');
  if (roll) tap(roll, -arc - 78, -6, 52, handlers.roll);

  return {
    touch,
    // slots：{ kind: { remaining, max, afford } }
    update(slots) {
      if (!touch) return;
      for (const [kind, b] of Object.entries(buttons)) {
        const s = slots[kind];
        if (!s) continue;
        b.style.setProperty('--cd', s.max > 0 ? (s.remaining / s.max).toFixed(3) : '0');
        b.classList.toggle('poor', !s.afford);
      }
    },
  };
}
