import { describe, expect, it } from 'vitest'
import { aggregateActivationFields, computeSeedField, normalizeActivationConfig, probabilisticOrAggregator, smoothMaxAggregator } from './index'
import { extractFeatures } from '../features'
import { DEFAULT_ACTIVATION, DEFAULT_AGGREGATOR } from '../types'
import type { ColorConstraint } from '../types'

function image(width=18,height=12){
  const data=new Uint8ClampedArray(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;data[p]=x<width/2?210:45;data[p+1]=80;data[p+2]=x<width/2?30:205;data[p+3]=255}
  return {width,height,data}
}
const c=(target:{r:number;g:number;b:number}):ColorConstraint=>({id:'sample',position:{x:.2,y:.5},source:{r:.55,g:.08,b:.02},target,confidence:1})

describe('target-independent activation',()=>{
  it('does not change seed or aggregate field when target changes',async()=>{
    const features=await extractFeatures(image(),[2,4,8]),config={...DEFAULT_ACTIVATION,analysisMaxDimension:256 as const}
    const first=c({r:.5,g:.2,b:.1}),second={...first,target:{r:.01,g:.95,b:.8}}
    const seedA=computeSeedField(features,first,config),seedB=computeSeedField(features,second,config)
    expect(seedA.values).toEqual(seedB.values)
    expect(aggregateActivationFields([seedA],[],config,DEFAULT_AGGREGATOR)).toEqual(aggregateActivationFields([seedB],[],config,DEFAULT_AGGREGATOR))
  })
  it('single-constraint aggregation exactly reduces to its seed field',async()=>{
    const features=await extractFeatures(image(),[2,4,8]),config={...DEFAULT_ACTIVATION,analysisMaxDimension:256 as const},seed=computeSeedField(features,c({r:.6,g:.2,b:.1}),config)
    expect(aggregateActivationFields([seed],[],config,DEFAULT_AGGREGATOR)).toEqual(seed.values)
  })
  it('supports smooth max and include/exclude hint aggregation in [0,1]',()=>{
    const values=[.21,.62,.44]
    const included=probabilisticOrAggregator.aggregate(values,[{type:'include',influence:.5}],DEFAULT_AGGREGATOR)
    const excluded=probabilisticOrAggregator.aggregate(values,[{type:'exclude',influence:.5}],DEFAULT_AGGREGATOR)
    const smooth=smoothMaxAggregator.aggregate(values,[],{type:'smooth-max',temperature:.1})
    expect(included).toBeGreaterThan(excluded)
    expect(smooth).toBeGreaterThanOrEqual(Math.max(...values))
    expect(smooth).toBeLessThanOrEqual(1)
    expect(values.every(v=>v>=0&&v<=1)).toBe(true)
  })
  it('is independent of seed ordering',async()=>{
    const features=await extractFeatures(image(),[2,4,8]),config={...DEFAULT_ACTIVATION,analysisMaxDimension:256 as const}
    const first=computeSeedField(features,c({r:.2,g:.2,b:.2}),config),second=computeSeedField(features,{...c({r:.2,g:.2,b:.2}),id:'second',position:{x:.8,y:.5}},config)
    const a=aggregateActivationFields([first,second],[],config,DEFAULT_AGGREGATOR),b=aggregateActivationFields([second,first],[],config,DEFAULT_AGGREGATOR)
    for(let i=0;i<a.length;i++)expect(a[i]).toBeCloseTo(b[i],6)
  })
  it('bounds invalid experimental settings to finite safe defaults',()=>{
    const config=normalizeActivationConfig({...DEFAULT_ACTIVATION,colorWeight:1e308,colorScale:0,sharpness:NaN,contextRadii:[Infinity,4,8]})
    expect([config.colorWeight,config.colorScale,config.sharpness,...config.contextRadii].every(Number.isFinite)).toBe(true)
    expect(config.colorWeight).toBeLessThanOrEqual(20)
    expect(config.colorScale).toBeGreaterThan(0)
  })
})
