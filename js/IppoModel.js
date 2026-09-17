// IPPO reference anatomy, adapted to each character. Welded eight-bone neck, torso and arms.
import * as THREE from 'three';
const bell=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
const smooth=(x,a,b)=>THREE.MathUtils.smoothstep(x,a,b);
const blend=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const bodyCache=new Map();

export function ippoBodyGeometry(P,def={referenceIppo:true}) {
  const cacheKey=JSON.stringify([P,def.bodyColor,def.sleeves,def.skin,def.belly,def.referenceIppo]);
  if(bodyCache.has(cacheKey))return bodyCache.get(cacheKey);
  const w=P.torsoW,d=P.torsoD,arm=.32*P.armLen,r=.080*P.armR,ax=.27*w,sy=.516;
  const muscular=def.referenceIppo?1:(def.bodyColor?.12:1)*(P.muscle??0), neckR=def.referenceIppo?.071:.063*w, neckD=def.referenceIppo?.067:.061*d, neckTop=def.referenceIppo?.685:.52+.02+.07*P.neck+.178*P.headS-.17*P.headS*P.headY+.055;
  const torso=[[.012,.155*w,.113*d],[.12,.166*w,.125*d],[.25,.176*w,.133*d],[.33,.205*w,.145*d],[.43,.247*w,.151*d],[.50,.245*w,.132*d],[.55,.175*w,.098*d],[.59,.077*w,.067*d]];
  const arms=[[-.15,.05],[0,1.03],[.18,1.16],[.46,1.02],[.8,.70],[1,.63],[1.23,.90],[1.55,.72],[1.89,.49],[2.05,.07]];
  function profile(rows,t){let i=0;while(i<rows.length-2&&rows[i+1][0]<t)i++;const a=rows[i],b=rows[i+1],f=smooth(t,a[0],b[0]);return a.slice(1).map((v,j)=>v+(b[j+1]-v)*f);}
  function field(x,y,z){
    const [rx,rz]=profile(torso,y),front=smooth(z,-.01,.09);
    const pec=(bell(x,.118*w,.089*w)+bell(x,-.118*w,.089*w))*bell(y,.423,.062)*.045;
    const sternum=bell(x,0,.019)*bell(y,.42,.11)*.009;
    let abs=0;for(const row of [.166,.24,.305])abs+=(bell(x,.054*w,.045*w)+bell(x,-.054*w,.045*w))*bell(y,row,.036)*.013;
    const ribs=bell(Math.abs(x),.165*w,.045)*bell(y,.31,.105)*(.005+.004*Math.sin(y*99+Math.abs(x)*14));
    const clavicle=bell(y,.521,.017)*bell(Math.abs(x),.115*w,.085)*.010;
    let body=Math.max((Math.hypot(x/rx,(z-front*(muscular*(pec+abs+ribs+clavicle-sternum)+(def.belly?bell(y,.20,.15)*.072:0)))/rz)-1)*Math.min(rx,rz),.012-y,y-.59);
    const neck=Math.max((Math.hypot(x/neckR,(z-.015)/neckD)-1)*Math.min(neckR,neckD),.565-y,y-neckTop);
    body=blend(body,neck,.035);
    for(const sign of [-1,1]){
      const u=(sy-y)/arm,ar=profile(arms,u)[0]*r;
      const muscle=bell(u,.42,.25)*.009*(P.muscle??1)*smooth(z,-.015,.06);
      const limb=Math.max((Math.hypot((x-sign*ax)/ar,(z-muscle)/(ar*.92))-1)*ar,y-(sy+arm*.15),(sy-arm*2.05)-y);
      body=blend(body,limb,.035);
    }
    return body;
  }
  const extent=Math.max(.27*w+r*1.35+.045,.27*w+.035);
  const lo=def.referenceIppo?[-.46,-.18,-.23]:[-extent,sy-arm*2.05-.04,-.18*d-.04],hi=def.referenceIppo?[.46,.71,.28]:[extent,Math.max(.71,neckTop+.03),.18*d+(def.belly?.10:.05)],step=def.referenceIppo?.018:.024;
  const n=hi.map((v,i)=>Math.ceil((v-lo[i])/step)+1),[nx,ny,nz]=n,total=nx*ny*nz;
  const values=new Float32Array(total),positions=[],normals=[],colors=[],indices=[],ids=[],weights=[],uvs=[],skinSurface=[];
  const at=(x,y,z)=>x+nx*(y+ny*z),xyz=i=>{const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));return [lo[0]+x*step,lo[1]+y*step,lo[2]+z*step];};
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[at(x,y,z)]=field(lo[0]+x*step,lo[1]+y*step,lo[2]+z*step);
  const edgeCache=new Map();
  function gradient(i){const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));return [values[at(Math.min(nx-1,x+1),y,z)]-values[at(Math.max(0,x-1),y,z)],values[at(x,Math.min(ny-1,y+1),z)]-values[at(x,Math.max(0,y-1),z)],values[at(x,y,Math.min(nz-1,z+1))]-values[at(x,y,Math.max(0,z-1))]];}
  function vertex(a,b){
    const key=a<b?a+'_'+b:b+'_'+a;if(edgeCache.has(key))return edgeCache.get(key);
    const t=values[a]/(values[a]-values[b]),pa=xyz(a),pb=xyz(b),p=pa.map((v,i)=>v+(pb[i]-v)*t),ga=gradient(a),gb=gradient(b),normal=ga.map((v,i)=>v+(gb[i]-v)*t),nl=Math.hypot(...normal)||1;
    const index=positions.length/3;edgeCache.set(key,index);positions.push(...p);normals.push(...normal.map(v=>v/nl));
    const [x,y,z]=p,front=smooth(z,.01,.12);
    const pecEdge=bell(y,.359+.055*(Math.abs(x)/(.25*w))**2,.009)*bell(Math.abs(x),.12*w,.10*w);
    let folds=0;for(const row of [.133,.204,.274])folds+=(bell(x,.056*w,.034*w)+bell(x,-.056*w,.034*w))*bell(y,row+.009*(x/.12)**2,.007);
    const center=bell(x,0,.009)*bell(y,.255,.17),clavicle=bell(y,.497,.007)*bell(Math.abs(x),.12*w,.10*w);
    const serratus=bell(Math.abs(x),.172*w,.026)*bell(y,.31,.09)*Math.pow(Math.max(0,Math.sin(y*105+Math.abs(x)*22)),4);
    const shade=Math.min(.72,muscular*front*(pecEdge*.45+folds*.28+center*.16+clavicle*.22+serratus*.16));
    colors.push(1-shade*.24,1-shade*.52,1-shade*.69);uvs.push((x+.46)/.92,(y+.18)/.89);
    const u=(sy-y)/arm,ar=profile(arms,u)[0]*r,[rx,rz]=profile(torso,y);
    const torsoDistance=Math.max((Math.hypot(x/rx,z/rz)-1)*Math.min(rx,rz),.012-y,y-.59);
    const limbDistance=Math.max((Math.hypot((Math.abs(x)-ax)/ar,z/(ar*.92))-1)*ar,y-(sy+arm*.15),(sy-arm*2.05)-y);
    const armWeight=smooth(torsoDistance-limbDistance,-.045,.045);
    const neckMask=smooth(y,.548,.58)*(1-smooth(Math.abs(x),neckR,neckR*1.8)),armMask=smooth(armWeight,.32,.68),bareArm=!def.sleeves||def.sleeves===def.skin;
    skinSurface.push(def.bodyColor?Math.max(neckMask,bareArm?armMask:0):bareArm?1:1-armMask);
    const chest=smooth(y,.25,.53),h=smooth(u,.76,1),k=smooth(u,1,1.24),base=x>0?2:5;
    const boneWeights=[[0,(1-armWeight)*(1-chest)],[1,(1-armWeight)*chest],[base,armWeight*(1-h)],[base+1,armWeight*h*(1-k)],[base+2,armWeight*k]].filter(v=>v[1]>1e-6).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const sum=boneWeights.reduce((s,v)=>s+v[1],0);while(boneWeights.length<4)boneWeights.push([0,0]);ids.push(...boneWeights.map(v=>v[0]));weights.push(...boneWeights.map(v=>v[1]/sum));return index;
  }
  function triangle(a,b,c){const p=a*3,q=b*3,r=c*3,ab=[positions[q]-positions[p],positions[q+1]-positions[p+1],positions[q+2]-positions[p+2]],ac=[positions[r]-positions[p],positions[r+1]-positions[p+1],positions[r+2]-positions[p+2]],cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];if(cross[0]*normals[p]+cross[1]*normals[p+1]+cross[2]*normals[p+2]<0)indices.push(a,c,b);else indices.push(a,b,c);}
  const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],offsets=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    const cube=offsets.map(([dx,dy,dz])=>at(x+dx,y+dy,z+dz));if(cube.every(i=>values[i]>0)||cube.every(i=>values[i]<0))continue;
    for(const tet of tetra){const inside=[],outside=[];for(const v of tet)(values[cube[v]]<0?inside:outside).push(cube[v]);if(!inside.length||!outside.length)continue;
      if(inside.length===1){const p=outside.map(i=>vertex(inside[0],i));triangle(...p);}
      else if(inside.length===3){const p=inside.map(i=>vertex(outside[0],i));triangle(...p);}
      else {const a=vertex(inside[0],outside[0]),b=vertex(inside[0],outside[1]),c=vertex(inside[1],outside[0]),d=vertex(inside[1],outside[1]);triangle(a,b,c);triangle(b,d,c);}
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ids,4));geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));if(def.bodyColor||def.sleeves&&def.sleeves!==def.skin)geo.setAttribute('skinSurface',new THREE.Float32BufferAttribute(skinSurface,1));geo.setIndex(indices);geo.computeBoundingSphere();bodyCache.set(cacheKey,geo);return geo;
}

