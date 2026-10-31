// 進入點：建立各模組並接上主迴圈。模組之間只透過這裡傳參數，彼此不互相 import 狀態。
import * as THREE from 'three';
import { CONFIG, applyOverrides } from './config.js';
import { createRng } from './core/rng.js';
import { createProfiler } from './core/profiler.js';
import { createLoop } from './core/loop.js';
import { createInput } from './input/input.js';
import { createWeather } from './weather/weather.js';
import { createMaterialLibrary } from './render/materials.js';
import { createAsciiRenderer, DEBUG_VIEWS } from './render/asciiRenderer.js';
import { createTerrain } from './world/terrain.js';
import { createHeightField, REGION, REGION_COUNT } from './world/heightField.js';
import { verifyHeightField } from './render/terrainVerify.js';
import { createTutorialScene } from './world/tutorialScene.js';
import { createBiomes } from './world/biomes.js';
import { createVillage } from './world/village.js';
import { MAX_LIGHTS } from './render/materials.js';
import { createGrassBlades } from './world/grassBlades.js';
import { createTrampleField } from './world/trample.js';
import { createReeds, createWaterfallLines, createSnowfall, createChimneySmoke } from './world/lineProps.js';
import { createStrands } from './entities/strands.js';
import { createPhysics } from './physics/physics.js';
import { createDebugProxy } from './entities/debugProxy.js';
import { createCharacter } from './entities/character.js';
import { createCloak } from './entities/cloak.js';
import { createHorse } from './entities/horse.js';
import { createHoofEffects } from './world/hoofEffects.js';
import { createWaterSurface } from './world/waterSurface.js';
import { createHorseHair } from './entities/horseHair.js';
import { createSoftBodies } from './physics/softBodies.js';
import { createAnimator } from './entities/animator.js';
import { createTraveler, GAIT_NAMES } from './entities/traveler.js';
import { createOutfitMenu } from './ui/outfitMenu.js';
import { createCameraRig } from './camera/cameraRig.js';
import { createAmbience } from './audio/ambience.js';
import { createDevPanel } from './ui/devPanel.js';
import { createRegionBanner } from './ui/regionBanner.js';
import { showHint, showLegend } from './ui/hint.js';
import { createClock } from './world/clock.js';
import { createCombat } from './creatures/combat.js';
import { createCreatures } from './creatures/creatures.js';
import { createCombatHud } from './ui/combatHud.js';

const overrides = new URLSearchParams(location.search).get('set');
applyOverrides(CONFIG, overrides);

// 人物展示模式：替身站在人物的位置（鏡頭跟著它，所以對準人物），替身與圍巾隱藏
const showcase = CONFIG.character.showcase;
if (showcase.enabled) {
  Object.assign(CONFIG.camera, showcase.camera);
  CONFIG.player.spawn = [...showcase.position];
  applyOverrides(CONFIG, overrides); // 網址參數優先於展示模式的預設
}
// 馬的展示模式：馬停在展示位置，鏡頭對準馬；人物站在馬的右後方（可以按 R 直接騎上去看騎乘的樣子）
const horseShow = CONFIG.horse.showcase;
if (horseShow.enabled && !showcase.enabled) {
  Object.assign(CONFIG.camera, horseShow.camera);
  const [x, , z] = horseShow.position;
  CONFIG.traveler.horseSpawn = [x, 0, z];
  CONFIG.traveler.horseHeading = horseShow.heading;
  CONFIG.player.spawn = [x - 2.5, 0, z - 2.5];
  applyOverrides(CONFIG, overrides);
} else horseShow.enabled = false;
if (Object.keys(CONFIG.regions).join() !== Object.keys(REGION).join()) {
  throw new Error('CONFIG.regions must list regions in the order of REGION in world/heightField.js');
}

const canvas = document.getElementById('view');
const rng = createRng(CONFIG.seed);
const profiler = createProfiler(CONFIG.dev.smoothing);
const input = createInput(canvas, CONFIG.input);
// 晝夜：白天主光源換成太陽；部分野怪只在夜裡出現
const clock = createClock(CONFIG.clock);
const weather = createWeather(CONFIG.weather, CONFIG.regions, clock, CONFIG.clock);
const heightField = createHeightField(CONFIG.terrain, CONFIG.regions, CONFIG.seed);
const materials = createMaterialLibrary(CONFIG.materials, CONFIG.surface, rng.fork('materials'), {
  cfg: CONFIG.terrain,
  glsl: heightField.glsl,
  forestDarken: CONFIG.terrain.forestDarken,
  warmThreshold: CONFIG.lights.warmThreshold,
  printSurfaces: CONFIG.hoofEffects.prints.surfaces,
  water: CONFIG.water,
  riverWidth: CONFIG.terrain.river.width,
});
const view = createAsciiRenderer(canvas, CONFIG, weather, materials);
const heightCheck = verifyHeightField(view.renderer, heightField, CONFIG.world.size);
if (heightCheck.ok) console.info('Height field GPU vs JS:', JSON.stringify(heightCheck));
else console.warn('Height field check skipped:', heightCheck.reason);

