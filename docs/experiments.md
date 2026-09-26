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

Variant cards show output, runtime and out-of-gamut rate. Debug modes in the primary canvas expose original/corrected, split, difference, selected seed, aggregated field, dominant layer, selected contribution and gamut violations.

## Synthetic fixture protocol

`src/experiments/fixtures/synthetic.ts` procedurally creates observed and ground-truth images and samples source→target calibration constraints at known positions. It includes two spatial illumination regions, a warm-to-cool gradient, same color in different contexts, different colors sharing one transform, object-boundary leakage, and nonlinear color bias. The generator can serve directly as an editor input by constructing a `File` from the returned observed bytes; it can also feed an external evaluation harness with known ground truth and constraints.

`src/experiments/metrics/index.ts` reports mean / 95th-percentile OKLab ΔE, optional boundary-band error, out-of-gamut rate, runtime, and number of constraints. Measure boundary leakage with a one-byte-per-pixel mask near fixture boundaries. Compare presets at equal points and report each fixture separately rather than only averaging easy spatial cases.

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
