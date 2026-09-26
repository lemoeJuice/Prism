import { runPipeline } from '../../core/pipeline'
import { DEFAULT_PIPELINE } from '../../core/types'
import { createLayer } from '../presets'
import { evaluateImageMetrics } from '../metrics'
import { createSyntheticFixture, type FixtureName } from './synthetic'

export interface SyntheticBenchmarkRow {
  fixture:FixtureName
  variant:string
  metrics:ReturnType<typeof evaluateImageMetrics>
  effectiveModels:string[]
  description:string
}

/** Reproducible CPU baseline run over procedural, ground-truth paired fixtures. */
export async function runSyntheticBenchmarks(names:readonly FixtureName[]=[
  'same-color-different-context','different-colors-same-regime','object-boundary-leakage',
  'warm-to-cool-gradient','nonlinear-color-bias','two-spatial-illumination-regions','identity-preserve',
],width=48,height=32):Promise<SyntheticBenchmarkRow[]>{
  const rows:SyntheticBenchmarkRow[]=[]
  for(const name of names){
    const fixture=createSyntheticFixture(name,width,height),modes=name==='nonlinear-color-bias'?['constant','affine','root-polynomial','adaptive'] as const:['adaptive'] as const
    const activationPresets=name==='same-color-different-context'||name==='different-colors-same-regime'||name==='object-boundary-leakage'?['spatial-only','color-only','color+xy','color+context','color+context+edge'] as const:['color+context+edge'] as const
    for(const mode of modes){
      for(const activationPreset of activationPresets){
        const layer=createLayer(`bench-${name}-${mode}-${activationPreset}`,name);layer.strength=1;layer.constraints=fixture.calibrationConstraints;layer.transformConfig={...layer.transformConfig,mode};layer.activationConfig={...layer.activationConfig,preset:activationPreset}
        const variantId=`appearance-${activationPreset}-${mode}`,started=performance.now(),output=await runPipeline({width,height,data:fixture.observed},`synthetic:${name}:${width}x${height}`,[layer],DEFAULT_PIPELINE,{id:variantId,name:`Appearance ${activationPreset} · ${mode}`})
        const metrics=evaluateImageMetrics(output.corrected,fixture.groundTruth,width,height,{runtimeMs:performance.now()-started,constraintCount:layer.constraints.length,activation:output.debug[0]?.activation,regimeMask:fixture.regimeMask,outOfGamut:output.outOfGamut})
        rows.push({fixture:name,variant:variantId,metrics,effectiveModels:output.debug.map(debug=>debug.transform.effectiveMode),description:fixture.description})
      }
    }
  }
  return rows
}
