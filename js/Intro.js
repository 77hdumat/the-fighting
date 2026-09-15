// Intro.js — 경기 시작 연출: 선수들이 코너에서 걸어 나와 포즈(삿대질 → 주먹 들기)를 취하며 자기소개 대사를 읊고,
// 스킵되거나 끝나면 각자 자리에서 3초 카운트다운 → 공(종) 소리와 함께 시작. 모든 클라이언트가 로컬로 동일 타임라인 재생.
import * as THREE from 'three';
import { defaultPose, applyPose, copyPose } from './Rig.js';
import { easeOutCubic, easeInOut } from './Punch.js';
import { HIDDEN_LINES } from './Specials.js';

const PER = 4.4;          // 선수 1명당 연출 시간 (걸어나오기 → 클로즈업 멘트 → 포즈 홀드)
const WALK = 1.3;         // 걸어 나오는 시간
// 링 안쪽 자기 코너(로프 안)에서 걸어 나온다
const CORNERS = [[2.45, 2.45], [-2.45, -2.45], [2.45, -2.45], [-2.45, 2.45]];

export class Intro {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.t = 0;
    this.idx = -1;
    this.done = false;
    this.pose = defaultPose();
    this.spawns = [];
    this.starts = [];
    this.center = new THREE.Vector3(0, 0, 0);
  }

  start() {
    const fs = this.g.fighters;
    this.active = true; this.done = false; this.t = 0; this.idx = -1; this.spoken = new Set(); this.threw = false; this.revved = false;
    this.spawns = fs.map((f) => f.pos.clone());
    this.starts = fs.map((f, i) => new THREE.Vector3(CORNERS[i % 4][0], 0, CORNERS[i % 4][1]));
    // 전원 코너로 (링 밖) 이동시켜 대기
    fs.forEach((f, i) => { f.pos.copy(this.starts[i]); f._applyNow(f.pose); });
  }

  get total() { return this.g.fighters.length * PER; }

  /** @returns true 면 인트로 종료 */
  update(dt) {
    if (!this.active) return false;
    this.t += dt;
    const fs = this.g.fighters;
    const g = this.g;
    const idx = Math.min(fs.length - 1, Math.floor(this.t / PER));
    const local = this.t - idx * PER;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      const p = copyPose(defaultPose(), this.pose);
      const start = this.starts[i], end = this.spawns[i];
      const toC = new THREE.Vector3().subVectors(this.center, end).setY(0).normalize();
      if (i < idx) {
        // 이미 등장한 선수: 제자리에서 가드 자세로 대기
        f.pos.copy(end);
        f.forward.copy(toC);
      } else if (i === idx) {
        if (local < WALK) {
          // 걸어 나오기 (달리듯)
          const k = easeInOut(local / WALK);
          f.pos.lerpVectors(start, end, k);
          f.forward.subVectors(end, start).setY(0).normalize();
          const ph = local * 9;
          p.thighLX += Math.sin(ph) * 0.6; p.thighRX += -Math.sin(ph) * 0.6;
          p.shinL += Math.max(0, -Math.sin(ph)) * 0.9; p.shinR += Math.max(0, Math.sin(ph)) * 0.9;
          p.hipsY += Math.abs(Math.sin(ph * 2)) * 0.04; p.waistX += 0.12;
          p.shLX += Math.sin(ph) * 0.3; p.shRX += -Math.sin(ph) * 0.3; p.elL += 0.6; p.elR += 0.6;
        } else {
          f.pos.copy(end);
          f.forward.copy(toC);
          const u = local - WALK;                 // 0 .. PER-WALK (2.3s)
          const key = f.defKey;
          if (key === 'chaechae') {
            // 채채더킴: 브이 + 살짝 기울인 고개 → 셀카 찍듯 손 뻗기
            const k = easeOutCubic(Math.min(1, u / 0.4));
            p.shRX += (-2.25 - p.shRX) * k; p.shRY += (0.35 - p.shRY) * k; p.shRZ += (-0.25 - p.shRZ) * k; p.elR += (-1.5 - p.elR) * k;
            p.headZ += 0.3 * k; p.headY += 0.18 * k; p.waistY += 0.2 * k; p.hipsX += 0.05 * k;
            p.hipsY += Math.abs(Math.sin(u * 7)) * 0.05 * k;
            if (u > 1.1) { const k2 = easeOutCubic(Math.min(1, (u - 1.1) / 0.35)); p.shLX += (-1.9 - p.shLX) * k2; p.elL += (-0.9 - p.elL) * k2; p.shLY += (-0.35) * k2; }
          } else if (key === 'jjeonghyo') {
            // 쩡효: 바벨을 머리 위로 들었다가 앞으로 내던짐
            if (u < 1.0) {
              const k = easeOutCubic(Math.min(1, u / 0.45));
              p.shLX += (-2.9 - p.shLX) * k; p.shRX += (-2.9 - p.shRX) * k; p.elL += (-0.3 - p.elL) * k; p.elR += (-0.3 - p.elR) * k;
              p.shLZ += 0.5 * k; p.shRZ += -0.5 * k; p.waistX += -0.22 * k; p.thighLX += -0.25 * k; p.thighRX += -0.25 * k; p.shinL += 0.4 * k; p.shinR += 0.4 * k;
            } else {
              const k = easeOutCubic(Math.min(1, (u - 1.0) / 0.25));
              p.shLX += (-1.0 - p.shLX) * k; p.shRX += (-1.0 - p.shRX) * k; p.elL += (-0.2 - p.elL) * k; p.elR += (-0.2 - p.elR) * k;
              p.waistX += 0.45 * k; p.chestX += 0.2 * k; p.headX += 0.2 * k; p.hipsY += -0.12 * k;
              if (!this.threw) { this.threw = true; try { g.audio.clang(1.1); } catch (e) {} }
            }
          } else if (key === 'ohsh') {
            // 오승현: 빵을 오물오물 먹다가 흠칫 → 소심하게 고개 숙여 인사
            const k = easeOutCubic(Math.min(1, u / 0.4));
            p.shLX += (-2.0 - p.shLX) * k; p.elL += (-2.3 - p.elL) * k; p.shLY += (-0.35) * k;
            p.headX += (0.18 + Math.sin(u * 14) * 0.06) * k;      // 오물오물
            p.shRX += (-0.7 - p.shRX) * k; p.elR += (-1.4 - p.elR) * k;
            if (u > 1.2) { const k2 = easeOutCubic(Math.min(1, (u - 1.2) / 0.3)); p.waistX += 0.45 * k2; p.headX += 0.35 * k2; p.hipsY += -0.08 * k2; }
          } else if (key === 'jungjuwon') {
            // 정주원: 커피를 쭉 들이켜고 만족 (헤드폰 매만지기)
            const k = easeOutCubic(Math.min(1, u / 0.45));
            p.shRX += (-2.1 - p.shRX) * k; p.elR += (-2.4 - p.elR) * k; p.shRY += (0.25) * k;
            p.headX += (-0.35) * k;
            if (u > 1.1) {
              const k2 = easeOutCubic(Math.min(1, (u - 1.1) / 0.35));
              p.shRX += (1.0) * k2; p.headX += (0.45) * k2;        // 컵 내리고 흡족
              p.shLX += (-1.9 - p.shLX) * k2; p.elL += (-2.2 - p.elL) * k2; p.shLY += (-0.5) * k2;   // 헤드폰 매만짐
              p.chestZ += Math.sin(u * 5) * 0.05 * k2;
            }
          } else if (key === 'gokomong') {
            // 고코몽: 무표정, 손 주머니에 넣듯 늘어뜨리고 한 번 끄덕
            const k = easeOutCubic(Math.min(1, u / 0.5));
            p.shLX += (-0.35 - p.shLX) * k; p.shRX += (-0.32 - p.shRX) * k; p.elL += (-0.55 - p.elL) * k; p.elR += (-0.5 - p.elR) * k;
            p.waistX += -0.05 * k; p.headX += -0.02 * k;
            if (u > 1.3) { const k2 = Math.min(1, (u - 1.3) / 0.25); p.headX += 0.3 * k2 * Math.max(0, 1 - (u - 1.55) * 4); }
          } else if (key === 'ppyeo') {
            // 뼈석원: 한 손으로 배를 문지르며 씩 웃기 → 시동 거는 손목 스냅
            const k = easeOutCubic(Math.min(1, u / 0.4));
            p.shRX += (-0.35 - p.shRX) * k; p.elR += (-2.3 - p.elR) * k; p.shRY += (0.5 - p.shRY) * k;
            p.chestZ += Math.sin(u * 5) * 0.06 * k; p.waistY += Math.sin(u * 3) * 0.12 * k;
            p.headX += -0.12 * k; p.hipsX += Math.sin(u * 2.2) * 0.04 * k;
            if (u > 1.2) {
              const k2 = easeOutCubic(Math.min(1, (u - 1.2) / 0.3));
              p.shLX += (-1.5 - p.shLX) * k2; p.elL += (-1.7 - p.elL) * k2;
              p.shLZ += Math.sin(u * 26) * 0.12 * k2;   // 부릉부릉 손목
              if (!this.revved) { this.revved = true; try { g.audio.engine(1.1); } catch (e) {} }
            }
          } else if (u < 1.0) {
            // 삿대질: 오른팔을 앞으로 쭉 뻗어 상대를 가리킨다, 턱 들기
            const k = easeOutCubic(Math.min(1, u / 0.35));
            p.shRX += (-1.7 - p.shRX) * k; p.shRY += (0.05 - p.shRY) * k; p.shRZ += (0.0 - p.shRZ) * k; p.elR += (-0.05 - p.elR) * k;
            p.waistY += 0.35 * k; p.chestY += 0.2 * k; p.headX += -0.2 * k; p.hipsZ += 0.12 * k;
            p.shLX += 0.4 * k; p.elL += 0.5 * k;
            p.shRX += Math.sin(u * 30) * 0.03 * k;   // 손끝 떨림
          } else {
            // 주먹 들어 올리기 "이겨주겠다": 양팔 위로, 가슴 펴기, 살짝 점프
            const k = easeOutCubic(Math.min(1, (u - 1.0) / 0.35));
            p.shLX += (-2.7 - p.shLX) * k; p.shRX += (-2.7 - p.shRX) * k;
            p.shLY += (-0.2 - p.shLY) * k; p.shRY += (0.2 - p.shRY) * k;
            p.shLZ += (0.35 - p.shLZ) * k; p.shRZ += (-0.35 - p.shRZ) * k;
            p.elL += (-0.6 - p.elL) * k; p.elR += (-0.6 - p.elR) * k;
            p.waistX += -0.25 * k; p.headX += -0.35 * k; p.chestZ += Math.sin(u * 8) * 0.05 * k;
            p.hipsY += Math.max(0, Math.sin((u - 1.0) * 6)) * 0.12 * k;
          }
        }
      } else {
        // 아직 등장 전: 코너에서 대기 (팔짱)
        f.pos.copy(start);
        f.forward.subVectors(this.center, start).setY(0).normalize();
        p.shLX = -0.9; p.elL = -2.4; p.shLY = -1.05; p.shRX = -0.85; p.elR = -2.4; p.shRY = 1.05;
      }
      f.yaw = Math.atan2(f.forward.x, f.forward.z);
      f.side.set(f.forward.z, 0, -f.forward.x);
      copyPose(p, f.pose);
      f._applyNow(f.pose);
    }
    // 자기소개 대사 (선수당 1회, 걸어 나온 직후)
    if (idx !== this.idx) { this.idx = idx; }
    if (!this.spoken.has(idx) && local >= WALK * 0.7) {
      this.spoken.add(idx);
      const f = fs[idx];
      const hid = HIDDEN_LINES[f.defKey];
      const line = f.intro || (hid && hid.intro) || ({ ippo: '…やります。全力で！', mashiba: '…殺す気で来い。', miyata: '見切ってやる。', sendo: 'ぶっ飛ばしたるわ！' })[f.defKey] || '…';
      g.subs.show(line, { duration: PER - WALK * 0.7, mid: true, speaker: f.slot === g.localSlot ? 'player' : 'opp', charKey: f.defKey, voice: true });
      g.introName(f);
      g.coaches.shout(f.slot, 1.2);
    }
    // ---- 카메라: 한 명씩 줌 인 (와이드 → 상반신 클로즈업 → 포즈에서 살짝 빠짐) ----
    const f = fs[idx];
    const u = Math.max(0, local - WALK * 0.55);              // 걸어나오는 중반부터 붙는다
    const zin = easeOutCubic(Math.min(1, u / 1.15));          // 줌 인
    const zout = Math.max(0, (local - (PER - 0.75)) / 0.75);  // 다음 선수로 넘어가기 직전 살짝 빠짐
    const dist = 3.4 - 2.05 * zin + 0.7 * zout;               // 3.4m → 1.35m
    const ang = 0.72 - local * 0.1;                           // 천천히 도는 3/4 앵글
    const hy = 1.34 + 0.16 * zin;                             // 얼굴 높이
    const camPos = f.pos.clone()
      .addScaledVector(f.forward, dist * Math.cos(ang))
      .addScaledVector(f.side, dist * Math.sin(ang))
      .add(new THREE.Vector3(0, hy, 0));
    const look = f.pos.clone().add(new THREE.Vector3(0, 1.02 + 0.22 * zin, 0));
    g.camera.position.lerp(camPos, Math.min(1, dt * (3 + 3 * zin)));
    g.camera.lookAt(look);
    // 렌즈: 멀리선 넓게, 붙으면 망원 느낌 (인물이 도드라진다)
    const wantFov = 52 - 14 * zin + 6 * zout;
    g.camera.fov += (wantFov - g.camera.fov) * Math.min(1, dt * 5);
    g.camera.updateProjectionMatrix();
    // 주인공만 또렷하게 — 나머지는 흐리게 (등장 순서가 분명해진다)
    for (let i = 0; i < fs.length; i++) fs[i].setFade(i === idx ? 1 : 0.22 + 0.18 * (1 - zin));
    if (this.t >= this.total) { this.finish(); return true; }
    return false;
  }

  finish() {
    if (!this.active) return;
    this.active = false; this.done = true;
    const fs = this.g.fighters;
    fs.forEach((f) => f.setFade(1));
    this.g.camera.fov = 50; this.g.camera.updateProjectionMatrix();
    fs.forEach((f, i) => { f.pos.copy(this.spawns[i]); f.forward.subVectors(this.center, f.pos).setY(0).normalize(); f.yaw = Math.atan2(f.forward.x, f.forward.z); copyPose(defaultPose(), f.pose); f._applyNow(f.pose); });
  }
}
