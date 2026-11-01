// 所有可調整的數值集中在這裡。各模組只讀取自己的區塊，程式碼內不寫死魔術數字。
// 執行中可從瀏覽器主控台以 __moonshade.CONFIG 即時調整（大部分渲染數值每幀生效）。

export const CONFIG = {
  seed: 20261028,

  world: {
    name: '月影那地',
    size: 1024, // 公尺，正方形邊長，中心在原點
  },

  sim: {
    fixedDt: 1 / 60, // 物理／邏輯固定步長
    maxSubSteps: 5, // 單幀最多補幾步，超過就丟棄積壓
    maxFrameDt: 0.25, // 分頁切回來時避免一次跳太久
    physicsWorker: true, // 披風與馬毛的模擬放在 Web Worker（另一個 CPU 核心）；false = 主執行緒
  },

  render: {
    cellWidth: 7, // 每個字元格的 CSS 像素寬
    cellHeight: 12,
    maxPixelRatio: 2,
    maxCols: 320, // 超寬螢幕時放大字元格，控制成本
    fov: 55,
    near: 0.1,
    far: 600, // 深度正規化範圍（公尺）
    background: '#06070a',
    // 'ascii' | 'material' | 'normal' | 'depth' | 'fog' | 'extra' | 'edges' | 'ao'：直接看 G-buffer 各通道
    debugView: 'ascii',
  },

  ascii: {
    // 'sync'：零延遲（已驗證）；'async'：CPU 不等 GPU，畫面晚 1–2 幀（實驗性，尚未在實機驗證）
    readback: 'sync',
    // 'webgl'：字元畫面在 GPU 上一次畫完（render/glyphPass.js）；'canvas'：2D canvas 每格一次 drawImage（舊做法，比較慢）
    present: 'webgl',
    fontFamily: 'Consolas, "DejaVu Sans Mono", Menlo, "Courier New", monospace',
    fontWeight: 'bold',
    fontScale: 0.95, // 字高 / 格高
    // 每種材質的顏色：受光 colorLevels 級（材質色 × 主光源顏色）＋ 陰影 colorLevels 級（見 shadow）
    colorLevels: 4,
    colorFloor: 0.45, // 受光最暗層級 = 材質色 × 光色 × floor
    colorTop: 1.25, // 受光最亮層級 = 材質色 × 光色 × top
    exposure: 1.15,
    blankBelow: 0.06, // 亮度低於此值留白
    dither: 0.85, // ordered dithering 強度（0 關閉，1 = 相鄰兩級之間完整抖動）
    edges: {
      enabled: true,
      depthThreshold: 0.12, // 輪廓：1/深度 的二階差分相對門檻
      normalThreshold: 0.8, // 摺邊：相鄰法線 cos 低於此值
      contourNz: 0.4, // 法線 z 低於此值視為曲面輪廓，直接用法線決定邊線方向
      levelBoost: 2, // 邊線比原本亮幾個顏色層級
      glyphs: { horizontal: '-', bottom: '_', vertical: '|', slash: '/', backslash: '\\' },
    },
  },

  // 每種材質：字元集（由暗到亮）、顏色、表面雜訊、選字抖動。
  // 陰影區一律用 shadow.chars，材質可用 shadowChars 覆寫。
  // 字元解析邏輯在 render/resolvers.js，每種材質一個函式。
  // ownsCreases: false 的材質（地面、水面）不畫與物件交界的摺邊，交給物件那一側。
  materials: {
    generic: { chars: '.:-=+*#%@', color: '#c8ccd4' },
    grass: {
      chars: ".,';",
      color: '#3f7f4a',
      jitter: 0.35,
      ownsCreases: false,
      noise: { fineScale: 1.6, fineAmount: 0.25, patchScale: 0.045, patchAmount: 0.25 },
    },
    dryGrass: {
      chars: ".,;:",
      color: '#a3955a',
      jitter: 0.3,
      ownsCreases: false,
      noise: { fineScale: 1.4, fineAmount: 0.2, patchScale: 0.06, patchAmount: 0.2 },
    },
    mud: {
      chars: '.:o',
      color: '#6e5440',
      jitter: 0.25,
      ownsCreases: false,
      noise: { fineScale: 0.9, fineAmount: 0.2, patchScale: 0.12, patchAmount: 0.2 },
    },
    sand: {
      chars: ".':",
      color: '#cdbd8c',
      jitter: 0.2,
      ownsCreases: false,
      noise: { fineScale: 2.5, fineAmount: 0.1, patchScale: 0.08, patchAmount: 0.1 },
    },
    rock: {
      chars: ':%#@',
      color: '#80838c',
      jitter: 0.2,
      ownsCreases: false,
      noise: { fineScale: 0.8, fineAmount: 0.25, patchScale: 0.15, patchAmount: 0.2 },
    },
    snow: {
      chars: '-+*#',
      color: '#e6edf8',
      jitter: 0.15,
      ownsCreases: false,
      noise: { fineScale: 1.2, fineAmount: 0.08, patchScale: 0.05, patchAmount: 0.1 },
    },
    needles: {
      chars: '.,:;', // 黑杉林的針葉地面
      color: '#5f5a3c',
      jitter: 0.3,
      ownsCreases: false,
      noise: { fineScale: 1.8, fineAmount: 0.25, patchScale: 0.1, patchAmount: 0.2 },
    },
    moss: {
      chars: "';o",
      color: '#4f9a52',
      jitter: 0.25,
      ownsCreases: false,
      noise: { fineScale: 1.2, fineAmount: 0.2, patchScale: 0.2, patchAmount: 0.15 },
    },
    // 草原的野花：一律畫成 *，以顏色區分；陰影裡也還是 *
    flowerRed: { chars: '*', shadowChars: '*', color: '#e2566c', ownsCreases: false },
    flowerGold: { chars: '*', shadowChars: '*', color: '#e8c35a', ownsCreases: false },
    flowerViolet: { chars: '*', shadowChars: '*', color: '#a97ee2', ownsCreases: false },
    rut: { chars: '=_-', color: '#6f6450', jitter: 0.2, ownsCreases: false }, // 車轍
    hoofprint: { chars: 'uo', color: '#6a5d48', jitter: 0.3, ownsCreases: false }, // 蹄印
    // ---- 人物 ----
    skin: { chars: '.:-=+*', color: '#d8ae8c', jitter: 0.1 },
    tunic: { chars: ':=#%', color: '#8a4f3c', jitter: 0.15, noise: { fineScale: 8, fineAmount: 0.1, patchScale: 1, patchAmount: 0.08 } },
    trousers: { chars: ':=#', color: '#56606f', jitter: 0.15 },
    boots: { chars: '=#@', color: '#4a3527', jitter: 0.1 },
    hair: { chars: ':%&@', color: '#4a3424', jitter: 0.25 },
    // ---- 馬（佔位版）----
    horseCoat: { chars: ':=%#', color: '#7a5236', jitter: 0.15, noise: { fineScale: 3, fineAmount: 0.1, patchScale: 0.5, patchAmount: 0.1 } },
    horseHair: { chars: '%&#', color: '#2e2219', jitter: 0.25 },
    saddle: { chars: '=#H', color: '#5a3a22' }, // 馬鞍、肚帶、籠頭
    saddlePad: { chars: ':=#', color: '#5b3a44', jitter: 0.15 }, // 鞍墊（羊毛氈）
    hoof: { chars: '#H', color: '#3a332d' },
    dust: { chars: ".:;'", color: '#d4c3a1', jitter: 0.4 }, // 馬蹄揚起的塵土（比路面亮）
    // ---- 水面（shaders.js 的 WATER 依情況換成這些材質）----
    ripple: { chars: '()-_/\\', color: '#a9c9e8' }, // 漣漪：依方向選字元
    foam: { chars: '~^*', color: '#e2ecf4', jitter: 0.5 }, // 岸邊浪花
    waterBed: { chars: 'o.:,', color: '#5f7686', jitter: 0.5 }, // 淺水處透出的水底石頭
    reflection: { chars: '.', color: '#2c4c78' }, // 倒影的顏色（字元取自被倒映的物件）
    floatLeaf: { chars: ",*'", color: '#b39a4b', jitter: 0.4 }, // 漂在水上的葉子
    // ---- 旅人的服裝（每件獨立的字元與顏色）----
    hat: { chars: '-=#', color: '#5e4a36', jitter: 0.15 }, // 寬邊旅行帽
    cloak: { chars: ':=%#', color: '#2f4a73', jitter: 0.2, doubleSide: true, noise: { fineScale: 6, fineAmount: 0.12, patchScale: 1.2, patchAmount: 0.1 } }, // 旅行披風（顏色可在換裝選單切換）
    leather: { chars: '=#H', color: '#7a5434', jitter: 0.15 }, // 皮革胸甲
    belt: { chars: '=-', color: '#3d2b1d' },
    pouch: { chars: '#=', color: '#6a4a2c' },
    scabbard: { chars: '|=#', color: '#33291f' },
    steel: { chars: '+|=', color: '#b9bec7' },
    lanternFrame: { chars: '#|', color: '#3e3a35' },
    lanternGlass: { chars: '*□', color: '#ffcf66', emissive: 1 },
    // ---- 灰燼村的建築 ----
    timber: {
      chars: '|', // 木牆：直向木板，板縫留白 → | | |
      shadowChars: '|',
      color: '#9a6b43',
      pattern: { type: 'planks', period: 0.45, duty: 0.3 },
      noise: { fineScale: 3, fineAmount: 0.15, patchScale: 0.6, patchAmount: 0.1 },
    },
    roof: {
      chars: '/\\', // 屋頂：依屋面朝向畫 / 或 \（resolvers.js）
      shadowChars: '/\\',
      extraChars: '-^',
      color: '#7d5a4a',
      pattern: { type: 'shingles', period: 0.5, duty: 0.22 },
    },
    foundation: { chars: '#', shadowChars: '#', color: '#8a8c92', noise: { fineScale: 2.5, fineAmount: 0.2, patchScale: 0.5, patchAmount: 0.1 } }, // 石地基、煙囪、井圈
    window: { chars: '□', extraChars: '[]', color: '#ffd27a', emissive: 0.95 }, // 透著暖光的窗
    door: { chars: '|=', shadowChars: '|=', color: '#5c3d27' },
    fence: { chars: '-=+', shadowChars: '-=', color: '#8f6c49' },
    hay: { chars: ",;'", color: '#d2b65c', jitter: 0.3 },
    clothRed: { chars: '=#', color: '#b54a40' }, // 市集攤位的布篷
    clothTeal: { chars: '=#', color: '#3f8f88' },
    flame: { chars: '*^', color: '#ffb04a', emissive: 1 }, // 火把的火焰
    path: {
      chars: '.:-', // 泥土路
      color: '#8f8063',
      jitter: 0.25,
      ownsCreases: false,
      noise: { fineScale: 2, fineAmount: 0.15, patchScale: 0.2, patchAmount: 0.12 },
    },
    spruce: {
      chars: '^A#', // 高針葉樹（黑杉）的針葉
      color: '#2f6e4c',
      jitter: 0.25,
      noise: { fineScale: 2.5, fineAmount: 0.2, patchScale: 0.5, patchAmount: 0.15 },
      foliage: true, // 擋住角色時變稀疏
    },
    pine: {
      chars: '*%&', // 矮松的雲狀樹冠
      color: '#46805a',
      jitter: 0.3,
      noise: { fineScale: 2, fineAmount: 0.2, patchScale: 0.6, patchAmount: 0.15 },
      foliage: true,
    },
    birch: {
      chars: '|!I', // 樺樹的白色樹皮
      color: '#d9d4c6',
      jitter: 0.3,
      noise: { fineScale: 4, fineAmount: 0.3, patchScale: 1.5, patchAmount: 0.2 },
    },
    birchLeaf: {
      chars: ".*o", // 樺樹的小葉叢
      color: '#a8bd62',
      jitter: 0.35,
      noise: { fineScale: 3, fineAmount: 0.25, patchScale: 0.8, patchAmount: 0.15 },
      foliage: true,
    },
    deadwood: {
      chars: '/|\\', // 枯木
      color: '#9a9488',
      jitter: 0.4,
      noise: { fineScale: 3, fineAmount: 0.2, patchScale: 0.6, patchAmount: 0.1 },
    },
    mushroom: { chars: 'nmo', color: '#dccaa6', jitter: 0.2 },
    falls: { chars: "|'.", shadowChars: "|'.", color: '#d2e4ff', doubleSide: true, pattern: { type: 'fall', period: 1.6, duty: 4 } }, // 瀑布水幕：往下流動的 | ' .
    water: {
      chars: '-~', // 波腰 -、浪峰 ~（浪谷留白）
      color: '#4a7fbd',
      ownsCreases: false,
      wave: { scale: 0.9, speed: 1.4 },
    },
    stone: {
      chars: ':=#',
      color: '#8f959e',
      jitter: 0.15,
      noise: { fineScale: 2.2, fineAmount: 0.12, patchScale: 0.3, patchAmount: 0.1 },
    },
    leaf: { chars: '^*A', color: '#4b9354', jitter: 0.25, foliage: true },
    wood: {
      chars: '|=H',
      color: '#a0703f',
      jitter: 0.1,
      noise: { fineScale: 3.0, fineAmount: 0.1, patchScale: 0.4, patchAmount: 0.08 },
    },
    // ---- 野怪（creatures/）：每種一個專屬材質與字元風格 ----
    wolf: { chars: "'\"~^", color: '#8d949e', jitter: 0.45, noise: { fineScale: 9, fineAmount: 0.18, patchScale: 1.5, patchAmount: 0.1 } }, // 草原狼：細線毛髮的字元（另有細線層的毛）
    wolfAlpha: { chars: "'\"~^", color: '#5d6068', jitter: 0.45, noise: { fineScale: 9, fineAmount: 0.18, patchScale: 1.5, patchAmount: 0.1 } }, // 狼王：較深的毛色
    boar: { chars: '%&#', color: '#6e4b35', jitter: 0.3, noise: { fineScale: 6, fineAmount: 0.2, patchScale: 1, patchAmount: 0.1 } }, // 鐵牙野豬：粗硬的鬃毛
    ivory: { chars: '<>v', color: '#e6dcc2' }, // 獠牙、尖牙、角、爪
    treant: { chars: '^*&%', color: '#5f9148', jitter: 0.35, noise: { fineScale: 3, fineAmount: 0.25, patchScale: 0.8, patchAmount: 0.15 } }, // 苔蘚樹精：樹葉字元
    treantBark: { chars: '|!I', color: '#6f5a40', jitter: 0.3, noise: { fineScale: 4, fineAmount: 0.3, patchScale: 1.2, patchAmount: 0.15 } },
    spider: { chars: 'xX#', color: '#5a4062', jitter: 0.25 }, // 夜網蛛
    web: { chars: '#+x', color: '#d6dbe6', jitter: 0.5, ownsCreases: false, sparse: { keep: 0.55 } }, // 蛛網（地上一塊、吐出的網）
    lakeHag: { chars: '~S$', color: '#3f8a86', jitter: 0.3, noise: { fineScale: 3, fineAmount: 0.2, patchScale: 0.7, patchAmount: 0.15 } }, // 湖妖
    hagHair: { chars: '}{)', color: '#2f5c3c', jitter: 0.4 }, // 湖妖的水草頭髮
    frog: { chars: 'oO@', color: '#6f9a3a', jitter: 0.3, noise: { fineScale: 5, fineAmount: 0.2, patchScale: 1.2, patchAmount: 0.2 } }, // 沼澤蛙
    acid: { chars: '~o.', color: '#b8e04a', jitter: 0.5, ownsCreases: false, sparse: { keep: 0.6, rate: 3 } }, // 酸液：地上的毒池（會冒泡）
    crab: { chars: 'HM#', color: '#b0563c', jitter: 0.2 }, // 岩甲蟹：殼
    crabCracked: { chars: '/\\x', color: '#7a3d2c', jitter: 0.4 }, // 被雷劈裂的殼
    golem: { chars: '#[]', color: '#8e8a80', jitter: 0.2, noise: { fineScale: 2.5, fineAmount: 0.2, patchScale: 0.5, patchAmount: 0.12 } }, // 石像守衛
    golemRune: { chars: '=+', color: '#7ad0ff' }, // 符文：入夜甦醒時發光（白天是暗的石頭）
    wisp: { chars: '°*~', color: '#bfe8ff', sparse: { keep: 0.55, rate: 7 } }, // 遊魂：半透明、字元閃爍
    frostBear: { chars: 'M%&', color: '#d6e0ec', jitter: 0.3, noise: { fineScale: 7, fineAmount: 0.15, patchScale: 1.2, patchAmount: 0.1 } }, // 霜角熊
    frostBearRage: { chars: 'M%&', color: '#e0806e', jitter: 0.3 }, // 霜角熊暴走
    wyvern: { chars: 'VW^', color: '#7fa8d0', jitter: 0.25, noise: { fineScale: 3, fineAmount: 0.15, patchScale: 0.6, patchAmount: 0.1 } }, // 霜翼飛龍
    wyvernWing: { chars: '/\\-', color: '#5a7ca6', jitter: 0.3 },
    hare: { chars: ':o', color: '#b49a76', jitter: 0.3 }, // 野兔（小動物）
    eye: { chars: 'o', color: '#ff8a3c' }, // 野怪的眼睛（自己發光）
    // ---- 戰鬥 ----
    telegraph: { chars: '!', shadowChars: '!', color: '#ff3a32', emissive: 1, ownsCreases: false, sparse: { keep: 0.42 } }, // 攻擊範圍預告：地上的紅色 ! ! !
    telegraphEdge: { chars: '!', shadowChars: '!', color: '#ff5a3a', emissive: 1, ownsCreases: false }, // 預告的外框
    alert: { chars: '!', shadowChars: '!', color: '#ffd23a', emissive: 1 }, // 頭上的 !（警覺）
    alertLost: { chars: '?', shadowChars: '?', color: '#b8c4d4', emissive: 1 }, // 頭上的 ?（跟丟了）
    stun: { chars: '*', shadowChars: '*', color: '#ffe680', emissive: 1 }, // 暈眩
    fireBolt: { chars: '*@', color: '#ff8a2a', emissive: 1 }, // 火球
    iceShard: { chars: '*+', color: '#c4e8ff', emissive: 0.8 }, // 冰錐、冰息
    roots: { chars: 'Y|/\\', color: '#7d6242', jitter: 0.4 }, // 樹精從地下冒出的根
    aimGuide: { chars: '+', shadowChars: '+', color: '#7fd8ff', emissive: 1, ownsCreases: false }, // 法術瞄準時地上的範圍（外框）
  },

  surface: {
    noiseFadeDistance: 60, // 細紋在此距離外淡出，避免遠處字元閃爍
  },

  shadow: {
    enabled: true,
    mapSize: 512, // 即時陰影貼圖解析度（低即可，字元格本身就很粗）
    extent: 50, // 以玩家為中心，半邊長（公尺）
    depthRange: 200,
    bias: 0.0012,
    selfShadowNdl: 0.04, // 受光角 cos 低於此值（背光面）也算陰影區
    chars: '08QB', // 陰影區字元集（由暗到亮）
    range: 0.3, // 陰影區亮度達此值即用最亮的陰影字元
    tintMix: 0.65, // 陰影色 = 材質色與天空色混合（0 純材質色，1 純天空色）
    colorFloor: 0.35,
    colorTop: 0.85,
  },

  // 簡易環境遮蔽（螢幕空間，以字元格的深度與法線在 CPU 上計算）
  ao: {
    enabled: true,
    radius: 0.9, // 取樣半徑（公尺）
    samples: 8,
    strength: 0.75,
    bias: 0.08, // 公尺；另加深度比例 relBias，避免斜看的地面被自己遮蔽
    relBias: 0.01,
    range: 2.5, // 遮蔽物與取樣點深度差超過此值不算（避免前景物件在背景投下光暈）
    fadeDistance: 60, // 超過此距離逐漸關閉
  },

  weather: {
    rain: 0, // 雨量 0–1（目前用在水面的雨滴漣漪；例：?set=weather.rain:0.6）
    sun: {
      direction: [-0.55, 0.6, 0.45], // 指向光源；低角度的冷月光
      color: '#d4ddff',
      intensity: 0.75,
    },
    sky: { color: '#3d5c9e', intensity: 0.17 }, // 天空環境光（照向上的面）
    ground: { color: '#33503a', intensity: 0.07 }, // 地面反射光（照向下的面）
    climateSharpness: 0.8, // 跨區時氣候過渡的速率（1/s）
    wind: {
      direction: [1, 0, 0.35],
      strength: 1,
      gust: 0.5, // 陣風起伏幅度（相對 strength）
      gustSpeed: 0.35,
    },
    fog: {
      start: 25, // 公尺
      end: 300,
      floor: 0.15, // 霧最濃處保留的亮度比例
      sparsity: 0.9, // 霧最濃處被抽掉的字元比例
    },
  },

  // 細線層（鬃毛、尾巴、頭髮、披風邊緣、近處草葉）：畫在字元之上，以讀回的場景深度逐段判斷遮擋
  lines: {
    enabled: true,
    depthBias: 0.12, // 公尺：線比場景表面深這麼多以內仍算可見（線常緊貼在表面上）
    relBias: 0.02, // 另加深度比例的容許量
    pieceLength: 1, // 遮擋檢查的取樣間距（字元格）
    referenceDistance: 3, // 公尺：此距離內用原始寬度，更遠依距離反比變細
    minWidth: 0.5, // CSS px：比這更細時改以透明度表現
    fadeStart: 10, // 公尺：開始變透明
    fadeEnd: 35, // 公尺：完全看不見
    // 近處的草：玩家周圍 radius 內以世界空間的細線筆劃畫出，會被踩倒、被風吹彎；
    // 遠處轉成地表字元（細線淡出的同時，近處地面的草字元變疏，讓細線成為主體）
    grass: {
      enabled: true,
      radius: 20, // 公尺：玩家周圍多遠內長草葉
      cellSize: 0.5, // 公尺：每格 perCell 根
      perCell: 1,
      thinFrom: 7, // 公尺：從這裡開始逐漸減少草葉
      thinTo: 0.25, // radius 處只保留這個比例
      glyphFade: [11, 18], // 公尺（鏡頭距離）：這個範圍以內的草地字元逐漸變疏，交給細線
      glyphKeep: 0.35, // 最近處仍保留的草地字元比例
      minHeight: 0.18,
      maxHeight: 0.45,
      lean: 0.3, // 自然傾斜（相對高度）
      sway: 0.35, // 隨風彎曲幅度（相對高度）
      swaySpeed: 2.2,
      waveScale: 0.35, // 風波在地面上的空間頻率
      width: 1.2, // CSS px
      color: '#6aa872',
      shadowColor: '#35558c', // 長在陰影裡的草葉
      fadeStart: 13,
      fadeEnd: 22,
      nearFade: [1, 3.5], // 公尺：鏡頭腳下的草淡出（否則會被投影成很長的線）
      meadowHeightScale: 1.7, // 北境草原的高草：高度倍率
      meadowSwayScale: 1.3, // 北境草原的高草：擺動倍率
    },
    reins: { width: 1.4, color: '#a07a52', fadeStart: 15, fadeEnd: 35 }, // 比馬身亮，才分得出來
    breath: { width: 1.3, color: '#c3ccd6', fadeStart: 12, fadeEnd: 30 }, // 馬呼出的白霧
    splash: { width: 1.2, color: '#cfe3f2', fadeStart: 15, fadeEnd: 35 }, // 馬蹄踩水的水花
    ripple: { width: 1, color: '#8fb3cf', fadeStart: 15, fadeEnd: 35 }, // 水面的漣漪
    fish: { width: 2, color: '#9fb4c4', fadeStart: 15, fadeEnd: 40 }, // 跳出水面的魚
    stone: { width: 2, color: '#8b8d91', fadeStart: 20, fadeEnd: 50 }, // 丟出去的石頭
    // 野怪與戰鬥
    wolfFur: { width: 1.1, color: '#a3aab4', sceneLight: true, lightRange: [0.05, 0.55], fadeStart: 10, fadeEnd: 26 }, // 狼的細線毛髮
    wolfAlphaFur: { width: 1.2, color: '#6c7079', sceneLight: true, lightRange: [0.05, 0.55], fadeStart: 10, fadeEnd: 26 },
    lightning: { width: 2.4, color: '#fff3a0', fadeStart: 60, fadeEnd: 120 }, // 雷擊
    wind: { width: 1.3, color: '#d8f0e8', fadeStart: 20, fadeEnd: 45 }, // 風刃、拍翼風壓
    frost: { width: 1.6, color: '#d4f0ff', fadeStart: 40, fadeEnd: 90 }, // 冰息
    ember: { width: 1.6, color: '#ffb04a', fadeStart: 25, fadeEnd: 60 }, // 火花、火焰的拖尾
    spark: { width: 1.4, color: '#fff0c8', fadeStart: 20, fadeEnd: 50 }, // 命中的火花
    webLine: { width: 1, color: '#e2e6ee', fadeStart: 15, fadeEnd: 35 }, // 吐出的蛛絲
    swing: { width: 2, color: '#e8edf5', fadeStart: 15, fadeEnd: 30 }, // 揮劍的弧線
    rageSteam: { width: 1.6, color: '#f0d0c8', fadeStart: 15, fadeEnd: 40 }, // 熊暴走時噴出的白氣
    trample: {
      cellSize: 0.4, // 公尺
      radius: 0.5, // 公尺：人每步壓倒的範圍
      horseRadius: 1.1, // 公尺：馬每步壓倒的範圍
      recoverySeconds: 6, // 被踩倒的草多久恢復（時間常數）
      flatten: 0.85, // 完全踩倒時草葉高度剩下的比例的補數
    },
    reeds: { width: 1.3, color: '#b3a56a', shadowColor: '#4a5a86', fadeStart: 20, fadeEnd: 45 },
    falls: { width: 1.4, color: '#e2efff', fadeStart: 40, fadeEnd: 90 },
    snow: { width: 2.2, color: '#f2f6ff', fadeStart: 10, fadeEnd: 20 },
    smoke: { width: 2, color: '#8e96a4', fadeStart: 35, fadeEnd: 90, puffs: 7, height: 7, speed: 0.6, drift: 0.35, drawRadius: 100 },
    // 開發替身背後的圍巾：展示繩狀物理與遮擋，之後改為鬃毛、尾巴、頭髮、披風邊緣
    strands: {
      enabled: false, // 早期的細線示範（替身背後的五條圍巾），已關閉；馬的毛髮見 horse.hair
      anchor: [0, 1.5, -0.35], // 替身本地座標：x 右、y 上、z 前
      count: 5,
      nodes: 9,
      length: 1.1, // 公尺
      spread: 0.09,
      gravity: 9.8,
      damping: 0.97,
      iterations: 4,
      windResponse: 2.5,
      width: 1.6,
      color: '#d8cfb8',
    },
  },

  // 地形（world/heightField.js 的 JS 與 GLSL 版都由這裡產生；改了需重新整理頁面）
  // 座標：世界中心為原點，x 向東、z 向南（鏡頭預設看向 -z，也就是北方）
  terrain: {
    chunkSize: 64, // 公尺
    loadRadius: 2, // 玩家周圍 (2r+1)² 塊載入高精度：2 → 5×5
    loadPerFrame: 2, // 每幀最多載入幾塊
    viewDistance: 340, // 遠景 LOD 的繪製範圍（公尺）
    lod: { near: { segments: 32 }, far: { segments: 8 } }, // 每塊的格數：2 m／8 m 一格
    skirtDepth: 3, // 裙邊往下延伸多深（遮住不同 LOD 之間的裂縫）
    normalStep: 1, // 法線有限差分的間距（公尺）
    waterLevel: 0,
    waterDepths: [0.35, 1.2, 3], // 水深等級分界（公尺）：淺灘 / 淺水 / 中等 / 深水
    baseHeight: 16, // 夠高，噪聲的低谷才不會掉到水面下（水只出現在湖與河）
    // 多層噪聲：大尺度山丘 + 中尺度起伏 + 小尺度凹凸
    layers: [
      { name: 'hills', frequency: 1 / 260, amplitude: 12, octaves: 2 },
      { name: 'rolling', frequency: 1 / 70, amplitude: 4, octaves: 2 },
      { name: 'bumps', frequency: 1 / 11, amplitude: 0.45, octaves: 2 },
    ],
    // 手動設計的地標
    ridge: { from: [140, 120], to: [430, 400], height: 70, width: 75, roughness: 0.35, noiseFrequency: 1 / 25 },
    rim: { start: 420, end: 512, height: 75 }, // 世界邊界的外圍山（霜脛山脊的一部分，也是地圖邊界）
    plateau: { center: [0, 0], radius: 62, falloff: 30, height: 17 }, // 灰燼村所在的平台
    stones: { center: [-230, 170], topRadius: 24, hillRadius: 95, topHeight: 33 }, // 古石環所在的山丘，頂部壓平
    island: { center: [-225, -232], radius: 20, height: 3 }, // 月影湖的小島
    lake: {
      center: [-200, -210],
      radius: 95,
      depth: 9,
      shoreHeight: 1.8, // 湖周圍壓到水面上這麼高
      bankWidth: 1.7, // 湖岸影響範圍（湖半徑的倍數）
      wobble: 0.18, // 湖岸不規則程度
      wobbleFrequency: 1 / 70,
    },
    river: {
      points: [[-110, -190], [-30, -140], [60, -150], [160, -90], [280, -70], [400, 10], [520, 30]],
      width: 9, // 河道半寬
      depth: 2.2, // 河床在水面下多深
      bankHeight: 1.4, // 河谷壓到水面上這麼高
      valleyWidth: 5, // 河谷寬度（河道半寬的倍數）
      warp: 10, // 河道蜿蜒幅度（公尺）
      warpFrequency: 1 / 80,
      // 沿河距離 s 從湖端（第一個點）起算，往上游增加；河從東邊的山上流下，注入月影湖
      fall: { at: 560, height: 6, length: 3 }, // 小瀑布：此處以上的河面高 height 公尺
      ford: { at: 330, length: 14, strength: 0.85 }, // 淺灘：河床在此變淺
    },
    // 道路網：泥土路，以 Catmull-Rom 樣條連接各區域（只改地表與擺設，不改高度）。
    // 路線由錨點與控制點組成；錨點由地標算出（見 heightField.js）：
    //   village、stones（樞紐，路從其邊緣開始）、bridgeSouth / bridgeNorth、fordSouth / fordNorth、boardwalk、falls
    roads: {
      width: 2.2, // 半寬（公尺）
      sampleStep: 3, // 樣條每幾公尺取一點
      hubRadius: { village: 7, stones: 17 },
      detailFade: [18, 40], // 公尺：車轍與蹄印只在近處畫
      ruts: { offset: 0.75, width: 0.16 }, // 兩道車轍：距中心線 offset、寬 width
      hoof: { step: 0.8, lane: 0.35, size: 0.14, length: 0.16 }, // 蹄印：沿路每 step 一個，左右在 lane 內隨機
      paths: [
        ['village', [6, -60], [16, -105], 'bridgeSouth'], // 灰燼村 → 石橋
        ['bridgeNorth', [40, -205], [70, -262], [95, -330]], // 石橋 → 黑杉林
        ['village', [-60, 45], [-140, 105], 'stones'], // 灰燼村 → 古石環
        ['village', [-55, -40], [-120, -80], 'boardwalk'], // 灰燼村 → 月影湖棧道
        ['village', [70, -25], [140, -55], 'fordSouth'], // 灰燼村 → 淺灘
        ['fordNorth', [250, -115], [330, -75], 'falls'], // 淺灘 → 瀑布
        ['village', [60, 55], [140, 110], [190, 150]], // 灰燼村 → 霜脛山脊山腳
      ],
    },
    bridge: { at: 150, width: 3.4, span: 26, deckHeight: 0.6 }, // 石橋：at 沿河距離；deckHeight 高出河岸
    boardwalk: { angle: 1.15, length: 34, width: 2.2, deckHeight: 0.75, plankGap: 0.5 }, // 木棧道：angle 從湖心往外的方向（弧度，0 = 東）
    forestDarken: 0.35, // 黑杉林地面變暗的比例（樹冠遮光）
    // 地表材質（GLSL hfSurface 依名稱取索引）與分配規則
    surfaces: ['grass', 'dryGrass', 'mud', 'sand', 'rock', 'snow', 'needles', 'moss', 'flowerRed', 'flowerGold', 'flowerViolet', 'path', 'rut', 'hoofprint'],
    surface: {
      moistureRange: 3, // 水面以上幾公尺內算潮濕
      moistureRiver: 2.5, // 河道半寬幾倍內算潮濕
      moistureLake: 1.3, // 湖半徑幾倍內算潮濕
      moistureNoise: 0.35,
      moistureNoiseFrequency: 1 / 45,
      rockSlope: 0.78, // 法線 y 低於此值（坡度約 39° 以上）為岩壁
      rockBlend: 0.06,
      snowLine: 48, // 公尺
      snowBlend: 6,
      snowNoise: 10,
      snowNoiseFrequency: 1 / 30,
      snowFlat: [0.6, 0.75], // 太陡積不了雪
      beachHeight: 2.6, // 水面以上幾公尺內的緩坡是沙灘
      mudWet: [0.7, 0.92],
      dryWet: [0.15, 0.35], // 越乾越容易是乾草
      dryNoise: [0.5, 0.68],
      dryNoiseFrequency: 1 / 90,
      mossNoise: [0.55, 0.7], // 黑杉林地面的苔蘚斑塊
      mossNoiseFrequency: 1 / 14,
      flowerDensity: 0.025, // 草原上野花（彩色 *）的比例
      flowerFade: [15, 45], // 公尺：野花只在近處出現
    },
  },

  // 六個生態區域（順序固定，對應 world/heightField.js 的 REGION）。
  // area：範圍；climate：氣候（光線倍率、霧、風、雪）；audio：環境音各層的音量。
  // 玩家所在位置的區域權重會混合各區的 climate 與 audio，跨區時平滑過渡。
  // trees：該區的樹種比例；treeDensity：Poisson 取樣點長成樹的機率
  regions: {
    meadow: {
      name: '北境草原',
      subtitle: '高草隨風起伏，石牆低矮',
      trees: { birch: 0.5, pine: 0.3, dead: 0.2 },
      treeDensity: 0.012,
      climate: { sun: 1, sky: 1, fogStart: 30, fogEnd: 300, wind: 1.15, snow: 0 },
      audio: { wind: 0.35, crickets: 0.45 },
    },
    forest: {
      name: '黑杉林',
      subtitle: '樹冠遮住了天空',
      trees: { spruce: 0.62, pine: 0.12, birch: 0.14, dead: 0.12 },
      treeDensity: 0.85,
      area: { center: [120, -330], radius: 165, inner: 0.82, wobble: 0.22, wobbleFrequency: 1 / 90 },
      climate: { sun: 0.6, sky: 0.55, fogStart: 10, fogEnd: 140, wind: 0.35, snow: 0 },
      audio: { wind: 0.12, birds: 0.6 },
    },
    lake: {
      name: '月影湖',
      subtitle: '水面映著月光',
      trees: { birch: 0.55, pine: 0.35, dead: 0.1 },
      treeDensity: 0.05,
      area: { inner: 1.15, outer: 1.5 }, // 湖半徑的倍數
      climate: { sun: 1, sky: 1.1, fogStart: 14, fogEnd: 220, wind: 0.8, snow: 0 },
      audio: { wind: 0.2, lapping: 0.55 },
    },
    river: {
      name: '石溪河谷',
      subtitle: '溪水自山上流下，注入月影湖',
      trees: { birch: 0.5, pine: 0.4, spruce: 0.1 },
      treeDensity: 0.05,
      area: { inner: 3, outer: 6 }, // 河道半寬的倍數
      climate: { sun: 0.95, sky: 1, fogStart: 22, fogEnd: 260, wind: 0.9, snow: 0 },
      audio: { wind: 0.2, rush: 0.55 },
    },
    stones: {
      name: '古石環',
      subtitle: '山丘上殘破的石柱，無人記得的祈禱',
      trees: { dead: 0.7, pine: 0.3 },
      treeDensity: 0.03,
      area: { inner: 45, outer: 75 }, // 公尺，以石環中心起算
      climate: { sun: 0.85, sky: 0.9, fogStart: 16, fogEnd: 190, wind: 1.2, snow: 0 },
      audio: { wind: 0.3, drone: 0.4 },
    },
    ridge: {
      name: '霜脛山脊',
      subtitle: '世界的盡頭，終年積雪',
      trees: { pine: 0.7, dead: 0.3 },
      treeDensity: 0.04,
      area: { heightFrom: 36, heightTo: 46 }, // 公尺：海拔越高越屬於山脊
      climate: { sun: 1.1, sky: 1.2, fogStart: 20, fogEnd: 260, wind: 2.2, snow: 1 },
      audio: { wind: 0.45, howl: 0.5 },
    },
  },

  // 點光源（窗光、火把）：被照亮的地方改用暖色調色盤
  lights: {
    color: '#ffb45a',
    tintMix: 0.4, // 暖光色 = 材質色與光色混合（保留材質原色，暖光下也分得出不同東西）
    colorFloor: 0.5,
    colorTop: 1.3,
    warmThreshold: 0.2, // 點光源佔原本亮度的比例超過此值，該處改用暖色
  },

  // 灰燼村（在村莊平台上）
  village: {
    name: '灰燼村',
    houses: [8, 12],
    ring: [17, 46], // 房屋所在的環帶（公尺，距村中心）
    plazaRadius: 7.5, // 中央廣場（井在正中）
    gateRadius: 50, // 道路出村處（兩旁立火把）
    roadClearance: 1.2, // 公尺：建築與路邊的距離
    houseWidth: [5, 7],
    houseDepth: [6, 9],
    wallHeight: [2.5, 3.1],
    roofPitch: [32, 44], // 度
    stalls: 4,
    stable: { width: 11, depth: 6, height: 2.8, paddock: [12, 10] },
    windowLight: { radius: 7, power: 1.2 },
    torchLight: { radius: 10, power: 1.8 },
  },

  // 各區域的擺設（固定種子產生，每次都一樣）
  biomes: {
    tileSize: 128, // 公尺：物件依此分塊成 InstancedMesh，遠處整塊不畫、視野外整塊剔除
    viewDistance: 340,
    // 樹：4 種（高針葉樹 spruce、矮松 pine、樺樹 birch、枯木 dead）× variants 種結構 × 3 種尺寸。
    // 各區的樹種比例與密度在 CONFIG.regions[*].trees / treeDensity。
    trees: {
      variants: 2, // 每種樹的結構變體數
      sizes: [0.7, 1, 1.35], // 3 種尺寸等級（相對各樹種的基準高度：黑杉 13 m、矮松 6 m、樺樹 10 m、枯木 8 m）
      sizeWeights: [0.3, 0.45, 0.25],
      tilt: 0.05, // 隨機傾斜（弧度；枯木加倍）
      sway: 0.35, // 公尺：樹頂在風力 1 時的擺動幅度
      spacing: 3.6, // Poisson 最小間距（有森林的區塊）
      sparseSpacing: 14, // Poisson 最小間距（只有零星樹的區塊）
      denseThreshold: 0.2, // 區塊內樹的機率超過此值就用密集間距
      islandDensity: 0.55,
      maxSlope: 0.8, // 法線 y 低於此值（約 37° 以上）不長樹
      maxAltitude: 46, // 公尺：林線
      tileSize: 64, // 樹以區塊為單位分組（比其他物件細，LOD 才切得準）
      lodDistance: 70, // 公尺：更遠的樹換成簡化幾何
    },
    props: { spacing: 7, logs: 0.08, mushrooms: 0.1, ridgeBoulders: 0.1, riverBoulders: 0.14 }, // 散落物件：Poisson 間距與各區的機率
    roadClearance: 1.5, // 公尺：路邊多遠內不長樹、不放物件
    plateauClearance: 66, // 公尺：灰燼村周圍不長樹
    logs: { length: [4, 9], radius: [0.22, 0.4] },
    mushrooms: { perCluster: [3, 7], size: [0.12, 0.3] },
    walls: { count: 45, length: [6, 16], blockLength: 1.3, height: 0.9, width: 0.6, gapChance: 0.15, minMeadow: 0.85 },
    boulders: { size: [0.5, 1.8] },
    driftwood: { count: 18, length: [2, 5], radius: [0.15, 0.3] },
    steppingStones: { count: 8, spacing: 1.7 },
    stoneCircle: { ringRadius: 11, count: 12, height: [3, 4.2], brokenChance: 0.35, fallen: [3, 8], archRadius: 18 },
    reeds: { lakeSpacing: 1.4, riverSpacing: 2.5, density: 0.55, depth: [0, 1.5], perClump: [3, 6], height: [0.8, 1.7], drawRadius: 45 }, // depth：只長在水邊 0–1.5 m 深處
    waterfall: { streaks: 28, speed: 5, streakLength: 0.9, drawRadius: 90 },
    snowfall: { flakes: 450, radius: 16, height: 10, speed: 1.1, drift: 0.8, flakeLength: 0.14 },
  },

  physics: {
    maxStep: 0.25, // 單次位移超過就切成子步，避免穿透
    iterations: 2,
    gridSize: 16, // 公尺：碰撞體的空間格，只檢查附近的格
    stepHeight: 0.7, // 可直接踏上的高度（橋面、棧道）
    maxWadeDepth: 1.1, // 比這更深的水走不進去
  },

  // 環境音（WebAudio 即時合成，不需音檔）。瀏覽器規定要在第一次點擊／按鍵後才能出聲。
  audio: {
    enabled: true,
    volume: 0.6,
    muteKey: 'KeyN',
    fadeSeconds: 1.5, // 跨區時音量過渡的時間常數
    waterfallRadius: 70,
    whistleVolume: 0.25, // 叫馬的口哨 // 公尺：瀑布聲的範圍
  },

  // 教學場景：球（明暗交界）、方塊（輪廓與摺邊）、圓柱（曲面輪廓）、遠方石柱（霧）
  // 灰燼村蓋在同一個平台上，預設關閉；?set=tutorial.enabled:true 可以打開（會和村子重疊）
  tutorial: {
    enabled: false,
    sphere: { position: [-5, 0, -4], radius: 1.6, material: 'generic' },
    cube: { position: [0, 0, -6], size: 3, material: 'stone' },
    cylinder: { position: [5, 0, -4], radius: 1.2, height: 3.5, material: 'wood' },
    pillars: { count: 14, near: 30, far: 320, spread: 40, width: 2, minHeight: 4, maxHeight: 10, material: 'stone' },
  },

  // 人物（程式生成，entities/character.js）
  character: {
    height: 1.75, // 公尺；頭高 = 身高 / 7.5
    hatBrimSway: 0.03, // 公尺：帽緣在風力 1 時的抖動幅度
    // 展示模式：人物站在廣場上緩慢旋轉，替身隱藏、鏡頭對準人物
    showcase: {
      enabled: false, // ?set=character.showcase.enabled:true 開啟
      position: [-10, 0, 95], // 灰燼村南方的空曠草原（背景乾淨，輪廓看得清楚）
      spin: 0.35, // 弧度 / 秒
      camera: { distance: 3.2, pitch: 0.12, pivotHeight: 0.95, minDistance: 1.2, maxPitch: 1.5 },
      // 按鍵：固定成某個角度（相對鏡頭）；0 恢復旋轉
      views: {
        Digit1: { name: '正面', yaw: 0, pitch: 0.12 },
        Digit2: { name: '側面', yaw: Math.PI / 2, pitch: 0.12 },
        Digit3: { name: '背面', yaw: Math.PI, pitch: 0.12 },
        Digit4: { name: '俯視', yaw: 0, pitch: 1.42 },
      },
      resumeKey: 'Digit0',
      initialView: '', // 開場就固定成某個角度（例如 'Digit2'）；空字串 = 旋轉
    },
  },

  // 人物的程序式動畫（entities/animator.js）
  animation: {
    blend: 0.25, // 秒：狀態之間的混合過渡
    walkSpeed: 0.25, // m/s：低於此為待機
    runSpeed: 3, // m/s：高於此為跑步
    walkStride: 1.45, // 公尺：走路一個週期（兩步）前進的距離
    runStride: 2.6,
    turnLean: 0.05, // 轉彎傾斜：轉向速率 × 速度 × 此值（弧度）
    ankleHeight: 0.085, // 公尺：腳踝離地高度（IK 貼地用）
    swimFloat: -1.07, // 游泳時骨盆相對水面的高度（根節點放在水面）
    swimRate: 0.55, // 每秒划幾次
    posting: 0.1, // 公尺：快步起坐時站起的高度
    gallopRise: 0.12, // 公尺：襲步時離開鞍座的高度（兩點式）
  },

  // 旅人控制器（entities/traveler.js）：下馬、騎馬、上下馬、游泳
  traveler: {
    interactKey: 'KeyE', // 上馬／下馬
    mountRange: 2.2, // 公尺：離馬左側的上馬點多近才能上馬
    mountSeconds: 1.2,
    freezeMount: -1, // 測試用：0–1 時把上馬動畫停在這個進度（-1 = 正常播放）
    dismountSpeed: 0.8, // m/s：馬慢於此才能下馬
    horseSpawn: [0.6, 0, 12], // 一開始馬停的位置（灰燼村廣場南側，左側朝向玩家）
    horseHeading: 0,
    swimDepth: 1.0, // 公尺：水深過腰改游泳
    swimHysteresis: 0.15,
    waterSlow: 0.55, // 水深到腰時速度降低的比例
    swimPivot: 0.4, // 游泳時鏡頭看向水面上多高
    ridePivot: 2.4, // 騎馬時鏡頭看向地面上多高
    rideDistance: 1.6, // 騎馬時鏡頭距離是下馬時的幾倍
    // 物理身體的手感（entities/debugProxy.js）：速度 m/s，加減速 m/s²；turnRate 最快轉速（弧度／秒），
    // turnSharpness 轉向的靈敏度；放開輸入時 brakeTime 秒內停下（至少 minBrake m/s²）
    // 碰撞與坡度（見 debugProxy.js）：maxSlope 爬得上的最大坡度（弧度），超過就往下滑；headOn 正面撞上的門檻（方向與法線夾角的 cos）；
    // impactSpeed 正面撞上時超過這個速度會抬前腳；capsule 膠囊軸線半長（馬沿著身體）；slideSteer 沿牆滑時把頭轉向牆的方向
    footTuning: { radius: 0.35, height: 1.75, walkSpeed: 1.5, runSpeed: 5.2, acceleration: 12, deceleration: 16, turnRate: 12, turnSharpness: 14, brakeTime: 0.3, minBrake: 6, maxSlope: 1.1 },
    swimTuning: { radius: 0.35, height: 1.75, walkSpeed: 0.9, runSpeed: 1.5, acceleration: 2, deceleration: 2, turnRate: 3, turnSharpness: 6, brakeTime: 1, minBrake: 0.8, maxSlope: 1.5 },
    // 馬：轉彎半徑 = turnRadius[0] + turnRadius[1] × 速度（襲步時約 9 m）；幾乎停著時最多 pivotRate 弧度／秒；
    // 輸入方向與馬頭差超過 uTurnAngle 時先減速到 turnSpeed 再轉身；放開移動鍵 1.3 秒內停下
    horseTuning: { height: 2.2, acceleration: 3, deceleration: 5, turnSharpness: 3, turnRadius: [2, 0.55], pivotRate: 0.35, uTurnAngle: 1.9, turnSpeed: 1.5, brakeTime: 1.3, minBrake: 1.5, vehicle: true,
      radius: 0.42, capsule: 0.78, maxSlope: 0.96, headOn: 0.7, impactSpeed: 4.5, slideSteer: 3 },
    // 騎馬的步態：預設慢步；按住 Shift 快步，按住超過 canterHold 秒跑步；doubleTap 秒內連按兩下 Shift（並按住）襲步。
    // 手把／觸控：推的深度在 analog[0] 以下慢步、analog[1] 以下快步、再深跑步；按左搖桿（觸控推到底）襲步。
    // 襲步消耗耐力：staminaDrain 秒用完，之後只能跑步，恢復到 staminaRecover 才能再襲步；不襲步時 staminaRegen 秒回滿（慢步以下兩倍快）
    horseGaits: {
      speeds: { walk: 1.7, trot: 4, canter: 7, gallop: 13 },
      canterHold: 1,
      doubleTap: 0.35,
      analog: [0.45, 0.8],
      staminaDrain: 9,
      staminaRegen: 14,
      staminaRecover: 0.35,
    },
    // 跳躍（空白鍵）：apex 最高點（公尺）、duration 秒；馬依速度在兩個值之間（慢步 → 跑步以上）
    jump: { foot: { apex: 0.55, duration: 0.6 }, horse: { apex: [0.7, 1.45], duration: [0.75, 1.0] } },
    // 叫馬（C）：停在玩家 stopDistance 公尺外；以 brake m/s² 煞車；超過 teleportBeyond 公尺時先移到 arriveFrom 公尺外再跑來；
    // 卡住 giveUp 秒就放棄
    call: { stopDistance: 2.2, brake: 6, teleportBeyond: 150, arriveFrom: 45, giveUp: 3 },
    horseMaxDepth: 1.3, // 公尺：馬能走進去的最深的水
    horseWaterSlow: 0.6, // 水深到 horseMaxDepth 時速度減少的比例
    horseUphillSlow: 0.45, // 坡度 1:2（約 27°）時上坡速度減少的比例
  },

  // 馬（佔位版，entities/horse.js）：步態依速度切換
  horse: {
    gaitSpeeds: { trot: 2.6, canter: 5.5, gallop: 9.5 }, // m/s：超過即換成該步態（慢步約 1.7、快步 4、跑步 7、襲步 13）
    gaitHysteresis: 0.3, // m/s：門檻兩側的遲滯，避免在門檻附近來回切換
    gaitBlend: 0.5, // 秒：換步態時兩組曲線混合的時間
    // 停著時隨機播放的待機動作（相對機率）
    idleWeights: { graze: 3, toss: 1.5, swish: 2, shift: 2, snort: 1.5 },
    idleForce: '', // 測試用：固定播某個待機動作（例：?set=horse.idleForce:graze）
    // 鬃毛、前髮、尾巴：Verlet 細線（entities/horseHair.js）
    hair: {
      // count 根數、nodes 每根的節數、length 長度（m）、stiffness 根部被拉回靜止樣子的強度（每步的比例，往尖端遞減）
      mane: { count: 150, nodes: [10, 14], length: [0.2, 0.34], stiffness: 0.1, width: 1, color: '#5a4434', wetColor: '#2c221a' },
      forelock: { count: 15, nodes: [10, 12], length: [0.14, 0.22], stiffness: 0.08, width: 0.9, color: '#5a4434', wetColor: '#2c221a' },
      tail: { count: 300, nodes: [12, 16], length: [0.6, 0.85], spread: 0.18, stiffness: 0.03, width: 1.1, color: '#4e3b2d', wetColor: '#261d16' },
      gravity: 9.8,
      damping: 0.995, // 每步保留的速度（其餘的減速由空氣阻力負責）
      drag: 1.5, // 1/s：空氣阻力（相對於風的速度）。襲步 13 m/s 時毛往後約 63°，快步約 30°
      wind: 4, // m/s：風力 1 時的風速
      iterations: 3,
      margin: 0.015, // 公尺：與碰撞體保持的距離
      cloakRadius: 0.07, // 公尺：披風下緣節點當作的球半徑
      // 濕：soak 秒濕透、dry 秒乾；weight 變重的倍數、damping 多吸收的速度、dragLoss 少吃的風、cling 貼回身上的力
      wet: { soak: 1.2, dry: 60, weight: 1.5, damping: 0.04, dragLoss: 0.7, cling: 0.2 },
      // 每根分三段（根、中、尖）：寬度（CSS px）與不透明度遞減；顏色依所在格的光照分四級
      lines: { width: [1.4, 1.0, 0.6], opacity: [1, 0.75, 0.4], fadeStart: 12, fadeEnd: 40, lightRange: [0.05, 0.55] },
      // 距離（公尺）：full 內每節都畫、再遠每段跨兩節；half 內畫每一根、quarter 內畫一半、再遠畫四分之一；
      // simDistance 外不模擬也不畫（細線本身在 lines.fadeEnd 就淡出）
      lod: { simDistance: 45, full: 7, half: 16, quarter: 30 },
    },
    reinLength: 1.55, // 公尺：馬銜到手的韁繩長度（距離較短時下垂，拉到這麼長就繃直）
    // 展示模式：馬停在空曠的草原上，鏡頭對準馬。1 側面（左側）、2 前方、3 後方、4 俯視、0 旋轉；R 騎上／下馬
    showcase: {
      enabled: false, // ?set=horse.showcase.enabled:true 開啟
      position: [-10, 0, 95],
      heading: -2.0, // 讓馬的左側與正面朝向月光（weather.sun.direction，夜裡是月光），看得清楚
      spin: 0.3, // 弧度 / 秒
      camera: { distance: 6, pitch: 0.1, pivotHeight: 1.1, minDistance: 2, maxPitch: 1.5 },
      views: {
        Digit1: { name: '側面', yaw: Math.PI / 2, pitch: 0.06 },
        Digit2: { name: '前方', yaw: 0, pitch: 0.1 },
        Digit3: { name: '後方', yaw: Math.PI, pitch: 0.1 },
        Digit4: { name: '俯視', yaw: Math.PI / 2, pitch: 1.45 },
      },
      resumeKey: 'Digit0',
      rideKey: 'KeyR',
      initialView: 'Digit1',
    },
  },

  // 水面（world/waterSurface.js 與 shaders.js 的 WATER）
  water: {
    // 漣漪：以玩家為中心 size × size 格（每格 cell 公尺）解 2D 波動方程式；speed 波速 m/s、damping 每步保留的比例；
    // encode 高度寫進貼圖的倍數；threshold 畫漣漪字元的高度（貼圖上的值，-1–1）
    ripples: { cell: 0.25, size: 128, speed: 1.1, damping: 0.993, step: 1 / 60, encode: 400, velocityGain: 6, threshold: 0.12 },
    flow: { speed: 0.8 }, // m/s：河水流速（水紋與漂流物）
    foam: 0.12, // 公尺：岸邊浪花的寬度（水深）
    bedDepth: 0.5, // 公尺：比這淺的地方看得到水底的石頭
    windDensity: 0.6, // 風讓波紋變密的程度
    // 倒影：平面鏡像再畫一次場景（只在附近有水時）；density 倒影字元佔的比例、distortion 依漣漪左右扭曲、brightness 亮度
    reflection: { enabled: true, density: 0.8, distortion: 0.03, brightness: 0.8 },
    drift: { logs: 3, leaves: 24, logRipple: 0.03, leafRipple: 0.01 }, // 河上漂流的木頭、葉子
    fish: { every: [6, 15], minDepth: 0.8, duration: 0.6, distance: 0.9, height: 0.45, ripple: 0.08 },
    stone: { speed: 14, arc: 1.5, ripple: 0.12, range: 45 }, // 丟石頭（點水面）
    rain: { rate: 120, ripple: 0.05 }, // 雨滴：weather.rain = 1 時每秒幾顆
    reeds: { rate: 0.15, ripple: 0.015 }, // 風吹時蘆葉碰到水面
  },

  // 馬蹄對地面的影響（world/hoofEffects.js）：每隻蹄落地時觸發
  hoofEffects: {
    // 蹄印：留在這些地表上，以世界座標的遮罩記錄（以玩家為中心的方形區域，移動時跟著平移）
    prints: {
      surfaces: ['mud', 'sand', 'snow', 'path', 'rut', 'hoofprint'],
      chars: 'U', // 與道路上原本就有的舊蹄印（hoofprint 材質的 uo）區分
      texel: 0.12, // 公尺：遮罩一格的大小（約一個蹄的大小）
      size: 400, // 格：遮罩邊長（400 × 0.12 = 48 m）
      radius: 0.05, // 公尺：一個蹄印的半徑（小於半格 = 只佔一格）
      life: 90, // 秒：完全消失
      minWeight: 0.35, // 這些地表的權重合計超過此值才算（JS 端判斷，省下不必要的寫入）
    },
    trampleRadius: 0.3, // 公尺：每一步壓彎的草
    // 揚塵：跑過沙地、泥土路、乾草地時，往後上方揚起的小塊塵土
    dust: { max: 200, minSpeed: 3, perStep: [2, 4], life: [0.7, 1.4], size: [0.1, 0.2], dryWeight: 0.4 },
    // 踩水：水花（往上濺的細線）與漣漪（往外擴散的圓）
    splash: { minDepth: 0.03, droplets: [3, 7], speed: 1.6, ripple: 0.08 }, // ripple：在水面漣漪格子壓下的深度（公尺）
  },

  // 旅人的服裝
  outfit: {
    hat: true,
    lantern: true, // 油燈點亮（照亮周圍）
    cloakColor: '深藍',
    cloakColors: { 深藍: '#2f4a73', 酒紅: '#7a2e35', 墨綠: '#2f5a43', 灰褐: '#6e6559', 黑: '#2a2a30' },
    menuKey: 'KeyO', // 換裝選單
    cloak: {
      columns: 12,
      rows: 10,
      airDrag: 0.6, // 1/s：跑起來時的空氣阻力（下擺往後飄；襲步時約 40°）
      length: 0.95, // 公尺：從肩到膝
      spread: 105, // 度：掛點沿頸後到兩肩的弧（0 = 正後方）
      shoulderWidth: 0.2,
      backDepth: 0.13,
      shoulderDrop: 0.04,
      flare: 0.45, // 下擺比肩寬多展開的比例
      bend: 0.98, // 彎曲約束（隔一個節點）的長度比例，越接近 1 越挺
      gravity: 9.8,
      damping: 0.985,
      iterations: 6,
      windResponse: 3.5,
      flutter: 0.6,
      margin: 0.025, // 公尺：與身體保持的距離
    },
    lanternLight: { radius: 5, power: 0.5, flicker: 0.12 }, // 掛在身上，太亮會讓旅人整個變成暖色、看不出衣服的顏色
  },

  // 晝夜（world/clock.js）：一天 dayLength 秒；白天主光源換成太陽（較亮、方向隨時間），夜裡是月光。
  // 部分野怪只在夜裡出現，石像守衛白天是石柱、入夜甦醒（creatures/）
  clock: {
    startHour: 21, // 開場的時刻（例：?set=clock.startHour:12 白天）
    dayLength: 1440, // 秒：一整天（24 分鐘）
    speed: 1, // 時間流速倍率（測試用）
    dawn: [5, 7], // 時：天亮的過渡
    dusk: [17.5, 19.5], // 時：天黑的過渡
    nightBelow: 0.3, // 日光低於此值算夜晚
    sun: { intensity: 1.5, sky: 2.3 }, // 正午時主光源、天空光是月光時的幾倍
    skipKey: 'KeyT', // 快轉一小時（開發者面板開著時）
  },

  // 野怪（creatures/）。每種：程式生成、帶骨架的模型（species/*.js），屬性在這裡。
  // hp、damage 為等級 1 的數值；離灰燼村越遠等級越高（level），每級乘上 levelScale。
  // weak／resist：元素倍率（火 fire、雷 thunder、冰 ice、風 wind、物理 physical）
  creatures: {
    enabled: true,
    activeRadius: 150, // 公尺：玩家周圍多遠內的野怪會模擬、畫出來
    respawnSeconds: 90, // 死亡後多久重生（在玩家看不到的地方）
    respawnHiddenBeyond: 70, // 公尺：比這遠就算看不到（較近時要在鏡頭的視野外）
    respawnMinDistance: 35, // 公尺：就算在視野外，也不會在離玩家這麼近的地方重生
    noSpawn: { villageMargin: 45, roadClearance: 10, maxSlope: 0.72 }, // 村莊平台外 villageMargin 公尺內、道路 roadClearance 公尺內不刷怪
    level: { per: 70, max: 9, hp: 0.16, damage: 0.07 }, // 離村莊每 per 公尺升一級；每級 hp ×(1+hp)、傷害 ×(1+damage)
    leash: 1.0, // 地盤半徑的倍數：追出 territory × (1 + leash) 就放棄、回家回血
    returnRegen: 0.25, // 回家途中每秒回復的血量比例
    alertSeconds: 0.75, // 頭上出現 ! 之後多久開始追擊
    loseSightSeconds: 5, // 看不到玩家多久之後放棄
    fearFireRadius: 9, // 公尺：狼不敢靠近火堆的距離
    maxAttackers: 2, // 同時攻擊玩家的狼群成員數
    corpseSeconds: 4, // 屍體留多久
    alertMarkCells: 2.2, // 頭上的 ! 在畫面上約幾格高（遠處也看得到）
    // 距離分級：身高不到 minCells 格就不畫；鏡頭 half 公尺外姿勢隔一幀更新、third 外隔兩幀；ik 公尺外不做腳的 IK
    lod: { minCells: 0.5, half: 45, third: 80, ik: 60 },
    species: {
      // ---- 北境草原 ----
      wolf: {
        name: '草原狼', region: 'meadow', groups: 6, pack: [3, 5], territory: 38,
        hp: 42, damage: 9, walk: 1.6, run: 7.4, turn: 7, radius: 0.4, sight: 26, fov: 2.4, hearing: 9,
        weak: { fire: 1.5 }, resist: {}, fearsFire: true,
        alpha: { hp: 1.8, damage: 1.3, scale: 1.22 }, // 狼王
        attacks: {
          bite: { range: 2.1, windup: 0.55, recover: 0.6, cooldown: 2.2, damage: 1, shape: { type: 'cone', radius: 2.4, angle: 1.2 }, lunge: 4.5 },
        },
      },
      boar: {
        name: '鐵牙野豬', region: 'meadow', groups: 7, pack: [1, 2], territory: 30,
        hp: 70, damage: 14, walk: 1.3, run: 5.5, turn: 4, radius: 0.55, sight: 20, fov: 2.2, hearing: 7,
        weak: { wind: 1.5 }, resist: {}, knockback: 3, // 怕風：被風刃擊退得特別遠
        attacks: {
          gore: { range: 2.2, windup: 0.6, recover: 0.7, cooldown: 2, damage: 0.8, shape: { type: 'cone', radius: 2.5, angle: 1.1 } },
          charge: { range: [6, 15], windup: 1.1, recover: 1, cooldown: 7, damage: 1.6, shape: { type: 'rect', length: 16, width: 2.2 }, speed: 15, knock: 9 },
        },
        stunSeconds: 2, // 衝撞撞到樹：暈眩
      },
      hare: {
        name: '野兔', region: 'meadow', groups: 12, pack: [1, 3], territory: 20, critter: true,
        hp: 8, damage: 0, walk: 1.2, run: 8, turn: 10, radius: 0.18, sight: 14, fov: 4, hearing: 7,
        weak: {}, resist: {}, fearsWolves: 22, fearsPlayer: 7, attacks: {},
      },
      // ---- 黑杉林 ----
      treant: {
        name: '苔蘚樹精', region: 'forest', groups: 7, pack: [1, 1], territory: 22,
        hp: 120, damage: 13, walk: 1.1, run: 2.6, turn: 1.8, radius: 0.8, sight: 7, fov: 6.3, hearing: 7, wakeRange: 6.5,
        weak: { fire: 2 }, resist: { thunder: 0.5 },
        attacks: {
          roots: { range: [2, 14], windup: 1.25, recover: 1.2, cooldown: 5, damage: 1, shape: { type: 'circle', radius: 2.6 }, at: 'target', root: 1.6 },
          slam: { range: 3, windup: 0.9, recover: 1, cooldown: 3, damage: 1.2, shape: { type: 'circle', radius: 3, offset: 2 } },
        },
      },
      spider: {
        name: '夜網蛛', region: 'forest', groups: 7, pack: [1, 2], territory: 30, nightOnly: true, darkForest: 0.4, // darkForest：白天只在黑杉林中心（離中心 forestDistance 低於此值）的陰暗處出沒
        hp: 55, damage: 10, walk: 1.8, run: 6.2, turn: 6, radius: 0.7, sight: 22, fov: 3, hearing: 8,
        weak: { fire: 1.5 }, resist: {},
        attacks: {
          web: { range: [4, 16], windup: 0.8, recover: 0.6, cooldown: 4.5, damage: 0.4, shape: { type: 'circle', radius: 2 }, at: 'target', projectile: { speed: 16, arc: 2 }, slow: 0.5, slowSeconds: 3.5, hazard: 'web' },
          bite: { range: 2.2, windup: 0.5, recover: 0.6, cooldown: 1.8, damage: 1, shape: { type: 'cone', radius: 2.6, angle: 1.1 }, lunge: 3 },
        },
      },
      // ---- 月影湖 ----
      lakeHag: {
        name: '湖妖', region: 'lake', groups: 2, pack: [1, 1], territory: 60, aquatic: true,
        hp: 140, damage: 15, walk: 2, run: 5, turn: 3, radius: 0.9, sight: 18, fov: 6.3, hearing: 18,
        weak: { thunder: 2 }, resist: { ice: 0.5 }, immuneSubmerged: { fire: 0 }, // 在水裡時免疫火
        attacks: {
          grasp: { range: [1, 9], windup: 1.1, recover: 1.2, cooldown: 3.5, damage: 1, shape: { type: 'circle', radius: 2.4 }, at: 'target', knock: 5 },
          wave: { range: 6, windup: 1.4, recover: 1.4, cooldown: 8, damage: 0.8, shape: { type: 'circle', radius: 6 } },
        },
      },
      frog: {
        name: '沼澤蛙', region: 'lake', groups: 7, pack: [1, 3], territory: 24,
        hp: 38, damage: 8, walk: 1, run: 4, turn: 6, radius: 0.45, sight: 16, fov: 3, hearing: 6,
        weak: { ice: 1.5 }, resist: { fire: 0.5 },
        attacks: {
          leap: { range: [3, 9], windup: 0.7, recover: 0.7, cooldown: 3.5, damage: 1, shape: { type: 'circle', radius: 1.8 }, at: 'target', leap: true },
          spit: { range: [3, 12], windup: 0.7, recover: 0.5, cooldown: 5.5, damage: 0.5, shape: { type: 'circle', radius: 1.9 }, at: 'target', projectile: { speed: 13, arc: 2.5 }, hazard: 'acid' },
        },
      },
      // ---- 石溪河谷 ----
      crab: {
        name: '岩甲蟹', region: 'river', groups: 8, pack: [1, 2], territory: 22,
        hp: 80, damage: 11, walk: 1.4, run: 3.6, turn: 3, radius: 0.75, sight: 15, fov: 3, hearing: 6,
        weak: { thunder: 1.5 }, resist: { fire: 0.5, wind: 0.5 },
        shell: { seconds: 2.6, damage: 0.08, trigger: 0.18, cooldown: 6 }, // 一次受到 trigger 比例的血量就縮進殼裡，殼裡只吃 damage 倍的傷害
        attacks: {
          pinch: { range: 2.2, windup: 0.6, recover: 0.6, cooldown: 1.9, damage: 1, shape: { type: 'cone', radius: 2.5, angle: 1.3 } },
        },
      },
      // ---- 古石環 ----
      golem: {
        name: '石像守衛', region: 'stones', groups: 2, pack: [1, 1], territory: 26, elite: true, pillarByDay: true,
        hp: 320, damage: 20, walk: 1.2, run: 2.8, turn: 1.6, radius: 1.0, sight: 18, fov: 6.3, hearing: 12,
        weak: { thunder: 1.5 }, resist: { fire: 0.5, ice: 0.5 },
        attacks: {
          punch: { range: 3, windup: 0.9, recover: 0.8, cooldown: 2.5, damage: 1, shape: { type: 'cone', radius: 3.6, angle: 1 } },
          quake: { range: 9, windup: 1.4, recover: 1.6, cooldown: 7, damage: 1.3, shape: { type: 'ring', radius: 14, speed: 9, width: 1.2 }, knock: 6 }, // 震波：往外擴散的環，跳起來可以躲
        },
      },
      wisp: {
        name: '遊魂', region: 'stones', groups: 4, pack: [1, 2], territory: 30, nightOnly: true, flying: 1.6, ghost: true,
        hp: 34, damage: 9, walk: 1.4, run: 4.4, turn: 4, radius: 0.4, sight: 20, fov: 6.3, hearing: 10,
        weak: { fire: 1.5, thunder: 1.5 }, resist: { physical: 0 }, // 物理無效
        attacks: {
          wail: { range: 2.6, windup: 0.9, recover: 0.8, cooldown: 3, damage: 1, shape: { type: 'circle', radius: 2.8 } },
        },
      },
      // ---- 霜脛山脊 ----
      bear: {
        name: '霜角熊', region: 'ridge', groups: 5, pack: [1, 1], territory: 30,
        hp: 190, damage: 18, walk: 1.4, run: 6.5, turn: 3, radius: 0.85, sight: 20, fov: 2.6, hearing: 9,
        weak: { fire: 2 }, resist: { ice: 0.5 },
        rage: { below: 0.3, speed: 1.35, damage: 1.4 }, // 死前暴走：血量低於 below 時變快、變痛
        attacks: {
          swipe: { range: 2.8, windup: 0.95, recover: 0.8, cooldown: 2.4, damage: 1, shape: { type: 'cone', radius: 3.4, angle: 1.4 }, rear: true }, // 站起來揮爪
          maul: { range: 2.2, windup: 0.6, recover: 0.7, cooldown: 3.2, damage: 0.7, shape: { type: 'cone', radius: 2.6, angle: 1 } },
        },
      },
      wyvern: {
        name: '霜翼飛龍', region: 'ridge', groups: 1, pack: [1, 1], territory: 80, boss: true, flying: 13,
        hp: 900, damage: 22, walk: 2, run: 18, turn: 1.6, radius: 2, sight: 60, fov: 6.3, hearing: 40,
        weak: { fire: 1.5 }, resist: { ice: 0.5, wind: 0.5 },
        orbit: { radius: 15, height: 12, speed: 11 }, // 盤旋
        lakePhase: 0.5, // 血量剩一半時飛到月影湖上方
        attacks: {
          breath: { range: [6, 30], windup: 1.3, recover: 1.2, cooldown: 6, damage: 0.35, shape: { type: 'rect', length: 22, width: 4.5 }, breath: 1.2, ticks: 5 }, // 冰息：持續 breath 秒，每 1/ticks 判定一次
          gust: { range: 12, windup: 1.5, recover: 1.6, cooldown: 14, damage: 1, shape: { type: 'circle', radius: 9 }, land: true, knock: 12 }, // 降落拍翼風壓
        },
      },
    },
  },

  // 戰鬥：玩家的血量、劍與四種元素法術
  combat: {
    hp: 160,
    regen: 4, // 每秒回血（脫離戰鬥 regenDelay 秒後）
    regenDelay: 6,
    respawnSeconds: 3.5, // 倒下後多久在灰燼村醒來
    invulnerable: 0.6, // 被打中後幾秒內不再受傷
    jumpDodge: 0.22, // 公尺：震波經過時離地這麼高就躲過
    aimCone: 0.45, // 弧度：劍揮向鏡頭前方這個角度內的野怪
    sword: { damage: 13, range: 2.7, angle: 1.9, cooldown: 0.5, element: 'physical' }, // 滑鼠左鍵（或 F）
    weakDefault: 1.5,
    hazards: { web: { seconds: 14, radius: 2, slow: 0.45 }, acid: { seconds: 7, radius: 1.9, dps: 0.6 } }, // 地上的蛛網、毒池（dps 為施放者傷害的倍數）
    campfires: { count: 7, minVillage: 110, radius: 1, light: { radius: 9, power: 1.6, flicker: 0.3 } }, // 野外的火堆（狼不敢靠近）
  },

  // 法術（creatures/spells.js）：快捷鍵 1–5，每招有冷卻與魔力消耗；騎馬時也能施放（引導技「雷暴」除外）。
  // 鍵盤：火球按住蓄力、放開發射；雷暴按住選範圍、放開施放；其他按下就放。手機：右下角的技能鈕按住拖曳調方向，放開施放。
  spells: {
    mp: 100,
    mpRegen: 7, // 每秒
    aimRange: 45, // 公尺：準星的射線最遠查到哪
    lockRange: 35, // 公尺：Tab 鎖定的範圍
    fireball: {
      name: '火球術', cost: 14, cooldown: 0.7, speed: 26, range: 45, radius: 3, damage: 18,
      charge: { seconds: 1.2, cost: 14, radius: 5, damage: 2.2, size: 2.4 }, // 長按蓄力：滿蓄力時多耗的魔力、爆炸半徑、傷害倍率、火球大小
      burn: { seconds: 4, dps: 4 }, // 燃燒狀態
      groundFire: 4, // 秒：落地處燒著（狼怕、蛛網燒掉）
    },
    // 地獄業火：快速連按兩下 1（doubleTap 秒內）開始蓄力；引導技（不用一直按著）：charge 秒後自動朝準星發射，
    // 期間走得慢、不能放其他招，翻滾、上馬或倒下就中斷；騎馬時不能用。爆炸後落地處留下一片火海（fires 團火，燒 groundFire 秒）
    hellfire: {
      name: '地獄業火', cost: 80, cooldown: 0, charge: 13, doubleTap: 0.3, channel: true, moveScale: 0.35,
      speed: 16, range: 80, radius: 14, damage: 2000, knock: 16, size: 6, burn: { seconds: 8, dps: 18 }, groundFire: 15, fires: 18,
    },
    chain: { name: '連鎖雷法', cost: 20, cooldown: 2.5, range: 35, damage: 22, jumps: 4, jumpRange: 8, falloff: 0.8, wet: 2, pickCone: 0.08 }, // 打到濕的目標傷害 ×wet
    nova: { name: '冰霜新星', cost: 24, cooldown: 9, radius: 7, damage: 10, freeze: 2, eliteFreeze: 1, bossFreeze: 0.5, expand: 0.35 },
    wind: { name: '風刃', cost: 12, cooldown: 3, range: 8, angle: 1.3, damage: 9, knock: 7, interruptStun: 0.5 }, // 擊退、打斷蓄力
    storm: { name: '雷暴', cost: 50, cooldown: 60, range: 32, radius: 7, seconds: 5, bolts: 12, rainMultiplier: 2, damage: 26, boltRadius: 2.2, dim: 0.6, moveScale: 0.4, channel: true }, // 引導技：期間移動變慢、不能放其他招
    roll: { cooldown: 0.6, distance: 3.8, seconds: 0.45, invulnerable: 0.3, doubleTap: 0.28 }, // 翻滾迴避
  },

  // 開發用替身（之後由騎馬的旅人取代），用來測試移動手感與鏡頭
  player: {
    spawn: [3, 0, 12], // 灰燼村的廣場南側
    showProxy: false, // 顯示物理身體（開發用的柱子）
    heading: Math.PI, // 面向 -Z
    radius: 0.45,
    height: 1.7,
    walkSpeed: 5,
    runSpeed: 12,
    acceleration: 5, // 指數趨近速率（1/s）
    deceleration: 7,
    turnSharpness: 10,
    turnRate: 10,
    brakeTime: 0.3,
    minBrake: 6,
    // 碰撞與坡度的預設值（各組手感可以覆寫）
    capsule: 0,
    maxSlope: 1.0,
    slopeBlend: 0.08,
    slopeSample: 1.5, // 公尺：量坡度的範圍
    slopeFriction: 0.3,
    maxSlide: 2.5, // m/s：滑下坡的最快速度
    minSlide: 2, // m/s²：失去立足點時至少以這個加速度往下滑
    headOn: 0.75,
    impactSpeed: 99,
    slideSteer: 0,
  },

  camera: {
    yaw: 0,
    pitch: 0.42, // 弧度，正值為從上往下看
    minPitch: -0.3,
    maxPitch: 1.2,
    distance: 6, // 公尺：下馬時的距離；騎馬時乘上 traveler.rideDistance（滾輪縮放的比例會保留）
    minDistance: 4,
    maxDistance: 20,
    pivotHeight: 1.5,
    lookSensitivity: 0.0025, // 弧度 / 像素
    invertY: false,
    zoomSpeed: 0.0012,
    followTime: [0.12, 0.35], // 秒：彈簧阻尼跟隨的時間常數（水平、垂直；垂直慢，不跟著步伐上下搖）
    rotateSharpness: 18,
    zoomSharpness: 10,
    recenterDelay: 0.6, // 放開轉動後幾秒開始回到身後（只在移動中；回正約 2 秒）
    recenterSharpness: 1.8,
    recenterMinSpeed: 0.5,
    fov: [40, 50], // 度：靜止 → speedReference 速度時的視野
    speedReference: 13, // m/s：襲步
    speedDistance: 0.3, // 全速時鏡頭距離多拉遠的比例
    terrainStep: 0.5, // 公尺：沿鏡頭射線檢查地形的間隔
    // 風景模式（V，開發者面板關著時）：拉遠、視野較寬，鏡頭繞著目標緩慢漂移
    scenic: { distance: 28, pitch: 0.3, drift: 0.05, fov: 48 },
    aim: { shoulder: 0.75, lift: 0.15, distance: 0.55, fov: 0.8 }, // 右鍵瞄準：看向右肩外 shoulder 公尺、距離與視野乘上的倍數
    thinFoliage: true, // 角色被樹葉擋住時，擋著的樹葉字元變稀疏
    startScenic: false, // 測試用：一開始就是風景模式
    collision: true, // 鏡頭被物件擋住時拉近
    collisionPadding: 0.3,
    minHeightAboveGround: 0.4,
  },

  input: {
    pointerLock: true,
    bindings: {
      forward: ['KeyW', 'ArrowUp'],
      back: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      jump: ['Space'],
      call: ['KeyC'], // 吹口哨叫馬
      sword: ['Mouse0', 'KeyF'], // 普攻（劍）：滑鼠左鍵
      fireball: ['Digit1'], // 法術 1–5：火球術、連鎖雷法、冰霜新星、風刃、雷暴
      chain: ['Digit2'],
      nova: ['Digit3'],
      wind: ['Digit4'],
      storm: ['Digit5'],
      aim: ['Mouse2'], // 右鍵按住瞄準
      lock: ['Tab'], // 鎖定最近的敵人（再按換下一個）
      roll: ['ControlLeft', 'ControlRight', 'KeyQ'], // 翻滾迴避（也可以連點兩下方向鍵）
      stone: ['KeyG'], // 往準星的水面丟石頭
    },
    // 手把（標準配置）：按鍵編號 → 對應的鍵盤按鍵；lookSpeed 右搖桿推到底時每秒相當於滑鼠移動幾像素
    gamepad: {
      deadzone: 0.15,
      lookSpeed: 900,
      buttons: { 0: 'Space', 1: 'KeyQ', 2: 'KeyC', 3: 'KeyE', 4: 'Digit1', 5: 'Digit2', 6: 'Mouse2', 7: 'Mouse0', 12: 'Digit3', 13: 'Digit4', 14: 'Digit5', 15: 'Tab', 10: 'GamepadL3', 8: 'KeyO', 9: 'Backquote' }, // A 跳、B 翻滾、X 叫馬、Y 上下馬、LB／RB 火球／連鎖雷、LT 瞄準、RT 揮劍、十字鍵上／下／左 冰霜新星／風刃／雷暴、十字鍵右 鎖定、左搖桿按下 襲步
    },
    touch: {
      joystickRadius: 60, // CSS px
      deadzone: 0.12,
      sprintBeyond: 1.3, // 搖桿推超過半徑的倍數即衝刺
      lookScale: 1.6,
    },
  },

  dev: {
    toggleKey: 'Backquote',
    touchToggle: 'Touch3', // 三指點擊
    debugViewKey: 'KeyV', // 面板開啟時切換 G-buffer 檢視；面板關著時切換風景模式
    // 自動駕駛（測試用）：'' | 'walk' | 'run' | 'mount' | 'walkHorse' | 'trot' | 'canter' | 'gallop' | 'dismount'
    // 例：?set=dev.autopilot:trot（上馬後一直往前快步）
    autopilot: '',
    waterTest: false, // 測試用：每 1.5 秒在玩家前方 5 m 的水面丟一顆石頭（看漣漪）
    autopilotSwitch: 5, // 秒：uturn、brake、jumpHorse、jump 這類測試在這個時間切換動作
    nearCreature: '', // 測試用：一開始就站在某種野怪的地盤旁邊（例：?set=dev.nearCreature:wolf）
    nearDistance: 14, // 公尺
    snapshotFrames: 0, // 測試用：第幾幀把畫面（canvas）以 data URL 放進 <textarea id="snapshot">（無頭瀏覽器截圖）
    warmup: 0, // 開始前先快轉幾秒的模擬（例：?set=dev.autopilot:gallop;dev.warmup:8）
    showOnStart: false, // 網址加 ?dev=1 也可強制開啟
    refreshHz: 5,
    smoothing: 0.1,
  },

  ui: {
    hintSeconds: 9,
    desktopHint: 'WASD 移動（以鏡頭為準）· Shift 跑；騎馬時按住加速、連點兩下襲步 · 空白鍵 跳躍 · E 上馬／下馬 · C 吹口哨叫馬 · V 風景模式 · 點擊畫面鎖定滑鼠轉鏡頭（Esc 解除）並開啟音效 · 滾輪縮放 · 左鍵 揮劍 · 右鍵按住 瞄準 · 1–5 火球（按住蓄力）／連鎖雷／冰霜新星／風刃／雷暴（按住選範圍）· Tab 鎖定 · Ctrl／Q 或連點方向鍵 翻滾（地上出現紅色 ! 時快躲開）· G 丟石頭· O 換裝 · N 靜音 · ` 開發者面板',
    touchHint: '左半邊拖曳移動 · 右半邊拖曳轉視角 · 右下角技能鈕：按住拖曳調方向、放開施放 · 三指點擊開發者面板',
    bannerSeconds: 4, // 區域名稱顯示多久
    bannerDelay: 0.8, // 進入新區域多久後才顯示（避免在邊界來回閃）
    legend: [
      '中央：灰燼村（道路由此出發）',
      '北：石溪河谷、石橋 → 黑杉林',
      '西北：月影湖、小島、棧道',
      '西南：古石環（山丘上）',
      '東：河的上游、小瀑布',
      '東南與世界邊緣：霜脛山脊',
      '野怪：離村莊越遠越強，夜裡更危險',
    ],
    // 網址參數可覆寫 CONFIG，方便測試：?set=ascii.edges.enabled:false;player.spawn:[0,0,30]
  },
};

export function applyOverrides(config, spec) {
  if (!spec) return;
  for (const entry of spec.split(';')) {
    const split = entry.indexOf(':');
    const path = entry.slice(0, split);
    const raw = entry.slice(split + 1);
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, k) => obj?.[k], config);
    if (split < 0 || !target || !(last in target)) {
      console.warn(`CONFIG override ignored: ${entry}`);
      continue;
    }
    try {
      target[last] = typeof target[last] === 'string' ? raw : JSON.parse(raw);
    } catch {
      console.warn(`CONFIG override has invalid value: ${entry}`);
    }
  }
}
