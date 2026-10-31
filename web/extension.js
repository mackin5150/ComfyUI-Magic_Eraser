import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import { openEditor } from './editor.js';
import { queueModelEdit } from './model_queue.js';
app.registerExtension({
    name: 'Pristine.InteractiveEraser',
    nodeCreated(node) {
        if (node.comfyClass !== 'PristineEditor') return;
        const internal = node.widgets.find(w=>w.name==='model_request');
        if (internal) {
            internal.type='converted-widget';
            internal.computeSize=()=>[0,-4];
            internal.serializeValue=()=>'';
        }
        node.addWidget('button', 'Open Photo Editor', null, () => {
            const state = Object.fromEntries(node.widgets.filter(w => w.name.endsWith('_asset')).map(w => [w.name, w.value]));
            openEditor({ state, url: p => api.apiURL(p), request: (p, options) => api.fetchApi(p, options),
                async onModel(assets,onStatus) {
                    const graph = await app.graphToPrompt();
                    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
                    return queueModelEdit({output:graph.output,nodeId:node.id,assets,requestId,
                        clientId:api.clientId,request:(p,o)=>api.fetchApi(p,o),onStatus});
                },
                onApply(result) {
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
