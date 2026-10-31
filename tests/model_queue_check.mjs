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
