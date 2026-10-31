// A separate prompt snapshot keeps interactive generation out of downstream Save Image.
export function buildModelPrompt(output, nodeId, assets, requestId) {
    const id = String(nodeId);
    const prompt = JSON.parse(JSON.stringify(output));
    if (!prompt[id] || prompt[id].class_type !== 'PristineEditor')
        throw Error('Place the main editor on the root workflow canvas before using model editing.');
    const target = prompt[id];
    for (const name of ['model','vae','positive','negative']) {
        if (!Array.isArray(target.inputs[name]))
            throw Error(`Connect ${name.toUpperCase()} to the main editor node first.`);
    }
    Object.assign(target.inputs, assets, {model_request:requestId});
    target.class_type = 'PristineEditorRender';
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
    pollMs=1000,timeoutMs=30*60*1000,onStatus=()=>{}}) {
    const prompt = buildModelPrompt(output,nodeId,assets,requestId);
    const r = await request('/prompt', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt,client_id:clientId,partial_execution_targets:[String(nodeId)]})});
    const queued = await r.json();
    if (!r.ok || !queued.prompt_id) {
        const details = Object.values(queued.node_errors || {}).flatMap(x => x.errors || []).map(x => x.details || x.message).join('; ');
        throw Error(details || queued.error?.message || queued.error || 'Could not queue model editing.');
    }
    onStatus('Model edit queued. ComfyUI will load the connected model and fill the selection…');
    const deadline = Date.now()+timeoutMs;
    while (Date.now()<deadline) {
        const h = await request('/history/'+encodeURIComponent(queued.prompt_id));
        if (!h.ok) throw Error('Could not read model job history. Your edit is still available in the editor.');
        const entry = (await h.json())[queued.prompt_id];
        if (entry) {
            if (entry.status?.status_str === 'error') {
                const message = entry.status.messages?.find(x => x[0] === 'execution_error')?.[1]?.exception_message;
                throw Error(message || 'Model editing failed or was interrupted. Check the ComfyUI log.');
            }
            const result = entry.outputs?.[String(nodeId)]?.pristine_result?.find(x=>x.request_id===requestId);
            if (result) return result;
            if (entry.status?.completed) throw Error('Model job finished without returning an edited photo.');
        }
        await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
    throw Error('Model edit timed out. Check ComfyUI History for the completed job; your previous photo was kept.');
}
