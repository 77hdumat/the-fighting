// Fighter.js — 4인 난투용 통합 복서: 사람(로컬/네트워크) 또는 AI(AIBrain)가 InputState 로 조작.
// 이동/가드/블록/펀치/스탠스(캐릭터별)/고유기(U,I)/필살(L)/피격/스태거/카운터 rattle/KO, 타겟팅
import * as THREE from 'three';
import { buildBoxer, defaultPose, applyPose, copyPose, CHARACTERS } from './Rig.js';
import { DempseyController } from './DempseyController.js';
import { createPunch, applyPunchToPose, applyAimToPose, pointSegmentDist, segSegDist, easeOutCubic } from './Punch.js';
import { SPECIALS, KITS, HIDDEN_LINES } from './Specials.js';

const RING_LIMIT = 4.15;   // 링 1.5배 확장

// 현재 경기장 (Game 이 맵을 만들 때 설정). cliff 는 로프가 없고 가장자리 밖은 낙사
let ARENA = { kind: 'ring', radius: () => RING_LIMIT };
// ---- 콤비네이션 (전 캐릭터 공통) ----
export function setArena(a) { ARENA = a || { kind: 'ring', radius: () => RING_LIMIT }; }
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
  bike:         { side: 'R', wind: 0.5, dur: 0.52, powerBase: 2.7, powerCharge: 0.4, kind: 'bike', launch: 0.7, dash: 10 }, // 오토바이 돌진
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
    this.cd = { U: 0, I: 0, S: 0 };    // 고유기 / 위빙훅 쿨다운
    this.weave = null;                  // 위빙 훅 { t, dur, hit }
    // 가드 게이지: 막는 동안 줄고, 다 떨어지면 가드가 깨져 한동안 못 올린다.
    // 무한 가드를 막아 '언제 막고 언제 뺄지'를 고르게 만드는 자원.
    this.stamMax = this.def.guardMax || 100; this.stam = this.stamMax;
    this.stamIdle = 0;                  // 가드를 뗀 뒤 회복이 시작되기까지의 유예
    this.guardBroken = 0;               // > 0 이면 가드 잠김
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
    this.fallT = 0; this.fallY = 0; this.benched = false; this.team = null;   // 낙사 / 팀전 교체 대기
    this.ultVictimT = 0; this.ultVictimKind = null; this.ultDmg = 0;
    this.groggy = 0;   // 뎀프시 연타 누적 → 4 이면 그로기
    this.downT = 0; this.downDur = 2.7;   // 필살기 피격 다운 → 넘어졌다 고개 흔들며 일어남 (무적·행동불가)
    this.rattle = 0;
    this.airY = 0; this.airV = 0;      // 띄워짐 (가젤/스매시)
    this.ko = false; this.koT = 0; this.koSpin = 0; this.koAngle = 0; this.koLift = 0;
    this.spin = 0;   // 피루엣(우랄라 사이드 스텝) 제자리 회전 각
    this.koFly = false; this.koLandT = -1;   // KO: 위로 붕 떠서 뒤로 날아가다 뒤통수부터 떨어진다
    this.combo = 0; this.comboTimer = 0;
    this.target = null;
    this.events = [];
    this.shots = []; this._shotId = 0;   // 원거리 캐릭터(우랄라)의 레이저 탄
    this.gloveL = new THREE.Vector3(); this.gloveR = new THREE.Vector3();
    this.prevGloveL = new THREE.Vector3(); this.prevGloveR = new THREE.Vector3();
    this.footL = new THREE.Vector3(); this.footR = new THREE.Vector3();
    this.prevFootL = new THREE.Vector3(); this.prevFootR = new THREE.Vector3();
    this.squash = { L: 0, R: 0 }; this.flash = 0;
    this.tell = { L: 0, R: 0 };
    this.guardT = 99;
    this.blockShock = 0; this.blockGhost = 0;
    this.headPos = new THREE.Vector3(); this.chestPos = new THREE.Vector3(); this.hipsPos = new THREE.Vector3();
    this.updateWorldPoints();
  }

  get dempseyActive() { return this.dempsey.active; }
  get stanceStyle() { return this.dempsey.style; }
  get busy() { return this.ko || this.fallT > 0 || this.stagger > 0 || !!this.finisher || !!this.weave || this.airY > 0.01 || this.downT > 0 || this.danceT > 0 || this.ultT > 0 || this.ultVictimT > 0; }
  get rolling() { return this.rollT > 0; }
  get alive() { return !this.ko; }
  get isCounterWindow() { return !!this.punch && this.punch.t / this.punch.dur < 0.55; }
  get punchProgress() { return this.punch ? this.punch.t / this.punch.dur : 0; }
  get reach() { return (0.55 + 0.35 * this.def.prop.armLen) * 0.7; }

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
    if (this.rig.footL) { this.rig.footL.getWorldPosition(this.footL); this.rig.footR.getWorldPosition(this.footR); }
    this.rig.headMesh.getWorldPosition(this.headPos);
    this.rig.chest.getWorldPosition(this.chestPos);
    this.rig.hips.getWorldPosition(this.hipsPos);
  }

  // ---------- 클라 로컬 예측 (게스트 체감 지연 감소) ----------
  /** 호스트가 실제로 받아 줄 입력인지 (클라 예측이 헛돌지 않게 같은 조건으로 검사) */
  canPredict(slotKey) {
    if (this.busy || this.benched || this.fallT > 0 || this.falling) return false;
    if (this.punch && this.punch.t < this.punch.dur * (this.dempsey.active ? 0.42 : 0.55)) return false;
    const pp = this._predPunch;
    if (pp && pp.t < pp.dur * (this.dempsey.active ? 0.42 : 0.55)) return false;   // 아직 서버 확인 전인 예측 펀치도 같은 캔슬 창을 따른다
    if (slotKey === 'U' || slotKey === 'I') return this.cd[slotKey] <= 0;
    if (slotKey === 'L') return !!this.dempsey.maxSpeed;
    return true;
  }

  /**
   * 입력이 아닌 '자동' 이동(추적·대시·돌격)을 장외로 넘어가지 않게 막는다.
   * 낙사는 밀려나서 당하는 것이지, 상대를 쫓다가 스스로 걸어 나가서 당하는 게 아니다.
   * 플레이어 입력과 넉백(knock)은 그대로 둔다.
   */
  _advance(dir, dist) {
    const nx = this.pos.x + dir.x * dist, nz = this.pos.z + dir.z * dist;
    if (ARENA.kind === 'cliff') {
      const edge = ARENA.radius(nx, nz) - 0.4;        // 발 크기만큼 여유
      if (Math.hypot(nx, nz) > edge) return;          // 그 방향으로는 더 못 간다
    }
    this.pos.x = nx; this.pos.z = nz;
  }

  /** 클라 예측용 — 호스트와 같은 규칙으로 이번 입력이 어떤 펀치가 될지 고른다 */
  predictComboKind(press) {
    // J = 왼손 스트레이트, K = 오른손 훅 (콤비네이션 없음)
    return press === 'J' ? { side: 'L', type: 'straight' } : { side: 'R', type: 'hook' };
  }

  /** 버튼을 누른 즉시 팔 동작을 그려 준다. 판정은 호스트가 하고, 서버 포즈가 오면 예측은 버린다 */
  predictPunch(side, type = 'straight') {
    if (this.ko || this.downT > 0 || this.stagger > 0 || this.ultVictimT > 0) return;
    const sm = this.def.speedMul * (type === 'special' ? 1 : (this.def.atkMul || 1));
    const dur = (type === 'hook' ? 0.32 : type === 'special' ? 0.4 : 0.27) / sm;
    this._predPunch = createPunch(side, type, dur, 0.5);
    this._predAge = 0;
    // 기본 펀치는 효과음도 즉시 낸다 (호스트가 보내는 같은 소리는 한 번 건너뛴다 — main.js onSnapshot)
    if (type !== 'special') {
      this.audio.swoosh(side === 'L' ? -1 : 1, 0.45 * this.def.powerMul, type === 'hook');
      this._predSwoosh = true;
      if (this.def.sfx === 'nyang') { this.audio.nyang(0.9 + Math.random() * 0.3); this._predNyang = true; }
    }
  }

  /** 예측 포즈를 서버 포즈 위에 덮어쓴다 (서버가 실제 펀치를 보내오면 즉시 해제) */
  applyPrediction(dt, serverPunching, guardHeld) {
    let touched = false;
    const pu = this._predPunch;
    if (pu) {
      this._predAge += dt; pu.t += dt;
      if (serverPunching) this._predPunch = null;
      else if (this._predAge > pu.dur * 1.3) { this._predPunch = null; this._predSwoosh = this._predNyang = false; }   // 호스트가 거부한 펀치 → 다음 소리는 건너뛰지 않는다
      else { if (this.def.ranged && pu.type !== 'special') applyAimToPose(this.pose, pu); else applyPunchToPose(this.pose, pu); touched = true; }
    }
    // 가드도 즉시 반영 (서버 플래그가 아직 안 왔을 때만)
    if (guardHeld && !this.guard && !this.busy) {
      const p = this.pose;
      p.shLX += -1.15; p.shRX += -1.15; p.elL += -1.75; p.elR += -1.75;
      p.shLZ += 0.42; p.shRZ += -0.42; p.headX += -0.12; p.waistX += 0.16;
      touched = true;
    }
    if (touched) this._applyNow(this.pose);
  }

  /** 카메라에 너무 가까운(시야를 가리는) 파이터를 반투명하게 */
  setFade(a) {
    if (this._fade === a) return;
    this._fade = a;
    for (const m of this.rig.bodyMats) { m.transparent = a < 0.999; m.opacity = a; m.depthWrite = a > 0.5; }
    this.rig.setOutlineOpacity(a);
  }

  updateVisualFx(rawDt) {
    const blink = ((this.rtime + this.slot * .73) % 3.9) > 3.81;
    this.rig.setExpression(this.flash > .45 || this.stagger > .12 ? 'hurt' : blink ? 'blink' : 'focused');
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
    const sm = this.def.speedMul * (this.def.atkMul || 1);   // atkMul: 기본 펀치 전용 공격속도 배수 (이동속도엔 영향 없음)
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
    if (durOverride) dur = durOverride / this.def.speedMul;   // 고유기·연출용 지속시간은 공격속도 배수를 타지 않는다
    if (powerOverride) power = powerOverride;
    power *= this.def.powerMul;
    if (this.boostT > 0) power *= 1.3;   // 로프 반동 부스트
    this.punch = createPunch(side, type, dur, power);
    this.punch.heavy = (type === 'hook' && this.dempsey.active && st === 'dempsey') || !!opts.heavy || (type === 'hook' && this.def.style === 'power');
    if (this.def.ranged && !opts.kind && (type === 'straight' || type === 'hook')) this.punch.ranged = true;   // 우랄라: 사격 (조준 자세 + 레이저 탄)
    if (opts.kind) { this.punch.kind = opts.kind; Object.assign(this.punch, opts); }
    if (opts.kick) this.punch.kick = true;
    if (opts.hitRadius) this.punch.hitRadius = opts.hitRadius;
    if (opts.fromU) this.punch.fromU = true;
    if (opts.roll) this.punch.roll = true;
    if (opts.rollFinish) { this.punch.rollFinish = true; this.punch.staggerT = opts.staggerT || 0; }
    if (opts.staggerT && !opts.kind) this.punch.staggerT = opts.staggerT;
    // 펀치도 가드 게이지를 쓴다. 막누르면 바닥나서 가드를 못 올리게 되므로, 난타에 대가가 생긴다.
    // (가드 전용 자원이면 '때리는 쪽'은 아무 위험이 없어 긴장감이 한쪽으로만 생긴다)
    this.stam = Math.max(0, this.stam - (type === 'hook' ? 5 : type === 'special' ? 7 : 3));
    this.stamIdle = 0;
    if (!opts.noTell) this.tell[side] = 1;
    this.audio.swoosh(side === 'L' ? -1 : 1, power, type === 'hook');
    // 뎀프시롤: 좌우 훅이 나갈 때마다 번개가 친다 (마무리 훅은 더 크게)
    if (opts.roll || opts.rollFinish) this.audio.lightning(side === 'L' ? -1 : 1, opts.rollFinish ? 1.5 : 0.9);
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
    if (spec.dash) {
      // 사이드 스텝 (우랄라 I): A/D 누른 쪽(없으면 번갈아)으로 0.26초 빠르게 옆 이동. 이동 중엔 모든 공격 회피 (필살기 제외)
      const sgn = this._dashSign || 1;
      this.sideDash = { t: 0, dur: spec.dur, dir: this.side.clone().multiplyScalar(sgn) };
      this.punch = null; this.queue.length = 0;
      this.audio.dodge(sgn);
      this.subs.show(this.specialLine(spec, slotKey), { duration: 0.5, mid: false });
      this.events.push({ type: 'special', kind });
      return true;
    }
    if (spec.self) {
      // 자기 버프형 (우랄라 춤추기): 1.3초 춤추며 슈퍼아머, 기 게이지 +18, 가드 게이지 회복
      this.danceT = spec.dur; this.dancePartner = null; this.danceVictim = false;
      this.armor = spec.dur + 0.1;
      this.dempsey.addGauge(spec.gauge || 15);
      this.stam = Math.min(this.stamMax, this.stam + this.stamMax * 0.5);
      this.audio.riser(0.3, 0.2);
      this.subs.show(this.specialLine(spec, slotKey), { duration: 0.9, mid: true });
      this.events.push({ type: 'special', kind });
      return true;
    }
    if (kind === 'dumbbellPress') this.audio.clang(0.9);
    else if (kind === 'marketerPunch') { this.audio.clang(0.3); this.audio.shutter(); }
    else if (kind === 'helmetBash') this.audio.engine(0.5);
    const ok = this.startPunch(spec.side, 'special', spec.dur, spec.power, { kind, heavy: !!spec.heavy, launch: spec.launch || 0, staggerT: uStag, zoneForce: spec.zone || null, liver: !!spec.liver, counterMul: spec.counterMul || 1, step: spec.step || 0, noTell: !!spec.quick, kick: !!spec.kick, hitRadius: spec.hitRadius || 0, fromU: isU });
    if (!ok) { this.cd[slotKey] = 0; this.armor = 0; return false; }
    if (spec.backstep) this.backstep = spec.backstep;
    this.subs.show(this.specialLine(spec, slotKey), { duration: 0.9, mid: !spec.quick });
    this.events.push({ type: 'special', kind });
    return true;
  }

  startFinisher() {
    const d = this.dempsey;
    if (this.busy || this.rollT > 0 || !d.maxSpeed) return false;
    // 동시 필살: 먼저 시작한 쪽이 진행되고, 상대가 필살기(연출·롤·대시) 중이면 내 입력은 무시된다 (게이지는 남는다)
    const tg0 = this.target;
    if (tg0 && (tg0.ultT > 0 || tg0.rollT > 0 || tg0.finisher || tg0.ultVictimT > 0)) return false;
    const fk = this.kit.finisher;
    const F = FINISHERS[fk] || FINISHERS.finisherHook;
    const charge = d.charge;
    const ULT = { reels: 3.4, barbell: 3.6, bike: 3.0, forge: 3.3, snackRain: 3.6, coldCut: 3.4, cafeRush: 3.2, coffeeBarrage: 3.6, danceTime: 3.6 };
    if (fk === 'cafeRush') {
      // ---- 카페 돌격: 경로상의 모두에게 스턴 + 데미지 (넘어뜨리진 않는다) ----
      this.ultT = 3.2; this.ultKind = fk; this.ultTarget = this.target;
      this.punch = null; this.queue.length = 0; this.armor = 3.2;
      this.rushHits = new Map();          // slot → 다음 타격 시각 (0.1초 도트)
      this.rushPower = (16 + 4 * charge) * this.def.powerMul;
      this.rushT = 0;
      d.consume();
      this.audio.engine(1.2); this.audio.finisherWind(0.4);
      this.subs.show('커피 마셔야 돼—!!', { duration: 1.6, strong: true });
      this.events.push({ type: 'ultStart', kind: fk, target: this.target ? this.target.slot : this.slot, charge });
      return true;
    }
    if (ULT[fk]) {
      // ---- 연출형 필살: 상대를 붙잡아두고 스크립트대로 진행 ----
      const tg = this.target;
      if (!tg || tg.ko || tg.downT > 0) return false;
      // 가드 중이면 연출형 필살도 막힌다 (가드는 모든 공격을 막는다는 규칙 유지). 예외: 커피 폭격은 뜨거운 커피라 가드를 뚫는다 (데미지 절반 + 가드 파괴)
      const guardPierce = fk === 'coffeeBarrage';
      if (tg.guard && !guardPierce) {
        const chip = Math.max(1.5, (34 + 7 * charge) * this.def.powerMul * 0.08);
        tg.hp = Math.max(0, tg.hp - chip);
        tg.block = Math.max(tg.block, 0.5); tg.blockShock = 1; tg.blockGhost = 0.5;
        tg.knock.addScaledVector(this.forward, 1.6);
        tg.cd.U = Math.max(0, tg.cd.U - 0.4);
        if (tg.hp <= 0) tg._die();
        this.stagger = Math.max(this.stagger, 0.7); this.staggerKind = 'normal';
        d.consume();
        this.audio.guardHeavy(1.2);
        this.subs.show('막혔다…!?', { duration: 1.2, mid: true });
        this.events.push({ type: 'ultBlocked', kind: fk, target: tg.slot });
        return true;
      }
      const dur = ULT[fk];
      this.ultT = dur; this.ultKind = fk; this.ultTarget = tg;
      this.punch = null; this.queue.length = 0; this.armor = dur;
      tg.ultVictimT = dur; tg.ultVictimKind = fk; tg.punch = null; tg.queue.length = 0; tg.stagger = 0; tg.dempsey.stop();
      // 연출 동안 나눠서 들어간다. 채채(릴스)·오승현(간식 폭격)은 기본 파워가 낮아 필살기만은 크게 (경량 캐릭터의 한 방)
      const ULT_MUL = { reels: 1.8, snackRain: 1.8, forge: 1.15, coffeeBarrage: 1.3 };
      tg.ultDmg = (34 + 7 * charge) * this.def.powerMul * (ULT_MUL[fk] || 1) * (guardPierce && tg.guard ? 0.5 : 1);
      if (fk === 'danceTime') {
        // 댄스 타임: 상대 최대 체력의 1/3 고정. 둘이 나란히 서서 같이 춤춘다 (기존 파트너 댄스 재사용)
        tg.ultDmg = (tg.maxHp || tg.def.hp) / 3;
        this.danceT = dur; this.dancePartner = tg; this.danceVictim = false;
        tg.danceT = dur; tg.dancePartner = this; tg.danceVictim = true;
        this.danceStay = true; tg.danceStay = true;   // 끌어오지 않고 각자 제자리에서 춤춘다
      }
      if (guardPierce && tg.guard) { tg.guard = false; tg.stam = 0; tg.guardBroken = Math.max(tg.guardBroken || 0, 2.0); tg.events.push({ type: 'guardBreak' }); }
      tg.ultDmgRate = tg.ultDmg / dur;
      d.consume();
      this.audio.finisherWind(0.5);
      const line = fk === 'reels' ? '잡았다! 릴스 각이야, 찍는다!' : fk === 'barbell' ? '자, 10회 3세트 간다!' : fk === 'snackRain' ? '비, 빵이 떨어진다…!' : fk === 'coldCut' ? '…그래서 어쩌라고.' : fk === 'forge' ? '망치로 뚝배기 강화하기!' : fk === 'coffeeBarrage' ? '커피 마셔야 돼!! 받아!!' : fk === 'danceTime' ? '자, 댄스 타임!! 업, 다운, 츄!' : '어… 이거 무거운데—!!';
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
    // 지친 상대의 주먹은 힘이 실리지 않는다 — 가드 게이지를 다 쓴 난타는 실질 위력이 떨어진다.
    // P 는 const 이고 넉백·경직 판정에도 쓰이므로 건드리지 않고, 데미지에만 계수로 곱한다.
    const tired = (ev.attacker && ev.attacker.stam < 20 && !ev.finisher)
      ? 0.55 + 0.45 * (ev.attacker.stam / 20) : 1;
    let dmg = ev.type === 'hook' ? 2.5 + 4.5 * P : ev.type === 'flicker' ? 2.1 + 2.6 * P : ev.type === 'special' ? 3 + 4.5 * P : 3 + 3 * P;
    if (ev.dempsey) dmg *= 1.1;
    if (ev.roll) dmg *= 0.45;   // 뎀프시롤 난타: 한 방은 가볍고 수로 민다
    if (ev.maxSpeed) dmg *= 1.2;
    if (counter || ev.counter) dmg *= 1.8 * (ev.counterMul || 1);
    if (this.stagger > 0) dmg *= (this.staggerKind === 'groggy' ? 1.3 : 1.2);
    if (this.dempsey.active && !this.dempsey.maxSpeed) dmg *= 1.2;
    dmg *= tired;
    this.readSkill = Math.min(0.3, this.readSkill + 0.025);

    // ---- 사이드 스텝 회피 (우랄라 I): 이동 중엔 필살기 빼고 전부 피한다 ----
    if (this.sideDash && !ev.finisher) { this.dempsey.addGauge(2); return { dmg: 0, evaded: true, ko: false }; }
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
    // ---- 필살기 시전 중: 완전 무적 ----
    // 예전엔 아머로 묶여 50% 피해를 받아, 필살기 연출 중에 그대로 얻어맞았다.
    if (this.finisher || this.ultT > 0 || this.rollT > 0) {
      return { dmg: 0, armored: true, staggered: false, ko: this.ko, ignore: true };
    }
    // ---- U 반격기 아머: 끊기지 않고 스턴도 안 걸리되 피해는 절반 받는다 ----
    if (this.armor > 0) {
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
      // 가드 관통 칩 데미지. 10대를 막으면 10 정도 깎이도록 잡는다
      // (예전엔 4%/최소 0.3 이라 10대를 막아도 3 밖에 안 줄어 '안 아픈' 느낌이었다)
      dmg = Math.max(1, dmg * (ev.finisher ? 0.22 : 0.13));
      this.hp = Math.max(0, this.hp - dmg);
      if (this.hp <= 0) this._die();
      const heavy = ev.dempsey || ev.heavy || ev.finisher || ev.counter || counter || P >= 0.75;
      this.react.headX = -0.1 - 0.15 * P; this.react.waistX = -0.08 - 0.1 * P;
      this.knock.copy(ev.dir).multiplyScalar((0.9 + 1.5 * P) * (ev.finisher ? 2.0 : 1));   // 가드는 밀리되 과하지 않게
      // 한 대 막을 때마다 크게 깎인다 — 센 공격일수록 더. 무한히 버틸 수 없다.
      this.stam = Math.max(0, this.stam - (4 + 7 * P) * (ev.finisher ? 2.2 : 1));
      this.stamIdle = 0;
      this.block = Math.max(this.block, 0.3);
      this.blockShock = Math.max(this.blockShock, heavy ? 1 : 0.4);
      if (heavy) this.blockGhost = 0.4;
      return { dmg, blocked: true, staggered: false, ko: this.ko, heavy };
    }

    // ---- 위빙 훅 피격: 뒤로 크게 밀리고 길게 경직된다 (가드로는 막힌다 — 위 분기에서 처리) ----
    if (ev.weave) {
      const dmgW = 6 + 6 * P;
      this.hp = Math.max(0, this.hp - dmgW);
      this.knock.copy(ev.dir).setLength(18);      // '많이 밀린다' — 일반 훅(약 3)의 6배
      this.stagger = Math.max(this.stagger, 1.5); this.staggerKind = 'normal'; this.staggerImmune = 1.2;
      this.punch = null; this.queue.length = 0; this.hitCount = 0;
      this.react.headX = -0.65; this.react.waistX = -0.45; this.react.headY = 0.5;
      this.stam = Math.max(0, this.stam - 12);    // 맞으면 가드 게이지도 깎인다
      if (this.hp <= 0) this._die();
      return { dmg: dmgW, weave: true, staggered: true, ko: this.ko, heavy: true };
    }

    const body = ev.zone === 'body';
    dmg *= body ? 0.9 : 1.15;
    this.hp = Math.max(0, this.hp - dmg);
    const sgn = ev.side === 'L' ? 1 : -1;
    const r = this.react;
    const k = counter ? 1.7 : 1;
    if (body) {
      r.waistX = (0.75 + 0.45 * P) * k; r.headX = 0.45 * k; r.waistY = sgn * 0.3 * k;
      if (ev.type === 'hook') r.waistZ = -sgn * 0.38 * k;
      this.dempsey.gauge = Math.max(0, this.dempsey.gauge - 4 * P);
    } else if (ev.type === 'hook' || ev.type === 'special') {
      r.headY = sgn * (1.15 + 0.6 * P) * k; r.headZ = -sgn * (0.6 + 0.35 * P) * k; r.headX = -0.3 * k;
      r.waistY = sgn * (0.6 + 0.4 * P) * k; r.waistZ = -sgn * 0.3 * k; r.waistX = -0.35 * P * k;
    } else {
      r.headX = -(0.7 + 0.5 * P) * k; r.waistX = -0.45 * k; r.headY = sgn * 0.28;
    }
    // 맞은 충격으로 뒷발이 밀리는 스텝백 (0.22초 동안)
    this.hitStepT = 0.22;
    const comboScale = 1 / (1 + 0.45 * Math.min(4, this.hitCount));   // 맞을수록 덜 밀린다 → 연타가 이어진다
    this.hitStep = Math.min(0.7, (this.hitStep || 0) + (0.18 + 0.32 * P) * (counter ? 1.5 : 1) * comboScale);
    this.knock.copy(ev.dir).multiplyScalar((0.8 + 1.45 * P) * (body ? 1.2 : 1) * (counter ? 1.9 : ev.finisher ? 3.0 : 1) * comboScale);
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
      // 다운 중엔 추가타가 불가능하다 → 넉백을 키워도 연타 밸런스에 영향이 없다.
      // 위의 knock 은 콤보 스케일(comboScale)로 줄어들어 있어서 맞은 횟수에 따라 거리가 들쭉날쭉했다.
      // 다운만은 콤보 스케일과 무관하게 뒤로 확실히 밀어낸다 → 암벽 맵에서 낙사를 노릴 수 있다.
      // 감쇠가 exp(-dt*6.5) 이므로 이동 거리 ≈ DOWN_KNOCK / 6.5 ≈ 2.2 (암벽 반경 8.6 기준)
      const DOWN_KNOCK = 14;
      if (this.knock.lengthSq() > 1e-6) this.knock.setLength(Math.max(this.knock.length(), DOWN_KNOCK));
      else this.knock.copy(ev.dir).setLength(DOWN_KNOCK);
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
    // 위로 붕 떠올라 뒤로 날아간다 (마지막 타격 방향 = 지금 밀리고 있는 방향, 없으면 내 뒤쪽)
    const dir = this.knock.lengthSq() > 1e-4 ? this.knock.clone().setY(0).normalize() : this.forward.clone().negate();
    this.knock.copy(dir).multiplyScalar(4.2);
    this.airV = Math.max(this.airV, 5.2); this.airY = Math.max(this.airY, 0.001);
    this.koFly = true; this.koLandT = -1; this.koLift = 0;
  }

  /** 팀전에서 같은 편인가 (난투는 team === null 이라 항상 false) */
  sameTeam(o) { return this.team !== null && o && o.team !== null && o.team === this.team; }

  pickTarget(fighters) {
    if (this.target && this.target.ko && this.target.koT < 1.2 && this.target.pos.distanceTo(this.pos) < 1.8) return;
    let best = null, bd = 1e9;
    for (const f of fighters) {
      if (f === this || f.ko || f.benched) continue;
      if (this.sameTeam(f)) continue;   // 팀전: 같은 편은 노리지 않는다
      const dd = f.pos.distanceToSquared(this.pos);
      let w = f === this.target ? dd * 0.55 : dd;   // 현재 타겟 유지 성향 강하게 (타겟이 자주 바뀌면 시야·조준이 흔들린다)
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
    this.prevFootL.copy(this.footL); this.prevFootR.copy(this.footR);
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
    const canMove = (!this.punch || (this.punch.t > this.punch.dur * 0.5 && !this.punch.ranged)) && !this.busy;   // 사격 중엔 제자리
    if (canMove) {
      // 스탠스 중에도 자유 이동 (스매시 차지만 약간 느림)
      const stanceSlow = d.active ? (st === 'smash' ? 0.6 : 0.9) : 1;
      const speed = 2.5 * Math.pow(this.def.speedMul, 0.75) * stanceSlow * (this.boostT > 0 ? 1.45 : 1);
      this.pos.x += input.mx * speed * dt; this.pos.z += input.mz * speed * dt;
    }
    // (자동 전진/거리 유지 제거 — 제자리에서도 롤/스탠스 가능, 이동은 전부 WASD)
    if (this.backstep > 0) { this.backstep -= dt; this.pos.addScaledVector(this.forward, -4.2 * dt); }
    if (this.sideDash) {
      const sd = this.sideDash; sd.t += dt;
      const k = Math.min(1, sd.t / sd.dur), spd = 5.2 * (1 - k * k);   // 초반 빠르고 끝에서 멈춘다 (약 1.5m)
      this._advance(sd.dir, spd * dt);
      // 빙그르르 한 바퀴 (이동 방향으로), 끝에서 정확히 원래 방향
      const sgn = sd.dir.dot(this.side) > 0 ? 1 : -1;
      this.spin = sgn * Math.PI * 2 * (1 - Math.pow(1 - k, 2.2));
      if (sd.t >= sd.dur) { this.sideDash = null; this.spin = 0; }
    }
    this.pos.addScaledVector(this.knock, dt);
    // KO 로 떠 있는 동안은 공중에서 거의 안 줄어든다 (뒤로 시원하게 날아가게)
    this.knock.multiplyScalar(Math.exp(-dt * (this.ko && this.koFly ? 1.1 : this.stagger > 0 ? 9 : 6.5)));
    // 띄워짐
    if (this.airY > 0 || this.airV > 0) {
      this.airV -= 14 * dt; this.airY += this.airV * dt;
      if (this.airY <= 0) { this.airY = 0; if (this.airV < -1) { this.audio.impact(0.5, 'body'); } this.airV = 0; }
    }
    // ---- 로프: 밀어붙이면 로프가 늘어나며 힘을 모으고(최대 0.45초), 놓거나 다 모이면 안쪽으로 튕겨나가 부스트 ----
    this.pos.addScaledVector(this.dash, dt);
    this.dash.multiplyScalar(Math.exp(-dt * 2.8));
    if (this.ropeCool > 0) this.ropeCool -= dt;
    if (this.boostT > 0) this.boostT -= dt;
    let pushing = false;
    if (ARENA.kind === 'cliff') {
      // ---- 암벽: 로프가 없다. 가장자리를 넘으면 그대로 추락 ----
      if (this.fallT <= 0 && !this.fellOut) {
        const r = Math.hypot(this.pos.x, this.pos.z);
        const edge = ARENA.radius(this.pos.x, this.pos.z);
        if (r > edge) {
          this.fallT = 2.4; this.fallVy = 0; this._fallDir = null; this.punch = null; this.queue.length = 0; this.finisher = null;
          this.dempsey.stop(); this.ultT = 0; this.ultVictimT = 0;
          this.audio.stagger();
          this.events.push({ type: 'fell' });
        }
      }
    } else for (const axis of ['x', 'z']) {
      const v = this.pos[axis];
      if (Math.abs(v) <= 2.5) continue;
      const dir = Math.sign(v);
      const inputOut = (axis === 'x' ? input.mx : input.mz) * dir;
      if (inputOut > 0.3 && !this.busy && !this.ko && this.ropeCool <= 0 && (this.ropeAxis === null || this.ropeAxis === axis)) {
        pushing = true;
        this.ropeAxis = axis; this.ropeDir = dir;
        this.ropeCharge = Math.min(0.45, this.ropeCharge + dt);
        const stretch = 3.75 + 0.55 * (this.ropeCharge / 0.45);       // 로프가 늘어나는 만큼 밖으로
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
      // 보폭 주파수. 예전 값(4.5~7 rad/s)은 초당 2.1스텝이라 밍기적거렸다.
      // 6.5~10 rad/s = 초당 2.1~3.2 스텝 → 빠르게 움직일 때 달리는 것으로 읽힌다.
      const freq = 6.5 + 3.5 * Math.min(1, spd / 2.5);
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
    this.cd.S = Math.max(0, this.cd.S - dt);
    // 가드 게이지. 막는 동안 줄고, 손을 내리면 잠깐 뒤부터 빠르게 찬다.
    if (this.guard) {
      this.stam = Math.max(0, this.stam - 11 * dt);
      this.stamIdle = 0;
      if (this.stam <= 0 && this.guardBroken <= 0) {
        this.guardBroken = 1.2;                 // 가드 깨짐 — 그동안 못 올린다
        this.guard = false;
        this.audio.guardHeavy ? this.audio.guardHeavy(1) : this.audio.block();
        this.events.push({ type: 'guardBreak' });
      }
    } else {
      this.stamIdle += dt;
      if (this.stamIdle > 0.30) this.stam = Math.min(this.stamMax, this.stam + 34 * (this.def.guardRegen || 1) * dt);
    }
    if (this.guardBroken > 0) this.guardBroken -= dt;
    if (this.armor > 0) this.armor -= dt;

    // ---- 입력 ----
    const shift = input.isDown('ShiftLeft');
    const wasGuard = this.guard;
    // 경직(stagger)은 가드를 풀지 않는다.
    // 예전엔 !this.busy 를 썼는데 busy 에 stagger 가 포함돼, 필살기 첫 대에 경직되면
    // SHIFT 를 누르고 있어도 가드가 풀려 나머지가 전부 들어갔다.
    // (연출형 필살기도 tg.guard 를 보고 막히므로 같은 이유로 안 막혔다)
    // 경직 중엔 공격이 막히는 것으로 충분하다 — 방어까지 막을 이유는 없다.
    const guardLocked = this.ko || this.fallT > 0 || !!this.finisher || this.airY > 0.01
      || this.downT > 0 || this.danceT > 0 || this.ultT > 0 || this.ultVictimT > 0;
    // 사람은 SHIFT 를 떼는 즉시 가드가 풀린다.
    // block 타이머를 가드 조건에 넣어 두면, 한 대 막을 때마다 0.3초씩 갱신돼서
    // SHIFT 를 뗐는데도 후속타까지 계속 자동으로 막혔다.
    // 단 block 은 AI 가 가드하는 수단이기도 하므로(AIBrain.doBlock) AI 에게는 남겨 둔다.
    const wantGuard = this.isAI ? (shift || this.block > 0) : shift;
    // 가드 게이지가 바닥나 가드가 깨졌으면, 잠김이 풀리고 최소치(최대의 18%)를 회복할 때까지 못 올린다
    const stamOk = this.guardBroken <= 0 && this.stam > (this.guard ? 0 : this.stamMax * 0.18);
    this.guard = wantGuard && stamOk && !d.active && !this.punch && !guardLocked;
    this.guardT = this.guard ? (wasGuard ? this.guardT + dt : 0) : 99;
    this.guardHold = this.guard ? (this.guardHold || 0) + dt : 0;   // 코치용: 가드 연속 유지 시간
    // ---- 밀치기 (Space) ----
    // 막고만 있으면 아무것도 못 하니, 가드 중에도 눌러서 상대를 밀어낼 수 있게 한다.
    // 맞으면 크게 밀리며 넘어진다. 단 상대도 가드로 막을 수 있다.
    if (input.justPressed('Space') && !this.weave && !this.punch && !this.busy && this.cd.S <= 0) {
      this.weave = { t: 0, dur: 0.52, hit: false };
      this.cd.S = this.def.weaveCd || 1.3;
      this.guard = false;
      this.slip = 0.26; this.slipDir = this.dempsey.sway >= 0 ? 1 : -1;   // 앞머리 0.26초는 상체를 낮춰 흘린다
      this.audio.swoosh(this.slipDir, 0.7, true);
    }
    const jDown = input.isDown('KeyJ'), kDown = input.isDown('KeyK');
    const jPress = input.justPressed('KeyJ'), kPress = input.justPressed('KeyK');
    const finPress = input.justPressed('KeyL');   // 필살기는 L 로만 (J+K 동시 입력 트리거 제거)
    if (this.rollT > 0) {
      // ---- 뎀프시롤 필살: 상대를 자동 추적하며 좌우 끝마다 훅 난타. 마지막 0.3초에 피니시 훅 ----
      this.rollT -= dt;
      this.armor = Math.max(this.armor, 0.1);
      if (tgt && dist > 0.9) this._advance(this.forward, 2.2 * dt);
      if (d.hookTrigger && (!this.punch || this.punch.t > this.punch.dur * 0.35)) {
        const last = this.rollT < 0.35 && !this.rollFinal;
        if (last) { this.rollFinal = true; this.startPunch(d.hookTrigger, 'hook', 0.3, 1.9 * this.def.powerMul, { heavy: true, rollFinish: true, staggerT: 1.2 }); }
        else this.startPunch(d.hookTrigger, 'hook', null, 0.6 * this.def.powerMul, { roll: true });
      }
      if (this.rollT <= 0) { this.rollT = 0; this.rollFinal = false; d.consume(); this.armor = 0; }
    } else if (!this.busy && !this.ko) {
      if (finPress && d.maxSpeed) this.startFinisher();
      else if (input.justPressed('KeyU')) this.startSpecial('U');
      else if (input.justPressed('KeyI')) { this._dashSign = input.isDown('KeyA') ? 1 : input.isDown('KeyD') ? -1 : -(this._lastDash || 1); this._lastDash = this._dashSign; this.startSpecial('I'); }
      else {
        const press = jPress ? 'J' : kPress ? 'K' : null;
        if (press) {
          // J = 왼손 스트레이트, K = 오른손 훅 (콤비네이션 없음)
          if (press === 'J') this.startPunch('L', 'straight'); else this.startPunch('R', 'hook');
        }
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
    p.shLX += Math.sin(t * 3.4) * 0.05 * bob; p.shRX += Math.cos(t * 3.4 + 1) * 0.05 * bob;
    p.waistZ += Math.sin(t * 1.7) * 0.04 * bob;

    // ---- 제자리 바운스: 복서는 가만히 서 있지 않는다. 무릎으로 통통 튀며 숨을 고른다 ----
    // 이동·펀치·필살 중에는 각자의 모션이 있으므로 섞지 않는다.
    // 상대를 향해 미세하게 움직이는 동안에도 복서는 통통 튄다 → on/off 가 아니라 보행량에 따라 섞는다
    // (walkAmt 가 0.45 를 넘어 실제로 달리기 시작하면 보행 모션에 자리를 내준다)
    const idleTarget = bob && !this.punch && !this.busy ? Math.max(0, 1 - this.walkAmt * 2.2) : 0;
    this._idleAmt = (this._idleAmt || 0) + (idleTarget - (this._idleAmt || 0)) * Math.min(1, dt * 6);
    const ia = this._idleAmt;
    if (ia > 0.01) {
      // |sin| 은 주기가 절반이라 실제 바운스는 초당 HOP*2 회가 된다 → 1.9회/초
      const HOP = 0.95;
      const ph = t * HOP * Math.PI * 2;
      const up = Math.abs(Math.sin(ph));                // 0 = 착지, 1 = 최고점
      const squash = 1 - up;                            // 착지 순간 무릎이 접힌다
      p.hipsY += (up * 0.048 - 0.010) * ia;
      p.thighLX += -squash * 0.20 * ia; p.shinL += squash * 0.34 * ia;
      p.thighRX += -squash * 0.20 * ia; p.shinR += squash * 0.34 * ia;
      // 좌우로 살짝 무게를 옮기며 스텝 (한 박자 느리게)
      const sway = Math.sin(t * HOP * Math.PI);
      p.hipsX += sway * 0.022 * ia;
      p.waistZ += sway * 0.05 * ia;
      // 상체·머리는 반 박자 늦게 따라온다 (관성)
      const lag = Math.abs(Math.sin(ph - 0.7));
      p.chestZ += sway * 0.035 * ia;
      p.headOffY += (lag * 0.012 - 0.004) * ia;
      p.headX += -lag * 0.05 * ia;
      // 글러브도 같이 들썩 (가드 자세 유지)
      p.shLX += -lag * 0.10 * ia; p.shRX += -lag * 0.10 * ia;
      p.elL += lag * 0.07 * ia; p.elR += lag * 0.07 * ia;
    }
    if (this.walkAmt > 0.01 && !d.active) {
      // ---- 보행/달리기: 다리 교차 + 무릎 굽힘 + 골반 상하/좌우 + 상체 약간 앞으로 + 어깨 반동 ----
      const a = this.walkAmt, ph = this.walkPhase;
      const sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
      const run = Math.min(1, Math.abs(this.walkFwd || 0) / 2.2);
      // 보폭. 예전 0.45~0.80 은 발을 끄는 느낌이었고, 1.35 까지 올리니 다리가 과하게 찢어졌다.
      // 0.50~0.95 rad (±29°~±54°) 가 달리는 것으로 읽히면서 자연스러운 선
      const stride = 0.50 + 0.45 * run;
      p.thighLX += sw * stride * a;  p.thighRX += -sw * stride * a;
      // 무릎: 뒤로 뻗은 다리를 확 접어 올린다 (달리기의 핵심). 위상을 살짝 앞당겨 차올리는 느낌
      const tuckL = Math.max(0, -Math.sin(ph - 0.45)), tuckR = Math.max(0, Math.sin(ph - 0.45));
      p.shinL += tuckL * (0.80 + 0.80 * run) * a;  p.shinR += tuckR * (0.80 + 0.80 * run) * a;
      // 옆걸음: 다리를 벌렸다 모은다
      const side = Math.max(-1, Math.min(1, (this.walkSide || 0) / 2));
      p.thighLZ += side * sw * 0.25 * a; p.thighRZ += side * sw * 0.25 * a;
      // 상하 반동을 키우고, 달릴수록 무게중심이 살짝 낮아진다
      p.hipsY += (Math.abs(sw2) * 0.055 + 0.03 * run) * a - 0.035 * run * a;
      p.hipsX += -side * 0.03 * a + Math.sin(ph) * 0.028 * a;
      p.hipsRotY += sw * 0.20 * a;                  // 골반 회전도 크게
      p.waistY += -sw * 0.18 * a;                   // 상체는 반대로 비튼다
      p.waistX += 0.22 * run * a;                   // 달리면 상체를 확실히 앞으로
      p.chestZ += sw * 0.05 * run * a;
      // 팔 반동 (가드는 유지하되 어깨가 확실히 움직인다)
      p.shLX += sw * 0.24 * a; p.shRX += -sw * 0.24 * a;
      p.elL += Math.max(0, sw) * 0.22 * run * a; p.elR += Math.max(0, -sw) * 0.22 * run * a;
      p.headY += -sw * 0.05 * a;
      p.headX += -0.10 * run * a;
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
    const others = fighters.filter((f) => f !== this && !f.benched && !this.sameTeam(f) && (!f.ko || f.koT < 1.2) && !(f.downT > 0));
    const _hit = { zone: 'head', point: new THREE.Vector3(), t: 0 };
    const tryHit = (side, radius, mk, useFoot = false) => {
      const glove = useFoot ? (side === 'L' ? this.footL : this.footR) : (side === 'L' ? this.gloveL : this.gloveR);
      const prev = useFoot ? (side === 'L' ? this.prevFootL : this.prevFootR) : (side === 'L' ? this.prevGloveL : this.prevGloveR);
      for (const f of others) {
        _d.subVectors(f.pos, this.pos); _d.y = 0;
        if (_d.dot(this.forward) <= 0.2) continue;
        if (f.sweptHit(prev, glove, radius, _hit)) return mk(f, _hit);
      }
      return null;
    };

    // ---- 위빙 훅 ----
    // 앞 절반은 상체를 낮춰 흘리고(위빙), 뒤 절반에 아래에서 올려치는 훅이 나간다.
    // 맞으면 크게 뒤로 밀린다. 가드로는 막힌다.
    if (this.weave) {
      const wv = this.weave;
      wv.t += dt;
      const u = Math.min(1, wv.t / wv.dur);
      const sd = wv.side || (wv.side = this.slipDir >= 0 ? 'L' : 'R');
      const sgn = sd === 'L' ? 1 : -1;
      if (u < 0.5) {
        // 위빙: 무릎을 굽혀 몸을 낮추고 옆으로 흘린다
        const k = Math.sin((u / 0.5) * Math.PI);
        p.hipsY += -0.10 * k;
        p.thighLX += -0.45 * k; p.shinL += 0.75 * k;
        p.thighRX += -0.45 * k; p.shinR += 0.75 * k;
        p.waistX += 0.42 * k; p.waistZ += -sgn * 0.42 * k;
        p.hipsX += sgn * 0.16 * k;
        p.headX += 0.30 * k; p.headZ += -sgn * 0.26 * k;
      } else {
        // 올려치는 훅: 낮춘 몸을 펴면서 어깨를 돌린다
        const k = Math.sin(((u - 0.5) / 0.5) * Math.PI);
        const kx = sd === 'L' ? 'shLX' : 'shRX', ky = sd === 'L' ? 'shLY' : 'shRY', ke = sd === 'L' ? 'elL' : 'elR';
        p[kx] += -1.55 * k; p[ky] += sgn * 0.95 * k; p[ke] += 1.25 * k;
        p.waistY += -sgn * 0.55 * k; p.waistX += -0.30 * k;
        p.hipsRotY += -sgn * 0.35 * k; p.hipsY += 0.05 * k;
        p.chestY += -sgn * 0.30 * k;
      }
      if (!wv.hit && u > 0.55 && u < 0.82) {
        hitEvent = tryHit(sd, 0.46, (tg, h) => {
          wv.hit = true;
          return { attacker: this, target: tg, side: sd, type: 'hook', weave: true, heavy: true, power: 1.15,
                   pos: h.point.clone(), zone: h.zone, dir: this.forward.clone() };
        }) || hitEvent;
      }
      if (wv.t >= wv.dur) this.weave = null;
    }

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
        if (info.p < 0.5 && dist > 0.95) this._advance(this.forward, (f.dash || 4.5) * dt);
        if (!f.hit && info.p > 0.3 && info.p < 0.66) {
          this._applyNow(p);
          hitEvent = tryHit(f.side, 0.42, (tg, h) => { f.hit = true; return { attacker: this, target: tg, side: f.side, type: 'hook', power: f.power, pos: h.point.clone(), zone: h.zone, dir: this.forward.clone(), maxSpeed: true, finisher: true, charge: f.charge, dempsey: false, launch: f.launch, kind: f.kind }; });
        }
        if (f.punch.t >= f.punch.dur) this.finisher = null;
      }
    } else if (this.punch) {
      const pu = this.punch;
      pu.t += dt;
      const info = pu.ranged ? applyAimToPose(p, pu) : applyPunchToPose(p, pu);
      // 스텝인 (원거리 캐릭터의 기본 사격은 제자리에서 — 자동으로 파고들면 원거리의 의미가 없다)
      if (tgt && !d.active && !(this.def.ranged && !pu.kind)) {
        const reach = this.reach;
        const stepSpd = pu.step || 3.2;
        if (info.p < 0.28) {
          // 예비동작: 뒷발로 체중 싣기 (거의 제자리 — 연타 거리 유지)
          this.pos.addScaledVector(this.forward, -0.15 * dt);
        } else if (info.p < 0.7 && dist > reach * 0.8) {
          // 도움닫기: 거리가 멀수록 크게 파고든다 (경직된 상대는 더 바싹 따라붙는다)
          const chase = tgt.stagger > 0 || tgt.downT > 0 ? 2.2 : 1.6;
          this._advance(this.forward, Math.min(stepSpd * chase, (dist - reach) * 18 * chase) * dt);
        }
      }
      if (pu.t >= pu.dur) { this.punch = null; this.events.push({ type: 'punchEnd', hit: !!pu.hit }); }
      if (!d.active) this.bufferedHook = null;
      // 원거리 캐릭터: 기본 펀치(스트레이트/훅)는 주먹 대신 레이저 탄을 쏜다. 탄 판정은 아래 shots 갱신에서
      if (this.def.ranged && !pu.kind && (pu.type === 'straight' || pu.type === 'hook') && !pu.shotFired && info.p > 0.22) {
        pu.shotFired = true; pu.hit = true;   // 주먹 판정은 쓰지 않는다
        this._applyNow(p);
        const dir = this.forward.clone();
        // 쌍권총: J/K 구분 없이 두 총에서 동시에 두 발 (한 발 위력은 60%, 둘 다 맞으면 120%)
        for (const side of ['L', 'R']) {
          const from = (side === 'L' ? this.gloveL : this.gloveR).clone().addScaledVector(dir, 0.22);
          const id = ++this._shotId;
          this.shots.push({ id, pos: from, dir: dir.clone(), side, type: pu.type, power: pu.power * 0.6, life: 0.7, maxSpeed: d.maxSpeed, dempsey: d.active, heavy: pu.type === 'hook' });
          this.events.push({ type: 'shot', id, x: from.x, y: from.y, z: from.z, dx: dir.x, dz: dir.z, side, hook: pu.type === 'hook' });
        }
        this.audio.whoosh(0, 1.6, 0.4);
      }
      if (!pu.hit && info.p > (pu.kind ? 0.24 : 0.3) && info.p < 0.66) {
        this._applyNow(p);
        const radius = 0.85 * (pu.hitRadius || (pu.type === 'flicker' ? (st === 'flicker' && d.active ? 0.55 : 0.48) : pu.kind ? 0.62 : 0.42));
        hitEvent = tryHit(pu.side, radius, (tg, h) => { pu.hit = true; return { attacker: this, target: tg, side: pu.side, type: pu.type, power: pu.power, pos: h.point.clone(), zone: pu.zoneForce || h.zone, dir: this.forward.clone(), maxSpeed: d.maxSpeed, dempsey: d.active, finisher: !!pu.rollFinish, roll: !!pu.roll, charge: pu.rollFinish ? d.charge : 0, heavy: !!pu.heavy, counter: !!pu.counter || !!pu.forceCounter, counterMul: pu.counterMul || 1, launch: pu.launch || 0, liver: !!pu.liver, staggerT: pu.staggerT || 0, kind: pu.kind || null, fromU: !!pu.fromU }; }, !!pu.kick);
      }
    }

    // ---- 레이저 탄 (원거리): 14m/s 직진, 몸통 선분에 닿으면 펀치와 같은 피격 이벤트 ----
    if (this.shots.length) {
      const SPD = 14;
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const sh = this.shots[i];
        sh.pos.addScaledVector(sh.dir, SPD * dt); sh.life -= dt;
        let done = sh.life <= 0 || Math.abs(sh.pos.x) > 7 || Math.abs(sh.pos.z) > 7;
        if (!done) {
          for (const f of others) {
            if (pointSegmentDist(sh.pos, f.hipsPos, f.headPos) < 0.42) {
              const zone = sh.pos.y > f.hipsPos.y + (f.headPos.y - f.hipsPos.y) * 0.72 ? 'head' : 'body';
              const ev = { attacker: this, target: f, side: sh.side, type: sh.type, power: sh.power, pos: sh.pos.clone(), zone, dir: sh.dir.clone(), maxSpeed: sh.maxSpeed, dempsey: sh.dempsey, finisher: false, roll: false, charge: 0, heavy: sh.heavy, counter: false, counterMul: 1, launch: 0, liver: false, staggerT: 0, kind: null, fromU: false, laser: true };
              if (!hitEvent) hitEvent = ev; else this.events.push({ type: 'extraHit', ev });
              done = true; break;
            }
          }
        }
        if (done) { this.events.push({ type: 'shotEnd', id: sh.id }); this.shots.splice(i, 1); }
      }
    }

    // ---- 낙사: 허우적대며 아래로 ----
    if (this.fallT > 0) {
      this.fallT -= dt;
      const u = 2.4 - this.fallT;                              // 총 2.4초 낙하
      // 발이 허공을 딛고 → 중심을 잃고 뒤로 기울며 → 가속 추락
      // 가장자리에서 머뭇거리면 '나갔는데 안 떨어진다'로 보인다 → 즉시 떨어지게
      const tip = Math.min(1, u / 0.12);
      this.fallVy = (this.fallVy || 0) + 19 * dt;
      this.fallY += this.fallVy * dt * (0.7 + 0.3 * tip);
      if (!this._fallDir) { this._fallDir = this.forward.clone().multiplyScalar(-1); this.fallSpin = (Math.random() - 0.5) * 2.2; }
      this.pos.addScaledVector(this._fallDir, (1.4 - u * 0.4) * dt);   // 밀려난 방향으로 관성
      this.rig.root.rotation.x = tip * (0.5 + Math.sin(u * 2.2) * 0.35) + u * 0.5;
      this.rig.root.rotation.z = Math.sin(u * 3.1) * 0.35 * tip;
      const flail = Math.sin(t * 16);
      p.shLX += -2.35 + flail * 0.75; p.shRX += -2.35 - flail * 0.75;
      p.elL += -0.45 - Math.abs(flail) * 0.3; p.elR += -0.45 - Math.abs(flail) * 0.3;
      p.shLZ += 0.75; p.shRZ += -0.75;
      p.thighLX += -0.75 + flail * 0.65; p.thighRX += -0.7 - flail * 0.65;
      p.shinL += 0.85 + Math.max(0, flail) * 0.5; p.shinR += 0.8 + Math.max(0, -flail) * 0.5;
      p.waistX += -0.35 - 0.25 * tip; p.headX += -0.55; p.headZ += flail * 0.25;
      this.queue.length = 0;
      if (this.fallT <= 0) { this.fallT = 0; this.hp = 0; if (!this.ko) { this._die(); this.events.push({ type: 'fellDead' }); } this.fellOut = true; }
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
        // 폰을 두 손으로 들고 촬영: 살짝 무릎 굽혀 앵글 잡고 리듬 타기
        const bob = Math.sin(t * 5.5);
        p.shRX += -1.55; p.shRY += 0.28; p.elR += -1.25;
        p.shLX += -1.45; p.shLY += -0.3; p.elL += -1.35;
        p.headX += -0.18 + bob * 0.05; p.headY += bob * 0.12;
        p.waistX += 0.12; p.hipsY += -0.06 + Math.abs(bob) * 0.05; p.hipsX += bob * 0.05;
        p.thighLX += -0.16; p.thighRX += -0.16; p.shinL += 0.28; p.shinR += 0.28;
      } else if (k === 'barbell') {
        // 팔짱 끼고 카운트 세기 → 마지막엔 손 내리기
        p.shLX += -0.95; p.elL += -2.35; p.shLY += -1.0; p.shRX += -0.9; p.elR += -2.35; p.shRY += 1.0;
        p.chestX += 0.12; p.headX += -0.1 + Math.sin(t * 3) * 0.06; p.hipsX += Math.sin(t * 1.6) * 0.04;
      } else if (k === 'coldCut') {
        // 무표정하게 듣다가 손 들어 차단 → 도리도리 (중요치 않아)
        const u = 3.4 - this.ultT;
        if (u < 2.0) {
          p.shLX += -0.55; p.shRX += -0.5; p.elL += -1.1; p.elR += -1.05; p.headX += -0.05;
          p.hipsX += Math.sin(t * 1.4) * 0.03;
        } else if (u < 2.45) {
          const k2 = Math.min(1, (u - 2.0) / 0.12);
          p.shRX += -2.5 * k2; p.shRY += 0.15 * k2; p.elR += -0.25 * k2; p.shRZ += -0.3 * k2;   // 손바닥 들어 차단
          p.waistX += -0.12 * k2; p.headX += -0.18 * k2;
        } else {
          p.shRX += -1.4; p.elR += -1.6; p.shRY += 0.3;
          p.headY += Math.sin(t * 11) * 0.5;      // 도리도리
          p.headZ += Math.sin(t * 5.5) * 0.06;
          p.waistY += Math.sin(t * 11) * 0.1;
        }
      } else if (k === 'snackRain') {
        // 하늘을 가리키며 빵을 부른다 → 흐뭇하게 구경
        const u = 3.6 - this.ultT;
        if (u < 0.9) {
          const k2 = Math.min(1, u / 0.4);
          p.shRX += -2.85 * k2; p.shRZ += -0.3 * k2; p.elR += -0.2 * k2; p.headX += -0.5 * k2;
          p.shLX += -0.9 * k2; p.elL += -1.6 * k2;
        } else {
          p.shLX += -1.35; p.shRX += -1.3; p.elL += -1.9; p.elR += -1.9;   // 두 손 모으고 구경
          p.headX += -0.25 + Math.sin(t * 3) * 0.05; p.hipsY += Math.abs(Math.sin(t * 4)) * 0.03;
        }
      } else if (k === 'coffeeBarrage') {
        // 카페에서 커피를 꺼내 양손 번갈아 던진다 (0.55초 후 0.05초 간격 50개)
        const u = 3.6 - this.ultT;
        const T0 = 0.55, STEP = 0.05, N = 50;
        if (u < T0) {
          const kk = u / T0;
          p.waistY += -0.6 * kk; p.shRX += -0.4 - 0.8 * kk; p.shRY += 0.6 * kk; p.elR += -1.2; p.headY += -0.5 * kk;   // 옆의 카페로 손 뻗기
        } else if (u < T0 + STEP * N) {
          const i = Math.floor((u - T0) / STEP), ph = ((u - T0) % STEP) / STEP;
          const right = i % 2 === 0, thr = Math.sin(ph * Math.PI);
          const a = -2.4 + 1.9 * ph, b = -1.3;   // 던지는 팔: 뒤에서 앞으로 / 반대 팔: 다음 컵 집기
          if (right) { p.shRX += a; p.elR += -0.3 - 0.5 * (1 - ph); p.shLX += b; p.elL += -1.6; p.shLY += -0.5; }
          else { p.shLX += a; p.elL += -0.3 - 0.5 * (1 - ph); p.shRX += b; p.elR += -1.6; p.shRY += 0.5; }
          p.waistX += 0.15 + 0.2 * thr; p.waistY += (right ? -1 : 1) * 0.25 * (1 - ph); p.headX += -0.1; p.hipsY += -0.04 * thr;
        } else {
          const kk = Math.min(1, (u - T0 - STEP * N) / 0.3);
          p.shLX += -0.7 * kk; p.shRX += -0.7 * kk; p.elL += -1.8 * kk; p.elR += -1.8 * kk; p.headX += 0.2 * kk; p.waistX += 0.15 * kk;   // 만족스럽게 커피 한 모금
        }
      } else if (k === 'cafeRush') {
        // 커피를 향해 전력 질주: 팔 흔들고 상체 앞으로, 부딪히는 사람은 스턴
        const u = 3.2 - this.ultT;
        const run = Math.sin(t * 16);
        p.waistX += 0.45; p.headX += -0.25; p.chestX += 0.2;
        p.shLX += -1.1 + run * 0.9; p.shRX += -1.1 - run * 0.9; p.elL += -1.5; p.elR += -1.5;
        p.thighLX += run * 0.85; p.thighRX += -run * 0.85; p.shinL += Math.max(0, run) * 1.2; p.shinR += Math.max(0, -run) * 1.2;
        p.hipsY += Math.abs(Math.sin(t * 32)) * 0.05;
        this.rushT = (this.rushT || 0) + dt;
        if (u > 0.35 && u < 2.7) {
          this._advance(this.forward, 7.2 * dt);
          const tickDmg = (this.rushPower || 16) * 0.075;   // 0.1초 간격 도트 (≈23히트, 총량은 다른 필살기와 동일)
          for (const o of fighters) {
            if (o === this || o.ko || this.sameTeam(o)) continue;
            const caught = this.rushHits.has(o.slot);
            if (!caught && o.pos.distanceTo(this.pos) > 0.95) continue;
            // 닿는 즉시 첫 타격, 이후 0.1초마다 도트. 기절/다운 중이어도 데미지는 그대로 들어간다
            if (!caught) { this.rushHits.set(o.slot, -1); o.audio.stagger(); }
            const guarding = o.guard;
            if (guarding) {
              // 가드 중이면 밀리지도 않고 칩 데미지만 (0.1초 도트 × 12%)
              o.block = Math.max(o.block, 0.35); o.blockShock = Math.max(o.blockShock, 0.7);
              const next2 = this.rushHits.get(o.slot);
              if (this.rushT >= next2) {
                this.rushHits.set(o.slot, this.rushT + 0.1);
                o.hp = Math.max(0, o.hp - tickDmg * 0.12);
                if (o.hp <= 0) o._die();
              }
              continue;
            }
            if (o.downT <= 0) {
              const want = this.pos.clone().addScaledVector(this.forward, 0.82);
              o.pos.lerp(want, Math.min(1, dt * 14));
              o.stagger = Math.max(o.stagger, 0.6); o.staggerKind = 'normal'; o.staggerImmune = 0.4;
              o.punch = null; o.queue.length = 0;
            }
            const next = this.rushHits.get(o.slot);
            if (this.rushT >= next) {
              this.rushHits.set(o.slot, this.rushT + 0.1);
              o.hp = Math.max(0, o.hp - tickDmg);
              o.rattle = Math.max(o.rattle, 0.55);
              o.react.headX = -0.22; o.react.waistX = -0.12;
              o.audio.impact(0.45, 'follow');
              if (o.hp <= 0) o._die();
              this.events.push({ type: 'rushHit', target: o.slot });
            }
          }
        } else if (u >= 2.7) {
          // 돌격 종료: 밀고 온 상대들을 앞으로 튕겨내고 스태거만 남긴다 (넘어지진 않음)
          for (const o of fighters) {
            if (!this.rushHits.has(o.slot) || o.ko || o.downT > 0) continue;
            if (!o._rushReleased) { o._rushReleased = true; o.knock.addScaledVector(this.forward, 3.4); o.stagger = Math.max(o.stagger, 1.4); o.staggerImmune = 1.2; o.audio.stagger(); }
          }
        }
      } else if (k === 'forge') {
        // 망치 강화: 0.45초 들어올린 뒤 0.11초마다 내려친다 (+1강 … +20강) → 마지막에 만세
        const u = 3.3 - this.ultT;
        const HIT0 = 0.45, STEP = 0.11, N = 20;
        if (u < HIT0) {
          const kk = u / HIT0;
          p.shLX += -1.2 - 1.7 * kk; p.shRX += -1.2 - 1.7 * kk; p.elL += -0.9 + 0.5 * kk; p.elR += -0.9 + 0.5 * kk;
          p.waistX += -0.35 * kk; p.headX += -0.3 * kk; p.hipsY += -0.08 * kk;
        } else if (u < HIT0 + STEP * N) {
          const ph = ((u - HIT0) % STEP) / STEP;              // 0 → 1: 치켜들기(0~0.45) → 내려찍기(0.45~1)
          const up = ph < 0.45 ? ph / 0.45 : 1 - (ph - 0.45) / 0.55;
          const slam = 1 - up;
          p.shLX += -1.2 - 1.6 * up; p.shRX += -1.2 - 1.6 * up; p.elL += -0.5 - 0.4 * up; p.elR += -0.5 - 0.4 * up;
          p.shLY += -0.25; p.shRY += 0.25;
          p.waistX += -0.3 * up + 0.5 * slam; p.headX += -0.25 * up + 0.35 * slam; p.hipsY += -0.06 * slam;
          p.thighLX += -0.15 * slam; p.thighRX += -0.15 * slam; p.shinL += 0.25 * slam; p.shinR += 0.25 * slam;
        } else {
          const kk = Math.min(1, (u - HIT0 - STEP * N) / 0.3);
          p.shLX += -2.9 * kk; p.shRX += -2.9 * kk; p.elL += -0.3; p.elR += -0.3; p.shLZ += 0.5 * kk; p.shRZ += -0.5 * kk;
          p.headX += -0.35 * kk; p.hipsY += Math.abs(Math.sin(t * 12)) * 0.07 * kk;
        }
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
      if (this.ultT <= 0) {
        this.ultT = 0; this.ultKind = null; this.ultTarget = null; this.armor = 0;
        if (this.rushHits) { for (const f2 of fighters) f2._rushReleased = false; this.rushHits.clear(); }
      }
    }
    // ---- 연출형 필살: 당하는 쪽 ----
    if (this.ultVictimT > 0) {
      this.ultVictimT -= dt;
      const k = this.ultVictimKind;
      const tick = (this.ultDmgRate || 0) * dt;
      if (tick > 0 && !this.ko) { this.hp = Math.max(0, this.hp - tick); if (this.hp <= 0) { this._die(); } }
      if (k === 'reels') {
        // ---- 강제 유행 댄스 → 오글거려 주저앉음 ----
        const u = 3.4 - this.ultVictimT;
        const beat = t * 9.2;                      // 비트
        const sw = Math.sin(beat), sw2 = Math.sin(beat * 2);
        if (u < 0.9) {
          // ① 양손 위로 흔들기 (하트 시그니처)
          p.shLX += -2.7 + sw * 0.35; p.shRX += -2.7 - sw * 0.35; p.elL += -0.7; p.elR += -0.7;
          p.shLZ += 0.45; p.shRZ += -0.45;
          p.hipsX += sw * 0.12; p.waistY += sw * 0.3; p.headY += sw * 0.35; p.hipsY += Math.abs(sw2) * 0.08;
        } else if (u < 1.8) {
          // ② 허리 튕기며 사이드 스텝
          p.hipsX += sw * 0.2; p.hipsRotY += sw * 0.5; p.waistY += -sw * 0.45; p.waistZ += sw2 * 0.18;
          p.shLX += -1.5 - Math.max(0, sw) * 0.9; p.shRX += -1.5 - Math.max(0, -sw) * 0.9;
          p.elL += -1.5; p.elR += -1.5; p.headZ += sw2 * 0.22; p.headY += sw * 0.3;
          p.thighLX += sw * 0.3; p.thighRX += -sw * 0.3; p.shinL += Math.max(0, sw) * 0.5; p.shinR += Math.max(0, -sw) * 0.5;
        } else if (u < 2.6) {
          // ③ 손가락 하트 + 윙크 포즈 (카메라 정면)
          const k2 = Math.min(1, (u - 1.8) / 0.25);
          p.shRX += -2.35 * k2; p.shRY += 0.55 * k2; p.elR += -1.9 * k2; p.shRZ += -0.35 * k2;
          p.shLX += -1.0 * k2; p.elL += -2.0 * k2; p.shLY += -0.55 * k2;
          p.headZ += 0.28 * k2 + sw2 * 0.08; p.headX += -0.18 * k2; p.hipsY += Math.abs(sw2) * 0.05;
          p.hipsRotY += sw * 0.15;
        } else {
          // ④ 정신 차리고 오글거림 폭발 → 얼굴 감싸고 배배 꼬며 주저앉음
          const k2 = Math.min(1, (u - 2.6) / 0.8);
          p.shLX += -2.5 + 0.2 * k2; p.shRX += -2.5 + 0.2 * k2; p.elL += -2.5; p.elR += -2.5;   // 두 손으로 얼굴 가림
          p.shLZ += 0.6; p.shRZ += -0.6;
          p.headX += 0.55 * k2; p.waistX += 0.85 * k2; p.waistZ += Math.sin(t * 7) * 0.22 * k2;
          p.hipsY += -0.6 * k2; p.thighLX += -1.15 * k2; p.thighRX += -1.05 * k2; p.shinL += 1.9 * k2; p.shinR += 1.8 * k2;
          p.hipsRotY += Math.sin(t * 5) * 0.2 * k2;
          this.rattle = Math.max(this.rattle, 0.3 * k2);
        }
      } else if (k === 'barbell') {
        // 강제 스쿼트 3회 → 마지막에 깔려 주저앉음
        const u = 3.6 - this.ultVictimT;
        const sq = u < 2.45 ? Math.abs(Math.sin((u - 1.0) / 1.45 * Math.PI * 3)) : 1;
        const down = u < 2.45 ? sq : 1;
        p.hipsY += -0.55 * down; p.thighLX += -1.15 * down; p.thighRX += -1.15 * down; p.shinL += 1.9 * down; p.shinR += 1.9 * down;
        p.waistX += 0.3 * down; p.shLX += -2.6; p.shRX += -2.6; p.elL += -0.4; p.elR += -0.4; p.shLZ += 0.55; p.shRZ += -0.55;
        p.headX += -0.2 + Math.sin(t * 12) * 0.08 * down;
        if (u > 2.45) { p.headZ += Math.sin(t * 14) * 0.2; this.rattle = Math.max(this.rattle, 0.4); }
      } else if (k === 'snackRain') {
        // 쏟아지는 간식을 맞으며 몸부림 → 무릎 꺾임 → 기절
        const u = 3.6 - this.ultVictimT;
        if (u < 2.8) {
          const phase = u / 2.8;                       // 갈수록 더 괴로워진다
          const wob = Math.sin(t * 7.5), wob2 = Math.sin(t * 13), fast = Math.sin(t * 24);
          // 머리를 감싸 쥐고 팔을 퍼덕임
          p.shLX += -2.35 + wob * 0.45; p.shRX += -2.35 - wob * 0.45;
          p.elL += -2.4 + Math.abs(fast) * 0.35; p.elR += -2.4 + Math.abs(fast) * 0.35;
          p.shLZ += 0.6 + wob2 * 0.15; p.shRZ += -0.6 - wob2 * 0.15;
          // 상체를 웅크리고 좌우로 비틀거림
          p.waistX += 0.55 + 0.35 * phase + Math.abs(wob) * 0.15;
          p.waistZ += wob * (0.28 + 0.2 * phase);
          p.waistY += wob2 * 0.22;
          p.hipsX += wob * (0.12 + 0.1 * phase);
          p.hipsRotY += wob2 * 0.3;
          // 무릎이 점점 꺾인다
          const sink = 0.25 + 0.45 * phase;
          p.hipsY += -sink + Math.abs(Math.sin(t * 9)) * 0.05;
          p.thighLX += -0.55 * sink * 2 + wob * 0.2; p.thighRX += -0.5 * sink * 2 - wob * 0.2;
          p.shinL += 1.1 * sink + Math.max(0, wob) * 0.3; p.shinR += 1.05 * sink + Math.max(0, -wob) * 0.3;
          // 고개를 마구 흔들며 비명
          p.headX += 0.45 + fast * 0.14; p.headY += wob2 * 0.4; p.headZ += fast * 0.2;
          this.rattle = Math.max(this.rattle, 0.55 + 0.25 * phase);
          this.react.headX = -0.25 - 0.2 * phase;
          this._snackCry = (this._snackCry || 0) + dt;
          if (this._snackCry > 0.42) { this._snackCry = 0; this.events.push({ type: 'ultHurt' }); }
        } else {
          const k2 = Math.min(1, (u - 2.8) / 0.8);
          p.hipsY += -0.5 * k2; p.thighLX += -1.0 * k2; p.thighRX += -1.0 * k2; p.shinL += 1.7 * k2; p.shinR += 1.7 * k2;
          p.waistX += 0.6 * k2; p.headX += 0.5 * k2; p.shLX += -0.8; p.shRX += -0.8;
          p.headZ += Math.sin(t * 9) * 0.25 * k2;
        }
      } else if (k === 'coldCut') {
        // 하소연 → 차단당함 → 굳음 → 상처받아 기절
        const u = 3.4 - this.ultVictimT;
        if (u < 2.05) {
          // 손짓하며 푸념
          const g2 = Math.sin(t * 6);
          p.shLX += -1.5 + g2 * 0.35; p.shRX += -1.45 - g2 * 0.35; p.elL += -1.7; p.elR += -1.7;
          p.headX += -0.12 + g2 * 0.08; p.headY += g2 * 0.2; p.waistY += g2 * 0.15;
        } else if (u < 2.55) {
          // 굳는다 (정지)
          p.shLX += -1.2; p.shRX += -1.2; p.elL += -1.4; p.elR += -1.4; p.headX += -0.05;
          this.rattle = Math.max(this.rattle, 0.2);
        } else {
          // 무너짐
          const k2 = Math.min(1, (u - 2.55) / 0.85);
          p.shLX += -0.3 + 0.3 * k2; p.shRX += -0.3 + 0.3 * k2; p.elL += -0.3; p.elR += -0.3;
          p.waistX += 0.9 * k2; p.headX += 0.6 * k2; p.hipsY += -0.55 * k2;
          p.thighLX += -1.0 * k2; p.thighRX += -0.95 * k2; p.shinL += 1.7 * k2; p.shinR += 1.6 * k2;
          p.waistZ += Math.sin(t * 4) * 0.2 * k2;
        }
      } else if (k === 'coffeeBarrage') {
        // 커피를 연달아 맞는다: 팔로 얼굴 가리고 움찔움찔, 점점 뒤로 밀리다 마지막엔 미끄러져 넘어질 듯
        const u = 3.6 - this.ultVictimT;
        const T0 = 0.55, STEP = 0.05, N = 50;
        const n = Math.max(0, Math.min(N, Math.floor((u - T0 + 0.3) / STEP)));   // 컵 비행 0.3초 뒤 착탄
        const ph = u < T0 + 0.3 ? 0 : ((u - T0 - 0.3) % STEP) / STEP;
        const jolt = n > 0 && n < N ? Math.max(0, 1 - ph * 2.5) : 0;
        const wet = n / N;
        p.shLX += -1.7 - 0.3 * jolt; p.shRX += -1.5 - 0.3 * jolt; p.elL += -2.0; p.elR += -1.9; p.shLZ += 0.5; p.shRZ += -0.5;   // 얼굴 가리기
        p.headX += 0.35 * wet + 0.25 * jolt; p.headY += (n % 2 ? 1 : -1) * 0.2 * jolt; p.waistX += 0.2 * wet + 0.12 * jolt; p.waistZ += (n % 2 ? 1 : -1) * 0.12 * jolt;
        p.hipsY += -0.05 * wet - 0.03 * jolt; p.thighLX += -0.2 * wet; p.thighRX += -0.15 * wet; p.shinL += 0.3 * wet; p.shinR += 0.25 * wet;
        if (jolt > 0.5) this.rattle = Math.max(this.rattle, 0.35);
        if (u > 0.9 && u < T0 + STEP * N + 0.3) this.knock.addScaledVector(this.forward, -0.35 * dt);   // 조금씩 밀린다
        if (n >= N) { const k2 = Math.min(1, (u - T0 - STEP * N - 0.3) / 0.4); p.waistX += 0.5 * k2; p.headX += 0.4 * k2; p.hipsY += -0.25 * k2; p.shinL += 0.6 * k2; p.shinR += 0.6 * k2; this.rattle = Math.max(this.rattle, 0.5); }
      } else if (k === 'forge') {
        // 망치에 맞을 때마다 조금씩 땅으로 박힌다 (+20강이면 무릎까지) → 끝나면 눈 돌아가며 주저앉음
        const u = 3.3 - this.ultVictimT;
        const HIT0 = 0.45, STEP = 0.11, N = 20;
        const n = Math.max(0, Math.min(N, Math.floor((u - HIT0) / STEP) + 1));   // 지금까지 맞은 횟수
        const ph = u < HIT0 ? 0 : ((u - HIT0) % STEP) / STEP;
        const jolt = n > 0 && u < HIT0 + STEP * N ? Math.max(0, 1 - ph * 3) : 0;   // 맞은 직후 0.037초 동안 움찔
        const sink = n / N;
        p.hipsY += -0.42 * sink - 0.06 * jolt; p.headX += 0.35 * sink + 0.5 * jolt; p.waistX += 0.25 * sink + 0.2 * jolt;
        p.thighLX += -0.5 * sink; p.thighRX += -0.5 * sink; p.shinL += 0.9 * sink; p.shinR += 0.9 * sink;
        p.shLX += -0.9 + Math.sin(t * 25) * 0.5 * jolt; p.shRX += -0.9 - Math.sin(t * 25) * 0.5 * jolt; p.elL += -1.2; p.elR += -1.2;
        p.headY += Math.sin(t * 40) * 0.25 * jolt; p.headZ += (n % 2 ? 1 : -1) * 0.18 * jolt;
        if (jolt > 0.5) this.rattle = Math.max(this.rattle, 0.5);
        if (u >= HIT0 + STEP * N) { const k2 = Math.min(1, (u - HIT0 - STEP * N) / 0.4); p.headY += Math.sin(t * 8) * 0.6 * k2; p.waistZ += Math.sin(t * 5) * 0.25 * k2; this.rattle = Math.max(this.rattle, 0.6); }
      } else if (k === 'bike') {
        const u = 3.0 - this.ultVictimT;
        if (u < 1.4) { p.shLX += -1.6; p.shRX += -1.6; p.elL += -1.8; p.elR += -1.8; p.headX += -0.3; p.waistX += -0.15 + Math.sin(t * 18) * 0.05; }
        else { p.waistX += -0.8; p.headX += -0.5; p.shLX += 0.9; p.shRX += 0.9; this.rattle = Math.max(this.rattle, 0.8); if (!this._bikeHit) { this._bikeHit = true; this.knock.addScaledVector(this.forward, -7); this.audio.stagger(); } }
      }
      this.queue.length = 0;
      if (this.ultVictimT <= 0) {
        this.ultVictimT = 0; this.ultVictimKind = null; this._bikeHit = false; this.ultDmg = 0; this.ultDmgRate = 0; this._snackCry = 0;
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
        if (!this.danceStay) { const want = pr.pos.clone().addScaledVector(pr.forward, 0.95); this.pos.lerp(want, Math.min(1, dt * 8)); }
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
        this.danceT = 0; this.dancePartner = null; this.danceStay = false;
        if (this.danceVictim && !this.ko) { this.downT = this.downDur; this.hp = Math.max(0, this.hp - 6); if (this.hp <= 0) this._die(); }
        this.danceVictim = false;
      }
    }
    // ---- 피루엣 포즈: 발끝으로 서서 한 팔은 머리 위 곡선, 한 팔은 옆으로, 한 다리는 뒤로 뻗고 우아하게 돈다 ----
    if (this.sideDash) {
      const sd = this.sideDash, u = Math.min(1, sd.t / sd.dur), k = Math.sin(u * Math.PI), sgn = sd.dir.dot(this.side) > 0 ? 1 : -1;
      p.hipsY += 0.06 * k; p.hipsZ += sgn * 0.08 * k; p.waistZ += -sgn * 0.12 * k; p.chestX += -0.1 * k; p.headX += -0.15 * k; p.headZ += sgn * 0.12 * k;
      if (sgn > 0) { p.shLX += -2.9 * k; p.shLZ += 0.55 * k; p.elL += -0.7 * k; p.shRX += -1.3 * k; p.shRZ += -1.35 * k; p.elR += -0.25 * k; }
      else { p.shRX += -2.9 * k; p.shRZ += -0.55 * k; p.elR += -0.7 * k; p.shLX += -1.3 * k; p.shLZ += 1.35 * k; p.elL += -0.25 * k; }
      p.thighLX += (sgn > 0 ? 0.55 : -0.25) * k; p.thighRX += (sgn > 0 ? -0.25 : 0.55) * k; p.shinL += (sgn > 0 ? 0.9 : 0.15) * k; p.shinR += (sgn > 0 ? 0.15 : 0.9) * k;
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

    // 피격 스텝백: 뒷발이 끌리며 몸이 뒤로 밀린다
    if (this.hitStepT > 0) {
      this.hitStepT -= dt;
      const k2 = Math.max(0, this.hitStepT / 0.22);
      this.pos.addScaledVector(this.forward, -this.hitStep * 0.55 * dt * k2);
      p.thighLX += -0.22 * this.hitStep * k2; p.thighRX += 0.18 * this.hitStep * k2;
      p.shinL += 0.3 * this.hitStep * k2; p.hipsY += -0.05 * this.hitStep * k2;
      if (this.hitStepT <= 0) this.hitStep = 0;
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
      this.rig.root.rotation.x = lie * Math.PI * 0.5;    // 다운도 뒤로 넘어졌다가 일어난다
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
      this.koAngle += this.koSpin * dt; this.koSpin *= Math.exp(-dt * 3);
      if (this.koFly && this.airY > 0) {
        // 공중: 몸이 뒤로 젖혀지며 수평이 된다. 팔은 위로 휘날리고 다리는 앞으로 뜬다
        const u = Math.min(1, this.koT / 0.55), e = 1 - (1 - u) * (1 - u);
        this.rig.root.rotation.x = e * Math.PI * 0.55;   // 뒤통수가 먼저 바닥을 향하도록 살짝 더 젖힌다
        p.shLX = -1.5; p.shRX = -1.4; p.elL = -0.35; p.elR = -0.3; p.shLZ = 1.0; p.shRZ = -1.0;
        p.headX = -0.7; p.waistX = -0.25;
        p.thighLX = -0.55; p.thighRX = -0.75; p.shinL = 0.9; p.shinR = 0.7;
      } else {
        if (this.koFly) { this.koFly = false; this.koLandT = 0; this.koLift = 0.32; this.rattle = Math.max(this.rattle, 0.8); this.knock.multiplyScalar(0.35); }   // 착지음은 공중 물리(airY 착지)가 낸다
        if (this.koLandT >= 0) this.koLandT += dt;
        // 착지: 뒤통수를 찧고 튕겼다가 눕는다 (머리 쪽이 잠깐 들렸다 내려온다)
        const L = Math.max(0, this.koLandT), bounce = Math.sin(L * 15) * Math.exp(-L * 5.5) * 0.14;
        const settle = this.koLandT < 0 ? Math.min(1, this.koT / 0.75) : Math.min(1, L / 0.35), e = settle * settle;
        this.rig.root.rotation.x = this.koLandT >= 0 ? Math.PI * 0.5 + bounce + (1 - e) * Math.PI * 0.05 : e * Math.PI * 0.5;
        this.koLift = Math.max(0, this.koLift - dt * 1.6);
        p.hipsY += this.koLift * 0.6;
        this.knock.multiplyScalar(Math.exp(-dt * 3));
        // 팔다리가 툭 떨어진다
        const m = (a, b) => a + (b - a) * e;
        p.shLX = m(-1.5, 0.9); p.shRX = m(-1.4, 0.9); p.elL = m(-0.35, -0.5); p.elR = m(-0.3, -0.5); p.shLZ = m(1.0, 0.6); p.shRZ = m(-1.0, -0.6);
        p.headX = m(-0.7, -0.4); p.waistX = m(-0.25, 0);
        p.thighLX = m(-0.55, -0.2); p.thighRX = m(-0.75, -0.2); p.shinL = m(0.9, 0.5); p.shinR = m(0.7, 0.4);
      }
    } else if (this.fallT <= 0 && !(this.ko && this.fallY > 0.01)) { this.rig.root.rotation.x = 0; this.koAngle = 0; }

    this._applyNow(p);
    if (hitEvent) { this.combo++; this.comboTimer = 1.4; }
    return hitEvent;
  }

  _applyNow(p) {
    this.rig.root.position.set(this.pos.x, this.airY - (this.fallY || 0), this.pos.z);
    this.rig.root.rotation.y = this.yaw + this.koAngle + (this.spin || 0);
    applyPose(this.rig, p);
    this.updateWorldPoints();
  }

  // ---------- 네트워크 ----------
  snapshot() {
    const d = this.dempsey;
    let flags = 0;
    if (this.ko) flags |= 1; if (d.active) flags |= 2; if (d.maxSpeed) flags |= 4; if (this.guard) flags |= 8;
    if (this.stagger > 0) flags |= 16; if (this.finisher) flags |= 32; if (this.boostT > 0) flags |= 64; if (this.ropeCharge > 0) flags |= 128; if (this.downT > 0) flags |= 256; if (this.benched) flags |= 512; if (this.fallT > 0) flags |= 1024;
    const po = new Array(29);
    let i = 0; for (const k in this.pose) po[i++] = Math.round(this.pose[k] * 100);   // 0.01 단위 정수 (소수점 문자열보다 짧아 4인 60Hz 페이로드를 줄인다)
    return {
      x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), y: +(this.yaw + this.koAngle + (this.spin || 0)).toFixed(3), rx: +this.rig.root.rotation.x.toFixed(2), ay: +this.airY.toFixed(2),
      hp: +this.hp.toFixed(1), f: flags, fy: +(this.fallY || 0).toFixed(2),
      st: +Math.max(0, this.stagger).toFixed(2), sk: this.staggerKind === 'groggy' ? 2 : this.staggerKind === 'liver' ? 1 : 0, dI: +d.intensity.toFixed(3), sw: +d.sway.toFixed(3), sv: +d.swayVel.toFixed(2),
      bl: +d.blend.toFixed(2), ga: +d.gauge.toFixed(1), ch: d.charge, ra: +this.rattle.toFixed(2),
      ps: this.punch ? (this.punch.side === 'L' ? 1 : 2) : 0, pp: +this.punchProgress.toFixed(2),
      tg: this.target ? this.target.slot : -1, cb: this.combo, cu: +this.cd.U.toFixed(1), ci: +this.cd.I.toFixed(1),
      sm: +this.stam.toFixed(1), gb: +Math.max(0, this.guardBroken).toFixed(2), po,
    };
  }

  applySnapshot(a, b, t) {
    const L = (u, v) => u + (v - u) * t;
    this.koAngle = 0;
    this.pos.set(L(a.x, b.x), 0, L(a.z, b.z));
    this.airY = L(a.ay || 0, b.ay || 0);
    this.fallY = L(a.fy || 0, b.fy || 0);
    let dy = b.y - a.y; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.y + dy * t;
    this.rig.root.rotation.x = L(a.rx, b.rx);
    this.hp = L(a.hp, b.hp);
    const f = b.f;
    this.ko = !!(f & 1); this.guard = !!(f & 8);
    // 스태거는 실제 남은 시간까지 동기화 (예측/판정이 서버와 같은 기준을 쓰도록)
    this.stagger = b.st !== undefined ? b.st : ((f & 16) ? 1 : 0);
    this.staggerKind = b.sk === 2 ? 'groggy' : b.sk === 1 ? 'liver' : 'normal';
    this.finisher = (f & 32) ? { t: 0 } : null;
    this.boostT = (f & 64) ? 1 : 0; this.ropeCharge = (f & 128) ? 0.3 : 0; this.downT = (f & 256) ? 1 : 0;
    const bench = !!(f & 512);
    if (bench !== this.benched) { this.benched = bench; this.rig.root.visible = !bench; }
    this.falling = !!(f & 1024);   // 클라는 이 플래그로 낙하 중임을 안다 (높이는 fy)
    const d = this.dempsey;
    d.active = !!(f & 2); d.maxSpeed = !!(f & 4); d.intensity = L(a.dI, b.dI); d.sway = L(a.sw, b.sw); d.swayVel = L(a.sv, b.sv);
    d.blend = L(a.bl, b.bl); d.gauge = L(a.ga, b.ga); d.charge = b.ch;
    this.rattle = L(a.ra, b.ra);
    this.punch = b.ps ? { side: b.ps === 1 ? 'L' : 'R', t: L(a.pp, b.pp), dur: 1 } : null;
    this.targetSlot = b.tg; this.combo = b.cb; this.cd.U = b.cu || 0; this.cd.I = b.ci || 0;
    // 가드 게이지는 호스트가 권위를 가진다 — 클라는 보간 없이 받은 값을 그대로 쓴다
    if (b.sm !== undefined) this.stam = b.sm;
    if (b.gb !== undefined) this.guardBroken = b.gb;
    let i = 0; for (const k in this.pose) { this.pose[k] = L(a.po[i], b.po[i]) * 0.01; i++; }
    this._applyNow(this.pose);
  }
}
