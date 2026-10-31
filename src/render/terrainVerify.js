// 驗證高度函式的 JS 版與 GLSL 版結果一致：在 GPU 上對一批取樣點計算高度（寫入浮點 render target），
// 讀回後與 JS 比對。啟動時跑一次，結果顯示在開發者面板。
import * as THREE from 'three';

export function verifyHeightField(renderer, heightField, worldSize, samples = 48) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    return { ok: false, reason: 'EXT_color_buffer_float unavailable' };
  }
  const n = samples;
  const target = new THREE.WebGLRenderTarget(n, n, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
  // 取樣點：略為錯開的格子，涵蓋整個世界（含湖、河、山脊、平台）
  const origin = -worldSize / 2 + 3.7;
  const spacing = (worldSize - 7.4) / n;
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uOrigin: { value: origin }, uSpacing: { value: spacing } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
uniform float uOrigin;
uniform float uSpacing;
layout(location = 0) out vec4 outHeight;
${heightField.glsl}
void main() {
  vec2 p = uOrigin + floor(gl_FragCoord.xy) * uSpacing;
  outHeight = vec4(hfHeight(p), 0.0, 0.0, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const pixels = new Float32Array(n * n * 4);
  renderer.readRenderTargetPixels(target, 0, 0, n, n, pixels);
  renderer.setRenderTarget(previous);

  // JS 端以 float32 重現 GPU 的取樣座標，只比較高度函式本身的差異
  const f = Math.fround;
  let max = 0;
  let sum = 0;
  let worst = null;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = f(f(origin) + f(i * f(spacing)));
      const z = f(f(origin) + f(j * f(spacing)));
      const gpu = pixels[(j * n + i) * 4];
      const err = Math.abs(gpu - heightField.height(x, z));
      sum += err;
      if (err > max) {
        max = err;
        worst = { x, z, gpu, js: heightField.height(x, z) };
      }
    }
  }

  target.dispose();
  material.dispose();
  geometry.dispose();
  return { ok: true, samples: n * n, maxError: max, meanError: sum / (n * n), worst };
}