const terrain = createTerrain(CONFIG.terrain, CONFIG.world, materials, heightField);
terrain.update({ x: CONFIG.player.spawn[0], z: CONFIG.player.spawn[2] }, true); // 開場先載完周圍區塊
const physics = createPhysics(CONFIG.physics, CONFIG.world, terrain);
const tutorial = createTutorialScene(CONFIG.tutorial, terrain, physics, materials, rng.fork('tutorial'));
const village = createVillage(CONFIG.village, {
  terrainCfg: CONFIG.terrain,
  heightField,
  terrain,
  physics,
  materials,
  rng: rng.fork('village'),
});
const biomeStart = performance.now();
const biomes = createBiomes(CONFIG.biomes, {
  terrainCfg: CONFIG.terrain,
  regionsCfg: CONFIG.regions,
  worldCfg: CONFIG.world,
  heightField,
  terrain,
  physics,
  materials,
  rng: rng.fork('biomes'),
});
const biomeMs = performance.now() - biomeStart;
const proxy = createDebugProxy(CONFIG.player, physics, terrain, materials);
const rig = createCameraRig(CONFIG.camera, CONFIG.render, physics, terrain);
view.scene.add(terrain.group, tutorial.group, village.group, biomes.group, proxy.object);

// 人物
const character = createCharacter(CONFIG.character, materials);
{
  const [x, , z] = showcase.position;
  character.object.position.set(x, terrain.heightAt(x, z), z);
  view.scene.add(character.object);
}
const outfit = CONFIG.outfit;
const cloak = createCloak(outfit.cloak, character, materials, terrain);
view.scene.add(cloak.mesh);
character.hat.visible = outfit.hat;
const outfitMenu = createOutfitMenu(outfit, CONFIG.materials, {
  onHat: (on) => (character.hat.visible = on),
  onLantern: () => {},
});
input.onPress(outfit.menuKey, () => outfitMenu.toggle());
const lanternPos = new THREE.Vector3();

// 馬、動畫、旅人控制器
const horse = createHorse(CONFIG.horse, materials, terrain);
view.scene.add(horse.object);
const animator = createAnimator(CONFIG.animation, character, terrain);
// 戰鬥：玩家的血量與狀態、劍與法術、野怪的投射物、地上的危險區、火（見 creatures/combat.js）
const L0 = CONFIG.lines;
const combatStyles = Object.fromEntries(['wolfFur', 'wolfAlphaFur', 'lightning', 'wind', 'frost', 'ember', 'spark', 'webLine', 'swing', 'rageSteam'].map((k) => [k, view.lines.style(L0[k])]));
const combat = createCombat(CONFIG.combat, {
  terrain,
  materials,
  physics,
  proxy,
  rng: rng.fork('combat'),
  lineStyle: combatStyles,
  // 倒下後在灰燼村醒來
  spawn: () => proxy.teleport(CONFIG.player.spawn[0], CONFIG.player.spawn[2], CONFIG.player.heading),
});
const traveler = createTraveler(CONFIG.traveler, {
  character,
  animator,
  horse,
  proxy,
  physics,
  terrain,
  cloak,
  audio: { whistle: () => ambience.whistle() },
  status: combat.status,
});
input.onPress(CONFIG.traveler.interactKey, () => traveler.interact());
// Shift：按住加速（traveler 讀 input.sprint），連點兩下襲步；空白鍵跳躍；C 吹口哨叫馬；手把左搖桿按下切換襲步
for (const code of CONFIG.input.bindings.sprint) input.onPress(code, () => traveler.sprintTap());
for (const code of CONFIG.input.bindings.jump) input.onPress(code, () => traveler.jump());
for (const code of CONFIG.input.bindings.call) input.onPress(code, () => traveler.callHorse());
input.onPress('GamepadL3', () => traveler.toggleGallop());
const prompt = document.createElement('div');
prompt.id = 'prompt';
document.body.appendChild(prompt);
// 耐力條（騎馬時顯示在提示下方）
const staminaBar = document.createElement('div');
staminaBar.id = 'stamina';
staminaBar.innerHTML = '<div></div>';
document.body.appendChild(staminaBar);

let showcaseView = null; // null = 旋轉中；否則為 CONFIG.character.showcase.views 的一項
let showcaseYaw = 0;
const showcaseCtx = { dt: 0, time: 0, speed: 0, turnRate: 0, mode: 'foot', gait: horse.gait, mountT: 0, swimming: false };
if (showcase.enabled) {
  for (const [key, v] of Object.entries(showcase.views)) {
    input.onPress(key, () => {
      showcaseView = v;
      rig.setAngles(rig.yaw, v.pitch);
    });
  }
  input.onPress(showcase.resumeKey, () => {
    showcaseView = null;
    rig.setAngles(rig.yaw, showcase.camera.pitch);
  });
  if (showcase.views[showcase.initialView]) {
    showcaseView = showcase.views[showcase.initialView];
    rig.setAngles(rig.yaw, showcaseView.pitch);
  }
}
let horseView = horseShow.views[horseShow.initialView] ?? null; // null = 旋轉中
let horseYaw = 0;
if (horseShow.enabled) {
  for (const [key, v] of Object.entries(horseShow.views)) input.onPress(key, () => (horseView = v));
  input.onPress(horseShow.resumeKey, () => (horseView = null));
  input.onPress(horseShow.rideKey, () => (traveler.mode === 'foot' ? traveler.seat() : traveler.interact()));
}
if (CONFIG.camera.startScenic) rig.toggleScenic();
rig.camera.layers.enable(1); // 地形與水面在 layer 1：主鏡頭看得到，陰影鏡頭看不到
view.onResize((aspect) => rig.setAspect(aspect));

// 區域權重快取（8 m 一格），給每幀要查上千次的草葉用
const meadowCache = new Map();
function meadowAt(x, z) {
  const key = Math.floor(x / 8) * 65536 + Math.floor(z / 8);
  let v = meadowCache.get(key);
  if (v === undefined) {
    if (meadowCache.size > 20000) meadowCache.clear();
    v = heightField.regionWeights(Math.floor(x / 8) * 8 + 4, Math.floor(z / 8) * 8 + 4)[REGION.meadow];
    meadowCache.set(key, v);
  }
  return v;
}

