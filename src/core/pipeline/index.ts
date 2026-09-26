import { clamp01, hardClipGamut, linearToEncodedRgb, linearToOKLab, oklchChromaCompression, srgbToLinear } from '../color'
import { aggregateActivationFields, computeSeedField, normalizeActivationAggregatorConfig, normalizeActivationConfig, type ActivationSeedTexture } from '../activation'
import { makeAnalysisImage, multiscaleFeatureExtractor, type AnalysisImage, type FeatureMap } from '../features'
import { getCompositor } from '../compositor'
import { weightedRidgeTransform, type SolvedTransform } from '../transform'
import type { ActivationConfig, ColorConstraint, CorrectionLayer, PipelineConfig, TransformConfig } from '../types'

export type DebugView='corrected'|'original'|'split'|'difference'|'activation'|'activation-overlay'|'seed'|'dominant'|'contribution'|'total-correction'|'out-of-gamut'
export interface VariantOverride {
  id:string; name:string; activation?:Partial<ActivationConfig>; transform?:Partial<TransformConfig>
  aggregator?:CorrectionLayer['activationAggregator']['type']; compositor?:PipelineConfig['compositor']; gamut?:PipelineConfig['gamut']; architecture?:PipelineConfig['architectureBaseline']
}
export interface LayerDebug {
  id:string; activation:Float32Array; seeds:ActivationSeedTexture[]; contribution:Float32Array; transform:SolvedTransform
}
export interface PipelineOutput {
  width:number;height:number;rgba:Uint8ClampedArray;corrected:Uint8ClampedArray;debug:LayerDebug[]
  dominant:Uint8Array;outOfGamut:Uint8Array;totalMagnitude:Float32Array
  processingMs:number;outOfGamutRate:number;variantId:string
}
interface ActivationCacheEntry { key:string; seeds:ActivationSeedTexture[]; field:Float32Array; width:number;height:number }
const seedCache=new Map<string,ActivationSeedTexture>()
const fieldCache=new Map<string,ActivationCacheEntry>()
const featureCache=new Map<string,Promise<FeatureMap>>()
const upsampleCache=new Map<string,Float32Array>()
let seedTextureIds=new WeakMap<ActivationSeedTexture,number>(),nextSeedTextureId=1
export function clearPipelineCaches(){seedCache.clear();fieldCache.clear();featureCache.clear();upsampleCache.clear();seedTextureIds=new WeakMap();nextSeedTextureId=1}
function cacheSet<T>(cache:Map<string,T>,key:string,value:T,maxEntries:number){
  cache.delete(key);cache.set(key,value)
  while(cache.size>maxEntries){const oldest=cache.keys().next().value as string|undefined;if(oldest===undefined)break;cache.delete(oldest)}
}
function maxFieldCacheEntries(pixels:number){return Math.max(1,Math.min(8,Math.floor(96_000_000/Math.max(1,pixels*4))))}
function stable(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value)
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}
const colorKey=(c:ColorConstraint)=>({id:c.id,position:c.position,source:c.source,confidence:c.confidence})
async function preparedActivation(image:AnalysisImage,fingerprint:string,layer:CorrectionLayer,config:ActivationConfig,aggregator:CorrectionLayer['activationAggregator'],features:FeatureMap):Promise<ActivationCacheEntry>{
  const featureKey=stable({fingerprint,width:image.width,height:image.height,config})
  const seedKeys=layer.constraints.map(c=>`${featureKey}:${stable(colorKey(c))}`)
  const seeds=layer.constraints.map((constraint,i)=>{
    let seed=seedCache.get(seedKeys[i])
    if(!seed){seed=computeSeedField(features,constraint,config);cacheSet(seedCache,seedKeys[i],seed,24)}
    else cacheSet(seedCache,seedKeys[i],seed,24)
    return seed
  })
  const fieldKey=stable({seedKeys,hints:layer.activationHints,aggregator})
  let cached=fieldCache.get(fieldKey)
  if(!cached){
    cached={key:fieldKey,seeds,field:seeds.length?aggregateActivationFields(seeds,layer.activationHints,config,aggregator):new Float32Array(features.width*features.height),width:features.width,height:features.height}
    cacheSet(fieldCache,fieldKey,cached,12)
  }else cacheSet(fieldCache,fieldKey,cached,12)
  return cached
}

