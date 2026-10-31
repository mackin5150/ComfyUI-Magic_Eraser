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
sys.modules['folder_paths'] = types.SimpleNamespace(get_input_directory=lambda:DATA.name)
sys.modules['server'] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
spec = importlib.util.spec_from_file_location('pristine_test',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)])
package=importlib.util.module_from_spec(spec);sys.modules['pristine_test']=package;spec.loader.exec_module(package)
app.add_routes(routes)
async def page(request):
    return web.Response(text='''<!doctype html><body><script type="module">import {openEditor} from '/web/editor.js';openEditor({onApply:r=>window.applied=r});</script>''',content_type='text/html')
app.router.add_get('/',page)
app.router.add_static('/web',ROOT/'web')
if __name__=='__main__':web.run_app(app,host='127.0.0.1',port=8199)