// 細線層的來源
const L = CONFIG.lines;
const B = CONFIG.biomes;
const lineCtx = (style) => ({ heightField, terrainCfg: CONFIG.terrain, rng: rng.fork(`lines-${style}`) });
const trample = createTrampleField(L.trample);
const grass = createGrassBlades(
  L.grass,
  rng.fork('grass').int(0, 0x7fffffff),
  terrain,
  view.lines.style({ ...L.grass, anchorMaterialId: materials.ids.grass, sceneShade: true }),
  meadowAt,
  trample,
  L.trample,
);
const reeds = createReeds(B.reeds, { ...lineCtx('reeds'), styleId: view.lines.style({ ...L.reeds, sceneShade: true }) });
const waterfall = createWaterfallLines(B.waterfall, { ...lineCtx('falls'), styleId: view.lines.style(L.falls) });
const snowfall = createSnowfall(B.snowfall, {
  rng: rng.fork('snow'),
  styleId: view.lines.style(L.snow),
  groundAt: terrain.heightAt,
});
const scarf = createStrands(L.strands, rng.fork('strands'), terrain, view.lines.style(L.strands));
const smoke = createChimneySmoke(L.smoke, { chimneys: village.chimneys, rng: rng.fork('smoke'), styleId: view.lines.style(L.smoke) });
const reins = horse.reins(view.lines.style(L.reins), (side, out) => traveler.hand(side, out));
const breath = horse.breath(view.lines.style(L.breath));
// 水面：漣漪（2D 波動方程式）、漂流物、魚、丟石頭、雨滴、蘆葉；倒影的水面高度
const water = createWaterSurface(CONFIG.water, {
  terrain,
  heightField,
  riverWidth: CONFIG.terrain.river.width,
  physics,
  materials,
  rng: rng.fork('water'),
  reeds,
  lineStyle: { fish: view.lines.style(L.fish), stone: view.lines.style(L.stone), splash: view.lines.style(L.splash) },
});
for (const o of water.objects) view.scene.add(o);
// 馬蹄對地面的影響：蹄印、壓草、揚塵、水花與漣漪
const hoofEffects = createHoofEffects(CONFIG.hoofEffects, {
  terrain,
  materials,
  trample,
  rng: rng.fork('hoof'),
  splashStyle: view.lines.style(L.splash),
  water,
});
view.scene.add(hoofEffects.object);
// 鬃毛、前髮、尾巴（Verlet 細線）
const horseHair = createHorseHair(CONFIG.horse.hair, { horse, terrain, rng: rng.fork('horse-hair'), lineStyle: view.lines.style });
const softBodies = createSoftBodies(CONFIG.sim, { cloak, horseHair, cloakCfg: outfit.cloak, hairCfg: CONFIG.horse.hair, horse, character });
horse.onStep(hoofEffects.step);
for (const source of [grass, reeds, waterfall, snowfall, smoke, scarf, reins, breath, hoofEffects.lines, horseHair.lines, water.lines]) view.lines.add(source);

// 火：村裡的火把、野外的火堆（狼不敢靠近）
for (const l of village.lights) if (l.fire) combat.addFire(l.x, l.z, Infinity, 0.5);
combat.placeCampfires(heightField, CONFIG.terrain.plateau);
// 野怪（creatures/）：程式生成的骨架模型、AI 狀態機、生成與重生
const creatures = createCreatures(CONFIG.creatures, {
  terrain,
  heightField,
  physics,
  materials,
  combat,
  clock,
  weather,
  water,
  rng: rng.fork('creatures'),
  plateau: CONFIG.terrain.plateau,
  lakeCfg: CONFIG.terrain.lake,
  stonesCfg: CONFIG.terrain.stones,
  circleCfg: CONFIG.biomes.stoneCircle,
  ridgeCfg: CONFIG.terrain.ridge,
  lineStyle: combatStyles,
});
const hud = createCombatHud(CONFIG.combat, Object.fromEntries(['sword', 'fire', 'thunder', 'ice', 'wind'].map((k) => [k, CONFIG.input.bindings[k][0].replace(/^(Key|Digit)/, '')])));
combat.bind(creatures, hud);
document.getElementById('hud').hidden = showcase.enabled || horseShow.enabled; // 展示模式不顯示戰鬥資訊
creatures.bindHud(hud);
view.scene.add(combat.group, creatures.group);
// 預先編譯戰鬥與野怪用到的材質：否則第一次出現攻擊預告、頭上的 !、法術時才編譯 shader，畫面會頓一下
{
  const warm = new THREE.Group();
  const tiny = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  for (const name of ['telegraph', 'telegraphEdge', 'alert', 'alertLost', 'stun', 'fireBolt', 'iceShard', 'web', 'acid', 'roots', 'flame', 'stone', 'wood']) {
    warm.add(new THREE.Mesh(tiny, materials.get(name)));
  }
  view.scene.add(warm);
  view.renderer.compile(view.scene, rig.camera);
  view.scene.remove(warm);
  tiny.dispose();
}
view.lines.add(combat.lines);
for (const source of creatures.lines) view.lines.add(source);

