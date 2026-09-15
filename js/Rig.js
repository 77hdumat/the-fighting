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
  // ---- 히든 캐릭터 ----
  // 채채더킴: 작은 키, 단발머리 + 큰 눈. 냥냥펀치(빠르고 가벼움), 필살 = 릴스 (상대를 붙잡아 같이 춤)
  chaechae: {
    name: 'CHAECHAE', skin: 0xffdcc4, trunks: 0x14141a, trunksTrim: 0x2a2a33, trunksText: '',
    bodyColor: 0x17171e, sleeves: 0xffdcc4, pants: 0xffdcc4,          // 검은 원피스 (팔·다리는 맨살)
    gloves: 0xffdcc4, noGloves: true, shoes: 0x1b1b22, shoesTrim: 0x3a3a46,   // 단화
    hair: 0x2a1a16, hairStyle: 'bob', brows: 'thin', eyes: 'big', mouth: 'grin',
    accessory: 'sunglasses', skirt: 0x17171e, hold: { L: 'book', R: 'book' },
    prop: { height: 0.82, torsoW: 0.88, torsoD: 0.86, armR: 0.86, armLen: 0.88, legR: 0.9, legLen: 0.86, headS: 1.08, headY: 1.0, neck: 0.8, muscle: 0.3 },
    hp: 120, powerMul: 0.8, speedMul: 1.8, style: 'idol', gaugeMul: 1.15, hidden: true, sfx: 'nyang',
  },
  // 쩡효: 중간 키, 긴 생머리 + 흰 피부. 덤벨 펀치(무겁다), 필살 = 바벨 내려찍기
  jjeonghyo: {
    name: 'JJEONGHYO', skin: 0xfdeade, trunks: 0x14141a, trunksTrim: 0x2a2a33, trunksText: '',
    bodyColor: 0xf4f4f0, sleeves: 0xfdeade, pants: 0x1a1a20,          // 흰 티 + 검정 레깅스
    chestText: 'HDEX', chestTextColor: '#111118',
    gloves: 0xfdeade, noGloves: true, shoes: 0xf0f0f0, shoesTrim: 0xc0f000,
    hair: 0x241b18, hairStyle: 'long', brows: 'thin', eyes: 'narrow', mouth: 'grit',
    hold: { L: 'dumbbell', R: 'dumbbell' },
    prop: { height: 1.0, torsoW: 1.06, torsoD: 1.0, armR: 1.12, armLen: 1.0, legR: 1.12, legLen: 0.98, headS: 0.98, headY: 1.0, neck: 1.0, muscle: 1 },
    hp: 185, powerMul: 1.45, speedMul: 0.8, style: 'gym', gaugeMul: 0.8, hidden: true, sfx: 'clang',
  },
  // 뼈석원: 큰 키, 구릿빛 피부에 마른 몸. 뼈펀치(리치 최장), 필살 = 오토바이 돌진
  ppyeo: {
    name: 'PPYEO', skin: 0xb07848, trunks: 0x2f4f86, trunksTrim: 0x24406e, trunksText: '',
    bodyColor: 0xf2f2f4, sleeves: 0xb07848, pants: 0x2f4f86,          // 스티치 티 + 청바지
    chestText: 'STITCH', chestTextColor: '#2ba8e0', chestArt: 'stitch',
    gloves: 0xb07848, noGloves: true, shoes: 0xe8e8ec, shoesTrim: 0x2f4f86,
    hair: 0x14100e, hairStyle: 'slick', brows: 'thin', eyes: 'narrow', mouth: 'grin',
    hold: { L: 'helmet', R: 'bottle' },
    prop: { height: 1.2, torsoW: 0.74, torsoD: 0.72, armR: 0.7, armLen: 1.32, legR: 0.72, legLen: 1.2, headS: 0.94, headY: 1.16, neck: 1.4, muscle: 0.1 },
    hp: 125, powerMul: 1.15, speedMul: 1.4, style: 'bone', gaugeMul: 1.0, hidden: true, sfx: 'bone',
  },
  // 오승현: 가장 작고 하얀 피부. 빵을 들고 계속 먹는다. 소심하지만 갑자기 때린다
  ohsh: {
    name: 'OHSH', skin: 0xfff0e6, trunks: 0xfaf3ea, trunksTrim: 0xe8c9a0, trunksText: '',
    bodyColor: 0xfdf6ec, sleeves: 0xfff0e6, pants: 0xe8dbc8,
    gloves: 0xfff0e6, noGloves: true, shoes: 0xf4e7d4, shoesTrim: 0xd9a95c,
    hair: 0x14131a, hairStyle: 'bobsharp', brows: 'thin', eyes: 'big', mouth: 'grit',
    hold: { L: 'bread', R: 'croissant' }, oversize: 1,
    prop: { height: 0.72, torsoW: 0.9, torsoD: 0.88, armR: 0.95, armLen: 0.82, legR: 0.84, legLen: 0.78, headS: 1.14, headY: 1.0, neck: 0.7, muscle: 0.15 },
    hp: 105, powerMul: 0.9, speedMul: 1.7, style: 'bread', gaugeMul: 1.25, hidden: true, sfx: 'nyang', sleeveColor: 0xfdf6ec,
  },
  // 정주원: 뚱뚱한 보통 체격, 헤드폰. 삼각김밥을 계속 먹는다
  jungjuwon: {
    name: 'JUNGJUWON', skin: 0xf0c9a0, trunks: 0x2e2e38, trunksTrim: 0x5b5be0, trunksText: '',
    bodyColor: 0x3c4250, sleeves: 0xf0c9a0, pants: 0x2a2f3a,
    gloves: 0xf0c9a0, noGloves: true, shoes: 0x2e2e38, shoesTrim: 0x5b5be0,
    hair: 0x1c1712, hairStyle: 'spiky', brows: 'thick', eyes: 'round', mouth: 'grin',
    accessory: 'headphones', belly: 1,
    hold: { L: 'onigiri', R: 'coffee' },
    prop: { height: 1.0, torsoW: 1.34, torsoD: 1.34, armR: 1.14, armLen: 1.0, legR: 1.12, legLen: 0.94, headS: 1.04, headY: 1.0, neck: 0.85, muscle: 0.15 },
    hp: 195, powerMul: 1.3, speedMul: 0.85, style: 'snack', gaugeMul: 0.9, hidden: true,
  },
  // 고코몽: 약간 작은 체격, 하늘색 긴 티. 감정이 없다
  gokomong: {
    name: 'GOKOMONG', skin: 0xecc6a4, trunks: 0x2b3440, trunksTrim: 0x7fd4f5, trunksText: '',
    bodyColor: 0x8fd6f2, sleeves: 0x8fd6f2, pants: 0x3b4450,     // 하늘색 긴팔 티
    gloves: 0xecc6a4, noGloves: true, shoes: 0x2b3440, shoesTrim: 0x8fd6f2,
    hair: 0x1a1a20, hairStyle: 'bob', brows: 'thin', eyes: 'narrow', mouth: 'grit',
    prop: { height: 0.94, torsoW: 0.98, torsoD: 0.94, armR: 0.94, armLen: 1.04, legR: 0.96, legLen: 0.96, headS: 1.02, headY: 1.0, neck: 0.95, muscle: 0.45 },
    hp: 150, powerMul: 1.05, speedMul: 1.0, style: 'istp', gaugeMul: 0.95, hidden: true,
  },
};
export const CHARACTER_ORDER = ['ippo', 'mashiba', 'miyata', 'sendo'];
export const HIDDEN_ORDER = ['chaechae', 'jjeonghyo', 'ppyeo', 'ohsh', 'jungjuwon', 'gokomong'];

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

