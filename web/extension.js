import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import { openEditor } from './editor.js?v=0.5.0';
import { requestJson } from './network.js?v=0.5.0';
import { queueModelEdit } from './model_queue.js?v=0.5.0';
app.registerExtension({
    name: 'Pristine.InteractiveEraser',
    nodeCreated(node) {
        if (node.comfyClass !== 'PristineEditor') return;
        node.properties ||= {};
        node.properties.pristine_residency_key ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        for (const name of ['model_request','residency_key','editor_prompt']) {
            const internal = node.widgets.find(w=>w.name===name);
            if (internal) {
                internal.type='converted-widget';
                internal.computeSize=()=>[0,-4];
                internal.serializeValue=()=>'';
            }
        }
        async function runModelAction(action,assets={},onStatus=()=>{}) {
            const health=await requestJson((p,o)=>api.fetchApi(p,o),'/pristine_eraser/health',{},'Check editor connection');
            if (health.version!=='0.5.0')throw Error('Editor/backend versions differ. Restart ComfyUI and hard-refresh this browser tab.');
            if (!health.preload) throw Error('Restart ComfyUI to load the updated editor backend.');
            const graph = await app.graphToPrompt();
            const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            const requestId=action==='edit'?token:`${action}:${token}`;
            return queueModelEdit({output:graph.output,nodeId:node.id,
                assets:{...assets,residency_key:node.properties.pristine_residency_key},requestId,action,serverReceipts:health.job_receipts===true,eventSource:api,
                clientId:api.clientId,request:(p,o)=>api.fetchApi(p,o),onStatus});
        }
        let managing=false;
        node.addWidget('button','Preload Models',null,async()=>{
            if(managing)return;managing=true;const title=node.title;
            try {
                node.title=title+' • Loading models…';app.graph.setDirtyCanvas(true,true);
                const result=await runModelAction('preload');
                alert(`Models preloaded: ${result.components.join(', ')}. Retained for editing; ComfyUI may offload under memory pressure.`);
            } catch(e) {alert(e.message);} finally {managing=false;node.title=title;app.graph.setDirtyCanvas(true,true);}
        });
        node.addWidget('button', 'Open Photo Editor', null, () => {
            const state = Object.fromEntries(node.widgets.filter(w => w.name.endsWith('_asset')).map(w => [w.name, w.value]));
            state.revision=node.properties.pristine_revision||0;
            openEditor({ state, url: p => api.apiURL(p), request: (p, options) => api.fetchApi(p, options),
                onModel:(assets,onStatus)=>runModelAction('edit',assets,onStatus),
                onPreload:onStatus=>runModelAction('preload',{},onStatus),
                onRelease:onStatus=>runModelAction('release',{},onStatus),
                onApply(result) {
                    node.properties.pristine_revision=result.revision||0;
                    for (const k of ['edited_asset','mask_asset','original_asset']) {
                        const w = node.widgets.find(w => w.name === k);
                        if (w) { w.value = result[k]; w.callback?.(result[k]); }
                    }
                    app.graph.setDirtyCanvas(true, true);
                }
            });
        });
    }
});
