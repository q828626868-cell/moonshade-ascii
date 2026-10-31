// 馬的步態資料：四腳的落地時刻、支撐期比例、步幅，以及每個關節的角度曲線與身體的起伏曲線。
//
// 腿的曲線依 Muybridge（1878–1887）的連續攝影整理成關鍵影格，以 Hermite 樣條內插（不是正弦波）：
//   支撐期（蹄在地上）：腿由前往後擺；中段負重時球節下沉（系部趨向水平）；最後 15% 蹄跟先離地（翻蹄），球節與腕關節開始摺。
//   擺盪期：前腿——離地後腕關節迅速摺到最大（砲骨幾乎貼著前臂），前臂往前上方抬，接著腕關節伸直、
//     整條腿往前伸到最遠，落地前稍微往回收（減少落地時的衝擊）。
//   後腿——飛節在擺盪期前段就摺到最大（與後膝連動），大腿往前帶，然後飛節伸直往前伸、落地前回收。
// 每條曲線的值都是比例：limb × 擺角 A（由步幅與速度決定）、膝／飛節、球節、肘／後膝 × 各步態的摺疊幅度。
//
// 步態（依速度自動切換、平滑混合）：
//   walk   慢步 四拍：左後 → 左前 → 右後 → 右前，間隔相等，永遠有兩到三隻腳著地；頭頸隨每隻前腳落地點頭
//   trot   快步 兩拍：對角線的兩腳同時落地，兩拍之間有短暫懸空；身體上下彈跳明顯
//   canter 跑步 三拍 + 懸空：右後 → 左後與右前（對角）同時 → 左前（領先腳），之後懸空；身體前後搖晃（像搖搖馬）
//   gallop 襲步 四拍 + 懸空：右後 → 左後 → 右前 → 左前，之後四腳收在腹下懸空；身體拉長、頸部前伸

// 腿的順序：左後、左前、右後、右前
export const LEG_NAMES = ['LH', 'LF', 'RH', 'RF'];

// [時刻, limb, 膝（前：腕／後：飛節）, 球節, 肘（前）／後膝（後）]；支撐期 s 與擺盪期 w 各自 0–1
const FRONT = {
  stance: [
    [0, -1, 0, -0.05, 0],
    [0.5, 0, 0, -0.35, 0],
    [0.85, 0.75, 0.02, -0.1, 0],
  ],
  swing: [
    [0, 1, 0.15, 0.45, 0],
    [0.15, 0.75, 0.65, 0.95, 0.15],
    [0.35, 0.1, 1, 0.85, 0.35],
    [0.55, -0.7, 0.75, 0.45, 0.3],
    [0.78, -1.15, 0.1, 0.05, 0.05],
  ],
};
const HIND = {
  stance: [
    [0, -1, 0, -0.05, 0],
    [0.45, -0.05, 0.15, -0.3, 0.1],
    [0.85, 0.75, 0.1, 0, 0.05],
  ],
  swing: [
    [0, 1, 0.25, 0.55, 0.1],
    [0.18, 0.7, 0.95, 1, 0.6],
    [0.4, 0.05, 0.8, 0.75, 0.9],
    [0.62, -0.75, 0.4, 0.3, 0.6],
    [0.82, -1.1, 0.08, 0, 0.15],
  ],
};

