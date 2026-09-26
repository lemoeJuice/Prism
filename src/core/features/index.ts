import { linearToOKLab, srgbToLinear } from '../color'
import type { LinearRGB } from '../types'

export interface PixelFeature {
  x: number; y: number
  lab: [number, number, number]
  means: number[]
  variances: number[]
  localContrast: number
  luminanceGradient: number
  chromaGradient: number
  edgeStrength: number
}
export interface FeatureMap {
  width: number; height: number
  lab: Float32Array
  means: Float32Array
  variances: Float32Array
  localContrast: Float32Array
  luminanceGradient: Float32Array
  chromaGradient: Float32Array
  edgeStrength: Float32Array
  rgb: Float32Array
}
export interface AnalysisImage { width: number; height: number; data: Uint8ClampedArray }
export interface FeatureConfig { contextRadii: readonly [number,number,number] }
export interface FeatureExtractor { analyze(image:AnalysisImage,config:FeatureConfig):Promise<FeatureMap> }

export type AnalysisDownsampleMode='nearest'|'bilinear'|'area'
export function makeAnalysisImage(image: AnalysisImage, maxDimension: number, mode:AnalysisDownsampleMode='area'): AnalysisImage {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale))
  if (width === image.width && height === image.height) return image
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const di=(y*width+x)*4
    if(mode==='nearest'){
      const sx=Math.min(image.width-1,Math.round((x+.5)*image.width/width-.5)),sy=Math.min(image.height-1,Math.round((y+.5)*image.height/height-.5)),si=(sy*image.width+sx)*4
      data.set(image.data.subarray(si,si+4),di);continue
    }
    if(mode==='bilinear'){
      const fx=(x+.5)*image.width/width-.5,fy=(y+.5)*image.height/height-.5,x0=Math.max(0,Math.floor(fx)),y0=Math.max(0,Math.floor(fy)),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),tx=Math.max(0,fx-x0),ty=Math.max(0,fy-y0)
      for(let c=0;c<4;c++){const a=image.data[(y0*image.width+x0)*4+c]*(1-tx)+image.data[(y0*image.width+x1)*4+c]*tx,b=image.data[(y1*image.width+x0)*4+c]*(1-tx)+image.data[(y1*image.width+x1)*4+c]*tx;data[di+c]=Math.round(a*(1-ty)+b*ty)}
      continue
    }
    const left=x*image.width/width,right=(x+1)*image.width/width,top=y*image.height/height,bottom=(y+1)*image.height/height
    let total=0,sums=[0,0,0,0]
    for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
      const weight=Math.max(0,Math.min(right,sx+1)-Math.max(left,sx))*Math.max(0,Math.min(bottom,sy+1)-Math.max(top,sy)),si=(Math.min(image.height-1,sy)*image.width+Math.min(image.width-1,sx))*4
      total+=weight;for(let c=0;c<4;c++)sums[c]+=image.data[si+c]*weight
    }
    if(total)for(let c=0;c<4;c++)data[di+c]=Math.round(sums[c]/total)
  }
  return { width, height, data }
}

function integral(src: Float32Array, width: number, height: number) {
  const stride = width + 1, sum = new Float64Array((width+1)*(height+1))
  for (let y=1; y<=height; y++) {
    let row=0
    for (let x=1; x<=width; x++) { row += src[(y-1)*width+x-1]; sum[y*stride+x] = sum[(y-1)*stride+x] + row }
  }
  return sum
}
function boxSum(ii: Float64Array, width: number, height: number, x: number, y: number, radius: number) {
  const x0=Math.max(0,x-radius), y0=Math.max(0,y-radius), x1=Math.min(width,x+radius+1), y1=Math.min(height,y+radius+1), s=width+1
  return ii[y1*s+x1]-ii[y0*s+x1]-ii[y1*s+x0]+ii[y0*s+x0]
}