// 손에 드는 소품: 책 / 덤벨 / 하이바(헬멧) / 녹차병
function buildHeldItem(kind, glove, part, sx) {
  if (kind === 'book') {
    const cover = part(new THREE.BoxGeometry(0.19, 0.25, 0.045), 0x8a2b2b, glove, 0, -0.02, 0.06);
    cover.rotation.set(0.25, sx * 0.25, 0);
    const pages = part(new THREE.BoxGeometry(0.175, 0.235, 0.05), 0xf6f1e2, cover, 0, 0, 0.004, false);
    const band = part(new THREE.BoxGeometry(0.02, 0.25, 0.048), 0xe8c24a, cover, -0.082, 0, 0.001, false);
  } else if (kind === 'dumbbell') {
    const bar = part(new THREE.CylinderGeometry(0.022, 0.022, 0.19, 8), 0x9a9aa4, glove, 0, -0.02, 0.03);
    bar.rotation.z = Math.PI / 2;
    for (const s2 of [-1, 1]) {
      const pl = part(new THREE.CylinderGeometry(0.068, 0.068, 0.055, 12), 0x24242c, bar, 0, s2 * 0.095, 0);
      const rim = part(new THREE.TorusGeometry(0.068, 0.008, 6, 16), 0xc0f000, pl, 0, 0, 0, false);
      rim.rotation.x = Math.PI / 2;
    }
  } else if (kind === 'helmet') {
    // 하이바: 크고 밝은 흰/빨강 풀페이스 + 하늘색 바이저 (멀리서도 눈에 띈다)
    const shell = part(new THREE.SphereGeometry(0.165, 18, 14), 0xf6f7fa, glove, 0, -0.06, 0.1);
    shell.scale.set(1.0, 1.02, 1.08);
    const chin = part(new THREE.BoxGeometry(0.2, 0.12, 0.16), 0xf6f7fa, shell, 0, -0.1, 0.09);
    const visor = part(new THREE.SphereGeometry(0.158, 18, 12, -1.05, 2.1, 0.75, 0.62), 0x35c8ff, shell, 0, 0.015, 0.02, false);
    if (visor.material.emissive) { visor.material.emissive.set(0x1a6f96); visor.material.emissiveIntensity = 0.8; }
    const stripe = part(new THREE.BoxGeometry(0.052, 0.3, 0.3), 0xe0222c, shell, 0, 0.02, -0.02, false);
    const stripe2 = part(new THREE.BoxGeometry(0.19, 0.045, 0.3), 0xe0222c, shell, 0, 0.1, -0.02, false);
    const vent = part(new THREE.BoxGeometry(0.1, 0.03, 0.06), 0x2b2b33, shell, 0, 0.12, 0.13, false);
  } else if (kind === 'bread') {
    // 바게트 (한 손) — 한 입 베어 문 자국
    const loaf = part(new THREE.CapsuleGeometry(0.062, 0.26, 4, 12), 0xd9a95c, glove, 0, -0.02, 0.09);
    loaf.rotation.x = 1.15; loaf.scale.set(1, 1, 0.85);
    for (let i = 0; i < 3; i++) {
      const cut = part(new THREE.BoxGeometry(0.03, 0.012, 0.09), 0xf0d9a8, loaf, 0, 0.06 - i * 0.07, 0.055, false);
      cut.rotation.z = 0.5;
    }
  } else if (kind === 'croissant') {
    const c = part(new THREE.TorusGeometry(0.085, 0.045, 8, 14, Math.PI * 1.15), 0xe0b062, glove, 0, -0.03, 0.08);
    c.rotation.set(1.3, 0, 0.4);
  } else if (kind === 'onigiri') {
    // 삼각김밥: 흰 밥 삼각기둥 + 검은 김 띠
    const rice = part(new THREE.CylinderGeometry(0.135, 0.135, 0.075, 3), 0xf8f6ef, glove, 0, -0.02, 0.07);
    rice.rotation.set(Math.PI / 2, 0, Math.PI);
    const nori = part(new THREE.CylinderGeometry(0.138, 0.138, 0.078, 3), 0x1c2a22, rice, 0, -0.045, 0);
    nori.scale.set(1, 0.42, 1);
  } else if (kind === 'coffee') {
    const cup = part(new THREE.CylinderGeometry(0.058, 0.045, 0.17, 12), 0xf3f1ec, glove, 0, -0.04, 0.06);
    part(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 12), 0x8a5a3a, cup, 0, 0.09, 0);
    const sleeve = part(new THREE.CylinderGeometry(0.062, 0.055, 0.06, 12), 0x8a6a4a, cup, 0, -0.005, 0, false);
    const straw = part(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), 0x2a6a3a, cup, 0.018, 0.16, 0);
    straw.rotation.z = -0.25;
  } else if (kind === 'bottle') {
    const body = part(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 12), 0x2f7d32, glove, 0, -0.05, 0.05);
    const label = part(new THREE.CylinderGeometry(0.052, 0.052, 0.085, 12), 0xf3f6e8, body, 0, -0.01, 0, false);
    const neck = part(new THREE.CylinderGeometry(0.022, 0.032, 0.05, 10), 0x2f7d32, body, 0, 0.13, 0);
    const cap = part(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 10), 0xe8e8ec, body, 0, 0.165, 0);
  }
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
    const foot = part(G.foot, def.shoes, shin, 0, -legLen, 0.05);
    part(G.footTrim, def.shoesTrim, shin, 0, -legLen - 0.04, 0.05, false);
    return { thigh, shin, foot };
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  // ---- 상체 ----
  const waist = new THREE.Group();
  waist.position.y = 0.06;
  hips.add(waist);
  part(G.torso, bodyCol, waist, 0, 0.3, 0);
  // 뱃살 (정주원)
  if (def.belly) {
    const b = part(new THREE.SphereGeometry(0.22, 16, 12), bodyCol, waist, 0, 0.2, 0.06 * P.torsoD);
    b.scale.set(1.25 * P.torsoW, 0.95, 0.95 * P.torsoD);
  }
  // 근육 디테일 (가슴/복근) — 잔상엔 생략
  if (!ghost && P.muscle > 0.5) {
    part(G.pec, def.skin, waist, 0.1 * P.torsoW, 0.4, 0.11 * P.torsoD, false);
    part(G.pec, def.skin, waist, -0.1 * P.torsoW, 0.4, 0.11 * P.torsoD, false);
    for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c += 2) part(G.abs, def.skin, waist, c * 0.045 * P.torsoW, 0.26 - r * 0.08, 0.125 * P.torsoD, false);
  }

  // 가슴 프린트 (티셔츠 로고)
  if (def.chestText && !ghost) {
    const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.1), new THREE.MeshBasicMaterial({ map: trunksTextTexture(def.chestText, def.chestTextColor || '#111118'), transparent: true, depthWrite: false }));
    cp.position.set(0, 0.36, 0.142 * P.torsoD);
    waist.add(cp);
    if (def.chestArt === 'stitch') {   // 티셔츠 캐릭터 그림 (파란 얼굴 + 큰 귀)
      const art = new THREE.Group(); art.position.set(0, 0.2, 0.142 * P.torsoD); waist.add(art);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.052, 20), new THREE.MeshBasicMaterial({ color: 0x2ba8e0 }));
      art.add(face);
      for (const s2 of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.CircleGeometry(0.024, 14), new THREE.MeshBasicMaterial({ color: 0x2ba8e0 }));
        ear.position.set(s2 * 0.052, 0.042, 0.001); ear.scale.set(0.8, 1.5, 1); art.add(ear);
        const eye = new THREE.Mesh(new THREE.CircleGeometry(0.013, 12), new THREE.MeshBasicMaterial({ color: 0x14141c }));
        eye.position.set(s2 * 0.02, 0.012, 0.002); art.add(eye);
      }
      const nose = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), new THREE.MeshBasicMaterial({ color: 0x14141c }));
      nose.position.set(0, -0.012, 0.002); art.add(nose);
    }
  }
  // 원피스 치마 (채채더킴)
  if (def.skirt) {
    const sk = part(new THREE.CylinderGeometry(0.16 * P.torsoW, 0.245 * P.torsoW, 0.26, 16, 1, true), def.skirt, waist, 0, 0.02, 0);
    sk.material.side = THREE.DoubleSide;
  }

  // 오버핏: 상의를 한 겹 크게 덧입혀 헐렁해 보이게
  if (def.oversize) {
    const over = part(new THREE.CapsuleGeometry(0.235 * P.torsoW, 0.34, 5, 14), bodyCol, waist, 0, 0.3, 0);
    over.scale.set(1.16, 1.06, 1.2);
    const hem = part(new THREE.CylinderGeometry(0.27 * P.torsoW, 0.29 * P.torsoW, 0.1, 16, 1, true), bodyCol, waist, 0, 0.08, 0);
    hem.material.side = THREE.DoubleSide;
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
    if (def.oversize) {   // 소매가 팔보다 크다
      const sl = part(new THREE.CapsuleGeometry(0.098 * P.armR, armLen * 0.72, 4, 12), def.sleeveColor || bodyCol, shoulder, 0, -armLen * 0.52, 0);
      sl.scale.set(1.12, 1, 1.12);
    }
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
    // ---- 손에 든 소품 (히든 캐릭터) ----
    const item = def.hold && def.hold[sx > 0 ? 'L' : 'R'];
    if (item && !ghost) buildHeldItem(item, glove, part, sx);
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
  if (def.hairStyle === 'bobsharp') {
    // 칼단발: 턱선에서 직선으로 뚝 떨어지는 실루엣 + 일자 앞머리
    const cap = part(new THREE.SphereGeometry(0.208 * P.headS, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), def.hair, head, 0, hy + 0.015, -0.01);
    cap.scale.set(1.03, 1.0, 1.06);
    // 옆/뒤를 감싸는 원통형 컷 (아래가 일자로 잘린 느낌)
    const cut = part(new THREE.CylinderGeometry(0.215 * P.headS, 0.225 * P.headS, 0.26, 18, 1, true), def.hair, head, 0, hy - 0.1, -0.012);
    cut.material.side = THREE.DoubleSide;
    cut.scale.set(1, 1, 1.02);
    const backFill = part(new THREE.BoxGeometry(0.3 * P.headS, 0.26, 0.16), def.hair, head, 0, hy - 0.1, -0.11);
    // 일자 앞머리 (뱅)
    const bang = part(new THREE.BoxGeometry(0.3 * P.headS, 0.1, 0.075), def.hair, head, 0, hy + 0.085, 0.112 * P.headS);
    bang.rotation.x = -0.1;
  } else if (def.hairStyle === 'bob') {
    // 단발: 머리통을 감싸는 짧은 컷 + 앞머리 뱅
    const cap = part(new THREE.SphereGeometry(0.205 * P.headS, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.72), def.hair, head, 0, hy + 0.012, -0.012);
    cap.scale.set(1.02, 1.0, 1.04);
    for (const sx of [-1, 1]) {   // 옆머리 (귀 아래까지)
      const side = part(new THREE.CapsuleGeometry(0.055 * P.headS, 0.16, 4, 10), def.hair, head, sx * 0.155 * P.headS, hy - 0.06, -0.01);
      side.scale.set(1, 1, 0.75);
    }
    const bang = part(new THREE.BoxGeometry(0.26 * P.headS, 0.075, 0.08), def.hair, head, 0, hy + 0.1, 0.108 * P.headS);
    bang.rotation.x = -0.18;
  } else if (def.hairStyle === 'long') {
    // 긴 생머리: 뒤로 길게 흐르는 판 + 양옆 머리카락
    const cap = part(new THREE.SphereGeometry(0.2 * P.headS, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.66), def.hair, head, 0, hy + 0.01, -0.01);
    const back = part(new THREE.CapsuleGeometry(0.115 * P.headS, 0.42, 4, 12), def.hair, head, 0, hy - 0.3, -0.075);
    back.scale.set(1.15, 1, 0.6);
    for (const sx of [-1, 1]) {
      const side = part(new THREE.CapsuleGeometry(0.05 * P.headS, 0.3, 4, 10), def.hair, head, sx * 0.15 * P.headS, hy - 0.16, 0.012);
      side.scale.set(1, 1, 0.7);
    }
    const bang = part(new THREE.BoxGeometry(0.24 * P.headS, 0.06, 0.07), def.hair, head, 0, hy + 0.105, 0.1 * P.headS);
    bang.rotation.x = -0.25;
  } else if (def.hairStyle === 'spiky') {
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
  const big = def.eyes === 'big';
  for (const sx of [-1, 1]) {
    const sc = part(G.sclera, 0xf6f6f6, head, sx * (big ? 0.072 : 0.065), eyeY, eyeZ, false);
    sc.scale.set(big ? 1.35 : 1, narrow ? 0.35 : big ? 1.75 : 1.15, 0.5);
    const pu = part(G.pupil, big ? 0x3a2418 : 0x101018, head, sx * (big ? 0.07 : 0.062), eyeY, eyeZ + 0.022, false);
    pu.scale.set(narrow ? 0.9 : big ? 1.8 : 1.1, narrow ? 0.45 : big ? 2.1 : 1.4, 0.6);
    if (big) {   // 큰 눈 하이라이트
      const hl = part(new THREE.SphereGeometry(0.012, 8, 6), 0xffffff, head, sx * 0.078, eyeY + 0.022, eyeZ + 0.034, false);
      hl.scale.set(1.1, 1.1, 0.5);
    }
    const br = part(G.brow, 0x101018, head, sx * 0.068, eyeY + (narrow ? 0.03 : big ? 0.085 : 0.06), eyeZ + 0.015, false);
    br.rotation.z = -sx * (narrow ? 0.55 : big ? 0.12 : 0.32);
  }
  // 헤드폰 (정주원)
  if (def.accessory === 'headphones') {
    const band = part(new THREE.TorusGeometry(0.2 * P.headS, 0.022, 8, 20, Math.PI), 0x24242c, head, 0, hy + 0.03, -0.01);
    band.rotation.set(0, 0, 0);
    for (const sx of [-1, 1]) {
      const cup = part(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14), 0x2e2e3a, head, sx * 0.185 * P.headS, hy + 0.01, 0);
      cup.rotation.z = Math.PI / 2;
      const pad = part(new THREE.CylinderGeometry(0.06, 0.06, 0.055, 14), 0x14141a, cup, 0, -0.012, 0, false);
      const led = part(new THREE.SphereGeometry(0.014, 8, 6), 0x5b5be0, cup, 0, 0.03, 0.045, false);
      if (led.material.emissive) { led.material.emissive.set(0x5b5be0); led.material.emissiveIntensity = 1.2; }
    }
  }
  // 선글라스 (채채더킴)
  if (def.accessory === 'sunglasses') {
    const gl = new THREE.Group(); gl.position.set(0, eyeY + 0.012, eyeZ + 0.028); head.add(gl);
    for (const sx of [-1, 1]) {
      const lens = part(new THREE.BoxGeometry(0.085, 0.055, 0.016), 0x15151c, gl, sx * 0.058, 0, 0);
      lens.rotation.z = -sx * 0.06;
      const shine = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.012), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75 }));
      shine.position.set(sx * 0.02, 0.012, 0.01); shine.rotation.z = 0.4; lens.add(shine);
      const arm = part(new THREE.BoxGeometry(0.02, 0.012, 0.09), 0x15151c, gl, sx * 0.108, 0.006, -0.05, false);
    }
    part(new THREE.BoxGeometry(0.038, 0.012, 0.014), 0x15151c, gl, 0, 0.008, 0, false);
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
    footL: legL.foot, footR: legR.foot,
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
