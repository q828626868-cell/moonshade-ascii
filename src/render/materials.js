// 材質庫：每種材質對應一個 ID（0 保留給天空），以及寫入 G-buffer 的 ShaderMaterial。
// 光照、霧、影子等共用 uniform 是同一份物件，渲染器每幀更新一次即可套用到所有材質。
// 地形與水面需要高度函式的 GLSL（world/heightField.js），由 terrain 參數傳入。
import * as THREE from 'three';
import { surfaceVertexShader, surfaceFragmentShader } from './shaders.js';

export const MAX_LIGHTS = 12; // 同時影響畫面的點光源數（離玩家最近的幾盞）

export function createMaterialLibrary(materialsCfg, surfaceCfg, rng, terrain) {
  const names = ['sky', ...Object.keys(materialsCfg)];
  const ids = Object.fromEntries(names.map((name, i) => [name, i]));
  const cache = new Map();
  const surfaces = terrain.cfg.surfaces;
  const vertexShader = surfaceVertexShader(terrain.glsl);
  const fragmentShader = surfaceFragmentShader(terrain.glsl, surfaces.length, names.length, MAX_LIGHTS);

  const shared = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunIntensity: { value: 1 },
    uSkyIntensity: { value: 0 },
    uGroundIntensity: { value: 0 },
    uSelfShadowNdl: { value: 0 },
    uFar: { value: 1 },
    uFogRange: { value: 1 },
    uNoiseFade: { value: surfaceCfg.noiseFadeDistance },
    uCellFootprint: { value: 0.01 },
    uSeedOffset: { value: new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
    uTime: { value: 0 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowBias: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2() },
    uNormalStep: { value: terrain.cfg.normalStep },
    uSkirtDepth: { value: terrain.cfg.skirtDepth },
    uWaterDepths: { value: new THREE.Vector3(...terrain.cfg.waterDepths) },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0 },
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
    uLightPower: { value: new Array(MAX_LIGHTS).fill(0) },
    uLightCount: { value: 0 },
    uLightBounds: { value: new THREE.Vector4(0, 0, 0, -1) },
    uWarmThreshold: { value: terrain.warmThreshold ?? 0.35 },
    uOccluder: { value: new THREE.Vector4() },
    uOccluderKeep: { value: 0.25 },
    // 水面（見 shaders.js 的 WATER 與 world/waterSurface.js）
    uClipY: { value: new THREE.Vector2() },
    uRipple: { value: null },
    uRippleArea: { value: new THREE.Vector4() },
    uRippleThreshold: { value: terrain.water?.ripples.threshold ?? 0.15 },
    uReflect: { value: null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectOn: { value: 0 },
    uReflectParams: { value: new THREE.Vector3(terrain.water?.reflection.density ?? 0.8, terrain.water?.reflection.distortion ?? 0.02, terrain.water?.reflection.brightness ?? 0.8) },
    uCamRight: { value: new THREE.Vector2(1, 0) },
    uCamForward: { value: new THREE.Vector2(0, -1) },
    uWaterIds: { value: new THREE.Vector4(ids.ripple ?? -1, ids.foam ?? -1, ids.waterBed ?? -1, -1) },
    uWaterLook: { value: new THREE.Vector4(terrain.water?.flow.speed ?? 0, terrain.water?.foam ?? 0, terrain.water?.bedDepth ?? 0, terrain.water?.windDensity ?? 0) },
    uRiverWidth: { value: terrain.riverWidth ?? 0 },
  };
  // 樹葉材質（CONFIG.materials 裡標 foliage: true 的，最多四種）：擋住角色時變稀疏
  const foliageIds = names.filter((n) => materialsCfg[n]?.foliage).map((n) => ids[n]);
  shared.uFoliage = { value: new THREE.Vector4(...[...foliageIds, -1, -1, -1, -1].slice(0, 4)) };
  // 半透明的材質（CONFIG.materials 裡有 sparse 的，最多四種）：以世界座標雜湊抽掉一部分像素，看得到後面的東西；
  // rate > 0 時圖樣每秒換 rate 次（閃爍）。keep 可在執行中改（例如攻擊預告隨前搖變密）
  const sparse = names.filter((n) => materialsCfg[n]?.sparse).slice(0, 4);
  const pad = (list, v) => [...list, v, v, v, v].slice(0, 4);
  shared.uSparseIds = { value: new THREE.Vector4(...pad(sparse.map((n) => ids[n]), -1)) };
  shared.uSparseKeep = { value: new THREE.Vector4(...pad(sparse.map((n) => materialsCfg[n].sparse.keep), 1)) };
  shared.uSparseRate = { value: new THREE.Vector4(...pad(sparse.map((n) => materialsCfg[n].sparse.rate ?? 0), 0)) };
  const sparseSlot = Object.fromEntries(sparse.map((n, i) => [n, i]));
  const PATTERNS = { planks: 1, shingles: 2, fall: 3 }; // fall：瀑布往下流動的字元（period = 每公尺幾個週期、duty = 每秒幾個週期）
  const perMaterial = (def) => ({
    uPattern: {
      value: new THREE.Vector3(PATTERNS[def.pattern?.type] ?? 0, def.pattern?.period ?? 1, def.pattern?.duty ?? 0.5),
    },
    uEmissive: { value: def.emissive ?? 0 },
  });

  const noiseOf = (def) => {
    const n = def.noise ?? {};
    return new THREE.Vector4(n.fineScale ?? 0, n.fineAmount ?? 0, n.patchScale ?? 0, n.patchAmount ?? 0);
  };
  // 每種材質的表面雜訊（頂點材質的物件依 aMaterial 查表）
  shared.uMaterialNoise = { value: names.map((name, i) => (i === 0 ? new THREE.Vector4() : noiseOf(materialsCfg[name]))) };

  function make(name, defines, uniforms, extra = {}) {
    return new THREE.ShaderMaterial({
      name,
      glslVersion: THREE.GLSL3,
      defines,
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...uniforms },
      ...extra,
    });
  }

  function get(name) {
    let material = cache.get(name);
    if (material) return material;
    const def = materialsCfg[name];
    if (!def) throw new Error(`Unknown material "${name}"`);
    const wave = def.wave;
    material = make(
      `surface:${name}`,
      wave ? { WATER: '' } : {},
      {
        uMaterialId: { value: ids[name] },
        uNoise: { value: noiseOf(def) },
        uWater: { value: new THREE.Vector3(wave ? 1 : 0, wave?.scale ?? 0, wave?.speed ?? 0) },
        ...perMaterial(def),
      },
      def.doubleSide ? { side: THREE.DoubleSide } : {},
    );
    cache.set(name, material);
    return material;
  }

  // 地形材質：一個 ShaderMaterial，片段 shader 依高度／坡度／濕度從 terrain.surfaces 中挑選
  function terrainMaterial() {
    let material = cache.get('#terrain');
    if (material) return material;
    for (const name of surfaces) if (!materialsCfg[name]) throw new Error(`Terrain surface "${name}" not in CONFIG.materials`);
    material = make(
      'surface:terrain',
      { TERRAIN: '' },
      {
        uMaterialId: { value: ids[surfaces[0]] },
        uNoise: { value: new THREE.Vector4() },
        uWater: { value: new THREE.Vector3() },
        uTerrainIds: { value: surfaces.map((name) => ids[name]) },
        uTerrainNoise: { value: surfaces.map((name) => noiseOf(materialsCfg[name])) },
        uForestDarken: { value: terrain.forestDarken },
        uPrints: { value: null },
        uPrintArea: { value: new THREE.Vector4() },
        uPrintable: { value: surfaces.map((name) => ((terrain.printSurfaces ?? []).includes(name) ? 1 : 0)) },
        ...perMaterial({}),
      },
      { side: THREE.DoubleSide }, // 裙邊從兩側都可能看到
    );
    cache.set('#terrain', material);
    return material;
  }

  // 頂點材質（樹）：材質 ID 來自頂點屬性，並隨風搖晃。sway：擺動權重 1 的頂點在風力 1 時的位移（公尺）
  function vertexMaterial(sway) {
    const key = `#vertex:${sway}`;
    let material = cache.get(key);
    if (material) return material;
    material = make('surface:vertex', { VERTEX_MATERIAL: '' }, {
      uMaterialId: { value: 0 },
      uNoise: { value: new THREE.Vector4() },
      uWater: { value: new THREE.Vector3() },
      uSway: { value: sway },
      ...perMaterial({}),
    });
    cache.set(key, material);
    return material;
  }

  // 執行中改半透明材質保留的比例（0–1）
  function setSparse(name, keep) {
    const i = sparseSlot[name];
    if (i !== undefined) shared.uSparseKeep.value.setComponent(i, keep);
  }

  return { names, ids, shared, get, terrain: terrainMaterial, vertexMaterial, setSparse };
}