// 玩家的攻擊：F 揮劍、1–4 法術，方向是鏡頭的前方（鏡頭前方的野怪會被自動瞄準）；人物的右手跟著揮、舉起
const action = { kind: null, t: 0 };
function playerAttack(kind) {
  if (showcase.enabled || horseShow.enabled) return;
  const aim = { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) };
  if (combat.attack(kind, aim)) {
    action.kind = kind;
    action.t = 0;
  }
}
for (const kind of ['sword', 'fire', 'thunder', 'ice', 'wind']) {
  for (const code of CONFIG.input.bindings[kind]) input.onPress(code, () => playerAttack(kind));
}
function actionPose(dt) {
  if (!action.kind) return;
  action.t += dt;
  const T = action.kind === 'sword' ? 0.35 : 0.45;
  if (action.t > T) {
    action.kind = null;
    return;
  }
  const k = action.t / T;
  const B = character.bones;
  if (action.kind === 'sword') {
    // 揮劍：右臂從右上往左下掃
    const s = Math.sin(Math.PI * k);
    B.upperArmR.rotateX(-1.6 * s);
    B.upperArmR.rotateZ(-0.9 * (1 - k) * s);
    B.spine3.rotateY(0.5 - k * 1.0);
  } else {
    // 施法：右手往前舉、掌心朝前
    const s = Math.sin(Math.PI * Math.min(1, k * 1.6));
    B.upperArmR.rotateX(-1.45 * s);
    B.forearmR.rotateX(-0.3 * s);
  }
}
// 測試用：一開始就站在某種野怪的地盤旁邊（面向牠）
if (CONFIG.dev.nearCreature) {
  const target = creatures.list.find((c) => c.sp.id === CONFIG.dev.nearCreature);
  if (target) {
    const d = CONFIG.dev.nearDistance;
    let x = target.home.x + d;
    let z = target.home.z;
    // 水裡的（湖妖）：往湖岸找一個站得住的地方
    for (let a = 0; a < Math.PI * 2 && terrain.waterDepthAt(x, z) > 0.5; a += 0.3) {
      x = target.home.x + Math.cos(a) * d;
      z = target.home.z + Math.sin(a) * d;
    }
    proxy.teleport(x, z, Math.atan2(target.home.x - x, target.home.z - z));
    rig.setAngles(Math.atan2(target.home.x - x, target.home.z - z) + Math.PI, CONFIG.camera.pitch);
    terrain.update({ x, z }, true);
  } else console.warn(`dev.nearCreature: no creature "${CONFIG.dev.nearCreature}"`);
}
// 開發者面板開著時，T 快轉一小時（看晝夜、夜行的野怪）
input.onPress(CONFIG.clock.skipKey, () => {
  if (devPanel.visible) clock.skip(1);
});

// 丟石頭：滑鼠鎖定時按左鍵，往畫面中央的水面丟（沒有鎖定時以點的位置）
const stoneRay = new THREE.Raycaster();
const stoneHit = new THREE.Vector3();
const stoneFrom = new THREE.Vector3();
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !water.hasWater) return;
  const locked = document.pointerLockElement === canvas;
  if (CONFIG.input.pointerLock && !locked) return; // 第一下是鎖定滑鼠
  const ndc = locked ? new THREE.Vector2(0, 0) : new THREE.Vector2((e.offsetX / canvas.clientWidth) * 2 - 1, -(e.offsetY / canvas.clientHeight) * 2 + 1);
  stoneRay.setFromCamera(ndc, rig.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -water.surface);
  if (!stoneRay.ray.intersectPlane(plane, stoneHit)) return;
  character.bones.handR.getWorldPosition(stoneFrom);
  if (stoneFrom.distanceTo(stoneHit) > CONFIG.water.stone.range || terrain.waterDepthAt(stoneHit.x, stoneHit.z) < 0.05) return;
  water.throwStone(stoneFrom, stoneHit);
});

// 點光源：每幀取離玩家最近的 MAX_LIGHTS 盞（窗光、火把），火把會閃爍
const lightUniforms = materials.shared;
function updateLights(p, t) {
  // 窗光、火把、野外的火堆與燒著的地面；旅人腰間的油燈跟著骨盆移動
  const lights = [...village.lights, ...combat.lights];
  if (outfit.lantern) {
    character.lanternLight(lanternPos);
    lights.push({ x: lanternPos.x, y: lanternPos.y, z: lanternPos.z, ...outfit.lanternLight, phase: 0.7, lantern: true });
  }
  const nearest = lights
    .map((l) => ({ l, d: (l.x - p.x) ** 2 + (l.z - p.z) ** 2 }))
    .filter((e) => e.d < (e.l.radius + CONFIG.render.far * 0.25) ** 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_LIGHTS);
  nearest.forEach(({ l }, i) => {
    const flicker = 1 - l.flicker * (0.5 + 0.5 * Math.sin(t * 9.1 + l.phase) * Math.sin(t * 13.7 + l.phase * 2.3));
    lightUniforms.uLightPos.value[i].set(l.x, l.y, l.z, l.radius);
    lightUniforms.uLightPower.value[i] = l.power * flicker;
  });
  lightUniforms.uLightCount.value = nearest.length;
  // 包圍球：shader 中範圍外的像素整段跳過點光源
  const bounds = lightUniforms.uLightBounds.value;
  if (!nearest.length) bounds.set(0, 0, 0, -1);
  else {
    const c = nearest.reduce((s, { l }) => [s[0] + l.x, s[1] + l.y, s[2] + l.z], [0, 0, 0]).map((v) => v / nearest.length);
    const r = Math.max(...nearest.map(({ l }) => Math.hypot(l.x - c[0], l.y - c[1], l.z - c[2]) + l.radius));
    bounds.set(c[0], c[1], c[2], r);
  }
}
const scarfAnchor = { x: 0, y: 0, z: 0 };

// 替身本地座標（x 右、y 上、z 前）→ 世界座標
function proxyLocalToWorld(local, out) {
  const h = proxy.heading;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const p = proxy.simPosition;
  out.x = p.x + fz * local[0] + fx * local[2];
  out.y = p.y + local[1];
  out.z = p.z - fx * local[0] + fz * local[2];
  return out;
}

