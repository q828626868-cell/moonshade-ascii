// 野怪的身體：程式生成的骨架 + 蒙皮網格（與人物、馬共用 entities/skinnedParts.js 的零件），以及腳貼地的步伐（IK）。
//
// 模板（每種野怪建一次）：define(b) 用 b.bone() 定義關節（靜止姿勢的模型座標，面向 +z、y 向上、地面 y = 0），
//   b.add() 加上零件（材質名稱、跟著哪根骨頭、可選的與上一節骨頭混合）。variants 是換材質的版本（狼王、暴走、白天的石柱…），
//   共用同一副骨架權重，執行中換 mesh.geometry 就好。
// 實體（每隻一份）：自己的骨頭與 Skeleton，共用模板的幾何。reset() 把骨頭回到靜止姿勢（每幀姿勢從這裡開始疊）。
//
// 步伐（createLegs）：每隻腳有一個踩在地上的落點；身體走遠、落點離「腳該在的位置」超過步距時，
//   這隻腳抬起、沿弧線移到新的落點（往移動方向多踩一點）。同一組的腳一起邁步，別組的腳在地上時才能邁步：
//   四足的小跑是對角兩隻一組，蜘蛛與蟹是交錯的兩組四隻。每幀再用兩骨 IK（entities/ik.js）把腳放到落點上。
import * as THREE from 'three';
import { buildSkinnedGeometry, buildBones, blendFrom, v3 } from '../entities/skinnedParts.js';
import { solveTwoBone } from '../entities/ik.js';

export function buildTemplate(define, materials, variants = {}) {
  const names = [];
  const joint = {};
  const parents = {};
  const parts = [];
  const b = {
    joint,
    // 關節：名稱、上一節（null = 根）、靜止姿勢的位置
    bone(name, parent, pos) {
      names.push(name);
      joint[name] = v3(...pos);
      parents[name] = parent;
      return joint[name];
    },
    // 零件：blend = [上一節骨頭, 起點, 終點, 長度]——起點附近與上一節混合，關節彎曲時不裂開
    add(geometry, bone, material, blend = null) {
      if (!materials.ids[material]) throw new Error(`Creature material "${material}" not in CONFIG.materials`);
      parts.push({ geometry, bone, material, mesh: 'body', blend: blend ? blendFrom(blend[0], blend[1], blend[2], blend[3] ?? 0.08) : null });
    },
    // 左右對稱：fn(side, s)，side = 'L' | 'R'，s = +1（+x 側）| -1
    mirror(fn) {
      fn('L', 1);
      fn('R', -1);
    },
  };
  const meta = define(b) ?? {};
  const boneIndex = Object.fromEntries(names.map((n, i) => [n, i]));
  const geometryFor = (remap) =>
    buildSkinnedGeometry(
      parts.map((p) => ({ ...p, material: materials.ids[remap[p.material] ?? p.material] })),
      boneIndex,
      'body',
    );
  const base = geometryFor({});
  const geometries = { base: base.geometry };
  for (const [key, remap] of Object.entries(variants)) geometries[key] = geometryFor(remap).geometry;
  for (const p of parts) p.geometry.dispose();
  return { names, joint, parents, geometries, triangles: base.triangles, meta };
}

export function instantiate(template, material) {
  const { bones } = buildBones(template.names, template.joint, (n) => template.parents[n]);
  const mesh = new THREE.SkinnedMesh(template.geometries.base, material);
  mesh.add(bones[template.names[0]]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(template.names.map((n) => bones[n])));
  mesh.frustumCulled = false; // 姿勢改變後靜止的包圍體不準
  const object = new THREE.Group();
  object.add(mesh);
  object.rotation.order = 'YXZ';
  const restPos = Object.fromEntries(template.names.map((n) => [n, bones[n].position.clone()]));
  let variant = 'base';
  return {
    object,
    mesh,
    bones,
    joint: template.joint,
    reset() {
      for (const n of template.names) {
        bones[n].quaternion.identity();
        bones[n].position.copy(restPos[n]);
        bones[n].scale.set(1, 1, 1);
      }
    },
    // 換材質的版本（模板的 variants）
    setVariant(name) {
      if (name === variant || !template.geometries[name]) return;
      variant = name;
      mesh.geometry = template.geometries[name];
    },
    get variant() {
      return variant;
    },
    // 模型座標的一點（靜止姿勢）跟著某根骨頭移動後的世界座標
    attach(bone, rest) {
      const local = rest.clone().sub(template.joint[bone]);
      return (out) => out.copy(local).applyMatrix4(bones[bone].matrixWorld);
    },
  };
}

const _home = new THREE.Vector3();
const _target = new THREE.Vector3();

