// 環境音：WebAudio 即時合成，不需音檔。每一層是一種聲音，音量由玩家所在位置的區域權重混合
// （CONFIG.regions[*].audio），跨區時平滑過渡。
//   wind     風（帶通濾波的噪聲，隨風力起伏）
//   howl     山脊的呼嘯（窄頻噪聲，中心頻率緩慢飄移）
//   lapping  湖水拍岸（低通噪聲，緩慢的強弱起伏）
//   rush     溪水（較亮的帶通噪聲）；靠近瀑布時加強
//   drone    古石環的低鳴（兩個略為失諧的低頻正弦）
//   crickets 草原夜裡的蟲鳴（高頻短促的脈衝）
//   birds    林間的鳥鳴（隨機排程的短促滑音）
// 瀏覽器規定 AudioContext 要在使用者操作後才能啟動：第一次點擊或按鍵時呼叫 start()。

const LAYERS = ['wind', 'howl', 'lapping', 'rush', 'drone', 'crickets', 'birds'];

export function createAmbience(cfg, regionsCfg) {
  const regionAudio = Object.values(regionsCfg).map((r) => r.audio ?? {});
  const levels = Object.fromEntries(LAYERS.map((k) => [k, 0]));
  let ctx = null;
  let master = null;
  const gains = {};
  let muted = !cfg.enabled;
  let nextBird = 0;

  function noiseSource() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // 固定的線性同餘產生器（不用 Math.random，聲音也可重現）
    let s = 12345;
    for (let i = 0; i < data.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      data[i] = (s / 4294967296) * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  function filter(type, frequency, Q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  }

  function lfo(frequency, depth, target) {
    const o = ctx.createOscillator();
    o.frequency.value = frequency;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
  }

  function layerGain(name) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    gains[name] = g;
    return g;
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : cfg.volume;
    master.connect(ctx.destination);

    noiseSource().connect(filter('bandpass', 480, 0.6)).connect(layerGain('wind'));

    const howl = filter('bandpass', 850, 7);
    lfo(0.07, 280, howl.frequency);
    noiseSource().connect(howl).connect(layerGain('howl'));

    const lapAmp = ctx.createGain();
    lapAmp.gain.value = 0.6;
    lfo(0.35, 0.4, lapAmp.gain);
    noiseSource().connect(filter('lowpass', 520, 0.7)).connect(lapAmp).connect(layerGain('lapping'));

    noiseSource().connect(filter('highpass', 400, 0.5)).connect(filter('bandpass', 1900, 0.5)).connect(layerGain('rush'));

    const drone = layerGain('drone');
    const droneLow = filter('lowpass', 300, 0.7);
    droneLow.connect(drone);
    for (const f of [55, 82.6, 55.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(droneLow);
      o.start();
    }
    lfo(0.05, 0.25, drone.gain);

    // 蟲鳴：4.4 kHz 正弦 × 方波脈衝（每秒數次的短促顫音）
    const cricketTone = ctx.createOscillator();
    cricketTone.frequency.value = 4400;
    const cricketAmp = ctx.createGain();
    cricketAmp.gain.value = 0.5; // 0.5 ± 0.5：方波讓聲音在 0 與 1 之間切換
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 28;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulse.connect(pulseDepth).connect(cricketAmp.gain);
    const chirpGate = ctx.createGain();
    chirpGate.gain.value = 0.5;
    lfo(2.3, 0.5, chirpGate.gain);
    cricketTone.connect(cricketAmp).connect(chirpGate).connect(layerGain('crickets'));
    cricketTone.start();
    pulse.start();

    layerGain('birds');
  }

  // 一聲鳥鳴：2–4 個短促的上揚滑音
  function chirp(t) {
    const notes = 2 + Math.floor(Math.abs(Math.sin(t * 13.7)) * 3);
    for (let k = 0; k < notes; k++) {
      const start = ctx.currentTime + k * 0.14;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f0 = 2400 + ((k * 397 + Math.floor(t * 31)) % 900);
      o.frequency.setValueAtTime(f0, start);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, start + 0.09);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
      o.connect(g).connect(gains.birds);
      o.start(start);
      o.stop(start + 0.12);
    }
  }

  return {
    levels,
    get started() {
      return !!ctx;
    },
    get muted() {
      return muted;
    },

    start() {
      if (ctx || !cfg.enabled) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      build();
    },

    // 口哨（叫馬）：兩聲往上滑的口哨音
    whistle() {
      if (!ctx || muted) return;
      for (const [delay, f0, f1, len] of [
        [0, 1500, 2300, 0.22],
        [0.3, 1700, 2600, 0.38],
      ]) {
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.6);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(cfg.whistleVolume, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + len);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + len + 0.02);
      }
    },

    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : cfg.volume, ctx.currentTime, 0.1);
    },

    // weights：區域權重；wind：目前風力；waterfall：0–1，離瀑布多近
    update(time, weights, wind, waterfall) {
      for (const k of LAYERS) {
        let v = 0;
        for (let i = 0; i < regionAudio.length; i++) v += weights[i] * (regionAudio[i][k] ?? 0);
        levels[k] = v;
      }
      levels.wind *= Math.min(2, wind);
      levels.rush = Math.min(1, levels.rush + waterfall * 0.7);
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      for (const k of LAYERS) gains[k].gain.setTargetAtTime(levels[k], ctx.currentTime, cfg.fadeSeconds);
      if (levels.birds > 0.05 && time > nextBird) {
        chirp(time);
        nextBird = time + 1.2 + 4 * (1 - levels.birds) * (0.5 + 0.5 * Math.sin(time * 7.3));
      }
    },
  };
}
