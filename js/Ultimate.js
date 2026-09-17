// Ultimate.js — 히든 캐릭터 필살기 3D 연출 (겟앰프드처럼 화면에 확실히 보이게)
// chaechae: 하늘에서 유물·미술품 무더기 낙하 / jjeonghyo: 데드리프트 랙에 가두고 운동시킨 뒤 바벨에 깔림 / ppyeo: 오토바이를 놓쳐 던짐
import * as THREE from 'three';

const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// 링 조명은 바닥 근처만 비추므로, 낙하물은 자체 발광을 섞어 어디서든 또렷하게 보이게 한다.
// 재질은 색별로 캐시해 재사용한다: 필살기마다 새 재질을 만들고 끝나면 dispose 하면 three 가 셰이더 프로그램까지 버려서
// 다음 필살기 때 다시 컴파일한다 (첫 사용 시 화면이 1초쯤 멈추던 원인 중 하나). 개별로 색·투명도를 바꿀 메시는 clone() 해서 쓴다.
const TOON_CACHE = new Map();
const TOON = (c) => {
  let m = TOON_CACHE.get(c);
  if (!m) {
    const col = new THREE.Color(c);
    m = new THREE.MeshToonMaterial({ color: c, emissive: col.clone().multiplyScalar(0.55) });
    m.userData.shared = true;
    TOON_CACHE.set(c, m);
  }
  return m;
};
/** 개별 조정(발광·투명도)이 필요한 메시용: 공유 재질을 복제 (같은 프로그램을 쓰므로 컴파일은 없다) */
const own = (mesh) => { mesh.material = mesh.material.clone(); mesh.material.userData.shared = false; return mesh; };

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

// ---- 릴스 촬영 스태프: 검은 옷 + 캡 + 카메라. 촬영 후 한 대씩 귀싸대기 ----
function makeStaff() {
  const g = new THREE.Group();
  const black = 0x15151c, skin = 0xfff6d0;
  const legL = outlined(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8), black, g, new THREE.Vector3(-0.09, 0.31, 0));
  const legR = outlined(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8), black, g, new THREE.Vector3(0.09, 0.31, 0));
  const torso = outlined(new THREE.BoxGeometry(0.34, 0.5, 0.2), black, g, new THREE.Vector3(0, 0.88, 0));
  const head = outlined(new THREE.SphereGeometry(0.13, 12, 10), skin, g, new THREE.Vector3(0, 1.28, 0));
  const cap = outlined(new THREE.CylinderGeometry(0.14, 0.145, 0.09, 12), black, g, new THREE.Vector3(0, 1.38, 0));
  const brim = outlined(new THREE.BoxGeometry(0.2, 0.02, 0.14), black, g, new THREE.Vector3(0, 1.345, 0.14));
  // 왼팔: 카메라를 얼굴 앞에 든다
  const armL = new THREE.Group(); armL.position.set(-0.2, 1.1, 0); g.add(armL);
  outlined(new THREE.CylinderGeometry(0.04, 0.04, 0.34, 8), skin, armL, new THREE.Vector3(0.05, -0.02, 0.2)).rotation.x = Math.PI / 2;
  const cam = new THREE.Group(); cam.position.set(0.12, 0.1, 0.36); armL.add(cam);
  outlined(new THREE.BoxGeometry(0.2, 0.13, 0.12), black, cam);
  const lens = outlined(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), 0xffffff, cam, new THREE.Vector3(0.02, 0, 0.09)); lens.rotation.x = Math.PI / 2;
  const rec = outlined(new THREE.SphereGeometry(0.018, 8, 6), 0xff2d2d, cam, new THREE.Vector3(-0.07, 0.08, 0));
  // 오른팔: 어깨 피벗 — 싸대기용
  const armR = new THREE.Group(); armR.position.set(0.2, 1.1, 0); g.add(armR);
  const upper = outlined(new THREE.CylinderGeometry(0.04, 0.04, 0.36, 8), skin, armR, new THREE.Vector3(0.06, -0.16, 0));
  const hand = outlined(new THREE.BoxGeometry(0.1, 0.13, 0.04), skin, armR, new THREE.Vector3(0.06, -0.38, 0));
  armR.rotation.z = -0.25;
  g.userData = { armR, armL, cam, rec, legL, legR };
  return g;
}

