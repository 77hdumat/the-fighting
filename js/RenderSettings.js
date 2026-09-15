// The measured-performance gate keeps the existing renderer as the release default.
export const PHOTOREAL = new URLSearchParams(globalThis.location?.search || '').get('photoreal') === '1';
export const PRESETS = Object.freeze({
  low: { shadows: 1024, ao: 'Low', bloom: false, dof: false, fx: 0 },
  medium: { shadows: 1024, ao: 'Medium', bloom: true, dof: false, fx: 1 },
  high: { shadows: 2048, ao: 'High', bloom: true, dof: true, fx: 2 },
  ultra: { shadows: 2048, ao: 'Ultra', bloom: true, dof: true, fx: 2 },
});

export function initialPreset(device = globalThis.navigator || {}) {
  if (device.maxTouchPoints > 1 || (device.deviceMemory && device.deviceMemory <= 4)) return 'low';
  return device.hardwareConcurrency >= 8 ? 'high' : 'medium';
}

// Frame intervals are not clamped simulation dt. Windows exclude tab suspension.
export class ResolutionGovernor {
  constructor(onChange, { allow30fps = false, onFrameRate = () => {} } = {}) {
    this.onChange = onChange;
    this.allow30fps = allow30fps; this.onFrameRate = onFrameRate; this.targetFps = 60;
    this.steps = [1, .85, .7, .6];
    this.index = 0;
    this.reset();
  }
  reset() { this.elapsed = 0; this.frames = 0; this.cooldown = 4; this.good = 0; this.floorOverload = 0; }
  retry60fps() { this.targetFps = 60; this.reset(); this.onFrameRate(60); }
  sample(ms, visible = true) {
    if (!visible || !Number.isFinite(ms) || ms <= 0 || ms > 250) { this.reset(); return; }
    // Intentional 30fps presentation must never be interpreted as overload/recovery.
    if (this.targetFps === 30) return;
    this.cooldown = Math.max(0, this.cooldown - ms / 1000);
    this.elapsed += ms; this.frames++;
    if (this.elapsed < 2000) return;
    const avg = this.elapsed / this.frames;
    this.elapsed = 0; this.frames = 0;
    if (this.cooldown > 0) return;
    if (avg <= 22) this.floorOverload = 0;
    if (avg > 18.5 && this.index < this.steps.length - 1) {
      this.index++; this.good = 0; this.cooldown = 4;
      this.onChange(this.steps[this.index]);
    } else if (avg < 17.2 && this.index > 0) {
      // Sustained 60 Hz for 12 s permits one trial up; a failed trial drops again.
      if (++this.good >= 6) { this.index--; this.good = 0; this.cooldown = 8; this.onChange(this.steps[this.index]); }
    } else {
      this.good = 0;
      if (this.allow30fps && this.index === this.steps.length - 1 && avg > 22) {
        if (++this.floorOverload >= 4) { this.targetFps = 30; this.onFrameRate(30); }
      } else this.floorOverload = 0;
    }
  }
}

// Presentation-only cap. Simulation, input, audio and networking still run each rAF.
export class FramePacer {
  constructor() { this.targetFps = 60; this.previous = null; }
  setTarget(fps) { this.targetFps = fps === 30 ? 30 : 60; this.previous = null; }
  shouldRender(now) {
    if (!Number.isFinite(now)) return false;
    if (this.targetFps === 60) { this.previous = now; return true; }
    if (this.previous === null || now < this.previous || now - this.previous > 250) {
      this.previous = now; return true;
    }
    const interval = 1000 / this.targetFps, elapsed = now - this.previous;
    if (elapsed + .2 < interval) return false;
    this.previous += Math.max(1, Math.floor((elapsed + .2) / interval)) * interval;
    return true;
  }
}
