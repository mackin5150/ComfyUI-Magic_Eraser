# ComfyUI Magic Eraser — Pristine Interactive Suite

A model-backed photo editor inside ComfyUI. Select an object, remove or repair it, and continue editing the **new result** in the same UI. Intermediate photos and masks are temporary. **Save final image** writes only the final edited frame to ComfyUI's output folder and deletes that session's temporary files.

## Install or update

From your ComfyUI directory, using the Python environment that runs ComfyUI (same commands for bash and fish):

```sh
git clone --branch dev/interactive-editor https://github.com/mackin5150/ComfyUI-Magic_Eraser.git custom_nodes/ComfyUI-Magic_Eraser
python -m pip install -r custom_nodes/ComfyUI-Magic_Eraser/requirements.txt
```

If already installed:

```sh
git -C custom_nodes/ComfyUI-Magic_Eraser switch dev/interactive-editor
git -C custom_nodes/ComfyUI-Magic_Eraser pull --ff-only
```

Restart ComfyUI, hard-refresh the browser, and search **Pristine** in Add Node. The editor header must show **v0.5.0** and **Check connection** must report backend **0.5.0**. A version mismatch during model editing tells you to restart/refresh. Frontend module imports are versioned to reduce stale-script problems.

The requirements do not reinstall PyTorch or change its CUDA build. OpenCV's optional legacy repair API runs on CPU; model editing uses your ComfyUI model setup. ARM64/GB10 requires a compatible OpenCV wheel for its Python version.

## Editing and final-only saving

1. Add **Pristine • Open Photo Editor** and click **Open Photo Editor**.
2. Upload a photo, or receive one from Send to Editor as described below.
3. Paint/lasso a selection. The red overlay is a mask display, never baked into the working photo.
4. Click **Remove with Model** or **Repair with Model**. The completed image becomes the current working photo, the selection clears, and the header advances to **Edit 1**, **Edit 2**, etc. The next operation uses that current photo.
5. Continue editing. Undo/Redo restore image, mask and edit revision. Show original compares against the photo loaded at the start of this session.
6. Click **Save final image** when finished. The clean current photo is written to `ComfyUI/output/pristine_eraser/<id>.png`. Its alpha is preserved.
7. After the final PNG is committed, the session's temporary source copies, generated images, masks and progress receipts are deleted. Undo history is cleared. Repeated Save without a new edit does not create another image.

**Run is not required to save the final image.** The main node is updated to reference that one saved output, so its IMAGE/RGBA outputs can still feed other nodes on normal Run. Its selection-mask output is then empty; original output equals the saved final, since the previous session's original and masks were discarded. A downstream **Save Image** creates another copy if you choose to run it; it is not needed for this final-only save flow. The example `direct-save.json` and `main-node-model-editor.json` omit that extra saver.

## Temporary-file lifecycle

Editing files belong to a random session under `ComfyUI/temp/pristine_eraser/sessions/`. Each editor only cleans its own session. Other sessions, model weights, unrelated ComfyUI files and saved final images are preserved. Model caching/retention is independent of photo cleanup.

A final write is atomic and happens **before** cleanup. If saving fails, the temporary edit remains recoverable in the open UI. If cleanup fails after saving, the UI reports it and retries cleanup on close. Retrying a save after a lost response uses the same final filename instead of creating duplicates. Active model jobs prevent their session from being cleaned.

Closing and confirming discard removes the unsaved session. Replacing the photo discards the previous temporary session. Browser crashes/abandoned sessions are eligible for cleanup after 24 hours of inactivity when a new session starts; active jobs are excluded. ComfyUI may also clear its own temp directory on restart. Temporary sessions are not durable project backups.

Older versions' working files under `input/pristine_eraser/` remain readable and are not globally deleted: existing saved workflows may reference them. Newly created UI editing progress no longer accumulates there. Send to Editor uses temporary staged files and replaces only the previous staged image in the same slot; staging sources are separate from session history.

## Model connections

For SD1.5/SDXL checkpoints, put the `.safetensors` checkpoint in `ComfyUI/models/checkpoints/`, refresh/restart, and select it in Load Checkpoint. A separate VAE goes in `models/vae/`.

| From | Main editor / destination |
| --- | --- |
| Load Checkpoint MODEL (or compatible diffusion loader) | `model` |
| Load Checkpoint VAE / Load VAE | `vae` |
| CLIP / compatible text-encoder loader | main editor `clip` |
| CLIP | positive and negative CLIP Text Encode nodes |
| Positive / negative conditioning | main editor `positive` / `negative` for conventional conditioning workflows |

Remove/Repair use the editor's visible **Fill instruction**, freshly encoded through the connected CLIP. Their queue snapshots exclude unrelated workflow positive/negative conditioning, preventing a sample office-scene prompt from being silently inherited. The default instruction asks for continuation of the surrounding scene; you can specify the intended material, such as “continue the white collar and fabric, matching texture and lighting.” Outpaint uses a scene-continuation instruction. Results remain model-dependent and cannot recover the actual hidden scene.

