import { runPipeline, type DebugView, type VariantOverride } from '../core/pipeline'
import { clearPipelineCaches } from '../core/pipeline'
import { fingerprintImage } from '../core/project'
import type { CorrectionLayer, PipelineConfig } from '../core/types'
const workerScope=self as unknown as DedicatedWorkerGlobalScope

interface SetImageMessage { type:'set-image'; width:number;height:number;data:ArrayBuffer;name:string;fingerprint?:string }
interface RenderMessage {
  type:'render';requestId:number;layers:CorrectionLayer[];pipeline:PipelineConfig;variants:VariantOverride[]
  view:DebugView;selectedLayerId?:string;selectedConstraintId?:string
}
type WorkerMessage=SetImageMessage|RenderMessage
let original:{width:number;height:number;data:Uint8ClampedArray;name:string;fingerprint:string}|undefined

workerScope.onmessage=async(event:MessageEvent<WorkerMessage>)=>{
  const message=event.data
  if(message.type==='set-image'){
    const data=new Uint8ClampedArray(message.data),fingerprint=message.fingerprint??fingerprintImage(data,message.width,message.height)
    if(original?.fingerprint!==fingerprint)clearPipelineCaches()
    original={width:message.width,height:message.height,data,name:message.name,fingerprint}
    workerScope.postMessage({type:'image-ready',width:message.width,height:message.height,fingerprint})
    return
  }
  if(!original){workerScope.postMessage({type:'error',requestId:message.requestId,message:'Load a photo before rendering.'});return}
  try {
    const input=original
    const variants=message.variants.length?message.variants:[{id:'default',name:'Shared correction'}]
    const results=[] as {id:string;name:string;rgba:Uint8ClampedArray;corrected:Uint8ClampedArray;processingMs:number;outOfGamutRate:number;thumbnails:{id:string;rgba:Uint8Array}[];diagnostics:{id:string;effectiveMode:string;condition:number;stable:boolean;residualMagnitude:number;colorSpread:number;constraintCount:number;coefficients:number[][]}[]}[]
    for(let i=0;i<variants.length;i++){
      const variant=variants[i]
      const output=await runPipeline(input,input.fingerprint,message.layers,message.pipeline,variant,i===0?message.view:'corrected',message.selectedLayerId,message.selectedConstraintId)
      const thumbnails=output.debug.flatMap(layer=>[
        {id:layer.id,rgba:makeActivationThumbnail(layer.activation,input.data,input.width,input.height)},
        ...layer.seeds.map(seed=>({id:`${layer.id}:seed:${seed.constraintId}`,rgba:makeThumbnail(seed.values,seed.width,seed.height,48,48)})),
      ])
      const diagnostics=output.debug.map(layer=>({id:layer.id,effectiveMode:layer.transform.effectiveMode,condition:layer.transform.condition,stable:layer.transform.stable,residualMagnitude:layer.transform.residualMagnitude,colorSpread:layer.transform.colorSpread,constraintCount:layer.transform.constraintCount,coefficients:layer.transform.coefficients}))
      results.push({id:variant.id,name:variant.name,rgba:output.rgba,corrected:output.corrected,processingMs:output.processingMs,outOfGamutRate:output.outOfGamutRate,thumbnails,diagnostics})
    }
    const transfers:Transferable[]=[]
    for(const result of results){transfers.push(result.rgba.buffer,result.corrected.buffer);for(const thumb of result.thumbnails)transfers.push(thumb.rgba.buffer)}
    workerScope.postMessage({type:'rendered',requestId:message.requestId,width:input.width,height:input.height,results},transfers)
  } catch(error) {
    workerScope.postMessage({type:'error',requestId:message.requestId,message:error instanceof Error?error.message:String(error)})
  }
}
function makeThumbnail(field:Float32Array,width:number,height:number,outWidth:number,outHeight:number):Uint8Array{
  const data=new Uint8Array(outWidth*outHeight*4)
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
    const sx=Math.round(x*(width-1)/(outWidth-1||1)),sy=Math.round(y*(height-1)/(outHeight-1||1)),t=Math.min(1,Math.max(0,field[sy*width+sx])),p=(y*outWidth+x)*4
    data[p]=Math.round(255*Math.min(1,t*1.7));data[p+1]=Math.round(255*Math.max(0,1-Math.abs(2*t-1)));data[p+2]=Math.round(255*Math.max(0,1-t*1.7));data[p+3]=255
  }
  return data
}
function makeActivationThumbnail(field:Float32Array,image:Uint8ClampedArray,width:number,height:number):Uint8Array{
  const size=144,data=new Uint8Array(size*size*4),scale=Math.min(size/width,size/height),drawWidth=Math.max(1,Math.round(width*scale)),drawHeight=Math.max(1,Math.round(height*scale)),offsetX=Math.floor((size-drawWidth)/2),offsetY=Math.floor((size-drawHeight)/2)
  for(let y=0;y<drawHeight;y++)for(let x=0;x<drawWidth;x++){
    const sx=Math.min(width-1,Math.floor(x/scale)),sy=Math.min(height-1,Math.floor(y/scale)),source=(sy*width+sx)*4,value=Math.max(0,Math.min(1,field[sy*width+sx])),p=((offsetY+y)*size+offsetX+x)*4
    const heat=value<0.5?{r:35,g:150+Math.round(value*140),b:235- Math.round(value*220)}:{r:35+Math.round((value-0.5)*440),g:220-Math.round((value-0.5)*400),b:15}
    const alpha=Math.min(0.82,value*1.8)
    data[p]=Math.round(image[source]*(1-alpha)+heat.r*alpha);data[p+1]=Math.round(image[source+1]*(1-alpha)+heat.g*alpha);data[p+2]=Math.round(image[source+2]*(1-alpha)+heat.b*alpha);data[p+3]=255
  }
  return data
}