// ---- 떼로 날아오는 오토바이 (간략 모델: 메시 7개) ----
function makeBikeLite() {
  const b = new THREE.Group();
  const bodies = [0xf4f6f8, 0xd3391c, 0x1f6fd0, 0x18181e, 0xffc400];
  const body = bodies[Math.floor(Math.random() * bodies.length)];
  outlined(new THREE.BoxGeometry(1.0, 0.3, 0.34), body, b, new THREE.Vector3(0, 0.68, 0));
  const tank = outlined(new THREE.SphereGeometry(0.26, 10, 8), body, b, new THREE.Vector3(-0.02, 0.86, 0)); tank.scale.set(1.25, 0.72, 0.95);
  const cowl = outlined(new THREE.ConeGeometry(0.22, 0.46, 8), body, b, new THREE.Vector3(-0.66, 0.88, 0)); cowl.rotation.z = Math.PI / 2 + 0.25;
  outlined(new THREE.BoxGeometry(0.42, 0.14, 0.3), 0x18181e, b, new THREE.Vector3(0.34, 0.86, 0));
  for (const sx of [-1, 1]) outlined(new THREE.TorusGeometry(0.33, 0.1, 6, 14), 0x18181e, b, new THREE.Vector3(sx * 0.66, 0.34, 0));
  const head = outlined(new THREE.SphereGeometry(0.12, 8, 6), 0xfff6d0, b, new THREE.Vector3(-0.78, 0.9, 0));   // 헤드라이트
  return b;
}

