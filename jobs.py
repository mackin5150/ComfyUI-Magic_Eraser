"""Small durable receipts let the editor recover completed jobs independently of History."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time

class JobReceipts:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()

    def path(self, request_id):
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 160:
            raise ValueError('Invalid editor request ID')
        return self.root / (hashlib.sha256(request_id.encode()).hexdigest() + '.json')

    def read(self, request_id):
        path = self.path(request_id)
        with self.lock:
            if not path.exists(): return {'request_id': request_id, 'state': 'waiting'}
            return json.loads(path.read_text())

    def write(self, request_id, **data):
        path = self.path(request_id)
        payload = {'request_id': request_id, 'updated_at': time.time(), **data}
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(dir=self.root, suffix='.tmp')
            try:
                with os.fdopen(fd, 'w') as f: json.dump(payload, f)
                os.replace(name, path)
            finally:
                if os.path.exists(name): os.unlink(name)
        return payload
