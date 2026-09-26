# Compare presets

`preset-catalog.json` mirrors the built-in Compare Mode variants. The current main path is `shared-correction-layer`. Activation, aggregator, transform and compositor are independently overridable in `src/experiments/presets.ts`.

The UI includes a working per-point-independent approximation and a simplified joint-per-pixel baseline. The joint baseline uses seed-weighted local constant residual regression; a higher-capacity local affine solve remains future work. Neither approximation is presented as a reproduction of a published method.
