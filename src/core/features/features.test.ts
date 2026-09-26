import {describe,expect,it} from 'vitest'
import {makeAnalysisImage,extractFeatures} from './index'

describe('analysis downsampling strategies',()=>{
  it('produces requested dimensions and preserves constant images',()=>{
    const image={width:8,height:6,data:new Uint8ClampedArray(8*6*4)}
    for(let i=0;i<image.data.length;i+=4){image.data[i]=37;image.data[i+1]=91;image.data[i+2]=143;image.data[i+3]=255}
    for(const mode of ['nearest','bilinear','area'] as const){const resized=makeAnalysisImage(image,4,mode);expect([resized.width,resized.height]).toEqual([4,3]);for(let i=0;i<resized.data.length;i+=4)expect(Array.from(resized.data.subarray(i,i+4))).toEqual([37,91,143,255])}
  })
  it('suppresses checkerboard alias pattern with area and bilinear filtering',()=>{
    const image={width:32,height:32,data:new Uint8ClampedArray(32*32*4)}
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){const p=(y*32+x)*4,v=(x+y)%2?255:0;image.data[p]=image.data[p+1]=image.data[p+2]=v;image.data[p+3]=255}
    const nearest=makeAnalysisImage(image,8,'nearest'),area=makeAnalysisImage(image,8,'area'),bilinear=makeAnalysisImage(image,8,'bilinear')
    const deviation=(data:Uint8ClampedArray)=>{let sum=0;for(let i=0;i<data.length;i+=4)sum+=Math.abs(data[i]-127.5);return sum/(data.length/4)}
    expect(deviation(area.data)).toBeLessThan(deviation(nearest.data));expect(deviation(bilinear.data)).toBeLessThan(deviation(nearest.data))
  })
  it('keeps feature maps finite under every resize strategy',async()=>{
    const image={width:32,height:24,data:Uint8ClampedArray.from({length:32*24*4},(_,i)=>i%4===3?255:(i*19)%256)}
    for(const mode of ['nearest','bilinear','area'] as const){const resized=makeAnalysisImage(image,16,mode),map=await extractFeatures(resized,[1,2,4]);for(const values of [map.lab,map.means,map.variances,map.localContrast,map.luminanceGradient,map.chromaGradient,map.edgeStrength])expect(Array.from(values).every(Number.isFinite)).toBe(true)}
  })
})
