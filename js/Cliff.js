// Cliff.js — 암벽 맵: 링 대신 거대한 바위 고원 위에서 싸운다. 가장자리 밖으로 나가면 낙사.
// buildRing 과 같은 인터페이스({ update, cheer, fill, dispose })를 제공해 Game 이 그대로 쓸 수 있게 한다.
import * as THREE from 'three';
import { surfaceTexture, disposeEnvironment } from './Environment.js';

function rockTexture() {
  const tex=new THREE.TextureLoader().load('assets/environment/sandstone-v1.jpg');
  tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(3,3);tex.anisotropy=4;return tex;
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
  scene.background = new THREE.Color(0x889da9);
  scene.fog = new THREE.FogExp2(0x889da9, 0.014);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(75,24,12),new THREE.ShaderMaterial({
    vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec3 direction;void main(){float h=normalize(direction).y;vec3 c=mix(vec3(.70,.68,.59),vec3(.18,.34,.49),smoothstep(-.1,.65,h));gl_FragColor=vec4(c,1.);}',
    side:THREE.BackSide,depthWrite:false,
  }));sky.name='canyon-sky';group.add(sky);

  const topDetail=rockTexture(),sideColor=rockTexture(),strata=surfaceTexture('rock');sideColor.repeat.set(2,2);strata.repeat.set(2,3);
  const rockMat = new THREE.MeshStandardMaterial({map:topDetail,bumpMap:topDetail,bumpScale:.035,roughness:.98});
  const rockDark = new THREE.MeshStandardMaterial({color:0xc1b6a2,map:sideColor,bumpMap:strata,bumpScale:.08,roughness:.96});

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
    const sideGeo = new THREE.CylinderGeometry(1, 0.84, 9, SECTOR_SEG, 12, true, a0, span);
    {
      const pos = sideGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const len = Math.hypot(x, z);
        if (len < 1e-4) continue;
        const depth=(4.5-y)/9;
        const scale = cliffRadius(x, z, R) * (1-depth*.14);
        const jag = 1 + depth*(Math.sin(y*3.1+Math.atan2(z,x)*8)*.045+Math.sin(y*1.7)*.025);
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
  const peakGeo=new THREE.CylinderGeometry(.64,1,1,12,10);
  const peakPos=peakGeo.attributes.position;
  for(let i=0;i<peakPos.count;i++){
    const x=peakPos.getX(i),y=peakPos.getY(i),z=peakPos.getZ(i),a=Math.atan2(z,x);
    const ripple=1+Math.sin(y*28+a*5)*.10+Math.cos(a*3+y*11)*.07;
    peakPos.setXYZ(i,x*ripple,y+(y>.49?Math.sin(a*3)*.08:0),z*ripple);
  }
  peakGeo.computeVertexNormals();
  const peaks=new THREE.InstancedMesh(peakGeo,rockDark,48),dummy=new THREE.Object3D();
  for(let i=0;i<48;i++){
    const a=(i%24)/24*Math.PI*2+Math.random()*.16,far=i>=24,dist=far?34+Math.random()*18:15+Math.random()*10;
    const h=far?12+Math.random()*12:5+Math.random()*10,rr=far?3+Math.random()*4:1.3+Math.random()*1.8;
    dummy.position.set(Math.cos(a)*dist,-10+h/2,Math.sin(a)*dist);dummy.rotation.y=Math.random()*3;dummy.scale.set(rr,h,rr*.8);dummy.updateMatrix();peaks.setMatrixAt(i,dummy.matrix);
    peaks.setColorAt(i,new THREE.Color(far?0xaab2b1:0xc9b89c));
  }
  peaks.name='layered-canyon-pillars';group.add(peaks);

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
  const abyss = new THREE.Mesh(new THREE.CylinderGeometry(64, 64, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x566874, side: THREE.BackSide }));
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
  const CRUMBLE = false;    // 암벽 붕괴 연출 사용 안 함 (요청)
  let nextBreak = Infinity;
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
      clock = 0; nextBreak = CRUMBLE ? 60 : Infinity;
      for (const sec of sectors) { sec.state = 'ok'; sec.t = 0; sec.vy = 0; sec.spin = 0; sec.g.visible = true; sec.g.position.set(0, 0, 0); sec.g.rotation.set(0, 0, 0); }
      for (const r of rubble) group.remove(r.m);
      rubble.length = 0;
    },
    update(dt, excitement) {
      edge.material.opacity = 0.25 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
      clock += dt;

      // 1분 뒤부터 랜덤 섹터가 무너진다 (지금은 비활성)
      if (CRUMBLE && clock > nextBreak) {
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
      sun.shadow.dispose();disposeEnvironment(group);
    },
  };
}
