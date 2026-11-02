"""Bounded strong references to editor model bundles; GPU placement stays with ComfyUI."""
from collections import OrderedDict
import threading

class ModelResidency:
    def __init__(self, max_sessions=2):
        self._sessions = OrderedDict()
        self._lock = threading.RLock()
        self.max_sessions = max_sessions

    def hold(self, key, model, vae, clip=None, positive=None, negative=None, warm=True):
        with self._lock:
            previous = self._sessions.get(key)
            if clip is None and previous and previous[0] is model and previous[1] is vae:
                clip = previous[2]
        patchers = [model]
        for owner in (vae, clip):
            patcher = getattr(owner, 'patcher', None)
            if patcher is not None and all(patcher is not x for x in patchers):
                patchers.append(patcher)
        # Called only from ComfyUI's prompt worker, never an HTTP callback.
        if warm:
            import comfy.model_management as mm
            mm.load_models_gpu(patchers)
        with self._lock:
            self._sessions.pop(key, None)
            self._sessions[key] = (model, vae, clip, positive, negative)
            while len(self._sessions) > self.max_sessions:
                self._sessions.popitem(last=False)
        return {'retained': True, 'components': ['diffusion', 'vae'] + (['clip'] if clip is not None else []),
                'gpu_residency': 'ComfyUI managed; memory pressure can still offload weights'}

    def release(self, key):
        with self._lock:
            removed = self._sessions.pop(key, None) is not None
        return {'retained': False, 'released': removed,
                'message': 'Editor retention released. ComfyUI caches may still own these models.'}

RESIDENCY = ModelResidency()
