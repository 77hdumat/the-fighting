// Isolated local Chromium fallback: no user profile or signed-in browser session.
// npm install --prefix /tmp/dempsey-render-qa --no-audit --no-fund playwright@1.55.0
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/tmp/dempsey-render-qa/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const output = path.resolve('artifacts/rendering'); fs.mkdirSync(output, {recursive:true});
  console.log('Launching isolated Chromium');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout:30000, args:['--disable-webgpu'] });
  try {
    for (const mode of ['baseline','photoreal']) {
      const page = await browser.newPage({viewport:{width:1920,height:1080}});
      const errors=[], failedResources=[];
      page.on('pageerror', e=>errors.push(String(e)));
      page.on('console', m=>{if(m.type()==='error') errors.push(m.text());});
      page.on('response', response=>{if(response.status()>=400) failedResources.push({url:response.url(),status:response.status()});});
      await page.addInitScript(()=>{let seed=123456;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
      console.log(`Opening ${mode}`);
      await page.goto('http://127.0.0.1:8791/dev.html?'+(mode==='photoreal'?'photoreal=1':'profile=1'),{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>window.game?.renderFoundation?.state==='ready',null,{timeout:30000});
      await page.locator('#btn-solo').click();
      await page.keyboard.press('Space');
      await page.waitForFunction(()=>game.started && game.phase==='fight',null,{timeout:30000});
      await page.screenshot({path:path.join(output,`${mode}-fight.png`)});
      const result=await page.evaluate(async()=>{
        const samples=[];let previous=performance.now();const start=previous;
        await new Promise(resolve=>{function sample(now){samples.push({ms:now-previous,draws:game.renderer.info.render.calls,scale:game.renderer.getPixelRatio()});previous=now;if(now-start>=6000)resolve();else requestAnimationFrame(sample);}requestAnimationFrame(sample);});
        const avg=samples.reduce((s,f)=>s+f.ms,0)/samples.length;
        const sorted=samples.map(f=>f.ms).sort((a,b)=>a-b);
        const gl=game.renderer.getContext(); const debug=gl.getExtension('WEBGL_debug_renderer_info');
        return {state:game.renderFoundation.state,fps:1000/avg,meanMs:avg,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],stddevMs:Math.sqrt(samples.reduce((s,f)=>s+(f.ms-avg)**2,0)/samples.length),maxDraws:Math.max(...samples.map(f=>f.draws)),gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',batchBones:game.fighters.map(f=>f.rig.batch?.skeleton.bones.length),samples};
      });
      fs.writeFileSync(path.join(output,`${mode}-smoke.json`),JSON.stringify({browser:browser.version(),viewport:[1920,1080],timing:'rAF intervals; local headless Chrome, not target-device acceptance',result,errors,failedResources},null,2));
      const {samples,...summary}=result;console.log(JSON.stringify({mode,...summary,errors,failedResources},null,2));
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
