// G-buffer 的 GLSL。場景以「每個字元格 = 1 像素」繪製，輸出封裝過的資料而不是顏色：
//   gSurface  r 光照亮度 | g 材質 ID | b 霧的距離 | a 附加資訊
//               光照 = 主光源（月光／太陽）× 陰影 + 天空環境光（上方）+ 地面反射光（下方）
//               附加資訊：bit0–3 世界座標雜湊（抖動、霧抽格的門檻，貼在世界座標上）
//                         bit4   圖樣（木牆的板縫、屋頂的瓦列）；水面：bit4–5 波紋等級（浪谷、波腰、浪峰）；
//                                漣漪：bit4–6 字元方向；瀑布：bit4–5 流動字元
//                         bit5   地形：這格有蹄印（泥地、沙、雪、泥土路上，world/hoofEffects.js 寫入的遮罩）
//                         bit6   暖光（被點光源照亮為主，或自己發光）；水面：浪峰
//                         bit7   影子旗標（被投影遮住，或背向主光源；暖光處不算）
//               bit6 + bit7 同時為 1（自然不會出現：暖光處不算陰影）：水面上的倒影，材質是被倒映的物件
//               點光源（窗光、火把）照亮周圍：亮度加上去，並標記暖光讓字元改用暖色調色盤
//   gGeometry rg 螢幕空間（視空間）法線 xy | ba 16 位元線性深度
//
// 變體（ShaderMaterial defines）：
//   TERRAIN  地形：頂點依高度函式位移（instanceMatrix 給區塊位置），片段依高度／坡度／濕度選地表材質
//   WATER    水面：水波相位，並以高度函式算出水深
//   VERTEX_MATERIAL  材質 ID 來自頂點屬性 aMaterial（樹幹與葉叢在同一個幾何），並依 aFlex 隨風搖晃

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

export function surfaceVertexShader(heightGlsl) {
  return /* glsl */ `
uniform mat4 uShadowMatrix;
uniform float uNormalStep;
uniform float uSkirtDepth;

out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
out float vViewZ;
out vec4 vShadowCoord;

#ifdef TERRAIN
${heightGlsl}
#endif

#include <skinning_pars_vertex>

#ifdef VERTEX_MATERIAL
in float aMaterial;
in float aFlex;
flat out float vMaterial;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uSway;   // 公尺：擺動權重 1 的頂點在風力 1 時的位移
uniform float uTime;
#endif

void main() {
#ifdef TERRAIN
  // 區塊共用一張平面網格；position.y < 0 的頂點是裙邊（往下延伸，遮住相鄰 LOD 之間的裂縫）
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 world = m * vec4(position.x, 0.0, position.z, 1.0);
  float h0 = hfHeight(world.xz);
  float hx = hfHeight(world.xz + vec2(uNormalStep, 0.0));
  float hz = hfHeight(world.xz + vec2(0.0, uNormalStep));
  world.y = h0 - (position.y < -0.5 ? uSkirtDepth : 0.0);
  vWorldNormal = normalize(vec3(h0 - hx, uNormalStep, h0 - hz));
  vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
#else
  // 一般物件；樹、倒木等大量物件以 InstancedMesh 繪製；人物以 SkinnedMesh（骨架蒙皮）繪製
  vec3 transformed = position;
  vec3 objectNormal = normal;
#ifdef USE_SKINNING
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
#endif
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 world = m * vec4(transformed, 1.0);
  // 非等比縮放（樹冠、倒木）的法線：矩陣是「旋轉 × 縮放」、沒有切變，逆轉置 = M · S⁻²，
  // 用各軸縮放的平方修正即可，不必每個頂點求反矩陣
  mat3 m3 = mat3(m);
  vec3 s2 = vec3(dot(m3[0], m3[0]), dot(m3[1], m3[1]), dot(m3[2], m3[2]));
  vWorldNormal = normalize(m3 * (objectNormal / s2));
  vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
#ifdef VERTEX_MATERIAL
  // 隨風搖晃：依高度（aFlex）往風向位移，每棵樹以位置決定相位；再加上一點細碎的抖動
  vMaterial = aMaterial;
  float phase = dot(m[3].xz, vec2(0.173, 0.131));
  float gust = 0.6 + 0.4 * sin(uTime * 1.6 + phase) * sin(uTime * 0.53 + phase * 1.7);
  float amount = uWindStrength * uSway * aFlex;
  world.xz += uWindDir * amount * gust + vec2(sin(uTime * 2.3 + phase), cos(uTime * 1.9 + phase * 1.3)) * amount * 0.15;
  world.y += amount * 0.35 * sin(uTime * 6.1 + phase + world.x * 9.0 + world.z * 7.0); // 細碎的上下顫動（帽緣、葉尖）
#endif
#endif
  vec4 view = viewMatrix * world;
  vWorldPos = world.xyz;
  vViewZ = -view.z;
  vShadowCoord = uShadowMatrix * world;
  gl_Position = projectionMatrix * view;
}
`;
}