function bilinear(values:Float32Array,width:number,height:number,x:number,y:number){
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),tx=x-x0,ty=y-y0
  const a=values[y0*width+x0]*(1-tx)+values[y0*width+x1]*tx,b=values[y1*width+x0]*(1-tx)+values[y1*width+x1]*tx
  return a*(1-ty)+b*ty
}
function upsampleSeed(seed:ActivationSeedTexture,original:AnalysisImage,config:ActivationConfig){
  let id=seedTextureIds.get(seed)
  if(id===undefined){id=nextSeedTextureId++;seedTextureIds.set(seed,id)}
  const key=stable({seed:id,width:original.width,height:original.height,upsampling:config.upsampling,sigma:config.upsampleSigma})
  let field=upsampleCache.get(key)
  if(!field){field=upsampleActivation(seed.values,seed.width,seed.height,original,config.upsampling,config.upsampleSigma);cacheSet(upsampleCache,key,field,maxFieldCacheEntries(original.width*original.height))}
  return field
}
export function upsampleActivation(
  values:Float32Array,lowWidth:number,lowHeight:number,original:AnalysisImage,mode:ActivationConfig['upsampling'],sigma:number,
):Float32Array{
  const {width,height,data}=original,output=new Float32Array(width*height)
  if(mode==='bilinear'){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)output[y*width+x]=bilinear(values,lowWidth,lowHeight,x*(lowWidth-1)/(width-1||1),y*(lowHeight-1)/(height-1||1))
    return output
  }
  const guide=makeAnalysisImage(original,Math.max(lowWidth,lowHeight)), features=guide.data, lowRgb=new Float32Array(lowWidth*lowHeight*3)
  // The feature image has the same sampling grid as activation; use it as the joint bilateral guide.
  for(let i=0;i<lowWidth*lowHeight;i++){
    const x=Math.min(guide.width-1,Math.floor(i%lowWidth*guide.width/lowWidth)),y=Math.min(guide.height-1,Math.floor(Math.floor(i/lowWidth)*guide.height/lowHeight)),p=(y*guide.width+x)*4
    lowRgb[i*3]=srgbToLinear(features[p]/255);lowRgb[i*3+1]=srgbToLinear(features[p+1]/255);lowRgb[i*3+2]=srgbToLinear(features[p+2]/255)
  }
  const range=Math.max(0.015,sigma), spatialOffsets=[0,1,2,3]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const fx=x*(lowWidth-1)/(width-1||1),fy=y*(lowHeight-1)/(height-1||1),x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,p=(y*width+x)*4
    const high=[srgbToLinear(data[p]/255),srgbToLinear(data[p+1]/255),srgbToLinear(data[p+2]/255)]
    let sum=0,total=0
    for(const oy of spatialOffsets.slice(0,2))for(const ox of spatialOffsets.slice(0,2)){
      const xx=Math.min(lowWidth-1,x0+ox),yy=Math.min(lowHeight-1,y0+oy),index=yy*lowWidth+xx,dx=ox?tx:1-tx,dy=oy?ty:1-ty
      const rgbDistance=(high[0]-lowRgb[index*3])**2+(high[1]-lowRgb[index*3+1])**2+(high[2]-lowRgb[index*3+2])**2
      const weight=dx*dy*Math.exp(-rgbDistance/(2*range*range));sum+=weight*values[index];total+=weight
    }
    output[y*width+x]=total>1e-8?sum/total:bilinear(values,lowWidth,lowHeight,fx,fy)
  }
  return output
}

