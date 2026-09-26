import { describe, expect, it } from 'vitest'
import { createSyntheticFixture } from './synthetic'
import { runSyntheticBenchmarks } from './benchmark'
import { encodedRgbToLinear } from '../../core/color'

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
    const fixture=createSyntheticFixture('same-color-different-context'),[left]=fixture.calibrationConstraints,x=Math.round(.75*(fixture.width-1)),y=Math.round(.5*(fixture.height-1)),p=(y*fixture.width+x)*4
    expect(fixture.calibrationConstraints).toHaveLength(1)
    expect(left.source.r).toBeCloseTo(encodedRgbToLinear(fixture.observed[p]/255,fixture.observed[p+1]/255,fixture.observed[p+2]/255).r,5)
    const right=encodedRgbToLinear(fixture.observed[p]/255,fixture.observed[p+1]/255,fixture.observed[p+2]/255)
    expect(Math.hypot(left.source.r-right.r,left.source.g-right.g,left.source.b-right.b)).toBeLessThan(.02)
    expect(left.target).not.toEqual(left.source)
  })
  it('runs deterministic structured baseline metrics over at least five ground-truth fixtures',async()=>{
    const rows=await runSyntheticBenchmarks(undefined,36,24)
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for(const row of rows){expect(Number.isFinite(row.metrics.meanDeltaEOK)).toBe(true);expect(Number.isFinite(row.metrics.medianDeltaEOK)).toBe(true);expect(Number.isFinite(row.metrics.p95DeltaEOK)).toBe(true);expect(row.metrics.runtimeMs).toBeGreaterThanOrEqual(0);expect(row.effectiveModels.length).toBeGreaterThan(0)}
    expect(Number.isFinite(rows.find(row=>row.fixture==='same-color-different-context')?.metrics.activationLeakageRatio)).toBe(true)
  })
  it('includes an identity/preserve constraint fixture alongside an edited color',()=>{
    const fixture=createSyntheticFixture('identity-preserve')
    expect(fixture.calibrationConstraints).toHaveLength(2)
    expect(fixture.calibrationConstraints[0].source).not.toEqual(fixture.calibrationConstraints[0].target)
    expect(fixture.calibrationConstraints[1].source).toEqual(fixture.calibrationConstraints[1].target)
  })
})
