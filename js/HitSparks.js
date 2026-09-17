// HitSparks.js — 타격 지점 3D 파티클 (땀방울/스파크). additive Points, 중력, 수명 페이드
import * as THREE from 'three';

const MAX = 160;
export class HitSparks {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.baseSize = new Float32Array(MAX);
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
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // Shared generated alpha sprite, six pooled flashes, tested against opaque world depth.
    const impactTexture = new THREE.TextureLoader().load('assets/effects/boxing-impact-v2.png');
    impactTexture.colorSpace = THREE.SRGBColorSpace;
    this.flashes = Array.from({length:6},()=>{
      const material = new THREE.SpriteMaterial({map:impactTexture,color:0xffffff,transparent:true,opacity:0,depthTest:true,depthWrite:false,toneMapped:false});
      const sprite = new THREE.Sprite(material);sprite.visible=false;sprite.renderOrder=30;scene.add(sprite);return {sprite,life:0};
    });
    this.flashHead=0;
    const streakGeo=new THREE.BufferGeometry();this.streakPositions=new Float32Array(MAX*6);this.streakAlpha=new Float32Array(MAX*2);
    streakGeo.setAttribute('position',new THREE.BufferAttribute(this.streakPositions,3));streakGeo.setAttribute('alpha',new THREE.BufferAttribute(this.streakAlpha,1));
    this.streaks=new THREE.LineSegments(streakGeo,new THREE.ShaderMaterial({vertexShader:'attribute float alpha; varying float a; void main(){a=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying float a;void main(){gl_FragColor=vec4(1.,1.,1.,a);}',transparent:true,depthWrite:false,depthTest:true}));
    this.streaks.frustumCulled=false;scene.add(this.streaks);
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
    if(n>=6){const f=this.flashes[this.flashHead++%this.flashes.length];f.life=.10;f.sprite.visible=true;f.sprite.position.copy(pos).addScaledVector(dir,.025);f.sprite.scale.set(.20+Math.min(size,.6)*.15,.10+Math.min(size,.6)*.08,1);f.sprite.material.opacity=.70;}
    n=Math.min(14,n);
    const colors = null;   // 배열이면 입자마다 랜덤 색 (만화 색종이 스파크)
    for (let k = 0; k < n; k++) {
      if (colors) color = colors[Math.floor(Math.random() * colors.length)];
      const i = this.head; this.head = (this.head + 1) % MAX;
      const o = i * 3;
      this.pos[o] = pos.x; this.pos[o + 1] = pos.y; this.pos[o + 2] = pos.z;
      // 타격 방향 + 반구 랜덤 산포
      const rx = (Math.random() - 0.5), ry = Math.random() * 0.9, rz = (Math.random() - 0.5);
      const sp = (1.2 + Math.random() * 2.2) * speed;
      this.vel[o] = (dir.x * 0.8 + rx * 1.4) * sp;
      this.vel[o + 1] = (0.6 + ry * 1.6) * sp;
      this.vel[o + 2] = (dir.z * 0.8 + rz * 1.4) * sp;
      const c = new THREE.Color(0xffffff);
      this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
      this.maxLife[i] = this.life[i] = 0.08 + Math.random() * 0.10;
      this.baseSize[i] = this.size[i] = Math.min(.16, size*.3) * (.6 + Math.random()*.4);
    }
  }

  update(dt) {
    for(const f of this.flashes){f.life=Math.max(0,f.life-dt);f.sprite.visible=f.life>0;f.sprite.material.opacity=.70*(f.life/.10)**2;}
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.streakAlpha[i*2]=this.streakAlpha[i*2+1]=0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.8 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.01) { this.pos[o + 1] = 0.01; this.vel[o + 1] *= -0.3; this.vel[o] *= 0.7; this.vel[o + 2] *= 0.7; }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = this.baseSize[i] * k;
      for(let axis=0;axis<3;axis++){this.streakPositions[i*6+axis]=this.pos[o+axis];this.streakPositions[i*6+3+axis]=this.pos[o+axis]-this.vel[o+axis]*.025*k;}
      this.streakAlpha[i*2]=k*.40;this.streakAlpha[i*2+1]=0;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.streaks.geometry.attributes.position.needsUpdate=true;this.streaks.geometry.attributes.alpha.needsUpdate=true;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}
