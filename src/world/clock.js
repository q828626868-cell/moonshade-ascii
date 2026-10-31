// 晝夜：遊戲內的時刻（0–24 時）與日光（0 = 夜、1 = 白天）。
// 天氣模組依日光把主光源從月光換成太陽（較亮、方向隨時刻移動）；野怪依 night 決定出沒（creatures/）。
import { clamp } from '../core/mathx.js';

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createClock(cfg) {
  let hour = cfg.startHour;
  const clock = {
    get hour() {
      return hour;
    },
    // 0 = 夜、1 = 白天（天亮、天黑時平滑過渡）
    get daylight() {
      return smooth(cfg.dawn[0], cfg.dawn[1], hour) * (1 - smooth(cfg.dusk[0], cfg.dusk[1], hour));
    },
    get night() {
      return clock.daylight < cfg.nightBelow;
    },
    // 太陽的方向（白天）：早上從東邊升起，中午最高，傍晚落到西邊
    sunDirection(out) {
      const t = clamp((hour - 6) / 12, 0, 1);
      const a = Math.PI * t;
      out.set(Math.cos(a) * 0.75, 0.25 + Math.sin(a) * 0.75, 0.35).normalize();
      return out;
    },
    label() {
      const h = Math.floor(hour);
      const m = Math.floor((hour - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${clock.night ? '夜' : clock.daylight > 0.95 ? '晝' : hour < 12 ? '晨' : '昏'}`;
    },
    update(dt) {
      hour = (hour + (dt * cfg.speed * 24) / cfg.dayLength) % 24;
    },
    skip(hours) {
      hour = (hour + hours) % 24;
    },
  };
  return clock;
}
