import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import { openEditor } from './editor.js';
app.registerExtension({
    name: 'Pristine.InteractiveEraser',
    nodeCreated(node) {
        if (node.comfyClass !== 'PristineEditor') return;
        node.addWidget('button', 'Open Photo Editor', null, () => {
            const state = Object.fromEntries(node.widgets.filter(w => w.name.endsWith('_asset')).map(w => [w.name, w.value]));
            openEditor({ state, url: p => api.apiURL(p), request: (p, options) => api.fetchApi(p, options),
                onApply(result) {
                    for (const [k,v] of Object.entries(result)) {
                        const w = node.widgets.find(w => w.name === k);
                        if (w) { w.value = v; w.callback?.(v); }
                    }
                    app.graph.setDirtyCanvas(true, true);
                }
            });
        });
    }
});
