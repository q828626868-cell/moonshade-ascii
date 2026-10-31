// 換裝選單（開發者用，按 O 開關）：切換披風顏色、有無帽子、油燈點亮與否。
// 選項直接改 CONFIG.outfit（與 CONFIG.materials.cloak.color），字元圖集會自動重畫新的顏色。

export function createOutfitMenu(cfg, materialsCfg, { onHat, onLantern }) {
  const el = document.createElement('div');
  el.id = 'outfit-menu';
  el.hidden = true;
  document.body.appendChild(el);

  function render() {
    el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = '換裝　[O] 關閉';
    el.appendChild(title);

    const colors = document.createElement('div');
    colors.className = 'row';
    colors.append('披風');
    for (const [name, hex] of Object.entries(cfg.cloakColors)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.style.setProperty('--swatch', hex);
      b.className = cfg.cloakColor === name ? 'active' : '';
      b.onclick = () => {
        cfg.cloakColor = name;
        materialsCfg.cloak.color = hex;
        render();
      };
      colors.appendChild(b);
    }
    el.appendChild(colors);

    for (const [key, label, apply] of [
      ['hat', '帽子', onHat],
      ['lantern', '油燈', onLantern],
    ]) {
      const row = document.createElement('label');
      row.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = cfg[key];
      box.onchange = () => {
        cfg[key] = box.checked;
        apply(box.checked);
      };
      row.append(box, label);
      el.appendChild(row);
    }
  }

  render();
  materialsCfg.cloak.color = cfg.cloakColors[cfg.cloakColor] ?? materialsCfg.cloak.color;

  return {
    get visible() {
      return !el.hidden;
    },
    toggle() {
      el.hidden = !el.hidden;
      // 選單要用滑鼠點：放開指標鎖定
      if (!el.hidden && document.pointerLockElement) document.exitPointerLock();
    },
  };
}
