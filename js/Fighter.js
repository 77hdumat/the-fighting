// Fighter.js — 4인 난투용 통합 복서: 사람(로컬/네트워크) 또는 AI(AIBrain)가 InputState 로 조작.
// 이동/가드/블록/펀치/스탠스(캐릭터별)/고유기(U,I)/필살(L)/피격/스태거/카운터 rattle/KO, 타겟팅
import * as THREE from 'three';
import { buildBoxer, defaultPose, applyPose, copyPose, CHARACTERS } from './Rig.js';
import { DempseyController } from './DempseyController.js';
import { createPunch, applyPunchToPose, pointSegmentDist, segSegDist, easeOutCubic } from './Punch.js';
import { SPECIALS, KITS, HIDDEN_LINES } from './Specials.js';

const RING_LIMIT = 2.75;
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();

const BASE_POSES = {
  hitman: { waistX: 0.3, waistY: -0.35, headX: 0.3, headY: 0.25, shLX: 0.2, shLY: -0.05, shLZ: 0.3, elL: -0.5, shRX: -1.0, shRY: 0.45, shRZ: -0.2, elR: -2.5, thighLX: -0.45, shinL: 0.5, thighRX: 0.25, shinR: 0.35, hipsY: -0.06 },
  outboxer: { waistX: 0.05, waistY: -0.35, hipsRotY: 0.35, shLX: -1.2, shLY: -0.2, shLZ: 0.15, elL: -1.6, shRX: -0.7, shRY: 0.4, shRZ: -0.3, elR: -2.5, thighLX: -0.4, thighRX: 0.3 },
  power: { waistX: 0.2, shLX: -0.7, shRX: -0.7, shLZ: 0.4, shRZ: -0.4, elL: -2.1, elR: -2.1, thighLZ: 0.22, thighRZ: -0.22 },
  infighter: {},
};
// 필살기 키프레임 (L): 캐릭터별
const FINISHERS = {
  finisherHook: { side: null, wind: 0.55, dur: 0.34, powerBase: 1.6, powerCharge: 0.35, launch: 0, kind: null },
  chopping:     { side: 'R', wind: 0.5, dur: 0.5, powerBase: 1.9, powerCharge: 0.3, kind: 'chopping' },
  jolt:         { side: 'R', wind: 0.4, dur: 0.36, powerBase: 1.7, powerCharge: 0.3, kind: 'jolt', dash: 5.5 },
  smash:        { side: 'R', wind: 0.55, dur: 0.6, powerBase: 2.1, powerCharge: 0.35, kind: 'smash', launch: 1.1 },
  // 히든 필살기
  reels:        { side: 'L', wind: 0.35, dur: 0.4, powerBase: 1.2, powerCharge: 0.2, kind: 'reels', dash: 3.4 },        // 붙잡아 릴스 댄스
  barbell:      { side: 'R', wind: 0.62, dur: 0.6, powerBase: 2.2, powerCharge: 0.4, kind: 'barbell', launch: 1.2 },     // 바벨 내려찍기
  bike:         { side: 'R', wind: 0.5, dur: 0.52, powerBase: 2.3, powerCharge: 0.35, kind: 'bike', launch: 0.6, dash: 9.5 }, // 오토바이 돌진
};

export class Fighter {
  constructor(scene, slot, defKey, audio, subs) {
    this.slot = slot;
    this.def = CHARACTERS[defKey];
    this.defKey = defKey;
    this.kit = KITS[defKey] || KITS.ippo;
    this.name = this.def.name;
    this.rig = buildBoxer(this.def);
    scene.add(this.rig.root);
    this.audio = audio;
    this.subs = subs;
    this.isAI = false;
    this.brain = null;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.side = new THREE.Vector3(1, 0, 0);
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.time = 0; this.rtime = 0;
    this.pose = defaultPose();
    this.base = Object.assign(defaultPose(), BASE_POSES[this.def.style] || {});
    this.dempsey = new DempseyController(audio, subs, this.kit.stance);
    this.punch = null;
    this.queue = [];
    this.bufferedHook = null;
    this.finisher = null;
    this.cd = { U: 0, I: 0 };          // 고유기 쿨다운
    this.armor = 0;                     // U 반격기 슈퍼아머 남은 시간
    this.prevPos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.walkPhase = 0; this.walkAmt = 0;
    this.ropeCharge = 0; this.ropeAxis = null; this.ropeDir = 0; this.ropeCool = 0; this.boostT = 0; this.dash = new THREE.Vector3();
    this.rollT = 0;   // 뎀프시롤 필살 남은 시간
    this.guard = false;
    this.block = 0; this.blockHits = 0; this.blockHitTimer = 0;
    this.readSkill = 0;
    this.slip = 0; this.slipDir = 1;
    this.backstep = 0;
    this.react = { headX: 0, headY: 0, headZ: 0, waistX: 0, waistY: 0, waistZ: 0 };
    this.knock = new THREE.Vector3();
    this.hitCount = 0; this.hitTimer = 0;
    this.stagger = 0; this.staggerImmune = 0; this.staggerKind = 'normal';
    this.danceT = 0; this.danceVictim = false; this.dancePartner = null;   // (구) 릴스 댄스
    // 히든 필살 연출: 시전자(ultT) / 당하는 쪽(ultVictimT)
    this.ultT = 0; this.ultKind = null; this.ultTarget = null;
    this.ultVictimT = 0; this.ultVictimKind = null; this.ultDmg = 0;
    this.groggy = 0;   // 뎀프시 연타 누적 → 4 이면 그로기
    this.downT = 0; this.downDur = 2.7;   // 필살기 피격 다운 → 넘어졌다 고개 흔들며 일어남 (무적·행동불가)
    this.rattle = 0;
    this.airY = 0; this.airV = 0;      // 띄워짐 (가젤/스매시)
    this.ko = false; this.koT = 0; this.koSpin = 0; this.koAngle = 0; this.koLift = 0;
    this.combo = 0; this.comboTimer = 0;
    this.target = null;
    this.events = [];
    this.gloveL = new THREE.Vector3(); this.gloveR = new THREE.Vector3();
    this.prevGloveL = new THREE.Vector3(); this.prevGloveR = new THREE.Vector3();
    this.squash = { L: 0, R: 0 }; this.flash = 0;
    this.tell = { L: 0, R: 0 };
    this.guardT = 99;
    this.blockShock = 0; this.blockGhost = 0;
    this.headPos = new THREE.Vector3(); this.chestPos = new THREE.Vector3(); this.hipsPos = new THREE.Vector3();
    this.updateWorldPoints();
  }

  get dempseyActive() { return this.dempsey.active; }
  get stanceStyle() { return this.dempsey.style; }
  get busy() { return this.ko || this.stagger > 0 || !!this.finisher || this.airY > 0.01 || this.downT > 0 || this.danceT > 0 || this.ultT > 0 || this.ultVictimT > 0; }
  get rolling() { return this.rollT > 0; }
  get alive() { return !this.ko; }
  get isCounterWindow() { return !!this.punch && this.punch.t / this.punch.dur < 0.55; }
  get punchProgress() { return this.punch ? this.punch.t / this.punch.dur : 0; }
  get reach() { return 0.55 + 0.35 * this.def.prop.armLen; }

  hitTest(glove, radius) { return pointSegmentDist(glove, this.hipsPos, this.headPos) < radius; }
  sweptHit(prev, cur, radius, out) {
    const info = {};
    const dist = segSegDist(prev, cur, this.hipsPos, this.headPos, info);
    if (dist >= radius) return null;
    out.zone = info.t > 0.72 ? 'head' : 'body';
    out.t = info.t;
    out.point.set(info.px, info.py, info.pz);
    return out;
  }

  updateWorldPoints() {
    this.rig.root.updateMatrixWorld(true);
    this.rig.gloveL.getWorldPosition(this.gloveL);
    this.rig.gloveR.getWorldPosition(this.gloveR);
    this.rig.headMesh.getWorldPosition(this.headPos);
    this.rig.chest.getWorldPosition(this.chestPos);
    this.rig.hips.getWorldPosition(this.hipsPos);
  }

  /** 카메라에 너무 가까운(시야를 가리는) 파이터를 반투명하게 */
  setFade(a) {
    if (this._fade === a) return;
    this._fade = a;
    for (const m of this.rig.bodyMats) { m.transparent = a < 0.999; m.opacity = a; m.depthWrite = a > 0.5; }
    this.rig.outlineMat.uniforms.opacity.value = a;
    this.rig.outlineMat.transparent = a < 0.999;
  }

