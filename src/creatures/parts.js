// 野怪用的低面數零件：介面與 entities/skinnedParts.js 相同，但段數少很多。
// 字元畫面一格就是幾公分到幾十公分，20 m 外的狼只佔 6×3 格，人物等級的細節（16×12 的橢圓體、14 段的旋轉體）完全看不出來，
// 卻讓每隻野怪多出好幾千個三角形，而且主畫面、陰影、倒影各畫一次。法線仍是平滑的，明暗與輪廓不會變成一面一面。
import * as THREE from 'three';
import { ellipsoid as baseEllipsoid, cone as baseCone, v3, UP } from '../entities/skinnedParts.js';

export { v3 };

const DETAIL = [8, 6]; // 橢圓體：經線 × 緯線
const LIMB_SEGMENTS = 6; // 旋轉體的圓周段數上限
const CAP_STEPS = 2; // 旋轉體兩端半球的分段

export function ellipsoid(c, r, rot = null, detail = DETAIL) {
  return baseEllipsoid(c, r, rot, [Math.min(detail[0], DETAIL[0]), Math.min(detail[1], DETAIL[1])]);
}

export function cone(a, b, radius, segments = 4) {
  return baseCone(a, b, radius, Math.min(segments, 4));
}

// 旋轉體：與 skinnedParts.limb 相同（a → b，profile = [[t, 半徑], ...]，兩端半球蓋），段數較少
export function limb(a, b, profile, segments = LIMB_SEGMENTS, squash = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const pts = [];
  const r0 = profile[0][1];
  const r1 = profile[profile.length - 1][1];
  for (let i = 0; i <= CAP_STEPS; i++) {
    const t = -Math.PI / 2 + (i / CAP_STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r0 * Math.cos(t), r0 * Math.sin(t)));
  }
  for (const [t, r] of profile.slice(1, -1)) pts.push(new THREE.Vector2(r, t * len));
  for (let i = 0; i <= CAP_STEPS; i++) {
    const t = (i / CAP_STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(t)), len + r1 * Math.sin(t)));
  }
  const g = new THREE.LatheGeometry(pts, Math.min(segments, LIMB_SEGMENTS));
  if (squash !== 1) g.scale(squash, 1, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
