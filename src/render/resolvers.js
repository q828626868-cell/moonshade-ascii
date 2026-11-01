// 每種材質一個字元解析函式：
//   (亮度, 霧, 附加資訊, 鄰居, out) → out.glyph（字元圖集欄）, out.level（顏色層級，0 最暗）, out.shade（受光／陰影）
// 附加資訊 extra：bit0–3 世界座標雜湊；bit4 圖樣（板縫、瓦列）；bit6 暖光；bit7 影子旗標
//                 （水面：bit4–5 水深等級、bit6 浪峰）
// 鄰居 nb：edge（偵測到的邊線字元，-1 表示不是邊）、edgeKind、
//          dither（抖動門檻，-0.5–0.5，取自世界座標雜湊，所以字元貼在世界上不會隨鏡頭滑動）、depth（公尺）、
//          mat(dx, dy)、lum(dx, dy)
// 亮度已乘上環境遮蔽；霧的「變疏」在呼叫前已統一處理，這裡只負責「變暗」與選字元。
import { SHADE_LIT, SHADE_SHADOW, SHADE_WARM } from './glyphAtlas.js';

export const EDGE_NONE = 0;
export const EDGE_SILHOUETTE = 1;
export const EDGE_CREASE = 2;

export function createResolvers(config, atlas, materialIds) {
  const A = config.ascii;
  const S = config.shadow;
  const M = config.materials;
  const L = atlas.levels;

  const sets = {};
  for (const [name, def] of Object.entries(M)) {
    sets[name] = { lit: atlas.compile(def.chars), shadow: atlas.compile(def.shadowChars ?? S.chars) };
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const shade = (lum, fog) => lum * A.exposure * (1 - fog * (1 - config.weather.fog.floor));
  const hash = (extra) => (extra & 15) / 15;
  const shadowed = (extra) => extra >= 128;
  const warmLit = (extra) => (extra & 64) !== 0;
  const patterned = (extra) => (extra & 16) !== 0;
  const g = (ch) => atlas.glyph(ch);
  // 漣漪的方向碼 → 字元（右、右上、上、左上、左、左下、下、右下）
  const rippleGlyphs = [...')\\-/(\\_/'].map((ch) => atlas.glyph(ch));

  // ordered dithering：在相鄰兩級之間依門檻取捨，避免大塊同一字元的色帶
  const quantize = (v, steps, nb) => {
    const i = Math.floor(clamp01(v) * steps + nb.dither * A.dither);
    return i < 0 ? 0 : i >= steps ? steps - 1 : i;
  };
  const levelOf = (v, nb) => quantize(v, L, nb);
  const pick = (set, v, nb) => set[quantize(v, set.length, nb)];

  function edge(out, nb, v) {
    out.glyph = nb.edge;
    out.level = Math.min(L - 1, levelOf(v, nb) + A.edges.levelBoost);
  }

  function blank(out) {
    out.glyph = 0;
    out.level = 0;
  }

  // 共用流程：
  //   陰影區 → 陰影字元集、陰影色（亮度以 shadow.range 正規化，陰影裡的明暗也看得出來）
  //   受光區 → 邊線 → 太暗留白 → 依亮度（加雜湊抖動）從材質字元集選字
  function ramp(name, lum, fog, extra, nb, out) {
    const v = shade(lum, fog);
    const jitter = (hash(extra) - 0.5) * (M[name].jitter ?? 0);
    if (warmLit(extra)) {
      // 被窗光、火把照亮：材質字元集，暖色調色盤
      out.shade = SHADE_WARM;
      if (nb.edge >= 0) return edge(out, nb, v);
      out.glyph = pick(sets[name].lit, v + jitter, nb);
      out.level = levelOf(v, nb);
      return;
    }
    if (shadowed(extra)) {
      out.shade = SHADE_SHADOW;
      const t = v / S.range;
      if (nb.edge >= 0) return edge(out, nb, t);
      if (v < A.blankBelow * 0.5) return blank(out);
      out.glyph = pick(sets[name].shadow, t + jitter, nb);
      out.level = levelOf(t, nb);
      return;
    }
    out.shade = SHADE_LIT;
    if (nb.edge >= 0) return edge(out, nb, v);
    if (v < A.blankBelow) return blank(out);
    out.glyph = pick(sets[name].lit, v + jitter, nb);
    out.level = levelOf(v, nb);
  }

  function flower(name, lum, fog, extra, nb, out) {
    ramp(name, lum, fog, extra, nb, out);
    if (out.glyph && nb.edge < 0) out.level = Math.max(out.level, Math.floor(L / 2));
  }

  const table = {
    generic(lum, fog, extra, nb, out) {
      ramp('generic', lum, fog, extra, nb, out);
    },

    // 近處的草由細線畫（world/grassBlades.js），這裡的字元在近處變疏，讓細線成為主體；遠處全是字元
    grass(lum, fog, extra, nb, out) {
      ramp('grass', lum, fog, extra, nb, out);
      const G = config.lines.grass;
      if (!config.lines.enabled || !G.enabled || nb.edge >= 0 || !out.glyph) return;
      const near = 1 - clamp01((nb.depth - G.glyphFade[0]) / (G.glyphFade[1] - G.glyphFade[0]));
      if (hash(extra) > 1 - near * (1 - G.glyphKeep)) blank(out);
    },

    path(lum, fog, extra, nb, out) {
      ramp('path', lum, fog, extra, nb, out);
    },

    rut(lum, fog, extra, nb, out) {
      ramp('rut', lum, fog, extra, nb, out);
    },

    hoofprint(lum, fog, extra, nb, out) {
      ramp('hoofprint', lum, fog, extra, nb, out);
    },

    // ---- 人物 ----
    skin(lum, fog, extra, nb, out) {
      ramp('skin', lum, fog, extra, nb, out);
    },

    tunic(lum, fog, extra, nb, out) {
      ramp('tunic', lum, fog, extra, nb, out);
    },

    trousers(lum, fog, extra, nb, out) {
      ramp('trousers', lum, fog, extra, nb, out);
    },

    boots(lum, fog, extra, nb, out) {
      ramp('boots', lum, fog, extra, nb, out);
    },

    hair(lum, fog, extra, nb, out) {
      ramp('hair', lum, fog, extra, nb, out);
    },

    horseCoat(lum, fog, extra, nb, out) {
      ramp('horseCoat', lum, fog, extra, nb, out);
    },

    horseHair(lum, fog, extra, nb, out) {
      ramp('horseHair', lum, fog, extra, nb, out);
    },

    saddle(lum, fog, extra, nb, out) {
      ramp('saddle', lum, fog, extra, nb, out);
    },

    saddlePad(lum, fog, extra, nb, out) {
      ramp('saddlePad', lum, fog, extra, nb, out);
    },

    hoof(lum, fog, extra, nb, out) {
      ramp('hoof', lum, fog, extra, nb, out);
    },

    hat(lum, fog, extra, nb, out) {
      ramp('hat', lum, fog, extra, nb, out);
    },

    cloak(lum, fog, extra, nb, out) {
      ramp('cloak', lum, fog, extra, nb, out);
    },

    leather(lum, fog, extra, nb, out) {
      ramp('leather', lum, fog, extra, nb, out);
    },

    belt(lum, fog, extra, nb, out) {
      ramp('belt', lum, fog, extra, nb, out);
    },

    pouch(lum, fog, extra, nb, out) {
      ramp('pouch', lum, fog, extra, nb, out);
    },

    scabbard(lum, fog, extra, nb, out) {
      ramp('scabbard', lum, fog, extra, nb, out);
    },

    steel(lum, fog, extra, nb, out) {
      ramp('steel', lum, fog, extra, nb, out);
    },

    lanternFrame(lum, fog, extra, nb, out) {
      ramp('lanternFrame', lum, fog, extra, nb, out);
    },

    // 油燈玻璃：點亮時自己發光（emissive）；熄滅時照一般光線畫
    lanternGlass(lum, fog, extra, nb, out) {
      if (!config.outfit.lantern) return ramp('lanternGlass', lum, fog, extra, nb, out);
      out.shade = SHADE_WARM;
      out.level = L - 1;
      out.glyph = pick(sets.lanternGlass.lit, hash(extra), nb);
    },

    // ---- 建築：字元要有結構感 ----

    // 木牆：直向木板，板縫（圖樣位元）留白 → | | |
    timber(lum, fog, extra, nb, out) {
      ramp('timber', lum, fog, extra, nb, out);
      if (nb.edge < 0 && patterned(extra)) blank(out);
    },

    // 屋頂：依屋面朝向畫 / 或 \（面向右下的斜面是 \、面向左下的是 /），兩面在屋脊相接成 /\；瓦列畫成 -
    roof(lum, fog, extra, nb, out) {
      ramp('roof', lum, fog, extra, nb, out);
      if (nb.edge >= 0 || !out.glyph) return;
      if (patterned(extra)) out.glyph = g('-');
      else if (nb.nx > 0.12) out.glyph = g('\\');
      else if (nb.nx < -0.12) out.glyph = g('/');
      else out.glyph = g('^');
    },

    foundation(lum, fog, extra, nb, out) {
      ramp('foundation', lum, fog, extra, nb, out);
    },

    // 窗戶：自己發光的暖黃色，左右兩端畫 [ ]，中間 □
    window(lum, fog, extra, nb, out) {
      const w = materialIds.window;
      out.shade = SHADE_WARM;
      out.level = L - 1;
      out.glyph = nb.mat(-1, 0) !== w ? g('[') : nb.mat(1, 0) !== w ? g(']') : g('□');
    },

    door(lum, fog, extra, nb, out) {
      ramp('door', lum, fog, extra, nb, out);
    },

    fence(lum, fog, extra, nb, out) {
      ramp('fence', lum, fog, extra, nb, out);
    },

    hay(lum, fog, extra, nb, out) {
      ramp('hay', lum, fog, extra, nb, out);
    },

    clothRed(lum, fog, extra, nb, out) {
      ramp('clothRed', lum, fog, extra, nb, out);
    },

    clothTeal(lum, fog, extra, nb, out) {
      ramp('clothTeal', lum, fog, extra, nb, out);
    },

    // 火焰：自己發光，字元隨世界雜湊在 * 與 ^ 之間跳動
    flame(lum, fog, extra, nb, out) {
      out.shade = SHADE_WARM;
      out.level = L - 1;
      out.glyph = pick(sets.flame.lit, hash(extra), nb);
    },

    pine(lum, fog, extra, nb, out) {
      ramp('pine', lum, fog, extra, nb, out);
    },

    birch(lum, fog, extra, nb, out) {
      ramp('birch', lum, fog, extra, nb, out);
    },

    birchLeaf(lum, fog, extra, nb, out) {
      ramp('birchLeaf', lum, fog, extra, nb, out);
    },

    deadwood(lum, fog, extra, nb, out) {
      ramp('deadwood', lum, fog, extra, nb, out);
    },

    dryGrass(lum, fog, extra, nb, out) {
      ramp('dryGrass', lum, fog, extra, nb, out);
    },

    mud(lum, fog, extra, nb, out) {
      ramp('mud', lum, fog, extra, nb, out);
    },

    sand(lum, fog, extra, nb, out) {
      ramp('sand', lum, fog, extra, nb, out);
    },

    rock(lum, fog, extra, nb, out) {
      ramp('rock', lum, fog, extra, nb, out);
    },

    snow(lum, fog, extra, nb, out) {
      ramp('snow', lum, fog, extra, nb, out);
    },

    needles(lum, fog, extra, nb, out) {
      ramp('needles', lum, fog, extra, nb, out);
    },

    moss(lum, fog, extra, nb, out) {
      ramp('moss', lum, fog, extra, nb, out);
    },

    // 野花：一律畫成 *，至少用中間的顏色層級，暗處也看得出顏色
    flowerRed(lum, fog, extra, nb, out) {
      flower('flowerRed', lum, fog, extra, nb, out);
    },

    flowerGold(lum, fog, extra, nb, out) {
      flower('flowerGold', lum, fog, extra, nb, out);
    },

    flowerViolet(lum, fog, extra, nb, out) {
      flower('flowerViolet', lum, fog, extra, nb, out);
    },

    spruce(lum, fog, extra, nb, out) {
      ramp('spruce', lum, fog, extra, nb, out);
    },

    mushroom(lum, fog, extra, nb, out) {
      ramp('mushroom', lum, fog, extra, nb, out);
    },

    // 瀑布水幕：不畫邊線（水幕的輪廓會被畫成 | 而和水流字元混在一起），亮度不低於一半
    // 瀑布：往下流動的 | ' .（bit4–5 是 shader 依高度與時間算出的相位）
    falls(lum, fog, extra, nb, out) {
      const v = Math.max(shade(lum, fog), 0.5 * (1 - fog));
      out.shade = SHADE_LIT;
      const set = sets.falls.lit;
      out.glyph = set[((extra >> 4) & 3) % set.length];
      out.level = levelOf(v, nb);
    },

    // 水面：浪峰 ~、波腰 -、浪谷留白（bit4–5）；在陰影裡只換成陰影色
    water(lum, fog, extra, nb, out) {
      const v = shade(lum, fog);
      const inShadow = shadowed(extra);
      out.shade = inShadow ? SHADE_SHADOW : SHADE_LIT;
      const t = inShadow ? v / S.range : v;
      if (nb.edge >= 0 && nb.edgeKind === EDGE_SILHOUETTE) return edge(out, nb, t);
      const cls = (extra >> 4) & 3;
      if (cls === 0 || v < A.blankBelow * 0.5) return blank(out);
      const set = sets.water.lit; // 波腰、浪峰
      out.glyph = set[Math.min(cls - 1, set.length - 1)];
      out.level = levelOf(t, nb);
    },

    // 漣漪：方向碼（bit4–6）0 右 → 1 右上 → 2 上 → 3 左上 → 4 左 → 5 左下 → 6 下 → 7 右下
    ripple(lum, fog, extra, nb, out) {
      const v = Math.max(shade(lum, fog), 0.35 * (1 - fog));
      out.shade = SHADE_LIT;
      out.glyph = rippleGlyphs[(extra >> 4) & 7];
      out.level = levelOf(v, nb);
    },

    foam(lum, fog, extra, nb, out) {
      const v = Math.max(shade(lum, fog), 0.4 * (1 - fog));
      out.shade = SHADE_LIT;
      out.glyph = pick(sets.foam.lit, hash(extra), nb);
      out.level = levelOf(v, nb);
    },

    waterBed(lum, fog, extra, nb, out) {
      ramp('waterBed', lum, fog, extra, nb, out);
    },

    floatLeaf(lum, fog, extra, nb, out) {
      ramp('floatLeaf', lum, fog, extra, nb, out);
    },

    // 倒影只用到它的調色盤（cellResolver 以被倒映物件的字元、這個材質的顏色畫）
    reflection(lum, fog, extra, nb, out) {
      ramp('reflection', lum, fog, extra, nb, out);
    },
    stone(lum, fog, extra, nb, out) {
      ramp('stone', lum, fog, extra, nb, out);
    },

    leaf(lum, fog, extra, nb, out) {
      ramp('leaf', lum, fog, extra, nb, out);
    },

    wood(lum, fog, extra, nb, out) {
      ramp('wood', lum, fog, extra, nb, out);
    },

    // 馬蹄揚起的塵土：小塊的點狀字元，不畫輪廓線（每塊只有一兩格大）
    dust(lum, fog, extra, nb, out) {
      const v = shade(lum, fog);
      out.shade = SHADE_LIT;
      if (v < A.blankBelow) return blank(out);
      out.glyph = pick(sets.dust.lit, v + (hash(extra) - 0.5) * (M.dust.jitter ?? 0), nb);
      out.level = levelOf(v, nb);
    },
  };

  // ---- 野怪：每種一個材質，字元風格各不相同 ----
  for (const name of ['wolf', 'wolfAlpha', 'boar', 'ivory', 'treant', 'treantBark', 'spider', 'lakeHag', 'hagHair', 'frog', 'crab', 'crabCracked', 'golem', 'frostBear', 'frostBearRage', 'wyvern', 'wyvernWing', 'hare', 'roots']) {
    table[name] = (lum, fog, extra, nb, out) => ramp(name, lum, fog, extra, nb, out);
  }
  // 自己發光、不受明暗影響的小物件：一律最亮的受光色，不畫輪廓（每個只有一兩格大）
  const glow = (name, minLevel = L - 1) => (lum, fog, extra, nb, out) => {
    out.shade = SHADE_LIT;
    out.glyph = pick(sets[name].lit, hash(extra), nb);
    out.level = Math.max(minLevel, levelOf(shade(lum, fog), nb));
  };
  table.eye = glow('eye');
  table.alert = glow('alert');
  table.alertLost = glow('alertLost');
  table.stun = glow('stun');
  const fireGlow = glow('fireBolt');
  table.fireBolt = (lum, fog, extra, nb, out) => {
    fireGlow(lum, fog, extra, nb, out);
    out.shade = SHADE_WARM;
  };
  table.iceShard = glow('iceShard', L - 2);
  // 攻擊範圍預告：地上的紅色 !（shader 已抽掉一部分像素 → ! ! !），外框是連續的 !
  table.telegraph = glow('telegraph');
  table.telegraphEdge = glow('telegraphEdge', L - 2);
  table.aimGuide = glow('aimGuide', L - 2); // 法術瞄準時地上的範圍
  // 石像守衛的符文：入夜甦醒時發光（白天的模型換成 golem 材質，見 species/golem.js）
  table.golemRune = glow('golemRune', L - 2);
  // 遊魂：字元隨時間閃爍（shader 也每 1/rate 秒換一組被抽掉的像素 → 半透明），暗處也看得到
  const wispSet = sets.wisp.lit;
  table.wisp = (lum, fog, extra, nb, out) => {
    const v = Math.max(shade(lum, fog), 0.45 * (1 - fog));
    const flick = Math.floor(performance.now() / 110);
    out.shade = SHADE_LIT;
    out.glyph = wispSet[((extra & 15) + flick) % wispSet.length];
    out.level = Math.min(L - 1, levelOf(v, nb) + ((((extra & 15) * 7 + flick) & 3) === 0 ? 1 : 0));
  };
  // 蛛網、毒池：地上的一塊（shader 抽掉一部分像素，看得到下面的地面）
  table.web = (lum, fog, extra, nb, out) => {
    ramp('web', Math.max(lum, 0.35), fog, extra, nb, out);
    if (nb.edge >= 0) out.glyph = pick(sets.web.lit, hash(extra), nb);
  };
  table.acid = (lum, fog, extra, nb, out) => {
    out.shade = SHADE_LIT;
    out.glyph = pick(sets.acid.lit, hash(extra), nb);
    out.level = Math.max(1, levelOf(shade(lum, fog) + 0.3, nb));
  };

  // 蹄印（extra bit5，地形 shader 依 world/hoofEffects.js 的遮罩寫入）：換成蹄印字元、暗一級（凹下去）
  const print = atlas.compile(config.hoofEffects.prints.chars);
  for (const name of config.hoofEffects.prints.surfaces) {
    const base = table[name];
    table[name] = (lum, fog, extra, nb, out) => {
      base(lum, fog, extra, nb, out);
      if ((extra & 32) === 0 || nb.edge >= 0 || !out.glyph) return;
      out.glyph = print[(extra & 15) % print.length];
      out.level = Math.max(0, out.level - 1);
    };
  }
  return table;
}
