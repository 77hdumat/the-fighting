// Coaches.js — 링 밖 코너에 서 있는 코치 NPC 4명. 파이터 슬롯별 담당 코치가 있고, 코치 대사가 나올 때 팔을 들고 외친다.
import * as THREE from 'three';
import { buildBoxer, defaultPose, applyPose, copyPose, COACH_DEFS } from './Rig.js';

const CORNERS = [[5.6, 5.6], [-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6]];

export class Coaches {
  constructor(scene) {
    this.list = COACH_DEFS.map((def, i) => {
      const rig = buildBoxer(def);
      const [x, z] = CORNERS[i];
      rig.root.position.set(x, -0.72, z);
      rig.root.rotation.y = Math.atan2(-x, -z);
      // 스포트라이트 밖이라 어두우니 살짝 자체 발광
      for (const m of rig.bodyMats) if (m.emissive) m.emissive.setRGB(0.16, 0.14, 0.13);
      scene.add(rig.root);
      const pose = defaultPose();
      return {
      rig, pose, phase: Math.random() * 6.28, shout: 0, x, z };
    });
    this.t = 0;
  }

  /** 코치 전체 표시/숨김 (암벽 맵에선 숨긴다) */
  setVisible(v) { for (const c of this.list) c.rig.root.visible = v; }

  /** 슬롯의 담당 코치가 외친다 */
  shout(slot, sec = 2.2) { const c = this.list[slot % this.list.length]; if (c) c.shout = sec; }

  update(dt, excitement = 0) {
    this.t += dt;
    for (const c of this.list) {
      const p = copyPose(defaultPose(), c.pose);
      const t = this.t + c.phase;
      // 기본: 팔짱 끼고 서 있기, 살짝 흔들림
      p.shLX = -0.9; p.elL = -2.4; p.shLY = -1.05; p.shLZ = 0.15;
      p.shRX = -0.85; p.elR = -2.4; p.shRY = 1.05; p.shRZ = -0.15;
      p.waistX = 0.05; p.headX = 0.05; p.hipsRotY = 0;
      p.thighLX = -0.08; p.thighRX = 0.08; p.thighLZ = 0.16; p.thighRZ = -0.16; p.shinL = 0.1; p.shinR = 0.1;
      p.hipsY += Math.sin(t * 1.3) * 0.01; p.waistZ += Math.sin(t * 0.9) * 0.03; p.headY += Math.sin(t * 0.6) * 0.15;
      // 흥분하면 몸을 앞으로 내밀고 주먹을 쥔 채 흔든다
      if (excitement > 0.4) { const e = (excitement - 0.4) / 0.6; p.waistX += 0.25 * e; p.shRX += Math.sin(t * 9) * 0.25 * e; p.hipsY += Math.abs(Math.sin(t * 6)) * 0.03 * e; }
      if (c.shout > 0) {
        // 외치기: 오른팔 번쩍, 왼손은 입가, 상체 앞으로, 몸 떨림
        c.shout -= dt;
        const k = Math.min(1, c.shout / 0.3);
        p.shRX = -2.6; p.elR = -0.6; p.shRY = 0.2; p.shRZ = -0.6;
        p.shLX = -1.6; p.elL = -2.6; p.shLY = -0.9; p.shLZ = 0.4;
        p.waistX = 0.35; p.headX = -0.15 + Math.sin(t * 25) * 0.05 * k; p.hipsY -= 0.06;
        p.shRX += Math.sin(t * 22) * 0.15 * k;
      }
      applyPose(c.rig, p);
    }
  }
}
