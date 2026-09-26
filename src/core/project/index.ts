import type { Project } from '../types'

export function fingerprintImage(data:ArrayLike<number>,width:number,height:number):string {
  let hash=2166136261
  const stride=Math.max(1,Math.floor(data.length/65536))
  for(let i=0;i<data.length;i+=stride){hash^=data[i];hash=Math.imul(hash,16777619)}
  hash^=width;hash=Math.imul(hash,16777619);hash^=height;hash=Math.imul(hash,16777619)
  return `fnv1a-${(hash>>>0).toString(16).padStart(8,'0')}-${width}x${height}`
}
export function serializeProject(project:Project):string {
  return JSON.stringify({version:1,image:project.image,layers:project.layers,pipeline:project.pipeline,comparePresetIds:project.comparePresetIds},null,2)
}
export function deserializeProject(text:string):Project {
  const value=JSON.parse(text) as Partial<Project>
  if(value.version!==1 || !value.image || !Array.isArray(value.layers) || !value.pipeline) throw new Error('Unsupported or malformed Prism project file')
  if(!Array.isArray(value.comparePresetIds))value.comparePresetIds=[]
  for(const layer of value.layers){
    if(!layer.id || !Array.isArray(layer.constraints) || !Array.isArray(layer.activationHints)) throw new Error('Malformed correction layer')
    for(const constraint of layer.constraints) {
      if(!constraint.id || !constraint.position || !constraint.source || !constraint.target) throw new Error('Malformed color constraint')
      if(![constraint.position.x,constraint.position.y,constraint.source.r,constraint.source.g,constraint.source.b,constraint.target.r,constraint.target.g,constraint.target.b,constraint.confidence].every(Number.isFinite)) throw new Error('Project contains invalid numeric values')
    }
  }
  return value as Project
}