// 區域：玩家所在位置的權重 → 氣候、音效、區域名稱
const regionNames = Object.values(CONFIG.regions).map((r) => r.name);
const weights = new Float32Array(REGION_COUNT);
const fallPoint = heightField.riverCenter(CONFIG.terrain.river.fall.at);
const ambience = createAmbience(CONFIG.audio, CONFIG.regions);
// 區域名稱：六個區域 + 灰燼村（在村莊平台上時優先顯示）
const places = [...Object.values(CONFIG.regions), { name: CONFIG.village.name, subtitle: `${village.stats.houses} 棟木屋，窗裡透著暖光` }];
const placeWeights = new Float32Array(places.length);
const banner = createRegionBanner(CONFIG.ui, places);
const startAudio = () => ambience.start();
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);
input.onPress(CONFIG.audio.muteKey, () => ambience.toggleMute());

const devPanel = createDevPanel(CONFIG.dev);
input.onPress(CONFIG.dev.toggleKey, devPanel.toggle);
input.onPress(CONFIG.dev.touchToggle, devPanel.toggle);
input.onPress(CONFIG.dev.debugViewKey, () => {
  if (!devPanel.visible) {
    rig.toggleScenic(); // 面板關著時：風景模式
    return;
  }
  const r = CONFIG.render;
  r.debugView = DEBUG_VIEWS[(DEBUG_VIEWS.indexOf(r.debugView) + 1) % DEBUG_VIEWS.length];
});

// 瀏覽器實際使用的顯示卡（筆電常有內顯與獨顯兩張；Windows 預設讓瀏覽器用省電的內顯）
const gpuName = (() => {
  const ctx = view.renderer.getContext();
  const ext = ctx.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
})();
console.info('GPU:', gpuName);
const collectDevInfo = () => ({
  worldName: CONFIG.world.name,
  seed: CONFIG.seed,
  profiler: profiler.snapshot(),
  layout: view.layout,
  stats: view.stats,
  lines: view.lines.stats,
  terrain: terrain.stats,
  heightCheck,
  biomes: { ...biomes.stats, reeds: reeds.count, ms: biomeMs },
  grass: { blades: grass.count, trampled: trample.size },
  village: { ...village.stats, activeLights: materials.shared.uLightCount.value },
  character: {
    bones: character.boneCount,
    triangles: character.triangles,
    view: showcase.enabled ? (showcaseView ? showcaseView.name : '旋轉中') : '—',
    cloak: `${cloak.nodes} nodes, ${outfit.cloakColor}`,
    hat: outfit.hat,
    mode: traveler.mode,
    anim: `${animator.state}${animator.blend < 1 ? ` (blend ${animator.blend.toFixed(2)})` : ''}`,
    gait: traveler.mode === 'foot' ? '—' : horse.gait.name,
    horse: `${horse.boneCount} bones   ${horse.triangles} tris   view ${horseShow.enabled ? (horseView ? horseView.name : '旋轉中') : '—'}`,
    horseGait: `${horse.gait.name}${horse.blend < 1 ? ` (blend ${horse.blend.toFixed(2)})` : ''}   ${horse.speed.toFixed(1)} m/s   want ${traveler.gait}   stamina ${traveler.stamina.toFixed(2)}   slip ${horse.slip.toFixed(1)} cm   idle ${horse.idle}`,
    hoofFx: (({ prints, dust, drops }) => 'prints ' + prints + '   dust ' + dust + '   splash ' + drops + '   slope ' + (horse.slope * 57.3).toFixed(0) + '°' + '   horse ' + traveler.horseDistance.toFixed(1) + ' m' + (traveler.horseCalled ? ' (called)' : ''))(hoofEffects.stats),
    physics: ((p) => p.colliders + ' colliders in ' + p.cells + ' cells   ' + p.queries + ' queries   ' + p.tested + ' tested / frame   steep ' + (proxy.steepness * 57.3).toFixed(0) + '°   slide ' + proxy.sliding.toFixed(1) + ' m/s')(physics.stats),
    water: ((w) => w.cells + ' water cells   ' + w.impulses + ' ripples   drift ' + w.drift + '   fish ' + w.fish + '   reflection ' + (view.reflection.enabled ? 'on' : 'off'))(water.stats),
    hair: ((h) => h.strands + ' strands   ' + h.nodes + ' nodes   wet ' + h.wet.toFixed(2) + '   cam ' + h.distance.toFixed(1) + ' m   sim ' + softBodies.stats.mode + ' (' + softBodies.stats.steps + ' steps, ' + softBodies.stats.waits + ' waits)')(horseHair.stats),
    ik: Object.entries(animator.error).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ') || '—',
  },
  region: {
    names: regionNames,
    weights,
    current: banner.current,
    place: banner.current >= 0 ? places[banner.current].name : '—',
    climate: weather.climate,
    audio: ambience.started ? (ambience.muted ? 'muted' : ambience.levels) : null,
  },
  ground: {
    height: terrain.heightAt(proxy.position.x, proxy.position.z),
    water: terrain.waterDepthAt(proxy.position.x, proxy.position.z),
  },
  calls: view.info.render.calls,
  triangles: view.info.render.triangles,
  glyphs: view.atlas.chars.length,
  readback: CONFIG.ascii.readback,
  gpu: gpuName,
  creatures: ((s) => `${s.total} total   ${s.active} active   ${s.visible} near   ${s.drawn} drawn   ${s.dead} dead   ${clock.label()}   ` + Object.entries(s.byState).map(([k, v]) => `${k} ${v}`).join(' '))(creatures.stats),
  combat: ((s) => `hp ${Math.ceil(combat.player.hp)}   proj ${s.projectiles}   hazards ${s.hazards}   telegraphs ${s.telegraphs}   waves ${s.waves}   fires ${s.fires}   fx ${s.fx}   [T] +1h`)(combat.stats),
  debugView: CONFIG.render.debugView,
  player: { position: proxy.position, speed: proxy.speed, heading: proxy.heading },
  camera: { position: rig.camera.position, yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, fov: rig.camera.fov, scenic: rig.scenic },
});

