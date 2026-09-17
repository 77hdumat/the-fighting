// Isolated Chromium fallback after browser plugin reported no connected browser.
const { chromium } = require('/tmp/dempsey-render-qa/node_modules/playwright');
const path = require('node:path');const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-webgpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],failedResources=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)failedResources.push({url:r.url(),status:r.status()});});
 const phase=process.argv[2]||'after',out=path.resolve('artifacts/character-rework');fs.mkdirSync(out,{recursive:true});
 await page.addInitScript(()=>{let seed=123456;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
 if(phase==='reference-all'){
  await page.goto('http://127.0.0.1:8791/ippo.html');await page.waitForFunction(()=>window.__ready);
  const keys=await page.locator('#character option').evaluateAll(options=>options.map(o=>o.value)),checks=[];
  for(const key of keys){
   await page.locator('#character').selectOption(key);
   for(const pose of ['front','side','guard','straight','hook']){
    await page.locator(`[data-pose="${pose}"]`).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const check=await page.evaluate(async({key,pose})=>{const r=__ippoViewer.rig,T=await import('three'),mesh=r.torso,p=new T.Vector3();let finite=true;mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){p.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,p);finite&&=Number.isFinite(p.x+p.y+p.z);}return {key,pose,finite,bones:mesh.skeleton.bones.length,vertices:mesh.geometry.attributes.position.count,groups:mesh.geometry.groups.length,materials:Array.isArray(mesh.material)?mesh.material.length:1,face:r.face.material.map.image.width,continuousClothing:!!mesh.geometry.attributes.skinSurface};},{key,pose});checks.push(check);
    await page.screenshot({path:path.join(out,`reference-${key}-${pose}.png`)});
   }
  }
  const result={errors,failedResources,checks};fs.writeFileSync(path.join(out,'reference-all-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||checks.some(c=>!c.finite||c.bones!==8||c.face!==512))process.exitCode=1;return;
 }
 if(phase==='ippo-viewer'){
  await page.goto('http://127.0.0.1:8791/ippo.html');await page.waitForFunction(()=>window.__ready);
  const poses=['front','side','guard','straight','hook'],checks=[];
  for(const pose of poses){await page.locator(`[data-pose="${pose}"]`).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));checks.push(await page.evaluate(pose=>({pose,bones:__ippoViewer.rig.torso.skeleton.bones.length,finite:__ippoViewer.rig.torso.skeleton.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite)),vertices:__ippoViewer.rig.torso.geometry.attributes.position.count}),pose));await page.screenshot({path:path.join(out,`ippo-viewer-${pose}.png`)});}
  await page.evaluate(()=>window.__poseAngle=__ippoViewer.rig.elbowL.rotation.x);await page.locator('#motion').click();await page.waitForFunction(()=>Math.abs(__ippoViewer.rig.elbowL.rotation.x-__poseAngle)>.01);await page.locator('#motion').click();
  await page.setViewportSize({width:390,height:844});await page.locator('[data-pose="front"]').click();await page.screenshot({path:path.join(out,'ippo-viewer-mobile.png')});
  const response=await page.request.get('http://127.0.0.1:8791/assets/models/ippo-reference-v1.glb'),binary=await response.body(),download=response.ok()&&binary.subarray(0,4).toString()==='glTF';
  const result={errors,failedResources,checks,download,bytes:binary.length};fs.writeFileSync(path.join(out,'ippo-viewer-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||!download||checks.some(c=>!c.finite||c.bones!==8))process.exitCode=1;return;
 }
 if(phase==='ippo-export'){
  await page.goto('http://127.0.0.1:8791/rigview.html');await page.waitForFunction(()=>window.__ready);
  const exported=await page.evaluate(async()=>{
   const T=await import('three'),R=await import('./js/Rig.js'),P=await import('./js/Punch.js'),{GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
   const r=R.buildBoxer(R.CHARACTERS.ippo),neutral=R.defaultPose();for(const key of R.POSE_KEYS)neutral[key]=0;
   const targets=['hips','waist','chest','head','shoulderL','elbowL','shoulderR','elbowR','thighL','shinL','thighR','shinR'];targets.forEach(key=>r[key].name='IPPO_'+key);
   let node=0;r.root.traverse(o=>{if(o.isBone)o.name='IPPO_bone_'+node++;});r.root.name='IPPO_reference';
   const clips=[];
   for(const kind of ['Guard','StraightPunch','HookPunch']){
    const times=[0,.15,.25,.35,.45,.55,.65,.8,1],duration=kind==='Guard'?1:kind==='HookPunch'?.38:.32,values=targets.map(()=>[]);
    for(const t of times){const pose=R.defaultPose();if(kind!=='Guard')P.applyPunchToPose(pose,{side:'L',type:kind==='HookPunch'?'hook':'straight',t,dur:1});R.applyPose(r,pose);targets.forEach((key,i)=>values[i].push(...r[key].quaternion.toArray()));}
    clips.push(new T.AnimationClip(kind,duration,targets.map((key,i)=>new T.QuaternionKeyframeTrack('IPPO_'+key+'.quaternion',times.map(t=>t*duration),values[i]))));
   }
   R.applyPose(r,neutral);const remove=[],mats=new Map();r.root.traverse(o=>{
    if(!o.isMesh)return;if(!o.visible||o.material.side===T.BackSide){remove.push(o);return;}
    const old=o.material;if(!mats.has(old))mats.set(old,new T.MeshStandardMaterial({name:old.vertexColors?'IPPO_anatomy':old.map?'IPPO_surface_ink':'IPPO_'+old.color.getHexString(),color:old.color,map:old.map||null,vertexColors:old.vertexColors,roughness:old.color.getHex()===R.CHARACTERS.ippo.gloves?.48:.88,metalness:0,transparent:old.transparent,opacity:old.opacity,side:old.side,depthWrite:!old.transparent}));o.material=mats.get(old);
   });remove.forEach(o=>o.removeFromParent());r.root.updateMatrixWorld(true);
   const binary=await new GLTFExporter().parseAsync(r.root,{binary:true,animations:clips,onlyVisible:true}),bytes=new Uint8Array(binary);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {base64:btoa(text),bytes:bytes.length,clips:clips.map(c=>c.name),bodyVertices:r.torso.geometry.attributes.position.count,bodyTriangles:r.torso.geometry.index.count/3,bones:r.torso.skeleton.bones.length};
  });
  const modelDir=path.resolve('assets/models');fs.mkdirSync(modelDir,{recursive:true});fs.writeFileSync(path.join(modelDir,'ippo-reference-v1.glb'),Buffer.from(exported.base64,'base64'));delete exported.base64;
  const loaded=await page.evaluate(async()=>{const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),T=await import('three'),v=__rigview;v.rigs.forEach(r=>r.root.visible=false);const model=await new GLTFLoader().loadAsync('./assets/models/ippo-reference-v1.glb');model.scene.position.x=v.rigs[0].root.position.x;v.scene.add(model.scene);v.setView('IPPO 전신');v.paint();let finite=true,skin=0;model.scene.traverse(o=>{if(o.isSkinnedMesh){skin++;finite&&=o.geometry.attributes.position.array.every(Number.isFinite);}});window.__exportedIppo=model;window.__exportMixer=new T.AnimationMixer(model.scene);return {clips:model.animations.map(c=>c.name),skin,finite};});await page.screenshot({path:path.join(out,'ippo-glb-front.png')});
  await page.evaluate(()=>{const clip=__exportedIppo.animations.find(a=>a.name==='HookPunch');__exportMixer.clipAction(clip).play();__exportMixer.update(.18);__rigview.paint();});await page.screenshot({path:path.join(out,'ippo-glb-hook.png')});
  const result={exported,loaded,errors,failedResources};fs.writeFileSync(path.join(out,'ippo-export-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||!loaded.finite||loaded.clips.length!==3)process.exitCode=1;return;
 }
 if(phase==='world-before'||phase==='world-after'){
  await page.goto('http://127.0.0.1:8791/index.html');await page.waitForFunction(()=>window.game);
  await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');
  const checks=[];
  for(const map of ['ring','cliff']){
   await page.evaluate(map=>{game.setMap(map);game.autoQuality=false;game.setQuality(2);game.last=performance.now();game.paused=false;},map);
   const metrics=await page.evaluate(async()=>{const samples=[],calls=[],r=game.renderer;let last=performance.now();r.info.autoReset=false;await new Promise(resolve=>{function tick(t){samples.push(t-last);last=t;calls.push(r.info.render.calls);r.info.reset();if(samples.length===120)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});r.info.autoReset=true;return {fps:1000/(samples.reduce((a,b)=>a+b,0)/samples.length),maxDraws:Math.max(...calls.slice(1)),textures:r.info.memory.textures,geometries:r.info.memory.geometries,quality:game.quality};});
   await page.evaluate(()=>game.paused=true);await page.screenshot({path:path.join(out,`${phase}-${map}.png`)});
   const detail=await page.evaluate(()=>{let instanced=0,standard=0,bump=0;game.ring.group.traverse(o=>{if(o.isInstancedMesh)instanced+=o.count;if(o.isMesh){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m.isMeshStandardMaterial)standard++;if(m.bumpMap)bump++;}}});return {instanced,standard,bump,kind:game.ring.kind};});checks.push({map,metrics,detail});
   await page.evaluate(()=>{const g=game,t=g.fighters.findIndex((f,i)=>i!==g.localSlot),p=g.fighters[t].headPos;g.fx.impacts.length=0;g.fx.flash=0;g.hitFx({a:g.localSlot,b:t,pos:[p.x,p.y,p.z],dir:[0,-1],side:'L',type:'hook',zone:'head',power:1.3,counter:true,res:{}});g.sparks.update(.07);g.post.render();g.fx.update(.07,{intensity:0,hitStop:0,velX:0,velY:0});});
   await page.screenshot({path:path.join(out,`${phase}-${map}-impact.png`)});
  }
  if(phase==='world-after'){
   await page.evaluate(async()=>{const g=game;g.setMap('ring');const rig=await import('./js/Rig.js'),punch=await import('./js/Punch.js'),r=g.trailL,f=g.fighters[g.localSlot],base={...f.pose};r.clear();for(let i=0;i<12;i++){const p={...base};punch.applyPunchToPose(p,{side:'L',type:'hook',t:.2+i*.022,dur:1});rig.applyPose(f.rig,p);f.updateWorldPoints();r.push(f.gloveL);}r.update(.1,g.camera,true);g.sparks.update(1);g.fx.impacts.length=0;g.fx.flash=0;g.fx.update(1,{intensity:0,hitStop:0,velX:0,velY:0});g.post.render();});await page.screenshot({path:path.join(out,'world-after-wind.png')});
   checks.push({wind:await page.evaluate(()=>({visible:game.trailL.mesh.visible,finite:game.trailL.pos.every(Number.isFinite),vertices:game.trailL.geo.attributes.position.count}))});
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{game.setQuality(0);game.last=performance.now();game.frame(performance.now()+16);});await page.screenshot({path:path.join(out,'world-after-mobile.png')});
   await page.setViewportSize({width:1440,height:1000});
   checks.push({switches:await page.evaluate(()=>{const g=game,counts=[];for(let i=0;i<6;i++){g.setMap(i%2?'ring':'cliff');g.post.render();counts.push({textures:g.renderer.info.memory.textures,geometries:g.renderer.info.memory.geometries,lights:g.scene.children.filter(o=>o.isLight).length});}return counts;})});
   await page.goto('http://127.0.0.1:8791/dev.html?photoreal=1');await page.waitForFunction(()=>window.game?.renderFoundation?.state==='ready');await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');await page.screenshot({path:path.join(out,'world-after-experimental.png')});
  }
  const result={phase,errors,failedResources,checks};fs.writeFileSync(path.join(out,`${phase}-qa.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length)process.exitCode=1;return;
 }
 if(phase==='wind'){
  await page.goto('http://127.0.0.1:8791/index.html');await page.waitForFunction(()=>window.game);await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');
  await page.evaluate(async()=>{game.paused=true;const {InputState}=await import('./js/InputState.js');for(const f of game.fighters)if(f.brain)f.brain.update=()=>new InputState();game.fx.impacts.length=0;window.__swingWindHead=game.sparks.windHead;game.last=performance.now();game.paused=false;});
  await page.keyboard.down('j');await page.waitForFunction(()=>game.sparks.windHead>__swingWindHead);
  await page.evaluate(()=>game.paused=true);await page.keyboard.up('j');
  const check=await page.evaluate(()=>({miss:game.fx.impacts.length===0,windVisible:game.sparks.windBursts.some(f=>f.life>0&&f.sprite.visible),ribbonVisible:game.trailL.mesh.visible,historyPoints:game.trailL.len,finite:game.trailL.pos.every(Number.isFinite)}));await page.screenshot({path:path.join(out,'world-after-swing.png')});
  await page.evaluate(()=>{game.last=performance.now();game.paused=false;});await page.waitForFunction(()=>game.sparks.windBursts.every(f=>f.life===0));check.expired=true;
  const result={errors,failedResources,check};fs.writeFileSync(path.join(out,'wind-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||!check.miss||!check.windVisible||!check.ribbonVisible||!check.finite)process.exitCode=1;return;
 }
 if(phase==='effects'){
  await page.goto('http://127.0.0.1:8791/index.html');await page.waitForFunction(()=>window.game);
  await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');
  await page.evaluate(()=>{game.paused=true;window.__drawnWords=[];const ctx=game.fx.ctx,original=ctx.fillText.bind(ctx);ctx.fillText=(text,...args)=>{__drawnWords.push(text);return original(text,...args);};});
  const checks=[];
  for(const kind of ['hit','counter','finisher','guard','mobile']){
   if(kind==='mobile')await page.setViewportSize({width:390,height:844});
   const check=await page.evaluate(kind=>{
    const g=game,attacker=g.localSlot,target=g.fighters.findIndex((f,i)=>i!==attacker),p=g.fighters[target].headPos;
    g.fx.impacts.length=0;g.fx.flash=0;g.sparks.update(1);__drawnWords.length=0;
    const res=kind==='guard'?{blocked:true,heavy:true}:{};
    g.hitFx({a:attacker,b:target,pos:[p.x,p.y,p.z],dir:[0,-1],side:'L',type:'hook',zone:'head',power:1,counter:kind==='counter',finisher:kind==='finisher',charge:1,res});
    const im=g.fx.impacts[0];g.sparks.update(.06);g.post.render();
    g.fx.update(.06,{intensity:0,hitStop:0,velX:0,velY:0,focusX:im.x,focusY:im.y});
    const rgb=new Set();let particles=0;for(let i=0;i<g.sparks.life.length;i++)if(g.sparks.life[i]>0){particles++;rgb.add(Array.from(g.sparks.col.slice(i*3,i*3+3)).map(v=>v.toFixed(2)).join(','));}
    const windImage=g.sparks.windBursts[0].sprite.material.map.image,c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');ctx.drawImage(windImage,0,0);const pixels=ctx.getImageData(0,0,512,512).data;let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===0)transparent++;
    return {kind,particles,colors:rgb.size,word:im.word,drawn:__drawnWords.includes(im.word),age:im.age,textureLoaded:g.fx.impactImage.naturalWidth===256,windLoaded:windImage.width===512,transparent,windDepth:g.sparks.windBursts.every(f=>f.sprite.material.depthTest&&!f.sprite.material.depthWrite)};
   },kind);checks.push(check);await page.screenshot({path:path.join(out,`restored-${kind}.png`)});
   check.expired=await page.evaluate(()=>{const g=game;g.fx.update(.5,{intensity:0,hitStop:0,velX:0,velY:0});g.sparks.update(1);return g.fx.impacts.length===0&&g.sparks.life.every(t=>t<=0)&&g.sparks.windBursts.every(f=>f.life===0&&!f.sprite.visible);});
  }
  const result={errors,failedResources,checks};fs.writeFileSync(path.join(out,'restored-effects-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
  if(errors.length||checks.some(c=>!c.drawn||!c.expired||!c.textureLoaded||!c.windLoaded||!c.windDepth||c.transparent<10000||c.particles<20||c.colors<2))process.exitCode=1;return;
 }
 if(phase==='before')await page.route(/\/js\/(Rig|AfterImageEffect|Trails|HitSparks|main|FxOverlay|Fighter)\.js(?:\?.*)?$/,route=>{const name=new URL(route.request().url()).pathname.split('/').pop();const saved=path.join(out,name);if(fs.existsSync(saved))route.fulfill({contentType:'text/javascript',body:fs.readFileSync(saved,'utf8')});else route.continue();});
 await page.goto('http://127.0.0.1:8791/rigview.html');await page.waitForFunction(()=>window.__ready);
 const poses=['front','side','guard','punch','hook'];
 for(const label of poses){
 await page.evaluate(async(label)=>{const v=window.__rigview,m=await import('./js/Rig.js');v.rigs.forEach((r,i)=>r.root.visible=i===0);const r=v.rigs[0],p=m.defaultPose();if(label==='front'||label==='side'){for(const k of ['hipsRotY','waistX','waistY','headX','headY','shLX','shLY','shLZ','shRX','shRY','shRZ','elL','elR'])p[k]=0;}if(label==='punch'||label==='hook'){const pu=await import('./js/Punch.js');pu.applyPunchToPose(p,{side:'L',type:label==='hook'?'hook':'straight',t:.5,dur:1});}m.applyPose(r,p);r.root.rotation.y=label==='side'?Math.PI/2:0;v.setView('IPPO 전신');v.paint();},label);
 await page.screenshot({path:path.join(out,`${phase}-${label}.png`)});
 }
 await page.evaluate(()=>{const v=__rigview;v.rigs.forEach(r=>r.root.visible=true);v.setView('전체 10인');});await page.screenshot({path:path.join(out,`${phase}-lineup.png`)});
 const checks=phase==='after'?await page.evaluate(async()=>{
   const m=await import('./js/Rig.js'),v=__rigview,results=[];
   for(const def of [...Object.values(m.CHARACTERS),...m.COACH_DEFS]){
    const r=m.buildBoxer(def);v.scene.add(r.root);let finite=true,weights=true;
    for(const pose of ['guard','straight','hook']){const p=m.defaultPose();if(pose!=='guard'){const pm=await import('./js/Punch.js');pm.applyPunchToPose(p,{side:'R',type:pose,t:.5,dur:1});}m.applyPose(r,p);r.root.updateMatrixWorld(true);r.root.traverse(o=>{if(o.isMesh){finite&&=o.matrixWorld.elements.every(Number.isFinite);const w=o.geometry.attributes.skinWeight;if(w)for(let i=0;i<w.count;i++)weights&&=Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5;}});v.paint();}
    const normalFace=r.face.material.map;r.setExpression('hurt');const hurtFace=r.face.material.map;r.setExpression('blink');const blinkFace=r.face.material.map;const expressions=normalFace!==hurtFace&&hurtFace!==blinkFace;r.setExpression('focused');results.push({name:def.name,finite,weights,expressions,limbs:r.deformers.length,skinnedTorso:r.torso.isSkinnedMesh});v.scene.remove(r.root);
   }
   const {AfterImageEffect}=await import('./js/AfterImageEffect.js');const fx=new AfterImageEffect(v.scene,m.CHARACTERS.ippo,8);
   for(let i=0;i<30;i++){const p=m.defaultPose();p.elL=-2.4+i*.06;p.shLX=-.85-i*.025;fx.record(i/60,{x:v.rigs[0].root.position.x-.4+i*.015,y:0,z:0},.02*i,0,p);}
   fx.update(29/60,7,.04,1,0xff0000);fx.update(29/60,7,.04,1,0xff0000);fx.update(29/60,7,.04,1,0xff0000);
   const fadeRig=v.rigs[0];fadeRig.setOutlineOpacity(.25);const fadeWorks=fadeRig.outlineMats.every(mat=>(mat.uniforms?mat.uniforms.opacity.value:mat.opacity)===.25);fadeRig.setOutlineOpacity(1);const extreme=m.defaultPose();extreme.elL=-5;extreme.shinL=-1;m.applyPose(fadeRig,extreme);const jointLimits=fadeRig.elbowL.rotation.x===-2.65&&fadeRig.shinL.rotation.x===0;m.applyPose(fadeRig,m.defaultPose());
   const gs=fx.ghosts.filter(g=>g.root.parent),historical=gs.length>0&&gs.every(g=>g.elbowL.rotation.x!==-2.4+29*.06);
   const white=gs.every(g=>g.bodyMats.every(mat=>mat.color.getHex()===0xffffff&&mat.depthTest&&!mat.depthWrite&&mat.opacity<=.14&&mat.stencilFunc===512+5&&mat.stencilWriteMask===0));
   window.__ghostQa=fx;const inkFree=fx.ghosts.every(g=>g.outlineMats.length===0&&!g.face);gs.forEach(g=>v.scene.remove(g.root));
   return {jointLimits,fadeWorks,characters:results,ghosts:{allocated:fx.ghosts.length,visible:gs.length,historical,white,inkFree}};
 }):null;
 if(phase==='after'){
   for(const key of ['mashiba','miyata','sendo','chaechae','jjeonghyo','ppyeo','ohsh','jungjuwon','gokomong']){await page.evaluate(async key=>{const v=__rigview,m=await import('./js/Rig.js');v.rigs.forEach(r=>r.root.visible=r.def===m.CHARACTERS[key]);const r=v.rigs.find(r=>r.root.visible);m.applyPose(r,m.defaultPose());v.setView(key.toUpperCase()+' 전신');},key);await page.screenshot({path:path.join(out,`after-${key}.png`)});}
   await page.evaluate(async()=>{const v=__rigview,m=await import('./js/Rig.js');v.rigs.forEach((r,i)=>r.root.visible=i===0);v.rigs[0].root.rotation.y=0;m.applyPose(v.rigs[0],m.defaultPose());v.setView('IPPO 얼굴');});await page.screenshot({path:path.join(out,'after-face.png')});await page.evaluate(()=>{__rigview.rigs[0].setExpression('hurt');__rigview.paint();});await page.screenshot({path:path.join(out,'after-face-hurt.png')});await page.evaluate(async()=>{const v=__rigview,m=await import('./js/Rig.js'),r=v.rigs[0],p=m.defaultPose();p.elL=-2.4+29*.06;p.shLX=-.85-29*.025;m.applyPose(r,p);r.setExpression('focused');__ghostQa.update(29/60,3,.038,1);v.setView('IPPO 전신');});await page.screenshot({path:path.join(out,'after-ghosts.png')});await page.evaluate(()=>{__ghostQa.update(29/60,3,.038,0);});
 }
 await page.goto('http://127.0.0.1:8791/dev.html');await page.waitForFunction(()=>window.game);await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');
 await page.evaluate(async()=>{await new Promise(resolve=>{let n=0;function tick(){if(++n===8)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});});
 await page.screenshot({path:path.join(out,`${phase}-fight.png`)});
 const metrics=await page.evaluate(async()=>{const samples=[],draws=[],triangles=[],r=game.renderer;let last=performance.now();r.info.autoReset=false;await new Promise(resolve=>{function tick(t){samples.push(t-last);last=t;draws.push(r.info.render.calls);triangles.push(r.info.render.triangles);r.info.reset();if(samples.length===180)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});r.info.autoReset=true;const sorted=samples.slice().sort((a,b)=>a-b);return {fps:1000/(samples.reduce((a,b)=>a+b,0)/samples.length),p95Ms:sorted[Math.floor(sorted.length*.95)],maxDraws:Math.max(...draws.slice(1)),maxTriangles:Math.max(...triangles.slice(1)),geometries:r.info.memory.geometries,textures:r.info.memory.textures};});
 if(phase==='after'){
  await page.keyboard.down('j');await page.evaluate(async()=>{await new Promise(resolve=>{let n=0;function tick(){if(++n===8)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});});await page.screenshot({path:path.join(out,'after-motion.png')});await page.keyboard.up('j');
  const effects=await page.evaluate(async()=>{const g=game,view=g.fighters[0];g.sparks.burst(view.gloveL,view.forward,12,undefined,1,.5);g.fx.addImpact(innerWidth*.5,innerHeight*.5,.8,false);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const image=g.sparks.flashes[0].sprite.material.map.image,canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,256,256).data;let transparent=0,opaque=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;if(pixels[i]===255)opaque++;}return {transparentPixels:transparent,opaquePixels:opaque,textureLoaded:image?.width===256,depthTest:g.sparks.flashes.every(f=>f.sprite.material.depthTest),screenLoaded:g.fx.impactImage.naturalWidth===256};});if(checks)checks.effects=effects;await page.screenshot({path:path.join(out,'after-impact.png')});
  await page.goto('http://127.0.0.1:8791/index.html');await page.waitForFunction(()=>window.game);await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');await page.screenshot({path:path.join(out,'after-release.png')});
  checks.stencil=await page.evaluate(()=>({context:game.renderer.getContext().getContextAttributes().stencil,sceneTarget:game.post.rtScene.stencilBuffer}));
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>game.setQuality(0));await page.screenshot({path:path.join(out,'after-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:8791/dev.html?photoreal=1');await page.waitForFunction(()=>window.game?.renderFoundation?.state==='ready');await page.locator('#btn-solo').click();await page.keyboard.press('Space');await page.waitForFunction(()=>game.started&&game.phase==='fight');checks.experimentalStencil=await page.evaluate(()=>game.post.composer.inputBuffer.stencilBuffer);await page.screenshot({path:path.join(out,'after-experimental.png')});
  await page.goto('http://127.0.0.1:8791/artifacts/character-rework/comparison.html');await page.screenshot({path:path.join(out,'comparison.png')});
 }
 const result={phase,errors,failedResources,metrics,checks};fs.writeFileSync(path.join(out,`${phase}-qa.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||checks?.characters.some(c=>!c.finite||!c.weights||!c.expressions)||checks&&(!checks.ghosts.historical||!checks.ghosts.white||!checks.ghosts.inkFree||!checks.effects.textureLoaded||!checks.effects.screenLoaded||!checks.jointLimits||!checks.fadeWorks))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
