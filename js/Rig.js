// Rig.js — 오리지널 복서 캐릭터 (셀 셰이딩 + 검은 외곽선) 와 포즈 파라미터 시스템
// 캐릭터 정의(비율/헤어/얼굴/트렁크)로 서로 다른 체형의 복서를 생성한다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 셀 셰이딩 램프: 강한 명암 경계 (그림자 / 좁은 중간톤 / 밝은면)
const gradientMap = (() => {
  const data = new Uint8Array([95, 95, 95, 175, 255, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

// 노멀 방향으로 밀어낸 뒷면 렌더링 = 두께 일정한 검은 외곽선
const OUTLINE_VERT = /* glsl */`
uniform float thickness;
void main() {
  vec3 p = position + normal * thickness;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const OUTLINE_FRAG = /* glsl */`
uniform vec3 color;
uniform float opacity;
void main() { gl_FragColor = vec4(color, opacity); }`;

function makeOutlineMaterial(ghost) {
  return new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: 0.014 },
      color: { value: new THREE.Color(0x000000) },
      opacity: { value: 1 },
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    transparent: ghost,
    depthWrite: !ghost,
  });
}

// ---- 캐릭터 정의 ----
// 주인공: 작고 다부진 인파이터 (검은 뻗친 머리, 굵은 눈썹, 초록/흰 트렁크, 빨간 글러브)
// 상대: 장신·마른 히트맨 (흑발 슬릭백, 가늘게 찢어진 눈, 다크 트렁크, 검은 글러브, 플리커 잽)
export const CHARACTERS = {
  ippo: {
    name: 'IPPO', skin: 0xf1c39a, trunks: 0x1c8d4a, trunksTrim: 0xf7f7f7, trunksText: 'IPPO',
    gloves: 0xd42a2a, hair: 0x15151a, shoes: 0xc92626, shoesTrim: 0xffffff,
    hairStyle: 'spiky', brows: 'thick', eyes: 'round', mouth: 'grit',
    prop: { height: 0.95, torsoW: 1.14, torsoD: 1.12, armR: 1.18, armLen: 0.96, legR: 1.12, legLen: 0.95, headS: 1.02, headY: 1.0, neck: 0.9, muscle: 1 },
    hp: 140, powerMul: 1.05, speedMul: 1.05, style: 'infighter',
  },
  mashiba: {
    name: 'MASHIBA', skin: 0xe4b892, trunks: 0x1d1226, trunksTrim: 0x9b4de0, trunksText: 'MASHIBA',
    gloves: 0x141218, hair: 0x0c0c10, shoes: 0x141218, shoesTrim: 0x9b4de0,
    hairStyle: 'slick', brows: 'thin', eyes: 'narrow', mouth: 'grin',
    prop: { height: 1.13, torsoW: 0.86, torsoD: 0.82, armR: 0.82, armLen: 1.24, legR: 0.84, legLen: 1.12, headS: 0.96, headY: 1.18, neck: 1.35, muscle: 0.35 },
    hp: 150, powerMul: 0.9, speedMul: 1.35, style: 'hitman',
  },
  // 아웃복서: 늘씬하고 빠름, 갈색 머리, 남색/흰 트렁크
  miyata: {
    name: 'MIYATA', skin: 0xf0cbb0, trunks: 0x1b2a6b, trunksTrim: 0xffffff, trunksText: 'MIYATA',
    gloves: 0xd42a2a, hair: 0x4a3220, shoes: 0x1b2a6b, shoesTrim: 0xffffff,
    hairStyle: 'spiky', brows: 'thin', eyes: 'round', mouth: 'grit',
    prop: { height: 1.02, torsoW: 0.92, torsoD: 0.9, armR: 0.9, armLen: 1.08, legR: 0.9, legLen: 1.04, headS: 0.98, headY: 1.05, neck: 1.1, muscle: 0.6 },
    hp: 115, powerMul: 0.8, speedMul: 2.0, style: 'outboxer',
  },
  // 나니와의 호랑이: 야성적인 갈색 스파이크 헤어, 검정/주황 트렁크, 강력한 스매시
  sendo: {
    name: 'SENDO', skin: 0xe4b088, trunks: 0x141414, trunksTrim: 0xff7a00, trunksText: 'SENDO',
    gloves: 0xff6a00, hair: 0x6b3a12, shoes: 0x141414, shoesTrim: 0xff7a00,
    hairStyle: 'spiky', brows: 'thick', eyes: 'narrow', mouth: 'grin',
    prop: { height: 1.06, torsoW: 1.22, torsoD: 1.15, armR: 1.22, armLen: 1.08, legR: 1.15, legLen: 1.04, headS: 1.03, headY: 1.0, neck: 1.0, muscle: 1 },
    hp: 220, powerMul: 1.75, speedMul: 0.55, style: 'power',
  },
};
export const CHARACTER_ORDER = ['ippo', 'mashiba', 'miyata', 'sendo'];

// 코치 (링 밖 코너에 서 있는 NPC): 트레이닝복, 글러브 없음
export const COACH_DEFS = [
  { name: 'COACH', skin: 0xe8c39e, bodyColor: 0x2b2f4a, pants: 0x1e2236, sleeves: 0x2b2f4a, trunks: 0x1e2236, trunksTrim: 0x3a4570, trunksText: '', gloves: 0xe8c39e, hair: 0x5a5a5a, shoes: 0x111111, shoesTrim: 0x333333, hairStyle: 'slick', brows: 'thick', eyes: 'narrow', mouth: 'grit', noGloves: true,
    prop: { height: 1.02, torsoW: 1.08, torsoD: 1.05, armR: 1.0, armLen: 1.0, legR: 1.0, legLen: 1.0, headS: 1.0, headY: 1.0, neck: 1.0, muscle: 0 }, hp: 1, powerMul: 1, speedMul: 1, style: 'infighter' },
  { name: 'COACH', skin: 0xf0d0b0, bodyColor: 0x7a1f1f, pants: 0x222222, sleeves: 0x7a1f1f, trunks: 0x222222, trunksTrim: 0x333333, trunksText: '', gloves: 0xf0d0b0, hair: 0x0e0e12, shoes: 0x111111, shoesTrim: 0x333333, hairStyle: 'spiky', brows: 'thin', eyes: 'round', mouth: 'grin', noGloves: true,
    prop: { height: 0.98, torsoW: 0.95, torsoD: 0.95, armR: 0.9, armLen: 1.0, legR: 0.9, legLen: 1.0, headS: 1.0, headY: 1.0, neck: 1.0, muscle: 0 }, hp: 1, powerMul: 1, speedMul: 1, style: 'infighter' },
  { name: 'COACH', skin: 0xd9b48f, bodyColor: 0x1f4d2b, pants: 0x1a1a1a, sleeves: 0x1f4d2b, trunks: 0x1a1a1a, trunksTrim: 0x2a6a3a, trunksText: '', gloves: 0xd9b48f, hair: 0x3a2a1a, shoes: 0x111111, shoesTrim: 0x333333, hairStyle: 'slick', brows: 'thick', eyes: 'narrow', mouth: 'grit', noGloves: true,
    prop: { height: 1.1, torsoW: 1.15, torsoD: 1.1, armR: 1.05, armLen: 1.0, legR: 1.05, legLen: 1.05, headS: 1.0, headY: 1.05, neck: 1.1, muscle: 0 }, hp: 1, powerMul: 1, speedMul: 1, style: 'infighter' },
  { name: 'COACH', skin: 0xf3c9a4, bodyColor: 0x333333, pants: 0x333333, sleeves: 0x333333, trunks: 0x333333, trunksTrim: 0xffaa00, trunksText: '', gloves: 0xf3c9a4, hair: 0x8a6a3a, shoes: 0x111111, shoesTrim: 0x333333, hairStyle: 'spiky', brows: 'thick', eyes: 'round', mouth: 'grit', noGloves: true,
    prop: { height: 1.0, torsoW: 1.0, torsoD: 1.0, armR: 0.95, armLen: 1.0, legR: 0.95, legLen: 1.0, headS: 1.0, headY: 1.0, neck: 1.0, muscle: 0 }, hp: 1, powerMul: 1, speedMul: 1, style: 'infighter' },
];

// ---- 포즈 파라미터 ----
// 모든 관절 값을 평면 객체로 두면 잔상 스냅샷 복사/보간이 단순해진다.
export const POSE_KEYS = [
  'hipsX', 'hipsY', 'hipsZ', 'hipsRotY',
  'waistX', 'waistY', 'waistZ',
  'chestY', 'chestZ',
  'headX', 'headY', 'headZ', 'headOffX', 'headOffY', 'headOffZ',
  'shLX', 'shLY', 'shLZ', 'elL',
  'shRX', 'shRY', 'shRZ', 'elR',
  'thighLX', 'thighLZ', 'shinL',
  'thighRX', 'thighRZ', 'shinR',
];

// 기본 가드 자세
export function defaultPose() {
  return {
    hipsX: 0, hipsY: 0, hipsZ: 0, hipsRotY: 0.15,
    waistX: 0.14, waistY: -0.15, waistZ: 0,
    chestY: 0, chestZ: 0,
    headX: 0.12, headY: 0.1, headZ: 0, headOffX: 0, headOffY: 0, headOffZ: 0,
    shLX: -0.85, shLY: -0.35, shLZ: 0.25, elL: -2.35,
    shRX: -0.8, shRY: 0.35, shRZ: -0.25, elR: -2.4,
    thighLX: -0.32, thighLZ: 0.14, shinL: 0.38,
    thighRX: 0.22, thighRZ: -0.14, shinR: 0.3,
  };
}

export function copyPose(src, dst) {
  for (let i = 0; i < POSE_KEYS.length; i++) { const k = POSE_KEYS[i]; dst[k] = src[k]; }
  return dst;
}

export function lerpPose(a, b, t, out) {
  for (let i = 0; i < POSE_KEYS.length; i++) { const k = POSE_KEYS[i]; out[k] = a[k] + (b[k] - a[k]) * t; }
  return out;
}

// 포즈 값 → 실제 Object3D 회전/위치
export function applyPose(rig, p) {
  rig.hips.position.set(p.hipsX, rig.hipsBaseY + p.hipsY, p.hipsZ);
  rig.hips.rotation.y = p.hipsRotY;
  rig.waist.rotation.set(p.waistX, p.waistY, p.waistZ);
  rig.chest.rotation.set(0, p.chestY, p.chestZ);
  rig.head.rotation.set(p.headX, p.headY, p.headZ);
  rig.head.position.set(p.headOffX, rig.headBaseY + p.headOffY, p.headOffZ);
  rig.shoulderL.rotation.set(p.shLX, p.shLY, p.shLZ);
  rig.elbowL.rotation.x = p.elL;
  rig.shoulderR.rotation.set(p.shRX, p.shRY, p.shRZ);
  rig.elbowR.rotation.x = p.elR;
  rig.thighL.rotation.set(p.thighLX, 0, p.thighLZ);
  rig.shinL.rotation.x = p.shinL;
  rig.thighR.rotation.set(p.thighRX, 0, p.thighRZ);
  rig.shinR.rotation.x = p.shinR;
}

// 캐릭터별 지오메트리 캐시 (잔상 8개가 같은 지오메트리 공유)
const geoCache = new Map();
function geometriesFor(def) {
  if (geoCache.has(def.name)) return geoCache.get(def.name);
  const P = def.prop;
  const G = {
    pelvis: new RoundedBoxGeometry(0.36 * P.torsoW, 0.24, 0.26 * P.torsoD, 4, 0.08),
    band: new RoundedBoxGeometry(0.38 * P.torsoW, 0.06, 0.28 * P.torsoD, 2, 0.02),
    stripe: new THREE.BoxGeometry(0.03, 0.2, 0.05),
    torso: new RoundedBoxGeometry(0.46 * P.torsoW, 0.52, 0.28 * P.torsoD, 4, 0.1),
    pec: new RoundedBoxGeometry(0.19 * P.torsoW, 0.13, 0.09, 3, 0.04),
    abs: new RoundedBoxGeometry(0.07 * P.torsoW, 0.07, 0.05, 2, 0.02),
    delt: new THREE.SphereGeometry(0.105 * P.armR, 14, 10),
    neck: new THREE.CylinderGeometry(0.065, 0.08, 0.14 * P.neck, 12),
    thigh: new THREE.CapsuleGeometry(0.09 * P.legR, 0.28 * P.legLen, 4, 14),
    shin: new THREE.CapsuleGeometry(0.075 * P.legR, 0.28 * P.legLen, 4, 14),
    foot: new RoundedBoxGeometry(0.14, 0.1, 0.3, 3, 0.035),
    footTrim: new RoundedBoxGeometry(0.15, 0.03, 0.31, 2, 0.01),
    upperArm: new THREE.CapsuleGeometry(0.078 * P.armR, 0.2 * P.armLen, 4, 14),
    forearm: new THREE.CapsuleGeometry(0.07 * P.armR, 0.18 * P.armLen, 4, 14),
    glove: new THREE.SphereGeometry(0.13, 18, 14),
    gloveCuff: new THREE.CylinderGeometry(0.085, 0.1, 0.1, 12),
    head: new THREE.SphereGeometry(0.17 * P.headS, 22, 18),
    jaw: new RoundedBoxGeometry(0.2 * P.headS, 0.12, 0.2 * P.headS, 3, 0.06),
    ear: new THREE.SphereGeometry(0.035, 8, 6),
    hair: new THREE.SphereGeometry(0.19 * P.headS, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    spike: new THREE.ConeGeometry(0.06, 0.2, 6),
    sclera: new THREE.SphereGeometry(0.045, 10, 8),
    pupil: new THREE.SphereGeometry(0.02, 8, 6),
    brow: new THREE.BoxGeometry(0.09, def.brows === 'thick' ? 0.035 : 0.014, 0.02),
    mouth: new THREE.BoxGeometry(def.mouth === 'grin' ? 0.11 : 0.07, 0.012, 0.02),
  };
  geoCache.set(def.name, G);
  return G;
}

function trunksTextTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  g.font = '900 64px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#000';
  g.strokeText(text, 128, 50);
  g.fillStyle = color;
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 복서 리그 생성. 캐릭터는 로컬 +Z 방향을 바라본다.
 * ghost=true 이면 잔상용: 라이팅 없는 반투명 머티리얼, 그림자 없음.
 */
export function buildBoxer(def, opts = {}) {
  const { ghost = false, tint = 0x9fdcff } = opts;
  const P = def.prop;
  const bodyCol = def.bodyColor || def.skin;   // 코치용: 몸은 트레이닝복 색, 얼굴만 피부색
  const G = geometriesFor(def);
  const bodyMats = [];
  const outlineMat = makeOutlineMaterial(ghost);

  const M = (c) => {
    let m;
    if (ghost) {
      m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c).lerp(new THREE.Color(tint), 0.22),
        transparent: true, opacity: 0.4, depthWrite: false,
      });
    } else {
      m = new THREE.MeshToonMaterial({ color: c, gradientMap });
      // 셀 셰이딩 위에 림라이트 + 작은 스페큘러(땀 반짝임) 주입 → 지점토 느낌 탈피
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            vec3 nrm = normalize(vNormal);
            vec3 vdir = normalize(vViewPosition);
            float rim = pow(1.0 - max(0.0, dot(nrm, vdir)), 3.0);
            vec3 ldir = normalize(vec3(0.4, 0.9, 0.5));
            vec3 h = normalize(ldir + vdir);
            float spec = pow(max(0.0, dot(nrm, h)), 42.0);
            spec = smoothstep(0.55, 0.7, spec) * 0.35;   // 셀 스타일 하이라이트 (경계 뚜렷)
            gl_FragColor.rgb += vec3(0.55, 0.42, 0.32) * rim * 0.32 + vec3(1.0) * spec;
          }`
        );
      };
    }
    bodyMats.push(m);
    return m;
  };

  const part = (geom, color, parent, x = 0, y = 0, z = 0, outline = true) => {
    const mesh = new THREE.Mesh(geom, M(color));
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    mesh.position.set(x, y, z);
    if (outline) mesh.add(new THREE.Mesh(geom, outlineMat));
    parent.add(mesh);
    return mesh;
  };

  const root = new THREE.Group();
  const legLen = 0.42 * P.legLen;
  const hipsBaseY = 0.1 + legLen * 2 + 0.04;

  // ---- 골반 / 트렁크 ----
  const hips = new THREE.Group();
  hips.position.y = hipsBaseY;
  root.add(hips);
  part(G.pelvis, def.trunks, hips, 0, -0.02, 0);
  part(G.band, def.trunksTrim, hips, 0, 0.09, 0);
  part(G.stripe, def.trunksTrim, hips, 0.185 * P.torsoW, -0.03, 0, false);
  part(G.stripe, def.trunksTrim, hips, -0.185 * P.torsoW, -0.03, 0, false);
  if (!ghost && def.trunksText) {
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.09), new THREE.MeshBasicMaterial({ map: trunksTextTexture(def.trunksText, '#' + new THREE.Color(def.trunksTrim).getHexString()), transparent: true, depthWrite: false }));
    tp.position.set(0, -0.005, 0.13 * P.torsoD + 0.005);
    hips.add(tp);
  }

  // ---- 다리 ----
  const mkLeg = (sx) => {
    const thigh = new THREE.Group();
    thigh.position.set(sx * 0.115 * P.torsoW, -0.1, 0);
    hips.add(thigh);
    part(G.thigh, def.pants || bodyCol, thigh, 0, -legLen * 0.48, 0);
    const shin = new THREE.Group();
    shin.position.y = -legLen;
    thigh.add(shin);
    part(G.shin, def.pants || bodyCol, shin, 0, -legLen * 0.48, 0);
    part(G.foot, def.shoes, shin, 0, -legLen, 0.05);
    part(G.footTrim, def.shoesTrim, shin, 0, -legLen - 0.04, 0.05, false);
    return { thigh, shin };
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  // ---- 상체 ----
  const waist = new THREE.Group();
  waist.position.y = 0.06;
  hips.add(waist);
  part(G.torso, bodyCol, waist, 0, 0.3, 0);
  // 근육 디테일 (가슴/복근) — 잔상엔 생략
  if (!ghost && P.muscle > 0.5) {
    part(G.pec, def.skin, waist, 0.1 * P.torsoW, 0.4, 0.11 * P.torsoD, false);
    part(G.pec, def.skin, waist, -0.1 * P.torsoW, 0.4, 0.11 * P.torsoD, false);
    for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c += 2) part(G.abs, def.skin, waist, c * 0.045 * P.torsoW, 0.26 - r * 0.08, 0.125 * P.torsoD, false);
  }

  const chest = new THREE.Group();
  chest.position.y = 0.52;
  waist.add(chest);
  part(G.neck, def.skin, chest, 0, 0.06 * P.neck, 0.02);

  const armLen = 0.32 * P.armLen;
  const mkArm = (sx) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.27 * P.torsoW, 0.0, 0);
    shoulder.rotation.order = 'YZX'; // X(들어올림) → Z(벌림) → Y(휘두름) 순으로 적용
    chest.add(shoulder);
    part(G.delt, bodyCol, shoulder, 0, 0.02, 0);
    part(G.upperArm, bodyCol, shoulder, 0, -armLen * 0.5, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -armLen;
    shoulder.add(elbow);
    part(G.forearm, def.sleeves || bodyCol, elbow, 0, -armLen * 0.45, 0);
    if (!def.noGloves) part(G.gloveCuff, def.gloves, elbow, 0, -armLen * 0.78, 0);
    const glove = part(G.glove, def.gloves, elbow, 0, -armLen - 0.02, 0);
    if (def.noGloves) glove.scale.setScalar(0.6);
    else if (!ghost) {
      // 글러브 솔기(엄지 라인) + 손목 스트랩
      const seam = part(new THREE.TorusGeometry(0.115, 0.012, 6, 24), 0x2a1010, glove, 0, 0.02, 0, false);
      seam.rotation.x = Math.PI / 2; seam.rotation.z = 0.5;
      const strap = part(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 14), 0xf5f5f5, elbow, 0, -armLen * 0.86, 0, false);
    }
    return { shoulder, elbow, glove };
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);

  // ---- 머리 / 얼굴 ----
  const headBaseY = 0.04 + 0.1 * P.neck;
  const head = new THREE.Group();
  head.position.y = headBaseY;
  chest.add(head);
  const hy = 0.2 * P.headS;
  const headMesh = part(G.head, def.skin, head, 0, hy, 0);
  headMesh.scale.set(1, P.headY, 1);
  // 턱 (장신 캐릭터는 길고 뾰족한 인상)
  const jaw = part(G.jaw, def.skin, head, 0, hy - 0.12 * P.headY, 0.02);
  jaw.scale.set(P.headY > 1.1 ? 0.8 : 1, P.headY > 1.1 ? 1.5 : 1, 1);
  part(G.ear, def.skin, head, 0.165 * P.headS, hy, 0);
  part(G.ear, def.skin, head, -0.165 * P.headS, hy, 0);
  part(G.hair, def.hair, head, 0, hy + 0.03, -0.02);
  if (def.hairStyle === 'spiky') {
    // 사방으로 뻗친 굵은 스파이크
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const rr = 0.09 + 0.03 * Math.sin(i * 2.1);
      const s = part(G.spike, def.hair, head, Math.cos(a) * rr, hy + 0.16, Math.sin(a) * rr * 0.9 - 0.04);
      s.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75);
      s.scale.set(1.1, 1.05 + 0.3 * Math.abs(Math.sin(i * 1.7)), 1.1);
    }
    // 앞머리 두 갈래
    for (const sx of [-1, 1]) {
      const s = part(G.spike, def.hair, head, sx * 0.07, hy + 0.13, 0.12);
      s.rotation.set(1.1, 0, -sx * 0.4);
      s.scale.set(0.9, 0.8, 0.9);
    }
  } else {
    // 뒤로 넘긴 흑발: 길게 뻗은 뾰족한 머리칼이 뒤/옆으로
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.55 + (i / 6) * Math.PI * 0.9;
      const s = part(G.spike, def.hair, head, Math.cos(a) * 0.1, hy + 0.12, Math.sin(a) * 0.08 - 0.06);
      s.rotation.set(1.35 - Math.abs(Math.cos(a)) * 0.3, 0, -Math.cos(a) * 0.45);
      s.scale.set(0.9, 1.7, 0.9);
    }
    // 뾰족한 구레나룻
    for (const sx of [-1, 1]) {
      const s = part(G.spike, def.hair, head, sx * 0.16, hy - 0.03, 0.05);
      s.rotation.set(Math.PI, 0, 0);
      s.scale.set(0.5, 0.8, 0.5);
    }
  }
  // 눈: 흰자 + 동공 (외곽선 없음)
  const eyeY = hy + 0.02 * P.headY, eyeZ = 0.14 * P.headS;
  const narrow = def.eyes === 'narrow';
  for (const sx of [-1, 1]) {
    const sc = part(G.sclera, 0xf6f6f6, head, sx * 0.065, eyeY, eyeZ, false);
    sc.scale.set(1, narrow ? 0.35 : 1.15, 0.5);
    const pu = part(G.pupil, 0x101018, head, sx * 0.062, eyeY, eyeZ + 0.02, false);
    pu.scale.set(narrow ? 0.9 : 1.1, narrow ? 0.45 : 1.4, 0.6);
    const br = part(G.brow, 0x101018, head, sx * 0.068, eyeY + (narrow ? 0.03 : 0.06), eyeZ + 0.015, false);
    br.rotation.z = -sx * (narrow ? 0.55 : 0.32);
  }
  // 코
  const nose = part(new THREE.ConeGeometry(0.028, 0.06, 6), def.skin, head, 0, hy - 0.02 * P.headY, 0.165 * P.headS, false);
  nose.rotation.x = Math.PI / 2 - 0.35;
  const mouth = part(G.mouth, 0x1a1014, head, 0, hy - 0.075 * P.headY, 0.155 * P.headS, false);
  if (def.mouth === 'grin') mouth.rotation.z = 0.18;

  const rig = {
    root, hips, waist, chest, head, headMesh, hipsBaseY, headBaseY, def,
    shoulderL: armL.shoulder, elbowL: armL.elbow, gloveL: armL.glove,
    shoulderR: armR.shoulder, elbowR: armR.elbow, gloveR: armR.glove,
    thighL: legL.thigh, shinL: legL.shin, thighR: legR.thigh, shinR: legR.shin,
    bodyMats, outlineMat,
    setOpacity(o) {
      for (let i = 0; i < bodyMats.length; i++) bodyMats[i].opacity = o;
      outlineMat.uniforms.opacity.value = Math.min(1, o * 1.3);
    },
    setOutline(thickness) { outlineMat.uniforms.thickness.value = thickness; },
  };
  applyPose(rig, defaultPose());
  return rig;
}
