import { linearToOKLab } from '../color'
import { featureForConstraint } from '../features'
import type { FeatureMap, PixelFeature } from '../features'
import { DEFAULT_ACTIVATION } from '../types'
import type { ActivationAggregatorConfig, ActivationConfig, ActivationHint, ActivationHintSample, ColorConstraint, Vec2 } from '../types'

export interface ActivationSeedTexture { constraintId: string; width: number; height: number; values: Float32Array }
export interface ActivationModel { evaluate(query: PixelFeature, seed: PixelFeature, config: ActivationConfig): number }
export interface ActivationBreakdown {
  colorDistance:number;spatialDistance:number;contextDistance:number;edgeDistance:number
  weightedColor:number;weightedSpatial:number;weightedContext:number;weightedEdge:number;totalDistance:number;activation:number
}
export interface ActivationAggregator {
  aggregate(seedValues: readonly number[], hints: readonly ActivationHintSample[], config: ActivationAggregatorConfig): number
}
const bounded=(value:number,fallback:number,min:number,max:number)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback
export function normalizeActivationConfig(input:ActivationConfig):ActivationConfig {
  const value={...DEFAULT_ACTIVATION,...input},validPresets=['spatial-only','color-only','color+xy','color+context','color+context+edge','custom']
  const radii=(Array.isArray(value.contextRadii)&&value.contextRadii.length===3?value.contextRadii:DEFAULT_ACTIVATION.contextRadii).map((radius,index)=>bounded(radius,DEFAULT_ACTIVATION.contextRadii[index],1,256)) as [number,number,number]
  const resolutions=[256,512,1024] as const
  const requested=Number.isFinite(value.analysisMaxDimension)?value.analysisMaxDimension:512
  const resolution=resolutions.reduce((best,current)=>Math.abs(current-requested)<Math.abs(best-requested)?current:best,512)
  return {
    ...value,model:'appearance-gaussian',preset:validPresets.includes(value.preset)?value.preset:'custom',
    colorWeight:bounded(value.colorWeight,DEFAULT_ACTIVATION.colorWeight,0,20),spatialWeight:bounded(value.spatialWeight,DEFAULT_ACTIVATION.spatialWeight,0,20),
    contextWeight:bounded(value.contextWeight,DEFAULT_ACTIVATION.contextWeight,0,20),edgeWeight:bounded(value.edgeWeight,DEFAULT_ACTIVATION.edgeWeight,0,20),
    contextSmallWeight:bounded(value.contextSmallWeight,1,0,20),contextMediumWeight:bounded(value.contextMediumWeight,.72,0,20),contextLargeWeight:bounded(value.contextLargeWeight,.48,0,20),
    contextVarianceWeight:bounded(value.contextVarianceWeight,.12,0,20),localContrastWeight:bounded(value.localContrastWeight,.18,0,20),edgeTextureWeight:bounded(value.edgeTextureWeight,1,0,20),
    luminanceGradientWeight:bounded(value.luminanceGradientWeight,.2,0,20),chromaGradientWeight:bounded(value.chromaGradientWeight,.2,0,20),
    spatialScale:bounded(value.spatialScale,.32,.0001,10),colorScale:bounded(value.colorScale,.24,.0001,10),contextScale:bounded(value.contextScale,.38,.0001,10),edgeScale:bounded(value.edgeScale,.45,.0001,10),
    sharpness:bounded(value.sharpness,1,.001,100),analysisMaxDimension:resolution,contextRadii:radii,
     downsampling:value.downsampling==='nearest'||value.downsampling==='bilinear'?value.downsampling:'area',
     upsampling:value.upsampling==='bilinear'?'bilinear':'guided-bilinear',upsampleSigma:bounded(value.upsampleSigma,.09,.005,2),
    hintRadius:bounded(value.hintRadius,.11,.005,1),hintSharpness:bounded(value.hintSharpness,1,.001,100),
  }
}
export function normalizeActivationAggregatorConfig(input:ActivationAggregatorConfig):ActivationAggregatorConfig {
  return {type:input.type==='smooth-max'?'smooth-max':'probabilistic-or',temperature:bounded(input.temperature,.12,.001,10)}
}
const presetWeights = (config: ActivationConfig) => {
  switch(config.preset) {
    case 'spatial-only': return [0,1,0,0]
    case 'color-only': return [1,0,0,0]
    case 'color+xy': return [1,1,0,0]
    case 'color+context': return [0.65,0.2,1,0]
    case 'color+context+edge': return [config.colorWeight,config.spatialWeight,config.contextWeight,config.edgeWeight]
    default: return [config.colorWeight,config.spatialWeight,config.contextWeight,config.edgeWeight]
  }
}
export const gaussianActivationModel: ActivationModel = {
  evaluate(query, seed, config) {
    return evaluateAppearanceGaussian(query,seed,config).activation
  },
}
export function evaluateAppearanceGaussian(query:PixelFeature,seed:PixelFeature,config:ActivationConfig):ActivationBreakdown {
    const [wc,ws,wm,we]=presetWeights(config)
    const cs=Math.max(1e-4,config.colorScale), ss=Math.max(1e-4,config.spatialScale), ms=Math.max(1e-4,config.contextScale), es=Math.max(1e-4,config.edgeScale)
    const dc=((query.lab[0]-seed.lab[0])**2 + (query.lab[1]-seed.lab[1])**2 + (query.lab[2]-seed.lab[2])**2)/(cs*cs)
    const dx=(query.x-seed.x)/ss, dy=(query.y-seed.y)/ss, dxy=dx*dx+dy*dy
    let context=0
    for(let i=0;i<9;i++) {
      const scaleFactor=i<3?config.contextSmallWeight:i<6?config.contextMediumWeight:config.contextLargeWeight
      context += scaleFactor*((query.means[i]-seed.means[i])**2/(ms*ms) + config.contextVarianceWeight*(Math.sqrt(query.variances[i])-Math.sqrt(seed.variances[i]))**2/(ms*ms))
    }
    context = context / 9 + config.localContrastWeight*(query.localContrast-seed.localContrast)**2/(ms*ms)
    const edge=config.edgeTextureWeight*(query.edgeStrength-seed.edgeStrength)**2/(es*es) + config.luminanceGradientWeight*(query.luminanceGradient-seed.luminanceGradient)**2/(es*es) + config.chromaGradientWeight*(query.chromaGradient-seed.chromaGradient)**2/(es*es)
    const weightedColor=wc*dc,weightedSpatial=ws*dxy,weightedContext=wm*context,weightedEdge=we*edge
    const distance=Math.max(0, weightedColor + weightedSpatial + weightedContext + weightedEdge)
    return {colorDistance:dc,spatialDistance:dxy,contextDistance:context,edgeDistance:edge,weightedColor,weightedSpatial,weightedContext,weightedEdge,totalDistance:distance,activation:Math.min(1,Math.max(0,Math.exp(-0.5*distance*Math.max(0.001,config.sharpness))))}
}

