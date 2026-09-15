// AfterImageEffect.js — 이전 프레임의 위치·회전·포즈를 링버퍼에 저장하고,
// 시간차를 둔 고스트 리그 4~8개가 따라오게 하는 잔상 시스템
import * as THREE from 'three';
import { buildBoxer, defaultPose, applyPose, copyPose, lerpPose, FIGHTER_SCALE } from './Rig.js';

const BUFFER = 180; // 약 3초 @60fps

export class AfterImageEffect {
  constructor(scene, charDef, maxGhosts = 8) {
    this.scene = scene;
    this.max = maxGhosts;
    this.ghosts = [];
    for (let i = 0; i < maxGhosts; i++) {
      // 오래된 잔상일수록 푸른 틴트 강하게 → 시간차가 색으로도 읽힘
      const tint = new THREE.Color().setHSL(0.56, 0.9, 0.7 + 0.2 * (i / maxGhosts));
      const rig = buildBoxer(charDef, { ghost: true, tint: tint.getHex() });
      rig.root.visible = false;
      rig.root.traverse((o) => { if (o.isMesh) o.renderOrder = -10 + i; });
      this.ghosts.push(rig);
    }
    // 스냅샷 링버퍼 (GC 회피용 사전 할당)
    this.snaps = [];
    for (let i = 0; i < BUFFER; i++) this.snaps.push({ t: -1, x: 0, y: 0, z: 0, yaw: 0, rx: 0, pose: defaultPose() });
    this.head = 0;   // 다음 쓰기 위치
    this.count = 0;
    this.tmpPose = defaultPose();
    this.visibleCount = 0;
    this.smoothCount = 0;
  }

  /** 매 시뮬레이션 프레임 호출: 현재 위치/회전/포즈를 저장 */
  record(time, pos, yaw, rx, pose) {
    const s = this.snaps[this.head];
    s.t = time; s.x = pos.x; s.y = pos.y; s.z = pos.z; s.yaw = yaw; s.rx = rx;
    copyPose(pose, s.pose);
    this.head = (this.head + 1) % BUFFER;
    this.count = Math.min(BUFFER, this.count + 1);
  }

  _snapAt(k) { // k=0 최신
    return this.snaps[(this.head - 1 - k + BUFFER * 2) % BUFFER];
  }

  /** 시각 tt 에 해당하는 보간 스냅샷을 out 에 채움. 성공 여부 반환 */
  _sample(tt, out) {
    if (this.count < 2) return false;
    let newer = this._snapAt(0);
    if (tt >= newer.t) { this._copySnap(newer, out); return true; }
    for (let k = 1; k < this.count; k++) {
      const older = this._snapAt(k);
      if (older.t <= tt) {
        const span = newer.t - older.t;
        const a = span > 1e-6 ? (tt - older.t) / span : 0;
        out.x = older.x + (newer.x - older.x) * a;
        out.y = older.y + (newer.y - older.y) * a;
        out.z = older.z + (newer.z - older.z) * a;
        let dy = newer.yaw - older.yaw;
        if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
        out.yaw = older.yaw + dy * a;
        out.rx = older.rx + (newer.rx - older.rx) * a;
        lerpPose(older.pose, newer.pose, a, out.pose);
        return true;
      }
      newer = older;
    }
    this._copySnap(newer, out);
    return true;
  }

  _copySnap(s, out) { out.x = s.x; out.y = s.y; out.z = s.z; out.yaw = s.yaw; out.rx = s.rx; copyPose(s.pose, out.pose); }

  /**
   * @param time      시뮬레이션 시간
   * @param count     보여줄 잔상 수 (0..max)
   * @param interval  잔상 간 시간차 (s)
   * @param strength  전체 불투명도 배율
   */
  update(time, count, interval, strength = 1) {
    // 개수 변화는 부드럽게 (갑자기 사라지지 않도록)
    this.smoothCount += (count - this.smoothCount) * 0.25;
    const n = Math.min(this.max, Math.round(this.smoothCount));
    this.visibleCount = n;
    const out = { x: 0, y: 0, z: 0, yaw: 0, rx: 0, pose: this.tmpPose };
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      // 안 보이는 고스트는 씬에서 떼어내 매 프레임 행렬 갱신 비용까지 없앤다
      if (i >= n) { if (g.root.parent) this.scene.remove(g.root); continue; }
      const tt = time - (i + 1) * interval;
      if (!this._sample(tt, out)) { if (g.root.parent) this.scene.remove(g.root); continue; }
      if (!g.root.parent) this.scene.add(g.root);
      g.root.visible = true;
      g.root.position.set(out.x, out.y, out.z);
      g.root.rotation.set(out.rx, out.yaw, 0);
      applyPose(g, out.pose);
      // 오래될수록 투명 + 약간 팽창(흐릿한 느낌) + 외곽선 두꺼워짐
      const age = (i + 1) / (n + 1);
      const op = strength * (0.62 * Math.pow(1 - age, 1.3) + 0.06);
      g.setOpacity(op);
      g.setOutline(0.014 + 0.012 * age);
      // 본체와 같은 축척(FIGHTER_SCALE)을 쓰고, 오래될수록 아주 살짝만 팽창
      const sc = FIGHTER_SCALE * (1 + 0.035 * age);
      g.root.scale.set(sc, sc, sc);
    }
  }
}
