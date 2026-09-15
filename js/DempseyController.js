// DempseyController.js — 캐릭터별 '스탠스' 컨트롤러 (Space 홀드). 게이지/강도/차지 공통, 스타일별 포즈·트리거가 다르다.
//  dempsey: ∞ 궤적 스웨이, 좌우 끝마다 훅 트리거
//  flicker: 히트맨 자세로 왼팔 채찍질, 반주기마다 플리커 트리거, 거리 유지
//  counter: 상체 세우고 상대를 응시, 트리거 없음 — 맞는 순간 자동 회피+카운터 (Fighter.takeHit)
//  smash:   깊게 웅크려 급속 충전, 트리거 없음 — MAX 에서 스매시
import { easeInOut } from './Punch.js';
import { STANCE_LINES } from './Specials.js';

const RATE = { dempsey: 28, flicker: 32, counter: 20, smash: 45 };
const OMEGA = { dempsey: [3.8, 11.5], flicker: [5.0, 7.0], counter: [1.6, 0.8], smash: [6, 4] };   // 뎀프시: 0.83초 → MAX 0.2초 간격 연타

export class DempseyController {
  constructor(audio, subtitles, style = 'dempsey') {
    this.audio = audio;
    this.subs = subtitles;
    this.style = style;
    this.active = false;
    this.theta = 0;
    this.omega = 0;
    this.gauge = 0;
    this.intensity = 0;
    this.blend = 0;
    this.maxSpeed = false;
    this.activeTime = 0;
    this.milestone = 0;
    this.hookTrigger = null;
    this.sway = 0;
    this.swayVel = 0;
    this.crossPulse = 0;
    this.charge = 0;
    this.chargeT = 0;
  }

  get lines() { return STANCE_LINES[this.style] || STANCE_LINES.dempsey; }
  get isRoll() { return this.style === 'dempsey'; }

  start() {
    this.active = true;
    this.activeTime = 0;
    this.theta = 0;
  }

  stop() {
    this.active = false;
  }

  consume() {
    this.stop();
    this.gauge = 0; this.maxSpeed = false; this.charge = 0; this.chargeT = 0; this.milestone = 0;
  }

  /** 기 충전 (히트/피격/블록). MAX 상태에서는 3히트마다 차지 스택 */
  addGauge(v, fromHit = false) {
    this.gauge = Math.min(100, this.gauge + v);
    if (this.maxSpeed && fromHit && this.charge < 3) {
      this.chargeHits = (this.chargeHits || 0) + 1;
      if (this.chargeHits >= 3) { this.chargeHits = 0; this.charge++; this.audio.chargeUp(this.charge); }
    }
  }

