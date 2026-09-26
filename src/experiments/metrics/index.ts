import { deltaEOK, encodedRgbToLinear } from '../../core/color'

export interface ImageMetrics {
  meanDeltaEOK:number
  p95DeltaEOK:number
  boundaryLeakage?:number
  outOfGamutRate:number
  runtimeMs:number
  constraintCount:number
}
export function evaluateImageMetrics(
  predicted:Uint8ClampedArray,groundTruth:Uint8ClampedArray,width:number,height:number,
  options:{boundaryMask?:Uint8Array;outOfGamut?:Uint8Array;runtimeMs?:number;constraintCount?:number}={},
):ImageMetrics{
  const count=Math.min(width*height,Math.floor(predicted.length/4),Math.floor(groundTruth.length/4)),errors=new Float32Array(count)
  let total=0,boundaryTotal=0,boundaryCount=0,gamut=0
  for(let i=0;i<count;i++){
    const p=i*4,a=encodedRgbToLinear(predicted[p]/255,predicted[p+1]/255,predicted[p+2]/255),b=encodedRgbToLinear(groundTruth[p]/255,groundTruth[p+1]/255,groundTruth[p+2]/255),error=deltaEOK(a,b)
    errors[i]=error;total+=error
    if(options.boundaryMask?.[i]){boundaryTotal+=error;boundaryCount++}
    if(options.outOfGamut?.[i])gamut++
  }
  errors.sort()
  return {meanDeltaEOK:count?total/count:0,p95DeltaEOK:count?errors[Math.min(count-1,Math.floor(count*.95))]:0,
    ...(boundaryCount?{boundaryLeakage:boundaryTotal/boundaryCount}:{}),outOfGamutRate:count?gamut/count:0,
    runtimeMs:options.runtimeMs??0,constraintCount:options.constraintCount??0}
}