export async function extractFeatures(image: AnalysisImage, radii: readonly number[] = [3,12,32]): Promise<FeatureMap> {
  const { width, height, data } = image, n=width*height
  const rgb = new Float32Array(n*3), lab = new Float32Array(n*3)
  for (let i=0; i<n; i++) {
    const r=srgbToLinear(data[i*4]/255), g=srgbToLinear(data[i*4+1]/255), b=srgbToLinear(data[i*4+2]/255)
    rgb[i*3]=r; rgb[i*3+1]=g; rgb[i*3+2]=b
    const l=linearToOKLab({r,g,b}); lab[i*3]=l.L; lab[i*3+1]=l.a; lab[i*3+2]=l.b
  }
  const means = new Float32Array(n*9), variances = new Float32Array(n*9), localContrast = new Float32Array(n)
  const channels: Float32Array[] = [0,1,2].map(ch => {
    const a = new Float32Array(n)
    for (let i=0;i<n;i++) a[i]=lab[i*3+ch]
    return a
  })
  const integrals=channels.map(channel=>integral(channel,width,height)), squareIntegrals=channels.map(src => { const sq=new Float32Array(n); for(let i=0;i<n;i++)sq[i]=src[i]*src[i]; return integral(sq,width,height) })
  for (let scale=0; scale<3; scale++) {
    const radius = Math.max(1, Math.round(radii[scale] * Math.max(width,height)/512))
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=y*width+x, area=(Math.min(width,x+radius+1)-Math.max(0,x-radius))*(Math.min(height,y+radius+1)-Math.max(0,y-radius))
      let contrast=0
      for(let ch=0;ch<3;ch++) {
        const mean=boxSum(integrals[ch],width,height,x,y,radius)/area
        const variance=Math.max(0,boxSum(squareIntegrals[ch],width,height,x,y,radius)/area-mean*mean)
        means[i*9+scale*3+ch]=mean; variances[i*9+scale*3+ch]=variance; contrast+=variance
      }
      if(scale===1) localContrast[i]=Math.sqrt(contrast)
    }
  }
  const luminanceGradient=new Float32Array(n), chromaGradient=new Float32Array(n), edgeStrength=new Float32Array(n)
  const at=(x:number,y:number,ch:number)=>lab[(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*3+ch]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x, dxL=(at(x+1,y,0)-at(x-1,y,0))*0.5, dyL=(at(x,y+1,0)-at(x,y-1,0))*0.5
    const dxC=Math.hypot(at(x+1,y,1)-at(x-1,y,1),at(x+1,y,2)-at(x-1,y,2))*0.5
    const dyC=Math.hypot(at(x,y+1,1)-at(x,y-1,1),at(x,y+1,2)-at(x,y-1,2))*0.5
    luminanceGradient[i]=Math.hypot(dxL,dyL); chromaGradient[i]=Math.hypot(dxC,dyC)
    edgeStrength[i]=Math.hypot(luminanceGradient[i],chromaGradient[i])
  }
  return { width,height,lab,means,variances,localContrast,luminanceGradient,chromaGradient,edgeStrength,rgb }
}
export const multiscaleFeatureExtractor:FeatureExtractor={analyze:(image,config)=>extractFeatures(image,config.contextRadii)}

export function featureAt(map: FeatureMap, x: number, y: number): PixelFeature {
  const px=Math.max(0,Math.min(map.width-1,Math.round(x*(map.width-1)))), py=Math.max(0,Math.min(map.height-1,Math.round(y*(map.height-1)))), i=py*map.width+px
  return {
    x,y,lab:[map.lab[i*3],map.lab[i*3+1],map.lab[i*3+2]],
    means:Array.from(map.means.subarray(i*9,i*9+9)), variances:Array.from(map.variances.subarray(i*9,i*9+9)),
    localContrast:map.localContrast[i], luminanceGradient:map.luminanceGradient[i], chromaGradient:map.chromaGradient[i], edgeStrength:map.edgeStrength[i],
  }
}
export function featureForConstraint(map: FeatureMap, position: {x:number;y:number}, source: LinearRGB): PixelFeature {
  const x=Number.isFinite(position.x)?Math.min(1,Math.max(0,position.x)):.5,y=Number.isFinite(position.y)?Math.min(1,Math.max(0,position.y)):.5
  const sampled=featureAt(map,x,y)
  const lab=linearToOKLab(source)
  return { ...sampled,x,y,lab:[lab.L,lab.a,lab.b] }
}
