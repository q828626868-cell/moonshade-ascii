// 兩骨 IK（大腿–小腿–腳踝、上臂–前臂–手腕）：在世界座標中解，再換回骨頭的局部旋轉。
// 彎曲平面沿用目前（FK 動畫）的膝蓋／手肘方向，所以膝蓋永遠朝前、手肘朝後外側，不會反折。
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _nb = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

// 讓骨頭在世界空間中轉動，使 fromDir 轉到 toDir（皆為世界方向、單位向量）；weight 0–1
export function rotateBoneToward(bone, fromDir, toDir, weight = 1) {
  _q.setFromUnitVectors(fromDir, toDir);
  if (weight < 1) _q.slerp(_pq.identity(), 1 - weight);
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_q);
  bone.parent.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_wq));
  bone.updateMatrixWorld(true);
}

// upper、lower、end：三個骨頭（例如 thigh、shin、foot），target：末端要到的世界座標
export function solveTwoBone(upper, lower, end, target, weight = 1) {
  if (weight <= 0) return;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _t.copy(target);
  _d.subVectors(_t, _a);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  _d.normalize();
  // 彎曲方向：目前膝蓋相對於 根→目標 連線的垂直分量
  _pole.subVectors(_b, _a);
  _pole.addScaledVector(_d, -_pole.dot(_d));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _pole.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _nb.copy(_a).addScaledVector(_d, l1 * cosA).addScaledVector(_pole, l1 * sinA); // 新的膝蓋位置

  rotateBoneToward(upper, _b.sub(_a).normalize(), _nb.clone().sub(_a).normalize(), weight);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.copy(_a).addScaledVector(_d, dist);
  rotateBoneToward(lower, _c.sub(_b).normalize(), _t.sub(_b).normalize(), weight);
}
