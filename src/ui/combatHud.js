// 戰鬥的畫面資訊：玩家血量、魔力與狀態（減速、被纏住、引導中）、劍與五個法術的冷卻（魔力不夠時變暗）、
// 火球的蓄力條與雷暴的引導條、準星（滑鼠鎖定時；右鍵瞄準時變亮）、Tab 鎖定的目標框、
// 目標野怪（名稱、等級、血量、弱點／抗性）、飄出來的傷害數字（弱點黃色、抗性灰色、無效「無效」）、受傷時畫面邊緣變紅、倒下、時刻。
import * as THREE from 'three';
import { ELEMENT_NAMES } from '../creatures/combat.js';

const el = (tag, id, parent = document.body) => {
  const e = document.createElement(tag);
  if (id) e.id = id;
  parent.appendChild(e);
  return e;
};

// slotDefs：[{ kind, key, name, cost }]（第一個是劍）
export function createCombatHud(combatCfg, slotDefs) {
  const root = el('div', 'hud');
  const hp = el('div', 'hud-hp', root);
  hp.innerHTML = '<div class="label"></div><div class="bar"><div></div></div><div class="mp"><div></div></div><div class="status"></div>';
  const skills = el('div', 'hud-skills', root);
  const slots = {};
  for (const { kind, key, name, cost } of slotDefs) {
    const s = el('div', null, skills);
    s.className = `slot ${kind}`;
    s.innerHTML = `<span class="key">${key}</span><span class="name">${name}</span>${cost ? `<span class="cost">${cost}</span>` : ''}<div class="cd"></div>`;
    slots[kind] = s;
  }
  const castBar = el('div', 'hud-cast', root);
  castBar.innerHTML = '<div class="label"></div><div class="bar"><div></div></div>';
  castBar.hidden = true;
  const crosshair = el('div', 'hud-crosshair', root);
  crosshair.textContent = '+';
  const lockEl = el('div', 'hud-lock', root);
  lockEl.textContent = '[   ]';
  lockEl.hidden = true;
  const target = el('div', 'hud-target', root);
  target.innerHTML = '<div class="name"></div><div class="bar"><div></div></div><div class="info"></div>';
  target.hidden = true;
  const clockEl = el('div', 'hud-clock', root);
  const hurtEl = el('div', 'hud-hurt', root);
  const downEl = el('div', 'hud-down', root);
  downEl.textContent = '你倒下了⋯⋯';
  downEl.hidden = true;
  const log = el('div', 'hud-log', root);
  const numbers = [];
  let hurtLevel = 0;
  let spread = 0; // 連續的數字左右錯開
  const v = new THREE.Vector3();
  const recent = new Map(); // 同一句話 1.5 秒內不重複

  const weakText = (S) => {
    const fmt = (o) =>
      Object.entries(o)
        .map(([k, m]) => `${ELEMENT_NAMES[k]}${m === 0 ? '無效' : m !== combatCfg.weakDefault && m > 1 ? `×${m}` : ''}`)
        .join('、');
    const weak = fmt(S.weak);
    const resist = fmt(S.resist);
    return `弱：${weak || '無'} ｜ 抗：${resist || '無'}`;
  };

  function message(text) {
    const now = performance.now();
    if (now - (recent.get(text) ?? -1e9) < 1500) return;
    recent.set(text, now);
    const m = el('div', null, log);
    m.textContent = text;
    setTimeout(() => m.classList.add('fade'), 2500);
    setTimeout(() => m.remove(), 4000);
  }

  // 世界座標 → 畫面座標（CSS px）；在鏡頭後方回傳 null
  function toScreen(p, camera, canvas) {
    v.copy(p).project(camera);
    if (v.z > 1) return null;
    return [(v.x * 0.5 + 0.5) * canvas.clientWidth, (0.5 - v.y * 0.5) * canvas.clientHeight];
  }

  return {
    root,
    // 傷害數字：kind = weak | resist | immune | normal
    number(pos, amount, kind, element) {
      const e = el('div', null, root);
      e.className = `hud-number ${kind} ${element}`;
      e.textContent = kind === 'immune' ? '無效' : String(amount) + (kind === 'weak' ? '!' : '');
      numbers.push({ e, x: pos.x, y: pos.y, z: pos.z, t: 0, dx: ((spread++ % 5) - 2) * 9 });
    },
    hurt(amount, frac, dot = false) {
      hurtLevel = Math.min(1, hurtLevel + (dot ? 0.15 : 0.45 + amount / 60));
    },
    down(on) {
      downEl.hidden = !on;
      if (on) message('你倒下了。稍後會在灰燼村醒來。');
    },
    killed(c) {
      message(`擊敗了 ${c.name}（Lv ${c.level}）`);
    },
    message,
    // data：{ player, mp, maxMp, slots: { kind: { remaining, max, afford } }, cast: { label, k, channel } | null, aiming, crosshair, lock, focus, clock, camera, canvas }
    update(dt, d) {
      const { player, camera, canvas } = d;
      // 血量、魔力與狀態
      const frac = player.hp / player.maxHp;
      hp.querySelector('.label').textContent = `HP ${Math.ceil(player.hp)} / ${player.maxHp}　MP ${Math.floor(d.mp)}`;
      const bar = hp.querySelector('.bar > div');
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      bar.className = frac < 0.3 ? 'low' : '';
      hp.querySelector('.mp > div').style.width = `${((d.mp / d.maxMp) * 100).toFixed(1)}%`;
      const st = [];
      if (player.rootT > 0) st.push('被樹根纏住');
      else if (player.slowT > 0) st.push('減速');
      if (d.cast?.channel) st.push(`引導${d.cast.label}中`);
      hp.querySelector('.status').textContent = st.join(' ');
      // 冷卻：遮罩的高度；魔力不夠時整格變暗
      for (const [kind, s] of Object.entries(slots)) {
        const info = d.slots[kind];
        if (!info) continue;
        const k = info.max > 0 ? info.remaining / info.max : 0;
        s.querySelector('.cd').style.height = `${(k * 100).toFixed(0)}%`;
        s.classList.toggle('ready', k <= 0 && info.afford);
        s.classList.toggle('poor', !info.afford);
      }
      // 蓄力條（火球）、引導條（雷暴）
      const cast = d.cast ? [d.cast.label, d.cast.k] : null;
      castBar.hidden = !cast;
      if (cast) {
        castBar.querySelector('.label').textContent = cast[0];
        castBar.querySelector('.bar > div').style.width = `${(cast[1] * 100).toFixed(0)}%`;
      }
      // 準星：滑鼠鎖定時顯示，右鍵瞄準時變亮
      crosshair.hidden = !d.crosshair;
      crosshair.classList.toggle('aiming', !!d.aiming);
      // 鎖定的目標框
      const s = d.lock ? toScreen(d.lock.aimPoint(new THREE.Vector3()), camera, canvas) : null;
      lockEl.hidden = !s;
      if (s) lockEl.style.transform = `translate(${s[0].toFixed(0)}px, ${s[1].toFixed(0)}px) translate(-50%, -50%)`;
      // 目標
      const focus = d.lock ?? d.focus;
      if (focus) {
        target.hidden = false;
        target.classList.toggle('boss', !!focus.stats.boss);
        target.classList.toggle('elite', !!focus.stats.elite);
        target.querySelector('.name').textContent = `${d.lock ? '◎ ' : ''}${focus.name}  Lv ${focus.level}${focus.rage ? '（暴走）' : ''}${focus.shellT > 0 ? '（縮進殼裡）' : ''}${focus.frozenT > 0 ? '（凍住）' : ''}${focus.burnT > 0 ? '（燃燒）' : ''}${focus.state === 'dormant' ? '（石柱）' : ''}${focus.state === 'return' ? '（撤退）' : ''}`;
        target.querySelector('.bar > div').style.width = `${((Math.max(0, focus.hp) / focus.maxHp) * 100).toFixed(1)}%`;
        target.querySelector('.info').textContent = weakText(focus.stats);
      } else target.hidden = true;
      clockEl.textContent = d.clock.label();
      // 受傷：畫面邊緣的紅光淡出
      hurtLevel = Math.max(0, hurtLevel - dt * 1.4);
      hurtEl.style.opacity = hurtLevel.toFixed(2);
      // 傷害數字：投影到畫面上，往上飄、淡出
      for (const n of [...numbers]) {
        n.t += dt;
        const p = n.t <= 1.1 ? toScreen(v.set(n.x, n.y, n.z), camera, canvas) : null;
        if (!p) {
          n.e.remove();
          numbers.splice(numbers.indexOf(n), 1);
          continue;
        }
        n.e.style.transform = `translate(${(p[0] + n.dx * n.t).toFixed(1)}px, ${(p[1] - 40 * n.t - 20).toFixed(1)}px)`;
        n.e.style.opacity = (1 - Math.max(0, n.t - 0.6) / 0.5).toFixed(2);
      }
    },
  };
}