export function attachIppoBody(waist,torso,deformers,P,def={referenceIppo:true},neckMaterial=torso.material) {
  torso.visible=false;waist.children.filter(o=>o.isSkinnedMesh).forEach(o=>o.visible=false);
  const arms=deformers.slice(2);
  for(const d of arms)d.mesh.parent.children.filter(o=>o.isSkinnedMesh).forEach(o=>o.visible=false);
  const bones=[...torso.skeleton.bones,...arms[0].mesh.skeleton.bones,...arms[1].mesh.skeleton.bones],skeleton=new THREE.Skeleton(bones);
  const geometry=ippoBodyGeometry(P,def),material=torso.material.clone();material.onBeforeCompile=torso.material.onBeforeCompile;material.vertexColors=true;
  if(geometry.attributes.skinSurface){
    const compile=material.onBeforeCompile,skin=neckMaterial.userData.ramp;
    material.onBeforeCompile=shader=>{
      compile(shader);
      shader.uniforms.uSurfaceSkinLit={value:skin.lit};shader.uniforms.uSurfaceSkinMid={value:skin.mid};shader.uniforms.uSurfaceSkinShadow={value:skin.shadow};
      shader.vertexShader='attribute float skinSurface; varying float vSurfaceSkin;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSurfaceSkin=skinSurface;');
      shader.fragmentShader='varying float vSurfaceSkin; uniform vec3 uSurfaceSkinLit,uSurfaceSkinMid,uSurfaceSkinShadow;\n'+shader.fragmentShader;
      const main=shader.fragmentShader.indexOf('void main()'),header=shader.fragmentShader.slice(0,main);let body=shader.fragmentShader.slice(main);
      const aliases={uLitColor:'surfaceLit',uMidColor:'surfaceMid',uShadowColor:'surfaceShadow',uGrade:'surfaceGrade',uSpecGain:'surfaceSpec',uRim:'surfaceRim',uFormWeight:'surfaceForm'};
      for(const [original,replacement]of Object.entries(aliases))body=body.replace(new RegExp('\\b'+original+'\\b','g'),replacement);
      body=body.replace('vec3 nrm = normalize(vNormal);',`float surfaceMask=smoothstep(.25,.75,vSurfaceSkin);
        vec3 surfaceLit=mix(uLitColor,uSurfaceSkinLit,surfaceMask),surfaceMid=mix(uMidColor,uSurfaceSkinMid,surfaceMask),surfaceShadow=mix(uShadowColor,uSurfaceSkinShadow,surfaceMask);
        float surfaceGrade=mix(uGrade,.88,surfaceMask),surfaceSpec=mix(uSpecGain,.015,surfaceMask),surfaceRim=mix(uRim,.10,surfaceMask),surfaceForm=mix(uFormWeight,.94,surfaceMask);
        vec3 nrm = normalize(vNormal);`);
      shader.fragmentShader=header+body;
    };
    material.customProgramCacheKey=()=> 'reference-anatomy-continuous-clothing-v1';
  }
  const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=(def.name||'IPPO')+' welded anatomical upper body';waist.add(mesh);waist.updateWorldMatrix(true,true);mesh.bind(skeleton);mesh.frustumCulled=false;mesh.castShadow=true;
  const ink=torso.userData.ink;ink.userData.thickness.value=.0017;ink.color.set(def.bodyColor?0x302c2a:0x694e32);
  const outline=new THREE.SkinnedMesh(mesh.geometry,ink);waist.add(outline);outline.bind(skeleton,mesh.bindMatrix);outline.frustumCulled=false;mesh.userData.ink=ink;return mesh;
}

