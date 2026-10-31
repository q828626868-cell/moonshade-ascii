// 教學場景：在村莊平台上展示渲染管線的各項效果。
//   球 — 明暗交界（字元密度隨受光連續變化）
//   方塊 — 輪廓線與摺邊
//   圓柱 — 曲面輪廓（邊線方向由法線決定）
//   遠方石柱 — 霧（變暗、變疏）；它們立在起伏的地形上，往北一路延伸過河
import * as THREE from 'three';

export function createTutorialScene(cfg, terrain, physics, materials, rng) {
  const group = new THREE.Group();
  group.name = 'tutorial';
  if (!cfg.enabled) return { group };

  // 底部對齊地面（坡地上取四角最低點，再往下埋一點，避免懸空）
  const groundUnder = (x, z, r) =>
    Math.min(
      terrain.heightAt(x - r, z - r),
      terrain.heightAt(x + r, z - r),
      terrain.heightAt(x - r, z + r),
      terrain.heightAt(x + r, z + r),
    ) - (r > 0.5 ? 0.3 : 0);

  {
    const { position: [x, , z], radius, material } = cfg.sphere;
    const y = terrain.heightAt(x, z);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), materials.get(material));
    mesh.position.set(x, y + radius, z);
    group.add(mesh);
    physics.addCylinder(x, z, radius * 0.9, y, y + radius * 2);
  }
  {
    const { position: [x, , z], size, material } = cfg.cube;
    const y = groundUnder(x, z, size / 2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials.get(material));
    mesh.position.set(x, y + size / 2, z);
    group.add(mesh);
    physics.addBox([x - size / 2, y, z - size / 2], [x + size / 2, y + size, z + size / 2]);
  }
  {
    const { position: [x, , z], radius, height, material } = cfg.cylinder;
    const y = groundUnder(x, z, radius);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 40), materials.get(material));
    mesh.position.set(x, y + height / 2, z);
    group.add(mesh);
    physics.addCylinder(x, z, radius, y, y + height);
  }
  {
    const p = cfg.pillars;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < p.count; i++) {
      const t = i / Math.max(1, p.count - 1);
      const z = -(p.near + (p.far - p.near) * t);
      const x = rng.range(-p.spread, p.spread);
      const h = rng.range(p.minHeight, p.maxHeight);
      const y = groundUnder(x, z, p.width / 2);
      const pillar = new THREE.Mesh(geometry, materials.get(p.material));
      pillar.scale.set(p.width, h, p.width);
      pillar.position.set(x, y + h / 2, z);
      group.add(pillar);
      physics.addBox([x - p.width / 2, y, z - p.width / 2], [x + p.width / 2, y + h, z + p.width / 2]);
    }
  }

  return { group };
}
