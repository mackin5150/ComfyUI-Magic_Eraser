# ComfyUI Magic Eraser — Pristine Interactive Suite

An interactive photo editor for ComfyUI, inspired by the supplied yellow-sleeve editor reference. Open the editor, work on a photo, **Apply to Node**, then **Run** to export. The main editor node never launches a model by itself.

## Included

- Dark responsive editor with a large image area and red selection overlay.
- Brush, freehand lasso, color-region Detect, and Deselect brush; adjustable brush and tolerance.
- Local object repair (OpenCV Telea), selective blur, transparent cutout, rotate and flip.
- Undo/redo (12 steps), original comparison, zoom, and fit.
- Expand any of the four canvas edges for outpainting; new borders become the selection mask.
- Upload photos directly or stage images from another ComfyUI node.
- Model Inpaint / Outpaint companion using your own MODEL, VAE and prompt conditioning.
- Standard IMAGE and MASK outputs, original IMAGE, and RGBA IMAGE for transparent PNG saving.
- No API keys, cloud editing, APK installation, or model download required for local tools.

This is an independent implementation, not the Android app or its proprietary engine. Detect selects connected similar colors; it is **not AI object segmentation**. App features such as AI filters, text generation, smart background removal and automatic semantic detection are not implemented in this version.

## Install — bash or fish, same commands

Use the Python environment that runs ComfyUI. From the ComfyUI directory:

```sh
git clone --branch dev/interactive-editor https://github.com/mackin5150/ComfyUI-Magic_Eraser.git custom_nodes/ComfyUI-Magic_Eraser
python -m pip install -r custom_nodes/ComfyUI-Magic_Eraser/requirements.txt
```

Restart ComfyUI, then hard-refresh the browser. Search for **Pristine** in Add Node. ComfyUI already supplies PyTorch; the requirements intentionally do not reinstall it or alter its CUDA build. OpenCV runs on CPU and does not require CUDA. ARM64/GB10 needs a compatible opencv-python-headless wheel for its Python version.

For portable Windows, use `python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-Magic_Eraser\requirements.txt` from the portable root after cloning into `ComfyUI\custom_nodes`.

## 1. Upload → edit → Save Image

1. Add **Pristine • Open Photo Editor** and standard **Save Image**.
2. Connect editor `image` → Save Image `images` (or `rgba` for transparency).
3. Click **Open Photo Editor → Upload photo**.
4. Paint with Brush, circle with Lasso, or select a connected color with Detect.
5. Choose **Remove selected** for quick local repair. Clear the red selection to inspect the result. Undo reverses both image edits and selection edits.
6. Click **Apply to Node**, close the editor, and click **Run**. Save Image writes the finished image to the normal ComfyUI output folder.

The three asset fields on the node are managed by the editor. Leave them alone. Applying creates immutable working PNGs under `ComfyUI/input/pristine_eraser/`; it does not create a final output image. Your workflow stores their filenames. Keep that folder with workflow backups and copy it when moving workflows to another machine. Old working assets are retained; deleting them breaks workflows that reference them. Closing without Apply discards uncommitted changes.

## 2. Receive a photo from another node

1. Connect any IMAGE output → **Pristine • Send to Editor** `image`.
2. Use slot `source` (or any name), choose `batch_index`, and Run that branch once.
3. In the editor, enter `source` beside **Load from Node**, then click it.
4. Edit, Apply to Node, and Run the editor → Save Image branch.

The stage node selects a single image from a batch. Use different slots for independent editing sessions. Stage nodes are output nodes, so connected stage branches execute on Run even without Save Image. Avoid wiring a loop; receiving and exporting are separate passes.

## 3. Add your own inpaint model

For a self-contained SD1.5 or SDXL checkpoint, put its `.safetensors` file in:

```text
ComfyUI/models/checkpoints/
```

Refresh ComfyUI's model list or restart. Select it in **Load Checkpoint**. For a separate VAE, put it in `ComfyUI/models/vae/` and choose **Load VAE** instead of the checkpoint's VAE output.

Add **Pristine • Model Inpaint / Outpaint** and wire:

| From | To |
| --- | --- |
| Editor `image` | Model Inpaint / Outpaint `image` |
| Editor `selection_mask` | Model Inpaint / Outpaint `mask` |
| Load Checkpoint `MODEL` | Model Inpaint / Outpaint `model` |
| Load Checkpoint `VAE` (or Load VAE) | Model Inpaint / Outpaint `vae` |
| Load Checkpoint `CLIP` | Two CLIP Text Encode nodes `clip` |
| Positive CLIP Text Encode | Model Inpaint / Outpaint `positive` |
| Negative CLIP Text Encode | Model Inpaint / Outpaint `negative` |
| Model Inpaint / Outpaint `IMAGE` | Save Image and/or Send to Editor |

Select `regular_checkpoint` for ordinary SD1.5/SDXL checkpoints, or `dedicated_inpaint_checkpoint` for compatible dedicated inpaint checkpoints. Model, VAE and conditioning must belong to compatible architectures. This companion uses ComfyUI's native VAE inpaint encoding, optional inpaint conditioning, sampler and decoder. It is not a universal loader for every model family.

For Flux Fill, Qwen Image Edit, WAN, or another specialized model, use its native loader and conditioning workflow. The editor's IMAGE/MASK outputs can feed that workflow, and its decoded IMAGE can feed Send to Editor. Do not assume the SD companion's settings apply to those architectures.

### Inpaint

Paint the region you want regenerated, **Apply to Node**, then Run the model branch. Use the prompt to describe the desired finished scene. For removal, describe the background that should fill the selected region. White/red means regenerate; black/unselected means preserve.

### Outpaint

Choose **Expand for outpaint**, enter padding as `left,top,right,bottom` pixels, for example `0,0,256,0`. The new right border is selected automatically. Brush a small overlap into the original edge if the seam needs blending. Apply to Node and Run the model branch using the same model connections.

The canvas expansion changes the working photo dimensions. New areas start neutral gray; the model fills the selected border. The model companion renders at `render_max_side` (default 1024) and returns the editor's full canvas size. Larger render sizes use more VRAM. Unselected pixels are composited back from the source, preserving them exactly. Very thin masks can disappear when downscaled; use a larger render size for small details. The original output remains the untransformed original photo and can have different dimensions after rotation/expansion.

### Return the generated result to the editor

Connect the model output → Send to Editor, slot `result`. Run once, then load `result` inside the editor. This replaces the current editing session and establishes the generated image as its new original. The graph remains acyclic; loading is an explicit transfer between passes. Once satisfied, use editor → Save Image for the final Run; bypass/disconnect the model branch if you no longer want it to run.

## Nodes

| Node | Purpose |
| --- | --- |
| Pristine • Open Photo Editor | Opens the editing UI and exports applied assets on Run |
| Pristine • Send to Editor | Stages one upstream image in a named slot |
| Pristine • Model Inpaint / Outpaint | Optional SD-style masked generation with user-supplied models |
| Pristine • Split Alpha | Converts RGBA to RGB and a ComfyUI alpha mask (1 = transparent) |

`selection_mask` uses 1 = selected for generation. Split Alpha uses ComfyUI's transparency-mask convention; these masks serve different purposes.

## Examples

Import `examples/direct-save.json` for the upload/save path. Import `examples/model-inpaint-outpaint.json` for a connected SD-style model branch. The model example intentionally has a placeholder checkpoint; select an installed compatible checkpoint and edit the positive/negative prompts before Run. Both need a photo loaded and applied first. Neither example includes user photos or downloaded weights.

## Validation and limits

Run from this repository:

```sh
python -m unittest discover -s tests -v
node --input-type=module --check < web/editor.js
node --input-type=module --check < web/extension.js
```

The automated tests exercise image repair, masks, staging, asset validation, tensor exports and mocked sampler integration. The standalone route/UI harness is `python tests/harness.py` at `http://127.0.0.1:8199`; it stubs the ComfyUI host only and uses real image operations and routes. It is for development, not installation.

A real ComfyUI/GPU generation run is still required to confirm model quality and frontend compatibility on your installation. This development environment has no running ComfyUI or model weights. Photos are limited to 24 megapixels. Editing uses browser canvas and 8-bit PNG working assets; it does not preserve RAW/HDR data, EXIF, animation, or original color profiles. Large photos and undo history consume browser RAM. Use ComfyUI's normal private access controls; the editor has no separate login.

## Design references

- ComfyUI extension hooks: https://docs.comfy.org/custom-nodes/js/javascript_hooks
- ComfyUI native node implementation: https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py

No Android APK code, logos, screenshots, or user photos are distributed in this repository.
