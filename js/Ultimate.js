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

// ---- 릴스 촬영 소품: 하트 / 좋아요 아이콘 ----
function makeHeart() {
  const g = new THREE.Group();
  const mat = TOON(0xff4f8b);
  for (const sx of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mat);
    lobe.position.set(sx * 0.055, 0.045, 0); g.add(lobe);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.16, 12), mat);
  tip.position.y = -0.055; tip.rotation.x = Math.PI; g.add(tip);
  return g;
}

// ---- 말풍선 (한국어 텍스트) ----
function bubbleTexture(text, bg = '#ffffff', fg = '#1a1a22') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = bg; g.strokeStyle = '#111118'; g.lineWidth = 8;
  const r = 34;
  g.beginPath();
  g.moveTo(r, 6); g.lineTo(512 - r, 6); g.quadraticCurveTo(506, 6, 506, r);
  g.lineTo(506, 112 - r); g.quadraticCurveTo(506, 112, 512 - r, 112);
  g.lineTo(300, 112); g.lineTo(268, 152); g.lineTo(250, 112);
  g.lineTo(r, 112); g.quadraticCurveTo(6, 112, 6, 112 - r);
  g.lineTo(6, r); g.quadraticCurveTo(6, 6, r, 6); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = fg; g.font = '900 52px "Noto Sans JP", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 60, 460);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBubble(text, bg, fg) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: bubbleTexture(text, bg, fg), transparent: true, depthWrite: false }));
  return m;
}

// ---- 간식: 소금빵 / 호두과자 ----
function makeSnack(i) {
  const g = new THREE.Group();
  if (i % 2 === 0) {                     // 소금빵 (길쭉한 롤 + 소금)
    const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 5, 12), TOON(0xe0b064));
    roll.rotation.z = Math.PI / 2; roll.scale.set(1, 1, 0.8); g.add(roll);
    for (let k = 0; k < 5; k++) {
      const salt = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), TOON(0xffffff));
      salt.position.set(-0.12 + k * 0.06, 0.09, (Math.random() - 0.5) * 0.06); g.add(salt);
    }
  } else {                               // 호두과자 (동그란 과자 + 갈색 무늬)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), TOON(0xd7a052));
    b.scale.set(1, 0.72, 1); g.add(b);
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), TOON(0x8a5a32));
    nut.position.y = 0.055; nut.scale.set(1, 0.6, 1); g.add(nut);
  }
  return g;
}

export class UltimateFx {
  constructor(scene, audio, fx, camera = null) {
    this.scene = scene; this.audio = audio; this.fx = fx; this.cam = camera;
    this.active = [];
  }

  /** kind: 'reels' | 'barbell' | 'bike' */
  play(kind, attacker, target) {
    if (!target) return;
    const root = new THREE.Group();
    this.scene.add(root);
    const DUR = { reels: 3.4, snackRain: 3.6, cafeRush: 3.2, coldCut: 3.4 };
    const item = { kind, root, t: 0, dur: DUR[kind] || 3.2, parts: [], attacker, target, tp: target.pos.clone() };
    if (kind === 'reels') this._buildReels(item, attacker);
    else if (kind === 'snackRain') this._buildSnackRain(item);
    else if (kind === 'cafeRush') this._buildCafeRush(item, attacker);
    else if (kind === 'coldCut') this._buildColdCut(item, attacker);
    else if (kind === 'barbell') this._buildRack(item);
    else if (kind === 'bike') this._buildBike(item, attacker);
    this.active.push(item);
  }

