import { describe, expect, it } from 'vitest'
import { createSyntheticFixture } from './synthetic'

describe('synthetic research fixtures',()=>{
  it('generates paired images and original-to-ground-truth calibration constraints',()=>{
    const fixture=createSyntheticFixture('nonlinear-color-bias',24,16)
    expect(fixture.observed).toHaveLength(24*16*4)
    expect(fixture.groundTruth).toHaveLength(fixture.observed.length)
    expect(fixture.calibrationConstraints.length).toBeGreaterThan(1)
    const first=fixture.calibrationConstraints[0]
    expect(first.source).not.toEqual(first.target)
    expect(first.position.x).toBeGreaterThanOrEqual(0)
    expect(first.position.x).toBeLessThanOrEqual(1)
  })
  it('includes a same-observed-color, different-context calibration case',()=>{
    const fixture=createSyntheticFixture('same-color-different-context'),[left,right]=fixture.calibrationConstraints
    expect(left.source.r).toBeCloseTo(right.source.r,3)
    expect(left.source.g).toBeCloseTo(right.source.g,3)
    expect(left.source.b).toBeCloseTo(right.source.b,3)
    expect(left.target).not.toEqual(right.target)
  })
})
