# ComfyUI Magic Eraser — Pristine Interactive Suite

An interactive photo editor for ComfyUI, inspired by the supplied yellow-sleeve editor reference. Open the editor, work on a photo, **Apply to Node**, then **Run** to export. Normal Run exports the applied photo. Model generation starts only when you click **Remove with Model** or **Outpaint with Model** inside the editor.

## Included

- Dark responsive editor with a large image area and red selection overlay.
- Brush, freehand lasso, color-region Detect, and Deselect brush; adjustable brush and tolerance.
- Local object repair (OpenCV Telea), selective blur, transparent cutout, rotate and flip.
- Undo/redo (12 steps), original comparison, zoom, and fit.
- Expand any of the four canvas edges for outpainting; new borders become the selection mask.
- Upload photos directly or stage images from another ComfyUI node.
- Connect MODEL, VAE and positive/negative conditioning directly to the main editor for interactive model removal and outpainting. An optional companion node remains available for conventional workflows.
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
5. Choose **Repair with Model** to reconstruct the selection using the loaded model, or **Remove with Model** after connecting a model as described below. Clear the red selection to inspect the result. Undo reverses both image edits and selection edits.
6. Click **Apply to Node**, close the editor, and click **Run**. Save Image writes the finished image to the normal ComfyUI output folder.

The three asset fields on the node are managed by the editor. Leave them alone. Applying creates immutable working PNGs under `ComfyUI/input/pristine_eraser/`; it does not create a final output image. Your workflow stores their filenames. Keep that folder with workflow backups and copy it when moving workflows to another machine. Old working assets are retained; deleting them breaks workflows that reference them. Closing without Apply discards uncommitted changes.

## 2. Receive a photo from another node

1. Connect any IMAGE output → **Pristine • Send to Editor** `image`.
2. Use slot `source` (or any name), choose `batch_index`, and Run that branch once.
3. In the editor, enter `source` beside **Load from Node**, then click it.
4. Edit, Apply to Node, and Run the editor → Save Image branch.

The stage node selects a single image from a batch. Use different slots for independent editing sessions. Stage nodes are output nodes, so connected stage branches execute on Run even without Save Image. Avoid wiring a loop; receiving and exporting are separate passes.

## 3. Connect your inpaint/outpaint model directly to the MAIN node

Import **`examples/main-node-model-editor.json`** for the recommended ready-wired workflow. It connects a checkpoint and two prompt nodes directly to the main editor; no companion inpaint node or round trip through Send to Editor is needed.

Put a compatible self-contained SD1.5 or SDXL `.safetensors` checkpoint in:

```text
ComfyUI/models/checkpoints/
```

Refresh the model list or restart, then select it in **Load Checkpoint**. For a separate VAE, place it in `ComfyUI/models/vae/` and select **Load VAE** instead of the checkpoint's VAE output.

| From | To |
| --- | --- |
| Load Checkpoint `MODEL` | Main editor `model` |
| Load Checkpoint `VAE` (or Load VAE) | Main editor `vae` |
| Load Checkpoint `CLIP` | Main editor `clip` **and** both CLIP Text Encode nodes `clip` |
| Positive CLIP Text Encode | Main editor `positive` |
| Negative CLIP Text Encode | Main editor `negative` |
| Main editor `image` | Save Image `images` |

For the conventional companion workflow, set the positive prompt to describe the finished background/foreground you want revealed, such as “continuous yellow leather surface, matching grain, natural lighting.” Include enough selection margin around the entire unwanted object, its shadow and its edges. The model reconstructs plausible content; it cannot recover the actual hidden scene or guarantee an invisible repair every time.

### FLUX Fill checkpoints (AGFlux_fill and similar)

FLUX Fill is supported natively by the main editor's model buttons — no companion node or separate workflow needed. The node detects a loaded FLUX model automatically and applies the official Black Forest Labs recipe: full-image latent with image+mask conditioning (`InpaintModelConditioning` without noise mask), `cfg` forced to 1.0, FluxGuidance on the positive prompt only, and euler/normal sampling when the SD defaults are left untouched.

Wire standard ComfyUI loaders into the main editor:

