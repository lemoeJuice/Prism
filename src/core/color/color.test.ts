import { describe, expect, it } from 'vitest'
import { encodedRgbToLinear, linearToEncodedRgb, linearToOKLab, oklabToLinear, oklchChromaCompression } from './index'

describe('color transforms',()=>{
  it('round-trips encoded sRGB through linear sRGB and OKLab',()=>{
    for(const rgb of [[0,0,0],[1,1,1],[0.1,0.4,0.9],[0.8,0.2,0.37],[0.5,0.5,0.5]]){
      const linear=encodedRgbToLinear(rgb[0],rgb[1],rgb[2]),encoded=linearToEncodedRgb(oklabToLinear(linearToOKLab(linear)))
      encoded.forEach((value,index)=>expect(value).toBeCloseTo(rgb[index],4))
    }
  })
  it('compresses out-of-gamut colors to finite sRGB values',()=>{
    for(const color of [{r:2.4,g:-0.7,b:1.8},{r:0.3,g:0.2,b:0.1},{r:Infinity,g:NaN,b:-8}]){
      const mapped=oklchChromaCompression.map(color)
      expect([mapped.r,mapped.g,mapped.b].every(value=>Number.isFinite(value)&&value>=0&&value<=1)).toBe(true)
    }
  })
})
