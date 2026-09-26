# Metrics hooks

`src/experiments/metrics/index.ts` exports `evaluateImageMetrics` for paired synthetic results. It reports mean / 95th-percentile OKLab ΔE, optional boundary-band error, out-of-gamut rate, runtime, and constraint count. Supply a one-byte-per-pixel boundary mask and out-of-gamut mask where available.

The app reports runtime and out-of-gamut rate live; ground-truth comparisons are intended for the generated fixture harness.
