# Synthetic fixtures

The deterministic fixture generator is `src/experiments/fixtures/synthetic.ts`. It produces paired `observed` / `groundTruth` RGBA arrays and includes six cases:

- two spatial illumination regions;
- smooth warm-to-cool gradient;
- same color in different contexts;
- different colors in one shared regime;
- object-boundary leakage;
- nonlinear color-response bias.

Call `createSyntheticFixture(name, width?, height?)` from a browser or test harness. Each result includes paired `observed` / `groundTruth` pixels and automatically sampled `calibrationConstraints` with source colors from the distorted original and targets from ground truth. Fixtures are generated, not bundled image files.
