// LaserFx.js — 우랄라 레이저 탄 연출. 호스트가 'shot'/'shotEnd' 이벤트를 내면(로컬·게스트 모두) 여기서 그린다.
// 판정은 Fighter.shots(호스트)가 하고, 이건 순수 시각용. 탄마다 밝은 코어 + 넓은 글로우 두 겹.
import * as THREE from 'three';

const SPEED = 14;   // Fighter.js 의 탄속과 같아야 착탄 지점이 맞는다

export class LaserFx {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.live = new Map();   // id → bolt
    this.coreGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.62, 8);
    this.coreGeo.rotateX(Math.PI / 2);
    this.glowGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.78, 8);
    this.glowGeo.rotateX(Math.PI / 2);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    this.glowMatPink = new THREE.MeshBasicMaterial({ color: 0xff5fd0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMatBlue = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    // 예열: 첫 발사 때 셰이더 컴파일로 멈추지 않게 하나 만들어 숨겨 둔다
    const w = this._make(); w.group.position.set(0, -50, 0); w.group.visible = true; w.group.traverse((o) => { o.frustumCulled = false; });
    this.pool.push(w);
  }

  _make() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.coreGeo, this.coreMat);
    const glow = new THREE.Mesh(this.glowGeo, this.glowMatPink);
    group.add(core, glow);
    group.visible = false;
    this.scene.add(group);
    return { group, core, glow, t: 0, dir: new THREE.Vector3() };
  }

  fire(e) {
    let b = this.pool.pop() || this._make();
    b.group.visible = true;
    b.group.position.set(e.x, e.y, e.z);
    b.dir.set(e.dx, 0, e.dz).normalize();
    b.group.lookAt(b.group.position.clone().add(b.dir));
    b.glow.material = e.hook ? this.glowMatBlue : this.glowMatPink;
    b.group.scale.setScalar(e.hook ? 1.35 : 1);
    b.t = 0;
    if (this.live.has(e.id)) this.end(e.id);
    this.live.set(e.id, b);
  }

  end(id) {
    const b = this.live.get(id); if (!b) return;
    this.live.delete(id);
    b.group.visible = false;
    this.pool.push(b);
  }

  update(dt) {
    for (const [id, b] of this.live) {
      b.t += dt;
      b.group.position.addScaledVector(b.dir, SPEED * dt);
      b.core.scale.x = 1 + Math.sin(b.t * 40) * 0.25;
      if (b.t > 0.75) this.end(id);   // 호스트의 shotEnd 를 못 받았을 때의 안전장치
    }
  }

  clear() { for (const id of [...this.live.keys()]) this.end(id); }
}
