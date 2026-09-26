export interface Vec2 { x: number; y: number }
export interface LinearRGB { r: number; g: number; b: number }
export interface OKLab { L: number; a: number; b: number }

export interface ColorConstraint {
  id: string
  position: Vec2
  source: LinearRGB
  target: LinearRGB
  confidence: number
}
export interface ActivationHint {
  id: string
  position: Vec2
  type: 'include' | 'exclude'
  strength: number
  radius?: number
}
export interface TransformModifierConfig { type: string; value?: number }

export type ActivationPreset = 'spatial-only' | 'color-only' | 'color+xy' | 'color+context' | 'color+context+edge' | 'custom'
export interface ActivationConfig {
  model: 'appearance-gaussian'
  preset: ActivationPreset
  colorWeight: number
  spatialWeight: number
  contextWeight: number
  edgeWeight: number
  contextSmallWeight: number
  contextMediumWeight: number
  contextLargeWeight: number
  contextVarianceWeight: number
  localContrastWeight: number
  edgeTextureWeight: number
  luminanceGradientWeight: number
  chromaGradientWeight: number
  spatialScale: number
  colorScale: number
  contextScale: number
  edgeScale: number
  sharpness: number
  analysisMaxDimension: 256 | 512 | 1024
  downsampling: 'nearest' | 'bilinear' | 'area'
  contextRadii: [number, number, number]
  upsampling: 'bilinear' | 'guided-bilinear'
  upsampleSigma: number
  hintRadius: number
  hintSharpness: number
}
export interface ActivationAggregatorConfig { type: 'probabilistic-or' | 'smooth-max'; temperature: number }
export type TransformMode = 'constant' | 'affine' | 'root-polynomial' | 'adaptive'
export interface TransformConfig {
  mode: TransformMode
  regularization: number
  nonlinearRegularization: number
  interceptRegularizationWeight: number
  adaptiveMinSpread: number
  adaptiveMinConstraints: number
  adaptiveAffineConditionLimit: number
  adaptiveRootConditionLimit: number
  adaptiveAffineSpreadFraction: number
  adaptiveConditionBoost: number
  adaptiveMaxRegularizationBoost: number
  nonlinearConditionScale: number
  nonlinearMaxConditionBoost: number
  coefficientLimit: number
}
export interface CorrectionLayer {
  id: string
  name: string
  enabled: boolean
  strength: number
  constraints: ColorConstraint[]
  activationHints: ActivationHint[]
  activationConfig: ActivationConfig
  activationAggregator: ActivationAggregatorConfig
  transformConfig: TransformConfig
  transformModifiers: TransformModifierConfig[]
  metadata?: Record<string, unknown>
}
export interface PipelineConfig {
  compositor: 'residual-add' | 'sequential' | 'normalized-mixture'
  gamut: 'oklch-compress' | 'hard-clip'
  architectureBaseline: 'shared-correction-layer' | 'per-point-independent-layer' | 'joint-per-pixel-regression'
}
export interface ImageReference { name: string; width: number; height: number; fingerprint: string; mimeType: string }
export interface Project {
  version: 1
  image: ImageReference
  layers: CorrectionLayer[]
  pipeline: PipelineConfig
  comparePresetIds: string[]
}
export interface ActivationHintSample { type: 'include' | 'exclude'; influence: number }

export const DEFAULT_ACTIVATION: ActivationConfig = {
  model: 'appearance-gaussian', preset: 'color+context+edge', colorWeight: 1.15, spatialWeight: 0.75,
  contextWeight: 0.85, edgeWeight: 0.35, spatialScale: 0.32, colorScale: 0.24,
  contextScale: 0.38, edgeScale: 0.45, sharpness: 1, analysisMaxDimension: 512,
  contextSmallWeight:1,contextMediumWeight:0.72,contextLargeWeight:0.48,contextVarianceWeight:0.12,
  localContrastWeight:0.18,edgeTextureWeight:1,luminanceGradientWeight:0.2,chromaGradientWeight:0.2,
  contextRadii: [3, 12, 32], downsampling:'area', upsampling: 'guided-bilinear', upsampleSigma: 0.09, hintRadius: 0.11,hintSharpness:1,
}
export const DEFAULT_AGGREGATOR: ActivationAggregatorConfig = { type: 'probabilistic-or', temperature: 0.12 }
export const DEFAULT_TRANSFORM: TransformConfig = {
  mode: 'adaptive', regularization: 0.025, nonlinearRegularization: 0.35,interceptRegularizationWeight:0.15,
  adaptiveMinSpread: 0.018, adaptiveMinConstraints: 4,adaptiveAffineConditionLimit:1e8,adaptiveRootConditionLimit:1e6,
  adaptiveAffineSpreadFraction:0.2,adaptiveConditionBoost:2,adaptiveMaxRegularizationBoost:40,
  nonlinearConditionScale:1e4,nonlinearMaxConditionBoost:100,coefficientLimit:4,
}
export const DEFAULT_PIPELINE: PipelineConfig = {
  compositor: 'residual-add', gamut: 'oklch-compress', architectureBaseline: 'shared-correction-layer',
}
