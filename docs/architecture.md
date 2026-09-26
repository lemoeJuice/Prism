# Architecture

## Product and data model

The primary user object is a `CorrectionLayer`, not an isolated color point. A layer owns user constraints, per-constraint Activation Seeds, its aggregated Activation Field, one shared Transform, strength/enabled state, and optional sparse Activation Hints. A constraint stores normalized coordinates in the original image, sampled original linear-sRGB `source`, editable linear-sRGB `target`, and confidence. `source === target` is a valid preserve measurement.

`src/core/types.ts` defines serializable user intent. Transform and Activation interfaces live in independent modules; Vue components only edit state and submit jobs. Constraints can move between layers without mutating their sampled source. Dragging to a new image position explicitly resamples source from the original image.

## Modules

- `core/color`: sRGB transfer functions, linear-sRGB/OKLab/OKLCH conversion, ΔEOK and gamut mapper.
- `core/features`: analysis-image scaling and original-only multiscale feature extraction.
- `core/activation`: target-independent Gaussian model, seed fields, probabilistic-OR/smooth-max aggregation, spatial hint propagation.
- `core/transform`: evidence-adaptive basis choice, weighted ridge and Cholesky solver.
- `core/compositor`: residual-add, sequential and normalized-mixture strategies.
- `core/pipeline`: cache keys, low-to-full field upsampling, variant evaluation, debug views and diagnostics.
- `core/project`: intent-only project JSON, image fingerprint and reversible command history.
- `workers/pipeline.worker.ts`: owns decoded RGBA and CPU-side caches; handles image and render messages off the UI thread.
- `renderer/webgl2/PreviewCanvas.vue`: uploads completed preview pixels to a WebGL2 texture. A 2D canvas fallback is used when WebGL2 is unavailable.
- `app/App.vue`: editor interactions, state/history coordination, inspectors and Compare Mode.

## Processing and invalidation

```text
original encoded sRGB
  → analysis image (max dimension 256 / 512 / 1024)
  → OKLab + XY + multiscale context / edge features
  → per-constraint Activation Seeds (target independent)
  → Layer aggregation + optional include/exclude hints
  → one weighted-ridge shared Transform per Layer
  → low-resolution activation upsample (bilinear / joint bilateral)
  → full-resolution layer composition
  → gamut mapping
  → WebGL2 preview / PNG export
```

Seed cache keys include image fingerprint, analysis configuration, constraint ID, original position/source and confidence; they deliberately exclude target. Aggregate cache keys additionally include hints and aggregator settings. Transform solves are performed per pipeline evaluation and never read position or activation. Consequently a target edit hits the same seed, aggregate and upsampled-field caches while changing transform output. A position/source/config change invalidates activation. Transient caches are bounded and cleared when the image fingerprint changes. No feature maps, fields, solved transforms or GPU resources enter saved projects.

## Worker and renderer

The main thread decodes the selected photo and retains original pixels only for original-color sampling/export. A copy is transferred to the persistent Worker. Analysis, seed generation, compositing and debug rendering run in that worker; computed RGBA is transferred back. The WebGL2 preview canvas renders that image as a texture. `ImageBitmap` orientation is normalized during import. The processing model is full-resolution for final output with analysis/activation fields at configured lower resolution.

## History and project files

`CommandHistory<Project>` stores reversible labeled snapshots for edits to layers, constraints, targets, hints, strengths, activation/transform/pipeline configuration, and compare presets. Project JSON stores image metadata/fingerprint, layers, user configuration and selected Compare presets only. Reopening a project requires re-importing the matching original photo to reconstruct transient analysis state.

## Baseline hooks

The active architecture is `shared-correction-layer`. Compare Mode includes a simplified working per-point-independent approximation and a seed-weighted local constant-residual joint-per-pixel baseline. The latter is a baseline hook, not a full local affine regression or a reproduction of a published method. Strategy boundaries allow replacing Activation, Transform, Aggregator, Compositor, gamut mapping or architecture policy independently.
