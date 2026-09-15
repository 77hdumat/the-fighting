import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../js/RenderFoundation.js', import.meta.url),'utf8');
let sequence=0;
async function fixture(failure) {
  const disposed=[], oldEnvironment={old:true};
  const resource=name=>({texture:{name},dispose(){disposed.push(name);}});
  const oldPost=resource('old-post');
  const scene={environment:oldEnvironment,environmentIntensity:1,remove(){}};
  const renderer={autoClear:true,toneMapping:7,toneMappingExposure:.9,outputColorSpace:'srgb',
    getPixelRatio:()=>1.25,setPixelRatio(value){this.ratio=value;},
    async compileAsync(){if(failure==='compile') throw new Error('compile rejected');}};
  const game={renderer,scene,post:oldPost,ring:{bloomObjects:[]},fx:{quality:2},quality:2,onResize(){}};
  const key=`__foundationFixture${++sequence}`;
  globalThis[key]={
    THREE:{PMREMGenerator:class {fromEquirectangular(){return resource('environment');} dispose(){disposed.push('pmrem');}},
      DataTexture:class {dispose(){disposed.push('shadow');}}},
    RGBELoader:class {async loadAsync(){return resource('hdr');}},
    createPhotorealPostFX:async()=>{renderer.autoClear=false;return {...resource('new-post'),setPreset(){},setBloomObjects(){},setSize(){}};},
    fetch:async()=>failure==='asset'?{ok:false,status:404}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(16384)},
  };
  const injected=`const {THREE,RGBELoader,createPhotorealPostFX,fetch}=globalThis.${key};\nconst PHOTOREAL=true, innerWidth=1920, innerHeight=1080;\n`;
  const {RenderFoundation}=await import('data:text/javascript;base64,'+Buffer.from(injected+source.replace(/^import .*;\n/gm,'')).toString('base64'));
  const foundation=Object.assign(Object.create(RenderFoundation.prototype),{game,shadows:[],name:'low',status:{},select:{},recordButton:{}});
  return {foundation,game,disposed,oldEnvironment,oldPost,key};
}
for(const failure of ['asset','compile']) test(`${failure} failure preserves the working pipeline and disposes prepared resources`,async()=>{
  const f=await fixture(failure);
  try {
    await assert.rejects(f.foundation.init(),failure==='asset'?/HTTP 404/:/compile rejected/);
    assert.equal(f.game.post,f.oldPost); assert(!f.disposed.includes('old-post'));
    assert.equal(f.game.scene.environment,f.oldEnvironment);
    assert.equal(f.game.renderer.autoClear,true);
    assert.equal(f.foundation.state,'failed'); assert.equal(f.foundation.ready,false);
    assert.equal(f.foundation.select.disabled,true); assert.equal(f.foundation.recordButton.disabled,true);
    assert(f.disposed.includes('hdr'));
    if(failure==='compile') for(const resource of ['pmrem','environment','shadow','new-post']) assert(f.disposed.includes(resource));
  } finally {delete globalThis[f.key];}
});