Select `regular_checkpoint` or `dedicated_inpaint_checkpoint` as appropriate. Main-node settings include seed, steps, cfg, guidance, sampler, scheduler, denoise, render_max_side and blend_pixels. Inward edge blending preserves unselected pixels; select slightly beyond an unwanted object's boundary/shadow. Rendering is capped by render_max_side, then composited back at the working photo's size. Very small selections can lose detail when downscaled.

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

The first run loads the ~12 GB diffusion weights plus T5, so click **Preload Models** once (with `clip` connected as above) before editing. With keep_loaded enabled, the editor retains the bundle between edits; ComfyUI still controls GPU placement and may offload under memory pressure.

## Preloading

Connect MODEL, CLIP and VAE, then click **Preload Models** before editing. The first load still takes time. Leave `keep_loaded=true` to retain the model bundle between edits; **Release Models** drops the suite's references. ComfyUI still manages device placement and may offload under memory pressure or according to launch settings. Preloading does not eliminate queue, encoding, sampling or decoding time. Photo-session cleanup does not unload or delete model weights.

## Tools

- Remove, Repair and Outpaint use the loaded model.
- Brush, lasso and deselect define the mask. **Color Select** selects connected similar colors, not semantic objects.
- Expand for outpaint adds selected borders. Click Outpaint with Model to fill them.
- Crop, rotate, flip, blur and alpha cutout are deterministic local operations.
- Undo/Redo are cumulative edit history, not independently blendable layers.

The APK video is a visual reference; this independent implementation does not distribute the APK's code, assets or proprietary engine. Semantic object detection and automatic AI background segmentation are not implemented.

## Receive an upstream photo

Connect an IMAGE output to **Pristine • Send to Editor**, choose a slot/batch index and Run once. In the editor enter that slot and click **Load from Node**. The editor imports one image from the batch and subsequent edits remain in its session. Keep transfers acyclic.

The separate **Pristine • Model Inpaint / Outpaint** companion is retained for conventional graph workflows. It uses its connected positive/negative conditioning and does not itself save files. `model-inpaint-outpaint.json` demonstrates that conventional workflow, including an explicitly connected Save Image node; it is separate from the new final-only UI save path. `main-node-model-editor.json` is the recommended editor workflow. Choose an installed compatible checkpoint before using it.

## Result delivery and diagnosis

Completed jobs return through a request-scoped websocket notification, temporary worker receipts and ComfyUI History fallback. Receipt polling/image downloads bypass caches; returned source IDs and image dimensions must match the pending edit. A completed render can therefore reach the canvas even while History remains empty or lacks custom UI output. The editor reports loading/preparing/sampling/download phases; these are not denoising-image previews.

**Check connection** reports backend version 0.5.0. Errors identify their phase and endpoint. HTTP 413 indicates a request-size limit; non-JSON responses can indicate a proxy/login/error page. Read-only status checks tolerate connection interruptions, while queue POSTs are never automatically retried. If submission loses its response, inspect Queue/History before retrying. A live server error still requires its log or displayed message to diagnose; no specific tunnel/server root cause has been confirmed here.

Use the editor on the root workflow canvas; nested-subgraph model editing is not supported. Model jobs time out in the editor after 30 minutes. Keep the normal private access controls around your ComfyUI instance; the suite has no separate login.

## Validation

```sh
python -m unittest discover -s tests -v
node tests/model_queue_check.mjs
node --input-type=module --check < web/editor.js
node --input-type=module --check < web/extension.js
```

Thirteen Python tests cover model/CLIP instruction paths, FLUX/SD sampler integration, masks, pixel preservation, receipts, preloading, temporary session ownership, save failure, active-job protection, final-only output and cleanup. Model management and generation are simulated in tests; actual GPU quality/residency needs validation on your installation.

For DOM/canvas checks, install development-only packages, then start the harness in one terminal and run the check in another:

```sh
npm install --no-save --package-lock=false jsdom @napi-rs/canvas
python tests/harness.py
```

```sh
node tests/ui_check.cjs
```

For the expanded queue/worker check, restart the harness with:

```sh
python tests/harness.py --mock-queue
```

```sh
node tests/queued_editor_check.cjs
```

That check submits a real HTTP queue request to a host simulation, runs the actual Python editor worker with a deterministic simulated model, keeps History empty, retrieves the completion receipt/image, and verifies two visible cumulative canvas edits. It then asserts one clean final output image, no session progress files, no legacy input progress images, and no red overlay in the saved PNG. This is stronger than a mocked image callback but is still not a real ComfyUI/GPU/browser layout test.

Working photos are limited to 24 megapixels. Browser canvas and 8-bit PNG do not preserve RAW/HDR, EXIF, animation or original color profiles. Large photos and undo history consume browser RAM.