  update(dt, holding, freeze = false) {
    this.hookTrigger = null;
    this.crossPulse = Math.max(0, this.crossPulse - dt * 8);
    // 기(氣)는 때려서만 찬다 (addGauge). 스탠스 홀드 충전/감소 없음
    const targetI = this.active ? 1 : this.gauge / 100;
    this.intensity += (targetI - this.intensity) * Math.min(1, dt * (this.active ? 10 : 6));

    if (holding && !this.active) this.start();
    if (!holding && this.active) this.stop();

    if (this.active) {
      this.activeTime += dt;
      this.blend = Math.min(1, this.blend + dt / 0.28);
      const [o0, o1] = OMEGA[this.style] || OMEGA.dempsey;
      this.omega = o0 + o1 * easeInOut(this.intensity);
      const prev = this.theta;
      this.theta += this.omega * dt;
      const s = Math.sin(this.theta), ps = Math.sin(prev);
      const triggers = this.style === 'dempsey' || this.style === 'flicker';
      if (triggers && ((ps < 0 && s >= 0) || (ps > 0 && s <= 0))) {
        const dir = s >= 0 ? 1 : -1;
        if (this.style === 'dempsey') this.audio.whoosh(dir, 0.7 + this.intensity * 1.2, 0.42 + 0.62 * this.intensity, this.maxSpeed);
        this.crossPulse = 1;
      }
      if (this.style === 'dempsey' && Math.abs(ps) < 0.88 && Math.abs(s) >= 0.88) this.hookTrigger = s > 0 ? 'L' : 'R';
      if (this.style === 'flicker' && ps < 0.85 && s >= 0.85) this.hookTrigger = 'L';
      if (this.style === 'smash') this.crossPulse = Math.max(this.crossPulse, 0.3 * this.intensity);

    } else {
      this.blend = Math.max(0, this.blend - dt / 0.25);
    }
    // MAX 판정: 게이지 100 (스탠스와 무관). 밀스톤 대사는 게이지 구간마다 한 번
    if (this.milestone < 1 && this.gauge >= 33) { this.milestone = 1; this.subs.show(this.lines[1], { duration: 1.3, mid: true }); this.audio.riser(0.35, 0.25); }
    if (this.milestone < 2 && this.gauge >= 66) { this.milestone = 2; this.subs.show(this.lines[2], { duration: 1.2, mid: true }); this.audio.riser(0.45, 0.4); }
    if (!this.maxSpeed && this.gauge >= 100) { this.maxSpeed = true; this.milestone = 3; this.subs.show(this.lines[3], { duration: 2.0, strong: true }); this.audio.maxSpeedHit(); }
    this.sway = Math.sin(this.theta) * this.blend;
    this.swayVel = this.active ? Math.cos(this.theta) * this.omega * this.blend : 0;
    return this;
  }

  get ghostCount() {
    if (this.blend <= 0) return 0;
    const base = this.style === 'dempsey' ? 3 + 5 * this.intensity : this.style === 'flicker' ? 2 + 4 * this.intensity : 1 + 2 * this.intensity;
    return Math.round(base * Math.min(1, this.blend * 2));
  }
  get ghostInterval() { return this.style === 'dempsey' ? 0.045 - 0.015 * this.intensity : 0.03 + 0.02 * this.intensity; }

