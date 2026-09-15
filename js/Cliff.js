// Cliff.js — 암벽 맵: 링 대신 거대한 바위 고원 위에서 싸운다. 가장자리 밖으로 나가면 낙사.
// buildRing 과 같은 인터페이스({ update, cheer, fill, dispose })를 제공해 Game 이 그대로 쓸 수 있게 한다.
import * as THREE from 'three';

const toonRamp = (() => {
  const data = new Uint8Array([60, 60, 150, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

function rockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#8a7d6f';
  g.fillRect(0, 0, 1024, 1024);
  // 암반 결 + 균열
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024;
    const r = 10 + Math.random() * 90;
    g.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${78 + Math.random() * 50 | 0},${66 + Math.random() * 40 | 0},0.35)`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.4 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(40,32,26,0.55)';
  for (let i = 0; i < 34; i++) {
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    let x = Math.random() * 1024, y = Math.random() * 1024;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 260; y += (Math.random() - 0.5) * 260; g.lineTo(x, y); }
    g.stroke();
  }
  // 중앙 투기장 마크
  g.strokeStyle = 'rgba(210,60,40,0.55)'; g.lineWidth = 12;
  g.beginPath(); g.arc(512, 512, 250, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.beginPath(); g.arc(512, 512, 180, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 고원 가장자리 반경 (각도에 따라 울퉁불퉁) */
export const CLIFF_R = 8.6;
export const SECTORS = 16;

/** 각도별 기본 반경 (울퉁불퉁) */
export function cliffRadius(x, z, R = CLIFF_R) {
  const a = Math.atan2(z, x);
  return R + Math.sin(a * 3.1) * 0.6 + Math.sin(a * 5.7 + 1.2) * 0.35;
}

export function buildCliff(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x0a0d14);
  scene.fog = new THREE.FogExp2(0x0a0d14, 0.028);

  const rockMat = new THREE.MeshToonMaterial({ map: rockTexture(), gradientMap: toonRamp });
  const rockDark = new THREE.MeshToonMaterial({ color: 0x5c5046, gradientMap: toonRamp });

  // ---- 고원: 섹터 조각들로 만든다 (1분 뒤부터 조각이 무너져 내린다) ----
  const SEG = 64, R = CLIFF_R;
  const sectors = [];
  const SECTOR_SEG = 6;      // 조각 하나의 원주 분할
  for (let s2 = 0; s2 < SECTORS; s2++) {
    const a0 = (s2 / SECTORS) * Math.PI * 2, span = (Math.PI * 2) / SECTORS;
    const g2 = new THREE.Group();
    // 상판 부채꼴
    const topGeo = new THREE.CircleGeometry(1, SECTOR_SEG, a0, span);
    {
      const pos = topGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const len = Math.hypot(x, y);
        if (len < 1e-4) continue;
        const r = cliffRadius(x, y, R);
        pos.setXY(i, (x / len) * r, (y / len) * r);
      }
      topGeo.computeVertexNormals();
    }
    const topM = new THREE.Mesh(topGeo, rockMat);
    topM.rotation.x = -Math.PI / 2;
    topM.receiveShadow = true;
    g2.add(topM);
    // 옆면 (조각 아래로 뻗은 암벽)
    const sideGeo = new THREE.CylinderGeometry(1, 0.84, 9, SECTOR_SEG, 1, true, a0, span);
    {
      const pos = sideGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const len = Math.hypot(x, z);
        if (len < 1e-4) continue;
        const scale = cliffRadius(x, z, R) * (y > 0 ? 1 : 0.86);
        const jag = 1 + Math.sin(y * 1.7 + Math.atan2(z, x) * 4) * 0.04;
        pos.setXYZ(i, (x / len) * scale * jag, y, (z / len) * scale * jag);
      }
      sideGeo.computeVertexNormals();
    }
    const sideM = new THREE.Mesh(sideGeo, rockDark);
    sideM.position.y = -4.5;
    g2.add(sideM);
    group.add(g2);
    sectors.push({ g: g2, idx: s2, mid: a0 + span / 2, state: 'ok', t: 0, vy: 0, spin: 0 });
  }

  // ---- 주변 봉우리 (멀리 솟은 바위 기둥들) ----
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const dist = 11 + Math.random() * 9;
    const h = 5 + Math.random() * 12;
    const rr = 0.8 + Math.random() * 1.9;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(rr, h, 6 + (i % 3)), rockDark);
    peak.position.set(Math.cos(a) * dist, -6 + h / 2, Math.sin(a) * dist);
    peak.rotation.y = Math.random() * 3;
    group.add(peak);
  }

  // ---- 가장자리 경고 링 (여기 넘으면 떨어진다) ----
  const edgeGeo = new THREE.RingGeometry(1, 1.06, SEG);
  {
    const pos = edgeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const len = Math.hypot(x, y) || 1;
      const base = cliffRadius(x, y, R);
      const r = len > 1.03 ? base : base - 0.55;     // 안쪽/바깥쪽 링
      pos.setXY(i, (x / len) * r, (y / len) * r);
    }
  }
  const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.012;
  group.add(edge);

  // ---- 바닥 없는 어둠 + 아래쪽 안개 ----
  const abyss = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 60, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide }));
  abyss.position.y = -28;
  group.add(abyss);

  // ---- 조명: 위에서 내리쬐는 햇빛 + 협곡 반사광 ----
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.6);
  sun.position.set(6, 14, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x4a3c30, 0.95);
  scene.add(hemi);
  const fill = new THREE.PointLight(0xffe7c4, 11, 16, 2);
  fill.position.set(0, 3.4, 2.5);
  scene.add(fill);

  const flashes = [];   // 링 인터페이스 맞추기용 (암벽엔 카메라 플래시 없음)

  // ---- 붕괴 상태 ----
  let clock = 0;            // 경기 시작 후 경과
  let nextBreak = 60;       // 1분 뒤 첫 붕괴, 이후 점점 잦아진다
  const rubble = [];
  const sectorOf = (x, z) => {
    let a = Math.atan2(z, x); if (a < 0) a += Math.PI * 2;
    return Math.floor((a / (Math.PI * 2)) * SECTORS) % SECTORS;
  };
  const spawnRubble = (sec, n) => {
    for (let i = 0; i < n; i++) {
      const a = sec.mid + (Math.random() - 0.5) * (Math.PI * 2 / SECTORS) * 0.9;
      const rr = R * (0.55 + Math.random() * 0.45);
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.22, 0), rockDark);
      m.position.set(Math.cos(a) * rr, -0.1, Math.sin(a) * rr);
      group.add(m);
      rubble.push({ m, vy: -0.5 - Math.random(), sx: (Math.random() - 0.5) * 0.6, sz: (Math.random() - 0.5) * 0.6, t: 0 });
    }
  };

  return {
    group,
    kind: 'cliff',
    fill,
    /** 무너진 섹터는 반경 0 → 그 방향은 발판이 없다 */
    radius: (x, z) => {
      const sec = sectors[sectorOf(x, z)];
      // 조각이 떨어져 나가기 시작하면 그 순간부터 발판이 없다
      if (sec && (sec.state === 'gone' || sec.state === 'falling')) return 0.0;
      return cliffRadius(x, z, R);
    },
    /** 흔들리는 중인 섹터인지 (연출/경고용) */
    shakingAt: (x, z) => {
      const sec = sectors[sectorOf(x, z)];
      return sec && sec.state === 'shake' ? 1 : 0;
    },
    reset() {
      clock = 0; nextBreak = 60;
      for (const sec of sectors) { sec.state = 'ok'; sec.t = 0; sec.vy = 0; sec.spin = 0; sec.g.visible = true; sec.g.position.set(0, 0, 0); sec.g.rotation.set(0, 0, 0); }
      for (const r of rubble) group.remove(r.m);
      rubble.length = 0;
    },
    update(dt, excitement) {
      edge.material.opacity = 0.25 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
      clock += dt;

      // 1분 뒤부터 랜덤 섹터가 무너진다 (점점 빨라짐)
      if (clock > nextBreak) {
        const alive = sectors.filter((x) => x.state === 'ok');
        if (alive.length > 4) {
          const sec = alive[Math.floor(Math.random() * alive.length)];
          sec.state = 'shake'; sec.t = 0;
        }
        nextBreak = clock + Math.max(4.5, 11 - clock * 0.05);
      }

      for (const sec of sectors) {
        if (sec.state === 'shake') {
          sec.t += dt;
          // 후두둑 — 크게 흔들리며 자갈이 떨어진다
          const amp = 0.02 + 0.06 * (sec.t / 1.6);
          sec.g.position.set(Math.sin(sec.t * 47) * amp, Math.sin(sec.t * 61) * amp * 1.4, Math.cos(sec.t * 53) * amp);
          sec.g.rotation.z = Math.sin(sec.t * 37) * amp * 0.25;
          if (Math.random() < dt * 22) spawnRubble(sec, 1);
          if (sec.t > 1.6) { sec.state = 'falling'; sec.t = 0; sec.vy = 0; sec.spin = (Math.random() - 0.5) * 1.2; spawnRubble(sec, 8); }
        } else if (sec.state === 'falling') {
          sec.t += dt; sec.vy -= 16 * dt;
          sec.g.position.y += sec.vy * dt;
          sec.g.position.x += Math.cos(sec.mid) * dt * 0.8;
          sec.g.position.z += Math.sin(sec.mid) * dt * 0.8;
          sec.g.rotation.x += sec.spin * dt; sec.g.rotation.z += sec.spin * dt * 0.6;
          if (sec.g.position.y < -22) { sec.state = 'gone'; sec.g.visible = false; }
        }
      }
      for (let i = rubble.length - 1; i >= 0; i--) {
        const r = rubble[i];
        r.t += dt; r.vy -= 14 * dt;
        r.m.position.x += r.sx * dt; r.m.position.z += r.sz * dt; r.m.position.y += r.vy * dt;
        r.m.rotation.x += dt * 3; r.m.rotation.y += dt * 2;
        if (r.m.position.y < -20 || r.t > 6) { group.remove(r.m); r.m.geometry.dispose(); rubble.splice(i, 1); }
      }
    },
    cheer() {},
    setCrowd() {},
    dispose() {
      scene.remove(group); scene.remove(sun); scene.remove(hemi); scene.remove(fill);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
}
