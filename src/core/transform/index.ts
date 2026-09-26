import { linearToOKLab } from '../color'
import { DEFAULT_TRANSFORM } from '../types'
import type { ColorConstraint, LinearRGB, TransformConfig, TransformMode } from '../types'

export interface SolvedTransform {
  apply(color: LinearRGB): LinearRGB
  mode: TransformMode
  effectiveMode: Exclude<TransformMode,'adaptive'>
  coefficients: number[][]
  condition: number
  stable: boolean
  regularization: number
  residualMagnitude: number
  constraintCount: number
  colorSpread: number
}
export interface TransformModel { solve(constraints: readonly ColorConstraint[], config: TransformConfig): SolvedTransform }
export interface TransformModifier { apply(base: SolvedTransform): SolvedTransform }
const bounded=(value:number,fallback:number,min:number,max:number)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback
export function normalizeTransformConfig(input:TransformConfig):TransformConfig {
  const value={...DEFAULT_TRANSFORM,...input},modes=['constant','affine','root-polynomial','adaptive']
  return {
    ...value,mode:modes.includes(value.mode)?value.mode:'adaptive',regularization:bounded(value.regularization,.025,1e-8,1e6),
    nonlinearRegularization:bounded(value.nonlinearRegularization,.35,1e-8,1e6),interceptRegularizationWeight:bounded(value.interceptRegularizationWeight,.15,.001,10),
    adaptiveMinSpread:bounded(value.adaptiveMinSpread,.018,0,1),adaptiveMinConstraints:Math.round(bounded(value.adaptiveMinConstraints,4,1,1000)),
    adaptiveAffineConditionLimit:bounded(value.adaptiveAffineConditionLimit,1e8,1,1e14),adaptiveRootConditionLimit:bounded(value.adaptiveRootConditionLimit,1e6,1,1e14),
    adaptiveAffineSpreadFraction:bounded(value.adaptiveAffineSpreadFraction,.2,0,10),adaptiveConditionBoost:bounded(value.adaptiveConditionBoost,2,.1,100),
    adaptiveMaxRegularizationBoost:bounded(value.adaptiveMaxRegularizationBoost,40,0,1e6),nonlinearConditionScale:bounded(value.nonlinearConditionScale,1e4,1,1e14),
    nonlinearMaxConditionBoost:bounded(value.nonlinearMaxConditionBoost,100,0,1e6),coefficientLimit:bounded(value.coefficientLimit,4,.05,1000),
  }
}

