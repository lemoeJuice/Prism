import { DEFAULT_ACTIVATION, DEFAULT_AGGREGATOR, DEFAULT_PIPELINE, DEFAULT_TRANSFORM } from '../core/types'
import type { CorrectionLayer } from '../core/types'
import type { VariantOverride } from '../core/pipeline'

export const activationPresets = ['spatial-only','color-only','color+xy','color+context','color+context+edge'] as const
export const aggregatorPresets = ['probabilistic-or','smooth-max'] as const
export const transformPresets = ['constant','affine','root-polynomial','adaptive'] as const
export const compositorPresets = ['residual-add','sequential','normalized-mixture'] as const
export const architecturePresets = ['per-point-independent-layer','shared-correction-layer','joint-per-pixel-regression'] as const

export const experimentPresets:VariantOverride[]=[
  {id:'shared-context',name:'Context + edge',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:DEFAULT_PIPELINE.compositor,architecture:'shared-correction-layer'},
  {id:'spatial-only',name:'Spatial-only',activation:{...DEFAULT_ACTIVATION,preset:'spatial-only'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'color-only',name:'Color-only',activation:{...DEFAULT_ACTIVATION,preset:'color-only'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'color-xy',name:'Color + XY',activation:{...DEFAULT_ACTIVATION,preset:'color+xy'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'color-context',name:'Color + context',activation:{...DEFAULT_ACTIVATION,preset:'color+context'},aggregator:'smooth-max',transform:{...DEFAULT_TRANSFORM,mode:'root-polynomial'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'constant-transform',name:'Constant transform',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'constant'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'affine-transform',name:'Affine transform',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'affine'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'root-transform',name:'Root-polynomial transform',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'root-polynomial'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'adaptive-transform',name:'Adaptive transform',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'residual-add',architecture:'shared-correction-layer'},
  {id:'resize-nearest',name:'Resize · nearest',activation:{...DEFAULT_ACTIVATION,downsampling:'nearest'},architecture:'shared-correction-layer'},
  {id:'resize-bilinear',name:'Resize · bilinear',activation:{...DEFAULT_ACTIVATION,downsampling:'bilinear'},architecture:'shared-correction-layer'},
  {id:'resize-area',name:'Resize · area/box',activation:{...DEFAULT_ACTIVATION,downsampling:'area'},architecture:'shared-correction-layer'},
  {id:'upsample-bilinear',name:'Upsample · bilinear',activation:{...DEFAULT_ACTIVATION,upsampling:'bilinear'},architecture:'shared-correction-layer'},
  {id:'upsample-guided',name:'Upsample · guided bilinear 2×2',activation:{...DEFAULT_ACTIVATION,upsampling:'guided-bilinear'},architecture:'shared-correction-layer'},
  {id:'sequential',name:'Sequential compositor',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'sequential',architecture:'shared-correction-layer'},
  {id:'normalized-mixture',name:'Normalized mixture',activation:{...DEFAULT_ACTIVATION,preset:'color+context+edge'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'adaptive'},compositor:'normalized-mixture',architecture:'shared-correction-layer'},
  {id:'independent',name:'Per-point baseline',activation:{...DEFAULT_ACTIVATION,preset:'color+xy'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'constant'},compositor:'normalized-mixture',architecture:'per-point-independent-layer'},
  {id:'joint-regression',name:'Joint per-pixel baseline',activation:{...DEFAULT_ACTIVATION,preset:'color+xy'},aggregator:'probabilistic-or',transform:{...DEFAULT_TRANSFORM,mode:'affine'},compositor:'residual-add',architecture:'joint-per-pixel-regression'},
]
export function createLayer(id:string,name:string):CorrectionLayer {
  return {id,name,enabled:true,strength:0.85,constraints:[],activationHints:[],activationConfig:{...DEFAULT_ACTIVATION,contextRadii:[...DEFAULT_ACTIVATION.contextRadii]},activationAggregator:{...DEFAULT_AGGREGATOR},transformConfig:{...DEFAULT_TRANSFORM},transformModifiers:[]}
}
