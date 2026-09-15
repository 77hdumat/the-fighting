// AudioManager.js — Web Audio API 절차적 효과음 + 타격음 샘플
// whoosh(스웨이 동기, 패닝/피치), swoosh(펀치), impact(적중), bassHit(강타), riser, maxSpeed, stagger, ko, block
//
// 타격음과 라운드 공만 외부 mp3 샘플을 쓴다 (assets/sfx/). 나머지는 전부 합성음이다.
// 샘플 로드에 실패하면(file:// 로 열었거나 오프라인) 기존 합성음으로 자동 대체된다.
// 출처: Pixabay (Universfield) — assets/sfx/CREDITS.md

const SFX_SAMPLES = {
  jab: 'punch-jab.mp3',       // 잽 · 플리커 — 가볍고 짧다
  hook: 'punch-hook.mp3',     // 훅 · 카운터 · 필살기 — 묵직하다
  follow: 'punch-follow.mp3', // 뎀프시 연타 등 후속타
  body: 'punch-body.mp3',     // 보디 · 리버
  bell: 'bell.mp3',           // 라운드 공 (시작 · 교대 출전)
  counter: 'counter.mp3',     // 반격기 적중 — 묵직한 임팩트
  crowd: 'crowd.mp3',         // 관중 앰비언스 (경기 중 루프)
  lightning: 'lightning.mp3', // 뎀프시롤 좌우 훅마다 터지는 번개
  block: 'block.mp3',         // 가드로 막았을 때
  dodge: 'dodge.mp3',         // 회피 (주먹이 허공을 가름)
  riser: 'riser.mp3',         // 뎀프시 게이지 단계 상승 · 가드 브레이크
  charge: 'charge.mp3',       // 필살기 차지
  engine: 'engine.mp3',       // 오토바이 필살 (뼈석원)
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.sfx = null;          // { jab, hook, follow, body, bell, counter, crowd } AudioBuffer — 로드 전엔 null
    this._sfxLoading = false;
    this.crowd = null;        // 재생 중인 관중 앰비언스 { g, srcs }
    this.crowdOn = false;
    this.crowdLevel = 0.18;
  }

  /** 효과음 샘플을 비동기로 받아 디코드한다. 실패해도 게임은 합성음으로 계속 돈다. */
  async _loadSamples() {
    if (this.sfx || this._sfxLoading || !this.ctx) return;
    this._sfxLoading = true;
    const out = {};
    await Promise.all(Object.entries(SFX_SAMPLES).map(async ([key, file]) => {
      try {
        const res = await fetch('assets/sfx/' + file);
        if (!res.ok) return;
        out[key] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* 합성음으로 대체된다 */ }
    }));
    if (Object.keys(out).length) this.sfx = out;
    this._sfxLoading = false;
    this._startCrowdNow();   // 로드 전에 startCrowd 가 불렸다면 여기서 시작된다
  }

  /**
   * 샘플 타격음 재생. 같은 소리가 반복되지 않도록 피치를 살짝 흔든다.
   * @returns 샘플을 실제로 재생했으면 true (false 면 호출부가 합성음으로 대체)
   */
  _playHitSample(kind, power, pan = 0) {
    const buf = this.sfx && (this.sfx[kind] || this.sfx.jab);
    if (!buf) return false;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 약한 타격일수록 살짝 높고 빠르게 → 같은 샘플이어도 세기가 구분된다
    src.playbackRate.value = (1.16 - 0.18 * Math.min(1, power)) * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = Math.min(1.5, 0.45 + 0.85 * power);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan * 0.5)); src.connect(g); g.connect(p); p.connect(this.master); }
    else { src.connect(g); g.connect(this.master); }
    src.start(t);
    return true;
  }

  /**
   * 단발 샘플 재생 공용 헬퍼. 합성음을 샘플로 갈아끼운 메서드들이 공통으로 쓴다.
   * @returns 샘플을 재생했으면 true (false 면 호출부가 기존 합성음으로 대체)
   */
  _play(key, { gain = 1, rate = 1, jitter = 0, pan = 0 } = {}) {
    const buf = this.sfx && this.sfx[key];
    if (!this.ctx || !buf) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (jitter ? 1 - jitter / 2 + Math.random() * jitter : 1);
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = pan && ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); src.connect(g); g.connect(p); p.connect(this.master); }
    else { src.connect(g); g.connect(this.master); }
    src.start(ctx.currentTime);
    return true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.12;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // 화이트 노이즈 버퍼 2초
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 소프트 클리핑 커브 (bass hit 용)
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.2); }
    this.shaper.curve = curve;
    this.shaper.connect(this.master);

    this._loadSamples();   // 비동기 — 도착 전 타격은 합성음으로 난다
  }

  get ready() { return !!this.ctx; }

  // ---- 관중 앰비언스 ----
  // 예전엔 합성 노이즈 루프를 썼는데 정적 잡음처럼 들려 제거했었다. 지금은 실제 관중 녹음을 쓴다.
  // 6.75초짜리 한 버퍼를 재생 속도가 다른 두 겹으로 깔아 반복 주기를 귀에 안 띄게 만든다.

  /** 경기 시작 시 호출. 샘플이 아직 도착 전이면 도착하는 즉시 자동으로 시작된다. */
  startCrowd(level = 0.18) {
    if (!this.ctx) return;
    this.crowdOn = true;
    this.crowdLevel = level;
    this._startCrowdNow();
  }

  _startCrowdNow() {
    if (!this.ctx || this.crowd || !this.crowdOn) return;
    const buf = this.sfx && this.sfx.crowd;
    if (!buf) return;                       // 로드 완료 후 _loadSamples 가 다시 부른다
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.crowdLevel), t + 1.5);
    g.connect(this.master);
    // mp3 디코드 결과 앞뒤에 인코더 패딩(무음)이 붙는다 → 루프 구간을 안쪽으로 잡아 이음새 끊김을 피한다
    const margin = 0.12;
    const loopEnd = Math.max(margin + 0.5, buf.duration - margin);
    const srcs = [1.0, 0.873].map((rate, i) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.loopStart = margin;
      s.loopEnd = loopEnd;
      s.playbackRate.value = rate;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = i === 0 ? -0.35 : 0.35; s.connect(pan); pan.connect(g); }
      else s.connect(g);
      // 두 겹의 시작 위치를 어긋나게 → 같은 박수가 겹쳐 들리지 않는다
      s.start(t, margin + i * 2.6);
      return s;
    });
    this.crowd = { g, srcs };
  }

  /** 경기 중 음량 조절 (0 = 무음). 환호 버스트 cheer() 와는 별개다. */
  setCrowd(level) {
    this.crowdLevel = level;
    if (!this.crowd) return;
    const t = this.ctx.currentTime;
    this.crowd.g.gain.cancelScheduledValues(t);
    this.crowd.g.gain.setValueAtTime(Math.max(0.0001, this.crowd.g.gain.value), t);
    this.crowd.g.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), t + 0.5);
  }

  /** 경기 종료 / 메뉴 복귀 시 호출. 페이드아웃 후 정리한다. */
  stopCrowd() {
    this.crowdOn = false;
    const c = this.crowd;
    if (!c) return;
    this.crowd = null;
    const t = this.ctx.currentTime;
    c.g.gain.cancelScheduledValues(t);
    c.g.gain.setValueAtTime(Math.max(0.0001, c.g.gain.value), t);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    for (const s of c.srcs) { try { s.stop(t + 0.85); } catch { /* 이미 정지 */ } }
  }

  /** 관중 환호 버스트 */
  cheer(power = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc();
    src.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 + 0.25 * power, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 + power);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 2.5);
  }

  /** 카운터: 강타 + 귀울림(고음 사인) */
  counter() {
    if (!this.ctx) return;
    // 반격기는 전용 샘플. impact() 를 또 부르면 타격음이 겹쳐 탁해지므로 대체한다
    if (this.sfx && this.sfx.counter) {
      const ctx0 = this.ctx;
      const src = ctx0.createBufferSource();
      src.buffer = this.sfx.counter;
      const g0 = ctx0.createGain();
      g0.gain.value = 1.1;
      src.connect(g0); g0.connect(this.master);
      src.start(ctx0.currentTime);
    } else {
      this.impact(1.2, 'hook');
    }
    this.bassHit();
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(3200, t);
    o.frequency.exponentialRampToValueAtTime(2600, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.4);
    // 둔탁한 2차 울림
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(120, t + 0.05);
    o2.frequency.exponentialRampToValueAtTime(35, t + 0.6);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o2.connect(g2); g2.connect(this.shaper);
    o2.start(t + 0.05); o2.stop(t + 0.75);
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  /** 좌우 스웨이 바람소리. dir: -1..1 (이동 방향), pitch: 속도 계수 */
  whoosh(dir = 0, pitch = 1, vol = 0.5, max = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = Math.max(0.1, 0.28 / pitch);
    const src = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(260 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * pitch, t + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(420 * pitch, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-dir * 0.85, t);
    pan.pan.linearRampToValueAtTime(dir * 0.85, t + dur);
    src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
    // (제거됨) MAX SPEED 고역 휘슬 — 호루라기처럼 들려 뺐다. 바람소리만으로 속도감을 낸다.
  }

  /** 회피: 상대 주먹이 허공을 가를 때 */
  dodge(dir = 0) {
    if (this._play('dodge', { gain: 0.8, rate: 1, jitter: 0.12, pan: dir * 0.45 })) return;
    this.whoosh(dir, 1.6, 0.8, false);   // 샘플 없으면 기존 바람소리
  }

  /** 펀치 휘두름 */
  swoosh(dir = 0, power = 0.5, hook = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 0.22 + 0.08 * Math.max(0, power - 0.8);
    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(3800 + 2000 * power, t + 0.07);
    bp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6 + 0.6 * power, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(dir * 0.6, t);
    pan.pan.linearRampToValueAtTime(-dir * 0.5, t + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
    // 무게감: 짧은 저역 드롭
    const o = ctx.createOscillator();
    o.type = hook ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35 * power, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14 + 0.1 * power);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  /**
   * 적중음. 샘플이 있으면 샘플 + 저음 바디, 없으면 기존 합성음(노이즈 + 저음 바디).
   * @param kind 'jab' | 'hook' | 'follow' | 'body' — 샘플 선택용
   */
  impact(power = 0.5, kind = 'jab', pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // 저음 바디는 샘플이 있든 없든 항상 깔아 준다 — 샘플만으론 묵직함이 부족하다
    const usedSample = this._playHitSample(kind, power, pan);
    if (!usedSample) {
      const src = this._noiseSrc();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.1 + 0.4 * power, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + 0.12 * power);
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.35);
    }

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(og); og.connect(this.shaper);
    o.start(t); o.stop(t + 0.3);

    // 클릭(어택 강조)은 합성음일 때만. 샘플에는 이미 자체 어택이 있어 겹치면 탁하다
    if (!usedSample) {
      const c = ctx.createOscillator();
      c.type = 'square';
      c.frequency.value = 1800;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.15, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      c.connect(cg); cg.connect(this.master);
      c.start(t); c.stop(t + 0.02);
    }
  }

  /**
   * 뎀프시롤 훅마다 터지는 번개. 0.2초 간격으로 연타되므로 짧게 끊고 매번 피치를 흔든다.
   * @param dir -1 = 왼손, +1 = 오른손 (좌우로 갈라 쳐야 난타감이 산다)
   */
  lightning(dir = 0, power = 1) {
    const buf = this.sfx && this.sfx.lightning;
    if (!this.ctx || !buf) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.92 + Math.random() * 0.26;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.85, 0.34 + 0.34 * power);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.max(-1, Math.min(1, dir * 0.6)); src.connect(g); g.connect(pan); pan.connect(this.master); }
    else { src.connect(g); g.connect(this.master); }
    src.start(t);
  }

  /** 강타 시 추가 베이스 */
  bassHit() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.shaper);
    o.start(t); o.stop(t + 0.6);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 38;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.7, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    sub.connect(sg); sg.connect(this.master);
    sub.start(t); sub.stop(t + 0.45);
  }

  // 뎀프시롤 지속음(드론)은 제거했다.
  // '위이이잉' 하는 저음이 거슬려서, 스웨이마다 나는 바람소리(whoosh)만으로 연출한다.


  /** 상승음 (자막 마일스톤 동기) */
  riser(dur = 0.4, vol = 0.3) {
    if (!this.ctx) return;
    // 샘플은 길이가 고정이라 dur 은 무시하고 vol 만 반영한다
    if (this._play('riser', { gain: Math.min(1, vol * 2.2) })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(720, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(4000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);
  }

  /** MAX SPEED 돌입 */
  maxSpeedHit() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.riser(0.35, 0.45);
    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(300, t); hp.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.75);
    setTimeout(() => this.bassHit(), 330);
  }

  /** 차지 스택 상승음 */
  chargeUp(level = 1) {
    if (!this.ctx) return;
    if (this._play('charge', { gain: Math.min(1, 0.55 + 0.3 * level), rate: 0.95 + 0.1 * level })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    const f = 440 * Math.pow(1.5, level - 1);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  /** 필살 훅 와인드업: 저음 차지 + 상승 노이즈 */
  finisherWind(dur = 0.6) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(220, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.15);
    const src = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(400, t); hp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.4, t + dur); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    src.connect(hp); hp.connect(ng); ng.connect(this.master);
    src.start(t); src.stop(t + dur + 0.2);
  }

  /** 필살 훅 적중 */
  finisherHit() {
    if (!this.ctx) return;
    this.impact(1.5);
    this.bassHit();
    setTimeout(() => this.bassHit(), 90);
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(80, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.6);
  }

  stagger() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.6);
  }

  ko() {
    if (!this.ctx) return;
    this.impact(1);
    this.bassHit();
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(100, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.4);
  }

  /** 강타를 가드로 받아냄: 금속성 클랭 + 저역 충격 + 고역 핑 */
  guardHeavy(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9 + 0.4 * power, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.3);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og); og.connect(this.shaper); o.start(t); o.stop(t + 0.4);
    const p1 = ctx.createOscillator(); p1.type = 'sine'; p1.frequency.setValueAtTime(2600, t); p1.frequency.exponentialRampToValueAtTime(2100, t + 0.4);
    const pg = ctx.createGain(); pg.gain.setValueAtTime(0.25, t); pg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    p1.connect(pg); pg.connect(this.master); p1.start(t); p1.stop(t + 0.5);
    if (power > 0.9) this.bassHit();
  }

  /** 카운트다운 비프 */
  // 카운트다운은 합성 사각파 그대로 둔다 (샘플로 바꿔봤지만 기존 쪽이 더 낫다는 판단)
  beep(high = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 1320 : 880;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.35 : 0.15));
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }

  /** 복싱 공(종): 금속 부분음 여러 개가 길게 울린다 */
  bell(times = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // 샘플이 있으면 샘플을 쓴다. 원본 자체에 울림(테일)이 들어 있어 간격을 넉넉히 준다
    if (this.sfx && this.sfx.bell) {
      for (let n = 0; n < times; n++) {
        const src = ctx.createBufferSource();
        src.buffer = this.sfx.bell;
        const g = ctx.createGain();
        g.gain.value = 0.9;
        src.connect(g); g.connect(this.master);
        src.start(ctx.currentTime + n * 0.9);
      }
      return;
    }
    for (let n = 0; n < times; n++) {
      const t = ctx.currentTime + n * 0.55;
      const partials = [[1000, 1.0], [1520, 0.55], [2410, 0.35], [3300, 0.2], [640, 0.4]];
      for (const [f, a] of partials) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 * a + 0.4);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 2.2);
      }
      // 타격 클릭
      const src = this._noiseSrc(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp); hp.connect(ng); ng.connect(this.master); src.start(t); src.stop(t + 0.08);
    }
  }

  /** 오토바이 엔진 소음 (뼈석원 필살) */
  engine(dur = 1.6) {
    if (!this.ctx) return;
    // 샘플 길이(1.7초)에 맞춰 재생 속도로 대략 dur 을 맞춘다
    if (this._play('engine', { gain: 0.8, rate: Math.max(0.7, Math.min(1.6, 1.7 / Math.max(0.6, dur))) })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    out.gain.setValueAtTime(0.5, t + dur * 0.7);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(this.shaper);
    // 저음 톱니 2개 + 럼블 노이즈 → 배기음
    for (const [mul, det] of [[1, 0], [1.005, 9], [0.5, -7]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(58 * mul, t);
      o.frequency.linearRampToValueAtTime(190 * mul, t + dur * 0.55);
      o.frequency.linearRampToValueAtTime(120 * mul, t + dur);
      o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.32;
      // 배기 펄스 (부릉부릉)
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(11, t); lfo.frequency.linearRampToValueAtTime(28, t + dur);
      const lg = ctx.createGain(); lg.gain.value = 0.22;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(320, t); bp.frequency.linearRampToValueAtTime(900, t + dur); bp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.25;
    src.connect(bp); bp.connect(ng); ng.connect(out); src.start(t); src.stop(t + dur + 0.05);
  }

  /** 쇳덩이 충돌 (덤벨/바벨) */
  clang(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [520, 780, 1170, 1660]) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f * (0.96 + Math.random() * 0.08), t);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 * power, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55 + Math.random() * 0.3);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.95);
    }
    this.impact(0.7 * power);
  }

  /** 냥냥펀치: 짧고 귀여운 삑 소리 */
  nyang(pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(880 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(1500 * pitch, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
  }

  /** 셔터음 (릴스 촬영) */
  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp); hp.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.08);
  }

  block() {
    if (!this.ctx) return;
    // 가드는 연타 중에도 자주 울린다 → 짧은 샘플 + 매번 피치를 흔들어 뭉치지 않게
    if (this.sfx && this.sfx.block) {
      const c = this.ctx, now = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = this.sfx.block;
      s.playbackRate.value = 0.94 + Math.random() * 0.2;
      const bg = c.createGain();
      bg.gain.value = 0.75;
      s.connect(bg); bg.connect(this.master);
      s.start(now);
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }
}
