export async function requestJson(request,path,options={},phase='Request') {
    let response;
    try { response=await request(path,options); }
    catch(e) {
        throw Error(`${phase} (${path}): ${e.message || 'Failed to fetch'}. Browser could not reach ComfyUI. Check the server terminal and your Vast proxy/tunnel connection. This does not by itself identify a model error.`);
    }
    if(response.status===413)throw Error(`${phase} (${path}): HTTP 413 — Photo upload exceeded the server/proxy request-size limit. Try a smaller image.`);
    let data;
    try { data=await response.json(); }
    catch {
        throw Error(`${phase} (${path}): HTTP ${response.status || 'unknown'}, expected JSON. A proxy/login/error page may have answered; check the ComfyUI URL and server log.`);
    }
    if (!response.ok) {
        const detail=typeof data.error==='string'?data.error:data.error?.message;
        const errors=Object.values(data.node_errors||{}).flatMap(x=>x.errors||[]).map(x=>x.details||x.message).join('; ');
        throw Error(`${phase} (${path}): HTTP ${response.status || 'error'} — ${errors||detail||'Request rejected'}` +
            (response.status===413?' Photo upload exceeded the server/proxy request-size limit. Try a smaller image.':'') +
            (response.status===404?' Restart ComfyUI after updating the custom node and refresh the browser.':''));
    }
    return data;
}

export async function readJobHistory(request,path,{attempts=4,delayMs=1000}={}) {
    let last;
    for(let i=0;i<attempts;i++) {
        try{return await requestJson(request,path,{},'Read model job');}
        catch(e){last=e;if(i+1<attempts)await new Promise(r=>setTimeout(r,delayMs));}
    }
    throw last;
}
