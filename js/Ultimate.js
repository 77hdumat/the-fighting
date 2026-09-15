// Ultimate.js — 히든 캐릭터 필살기 3D 연출 (겟앰프드처럼 화면에 확실히 보이게)
// chaechae: 하늘에서 유물·미술품 무더기 낙하 / jjeonghyo: 데드리프트 랙에 가두고 운동시킨 뒤 바벨에 깔림 / ppyeo: 오토바이를 놓쳐 던짐
import * as THREE from 'three';

const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// 링 조명은 바닥 근처만 비추므로, 낙하물은 자체 발광을 섞어 어디서든 또렷하게 보이게 한다
const TOON = (c, opts = {}) => {
  const col = new THREE.Color(c);
  return new THREE.MeshToonMaterial({ color: c, emissive: col.clone().multiplyScalar(0.55), ...opts });
};

function outlined(geo, color, group, pos, scale = 1) {
  const m = new THREE.Mesh(geo, TOON(color));
  if (pos) m.position.copy(pos);
  m.scale.setScalar(scale);
  m.castShadow = true;
  group.add(m);
  return m;
}

// ---- 낙하물: 도자기 / 액자 / 석상 / 두루마리 ----
function makeArtifact(i) {
  const g = new THREE.Group();
  const kind = i % 4;
  if (kind === 0) {           // 청자 도자기
    const body = outlined(new THREE.LatheGeometry([
      new THREE.Vector2(0.001, -0.22), new THREE.Vector2(0.11, -0.16), new THREE.Vector2(0.16, 0.0),
      new THREE.Vector2(0.1, 0.14), new THREE.Vector2(0.13, 0.2), new THREE.Vector2(0.08, 0.24),
    ], 14), 0x4a9d8f, g);
    outlined(new THREE.TorusGeometry(0.1, 0.014, 6, 16), 0xe8d7a6, g, new THREE.Vector3(0, 0.06, 0));
  } else if (kind === 1) {    // 금빛 액자 그림
    const frame = outlined(new THREE.BoxGeometry(0.46, 0.34, 0.035), 0xd9a441, g);
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.26), TOON(0xf3e9d2));
    canvas.position.z = 0.02; frame.add(canvas);
    const paint = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), TOON(0x3f6fb5));
    paint.position.set(-0.06, 0.02, 0.003); canvas.add(paint);
    const paint2 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), TOON(0xc0572f));
    paint2.position.set(0.08, -0.05, 0.003); canvas.add(paint2);
  } else if (kind === 2) {    // 대리석 흉상
    outlined(new THREE.CylinderGeometry(0.13, 0.17, 0.16, 10), 0xe9e6de, g, new THREE.Vector3(0, -0.16, 0));
    outlined(new THREE.SphereGeometry(0.12, 14, 10), 0xf1efe8, g, new THREE.Vector3(0, 0.02, 0));
    outlined(new THREE.BoxGeometry(0.1, 0.09, 0.14), 0xf1efe8, g, new THREE.Vector3(0, -0.06, 0.02));
  } else {                    // 두루마리 / 고서
    const b = outlined(new THREE.BoxGeometry(0.3, 0.38, 0.07), 0x8a2b2b, g);
    outlined(new THREE.BoxGeometry(0.27, 0.35, 0.08), 0xf6f1e2, b, new THREE.Vector3(0.012, 0, 0.002));
  }
  return g;
}

export class UltimateFx {
  constructor(scene, audio, fx) {
    this.scene = scene; this.audio = audio; this.fx = fx;
    this.active = [];
  }

  /** kind: 'reels' | 'barbell' | 'bike' */
  play(kind, attacker, target) {
    if (!target) return;
    const root = new THREE.Group();
    this.scene.add(root);
    const item = { kind, root, t: 0, dur: 3.2, parts: [], attacker, target, tp: target.pos.clone() };
    if (kind === 'reels') this._buildArtifacts(item);
    else if (kind === 'barbell') this._buildRack(item);
    else if (kind === 'bike') this._buildBike(item, attacker);
    this.active.push(item);
  }

