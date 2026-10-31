// 進入新區域時在畫面上方顯示區域名稱。
// 以權重最高的區域為準；需在新區域停留 bannerDelay 秒才切換，避免在邊界來回閃。

// entries：[{ name, subtitle }]（區域，以及村莊之類的地點），與 update() 的 weights 同順序
export function createRegionBanner(uiCfg, entries) {
  const regions = Array.isArray(entries) ? entries : Object.values(entries);
  const el = document.createElement('div');
  el.id = 'region-banner';
  const title = document.createElement('div');
  title.className = 'name';
  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  el.append(title, subtitle);
  document.body.appendChild(el);

  let current = -1;
  let candidate = -1;
  let held = 0;
  let hideTimer = 0;

  function show(index) {
    title.textContent = regions[index].name;
    subtitle.textContent = regions[index].subtitle ?? '';
    el.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove('visible'), uiCfg.bannerSeconds * 1000);
  }

  return {
    get current() {
      return current;
    },
    update(dt, weights) {
      let best = 0;
      for (let i = 1; i < weights.length; i++) if (weights[i] > weights[best]) best = i;
      if (best === current) {
        candidate = -1;
        return;
      }
      if (best !== candidate) {
        candidate = best;
        held = 0;
      }
      held += dt;
      if (held >= (current < 0 ? 0 : uiCfg.bannerDelay)) {
        current = best;
        candidate = -1;
        show(current);
      }
    },
  };
}
