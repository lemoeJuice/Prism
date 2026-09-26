# Experiments and research workflow

## Positioning

Prism investigates sparse source→target calibration in one photo. Its architectural hypothesis is that a target-independent transform-regime Activation Field and a shared, evidence-adaptive Layer transform are useful and controllable. Point propagation, appearance affinity, local transfer functions and spatial color adjustment have extensive prior work; this prototype does not claim those individual components are novel. The core empirical question is whether context-aware Activation plus capacity control reduces leakage/overfit at a fixed sparse-constraint budget.

## Built-in Compare Mode

Compare variants use the same photo, Layer/constraint/hint state, but independently override algorithm config:

- Activation: spatial-only, color-only, color+XY, color+context, color+context+edge.
- Aggregation: probabilistic OR, smooth max.
- Transform: constant, affine, root-polynomial, adaptive.
- Compositor: residual-add, sequential, normalized-mixture.
- Architecture: shared correction layer (main), a simplified per-point-independent baseline, and a seed-weighted local constant-residual joint-per-pixel baseline. The latter is intentionally lower-capacity than a complete local affine regression.

Variant cards show output, runtime and out-of-gamut rate. The Compare dock can run the procedural synthetic benchmark suite in the Worker and displays per-fixture mean/median/p95 OKLab error, inside/outside activation and leakage ratio, and runtime. Debug modes in the primary canvas expose original/corrected, split, difference, selected seed, aggregated field, per-cue color/spatial/context/edge distance heatmaps, weighted total distance, dominant seed, hint contribution, dominant layer, selected contribution and gamut violations. The distance inspection is for the currently selected constraint and makes the AppearanceGaussianActivation baseline's decision inspectable.

## Synthetic fixture protocol

`src/experiments/fixtures/synthetic.ts` procedurally creates observed and ground-truth images and samples source→target calibration constraints at known positions, with deterministic procedural texture (no network or runtime RNG). It includes two spatial illumination regions, a warm-to-cool gradient, same color in different contexts (single left-side calibration), different colors sharing one transform (white and red constraints with green/blue held out), object-boundary leakage, nonlinear color bias, and an identity/preserve pair. `runSyntheticBenchmarks()` in `src/experiments/fixtures/benchmark.ts` runs all seven and returns structured metrics. `src/experiments/presets.ts` includes cue, resize, upsample and transform compare variants. Resize defaults to area/box; the guided upsampler is explicitly a 2×2 guided-bilinear method, not a complete joint-bilateral filter.

`src/experiments/metrics/index.ts` reports mean / median / 95th-percentile OKLab ΔE, optional boundary-band error, out-of-gamut rate, runtime, number of constraints, and optional inside/outside activation means plus leakage ratio when a regime mask is supplied. `PipelineOutput.runtime` additionally reports feature extraction, seed generation, aggregation, transform solve, render preparation and render durations; Compare cards expose these timings. Compare presets at equal points and report each fixture separately rather than only averaging easy spatial cases. Synthetic fixtures are designed to expose known failure cases; poor cross-color activation on different-colors/same-regime is an informative baseline result, not a reason to tune the fixture or special-case the algorithm.

### Baseline snapshot (48 × 32, local CPU run)

These are reproducibility examples, not tuned or hardware-independent claims. On same-color/different-context, the default color+context+edge preset yielded mean inside activation `0.635`, outside `0.278` (leakage ratio `0.438`); color-only leaked nearly everywhere (`0.925` / `0.916`, ratio `0.991`). On the object boundary fixture the default ratio was `0.545`, compared with `0.743` for spatial-only and `0.876` for color-only: edge/context cues help relative to raw color-only propagation but do not prevent leakage. On different-colors/same-regime, mean activation across the correct regime was only `0.545` for default; color-only reached `0.891`, but that is appearance matching and does not establish shared-regime applicability. In the nonlinear-color-bias fixture, mean OKLab error was approximately `0.00481` constant, `0.00423` affine, `0.00422` root-polynomial, and `0.00486` adaptive; with only three constraints, adaptive selected constant and did not capture the small improvement of higher-capacity fits. This is a useful signal to investigate evidence thresholds and calibration budget.

## Experimental defaults and open parameters

Current uncertain values are exposed rather than treated as established:

1. Activation cue weights, internal context/edge component weights, and normalization scales.
2. Context window radii and context-statistic distance.
3. Edge/texture metric and edge range bandwidth.
4. Gaussian kernel and `sharpness` (future sigmoid, geodesic or learned alternatives).
5. Aggregator choice and smooth-max temperature.
6. Hint radius and spatial-vs-context hint propagation.
7. Background/identity prior and confidence interpretation.
8. Base and nonlinear ridge penalties; intercept weight and coefficient bound.
9. Adaptive spread / sample-count / affine/root condition limits and condition-dependent regularization.
10. Analysis resolution, activation cache policy and bilateral upsampling bandwidth.
11. Compositor selection for overlapping regimes.
12. OKLCH chroma compression curve and behavior for extreme targets.
13. Creative extreme-transform limiter and monotonicity/fold diagnostics.
14. Behavior when a layer has no constraints, or has conflicting source-equal preserve evidence.
15. Full implementations of per-point-independent and joint-per-pixel-regression architecture baselines.

These settings should be chosen from fixture and user-study evidence. Default values in this prototype are safe starting points, not tuned claims.
