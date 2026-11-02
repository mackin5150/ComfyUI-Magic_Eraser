import { requestJson } from './network.js?v=0.5.0';
const canvas = () => document.createElement('canvas');
const imageFrom = src => new Promise((resolve,reject) => {
    const im = new Image();const timer=setTimeout(()=>reject(Error('Image download timed out; the previous edit was kept.')),45000);
    im.onload=()=>{clearTimeout(timer);resolve(im);};im.onerror=()=>{clearTimeout(timer);reject(Error('Could not decode the edited image; the previous edit was kept.'));};im.src=src;
});
export async function openEditor({state={},url=p=>p,request=fetch,onApply=()=>{},onModel=null,onPreload=null,onRelease=null}={}) {
    if (document.querySelector('.pe-dialog')) return;
    const dialog=document.createElement('dialog'); dialog.className='pe-dialog';
    const style=document.createElement('style');
    style.textContent=`.pe-dialog{box-sizing:border-box;position:fixed;inset:0;width:96vw;max-width:1400px;height:94dvh;max-height:100dvh;padding:0;border:1px solid #33404b;border-radius:20px;background:#020d15;color:#f2f5f7;font:15px system-ui;overflow:hidden}.pe-dialog::backdrop{background:#000c}.pe-dialog *{box-sizing:border-box}.pe-dialog [hidden]{display:none!important}.pe-shell{height:100%;display:flex;flex-direction:column;overflow:auto}.pe-header,.pe-files,.pe-actions,.pe-sliders{display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap}.pe-header{justify-content:space-between;border-bottom:1px solid #26303a}.pe-header h2{margin:0;font-size:20px}.pe-dialog button,.pe-dialog select,.pe-dialog input[type=text]{background:#283039;color:#f5f5f5;border:1px solid #46515c;padding:10px 14px;border-radius:12px;font:inherit;cursor:pointer}.pe-dialog button:disabled{opacity:.4;cursor:wait}.pe-dialog button.active{color:#ff555c;border-color:#ff555c;background:#291921}.pe-dialog .pe-apply{border:2px solid #ff5058;color:#ff646b;background:transparent;font-weight:700}.pe-stage{flex:1;min-height:120px;overflow:auto;position:relative;background:repeating-conic-gradient(#18212b 0% 25%,#111923 0% 50%) 50%/24px 24px}.pe-display{display:block;touch-action:none;margin:auto;cursor:crosshair}.pe-tools{display:flex;justify-content:center;gap:12px;padding:12px;flex-wrap:wrap}.pe-tools button{min-width:95px;padding:16px}.pe-tools span{display:block;font-size:23px;margin-bottom:6px}.pe-status{min-height:26px;text-align:center;color:#c3ced7;padding:4px 12px}.pe-files{padding:8px 18px}.pe-files input{max-width:160px}.pe-actions{justify-content:center}.pe-sliders{justify-content:center}.pe-sliders label{display:flex;gap:8px;align-items:center}.pe-close{font-size:21px!important}.pe-empty{text-align:center;padding:35px;color:#9cabb8}.pe-hint{color:#a3b1be;font-size:12px}.pe-spacer{flex:1}@media(max-width:650px){.pe-dialog{width:100vw;height:100dvh;border-radius:0}.pe-header,.pe-files,.pe-actions,.pe-sliders{padding:7px;gap:6px}.pe-tools{gap:5px;padding:6px}.pe-tools button{min-width:65px;padding:9px}.pe-header h2{font-size:16px}.pe-dialog button{padding:8px;font-size:13px}.pe-sliders input{width:95px}}`;
    dialog.innerHTML=`<div class="pe-shell"><header class="pe-header"><button class="pe-close" aria-label="Close editor">←</button><h2>Pristine <span style="color:#ff555c">Remove</span> <small class="pe-revision">Original</small> <small>v0.5.0</small></h2><button class="pe-apply">Save final image →</button></header><div class="pe-files"><button data-action="upload">＋ Upload photo</button><input type="file" accept="image/*" hidden><input type="text" aria-label="Source slot" value="default"><button data-action="staged">Load from Node</button><span class="pe-hint">Run Send to Editor first</span></div><div class="pe-stage"><p class="pe-empty">Upload a photo or load one from a workflow node.</p><canvas class="pe-display" hidden></canvas></div><div class="pe-actions"><button data-action="undo">↶ Undo</button><button data-action="redo">↷ Redo</button><button data-action="compare">Show original</button><button data-action="fit">Fit</button><label>Zoom <input class="pe-zoom" type="range" min="10" max="300" value="100"></label></div><div class="pe-status" role="status">Select an area, then choose Remove, Blur, or Cut out.</div><div class="pe-tools"><button data-tool="brush"><span>◌</span>Brush</button><button data-tool="lasso"><span>⬡</span>Lasso</button><button data-tool="detect"><span>⌖</span>Color Select</button><button data-tool="deselect"><span>◇</span>Deselect</button><button data-action="clear"><span>×</span>Clear</button></div><div class="pe-sliders"><label>Brush <input class="pe-size" type="range" min="2" max="200" value="30"></label><label>Color tolerance <input class="pe-tolerance" type="range" min="0" max="100" value="24"></label></div><label class="pe-files">Fill instruction <textarea class="pe-instruction" rows="2" style="width:100%;background:#18212b;color:white;border:1px solid #46515c;border-radius:8px;padding:8px">A seamless continuation of the surrounding photograph, matching adjacent materials, colors, texture and lighting. The selected unwanted object is absent.</textarea></label><div class="pe-actions"><button class="pe-apply" data-action="model">✧ Remove with Model</button><button data-action="preload">Preload Models</button><button data-action="release">Release Models</button><button data-action="connection">Check connection</button><button data-action="modeloutpaint">Outpaint with Model</button><button data-action="heal">Repair with Model</button><button data-action="blur">Blur selected</button><button data-action="cut">Cut out selected</button><button data-action="expand">Expand for outpaint</button><button data-action="crop">Crop</button><button data-action="rotate">Rotate ↻</button><button data-action="flip">Flip ↔</button><button data-action="reset">Reset photo</button></div><div class="pe-status pe-hint">Color Select = connected colors · Remove / repair / outpaint use your model · Only Save final image keeps a permanent frame; intermediate photos are temporary.</div></div>`;
    document.head.append(style); document.body.append(dialog); dialog.showModal();
    const $=s=>dialog.querySelector(s), output=$('.pe-display'), ctx=output.getContext('2d'), stage=$('.pe-stage');
    let photo=canvas(), mask=canvas(), original=null, revision=0, undo=[], redo=[], tool='brush', busy=false, dirty=false, drawing=false, last=null, polygon=[], compare=false, sessionId=null, savedFinal=null, pendingCleanup=[];
    if(state.edited_asset?.startsWith('session:'))sessionId=state.edited_asset.split(':')[1];
    if(state.edited_asset?.startsWith('final:'))savedFinal={filename:state.edited_asset.slice(6)};
    const status=t=>$('.pe-status').textContent=t;
    const pack=()=>({image:photo.toDataURL(),mask:mask.toDataURL(),revision});
    function snapshot(){compare=false;$('[data-action=compare]').textContent='Show original';undo.push(pack()); if(undo.length>12)undo.shift(); redo=[];dirty=true;}
    function resize(w,h){for(const c of [photo,mask,output]){c.width=w;c.height=h;}}
    function render(){
        $('.pe-revision').textContent=revision?'Edit '+revision:'Original';
        ctx.clearRect(0,0,output.width,output.height);
        ctx.drawImage(compare&&original?original:photo,0,0,output.width,output.height);
        if(!compare){const tint=canvas(); tint.width=mask.width;tint.height=mask.height;const t=tint.getContext('2d');t.drawImage(mask,0,0);t.globalCompositeOperation='source-in';t.fillStyle='rgba(255,65,85,.48)';t.fillRect(0,0,tint.width,tint.height);ctx.drawImage(tint,0,0);}
        if(drawing&&tool==='lasso'&&polygon.length){ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle='#ff5a65';ctx.lineWidth=2;ctx.stroke();}
    }
    function scale(n){output.style.width=Math.round(output.width*n)+'px';output.style.height=Math.round(output.height*n)+'px';}
    function fit(){if(!photo.width)return;const n=Math.min((stage.clientWidth-8)/photo.width,(stage.clientHeight-8)/photo.height);scale(n);$('.pe-zoom').value=n*100;}
    async function load(src, initial=true){const im=typeof src==='string'?await imageFrom(src):src;if(im.width*im.height>24000000)throw Error('Maximum photo size is 24 megapixels');resize(im.width,im.height);photo.getContext('2d').drawImage(im,0,0);if(initial){original=im;revision=0;undo=[];redo=[];}output.hidden=false;$('.pe-empty').hidden=true;dirty=true;render();fit();status('Photo ready. Paint or lasso the area to edit.');}
    function exportMask(){const m=canvas();m.width=mask.width;m.height=mask.height;const c=m.getContext('2d');c.fillStyle='black';c.fillRect(0,0,m.width,m.height);c.drawImage(mask,0,0);return m.toDataURL();}
    async function loadMask(src){const im=typeof src==='string'?await imageFrom(src):src;const m=mask.getContext('2d');m.clearRect(0,0,mask.width,mask.height);m.drawImage(im,0,0);const data=m.getImageData(0,0,mask.width,mask.height);for(let i=0;i<data.data.length;i+=4){const alpha=data.data[i];data.data[i]=data.data[i+1]=data.data[i+2]=255;data.data[i+3]=alpha;}m.putImageData(data,0,0);}
    async function serverImage(path){
        const separator=path.includes('?')?'&':'?';
        const response=await request(path+separator+'t='+Date.now(),{cache:'no-store',timeoutMs:45000});
        if(!response.ok)throw Error(`Edited image download failed (HTTP ${response.status}); previous edit kept.`);
        const bytes=new Uint8Array(await response.arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        return imageFrom('data:image/png;base64,'+btoa(binary));
    }
    async function ensureSession(){
        if(!sessionId)sessionId=(await requestJson(request,'/pristine_eraser/session',{method:'POST'},'Start temporary edit session')).session_id;
        return sessionId;
    }
    async function discard(){
        for(const id of [...pendingCleanup,...(sessionId?[sessionId]:[])])await call('discard',{session_id:id});
        sessionId=null;pendingCleanup=[];
    }
    async function call(path, body){return requestJson(request,'/pristine_eraser/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:120000},path==='apply'?'Upload editor photo':'Image operation');}
    async function task(fn){if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}}
    const hasPhoto=()=>{if(output.hidden){status('Upload or load a photo first.');return false;}return true;};
    function selected(){const a=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;for(let i=3;i<a.length;i+=4)if(a[i])return true;status('Select an area first.');return false;}
    function point(e){const r=output.getBoundingClientRect();return [(e.clientX-r.left)*output.width/r.width,(e.clientY-r.top)*output.height/r.height];}
    function stroke(p,prev=p){const m=mask.getContext('2d');m.globalCompositeOperation=tool==='deselect'?'destination-out':'source-over';m.strokeStyle='white';m.fillStyle='white';m.lineCap='round';m.lineJoin='round';m.lineWidth=Number($('.pe-size').value);m.beginPath();m.moveTo(...prev);m.lineTo(...p);m.stroke();m.beginPath();m.arc(...p,m.lineWidth/2,0,Math.PI*2);m.fill();m.globalCompositeOperation='source-over';}
    output.onpointerdown=e=>{if(busy||!hasPhoto()||e.button!==0)return;e.preventDefault();const p=point(e);if(tool==='detect'){task(async()=>{status('Selecting connected colors…');const r=await call('process',{op:'detect',image:photo.toDataURL(),x:Math.floor(p[0]),y:Math.floor(p[1]),tolerance:Number($('.pe-tolerance').value)});snapshot();const keep=canvas();keep.width=mask.width;keep.height=mask.height;keep.getContext('2d').drawImage(mask,0,0);await loadMask(r.mask);mask.getContext('2d').drawImage(keep,0,0);render();status('Color region selected. Refine with Brush or Deselect.');});return;}snapshot();drawing=true;output.setPointerCapture(e.pointerId);last=p;polygon=[p];if(tool!=='lasso')stroke(p);render();};
    output.onpointermove=e=>{if(!drawing)return;const p=point(e);if(tool==='lasso')polygon.push(p);else stroke(p,last);last=p;render();};
    const finish=()=>{if(!drawing)return;if(tool==='lasso'&&polygon.length>2){const m=mask.getContext('2d');m.fillStyle='white';m.beginPath();polygon.forEach((p,i)=>i?m.lineTo(...p):m.moveTo(...p));m.closePath();m.fill();}drawing=false;render();};output.onpointerup=finish;output.onpointercancel=finish;
    for(const b of dialog.querySelectorAll('[data-tool]'))b.onclick=()=>{tool=b.dataset.tool;dialog.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));status(tool==='detect'?'Tap a connected color region. This is color selection, not semantic object detection.':tool==='lasso'?'Drag around the area; release to close the selection.':tool==='deselect'?'Brush over red areas to deselect them.':'Brush over the area you want to select.');};$('[data-tool=brush]').classList.add('active');
    async function modelEdit(kind='remove'){
        if(!hasPhoto()||!selected())return;
        if(!onModel)throw Error('Model editing is available through the main ComfyUI editor node.');
        status('Preparing the current photo and selection for model editing…');
        const o=canvas();o.width=original.width;o.height=original.height;o.getContext('2d').drawImage(original,0,0);
        const assets=await call('apply',{image:photo.toDataURL(),mask:exportMask(),original:o.toDataURL(),session_id:await ensureSession()});
        const instruction=kind==='outpaint'?'A natural continuation of the surrounding photograph, matching the existing scene, perspective, materials, colors and lighting.':$('.pe-instruction').value.trim();
        if(!instruction)throw Error('Enter the fill instruction before using the model.');
        const result=await onModel({...assets,editor_prompt:instruction},status);
        if(result.source_asset && result.source_asset!==assets.edited_asset)throw Error('Model result belongs to a different source image; current edit kept.');
        status('Downloading the completed edit…');
        const im=await serverImage('/pristine_eraser/asset/'+result.edited_asset);
        if(im.width!==photo.width||im.height!==photo.height)throw Error('Model returned unexpected dimensions. Previous edit was kept.');
        snapshot();revision++;photo.getContext('2d').clearRect(0,0,photo.width,photo.height);photo.getContext('2d').drawImage(im,0,0);
        mask.getContext('2d').clearRect(0,0,mask.width,mask.height);render();
        status('Model fill ready. Undo to compare; Save final image when satisfied; temporary editing files will then be removed.');
    }
    const actions={
        preload:()=>task(async()=>{if(!onPreload)throw Error('Open the editor through the main ComfyUI node to preload models.');status('Loading model, CLIP and VAE…');const r=await onPreload(status);status(`Preloaded ${r.components.join(', ')}. Retained for editing; GPU placement is managed by ComfyUI.`);}),
        release:()=>task(async()=>{if(!onRelease)throw Error('Model retention is available through the main node.');await onRelease(status);status('Editor model retention released. ComfyUI caches may still own the weights.');}),
        connection:()=>task(async()=>{const h=await requestJson(request,'/pristine_eraser/health',{},'Check editor connection');status(`Editor backend connected • version ${h.version}`);}),
        model:()=>task(()=>modelEdit('remove')),modeloutpaint:()=>task(()=>modelEdit('outpaint')),
        upload:()=> $('input[type=file]').click(),
        staged:()=>task(async()=>{if(dirty&&!confirm('Replace the current editing session?'))return;const r=await request('/pristine_eraser/slot?slot='+encodeURIComponent($('input[type=text]').value));const b=await r.json();if(!r.ok)throw Error(b.error);const image=await serverImage('/pristine_eraser/asset/'+b.asset);await discard();savedFinal=null;await load(image);}),
        clear:()=>{if(!hasPhoto())return;snapshot();mask.getContext('2d').clearRect(0,0,mask.width,mask.height);render();},
        undo:()=>task(async()=>{if(!undo.length)return;redo.push(pack());await restore(undo.pop());}),
        redo:()=>task(async()=>{if(!redo.length)return;undo.push(pack());await restore(redo.pop());}),
        fit,
        compare:()=>{if(!hasPhoto())return;compare=!compare;$('[data-action=compare]').textContent=compare?'Show edit':'Show original';render();},
        heal:()=>task(()=>modelEdit('remove')),
        blur:()=>{if(!hasPhoto()||!selected())return;snapshot();const b=canvas();b.width=photo.width;b.height=photo.height;const c=b.getContext('2d');c.filter='blur(12px)';c.drawImage(photo,0,0);c.filter='none';c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0);photo.getContext('2d').drawImage(b,0,0);render();status('Selected area blurred.');},
        cut:()=>{if(!hasPhoto()||!selected())return;snapshot();const c=photo.getContext('2d');c.globalCompositeOperation='destination-out';c.drawImage(mask,0,0);c.globalCompositeOperation='source-over';render();status('Selection made transparent. Use rgba output → Save Image to retain transparency.');},
        expand:()=>{
            if(!hasPhoto())return;
            const answer=prompt('Add pixels to LEFT, TOP, RIGHT, BOTTOM (example: 0,0,256,0)', '128,128,128,128');
            if(answer===null)return;
            const pad=answer.split(',').map(x=>Number(x.trim()));
            if(pad.length!==4||pad.some(x=>!Number.isInteger(x)||x<0||x>4096)){status('Enter four whole numbers from 0 to 4096.');return;}
            const [l,t,r,b]=pad,w=photo.width+l+r,h=photo.height+t+b;
            if(w*h>24000000){status('Expanded canvas exceeds 24 megapixels.');return;}
            snapshot();const old=canvas();old.width=photo.width;old.height=photo.height;old.getContext('2d').drawImage(photo,0,0);
            resize(w,h);const c=photo.getContext('2d');c.fillStyle='#808080';c.fillRect(0,0,w,h);c.drawImage(old,l,t);
            const m=mask.getContext('2d');m.fillStyle='white';m.fillRect(0,0,w,h);m.clearRect(l,t,old.width,old.height);
            render();fit();status('New borders selected. Click Outpaint with Model to fill them using the main node’s connected model.');
        },
        crop:()=>{
            if(!hasPhoto())return;
            const answer=prompt('Crop: LEFT, TOP, WIDTH, HEIGHT in pixels',`0,0,${photo.width},${photo.height}`);
            if(answer===null)return;const p=answer.split(',').map(x=>Number(x.trim()));
            if(p.length!==4||p.some(x=>!Number.isInteger(x))||p[0]<0||p[1]<0||p[2]<1||p[3]<1||p[0]+p[2]>photo.width||p[1]+p[3]>photo.height){status('Crop rectangle must be inside the current photo.');return;}
            snapshot();for(const c of [photo,mask]){const t=canvas();t.width=p[2];t.height=p[3];t.getContext('2d').drawImage(c,...p,0,0,p[2],p[3]);c.width=t.width;c.height=t.height;c.getContext('2d').drawImage(t,0,0);}
            output.width=photo.width;output.height=photo.height;render();fit();
        },
        rotate:()=>transform(true),flip:()=>transform(false),
        reset:()=>{if(!hasPhoto()||!confirm('Reset to the original photo?'))return;snapshot();revision=0;resize(original.width,original.height);photo.getContext('2d').drawImage(original,0,0);render();fit();}
    };
    async function restore(s){revision=s.revision||0;const im=await imageFrom(s.image),m=await imageFrom(s.mask);resize(im.width,im.height);photo.getContext('2d').clearRect(0,0,photo.width,photo.height);mask.getContext('2d').clearRect(0,0,mask.width,mask.height);photo.getContext('2d').drawImage(im,0,0);mask.getContext('2d').drawImage(m,0,0);dirty=true;render();fit();}
    function transform(rotate){if(!hasPhoto())return;snapshot();for(const c of [photo,mask]){const tmp=canvas();tmp.width=rotate?c.height:c.width;tmp.height=rotate?c.width:c.height;const x=tmp.getContext('2d');if(rotate){x.translate(tmp.width,0);x.rotate(Math.PI/2);}else{x.translate(tmp.width,0);x.scale(-1,1);}x.drawImage(c,0,0);c.width=tmp.width;c.height=tmp.height;c.getContext('2d').drawImage(tmp,0,0);}output.width=photo.width;output.height=photo.height;render();fit();}
    for(const b of dialog.querySelectorAll('[data-action]'))b.onclick=()=>actions[b.dataset.action]();
    $('.pe-zoom').oninput=e=>scale(Number(e.target.value)/100);
    $('input[type=file]').onchange=e=>task(async()=>{const f=e.target.files[0];if(!f)return;if(dirty&&!confirm('Replace the current editing session?'))return;const src=URL.createObjectURL(f);try{const image=await imageFrom(src);await discard();savedFinal=null;await load(image);}finally{URL.revokeObjectURL(src);e.target.value='';}});
    $('.pe-apply').onclick=()=>task(async()=>{
        if(!hasPhoto())return;
        if(!dirty&&savedFinal){status('This final image is already saved.');return;}
        status('Saving the final edited photo…');
        const result=await call('save_final',{image:photo.toDataURL(),session_id:await ensureSession()});
        // A successful save has already committed the pixels to output. Do not
        // recreate the editing history or masks after deleting the temp session.
        savedFinal=result;if(!result.cleanup_complete)pendingCleanup.push(sessionId);sessionId=null;
        mask.getContext('2d').clearRect(0,0,mask.width,mask.height);
        original=await imageFrom(photo.toDataURL());undo=[];redo=[];compare=false;
        $('[data-action=compare]').textContent='Show original';dirty=false;render();
        await onApply({...result,revision});
        status(result.cleanup_complete?`Saved final image: ${result.filename}. Temporary session removed.`:`Final image saved: ${result.filename}. Close the editor to retry temporary-file cleanup.`);
    });
    async function close(){
        if(busy)return;if(dirty&&!confirm('Discard this unsaved editing session?'))return;
        try{await discard();dialog.close();}catch(e){status('Could not remove temporary session: '+e.message);}
    }
    $('.pe-close').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};dialog.onclose=()=>{dialog.remove();style.remove();};
    if(state.edited_asset)await task(async()=>{await load(await serverImage('/pristine_eraser/asset/'+state.edited_asset));revision=state.revision??(state.edited_asset!==state.original_asset?1:0);if(state.original_asset)original=await serverImage('/pristine_eraser/asset/'+state.original_asset);if(state.mask_asset)await loadMask(await serverImage('/pristine_eraser/asset/'+state.mask_asset));dirty=false;render();status('Applied edit restored. Continue editing or close and Run.');});
}