export const probabilisticOrAggregator: ActivationAggregator = {
  aggregate(seedValues,hints) {
    let remaining=1
    for(const value of seedValues) remaining *= 1-Math.min(1,Math.max(0,value))
    let result=1-remaining
    for(const hint of hints) {
      const value=Math.min(1,Math.max(0,hint.influence))
      result = hint.type==='include' ? 1-(1-result)*(1-value) : result*(1-value)
    }
    return Math.min(1,Math.max(0,result))
  },
}
export const smoothMaxAggregator: ActivationAggregator = {
  aggregate(seedValues,hints,config) {
    let result=0
    if(seedValues.length===1) result=seedValues[0]
    else if(seedValues.length>1) {
      const t=Math.max(1e-3,config.temperature), max=Math.max(...seedValues)
      const sum=seedValues.reduce((a,v)=>a+Math.exp((v-max)/t),0)
      result=Math.min(1,max+t*Math.log(sum)/Math.max(1,Math.log(seedValues.length+1)))
    }
    for(const hint of hints) result=hint.type==='include'?1-(1-result)*(1-hint.influence):result*(1-hint.influence)
    return Math.min(1,Math.max(0,result))
  },
}
export function getAggregator(type: ActivationAggregatorConfig['type']): ActivationAggregator {
  return type==='smooth-max'?smoothMaxAggregator:probabilisticOrAggregator
}
export function hintInfluence(hint: ActivationHint, position: Vec2, config: ActivationConfig): number {
  const radius=Math.max(0.005,Number.isFinite(hint.radius)?hint.radius!:config.hintRadius),hintX=Number.isFinite(hint.position?.x)?Math.min(1,Math.max(0,hint.position.x)):.5,hintY=Number.isFinite(hint.position?.y)?Math.min(1,Math.max(0,hint.position.y)):.5
  const dx=(position.x-hintX)/radius,dy=(position.y-hintY)/radius,strength=Number.isFinite(hint.strength)?Math.min(1,Math.max(0,hint.strength)):0
  return Math.min(1,Math.max(0,strength*Math.exp(-0.5*config.hintSharpness*(dx*dx+dy*dy))))
}
export function computeSeedField(map: FeatureMap, constraint: ColorConstraint, config: ActivationConfig): ActivationSeedTexture {
  config=normalizeActivationConfig(config)
  const seed=featureForConstraint(map,constraint.position,constraint.source), values=new Float32Array(map.width*map.height)
  const [wc,ws,wm,we]=presetWeights(config),cs=Math.max(1e-4,config.colorScale),ss=Math.max(1e-4,config.spatialScale),ms=Math.max(1e-4,config.contextScale),es=Math.max(1e-4,config.edgeScale),sharpness=Math.max(0.001,config.sharpness)
  const confidence=Number.isFinite(constraint.confidence)?Math.min(1,Math.max(0,constraint.confidence)):0
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
    const i=y*map.width+x,l=i*3,m=i*9
    const dL=map.lab[l]-seed.lab[0],da=map.lab[l+1]-seed.lab[1],db=map.lab[l+2]-seed.lab[2]
    const dc=(dL*dL+da*da+db*db)/(cs*cs),dx=x/(map.width-1||1)-seed.x,dy=y/(map.height-1||1)-seed.y
    let context=0
    for(let j=0;j<9;j++){
      const scaleFactor=j<3?config.contextSmallWeight:j<6?config.contextMediumWeight:config.contextLargeWeight,queryVar=Math.sqrt(map.variances[m+j]),seedVar=Math.sqrt(seed.variances[j])
      context+=scaleFactor*((map.means[m+j]-seed.means[j])**2/(ms*ms)+config.contextVarianceWeight*(queryVar-seedVar)**2/(ms*ms))
    }
    context=context/9+config.localContrastWeight*(map.localContrast[i]-seed.localContrast)**2/(ms*ms)
    const edge=config.edgeTextureWeight*(map.edgeStrength[i]-seed.edgeStrength)**2/(es*es)+config.luminanceGradientWeight*(map.luminanceGradient[i]-seed.luminanceGradient)**2/(es*es)+config.chromaGradientWeight*(map.chromaGradient[i]-seed.chromaGradient)**2/(es*es)
    const distance=Math.max(0,wc*dc+ws*(dx*dx+dy*dy)/(ss*ss)+wm*context+we*edge)
    values[i]=Math.min(1,Math.max(0,confidence*Math.exp(-0.5*distance*sharpness)))
  }
  return { constraintId:constraint.id,width:map.width,height:map.height,values }
}
export function aggregateActivationFields(
  seedFields: readonly ActivationSeedTexture[], hints: readonly ActivationHint[], config: ActivationConfig,
  aggregatorConfig: ActivationAggregatorConfig,
): Float32Array {
  if(seedFields.length===1 && hints.length===0) return new Float32Array(seedFields[0].values)
  const first=seedFields[0], n=first?.values.length ?? 0, output=new Float32Array(n), aggregator=getAggregator(aggregatorConfig.type)
  for(let i=0;i<n;i++) {
    const x=(i%first.width)/(first.width-1||1), y=Math.floor(i/first.width)/(first.height-1||1)
    const values=seedFields.map(field=>field.values[i] ?? 0)
    const hintSamples=hints.map(hint=>({ type:hint.type,influence:hintInfluence(hint,{x,y},config) }))
    output[i]=aggregator.aggregate(values,hintSamples,aggregatorConfig)
  }
  return output
}
export function seedSourceColor(source: ColorConstraint['source']) { return linearToOKLab(source) }
