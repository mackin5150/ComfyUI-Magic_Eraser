import assert from 'node:assert/strict';
import {buildModelPrompt,queueModelEdit} from '../web/model_queue.js';
const graph={
    '1':{class_type:'PristineEditor',inputs:{edited_asset:'old.png',model:['2',0],vae:['2',2],positive:['3',0],negative:['4',0]}},
    '2':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'example.safetensors'}},
    '3':{class_type:'CLIPTextEncode',inputs:{clip:['2',1],text:'continuous background'}},
    '4':{class_type:'CLIPTextEncode',inputs:{clip:['2',1],text:''}},
    '5':{class_type:'SaveImage',inputs:{images:['1',0]}},
    '6':{class_type:'SaveImage',inputs:{images:['7',0]}},
    '7':{class_type:'OtherGenerator',inputs:{}}
};
const assets={edited_asset:'new.png',mask_asset:'mask.png',original_asset:'original.png'};
const prompt=buildModelPrompt(graph,1,assets,'job-1');
assert.deepEqual(Object.keys(prompt),['1','2','3','4']);
assert.equal(prompt['1'].class_type,'PristineEditorRender');
assert.equal(prompt['1'].inputs.model_request,'job-1');
assert.equal(graph['1'].class_type,'PristineEditor');
assert.equal(graph['1'].inputs.edited_asset,'old.png');
assert.throws(()=>buildModelPrompt({'1':{class_type:'PristineEditor',inputs:{}}},1,assets,'x'),/Connect MODEL/);
assert.throws(()=>buildModelPrompt(graph,'missing',assets,'x'),/root workflow/);
let queued=false,polls=0;
const response=(data,ok=true)=>({ok,json:async()=>data});
const result=await queueModelEdit({output:graph,nodeId:1,assets,requestId:'job-1',pollMs:1,
    request:async(path,opts)=>{
        if(path==='/prompt'){
            const body=JSON.parse(opts.body);assert.deepEqual(body.partial_execution_targets,['1']);
            assert.equal(body.prompt['5'],undefined);queued=true;return response({prompt_id:'p1'});
        }
        assert.equal(path,'/history/p1');
        if(++polls===1)return response({});
        return response({'p1':{status:{completed:true,status_str:'success'},outputs:{'1':{pristine_result:[{request_id:'other'},{request_id:'job-1',...assets}]}}}});
    }});
assert.ok(queued);assert.equal(result.edited_asset,'new.png');assert.equal(polls,2);
await assert.rejects(()=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'x',request:async()=>response({error:{message:'bad model'}},false)}),/bad model/);
await assert.rejects(()=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'x',request:async(path)=>path==='/prompt'?response({prompt_id:'p2'}):response({'p2':{status:{status_str:'error',messages:[['execution_error',{exception_message:'out of memory'}]]}}})}),/out of memory/);
await assert.rejects(()=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'x',request:async(path)=>path==='/prompt'?response({prompt_id:'p3'}):response({'p3':{status:{status_str:'success',completed:true},outputs:{}}})}),/without returning/);
console.log('PASS: isolated model prompt, required connections, graph immutability, scoped history, queue failures and execution errors.');

// Preload has no photo, no text-encoding dependency, and no Save Image branch.
const withClip=JSON.parse(JSON.stringify(graph));withClip['1'].inputs.clip=['2',1];
const preload=buildModelPrompt(withClip,1,{residency_key:'session-1'},'preload:1','preload');
assert.deepEqual(Object.keys(preload),['1','2']);assert.equal(preload['1'].inputs.edited_asset,'');
const release=buildModelPrompt(withClip,1,{residency_key:'session-1'},'release:1','release');
assert.deepEqual(Object.keys(release),['1']);assert.equal(release['1'].inputs.clip,undefined);
assert.throws(()=>buildModelPrompt(graph,1,{},'preload:1','preload'),/Connect CLIP/);

const {requestJson,readJobHistory}=await import('../web/network.js');
await assert.rejects(()=>requestJson(async()=>{throw new TypeError('Failed to fetch');},'/pristine_eraser/apply',{},'Upload editor photo'),/Upload editor photo.*pristine_eraser\/apply.*Failed to fetch/);
await assert.rejects(()=>requestJson(async()=>({ok:false,status:413,json:async()=>({error:'Too large'})}),'/pristine_eraser/apply',{},'Upload'),/request-size limit/);
await assert.rejects(()=>requestJson(async()=>({ok:false,status:502,json:async()=>{throw Error('HTML');}}),'/prompt',{},'Queue'),/HTTP 502.*expected JSON/);
let attempts=0;
const recovered=await readJobHistory(async()=>{if(++attempts<3)throw new TypeError('Failed to fetch');return response({ok:true});},'/history/test',{delayMs:1});
assert.equal(attempts,3);assert.ok(recovered.ok);
let submitted=0;
await assert.rejects(()=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'x',request:async()=>{submitted++;throw new TypeError('Failed to fetch');}}),/Queue edit.*Failed to fetch/);
assert.equal(submitted,1);
console.log('PASS: preload/release graph isolation, endpoint-specific errors, upload limits, HTML proxy errors, safe history retries and no duplicate queue submissions.');

// A model result is recovered even when ComfyUI History remains an empty snapshot.
let receiptReads=0;const recoveredReceipt={request_id:'ledger-edit',edited_asset:'finished.png',source_asset:assets.edited_asset};
const receiptResult=await queueModelEdit({output:graph,nodeId:1,assets,requestId:'ledger-edit',serverReceipts:true,pollMs:1,historyRetryMs:1,
 request:async(p,o)=>{
   if(p==='/prompt')return response({prompt_id:'ledger-prompt'});
   if(p.startsWith('/pristine_eraser/job/')){assert.equal(o.cache,'no-store');return response(++receiptReads===1?{request_id:'ledger-edit',state:'running',phase:'Sampling'}:{request_id:'ledger-edit',state:'completed',result:recoveredReceipt});}
   return response({});
 }});
assert.equal(receiptResult.edited_asset,'finished.png');assert.equal(receiptReads,2);
const removeGraph=JSON.parse(JSON.stringify(graph));removeGraph['1'].inputs.clip=['2',1];
const removal=buildModelPrompt(removeGraph,1,{...assets,editor_prompt:'continue the surrounding photo'},'remove');
assert.deepEqual(Object.keys(removal),['1','2']);assert.equal(removal['1'].inputs.positive,undefined);
await assert.rejects(()=>queueModelEdit({output:graph,nodeId:1,assets,requestId:'bad-ledger',serverReceipts:true,
 request:async p=>p==='/prompt'?response({prompt_id:'bad'}):response({request_id:'bad-ledger',state:'failed',error:'model stopped'})}),/model stopped/);
console.log('PASS: completed worker receipt replaces stale/empty History; removal instruction excludes unrelated workflow prompts; worker errors reach UI.');

// Result notification is scoped to the request and listeners are removed afterward.
let listener,removed=0;
const eventSource={addEventListener:(name,fn)=>{listener=fn;},removeEventListener:(name,fn)=>{assert.equal(fn,listener);removed++;}};
const fast=await queueModelEdit({output:graph,nodeId:1,assets,requestId:'event-job',eventSource,
 request:async p=>{assert.equal(p,'/prompt');listener({detail:{request_id:'unrelated',edited_asset:'wrong'}});listener({detail:{request_id:'event-job',edited_asset:'direct.png'}});return response({prompt_id:'event-prompt'});}});
assert.equal(fast.edited_asset,'direct.png');assert.equal(removed,1);
console.log('PASS: direct completion event updates the waiting request without History, ignores unrelated jobs and removes the listener.');