  _buildArtifacts(item) {
    // 표적 위 하늘에서 24개가 시간차로 쏟아진다
    for (let i = 0; i < 34; i++) {
      const a = makeArtifact(i);
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * 1.15;
      a.position.set(item.tp.x + Math.cos(ang) * rr, 5.2 + Math.random() * 4.2, item.tp.z + Math.sin(ang) * rr);
      a.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      a.scale.setScalar(1.15 + Math.random() * 0.75);
      item.root.add(a);
      item.parts.push({ m: a, delay: 0.1 + i * 0.062, vy: 0, spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), landed: 0 });
    }
  }

  _buildRack(item) {
    // 데드리프트 랙: 기둥 4개 + 상단 바 + 바벨 (상대를 가둔다)
    const g = item.root;
    g.position.copy(item.tp);
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2.3, 10);
    for (const [x, z] of [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]]) {
      const p = outlined(post, 0x1f2430, g, new THREE.Vector3(x, 1.15, z));
      p.scale.y = 0.01;   // 솟아오르는 연출용
      item.parts.push({ m: p, type: 'post' });
    }
    const top = outlined(new THREE.BoxGeometry(1.62, 0.1, 0.12), 0x1f2430, g, new THREE.Vector3(0, 2.28, -0.5));
    top.visible = false; item.top = top;
    const top2 = outlined(new THREE.BoxGeometry(1.62, 0.1, 0.12), 0x1f2430, g, new THREE.Vector3(0, 2.28, 0.5));
    top2.visible = false; item.top2 = top2;
    // 바벨 (봉 + 원판 4장)
    const bar = new THREE.Group();
    outlined(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 10), 0xb9bcc6, bar).rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
      const pl = outlined(new THREE.CylinderGeometry(0.28 - k * 0.04, 0.28 - k * 0.04, 0.07, 16), k ? 0x24242c : 0xc0f000, bar, new THREE.Vector3(sx * (0.72 + k * 0.09), 0, 0));
      pl.rotation.z = Math.PI / 2;
    }
    bar.position.set(0, 1.55, 0);
    g.add(bar); item.bar = bar;
  }

  _buildBike(item, attacker) {
    // 흰색 BMW 스타일 투어러: 흰 카울 + 검정 시트 + 실린더 + 파랑/흰 엠블럼
    const g = item.root;
    const b = new THREE.Group();
    const WHITE = 0xf4f6f8, BLACK = 0x18181e, SILVER = 0xb9bcc6, BLUE = 0x1f6fd0;
    // 프레임 / 연료탱크 / 카울
    outlined(new THREE.BoxGeometry(1.0, 0.3, 0.36), WHITE, b, new THREE.Vector3(0, 0.68, 0));
    const tank = outlined(new THREE.SphereGeometry(0.26, 14, 10), WHITE, b, new THREE.Vector3(-0.02, 0.86, 0));
    tank.scale.set(1.25, 0.72, 0.95);
    const cowl = outlined(new THREE.ConeGeometry(0.22, 0.46, 10), WHITE, b, new THREE.Vector3(-0.66, 0.88, 0));
    cowl.rotation.z = Math.PI / 2 + 0.25;
    outlined(new THREE.BoxGeometry(0.42, 0.14, 0.32), BLACK, b, new THREE.Vector3(0.34, 0.86, 0));     // 시트
    outlined(new THREE.BoxGeometry(0.3, 0.26, 0.3), WHITE, b, new THREE.Vector3(0.6, 0.78, 0));        // 테일
    // 박서 트윈 실린더 (양옆으로 튀어나온 BMW 특징)
    for (const sx of [-1, 1]) {
      const cyl = outlined(new THREE.CylinderGeometry(0.1, 0.11, 0.22, 10), SILVER, b, new THREE.Vector3(-0.02, 0.5, sx * 0.3));
      cyl.rotation.x = Math.PI / 2;
      outlined(new THREE.BoxGeometry(0.14, 0.02, 0.1), BLACK, cyl, new THREE.Vector3(0, 0.02, 0), 1);
    }
    // 배기 파이프
    const pipe = outlined(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), SILVER, b, new THREE.Vector3(0.36, 0.42, 0.2));
    pipe.rotation.z = Math.PI / 2 - 0.12;
    // 바퀴
    for (const sx of [-1, 1]) {
      const w = outlined(new THREE.TorusGeometry(0.33, 0.1, 8, 20), BLACK, b, new THREE.Vector3(sx * 0.66, 0.34, 0));
      const hub = outlined(new THREE.CylinderGeometry(0.11, 0.11, 0.13, 10), SILVER, w);
      hub.rotation.x = Math.PI / 2;
      for (let k = 0; k < 5; k++) {   // 스포크
        const sp = outlined(new THREE.BoxGeometry(0.04, 0.46, 0.03), SILVER, w, null, 1);
        sp.rotation.z = (k / 5) * Math.PI;
      }
    }
    // 포크 + 핸들 + 헤드라이트
    for (const sx of [-1, 1]) {
      const fork = outlined(new THREE.CylinderGeometry(0.035, 0.035, 0.52, 8), SILVER, b, new THREE.Vector3(-0.62, 0.6, sx * 0.13));
      fork.rotation.z = 0.28;
    }
    const bar = outlined(new THREE.CylinderGeometry(0.028, 0.028, 0.66, 8), BLACK, b, new THREE.Vector3(-0.5, 1.04, 0));
    bar.rotation.x = Math.PI / 2;
    const head = outlined(new THREE.SphereGeometry(0.13, 12, 10), 0xfff6d0, b, new THREE.Vector3(-0.78, 0.9, 0));
    head.scale.set(0.8, 1, 1);
    head.material.emissive = new THREE.Color(0xffd98a); head.material.emissiveIntensity = 1.2;
    // 엠블럼 (파랑/흰 4분할 원)
    for (const sx of [-1, 1]) {
      const em = new THREE.Group();
      em.position.set(-0.02, 0.9, sx * 0.24);
      em.rotation.y = sx > 0 ? 0 : Math.PI;
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), TOON(BLACK));
      em.add(base);
      for (let q = 0; q < 4; q++) {
        const seg = new THREE.Mesh(new THREE.CircleGeometry(0.055, 10, (q * Math.PI) / 2, Math.PI / 2), TOON(q % 2 ? BLUE : WHITE));
        seg.position.z = 0.004; em.add(seg);
      }
      b.add(em);
    }
    b.position.copy(attacker ? attacker.pos : item.tp).add(new THREE.Vector3(0, 0.2, 0));
    b.scale.setScalar(0.92);
    g.add(b); item.bike = b;
    item.from = b.position.clone();
  }

  update(dt, camShake) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const it = this.active[i];
      it.t += dt;
      const tp = it.target ? it.target.pos : it.tp;
      if (it.kind === 'reels') this._updArtifacts(it, dt, tp);
      else if (it.kind === 'barbell') this._updRack(it, dt, tp);
      else if (it.kind === 'bike') this._updBike(it, dt, tp);
      if (it.t > it.dur + 1.4) {
        this.scene.remove(it.root);
        it.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.active.splice(i, 1);
      }
    }
  }

  _updArtifacts(it, dt, tp) {
    for (const p of it.parts) {
      if (it.t < p.delay) continue;
      if (p.landed) { p.landed += dt; p.m.rotation.z += dt * 2; p.m.scale.multiplyScalar(Math.max(0.0001, 1 - dt * 2.2)); if (p.landed > 0.55) p.m.visible = false; continue; }
      p.vy -= 26 * dt;
      p.m.position.y += p.vy * dt;
      // 낙하 중 목표 쪽으로 살짝 끌린다 (확실히 맞게)
      p.m.position.x += (tp.x - p.m.position.x) * Math.min(1, dt * 1.6);
      p.m.position.z += (tp.z - p.m.position.z) * Math.min(1, dt * 1.6);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
      if (p.m.position.y <= 0.35) {
        p.m.position.y = 0.35; p.landed = 0.0001;
        this.audio.impact(0.55); if (Math.random() < 0.4) this.audio.clang(0.35);
        if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.12);
      }
    }
  }

  _updRack(it, dt, tp) {
    it.root.position.lerp(new THREE.Vector3(tp.x, 0, tp.z), Math.min(1, dt * 6));
    const u = it.t;
    // 0~0.45 기둥 솟음 → 0.45 상단바 → 1.0~2.4 바벨 상하 (스쿼트 3회) → 2.4 낙하
    for (const p of it.parts) if (p.type === 'post') p.m.scale.y = Math.min(1, u / 0.45);
    if (u > 0.45) { it.top.visible = true; it.top2.visible = true; }
    if (it.bar) {
      if (u < 1.0) it.bar.position.y = 1.55 + 0.35 * (1 - Math.min(1, u / 1.0));
      else if (u < 2.45) {
        const k = (u - 1.0) / 1.45;
        it.bar.position.y = 1.35 - 0.42 * Math.abs(Math.sin(k * Math.PI * 3));
        if (!it.repCount) it.repCount = 0;
        const rep = Math.floor(k * 3);
        if (rep !== it.lastRep) { it.lastRep = rep; this.audio.clang(0.5); }
      } else {
        it.bar.position.y = Math.max(0.28, it.bar.position.y - (u - 2.45) * 9 * dt * 6);
        if (!it.dropped && it.bar.position.y <= 0.3) { it.dropped = true; this.audio.clang(1.4); this.audio.bassHit(); }
      }
    }
    if (u > 3.0) {   // 랙은 사라진다
      const f = Math.max(0, 1 - (u - 3.0) / 0.8);
      it.root.scale.setScalar(Math.max(0.001, f));
    }
  }

  _updBike(it, dt, tp, attacker) {
    const b = it.bike; if (!b) return;
    const u = it.t;
    const att = it.attacker;
    const base = att ? att.pos.clone().add(new THREE.Vector3(0, 0.2, 0)) : it.from;
    const fwd = att ? att.forward : new THREE.Vector3(0, 0, 1);
    if (u < 0.55) {
      // ① 잡고 끌어올리기: 앞으로 살짝 기울었다가 가슴 높이까지
      const k = easeOut(u / 0.55);
      b.position.copy(base).add(new THREE.Vector3(0, 0.15 + 0.75 * k, 0)).addScaledVector(fwd, 0.55 + 0.1 * k);
      b.rotation.set(0, Math.atan2(fwd.x, fwd.z) + Math.PI / 2, -0.35 + 0.28 * k);
      if (!it.revved) { it.revved = true; this.audio.engine(1.9); }
    } else if (u < 1.05) {
      // ② 머리 위로 들다 무게에 못 이겨 휘청 (좌우로 크게 흔들림)
      const k = (u - 0.55) / 0.5;
      const wob = Math.sin(u * 13) * (0.1 + 0.22 * k);
      b.position.copy(base).add(new THREE.Vector3(0, 0.9 + 0.35 * k, 0)).addScaledVector(fwd, 0.62);
      b.position.x += wob * 0.35; b.position.z += wob * 0.2;
      b.rotation.set(wob * 0.5, Math.atan2(fwd.x, fwd.z) + Math.PI / 2 + wob * 0.4, -0.07 + wob);
    } else if (u < 1.35) {
      // ③ 손에서 미끄러짐: 앞으로 기울며 떨어지기 시작
      const k = (u - 1.05) / 0.3;
      b.position.copy(base).add(new THREE.Vector3(0, 1.25 - 0.25 * k * k, 0)).addScaledVector(fwd, 0.62 + 0.5 * k);
      b.rotation.z += dt * (1.2 + 3 * k);
      b.rotation.x += dt * 0.8 * k;
      if (!it.slipped) { it.slipped = true; this.audio.whoosh(0, 0.6, 0.8, true); }
    } else if (!it.crashed) {
      // ④ 포물선으로 날아가 상대에게 충돌
      const k = Math.min(1, (u - 1.35) / 0.42);
      if (!it.launchFrom) it.launchFrom = b.position.clone();
      const target = new THREE.Vector3(tp.x, 0.95, tp.z);
      b.position.lerpVectors(it.launchFrom, target, k);
      b.position.y += Math.sin(k * Math.PI) * 0.55;
      b.rotation.z += dt * 9; b.rotation.y += dt * 3;
      if (k >= 1) {
        it.crashed = true;
        this.audio.bassHit(); this.audio.impact(1); this.audio.clang(1.3);
        if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.5);
      }
    } else {
      // ⑤ 충돌 후 바닥에 쓰러져 뒹군다
      b.position.y = Math.max(0.36, b.position.y - 7 * dt);
      const spin = Math.max(0, 1 - (u - 1.8));
      b.rotation.z += dt * 2.4 * spin;
      b.rotation.x += (Math.PI / 2 - b.rotation.x) * Math.min(1, dt * 2);
      if (u > 3.4) { const f = Math.max(0, 1 - (u - 3.4) / 0.9); b.scale.setScalar(Math.max(0.001, 0.92 * f)); }
    }
  }

  clear() {
    for (const it of this.active) this.scene.remove(it.root);
    this.active.length = 0;
  }
}