| From | To |
| --- | --- |
| UNETLoader (e.g., `AGFlux_fill.safetensors` in `models/diffusion_models/`) | Main editor `model` |
| VAELoader (`flux_vae.safetensors` or `ae.safetensors` in `models/vae/`) | Main editor `vae` |
| DualCLIPLoader (`t5xxl_fp16.safetensors`, `clip_l.safetensors`, type **flux**) — or ComfyUI-GGUF's DualCLIPLoaderGGUF with a quantized T5 encoder | Both CLIP Text Encode nodes' `clip` **and** main editor `clip` (preload) |
| Positive CLIP Text Encode | Main editor `positive` |
| Negative CLIP Text Encode | Main editor `negative` |

For conventional companion workflows, set the positive prompt to describe what should appear in the selection; the negative prompt can be empty for FLUX Fill. Use the **guidance** widget (default 30) instead of cfg: guidance carries the model strength while cfg is forced to 1.0 on FLUX models. Leave sampler/scheduler at their defaults and the node switches them to euler/normal automatically; your own choice is respected.

The first run loads the ~12 GB diffusion weights plus T5, so click **Preload Models** once (with `clip` connected as above) before editing. With keep_loaded enabled, ComfyUI's model manager keeps the bundle resident between queued runs, so repeated edits do not re-read the checkpoint.

### Preload models and keep them available

Connect `model`, `vae`, and the new `clip` port directly to the main node. The CLIP output still connects to the positive/negative text encoder nodes. With separate diffusion/text-encoder/VAE loaders, connect their corresponding MODEL, CLIP and VAE outputs to the same ports; the architecture compatibility requirements below still apply. A DualCLIPLoader's combined CLIP object uses the single `clip` port.

Click **Preload Models** on the node or inside its editor. This queues only the loader dependencies and warms diffusion, CLIP and VAE through ComfyUI's model manager. It works before uploading a photo, does not sample, and does not run Save Image. The first preload still takes time to read the weights. A success message lists the loaded components.

Leave **keep_loaded = true** (the default) to retain the editor's model bundle after edits. The suite retains up to two editor sessions and preserves the preloaded CLIP reference alongside diffusion/VAE. **Release Models** in the editor drops its retention references. ComfyUI's own caches may still hold the weights afterward.

Retention avoids losing the bundle to garbage collection and requests device loading during preload. It does **not** bypass ComfyUI's memory manager or guarantee that all weights remain in GPU memory. ComfyUI may still offload under memory pressure or according to your launch settings. There is still queue/sampling/encoding/decoding time for each edit. We do not force full-GPU loading or change your global memory settings. This keeps the feature usable when the complete bundle does not fit in VRAM.

### Diagnose “Failed to fetch”

Click **Check connection** in the editor. A successful result reports backend version `0.4.0`. A 404 means the updated backend route is missing or the request is being routed incorrectly; restart ComfyUI and refresh the browser, then check the URL/proxy if it persists.

Requests now report their phase and endpoint: photo upload, image operation, queue submission, or job-history polling. HTTP 413 identifies an upload size limit; non-JSON responses identify a possible proxy/login/error page. A raw fetch failure means the browser did not receive a usable response, which by itself does not establish whether model loading, the server, or the network caused the interruption. Inspect the ComfyUI terminal at the same time.

Read-only history checks retry up to eight times (one second apart) after connection failures, so a brief proxy blip during a long first load no longer kills the poll loop. Queue submissions are never automatically retried, preventing duplicate model jobs. If submission loses its response, inspect Queue/History before clicking again. Preloading can reduce weight-loading delay, but cannot repair a broken browser-to-server connection. The failure on your own server has not been reproduced in this development environment; use the new endpoint-specific message to narrow it down if it continues.

### Remove an item inside the editor

1. Connect the model ports above and choose the main node's sampling settings.
2. Open Photo Editor and upload/load the photo.
3. Paint or lasso over the unwanted item.
4. Check the editor’s **Fill instruction** (the default asks for a continuation of the surrounding photo), then click **Remove with Model**. The photo stays in the editor while ComfyUI processes the model job, then the filled result appears automatically.
5. Inspect it, Undo or refine the selection if needed, then **Apply to Node**.
6. Close the editor and click **Run** to Save Image. This final save does not regenerate the image.

