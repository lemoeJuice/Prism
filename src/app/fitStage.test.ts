import { describe, expect, it } from 'vitest'
import { fitStageToViewport } from './fitStage'

describe('aspect-preserving canvas sizing',()=>{
  it('fits portrait photos within both viewport bounds without changing their ratio',()=>{
    const size=fitStageToViewport(3000,4000,800,700)
    expect(size.width).toBeLessThanOrEqual(800)
    expect(size.height).toBeLessThanOrEqual(700)
    expect(size.width/size.height).toBeCloseTo(3000/4000,10)
  })
  it('fits landscape photos within both viewport bounds without changing their ratio',()=>{
    const size=fitStageToViewport(6000,3000,760,540)
    expect(size.width).toBeLessThanOrEqual(760)
    expect(size.height).toBeLessThanOrEqual(540)
    expect(size.width/size.height).toBeCloseTo(2,10)
  })
  it('reserves room for compare previews while preserving the photo ratio',()=>{
    const normal=fitStageToViewport(4000,3000,900,700),compare=fitStageToViewport(4000,3000,900,700,true)
    expect(compare.height).toBeLessThan(normal.height)
    expect(compare.width/compare.height).toBeCloseTo(normal.width/normal.height,10)
  })
})