function basis(color: LinearRGB, mode: Exclude<TransformMode,'adaptive'>, center: LinearRGB): number[] {
  if(mode==='constant') return [1]
  if(mode==='affine') return [1,color.r,color.g,color.b]
  return [1,color.r-center.r,color.g-center.g,color.b-center.b,
    Math.sqrt(Math.max(0,color.r*color.g))-Math.sqrt(Math.max(0,center.r*center.g)),
    Math.sqrt(Math.max(0,color.r*color.b))-Math.sqrt(Math.max(0,center.r*center.b)),
    Math.sqrt(Math.max(0,color.g*color.b))-Math.sqrt(Math.max(0,center.g*center.b))]
}
function sourceCenter(constraints: readonly ColorConstraint[]): LinearRGB {
  let weight=0,r=0,g=0,b=0
  for(const c of constraints){const w=Math.max(0,c.confidence);weight+=w;r+=c.source.r*w;g+=c.source.g*w;b+=c.source.b*w}
  return weight>0?{r:r/weight,g:g/weight,b:b/weight}:{r:0.5,g:0.5,b:0.5}
}
function colorSpread(constraints: readonly ColorConstraint[]): number {
  if(constraints.length<2)return 0
  const labs=constraints.map(c=>({lab:linearToOKLab(c.source),weight:Math.max(0,c.confidence)})),weightSum=labs.reduce((sum,item)=>sum+item.weight,0)
  if(weightSum<=1e-12)return 0
  const mean=[0,0,0]
  labs.forEach(({lab,weight})=>{mean[0]+=lab.L*weight/weightSum;mean[1]+=lab.a*weight/weightSum;mean[2]+=lab.b*weight/weightSum})
  return labs.reduce((sum,{lab,weight})=>sum+weight*((lab.L-mean[0])**2+(lab.a-mean[1])**2+(lab.b-mean[2])**2),0)/weightSum
}
function sortedConstraints(constraints: readonly ColorConstraint[]) {
  return [...constraints].sort((a,b)=>[a.source.r,a.source.g,a.source.b,a.target.r,a.target.g,a.target.b,a.confidence].join(',').localeCompare([b.source.r,b.source.g,b.source.b,b.target.r,b.target.g,b.target.b,b.confidence].join(',')))
}
function gramFor(constraints: readonly ColorConstraint[], mode: Exclude<TransformMode,'adaptive'>, center: LinearRGB) {
  const size=mode==='constant'?1:mode==='affine'?4:7, gram=Array.from({length:size},()=>new Array<number>(size).fill(0))
  for(const c of constraints){const x=basis(c.source,mode,center),w=Math.max(0,c.confidence);for(let r=0;r<size;r++)for(let col=0;col<size;col++)gram[r][col]+=w*x[r]*x[col]}
  return gram
}
function conditionEstimate(matrix: number[][]): number {
  if(matrix.some(row=>row.some(value=>!Number.isFinite(value))))return 1e12
  const n=matrix.length, a=matrix.map(row=>row.slice())
  for(let step=0;step<n*n*8;step++) {
    let p=0,q=1,max=0
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(a[i][j])>max){max=Math.abs(a[i][j]);p=i;q=j}
    if(max<1e-12)break
    const phi=0.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]), c=Math.cos(phi),s=Math.sin(phi)
    const app=c*c*a[p][p]-2*s*c*a[p][q]+s*s*a[q][q], aqq=s*s*a[p][p]+2*s*c*a[p][q]+c*c*a[q][q]
    for(let k=0;k<n;k++)if(k!==p&&k!==q){const akp=c*a[k][p]-s*a[k][q],akq=s*a[k][p]+c*a[k][q];a[k][p]=a[p][k]=akp;a[k][q]=a[q][k]=akq}
    a[p][p]=app;a[q][q]=aqq;a[p][q]=a[q][p]=0
  }
  const eigen=Array.from({length:n},(_,i)=>Math.max(0,a[i][i])), max=Math.max(...eigen), min=Math.min(...eigen)
  const condition=min<=1e-12?1e12:max/min
  return Number.isFinite(condition)?condition:1e12
}
function choleskySolve(matrix: number[][], rhs: number[]): number[] | null {
  const n=rhs.length, l=Array.from({length:n},()=>new Array<number>(n).fill(0))
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let sum=matrix[i][j];for(let k=0;k<j;k++)sum-=l[i][k]*l[j][k]
    if(i===j){if(!(sum>1e-14)||!Number.isFinite(sum))return null;l[i][j]=Math.sqrt(sum)}else l[i][j]=sum/l[j][j]
  }
  const y=new Array<number>(n).fill(0),x=new Array<number>(n).fill(0)
  for(let i=0;i<n;i++){let s=rhs[i];for(let j=0;j<i;j++)s-=l[i][j]*y[j];y[i]=s/l[i][i]}
  for(let i=n-1;i>=0;i--){let s=y[i];for(let j=i+1;j<n;j++)s-=l[j][i]*x[j];x[i]=s/l[i][i]}
  return x.every(Number.isFinite)?x:null
}