**Repair with Model**, **Remove with Model**, and **Outpaint with Model** all use the loaded model. Crop, rotate, flip, blur and alpha cutout remain deterministic local operations; brush/lasso/deselect define the mask. Model buttons do not fall back to local repair if connections are missing; they show the missing connection instead.

### Outpaint inside the editor

1. Choose **Expand for outpaint** and enter padding as `left,top,right,bottom`, for example `0,0,256,0` for a new right border.
2. The new borders are selected automatically. Brush a small overlap into the original edge for continuity.
3. Click **Outpaint with Model**. It uses the same model ports and sampling settings on the main node and returns the result directly to the editor.
4. Apply to Node when satisfied, then Run to save.

### Main-node model settings

Select `regular_checkpoint` for ordinary SD1.5/SDXL checkpoints, or `dedicated_inpaint_checkpoint` for compatible dedicated inpaint checkpoints. Set `seed`, `steps`, `cfg`, sampler, scheduler, `denoise`, and `render_max_side` on the main node. New content usually needs high denoise; lower it when preserving existing texture is more important. For FLUX Fill models set **guidance** (default 30) instead of cfg — cfg is forced to 1.0 and sampler/scheduler default to euler/normal automatically, as described above.

`blend_pixels` (default 4) softens the model fill inward from the selected edge; 0 uses a hard boundary. Unselected pixels remain unchanged. Paint slightly beyond the object so the blending margin contains clean background rather than the object's outline.

The model renders at `render_max_side` (default 1024) and returns the editor's full canvas size. Larger render sizes use more VRAM. Very thin masks can disappear when downscaled; use a larger render size for small details. New outpaint areas start neutral gray. After rotation/expansion, the original output can have different dimensions from the working image.

### Successive edits update the current image

Each completed model fill replaces the editor's working photo immediately and clears its red selection. The header advances to **Edit 1**, **Edit 2**, and so on. The next model operation uploads that current working image, so edits build on one another without clicking Apply between operations. **Show original** still displays the initial photo; **Undo/Redo** restore the image, mask and edit revision. This is a cumulative edit history, not a stack of independently blendable layers. Click Apply to Node only when you want to commit the current photo for normal Run / Save Image.

Model image downloads use ComfyUI's authenticated request helper, bypass caches, validate the source image and dimensions, and keep the current edit if downloading/decoding fails. A generated result cannot replace a different source session. The backend writes a small completion receipt before the queue job finishes; the editor can retrieve the finished asset even if ComfyUI History is still empty or omits custom UI output. Loading/preparing/sampling phases are reported. These receipts live under `input/pristine_eraser/jobs/` with the other working assets. They are not live denoising previews.

**Remove** and **Repair** use the visible editor **Fill instruction**, encoded using the main node's connected CLIP. They do not reuse unrelated workflow prompt conditioning. This prevents a sample workflow prompt about an office or people from being silently inherited by the removal button. Outpaint uses an instruction to extend the surrounding photograph. The conventional companion node continues to respect its connected positive/negative conditioning. Generative quality is still model-dependent; a seamless reconstruction of hidden content is not guaranteed.

### Execution and saving

The model button queues an isolated snapshot of the main editor and its upstream model/CLIP connections using ComfyUI's normal execution queue. It excludes downstream Save Image and unrelated output branches. GPU work stays in the ComfyUI worker; it does not run inside an HTTP image route. A queue-only internal node variant supplies the result back to the editor. You never need to add that internal node manually.

The result is a preview until you choose Apply to Node. Failure or interruption keeps your previous photo; Undo can revert a completed fill. The generation request is not stored in your main workflow, so ordinary Run exports the applied photo and does not repeat generation. Model inputs are lazy and do not load during a normal save. Use the main node at the root of the workflow canvas; nested subgraph model editing is not supported in this version. Jobs time out in the editor after 30 minutes; inspect ComfyUI History if a job runs longer.

### Model compatibility and the optional companion

Model, VAE and conditioning must belong to compatible architectures. Built-in model editing supports FLUX Fill checkpoints (auto-detected; see above) plus SD1.5/SDXL-style sampling and dedicated inpaint conditioning. It is not a universal loader for every model family.