  _buildReels(item, attacker) {
    const g = item.root;
    // 세로형 스마트폰 (촬영자 손 위치에 붙는다)
    const phone = new THREE.Group();
    const body = outlined(new THREE.BoxGeometry(0.16, 0.3, 0.025), 0x15151c, phone);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.27), TOON(0xdff1ff));
    screen.position.z = 0.016; body.add(screen);
    const rec = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), TOON(0xff2d2d));
    rec.position.set(-0.045, 0.1, 0.002); screen.add(rec);
    item.rec = rec;
    g.add(phone); item.phone = phone;
    // 링라이트 (촬영 조명)
    const ring = outlined(new THREE.TorusGeometry(0.34, 0.05, 8, 24), 0xfff4cf, g);
    if (ring.material.emissive) { ring.material.emissive.set(0xfff0b0); ring.material.emissiveIntensity = 1.4; }
    item.ring = ring;
    const light = new THREE.PointLight(0xfff0c0, 0, 6);
    g.add(light); item.light = light;
    // 떠오르는 하트 / 좋아요
    item.hearts = [];
    for (let i = 0; i < 16; i++) {
      const h = makeHeart();
      h.visible = false; h.scale.setScalar(0.5 + Math.random() * 0.5);
      g.add(h);
      item.hearts.push({ m: h, delay: 0.35 + i * 0.16, t: 0, x: (Math.random() - 0.5) * 1.4, z: (Math.random() - 0.5) * 0.8, spd: 1.1 + Math.random() * 0.8 });
    }
  }

  _buildSnackRain(item) {
    // 정주원: 하늘에서 소금빵·호두과자가 쏟아진다
    item.parts = [];
    for (let i = 0; i < 46; i++) {
      const sn = makeSnack(i);
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * 1.25;
      sn.position.set(item.tp.x + Math.cos(ang) * rr, 4.6 + Math.random() * 4.6, item.tp.z + Math.sin(ang) * rr);
      sn.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sn.scale.setScalar(1.0 + Math.random() * 0.6);
      item.root.add(sn);
      item.parts.push({ m: sn, delay: 0.1 + i * 0.05, vy: 0, spin: new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7), landed: 0 });
    }
  }

  _buildCafeRush(item, attacker) {
    // 링 저편에 카페가 생긴다: 카운터 + 파라솔 + CAFE 간판 + 김 나는 커피
    const g = item.root;
    const aim = attacker ? new THREE.Vector3().subVectors(item.tp, attacker.pos).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    const spot = (attacker ? attacker.pos.clone() : item.tp.clone()).addScaledVector(aim, 4.6);
    spot.x = Math.max(-2.6, Math.min(2.6, spot.x)); spot.z = Math.max(-2.6, Math.min(2.6, spot.z));
    item.cafeSpot = spot.clone();
    const cafe = new THREE.Group(); cafe.position.copy(spot); g.add(cafe); item.cafe = cafe;
    cafe.lookAt(attacker ? attacker.pos.x : 0, 0, attacker ? attacker.pos.z : 0);
    outlined(new THREE.BoxGeometry(1.5, 0.75, 0.6), 0x6b4a32, cafe, new THREE.Vector3(0, 0.38, 0));       // 카운터
    outlined(new THREE.BoxGeometry(1.6, 0.08, 0.7), 0x3c2b1e, cafe, new THREE.Vector3(0, 0.79, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), new THREE.MeshBasicMaterial({ map: bubbleTexture('CAFE', '#f6efe4', '#4b2e17'), transparent: true }));
    sign.position.set(0, 1.5, 0.05); cafe.add(sign);
    const pole = outlined(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), 0x8a8a94, cafe, new THREE.Vector3(0.75, 0.95, -0.1));
    const shade = outlined(new THREE.ConeGeometry(1.1, 0.42, 12), 0xc0392b, cafe, new THREE.Vector3(0.75, 2.0, -0.1));
    const cup = outlined(new THREE.CylinderGeometry(0.1, 0.08, 0.22, 12), 0xf3f1ec, cafe, new THREE.Vector3(-0.45, 0.94, 0.1));
    item.steam = [];
    for (let i = 0; i < 6; i++) {
      const p2 = outlined(new THREE.SphereGeometry(0.05, 8, 6), 0xffffff, cafe, new THREE.Vector3(-0.45, 1.1, 0.1));
      p2.material.transparent = true; p2.material.opacity = 0.7;
      item.steam.push({ m: p2, t: i * 0.25 });
    }
    cafe.scale.setScalar(0.01);
  }

  _buildColdCut(item, attacker) {
    // 고코몽: 상대의 푸념 말풍선 → 칼차단(X) → 말풍선 산산조각
    const g = item.root;
    const LINES = ['요즘 너무 힘들어서…', '내 말 좀 들어봐…', '진짜 억울한 게…'];
    item.bubbles = LINES.map((tx, i) => {
      const b = makeBubble(tx, '#ffffff', '#1a1a22');
      b.visible = false; g.add(b);
      return { m: b, at: 0.25 + i * 0.75 };
    });
    item.cut = makeBubble('그래서 어쩌라고.', '#12131a', '#8fd6f2'); item.cut.visible = false; item.cut.scale.setScalar(1.25); g.add(item.cut);
    // 차단 이펙트: 가로로 그어지는 파란 칼선
    const slash = outlined(new THREE.BoxGeometry(2.6, 0.09, 0.09), 0x8fd6f2, g);
    if (slash.material.emissive) { slash.material.emissive.set(0x8fd6f2); slash.material.emissiveIntensity = 1.6; }
    slash.visible = false; g.add(slash); item.slash = slash;
    // 깨진 조각
    item.shards = [];
    for (let i = 0; i < 14; i++) {
      const sh = outlined(new THREE.BoxGeometry(0.16, 0.12, 0.02), 0xf2f4f8, g);
      sh.visible = false; g.add(sh);
      item.shards.push({ m: sh, v: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.2, (Math.random() - 0.5) * 3), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
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
    if (head.material.emissive) { head.material.emissive.set(0xffd98a); head.material.emissiveIntensity = 1.2; }
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
      if (it.kind === 'reels') this._updReels(it, dt, tp);
      else if (it.kind === 'snackRain') this._updSnackRain(it, dt, tp);
      else if (it.kind === 'cafeRush') this._updCafeRush(it, dt, tp);
      else if (it.kind === 'coldCut') this._updColdCut(it, dt, tp);
      else if (it.kind === 'barbell') this._updRack(it, dt, tp);
      else if (it.kind === 'bike') this._updBike(it, dt, tp);
      if (it.t > it.dur + 1.4) {
        this.scene.remove(it.root);
        it.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.active.splice(i, 1);
      }
    }
  }

  _updReels(it, dt, tp) {
    const u = it.t, att = it.attacker;
    // 폰: 촬영자 앞 가슴 높이에서 상대를 향해 겨눈다 (살짝 흔들리는 핸드헬드)
    if (it.phone && att) {
      const aim = new THREE.Vector3().subVectors(tp, att.pos).setY(0).normalize();
      const p = att.pos.clone().addScaledVector(aim, 0.42).add(new THREE.Vector3(0, 1.28 + Math.sin(u * 5) * 0.02, 0));
      it.phone.position.lerp(p, Math.min(1, dt * 12));
      it.phone.lookAt(tp.x, 1.15, tp.z);
      it.phone.rotateY(Math.PI);
      it.phone.rotation.z += Math.sin(u * 7) * 0.03;
      if (it.rec) it.rec.visible = Math.sin(u * 9) > -0.2;    // REC 점멸
    }
    // 링라이트: 상대 앞쪽에서 비춘다
    if (it.ring && att) {
      const aim = new THREE.Vector3().subVectors(tp, att.pos).setY(0).normalize();
      const rp = tp.clone().addScaledVector(aim, -0.95).add(new THREE.Vector3(0, 1.5, 0));
      it.ring.position.lerp(rp, Math.min(1, dt * 6));
      it.ring.lookAt(tp.x, 1.2, tp.z);
      const on = Math.min(1, u / 0.3) * (u > it.dur - 0.5 ? Math.max(0, (it.dur - u) / 0.5) : 1);
      it.ring.scale.setScalar(0.6 + 0.4 * on);
      if (it.light) { it.light.position.copy(it.ring.position); it.light.intensity = 9 * on; }
    }
    // 하트가 상대 주변에서 떠오른다 (좋아요 폭발)
    for (const h of it.hearts) {
      if (u < h.delay) continue;
      h.t += dt;
      if (h.t === dt) { h.m.visible = true; h.m.position.set(tp.x + h.x, 0.9, tp.z + h.z); }
      h.m.position.y += h.spd * dt;
      h.m.position.x += Math.sin(h.t * 3 + h.x * 5) * 0.4 * dt;
      h.m.rotation.z = Math.sin(h.t * 4) * 0.25;
      const fade = Math.max(0, 1 - h.t / 1.6);
      h.m.scale.setScalar(Math.max(0.001, (0.5 + 0.5 * Math.min(1, h.t * 4)) * fade));
      if (fade <= 0) h.m.visible = false;
    }
    // 셔터 플래시 (3회)
    if (!it.flashes) it.flashes = 0;
    const want = u > 2.7 ? 3 : u > 1.7 ? 2 : u > 0.7 ? 1 : 0;
    if (want > it.flashes) {
      it.flashes = want;
      this.audio.shutter();
      if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.45);
    }
  }

  _updSnackRain(it, dt, tp) {
    for (const p of it.parts) {
      if (it.t < p.delay) continue;
      if (p.landed) { p.landed += dt; p.m.scale.multiplyScalar(Math.max(0.0001, 1 - dt * 2.4)); if (p.landed > 0.5) p.m.visible = false; continue; }
      p.vy -= 24 * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.x += (tp.x - p.m.position.x) * Math.min(1, dt * 1.5);
      p.m.position.z += (tp.z - p.m.position.z) * Math.min(1, dt * 1.5);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
      if (p.m.position.y <= 0.32) {
        p.m.position.y = 0.32; p.landed = 0.0001;
        this.audio.impact(0.4, 'follow');
        if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.08);
      }
    }
  }

  _updCafeRush(it, dt, tp) {
    const u = it.t;
    if (it.cafe) {
      const k = Math.min(1, u / 0.4);
      it.cafe.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - k, 3)));
      if (u > 2.9) { const f = Math.max(0, 1 - (u - 2.9) / 0.6); it.cafe.scale.setScalar(Math.max(0.001, f)); }
      for (const st of it.steam) {
        st.t += dt;
        const q = (st.t % 1.2) / 1.2;
        st.m.position.y = 1.1 + q * 0.6;
        st.m.position.x = -0.45 + Math.sin(q * 6) * 0.06;
        st.m.material.opacity = 0.7 * (1 - q);
        st.m.scale.setScalar(0.6 + q * 0.9);
      }
    }
  }

  _updColdCut(it, dt, tp) {
    const u = it.t, att = it.attacker;
    for (const b of it.bubbles) {
      const on = u > b.at && u < 2.05;
      b.m.visible = on;
      if (on) {
        b.m.position.copy(tp).add(new THREE.Vector3(0, 2.05 + Math.sin(u * 3 + b.at) * 0.05, 0));
        if (this.cam) b.m.lookAt(this.cam.position);
        const k = Math.min(1, (u - b.at) / 0.18);
        b.m.scale.setScalar(0.6 + 0.45 * k);
      }
    }
    if (u > 2.05 && !it.cutDone) {
      it.cutDone = true;
      // counter() 자체가 임팩트 샘플을 재생한다 — 여기서 impact 를 또 부르면 겹쳐서 탁해진다
      this.audio.counter();
      if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.55);
      for (const sh of it.shards) { sh.m.visible = true; sh.m.position.copy(tp).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 2.05, (Math.random() - 0.5) * 0.4)); }
      if (it.slash) { it.slash.visible = true; it.slash.position.copy(tp).add(new THREE.Vector3(0, 2.05, 0)); }
    }
    if (it.slash && it.slash.visible) {
      const k = Math.min(1, (u - 2.05) / 0.3);
      it.slash.scale.set(0.2 + 1.3 * k, 1, 1);
      it.slash.material.opacity = 1;
      if (u > 2.6) it.slash.visible = false;
    }
    for (const sh of it.shards) {
      if (!sh.m.visible) continue;
      sh.v.y -= 9 * dt;
      sh.m.position.addScaledVector(sh.v, dt);
      sh.m.rotation.x += sh.spin.x * dt; sh.m.rotation.y += sh.spin.y * dt;
      if (sh.m.position.y < 0.1) sh.m.visible = false;
    }
    if (it.cut) {
      it.cut.visible = u > 2.1 && u < 3.2;
      it.cut.position.copy(att ? att.pos : tp).add(new THREE.Vector3(0, 2.1, 0));
      if (this.cam) it.cut.lookAt(this.cam.position);
    }
  }

  _updRack(it, dt, tp) {
    it.root.position.lerp(new THREE.Vector3(tp.x, 0, tp.z), Math.min(1, dt * 6));
    // 랙은 시전자를 바라보게 세운다 → 바벨이 피격자의 어깨선과 나란해진다 (십자 교차 방지)
    if (it.attacker) {
      const dir = new THREE.Vector3().subVectors(it.attacker.pos, tp).setY(0);
      if (dir.lengthSq() > 1e-4) {
        const want = Math.atan2(dir.x, dir.z);
        let d2 = want - it.root.rotation.y;
        while (d2 > Math.PI) d2 -= Math.PI * 2;
        while (d2 < -Math.PI) d2 += Math.PI * 2;
        it.root.rotation.y += d2 * Math.min(1, dt * 8);
      }
      // 피격자도 시전자를 정면으로 보게 (바벨이 몸을 가로지르지 않게)
      if (it.target && it.target.ultVictimT > 0) {
        const f = it.target;
        f.forward.copy(it.attacker.pos).sub(f.pos).setY(0);
        if (f.forward.lengthSq() > 1e-4) {
          f.forward.normalize();
          f.yaw = Math.atan2(f.forward.x, f.forward.z);
          f.side.set(f.forward.z, 0, -f.forward.x);
        }
      }
    }
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
      if (!it.slipped) { it.slipped = true; this.audio.dodge(0); }
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
        this.audio.bassHit(); this.audio.impact(1, 'hook'); this.audio.clang(1.3);
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