let frameInput = input.sample();
let time = 0;

// 自動駕駛（測試用，CONFIG.dev.autopilot）：模擬按鍵，讓無法操作的環境也能看到走路、騎馬、上下馬
let autoStep = 0;
// 名稱加上 Side（例如 walkSide）時往鏡頭右方移動，可以從側面看步態
function autopilot(inp) {
  const raw = CONFIG.dev.autopilot;
  if (!raw) return;
  const side = raw.endsWith('Side');
  const mode = side ? raw.slice(0, -4) : raw;
  const go = (amount) => {
    if (side) inp.moveX = amount;
    else inp.moveY = amount;
  };
  // 依時間切換的測試（dev.autopilotSwitch 秒時切換）：
  //   uturn 襲步後反向輸入、brake 襲步後放開、jumpHorse 跑步中跳、jump 走路中跳、call 吹口哨叫馬
  const T1 = CONFIG.dev.autopilotSwitch;
  if (mode === 'uturn' || mode === 'brake' || mode === 'jumpHorse') {
    if (autoStep === 0) {
      traveler.seat();
      autoStep = 1;
    }
    traveler.forceGait(mode === 'jumpHorse' ? 'canter' : 'gallop');
    go(time < T1 ? 1 : mode === 'uturn' ? -1 : mode === 'brake' ? 0 : 1);
    if (mode === 'jumpHorse' && time > T1 && autoStep === 1) {
      traveler.jump();
      autoStep = 2;
    }
    return;
  }
  if (mode === 'jump' || mode === 'call') {
    if (mode === 'jump') go(1);
    if (time > (mode === 'jump' ? T1 : 0.5) && autoStep === 0) {
      if (mode === 'jump') traveler.jump();
      else traveler.callHorse();
      autoStep = 1;
    }
    return;
  }
  const onHorse = ['mount', 'ride', 'walkHorse', 'trot', 'canter', 'gallop', 'dismount'].includes(mode);
  if (onHorse && autoStep === 0 && (traveler.canMount || horseShow.enabled)) {
    if (horseShow.enabled && mode !== 'mount') traveler.seat();
    else traveler.interact();
    autoStep = 1;
  }
  const riding = traveler.mode === 'riding';
  if (mode === 'walk' || mode === 'run') {
    go(1);
    inp.sprint = mode === 'run';
  } else if (riding && mode !== 'mount' && mode !== 'dismount') {
    go(mode === 'ride' ? 0 : 1);
    traveler.forceGait({ walkHorse: 'walk', trot: 'trot', canter: 'canter', gallop: 'gallop' }[mode] ?? null);
  } else if (mode === 'dismount' && riding && autoStep === 1) {
    traveler.interact();
    autoStep = 2;
  }
}

function beginFrame() {
  const t = profiler.now();
  physics.resetStats();
  frameInput = input.sample();
  autopilot(frameInput);
  profiler.record('input', t);
}

function fixedUpdate(dt) {
  time += dt;
  if (showcase.enabled) {
    if (showcaseView) showcaseYaw = rig.yaw + showcaseView.yaw;
    else showcaseYaw += showcase.spin * dt;
  } else {
    // 馬的展示模式中鏡頭跟著馬轉，移動改以朝向為準（W 前進、A／D 轉向）
    traveler.fixedUpdate(dt, frameInput, horseShow.enabled ? proxy.simHeading + Math.PI : rig.yaw);
  }
  // 踩倒腳下的草：下馬時是人的腳下，騎馬時是馬蹄的範圍
  const sp = proxy.simPosition;
  const moving = proxy.speed > 0.3;
  const riding = traveler.mode !== 'foot';
  trample.stamp(sp.x, sp.z, riding ? L.trample.horseRadius : L.trample.radius, moving ? Math.sin(proxy.simHeading) : 0, moving ? Math.cos(proxy.simHeading) : 0, time);
  scarf.update(dt, proxyLocalToWorld(L.strands.anchor, scarfAnchor), proxy.heading, weather);
  snowfall.update(dt, proxy.simPosition, weather);
  // 晝夜、戰鬥（玩家的狀態、投射物、危險區）、野怪的 AI
  clock.update(dt);
  if (!showcase.enabled && !horseShow.enabled) {
    combat.fixedUpdate(dt, { lift: traveler.lift, riding });
    const tc = profiler.now();
    creatures.fixedUpdate(dt);
    profiler.record('ai', tc);
  }
}

// 披風與毛髮：在人物與馬都更新完之後（同一幀的骨頭位置）以固定步長模擬，才不會落後身體一幀。
// carry：上一次到這一次身體的平移（布料與毛髮整體跟著平移）與速度（空氣阻力用）；瞬移（上下馬、停放）時重設
const makeCarry = () => ({ last: new THREE.Vector3(), valid: false, dx: 0, dy: 0, dz: 0, vx: 0, vz: 0, teleport: false });
const carryCloak = makeCarry();
const carryHair = makeCarry();
function follow(c, p, dt) {
  if (!c.valid) c.last.copy(p);
  c.valid = true;
  c.dx = p.x - c.last.x;
  c.dy = p.y - c.last.y;
  c.dz = p.z - c.last.z;
  c.teleport = c.dx * c.dx + c.dz * c.dz > 4;
  if (c.teleport) c.dx = c.dy = c.dz = c.vx = c.vz = 0;
  else if (dt > 0) {
    const k = 1 - Math.exp(-10 * dt);
    c.vx += (c.dx / dt - c.vx) * k;
    c.vz += (c.dz / dt - c.vz) * k;
  }
  c.last.copy(p);
}
let waterTestClock = 0;
function stepCloth(frameDt) {
  const tc = profiler.now();
  character.object.updateMatrixWorld(true);
  follow(carryCloak, character.object.position, frameDt);
  follow(carryHair, horse.object.position, frameDt);
  // 披風與馬毛：Web Worker 裡以固定步長模擬（physics/softBodies.js），主執行緒只整理輸入、套用結果
  softBodies.step(frameDt, { weather, time, cameraPos: rig.camera.position, riding: traveler.mode !== 'foot', carryCloak, carryHair });
  cloak.follow();
  profiler.record('cloth', tc);
}