function resolveOverrides(layer:CorrectionLayer,variant:VariantOverride){
  return {
    activation:normalizeActivationConfig({...layer.activationConfig,...variant.activation}),
    transform:{...layer.transformConfig,...variant.transform},
    aggregator:normalizeActivationAggregatorConfig({...layer.activationAggregator,...(variant.aggregator?{type:variant.aggregator}:{})} as CorrectionLayer['activationAggregator']),
  }
}
function makeIndependentLayers(layers:CorrectionLayer[]):CorrectionLayer[]{
  return layers.flatMap(layer=>layer.constraints.map((constraint,index)=>({...layer,id:`${layer.id}:${constraint.id}`,name:`${layer.name} · point ${index+1}`,constraints:[constraint],activationHints:[]})))
}
export async function runPipeline(
  original:AnalysisImage,fingerprint:string,layers:CorrectionLayer[],pipeline:PipelineConfig,variant:VariantOverride,
  view:DebugView='corrected',selectedLayerId?:string,selectedConstraintId?:string,
):Promise<PipelineOutput>{
  const started=performance.now(),width=original.width,height=original.height,n=width*height
  const architecture=variant.architecture??pipeline.architectureBaseline
  const activeLayers=architecture==='per-point-independent-layer'?makeIndependentLayers(layers):layers
  if(activeLayers.length===0){
    const corrected=new Uint8ClampedArray(original.data),rgba=new Uint8ClampedArray(corrected)
    if(view==='difference'||view==='out-of-gamut')for(let i=0;i<n;i++){const p=i*4;rgba[p]=view==='difference'?0:24;rgba[p+1]=view==='difference'?0:31;rgba[p+2]=view==='difference'?0:29;rgba[p+3]=255}
    else if(view==='dominant'||view==='contribution'||view==='activation'||view==='activation-overlay'||view==='seed'||view==='total-correction')rgba.fill(0),rgba.forEach((_,i)=>{if(i%4===3)rgba[i]=255})
    return {width,height,rgba,corrected,debug:[],dominant:new Uint8Array(n),outOfGamut:new Uint8Array(n),totalMagnitude:new Float32Array(n),processingMs:performance.now()-started,outOfGamutRate:0,variantId:variant.id}
  }
  const configs=activeLayers.map(layer=>resolveOverrides(layer,variant))
  const evaluated: {layer:CorrectionLayer; transform:SolvedTransform; activation:Float32Array; seeds:ActivationSeedTexture[];activationConfig:ActivationConfig}[]=[]
  for(let li=0;li<activeLayers.length;li++){
    const layer=activeLayers[li],cfg=configs[li]
    if(layer.constraints.length===0){
      const transform=weightedRidgeTransform.solve([],cfg.transform)
      evaluated.push({layer,transform,activation:new Float32Array(n),seeds:[],activationConfig:cfg.activation})
      continue
    }
    const analysis=makeAnalysisImage(original,cfg.activation.analysisMaxDimension),featureKey=stable({fingerprint,width:analysis.width,height:analysis.height,radii:cfg.activation.contextRadii})
    let featurePromise=featureCache.get(featureKey)
    if(!featurePromise){featurePromise=multiscaleFeatureExtractor.analyze(analysis,{contextRadii:cfg.activation.contextRadii});const featureBytes=analysis.width*analysis.height*112;cacheSet(featureCache,featureKey,featurePromise,Math.max(1,Math.min(4,Math.floor(224_000_000/featureBytes))))}
    else cacheSet(featureCache,featureKey,featurePromise,Math.max(1,Math.min(4,Math.floor(224_000_000/(analysis.width*analysis.height*112)))))
    const features=await featurePromise
    const cache=await preparedActivation(analysis,fingerprint,layer,cfg.activation,cfg.aggregator,features)
    const upKey=stable({key:cache.key,width,height,upsampling:cfg.activation.upsampling,sigma:cfg.activation.upsampleSigma})
    let activation=upsampleCache.get(upKey)
    if(!activation){activation=upsampleActivation(cache.field,cache.width,cache.height,original,cfg.activation.upsampling,cfg.activation.upsampleSigma);cacheSet(upsampleCache,upKey,activation,maxFieldCacheEntries(n))}
    else cacheSet(upsampleCache,upKey,activation,maxFieldCacheEntries(n))
    const transform=weightedRidgeTransform.solve(layer.constraints,cfg.transform)
    evaluated.push({layer,transform,activation,seeds:cache.seeds,activationConfig:cfg.activation})
  }
  if(architecture==='joint-per-pixel-regression'){
    const jointEvidence=evaluated.flatMap(item=>item.layer.constraints.map(constraint=>{
      const seed=item.seeds.find(field=>field.constraintId===constraint.id)
      return {layerId:item.layer.id,constraint,layer:item.layer,field:seed?upsampleSeed(seed,original,item.activationConfig):new Float32Array(n)}
    }))
    const corrected=new Uint8ClampedArray(n*4),dominant=new Uint8Array(n),outOfGamut=new Uint8Array(n),totalMagnitude=new Float32Array(n),contributions=evaluated.map(()=>new Float32Array(n));let outCount=0
    for(let i=0;i<n;i++){
      const p=i*4,input={r:srgbToLinear(original.data[p]/255),g:srgbToLinear(original.data[p+1]/255),b:srgbToLinear(original.data[p+2]/255)}
      let dr=0,dg=0,db=0,weightSum=0,best=-1,bestValue=-1
      for(const evidence of jointEvidence){
        const weight=evidence.layer.enabled?clamp01(evidence.layer.strength*evidence.field[i]):0;if(!weight)continue
        const r=evidence.constraint.target.r-evidence.constraint.source.r,g=evidence.constraint.target.g-evidence.constraint.source.g,b=evidence.constraint.target.b-evidence.constraint.source.b
        dr+=weight*r;dg+=weight*g;db+=weight*b;weightSum+=weight
        const layerIndex=evaluated.findIndex(item=>item.layer.id===evidence.layerId),magnitude=weight*Math.hypot(r,g,b)
        if(layerIndex>=0)contributions[layerIndex][i]+=magnitude
        if(magnitude>bestValue){bestValue=magnitude;best=layerIndex}
      }
      const normalization=Math.max(1,weightSum)
      dr/=normalization;dg/=normalization;db/=normalization
      dominant[i]=best>=0?best:255;totalMagnitude[i]=Math.hypot(dr,dg,db)
      const raw={r:input.r+dr,g:input.g+dg,b:input.b+db},invalid=[raw.r,raw.g,raw.b].some(v=>!Number.isFinite(v)||v<0||v>1)
      if(invalid){outOfGamut[i]=1;outCount++}
      const mapped=(variant.gamut??pipeline.gamut)==='hard-clip'?hardClipGamut.map(raw):oklchChromaCompression.map(raw),encoded=linearToEncodedRgb(mapped)
      corrected[p]=Math.round(encoded[0]*255);corrected[p+1]=Math.round(encoded[1]*255);corrected[p+2]=Math.round(encoded[2]*255);corrected[p+3]=original.data[p+3]
    }
    const debug=evaluated.map((item,index)=>({id:item.layer.id,activation:item.activation,seeds:item.seeds,contribution:contributions[index],transform:item.transform}))
    const rgba=view==='corrected'?new Uint8ClampedArray(corrected):debugViewPixels(view,original,corrected,debug,dominant,outOfGamut,totalMagnitude,selectedLayerId,selectedConstraintId)
    return {width,height,rgba,corrected,debug,dominant,outOfGamut,totalMagnitude,processingMs:performance.now()-started,outOfGamutRate:n?outCount/n:0,variantId:variant.id}
  }
  const compositorConfig={mode:variant.compositor??pipeline.compositor,gamut:variant.gamut??pipeline.gamut}
  const compositor=getCompositor(compositorConfig.mode),corrected=new Uint8ClampedArray(n*4),dominant=new Uint8Array(n),outOfGamut=new Uint8Array(n),totalMagnitude=new Float32Array(n)
  const contributions=evaluated.map(()=>new Float32Array(n));let outCount=0
  for(let i=0;i<n;i++){
    const p=i*4,input={r:srgbToLinear(original.data[p]/255),g:srgbToLinear(original.data[p+1]/255),b:srgbToLinear(original.data[p+2]/255)}
    let best=-1,bestContribution=0
    for(let j=0;j<evaluated.length;j++){
      const item=evaluated[j],gain=item.layer.enabled?clamp01(item.layer.strength*item.activation[i]):0,transformed=item.transform.apply(input)
      const magnitude=gain*Math.hypot(transformed.r-input.r,transformed.g-input.g,transformed.b-input.b)
      contributions[j][i]=magnitude;totalMagnitude[i]+=magnitude
      if(magnitude>bestContribution){bestContribution=magnitude;best=j}
    }
    dominant[i]=best
    const descriptors=evaluated.map(item=>({id:item.layer.id,enabled:item.layer.enabled,strength:item.layer.strength,activation:item.activation[i],transform:item.transform}))
    const {raw,output:mapped}=compositor.composeDetailed(input,descriptors,compositorConfig)
    const gamutInvalid=[raw.r,raw.g,raw.b].some(v=>!Number.isFinite(v)||v<0||v>1)
    if(gamutInvalid){outOfGamut[i]=1;outCount++}
    const encoded=linearToEncodedRgb(mapped);corrected[p]=Math.round(encoded[0]*255);corrected[p+1]=Math.round(encoded[1]*255);corrected[p+2]=Math.round(encoded[2]*255);corrected[p+3]=original.data[p+3]
  }
  const debug=evaluated.map((item,index)=>({id:item.layer.id,activation:item.activation,seeds:item.seeds,contribution:contributions[index],transform:item.transform}))
  let rgba=new Uint8ClampedArray(corrected)
  if(view!=='corrected') rgba=debugViewPixels(view,original,corrected,debug,dominant,outOfGamut,totalMagnitude,selectedLayerId,selectedConstraintId)
  return {width,height,rgba,corrected,debug,dominant,outOfGamut,totalMagnitude,processingMs:performance.now()-started,outOfGamutRate:n?outCount/n:0,variantId:variant.id}
}
function heat(v:number):[number,number,number]{const t=clamp01(v);return [Math.round(255*Math.min(1,Math.max(0,1.6*t))),Math.round(255*Math.max(0,1-Math.abs(t*2-1))),Math.round(255*Math.max(0,1-1.6*t))]}
function debugViewPixels(view:DebugView,original:AnalysisImage,corrected:Uint8ClampedArray,debug:LayerDebug[],dominant:Uint8Array,out:Uint8Array,total:Float32Array,layerId?:string,constraintId?:string){
  const output=new Uint8ClampedArray(corrected.length),n=original.width*original.height
  const exactLayerIndex=debug.findIndex(v=>v.id===layerId),prefixLayerIndex=debug.findIndex(v=>v.id.startsWith(`${layerId}:`)),layerIndex=Math.max(0,exactLayerIndex>=0?exactLayerIndex:prefixLayerIndex),selected=debug[layerIndex]
  let seed:ActivationSeedTexture|undefined=selected?.seeds.find(s=>s.constraintId===constraintId)??selected?.seeds[0]
  const lowSeed=seed
  for(let i=0;i<n;i++){
    const p=i*4;let rgb:[number,number,number]
    if(view==='original')rgb=[original.data[p],original.data[p+1],original.data[p+2]]
    else if(view==='split')rgb=(i%original.width)<original.width/2?[original.data[p],original.data[p+1],original.data[p+2]]:[corrected[p],corrected[p+1],corrected[p+2]]
    else if(view==='difference'){const d=Math.min(1,Math.hypot(corrected[p]-original.data[p],corrected[p+1]-original.data[p+1],corrected[p+2]-original.data[p+2])/140);rgb=[Math.round(d*255),Math.round(Math.max(0,1-Math.abs(d*2-1))*110),Math.round((1-d)*55)]}
    else if(view==='activation'){const [r,g,b]=heat(selected?.activation[i]??0);rgb=[r,g,b]}
    else if(view==='activation-overlay'){const [r,g,b]=heat(selected?.activation[i]??0);rgb=[Math.round(original.data[p]*.52+r*.48),Math.round(original.data[p+1]*.52+g*.48),Math.round(original.data[p+2]*.52+b*.48)]}
    else if(view==='seed'){
      let value=0
      if(lowSeed){const x=i%original.width,y=Math.floor(i/original.width),sx=Math.round(x*(lowSeed.width-1)/(original.width-1||1)),sy=Math.round(y*(lowSeed.height-1)/(original.height-1||1));value=lowSeed.values[sy*lowSeed.width+sx]}
      const [r,g,b]=heat(value);rgb=[r,g,b]
    }
    else if(view==='dominant'){const idx=dominant[i];if(idx===255)rgb=[25,31,26];else{const h=(idx*0.61803398875)%1,t=h*6,f=t-Math.floor(t),q=1-f;const colors=[[1,f,0],[q,1,0],[0,1,f],[0,q,1],[f,0,1],[1,0,q]][Math.floor(t)%6];rgb=colors.map(v=>Math.round(v*190+30)) as [number,number,number]}}
    else if(view==='contribution'){const [r,g,b]=heat(selected?.contribution[i]??0);rgb=[r,g,b]}
    else if(view==='total-correction'){const [r,g,b]=heat(total[i]*2);rgb=[r,g,b]}
    else if(view==='out-of-gamut')rgb=out[i]?[255,72,52]:[24,31,29]
    else {const d=Math.min(1,total[i]*2);rgb=[Math.round(d*255),Math.round(d*125),30]}
    output[p]=rgb[0];output[p+1]=rgb[1];output[p+2]=rgb[2];output[p+3]=255
  }
  return output
}
