from pathlib import Path
import asyncio
import hashlib
import json
import numpy as np
import torch
from PIL import Image
from aiohttp import web
import folder_paths
from server import PromptServer
from .core import decode, encode, heal, detect, persist, safe_path

from .residency import RESIDENCY

VERSION = "0.3.0"
WEB_DIRECTORY = './web'

def root():
    return Path(folder_paths.get_input_directory()) / 'pristine_eraser'

def load(name):
    with Image.open(safe_path(root(), name)) as im:
        return im.copy()

def tensor(im):
    return torch.from_numpy(np.array(im.convert('RGB')).astype(np.float32) / 255)[None, ...]

def asset_hash(name):
    return hashlib.sha256(safe_path(root(), name).read_bytes()).hexdigest() if name else ''

class PristineEditor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {k: ('STRING', {'default': ''}) for k in ('edited_asset', 'mask_asset', 'original_asset')},
            'optional': {
                'model': ('MODEL', {'lazy': True}), 'vae': ('VAE', {'lazy': True}),
                'positive': ('CONDITIONING', {'lazy': True}), 'negative': ('CONDITIONING', {'lazy': True}),
                'conditioning_mode': (['regular_checkpoint', 'dedicated_inpaint_checkpoint'],),
                'seed': ('INT', {'default':0, 'min':0, 'max':0xffffffffffffffff}),
                'steps': ('INT', {'default':28, 'min':1, 'max':200}),
                'cfg': ('FLOAT', {'default':5.0, 'min':0, 'max':30, 'step':0.1}),
                'guidance': ('FLOAT', {'default':30.0, 'min':0.0, 'max':100.0, 'step':0.5}),
                'sampler_name': (['dpmpp_2m','euler','euler_ancestral','dpmpp_sde'],),
                'scheduler': (['karras','normal','simple','sgm_uniform'],),
                'denoise': ('FLOAT', {'default':1.0, 'min':0.01, 'max':1.0, 'step':0.01}),
                'render_max_side': ('INT', {'default':1024, 'min':256, 'max':4096, 'step':64}),
                'blend_pixels': ('INT', {'default':4, 'min':0, 'max':64}),
                'model_request': ('STRING', {'default':''}),
                'clip': ('CLIP', {'lazy':True}),
                'keep_loaded': ('BOOLEAN', {'default':True}),
                'residency_key': ('STRING', {'default':''}),
            }, 'hidden': {'unique_id':'UNIQUE_ID'}}
    RETURN_TYPES = ('IMAGE', 'MASK', 'IMAGE', 'IMAGE')
    RETURN_NAMES = ('image', 'selection_mask', 'original', 'rgba')
    FUNCTION = 'execute'
    CATEGORY = 'Pristine/Interactive Editor'
    DESCRIPTION = 'Open Editor and edit interactively. Connect optional MODEL/VAE/conditioning for Remove with Model and Outpaint with Model. Normal Run exports applied assets.'
    @classmethod
    def IS_CHANGED(cls, **kw):
        return tuple(asset_hash(kw.get(k,'')) for k in ('edited_asset','mask_asset','original_asset')) + (kw.get('model_request',''),)
    def check_lazy_status(self, model_request='', model=None, vae=None, positive=None, negative=None, clip=None, **kw):
        # Ordinary Save Image runs do not load or evaluate the model branch.
        if not model_request or model_request.startswith('release:'): return []
        if model_request.startswith('preload:'):
            return [k for k,v in {'model':model,'vae':vae,'clip':clip}.items() if v is None]
        missing = [k for k,v in {'model':model,'vae':vae,'positive':positive,'negative':negative}.items() if v is None]
        # CLIP is not needed for sampling when conditioning is already computed.
        # The preload action explicitly evaluates and retains its optional connection.
        return missing

    def execute(self, edited_asset, mask_asset, original_asset, model=None, vae=None,
                positive=None, negative=None, conditioning_mode='regular_checkpoint', seed=0,
                steps=28, cfg=5.0, guidance=30.0, sampler_name='dpmpp_2m', scheduler='karras', denoise=1.0,
                render_max_side=1024, blend_pixels=4, model_request='', clip=None, keep_loaded=True, residency_key='', unique_id=None):
        key = residency_key or str(unique_id or 'default')
        if model_request.startswith('release:'):
            status = RESIDENCY.release(key)
            return {'ui': {'pristine_result': [{'request_id':model_request, **status}]}, 'result': self._empty_outputs()}
        if model_request.startswith('preload:'):
            if any(x is None for x in (model, vae, clip)):
                raise ValueError('Connect MODEL, VAE and CLIP to the main node before Preload Models.')
            status = RESIDENCY.hold(key, model, vae, clip, warm=True)
            return {'ui': {'pristine_result': [{'request_id':model_request, **status}]}, 'result': self._empty_outputs()}
        if model_request and any(x is None for x in (model, vae, positive, negative)):
            raise ValueError('Connect MODEL, VAE, positive and negative conditioning to the main editor node first.')
        if not edited_asset:
            raise ValueError('Open Editor, load a photo, then click Apply to Node before Run.')
        im = load(edited_asset).convert('RGBA')
        original = load(original_asset) if original_asset else im
        mask = load(mask_asset).convert('L') if mask_asset else Image.new('L', im.size)
        if mask.size != im.size:
            raise ValueError('Selection mask dimensions differ from image')
        selection = torch.from_numpy(np.array(mask).astype(np.float32)/255)[None,...]
        if model_request:
            from .model_nodes import PristineModelInpaint
            generated = PristineModelInpaint().execute(
                tensor(im), selection, model, vae, positive, negative, conditioning_mode,
                seed, steps, cfg, sampler_name, scheduler, denoise, render_max_side, blend_pixels, guidance=guidance)[0]
            rgb = np.clip(generated[0].detach().cpu().numpy()*255, 0, 255).round().astype(np.uint8)
            # Regenerated cutouts become opaque; untouched alpha remains unchanged.
            alpha = np.array(im.getchannel('A')).copy()
            alpha[np.array(mask) > 0] = 255
            im = Image.fromarray(np.dstack((rgb,alpha)))
            result_assets = {
                'edited_asset': persist(root(), im),
                'mask_asset': persist(root(), Image.new('L', im.size)),
                'original_asset': original_asset or persist(root(), original),
            }
            selection = torch.zeros_like(selection)
            if keep_loaded:
                # Keep live references. Preload explicitly warms all components; do
                # not move weights after every decode and add another transfer.
                RESIDENCY.hold(key, model, vae, clip, positive, negative, warm=False)
            else:
                RESIDENCY.release(key)
        rgba = torch.from_numpy(np.array(im).astype(np.float32) / 255)[None, ...]
        outputs = (tensor(im), selection, tensor(original), rgba)
        if model_request:
            return {'ui': {'pristine_result': [{'request_id':model_request, **result_assets}]}, 'result':outputs}
        return outputs

    @staticmethod
    def _empty_outputs():
        return (torch.zeros((1,1,1,3)), torch.zeros((1,1,1)),
                torch.zeros((1,1,1,3)), torch.zeros((1,1,1,4)))

