# Algorithm notes

This document records safe, editable first-pass values. The active model is an **AppearanceGaussianActivation baseline**: weighted color, position, context and edge feature distance passed through a Gaussian kernel. It does not infer physical illumination or learned transform-regime similarity. Transform-regime applicability remains the research goal; this appearance-similarity model is a baseline for comparison.

## Color and original features

Pixels arrive as encoded sRGB, are decoded to linear sRGB for transform fitting/composition, and converted to OKLab for perceptual cues. The analysis image defaults to area/box downsampling at max dimension 512 (256 / 1024 are configurable); nearest and bilinear are comparison strategies. Area sampling integrates source-pixel overlap for each destination pixel. Feature maps are built from this resampled original image.

Each analysis pixel stores OKLab and RGB, normalized XY at query time, three local OKLab means and variances, medium-scale local contrast, luminance gradient, chroma gradient and combined edge/texture magnitude. Box statistics use integral images. Default context radii are `[3, 12, 32]` pixels at the 512-pixel analysis scale.

## Per-constraint Gaussian activation

For query pixel feature `q` and original-source/context feature `s`, the Gaussian strategy computes:

```text
D = wc * D_color + ws * D_xy + wm * D_context + we * D_edge
A_seed = confidence * exp(-0.5 * sharpness * D)
```

Color is squared OKLab distance normalized by `colorScale`. XY is normalized position distance divided by `spatialScale`. Context compares multi-scale local means and standard deviations plus local contrast. Edge compares edge strength and luminance/chroma gradients. Relative context-scale, variance, contrast, texture and gradient terms are explicit config values. Presets selectively enable cues; all weights, scales, sharpness and radii are stored in `ActivationConfig`.

The model input does not contain `target`; source context is sampled from the original at `position`, with source color kept as an explicit source cue. The current Gaussian is an appearance/context prior, not a learned probability that two pixels share physical illumination. It may fail on same-appearance/different-lighting and different-appearance/same-lighting cases; presets and hints make that failure inspectable.

## Aggregation and hints

Default aggregation is probabilistic OR:

```text
A_layer = 1 - product(1 - A_seed_k)
```

A single seed with no hints is copied exactly. Smooth max is an alternative strategy and normalizes log-sum-exp by seed count. A hint computes a spatial Gaussian influence with optional radius and configurable hint sharpness. Include updates `A ← 1 - (1-A)(1-h)`; exclude updates `A ← A(1-h)`. Hints are sparse normalized points, not bitmap masks.

## Shared residual transform

Every model fits `T(c) = c + Δ(c)` from only the current layer's `(source, target, confidence)` evidence. Position, Activation, edge and context are not passed to the solver.

- Constant: basis `[1]`.
- Affine residual: basis `[1, r, g, b]`.
- Centered root-polynomial: `[1, r-μr, g-μg, b-μb, √rg-√μrμg, √rb-√μrμb, √gb-√μgμb]`. Cross terms use signed root products `sign(a·b)√|a|√|b|`; this matches `√(ab)` for nonnegative RGB, remains continuous through zero, avoids overflow from directly forming `a*b`, and is defined for small negative linear RGB values.
- Adaptive: estimates source OKLab spread and affine Gram conditioning. Weak/same-color evidence falls to a constant residual; better-spread evidence can use affine; root-polynomial opens only with adequate independent evidence and stable conditioning. Ill-conditioned nonlinear evidence increases regularization and falls back to affine when needed.

For each output channel, weighted ridge builds `Xᵀ W X + Λ` and `Xᵀ W d`; confidence is the sample weight. The small symmetric systems are solved using an explicit Cholesky decomposition. Adaptive spread/count/condition thresholds, condition-to-regularization boost, intercept penalty and coefficient bound are configurable. Empty evidence returns identity. Coefficients have a safety bound; finite out-of-gamut transform outputs are preserved (to a broad numeric safety limit) until composition and gamut mapping. Adaptive Cholesky failure or coefficient-bound overflow falls back toward simpler models and reports a reason; per-pixel numeric identity fallbacks are counted. Coefficient bounds are a last safety measure, not a substitute for diagnostics.

## Composition and gamut

Layer gain is `clamp(strength × activation, 0, 1)`. Residual-add evaluates every `T_i(input)` against the same input and adds each weighted residual before gamut mapping, making layer order independent up to floating-point summation. Sequential applies each transform to the preceding output. Normalized mixture includes identity as an expert and normalizes the expert weights.

The default gamut mapper converts to OKLCH, holds lightness and hue, and binary-searches chroma down until linear-sRGB is in gamut. Hard clip is exposed only as a comparison baseline. Out-of-gamut pixels are counted and viewable. Normal transform and composition paths do not clamp channels to `[0,1]` before this stage.

## Limiters and known approximations

Activation features are low-resolution and the current `guided-bilinear` upsampler uses color-guided weighting over only the bilinear 2×2 neighborhood; it is not full joint-bilateral filtering. `confidence` also scales the seed; target edits do not change it. Transform coefficient limiting and OKLCH chroma compression bound common runaway cases, but do not prove global monotonicity or prevent every transform fold under extreme creative targets. The independent-point and joint local constant-residual architecture baselines are simplified research approximations.
