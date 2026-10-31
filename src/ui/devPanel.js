// 開發者面板（預設按 ` 開關）：FPS、各階段耗時、格數、玩家與鏡頭座標。
// 隱藏時不做任何 DOM 工作；顯示時以 CONFIG.dev.refreshHz 更新。

const BUDGET_MS = 1000 / 60;

export function createDevPanel(cfg) {
  const forced = new URLSearchParams(location.search).get('dev') === '1';
  let visible = cfg.showOnStart || forced;
  let elapsed = Infinity;

  const el = document.createElement('div');
  el.id = 'dev-panel';
  el.hidden = !visible;
  const pre = document.createElement('pre');
  el.appendChild(pre);
  document.body.appendChild(el);

  function bar(ms) {
    return '#'.repeat(Math.min(24, Math.round((ms / BUDGET_MS) * 24)));
  }

  function format(d) {
    const p = d.profiler;
    const v = (vec) => `${vec.x.toFixed(2).padStart(8)} ${vec.y.toFixed(2).padStart(7)} ${vec.z.toFixed(2).padStart(8)}`;
    const deg = (rad) => `${(((rad * 180) / Math.PI) % 360).toFixed(0)}°`;
    const lines = [
      `${d.worldName} · DEV                 [\`] close`,
      '',
      `fps      ${p.fps.toFixed(1).padStart(6)}   frame ${p.frameMs.toFixed(2)} ms   worst ${p.worstMs.toFixed(1)} ms`,
      `grid     ${d.layout.cols}×${d.layout.rows} cells of ${d.layout.cw}×${d.layout.ch}px   canvas ${d.layout.width}×${d.layout.height} @${d.layout.pixelRatio}x`,
      `cells    ${d.stats.drawn} drawn   ${d.glyphs} glyphs in atlas`,
      `gpu      ${d.calls} draws   ${d.triangles} tris   readback ${d.readback}${d.stats.fresh ? '' : ' (stale)'}`,
      `lines    ${d.lines.segments} segments   ${d.lines.pieces} pieces drawn   ${d.lines.hidden} occluded`,
      `terrain  ${d.terrain.loaded} chunks loaded (${d.terrain.pending} queued)   far LOD ${d.terrain.far}`,
      `height   ${
        d.heightCheck.ok
          ? `GPU↔JS max ${d.heightCheck.maxError.toExponential(1)} m  mean ${d.heightCheck.meanError.toExponential(1)} m  (${d.heightCheck.samples} pts)`
          : `check skipped: ${d.heightCheck.reason}`
      }`,
      `trees    ${Object.entries(d.biomes.trees)
        .map(([k, v]) => `${k} ${v}`)
        .join('  ')}   (generated in ${d.biomes.ms.toFixed(0)} ms)`,
      `props    logs ${d.biomes.log}  mushrooms ${d.biomes.mushroom}  stones ${d.biomes.block}  boulders ${d.biomes.boulder}  reeds ${d.biomes.reeds}`,
      `grass    ${d.grass.blades} blades   ${d.grass.trampled} trampled cells`,
      `village  ${d.village.houses} houses   ${d.village.lights} lights (${d.village.activeLights} active)`,
      `person   ${d.character.bones} bones   ${d.character.triangles} tris   view ${d.character.view}   cloak ${d.character.cloak}   hat ${d.character.hat ? 'on' : 'off'}   [O] outfit`,
      `anim     mode ${d.character.mode}   state ${d.character.anim}   horse gait ${d.character.gait}`,
      `ik cm    ${d.character.ik}`,
      `horse    ${d.character.horse}`,
      `         ${d.character.horseGait}`,
      `         ${d.character.hoofFx}`,
      `water    ${d.character.water}`,
      `physics  ${d.character.physics}`,
      `region   ${d.region.place}   ${[...d.region.weights]
        .map((w, i) => (w > 0.01 ? `${d.region.names[i]} ${w.toFixed(2)}` : ''))
        .filter(Boolean)
        .join('  ')}`,
      `climate  sun ×${d.region.climate.sun.toFixed(2)}  sky ×${d.region.climate.sky.toFixed(2)}  fog ${d.region.climate.fogStart.toFixed(0)}–${d.region.climate.fogEnd.toFixed(0)} m  wind ×${d.region.climate.wind.toFixed(2)}  snow ${d.region.climate.snow.toFixed(2)}`,
      `audio    ${
        d.region.audio === null
          ? 'not started (click or press a key)'
          : d.region.audio === 'muted'
            ? 'muted [N]'
            : Object.entries(d.region.audio)
                .filter(([, v]) => v > 0.01)
                .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                .join('  ')
      }`,
      `gpu      ${d.gpu}`,
      `view     ${d.debugView}   [V] cycle`,
      '',
      'stage (CPU ms, ~16.7 = full bar)',
    ];
    for (const [name, s] of p.stages) {
      lines.push(`  ${name.padEnd(10)}${s.ms.toFixed(3).padStart(7)}  ${bar(s.ms)}`);
    }
    lines.push(
      '',
      `player   ${v(d.player.position)}`,
      `         speed ${d.player.speed.toFixed(2)} m/s   heading ${deg(d.player.heading)}`,
      `         ground ${d.ground.height.toFixed(2)} m   water depth ${d.ground.water.toFixed(2)} m`,
      `camera   ${v(d.camera.position)}`,
      `         yaw ${deg(d.camera.yaw)}   pitch ${deg(d.camera.pitch)}   dist ${d.camera.distance.toFixed(2)}   fov ${d.camera.fov.toFixed(1)}°${d.camera.scenic ? ' 風景模式' : ''}`,
      '',
      `creatures ${d.creatures}`,
      `combat   ${d.combat}`,
      `seed     ${d.seed}`,
    );
    return lines.join('\n');
  }

  return {
    get visible() {
      return visible;
    },
    toggle() {
      visible = !visible;
      el.hidden = !visible;
      elapsed = Infinity;
    },
    update(dt, collect) {
      if (!visible) return;
      elapsed += dt;
      if (elapsed < 1 / cfg.refreshHz) return;
      elapsed = 0;
      pre.textContent = format(collect());
    },
  };
}
