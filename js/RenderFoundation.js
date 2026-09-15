import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PHOTOREAL, PRESETS, initialPreset, ResolutionGovernor, FramePacer } from './RenderSettings.js';
import { createPhotorealPostFX } from './PhotorealPostFX.js';

export class RenderFoundation {
  constructor(game) {
    this.game = game; this.scale = 1; this.frames = []; this.recording = false;
    this.state = PHOTOREAL ? 'loading' : 'ready'; this.failure = null;
    this.pacer = new FramePacer(); this.lastPresentation = null;
    this.mobile = navigator.maxTouchPoints > 1;
    this.governor = new ResolutionGovernor((scale) => {
      this.scale = scale; game.renderer.setPixelRatio(scale); game.onResize();
    }, { allow30fps: this.mobile, onFrameRate: (fps) => this.pacer.setTarget(fps) });
    this.name = initialPreset();
    try { const saved = localStorage.getItem('dr-photo-quality'); if (saved in PRESETS) this.name = saved; } catch (_) {}
    this.shadows = [];
    this.makeUI();
    game.renderer.info.autoReset = false;
    document.addEventListener('visibilitychange', () => {
      this.governor.reset(); this.lastPresentation = null;
    });
  }
  async init() {
    if (!PHOTOREAL) return;
    const game = this.game;
    // Prepare every resource before replacing the working post pipeline.
    let hdr, environment, shadowTexture, post;
    const original = {
      autoClear: game.renderer.autoClear, toneMapping: game.renderer.toneMapping,
      exposure: game.renderer.toneMappingExposure, environment: game.scene.environment,
      environmentIntensity: game.scene.environmentIntensity,
      post: game.post, pixelRatio: game.renderer.getPixelRatio(), colorSpace: game.renderer.outputColorSpace,
      quality: game.quality, fxQuality: game.fx.quality,
    };
    try {
      const loaded = await Promise.allSettled([
        new RGBELoader().loadAsync('assets/rendering/arena-original.hdr'),
        fetch('assets/rendering/contact-shadow.rgba').then(async (response) => {
          if (!response.ok) throw new Error(`Contact shadow: HTTP ${response.status}`);
          const data = new Uint8Array(await response.arrayBuffer());
          if (data.length !== 64 * 64 * 4) throw new Error('Invalid contact shadow data');
          return data;
        }),
      ]);
      if (loaded[0].status === 'fulfilled') hdr = loaded[0].value;
      const failure = loaded.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
      const data = loaded[1].value;
      const pmrem = new THREE.PMREMGenerator(game.renderer);
      try {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        environment = pmrem.fromEquirectangular(hdr);
      } finally { pmrem.dispose(); hdr.dispose(); hdr = null; }
      shadowTexture = new THREE.DataTexture(data, 64, 64);
      shadowTexture.needsUpdate = true;
      shadowTexture.magFilter = shadowTexture.minFilter = THREE.LinearFilter;
      post = await createPhotorealPostFX(game.renderer, game.scene, game.camera);
      // Composer construction changes autoClear; keep the old pipeline usable while awaiting compile.
      game.renderer.autoClear = original.autoClear;
      post.setPreset(this.name);
      post.setBloomObjects(game.ring.bloomObjects || []);
      post.setSize(innerWidth, innerHeight);
      game.scene.environment = environment.texture;
      game.scene.environmentIntensity = .65;
      // Warm the scene's current material programs before its first HDR presentation.
      if (game.renderer.compileAsync) await game.renderer.compileAsync(game.scene, game.camera);
      this.environment = environment; this.shadowTexture = shadowTexture;
      game.post = post;
      game.renderer.autoClear = false;
      game.renderer.outputColorSpace = THREE.SRGBColorSpace;
      game.renderer.toneMapping = THREE.AgXToneMapping;
      game.renderer.toneMappingExposure = 1;
      game.renderer.setPixelRatio(1);
      this.setPreset(this.name);
      this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
      for (let i = 0; i < 4; i++) {
        const mesh = new THREE.Mesh(this.shadowGeometry, new THREE.MeshBasicMaterial({
          map: this.shadowTexture, transparent: true, opacity: .38, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }));
        mesh.rotation.x = -Math.PI / 2; mesh.visible = false;
        game.scene.add(mesh); this.shadows.push(mesh);
      }
      this.ready = true;
      this.state = 'ready'; this.select.disabled = false; this.recordButton.disabled = false;
      this.status.textContent = 'WebGL · 검증용';
      original.post.dispose();
    } catch (error) {
      this.ready = false; game.post = original.post;
      for (const mesh of this.shadows) { game.scene.remove(mesh); mesh.material.dispose(); }
      this.shadows.length = 0; this.shadowGeometry?.dispose();
      hdr?.dispose(); environment?.dispose(); shadowTexture?.dispose(); post?.dispose();
      game.scene.environment = original.environment;
      game.scene.environmentIntensity = original.environmentIntensity;
      game.renderer.autoClear = original.autoClear;
      game.renderer.toneMapping = original.toneMapping;
      game.renderer.toneMappingExposure = original.exposure;
      game.renderer.outputColorSpace = original.colorSpace;
      game.renderer.setPixelRatio(original.pixelRatio);
      game.quality = original.quality; game.fx.quality = original.fxQuality;
      game.onResize();
      this.select.disabled = true; this.recordButton.disabled = true;
      this.state = 'failed'; this.failure = error.message || String(error);
      this.status.textContent = '초기화 실패: ' + this.failure;
      throw error;
    }
  }
  setPreset(name) {
    if (!(name in PRESETS)) return;
    this.name = name; this.select.value = name;
    const game = this.game, preset = PRESETS[name];
    game.quality = preset.fx; game.fx.quality = preset.fx;
    game.post.setPreset?.(name);
    game.renderer.shadowMap.enabled = true;
    game.scene.traverse((object) => {
      if (!object.isLight || !object.castShadow) return;
      if (object.shadow.mapSize.x !== preset.shadows) {
        object.shadow.map?.dispose(); object.shadow.map = null;
        object.shadow.mapSize.setScalar(preset.shadows);
        object.shadow.needsUpdate = true;
      }
    });
    for (const effect of Object.values(game.ghostFx)) effect.max = preset.fx === 2 ? effect.ghosts.length : Math.max(3, Math.floor(effect.ghosts.length / 2));
    this.governor.reset(); game.onResize();
    try { localStorage.setItem('dr-photo-quality', name); } catch (_) {}
  }
  beforeFrame(ms, now) {
    this.frameMs = ms;
    this.now = now; this.presented = false;
    const game = this.game;
    game.renderer.info.reset();
    if (!this.ready) return;
    this.governor.sample(ms, !document.hidden);
    if (this.map !== game.ring) {
      this.map = game.ring; this.setPreset(this.name);
      game.post.setBloomObjects(game.ring.bloomObjects || []);
    }
    const target = game.localFighter?.rig.root.position;
    game.post.setCut(game.started && (game.phase === 'intro' || game.finisherWindT > 0), target ? game.camera.position.distanceTo(target) : 5);
    for (let i = 0; i < this.shadows.length; i++) {
      const fighter = game.fighters[i], shadow = this.shadows[i];
      shadow.visible = !!fighter && game.mapKind === 'ring' && fighter.rig.root.visible && !fighter.benched && !fighter.falling && !(fighter.fallY > .01);
      if (!shadow.visible) continue;
      const height = Math.max(0, fighter.airY || 0);
      shadow.position.set(fighter.pos.x, .008, fighter.pos.z);
      shadow.scale.set(.7 + height * .2, .48 + height * .15, 1);
      shadow.material.opacity = .38 / (1 + height * 3);
    }
  }
  render() {
    if (this.ready && !this.pacer.shouldRender(this.now)) return;
    this.game.post.render(); this.presented = true;
  }
  afterFrame() {
    const info = this.game.renderer.info.render;
    if (!this.presented) return;
    const displayMs = this.lastPresentation === null ? null : this.now - this.lastPresentation;
    this.lastPresentation = this.now;
    if (this.recording && !document.hidden && displayMs > 0 && displayMs <= 250) {
      this.frames.push({ ms: displayMs, rafMs: this.frameMs, targetFps: this.pacer.targetFps, calls: info.calls, triangles: info.triangles,
        scale: this.game.renderer.getPixelRatio(), preset: PHOTOREAL ? this.name : this.game.quality,
        viewport: [innerWidth, innerHeight], map: this.game.mapKind, phase: this.game.phase });
      if (this.frames.length >= 3600) { this.recording = false; this.recordButton.textContent = '측정 시작'; }
    }
    if (this.state === 'ready' && ++this.uiFrames % 30 === 0) this.status.textContent = `WebGL · ${this.pacer.targetFps}fps 목표 · ${this.game.renderer.getPixelRatio().toFixed(2)}× · ${info.calls} draws${this.recording ? ' · REC' : ''}`;
  }
  makeUI() {
    this.uiFrames = 0;
    const panel = document.createElement('details'); panel.id = 'render-settings';
    panel.innerHTML = '<summary>그래픽 · 측정</summary><label>화질 <select aria-label="렌더링 화질"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label><output></output><button type="button" data-record>측정 시작</button><button type="button" data-export>측정 JSON 저장</button>';
    document.body.appendChild(panel);
    panel.addEventListener('keydown', (event) => event.stopPropagation());
    this.select = panel.querySelector('select'); this.status = panel.querySelector('output');
    this.select.value = this.name; this.select.disabled = true;
    this.status.textContent = PHOTOREAL ? '렌더링 준비 중…' : '기존 렌더링 · 측정 준비됨';
    this.select.addEventListener('change', () => this.setPreset(this.select.value));
    this.recordButton = panel.querySelector('[data-record]');
    this.recordButton.disabled = PHOTOREAL;
    this.recordButton.addEventListener('click', (event) => {
      this.recording = !this.recording;
      if (this.recording) { this.frames = []; this.lastPresentation = null; this.captureStarted = new Date().toISOString(); }
      event.target.textContent = this.recording ? '측정 중지' : '측정 시작';
    });
    panel.querySelector('[data-export]').addEventListener('click', () => this.exportCapture());
    if (PHOTOREAL && this.mobile) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '60fps 다시 시도';
      retry.addEventListener('click', () => this.governor.retry60fps()); panel.appendChild(retry);
    }
  }
  exportCapture() {
    const frames = this.frames, times = frames.map((frame) => frame.ms).sort((a, b) => a - b);
    const mean = times.reduce((sum, ms) => sum + ms, 0) / (times.length || 1);
    const report = { mode: PHOTOREAL ? 'photoreal-experimental' : 'baseline', backend: 'WebGL', started: this.captureStarted,
      viewport: [innerWidth, innerHeight], devicePixelRatio, userAgent: navigator.userAgent,
      state: this.state, error: this.failure, targetFps: this.pacer.targetFps,
      timing: 'Presentation intervals with separate rAF timings; not GPU timings or a Chrome DevTools trace; suspended frames excluded',
      samples: times.length, fps: mean ? 1000 / mean : null, meanMs: mean,
      p95Ms: times.length ? times[Math.ceil(times.length * .95) - 1] : null,
      stddevMs: Math.sqrt(times.reduce((sum, ms) => sum + (ms - mean) ** 2, 0) / (times.length || 1)),
      maxDrawCalls: frames.reduce((max, frame) => Math.max(max, frame.calls), 0), frames };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `dempsey-${report.mode}-performance.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