// defs：[{ upper, lower, end, group }]（三根骨頭；end 的靜止位置就是腳的位置）
// opts：stride（公尺，走路時一步）、height（抬腳高度）、time（秒，一步的時間）、lead（往移動方向多踩的比例）、
//       spread（腳的落點往外推的比例，例如蜘蛛的腳往外撐）、lift（腳離地的距離：腳的骨頭到腳底）
export function createLegs(model, defs, opts) {
  const o = { stride: 0.6, height: 0.12, time: 0.32, lead: 0.4, lift: 0.04, minTime: 0.12, spread: 0, ...opts };
  const legs = defs.map((d) => {
    const rest = model.joint[d.end].clone();
    if (o.spread) {
      rest.x *= 1 + o.spread;
      rest.z *= 1 + o.spread * 0.4;
    }
    rest.y = 0;
    return {
      ...d,
      upper: model.bones[d.upper],
      lower: model.bones[d.lower],
      end: model.bones[d.end],
      rest,
      planted: new THREE.Vector3(),
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      foot: new THREE.Vector3(),
      t: 1,
      duration: o.time,
      stepping: false,
      enabled: true,
      weight: 1,
    };
  });
  let planted = false;
  let groundSum = 0;

  function homeOf(leg, object, vx, vz, lead, ground) {
    _home.copy(leg.rest).applyMatrix4(object.matrixWorld);
    _home.x += vx * lead;
    _home.z += vz * lead;
    _home.y = ground(_home.x, _home.z);
    return _home;
  }

  return {
    legs,
    // 所有的腳重新踩在目前的位置下方（出生、瞬移之後）
    plant(object, ground) {
      object.updateMatrixWorld(true);
      for (const leg of legs) {
        homeOf(leg, object, 0, 0, 0, ground);
        leg.planted.copy(_home);
        leg.foot.copy(_home);
        leg.stepping = false;
        leg.t = 1;
      }
      planted = true;
    },
    // 落點平均高出身體下方地面多少（身體依此上下調整，跨在坡上不會懸空）
    get groundOffset() {
      return groundSum;
    },
    // 每幀：決定哪些腳要邁步、推進邁步中的腳、IK。object 的矩陣要是最新的（身體的位置與朝向）
    update(dt, object, vx, vz, ground, scale = 1) {
      if (!planted) this.plant(object, ground);
      const speed = Math.hypot(vx, vz);
      const stride = o.stride * scale;
      const duration = Math.max(o.minTime, Math.min(o.time, (stride * 0.9) / Math.max(speed, 1e-3)));
      const threshold = speed > 0.2 ? stride * 0.5 : stride * 0.22;
      const lead = duration * o.lead * 2;
      // 離該在的位置最遠的腳先邁步
      let busy = -1;
      for (const leg of legs) if (leg.stepping) busy = leg.group;
      let worst = null;
      let worstD = 0;
      for (const leg of legs) {
        if (leg.stepping || !leg.enabled) continue;
        const h = homeOf(leg, object, vx, vz, lead * 0.5, ground);
        const d = Math.hypot(h.x - leg.planted.x, h.z - leg.planted.z) + Math.abs(h.y - leg.planted.y) * 0.5;
        if (d > threshold && d > worstD && (busy < 0 || busy === leg.group)) {
          worst = leg;
          worstD = d;
        }
      }
      if (worst) {
        // 同一組的腳一起邁步
        for (const leg of legs) {
          if (leg.group !== worst.group || leg.stepping || !leg.enabled) continue;
          leg.from.copy(leg.planted);
          leg.to.copy(homeOf(leg, object, vx, vz, lead, ground));
          leg.duration = duration;
          leg.t = 0;
          leg.stepping = true;
        }
      }
      groundSum = 0;
      let n = 0;
      for (const leg of legs) {
        if (leg.stepping) {
          leg.t = Math.min(1, leg.t + dt / leg.duration);
          const k = leg.t * leg.t * (3 - 2 * leg.t);
          leg.foot.lerpVectors(leg.from, leg.to, k);
          leg.foot.y += Math.sin(Math.PI * leg.t) * o.height * scale * Math.min(1, 0.4 + speed * 0.3);
          if (leg.t >= 1) {
            leg.stepping = false;
            leg.planted.copy(leg.to);
          }
        } else leg.foot.copy(leg.planted);
        if (leg.enabled) {
          groundSum += (leg.stepping ? leg.to.y : leg.planted.y) - ground(object.position.x, object.position.z);
          n++;
        }
      }
      groundSum = n ? groundSum / n : 0;
    },
    // IK：在姿勢（FK）都設定好、矩陣更新之後呼叫
    solve(scale = 1) {
      for (const leg of legs) {
        if (!leg.enabled || leg.weight <= 0) continue;
        _target.copy(leg.foot);
        _target.y += o.lift * scale;
        solveTwoBone(leg.upper, leg.lower, leg.end, _target, leg.weight);
      }
    },
  };
}
