import { encodedRgbToLinear, linearToEncodedRgb } from '../../core/color'
import type { ColorConstraint, LinearRGB } from '../../core/types'
export type FixtureName='two-spatial-illumination-regions'|'warm-to-cool-gradient'|'same-color-different-context'|'different-colors-same-regime'|'object-boundary-leakage'|'nonlinear-color-bias'|'identity-preserve'
export interface SyntheticFixture {name:FixtureName;width:number;height:number;observed:Uint8ClampedArray;groundTruth:Uint8ClampedArray;regimeMask:Uint8Array;calibrationConstraints:ColorConstraint[];description:string}
const clamp=(v:number)=>Math.min(1,Math.max(0,v))
const encode=(c:LinearRGB)=>linearToEncodedRgb({r:clamp(c.r),g:clamp(c.g),b:clamp(c.b)})
export function createSyntheticFixture(name:FixtureName,width=320,height=220):SyntheticFixture {
  const observed=new Uint8ClampedArray(width*height*4),groundTruth=new Uint8ClampedArray(width*height*4),regimeMask=new Uint8Array(width*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const nx=x/width,ny=y/height,idx=(y*width+x)*4
    let base:LinearRGB={r:0.36+0.22*nx,g:0.32+0.15*ny,b:0.28+0.12*(1-nx)}
    if(name==='same-color-different-context'){
      const neutral={r:.46,g:.45,b:.43},context=nx<.5?{r:.64,g:.38,b:.27}:{r:.25,g:.4,b:.66},distance=Math.abs(nx-(nx<.5?.25:.75)),mix=clamp((distance-.012)/.08)
      base={r:neutral.r*(1-mix)+context.r*mix,g:neutral.g*(1-mix)+context.g*mix,b:neutral.b*(1-mix)+context.b*mix}
    }
    if(name==='two-spatial-illumination-regions')base=nx<0.5?{r:0.48,g:0.43,b:0.38}:{r:0.38,g:0.43,b:0.49}
    if(name==='different-colors-same-regime')base=nx<.25?{r:.78,g:.72,b:.66}:nx<.5?{r:.72,g:.16,b:.12}:nx<.75?{r:.12,g:.58,b:.16}:{r:.1,g:.2,b:.72}
    if(name==='object-boundary-leakage')base=nx<0.5?{r:0.68,g:0.2,b:0.16}:{r:0.12,g:0.31,b:0.18}
    if(name==='identity-preserve')base=nx<.5?{r:.68,g:.22,b:.14}:{r:.16,g:.58,b:.22}
    if(name==='warm-to-cool-gradient')base={r:0.46,g:0.42,b:0.39}
    const textured=name==='same-color-different-context'?0:((x*17+y*31)%47)/2400
    base={r:clamp(base.r+textured),g:clamp(base.g+textured*0.7),b:clamp(base.b+textured*0.35)}
    let distortion:LinearRGB={r:1,g:1,b:1}
    if(name==='warm-to-cool-gradient')distortion={r:1.24-0.42*nx,g:1.03,b:0.72+0.62*nx}
    else if(name==='different-colors-same-regime')distortion={r:1.13,g:0.84,b:0.72}
    else if(name==='nonlinear-color-bias')distortion={r:1.08+0.22*Math.sqrt(base.g*base.b),g:0.88+0.16*Math.sqrt(base.r*base.b),b:0.8+0.2*Math.sqrt(base.r*base.g)}
    else if(name==='object-boundary-leakage')distortion=nx<0.5?{r:1.2,g:0.85,b:0.7}:{r:0.75,g:1.1,b:1.22}
    else if(name==='identity-preserve')distortion={r:1.18,g:.9,b:.76}
    else distortion=nx<0.5?{r:1.22,g:0.92,b:0.72}:{r:0.72,g:0.93,b:1.24}
    if(name==='same-color-different-context'){
      distortion=nx<0.5?{r:1.22,g:.92,b:.72}:{r:.72,g:.93,b:1.24}
      const center=nx<.5?.25:.75
      if(Math.abs(nx-center)<.012)base={r:.38/distortion.r,g:.38/distortion.g,b:.38/distortion.b}
    }
    if(name==='two-spatial-illumination-regions'&&nx>0.5)distortion={r:1,g:1,b:1}
    const correct=base,wrong={r:base.r*distortion.r,g:base.g*distortion.g,b:base.b*distortion.b},a=encode(wrong),b=encode(correct)
    regimeMask[y*width+x]=name==='same-color-different-context'||name==='object-boundary-leakage'?Number(nx<.5):1
    observed[idx]=a[0]*255;observed[idx+1]=a[1]*255;observed[idx+2]=a[2]*255;observed[idx+3]=255
    groundTruth[idx]=b[0]*255;groundTruth[idx+1]=b[1]*255;groundTruth[idx+2]=b[2]*255;groundTruth[idx+3]=255
  }
  const descriptions:Record<FixtureName,string>={
    'two-spatial-illumination-regions':'Two adjacent fields use different simulated illuminants; a correction seed should remain on its light regime.',
    'warm-to-cool-gradient':'A smooth spatial illumination shift from warm to cool across the frame.',
    'same-color-different-context':'Similar gray source colors occur in regions with distinct illumination context.',
    'different-colors-same-regime':'Red, green, and neutral samples share one camera/illumination transform.',
    'object-boundary-leakage':'A calibration point near a high-contrast object boundary exposes cross-edge propagation.',
    'nonlinear-color-bias':'Channel gains vary with mixed root-polynomial color terms to simulate nonlinear ISP bias.',
    'identity-preserve':'One color has a nonzero correction and a second color is an explicit source-equals-target preservation constraint.',
  }
  const locations:Record<FixtureName,{x:number;y:number}[]>={
    'two-spatial-illumination-regions':[{x:.25,y:.5},{x:.75,y:.5}],
    'warm-to-cool-gradient':[{x:.2,y:.5},{x:.5,y:.5},{x:.8,y:.5}],
    'same-color-different-context':[{x:.25,y:.5}],
    'different-colors-same-regime':[{x:.125,y:.5},{x:.375,y:.5}],
    'object-boundary-leakage':[{x:.48,y:.5},{x:.3,y:.5}],
    'nonlinear-color-bias':[{x:.15,y:.3},{x:.5,y:.5},{x:.84,y:.7}],
    'identity-preserve':[{x:.25,y:.5},{x:.75,y:.5}],
  }
  const sample=(data:Uint8ClampedArray,position:{x:number;y:number})=>{
    const x=Math.max(0,Math.min(width-1,Math.round(position.x*(width-1)))),y=Math.max(0,Math.min(height-1,Math.round(position.y*(height-1)))),p=(y*width+x)*4
    return encodedRgbToLinear(data[p]/255,data[p+1]/255,data[p+2]/255)
  }
  const calibrationConstraints=locations[name].map((position,index)=>{const source=sample(observed,position),target=name==='identity-preserve'&&index===1?source:sample(groundTruth,position);return {id:`${name}-calibration-${index+1}`,position,source,target,confidence:1}})
  return {name,width,height,observed,groundTruth,regimeMask,calibrationConstraints,description:descriptions[name]}
}