// 擋住角色的樹葉變稀疏：把角色（騎馬時是人與馬）在 G-buffer 上的位置、大小與視深交給 shader
const camTarget = new THREE.Vector3();
const occluderPoint = new THREE.Vector3();
function updateOccluder() {
  const occ = materials.shared.uOccluder.value;
  if (rig.scenic || !CONFIG.camera.thinFoliage) {
    occ.w = 0;
    return;
  }
  const cam = rig.camera;
  cam.updateMatrixWorld();
  const riding = traveler.mode !== 'foot';
  occluderPoint.copy(proxy.position);
  occluderPoint.y += riding ? 1.6 : 1.0;
  const depth = -occluderPoint.clone().applyMatrix4(cam.matrixWorldInverse).z;
  if (depth <= cam.near) {
    occ.w = 0;
    return;
  }
  occluderPoint.project(cam);
  const { cols, rows } = view.layout;
  const size = riding ? 2.1 : 1.2; // 公尺：角色的大小（半徑）
  occ.set((occluderPoint.x * 0.5 + 0.5) * cols, (occluderPoint.y * 0.5 + 0.5) * rows, (size / depth / Math.tan((cam.fov * Math.PI) / 360)) * (rows / 2) + 2, depth);
}

// 人物、馬與鏡頭（每幀，在畫面渲染之前）
function animate(alpha, frameDt) {
  const t = profiler.now();
  proxy.interpolate(alpha);
  // 人物：狀態機、混合、IK（展示模式下原地待機、緩慢旋轉）
  if (showcase.enabled) {
    const [x, , z] = showcase.position;
    character.object.position.set(x, terrain.heightAt(x, z), z);
    character.object.rotation.y = showcaseYaw;
    Object.assign(showcaseCtx, { dt: frameDt, time });
    animator.update(showcaseCtx);
    animator.applyIK(showcaseCtx);
    horse.update(frameDt, horse.position.set(...CONFIG.traveler.horseSpawn), CONFIG.traveler.horseHeading, 0);
  } else {
    traveler.update(frameDt, time);
    actionPose(frameDt);
    hoofEffects.update(frameDt, proxy.position);
    weather.rain = CONFIG.weather.rain;
    water.update(frameDt, proxy.position, weather);
    if (CONFIG.dev.waterTest && (waterTestClock += frameDt) > 1.5) {
      waterTestClock = 0;
      const h = proxy.heading;
      const x = proxy.position.x + Math.sin(h) * 5;
      const z = proxy.position.z + Math.cos(h) * 5;
      if (water.isWater(x, z)) {
        water.impulse(x, z, CONFIG.water.stone.ripple, 0.35);
        water.splash(x, z, 6, 2);
      }
    }
    view.reflection.enabled = water.hasWater;
    view.reflection.level = water.surface;
  }
  stepCloth(frameDt);
  // 野怪的姿勢（程序式動畫與腳的 IK）、戰鬥特效、畫面資訊
  if (!showcase.enabled && !horseShow.enabled) {
    const tc = profiler.now();
    rig.camera.updateMatrixWorld();
    creatures.frame(alpha, frameDt, rig.camera, view.layout);
    combat.frameUpdate(frameDt);
    hud.update(frameDt, { player: combat.player, cooldowns: combat.cooldowns, focus: creatures.focus, clock, camera: rig.camera, canvas });
    profiler.record('creatures', tc);
  }
  const root = character.object.position;
  if (horseShow.enabled) {
    // 角度相對於馬的朝向（1 側面 = 從馬的左側看）
    horseYaw = horseView ? horse.heading + horseView.yaw : horseYaw + horseShow.spin * frameDt;
    rig.setAngles(horseYaw, horseView ? horseView.pitch : horseShow.camera.pitch);
    rig.update(frameDt, frameInput, horse.object.position, horse.heading, 0, horseShow.camera.pivotHeight);
  } else {
    const pivot = traveler.mode === 'foot' ? (traveler.swimming ? CONFIG.traveler.swimPivot : CONFIG.camera.pivotHeight) : CONFIG.traveler.ridePivot;
    // 目標：物理身體在地面上的位置（不含跳躍、步伐的起伏）；游泳時是水面；上下馬時跟著人物的根節點
    const onGround = traveler.mode === 'foot' || traveler.mode === 'riding';
    camTarget.copy(showcase.enabled || !onGround ? root : proxy.position);
    if (traveler.swimming) camTarget.y = root.y;
    rig.update(frameDt, frameInput, camTarget, character.object.rotation.y, traveler.mode === 'foot' ? proxy.speed : horse.speed, showcase.enabled ? CONFIG.camera.pivotHeight : pivot, traveler.mode === 'foot' ? 1 : CONFIG.traveler.rideDistance);
  }
  updateOccluder();
  const key = CONFIG.traveler.interactKey.replace('Key', '');
  if (rig.scenic) prompt.textContent = '風景模式　V 返回';
  else if (traveler.canMount) prompt.textContent = `${key}：上馬`;
  else if (traveler.mode === 'riding') {
    // 騎乘時顯示目前的步態（累了時提示）
    const gaitText = GAIT_NAMES[traveler.gait] + (traveler.exhausted ? '（馬累了）' : '');
    prompt.textContent = proxy.speed < CONFIG.traveler.dismountSpeed ? `${gaitText} · ${key}：下馬` : gaitText;
  } else if (traveler.horseCalled) prompt.textContent = '馬正跑過來';
  else prompt.textContent = '';
  prompt.hidden = !prompt.textContent;
  // 耐力條：騎乘時，或耐力還沒回滿時顯示
  const showStamina = traveler.mode === 'riding' || traveler.stamina < 0.999;
  staminaBar.hidden = !showStamina;
  if (showStamina) {
    staminaBar.firstChild.style.width = `${(traveler.stamina * 100).toFixed(1)}%`;
    staminaBar.classList.toggle('tired', traveler.exhausted);
  }
  profiler.record('camera', t);
}

