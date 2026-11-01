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
 const {queueModelEdit}=await import(pathToFileURL(path.resolve(__dirname,'../web/model_queue.js')));
 const fixture=createCanvas(320,240);const fc=fixture.getContext('2d');fc.fillStyle='#be9128';fc.fillRect(0,0,320,240);
 const mask=createCanvas(320,240);mask.getContext('2d').fillRect(0,0,320,240);
 const initial=await (await request('/pristine_eraser/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:fixture.toDataURL(),mask:mask.toDataURL(),original:fixture.toDataURL()})})).json();
 const graph={'1':{class_type:'PristineEditor',inputs:{model:['2',0],clip:['2',1],vae:['2',2]}},'2':{class_type:'TestLoader',inputs:{}}};
 let result,sequence=0;
 await openEditor({state:{...initial,revision:0},request,onApply:r=>{result=r;},
   onModel:(assets,onStatus)=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'queued-'+(++sequence),request,serverReceipts:true,pollMs:5,historyRetryMs:1,onStatus})});
 const $=s=>document.querySelector(s),out=$('.pe-display');
 const pixel=(x,y)=>Array.from(out.getContext('2d').getImageData(x,y,1,1).data).slice(0,3);
 const paint=(x,y)=>{out.onpointerdown({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){}});out.onpointermove({clientX:x+5,clientY:y});out.onpointerup({});};
 paint(150,115);$('[data-action=model]').click();await waitIdle();
 assert.deepEqual(pixel(155,115),[255,0,0],$('.pe-status').textContent);assert.equal($('.pe-revision').textContent,'Edit 1');
 paint(50,50);$('[data-action=model]').click();await waitIdle();
 assert.deepEqual(pixel(155,115),[255,0,0]);assert.deepEqual(pixel(55,50),[0,0,255],$('.pe-status').textContent);assert.equal($('.pe-revision').textContent,'Edit 2');
 const before=await (await request('/test/storage')).json();assert.equal(before.output_images.length,0);assert.equal(before.legacy_images.length,0);assert.equal(before.temp_sessions.length,1);
 // Saving must use clean photo pixels, not the display canvas with red brush overlay.
 paint(100,100);$('.pe-apply').click();await waitIdle();assert.match(result.edited_asset,/^final:/);assert.equal(result.mask_asset,'');
 const after=await (await request('/test/storage')).json();assert.equal(after.output_images.length,1);assert.equal(after.temp_sessions.length,0);assert.equal(after.legacy_images.length,0);
 const saved=new Image();const data=Buffer.from(await (await request('/pristine_eraser/asset/'+result.edited_asset)).arrayBuffer());await new Promise((r,j)=>{saved.onload=r;saved.onerror=j;saved.src=data;});
 const check=createCanvas(320,240);check.getContext('2d').drawImage(saved,0,0);
 assert.deepEqual(Array.from(check.getContext('2d').getImageData(100,100,1,1).data).slice(0,3),[190,145,40]);
 $('.pe-apply').click();await waitIdle();assert.equal((await (await request('/test/storage')).json()).output_images.length,1);
 $('.pe-close').click();await new Promise(r=>setTimeout(r,30));assert.equal(document.querySelector('.pe-dialog'),null);
 console.log('PASS: actual HTTP queue submission → Python editor worker → completion receipt (History always empty) → asset download → two visible cumulative canvas edits → one clean final output → zero session/legacy progress images.');
})().catch(e=>{console.error(e);process.exit(1);});
