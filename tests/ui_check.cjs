const {JSDOM}=require('jsdom');
const {createCanvas,Image}=require('@napi-rs/canvas');
const assert=require('node:assert/strict');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const dom=new JSDOM('<body></body>',{url:'http://127.0.0.1:8199/'});
global.document=dom.window.document;global.window=dom.window;global.Image=Image;global.confirm=()=>true;global.prompt=()=> '16,8,24,12';
const P=dom.window.HTMLCanvasElement.prototype;
function backing(el){if(!el._canvas)el._canvas=createCanvas(el.width,el.height);if(el._canvas.width!==el.width)el._canvas.width=el.width;if(el._canvas.height!==el.height)el._canvas.height=el.height;return el._canvas;}
P.getContext=function(){const native=backing(this).getContext('2d');return new Proxy(native,{get(t,k){if(k==='drawImage')return (im,...args)=>t.drawImage(im instanceof dom.window.HTMLCanvasElement?backing(im):im,...args);const v=t[k];return typeof v==='function'?v.bind(t):v;},set(t,k,v){t[k]=v;return true;}});};
P.toDataURL=function(){try{return backing(this).toBuffer('image/png').toString('base64').replace(/^/,'data:image/png;base64,');}catch(e){console.error('toDataURL shim',this.tagName,this.width,this.height);throw e;}};P.setPointerCapture=()=>{};
P.getBoundingClientRect=function(){return {left:0,top:0,width:this.width,height:this.height};};
dom.window.HTMLDialogElement.prototype.showModal=function(){};
dom.window.HTMLDialogElement.prototype.close=function(){this.onclose?.();};
const base='http://127.0.0.1:8199';const request=(p,o)=>fetch(base+p,o);
async function waitIdle(){for(let i=0;i<100;i++){if(!document.querySelector('button:disabled'))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI stuck busy');}
(async()=>{
 const {openEditor}=await import(pathToFileURL(path.resolve(__dirname,'../web/editor.js')));
 const fixture=createCanvas(320,240);const fc=fixture.getContext('2d');fc.fillStyle='#be9128';fc.fillRect(0,0,320,240);fc.fillStyle='black';fc.fillRect(140,100,30,30);const img=fixture.toDataURL();const mc=createCanvas(320,240);const m=mc.getContext('2d');m.fillStyle='black';m.fillRect(0,0,320,240);
 const initial=await (await request('/pristine_eraser/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:img,original:img,mask:mc.toDataURL()})})).json();
 let applied, modelCalls=0, applyCalls=0;
 await openEditor({state:initial,url:p=>base+p,request,onApply:r=>{applied=r;applyCalls++;},onModel:async(assets,onStatus)=>{
     modelCalls++;onStatus('Simulated model fill…');
     const generated=createCanvas(320,240);const g=generated.getContext('2d');g.fillStyle='#dfb940';g.fillRect(0,0,320,240);
     return (await request('/pristine_eraser/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:generated.toDataURL(),mask:mc.toDataURL(),original:img})})).json();
 }
});
 const $=s=>document.querySelector(s);
 assert.equal($('.pe-display').width,320);
 // Paint a stroke around the black patch, then local inpaint via real server.
 const out=$('.pe-display');out.onpointerdown({clientX:150,clientY:115,button:0,pointerId:1,preventDefault(){}});out.onpointermove({clientX:165,clientY:115});out.onpointerup({});
 $('[data-action=heal]').click();await waitIdle();assert.match($('.pe-status').textContent,/Repair applied/);
 $('.pe-apply').click();await waitIdle();assert.ok(applied.edited_asset);
 const raw=await (await request('/pristine_eraser/asset/'+applied.edited_asset)).arrayBuffer();const fixed=new Image();fixed.src=Buffer.from(raw);await new Promise((res,rej)=>{fixed.onload=res;fixed.onerror=rej;});const c=createCanvas(320,240);c.getContext('2d').drawImage(fixed,0,0);assert.ok(c.getContext('2d').getImageData(155,115,1,1).data[0]>100);
 const previouslyApplied=applied.edited_asset,previousApplyCalls=applyCalls;
 $('[data-action=model]').click();await waitIdle();assert.equal(modelCalls,1);assert.equal(applied.edited_asset,previouslyApplied);assert.equal(applyCalls,previousApplyCalls);assert.match($('.pe-status').textContent,/Model fill ready/);
 // Undo model preview restores the previous image and its selection.
 $('[data-action=undo]').click();await waitIdle();
 $('[data-action=expand]').click();assert.equal(out.width,360);assert.equal(out.height,260);
 $('[data-action=undo]').click();await waitIdle();assert.equal(out.width,320);
 $('[data-action=redo]').click();await waitIdle();assert.equal(out.width,360);
 $('[data-action=rotate]').click();assert.equal(out.width,260);assert.equal(out.height,360);
 $('[data-action=flip]').click();
 $('[data-action=compare]').click();assert.equal($('[data-action=compare]').textContent,'Show edit');$('[data-action=compare]').click();
 $('[data-action=clear]').click();$('[data-tool=lasso]').click();out.onpointerdown({clientX:50,clientY:50,button:0,pointerId:1,preventDefault(){}});out.onpointermove({clientX:70,clientY:50});out.onpointermove({clientX:70,clientY:70});out.onpointerup({});
 $('[data-action=blur]').click();assert.match($('.pe-status').textContent,/blurred/);
 $('[data-tool=detect]').click();out.onpointerdown({clientX:0,clientY:0,button:0,pointerId:1,preventDefault(){}});await waitIdle();assert.match($('.pe-status').textContent,/Color region selected/);
 $('.pe-apply').click();await waitIdle();assert.ok(applied.mask_asset);
 $('.pe-close').click();assert.equal(document.querySelector('.pe-dialog'),null);
 console.log('PASS: DOM/canvas editor integration: restore, brush, local heal, apply/assets, model callback/preview without auto-Apply, expand, undo/redo, rotate/flip, compare, lasso, blur, detect, close.');
})().catch(e=>{console.error(e);process.exit(1);});
