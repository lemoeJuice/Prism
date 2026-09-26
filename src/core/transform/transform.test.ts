import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFORM } from '../types'
import type { ColorConstraint } from '../types'
import { normalizeTransformConfig, weightedRidgeTransform } from './index'

const constraint=(id:string,source:ColorConstraint['source'],target:ColorConstraint['target']):ColorConstraint=>({id,position:{x:0.5,y:0.5},source,target,confidence:1})
const finite=(values:number[])=>values.every(Number.isFinite)

describe('weighted ridge shared transforms',()=>{
  it('keeps source-equals-target evidence near identity',()=>{
    const color={r:0.3,g:0.5,b:0.2},solved=weightedRidgeTransform.solve([constraint('identity',color,color)],DEFAULT_TRANSFORM)
    const result=solved.apply(color)
    expect(Math.hypot(result.r-color.r,result.g-color.g,result.b-color.b)).toBeLessThan(1e-6)
  })
  it('is invariant to constraint ordering',()=>{
    const items=[constraint('a',{r:.2,g:.3,b:.4},{r:.26,g:.27,b:.42}),constraint('b',{r:.7,g:.2,b:.1},{r:.64,g:.28,b:.13}),constraint('c',{r:.1,g:.8,b:.4},{r:.14,g:.72,b:.5})]
    const a=weightedRidgeTransform.solve(items,{...DEFAULT_TRANSFORM,mode:'affine'}),b=weightedRidgeTransform.solve([...items].reverse(),{...DEFAULT_TRANSFORM,mode:'affine'})
    expect(a.coefficients).toEqual(b.coefficients)
    expect(a.apply({r:.4,g:.3,b:.6})).toEqual(b.apply({r:.4,g:.3,b:.6}))
  })
  it('falls back toward a simpler model for repeated-color evidence',()=>{
    const same={r:.35,g:.4,b:.2},items=[constraint('a',same,{r:.4,g:.35,b:.2}),constraint('b',same,{r:.44,g:.35,b:.2}),constraint('c',same,{r:.38,g:.35,b:.2})]
    const solved=weightedRidgeTransform.solve(items,{...DEFAULT_TRANSFORM,mode:'adaptive'})
    expect(solved.effectiveMode).toBe('constant')
    expect(solved.stable).toBe(true)
  })
  it('opens root-polynomial capacity only for broad, well-conditioned evidence',()=>{
    const colors=[.1,.9].flatMap(r=>[.1,.9].flatMap(g=>[.1,.9].map(b=>({r,g,b}))))
    const evidence=colors.map((source,index)=>constraint(`root-${index}`,source,{r:source.r+.02*source.g*source.b,g:source.g+.02*source.r*source.b,b:source.b+.02*source.r*source.g}))
    const solved=weightedRidgeTransform.solve(evidence,DEFAULT_TRANSFORM)
    expect(solved.effectiveMode).toBe('root-polynomial')
    expect(solved.condition).toBeLessThan(DEFAULT_TRANSFORM.adaptiveRootConditionLimit)
  })
  it('handles empty, repeated, and extreme finite evidence without NaN/Infinity',()=>{
    const extreme=constraint('extreme',{r:.2,g:.3,b:.4},{r:1e100,g:-1e100,b:1e100})
    const solved=weightedRidgeTransform.solve([extreme,{...extreme,id:'repeat'}],{...DEFAULT_TRANSFORM,mode:'root-polynomial'})
    expect(finite(solved.coefficients.flat())).toBe(true)
    expect(finite(Object.values(solved.apply({r:.4,g:.4,b:.4})))).toBe(true)
    const identity=weightedRidgeTransform.solve([],DEFAULT_TRANSFORM).apply({r:.2,g:.4,b:.8})
    expect(identity).toEqual({r:.2,g:.4,b:.8})
  })
  it('normalizes unstable experimental parameters and reports finite solver diagnostics',()=>{
    const config=normalizeTransformConfig({...DEFAULT_TRANSFORM,regularization:NaN,adaptiveRootConditionLimit:Infinity,coefficientLimit:Infinity})
    const solved=weightedRidgeTransform.solve([constraint('a',{r:.2,g:.4,b:.5},{r:.8,g:.1,b:.9})],config)
    expect([solved.condition,solved.regularization,solved.residualMagnitude,...solved.coefficients.flat()].every(Number.isFinite)).toBe(true)
  })
})