class PristineEditorRender(PristineEditor):
    # Queue-only output variant lets the UI execute the editor without Save Image.
    # The normal editor remains a regular node, so unrelated Run actions do not execute it.
    OUTPUT_NODE = True
    CATEGORY = 'Pristine/Internal'

class PristineSend:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'image': ('IMAGE',), 'slot': ('STRING', {'default': 'default'}),
                            'batch_index': ('INT', {'default': 0, 'min': 0, 'max': 99999})}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    OUTPUT_NODE = True
    CATEGORY = 'Pristine/Interactive Editor'
    def execute(self, image, slot, batch_index):
        if batch_index >= len(image):
            raise ValueError('batch_index exceeds the incoming image batch')
        a = image[batch_index].detach().cpu().numpy()
        name = persist(root(), Image.fromarray(np.clip(a*255,0,255).astype(np.uint8)))
        # Slot pointer is atomic; image assets are immutable.
        key = hashlib.sha256(slot.encode()).hexdigest()
        pointer = root() / (key + '.json')
        tmp = root() / (name + '.json')
        tmp.write_text(json.dumps({'asset':name})); tmp.replace(pointer)
        return {'ui': {'text': [f'Staged photo in slot: {slot}. Open Editor and click Load from Node.']}, 'result': (image,)}

