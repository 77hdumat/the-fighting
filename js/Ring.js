// Ring.js — 복싱 링, 어두운 관중석, 스포트라이트, 카메라 플래시
import * as THREE from 'three';
import { PHOTOREAL } from './RenderSettings.js';
import { surfaceTexture, addArenaStructure, disposeEnvironment } from './Environment.js';

function ringMaterial(options) {
  return new THREE.MeshStandardMaterial({ roughness: .72, metalness: 0, ...options });
}

function canvasTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const paint=(image=null)=>{
  g.fillStyle = '#e9e4d6';
  g.fillRect(0, 0, 1024, 1024);
  if(image)g.drawImage(image,0,0,1024,1024);
  // 캔버스 질감
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  // 중앙 원 + 링 로고 느낌
  g.strokeStyle = '#823b37';
  g.lineWidth = 14;
  g.beginPath(); g.arc(512, 512, 200, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.beginPath(); g.arc(512, 512, 150, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2f4362';
  g.font = '900 120px Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('D R', 512, 512);
  // 코너 마크
  g.fillStyle = '#823b37'; g.fillRect(40, 40, 90, 90);
  g.fillStyle = '#2f4362'; g.fillRect(894, 894, 90, 90);
  };paint();
  const tex = new THREE.CanvasTexture(c);
  const image=new Image();image.onload=()=>{paint(image);tex.needsUpdate=true;};image.src='assets/environment/ring-canvas-v1.jpg';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildRing(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x111a28);
  scene.fog = new THREE.FogExp2(0x111a28, 0.025);

  // ---- 링 바닥 ----
  const weave=surfaceTexture('fabric');weave.repeat.set(24,24);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.9, 9.9), ringMaterial({ map: canvasTexture(), bumpMap:weave,bumpScale:.013,roughness:.94 }));
  floor.name='woven-ring-canvas';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const platform = new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.7, 11.1), ringMaterial({ color: 0x1a1a22 }));
  platform.position.y = -0.36;
  platform.receiveShadow = true;
  group.add(platform);
  // 에이프런 (스커트)
  const apron = new THREE.Mesh(new THREE.BoxGeometry(11.13, 0.5, 11.13), ringMaterial({ color: 0x7a1d24,bumpMap:weave,bumpScale:.018,roughness:.92 }));
  apron.position.y = -0.28;
  group.add(apron);

  // ---- 포스트 / 코너 패드 / 로프 ----
  const postMat = ringMaterial({ color: 0x535861,metalness:.75,roughness:.35 });
  const padColors = [0xd0302c, 0x2438c8, 0xf0f0f0, 0xf0f0f0];
  const corners = [[4.72, 4.72], [-4.72, -4.72], [4.72, -4.72], [-4.72, 4.72]];
  corners.forEach(([x, z], i) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 12), postMat);
    post.position.set(x, 0.8, z);
    post.castShadow = true;
    group.add(post);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.0, 16), ringMaterial({ color: padColors[i],roughness:.65 }));
    pad.position.set(x, 0.95, z);
    group.add(pad);
    for(const h of [.52,.90,1.28]) {
      const band=new THREE.Mesh(new THREE.TorusGeometry(.143,.008,4,16),ringMaterial({color:0xdddddf,roughness:.8}));
      band.rotation.x=Math.PI/2;band.position.set(x,h,z);group.add(band);
    }
  });
  const ropeColors = [0xd0302c, 0xf0f0f0, 0x2438c8];
  const ropeHeights = [0.5, 0.9, 1.3];
  ropeHeights.forEach((h, i) => {
    const mat = ringMaterial({ color: ropeColors[i],bumpMap:weave,bumpScale:.008,roughness:.78 });
    for (let side = 0; side < 4; side++) {
      const off = 4.72;
      const points=[];
      for(let j=0;j<=16;j++){const along=-off+j/16*off*2,sag=.065*Math.sin(j/16*Math.PI);points.push(new THREE.Vector3(side%2?(side===1?off:-off):along,h-sag,side%2?along:(side===0?off:-off)));}
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),32,.03,8,false),mat);
      rope.castShadow = true;
      group.add(rope);
    }
  });
  const tieMat=ringMaterial({color:0xe5e3dc,roughness:.95});
  for(let side=0;side<4;side++)for(const along of [-2.3,2.3]){
    const tie=new THREE.Mesh(new THREE.BoxGeometry(.055,.82,.055),tieMat);
    tie.position.set(side%2?(side===1?4.72:-4.72):along,.87,side%2?along:(side===0?4.72:-4.72));group.add(tie);
  }
  const stepMat=ringMaterial({color:0x626872,metalness:.55,roughness:.7});
  for(let i=0;i<3;i++){const stair=new THREE.Mesh(new THREE.BoxGeometry(1.4,.2*(i+1),.42),stepMat);stair.position.set(-3.6,-.72+.1*(i+1),5.95-i*.42);stair.receiveShadow=true;group.add(stair);}

  // ---- 바깥 어둠: 바닥 + 관중 실루엣 ----
  const groundDetail=surfaceTexture('concrete');groundDetail.repeat.set(12,12);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), ringMaterial({color:0x303641,bumpMap:groundDetail,bumpScale:.025,roughness:.96}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.72;
  group.add(ground);
  const architecture=addArenaStructure(group);

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

  const bloomObjects = architecture.bloomObjects;
  if (PHOTOREAL) {
    // One shadow-casting spotlight, two unshadowed fills; fixtures emit without lights.
    spot.intensity = 240; spot.decay = 2;
    spot.angle = .72; spot.penumbra = .65;
    spot.shadow.normalBias = .025;
    fill.intensity = .6; rim.intensity = .85;
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
      disposeEnvironment(group);
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
