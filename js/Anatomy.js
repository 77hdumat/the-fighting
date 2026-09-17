// Continuous anatomical surfaces. Profiles interpolate smoothly instead of stacking primitives.
import * as THREE from 'three';
const bell = (x,c,w) => Math.exp(-(((x-c)/w)**2));
export function loft(profile, rings=40, sides=32, shape=null) {
  const points=[], uv=[], indices=[];
  for(let i=0;i<=rings;i++){
    const t=i/rings, q=t*(profile.length-1), k=Math.min(profile.length-2,Math.floor(q));
    const a=profile[k],b=profile[k+1],f=q-k,s=f*f*(3-2*f);
    const y=a[0]+(b[0]-a[0])*f,rx=a[1]+(b[1]-a[1])*s,rz=a[2]+(b[2]-a[2])*s;
    for(let j=0;j<=sides;j++){
      const angle=j/sides*Math.PI*2;let x=Math.sin(angle)*rx,z=Math.cos(angle)*rz;
      if(shape){const p=shape(x,y,z,t,angle);x=p[0];z=p[1];}
      points.push(x,y,z);uv.push(j/sides,t);
      if(i<rings&&j<sides){const n=i*(sides+1)+j;if(profile[0][0] < profile.at(-1)[0]) indices.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1); else indices.push(n,n+sides+1,n+1,n+1,n+sides+1,n+sides+2);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
export function torsoGeometry(P,def){
  const w=P.torsoW,d=P.torsoD,m=def.bodyColor?0:P.muscle;
  return loft([[.015,.12*w,.095*d],[.08,.165*w,.12*d],[.20,.17*w,.125*d],[.32,.215*w,.145*d],[.43,.247*w,.142*d],[.50,.232*w,.12*d],[.55,.16*w,.085*d],[.59,.066*w,.060*d]],48,40,(x,y,z,t,a)=>{
    const front=Math.max(0,Math.cos(a))**3;
    const pec=(bell(x,.105*w,.08*w)+bell(x,-.105*w,.08*w))*bell(y,.415,.062)*.023;
    let abs=0;for(const row of [.14,.22,.29])abs+=(bell(x,.052*w,.044*w)+bell(x,-.052*w,.044*w))*bell(y,row,.040)*.006;
    const clavicle=bell(y,.50,.018)*bell(Math.abs(x),.13*w,.09*w)*.007;
    const belly=def.belly?bell(y,.20,.15)*.072:0;
    return [x,z+front*(m*(pec+abs+clavicle)+belly)];
  });
}
export function sculptHead(g,P,def={}){
  const p=g.attributes.position,R=.17*P.headS;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),v=y/R;
    const jaw=1-(def.gender === 'f' ? .29 : P.headY > 1.1 ? .28 : .21)*THREE.MathUtils.smoothstep(-v,.1,.95);
    const front=Math.max(0,z/R);
    const bridge=bell(x,0,.020*P.headS)*bell(v,-.12,.22)*.017*P.headS;
    const socket=(bell(x,.061*P.headS,.028*P.headS)+bell(x,-.061*P.headS,.028*P.headS))*bell(v,.16,.13)*.007*P.headS;
    p.setXYZ(i,x*jaw,y,z*.91+front*(bell(v,-.10,.45)*.010*P.headS+bridge-socket));
  }
  g.computeVertexNormals();return g;
}
export function hairLock(radius,length,sweep=.045){
  return loft([[-length*.5,radius*.70,radius*.50],[-length*.25,radius,radius*.58],[length*.10,radius*.82,radius*.42],[length*.32,radius*.42,radius*.24],[length*.5,.001,.001]],18,12,(x,y,z,t)=>[x+sweep*t*t,z-.025*t*t]);
}
export function limbGeometry(length,radius,leg=false,simple=false){
  const l=length,r=radius;
  const profile=leg?[[.025,.01,.01],[0,r*.9,r*.86],[-l*.25,r*1.12,r],[-l*.65,r*.87,r*.85],[-l,r*.70,r*.72],[-l*1.28,r*.83,r*.90],[-l*1.60,r*.66,r*.70],[-l*1.95,r*.42,r*.45],[-l*2.02,.01,.01]]:
    [[.068,.012,.012],[.025,r*1.13,r*.96],[-l*.15,r*1.19,r*1.04],[-l*.45,r*.96,r*1.02],[-l*.80,r*.68,r*.77],[-l,r*.62,r*.65],[-l*1.22,r*.89,r*.82],[-l*1.56,r*.70,r*.67],[-l*1.90,r*.46,r*.48],[-l*2.02,.006,.006]];
  const g=loft(profile,simple?28:48,simple?16:24);const ids=[],weights=[];
  for(let i=0;i<g.attributes.position.count;i++){
    const u=-g.attributes.position.getY(i)/l;
    // A third bone follows the joint bisector; its ring retains elbow/knee volume in a deep guard.
    const h=THREE.MathUtils.smoothstep(u,.76,1.0),k=THREE.MathUtils.smoothstep(u,1.0,1.24);
    ids.push(0,1,2,0);weights.push(1-h,h*(1-k),k,0);
  }
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));return g;
}
function skinInk() {
  const ink = new THREE.MeshBasicMaterial({color:0x30201b,side:THREE.BackSide});
  ink.userData.thickness = {value:.0035};
  ink.onBeforeCompile = shader => {
    shader.uniforms.inkThickness = ink.userData.thickness;
    shader.vertexShader = 'uniform float inkThickness;\n' + shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed += normal * inkThickness;');
  };
  ink.customProgramCacheKey = () => 'anatomy-silhouette-v1';
  return ink;
}
export function attachLimb(parent,joint,geometry,material,outlineMaterial){
  const upper=new THREE.Bone(),middle=new THREE.Bone(),lower=new THREE.Bone();
  parent.add(upper,middle);joint.add(lower);middle.position.copy(joint.position);
  const skeleton=new THREE.Skeleton([upper,middle,lower]);
  const mesh=new THREE.SkinnedMesh(geometry,material);parent.add(mesh);parent.updateWorldMatrix(true,true);mesh.bind(skeleton);mesh.frustumCulled=false;mesh.castShadow=!material.transparent;mesh.receiveShadow=false;
  let ink = null;
  if(outlineMaterial){
    ink=skinInk();
    const shell=new THREE.SkinnedMesh(geometry,ink);parent.add(shell);shell.bind(skeleton,mesh.bindMatrix);shell.frustumCulled=false;
  }
  return {mesh,middle,joint,ink};
}
export function attachTorso(waist,chest,geometry,material,outline){
  const lower=new THREE.Bone(),upper=new THREE.Bone();waist.add(lower);chest.add(upper);
  const ids=[],weights=[];
  for(let i=0;i<geometry.attributes.position.count;i++){
    const w=THREE.MathUtils.smoothstep(geometry.attributes.position.getY(i),.25,.53);ids.push(0,1,0,0);weights.push(1-w,w,0,0);
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ids,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,material);waist.add(mesh);waist.updateWorldMatrix(true,true);const skeleton=new THREE.Skeleton([lower,upper]);mesh.bind(skeleton);mesh.frustumCulled=false;mesh.castShadow=!material.transparent;
  if(outline){const ink=skinInk();const shell=new THREE.SkinnedMesh(geometry,ink);waist.add(shell);shell.bind(skeleton,mesh.bindMatrix);shell.frustumCulled=false;mesh.userData.ink=ink;}
  return mesh;
}