class PristineRGBA:
    @classmethod
    def INPUT_TYPES(cls): return {'required': {'rgba': ('IMAGE',)}}
    RETURN_TYPES = ('IMAGE', 'MASK')
    RETURN_NAMES = ('rgb', 'alpha_mask')
    FUNCTION = 'execute'
    CATEGORY = 'Pristine/Interactive Editor'
    def execute(self, rgba):
        alpha = rgba[...,3] if rgba.shape[-1] == 4 else torch.ones_like(rgba[...,0])
        return rgba[...,:3], 1-alpha

async def process(request, fn):
    try:
        body = await request.json()
        result = await asyncio.to_thread(fn, body)
        return web.json_response(result)
    except (ValueError, KeyError, TypeError, OSError) as e:
        return web.json_response({'error': str(e)}, status=400)

def operation(b):
    im = decode(b['image'])
    if b['op'] == 'heal': return {'image': encode(heal(im, decode(b['mask']), b.get('radius',5)))}
    if b['op'] == 'detect': return {'mask': encode(detect(im,b['x'],b['y'],b.get('tolerance',24)).convert('RGBA'))}
    raise ValueError('Unknown operation')

@PromptServer.instance.routes.get('/pristine_eraser/health')
async def health(request):
    return web.json_response({'ok': True, 'version': VERSION, 'preload': True})

@PromptServer.instance.routes.post('/pristine_eraser/process')
async def do_process(request): return await process(request, operation)

@PromptServer.instance.routes.post('/pristine_eraser/apply')
async def do_apply(request):
    def save(b):
        im, mask, original = decode(b['image']), decode(b['mask']), decode(b['original'])
        if mask.size != im.size: raise ValueError('Mask dimensions must match image')
        return {'edited_asset': persist(root(),im), 'mask_asset':persist(root(),mask.convert('L')),
                'original_asset':persist(root(),original)}
    return await process(request, save)

@PromptServer.instance.routes.get('/pristine_eraser/asset/{name}')
async def get_asset(request):
    try: path = safe_path(root(), request.match_info['name'])
    except ValueError: raise web.HTTPBadRequest()
    if not path.is_file(): raise web.HTTPNotFound()
    return web.FileResponse(path)

@PromptServer.instance.routes.get('/pristine_eraser/slot')
async def get_slot(request):
    key = hashlib.sha256(request.query.get('slot','default').encode()).hexdigest()
    path = root() / (key + '.json')
    if not path.is_file(): return web.json_response({'error':'No photo in this slot. Run Send to Editor first.'},status=404)
    return web.json_response(json.loads(path.read_text()))

NODE_CLASS_MAPPINGS = {'PristineEditor':PristineEditor,'PristineSendToEditor':PristineSend,'PristineSplitAlpha':PristineRGBA}
NODE_DISPLAY_NAME_MAPPINGS = {'PristineEditor':'Pristine • Open Photo Editor', 'PristineSendToEditor':'Pristine • Send to Editor', 'PristineSplitAlpha':'Pristine • Split Alpha'}

from .model_nodes import PristineModelInpaint
NODE_CLASS_MAPPINGS['PristineModelInpaint'] = PristineModelInpaint
NODE_DISPLAY_NAME_MAPPINGS['PristineModelInpaint'] = 'Pristine • Model Inpaint / Outpaint'

NODE_CLASS_MAPPINGS['PristineEditorRender'] = PristineEditorRender
NODE_DISPLAY_NAME_MAPPINGS['PristineEditorRender'] = 'Pristine • Internal Editor Render (automatic)'
