// PostFX.js — 프레임 블렌딩(AfterimagePass) + 커스텀 radial/directional blur + chromatic aberration
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SpeedBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    radial: { value: 0 },          // 방사형 블러 강도
    center: { value: new THREE.Vector2(0.5, 0.5) },
    dirBlur: { value: new THREE.Vector2(0, 0) }, // 방향성 블러 (uv 단위)
    chroma: { value: 0 },
    vignette: { value: 0.45 },
    heat: { value: 0 },            // MAX SPEED 색 왜곡
    jitter: { value: new THREE.Vector2(0, 0) }, // 화면 전체 진동 (uv 오프셋)
    dv: { value: new THREE.Vector2(0, 0) },     // 이중상 오프셋
    dvMix: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float radial;
    uniform vec2 center;
    uniform vec2 dirBlur;
    uniform float chroma;
    uniform float vignette;
    uniform float heat;
    uniform vec2 jitter;
    uniform vec2 dv;
    uniform float dvMix;
    varying vec2 vUv;
    void main() {
      vec2 vUv2 = vUv + jitter;
      vec2 toC = vUv2 - center;
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 off = toC * radial * t + dirBlur * (t - 0.5);
        float w = 1.0 - 0.6 * t;
        vec2 uv = vUv2 - off;
        vec2 ca = toC * chroma;
        col.r += texture2D(tDiffuse, uv + ca).r * w;
        col.g += texture2D(tDiffuse, uv).g * w;
        col.b += texture2D(tDiffuse, uv - ca).b * w;
        wsum += w;
      }
      col /= wsum;
      if (dvMix > 0.001) {
        vec3 c2 = texture2D(tDiffuse, vUv2 + dv).rgb;
        vec3 c3 = texture2D(tDiffuse, vUv2 - dv * 0.6).rgb;
        col = mix(col, max(col, (c2 + c3) * 0.5), dvMix);
      }
      float d = length(toC * vec2(1.0, 0.85));
      col *= 1.0 - vignette * smoothstep(0.3, 0.95, d);
      col = mix(col, col * vec3(1.15, 0.9, 0.75) + vec3(0.06, 0.0, 0.0), heat * smoothstep(0.2, 0.9, d));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.afterimage = new AfterimagePass(0.0);
    this.composer.addPass(this.afterimage);
    this.blur = new ShaderPass(SpeedBlurShader);
    this.composer.addPass(this.blur);
    this.composer.addPass(new OutputPass());
    this.hitRadial = 0;
    this.hitDamp = 0;
    this.quality = 2; // 2 = 풀, 1 = 블러 필요시만, 0 = 후처리 최소
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  onHit(power, cx, cy) {
    this.hitRadial = 0.12 + 0.18 * power;
    this.hitDamp = 0.6;
    this.blur.uniforms.center.value.set(cx, cy);
  }

  update(dt, s) {
    // s: { intensity, dempseyActive, maxSpeed, dirX, dirY (uv/frame), focusX, focusY (uv) }
    const I = s.intensity;
    this.hitRadial *= Math.exp(-dt * 11);
    this.hitDamp *= Math.exp(-dt * 8);
    const u = this.blur.uniforms;
    if (this.hitRadial < 0.005) u.center.value.set(s.focusX, s.focusY);
    u.radial.value = this.hitRadial + (s.maxSpeed ? 0.012 + 0.006 * Math.sin(s.time * 30) : 0.006 * I * (s.dempseyActive ? 1 : 0));
    u.dirBlur.value.set(s.dirX, s.dirY);
    u.chroma.value = (s.dempseyActive ? 0.003 * I : 0) + (s.maxSpeed ? 0.003 : 0) + this.hitRadial * 0.05;
    u.vignette.value = 0.42 + 0.25 * I;
    u.heat.value = s.maxSpeed ? 0.6 + 0.2 * Math.sin(s.time * 18) : Math.max(0, (I - 0.7) * 1.5);
    // 카운터 '골 흔들림': 화면 지터 + 이중상
    const r = s.rattle || 0;
    const rr = r * (0.5 + 0.5 * r);
    u.jitter.value.set(Math.sin(s.time * 71) * 0.012 * rr + Math.sin(s.time * 113) * 0.006 * rr, Math.cos(s.time * 89) * 0.009 * rr);
    u.dv.value.set(Math.sin(s.time * 47) * 0.03 * rr + 0.015 * rr, Math.cos(s.time * 39) * 0.012 * rr);
    u.dvMix.value = Math.min(1, r * 1.3);
    const damp = (s.dempseyActive ? 0.1 + 0.25 * I : 0) + (s.maxSpeed ? 0.05 : 0);
    const dampV = Math.min(0.7, Math.max(damp, this.hitDamp));
    this.afterimage.uniforms.damp.value = dampV;
    // 필요 없을 땐 패스 자체를 끈다 (풀스크린 셰이더 2개 절감)
    this.afterimage.enabled = dampV > 0.02 && this.quality > 0;
    const blurNeeded = u.radial.value > 0.002 || Math.abs(s.dirX) + Math.abs(s.dirY) > 0.0005 || u.chroma.value > 0.0005 || (s.rattle || 0) > 0.02 || s.maxSpeed || u.heat.value > 0.02;
    this.blur.enabled = blurNeeded || this.quality > 1;
  }

  render() { this.composer.render(); }
}