export class UltimateFx {
  constructor(scene, audio, fx, camera = null) {
    this.scene = scene; this.audio = audio; this.fx = fx; this.cam = camera;
    this.active = [];
    // 예열: 필살기 소품이 쓰는 재질(그림자 포함)을 첫 프레임부터 그려 두어 셰이더가 미리 컴파일되게 한다
    const warm = new THREE.Group();
    for (const c of [0x15151c, 0xfff4cf, 0xff4f8b, 0xe0b064, 0xffffff, 0x6b4a32, 0x8fd6f2, 0xfff6d0, 0xff2d2d, 0xd3391c, 0x1f6fd0, 0x18181e, 0xffc400, 0xf4f6f8, 0x5a3a22, 0xf3f1ec, 0x3c2b1e]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), TOON(c));
      m.castShadow = true; warm.add(m);
    }
    warm.add(makeBubble('warm', '#ffffff', '#1a1a22'));
    warm.position.set(0, -60, 0);          // 화면엔 절대 안 보이는 위치
    warm.traverse((o) => { o.frustumCulled = false; });
    scene.add(warm);
  }

  _release(it) {
    this.scene.remove(it.root);
    // 공유 재질은 남긴다 (프로그램 캐시 유지). 지오메트리와 개별 복제 재질만 정리
    it.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.userData.shared) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }

  /** kind: 'reels' | 'barbell' | 'bike' */
  play(kind, attacker, target) {
    if (!target) return;
    const root = new THREE.Group();
    this.scene.add(root);
    const DUR = { reels: 3.4, snackRain: 3.6, cafeRush: 3.2, coldCut: 3.4, forge: 3.3, coffeeBarrage: 3.6, danceTime: 3.6 };
    const item = { kind, root, t: 0, dur: DUR[kind] || 3.2, parts: [], attacker, target, tp: target.pos.clone() };
    if (kind === 'reels') this._buildReels(item, attacker);
    else if (kind === 'snackRain') this._buildSnackRain(item);
    else if (kind === 'cafeRush') this._buildCafeRush(item, attacker);
    else if (kind === 'coldCut') this._buildColdCut(item, attacker);
    else if (kind === 'barbell') this._buildRack(item);
    else if (kind === 'bike') this._buildBike(item, attacker);
    else if (kind === 'forge') this._buildForge(item, attacker);
    else if (kind === 'coffeeBarrage') this._buildCoffee(item, attacker);
    else if (kind === 'danceTime') this._buildDance(item, attacker);
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
    // 촬영 스태프 5명: 상대를 둘러싸고 카메라를 든다 → 촬영이 끝나면 한 명씩 다가와 귀싸대기 → 사라진다
    item.staff = [];
    const base = attacker ? Math.atan2(attacker.pos.x - item.tp.x, attacker.pos.z - item.tp.z) : 0;   // 상대→촬영자 방향
    // 카메라가 촬영자 등 뒤에 있으므로 스태프는 상대의 옆·건너편에만 (카메라 앞을 가리지 않게)
    const offs = [-1.05, -1.95, 1.05, 1.95, Math.PI];
    offs.forEach((off, i) => {
      const st = makeStaff();
      const ang = base + off;
      st.position.set(item.tp.x + Math.sin(ang) * 1.35, 0, item.tp.z + Math.cos(ang) * 1.35);
      st.lookAt(item.tp.x, 0, item.tp.z);
      st.scale.setScalar(0.001);
      g.add(st);
      item.staff.push({ m: st, ang, order: i, slapAt: 1.75 + i * 0.28, phase: 'film', t: 0, sgn: i % 2 ? 1 : -1 });
    });
    item.staffScale = 0.7;   // 파이터와 같은 축소 비율
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
    // 120개가 3초 내내 우수수 (두 겹: 넓게 흩뿌리는 것 + 상대 머리 위로 집중)
    for (let i = 0; i < 120; i++) {
      const sn = makeSnack(i);
      const focus = i % 3 === 0;
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * (focus ? 0.5 : 1.7);
      sn.position.set(item.tp.x + Math.cos(ang) * rr, 4.2 + Math.random() * 6.5, item.tp.z + Math.sin(ang) * rr);
      sn.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sn.scale.setScalar(0.9 + Math.random() * 0.7);
      item.root.add(sn);
      item.parts.push({ m: sn, delay: 0.05 + i * 0.022, vy: 0, spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8), landed: 0, pull: focus ? 1.5 : 0.35 });
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
      const p2 = own(outlined(new THREE.SphereGeometry(0.05, 8, 6), 0xffffff, cafe, new THREE.Vector3(-0.45, 1.1, 0.1)));
      p2.material.transparent = true; p2.material.opacity = 0.7;
      item.steam.push({ m: p2, t: i * 0.25 });
    }
    cafe.scale.setScalar(0.01);
  }

  _buildCoffee(item, attacker) {
    // 정주원: 옆에 카페가 솟아나고, 거기서 꺼낸 커피 50잔을 상대에게 우다다 던진다
    const g = item.root;
    const aim = attacker ? new THREE.Vector3().subVectors(item.tp, attacker.pos).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3(aim.z, 0, -aim.x);   // 촬영자 왼쪽
    const spot = (attacker ? attacker.pos.clone() : item.tp.clone()).addScaledVector(side, 1.7).addScaledVector(aim, -0.3);
    spot.x = Math.max(-3.4, Math.min(3.4, spot.x)); spot.z = Math.max(-3.4, Math.min(3.4, spot.z));
    const cafe = new THREE.Group(); cafe.position.copy(spot); g.add(cafe); item.cafe = cafe;
    cafe.lookAt(attacker ? attacker.pos.x : 0, 0, attacker ? attacker.pos.z : 0);
    outlined(new THREE.BoxGeometry(1.5, 0.75, 0.6), 0x6b4a32, cafe, new THREE.Vector3(0, 0.38, 0));       // 카운터
    outlined(new THREE.BoxGeometry(1.6, 0.08, 0.7), 0x3c2b1e, cafe, new THREE.Vector3(0, 0.79, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), new THREE.MeshBasicMaterial({ map: bubbleTexture('CAFE', '#f6efe4', '#4b2e17'), transparent: true }));
    sign.position.set(0, 1.5, 0.05); cafe.add(sign);
    outlined(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), 0x8a8a94, cafe, new THREE.Vector3(0.75, 0.95, -0.1));
    outlined(new THREE.ConeGeometry(1.1, 0.42, 12), 0xc0392b, cafe, new THREE.Vector3(0.75, 2.0, -0.1));
    // 카운터 위 커피 더미 (던질수록 줄어든다)
    item.stack = [];
    for (let i = 0; i < 12; i++) {
      const c = outlined(new THREE.CylinderGeometry(0.09, 0.07, 0.2, 10), 0xf3f1ec, cafe, new THREE.Vector3(-0.6 + (i % 6) * 0.24, 0.93 + Math.floor(i / 6) * 0.22, 0.05 + Math.floor(i / 6) * 0.05));
      outlined(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 10), 0x5a3a22, c, new THREE.Vector3(0, 0.11, 0));
      item.stack.push(c);
    }
    cafe.scale.setScalar(0.01);
    // 날아가는 컵 50개 + 튀는 커피 방울 풀
    item.cups = [];
    for (let i = 0; i < 50; i++) {
      const c = new THREE.Group();
      outlined(new THREE.CylinderGeometry(0.09, 0.07, 0.2, 10), 0xf3f1ec, c);
      outlined(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 10), 0x5a3a22, c, new THREE.Vector3(0, 0.11, 0));
      c.visible = false; g.add(c);
      item.cups.push({ m: c, at: 0.55 + i * 0.05, t: -1, spin: (Math.random() - 0.5) * 16, side: (Math.random() - 0.5) * 0.5, hi: (Math.random() - 0.4) * 0.5 });
    }
    item.drops = [];
    for (let i = 0; i < 36; i++) {
      const d = outlined(new THREE.SphereGeometry(0.035, 6, 5), 0x5a3a22, g);
      d.castShadow = false; d.visible = false;
      item.drops.push({ m: d, t: -1, v: new THREE.Vector3() });
    }
    item.thrown = 0; item.hits = 0;
  }

  _updCoffee(it, dt, tp) {
    const u = it.t, att = it.attacker; if (!att) return;
    const aim = new THREE.Vector3().subVectors(tp, att.pos).setY(0); if (aim.lengthSq() < 1e-4) aim.set(0, 0, 1); aim.normalize();
    const sideV = new THREE.Vector3(aim.z, 0, -aim.x);
    // 카페 등장/퇴장
    if (it.cafe) {
      const k = Math.min(1, u / 0.35);
      it.cafe.scale.setScalar(Math.max(0.001, 0.01 + 0.99 * (1 - Math.pow(1 - k, 3))));
      if (u > it.dur - 0.3) it.cafe.scale.setScalar(Math.max(0.001, Math.max(0, 1 - (u - it.dur + 0.3) / 0.5)));
    }
    // 컵: 던지는 손(양손 번갈아)에서 출발 → 0.3초 포물선 → 상대 가슴/머리 착탄 → 튕겨 떨어지며 사라짐
    for (const c of it.cups) {
      if (u < c.at) continue;
      const m = c.m;
      if (c.t < 0) {
        c.t = 0; m.visible = true; it.thrown++;
        const right = it.thrown % 2 === 1;
        c.from = att.pos.clone().addScaledVector(aim, 0.35).addScaledVector(sideV, right ? -0.28 : 0.28).add(new THREE.Vector3(0, 1.35, 0));
        c.to = new THREE.Vector3(tp.x, 1.1 + c.hi, tp.z).addScaledVector(sideV, c.side * 0.4);
        m.position.copy(c.from);
        // 카운터 위 더미가 줄어든다 (12개를 50번에 걸쳐)
        const left = Math.max(0, 12 - Math.floor(it.thrown / 4.2));
        it.stack.forEach((s2, i) => { s2.visible = i < left; });
        if (!it._lastWhoosh || u - it._lastWhoosh > 0.12) { it._lastWhoosh = u; this.audio.whoosh(right ? 1 : -1, 1.3, 0.25); }
      }
      c.t += dt;
      if (!c.hit) {
        const k = Math.min(1, c.t / 0.3);
        m.position.lerpVectors(c.from, c.to, k); m.position.y += Math.sin(k * Math.PI) * 0.35;
        m.rotation.x += dt * c.spin; m.rotation.z += dt * c.spin * 0.6;
        if (k >= 1) {
          c.hit = true; it.hits++; c.life = 0;
          c.vel = new THREE.Vector3(aim.x * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, aim.z * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 3);
          // 커피 튀김
          let n = 0;
          for (const d of it.drops) { if (d.t >= 0) continue; if (n++ >= 5) break; d.t = 0; d.m.visible = true; d.m.position.copy(m.position); const a = Math.random() * Math.PI * 2; d.v.set(Math.cos(a) * (1 + Math.random() * 2) + aim.x * 1.5, 1.5 + Math.random() * 2.5, Math.sin(a) * (1 + Math.random() * 2) + aim.z * 1.5); }
          if (!it._lastHit || u - it._lastHit > 0.09) {
            it._lastHit = u; this.audio.impact(0.45, 'body');
            if (this.fx) { this.fx.flash = Math.max(this.fx.flash || 0, 0.1); }
          }
          if (this.fx && this.cam && (it.hits % 10 === 0 || it.hits === 1)) {
            const v = new THREE.Vector3(tp.x, 1.6, tp.z).project(this.cam);
            this.fx.addPopup((v.x * 0.5 + 0.5) * this.fx.w + (Math.random() - 0.5) * 140, (1 - (v.y * 0.5 + 0.5)) * this.fx.h - 30 - Math.random() * 50, it.hits >= 50 ? '커피 50잔!!!' : it.hits === 1 ? '촤악!' : `${it.hits}잔째!`, it.hits >= 50 ? 'groggy' : 'dodge');
          }
          if (it.hits >= 50) { this.audio.bassHit(); if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.5); }
        }
      } else {
        c.vel.y -= 16 * dt; m.position.addScaledVector(c.vel, dt);
        if (m.position.y < 0.1) { m.position.y = 0.1; c.vel.y *= -0.3; c.vel.x *= 0.6; c.vel.z *= 0.6; }
        m.rotation.x += dt * c.spin * 0.5;
        c.life += dt;
        if (c.life > 0.6) { const f = Math.max(0, 1 - (c.life - 0.6) / 0.3); m.scale.setScalar(Math.max(0.001, f)); if (f <= 0) m.visible = false; }
      }
    }
    for (const d of it.drops) {
      if (d.t < 0) continue;
      d.t += dt; d.v.y -= 12 * dt; d.m.position.addScaledVector(d.v, dt);
      if (d.t > 0.4 || d.m.position.y < 0.02) { d.t = -1; d.m.visible = false; }
    }
  }

  _buildDance(item, attacker) {
    // 우랄라 댄스 타임: 머리 위 미러볼 + 돌아가는 색 조명 + 떠오르는 음표·하트 + 'DANCE TIME!' 말풍선
    const g = item.root;
    const ball = new THREE.Group(); g.add(ball); item.ball = ball;
    const core = outlined(new THREE.SphereGeometry(0.32, 16, 12), 0xd8dbe4, ball);
    for (let i = 0; i < 26; i++) {   // 거울 조각 반짝이
      const tile = outlined(new THREE.BoxGeometry(0.08, 0.08, 0.02), i % 2 ? 0xffffff : 0x8fd6f2, ball);
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI * 0.8;
      tile.position.set(Math.cos(a) * Math.cos(b) * 0.33, Math.sin(b) * 0.33, Math.sin(a) * Math.cos(b) * 0.33);
      tile.lookAt(0, 0, 0); tile.castShadow = false;
    }
    outlined(new THREE.CylinderGeometry(0.012, 0.012, 3.0, 6), 0x8a8fa0, ball, new THREE.Vector3(0, 1.8, 0)).castShadow = false;
    ball.scale.setScalar(0.001);
    // 색 조명 원뿔 4개 (반투명 가산)
    item.beams = [];
    const cols = [0xff5fd0, 0x5fc8ff, 0xffe45f, 0x8cff6a];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.2, 14, 1, true), new THREE.MeshBasicMaterial({ color: cols[i], transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.userData.shared = false; m.visible = false; g.add(m);
      item.beams.push({ m, ph: i * Math.PI / 2 });
    }
    item.notes = [];
    for (let i = 0; i < 18; i++) {
      const isHeart = i % 3 === 0;
      const n = isHeart ? makeHeart() : (() => { const gr = new THREE.Group(); outlined(new THREE.SphereGeometry(0.07, 10, 8), 0x2b2b3a, gr, new THREE.Vector3(0, 0, 0)).scale.set(1, 0.7, 1); outlined(new THREE.BoxGeometry(0.025, 0.28, 0.02), 0x2b2b3a, gr, new THREE.Vector3(0.06, 0.13, 0)); outlined(new THREE.BoxGeometry(0.12, 0.03, 0.02), 0x2b2b3a, gr, new THREE.Vector3(0.11, 0.26, 0)); return gr; })();
      n.visible = false; g.add(n);
      item.notes.push({ m: n, delay: 0.3 + i * 0.17, t: 0, x: (Math.random() - 0.5) * 2.4, z: (Math.random() - 0.5) * 1.6, spd: 0.9 + Math.random() * 0.7 });
    }
    item.title = makeBubble('DANCE TIME!', '#ff5fd0', '#ffffff'); item.title.visible = false; item.title.scale.setScalar(1.3); g.add(item.title);
  }

  _updDance(it, dt, tp) {
    const u = it.t, att = it.attacker; if (!att) return;
    const mid = att.pos.clone().add(tp).multiplyScalar(0.5);
    // 미러볼: 두 사람 위에서 내려와 돈다
    const pop = Math.min(1, u / 0.5);
    it.ball.scale.setScalar(Math.max(0.001, (1 - Math.pow(1 - pop, 3)) * (u > it.dur ? Math.max(0, 1 - (u - it.dur) / 0.4) : 1)));
    it.ball.position.set(mid.x, 2.7, mid.z);
    it.ball.rotation.y = u * 2.2;
    // 조명: 미러볼에서 사방으로 돌며 바닥을 쓸어간다
    for (const b of it.beams) {
      b.m.visible = u > 0.3 && u < it.dur + 0.2;
      const a = u * 1.6 + b.ph;
      b.m.position.set(mid.x, 2.7 - 2.1, mid.z);
      b.m.rotation.set(0, 0, 0);
      b.m.rotateY(a); b.m.rotateX(Math.PI + 0.45 + Math.sin(u * 2.3 + b.ph) * 0.2);
      b.m.material.opacity = 0.16 + 0.1 * Math.sin(u * 9 + b.ph);
    }
    for (const n of it.notes) {
      if (u < n.delay) continue;
      n.t += dt;
      if (n.t === dt) { n.m.visible = true; n.m.position.set(mid.x + n.x, 0.8, mid.z + n.z); }
      n.m.position.y += n.spd * dt; n.m.position.x += Math.sin(n.t * 3 + n.x * 5) * 0.3 * dt;
      n.m.rotation.z = Math.sin(n.t * 4) * 0.3; n.m.rotation.y += dt * 2;
      const fade = Math.max(0, 1 - n.t / 1.8);
      n.m.scale.setScalar(Math.max(0.001, (0.5 + 0.5 * Math.min(1, n.t * 4)) * fade));
      if (fade <= 0) n.m.visible = false;
    }
    if (it.title) {
      it.title.visible = u > 0.15 && u < 1.8;
      it.title.position.set(mid.x, 2.1 + Math.sin(u * 6) * 0.05, mid.z);
      if (this.cam) it.title.lookAt(this.cam.position);
    }
    // 비트마다 플래시
    const beat = Math.floor(u * 3.2);
    if (beat !== it._beat) { it._beat = beat; if (this.fx && u > 0.3 && u < it.dur) this.fx.flash = Math.max(this.fx.flash || 0, 0.08); if (u > 0.3 && u < it.dur) this.audio.blip(beat % 2 === 0); }
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
    const slash = own(outlined(new THREE.BoxGeometry(2.6, 0.09, 0.09), 0x8fd6f2, g));
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

  _buildForge(item, attacker) {
    // 뼈석원: 초대형 클래식 뿅망치. 흰 막대 + 빨간 원통 머리 + 흰 띠/마개. 피벗은 손 위치, 자루가 위로 뻗고 머리가 끝에
    const g = item.root;
    const h = new THREE.Group();
    const RED = 0xd3391c, WHITE = 0xffffff;
    outlined(new THREE.CylinderGeometry(0.055, 0.065, 1.3, 10), WHITE, h, new THREE.Vector3(0, 0.62, 0));            // 흰 막대
    const head = new THREE.Group(); head.position.y = 1.3; head.rotation.x = Math.PI / 2; h.add(head);                // 머리 (축 = 앞뒤 → 내려찍을 때 평평한 앞면이 닿는다)
    outlined(new THREE.CylinderGeometry(0.36, 0.36, 0.98, 18), RED, head);                                              // 빨간 원통
    outlined(new THREE.CylinderGeometry(0.375, 0.375, 0.14, 18), WHITE, head, new THREE.Vector3(0, 0.0, 0));            // 가운데 흰 띠
    for (const sy of [-1, 1]) {
      outlined(new THREE.CylinderGeometry(0.375, 0.375, 0.12, 18), WHITE, head, new THREE.Vector3(0, sy * 0.44, 0));   // 양끝 흰 마개
      outlined(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14), RED, head, new THREE.Vector3(0, sy * 0.53, 0));         // 마개 중앙 빨간 점
    }
    h.scale.setScalar(0.001);
    g.add(h); item.hammer = h;
    // 불꽃 별 (맞을 때마다 튄다)
    item.stars = [];
    for (let i = 0; i < 14; i++) {
      const st = outlined(new THREE.TetrahedronGeometry(0.06), i % 3 ? 0xffc400 : 0xffffff, g);
      st.castShadow = false; st.visible = false;
      item.stars.push({ m: st, t: -1, v: new THREE.Vector3() });
    }
    item.hits = 0;
  }

  _updForge(it, dt, tp) {
    const u = it.t, att = it.attacker; if (!att) return;
    const HIT0 = 0.45, STEP = 0.11, N = 20;
    const aim = new THREE.Vector3().subVectors(tp, att.pos).setY(0); if (aim.lengthSq() < 1e-4) aim.set(0, 0, 1); aim.normalize();
    const yaw = Math.atan2(aim.x, aim.z);
    const hm = it.hammer;
    // 망치: 손 위치(가슴 앞)에서 뒤로 젖혔다가 상대 머리로 내려친다
    const pop = Math.min(1, u / 0.25);
    let swing;   // 0 = 뒤로 치켜듦, 1 = 상대 머리에 닿음
    if (u < HIT0) swing = 0.15 * (1 - u / HIT0);
    else if (u < HIT0 + STEP * N) { const ph = ((u - HIT0) % STEP) / STEP; swing = ph < 0.45 ? 1 - ph / 0.45 : (ph - 0.45) / 0.55; swing = swing * swing; }
    else swing = 0;
    // 피벗(손) → 상대 머리 벡터로 '내려찍었을 때' 각도와 필요한 망치 길이를 구한다 → 머리가 정확히 뚝배기에 떨어진다
    const pivot = att.pos.clone().addScaledVector(aim, 0.28).add(new THREE.Vector3(0, 1.32, 0));
    const dHead = new THREE.Vector3(tp.x, 1.5, tp.z).sub(pivot);
    const fwdDist = Math.max(0.3, dHead.dot(aim)), upDist = dHead.y;
    const bottomAngle = Math.atan2(fwdDist, upDist);                 // 수직에서 상대 쪽으로 기운 각
    const HAMMER_LEN = 1.66;                                          // 자루 1.3 + 머리 반지름
    const need = (Math.hypot(fwdDist, upDist) - 0.3) / HAMMER_LEN;   // 머리 앞면(중심에서 0.49·sc 앞)이 뚝배기에 닿는 길이
    const sc = Math.max(0.62, Math.min(1.0, need + 0.06));            // 멀면 크게, 가까우면 조금 작게 (그래도 초대형)
    hm.scale.setScalar(Math.max(0.001, sc * (1 - Math.pow(1 - pop, 3))));
    hm.position.copy(pivot);
    hm.rotation.set(0, yaw, 0);
    hm.rotateX(-1.1 + (1.1 + bottomAngle + 0.12) * swing);            // 뒤로 -63° → 상대 머리까지 (살짝 더 눌러 찌그러뜨리는 느낌)
    // 타격 카운트: 내려찍기가 바닥에 닿는 순간(ph≥0.97)마다 한 번. 프레임을 건너뛰어도 빠진 횟수는 따라잡는다
    if (u >= HIT0 && it.hits < N) {
      const idx = Math.floor((u - HIT0) / STEP), ph = ((u - HIT0) % STEP) / STEP;
      const reached = Math.min(N, idx + (ph >= 0.97 ? 1 : 0));
      while (it.hits < reached) {
        const k = ++it.hits;
        if (this.audio.squeak) this.audio.squeak(1 + k * 0.03); this.audio.impact(0.35 + 0.02 * k, 'hook');
        if (this.fx) {
          this.fx.flash = Math.max(this.fx.flash || 0, 0.12 + 0.02 * k);
          if (this.cam) {
            const v = new THREE.Vector3(tp.x, 1.55, tp.z).project(this.cam);
            const big = k === N;
            this.fx.addPopup((v.x * 0.5 + 0.5) * this.fx.w + (Math.random() - 0.5) * 120, (1 - (v.y * 0.5 + 0.5)) * this.fx.h - 40 - Math.random() * 60, big ? '+20강 성공!!!' : `+${k}강!`, big || k % 5 === 0 ? 'groggy' : 'dodge');
          }
        }
        if (k === N) { this.audio.bassHit(); if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.6); }
        // 별 튀김
        let spawned = 0;
        for (const st of it.stars) {
          if (st.t >= 0 && st.t < 0.35) continue;
          if (spawned++ >= (k === N ? 14 : 4)) break;
          st.t = 0; st.m.visible = true; st.m.position.set(tp.x, 1.5, tp.z);
          const a = Math.random() * Math.PI * 2; st.v.set(Math.cos(a) * (1.5 + Math.random() * 2), 2 + Math.random() * 3, Math.sin(a) * (1.5 + Math.random() * 2));
          st.m.scale.setScalar(k === N ? 2 : 1);
        }
      }
    }
    for (const st of it.stars) {
      if (st.t < 0) continue;
      st.t += dt; st.v.y -= 12 * dt; st.m.position.addScaledVector(st.v, dt);
      st.m.rotation.x += dt * 9; st.m.rotation.y += dt * 7;
      if (st.t > 0.45) { st.t = -1; st.m.visible = false; }
    }
    if (u > it.dur) hm.scale.setScalar(Math.max(0.001, sc * Math.max(0, 1 - (u - it.dur) / 0.4)));
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
    const head = own(outlined(new THREE.SphereGeometry(0.13, 12, 10), 0xfff6d0, b, new THREE.Vector3(-0.78, 0.9, 0)));
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
    // 첫 대가 박힌 뒤, 촬영자 등 뒤 하늘에서 오토바이 떼가 줄줄이 날아와 상대를 들이받는다
    item.swarm = [];
    for (let i = 0; i < 24; i++) {
      const sb = makeBikeLite();
      const sc = 0.42 + Math.random() * 0.16;
      sb.visible = false; sb.scale.setScalar(sc);
      g.add(sb);
      // 카메라(촬영자 등 뒤)를 뚫고 지나가지 않게 좌우 위쪽 하늘에서 비스듬히 날아든다
      const sideSign = i % 2 ? 1 : -1;
      item.swarm.push({ m: sb, at: 1.5 + i * 0.06, t: -1, side: sideSign * (1.8 + Math.random() * 2.6), h: 2.8 + Math.random() * 3.2, back: 0.5 + Math.random() * 2.2, spin: (Math.random() - 0.5) * 10, sc });
    }
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
      else if (it.kind === 'forge') this._updForge(it, dt, tp);
      else if (it.kind === 'coffeeBarrage') this._updCoffee(it, dt, tp);
      else if (it.kind === 'danceTime') this._updDance(it, dt, tp);
      if (it.t > it.dur + 1.4) {
        this._release(it);
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
    // 스태프: 등장 → 촬영(카메라 들고 흔들흔들, REC 점멸) → 순서대로 다가가 싸대기 → 펑 하고 사라짐
    for (const st of it.staff || []) {
      const m = st.m, ud = m.userData;
      const pop = Math.min(1, Math.max(0, (u - 0.1 - st.order * 0.06) / 0.25));
      const bob = Math.sin(u * 6 + st.order) * 0.03;
      if (st.phase === 'film') {
        m.scale.setScalar(Math.max(0.001, it.staffScale * (1 - Math.pow(1 - pop, 3))));
        m.position.y = bob;
        ud.armL.rotation.x = -0.15 + Math.sin(u * 4 + st.order * 2) * 0.05;
        ud.rec.visible = Math.sin(u * 8 + st.order) > 0;
        m.lookAt(tp.x, 0, tp.z);
        if (u >= st.slapAt - 0.32) { st.phase = 'approach'; st.t = 0; st.from = m.position.clone(); }
      } else if (st.phase === 'approach') {
        st.t += dt;
        const k = Math.min(1, st.t / 0.22), e = 1 - Math.pow(1 - k, 2);
        const want = tp.clone().add(new THREE.Vector3(Math.sin(st.ang), 0, Math.cos(st.ang)).multiplyScalar(0.5));
        m.position.lerpVectors(st.from, want, e); m.position.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.12;   // 두 발짝 콩콩
        ud.legL.rotation.x = Math.sin(k * Math.PI * 4) * 0.5; ud.legR.rotation.x = -Math.sin(k * Math.PI * 4) * 0.5;
        ud.armL.rotation.x = -0.15 + 0.9 * e;                    // 카메라 내리고
        ud.armR.rotation.x = -2.2 * e; ud.armR.rotation.z = -0.25 - 1.3 * e;   // 손 크게 치켜들고
        m.lookAt(tp.x, 0, tp.z);
        if (u >= st.slapAt) { st.phase = 'slap'; st.t = 0; }
      } else if (st.phase === 'slap') {
        st.t += dt;
        const k = Math.min(1, st.t / 0.09);
        ud.armR.rotation.x = -2.2 + 2.6 * k; ud.armR.rotation.z = -1.55 + 2.3 * k;   // 휘두르기
        m.rotation.y += 0; m.position.y = 0;
        if (!st.hit && k >= 1) {
          st.hit = true;
          this.audio.impact(0.7, 'hook');
          if (this.fx) {
            this.fx.flash = Math.max(this.fx.flash || 0, 0.18);
            if (this.cam) { const v = new THREE.Vector3(tp.x, 1.45, tp.z).project(this.cam); this.fx.addPopup((v.x * 0.5 + 0.5) * this.fx.w + st.sgn * 60, (1 - (v.y * 0.5 + 0.5)) * this.fx.h - 30, st.order === it.staff.length - 1 ? '짝!!!' : '짝!', 'groggy'); }
          }
          if (it.target && it.target.react) { it.target.react.headY = st.sgn * 0.95; it.target.react.headZ = -st.sgn * 0.3; }
        }
        if (st.t > 0.3) { st.phase = 'gone'; st.t = 0; }
      } else if (st.phase === 'gone') {
        st.t += dt;
        const k = Math.min(1, st.t / 0.18);
        const S = it.staffScale; m.scale.set(Math.max(0.001, S * (1 + 0.6 * k)), Math.max(0.001, S * (1 - k)), Math.max(0.001, S * (1 + 0.6 * k)));   // 납작하게 펑
        if (k >= 1) m.visible = false;
      }
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
      const pull = p.pull || 1.5;
      p.m.position.x += (tp.x - p.m.position.x) * Math.min(1, dt * pull);
      p.m.position.z += (tp.z - p.m.position.z) * Math.min(1, dt * pull);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
      if (p.m.position.y <= 0.32) {
        p.m.position.y = 0.32; p.landed = 0.0001;
        // 착지음은 40ms 에 한 번만 (120개가 겹치면 소리가 뭉개진다)
        if (!it._lastThud || it.t - it._lastThud > 0.04) { it._lastThud = it.t; this.audio.impact(0.4, 'follow'); if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.08); }
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
    // ---- 오토바이 떼 ----
    for (const sw of it.swarm || []) {
      if (u < sw.at) continue;
      const m = sw.m;
      if (sw.t < 0) {
        sw.t = 0; m.visible = true;
        sw.from = base.clone().addScaledVector(fwd, -sw.back).add(new THREE.Vector3(fwd.z * sw.side, sw.h, -fwd.x * sw.side));
        m.position.copy(sw.from);
        if (!it._lastRev || u - it._lastRev > 0.3) { it._lastRev = u; this.audio.engine(1.1); }
      }
      sw.t += dt;
      if (!sw.hit) {
        const k = Math.min(1, sw.t / 0.48);
        const target = new THREE.Vector3(tp.x + fwd.z * sw.side * 0.12, 0.9, tp.z - fwd.x * sw.side * 0.12);
        m.position.lerpVectors(sw.from, target, k);
        m.position.y += Math.sin(k * Math.PI) * 1.1;
        m.rotation.y = Math.atan2(fwd.x, fwd.z) + Math.PI / 2 + sw.side * 0.15;
        m.rotation.z += dt * sw.spin; m.rotation.x += dt * 1.5;
        if (k >= 1) {
          sw.hit = true; sw.life = 0;
          sw.vel = new THREE.Vector3(fwd.x * (2 + Math.random() * 3) + (Math.random() - 0.5) * 5, 3 + Math.random() * 3.5, fwd.z * (2 + Math.random() * 3) + (Math.random() - 0.5) * 5);
          if (!it._lastCrash || u - it._lastCrash > 0.07) {
            it._lastCrash = u; this.audio.impact(0.85, 'hook'); this.audio.clang(0.9);
            if (this.fx) this.fx.flash = Math.max(this.fx.flash || 0, 0.22);
          }
        }
      } else {
        // 튕겨 나가 굴러가다 사라진다
        sw.vel.y -= 18 * dt; m.position.addScaledVector(sw.vel, dt);
        if (m.position.y < 0.3) { m.position.y = 0.3; sw.vel.y *= -0.35; sw.vel.x *= 0.7; sw.vel.z *= 0.7; }
        m.rotation.z += dt * sw.spin * 0.5;
        sw.life += dt;
        if (sw.life > 0.75) { const f = Math.max(0, 1 - (sw.life - 0.75) / 0.35); m.scale.setScalar(Math.max(0.001, sw.sc * f)); if (f <= 0) m.visible = false; }
      }
    }
  }

  clear() {
    for (const it of this.active) this._release(it);
    this.active.length = 0;
  }
}
