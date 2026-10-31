// 每種野怪的模型、姿勢與特殊行為（屬性在 CONFIG.creatures.species）。
// 介面：
//   define(b)            骨架與零件（creatures/body.js 的 buildTemplate），回傳 meta：legs（IK 的腳）、legOpts、stride、
//                        length（依地形前後傾斜的身長）、eye／mark／aim（眼睛、頭上記號、被瞄準的高度）、mouth、fur
//   variants             換材質的版本（狼王、暴走、白天的石柱、裂開的殼）
//   pose(c, k)           每幀的程序式姿勢（骨頭從靜止姿勢開始疊）；之後才做腳的 IK
//   可選的掛勾：think（自己處理整個狀態機）、strike／strikeStep（特殊的出手）、beginAttack、canAttack、chaseTarget、
//   damageScale（元素倍率之外的倍率）、onHurt、onDeath、deadThink、restState（回家後的狀態）、homes（固定的地盤）、
//   homeOk／validPoint（能刷在哪、能走去哪）、present（何時出現）、emit（細線特效）、free（不受碰撞）、strafe（橫行）
import { wolf, boar, bear, hare } from './quadrupeds.js';
import { spider, crab } from './arthropods.js';
import { treant, golem, wisp } from './spirits.js';
import { lakeHag, frog } from './water.js';
import { wyvern } from './wyvern.js';

export const SPECIES = { wolf, boar, hare, treant, spider, lakeHag, frog, crab, golem, wisp, bear, wyvern };
