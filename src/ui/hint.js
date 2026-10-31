// 開場操作提示（數秒後淡出）與教學說明。

export function showHint(cfg) {
  const touch = matchMedia('(pointer: coarse)').matches;
  const el = document.createElement('div');
  el.id = 'hint';
  el.textContent = touch ? cfg.touchHint : cfg.desktopHint;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('fade'), cfg.hintSeconds * 1000);
  setTimeout(() => el.remove(), cfg.hintSeconds * 1000 + 1500);
}

// 教學場景的說明（常駐右上角）
export function showLegend(lines) {
  if (!lines?.length) return;
  const el = document.createElement('div');
  el.id = 'legend';
  el.textContent = lines.join('\n');
  document.body.appendChild(el);
}