  updateVisualFx(rawDt) {
    for (const side of ['L', 'R']) {
      const g = side === 'L' ? this.rig.gloveL : this.rig.gloveR;
      const k = this.squash[side];
      if (k > 0) { this.squash[side] = Math.max(0, k - rawDt / 0.14); const q = Math.sin(Math.min(1, k) * Math.PI); g.scale.set(1 + 0.35 * q, 1 - 0.3 * q, 1 + 0.35 * q); }
      else g.scale.set(1, 1, 1);
      const t = this.tell[side];
      const m = g.material;
      if (t > 0) { this.tell[side] = Math.max(0, t - rawDt / 0.22); if (m.emissive) m.emissive.setRGB(t, t * 0.95, t * 0.7); }
      else if (this.guard && m.emissive) { const pulse = 0.35 + 0.15 * Math.sin(this.rtime * 12); m.emissive.setRGB(0.1 * pulse, 0.5 * pulse, 0.9 * pulse); } // 가드 중: 글러브 푸른 빛
      else if (m.emissive && (m.emissive.r > 0 || m.emissive.b > 0)) m.emissive.setRGB(0, 0, 0);
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - rawDt / 0.12);
      const e = this.flash * this.flash;
      for (const m of this.rig.bodyMats) if (m.emissive) m.emissive.setRGB(0.9 * e, 0.25 * e, 0.15 * e);
    }
  }

  // ---------- 행동 ----------
  startPunch(side, type, durOverride, powerOverride, opts = {}) {
    if (this.busy) return false;
    const cancelAt = this.dempsey.active ? 0.42 : 0.55;
    if (this.punch && this.punch.t < this.punch.dur * cancelAt) {
      if (type === 'hook') this.bufferedHook = side;
      return false;
    }
    const I = this.dempsey.intensity;
    const sm = this.def.speedMul;
    const st = this.stanceStyle;
    let dur, power;
    if (type === 'hook' && this.dempsey.active && st === 'dempsey') {
      dur = (0.36 - 0.2 * I) / sm; power = 0.65 + 0.35 * I;   // 연타: MAX 에서 0.16초
      if (this.dempsey.maxSpeed) power = 1.0 + 0.1 * this.dempsey.charge;
      power *= 1 + Math.min(0.3, this.combo * 0.05);
    } else if (type === 'flicker' && this.dempsey.active && st === 'flicker') {
      dur = (0.3 - 0.12 * I) / sm; power = 0.5 + 0.4 * I;
      if (this.dempsey.maxSpeed) power = 0.95 + 0.08 * this.dempsey.charge;
    } else if (type === 'hook') { dur = 0.32 / sm; power = 0.55 * (1 + Math.min(0.3, this.combo * 0.05)); }
    else if (type === 'flicker') { dur = 0.32 / sm; power = 0.3; }
    else { dur = 0.27 / sm; power = 0.4; }
    if (durOverride) dur = durOverride / sm;
    if (powerOverride) power = powerOverride;
    power *= this.def.powerMul;
    if (this.boostT > 0) power *= 1.3;   // 로프 반동 부스트
    this.punch = createPunch(side, type, dur, power);
    this.punch.heavy = (type === 'hook' && this.dempsey.active && st === 'dempsey') || !!opts.heavy || (type === 'hook' && this.def.style === 'power');
    if (opts.kind) { this.punch.kind = opts.kind; Object.assign(this.punch, opts); }
    if (opts.fromU) this.punch.fromU = true;
    if (opts.roll) this.punch.roll = true;
    if (opts.rollFinish) { this.punch.rollFinish = true; this.punch.staggerT = opts.staggerT || 0; }
    if (opts.staggerT && !opts.kind) this.punch.staggerT = opts.staggerT;
    if (!opts.noTell) this.tell[side] = 1;
    this.audio.swoosh(side === 'L' ? -1 : 1, power, type === 'hook');
    // 캐릭터별 펀치 효과음 (냥냥펀치 / 덤벨 / 뼈)
    const sfx = this.def.sfx;
    if (sfx === 'nyang') this.audio.nyang(0.9 + Math.random() * 0.3);
    else if (sfx === 'clang' && (type === 'hook' || opts.heavy)) this.audio.clang(0.5);
    this.events.push({ type: 'punch', punchType: type, kind: opts.kind || null });
    return true;
  }

  /** 고유기 자막: 히든 캐릭터는 한국어 전용 대사 */
  specialLine(spec, slotKey) {
    const hid = HIDDEN_LINES[this.defKey];
    if (hid) return (slotKey === 'U' && hid.u) ? `${hid.u} — ${spec.ko}!` : `${spec.ko}!`;
    return spec.name + '！';
  }

  /** 고유기 (U / I) */
  startSpecial(slotKey) {
    const kind = this.kit[slotKey];
    const spec = SPECIALS[kind];
    if (!spec || this.busy || this.cd[slotKey] > 0) return false;
    if (this.punch && this.punch.t < this.punch.dur * 0.6) return false;
    if (this.dempsey.active) { this.dempsey.stop(); }
    this.cd[slotKey] = (slotKey === 'U' && this.kit.cdU) ? this.kit.cdU : spec.cd / Math.sqrt(this.def.speedMul);
    // U 는 반격기: 시전 중 슈퍼아머(끊기지 않음), 적중 시 상대 스턴
    const isU = slotKey === 'U';
    if (isU) this.armor = (spec.dur || 0.7) / this.def.speedMul + 0.15;
    const uStag = isU ? Math.max(spec.staggerT || 0, 1.2) : (spec.staggerT || 0);
    if (spec.burst) {
      // 연타형: 큐에 쌓는다
      if (kind === 'flickerBurst') {
        this.startPunch('L', 'flicker', 0.2, 0.45, { noTell: true, staggerT: isU ? 0.9 : 0, fromU: isU });
        this.queue.push({ side: 'L', type: 'flicker', dur: 0.19, power: 0.45, noTell: true, staggerT: isU ? 0.9 : 0, fromU: isU }, { side: 'L', type: 'flicker', dur: 0.19, power: 0.5, noTell: true, staggerT: isU ? 1.2 : 0, fromU: isU });
        if (isU) this.armor = 0.75 / this.def.speedMul;
      } else {
        this.startPunch('L', 'hook', 0.26, 0.75, { heavy: true, staggerT: isU ? 0.9 : 0, fromU: isU });
        this.queue.push({ side: 'R', type: 'hook', dur: 0.25, power: 0.85, heavy: true, staggerT: isU ? 0.9 : 0, fromU: isU }, { side: 'L', type: 'hook', dur: 0.24, power: 0.95, heavy: true, staggerT: isU ? 1.2 : 0, fromU: isU });
        if (isU) this.armor = 0.9 / this.def.speedMul;
      }
      this.subs.show(this.specialLine(spec, slotKey), { duration: 0.9, mid: true });
      this.events.push({ type: 'special', kind });
      return true;
    }
    if (kind === 'dumbbellPress') this.audio.clang(0.9);
    else if (kind === 'marketerPunch') { this.audio.clang(0.3); this.audio.shutter(); }
    else if (kind === 'helmetBash') this.audio.engine(0.5);
    const ok = this.startPunch(spec.side, 'special', spec.dur, spec.power, { kind, heavy: !!spec.heavy, launch: spec.launch || 0, staggerT: uStag, zoneForce: spec.zone || null, liver: !!spec.liver, counterMul: spec.counterMul || 1, step: spec.step || 0, noTell: !!spec.quick, fromU: isU });
    if (!ok) { this.cd[slotKey] = 0; this.armor = 0; return false; }
    if (spec.backstep) this.backstep = spec.backstep;
    this.subs.show(this.specialLine(spec, slotKey), { duration: 0.9, mid: !spec.quick });
    this.events.push({ type: 'special', kind });
    return true;
  }

  startFinisher() {
    const d = this.dempsey;
    if (this.busy || !d.maxSpeed) return false;
    const fk = this.kit.finisher;
    const F = FINISHERS[fk] || FINISHERS.finisherHook;
    const charge = d.charge;
    const ULT = { reels: 3.4, barbell: 3.6, bike: 3.0 };
    if (ULT[fk]) {
      // ---- 연출형 필살 (히든 3인): 상대를 붙잡아두고 스크립트대로 진행 ----
      const tg = this.target;
      if (!tg || tg.ko || tg.downT > 0) return false;
      const dur = ULT[fk];
      this.ultT = dur; this.ultKind = fk; this.ultTarget = tg;
      this.punch = null; this.queue.length = 0; this.armor = dur;
      tg.ultVictimT = dur; tg.ultVictimKind = fk; tg.punch = null; tg.queue.length = 0; tg.stagger = 0; tg.dempsey.stop();
      tg.ultDmg = (34 + 7 * charge) * this.def.powerMul;   // 연출 동안 나눠서 들어간다
      tg.ultDmgRate = tg.ultDmg / dur;
      d.consume();
      this.audio.finisherWind(0.5);
      const line = fk === 'reels' ? '이건 문화 충격이야!' : fk === 'barbell' ? '자, 10회 3세트 간다!' : '어… 이거 무거운데—!!';
      this.subs.show(line, { duration: 1.6, strong: true });
      this.events.push({ type: 'ultStart', kind: fk, target: tg.slot, charge });
      return true;
    }
    if (fk === 'finisherHook') {
      // 뎀프시롤 필살: 3.2초 동안 ∞ 로 격하게 흔들며 상대를 추적, 좌우 훅 난타 → 마지막 강타. 게이지는 종료 시 소모
      this.rollT = 2.8; this.rollFinal = false; this.punch = null; this.queue.length = 0;
      this.audio.finisherWind(0.6);
      this.subs.show(charge >= 3 ? 'デンプシーロールッ！！！' : 'デンプシー…ロールッ！！', { duration: 1.4, strong: true });
      this.events.push({ type: 'finisherStart', charge, roll: true, kind: 'roll' });
      return true;
    }
    const side = F.side || (d.sway > 0 ? 'L' : 'R');
    this.finisher = { t: 0, wind: F.wind, charge, side, hit: false, power: (F.powerBase + F.powerCharge * charge) * this.def.powerMul, punch: null, kind: F.kind, dur: F.dur, launch: F.launch || 0, dash: F.dash || 0 };
    this.punch = null;
    d.consume();
    this.audio.finisherWind(F.wind);
    if (F.kind === 'bike') this.audio.engine(1.8);
    else if (F.kind === 'barbell') this.audio.clang(0.8);
    else if (F.kind === 'reels') this.audio.shutter();
    const line = fk === 'reels' ? '자, 같이 춤춰!' : fk === 'barbell' ? '데드리프트… 받아!' : fk === 'bike' ? '부아아앙—!!' : fk === 'chopping' ? 'チョッピングライトォッ！！' : fk === 'jolt' ? 'ジョルトブローッ！！' : fk === 'smash' ? 'スマッシュゥゥッ！！！' : (charge >= 3 ? 'うおおおおおっ！！！' : 'うおおおっ！！');
    this.subs.show(line, { duration: 1.3, strong: true });
    this.events.push({ type: 'finisherStart', charge, kind: F.kind || null });
    return true;
  }

  doBlock() { this.block = 0.42; this.punch = null; this.queue.length = 0; }
  doSlip() { this.slip = 0.38; this.slipDir = Math.random() > 0.5 ? 1 : -1; }
  doBackstep() { this.backstep = 0.32; this.block = 0; }

  // ---------- 피격 ----------
  takeHit(ev, counter = false) {
    const P = ev.power;
    if (this.downT > 0) return { dmg: 0, ignore: true };   // 다운 중 무적
    if (this.ko) {
      if (this.koT > 1.2) return { dmg: 0, ignore: true };
      const sgn = ev.side === 'L' ? 1 : -1;
      this.knock.addScaledVector(ev.dir, 1.5 + 2.5 * P * (ev.finisher ? 2 : 1));
      this.koSpin += sgn * (1.5 + 3 * P);
      this.koLift = Math.max(this.koLift, 0.25 + 0.5 * P);
      this.rattle = Math.max(this.rattle, 0.6);
      this.react.headY = sgn * 0.8;
      return { dmg: 0, downed: true, ko: true };
    }
    let dmg = ev.type === 'hook' ? 2.5 + 4.5 * P : ev.type === 'flicker' ? 2.1 + 2.6 * P : ev.type === 'special' ? 3 + 4.5 * P : 3 + 3 * P;
    if (ev.dempsey) dmg *= 1.1;
    if (ev.roll) dmg *= 0.45;   // 뎀프시롤 난타: 한 방은 가볍고 수로 민다
    if (ev.maxSpeed) dmg *= 1.2;
    if (counter || ev.counter) dmg *= 1.8 * (ev.counterMul || 1);
    if (this.stagger > 0) dmg *= (this.staggerKind === 'groggy' ? 1.3 : 1.2);
    if (this.dempsey.active && !this.dempsey.maxSpeed) dmg *= 1.2;
    this.readSkill = Math.min(0.3, this.readSkill + 0.025);

    // ---- 뎀프시롤 회피: 롤 중엔 공격도 하면서 상체를 크게 흔들어 70% 확률로 피한다 (필살기·카운터는 예외) ----
    if (this.stanceStyle === 'dempsey' && this.dempsey.active && !ev.finisher && !ev.counter && !counter) {
      if (Math.random() < (ev.fromU ? 0.1 : 0.7)) {   // U 반격기는 10% 만 회피
        this.dempsey.addGauge(3);
        return { dmg: 0, evaded: true, roll: true, ko: false };
      }
    }
    // ---- 카운터 스탠스 (미야타): 맞는 순간 몸을 빼고 즉시 카운터 ----
    if (this.stanceStyle === 'counter' && this.dempsey.active && !ev.finisher && !ev.counter && !counter && !this.punch) {
      const chance = 0.55 + 0.45 * this.dempsey.intensity;
      if (Math.random() < chance) {
        this.slip = 0.3; this.slipDir = ev.side === 'L' ? 1 : -1;
        this.dempsey.addGauge(20);
        // 카운터 졸트: 상대는 아직 팔을 뻗은 상태 → 카운터 판정 확정
        const stance = this.dempsey; stance.stop();
        this.startPunch('R', 'special', 0.3, 1.1, { kind: 'jolt', counterMul: 1.6, step: 3.5, noTell: true, forceCounter: true });
        return { dmg: 0, evaded: true, ko: false };
      }
    }
    // ---- 파워형 아머: 펀치 도중 약한 타격(위력<0.6)엔 끊기지 않는다 (데미지 80%) ----
    if (this.def.style === 'power' && this.punch && P < 0.6 && !counter && !ev.counter && !ev.finisher && !this.guard) {
      dmg *= 0.8;
      this.hp = Math.max(0, this.hp - dmg);
      this.react.headX = -0.1;
      this.hitCount++;
      if (this.hp <= 0) this._die();
      return { dmg, armored: true, staggered: false, ko: this.ko };
    }
    // ---- 필살기 / U 반격기 슈퍼아머: 끊기지 않고 스턴도 안 걸린다 ----
    if (this.finisher || this.armor > 0) {
      dmg *= 0.5;
      this.hp = Math.max(0, this.hp - dmg);
      this.react.headX = -0.08;
      if (this.hp <= 0) this._die();
      return { dmg, armored: true, staggered: false, ko: this.ko };
    }
    // ---- 가드/블록: 가드 중이면 필살기·카운터 포함 모든 공격을 횟수 제한 없이 막는다 (무피해) ----
    if (this.guard) {
      // 가드로 받아낼 때마다 U 반격기 쿨타임 0.2초 감소
      this.cd.U = Math.max(0, this.cd.U - 0.2);
      // 가드 관통 미세 데미지 (칩): 원래 데미지의 4% (필살기는 8%), 최소 0.3
      dmg = Math.max(0.3, dmg * (ev.finisher ? 0.08 : 0.04));
      this.hp = Math.max(0, this.hp - dmg);
      if (this.hp <= 0) this._die();
      const heavy = ev.dempsey || ev.heavy || ev.finisher || ev.counter || counter || P >= 0.75;
      this.react.headX = -0.1 - 0.15 * P; this.react.waistX = -0.08 - 0.1 * P;
      this.knock.copy(ev.dir).multiplyScalar((0.5 + 1.2 * P) * (ev.finisher ? 1.8 : 1));
      this.block = Math.max(this.block, 0.3);
      this.blockShock = Math.max(this.blockShock, heavy ? 1 : 0.4);
      if (heavy) this.blockGhost = 0.4;
      return { dmg, blocked: true, staggered: false, ko: this.ko, heavy };
    }

    const body = ev.zone === 'body';
    dmg *= body ? 0.9 : 1.15;
    this.hp = Math.max(0, this.hp - dmg);
    const sgn = ev.side === 'L' ? 1 : -1;
    const r = this.react;
    const k = counter ? 1.7 : 1;
    if (body) {
      r.waistX = (0.55 + 0.35 * P) * k; r.headX = 0.35 * k; r.waistY = sgn * 0.25 * k;
      if (ev.type === 'hook') r.waistZ = -sgn * 0.3 * k;
      this.dempsey.gauge = Math.max(0, this.dempsey.gauge - 4 * P);
    } else if (ev.type === 'hook' || ev.type === 'special') {
      r.headY = sgn * (0.9 + 0.5 * P) * k; r.headZ = -sgn * (0.45 + 0.3 * P) * k; r.headX = -0.2 * k;
      r.waistY = sgn * (0.45 + 0.3 * P) * k; r.waistZ = -sgn * 0.2 * k; r.waistX = -0.25 * P * k;
    } else {
      r.headX = -(0.5 + 0.4 * P) * k; r.waistX = -0.3 * k; r.headY = sgn * 0.2;
    }
    this.knock.copy(ev.dir).multiplyScalar((0.5 + 1.1 * P) * (body ? 1.3 : 1) * (counter ? 2.2 : ev.finisher ? 3.5 : 1));
    this.punch = null; this.queue.length = 0; this.bufferedHook = null;

    // ---- 뎀프시 연타 그로기: 롤 훅을 연속으로 맞으면 누적, 4 스택이면 그로기(2초 무방비) ----
    let groggyNow = false;
    if (ev.dempsey && ev.type === 'hook') {
      this.groggy += 1;
      if (this.groggy >= 4 && this.staggerKind !== 'groggy') { groggyNow = true; this.groggy = 0; }
    }
    // 띄우기 (가젤 / 스매시)
    if (ev.launch) { this.airV = 2.2 + 2.5 * ev.launch; this.airY = Math.max(this.airY, 0.02); this.rattle = Math.max(this.rattle, 0.7); }
    // 리버 블로: 호흡 정지 → 주저앉음 + 게이지 대폭 감소
    if (ev.liver) { this.dempsey.gauge = Math.max(0, this.dempsey.gauge - 20); this.dempsey.charge = 0; }

    let interrupted = false;
    const d = this.dempsey;
    const st = this.stanceStyle;
    // 스탠스 중단: 뎀프시/스매시(충전형)만 강타에 끊긴다. 플리커·카운터 스탠스는 피격으로 끊기지 않는다
    // 스매시 차지는 강타에 끊길 수 있다. 뎀프시롤은 회피 스탠스라 카운터/필살기가 아니면 안 끊기고 게이지만 조금 깎인다
    if (d.active && !d.maxSpeed && st === 'smash' && (P >= 0.75 || counter)) {
      if (d.gauge < 15 || counter) { d.stop(); d.gauge *= 0.8; interrupted = true; }
      else d.gauge = Math.max(0, d.gauge - 6);
    } else if (d.active && st === 'dempsey' && !d.maxSpeed) {
      if (counter || ev.counter) { d.stop(); d.gauge *= 0.8; interrupted = true; }
      else d.gauge = Math.max(0, d.gauge - 4);
    }
    if (this.brain) this.brain.onHurt();

    this.hitCount++; this.hitTimer = 1.4;
    let staggered = false;
    const heavy = ev.type === 'hook' && ev.dempsey && P > 0.8;
    const forced = counter || ev.counter || heavy || ev.finisher || !!ev.staggerT || groggyNow;
    if (groggyNow) {
      this.stagger = 2.0; this.staggerKind = 'groggy'; this.staggerImmune = 3.5; this.hitCount = 0; staggered = true;
      this.rattle = Math.max(this.rattle, 0.8);
      this.audio.stagger();
      if (d.active && !d.maxSpeed) { d.stop(); d.gauge *= 0.6; interrupted = true; }
    } else if ((this.hitCount >= 5 || forced) && this.stagger <= 0 && (this.staggerImmune <= 0 || counter || ev.finisher || ev.staggerT)) {
      this.stagger = ev.staggerT || (counter || ev.finisher ? 1.6 : 1.0);
      this.staggerKind = ev.liver ? 'liver' : 'normal';
      this.staggerImmune = 4.0; this.hitCount = 0;
      staggered = true;
      this.audio.stagger();
      if (d.active && !d.maxSpeed) { d.stop(); d.gauge *= 0.7; interrupted = true; }
    } else if (this.brain && this.stagger <= 0 && Math.random() < 0.55) {
      this.brain.retaliate = 0.12 + Math.random() * 0.15;
    }
    if (counter || ev.counter || ev.finisher) this.rattle = 1; else if (P >= 0.95) this.rattle = Math.max(this.rattle, 0.55);
    if (this.hp <= 0) this._die();
    // 필살기에 맞고 살아남으면 다운: 넘어졌다가 고개를 흔들며 일어난다 (그동안 무적 + 행동 불가)
    let down = false;
    // 릴스 (채채더킴): 다운 대신 2.6초 강제 댄스 → 끝나고 쓰러짐
    if (ev.finisher && !this.ko && ev.kind === 'reels') {
      this.danceT = 2.6; this.danceVictim = true; this.dancePartner = ev.attacker;
      this.stagger = 0; this.punch = null; this.queue.length = 0; this.finisher = null; this.dempsey.stop();
      if (ev.attacker) { ev.attacker.danceT = 2.6; ev.attacker.danceVictim = false; ev.attacker.dancePartner = this; ev.attacker.punch = null; }
      this.audio.stagger();
      return { dmg, blocked: false, staggered: true, dance: true, ko: this.ko, heavy: true };
    }
    // 오토바이 (뼈석원): 쳐박히고 날아간다
    if (ev.kind === 'bike' && !this.ko) { this.knock.addScaledVector(ev.dir, 6.5); this.rattle = 1; }
    if (ev.finisher && !this.ko && ev.kind !== 'jolt') {   // 속공형(미야타 졸트)은 다운 없음
      this.downT = this.downDur; this.stagger = 0; this.punch = null; this.queue.length = 0; this.finisher = null; this.dempsey.stop();
      this.airY = 0; this.airV = 0;
      down = true;
    }
    return { dmg, staggered, interrupted, ko: this.ko, down };
  }

  _die() {
    if (this.ko) return;
    this.ko = true; this.koT = 0;
    this.dempsey.consume();
    this.finisher = null; this.punch = null;
    this.audio.ko();
  }

  pickTarget(fighters) {
    if (this.target && this.target.ko && this.target.koT < 1.2 && this.target.pos.distanceTo(this.pos) < 1.8) return;
    let best = null, bd = 1e9;
    for (const f of fighters) {
      if (f === this || f.ko) continue;
      const dd = f.pos.distanceToSquared(this.pos);
      let w = f === this.target ? dd * 0.7 : dd;
      if (this.brain) {
        // AI: 이미 다른 AI 가 노리는 상대는 덜 선호 (한 명에게 몰리지 않게), 사람은 약간 덜 선호
        const crowd = fighters.filter((o) => o !== this && o.brain && !o.ko && o.target === f).length;
        w *= 1 + 0.8 * crowd;
        if (!f.isAI) w *= 1.25;
      }
      if (w < bd) { bd = w; best = f; }
    }
    this.target = best;
  }

  // ---------- 프레임 ----------
  update(dt, rawDt, input, fighters) {
    this.time += dt; this.rtime += rawDt;
    this.prevGloveL.copy(this.gloveL); this.prevGloveR.copy(this.gloveR);
    this.events.length = 0;
    const d = this.dempsey;
    const st = this.stanceStyle;
    this.pickTarget(fighters);
    const tgt = this.target;
    if (tgt) {
      _d.subVectors(tgt.pos, this.pos); _d.y = 0;
      const dist = _d.length();
      if (dist > 1e-4) this.forward.copy(_d).divideScalar(dist);
    }
    this.side.set(this.forward.z, 0, -this.forward.x);
    const dist = tgt ? tgt.pos.distanceTo(this.pos) : 99;

    const holding = this.rollT > 0 && !!tgt;   // 뎀프시롤 필살 중에만 롤 활성 (Space 홀드 충전 없음)
    this.spaceHeld = input.isDown('Space');
    this.spaceBlocked = input.isDown('Space') && !holding ? (this.stagger > 0 ? 'stagger' : this.airY > 0.01 ? 'air' : !tgt ? 'notarget' : this.finisher ? 'finisher' : 'ko') : null;
    d.update(dt, holding, this.busy);

    // ---- 이동 ----
    this.prevPos.copy(this.pos);
    const canMove = (!this.punch || this.punch.t > this.punch.dur * 0.5) && !this.busy;
    if (canMove) {
      // 스탠스 중에도 자유 이동 (스매시 차지만 약간 느림)
      const stanceSlow = d.active ? (st === 'smash' ? 0.6 : 0.9) : 1;
      const speed = 2.5 * Math.pow(this.def.speedMul, 0.75) * stanceSlow * (this.boostT > 0 ? 1.45 : 1);
      this.pos.x += input.mx * speed * dt; this.pos.z += input.mz * speed * dt;
    }
    // (자동 전진/거리 유지 제거 — 제자리에서도 롤/스탠스 가능, 이동은 전부 WASD)
    if (this.backstep > 0) { this.backstep -= dt; this.pos.addScaledVector(this.forward, -4.2 * dt); }
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.exp(-dt * 6));
    // 띄워짐
    if (this.airY > 0 || this.airV > 0) {
      this.airV -= 14 * dt; this.airY += this.airV * dt;
      if (this.airY <= 0) { this.airY = 0; if (this.airV < -1) { this.audio.impact(0.5); } this.airV = 0; }
    }
    // ---- 로프: 밀어붙이면 로프가 늘어나며 힘을 모으고(최대 0.45초), 놓거나 다 모이면 안쪽으로 튕겨나가 부스트 ----
    this.pos.addScaledVector(this.dash, dt);
    this.dash.multiplyScalar(Math.exp(-dt * 2.8));
    if (this.ropeCool > 0) this.ropeCool -= dt;
    if (this.boostT > 0) this.boostT -= dt;
    let pushing = false;
    for (const axis of ['x', 'z']) {
      const v = this.pos[axis];
      if (Math.abs(v) <= 2.5) continue;
      const dir = Math.sign(v);
      const inputOut = (axis === 'x' ? input.mx : input.mz) * dir;
      if (inputOut > 0.3 && !this.busy && !this.ko && this.ropeCool <= 0 && (this.ropeAxis === null || this.ropeAxis === axis)) {
        pushing = true;
        this.ropeAxis = axis; this.ropeDir = dir;
        this.ropeCharge = Math.min(0.45, this.ropeCharge + dt);
        const stretch = 2.5 + 0.38 * (this.ropeCharge / 0.45);       // 로프가 늘어나는 만큼 밖으로
        this.pos[axis] = dir * Math.min(Math.abs(v), stretch);
      } else if (Math.abs(v) > RING_LIMIT) {
        // 그냥 밀려난 경우: 로프에 튕겨 절반 속도로 되돌아온다 (넉백 반사)
        this.pos[axis] = dir * RING_LIMIT;
        if (this.knock[axis] * dir > 1.0) this.knock[axis] *= -0.5;
        if (this.dash[axis] * dir > 0) this.dash[axis] = 0;
      }
    }
    if (this.ropeCharge > 0 && (!pushing || this.ropeCharge >= 0.45)) {
      const k = this.ropeCharge / 0.45;
      if (this.ropeCharge >= 0.12) {
        // 발사: 모은 만큼 세게 (스치기만 한 건 무시)
        const imp = 2.0 + 6.5 * k;
        if (this.ropeAxis === 'x') this.dash.set(-this.ropeDir * imp, 0, 0); else this.dash.set(0, 0, -this.ropeDir * imp);
        this.boostT = 0.6 + 0.8 * k;
        this.ropeCool = 1.0;
        this.events.push({ type: 'ropeLaunch', k });
        this.audio.swoosh(0, 0.6 + 0.6 * k, false);
      }
      this.ropeCharge = 0; this.ropeAxis = null;
    }
    if (!pushing && this.ropeCharge <= 0) this.ropeAxis = null;
    this.yaw = Math.atan2(this.forward.x, this.forward.z);
    // 실제 이동 속도로 보행 애니 구동 (입력·자동 전진·넉백 모두 반영)
    if (dt > 1e-4) {
      this.vel.subVectors(this.pos, this.prevPos).divideScalar(dt);
      const spd = Math.min(5, this.vel.length());
      const fwdV = this.vel.dot(this.forward), sideV = this.vel.dot(this.side);
      const moving = spd > 0.25 && !this.ko;
      this.walkAmt += ((moving ? Math.min(1, spd / 2.2) : 0) - this.walkAmt) * Math.min(1, dt * 12);
      // 보폭 주파수: 느리면 걷기(~4.5 step/s), 빠르면 달리기(~7)
      const freq = 4.5 + 2.5 * Math.min(1, spd / 3);
      this.walkPhase += freq * dt * (fwdV < -0.2 ? -1 : 1) * (moving ? 1 : 0);
      this.walkFwd = fwdV; this.walkSide = sideV;
    }

    // ---- 타이머 ----
    if (this.staggerImmune > 0) this.staggerImmune -= dt;
    if (this.block > 0) this.block -= dt;
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.hitCount = 0; }
    if (this.groggy > 0) this.groggy = Math.max(0, this.groggy - dt * 1.2);
    if (this.combo) this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    this.cd.U = Math.max(0, this.cd.U - dt); this.cd.I = Math.max(0, this.cd.I - dt);
    if (this.armor > 0) this.armor -= dt;

    // ---- 입력 ----
    const shift = input.isDown('ShiftLeft');
    const wasGuard = this.guard;
    this.guard = (shift || this.block > 0) && !d.active && !this.punch && !this.busy;
    this.guardT = this.guard ? (wasGuard ? this.guardT + dt : 0) : 99;
    this.guardHold = this.guard ? (this.guardHold || 0) + dt : 0;   // 코치용: 가드 연속 유지 시간
    const jDown = input.isDown('KeyJ'), kDown = input.isDown('KeyK');
    const jPress = input.justPressed('KeyJ'), kPress = input.justPressed('KeyK');
    const finPress = input.justPressed('KeyL');   // 필살기는 L 로만 (J+K 동시 입력 트리거 제거)
    if (this.rollT > 0) {
      // ---- 뎀프시롤 필살: 상대를 자동 추적하며 좌우 끝마다 훅 난타. 마지막 0.3초에 피니시 훅 ----
      this.rollT -= dt;
      this.armor = Math.max(this.armor, 0.1);
      if (tgt && dist > 0.9) this.pos.addScaledVector(this.forward, 2.2 * dt);
      if (d.hookTrigger && (!this.punch || this.punch.t > this.punch.dur * 0.35)) {
        const last = this.rollT < 0.35 && !this.rollFinal;
        if (last) { this.rollFinal = true; this.startPunch(d.hookTrigger, 'hook', 0.3, 1.9 * this.def.powerMul, { heavy: true, rollFinish: true, staggerT: 1.2 }); }
        else this.startPunch(d.hookTrigger, 'hook', null, 0.6 * this.def.powerMul, { roll: true });
      }
      if (this.rollT <= 0) { this.rollT = 0; this.rollFinal = false; d.consume(); this.armor = 0; }
    } else if (!this.busy && !this.ko) {
      if (finPress && d.maxSpeed) this.startFinisher();
      else if (input.justPressed('KeyU')) this.startSpecial('U');
      else if (input.justPressed('KeyI')) this.startSpecial('I');
      else {
        if (jPress) this.startPunch('L', 'straight');
        else if (kPress) this.startPunch('R', 'straight');
        else if (!this.punch && this.queue.length && this.block <= 0) {
          const q = this.queue.shift();
          this.startPunch(q.side, q.type, q.dur, q.power, q);
        }
      }
    }

    // ---- 포즈 ----
    const p = copyPose(this.base, this.pose);
    const t = this.time;
    const bob = d.active ? 0 : 1;
    p.hipsY += Math.sin(t * 3.4) * 0.018 * bob;
    p.shLX += Math.sin(t * 3.4) * 0.05 * bob; p.shRX += Math.cos(t * 3.4 + 1) * 0.05 * bob;
    p.waistZ += Math.sin(t * 1.7) * 0.04 * bob;
    if (this.walkAmt > 0.01 && !d.active) {
      // ---- 보행/달리기: 다리 교차 + 무릎 굽힘 + 골반 상하/좌우 + 상체 약간 앞으로 + 어깨 반동 ----
      const a = this.walkAmt, ph = this.walkPhase;
      const sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
      const run = Math.min(1, Math.abs(this.walkFwd || 0) / 2.5);
      const stride = 0.45 + 0.35 * run;
      p.thighLX += sw * stride * a;  p.thighRX += -sw * stride * a;
      // 뒤로 가는 다리는 무릎을 접는다
      p.shinL += Math.max(0, -sw) * (0.7 + 0.5 * run) * a;  p.shinR += Math.max(0, sw) * (0.7 + 0.5 * run) * a;
      // 옆걸음: 다리를 벌렸다 모은다
      const side = Math.max(-1, Math.min(1, (this.walkSide || 0) / 2));
      p.thighLZ += side * sw * 0.25 * a; p.thighRZ += side * sw * 0.25 * a;
      p.hipsY += (Math.abs(sw2) * 0.035 + 0.02 * run) * a;
      p.hipsX += -side * 0.03 * a + Math.sin(ph) * 0.02 * a;
      p.hipsRotY += sw * 0.12 * a;
      p.waistY += -sw * 0.1 * a;                    // 어깨 반동
      p.waistX += 0.12 * run * a;                   // 달리면 상체 앞으로
      p.shLX += sw * 0.12 * a; p.shRX += -sw * 0.12 * a;
      p.headY += -sw * 0.05 * a;
    }
    if (this.ropeCharge > 0) {
      // 로프에 등을 기대고 힘을 모은다: 상체 뒤로, 무릎 굽힘, 팔은 로프를 잡듯 벌림
      const k = this.ropeCharge / 0.45;
      p.waistX += -0.35 * k; p.hipsY -= 0.12 * k; p.headX += -0.2 * k;
      p.thighLX -= 0.35 * k; p.thighRX -= 0.35 * k; p.shinL += 0.6 * k; p.shinR += 0.6 * k;
      p.shLZ += 0.5 * k; p.shRZ -= 0.5 * k; p.shLX += 0.5 * k; p.shRX += 0.5 * k; p.elL += 0.8 * k; p.elR += 0.8 * k;
      p.hipsX += Math.sin(this.rtime * 40) * 0.02 * k;
    }
    if (this.boostT > 0.5) {
      const k = Math.min(1, (this.boostT - 0.5) / 0.6);
      p.waistX += 0.35 * k; p.headX += 0.15 * k;   // 돌진: 앞으로 숙임
    }
    if (this.blockShock > 0) {
      const k = this.blockShock, rt = this.rtime;
      p.elL -= 0.35 * k; p.elR -= 0.35 * k;
      p.shLX += (Math.sin(rt * 95) * 0.18 + 0.15) * k; p.shRX += (Math.cos(rt * 88) * 0.18 + 0.15) * k;
      p.waistX += 0.3 * k; p.hipsZ -= 0.18 * k; p.hipsY -= 0.08 * k; p.headX += 0.25 * k;
      p.waistZ += Math.sin(rt * 70) * 0.08 * k; p.headZ += Math.cos(rt * 80) * 0.1 * k;
      this.blockShock = Math.max(0, this.blockShock - dt / 0.4);
    }
    if (this.blockGhost > 0) this.blockGhost = Math.max(0, this.blockGhost - rawDt);
    if (this.guard) {
      // ---- 하이 가드(피카부): 양 글러브를 관자놀이 높이로, 팔꿈치는 몸 앞에 붙이고, 턱 당기고 어깨 움츠림 ----
      const w = this.block > 0 ? Math.min(1, this.block / 0.12) : 1;
      p.shLX += (-1.45 - p.shLX) * w; p.shRX += (-1.45 - p.shRX) * w;      // 위팔을 높이 들어
      p.elL += (-2.45 - p.elL) * w;   p.elR += (-2.45 - p.elR) * w;        // 전완은 수직으로 접어 글러브가 얼굴 앞
      p.shLY += (-0.85 - p.shLY) * w; p.shRY += (0.85 - p.shRY) * w;       // 안쪽으로 모아 얼굴을 가림
      p.shLZ += (0.12 - p.shLZ) * w;  p.shRZ += (-0.12 - p.shRZ) * w;
      p.chestY += (0 - p.chestY) * w; p.chestZ += (0 - p.chestZ) * w;
      p.headX += 0.42 * w; p.headOffY -= 0.03 * w;                         // 턱 당김 + 목 움츠림
      p.waistX += 0.3 * w; p.hipsY -= 0.08 * w;                             // 몸을 웅크림
      p.thighLX += -0.15 * w; p.thighRX += -0.15 * w; p.shinL += 0.25 * w; p.shinR += 0.25 * w;
      p.thighLZ += 0.08 * w; p.thighRZ -= 0.08 * w;                         // 스탠스 넓게
    }
    if (this.slip > 0) {
      this.slip -= dt;
      const k = Math.sin(Math.min(1, this.slip / 0.38) * Math.PI);
      p.hipsX += this.slipDir * 0.32 * k; p.waistZ += -this.slipDir * 0.5 * k; p.waistX += 0.3 * k; p.headZ += -this.slipDir * 0.3 * k; p.hipsY -= 0.1 * k;
    }
    d.applyToPose(p);

    let hitEvent = null;
    const others = fighters.filter((f) => f !== this && (!f.ko || f.koT < 1.2) && !(f.downT > 0));
    const _hit = { zone: 'head', point: new THREE.Vector3(), t: 0 };
    const tryHit = (side, radius, mk) => {
      const glove = side === 'L' ? this.gloveL : this.gloveR;
      const prev = side === 'L' ? this.prevGloveL : this.prevGloveR;
      for (const f of others) {
        _d.subVectors(f.pos, this.pos); _d.y = 0;
        if (_d.dot(this.forward) <= 0.2) continue;
        if (f.sweptHit(prev, glove, radius, _hit)) return mk(f, _hit);
      }
      return null;
    };

    // ---- 필살 ----
    if (this.finisher) {
      const f = this.finisher;
      f.t += dt;
      const sgn = f.side === 'L' ? 1 : -1;
      const spec = f.kind ? SPECIALS[f.kind] : null;
      if (f.t < f.wind) {
        const w = easeOutCubic(f.t / f.wind);
        if (spec) {
          spec.body(p, w, 0, f.side === 'L' ? -1 : 1);
          const kf = f.side === 'L' ? spec.wind : { x: spec.wind.x, y: -spec.wind.y, z: -spec.wind.z, el: spec.wind.el };
          const kx = f.side === 'L' ? 'shLX' : 'shRX', ky = f.side === 'L' ? 'shLY' : 'shRY', kz = f.side === 'L' ? 'shLZ' : 'shRZ', ke = f.side === 'L' ? 'elL' : 'elR';
          p[kx] += (kf.x - p[kx]) * w; p[ky] += (kf.y - p[ky]) * w; p[kz] += (kf.z - p[kz]) * w; p[ke] += (kf.el - p[ke]) * w;
          p.hipsY -= 0.1 * w;
        } else {
          p.hipsY -= 0.32 * w; p.hipsX += sgn * 0.3 * w;
          p.thighLX -= 0.8 * w; p.shinL += 1.4 * w; p.thighRX -= 0.8 * w; p.shinR += 1.4 * w;
          p.waistX += 0.5 * w; p.waistY += sgn * 1.1 * w; p.waistZ += -sgn * 0.6 * w;
          p.chestY += sgn * 0.5 * w; p.headY += -sgn * 1.0 * w; p.headX += 0.25 * w;
          const kx = f.side === 'L' ? 'shLX' : 'shRX', ky = f.side === 'L' ? 'shLY' : 'shRY', kz = f.side === 'L' ? 'shLZ' : 'shRZ', ke = f.side === 'L' ? 'elL' : 'elR';
          p[kx] += (0.4 - p[kx]) * w; p[ky] += (sgn * 1.3 - p[ky]) * w; p[kz] += (sgn * 1.5 - p[kz]) * w; p[ke] += (-1.6 - p[ke]) * w;
        }
      } else {
        if (!f.punch) { f.punch = createPunch(f.side, f.kind ? 'special' : 'hook', f.dur, f.power); f.punch.kind = f.kind; f.punch.heavy = true; this.audio.swoosh(sgn, 1.5, true); }
        f.punch.t += dt;
        const info = applyPunchToPose(p, f.punch);
        const lunge = info.strike;
        if (!spec) { p.chestY += -sgn * 0.6 * lunge; p.waistY += -sgn * 0.5 * lunge; p.waistX += 0.25 * lunge; p.hipsZ += 0.3 * lunge; p.hipsY -= 0.12 * lunge; }
        if (info.p < 0.5 && dist > 0.95) this.pos.addScaledVector(this.forward, (f.dash || 4.5) * dt);
        if (!f.hit && info.p > 0.3 && info.p < 0.66) {
          this._applyNow(p);
          hitEvent = tryHit(f.side, 0.6, (tg, h) => { f.hit = true; return { attacker: this, target: tg, side: f.side, type: 'hook', power: f.power, pos: h.point.clone(), zone: h.zone, dir: this.forward.clone(), maxSpeed: true, finisher: true, charge: f.charge, dempsey: false, launch: f.launch, kind: f.kind }; });
        }
        if (f.punch.t >= f.punch.dur) this.finisher = null;
      }
    } else if (this.punch) {
      const pu = this.punch;
      pu.t += dt;
      const info = applyPunchToPose(p, pu);
      // 스텝인
      if (tgt && info.p < 0.5 && !d.active) {
        const reach = this.reach;
        const stepSpd = pu.step || 3.2;
        if (dist > reach) this.pos.addScaledVector(this.forward, Math.min(stepSpd, (dist - reach) * 12) * dt);
      }
      if (pu.t >= pu.dur) { this.punch = null; this.events.push({ type: 'punchEnd', hit: !!pu.hit }); }
      if (!d.active) this.bufferedHook = null;
      if (!pu.hit && info.p > (pu.kind ? 0.24 : 0.3) && info.p < 0.66) {
        this._applyNow(p);
        const radius = pu.type === 'flicker' ? (st === 'flicker' && d.active ? 0.55 : 0.48) : pu.kind ? 0.62 : 0.42;
        hitEvent = tryHit(pu.side, radius, (tg, h) => { pu.hit = true; return { attacker: this, target: tg, side: pu.side, type: pu.type, power: pu.power, pos: h.point.clone(), zone: pu.zoneForce || h.zone, dir: this.forward.clone(), maxSpeed: d.maxSpeed, dempsey: d.active, finisher: !!pu.rollFinish, roll: !!pu.roll, charge: pu.rollFinish ? d.charge : 0, heavy: !!pu.heavy, counter: !!pu.counter || !!pu.forceCounter, counterMul: pu.counterMul || 1, launch: pu.launch || 0, liver: !!pu.liver, staggerT: pu.staggerT || 0, kind: pu.kind || null, fromU: !!pu.fromU }; });
      }
    }

    // ---- 연출형 필살: 시전자 ----
    if (this.ultT > 0) {
      this.ultT -= dt;
      const tg = this.ultTarget;
      if (tg) {
        this.forward.copy(tg.pos).sub(this.pos).setY(0);
        if (this.forward.lengthSq() > 1e-4) { this.forward.normalize(); this.yaw = Math.atan2(this.forward.x, this.forward.z); this.side.set(this.forward.z, 0, -this.forward.x); }
        const want = 2.1;
        const dd = this.pos.distanceTo(tg.pos);
        if (dd < want) this.pos.addScaledVector(this.forward, -(want - dd) * dt * 3);
      }
      const k = this.ultKind;
      if (k === 'reels') {
        // 손을 하늘로 뻗어 유물을 불러내고, 폰으로 촬영하는 포즈
        p.shRX += -2.75; p.shRZ += -0.45; p.elR += -0.25; p.shLX += -1.6; p.elL += -1.5; p.shLY += -0.4;
        p.headX += -0.45; p.waistX += -0.2; p.hipsY += Math.abs(Math.sin(t * 6)) * 0.05;
      } else if (k === 'barbell') {
        // 팔짱 끼고 카운트 세기 → 마지막엔 손 내리기
        p.shLX += -0.95; p.elL += -2.35; p.shLY += -1.0; p.shRX += -0.9; p.elR += -2.35; p.shRY += 1.0;
        p.chestX += 0.12; p.headX += -0.1 + Math.sin(t * 3) * 0.06; p.hipsX += Math.sin(t * 1.6) * 0.04;
      } else if (k === 'bike') {
        // ① 웅크려 들어올림 → ② 머리 위에서 휘청 → ③ 미끄러져 놓침 → ④ 반동으로 뒤로 휘청
        const u = (3.0 - this.ultT);
        if (u < 0.55) {
          const kk = u / 0.55;
          p.shLX += -1.0 - 1.5 * kk; p.shRX += -1.0 - 1.5 * kk; p.elL += -1.2 + 0.7 * kk; p.elR += -1.2 + 0.7 * kk;
          p.hipsY += -0.35 + 0.3 * kk; p.thighLX += -0.75 + 0.6 * kk; p.thighRX += -0.75 + 0.6 * kk;
          p.shinL += 1.25 - 1.0 * kk; p.shinR += 1.25 - 1.0 * kk; p.waistX += 0.45 - 0.75 * kk; p.headX += -0.2 * kk;
        } else if (u < 1.05) {
          const wob = Math.sin(t * 13) * 0.16;
          p.shLX += -2.75; p.shRX += -2.75; p.elL += -0.4; p.elR += -0.4;
          p.waistX += -0.4 + wob * 0.5; p.waistZ += wob; p.hipsX += wob * 0.12; p.headX += -0.45;
          p.thighLX += -0.2 - wob * 0.3; p.thighRX += -0.2 + wob * 0.3; p.shinL += 0.35; p.shinR += 0.35;
        } else if (u < 1.4) {
          const kk = (u - 1.05) / 0.35;
          p.shLX += -2.7 + 0.9 * kk; p.shRX += -2.7 + 0.9 * kk; p.shLZ += 0.5 * kk; p.shRZ += -0.5 * kk;
          p.waistX += -0.3 + 0.9 * kk; p.headX += -0.3 + 0.6 * kk; p.hipsY += -0.05 * kk;
        } else {
          const kk = Math.min(1, (u - 1.4) / 0.6);
          p.shLX += -1.2 + 0.5 * kk; p.shRX += -1.2 + 0.5 * kk; p.elL += -0.9; p.elR += -0.9;
          p.waistX += 0.55 - 0.25 * kk; p.headX += 0.3 - 0.1 * kk; p.hipsY += -0.14 + 0.1 * kk;
          p.hipsX += Math.sin(t * 6) * 0.05 * (1 - kk);
        }
      }
      this.queue.length = 0;
      if (this.ultT <= 0) { this.ultT = 0; this.ultKind = null; this.ultTarget = null; this.armor = 0; }
    }
    // ---- 연출형 필살: 당하는 쪽 ----
    if (this.ultVictimT > 0) {
      this.ultVictimT -= dt;
      const k = this.ultVictimKind;
      const tick = (this.ultDmgRate || 0) * dt;
      if (tick > 0 && !this.ko) { this.hp = Math.max(0, this.hp - tick); if (this.hp <= 0) { this._die(); } }
      if (k === 'reels') {
        // 머리 감싸고 쏟아지는 유물을 맞는다
        p.shLX += -2.2; p.shRX += -2.2; p.elL += -2.2; p.elR += -2.2; p.shLZ += 0.5; p.shRZ += -0.5;
        p.headX += 0.35 + Math.sin(t * 22) * 0.12; p.waistX += 0.45; p.hipsY += -0.16 + Math.abs(Math.sin(t * 9)) * 0.05;
        this.rattle = Math.max(this.rattle, 0.5);
      } else if (k === 'barbell') {
        // 강제 스쿼트 3회 → 마지막에 깔려 주저앉음
        const u = 3.6 - this.ultVictimT;
        const sq = u < 2.45 ? Math.abs(Math.sin((u - 1.0) / 1.45 * Math.PI * 3)) : 1;
        const down = u < 2.45 ? sq : 1;
        p.hipsY += -0.55 * down; p.thighLX += -1.15 * down; p.thighRX += -1.15 * down; p.shinL += 1.9 * down; p.shinR += 1.9 * down;
        p.waistX += 0.3 * down; p.shLX += -2.6; p.shRX += -2.6; p.elL += -0.4; p.elR += -0.4; p.shLZ += 0.55; p.shRZ += -0.55;
        p.headX += -0.2 + Math.sin(t * 12) * 0.08 * down;
        if (u > 2.45) { p.headZ += Math.sin(t * 14) * 0.2; this.rattle = Math.max(this.rattle, 0.4); }
      } else if (k === 'bike') {
        const u = 3.0 - this.ultVictimT;
        if (u < 1.4) { p.shLX += -1.6; p.shRX += -1.6; p.elL += -1.8; p.elR += -1.8; p.headX += -0.3; p.waistX += -0.15 + Math.sin(t * 18) * 0.05; }
        else { p.waistX += -0.8; p.headX += -0.5; p.shLX += 0.9; p.shRX += 0.9; this.rattle = Math.max(this.rattle, 0.8); if (!this._bikeHit) { this._bikeHit = true; this.knock.addScaledVector(this.forward, -7); this.audio.stagger(); } }
      }
      this.queue.length = 0;
      if (this.ultVictimT <= 0) {
        this.ultVictimT = 0; this.ultVictimKind = null; this._bikeHit = false; this.ultDmg = 0; this.ultDmgRate = 0;
        if (!this.ko) { this.downT = this.downDur; this.rattle = 1; }
      }
    }
    // ---- 릴스 댄스 (둘 다 강제로 춤) ----
    if (this.danceT > 0) {
      this.danceT -= dt;
      const pr = this.dancePartner;
      if (pr && !this.danceVictim) {
        // 촬영자: 상대를 자기 옆에 끌어다 붙인다
        this.forward.copy(pr.pos).sub(this.pos).setY(0);
        if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, 1);
        this.forward.normalize();
        this.yaw = Math.atan2(this.forward.x, this.forward.z);
        this.side.set(this.forward.z, 0, -this.forward.x);
      } else if (pr) {
        const want = pr.pos.clone().addScaledVector(pr.forward, 0.95);
        this.pos.lerp(want, Math.min(1, dt * 8));
        this.forward.copy(pr.pos).sub(this.pos).setY(0).normalize();
        this.yaw = Math.atan2(this.forward.x, this.forward.z);
      }
      const ph = t * 9.5, sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
      p.hipsY += Math.abs(sw2) * 0.1; p.hipsX += sw * 0.1; p.hipsRotY += sw * 0.35;
      p.waistY += sw * 0.4; p.waistZ += sw2 * 0.12; p.chestY += sw * 0.2;
      p.headY += sw * 0.5; p.headZ += sw2 * 0.18; p.headX += -0.1;
      p.shLX += -1.9 + sw * 0.9; p.shRX += -1.9 - sw * 0.9;
      p.shLZ += 0.5 + sw2 * 0.2; p.shRZ += -0.5 - sw2 * 0.2;
      p.elL += -1.0 - Math.max(0, sw) * 0.6; p.elR += -1.0 - Math.max(0, -sw) * 0.6;
      p.thighLX += -0.25 + sw * 0.35; p.thighRX += -0.25 - sw * 0.35; p.shinL += Math.max(0, sw) * 0.7; p.shinR += Math.max(0, -sw) * 0.7;
      this.queue.length = 0;
      if (this.danceT <= 0) {
        this.danceT = 0; this.dancePartner = null;
        if (this.danceVictim && !this.ko) { this.downT = this.downDur; this.hp = Math.max(0, this.hp - 6); if (this.hp <= 0) this._die(); }
        this.danceVictim = false;
      }
    }
    // ---- 스태거 ----
    if (this.stagger > 0) {
      this.stagger -= dt;
      const w = Math.min(1, this.stagger / 0.4);
      if (this.staggerKind === 'groggy') {
        // 그로기: 다리 풀려 비틀거리고 팔은 축 늘어짐, 머리는 흔들흔들
        p.hipsY += -0.18 * w; p.hipsX += Math.sin(t * 3.2) * 0.14 * w; p.hipsRotY += Math.sin(t * 2.1) * 0.25 * w;
        p.waistX += 0.25 * w; p.waistZ += Math.sin(t * 2.7) * 0.32 * w; p.waistY += Math.sin(t * 1.9) * 0.3 * w;
        p.headZ += Math.sin(t * 4.5) * 0.35 * w; p.headX += -0.3 * w + Math.sin(t * 3.3) * 0.2 * w; p.headY += Math.sin(t * 2.4) * 0.4 * w;
        p.shLX += 1.0 * w; p.shRX += 1.1 * w; p.elL += 1.4 * w; p.elR += 1.5 * w; p.shLZ += 0.3 * w; p.shRZ -= 0.3 * w;
        p.thighLX += -0.35 * w + Math.sin(t * 3) * 0.15 * w; p.thighRX += -0.3 * w - Math.sin(t * 3) * 0.15 * w; p.shinL += 0.6 * w; p.shinR += 0.55 * w;
      } else if (this.staggerKind === 'liver') {
        // 리버 블로: 옆구리를 감싸고 주저앉는다
        p.hipsY += -0.42 * w; p.waistX += 0.85 * w; p.waistZ += 0.25 * w; p.headX += 0.3 * w;
        p.thighLX += -0.9 * w; p.thighRX += -0.9 * w; p.shinL += 1.5 * w; p.shinR += 1.5 * w;
        p.shLX += 0.9 * w; p.shRX += 1.1 * w; p.elL += 0.4 * w; p.elR += 0.6 * w; p.shRZ += 0.5 * w; p.shLZ -= 0.3 * w;
        p.waistX += Math.sin(t * 5) * 0.06 * w;
      } else {
        p.shLX += 0.7 * w; p.shRX += 0.9 * w; p.elL += 0.5 * w; p.elR += 0.9 * w;
        p.shLZ += 0.35 * w; p.shRZ -= 0.35 * w;
        p.waistZ += Math.sin(t * 9) * 0.28 * w; p.waistX += -0.35 * w + Math.sin(t * 6.3) * 0.1 * w;
        p.headZ += Math.sin(t * 7) * 0.3 * w; p.headX += -0.45 * w;
        p.hipsY += -0.1 * w; p.hipsX += Math.sin(t * 4.5) * 0.08 * w;
        p.thighLX += -0.3 * w; p.shinL += 0.5 * w; p.thighRX += -0.3 * w; p.shinR += 0.5 * w;
      }
      this.queue.length = 0;
    }
    // 공중: 몸이 젖혀지고 팔다리가 벌어진다
    if (this.airY > 0.01) {
      const a = Math.min(1, this.airY * 2.5);
      p.waistX += -0.5 * a; p.headX += -0.4 * a; p.shLX += 0.8 * a; p.shRX += 0.8 * a; p.shLZ += 0.5 * a; p.shRZ -= 0.5 * a;
      p.thighLX += -0.4 * a; p.thighRX += 0.3 * a; p.shinL += 0.6 * a;
    }

    const r = this.react;
    p.headX += r.headX; p.headY += r.headY; p.headZ += r.headZ;
    p.waistX += r.waistX; p.waistY += r.waistY; p.waistZ += r.waistZ; p.chestY += r.waistY * 0.5;
    const decay = Math.exp(-dt * 6.5);
    r.headX *= decay; r.headY *= decay; r.headZ *= decay; r.waistX *= decay; r.waistY *= decay; r.waistZ *= decay;
    if (this.rattle > 0) {
      const n = this.rattle, rt = this.rtime, a = n * (0.6 + 0.4 * n);
      p.headY += (Math.sin(rt * 61) * 0.55 + Math.sin(rt * 97) * 0.28) * a;
      p.headZ += (Math.cos(rt * 73) * 0.42 + Math.sin(rt * 113) * 0.18) * a;
      p.headX += Math.sin(rt * 53) * 0.2 * a;
      p.headOffX += Math.sin(rt * 83) * 0.05 * a;
      p.chestY += Math.sin(rt * 47) * 0.12 * a; p.chestZ += Math.cos(rt * 41) * 0.08 * a;
      p.shLX += Math.sin(rt * 66) * 0.15 * a; p.shRX += Math.cos(rt * 71) * 0.15 * a;
      this.rattle = Math.max(0, this.rattle - rawDt / 1.6);
    }

    if (this.downT > 0 && !this.ko) {
      // ---- 다운 → 기상: 0~0.55 넘어짐, 0.55~1.1 누워 있음, 1.1~2.7 고개 흔들며 일어남 ----
      this.downT -= dt;
      const u = this.downDur - this.downT;
      let lie;                       // 0 = 서 있음, 1 = 완전히 누움
      if (u < 0.55) lie = Math.pow(u / 0.55, 2);
      else if (u < 1.1) lie = 1;
      else lie = 1 - easeOutCubic(Math.min(1, (u - 1.1) / 1.6));
      this.rig.root.rotation.x = -lie * Math.PI * 0.5;
      const rise = 1 - lie;
      // 일어나는 동안 무릎 짚고 웅크림 + 고개 좌우로 흔들기
      p.hipsY += -0.35 * lie * rise * 2 - 0.05 * lie;
      p.waistX += 0.6 * (1 - Math.abs(lie - 0.5) * 2);
      p.thighLX += -0.9 * (1 - Math.abs(lie - 0.5) * 2); p.thighRX += -0.6 * (1 - Math.abs(lie - 0.5) * 2); p.shinL += 1.4 * (1 - Math.abs(lie - 0.5) * 2); p.shinR += 1.0 * (1 - Math.abs(lie - 0.5) * 2);
      if (u >= 1.1) { const sh = Math.sin((u - 1.1) * 9); p.headY += sh * 0.55; p.headZ += Math.cos((u - 1.1) * 9) * 0.15; p.headX += -0.1; }
      else { p.shLX = -0.4 + lie * 1.2; p.shRX = -0.4 + lie * 1.2; p.elL = -0.5; p.elR = -0.5; p.shLZ = 0.6 * lie; p.shRZ = -0.6 * lie; p.headX = -0.4 * lie; }
      p.hipsY += this.koLift * 0.6; this.koLift = Math.max(0, this.koLift - dt * 1.6);
      if (this.downT <= 0) { this.downT = 0; this.rig.root.rotation.x = 0; this.staggerImmune = 2.5; this.hitCount = 0; this.groggy = 0; }
    } else if (this.ko) {
      this.koT += dt;
      const k = Math.min(1, this.koT / 0.75), e = k * k;
      this.rig.root.rotation.x = -e * Math.PI * 0.5;
      this.koAngle += this.koSpin * dt; this.koSpin *= Math.exp(-dt * 3);
      this.koLift = Math.max(0, this.koLift - dt * 1.6);
      p.hipsY += this.koLift * 0.6;
      this.knock.multiplyScalar(Math.exp(-dt * 3));
      p.shLX = -0.4 + e * 1.3; p.shRX = -0.4 + e * 1.3; p.elL = -0.5; p.elR = -0.5;
      p.shLZ = 0.6; p.shRZ = -0.6; p.headX = -0.4; p.waistX = 0; p.thighLX = -0.2; p.thighRX = -0.2; p.shinL = 0.5; p.shinR = 0.4;
    } else { this.rig.root.rotation.x = 0; this.koAngle = 0; }

    this._applyNow(p);
    if (hitEvent) { this.combo++; this.comboTimer = 1.4; }
    return hitEvent;
  }

  _applyNow(p) {
    this.rig.root.position.set(this.pos.x, this.airY, this.pos.z);
    this.rig.root.rotation.y = this.yaw + this.koAngle;
    applyPose(this.rig, p);
    this.updateWorldPoints();
  }

  // ---------- 네트워크 ----------
  snapshot() {
    const d = this.dempsey;
    let flags = 0;
    if (this.ko) flags |= 1; if (d.active) flags |= 2; if (d.maxSpeed) flags |= 4; if (this.guard) flags |= 8;
    if (this.stagger > 0) flags |= 16; if (this.finisher) flags |= 32; if (this.boostT > 0) flags |= 64; if (this.ropeCharge > 0) flags |= 128; if (this.downT > 0) flags |= 256;
    const po = new Array(29);
    let i = 0; for (const k in this.pose) po[i++] = +this.pose[k].toFixed(3);
    return {
      x: +this.pos.x.toFixed(3), z: +this.pos.z.toFixed(3), y: +(this.yaw + this.koAngle).toFixed(3), rx: +this.rig.root.rotation.x.toFixed(3), ay: +this.airY.toFixed(3),
      hp: +this.hp.toFixed(1), f: flags, dI: +d.intensity.toFixed(3), sw: +d.sway.toFixed(3), sv: +d.swayVel.toFixed(2),
      bl: +d.blend.toFixed(2), ga: +d.gauge.toFixed(1), ch: d.charge, ra: +this.rattle.toFixed(2),
      ps: this.punch ? (this.punch.side === 'L' ? 1 : 2) : 0, pp: +this.punchProgress.toFixed(2),
      tg: this.target ? this.target.slot : -1, cb: this.combo, cu: +this.cd.U.toFixed(1), ci: +this.cd.I.toFixed(1), po,
    };
  }

  applySnapshot(a, b, t) {
    const L = (u, v) => u + (v - u) * t;
    this.koAngle = 0;
    this.pos.set(L(a.x, b.x), 0, L(a.z, b.z));
    this.airY = L(a.ay || 0, b.ay || 0);
    let dy = b.y - a.y; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.y + dy * t;
    this.rig.root.rotation.x = L(a.rx, b.rx);
    this.hp = L(a.hp, b.hp);
    const f = b.f;
    this.ko = !!(f & 1); this.guard = !!(f & 8); this.stagger = (f & 16) ? 1 : 0;
    this.finisher = (f & 32) ? { t: 0 } : null;
    this.boostT = (f & 64) ? 1 : 0; this.ropeCharge = (f & 128) ? 0.3 : 0; this.downT = (f & 256) ? 1 : 0;
    const d = this.dempsey;
    d.active = !!(f & 2); d.maxSpeed = !!(f & 4); d.intensity = L(a.dI, b.dI); d.sway = L(a.sw, b.sw); d.swayVel = L(a.sv, b.sv);
    d.blend = L(a.bl, b.bl); d.gauge = L(a.ga, b.ga); d.charge = b.ch;
    this.rattle = L(a.ra, b.ra);
    this.punch = b.ps ? { side: b.ps === 1 ? 'L' : 'R', t: L(a.pp, b.pp), dur: 1 } : null;
    this.targetSlot = b.tg; this.combo = b.cb; this.cd.U = b.cu || 0; this.cd.I = b.ci || 0;
    let i = 0; for (const k in this.pose) { this.pose[k] = L(a.po[i], b.po[i]); i++; }
    this._applyNow(this.pose);
  }
}
