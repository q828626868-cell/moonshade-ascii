// 戰鬥的畫面資訊：玩家血量與狀態（減速、被纏住）、劍與四種法術的冷卻、目標野怪（名稱、等級、血量、弱點／抗性）、
// 飄出來的傷害數字（弱點黃色、抗性灰色、無效「無效」）、受傷時畫面邊緣變紅、倒下、時刻。
import * as THREE from 'three';
import { ELEMENT_NAMES } from '../creatures/combat.js';

const el = (tag, id, parent = document.body) => {
  const e = document.createElement(tag);
  if (id) e.id = id;
  parent.appendChild(e);
  return e;
};

export function createCombatHud(combatCfg, keys) {
  const root = el('div', 'hud');
  const hp = el('div', 'hud-hp', root);
  hp.innerHTML = '<div class="label"></div><div class="bar"><div></div></div><div class="status"></div>';
  const skills = el('div', 'hud-skills', root);
  const slots = {};
  const order = [
    ['sword', keys.sword, '劍'],
    ['fire', keys.fire, combatCfg.spells.fire.name],
    ['thunder', keys.thunder, combatCfg.spells.thunder.name],
    ['ice', keys.ice, combatCfg.spells.ice.name],
    ['wind', keys.wind, combatCfg.spells.wind.name],
  ];
  for (const [kind, key, name] of order) {
    const s = el('div', null, skills);
    s.className = `slot ${kind}`;
    s.innerHTML = `<span class="key">${key}</span><span class="name">${name}</span><div class="cd"></div>`;
    slots[kind] = s;
  }
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
    const m = el('div', null, log);
    m.textContent = text;
    setTimeout(() => m.classList.add('fade'), 2500);
    setTimeout(() => m.remove(), 4000);
  }

  return {
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
    cast(kind) {
      slots[kind]?.classList.add('flash');
      setTimeout(() => slots[kind]?.classList.remove('flash'), 150);
    },
    killed(c) {
      message(`擊敗了 ${c.name}（Lv ${c.level}）`);
    },
    message,
    update(dt, { player, cooldowns, focus, clock, camera, canvas }) {
      // 血量與狀態
      const frac = player.hp / player.maxHp;
      hp.querySelector('.label').textContent = `HP ${Math.ceil(player.hp)} / ${player.maxHp}`;
      const bar = hp.querySelector('.bar > div');
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      bar.className = frac < 0.3 ? 'low' : '';
      const st = [];
      if (player.rootT > 0) st.push('被樹根纏住');
      else if (player.slowT > 0) st.push('減速');
      hp.querySelector('.status').textContent = st.join(' ');
      // 冷卻
      for (const [kind, s] of Object.entries(slots)) {
        const max = kind === 'sword' ? combatCfg.sword.cooldown : combatCfg.spells[kind].cooldown;
        const k = cooldowns[kind] / max;
        s.querySelector('.cd').style.height = `${(k * 100).toFixed(0)}%`;
        s.classList.toggle('ready', k <= 0);
      }
      // 目標
      if (focus) {
        target.hidden = false;
        target.classList.toggle('boss', !!focus.stats.boss);
        target.classList.toggle('elite', !!focus.stats.elite);
        target.querySelector('.name').textContent = `${focus.name}  Lv ${focus.level}${focus.rage ? '（暴走）' : ''}${focus.shellT > 0 ? '（縮進殼裡）' : ''}${focus.state === 'dormant' ? '（石柱）' : ''}${focus.state === 'return' ? '（撤退）' : ''}`;
        target.querySelector('.bar > div').style.width = `${((Math.max(0, focus.hp) / focus.maxHp) * 100).toFixed(1)}%`;
        target.querySelector('.info').textContent = weakText(focus.stats);
      } else target.hidden = true;
      clockEl.textContent = clock.label();
      // 受傷：畫面邊緣的紅光淡出
      hurtLevel = Math.max(0, hurtLevel - dt * 1.4);
      hurtEl.style.opacity = hurtLevel.toFixed(2);
      // 傷害數字：投影到畫面上，往上飄、淡出
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (const n of [...numbers]) {
        n.t += dt;
        v.set(n.x, n.y, n.z).project(camera);
        const off = v.z > 1 || n.t > 1.1;
        if (off) {
          n.e.remove();
          numbers.splice(numbers.indexOf(n), 1);
          continue;
        }
        n.e.style.transform = `translate(${((v.x * 0.5 + 0.5) * w + n.dx * n.t).toFixed(1)}px, ${((0.5 - v.y * 0.5) * h - 40 * n.t - 20).toFixed(1)}px)`;
        n.e.style.opacity = (1 - Math.max(0, n.t - 0.6) / 0.5).toFixed(2);
      }
    },
  };
}