export function ippoHairGeometry(P,style='ippo-reference') {
  const pos=[],indices=[],s=P.headS;
  function blade(root,tip,width,depth,endRadius=.015){
    const a=new THREE.Vector3(...root),b=new THREE.Vector3(...tip),dir=b.clone().sub(a).normalize(),side=new THREE.Vector3(1,0,0);
    if(Math.abs(dir.dot(side))>.85)side.set(0,0,1);side.addScaledVector(dir,-side.dot(dir)).normalize();
    const thick=new THREE.Vector3().crossVectors(side,dir).normalize(),base=pos.length/3,cross=[[-1,0],[-.45,.65],[0,1],[.45,.65],[1,0],[0,-.45]];
    const ts=[0,.28,.67,1],radii=[.65,1,endRadius===.015?.55:.88,endRadius];
    for(let j=0;j<4;j++){
      const center=a.clone().lerp(b,ts[j]);center.addScaledVector(thick,Math.sin(ts[j]*Math.PI)*depth*.4);
      for(const [x,z]of cross){const p=center.clone().addScaledVector(side,x*width*radii[j]).addScaledVector(thick,z*depth*radii[j]);pos.push(p.x*s,p.y*s,p.z*s);}
      if(j<3)for(let k=0;k<6;k++){const u=base+j*6+k,v=base+j*6+(k+1)%6;indices.push(u,v,u+6,v,v+6,u+6);}
    }
  }
  if(style!=='ippo-reference'){
    const long=style==='long'||style==='longblack',bob=style==='bob'||style==='bobsharp'||style==='bowl';
    if(long||bob){
      // Overlapping curved locks grow from the crown, wrap the scalp, then fall.
      const count=24,length=long?(style==='long'?.48:.34):style==='bobsharp'?.23:style==='bowl'?.15:.20;
      for(let i=0;i<count;i++){
        const a=1.05+i/(count-1)*(Math.PI*2-2.10),x=Math.sin(a),z=Math.cos(a);
        blade([x*.14,.10,z*.13-.025],[x*(bob?.18:.177),.10-length+(style==='bobsharp'?0:Math.sin(i*1.7)*.015),z*.16-.027],.033,.023,bob?.66:.28);
      }
      for(let i=0;i<10;i++){
        const x=-.135+i*.03,slant=style==='longblack'?.035:style==='long'?.015:0;
        blade([x,.148,.078],[x+slant,.065+(style==='bobsharp'?0:Math.cos(i*1.7)*.012),.151],.023,.017,style==='bobsharp'?.7:.18);
      }
      if(style==='longblack')for(let i=0;i<9;i++){const a=i/9*Math.PI*2;blade([Math.sin(a)*.09,.14,Math.cos(a)*.08-.03],[Math.sin(a)*.145,.225+Math.sin(i)*.025,Math.cos(a)*.13-.04],.029,.021);}
    }else{
      const mane=style==='mane',slick=style==='slick',count=mane?24:22;
      for(let i=0;i<count;i++){
        const a=i/count*Math.PI*2,x=Math.sin(a),z=Math.cos(a),rear=Math.max(0,-z);
        blade([x*.10,.12+Math.sin(i)*.014,z*.09-.025],[x*(mane?.19:slick?.145:.17),slick?.14+.03*rear:.23+Math.sin(i*1.8)*.028,z*(slick?.14:.16)-(mane?.09:slick?.11:.035)],.034,.025);
      }
      for(let i=0;i<7;i++){const x=-.11+i*.036;blade([x,.14,.089],[x+(mane?x*.25:.015),mane?.065:slick?.12:.073,slick?.07:.15],.025,.016);}
    }
  }else{
  for(let i=0;i<14;i++){
    const a=i/14*Math.PI*2,rr=.065+(i%3)*.018;
    blade([Math.sin(a)*rr,.135+Math.sin(i*1.3)*.012,Math.cos(a)*rr-.025],[Math.sin(a)*(.11+(i%3)*.018),.235+Math.sin(i*2.1)*.037,Math.cos(a)*.12-.045],.033,.024);
  }
  for(let i=0;i<20;i++){
    const a=i/20*Math.PI*2;
    blade([Math.sin(a)*.137,.065+(i%3)*.018,Math.cos(a)*.118-.024],[Math.sin(a)*(.212+Math.sin(i*2)*.019),.109+Math.sin(i*1.7)*.035,Math.cos(a)*.180-.030],.036,.025);
  }
  for(let i=0;i<9;i++){
    const x=-.122+i*.0305;
    blade([x,.133+Math.cos(i)*.016,.119],[x+Math.sin(i*2.4)*.013,.043+Math.sin(i*1.9)*.016,.157],.020,.012);
  }
  for(let i=0;i<7;i++){
    const x=-.12+i*.04;blade([x,.02,-.123],[x*.98,-.084+Math.cos(i)*.025,-.15],.021,.016);
  }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

const faces=new Map();
export function ippoFaceTexture(expression='focused',def={referenceIppo:true}) {
  const key=[def.name,def.eyes,def.brows,def.mouth,def.gender,expression].join('|');
  if(faces.has(key))return faces.get(key);
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d'),blink=expression==='blink',hurt=expression==='hurt';
  for(const sign of [-1,1]){
    g.save();g.translate(sign<0?151:361,204);g.scale(sign,1);
    if(!def.referenceIppo)g.scale(def.eyes==='big'?.95:1,def.eyes==='narrow'?.62:def.eyes==='big'?1.08:.94);
    if(blink){g.strokeStyle='#211812';g.lineWidth=7;g.beginPath();g.moveTo(-72,-6);g.quadraticCurveTo(0,9,72,-16);g.stroke();}
    else {
      const h=hurt?.6:1;g.save();g.scale(1,h);
      g.beginPath();g.moveTo(-72,-8);g.quadraticCurveTo(-15,-38,68,-23);g.quadraticCurveTo(86,-2,62,24);g.quadraticCurveTo(-12,51,-72,-8);g.closePath();
      g.fillStyle='#eeeae2';g.fill();g.save();g.clip();
      const iris=g.createRadialGradient(-3,5,4,-3,5,31);iris.addColorStop(0,'#151110');iris.addColorStop(.6,'#3f3024');iris.addColorStop(1,'#82705a');
      g.fillStyle=iris;g.beginPath();g.ellipse(-3,5,28,30,0,0,Math.PI*2);g.fill();g.fillStyle='#100e0c';g.beginPath();g.ellipse(-3,3,17,23,0,0,Math.PI*2);g.fill();
      g.fillStyle='rgba(20,12,8,.24)';g.fillRect(-80,-35,160,30);g.fillStyle='#fff';g.beginPath();g.ellipse(-11,-8,8,10,0,0,Math.PI*2);g.fill();g.beginPath();g.arc(9,15,3,0,Math.PI*2);g.fill();g.restore();
      g.strokeStyle='#21150f';g.lineWidth=7;g.lineCap='round';g.beginPath();g.moveTo(-72,-8);g.quadraticCurveTo(-15,-38,68,-23);g.stroke();g.lineWidth=3;g.beginPath();g.moveTo(-62,7);g.quadraticCurveTo(0,46,69,15);g.stroke();g.restore();
    }
    g.save();if(def.brows==='thin')g.translate(0,-23);if(def.brows==='thin')g.scale(1,.55);
    g.fillStyle='#181410';g.beginPath();g.moveTo(-76,-43+(hurt?8:0));g.lineTo(58,-80);g.lineTo(75,-64);g.lineTo(-65,-24+(hurt?8:0));g.closePath();g.fill();
    // A few angled eyebrow strokes retain the hand inked density of the reference.
    g.strokeStyle='#1a1713';g.lineWidth=3;for(let i=0;i<6;i++){const x=-52+i*20;g.beginPath();g.moveTo(x,-33-i*4.5);g.lineTo(x+7,-47-i*4.5);g.stroke();}
    g.restore();g.restore();
  }
  g.strokeStyle='rgba(88,45,24,.8)';g.lineWidth=3;g.lineCap='round';
  g.beginPath();g.moveTo(238,312);g.quadraticCurveTo(245,307,252,312);g.moveTo(267,312);g.quadraticCurveTo(274,307,280,312);g.stroke();
  g.strokeStyle='#54321e';g.lineWidth=4;g.beginPath();g.moveTo(207,383);g.quadraticCurveTo(253,375,306,383);
  if(!hurt&&def.mouth==='grin'){g.quadraticCurveTo(258,413,207,383);g.fillStyle='#ece5d9';g.fill();}
  if(hurt){g.lineTo(301,399);g.quadraticCurveTo(256,407,212,398);g.closePath();g.fillStyle='#4d261e';g.fill();}g.stroke();
  g.strokeStyle='rgba(159,84,40,.32)';g.lineWidth=5;g.beginPath();g.moveTo(231,400);g.quadraticCurveTo(256,407,282,400);g.stroke();
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;faces.set(key,tex);return tex;
}