export function surfaceFragmentShader(heightGlsl, terrainCount, materialCount, maxLights) {
  return /* glsl */ `
uniform float uMaterialId;
uniform vec3 uPattern;          // x 類型（0 無、1 直向木板、2 橫向瓦列）, y 間距（公尺）, z 佔比
uniform float uEmissive;        // 自己發光（窗戶、火焰）的亮度
uniform vec4 uLightPos[${maxLights}];  // xyz 位置, w 半徑
uniform float uLightPower[${maxLights}];
uniform int uLightCount;
uniform vec4 uLightBounds;      // 所有作用中點光源的包圍球（xyz 中心, w 半徑）：範圍外整段跳過
uniform float uWarmThreshold;   // 點光源佔原本亮度的比例超過此值，該處改用暖色
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uSkyIntensity;    // 天空環境光（法線朝上時最強）
uniform float uGroundIntensity; // 地面反射光（法線朝下時最強）
uniform float uSelfShadowNdl;   // 受光角 cos 低於此值也算陰影區（背光面）
uniform float uFar;
uniform float uFogRange;
uniform vec2 uSeedOffset;
uniform vec4 uNoise;            // x 細紋尺度, y 細紋強度, z 斑塊尺度, w 斑塊強度
uniform float uNoiseFade;       // 公尺
uniform float uCellFootprint;   // 距離 1 公尺處一個字元格的世界尺寸（公尺）
uniform vec3 uWater;            // y 波紋尺度, z 波速
uniform vec3 uWaterDepths;      // 水深等級的分界（公尺）
uniform float uTime;
uniform vec4 uOccluder;         // 擋住角色的樹葉變稀疏：xy 角色在 G-buffer 上的像素位置、z 半徑（像素）、w 角色的視深（0 = 關閉）
uniform vec4 uFoliage;          // 樹葉的材質 ID（最多四種，-1 = 不用）
uniform float uOccluderKeep;    // 圓心處保留的比例
uniform vec2 uClipY;            // 倒影那一次繪製：x = 1 時丟掉 y 以下（水面以下）的部分，水面本身也不畫
uniform vec4 uSparseIds;        // 半透明的材質 ID（遊魂、蛛網、毒池、攻擊預告；-1 = 不用）
uniform vec4 uSparseKeep;       // 各自保留的像素比例
uniform vec4 uSparseRate;       // 圖樣每秒換幾次（0 = 固定，貼在世界上）
#ifdef WATER
uniform sampler2D uRipple;      // 漣漪：R 高度、G 速度（以玩家為中心的方形區域，見 world/waterSurface.js）
uniform vec4 uRippleArea;       // xy 區域最小的 x、z，z 邊長，w 1 = 啟用
uniform float uRippleThreshold; // 漣漪高度超過此值才畫漣漪字元
uniform sampler2D uReflect;     // 倒影（鏡像鏡頭畫的 G-buffer 第一張附件）
uniform mat4 uReflectMatrix;    // 世界座標 → 倒影貼圖座標
uniform float uReflectOn;
uniform vec3 uReflectParams;    // x 倒影字元的密度, y 依漣漪左右扭曲的量, z 亮度
uniform vec2 uCamRight;         // 鏡頭的右方與前方（水平面上），把漣漪的方向換成螢幕方向
uniform vec2 uCamForward;
uniform vec4 uWaterIds;         // 材質 ID：x 漣漪, y 岸邊浪花, z 水底
uniform vec4 uWaterLook;        // x 河流流速, y 岸邊浪花的寬度（水深）, z 看得到水底的水深, w 風讓波紋變密的程度
uniform float uRiverWidth;
uniform vec2 uWindDir;
uniform float uWindStrength;
#endif
uniform sampler2D uShadowMap;
uniform float uShadowOn;
uniform float uShadowBias;
uniform vec2 uShadowTexel;
#ifdef TERRAIN
uniform float uTerrainIds[${terrainCount}];
uniform vec4 uTerrainNoise[${terrainCount}];
uniform float uForestDarken;    // 黑杉林地面變暗的比例
uniform sampler2D uPrints;      // 蹄印遮罩（世界座標的方形區域，值 = 新舊程度，越舊越淡）
uniform vec4 uPrintArea;        // xy 區域的最小 x、z，z 邊長（公尺），w 1 = 啟用
uniform float uPrintable[${terrainCount}]; // 哪些地表會留下蹄印
#endif
#ifdef VERTEX_MATERIAL
flat in float vMaterial;
uniform vec4 uMaterialNoise[${materialCount}];
#endif

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vViewNormal;
in float vViewZ;
in vec4 vShadowCoord;

layout(location = 0) out vec4 gSurface;
layout(location = 1) out vec4 gGeometry;

${NOISE_GLSL}

#if defined(TERRAIN) || defined(WATER)
${heightGlsl}
#endif

// 0 = 完全受光，1 = 完全在影子裡（3×3 PCF）
float shadowAmount(float ndl) {
  if (uShadowOn < 0.5) return 0.0;
  vec3 c = vShadowCoord.xyz / vShadowCoord.w;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 0.0;
  float bias = uShadowBias * (1.0 + 3.0 * (1.0 - ndl));
  float s = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      s += step(texture(uShadowMap, c.xy + vec2(i, j) * uShadowTexel).r, c.z - bias);
    }
  }
  return s / 9.0;
}

// 貼在世界座標上的雜湊：格子大小依距離取 2 的冪次，約等於一個字元格在該處的世界尺寸。
// 鏡頭移動時圖樣跟著世界走（不像紗窗一樣滑動），遠處也不會因取樣過疏而閃爍。
float stableHash(vec2 p, float salt) {
  float level = ceil(log2(max(vViewZ * uCellFootprint, 1e-3)));
  float s = exp2(level);
  return hash12(floor(p / s) + vec2(salt + level * 17.0, salt * 3.0 - level * 5.0) + uSeedOffset);
}

void main() {
  if (uClipY.x > 0.5 && vWorldPos.y < uClipY.y) discard;
#ifdef WATER
  if (uClipY.x > 0.5) discard;
#endif
  vec3 n = normalize(vWorldNormal);
  vec3 vn = normalize(vViewNormal);
#ifdef DOUBLE_SIDED
  // 雙面材質（披風、瀑布水幕）：看到背面時法線翻過來，內側的明暗才正確
  if (!gl_FrontFacing) {
    n = -n;
    vn = -vn;
  }
#endif

  // 依法線選投影平面，垂直面也有紋理
  vec3 an = abs(n);
  vec2 p = an.y > max(an.x, an.z) ? vWorldPos.xz : (an.x > an.z ? vWorldPos.zy : vWorldPos.xy);

  float materialId = uMaterialId;
  vec4 noise = uNoise;
  float darken = 1.0;
#ifdef TERRAIN
  float forest;
  int surface = hfSurface(vWorldPos.xz, vWorldPos.y, n.y, stableHash(p, 31.0), stableHash(p, 57.0), stableHash(p, 83.0), vViewZ, forest);
  materialId = uTerrainIds[surface];
  noise = uTerrainNoise[surface];
  darken = 1.0 - uForestDarken * forest;
#endif
#ifdef VERTEX_MATERIAL
  materialId = vMaterial;
  noise = uMaterialNoise[int(vMaterial + 0.5)];
  // 擋在角色前面的樹葉：鏡頭與角色之間、畫面上靠近角色的地方，以世界座標雜湊抽掉一部分（字元變稀疏，看得到角色）
  if (uOccluder.w > 0.0 && vViewZ < uOccluder.w - 0.5 && any(equal(vec4(materialId), uFoliage))) {
    float r = length(gl_FragCoord.xy - uOccluder.xy) / uOccluder.z;
    if (r < 1.0 && stableHash(vWorldPos.xz + vWorldPos.yy, 211.0) > mix(uOccluderKeep, 1.0, smoothstep(0.6, 1.0, r))) discard;
  }
#endif

#ifndef TERRAIN
#ifndef WATER
  // 半透明：以世界座標雜湊抽掉一部分像素（後面的東西透出來）；會閃爍的材質每 1/rate 秒換一組圖樣
  for (int i = 0; i < 4; i++) {
    if (abs(materialId - uSparseIds[i]) < 0.5) {
      float salt = 503.0 + float(i) * 41.0 + floor(uTime * uSparseRate[i]) * 13.0;
      if (stableHash(p + vWorldPos.yy * 0.7, salt) > uSparseKeep[i]) discard;
    }
  }
#endif
#endif

  float ndl = max(dot(n, uSunDir), 0.0);
  float shadow = ndl > 0.0 ? shadowAmount(ndl) : 0.0;
  float hemi = uSkyIntensity * (0.5 + 0.5 * n.y) + uGroundIntensity * (0.5 - 0.5 * n.y);
  float lum = (hemi + ndl * uSunIntensity * (1.0 - shadow)) * darken;

  float fine = valueNoise(p * noise.x + uSeedOffset) - 0.5;
  float blotch = valueNoise(p * noise.z - uSeedOffset) - 0.5;
  float fade = 1.0 - smoothstep(uNoiseFade * 0.25, uNoiseFade, vViewZ);
  lum *= 1.0 + 2.0 * (fine * noise.y * fade + blotch * noise.w);

  // 點光源：二次衰減，背面也略受光（照亮周圍地面）
  float point = 0.0;
  int lightCount = distance(vWorldPos, uLightBounds.xyz) < uLightBounds.w ? uLightCount : 0;
  for (int i = 0; i < ${maxLights}; i++) {
    if (i >= lightCount) break;
    vec3 toLight = uLightPos[i].xyz - vWorldPos;
    float dist = length(toLight);
    float radius = uLightPos[i].w;
    if (dist < radius) {
      float att = 1.0 - dist / radius;
      point += uLightPower[i] * att * att * (0.25 + 0.75 * max(dot(n, toLight / max(dist, 1e-3)), 0.0));
    }
  }
  // 暖光：點光源佔到原本亮度的一定比例就算（月光下地面本來就亮，門檻太高的話只有燈正下方會變暖色）
  bool warm = point > 0.05 && point > lum * uWarmThreshold;
  lum += point;
  if (uEmissive > 0.0) {
    lum = max(lum, uEmissive);
    warm = true;
  }

  float extra = floor(stableHash(p, 0.0) * 15.999);
#ifdef TERRAIN
  // 蹄印：遮罩值與世界座標雜湊比較，越舊的蹄印剩下的格子越少（漸漸消失）
  if (uPrintArea.w > 0.5 && uPrintable[surface] > 0.5) {
    vec2 uv = (vWorldPos.xz - uPrintArea.xy) / uPrintArea.z;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      float v = texture(uPrints, uv).r;
      if (v > 0.02 && v > stableHash(p, 101.0) * 0.85) extra += 32.0;
    }
  }
#endif
#ifndef WATER
  if (uPattern.x > 2.5) {
    // 瀑布：沿著高度往下流動的字元（| ' .），每一欄的相位不同
    float column = hash12(floor(vWorldPos.xz * 6.0) + uSeedOffset);
    float ph = fract(vWorldPos.y * uPattern.y + uTime * uPattern.z + column);
    extra += floor(ph * 2.999) * 16.0;
  } else if (uPattern.x > 0.5 && vViewZ * uCellFootprint < uPattern.y * 0.8) {
    // 圖樣：木牆的直向板縫、屋頂的橫向瓦列（比一個字元格還細時不畫，避免閃爍）
    float coord = uPattern.x < 1.5 ? (an.x > an.z ? vWorldPos.z : vWorldPos.x) : vWorldPos.y;
    if ((uPattern.x > 1.5 || an.y < 0.5) && fract(coord / uPattern.y) < uPattern.z) extra += 16.0;
  }
  if (warm) extra += 64.0;
#endif
#ifdef WATER
  bool reflected = false;
  vec2 xz = vWorldPos.xz;
  float depth = vWorldPos.y - hfHeight(xz);
  // 河流：流向是沿河距離 s 減少的方向（往下游），水紋順著流向移動；湖裡沒有流
  vec2 flow = vec2(0.0);
  vec2 rv = hfRiver(xz);
  if (rv.x < uRiverWidth * 1.3 && hfLakeDistance(xz) > 1.05) {
    vec2 g = vec2(hfRiver(xz + vec2(0.5, 0.0)).y - rv.y, hfRiver(xz + vec2(0.0, 0.5)).y - rv.y);
    if (dot(g, g) > 1e-8) flow = -normalize(g) * uWaterLook.x;
  }
  // 多層 Gerstner 波：方向圍繞風向（風越大越集中），風越大波長越短（越密）。
  // 以兩次不動點迭代反推水平位移，波峰尖、波谷平
  float wind = clamp(uWindStrength, 0.0, 2.0);
  vec2 wd = length(uWindDir) > 0.01 ? normalize(uWindDir) : vec2(1.0, 0.0);
  vec2 q = xz - flow * uTime;
  float spread[4] = float[4](-0.55, -0.18, 0.22, 0.6);
  float lengths[4] = float[4](3.2, 2.1, 1.35, 0.85);
  float amps[4] = float[4](0.4, 0.28, 0.2, 0.12);
  vec2 disp = vec2(0.0);
  float wv = 0.0;
  for (int pass = 0; pass < 2; pass++) {
    vec2 x0 = q - disp;
    float hh = 0.0;
    vec2 dd = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      float ang = spread[i] * (1.0 - 0.45 * min(wind, 1.0));
      vec2 dir = vec2(wd.x * cos(ang) - wd.y * sin(ang), wd.x * sin(ang) + wd.y * cos(ang));
      float k = 6.2832 / (lengths[i] * uWater.y / (1.0 + uWaterLook.w * wind));
      float th = k * dot(dir, x0) - sqrt(9.8 * k) * uWater.z * 0.5 * uTime + float(i) * 1.7;
      hh += amps[i] * cos(th);
      dd += dir * sin(th) * 0.5 / k;
    }
    wv = hh;
    disp = dd;
  }
  lum *= 0.85 + 0.15 * (wv + 1.0);
  // 浪峰 ~、波腰 -、浪谷留白；風大時浪峰與波腰變多
  float cls = wv > mix(0.45, 0.28, min(wind, 1.0)) ? 2.0 : wv > mix(0.0, -0.25, min(wind, 1.0)) ? 1.0 : 0.0;

  // 漣漪：高度超過門檻的格（環的波峰）依「波往外傳的方向」在螢幕上的方向選字元：
  //   右 ) → 右上 \ → 上 - → 左上 / → 左 ( → 左下 \ → 下 _ → 右下 /（方向碼 0–7）
  float rh = 0.0;
  float code = -1.0;
  if (uRippleArea.w > 0.5) {
    vec2 uv = (xz - uRippleArea.xy) / uRippleArea.z;
    if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      float tx = 1.0 / float(textureSize(uRipple, 0).x);
      vec4 c = texture(uRipple, uv);
      rh = (c.r - 0.5) * 2.0;
      float vel = (c.g - 0.5) * 2.0;
      vec2 grad = vec2(texture(uRipple, uv + vec2(tx, 0.0)).r - texture(uRipple, uv - vec2(tx, 0.0)).r, texture(uRipple, uv + vec2(0.0, tx)).r - texture(uRipple, uv - vec2(0.0, tx)).r);
      vec2 outward = -grad * vel;
      if (rh > uRippleThreshold && dot(outward, outward) > 1e-9) {
        vec2 s = vec2(dot(outward, uCamRight), dot(outward, uCamForward));
        code = mod(floor(atan(s.y, s.x) / 0.785398 + 0.5), 8.0);
      }
    }
  }

  float foamBand = uWaterLook.y * (0.6 + 0.4 * sin(uTime * 1.3 + dot(xz, vec2(0.7, 0.5))));
  if (depth > 0.0 && depth < foamBand) {
    materialId = uWaterIds.y; // 岸邊浪花
  } else if (code >= 0.0) {
    materialId = uWaterIds.x; // 漣漪
    extra += code * 16.0;
  } else {
    // 淺水處看得到水底的石頭：越淺越常透出
    float see = 1.0 - smoothstep(0.0, uWaterLook.z, depth);
    if (cls < 1.5 && stableHash(p, 301.0) < see * 0.85) {
      materialId = uWaterIds.z;
      lum *= 0.7 + 0.3 * see;
    } else {
      extra += cls * 16.0;
      // 倒影：在浪谷與波腰上，以鏡像鏡頭畫的場景取樣（依漣漪高度左右扭曲）
      if (uReflectOn > 0.5 && cls < 1.5) {
        vec4 rc = uReflectMatrix * vec4(vWorldPos, 1.0);
        vec2 ruv = rc.xy / rc.w + vec2(rh * uReflectParams.y, 0.0);
        if (rc.w > 0.0 && all(greaterThan(ruv, vec2(0.0))) && all(lessThan(ruv, vec2(1.0)))) {
          vec4 r = texture(uReflect, ruv);
          float rm = floor(r.g * 255.0 + 0.5);
          if (rm > 0.5 && stableHash(p, 401.0) < uReflectParams.x) {
            materialId = rm;
            lum = r.r * uReflectParams.z;
            reflected = true;
          }
        }
      }
    }
  }
#endif
#ifdef WATER
  bool lit = false;
#else
  bool lit = warm;
#endif
  if ((shadow > 0.5 || ndl <= uSelfShadowNdl) && !lit) extra += 128.0;
#ifdef WATER
  if (reflected) extra = floor(stableHash(p, 0.0) * 15.999) + 192.0;
  // 漣漪的方向碼用到 bit4–6，不帶陰影旗標（否則 bit6 + bit7 會被當成倒影）
  else if (abs(materialId - uWaterIds.x) < 0.5) extra = mod(extra, 128.0);
#endif

  float fogDist = clamp(length(vWorldPos - cameraPosition) / uFogRange, 0.0, 1.0);

  float d = clamp(vViewZ / uFar, 0.0, 1.0);
  float d16 = floor(d * 65535.0 + 0.5);
  float hi = floor(d16 / 256.0);
  float lo = d16 - hi * 256.0;

  gSurface = vec4(clamp(lum, 0.0, 1.0), materialId / 255.0, fogDist, extra / 255.0);
  gGeometry = vec4(vn.xy * 0.5 + 0.5, hi / 255.0, lo / 255.0);
}
`;
}
