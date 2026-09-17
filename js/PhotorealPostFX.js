import * as THREE from 'three';
import { PRESETS } from './RenderSettings.js';

// Loaded only by the experimental mode; baseline does not request these libraries.
export async function createPhotorealPostFX(renderer, scene, camera) {
  const [P, A] = await Promise.all([import('postprocessing'), import('n8ao')]);
  return new PhotorealPostFX(renderer, scene, camera, P, A);
}

class PhotorealPostFX {
  constructor(renderer, scene, camera, P, A) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.P = P;
    this.delta = 0; this.hit = 0; this.cut = false;
    try {
      this.composer = new P.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: true });
      this.composer.addPass(new P.RenderPass(scene, camera));
      this.ao = new A.N8AOPostPass(scene, camera, innerWidth, innerHeight);
      this.ao.configuration.gammaCorrection = false;
      this.ao.configuration.aoRadius = .3;
      this.ao.configuration.intensity = 1.1;
      this.ao.configuration.halfRes = true;
      // Ghosts, sparks and flashes do not write depth. Re-rendering them into two
      // transparency targets costs extra scene/shadow passes and changes shaders mid-punch.
      this.ao.autoDetectTransparency = false;
      this.ao.configuration.transparencyAware = false;

      // Screen-space impact blur preserves hit feedback. This is not velocity motion blur.
      this.impact = new P.Effect('BoxingImpact', `
        uniform float strength;
        uniform vec2 center;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          // 이 패스는 항상 켜 둔다(아래 addPass 주석 참고). 타격이 없을 때는 원본을 그대로 통과시킨다.
          // uniform 분기라 워프가 갈라지지 않는다.
          if (strength < 0.0001) { outputColor = inputColor; return; }
          vec2 offset = (uv - center) * strength;
          vec3 color = inputColor.rgb * .4;
          color += texture2D(inputBuffer, uv - offset * .33).rgb * .3;
          color += texture2D(inputBuffer, uv - offset * .66).rgb * .2;
          color += texture2D(inputBuffer, uv - offset).rgb * .1;
          outputColor = vec4(color, inputColor.a);
        }`, {
          blendFunction: P.BlendFunction.NORMAL,
          // inputBuffer 를 현재 프래그먼트가 아닌 UV 에서 샘플링한다 (컨볼루션).
          // 이 속성이 없으면 컴포저가 이 이펙트를 다른 이펙트와 한 패스로 병합할 수 있다.
          attributes: P.EffectAttribute.CONVOLUTION,
          uniforms: new Map([
            ['strength', new THREE.Uniform(0)], ['center', new THREE.Uniform(new THREE.Vector2(.5, .5))],
          ]),
        });
      this.impactPass = new P.EffectPass(camera, this.impact);

      // ── 패스 순서·활성화 규칙 (바꾸지 말 것) ────────────────────────────────
      // postprocessing 의 EffectComposer 는 깊이 텍스처를 inputBuffer 에만 붙인다.
      // 스왑하는 패스는 출력 대상이 outputBuffer → inputBuffer → ... 로 번갈아 바뀌므로,
      // 깊이를 샘플링하는 패스가 스왑 순번 '짝수' 에 오면 깊이 텍스처를 가진 버퍼에
      // 쓰면서 동시에 읽게 되어 매 프레임 다음 경고가 뜨고 그 패스 출력이 미정의가 된다:
      //   GL_INVALID_OPERATION: Feedback loop formed between Framebuffer and active Texture
      //
      // 실측 결과 DOF 만 이 패리티에 민감하다 (AO·Bloom·SMAA 는 자체 타깃을 쓰므로 무관).
      // 그래서 두 가지를 고정한다:
      //   1) 충돌 블러를 AO 앞에 두고 '항상' 활성 상태로 유지한다 (강도 0 이면 셰이더가 통과).
      //      켰다 껐다 하면 뒤따르는 DOF 의 순번이 홀↔짝으로 흔들린다.
      //   2) DOF 를 Bloom '앞' 에 둔다 → DOF 는 항상 3번째 스왑(홀수)이 된다.
      // ────────────────────────────────────────────────────────────────────
      this.impactPass.enabled = true;
      this.composer.addPass(this.impactPass);
      this.composer.addPass(this.ao);
      this.dof = new P.DepthOfFieldEffect(camera, { focusDistance: .045, focalLength: .08, bokehScale: 1.2, resolutionScale: .5 });
      this.dofPass = new P.EffectPass(camera, this.dof);
      this.composer.addPass(this.dofPass);
      this.bloom = new P.SelectiveBloomEffect(scene, camera, { intensity: .22, luminanceThreshold: 1.1, mipmapBlur: true });
      this.bloom.ignoreBackground = true;
      this.bloomPass = new P.EffectPass(camera, this.bloom);
      this.composer.addPass(this.bloomPass);
      // Tone mapping occurs exactly once, after HDR effects and before display-space AA.
      this.composer.addPass(new P.EffectPass(camera, new P.ToneMappingEffect({ mode: P.ToneMappingMode.AGX })));
      this.smaa = new P.SMAAEffect({ preset: P.SMAAPreset.MEDIUM });
      this.composer.addPass(new P.EffectPass(camera, this.smaa));
      this.noise = new P.NoiseEffect({ blendFunction: P.BlendFunction.SOFT_LIGHT });
      this.noise.blendMode.opacity.value = .018;
      this.composer.addPass(new P.EffectPass(camera,
        new P.VignetteEffect({ darkness: .18, offset: .3 }), this.noise,
        new P.ChromaticAberrationEffect({ offset: new THREE.Vector2(.00015, .00015) })));
      this.setPreset('low');
    } catch (error) {
      this.composer?.dispose();
      throw error;
    }
  }
  setPreset(name) {
    this.preset = PRESETS[name];
    this.ao.setQualityMode(this.preset.ao);
    this.bloomPass.enabled = this.preset.bloom;
    this.dofPass.enabled = this.preset.dof && this.cut;
    this.smaa.applyPreset(this.P.SMAAPreset[name.toUpperCase()]);
  }
  setBloomObjects(objects) { this.bloom.selection.set(objects); }
  setCut(active, distance) {
    this.cut = active;
    this.dofPass.enabled = this.preset.dof && active;
    if (active) this.dof.cocMaterial.uniforms.focusDistance.value = THREE.MathUtils.clamp((distance - this.camera.near) / (this.camera.far - this.camera.near), 0, 1);
  }
  onHit(power, x, y) {
    this.hit = Math.min(.06, .025 * power);
    this.impact.uniforms.get('center').value.set(x, y);
  }
  update(dt, state) {
    this.delta = dt; this.hit *= Math.exp(-dt * 12);
    this.impact.uniforms.get('strength').value = this.hit + (state.maxSpeed ? .004 : 0);
    // 패스는 끄지 않는다 — 켜고 끄면 DOF 의 스왑 패리티가 흔들려 피드백 루프가 생긴다.
    // 강도가 0 이면 셰이더가 원본을 그대로 통과시킨다.
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render() {
    const mapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    try { this.composer.render(this.delta); } finally { this.renderer.toneMapping = mapping; }
  }
  dispose() { this.composer.dispose(); }
}
