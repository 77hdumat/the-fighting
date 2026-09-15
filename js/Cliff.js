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
export function cliffRadius(x, z, R = 6.2) {
  const a = Math.atan2(z, x);
  return R + Math.sin(a * 3.1) * 0.45 + Math.sin(a * 5.7 + 1.2) * 0.25;
}

export function buildCliff(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x0a0d14);
  scene.fog = new THREE.FogExp2(0x0a0d14, 0.028);

  const rockMat = new THREE.MeshToonMaterial({ map: rockTexture(), gradientMap: toonRamp });
  const rockDark = new THREE.MeshToonMaterial({ color: 0x5c5046, gradientMap: toonRamp });

  // ---- 고원 상판: 원판을 각도별로 찌그러뜨려 자연스러운 바위 실루엣 ----
  const SEG = 48, R = 6.2;
  const topGeo = new THREE.CircleGeometry(1, SEG);
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
  const top = new THREE.Mesh(topGeo, rockMat);
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  group.add(top);

  // ---- 절벽 옆면: 아래로 갈수록 살짝 좁아지는 기둥 ----
  const sideGeo = new THREE.CylinderGeometry(1, 0.82, 9, SEG, 1, true);
  {
    const pos = sideGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const len = Math.hypot(x, z);
      if (len < 1e-4) continue;
      const scale = cliffRadius(x, z, R) * (y > 0 ? 1 : 0.86);
      const jag = 1 + Math.sin(y * 1.7 + Math.atan2(z, x) * 4) * 0.035;
      pos.setXYZ(i, (x / len) * scale * jag, y, (z / len) * scale * jag);
    }
    sideGeo.computeVertexNormals();
  }
  const side = new THREE.Mesh(sideGeo, rockDark);
  side.position.y = -4.5;
  group.add(side);

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

  return {
    group,
    kind: 'cliff',
    fill,
    radius: (x, z) => cliffRadius(x, z, R),
    update(dt, excitement) {
      // 가장자리 경고 링 맥동
      edge.material.opacity = 0.25 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
    },
    cheer() {},
    setCrowd() {},
    dispose() {
      scene.remove(group); scene.remove(sun); scene.remove(hemi); scene.remove(fill);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
}
