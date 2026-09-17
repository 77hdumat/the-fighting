// Rig.js — 오리지널 복서 캐릭터 (셀 셰이딩 + 검은 외곽선) 와 포즈 파라미터 시스템
// 캐릭터 정의(비율/헤어/얼굴/트렁크)로 서로 다른 체형의 복서를 생성한다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { torsoGeometry, sculptHead, hairLock, limbGeometry, attachLimb, attachTorso } from './Anatomy.js';
import { attachIppoBody, ippoHairGeometry, ippoFaceTexture } from './IppoModel.js';

// Soft three-region ramp: shadows, warm midtones, lit planes.
// 원작 화면에서 추출한 명암 분포에 맞춰 그림자 단을 더 깊게, 경계를 더 좁게 잡는다.
const gradientMap = (() => {
  const data = new Uint8Array([112, 112, 156, 198, 232, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

// ---- 3톤 컬러 램프 (원작 채색 재현) ----
// 원작은 그림자를 "어둡게" 칠하지 않는다. 채도를 올리고 색상을 붉게 밀어낸다.
// (추출값 예: 밝은면 #f0cdb0 → 그림자 #a15230 — 명도만 내려간 게 아니라 hue/sat 가 이동)
// 밝기 배율만 하는 gradientMap 으로는 이 느낌이 안 나오므로, 셰이딩 결과 휘도를 3단 컬러 램프로 다시 매핑한다.
const DEFAULT_SKIN_RAMP = { lit: 0xf0cdb0, mid: 0xd8906c, shadow: 0xa15230 };

// Material differences: matte skin and cloth; restrained hair and leather highlights.
const ROLE_LOOK = {
  // specEdge 는 하이라이트가 생기기 시작하는 문턱이다. 낮으면 넓은 흰 원이 되어 즉시 플라스틱처럼 보인다.
  skin:  { grade: 0.88, rim: 0.10, specPower: 46, specGain: 0.015, specEdge: 0.74, outline: 1.0 },
  face:  { grade: 0.92, rim: 0.08, specPower: 52, specGain: 0.0, specEdge: 0.80, outline: 0.8 },
  hair:  { grade: 0.55, rim: 0.14, specPower: 40, specGain: 0.05, specEdge: 0.88, outline: 0.75, hairBand: 1 },
  glove: { grade: 0.62, rim: 0.38, specPower: 64, specGain: 0.30, specEdge: 0.80, outline: 0.62 },
  cloth: { grade: 0.45, rim: 0.20, specPower: 34, specGain: 0.08, specEdge: 0.78, outline: 1.0 },
};

// 셰이딩 결과를 3톤 램프로 재매핑 + 림라이트 + 셀 스페큘러 + 헤어 하이라이트 밴드
const TONE_GRADE_GLSL = /* glsl */`
{
  vec3 nrm = normalize(vNormal);
  vec3 vdir = normalize(vViewPosition);

  // 현재 프래그먼트가 베이스 색 대비 얼마나 밝게 셰이딩됐는지 (0 = 완전 그림자, 1 = 정면광)
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float baseLum = max(dot(uBaseColor, LUMA), 1e-4);
  float illumination = clamp(dot(gl_FragColor.rgb, LUMA) / baseLum, 0.0, 1.25);
  float formLight = .56 + .48 * dot(nrm, normalize(vec3(-.45,.72,.65)));
  float shade = mix(illumination, formLight, uGrade * uFormWeight);

  // Soft transitions retain comic planes without hard black muscle borders.
  vec3 toned = mix(uShadowColor, uMidColor, smoothstep(0.36, 0.58, shade));
  toned = mix(toned, uLitColor, smoothstep(0.72, 0.96, shade));
  toned *= 0.82 + 0.18 * clamp(shade, 0.0, 1.15);   // 광량 차이는 남기되 상단을 눌러 클리핑 방지
  gl_FragColor.rgb = mix(gl_FragColor.rgb, toned, uGrade);

  // 인트로처럼 조명이 강한 장면에서 얼굴이 흰색으로 날아가지 않도록 밝은 쪽 가산을 줄인다
  float hot = smoothstep(0.85, 1.30, shade);

  // 림라이트: 실루엣을 배경에서 떼어낸다
  float rim = pow(1.0 - max(0.0, dot(nrm, vdir)), 3.0);
  gl_FragColor.rgb += uLitColor * rim * uRim * 0.42 * (1.0 - 0.75 * hot);

  // 셀 스페큘러: 경계가 뚜렷한 하이라이트 (땀 · 가죽 광택)
  vec3 ldir = normalize(vec3(0.4, 0.9, 0.5));
  vec3 hvec = normalize(ldir + vdir);
  float spec = pow(max(0.0, dot(nrm, hvec)), uSpecPower);
  spec = smoothstep(uSpecEdge, uSpecEdge + 0.15, spec) * uSpecGain;
  gl_FragColor.rgb += vec3(1.0) * spec * (1.0 - 0.7 * hot);

  // 밝은 쪽 소프트 클립 — 흰색으로 뭉개지는 대신 램프의 밝은면 색을 유지한다
  gl_FragColor.rgb = min(gl_FragColor.rgb, mix(vec3(1.0), uLitColor * 1.02 + 0.03, uGrade));

  // 머리카락: 결을 따라 흐르는 가로 하이라이트 띠.
  // 원작의 머리 광택은 "좁고 경계가 단단한 띠"다. 넓게 퍼지면 즉시 플라스틱처럼 보인다.
  if (uHairBand > 0.5) {
    float band = 1.0 - abs(nrm.y - 0.46) * 15.0;
    band = smoothstep(0.55, 0.78, band);
    gl_FragColor.rgb += vec3(0.06, 0.055, 0.05) * band * 0.12;
  }
  #ifdef USE_COLOR
    gl_FragColor.rgb *= vColor;
  #endif
}`;

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

function makeOutlineMaterial(ghost, thickness = 0.014) {
  return new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      color: { value: new THREE.Color(0x120a08) },   // 순흑보다 살짝 따뜻한 잉크 (원작 선 색)
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
// 주인공: 작고 다부진 인파이터 (첨부 레퍼런스의 흰/빨간 트렁크, 검은 헤어, 빨간 글러브)
// 상대: 장신·마른 히트맨 (흑발 슬릭백, 가늘게 찢어진 눈, 다크 트렁크, 검은 글러브, 플리커 잽)
export const CHARACTERS = {
  ippo: {
    name: 'IPPO', gender: 'm', skin: 0xf0caad, trunks: 0xf1eee6, trunksTrim: 0xb72b2d, trunksText: 'IPPO',
    referenceIppo: true,
    ramp: { lit: 0xf0c293, mid: 0xcf8e53, shadow: 0x854926 },
    gloves: 0xc8241f, hair: 0x20201e, shoes: 0xc92626, shoesTrim: 0xffffff,
    hairStyle: 'ippo-reference', brows: 'thick', eyes: 'round', mouth: 'grit',
    prop: { height: 0.95, torsoW: 1.14, torsoD: 1.12, armR: 1.18, armLen: 0.96, legR: 1.12, legLen: 0.95, headS: .98, headY: 1.10, neck: 1.0, muscle: 1 },
    hp: 140, powerMul: 1.05, speedMul: 1.05, style: 'infighter', guardMax: 110, guardRegen: 1.0, weaveCd: 1.2,
  },
  mashiba: {
    name: 'MASHIBA', gender: 'm', skin: 0xf1c8a6, trunks: 0x1d1226, trunksTrim: 0x9b4de0, trunksText: 'MASHIBA',
    ramp: { lit: 0xf1c8a6, mid: 0xd8916b, shadow: 0xa1502f },
    gloves: 0x8e1d18, hair: 0x0d0809, shoes: 0x141218, shoesTrim: 0x9b4de0,
    hairStyle: 'longblack', brows: 'thin', eyes: 'narrow', mouth: 'grin',
    // 원작은 마르되 근육 윤곽이 뚜렷하다 — 복근/대흉근 디테일이 나오도록 상향
    prop: { height: 1.13, torsoW: 0.86, torsoD: 0.82, armR: 0.82, armLen: 1.24, legR: 0.84, legLen: 1.12, headS: 0.96, headY: 1.18, neck: 1.35, muscle: 0.75 },
    hp: 150, powerMul: 0.9, speedMul: 1.22, style: 'hitman', guardMax: 85, guardRegen: 1.15, weaveCd: 1.1,
  },
  // 아웃복서: 늘씬하고 빠름, 갈색 머리, 남색/흰 트렁크
  miyata: {
    name: 'MIYATA', gender: 'm', skin: 0xedd5c1, trunks: 0x1b2a6b, trunksTrim: 0xffffff, trunksText: 'MIYATA',
    ramp: { lit: 0xedd5c1, mid: 0xdc926e, shadow: 0xa15030 },
    gloves: 0xcf2a22, hair: 0x0c0909, shoes: 0x1b2a6b, shoesTrim: 0xffffff,
    hairStyle: 'bowl', brows: 'thin', eyes: 'round', mouth: 'grit',
    prop: { height: 1.02, torsoW: 0.92, torsoD: 0.9, armR: 0.9, armLen: 1.08, legR: 0.9, legLen: 1.04, headS: 0.98, headY: 1.05, neck: 1.1, muscle: 0.6 },
    hp: 115, powerMul: 0.8, speedMul: 1.45, style: 'outboxer', guardMax: 80, guardRegen: 1.35, weaveCd: 0.95,
  },
  // 나니와의 호랑이: 야성적인 갈색 스파이크 헤어, 검정/주황 트렁크, 강력한 스매시
  sendo: {
    name: 'SENDO', gender: 'm', skin: 0xf1d0b3, trunks: 0x141414, trunksTrim: 0xff7a00, trunksText: 'SENDO',
    ramp: { lit: 0xf1d0b3, mid: 0xd6906c, shadow: 0xa15430 },
    gloves: 0xd3391c, hair: 0x0f0c0e, shoes: 0x141414, shoesTrim: 0xff7a00,
    hairStyle: 'mane', brows: 'thick', eyes: 'narrow', mouth: 'grin',
    prop: { height: 1.06, torsoW: 1.22, torsoD: 1.15, armR: 1.22, armLen: 1.08, legR: 1.15, legLen: 1.04, headS: 1.03, headY: 1.0, neck: 1.0, muscle: 1 },
    hp: 220, powerMul: 1.75, speedMul: 0.82, style: 'power', guardMax: 135, guardRegen: 0.8, weaveCd: 1.7,
  },
  // ---- 히든 캐릭터 ----
  // 채채더킴: 작은 키, 단발머리 + 큰 눈. 냥냥펀치(빠르고 가벼움), 필살 = 릴스 (상대를 붙잡아 같이 춤)
  chaechae: {
    name: 'CHAECHAE', gender: 'f', skin: 0xffdcc4, trunks: 0x14141a, trunksTrim: 0x2a2a33, trunksText: '',
    bodyColor: 0x17171e, sleeves: 0xffdcc4, pants: 0xffdcc4,          // 검은 원피스 (팔·다리는 맨살)
    gloves: 0xffdcc4, noGloves: true, shoes: 0x1b1b22, shoesTrim: 0x3a3a46,   // 단화
    hair: 0x2a1a16, hairStyle: 'bob', brows: 'thin', eyes: 'big', mouth: 'grin',
    accessory: 'sunglasses', skirt: 0x17171e, hold: { L: 'book', R: 'book' },
    prop: { height: 0.82, torsoW: 0.88, torsoD: 0.86, armR: 0.86, armLen: 0.88, legR: 0.9, legLen: 0.86, headS: 1.08, headY: 1.0, neck: 0.8, muscle: 0.3 },
    hp: 120, powerMul: 0.8, speedMul: 1.38, style: 'idol', guardMax: 75, guardRegen: 1.35, weaveCd: 1.0, gaugeMul: 1.15, hidden: true, sfx: 'nyang',
  },
  // 쩡효: 중간 키, 긴 생머리 + 흰 피부. 덤벨 펀치(무겁다), 필살 = 바벨 내려찍기
  jjeonghyo: {
    name: 'JJEONGHYO', gender: 'f', skin: 0xfdeade, trunks: 0x14141a, trunksTrim: 0x2a2a33, trunksText: '',
    bodyColor: 0xf4f4f0, sleeves: 0xfdeade, pants: 0x1a1a20,          // 흰 티 + 검정 레깅스
    chestText: 'HDEX', chestTextColor: '#111118',
    gloves: 0xfdeade, noGloves: true, shoes: 0xf0f0f0, shoesTrim: 0xc0f000,
    hair: 0x241b18, hairStyle: 'long', brows: 'thin', eyes: 'narrow', mouth: 'grit',
    hold: { L: 'dumbbell', R: 'dumbbell' },
    prop: { height: 1.0, torsoW: 1.06, torsoD: 1.0, armR: 1.12, armLen: 1.0, legR: 1.12, legLen: 0.98, headS: 0.98, headY: 1.0, neck: 1.0, muscle: 1 },
    hp: 185, powerMul: 1.45, speedMul: 0.90, style: 'gym', guardMax: 130, guardRegen: 0.85, weaveCd: 1.6, gaugeMul: 0.8, hidden: true, sfx: 'clang',
  },
  // 뼈석원: 큰 키, 구릿빛 피부에 마른 몸. 뼈펀치(리치 최장), 필살 = 오토바이 돌진
  ppyeo: {
    name: 'PPYEO', gender: 'm', skin: 0xb07848, trunks: 0x2f4f86, trunksTrim: 0x24406e, trunksText: '',
    bodyColor: 0xf2f2f4, sleeves: 0xb07848, pants: 0x2f4f86,          // 스티치 티 + 청바지
    chestText: 'STITCH', chestTextColor: '#2ba8e0', chestArt: 'stitch',
    gloves: 0xb07848, noGloves: true, shoes: 0xe8e8ec, shoesTrim: 0x2f4f86,
    hair: 0x14100e, hairStyle: 'slick', brows: 'thin', eyes: 'narrow', mouth: 'grin',
    hold: { L: 'helmet', R: 'bottle' },
    prop: { height: 1.2, torsoW: 0.74, torsoD: 0.72, armR: 0.7, armLen: 1.32, legR: 0.72, legLen: 1.2, headS: 0.94, headY: 1.16, neck: 1.4, muscle: 0.1 },
    hp: 125, powerMul: 1.15, speedMul: 1.25, style: 'bone', guardMax: 90, guardRegen: 1.1, weaveCd: 1.2, gaugeMul: 1.0, hidden: true, sfx: 'bone',
  },
  // 오승현: 가장 작고 하얀 피부. 빵을 들고 계속 먹는다. 소심하지만 갑자기 때린다
  ohsh: {
    name: 'OHSH', gender: 'f', skin: 0xfff0e6, trunks: 0xfaf3ea, trunksTrim: 0xe8c9a0, trunksText: '',
    bodyColor: 0xfdf6ec, sleeves: 0xfff0e6, pants: 0xe8dbc8,
    gloves: 0xfff0e6, noGloves: true, shoes: 0xf4e7d4, shoesTrim: 0xd9a95c,
    hair: 0x14131a, hairStyle: 'bobsharp', brows: 'thin', eyes: 'big', mouth: 'grit',
    hold: { L: 'bread', R: 'croissant' }, oversize: 1,
    prop: { height: 0.72, torsoW: 0.9, torsoD: 0.88, armR: 0.95, armLen: 0.82, legR: 0.84, legLen: 0.78, headS: 1.14, headY: 1.0, neck: 0.7, muscle: 0.15 },
    hp: 105, powerMul: 0.9, speedMul: 1.35, style: 'bread', guardMax: 70, guardRegen: 1.4, weaveCd: 1.0, gaugeMul: 1.25, hidden: true, sfx: 'nyang', sleeveColor: 0xfdf6ec,
  },
  // 정주원: 뚱뚱한 보통 체격, 헤드폰. 삼각김밥을 계속 먹는다
  jungjuwon: {
    name: 'JUNGJUWON', gender: 'm', skin: 0xf0c9a0, trunks: 0x2e2e38, trunksTrim: 0x5b5be0, trunksText: '',
    bodyColor: 0x3c4250, sleeves: 0xf0c9a0, pants: 0x2a2f3a,
    gloves: 0xf0c9a0, noGloves: true, shoes: 0x2e2e38, shoesTrim: 0x5b5be0,
    hair: 0x1c1712, hairStyle: 'spiky', brows: 'thick', eyes: 'round', mouth: 'grin',
    accessory: 'headphones', belly: 1,
    hold: { L: 'onigiri', R: 'coffee' },
    prop: { height: 1.0, torsoW: 1.34, torsoD: 1.34, armR: 1.14, armLen: 1.0, legR: 1.12, legLen: 0.94, headS: 1.04, headY: 1.0, neck: 0.85, muscle: 0.15 },
    hp: 195, powerMul: 1.3, speedMul: 0.92, style: 'snack', guardMax: 125, guardRegen: 0.85, weaveCd: 1.55, gaugeMul: 0.9, hidden: true,
  },
  // 고코몽: 약간 작은 체격, 하늘색 긴 티. 감정이 없다
  gokomong: {
    name: 'GOKOMONG', gender: 'm', skin: 0xecc6a4, trunks: 0x2b3440, trunksTrim: 0x7fd4f5, trunksText: '',
    bodyColor: 0x8fd6f2, sleeves: 0x8fd6f2, pants: 0x3b4450,     // 하늘색 긴팔 티
    gloves: 0xecc6a4, noGloves: true, shoes: 0x2b3440, shoesTrim: 0x8fd6f2,
    hair: 0x1a1a20, hairStyle: 'bob', brows: 'thin', eyes: 'narrow', mouth: 'grit',
    prop: { height: 0.94, torsoW: 0.98, torsoD: 0.94, armR: 0.94, armLen: 1.04, legR: 0.96, legLen: 0.96, headS: 1.02, headY: 1.0, neck: 0.95, muscle: 0.45 },
    hp: 150, powerMul: 1.05, speedMul: 1.0, style: 'istp', guardMax: 100, guardRegen: 1.0, weaveCd: 1.3, gaugeMul: 0.95, hidden: true,
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
  rig.elbowL.rotation.x = THREE.MathUtils.clamp(p.elL, -2.65, .02);
  rig.shoulderR.rotation.set(p.shRX, p.shRY, p.shRZ);
  rig.elbowR.rotation.x = THREE.MathUtils.clamp(p.elR, -2.65, .02);
  rig.thighL.rotation.set(p.thighLX, 0, p.thighLZ);
  rig.shinL.rotation.x = THREE.MathUtils.clamp(p.shinL, 0, 2.4);
  rig.thighR.rotation.set(p.thighRX, 0, p.thighRZ);
  rig.shinR.rotation.x = THREE.MathUtils.clamp(p.shinR, 0, 2.4);
  for (const d of rig.deformers || []) d.middle.rotation.x = d.joint.rotation.x * .5;
}

// 캐릭터별 지오메트리 캐시 (잔상 8개가 같은 지오메트리 공유)
const geoCache = new Map();
// y 높이에 따라 x/z 를 눌러 실루엣을 만든다.
// 원작 복서의 상체는 어깨가 넓고 허리로 갈수록 좁아지는 역삼각형이다. 박스 지오메트리는 이게 안 나온다.
function taperY(geo, { top = 1, bottom = 1, curve = 1 } = {}) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.pow((pos.getY(i) - minY) / span, curve);
    const s = bottom + (top - bottom) * t;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function geometriesFor(def) {
  if (geoCache.has(def)) return geoCache.get(def);
  const P = def.prop;
  const G = {
    pelvis: new RoundedBoxGeometry(0.36 * P.torsoW, 0.24, 0.26 * P.torsoD, 4, 0.08),
    band: new RoundedBoxGeometry(0.38 * P.torsoW, def.referenceIppo?.105:.06, 0.28 * P.torsoD, 2, 0.02),
    stripe: new THREE.BoxGeometry(0.03, 0.2, 0.05),
    // 어깨(위) 넓고 허리(아래) 좁은 역삼각형. muscle 이 높을수록 차이를 크게 준다
    torso: torsoGeometry(P, def),
    ghostTorso: torsoGeometry(P, {...def, bodyColor: 0xffffff}),
    armSurface: limbGeometry(.32 * P.armLen, .080 * P.armR),
    legSurface: limbGeometry(.42 * P.legLen, .087 * P.legR, true),
    ghostArm: limbGeometry(.32 * P.armLen, .080 * P.armR, false, true),
    ghostLeg: limbGeometry(.42 * P.legLen, .087 * P.legR, true, true),
    // Pectorals and abdomen are already sculpted into the continuous torso.
    // Deltoid, upper arm, elbow and forearm share a weighted surface.
    // 목: 원작 복서는 목이 굵고 짧게 드러나되, 머리보다는 확실히 가늘다
    neck: new THREE.CylinderGeometry(0.060 * P.torsoW, 0.076 * P.torsoW, 0.15 * P.neck, 14),
    foot: new RoundedBoxGeometry(0.14, 0.1, 0.3, 3, 0.035),
    footTrim: new RoundedBoxGeometry(0.15, 0.03, 0.31, 2, 0.01),
    // 글러브: 원작은 구체가 아니라 각이 살아있는 큰 주먹. 앞면이 넓고 손목 쪽으로 좁아진다
    // 세그먼트·라운드를 넉넉히 준다. 각이 너무 날카로우면 외곽선(인버티드 헐)이 모서리에서 벌어져 격자로 깨진다
    glove: taperY(new RoundedBoxGeometry(0.25, 0.235, 0.27, 7, 0.108), { top: 0.80, bottom: 1.04, curve: 1.1 }),
    hand: new THREE.SphereGeometry(0.13, 16, 12),   // 맨손 캐릭터용
    gloveCuff: new THREE.CylinderGeometry(0.09, 0.108, 0.105, 14),
    // 3톤 램프는 면 경계를 드러낸다 — 얼굴은 가까이 잡히므로 세그먼트를 넉넉히 준다 (메시 1개라 비용 무시 가능)
    head: sculptHead(new THREE.SphereGeometry(0.17 * P.headS, 40, 30), P, def),
    ear: new THREE.SphereGeometry(0.035, 8, 6),
    hair: new THREE.SphereGeometry(0.184 * P.headS, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.48),
    spike: hairLock(0.048 * P.headS, 0.17 * P.headS),
    spikeBig: hairLock(0.058 * P.headS, 0.235 * P.headS),          // 크게 뻗치는 머리칼
    strand: hairLock(0.041 * P.headS, 0.30 * P.headS, 0.014),   // 늘어지는 긴 머리칼
    bang: new RoundedBoxGeometry(.27 * P.headS, .075 * P.headS, .055, 4, .025), // 이마 덮는 앞머리
    ippoHair: ippoHairGeometry(P,def.hairStyle),
  };
  geoCache.set(def, G);
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

// ---- 얼굴 텍스처 ----
// 원작의 눈은 "얼굴 평면에 그려진 날카로운 도형"이다. 구체를 박아 넣으면 눈알이 튀어나온 인형이 된다.
// 눈·눈썹·입을 캔버스에 그려서 얼굴 앞면에 감싼다.
function faceTexture(def, expression = 'focused') { return ippoFaceTexture(expression,def); }

function trunksTextTexture(text, color, patch=false) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  if(patch){g.fillStyle='#eee9dd';g.fillRect(4,4,248,88);g.strokeStyle='#a49583';g.lineWidth=4;g.strokeRect(4,4,248,88);}
  g.font = '900 64px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = patch?1:8; g.strokeStyle = '#000';
  if(!patch)g.strokeText(text, 128, 50);
  g.fillStyle = patch?'#181413':color;
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 복서 리그 생성. 캐릭터는 로컬 +Z 방향을 바라본다.
 * ghost=true 이면 잔상용: 라이팅 없는 반투명 머티리얼, 그림자 없음.
 */
export const FIGHTER_SCALE = 0.7;

export function buildBoxer(def, opts = {}) {
  const { ghost = false, tint = 0x9fdcff } = opts;
  const P = def.prop;
  const bodyCol = def.bodyColor || def.skin;   // 코치용: 몸은 트레이닝복 색, 얼굴만 피부색
  const G = geometriesFor(def);
  const bodyMats = [];

  // Thin warm silhouette ink; ghosts never create outline meshes.
  const outlineMats = new Map();
  const outlineFor = (scale) => {
    const key = Math.round(scale * 100);
    let m = outlineMats.get(key);
    if (!m) { m = makeOutlineMaterial(ghost, 0.0038 * scale); if (ghost) m.uniforms.color.value.set(0xffffff); outlineMats.set(key, m); }
    return m;
  };

  // 부위 판정: 지오메트리 우선, 없으면 색으로 역추적
  const geomRole = new Map([
    [G.head, 'face'], [G.ear, 'face'], [G.neck, 'skin'],
    [G.hair, 'hair'], [G.spike, 'hair'],
    [G.glove, 'glove'], [G.gloveCuff, 'glove'],
  ]);
  const roleFor = (geom, c) => geomRole.get(geom)
    || (c === def.hair ? 'hair'
      : (c === def.gloves && !def.noGloves) ? 'glove'
      : c === def.skin ? 'skin' : 'cloth');

  // 베이스 색에서 3톤 램프 유도 — 그림자로 갈수록 채도 ↑, 색상은 붉은 쪽으로 이동
  const deriveRamp = (c) => {
    const hsl = {};
    new THREE.Color(c).getHSL(hsl);
    return {
      lit: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.04), Math.min(1, hsl.l * 1.05 + 0.02)),
      mid: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.14), hsl.l * 0.70),
      shadow: new THREE.Color().setHSL((hsl.h - 0.02 + 1) % 1, Math.min(1, hsl.s * 1.38 + 0.04), hsl.l * 0.40),
    };
  };
  const skinRamp = def.ramp || (def.skin != null ? deriveRamp(def.skin) : DEFAULT_SKIN_RAMP);
  const rampFor = (role, c) => (role === 'skin' || role === 'face')
    ? { lit: new THREE.Color(skinRamp.lit), mid: new THREE.Color(skinRamp.mid), shadow: new THREE.Color(skinRamp.shadow).lerp(new THREE.Color(skinRamp.mid), .22) }
    : deriveRamp(c);

  // (역할, 색) 단위 재질 캐시 — 부위 300개가 재질 300개를 만들던 것을 10여 개로 줄인다
  const matCache = new Map();
  const M = (c, role) => {
    const key = role + ':' + c;
    const cached = matCache.get(key);
    if (cached) return cached;

    let m;
    if (ghost) {
      // Unlit white silhouette: no skin tint, gloss or ink.
      // 톤매핑을 끄면 흰색이 회색으로 눌리지 않고 그대로 하얗게 남는다 (만화의 흰 잔상).
      m = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, depthTest: true, toneMapped: false,
      });
      m.userData.base = new THREE.Color(0xffffff);
    } else {
      const look = ROLE_LOOK[role] || ROLE_LOOK.cloth;
      const ramp = rampFor(role, c);
      m = new THREE.MeshToonMaterial({ color: c, gradientMap });
      m.userData.ramp = ramp;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uBaseColor = { value: new THREE.Color(c) };
        sh.uniforms.uLitColor = { value: ramp.lit };
        sh.uniforms.uMidColor = { value: ramp.mid };
        sh.uniforms.uShadowColor = { value: ramp.shadow };
        sh.uniforms.uGrade = { value: look.grade };
        sh.uniforms.uFormWeight = {value:(role==='skin'||role==='face')?.94:.65};
        sh.uniforms.uRim = { value: look.rim };
        sh.uniforms.uSpecPower = { value: look.specPower };
        sh.uniforms.uSpecGain = { value: look.specGain };
        sh.uniforms.uSpecEdge = { value: look.specEdge };
        sh.uniforms.uHairBand = { value: look.hairBand ? 1 : 0 };
        sh.fragmentShader = `
uniform vec3 uBaseColor; uniform vec3 uLitColor; uniform vec3 uMidColor; uniform vec3 uShadowColor;
uniform float uGrade; uniform float uFormWeight; uniform float uRim; uniform float uSpecPower; uniform float uSpecGain;
uniform float uSpecEdge; uniform float uHairBand;
` + sh.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          TONE_GRADE_GLSL + '\n#include <tonemapping_fragment>'
        );
      };
    }
    // Reserve stencil bit 0 for current characters. Historical poses may overlap
    // them in world space, but must never paint over their projected silhouette.
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilWriteMask = ghost ? 0 : 1;
    m.stencilFuncMask = 1;
    m.stencilFunc = ghost ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc;
    m.stencilFail = m.stencilZFail = THREE.KeepStencilOp;
    m.stencilZPass = ghost ? THREE.KeepStencilOp : THREE.ReplaceStencilOp;
    matCache.set(key, m);
    bodyMats.push(m);
    return m;
  };

  const part = (geom, color, parent, x = 0, y = 0, z = 0, outline = true) => {
    const role = roleFor(geom, color);
    const mesh = new THREE.Mesh(geom, M(color, role));
    mesh.castShadow = !ghost;
    mesh.receiveShadow = false; // Stable painted form shading; floor still receives cast shadows.
    mesh.position.set(x, y, z);
    if (outline && !ghost && role !== 'hair') {
      // 숫자를 넘기면 그 값이 굵기 배율 (작은 부위는 선이 뭉치지 않게 가늘게)
      const w = typeof outline === 'number' ? outline : (ROLE_LOOK[role] || ROLE_LOOK.cloth).outline;
      mesh.add(new THREE.Mesh(geom, outlineFor(w)));
    }
    parent.add(mesh);
    return mesh;
  };

  const root = new THREE.Group();
  // 전체 체격 축소 (맵이 넓어져 상대적으로 크게 보이던 것을 70% 로)
  root.scale.setScalar(FIGHTER_SCALE);
  const legLen = 0.42 * P.legLen;
  const deformers = [];
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
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(def.referenceIppo?.14:.24,def.referenceIppo?.08:.09), new THREE.MeshBasicMaterial({ map: trunksTextTexture(def.trunksText, '#' + new THREE.Color(def.trunksTrim).getHexString(),def.referenceIppo), transparent: true, depthWrite: false }));
    tp.position.set(0, def.referenceIppo?.09:-.005, 0.14 * P.torsoD + 0.006);
    hips.add(tp);
  }

  // ---- 다리 ----
  const mkLeg = (sx) => {
    const thigh = new THREE.Group();
    thigh.position.set(sx * 0.115 * P.torsoW, -0.1, 0);
    hips.add(thigh);

    const shin = new THREE.Group();
    shin.position.y = -legLen;
    thigh.add(shin);
    deformers.push(attachLimb(thigh, shin, ghost ? G.ghostLeg : G.legSurface, M(def.pants || def.skin, def.pants ? 'cloth' : 'skin'), !ghost));
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
  let torso = attachTorso(waist, chest, ghost ? G.ghostTorso : G.torso, M(bodyCol, def.bodyColor ? 'cloth' : 'skin'), !ghost);
  if(ghost)part(G.neck, def.skin, chest, 0, 0.06 * P.neck, 0.02);

  const armLen = 0.32 * P.armLen;
  const mkArm = (sx) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * .27 * P.torsoW, -0.004, 0);
    shoulder.rotation.order = 'YZX'; // X(들어올림) → Z(벌림) → Y(휘두름) 순으로 적용
    chest.add(shoulder);
    if (def.oversize) {   // 소매가 팔보다 크다
      const sl = part(new THREE.CapsuleGeometry(0.098 * P.armR, armLen * 0.72, 4, 12), def.sleeveColor || bodyCol, shoulder, 0, -armLen * 0.52, 0);
      sl.scale.set(1.12, 1, 1.12);
    }
    const elbow = new THREE.Group();
    elbow.position.y = -armLen;
    shoulder.add(elbow);
    const armColor = def.sleeves || def.skin;
    deformers.push(attachLimb(shoulder, elbow, ghost ? G.ghostArm : G.armSurface, M(armColor, armColor === def.skin ? 'skin' : 'cloth'), !ghost));
    if (!def.noGloves) part(G.gloveCuff, 0xe9e3d7, elbow, 0, -armLen * 0.78, 0);
    const glove = part(def.noGloves ? G.hand : G.glove, def.gloves, elbow, 0, -armLen - 0.02, 0);
    if (def.noGloves) glove.scale.setScalar(0.6);
    else if (!ghost) {
      // 글러브 솔기(엄지 라인) + 손목 스트랩
      const seam = part(new THREE.TorusGeometry(0.101, 0.004, 6, 24), 0x6c2824, glove, 0, 0.025, 0.012, false);
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
  if(!ghost){torso=attachIppoBody(waist,torso,deformers,P,def,M(def.skin,'skin'));bodyMats.push(...(Array.isArray(torso.material)?torso.material:[torso.material]));}

  // ---- 머리 / 얼굴 ----
  const headBaseY = 0.02 + 0.07 * P.neck;
  const head = new THREE.Group();
  head.position.y = headBaseY;
  chest.add(head);
  const hy = 0.178 * P.headS;
  const headMesh = part(G.head, def.skin, head, 0, hy, 0);
  headMesh.scale.set(1, P.headY, 1);
  // 턱 (장신 캐릭터는 길고 뾰족한 인상)
  // 턱은 머리 구면 안에 머물러야 한다 — 앞으로 삐져나오면 얼굴 텍스처를 뚫고 면이 얼룩진다
  if (!ghost) part(G.ear, def.skin, head, 0.165 * P.headS, hy, 0);
  if (!ghost) part(G.ear, def.skin, head, -0.165 * P.headS, hy, 0);
  // 머리 캡을 뒤로 젖힌다 — 앞쪽 헤어라인이 올라가 이마와 눈썹이 드러난다 (원작은 눈썹이 항상 보인다)
  const hairCap = part(G.hair, def.hair, head, 0, hy + 0.018, -0.022);
  hairCap.rotation.x = -0.32;
  hairCap.scale.set(1.03, P.headY, 1.02);
  if (!ghost) {
    part(G.ippoHair,def.hair,head,0,hy,0,false);
  }

  // 얼굴: 머리 구면에 딱 맞는 앞면 패치에 눈·눈썹·입 텍스처를 감싼다 (튀어나온 눈알 없음)
  const eyeY = hy + 0.02 * P.headY, eyeZ = 0.14 * P.headS;   // 소품(선글라스 등) 기준점
  let rigFace = null;
  if (!ghost) {
    const R = 0.17 * P.headS;
    const faceGeo = sculptHead(new THREE.SphereGeometry(
      R * 1.006, 28, 22,
      Math.PI * 0.5 - .90, 1.80,
      .83, 1.75,
    ), P, def);
    const faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({
      map: faceTexture(def), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    faceMesh.renderOrder = 2;
    faceMesh.position.y = hy;
    faceMesh.scale.set(1, P.headY, 1);   // 머리통 세로 비율을 그대로 따라간다
    head.add(faceMesh);
    rigFace = faceMesh;
  }
  // 헤드폰 (정주원)
  if (!ghost && def.accessory === 'headphones') {
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
  if (!ghost && def.accessory === 'sunglasses') {
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
  const skinOutlineMats = [...deformers.map(d => d.ink), torso.userData.ink].filter(Boolean);
  const rig = {
    root, hips, waist, chest, head, headMesh, hipsBaseY, headBaseY, def, deformers, torso,
    shoulderL: armL.shoulder, elbowL: armL.elbow, gloveL: armL.glove,
    shoulderR: armR.shoulder, elbowR: armR.elbow, gloveR: armR.glove,
    thighL: legL.thigh, shinL: legL.shin, thighR: legR.thigh, shinR: legR.shin,
    footL: legL.foot, footR: legR.foot,
    face: rigFace,
    setExpression(expression) {
      if (!rigFace || this._expression === expression) return;
      this._expression = expression;
      rigFace.material.map = faceTexture(def, expression);
    },
    bodyMats,
    get outlineMats() { return [...outlineMats.values(), ...skinOutlineMats]; },
    setOpacity(o) {
      for (let i = 0; i < bodyMats.length; i++) bodyMats[i].opacity = o;
      this.setOutlineOpacity(Math.min(1, o * 1.3));
    },
    /** Legacy tint API: motion silhouettes always remain unlit white. */
    setTint(color, k = 0.3) {
      if (ghost) for (const m of bodyMats) m.color.set(0xffffff);
    },
    setOutlineOpacity(a) {
      for (const m of skinOutlineMats) { m.opacity=a; m.transparent=a<.999; m.depthWrite=a>.5; }
      for (const m of outlineMats.values()) {
        m.uniforms.opacity.value = a;
        m.transparent = a < 0.999;
      }
    },
    // 인자는 '몸통 기준' 굵기. 얼굴·머리의 굵기 배율은 그대로 유지한다.
    setOutline(thickness) {
      for (const m of skinOutlineMats) m.userData.thickness.value = thickness * .92;
      const k = thickness / 0.013;
      for (const [key, m] of outlineMats) m.uniforms.thickness.value = 0.013 * (key / 100) * k;
    },
  };
  applyPose(rig, defaultPose());
  // Anatomical skinned surfaces retain smooth joint weights in every render mode.
  return rig;
}