  applyToPose(p) {
    const b = this.blend;
    if (b <= 0) return;
    const I = this.intensity, th = this.theta;
    // MAX: 온몸이 힘으로 떨린다
    if (this.maxSpeed) { const tr = Math.sin(th * 23) * 0.03 * b; p.chestZ += tr; p.headZ += tr * 1.5; p.shLX += tr; p.shRX -= tr; p.hipsX += tr * 0.5; }
    const s = Math.sin(th), s2 = Math.sin(2 * th);
    const dip = (1 - Math.cos(2 * th)) * 0.5;
    switch (this.style) {
      case 'flicker': {
        // 히트맨: 상체 숙이고 왼팔이 채찍처럼 늘어져 흔들린다. 몸은 살짝만 스웨이. 충전될수록 더 낮게
        const amp = b * (0.6 + 0.4 * I);
        p.hipsY -= 0.12 * I * b; p.thighLX -= 0.25 * I * b; p.thighRX -= 0.25 * I * b; p.shinL += 0.45 * I * b; p.shinR += 0.45 * I * b;
        p.hipsX += 0.1 * s * amp; p.waistX += 0.35 * b; p.waistY += -0.35 * b + 0.25 * s * amp; p.waistZ += -0.15 * s * amp;
        p.headX += 0.3 * b; p.headY += 0.25 * b - 0.2 * s * amp;
        p.shLX += (0.25 - p.shLX) * b + 0.35 * s * amp; p.shLY += (-0.05 - p.shLY) * b; p.shLZ += (0.35 - p.shLZ) * b + 0.2 * Math.abs(s) * amp; p.elL += (-0.45 - p.elL) * b;
        p.shRX += -0.2 * b; p.elR += -0.15 * b;
        p.thighLX += -0.15 * b; p.shinL += 0.25 * b; p.hipsY += -0.06 * b;
        break;
      }
      case 'counter': {
        // 아웃복서: 상체 세우고 가볍게 리듬, 앞손을 살짝 내려 유인. 충전될수록 무릎 굽혀 스프링처럼
        const amp = b * (0.5 + 0.3 * I);
        p.hipsY -= 0.1 * I * b; p.thighLX -= 0.2 * I * b; p.thighRX -= 0.2 * I * b; p.shinL += 0.35 * I * b; p.shinR += 0.35 * I * b;
        p.hipsY += Math.abs(Math.sin(th * 4)) * 0.04 * I * b;
        p.hipsY += Math.abs(Math.sin(th * 2)) * 0.03 * amp - 0.03 * b; p.hipsX += 0.06 * s * amp;
        p.waistX += -0.08 * b; p.waistY += -0.3 * b + 0.12 * s * amp; p.waistZ += -0.08 * s * amp;
        p.headX += 0.05 * b; p.headY += 0.2 * b;
        p.shLX += 0.35 * b; p.elL += 0.5 * b; p.shLZ += 0.1 * b;
        p.shRX += -0.15 * b; p.elR += -0.1 * b;
        p.thighLX += -0.1 * b; p.thighRX += 0.1 * b;
        break;
      }
      case 'smash': {
        // 파워 슬러거: 깊게 웅크려 오른팔을 아래로 감고, 충전될수록 떨린다
        const tr = Math.sin(th * 9) * 0.06 * I * b;
        p.hipsY += -(0.3 + 0.15 * I) * b; p.waistX += (0.5 + 0.15 * I) * b; p.waistY += 0.55 * b; p.waistZ += -0.25 * b + tr;
        p.chestY += 0.3 * b; p.headX += 0.3 * b; p.headY += -0.5 * b; p.headZ += tr;
        p.shRX += (0.9 - p.shRX) * b; p.shRY += (-0.5 - p.shRY) * b; p.shRZ += (-0.55 - p.shRZ) * b; p.elR += (-1.9 - p.elR) * b;
        p.shLX += -0.3 * b; p.elL += -0.2 * b;
        p.thighLX += -0.6 * b; p.thighRX += -0.6 * b; p.shinL += 1.05 * b; p.shinR += 1.05 * b; p.thighLZ += 0.15 * b; p.thighRZ -= 0.15 * b;
        p.shRX += tr * 2; p.hipsX += tr;
        break;
      }
      default: {
        // 뎀프시롤 ∞
        const amp = b * (1.0 + 0.5 * I);
        const crouch = b * (0.55 + 0.3 * I);
        p.hipsX += 0.3 * s * amp; p.hipsY += -(0.2 + 0.12 * I) * b - 0.07 * dip * amp; p.hipsZ += 0.06 * b; p.hipsRotY += 0.4 * s * amp;
        p.waistX += 0.32 * b + 0.2 * dip * amp; p.waistY += 1.1 * s * amp; p.waistZ += -0.52 * s * amp;
        p.chestY += 0.5 * s * amp; p.chestZ += -0.26 * s * amp;
        p.headOffX += 0.11 * s * amp; p.headOffY += 0.07 * s2 * amp - 0.04 * dip * amp; p.headOffZ += 0.03 * dip * amp;
        p.headX += 0.28 * b; p.headY += -0.65 * s * amp; p.headZ += -0.32 * s * amp;
        const wl = Math.max(0, s), wr = Math.max(0, -s);
        p.thighLX += -0.6 * crouch - 0.22 * wl * amp; p.shinL += 1.1 * crouch + 0.38 * wl * amp;
        p.thighRX += -0.6 * crouch - 0.22 * wr * amp; p.shinR += 1.1 * crouch + 0.38 * wr * amp;
        p.thighLZ += 0.16 * b - 0.32 * s * amp; p.thighRZ += -0.16 * b - 0.32 * s * amp;
        p.shLX += -0.25 * b; p.shRX += -0.25 * b; p.elL += -0.12 * b; p.elR += -0.12 * b;
        p.shLZ += 0.5 * wl * amp; p.shLY += 0.45 * wl * amp; p.shRZ += -0.5 * wr * amp; p.shRY += -0.45 * wr * amp;
      }
    }
  }
}
