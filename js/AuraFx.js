// AuraFx.js — 필살기 게이지 MAX 오라 (드래곤볼 초사이어인 스타일: 몸을 감싸고 위로 치솟는 황금 불꽃 + 발밑 파동).
// 상태(dempsey.maxSpeed)는 스냅샷으로 동기화되므로 호스트·게스트·상대 화면 모두에서 똑같이 보인다.
// 파이터(슬롯)마다 불꽃 껍질 메시 하나 + 바닥 파동 하나. 텍스처 없이 셰이더 노이즈만 써서 저사양에서도 싸다.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 2.9) * 0.15; }
`;

const FLAME_VERT = /* glsl */`
  uniform float uTime; uniform float uPulse;
  varying vec2 vUv; varying float vRim;
  ${NOISE}
  void main() {
    vUv = uv;
    vec3 p = position;
    // 불꽃 혀: 위로 갈수록 크게 일렁이며 바깥으로 벌어진다
    float a = atan(p.z, p.x);
    float n = fbm(vec2(a * 1.6 + 3.0, uv.y * 2.2 - uTime * 2.4));
    float flick = (n - 0.5) * (0.25 + 0.9 * uv.y);
    p.xz *= 1.0 + flick + uPulse * 0.08;
    p.y += (n - 0.5) * 0.35 * uv.y + uPulse * 0.1 * uv.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 nrm = normalize(normalMatrix * normal);
    vRim = 1.0 - abs(dot(normalize(-mv.xyz), nrm));
    gl_Position = projectionMatrix * mv;
  }`;
const FLAME_FRAG = /* glsl */`
  uniform float uTime; uniform float uFade; uniform vec3 uCore; uniform vec3 uEdge;
  varying vec2 vUv; varying float vRim;
  ${NOISE}
  void main() {
    float x = vUv.x, y = vUv.y;
    // 위로 흐르는 불꽃 노이즈
    vec2 q = vec2(x * 7.0, y * 3.2 - uTime * 3.0);
    float n = fbm(q) * 0.7 + fbm(vec2(x * 13.0 + 5.0, y * 5.5 - uTime * 4.6)) * 0.3;
    // 아래는 촘촘하고 위로 갈수록 문턱이 높아져 혀처럼 찢어진다
    float t = 0.28 + 0.34 * y;
    float mask = smoothstep(t, t + 0.2, n);
    float bottom = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.75, 1.0, y));
    // 실루엣 가장자리(카메라 접선)에서 진하고 몸 앞쪽은 얇게 — 몸을 '감싸는' 느낌
    float rim = 0.35 + 0.65 * vRim;
    float a = mask * bottom * rim * uFade;
    // 안쪽은 흰노랑, 바깥·위쪽은 황금/주황
    float hot = smoothstep(0.62, 0.95, n) * (1.0 - y * 0.6);
    vec3 col = mix(uEdge, uCore, hot);
    gl_FragColor = vec4(col * (1.0 + 0.7 * hot), a);
  }`;

const GROUND_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = /* glsl */`
  uniform float uTime; uniform float uFade; uniform vec3 uEdge;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 c = vUv - 0.5; float d = length(c) * 2.0; float ang = atan(c.y, c.x);
    // 바깥으로 퍼지는 충격파 링 + 중심 빛
    float wave = fract(uTime * 0.9);
    float ring = smoothstep(wave - 0.08, wave, d) * (1.0 - smoothstep(wave, wave + 0.06, d)) * (1.0 - wave);
    float glow = (1.0 - smoothstep(0.0, 0.55, d)) * 0.5;
    float jag = 0.7 + 0.3 * vnoise(vec2(ang * 3.0 + uTime * 2.0, uTime));
    float a = (ring * 0.8 + glow * jag * 0.5) * uFade;
    gl_FragColor = vec4(uEdge, a);
  }`;

export class AuraFx {
  constructor(scene) {
    this.scene = scene;
    this.items = {};     // slot → { group, flame, ground, uniforms, fade, pulse }
    this.time = 0;
    // 불꽃 껍질: 몸을 감싸는 둥근 아래 → 위로 갈수록 좁아지고 셰이더가 혀 모양으로 찢는다
    this.flameGeo = new THREE.CylinderGeometry(0.28, 0.6, 2.1, 48, 14, true);
    this.flameGeo.translate(0, 1.0, 0);
    this.groundGeo = new THREE.PlaneGeometry(3.0, 3.0);
    this.groundGeo.rotateX(-Math.PI / 2);
  }

  _make() {
    const uniforms = {
      uTime: { value: 0 }, uFade: { value: 0 }, uPulse: { value: 0 },
      uCore: { value: new THREE.Color(1.0, 0.98, 0.75) },   // 안쪽: 흰노랑
      uEdge: { value: new THREE.Color(1.0, 0.58, 0.06) },   // 바깥: 황금·주황
    };
    const flame = new THREE.Mesh(this.flameGeo, new THREE.ShaderMaterial({
      uniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    }));
    const ground = new THREE.Mesh(this.groundGeo, new THREE.ShaderMaterial({
      uniforms, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    ground.position.y = 0.02;
    const group = new THREE.Group();
    group.add(flame, ground);
    group.visible = false;
    flame.renderOrder = ground.renderOrder = 5;
    flame.frustumCulled = ground.frustumCulled = false;
    this.scene.add(group);
    return { group, flame, ground, uniforms, fade: 0, pulse: 0 };
  }

  /** 매 프레임: MAX 인 파이터에게 오라를 켜고(페이드 인), 아니면 끈다(페이드 아웃) */
  update(dt, fighters) {
    this.time += dt;
    const seen = new Set();
    for (const f of fighters) {
      const it = this.items[f.slot] || (this.items[f.slot] = this._make());
      seen.add(f.slot);
      const on = !!(f.dempsey && f.dempsey.maxSpeed) && !f.ko && !f.benched && !f.falling && f.downT <= 0 && !f.ultVictimT;
      const target = on ? 1 : 0;
      it.fade += (target - it.fade) * Math.min(1, dt / (on ? 0.25 : 0.15));
      if (it.fade < 0.01 && !on) { it.fade = 0; it.group.visible = false; continue; }
      it.group.visible = true;
      it.group.position.set(f.pos.x, f.airY - (f.fallY || 0), f.pos.z);
      // 캐릭터 체격에 맞춘다 (작은 캐릭터는 작은 오라)
      const prop = f.def && f.def.prop ? f.def.prop : null;
      const h = prop ? prop.height : 1, w = prop ? Math.max(prop.torsoW, prop.armR) : 1;
      it.group.scale.set(0.95 * w, 0.9 * h, 0.95 * w);
      // 공격 중엔 오라가 더 크게 타오른다 (펀치·필살기)
      const attacking = !!f.punch || !!f.finisher || f.ultT > 0;
      it.pulse += ((attacking ? 1 : 0) - it.pulse) * Math.min(1, dt / 0.12);
      it.uniforms.uPulse.value = it.pulse;
      it.uniforms.uTime.value = this.time + f.slot * 7.7;
      it.uniforms.uFade.value = it.fade * (0.85 + 0.15 * Math.sin(this.time * 9.0 + f.slot)) * (1 + 0.3 * it.pulse);
    }
    for (const k in this.items) if (!seen.has(+k)) this.items[k].group.visible = false;
  }

  clear() {
    for (const k in this.items) { this.items[k].fade = 0; this.items[k].pulse = 0; this.items[k].group.visible = false; }
  }
}
