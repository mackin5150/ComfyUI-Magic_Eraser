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
        return {'required': {k: ('STRING', {'default': ''}) for k in ('edited_asset', 'mask_asset', 'original_asset')}}
    RETURN_TYPES = ('IMAGE', 'MASK', 'IMAGE', 'IMAGE')
    RETURN_NAMES = ('image', 'selection_mask', 'original', 'rgba')
    FUNCTION = 'execute'
    CATEGORY = 'Pristine/Interactive Editor'
    DESCRIPTION = 'Open Editor, upload or load a staged photo, edit and Apply to Node. Run only exports the applied assets.'
    @classmethod
    def IS_CHANGED(cls, **kw):
        return tuple(asset_hash(kw.get(k,'')) for k in ('edited_asset','mask_asset','original_asset'))
    def execute(self, edited_asset, mask_asset, original_asset):
        if not edited_asset:
            raise ValueError('Open Editor, load a photo, then click Apply to Node before Run.')
        im = load(edited_asset).convert('RGBA')
        original = load(original_asset) if original_asset else im
        mask = load(mask_asset).convert('L') if mask_asset else Image.new('L', im.size)
        if mask.size != im.size:
            raise ValueError('Selection mask dimensions differ from image')
        rgba = torch.from_numpy(np.array(im).astype(np.float32) / 255)[None, ...]
        return tensor(im), torch.from_numpy(np.array(mask).astype(np.float32)/255)[None,...], tensor(original), rgba

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
