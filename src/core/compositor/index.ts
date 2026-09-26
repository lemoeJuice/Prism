import { oklchChromaCompression, hardClipGamut } from '../color'
import type { LinearRGB, PipelineConfig } from '../types'
import type { SolvedTransform } from '../transform'

export interface EvaluatedLayer { id:string; enabled:boolean; strength:number; activation:number; transform:SolvedTransform }
export interface CompositorConfig { mode:PipelineConfig['compositor']; gamut:PipelineConfig['gamut'] }
export interface LayerCompositor {
  compose(input:LinearRGB,layers:readonly EvaluatedLayer[],config:CompositorConfig):LinearRGB
  composeDetailed(input:LinearRGB,layers:readonly EvaluatedLayer[],config:CompositorConfig):{raw:LinearRGB;output:LinearRGB}
}
const gain=(layer:EvaluatedLayer)=>layer.enabled?Math.max(0,Math.min(1,layer.strength*layer.activation)):0
function mapResult(raw:LinearRGB,config:CompositorConfig){return config.gamut==='hard-clip'?hardClipGamut.map(raw):oklchChromaCompression.map(raw)}
export const residualAddCompositor:LayerCompositor={
  compose(input,layers,config) {return this.composeDetailed(input,layers,config).output},
  composeDetailed(input,layers,config) {
    let r=input.r,g=input.g,b=input.b
    for(const layer of layers){const amount=gain(layer);if(!amount)continue;const corrected=layer.transform.apply(input);r+=amount*(corrected.r-input.r);g+=amount*(corrected.g-input.g);b+=amount*(corrected.b-input.b)}
    const raw={r,g,b}
    return {raw,output:mapResult(raw,config)}
  },
}
export const sequentialCompositor:LayerCompositor={
  compose(input,layers,config) {return this.composeDetailed(input,layers,config).output},
  composeDetailed(input,layers,config) {
    let color={...input}
    for(const layer of layers){const amount=gain(layer);if(!amount)continue;const target=layer.transform.apply(color);color={r:color.r+(target.r-color.r)*amount,g:color.g+(target.g-color.g)*amount,b:color.b+(target.b-color.b)*amount}}
    return {raw:color,output:mapResult(color,config)}
  },
}
export const normalizedMixtureCompositor:LayerCompositor={
  compose(input,layers,config) {return this.composeDetailed(input,layers,config).output},
  composeDetailed(input,layers,config) {
    const weights=layers.map(gain),sum=weights.reduce((a,b)=>a+b,0),norm=Math.max(1,sum)
    let r=input.r*Math.max(0,1-sum)/norm,g=input.g*Math.max(0,1-sum)/norm,b=input.b*Math.max(0,1-sum)/norm
    for(let i=0;i<layers.length;i++){const w=weights[i]/norm;if(!w)continue;const transformed=layers[i].transform.apply(input);r+=w*transformed.r;g+=w*transformed.g;b+=w*transformed.b}
    const raw={r,g,b}
    return {raw,output:mapResult(raw,config)}
  },
}
export function getCompositor(mode:PipelineConfig['compositor']):LayerCompositor {
  return mode==='sequential'?sequentialCompositor:mode==='normalized-mixture'?normalizedMixtureCompositor:residualAddCompositor
}
