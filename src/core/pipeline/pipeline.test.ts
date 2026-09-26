import { describe, expect, it } from 'vitest'
import { runPipeline } from './index'
import { createLayer } from '../../experiments/presets'
import { DEFAULT_PIPELINE } from '../types'
import type { ColorConstraint } from '../types'

function fixture(){
  const width=20,height=14,data=new Uint8ClampedArray(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;data[p]=x<width/2?190:55;data[p+1]=y*12;data[p+2]=90;data[p+3]=255}
  return {width,height,data}
}
const makeConstraint=(id:string,x:number,target={r:.4,g:.24,b:.12}):ColorConstraint=>({id,position:{x,y:.5},source:{r:x<.5?.51:.04,g:.18,b:.1},target,confidence:1})
const variant={id:'test',name:'Test'}

describe('pipeline invariants',()=>{
  it('has exact identity with no layers',async()=>{
    const input=fixture(),result=await runPipeline(input,'fixture',[],DEFAULT_PIPELINE,variant)
    expect(result.corrected).toEqual(input.data)
    expect(result.rgba).toEqual(input.data)
  })
  it('disabled or zero-strength layers have no effect',async()=>{
    const input=fixture(),layer=createLayer('l','Correction')
    layer.constraints=[makeConstraint('c',.2,{r:.95,g:.02,b:.8})]
    const base=await runPipeline(input,'fixture-disable',[],DEFAULT_PIPELINE,variant)
    const disabled=await runPipeline(input,'fixture-disable', [{...layer,enabled:false}],DEFAULT_PIPELINE,variant)
    const zero=await runPipeline(input,'fixture-disable',[{...layer,strength:0}],DEFAULT_PIPELINE,variant)
    expect(disabled.corrected).toEqual(base.corrected);expect(zero.corrected).toEqual(base.corrected)
  })
  it('residual-add output is layer-order independent',async()=>{
    const input=fixture(),a=createLayer('a','A'),b=createLayer('b','B')
    a.constraints=[makeConstraint('a1',.2,{r:.7,g:.08,b:.1})];b.constraints=[makeConstraint('b1',.8,{r:.1,g:.65,b:.9})]
    const left=await runPipeline(input,'fixture-order',[a,b],DEFAULT_PIPELINE,variant),right=await runPipeline(input,'fixture-order',[b,a],DEFAULT_PIPELINE,variant)
    expect(left.corrected).toEqual(right.corrected)
  })
  it('changes the source/context activation when a constraint is moved and resampled',async()=>{
    const input=fixture(),layer=createLayer('move','Move')
    layer.constraints=[makeConstraint('move-point',.1)]
    const before=await runPipeline(input,'fixture-move',[layer],DEFAULT_PIPELINE,variant)
    layer.constraints=[{...layer.constraints[0],position:{x:.9,y:.5},source:{r:.03,g:.4,b:.3}}]
    const after=await runPipeline(input,'fixture-move',[layer],DEFAULT_PIPELINE,variant)
    expect(before.debug[0].activation).not.toEqual(after.debug[0].activation)
  })
  it('target edits change only the solved output, not cached Activation Fields',async()=>{
    const input=fixture(),layer=createLayer('target-edit','Target edit')
    layer.constraints=[makeConstraint('stable-source',.2,{r:.22,g:.25,b:.14})]
    const before=await runPipeline(input,'fixture-target',[layer],DEFAULT_PIPELINE,variant)
    layer.constraints=[{...layer.constraints[0],target:{r:.95,g:.03,b:.82}}]
    const after=await runPipeline(input,'fixture-target',[layer],DEFAULT_PIPELINE,variant)
    expect(after.debug[0].activation).toEqual(before.debug[0].activation)
    expect(after.corrected).not.toEqual(before.corrected)
  })
  it('source-equals-target is a preserve constraint and remains near identity',async()=>{
    const input=fixture(),layer=createLayer('preserve','Preserve')
    layer.constraints=[makeConstraint('preserve-color',.4,{r:.33,g:.19,b:.35})]
    layer.constraints[0].target={...layer.constraints[0].source}
    const output=await runPipeline(input,'fixture-preserve',[layer],DEFAULT_PIPELINE,variant)
    expect(output.corrected).toEqual(input.data)
  })
  it('keeps finite image output for extreme finite target colors',async()=>{
    const input=fixture(),layer=createLayer('extreme','Extreme')
    layer.constraints=[makeConstraint('extreme-point',.4,{r:1e100,g:-1e100,b:1e100})]
    const output=await runPipeline(input,'fixture-extreme',[layer],DEFAULT_PIPELINE,variant)
    expect(Array.from(output.corrected).every(Number.isFinite)).toBe(true)
    expect(Array.from(output.debug[0].transform.coefficients.flat()).every(Number.isFinite)).toBe(true)
  })
  it('exposes selected-constraint distance, dominant-seed and hint contribution diagnostics on demand',async()=>{
    const input=fixture(),layer=createLayer('inspect','Inspect');layer.constraints=[makeConstraint('inspect-seed',.2)];layer.activationHints=[{id:'include',position:{x:.8,y:.5},type:'include',strength:.8,radius:.2}]
    const output=await runPipeline(input,'fixture-inspect',[layer],DEFAULT_PIPELINE,variant,'distance-total',layer.id,'inspect-seed')
    expect(output.debug[0].breakdown).toHaveLength(output.debug[0].breakdownWidth!*output.debug[0].breakdownHeight!)
    expect(output.debug[0].dominantSeed).toBeDefined();expect(output.debug[0].hintContribution).toBeDefined()
    expect(output.debug[0].hintContribution?.some(value=>Math.abs(value)>0)).toBe(true)
  })
})
