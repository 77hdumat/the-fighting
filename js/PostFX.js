// PostFX.js — 후처리: 씬을 렌더타깃에 그린 뒤 "잔상 누적 + 스피드 블러 + 수차/비네트/열왜곡 + 톤매핑/색공간"을
// 단 하나의 풀스크린 패스로 합성한다. (기존 EffectComposer 체인: Render → Afterimage → SpeedBlur → Output = 최대 4패스)
//
// 구조
//   1) scene → rtScene                      (항상)
//   2) rtScene + rtPrev → rtAccum           (잔상이 필요할 때만. 없으면 건너뜀)
//   3) (rtAccum | rtScene) → 화면            (블러/수차/비네트/열/지터/이중상 + 톤매핑 + sRGB 를 한 번에)
//
// EffectComposer/OutputPass 를 쓰지 않으므로 톤매핑·색공간 변환을 직접 셰이더 청크로 넣는다.
import * as THREE from 'three';

const QUAD = new THREE.PlaneGeometry(2, 2);

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 잔상 누적: 이번 씬 프레임과 지난 누적 프레임을 damp 비율로 섞는다
const ACCUM_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform float damp;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tScene, vUv);
  vec4 prev = texture2D(tPrev, vUv);
  // 어두운 쪽으로 서서히 붕괴시켜 잔상이 영원히 남지 않게 한다 (three AfterimagePass 와 동일한 감쇠)
  vec4 decayed = max(prev * damp - 0.001, vec4(0.0));
  gl_FragColor = max(cur, decayed);
}`;

const COMPOSITE_FRAG = /* glsl */`
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
uniform float samplesMix;      // 0 = 저품질(4탭), 1 = 고품질(8탭)
varying vec2 vUv;
// tonemapping_pars / colorspace_pars 는 three 가 프래그먼트 프리픽스에 이미 넣어 준다 (중복 선언 금지)

