const {JSDOM}=require('jsdom');
const {createCanvas,Image}=require('@napi-rs/canvas');
const assert=require('node:assert/strict');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const dom=new JSDOM('<body></body>',{url:'http://127.0.0.1:8199/'});
global.document=dom.window.document;global.window=dom.window;global.Image=Image;global.confirm=()=>true;global.prompt=()=> '16,8,24,12';
const P=dom.window.HTMLCanvasElement.prototype;
function backing(el){if(!el._canvas)el._canvas=createCanvas(el.width,el.height);if(el._canvas.width!==el.width)el._canvas.width=el.width;if(el._canvas.height!==el.height)el._canvas.height=el.height;return el._canvas;}
P.getContext=function(){const el=this,native=backing(this).getContext('2d');return new Proxy(native,{get(t,k){backing(el);if(k==='drawImage')return (im,...args)=>t.drawImage(im instanceof dom.window.HTMLCanvasElement?backing(im):im,...args);const v=t[k];return typeof v==='function'?v.bind(t):v;},set(t,k,v){t[k]=v;return true;}});};
P.toDataURL=function(){try{return backing(this).toBuffer('image/png').toString('base64').replace(/^/,'data:image/png;base64,');}catch(e){console.error('toDataURL shim',this.tagName,this.width,this.height);throw e;}};P.setPointerCapture=()=>{};
P.getBoundingClientRect=function(){return {left:0,top:0,width:this.width,height:this.height};};
dom.window.HTMLDialogElement.prototype.showModal=function(){};
dom.window.HTMLDialogElement.prototype.close=function(){this.onclose?.();};
const base='http://127.0.0.1:8199';const request=(p,o)=>fetch(base+p,o);
async function waitIdle(){for(let i=0;i<100;i++){if(!document.querySelector('button:disabled'))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI stuck busy');}
(async()=>{
 const {openEditor}=await import(pathToFileURL(path.resolve(__dirname,'../web/editor.js')));
 const fixture=createCanvas(320,240);const fc=fixture.getContext('2d');fc.fillStyle='#be9128';fc.fillRect(0,0,320,240);fc.fillStyle='black';fc.fillRect(140,100,30,30);const img=fixture.toDataURL();
 const mc=createCanvas(320,240);mc.getContext('2d').fillRect(0,0,320,240);
 const initial=await (await request('/pristine_eraser/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:img,original:img,mask:mc.toDataURL()})})).json();
 async function asset(name){const im=new Image();const bytes=Buffer.from(await (await request('/pristine_eraser/asset/'+name)).arrayBuffer());await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=bytes;});return im;}
 const pixel=(c,x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data).slice(0,3);
 let applied,modelCalls=0,applyCalls=0,preloadCalls=0,releaseCalls=0,fail=false,mismatch=false,secondSource;
 await openEditor({state:{...initial,revision:0},url:p=>base+p,request,
 onPreload:async()=>{preloadCalls++;return {components:['diffusion','clip','vae']};},onRelease:async()=>{releaseCalls++;return {retained:false};},
 onApply:r=>{applied=r;applyCalls++;},onModel:async(assets,onStatus)=>{
     if(fail)throw Error('Simulated generation failure');
     assert.match(assets.editor_prompt,/seamless continuation/);
     modelCalls++;onStatus('Simulated model fill…');
     const generated=createCanvas(320,240),g=generated.getContext('2d');g.drawImage(await asset(assets.edited_asset),0,0);
     if(modelCalls===2)secondSource=pixel(generated,155,115);
     const selected=createCanvas(320,240),sc=selected.getContext('2d');sc.drawImage(await asset(assets.mask_asset),0,0);
     const md=sc.getImageData(0,0,320,240);for(let i=0;i<md.data.length;i+=4){md.data[i+3]=md.data[i];md.data[i]=md.data[i+1]=md.data[i+2]=255;}sc.putImageData(md,0,0);
     sc.globalCompositeOperation='source-in';sc.fillStyle=modelCalls===1?'#ff0000':'#0000ff';sc.fillRect(0,0,320,240);g.drawImage(selected,0,0);
     const result=await (await request('/pristine_eraser/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:generated.toDataURL(),mask:mc.toDataURL(),original:img,session_id:assets.session_id})})).json();
     return {...result,source_asset:mismatch?'wrong-source':assets.edited_asset};
 }});
 const $=s=>document.querySelector(s),out=$('.pe-display');
 const paint=(x,y)=>{out.onpointerdown({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){}});out.onpointermove({clientX:x+5,clientY:y});out.onpointerup({});};
 assert.equal($('.pe-revision').textContent,'Original');
 $('[data-action=connection]').click();await waitIdle();assert.match($('.pe-status').textContent,/version 0.5.0/);
 $('[data-action=preload]').click();await waitIdle();assert.equal(preloadCalls,1);
 $('[data-action=release]').click();await waitIdle();assert.equal(releaseCalls,1);
 paint(150,115);$('[data-action=model]').click();await waitIdle();
 assert.deepEqual(pixel(out,155,115),[255,0,0],$('.pe-status').textContent);assert.equal($('.pe-revision').textContent,'Edit 1');assert.equal(applyCalls,0);
 paint(50,50);$('[data-action=heal]').click();await waitIdle();
 assert.deepEqual(secondSource,[255,0,0]);assert.equal(modelCalls,2);
 assert.deepEqual(pixel(out,155,115),[255,0,0]);assert.deepEqual(pixel(out,55,50),[0,0,255]);assert.equal($('.pe-revision').textContent,'Edit 2');
 $('[data-action=undo]').click();await waitIdle();assert.equal($('.pe-revision').textContent,'Edit 1');assert.deepEqual(pixel(out,155,115),[255,0,0]);
 $('[data-action=redo]').click();await waitIdle();assert.deepEqual(pixel(out,55,50),[0,0,255]);
 $('[data-action=compare]').click();assert.deepEqual(pixel(out,155,115),[0,0,0]);$('[data-action=compare]').click();assert.deepEqual(pixel(out,155,115),[255,0,0]);
 paint(100,100);fail=true;$('[data-action=model]').click();await waitIdle();assert.match($('.pe-status').textContent,/Simulated generation failure/);assert.equal($('.pe-revision').textContent,'Edit 2');fail=false;
 mismatch=true;$('[data-action=model]').click();await waitIdle();assert.match($('.pe-status').textContent,/different source/);assert.equal($('.pe-revision').textContent,'Edit 2');mismatch=false;
 $('[data-action=clear]').click();$('.pe-apply').click();await waitIdle();assert.equal(applyCalls,1);assert.equal(applied.revision,2);assert.match(applied.edited_asset,/^final:/);assert.equal(applied.mask_asset,'');
 const saved=createCanvas(320,240);saved.getContext('2d').drawImage(await asset(applied.edited_asset),0,0);assert.deepEqual(pixel(saved,55,50),[0,0,255]);
 $('[data-action=expand]').click();assert.equal(out.width,360);assert.equal(out.height,260);
 $('[data-action=undo]').click();await waitIdle();assert.equal(out.width,320);
 $('[data-action=redo]').click();await waitIdle();assert.equal(out.width,360);
 $('[data-action=rotate]').click();assert.equal(out.width,260);assert.equal(out.height,360);$('[data-action=flip]').click();
 const beforeCropCalls=modelCalls;$('[data-action=crop]').click();assert.equal(out.width,24);assert.equal(out.height,12);assert.equal(modelCalls,beforeCropCalls);
 $('[data-action=undo]').click();await waitIdle();assert.equal(out.width,260);assert.equal(out.height,360);
 $('[data-action=clear]').click();$('[data-tool=lasso]').click();paint(50,50);
 $('[data-tool=brush]').click();paint(70,70);$('[data-action=blur]').click();assert.match($('.pe-status').textContent,/blurred/);
 $('[data-tool=detect]').click();out.onpointerdown({clientX:0,clientY:0,button:0,pointerId:1,preventDefault(){}});await waitIdle();assert.match($('.pe-status').textContent,/Color region selected/);
 $('.pe-close').click();await new Promise(r=>setTimeout(r,30));assert.equal(document.querySelector('.pe-dialog'),null);
 console.log('PASS: final-only save; real asset routes; two cumulative model edits visibly repaint the canvas; model repair; immutable original; revision undo/redo; source mismatch/failure preserve the current edit; Apply saves the newest result; transforms and selection.');
})().catch(e=>{console.error(e);process.exit(1);});
