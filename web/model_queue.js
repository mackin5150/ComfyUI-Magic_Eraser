import { requestJson, readJobHistory } from './network.js';
// A separate prompt snapshot keeps interactive generation out of downstream Save Image.
export function buildModelPrompt(output, nodeId, assets, requestId, action='edit') {
    const id = String(nodeId);
    const prompt = JSON.parse(JSON.stringify(output));
    if (!prompt[id] || prompt[id].class_type !== 'PristineEditor')
        throw Error('Place the main editor on the root workflow canvas before using model editing.');
    const target = prompt[id];
    const required=action==='release'?[]:action==='preload'?['model','vae','clip']:['model','vae','positive','negative'];
    for (const name of required) {
        if (!Array.isArray(target.inputs[name]))
            throw Error(`Connect ${name.toUpperCase()} to the main editor node first.`);
    }
    Object.assign(target.inputs, assets, {model_request:requestId});
    target.class_type = 'PristineEditorRender';
    if (action==='preload') {
        for (const name of ['positive','negative']) delete target.inputs[name];
        for (const name of ['edited_asset','mask_asset','original_asset']) target.inputs[name]='';
    }
    if (action==='release') {
        for (const name of ['model','vae','clip','positive','negative']) delete target.inputs[name];
        for (const name of ['edited_asset','mask_asset','original_asset']) target.inputs[name]='';
    }
    const keep = new Set();
    function visit(key) {
        if (keep.has(key)) return;
        const entry = prompt[key];
        if (!entry) throw Error('A model connection is missing from the workflow.');
        keep.add(key);
        for (const value of Object.values(entry.inputs || {})) {
            if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'number') visit(String(value[0]));
        }
    }
    visit(id);
    return Object.fromEntries(Object.entries(prompt).filter(([key]) => keep.has(key)));
}

export async function queueModelEdit({output,nodeId,assets,requestId,request,clientId,
    pollMs=1000,timeoutMs=30*60*1000,onStatus=()=>{},action='edit',historyRetryMs=1000}) {
    const prompt = buildModelPrompt(output,nodeId,assets,requestId,action);
    // Never retry queue submissions: a dropped response may still have queued a job.
    const queued = await requestJson(request,'/prompt', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt,client_id:clientId,partial_execution_targets:[String(nodeId)]})},'Queue '+action);
    if (!queued.prompt_id) throw Error('Queue returned no prompt_id. Check ComfyUI Queue before retrying.');
    onStatus(action==='preload'?'Preload queued. Loading diffusion model, CLIP and VAE…':action==='release'?'Releasing editor model retention…':'Model edit queued. Filling the selection…');
    const deadline = Date.now()+timeoutMs;
    while (Date.now()<deadline) {
        const history=await readJobHistory(request,'/history/'+encodeURIComponent(queued.prompt_id),{delayMs:historyRetryMs});
        const entry = history[queued.prompt_id];
        if (entry) {
            if (entry.status?.status_str === 'error') {
                const message = entry.status.messages?.find(x => x[0] === 'execution_error')?.[1]?.exception_message;
                throw Error(message || 'Model editing failed or was interrupted. Check the ComfyUI log.');
            }
            const result = entry.outputs?.[String(nodeId)]?.pristine_result?.find(x=>x.request_id===requestId);
            if (result) return result;
            if (entry.status?.completed) throw Error('Model job finished without returning a result.');
        }
        await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
    throw Error('Model edit timed out. Check ComfyUI History for the completed job; your previous photo was kept.');
}