For Qwen Image Edit, WAN or other specialized models, use their native loaders and conditioning workflows. The main editor's IMAGE/MASK outputs can feed such a workflow, and its decoded IMAGE can feed Send to Editor. Do not assume the built-in model buttons support those architectures.

The separate **Pristine • Model Inpaint / Outpaint** node is retained for conventional graph workflows and backward compatibility. Connect editor IMAGE/MASK plus MODEL/VAE/conditioning to it, then connect its output to Save Image or Send to Editor (`result` slot). Loading `result` establishes a new editor session/original; the main-node model buttons preserve the current original and undo history instead.

## Nodes

| Node | Purpose |
| --- | --- |
| Pristine • Open Photo Editor | Interactive model removal/outpainting with optional MODEL/VAE/conditioning; exports applied assets on normal Run |
| Pristine • Send to Editor | Stages one upstream image in a named slot |
| Pristine • Model Inpaint / Outpaint | Optional masked-generation companion for FLUX Fill and SD checkpoints |
| Pristine • Split Alpha | Converts RGBA to RGB and a ComfyUI alpha mask (1 = transparent) |

`selection_mask` uses 1 = selected for generation. Split Alpha uses ComfyUI's transparency-mask convention; these masks serve different purposes.

## Examples

Import `examples/direct-save.json` for the upload/save path. Import `examples/main-node-model-editor.json` for model editing directly inside the main editor. `examples/model-inpaint-outpaint.json` is the optional companion-node example. Model examples intentionally have a placeholder checkpoint; select an installed compatible checkpoint and edit the positive/negative prompts before Run. The direct-save/companion workflows need a photo applied first. Main-node model editing accepts the current uncommitted photo when you click its model button. None of the examples includes user photos or downloaded weights.

## Validation and limits

Run from this repository:

```sh
python -m unittest discover -s tests -v
node --input-type=module --check < web/editor.js
node --input-type=module --check < web/extension.js
node --input-type=module --check < web/model_queue.js
node tests/model_queue_check.mjs
```

Eleven Python tests exercise image repair, masks, staging, asset validation, tensor exports, lazy main-node model execution, preview preservation, preload/release without a photo, bounded retention, the FLUX Fill recipe (noise-mask-free conditioning, forced cfg 1.0, euler/normal defaults and positive-only guidance) durable completion/error receipts, editor-instruction conditioning and mocked sampler integration. Queue tests verify isolated upstream-only snapshots, unchanged workflow state, scoped result retrieval, preload/release graph isolation, transient history recovery, endpoint-specific errors and no duplicate submissions. A DOM/canvas integration check also passed against real HTTP editor routes: restore, brush, repair, apply, expansion, undo/redo, rotate/flip, comparison, lasso, blur, Detect, connection health, preload/release callbacks and a simulated model callback/preview without automatic Apply. The cumulative-edit regression also asserts actual displayed canvas pixels after two successive fills, confirms the second input contains the first result, verifies Undo/Redo and original comparison, rejects stale-source results, and checks Apply saves the latest image. This is not a full browser layout test; browser binary download was unavailable here. The standalone route/UI harness is `python tests/harness.py` at `http://127.0.0.1:8199`; it stubs the ComfyUI host only and uses real image operations and routes. It is for development, not installation. To reproduce the DOM/canvas check with that harness running in another terminal, install development-only packages and run:

```sh
npm install --no-save --package-lock=false jsdom @napi-rs/canvas
node tests/ui_check.cjs
```

These packages are unnecessary for using the suite.

A real ComfyUI/GPU generation run is still required to confirm model quality and frontend compatibility on your installation. This development environment has no running ComfyUI or model weights. Photos are limited to 24 megapixels. Editing uses browser canvas and 8-bit PNG working assets; it does not preserve RAW/HDR data, EXIF, animation, or original color profiles. Large photos and undo history consume browser RAM. Use ComfyUI's normal private access controls; the editor has no separate login.

## Design references

- ComfyUI extension hooks: https://docs.comfy.org/custom-nodes/js/javascript_hooks
- ComfyUI native node implementation: https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py

No Android APK code, logos, screenshots, or user photos are distributed in this repository.
