"""Image operations; independent of ComfyUI for testing."""
import base64
import io
import re
from pathlib import Path
import uuid
import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_PIXELS = 24_000_000

def decode(value):
    if not isinstance(value, str) or len(value) > 100_000_000:
        raise ValueError('Image payload is missing or too large')
    raw = base64.b64decode(value.split(',', 1)[-1], validate=True)
    with Image.open(io.BytesIO(raw)) as im:
        if im.width * im.height > MAX_PIXELS:
            raise ValueError('Maximum image size is 24 megapixels')
        return ImageOps.exif_transpose(im).convert('RGBA')

def encode(im):
    out = io.BytesIO(); im.save(out, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()

def heal(image, mask, radius=5):
    a = np.array(image.convert('RGBA'))
    m = np.array(mask.convert('L'))
    if m.shape != a.shape[:2]:
        raise ValueError('Mask dimensions must match the image')
    m = (m > 0).astype(np.uint8) * 255
    if np.all(m):
        raise ValueError('Select part of the image, not the entire image')
    rgb = cv2.inpaint(a[:, :, :3], m, max(1, min(float(radius), 25)), cv2.INPAINT_TELEA)
    return Image.fromarray(np.dstack((rgb, a[:, :, 3])))

def detect(image, x, y, tolerance=24):
    rgb = np.array(image.convert('RGB'))
    h, w = rgb.shape[:2]
    x, y = int(x), int(y)
    if not (0 <= x < w and 0 <= y < h):
        raise ValueError('Click inside the photo')
    flood = np.zeros((h+2, w+2), np.uint8)
    t = max(0, min(int(tolerance), 100))
    cv2.floodFill(rgb, flood, (x, y), (0,0,0), (t,t,t), (t,t,t),
                  4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8))
    return Image.fromarray(flood[1:-1, 1:-1])

def safe_path(root, name):
    if not isinstance(name, str) or not re.fullmatch(r'[a-f0-9]{32}\.png', name):
        raise ValueError('Invalid editor asset reference')
    return Path(root) / name

def persist(root, im):
    Path(root).mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex + '.png'
    im.save(safe_path(root, name), 'PNG')
    return name
