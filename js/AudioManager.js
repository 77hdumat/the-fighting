// AudioManager.js — Web Audio API 절차적 효과음 (외부 음원 없음)
// whoosh(스웨이 동기, 패닝/피치), swoosh(펀치), impact(적중), bassHit(강타), drone(뎀프시 지속음), riser, maxSpeed, stagger, ko, block

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.drone = null;
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
  }

  get ready() { return !!this.ctx; }

  /** (제거됨) 상시 관중 노이즈 루프는 정적 잡음처럼 들려 사용하지 않는다. 환호는 cheer() 버스트만. */
  startCrowd() {}
  setCrowd() {}

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
    this.impact(1.2);
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
    if (max) {
      // MAX SPEED: 날카로운 고역 휘슬 추가
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(2200 * pitch, t + dur * 0.5);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(og); og.connect(pan);
      o.start(t); o.stop(t + dur);
    }
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

  /** 적중음: 노이즈 타격 + 저음 바디 + 클릭 */
  impact(power = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
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

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(og); og.connect(this.shaper);
    o.start(t); o.stop(t + 0.3);

    const c = ctx.createOscillator();
    c.type = 'square';
    c.frequency.value = 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.15, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    c.connect(cg); cg.connect(this.master);
    c.start(t); c.stop(t + 0.02);
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

  /** 뎀프시롤 지속 저음 드론 (강도에 따라 피치/밝기 상승) */
  startDrone() {
    if (!this.ctx || this.drone) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 45;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 45.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.4);
    // 트레몰로 (심장박동 느낌)
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 4;
    const lg = ctx.createGain(); lg.gain.value = 0.05;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
    o1.start(t); o2.start(t); lfo.start(t);
    this.drone = { o1, o2, lp, g, lfo };
  }

  setDrone(I, max) {
    if (!this.drone) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const d = this.drone;
    const f = 45 + 70 * I;
    d.o1.frequency.setTargetAtTime(f, t, 0.08);
    d.o2.frequency.setTargetAtTime(f * 1.015 + 0.5, t, 0.08);
    d.lp.frequency.setTargetAtTime(200 + 1600 * I + (max ? 800 : 0), t, 0.08);
    d.g.gain.setTargetAtTime(0.1 + 0.18 * I + (max ? 0.08 : 0), t, 0.1);
    d.lfo.frequency.setTargetAtTime(4 + 14 * I, t, 0.1);
  }

  stopDrone() {
    if (!this.drone) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const d = this.drone;
    d.g.gain.cancelScheduledValues(t);
    d.g.gain.setTargetAtTime(0.0001, t, 0.12);
    setTimeout(() => { try { d.o1.stop(); d.o2.stop(); d.lfo.stop(); } catch (e) {} }, 500);
    this.drone = null;
  }

  /** 상승음 (자막 마일스톤 동기) */
  riser(dur = 0.4, vol = 0.3) {
    if (!this.ctx) return;
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

  block() {
    if (!this.ctx) return;
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