// 每種步態：
//   nominal 代表速度（m/s）、stride 該速度時一個週期前進的距離（m）、duty 每隻腳的支撐期比例、
//   strikes 四腳的落地時刻（週期中的位置）、knee／fetlock／upper 摺疊幅度（弧度）、
//   body：起伏 bob（m）、前後傾 pitch（弧度，正 = 前低）、點頭 nod（弧度，正 = 低頭）、身體伸縮 stretch（m）、頸前伸 reach
//     每條是 [幅度, 重複次數, 關鍵影格 [[時刻, 值], ...]]
export const GAITS = {
  walk: {
    nominal: 1.7,
    stride: 1.8,
    duty: 0.62,
    strikes: [0, 0.25, 0.5, 0.75],
    knee: 0.9,
    hock: 0.6,
    fetlock: 0.6,
    upper: 0.5,
    reach: 0,
    body: {
      bob: [0.02, 2, [[0.1, -1], [0.6, 1]]],
      pitch: [0.01, 2, [[0.2, -1], [0.7, 1]]],
      nod: [0.07, 2, [[0.1, -1], [0.55, 1]]], // 每隻前腳落地（0.25、0.75）後低頭
      stretch: [0, 1, [[0, 0], [0.5, 0]]],
    },
  },
  trot: {
    nominal: 4,
    stride: 2.6,
    duty: 0.4,
    strikes: [0, 0.5, 0.5, 0], // 左後＋右前、左前＋右後
    knee: 1.35,
    hock: 0.9,
    fetlock: 0.85,
    upper: 0.8,
    reach: 0.02,
    body: {
      bob: [0.06, 2, [[0.4, -1], [0.9, 1]]], // 對角支撐的中段最低、懸空時最高
      pitch: [0.012, 2, [[0.3, -1], [0.8, 1]]],
      nod: [0.02, 2, [[0.45, 1], [0.95, -1]]],
      stretch: [0, 1, [[0, 0], [0.5, 0]]],
    },
  },
  canter: {
    nominal: 7,
    stride: 3.4,
    duty: 0.38,
    strikes: [0.28, 0.5, 0, 0.28], // 右後 → 左後＋右前 → 左前（左領先）
    knee: 1.55,
    hock: 1,
    fetlock: 1,
    upper: 0.9,
    reach: 0.08,
    body: {
      bob: [0.06, 1, [[0.45, -1], [0.94, 1]]],
      pitch: [0.075, 1, [[0.18, -1], [0.7, 1]]], // 後腳推起時前高、領先前腳負重時前低
      nod: [0.08, 1, [[0.15, -1], [0.66, 1]]],
      stretch: [0.02, 1, [[0.25, -1], [0.75, 1]]],
    },
  },
  gallop: {
    nominal: 13,
    stride: 5.9,
    duty: 0.25,
    strikes: [0.12, 0.44, 0, 0.32], // 右後 → 左後 → 右前 → 左前（左領先）
    knee: 1.8,
    hock: 1.1,
    fetlock: 1.1,
    upper: 1,
    reach: 0.2,
    body: {
      bob: [0.05, 1, [[0.3, -1], [0.85, 1]]], // 前腳支撐時最低、收腿懸空時最高
      pitch: [0.05, 1, [[0.1, -1], [0.45, 1]]],
      nod: [0.1, 1, [[0.15, -1], [0.5, 1]]],
      stretch: [0.05, 1, [[0.3, 1], [0.82, -1]]], // 前腳伸到最遠時身體拉長，懸空收腿時縮短
    },
  },
};
export const GAIT_ORDER = ['walk', 'trot', 'canter', 'gallop'];

// ---- 週期性 Hermite 樣條（關鍵影格時刻不等距；切線用前後兩點的差分）----
// keys：[[t, v0, v1, ...], ...]，t 在 [0, 1) 遞增；回傳 out[channel]
function makeCurve(keys) {
  const n = keys.length;
  const channels = keys[0].length - 1;
  const at = (i) => {
    const k = keys[((i % n) + n) % n];
    return { t: k[0] + Math.floor(i / n), v: k };
  };
  const tangents = keys.map((_, i) => {
    const a = at(i - 1);
    const b = at(i + 1);
    const dt = b.t - a.t;
    return Array.from({ length: channels }, (__, c) => (b.v[c + 1] - a.v[c + 1]) / dt);
  });
  return (t, out) => {
    t -= Math.floor(t);
    let i = -1; // 比第一個關鍵影格早：從上一個週期的最後一個開始
    for (let k = 0; k < n; k++) if (keys[k][0] <= t) i = k;
    const a = at(i);
    const b = at(i + 1);
    const span = b.t - a.t;
    const u = (t - a.t) / span;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const ta = tangents[(i + n) % n];
    const tb = tangents[(i + 1) % n];
    for (let c = 0; c < channels; c++) out[c] = h00 * a.v[c + 1] + h10 * span * ta[c] + h01 * b.v[c + 1] + h11 * span * tb[c];
    return out;
  };
}

// 把支撐期與擺盪期的關鍵影格接成一個週期（支撐期佔 duty）
function legCurve(def, duty) {
  const keys = [...def.stance.map(([s, ...v]) => [s * duty, ...v]), ...def.swing.map(([w, ...v]) => [duty + w * (1 - duty), ...v])];
  return makeCurve(keys);
}

const curves = {};
for (const [name, g] of Object.entries(GAITS)) {
  curves[name] = {
    front: legCurve(FRONT, g.duty),
    hind: legCurve(HIND, g.duty),
    body: Object.fromEntries(Object.entries(g.body).map(([k, [amp, repeat, keys]]) => [k, { amp, repeat, curve: makeCurve(keys) }])),
  };
}

const tmp = [0];
// 身體曲線：channel = bob / pitch / nod / stretch
export function bodyCurve(gait, channel, phase) {
  const b = curves[gait].body[channel];
  return b.amp * b.curve(phase * b.repeat, tmp)[0];
}

// 一隻腳在某步態、某相位的姿勢。out：{ limb, knee, fetlock, upper, stance, s }（s：支撐期內的進度 0–1）
export function legPose(gait, leg, phase, out) {
  const g = GAITS[gait];
  const front = leg % 2 === 1;
  const ph = (((phase - g.strikes[leg]) % 1) + 1) % 1; // 這隻腳自己的相位：0 = 落地
  const v = (front ? curves[gait].front : curves[gait].hind)(ph, out.v ?? (out.v = [0, 0, 0, 0]));
  out.limb = v[0];
  out.knee = v[1] * (front ? g.knee : g.hock);
  out.fetlock = v[2] * g.fetlock;
  out.upper = v[3] * g.upper;
  out.stance = ph < g.duty;
  out.s = out.stance ? ph / g.duty : (ph - g.duty) / (1 - g.duty);
  return out;
}
