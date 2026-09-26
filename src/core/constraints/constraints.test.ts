import { describe, expect, it } from 'vitest'
import { moveConstraint, sampleOriginalColor } from './index'
import type { ColorConstraint } from '../types'

describe('original-image constraints',()=>{
  it('samples source from the original pixels and resamples after moving',()=>{
    const width=4,height=2,data=new Uint8ClampedArray(width*height*4)
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;data[p]=x<2?255:0;data[p+1]=0;data[p+2]=x<2?0:255;data[p+3]=255}
    const position={x:0.1,y:0.5},source=sampleOriginalColor(data,width,height,position)
    const constraint:ColorConstraint={id:'c',position,source,target:{r:.2,g:.7,b:.3},confidence:1}
    const moved=moveConstraint(constraint,{x:.9,y:.5},data,width,height)
    expect(moved.source).not.toEqual(constraint.source)
    expect(moved.target).toEqual(constraint.target)
    expect(constraint.source).toEqual(source)
  })
})
