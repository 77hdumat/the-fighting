// HitSparks.js — 타격 지점 3D 파티클 (땀방울/스파크). additive Points, 중력, 수명 페이드
import * as THREE from 'three';

const MAX = 400;
export class HitSparks {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; varying vec3 vC; varying float vA;
        void main() { vC = color; vA = min(1.0, size); vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 120.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0;
    this.tmp = new THREE.Vector3();
  }

  /**
   * @param pos   월드 위치
   * @param dir   튀는 주 방향 (타격 방향)
   * @param n     개수
   * @param color THREE.Color
   * @param speed 초기 속도 배율
   */
  burst(pos, dir, n = 20, color = new THREE.Color(1, 1, 1), speed = 1, size = 0.5) {
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % MAX;
      const o = i * 3;
      this.pos[o] = pos.x; this.pos[o + 1] = pos.y; this.pos[o + 2] = pos.z;
      // 타격 방향 + 반구 랜덤 산포
      const rx = (Math.random() - 0.5), ry = Math.random() * 0.9, rz = (Math.random() - 0.5);
      const sp = (1.2 + Math.random() * 2.2) * speed;
      this.vel[o] = (dir.x * 0.8 + rx * 1.4) * sp;
      this.vel[o + 1] = (0.6 + ry * 1.6) * sp;
      this.vel[o + 2] = (dir.z * 0.8 + rz * 1.4) * sp;
      const c = color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
      this.maxLife[i] = this.life[i] = 0.25 + Math.random() * 0.35;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.8 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.01) { this.pos[o + 1] = 0.01; this.vel[o + 1] *= -0.3; this.vel[o] *= 0.7; this.vel[o + 2] *= 0.7; }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = Math.min(this.size[i], 1) * (0.3 + 0.7 * k) + (k < 1 ? 0 : 0);
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}
