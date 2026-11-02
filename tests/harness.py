"""Standalone integration harness: real routes + tensors, stub ComfyUI host only."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
from aiohttp import web

ROOT = Path(__file__).resolve().parents[1]
DATA = tempfile.TemporaryDirectory()
app = web.Application(client_max_size=250*1024*1024)
routes = web.RouteTableDef()
sys.modules['folder_paths'] = types.SimpleNamespace(get_input_directory=lambda:str(Path(DATA.name)/'input'), get_temp_directory=lambda:str(Path(DATA.name)/'temp'), get_output_directory=lambda:str(Path(DATA.name)/'output'))
sys.modules['server'] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
spec = importlib.util.spec_from_file_location('pristine_test',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)])
package=importlib.util.module_from_spec(spec);sys.modules['pristine_test']=package;spec.loader.exec_module(package)
app.add_routes(routes)
async def page(request):
    return web.Response(text='''<!doctype html><body><script type="module">import {openEditor} from '/web/editor.js';openEditor({onApply:r=>window.applied=r});</script>''',content_type='text/html')
app.router.add_get('/',page)
app.router.add_static('/web',ROOT/'web')

# Optional host simulation for queue-to-worker-to-canvas regression testing.
# It is enabled only when executing this harness, never by importing the node suite.
if __name__ == '__main__' and '--mock-queue' in sys.argv:
    import asyncio
    import json
    import uuid
    import torch
    class Encoder:
        def encode(self, clip, text):return ([['encoded',{'text':text}]],)
    sys.modules['nodes']=types.SimpleNamespace(CLIPTextEncode=Encoder)
    def simulated_fill(self,image,mask,*args,**kw):
        color=torch.tensor([0.,0.,1.]) if image[0,115,155,0]>.9 else torch.tensor([1.,0.,0.])
        return (image*(1-mask[...,None])+color*mask[...,None],)
    package.PristineModelInpaint.execute=simulated_fill
    tasks=set()
    async def submit(request):
        body=await request.json();prompt=body['prompt'];node_id=body['partial_execution_targets'][0]
        inputs=dict(prompt[node_id]['inputs'])
        for key in ['model','vae','clip','positive','negative']:
            if isinstance(inputs.get(key),list):inputs[key]=object() if key in ['model','vae','clip'] else []
        prompt_id=uuid.uuid4().hex
        async def worker():
            try:await asyncio.to_thread(package.PristineEditorRender().execute,**inputs)
            except Exception:pass  # The production worker wrote the failure receipt.
        task=asyncio.create_task(worker());tasks.add(task);task.add_done_callback(tasks.discard)
        return web.json_response({'prompt_id':prompt_id})
    async def empty_history(request):return web.json_response({})
    async def storage(request):
        st=package.store()
        return web.json_response({'output_images':[p.name for p in st.output_root.glob('*.png')],
            'temp_sessions':[p.name for p in (st.temp_root/'sessions').glob('*') if p.is_dir()],
            'legacy_images':[p.name for p in package.root().glob('*.png')]})
    app.router.add_post('/prompt',submit);app.router.add_get('/history/{prompt_id}',empty_history)
    app.router.add_get('/test/storage',storage)

if __name__=='__main__':web.run_app(app,host='127.0.0.1',port=8199)