let snapshotCount = 0;
const loop = createLoop({
  ...CONFIG.sim,
  profiler,
  beginFrame,
  fixedUpdate,
  render(alpha, frameDt) {
    animate(alpha, frameDt);
    let t = profiler.now();
    const p = proxy.position;
    heightField.regionWeights(p.x, p.z, undefined, weights);
    weather.update(frameDt, weights);
    const plateau = CONFIG.terrain.plateau;
    const villageW = Math.max(0, Math.min(1, (plateau.radius - Math.hypot(p.x - plateau.center[0], p.z - plateau.center[1])) / 10));
    for (let i = 0; i < REGION_COUNT; i++) placeWeights[i] = weights[i] * (1 - villageW);
    placeWeights[REGION_COUNT] = villageW;
    banner.update(frameDt, placeWeights);
    updateLights(p, time);
    const nearFall = 1 - Math.min(1, Math.hypot(p.x - fallPoint.x, p.z - fallPoint.z) / CONFIG.audio.waterfallRadius);
    ambience.update(time, weights, weather.wind.strength, nearFall);
    profiler.record('region', t);

    t = profiler.now();
    terrain.update(p);
    biomes.update(p);
    grass.update(time, p, weather);
    reeds.update(time, p, weather);
    waterfall.update(time, p);
    smoke.update(time, p, weather);
    profiler.record('world', t);

    view.render(rig.camera, p, time, profiler);
    if (CONFIG.dev.snapshotFrames && ++snapshotCount === CONFIG.dev.snapshotFrames) {
      // 文字截圖：每列的字元（第二張只留野怪與戰鬥的材質，其他留白）
      const { cols, rows } = view.layout;
      const chars = view.atlas.chars;
      const creatureIds = new Set(['wolf', 'wolfAlpha', 'boar', 'ivory', 'treant', 'treantBark', 'spider', 'web', 'lakeHag', 'hagHair', 'frog', 'acid', 'crab', 'crabCracked', 'golem', 'golemRune', 'wisp', 'frostBear', 'frostBearRage', 'wyvern', 'wyvernWing', 'hare', 'eye', 'telegraph', 'telegraphEdge', 'alert', 'alertLost', 'stun', 'fireBolt', 'iceShard', 'roots'].map((n) => materials.ids[n]));
      const all = [];
      const only = [];
      for (let y = rows - 1; y >= 0; y--) {
        let a = '';
        let b = '';
        for (let x = 0; x < cols; x++) {
          const ch = chars[view.cells.glyph[y * cols + x]] ?? ' ';
          a += ch;
          b += creatureIds.has(view.cells.matAt(x, y)) ? ch : ' ';
        }
        all.push(a);
        only.push(b);
      }
      for (const [id, text] of [['snapshot', all], ['snapshot-creatures', only]]) {
        const pre = document.createElement('pre');
        pre.id = id;
        pre.hidden = true;
        pre.textContent = text.join('\n');
        document.body.appendChild(pre);
      }
    }

    t = profiler.now();
    devPanel.update(frameDt, collectDevInfo);
    profiler.record('ui', t);
  },
});

// 測試用：開始之前先快轉 CONFIG.dev.warmup 秒的模擬（無頭瀏覽器每秒只畫一兩幀，看不到加速完成後的步態）
for (let s = 0; s < CONFIG.dev.warmup; s += CONFIG.sim.fixedDt) {
  beginFrame();
  fixedUpdate(CONFIG.sim.fixedDt);
  animate(1, CONFIG.sim.fixedDt);
}
loop.start();
showHint(CONFIG.ui);
showLegend(
  showcase.enabled
    ? [
        '人物展示',
        ...Object.entries(showcase.views).map(([k, v]) => `${k.replace('Digit', '')}：${v.name}`),
        `${showcase.resumeKey.replace('Digit', '')}：恢復旋轉`,
        '滾輪：拉近／拉遠',
        `${outfit.menuKey.replace('Key', '')}：換裝`,
      ]
    : horseShow.enabled
      ? [
          '馬的展示',
          ...Object.entries(horseShow.views).map(([k, v]) => `${k.replace('Digit', '')}：${v.name}`),
          `${horseShow.resumeKey.replace('Digit', '')}：旋轉`,
          `${horseShow.rideKey.replace('Key', '')}：騎上／下馬`,
          '滾輪：拉近／拉遠',
        ]
      : CONFIG.ui.legend,
);

// 主控台除錯用
window.__moonshade = { CONFIG, view, rig, proxy, physics, terrain, heightField, heightCheck, biomes, weather, ambience, loop, creatures, combat, clock, softBodies, cloak, horseHair, character, horse };
