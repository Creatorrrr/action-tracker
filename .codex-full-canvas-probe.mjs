import { writeFileSync } from 'node:fs';

import {
  captureViewportScreenshot,
  closePage,
  createPage,
  evaluate,
  navigate,
  setViewport,
  startHeadedChrome,
  stopHeadedChrome,
} from './tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-chrome-cdp-v1.mjs';

const browser = await startHeadedChrome({ windowWidth: 1280, windowHeight: 720 });
try {
  for (const dpr of [1, 2]) {
    const page = await createPage(browser);
    try {
      const viewport = { width: 1280, height: 720, deviceScaleFactor: dpr };
      await setViewport(page, viewport);
      await navigate(page, 'data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:rgb(16,19,27);overflow:hidden}canvas{position:fixed;left:0;top:0;width:1280px;height:720px;pointer-events:none;image-rendering:pixelated}</style><canvas id="nonce"></canvas>');
      const expression = '(()=>{const dpr=' + dpr + ',canvas=document.getElementById("nonce"),ctx=canvas.getContext("2d",{alpha:true});canvas.width=1280*dpr;canvas.height=720*dpr;const P=dpr===1?{x:40,y:164,width:695,height:392}:{x:80,y:328,width:1390,height:784},core={start:P.y+1,end:P.y+P.height-2},bits=Array.from({length:64},(_,i)=>i===0||i===63||i%3===0?1:0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle="rgb(255,0,255)";ctx.fillRect(P.x,P.y,P.width,P.height);for(let i=0;i<64;i++){const left=P.x+Math.floor(P.width*i/64),right=P.x+Math.floor(P.width*(i+1)/64);ctx.fillStyle=bits[i]?"rgb(255,0,255)":"rgb(0,0,0)";ctx.fillRect(left,core.start,right-left,core.end-core.start);}const r=canvas.getBoundingClientRect();return{P,core,bits:bits.join(""),rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}})()';
      const evidence = await evaluate(page, expression);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const screenshot = await captureViewportScreenshot(page);
      const outputPath = '/private/tmp/full-canvas-nonce-dsf' + dpr + '.png';
      writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
      process.stdout.write(JSON.stringify({ dpr, outputPath, evidence }) + '\n');
    } finally {
      await closePage(page);
    }
  }
} finally {
  await stopHeadedChrome(browser);
}
