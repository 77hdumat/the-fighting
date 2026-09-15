// Ring.js — 복싱 링, 어두운 관중석, 스포트라이트, 카메라 플래시
import * as THREE from 'three';
import { PHOTOREAL } from './RenderSettings.js';

function ringMaterial(options) {
  if (!PHOTOREAL) return new THREE.MeshToonMaterial({ ...options, gradientMap: toonRamp });
  return new THREE.MeshStandardMaterial({ roughness: .72, metalness: 0, ...options });
}

const toonRamp = (() => {
  const data = new Uint8Array([70, 70, 170, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

function canvasTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d6';
  g.fillRect(0, 0, 1024, 1024);
  // 캔버스 질감
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  // 중앙 원 + 링 로고 느낌
  g.strokeStyle = '#b8342e';
  g.lineWidth = 14;
  g.beginPath(); g.arc(512, 512, 200, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.beginPath(); g.arc(512, 512, 150, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2438c8';
  g.font = '900 120px Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('D R', 512, 512);
  // 코너 마크
  g.fillStyle = '#b8342e'; g.fillRect(40, 40, 90, 90);
  g.fillStyle = '#2438c8'; g.fillRect(894, 894, 90, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildRing(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.042);

  // ---- 링 바닥 ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.9, 9.9), ringMaterial({ map: canvasTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const platform = new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.7, 11.1), ringMaterial({ color: 0x1a1a22 }));
  platform.position.y = -0.36;
  platform.receiveShadow = true;
  group.add(platform);
  // 에이프런 (스커트)
  const apron = new THREE.Mesh(new THREE.BoxGeometry(11.13, 0.5, 11.13), ringMaterial({ color: 0x7a1d24 }));
  apron.position.y = -0.28;
  group.add(apron);

  // ---- 포스트 / 코너 패드 / 로프 ----
  const postMat = ringMaterial({ color: 0x2a2a30 });
  if (PHOTOREAL) { postMat.metalness = .75; postMat.roughness = .35; }
  const padColors = [0xd0302c, 0x2438c8, 0xf0f0f0, 0xf0f0f0];
  const corners = [[4.72, 4.72], [-4.72, -4.72], [4.72, -4.72], [-4.72, 4.72]];
  corners.forEach(([x, z], i) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 12), postMat);
    post.position.set(x, 0.8, z);
    post.castShadow = true;
    group.add(post);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 12), ringMaterial({ color: padColors[i] }));
    pad.position.set(x, 0.95, z);
    group.add(pad);
  });
  const ropeColors = [0xd0302c, 0xf0f0f0, 0x2438c8];
  const ropeHeights = [0.5, 0.9, 1.3];
  ropeHeights.forEach((h, i) => {
    const mat = ringMaterial({ color: ropeColors[i] });
    for (let side = 0; side < 4; side++) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9.45, 8), mat);
      rope.rotation.z = Math.PI / 2;
      if (side % 2) rope.rotation.y = Math.PI / 2;
      const off = 4.72;
      if (side === 0) rope.position.set(0, h, off);
      if (side === 1) rope.position.set(off, h, 0);
      if (side === 2) rope.position.set(0, h, -off);
      if (side === 3) rope.position.set(-off, h, 0);
      rope.castShadow = true;
      group.add(rope);
    }
  });

  // ---- 바깥 어둠: 바닥 + 관중 실루엣 ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x020204 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.72;
  group.add(ground);

  // ---- 관중 없음. 링 코너 밖에 코치 4명 (Game 이 buildBoxer 로 세운다) ----
  const updateCrowd = () => {};
  const crowdLight = new THREE.HemisphereLight(0x776a66, 0x2a1e1a, 0.35);
  if (!PHOTOREAL) scene.add(crowdLight);

  // ---- 카메라 플래시 (스프라이트 깜빡임) ----
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flashes = [];
  for (let i = 0; i < 36; i++) {
    const mat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * 6;
    sp.position.set(Math.cos(a) * r, 0.6 + Math.random() * 2.5, Math.sin(a) * r);
    sp.scale.setScalar(0.6);
    if (PHOTOREAL) sp.visible = false;
    group.add(sp);
    flashes.push({ sp, t: Math.random() * 3 });
  }

  // ---- 조명: 링 위 스포트라이트, 어두운 주변 ----
  const ambient = new THREE.AmbientLight(0x5a4a44, 0.6);
  if (!PHOTOREAL) scene.add(ambient);
  const spot = new THREE.SpotLight(0xfff2dc, 170, 30, 0.62, 0.45, 1.4);
  spot.position.set(0.5, 9, 1);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  spot.shadow.camera.near = 2;
  spot.shadow.camera.far = 20;
  scene.add(spot, spot.target);



  // 키 라이트 (셀 셰이딩 명암 경계를 만드는 주광)
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 6, 4);
  if (!PHOTOREAL) scene.add(key);
  // 정면 필라이트 (카메라 쪽에서 몸통이 어둡게 죽지 않게)
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.75);
  fill.position.set(0, 3, 6);
  scene.add(fill, fill.target);
  // 푸른 림라이트 (역광)
  const rim = new THREE.DirectionalLight(0x7a8cff, 1.1);
  rim.position.set(-4, 3, -5);
  scene.add(rim);

  const bloomObjects = [];
  if (PHOTOREAL) {
    // One shadow-casting spotlight, two unshadowed fills; fixtures emit without lights.
    spot.intensity = 240; spot.decay = 2;
    spot.angle = .72; spot.penumbra = .65;
    spot.shadow.normalBias = .025;
    fill.intensity = .6; rim.intensity = .85;
    const fixtures = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, .06, .5),
      new THREE.MeshStandardMaterial({ color: 0x151923, emissive: 0xffe1bb, emissiveIntensity: 5 }), 8);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      matrix.makeRotationY(-angle);
      matrix.setPosition(Math.cos(angle) * 5.5, 7.5, Math.sin(angle) * 5.5);
      fixtures.setMatrixAt(i, matrix);
    }
    fixtures.instanceMatrix.needsUpdate = true;
    group.add(fixtures); bloomObjects.push(fixtures);
  }

  let crowdT = 0, jump = 0, frame = 0;
  return {
    group,
    kind: 'ring',
    fill,
    bloomObjects,
    dispose() {
      scene.remove(group);
      scene.remove(crowdLight, ambient, key, key.target, spot, spot.target, fill, fill.target, rim, rim.target);
      spot.shadow.dispose();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      group.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          if (material.map) textures.add(material.map);
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
    cheer() { jump = 1; },
    update(dt, excitement = 0) {
      crowdT += dt;
      jump *= Math.exp(-dt * 4);
      // 관중은 2프레임에 한 번만 갱신 (1560 행렬 compose 절감)

      for (const f of flashes) {
        f.t -= dt;
        if (f.t <= 0) {
          f.t = 0.4 + Math.random() * (3.5 - 2.5 * excitement);
          f.sp.material.opacity = 1;
          f.sp.scale.setScalar(0.5 + Math.random() * 0.8);
        }
        f.sp.material.opacity *= Math.exp(-dt * 12);
        if (PHOTOREAL) f.sp.visible = f.sp.material.opacity > .01;
      }
    },
  };
}
