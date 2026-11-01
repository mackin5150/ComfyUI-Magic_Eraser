"""Session-owned temporary images; only the final frame is committed to output."""
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
import uuid
from PIL import Image

LOCK = threading.RLock()
IDENTIFIER = re.compile(r'^[a-f0-9]{32}$')
IMAGE_NAME = re.compile(r'^[a-f0-9]{32}\.png$')

class SessionStore:
    def __init__(self, temp_root, output_root, legacy_root):
        self.temp_root=Path(temp_root); self.output_root=Path(output_root); self.legacy_root=Path(legacy_root)

    def directory(self, session_id, require=True):
        if not isinstance(session_id,str) or not IDENTIFIER.fullmatch(session_id):
            raise ValueError('Invalid editor session')
        path=self.temp_root/'sessions'/session_id
        if path.is_symlink(): raise ValueError('Invalid editor session directory')
        if require and not path.is_dir(): raise ValueError('Editing session expired. Reopen the photo to continue.')
        return path

    def create(self):
        self.prune_idle()
        session_id=uuid.uuid4().hex
        self.directory(session_id,False).mkdir(parents=True)
        return session_id

    @staticmethod
    def session_of(ref):
        if isinstance(ref,str) and ref.startswith('session:'):
            fields=ref.split(':')
            if len(fields)==3 and IDENTIFIER.fullmatch(fields[1]) and IMAGE_NAME.fullmatch(fields[2]):return fields[1]
            raise ValueError('Invalid temporary image reference')
        return None

    def resolve(self, ref):
        session_id=self.session_of(ref)
        if session_id:return self.directory(session_id)/ref.split(':')[2]
        if isinstance(ref,str) and ref.startswith('final:'):
            name=ref[6:]
            if IMAGE_NAME.fullmatch(name):return self.output_root/name
        elif isinstance(ref,str) and ref.startswith('stage:'):
            name=ref[6:]
            if IMAGE_NAME.fullmatch(name):return self.temp_root/'staged'/name
        elif isinstance(ref,str) and IMAGE_NAME.fullmatch(ref):
            return self.legacy_root/ref
        raise ValueError('Invalid editor asset reference')

    def persist(self, image, session_id):
        with LOCK:
            directory=self.directory(session_id)
            name=uuid.uuid4().hex+'.png';image.save(directory/name,'PNG')
            os.utime(directory,None)
        return f'session:{session_id}:{name}'

    @contextmanager
    def active_job(self, ref):
        session_id=self.session_of(ref)
        if not session_id:
            yield;return
        with LOCK:
            directory=self.directory(session_id)
            marker=directory/(uuid.uuid4().hex+'.active');marker.touch()
        try:yield
        finally:
            with LOCK:marker.unlink(missing_ok=True)

    def cleanup(self, session_id):
        with LOCK:
            directory=self.directory(session_id,False)
            if not directory.exists():return
            if list(directory.glob('*.active')):raise ValueError('A model job is still using this editing session. Wait for it to finish.')
            shutil.rmtree(directory)

    def save_final(self, image, session_id):
        with LOCK:
            directory=self.directory(session_id,False)
            if directory.exists() and list(directory.glob('*.active')):raise ValueError('Wait for the model job before saving the final image.')
            self.output_root.mkdir(parents=True,exist_ok=True)
            name=session_id+'.png';destination=self.output_root/name
            if destination.exists():
                cleaned=True
                try:self.cleanup(session_id)
                except OSError:cleaned=False
                ref='final:'+name
                return {'edited_asset':ref,'mask_asset':'','original_asset':ref,'filename':name,
                        'subfolder':'pristine_eraser','type':'output','cleanup_complete':cleaned,'session_id':session_id}
            self.directory(session_id)
            fd, temporary=tempfile.mkstemp(dir=self.output_root,suffix='.tmp')
            os.close(fd)
            try:
                image.save(temporary,'PNG')
                os.replace(temporary,destination)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)
            # Cleanup is after the atomic final write, so failures never erase an unsaved edit.
            cleaned=True
            try:self.cleanup(session_id)
            except OSError:cleaned=False
            ref='final:'+name
            return {'edited_asset':ref,'mask_asset':'','original_asset':ref,
                    'filename':name,'subfolder':'pristine_eraser','type':'output',
                    'cleanup_complete':cleaned,'session_id':session_id}

    def prune_idle(self, age_seconds=24*60*60):
        parent=self.temp_root/'sessions'
        if not parent.exists():return
        for directory in parent.iterdir():
            if not IDENTIFIER.fullmatch(directory.name) or directory.is_symlink() or not directory.is_dir():continue
            if time.time()-directory.stat().st_mtime>age_seconds:
                try:self.cleanup(directory.name)
                except (ValueError,OSError):pass
