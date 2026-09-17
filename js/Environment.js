// Shared authored surface detail and batched arena architecture. No extra shadow lights.
import * as THREE from 'three';

export function surfaceTexture(kind = 'fabric', seed = 31) {
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  g.fillStyle=kind==='rock'?'#988676':kind==='concrete'?'#60656c':'#aaa69e';g.fillRect(0,0,512,512);
  if(kind==='fabric'){
    for(let i=0;i<512;i+=4){g.fillStyle=i%8?'#aca89e':'#827f78';g.fillRect(i,0,1,512);g.fillRect(0,i,512,1);}
  } else {
    for(let i=0;i<6500;i++) {const v=70+Math.floor(rand()*100);g.fillStyle=`rgba(${v},${v},${v},.12)`;g.fillRect(rand()*512,rand()*512,1+rand()*5,1+rand()*3);}
    if(kind==='rock'){
      for(let i=0;i<28;i++) {const y=i*19;g.strokeStyle=i%3?'rgba(65,47,36,.3)':'rgba(218,196,162,.5)';g.lineWidth=2+rand()*5;g.beginPath();g.moveTo(0,y);for(let x=0;x<=512;x+=16)g.lineTo(x,y+Math.sin(x*.028+i)*5);g.stroke();}
    }
  }
  const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=4;
  return tex;
}

function batch(group, geometry, material, transforms, name) {
  const mesh=new THREE.InstancedMesh(geometry,material,transforms.length),dummy=new THREE.Object3D();
  transforms.forEach((t,i)=>{dummy.position.set(...t.p);dummy.rotation.set(0,t.yaw||0,0);dummy.scale.set(...(t.s||[1,1,1]));dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(t.color)mesh.setColorAt(i,new THREE.Color(t.color));});
  mesh.instanceMatrix.needsUpdate=true;mesh.name=name;group.add(mesh);return mesh;
}

function roundedSeatGeometry() {
  const shape=new THREE.Shape();shape.moveTo(-.42,-.42);shape.lineTo(.42,-.42);shape.lineTo(.42,.42);shape.lineTo(-.42,.42);shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.84,bevelEnabled:true,bevelThickness:.08,bevelSize:.08,bevelSegments:2,steps:1});geo.translate(0,0,-.42);return geo;
}

export function addArenaStructure(group) {
  const concrete=surfaceTexture('concrete');concrete.repeat.set(8,8);
  const concreteMat=new THREE.MeshStandardMaterial({color:0x4a505b,map:concrete,bumpMap:concrete,bumpScale:.024,roughness:.96});
  const steel=new THREE.MeshStandardMaterial({color:0x555e6c,metalness:.75,roughness:.46});
  const stands=[],seats=[],backs=[],steps=[],tables=[];
  for(let side=0;side<4;side++){
    const yaw=side*Math.PI/2,c=Math.cos(yaw),s=Math.sin(yaw);
    const point=(x,y,z)=>[x*c+z*s,y,-x*s+z*c];
    for(let row=0;row<7;row++){
      const z=-10.2-row*1.12,y=-.7+row*.48;
      stands.push({p:point(0,y-.22,z),s:[29,.44,1.14],yaw});
      for(let col=0;col<24;col++){
        const x=-13.2+col*1.12;if(Math.abs(x)<1.3||Math.abs(x)>11.8-row*.22)continue;
        const color=row%3===0?0x69292f:0x203b54;
        seats.push({p:point(x,y+.10,z),s:[.72,.16,.65],yaw,color});
        backs.push({p:point(x,y+.43,z-.3),s:[.72,.65,.12],yaw,color});
      }
      steps.push({p:point(0,y-.11,z),s:[1.7,.20,1.12],yaw});
    }
    tables.push({p:point(0,-.20,-7.1),s:[3.1,.12,.8],yaw});
  }
  batch(group,new THREE.BoxGeometry(1,1,1),concreteMat,stands,'arena-terraces');
  const seatMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7});
  const seatGeo=roundedSeatGeometry();
  batch(group,seatGeo,seatMat,seats,'arena-seat-cushions');
  batch(group,seatGeo,seatMat,backs,'arena-seat-backs');
  batch(group,new THREE.BoxGeometry(1,1,1),steel,steps,'arena-aisle-steps');
  batch(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x292c33,roughness:.8}),tables,'ringside-desks');
  const shell=[];
  for(let i=0;i<4;i++){const a=i*Math.PI/2;shell.push({p:[Math.sin(a)*21,4,Math.cos(a)*21],s:[42,10,.4],yaw:a});}
  shell.push({p:[0,9.1,0],s:[42,.2,42]});
  batch(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x151c28,roughness:.92}),shell,'arena-shell');

  // Real cylindrical truss members, combined into one instanced draw.
  const links=[];const span=6.3,y=7.2;
  for(let side=0;side<4;side++){
    const a=side*Math.PI/2,c=Math.cos(a),s=Math.sin(a),p=(x,h,z)=>new THREE.Vector3(x*c+z*s,h,-x*s+z*c);
    for(const h of [y,y+.5])links.push([p(-span,h,-span),p(span,h,-span)]);
    for(let x=-span;x<span;x+=1.26){links.push([p(x,y,-span),p(x+1.26,y+.5,-span)]);links.push([p(x,y+.5,-span),p(x+1.26,y,-span)]);}
    links.push([p(-span,y+.5,-span),p(-span,9,-span)]);
  }
  const beams=new THREE.InstancedMesh(new THREE.CylinderGeometry(.035,.035,1,6),steel,links.length),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  links.forEach(([a,b],i)=>{dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,b.clone().sub(a).normalize());dummy.scale.set(1,a.distanceTo(b),1);dummy.updateMatrix();beams.setMatrixAt(i,dummy.matrix);});
  beams.name='overhead-truss';group.add(beams);
  const fixtures=[];
  for(let i=0;i<8;i++){const a=i*Math.PI/4;fixtures.push({p:[Math.cos(a)*5.5,7.1,Math.sin(a)*5.5],s:[1.4,.10,.45],yaw:-a});}
  const lamps=batch(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xfff4de,emissive:0xffe1bb,emissiveIntensity:3,roughness:.4}),fixtures,'arena-light-fixtures');

  const c=document.createElement('canvas');c.width=1024;c.height=128;const g=c.getContext('2d');
  g.fillStyle='#142337';g.fillRect(0,0,1024,128);g.fillStyle='#af3436';g.fillRect(0,110,1024,10);
  g.fillStyle='#d5d8dc';g.font='italic 900 60px Impact, sans-serif';g.textAlign='center';g.fillText('D E M P S E Y  /  B O X I N G',512,82);
  const bannerTex=new THREE.CanvasTexture(c);bannerTex.colorSpace=THREE.SRGBColorSpace;
  const bannerMat=new THREE.MeshBasicMaterial({map:bannerTex});
  for(let i=0;i<4;i++){const a=i*Math.PI/2,banner=new THREE.Mesh(new THREE.PlaneGeometry(15,1.7),bannerMat);banner.position.set(Math.sin(a)*20.7,5.2,Math.cos(a)*20.7);banner.rotation.y=a+Math.PI;group.add(banner);}
  return {bloomObjects:[lamps]};
}

export function disposeEnvironment(group) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const key of ['map','bumpMap','roughnessMap','normalMap'])if(m[key])textures.add(m[key]);}});
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
}
