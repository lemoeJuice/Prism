import { describe, expect, it } from 'vitest'
import { createLayer } from '../../experiments/presets'
import { DEFAULT_PIPELINE } from '../types'
import type { Project } from '../types'
import { deserializeProject, fingerprintImage, serializeProject } from './index'
import { CommandHistory } from './history'

describe('project intent and history',()=>{
  it('round-trips layers, constraints, hints, and pipeline configuration',()=>{
    const layer=createLayer('layer','Window light');layer.constraints.push({id:'point',position:{x:.2,y:.4},source:{r:.1,g:.2,b:.3},target:{r:.4,g:.5,b:.6},confidence:.7});layer.activationHints.push({id:'hint',position:{x:.6,y:.5},type:'exclude',strength:.4,radius:.08})
    const project:Project={version:1,image:{name:'photo.png',width:20,height:10,fingerprint:'fnv1a-test',mimeType:'image/png'},layers:[layer],pipeline:{...DEFAULT_PIPELINE,compositor:'sequential'},comparePresetIds:['spatial-only']}
    expect(deserializeProject(serializeProject(project))).toEqual(project)
  })
  it('tracks reversible command snapshots and deterministic image metadata fingerprints',()=>{
    const history=new CommandHistory({value:1}),next=history.execute('increment',current=>({value:current.value+1}))
    expect(next.value).toBe(2);expect(history.undo().value).toBe(1);expect(history.redo().value).toBe(2)
    expect(fingerprintImage(new Uint8Array([1,2,3]),1,1)).toBe(fingerprintImage(new Uint8Array([1,2,3]),1,1))
  })
})
