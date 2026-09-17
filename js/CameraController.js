// CameraController.js — 애니메이션 컷 같은 동적 카메라
// 평상시: 두 복서가 보이는 3/4 뷰 / 뎀프시롤: 상대 어깨 너머 로우앵글로 스윕 / 히트: 킥 + 줌 + 셰이크
import * as THREE from 'three';

const _mid = new THREE.Vector3();
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _l2 = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _look = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraController {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(4, 2, 4);
    this.look = new THREE.Vector3(0, 1, 0);
    this.blend = 0;
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.kick = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();
    this.fovBase = 56;
    this.fovPunch = 0;
    this.initialized = false;
    this.rollKick = 0;
  }

  onHit(dir, power) {
    // 타격 방향으로 밀렸다가 스프링으로 복귀
    this.kickVel.addScaledVector(dir, 3.5 + 5 * power);
    this.kickVel.y += 0.8 * power;
    this.shakeAmp = Math.max(this.shakeAmp, 0.05 + 0.11 * power);
    this.fovPunch = -(5 + 9 * power);
    this.rollKick = (Math.random() > 0.5 ? 1 : -1) * (0.02 + 0.04 * power);
  }

  onCounter(dir) {
    this.kickVel.addScaledVector(dir, 9);
    this.kickVel.y += 1.5;
    this.shakeAmp = 0.28;
    this.fovPunch = -20;
    this.rollKick = (Math.random() > 0.5 ? 1 : -1) * 0.11;
  }

  onPlayerHit() {
    this.shakeAmp = Math.max(this.shakeAmp, 0.06);
    this.fovPunch = 3;
  }

  /**
   * ctx: { playerPos, oppPos, f(플레이어→상대 단위벡터), s(플레이어 왼쪽), intensity, dempseyActive, sway, maxSpeed, hitStop, blendOverride }
   */
  update(dt, ctx) {
    const { playerPos, oppPos, f, s } = ctx;
    const target = ctx.dempseyActive ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt * (ctx.dempseyActive ? 3.2 : 2.2));
    const b = this.blend * this.blend * (3 - 2 * this.blend);
    const I = ctx.intensity;

    // --- 추적 카메라: 내 캐릭터 바로 뒤 (살짝 오른쪽), 시선은 나와 타겟 사이 → 둘 다 프레임에 ---
    // 시야 방향(yaw)은 경기 시작 때 상대를 바라본 방향으로 고정한다. 상대가 돌아다녀도, 타겟이 바뀌어도 돌지 않는다
    // (매번 따라 돌면 시야가 왔다갔다 하고 WASD 방향도 같이 바뀐다). 상대가 거의 등 뒤(110°+)로 간 채 1초 넘게 머물 때만 천천히 따라간다.
    const wantYaw = Math.atan2(f.x, f.z);
    if (!this.initialized || this.orbitYaw === undefined) { this.orbitYaw = wantYaw; this._offT = 0; }
    else {
      let dy = wantYaw - this.orbitYaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this._offT = Math.abs(dy) > 1.9 ? (this._offT || 0) + dt : 0;
      if (this._offT > 1.2) { const maxTurn = 0.8 * dt; this.orbitYaw += Math.max(-maxTurn, Math.min(maxTurn, dy)); }
    }
    const bx = Math.sin(this.orbitYaw), bz = Math.cos(this.orbitYaw);     // 부드러운 전방
    const sx = bz, sz = -bx;                                               // 부드러운 좌측
    // 살짝 대각선(오른쪽 뒤)에서 → 내 몸이 상대를 가리지 않는다. 내 캐릭터는 화면 왼쪽 아래, 상대는 중앙
    const dist = 3.1 - 0.4 * b, height = 2.15 - 0.45 * b, sideOff = 1.2 - 0.2 * b;   // 캐릭터 70% 축소에 맞춰 카메라도 당긴다
    _p.copy(playerPos).addScaledVector(new THREE.Vector3(bx, 0, bz), -dist).addScaledVector(new THREE.Vector3(sx, 0, sz), -sideOff).addScaledVector(UP, height);
    // 시선: 나와 타겟 사이 45% 지점 (타겟이 멀면 더 멀리)
    _mid.copy(playerPos).lerp(oppPos, 0.55);
    _l.copy(_mid).addScaledVector(UP, 0.75).addScaledVector(new THREE.Vector3(sx, 0, sz), ctx.sway * 0.12 * b);
    // 카메라가 로프 밖으로 나가 로프가 화면을 가로지르지 않도록 링 안쪽으로 클램프
    _p.x = Math.max(-4.5, Math.min(4.5, _p.x)); _p.z = Math.max(-4.5, Math.min(4.5, _p.z));
    _p2.copy(_p); _l2.copy(_l);

    _p.lerp(_p2, b);
    _l.lerp(_l2, b);

    const kp = 1 - Math.exp(-dt * 6.5);
    const kl = 1 - Math.exp(-dt * 9);
    if (!this.initialized) { this.pos.copy(_p); this.look.copy(_l); this.initialized = true; }
    this.pos.lerp(_p, kp);
    this.look.lerp(_l, kl);

    // --- 킥 스프링 ---
    this.kickVel.addScaledVector(this.kick, -220 * dt);
    this.kickVel.multiplyScalar(Math.exp(-dt * 16));
    this.kick.addScaledVector(this.kickVel, dt);

    // --- 셰이크 (MAX SPEED 중 상시 미세 진동) ---
    this.shakeT += dt * 60;
    const base = ctx.maxSpeed ? 0.014 : ctx.dempseyActive ? 0.004 * I : 0;
    this.shakeAmp = Math.max(base, this.shakeAmp * Math.exp(-dt * 7));
    const a = this.shakeAmp;
    _shake.set(
      Math.sin(this.shakeT * 1.7) * 0.6 + Math.sin(this.shakeT * 3.9) * 0.4,
      Math.cos(this.shakeT * 2.3) * 0.6 + Math.sin(this.shakeT * 5.1) * 0.4,
      Math.sin(this.shakeT * 1.1) * 0.3,
    ).multiplyScalar(a);
    this.rollKick *= Math.exp(-dt * 9);

    // --- FOV: 뎀프시롤 중 살짝 망원 + 히트 줌 ---
    this.fovPunch *= Math.exp(-dt * 9);
    const fov = this.fovBase - 4 * b * I + this.fovPunch;

    // ctx.apply === false: 낙사 카메라처럼 바깥에서 카메라를 직접 잡는 구간.
    // 위의 스프링·셰이크·FOV 감쇠는 그대로 돌려 두고 카메라에 쓰는 것만 건너뛴다.
    // (여기서 통째로 return 해버리면 제어권이 돌아올 때 킥·셰이크가 그대로 남아 화면이 튄다)
    if (ctx.apply === false) return;

    this.cam.position.copy(this.pos).add(this.kick).add(_shake);
    _look.copy(this.look).addScaledVector(_shake, 0.4);
    this.cam.up.set(Math.sin(this.rollKick), Math.cos(this.rollKick), 0);
    this.cam.lookAt(_look);
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }
}
