# Pipeline configuration reference

All algorithm values live in serializable configuration objects (`src/core/types.ts`) and can be edited in the inspector or experiment presets. The numbers below are deliberately conservative starting points.

## Activation config

| Setting | Default | Meaning |
|---|---:|---|
| `model` | `gaussian` | Replaceable activation model strategy. |
| `preset` | `color+context+edge` | Cue preset: spatial-only, color-only, color+xy, color+context, color+context+edge, custom. |
| `colorWeight` | 1.15 | OKLab source-color distance weight. |
| `spatialWeight` | 0.75 | Normalized XY prior weight. |
| `contextWeight` | 0.85 | Multiscale means/variance/local-contrast weight. |
| `edgeWeight` | 0.35 | Gradient / texture cue weight. |
| `contextSmallWeight` / `contextMediumWeight` / `contextLargeWeight` | 1 / 0.72 / 0.48 | Relative small-, medium- and large-window context terms. |
| `contextVarianceWeight` | 0.12 | Local variance term inside context distance. |
| `localContrastWeight` | 0.18 | Local contrast term inside context distance. |
| `edgeTextureWeight` | 1.0 | Edge magnitude term inside edge distance. |
| `luminanceGradientWeight` / `chromaGradientWeight` | 0.2 / 0.2 | Gradient terms inside edge distance. |
| `colorScale` | 0.24 | OKLab distance scale. |
| `spatialScale` | 0.32 | Normalized image-space distance scale. |
| `contextScale` | 0.38 | Context-statistic distance scale. |
| `edgeScale` | 0.45 | Edge-statistic distance scale. |
| `sharpness` | 1.0 | Exponential distance multiplier. |
| `analysisMaxDimension` | 512 | Feature/seed grid cap; choices are 256, 512, 1024. |
| `downsampling` | `area` | Analysis image resize: nearest baseline, bilinear, or true area/box overlap sampling. |
| `contextRadii` | `[3,12,32]` | Small, medium and large box-statistic radii at the 512 scale. |
| `upsampling` | `guided-bilinear` | Bilinear or current color-guided 2×2 interpolation; this is not full joint-bilateral filtering. |
| `upsampleSigma` | 0.09 | RGB range bandwidth for color-guided bilinear interpolation. |
| `hintRadius` | 0.11 | Default normalized radius for newly added hints. |
| `hintSharpness` | 1.0 | Gaussian falloff multiplier for spatial hints. |

Spatial-only / color-only presets zero the other cues at evaluation time. The custom preset uses all individually configured values.

## Aggregator config

- `probabilistic-or` is default and preserves a one-seed field exactly.
- `smooth-max` is the comparison option; `temperature` defaults to 0.12.
- Hints use their explicit normalized radius or `hintRadius`, and strength is clamped to `[0,1]` during field evaluation.

## Transform config

| Setting | Default | Meaning |
|---|---:|---|
| `mode` | `adaptive` | constant / affine / root-polynomial / adaptive. |
| `regularization` | 0.025 | Base ridge penalty. |
| `nonlinearRegularization` | 0.35 | Root-polynomial high-order penalty, increased as condition worsens. |
| `interceptRegularizationWeight` | 0.15 | Fraction of base ridge applied to the residual intercept. |
| `adaptiveMinSpread` | 0.018 | OKLab color spread scale required to open nonlinear capacity. |
| `adaptiveMinConstraints` | 4 | Constraint count threshold used with spread/condition (not alone). |
| `adaptiveAffineConditionLimit` | 1e8 | Maximum design condition for affine capacity. |
| `adaptiveRootConditionLimit` | 1e6 | Maximum design condition for root-polynomial eligibility/fallback. |
| `adaptiveAffineSpreadFraction` | 0.2 | Fraction of minimum spread required before affine can be considered. |
| `adaptiveConditionBoost` / `adaptiveMaxRegularizationBoost` | 2 / 40 | Condition-to-ridge boost scale and cap. |
| `nonlinearConditionScale` / `nonlinearMaxConditionBoost` | 1e4 / 100 | Condition-dependent high-order penalty scale and cap. |
| `coefficientLimit` | 4 | Finite coefficient bound. |

`condition`, stability, effective model, coefficient rows, source spread and residual magnitude are returned in `SolvedTransform` diagnostics.

## Pipeline config

- `compositor`: `residual-add` default, `sequential`, or `normalized-mixture`.
- `gamut`: `oklch-compress` default or `hard-clip` comparison baseline.
- `architectureBaseline`: shared correction layer default; simplified per-point-independent or seed-weighted local constant-residual joint-per-pixel baseline.

Each Compare `VariantOverride` can override activation config, transform config, aggregator, compositor, gamut and architecture while sharing project constraints. Project files contain these user settings; generated feature maps, activation textures and solved transforms are always rebuilt.
