// 天氣與光照：主光源（月光／太陽）、天空環境光、地面反射光、風、霧、雪。
// 每幀以玩家所在位置的區域權重混合各區的氣候（CONFIG.regions[*].climate），再平滑趨近，跨區時不會突變。
// 基準值每幀從 CONFIG 讀取，主控台調整仍會生效。
import * as THREE from 'three';
import { damp } from '../core/mathx.js';

const FIELDS = ['sun', 'sky', 'fogStart', 'fogEnd', 'wind', 'snow'];

// clock（world/clock.js，可省略）：白天主光源換成太陽——較亮、方向隨時刻移動（光色不變，字元圖集不用重畫）
export function createWeather(cfg, regionsCfg, clock = null, clockCfg = null) {
  const climates = Object.values(regionsCfg).map((r) => r.climate);
  const windDir = new THREE.Vector2(cfg.wind.direction[0], cfg.wind.direction[2]).normalize();
  const moonDir = new THREE.Vector3(...cfg.sun.direction).normalize();
  const sunDir = new THREE.Vector3();
  const climate = { ...climates[0] }; // 目前（過渡中）的氣候
  const target = { ...climates[0] };
  let time = 0;
  let initialized = false;

  const weather = {
    sunDir: new THREE.Vector3(...cfg.sun.direction).normalize(),
    sun: { color: cfg.sun.color, intensity: cfg.sun.intensity },
    sky: { color: cfg.sky.color, intensity: cfg.sky.intensity },
    ground: { color: cfg.ground.color, intensity: cfg.ground.intensity },
    fog: { ...cfg.fog },
    // 目前的風（水平單位向量 × 強度）
    wind: { x: windDir.x, z: windDir.y, strength: cfg.wind.strength },
    snow: 0, // 0–1，降雪量
    dim: 0, // 0–1：天色轉暗（雷暴，creatures/spells.js 設定）
    climate,

    // weights：玩家所在位置的區域權重（與 CONFIG.regions 同順序）
    update(dt, weights) {
      time += dt;
      for (const f of FIELDS) {
        let v = 0;
        for (let i = 0; i < climates.length; i++) v += weights[i] * climates[i][f];
        target[f] = v;
        climate[f] = initialized ? damp(climate[f], v, cfg.climateSharpness, dt) : v;
      }
      initialized = true;

      const day = clock ? clock.daylight : 0;
      weather.sun.intensity = cfg.sun.intensity * climate.sun * (1 + (clockCfg?.sun.intensity - 1 || 0) * day);
      weather.sky.intensity = cfg.sky.intensity * climate.sky * (1 + (clockCfg?.sun.sky - 1 || 0) * day);
      weather.sun.intensity *= 1 - weather.dim;
      weather.sky.intensity *= 1 - weather.dim * 0.8;
      if (clock) weather.sunDir.copy(moonDir).lerp(clock.sunDirection(sunDir), day).normalize();
      weather.ground.intensity = cfg.ground.intensity;

      weather.fog.start = climate.fogStart;
      weather.fog.end = climate.fogEnd;
      weather.fog.floor = cfg.fog.floor;
      weather.fog.sparsity = cfg.fog.sparsity;
      // 陣風：強度隨兩個不同頻率的正弦起伏
      const w = cfg.wind;
      const gust = Math.sin(time * w.gustSpeed) * Math.sin(time * w.gustSpeed * 0.37 + 1.3);
      weather.wind.strength = w.strength * climate.wind * (1 + w.gust * gust);
      weather.snow = climate.snow;
    },
  };
  return weather;
}