void main() {
  vec2 uv0 = vUv + jitter;
  vec2 toC = uv0 - center;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  // 블러가 필요 없는 프레임에서는 1탭만 (분기 없이 가중치로 처리하면 느려서 실제 분기 사용)
  if (radial < 0.0008 && dot(dirBlur, dirBlur) < 1e-9 && chroma < 0.0004) {
    col = texture2D(tDiffuse, uv0).rgb;
  } else {
    const int N = 8;
    for (int i = 0; i < N; i++) {
      float t = float(i) / float(N - 1);
      // 저품질에서는 홀수 탭을 버린다 (가중치 0)
      float use = (mod(float(i), 2.0) < 0.5) ? 1.0 : samplesMix;
      vec2 off = toC * radial * t + dirBlur * (t - 0.5);
      float w = (1.0 - 0.6 * t) * use;
      vec2 uv = uv0 - off;
      vec2 ca = toC * chroma;
      col.r += texture2D(tDiffuse, uv + ca).r * w;
      col.g += texture2D(tDiffuse, uv).g * w;
      col.b += texture2D(tDiffuse, uv - ca).b * w;
      wsum += w;
    }
    col /= max(wsum, 0.0001);
  }
  if (dvMix > 0.001) {
    vec3 c2 = texture2D(tDiffuse, uv0 + dv).rgb;
    vec3 c3 = texture2D(tDiffuse, uv0 - dv * 0.6).rgb;
    col = mix(col, max(col, (c2 + c3) * 0.5), dvMix);
  }
  float d = length(toC * vec2(1.0, 0.85));
  col *= 1.0 - vignette * smoothstep(0.3, 0.95, d);
  col = mix(col, col * vec3(1.15, 0.9, 0.75) + vec3(0.06, 0.0, 0.0), heat * smoothstep(0.2, 0.9, d));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = 2;
    this.hitRadial = 0;
    this.hitDamp = 0;
    this.damp = 0;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true };
    this.rtScene = new THREE.WebGLRenderTarget(size.x, size.y, opts);
    this.rtA = new THREE.WebGLRenderTarget(size.x, size.y, { ...opts, depthBuffer: false, stencilBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(size.x, size.y, { ...opts, depthBuffer: false, stencilBuffer: false });
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
    }
    this.accumValid = false;

    this.accumMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tPrev: { value: null }, damp: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: ACCUM_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        radial: { value: 0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
        dirBlur: { value: new THREE.Vector2(0, 0) },
        chroma: { value: 0 },
        vignette: { value: 0.45 },
        heat: { value: 0 },
        jitter: { value: new THREE.Vector2(0, 0) },
        dv: { value: new THREE.Vector2(0, 0) },
        dvMix: { value: 0 },
        samplesMix: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(QUAD, this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const dw = Math.max(1, Math.floor(w * pr)), dh = Math.max(1, Math.floor(h * pr));
    this.rtScene.setSize(dw, dh); this.rtA.setSize(dw, dh); this.rtB.setSize(dw, dh);
    this.accumValid = false;
  }

  onHit(power, cx, cy) {
    this.hitRadial = 0.012 + 0.018 * Math.min(1.5, power);
    this.hitDamp = 0;
    this.compositeMat.uniforms.center.value.set(cx, cy);
  }

  update(dt, s) {
    const I = s.intensity;
    this.hitRadial *= Math.exp(-dt * 11);
    this.hitDamp *= Math.exp(-dt * 8);
    const u = this.compositeMat.uniforms;
    if (this.hitRadial < 0.005) u.center.value.set(s.focusX, s.focusY);
    u.radial.value = this.hitRadial + (s.maxSpeed ? 0.012 + 0.006 * Math.sin(s.time * 30) : 0.006 * I * (s.dempseyActive ? 1 : 0));
    u.dirBlur.value.set(s.dirX, s.dirY);
    u.chroma.value = (s.dempseyActive ? 0.003 * I : 0) + (s.maxSpeed ? 0.003 : 0) + this.hitRadial * 0.05;
    u.vignette.value = 0.42 + 0.25 * I;
    u.heat.value = s.maxSpeed ? 0.6 + 0.2 * Math.sin(s.time * 18) : Math.max(0, (I - 0.7) * 1.5);
    const r = s.rattle || 0;
    const rr = r * (0.5 + 0.5 * r);
    u.jitter.value.set(Math.sin(s.time * 71) * 0.012 * rr + Math.sin(s.time * 113) * 0.006 * rr, Math.cos(s.time * 89) * 0.009 * rr);
    u.dv.value.set(Math.sin(s.time * 47) * 0.03 * rr + 0.015 * rr, Math.cos(s.time * 39) * 0.012 * rr);
    u.dvMix.value = Math.min(1, r * 1.3);
    u.samplesMix.value = this.quality > 1 ? 1 : 0;

    const damp = (s.dempseyActive ? 0.1 + 0.25 * I : 0) + (s.maxSpeed ? 0.05 : 0);
    this.damp = 0; // Historical rig silhouettes provide motion without smearing colored frames.
  }

  /** 씬 렌더 + 합성. EffectComposer 없이 직접 돌린다 */
  render() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const useAccum = this.damp > 0.02;

    // 1) 씬 → rtScene (톤매핑은 마지막 합성에서 한 번만 하므로 여기선 끈다)
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rtScene);
    r.render(this.scene, this.camera);

    let src = this.rtScene.texture;
    // 2) 잔상 누적 (필요할 때만)
    if (useAccum) {
      if (!this.accumValid) {
        // 첫 프레임: 이전 버퍼를 현재 씬으로 채워 번쩍임 방지
        this.accumMat.uniforms.damp.value = 0;
        this.accumValid = true;
      } else {
        this.accumMat.uniforms.damp.value = this.damp;
      }
      this.accumMat.uniforms.tScene.value = this.rtScene.texture;
      this.accumMat.uniforms.tPrev.value = this.rtA.texture;
      this.quad.material = this.accumMat;
      r.setRenderTarget(this.rtB);
      r.render(this.quadScene, this.quadCam);
      // 핑퐁
      const t = this.rtA; this.rtA = this.rtB; this.rtB = t;
      src = this.rtA.texture;
    } else {
      this.accumValid = false;
    }

    // 3) 최종 합성 → 화면 (톤매핑 + sRGB 포함)
    r.toneMapping = tm;
    this.compositeMat.uniforms.tDiffuse.value = src;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prevTarget);
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.dispose();
    this.accumMat.dispose(); this.compositeMat.dispose();
  }
}
