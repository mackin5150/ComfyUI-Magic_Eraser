"""Optional generative companion. Models stay in ComfyUI's normal loaders."""
import torch
import torch.nn.functional as F

class PristineModelInpaint:
    @classmethod
    def INPUT_TYPES(cls):
        import comfy.samplers
        return {'required': {
            'image': ('IMAGE',), 'mask': ('MASK',), 'model': ('MODEL',), 'vae': ('VAE',),
            'positive': ('CONDITIONING',), 'negative': ('CONDITIONING',),
            'conditioning_mode': (['regular_checkpoint', 'dedicated_inpaint_checkpoint'],),
            'seed': ('INT', {'default':0, 'min':0, 'max':0xffffffffffffffff}),
            'steps': ('INT', {'default':28, 'min':1, 'max':200}),
            'cfg': ('FLOAT', {'default':5.0, 'min':0, 'max':30, 'step':0.1}),
            'sampler_name': (comfy.samplers.KSampler.SAMPLERS, {'default':'dpmpp_2m'}),
            'scheduler': (comfy.samplers.KSampler.SCHEDULERS, {'default':'karras'}),
            'denoise': ('FLOAT', {'default':1.0, 'min':0.01, 'max':1.0, 'step':0.01}),
            'render_max_side': ('INT', {'default':1024, 'min':256, 'max':4096, 'step':64}),
        }}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Pristine/Interactive Editor'
    DESCRIPTION = 'SD1.5/SDXL-style masked sampling, also for expanded outpaint canvases. Uses your MODEL, VAE and conditioning. Other architectures may require their native workflow.'
    def execute(self, image, mask, model, vae, positive, negative, conditioning_mode,
                seed, steps, cfg, sampler_name, scheduler, denoise, render_max_side, blend_pixels=0):
        import nodes
        source = image[..., :3]
        if source.shape[0] != 1 or mask.shape[0] != 1:
            raise ValueError('This editor companion expects one image and one mask')
        h,w = source.shape[1:3]
        if mask.shape[-2:] != (h,w): raise ValueError('Mask must match image dimensions')
        if not torch.any(mask > 0): raise ValueError('Empty mask: paint a selection or expand the canvas, then Apply to Node')
        # Keep render dimensions divisible by 8; preserve output size and unselected pixels.
        ratio = min(1.0, render_max_side/max(h,w))
        rh,rw = max(64,round(h*ratio/8)*8),max(64,round(w*ratio/8)*8)
        pixels = F.interpolate(source.movedim(-1,1),size=(rh,rw),mode='bilinear',align_corners=False).movedim(1,-1)
        selection = F.interpolate(mask[:,None].float(),size=(rh,rw),mode='nearest')[:,0]
        if conditioning_mode == 'dedicated_inpaint_checkpoint':
            positive,negative,latent = nodes.InpaintModelConditioning().encode(
                positive=positive,negative=negative,pixels=pixels,vae=vae,mask=selection,noise_mask=True)
        else:
            latent = nodes.VAEEncodeForInpaint().encode(vae=vae,pixels=pixels,mask=selection,grow_mask_by=6)[0]
        samples = nodes.common_ksampler(model,seed,steps,cfg,sampler_name,scheduler,positive,negative,latent,denoise=denoise)[0]
        generated = nodes.VAEDecode().decode(vae,samples)[0]
        generated = F.interpolate(generated[...,:3].movedim(-1,1),size=(h,w),mode='bilinear',align_corners=False).movedim(1,-1)
        m = mask.to(device=source.device,dtype=source.dtype).clamp(0,1)[...,None]
        if blend_pixels > 0:
            import cv2
            import numpy as np
            binary = (mask[0].detach().cpu().numpy() > 0).astype(np.uint8)
            distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
            feather = torch.from_numpy(np.minimum(distance / blend_pixels, 1.0)).to(device=source.device,dtype=source.dtype)
            m = m * feather[None,...,None]
        return (source*(1-m)+generated.to(source.device)*m,)