export const weightedRidgeTransform: TransformModel = {
  solve(input,constraintsInput) {
    const config=normalizeTransformConfig(constraintsInput)
    const constraints=sortedConstraints(input.filter(c=>[c.source.r,c.source.g,c.source.b,c.target.r,c.target.g,c.target.b,c.confidence].every(Number.isFinite)).map(c=>({...c,confidence:Math.max(0,Math.min(1,c.confidence))})))
    const center=sourceCenter(constraints), spread=colorSpread(constraints), count=constraints.filter(c=>c.confidence>1e-6).length
    if(constraints.length===0) return {apply:c=>({...c}),mode:config.mode,effectiveMode:'constant',coefficients:[[0],[0],[0]],condition:1,stable:true,regularization:0,residualMagnitude:0,constraintCount:0,colorSpread:0}
    let selected: Exclude<TransformMode,'adaptive'> = config.mode==='adaptive'?'constant':config.mode
    let adaptiveReg=config.regularization
    const affineCondition=conditionEstimate(gramFor(constraints,'affine',center))
    if(config.mode==='adaptive') {
      if(count>1 && spread>config.adaptiveMinSpread*config.adaptiveAffineSpreadFraction && affineCondition<config.adaptiveAffineConditionLimit) selected='affine'
      if(count>=config.adaptiveMinConstraints && spread>config.adaptiveMinSpread && affineCondition<config.adaptiveRootConditionLimit) selected='root-polynomial'
      const conditionBoost=Math.min(config.adaptiveMaxRegularizationBoost,Math.log10(Math.max(1,affineCondition))/Math.max(0.1,config.adaptiveConditionBoost))
      adaptiveReg *= 1 + conditionBoost / (1+Math.sqrt(spread))
    }
    let gram=gramFor(constraints,selected,center), condition=conditionEstimate(gram)
    if(config.mode==='adaptive' && selected==='root-polynomial' && (condition>config.adaptiveRootConditionLimit || count<selectedFeatureCount(selected))) {
      selected='affine';gram=gramFor(constraints,selected,center);condition=conditionEstimate(gram)
    }
    const size=gram.length, regularization=Math.max(1e-8,adaptiveReg), nonlinear=selected==='root-polynomial'?Math.max(regularization,config.nonlinearRegularization*(1+Math.min(config.nonlinearMaxConditionBoost,condition/Math.max(1,config.nonlinearConditionScale)))):regularization
    const system=gram.map(row=>row.slice())
    for(let i=0;i<size;i++)system[i][i]+= i===0?regularization*config.interceptRegularizationWeight:(selected==='root-polynomial'&&i>=4?nonlinear:regularization)
    const rhs=[new Array<number>(size).fill(0),new Array<number>(size).fill(0),new Array<number>(size).fill(0)]
    for(const c of constraints){const f=basis(c.source,selected,center),w=Math.max(0,c.confidence),d=[c.target.r-c.source.r,c.target.g-c.source.g,c.target.b-c.source.b];for(let ch=0;ch<3;ch++)for(let i=0;i<size;i++)rhs[ch][i]+=w*f[i]*d[ch]}
    const coefficients=rhs.map(values=>choleskySolve(system,values) ?? new Array<number>(size).fill(0))
    const limit=config.coefficientLimit
    for(const row of coefficients)for(let i=0;i<row.length;i++)row[i]=Number.isFinite(row[i])?Math.max(-limit,Math.min(limit,row[i])):0
    const residualMagnitude=Math.sqrt(coefficients.reduce((sum,row)=>sum+row.reduce((s,v)=>s+v*v,0),0))
    const apply=(color:LinearRGB):LinearRGB=>{
      const f=basis(color,selected,center), delta=[0,1,2].map(ch=>coefficients[ch].reduce((sum,value,i)=>sum+value*f[i],0))
      return {r:finiteBound(color.r+delta[0]),g:finiteBound(color.g+delta[1]),b:finiteBound(color.b+delta[2])}
    }
    return {apply,mode:config.mode,effectiveMode:selected,coefficients,condition,stable:Number.isFinite(condition)&&condition<1e10,regularization:nonlinear,residualMagnitude,constraintCount:constraints.length,colorSpread:spread}
  },
}
function selectedFeatureCount(mode: Exclude<TransformMode,'adaptive'>) { return mode==='constant'?1:mode==='affine'?4:7 }
function finiteBound(n:number){return Number.isFinite(n)?Math.max(-8,Math.min(8,n)):0}
