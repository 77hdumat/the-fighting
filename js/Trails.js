// Trails.js — 카메라를 향하는 리본 트레일 (펀치 궤적 / 머리 ∞ 궤적)
import * as THREE from 'three';

const VERT = /* glsl */`
attribute float alpha;
attribute float edge;
varying float vA;
varying float vEdge;
void main() {
  vA = alpha;
  vEdge = edge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 color;
uniform vec3 coreColor;
uniform float opacity;
varying float vA;
varying float vEdge;
void main() {
  float feather = pow(max(0.0,1.0-abs(vEdge)), .45);
  vec3 c = mix(color, coreColor, feather);
  gl_FragColor = vec4(c, vA * opacity * feather);
}`;

const _tan = new THREE.Vector3();
const _side = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class Ribbon {
  constructor(scene, { maxPoints = 18, width = 0.075, color = 0xc4eaff, coreColor = 0xffffff, opacity = 1, wind = true } = {}) {
    maxPoints = Math.min(28, maxPoints);
    this.maxPoints = maxPoints;
    this.width = Math.min(.10, width);
    this.rails = wind ? 3 : 1;
    this.points = [];
    for (let i = 0; i < maxPoints; i++) this.points.push(new THREE.Vector3());
    this.len = 0;
    this.strength = 0;
    this.targetStrength = 0;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPoints * 2 * 3 * this.rails);
    this.alpha = new Float32Array(maxPoints * 2 * this.rails);
    const edges=new Float32Array(maxPoints*2*this.rails);
    for(let i=0;i<edges.length;i++)edges[i]=i%2?1:-1;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('edge',new THREE.BufferAttribute(edges,1));
    const idx = [];
    for(let rail=0;rail<this.rails;rail++)for (let i = 0; i < maxPoints - 1; i++) {
      const a = (rail*maxPoints+i)*2, b = a+1, c = a+2, d = a+3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, coreColor: { value: new THREE.Color(coreColor) }, opacity: { value: opacity } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  push(p) {
    if(this.len&&this.points[0].distanceToSquared(p)>1.44)this.clear();
    // 최신 점을 앞으로 (배열 회전)
    const last = this.points.pop();
    last.copy(p);
    this.points.unshift(last);
    this.len = Math.min(this.maxPoints, this.len + 1);
  }

  clear() { this.len = 0; }
  setColor(hex) { const u = this.mat.uniforms.color.value; if (u.getHex() !== hex) u.set(hex); }

  update(dt, camera, active) {
    this.targetStrength = active ? 1 : 0;
    this.strength += (this.targetStrength - this.strength) * Math.min(1, dt * (active ? 30 : 28));
    if (this.strength < 0.02 || this.len < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    camera.getWorldDirection(_camDir);
    const n = this.len;
    for (let i = 0; i < this.maxPoints; i++) {
      const k = Math.min(i, n - 1);
      const p = this.points[k];
      const prev = this.points[Math.max(0, k - 1)];
      const next = this.points[Math.min(n - 1, k + 1)];
      _tan.subVectors(next, prev);
      if (_tan.lengthSq() < 1e-8) _tan.set(0, 1, 0);
      _side.crossVectors(_tan, _camDir).normalize();
      const f = 1 - k / (n - 1);
      for(let rail=0;rail<this.rails;rail++){
        const outer=rail>0, offset=outer?(rail===1?-1:1)*(.07+.085*Math.sin(f*Math.PI)):0;
        const w=this.width*(outer?.30:1)*Math.sin(Math.PI*(.05+.9*f));
        const o=(rail*this.maxPoints+i)*6;
        this.pos[o]=p.x+_side.x*(offset-w);this.pos[o+1]=p.y+_side.y*(offset-w);this.pos[o+2]=p.z+_side.z*(offset-w);
        this.pos[o+3]=p.x+_side.x*(offset+w);this.pos[o+4]=p.y+_side.y*(offset+w);this.pos[o+5]=p.z+_side.z*(offset+w);
        const a=(outer?.48:.80)*Math.pow(f,1.2)*this.strength*(i<n?1:0),v=(rail*this.maxPoints+i)*2;
        this.alpha[v]=this.alpha[v+1]=a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}
