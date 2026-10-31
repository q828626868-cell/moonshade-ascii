// 陽光陰影貼圖：正交相機跟著焦點（玩家），只寫深度。結果用來設定 G-buffer 的影子旗標並壓暗亮度。
import * as THREE from 'three';

const BIAS_MATRIX = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export function createShadowMap(renderer, cfg, shared) {
  const size = cfg.mapSize;
  const target = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: true,
    depthTexture: new THREE.DepthTexture(size, size),
  });
  const e = cfg.extent;
  const camera = new THREE.OrthographicCamera(-e, e, e, -e, 0.1, cfg.depthRange);
  // 只畫背面：投影體的厚度就是天然的偏移，受光面不會長出自我陰影的條紋
  const caster = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const center = new THREE.Vector3();

  shared.uShadowMap.value = target.depthTexture;
  shared.uShadowTexel.value.set(1 / size, 1 / size);

  function render(scene, focus, sunDir) {
    shared.uShadowOn.value = cfg.enabled ? 1 : 0;
    shared.uShadowBias.value = cfg.bias;
    if (!cfg.enabled) return;

    // 把中心對齊到陰影貼圖的像素格，移動時影子邊緣才不會閃爍
    camera.position.copy(focus).addScaledVector(sunDir, cfg.depthRange / 2);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const texel = (2 * e) / size;
    const pr = focus.dot(right);
    const pu = focus.dot(up);
    center
      .copy(focus)
      .addScaledVector(right, Math.round(pr / texel) * texel - pr)
      .addScaledVector(up, Math.round(pu / texel) * texel - pu);
    camera.position.copy(center).addScaledVector(sunDir, cfg.depthRange / 2);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    shared.uShadowMatrix.value
      .multiplyMatrices(BIAS_MATRIX, camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse);

    const previous = scene.overrideMaterial;
    scene.overrideMaterial = caster;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = previous;
  }

  return { render };
}
