<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Aperture, ArrowDownToLine, ArrowLeftRight, Check, ChevronDown, ChevronUp, Copy,
  Eye, EyeOff, FileImage, FolderOpen, Gauge, Layers3, Minus, MousePointer2, Plus,
  Move, Redo2, Save, ScanEye, SlidersHorizontal, Sparkles, Trash2, Undo2, Upload, X,
} from 'lucide-vue-next'
import PreviewCanvas from '../renderer/webgl2/PreviewCanvas.vue'
import { encodedRgbToLinear, linearToEncodedRgb } from '../core/color'
import { createConstraint, moveConstraint, sampleOriginalColor } from '../core/constraints'
import { CommandHistory } from '../core/project/history'
import { deserializeProject, fingerprintImage, serializeProject } from '../core/project'
import { DEFAULT_PIPELINE } from '../core/types'
import type { ActivationHint, CorrectionLayer, Project } from '../core/types'
import type { DebugView } from '../core/pipeline'
import { createLayer, experimentPresets } from '../experiments/presets'

interface WorkerResult {id:string;name:string;rgba:Uint8ClampedArray;corrected:Uint8ClampedArray;processingMs:number;outOfGamutRate:number;thumbnails:{id:string;rgba:Uint8Array}[];diagnostics:{id:string;effectiveMode:string;condition:number;stable:boolean;residualMagnitude:number;colorSpread:number;constraintCount:number;coefficients:number[][]}[]}
interface WorkerResponse {type:string;requestId?:number;width?:number;height?:number;results?:WorkerResult[];message?:string}
const emptyProject=():Project=>({version:1,image:{name:'Untitled photo',width:0,height:0,fingerprint:'',mimeType:''},layers:[],pipeline:{...DEFAULT_PIPELINE},comparePresetIds:['shared-context','spatial-only','color-context']})
const project=ref<Project>(emptyProject()),history=new CommandHistory(project.value)
const worker=new Worker(new URL('../workers/pipeline.worker.ts',import.meta.url),{type:'module'})
const sourcePixels=ref<Uint8ClampedArray|null>(null),preview=ref<Uint8ClampedArray|null>(null),correctedPixels=ref<Uint8ClampedArray|null>(null)
const compareResults=ref<WorkerResult[]>([]),thumbnailMap=ref<Record<string,Uint8Array>>({})
const selectedLayerId=ref(''),selectedConstraintId=ref(''),view=ref<DebugView>('corrected'),compareMode=ref(false)
const selectedPresetIds=ref<string[]>(['shared-context','spatial-only','color-context'])
const addMode=ref<'select'|'new-layer'|'constraint'|'include'|'exclude'>('select')
const status=ref('Load a photo to start a correction session.'),isRendering=ref(false),zoom=ref(1),inspectorTab=ref<'activation'|'transform'>('activation')
const errorMessage=ref(''),draggingConstraint=ref(''),dragPosition=ref<{x:number;y:number}|null>(null)
const loadedImageFingerprint=ref('')
const panMode=ref(false),pan=ref({x:0,y:0})
let requestId=0,latestRequest=0,renderTimer:number|undefined,imageReady=false
let panStart:{x:number;y:number;originX:number;originY:number}|undefined,didPan=false
const width=computed(()=>project.value.image.width),height=computed(()=>project.value.image.height)
const activeLayer=computed(()=>project.value.layers.find(layer=>layer.id===selectedLayerId.value))
const selectedConstraint=computed(()=>activeLayer.value?.constraints.find(item=>item.id===selectedConstraintId.value))
const canUndo=computed(()=>history.canUndo),canRedo=computed(()=>history.canRedo)
const selectedTransform=computed(()=>activeLayer.value?.transformConfig)
const layerDiagnostics=computed(()=>{
  if(!activeLayer.value)return undefined
  const diagnostics=compareResults.value[0]?.diagnostics??[]
  return diagnostics.find(item=>item.id===activeLayer.value?.id)??diagnostics.find(item=>item.id.startsWith(`${activeLayer.value?.id}:`))
})
const dimensionsLabel=computed(()=>width.value?`${width.value} × ${height.value}`:'No image')
const rgbHex=(color:{r:number;g:number;b:number})=>'#'+linearToEncodedRgb(color).map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join('')
const markerPosition=(position:{x:number;y:number})=>draggingConstraint.value===selectedConstraintId.value&&dragPosition.value?dragPosition.value:position
const markerStyle=(position:{x:number;y:number})=>({left:`${position.x*100}%`,top:`${position.y*100}%`})
const findLayer=(id:string)=>project.value.layers.find(layer=>layer.id===id)

function commit(label:string,reduce:(current:Project)=>Project){project.value=history.execute(label,reduce);scheduleRender()}
function updateLayer(id:string,label:string,update:(layer:CorrectionLayer)=>CorrectionLayer){commit(label,current=>({...current,layers:current.layers.map(layer=>layer.id===id?update(layer):layer)}))}
function onWorkerMessage(event:MessageEvent<WorkerResponse>){
  const message=event.data
  if(message.type==='image-ready'){imageReady=true;status.value=`${dimensionsLabel.value} · Original image analyzed on demand`;scheduleRender();return}
  if(message.type==='error'){if(message.requestId===latestRequest){isRendering.value=false;errorMessage.value=message.message??'Processing failed';status.value='Processing error'}return}
  if(message.type!=='rendered'||message.requestId!==latestRequest||!message.results)return
  isRendering.value=false;errorMessage.value='';compareResults.value=message.results
  preview.value=message.results[0]?.rgba??null;correctedPixels.value=message.results[0]?.corrected??null
  const thumbs:Record<string,Uint8Array>={};for(const result of message.results)for(const thumb of result.thumbnails)thumbs[`${result.id}:${thumb.id}`]=thumb.rgba
  thumbnailMap.value=thumbs
  const time=message.results[0]?.processingMs??0,rate=(message.results[0]?.outOfGamutRate??0)*100
  status.value=`${dimensionsLabel.value} · ${time.toFixed(0)} ms · ${rate.toFixed(2)}% out of gamut`
}
worker.addEventListener('message',onWorkerMessage)
function activeVariants(){
  if(!compareMode.value)return [{id:'main',name:'Current pipeline'}]
  const variants=experimentPresets.filter(item=>selectedPresetIds.value.includes(item.id))
  return variants.length?variants:[experimentPresets[0]]
}
function scheduleRender(){
  if(!imageReady)return
  if(renderTimer)window.clearTimeout(renderTimer)
  isRendering.value=true
  renderTimer=window.setTimeout(()=>{
    const id=++requestId;latestRequest=id
    worker.postMessage({type:'render',requestId:id,layers:structuredClone(project.value.layers),pipeline:structuredClone(project.value.pipeline),variants:activeVariants(),view:view.value,selectedLayerId:selectedLayerId.value,selectedConstraintId:selectedConstraintId.value})
  },80)
}
watch([project,view,selectedLayerId,selectedConstraintId,compareMode,selectedPresetIds],scheduleRender,{deep:true})

async function loadPhoto(file:File){
  errorMessage.value=''
  try {
    if(renderTimer)window.clearTimeout(renderTimer)
    latestRequest=++requestId;isRendering.value=false;imageReady=false
    const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),canvas=document.createElement('canvas')
    canvas.width=bitmap.width;canvas.height=bitmap.height
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Could not create an image sampling canvas.')
    context.drawImage(bitmap,0,0);const image=context.getImageData(0,0,bitmap.width,bitmap.height);bitmap.close()
    const data=new Uint8ClampedArray(image.data),fingerprint=fingerprintImage(data,canvas.width,canvas.height)
    loadedImageFingerprint.value=fingerprint
    sourcePixels.value=data;preview.value=null;correctedPixels.value=null;compareResults.value=[];thumbnailMap.value={};pan.value={x:0,y:0}
    const loaded=project.value.image.fingerprint===fingerprint&&project.value.layers.length>0?project.value:emptyProject()
    loaded.image={name:file.name,width:canvas.width,height:canvas.height,fingerprint,mimeType:file.type||'image/*'}
    project.value=structuredClone(loaded);history.replace('Load photo',project.value)
    selectedLayerId.value=project.value.layers[0]?.id??'';selectedConstraintId.value=project.value.layers[0]?.constraints[0]?.id??''
    const transferCopy=data.slice()
    worker.postMessage({type:'set-image',width:canvas.width,height:canvas.height,data:transferCopy.buffer,name:file.name,fingerprint},[transferCopy.buffer])
    // Transfer a single owned copy; retain sourcePixels for original-color sampling.
    imageReady=false;status.value=`Loaded ${file.name} · preparing analysis`
  }catch(error){errorMessage.value=error instanceof Error?error.message:'Unable to decode image';status.value='Image import failed'}
}
function choosePhoto(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(file)void loadPhoto(file);(event.target as HTMLInputElement).value=''}
function onProjectFile(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return
  const reader=new FileReader();reader.onload=()=>{
    try{
      const loaded=deserializeProject(String(reader.result));project.value=loaded;history.replace('Open project',loaded)
      selectedLayerId.value=loaded.layers[0]?.id??'';selectedConstraintId.value=loaded.layers[0]?.constraints[0]?.id??''
      selectedPresetIds.value=[...loaded.comparePresetIds]
      if(sourcePixels.value&&loaded.image.fingerprint===loadedImageFingerprint.value) scheduleRender()
      else {imageReady=false;sourcePixels.value=null;preview.value=null;status.value='Project opened · re-import the matching original photo to rebuild previews'}
    }catch(error){errorMessage.value=error instanceof Error?error.message:'Could not open project'}
  };reader.readAsText(file);(event.target as HTMLInputElement).value=''
}
function saveProject(){
  const value={...project.value,comparePresetIds:[...selectedPresetIds.value]},url=URL.createObjectURL(new Blob([serializeProject(value)],{type:'application/json'})),a=document.createElement('a')
  a.href=url;a.download=`${project.value.image.name.replace(/\.[^.]+$/,'')||'prism-project'}.prism.json`;a.click();URL.revokeObjectURL(url)
}
function exportPng(){
  if(!correctedPixels.value||!width.value||!height.value)return
  const canvas=document.createElement('canvas');canvas.width=width.value;canvas.height=height.value
  const ctx=canvas.getContext('2d');if(!ctx)return
  ctx.putImageData(new ImageData(new Uint8ClampedArray(correctedPixels.value),width.value,height.value),0,0)
  canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${project.value.image.name.replace(/\.[^.]+$/,'')}-corrected.png`;a.click();URL.revokeObjectURL(url)},'image/png')
}
function undo(){project.value=history.undo();selectedPresetIds.value=[...project.value.comparePresetIds];scheduleRender()}
function redo(){project.value=history.redo();selectedPresetIds.value=[...project.value.comparePresetIds];scheduleRender()}
function onKey(event:KeyboardEvent){
  const target=event.target as HTMLElement|null
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!target?.matches('input,textarea')){event.preventDefault();event.shiftKey?redo():undo()}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo()}
  if(event.key==='Escape'){addMode.value='select';draggingConstraint.value=''}
}
onMounted(()=>window.addEventListener('keydown',onKey))
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKey);worker.removeEventListener('message',onWorkerMessage);worker.terminate();if(renderTimer)window.clearTimeout(renderTimer)})

function createNewLayer(){
  const id=crypto.randomUUID(),layer=createLayer(id,`Correction ${project.value.layers.length+1}`)
  commit('Add correction layer',current=>({...current,layers:[...current.layers,layer]}));selectedLayerId.value=id;selectedConstraintId.value='';addMode.value='constraint'
}
function addConstraintAt(position:{x:number;y:number}){
  if(!sourcePixels.value)return
  let layer=findLayer(selectedLayerId.value)
  if(addMode.value==='new-layer'||!layer){
    const id=crypto.randomUUID(),newLayer=createLayer(id,`Correction ${project.value.layers.length+1}`)
    const constraint=createConstraint(crypto.randomUUID(),position,sampleOriginalColor(sourcePixels.value,width.value,height.value,position));newLayer.constraints.push(constraint)
    commit('Create layer and constraint',current=>({...current,layers:[...current.layers,newLayer]}));selectedLayerId.value=id;selectedConstraintId.value=constraint.id;addMode.value='select';return
  }
  const constraint=createConstraint(crypto.randomUUID(),position,sampleOriginalColor(sourcePixels.value,width.value,height.value,position))
  commit('Add color constraint',current=>({...current,layers:current.layers.map(item=>item.id===layer?.id?{...item,constraints:[...item.constraints,constraint]}:item)}))
  selectedConstraintId.value=constraint.id;addMode.value='select'
}
function stagePosition(event:PointerEvent|MouseEvent){
  const bounds=(event.currentTarget as HTMLElement).getBoundingClientRect()
  return {x:Math.min(1,Math.max(0,(event.clientX-bounds.left)/bounds.width)),y:Math.min(1,Math.max(0,(event.clientY-bounds.top)/bounds.height))}
}
function onStageClick(event:MouseEvent){
  if(didPan){didPan=false;return}
  if(draggingConstraint.value)return
  const position=stagePosition(event)
  if(addMode.value==='include'||addMode.value==='exclude'){
    if(!activeLayer.value)return
    const hint:ActivationHint={id:crypto.randomUUID(),position,type:addMode.value,strength:0.85,radius:activeLayer.value.activationConfig.hintRadius}
    updateLayer(activeLayer.value.id,`Add ${hint.type} hint`,layer=>({...layer,activationHints:[...layer.activationHints,hint]}));addMode.value='select';return
  }
  if(addMode.value==='new-layer'||addMode.value==='constraint'||!activeLayer.value){addConstraintAt(position);return}
}
function startConstraintDrag(event:PointerEvent,constraintId:string){event.stopPropagation();selectedConstraintId.value=constraintId;draggingConstraint.value=constraintId;dragPosition.value=null;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)}
function movePointer(event:PointerEvent){if(draggingConstraint.value)dragPosition.value=stagePosition(event)}
function startPan(event:PointerEvent){
  if(event.target instanceof Element&&event.target.closest('.constraint-marker'))return
  if(!(panMode.value&&event.button===0)&&event.button!==1)return
  event.preventDefault();panStart={x:event.clientX,y:event.clientY,originX:pan.value.x,originY:pan.value.y};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function movePan(event:PointerEvent){
  if(!panStart)return
  const dx=event.clientX-panStart.x,dy=event.clientY-panStart.y
  if(Math.abs(dx)+Math.abs(dy)>3)didPan=true
  pan.value={x:panStart.originX+dx,y:panStart.originY+dy}
}
function endPan(){panStart=undefined}
function endPointer(event:PointerEvent){
  if(!draggingConstraint.value||!sourcePixels.value)return
  const constraintId=draggingConstraint.value,position=stagePosition(event),layer=project.value.layers.find(l=>l.constraints.some(c=>c.id===constraintId))
  if(layer){
    const old=layer.constraints.find(c=>c.id===constraintId)!
    const updated=moveConstraint(old,position,sourcePixels.value,width.value,height.value)
    commit('Move constraint and resample source',current=>({...current,layers:current.layers.map(item=>item.id===layer.id?{...item,constraints:item.constraints.map(c=>c.id===constraintId?updated:c)}:item)}))
  }
  draggingConstraint.value='';dragPosition.value=null
}
function pickConstraint(layerId:string,id:string){selectedLayerId.value=layerId;selectedConstraintId.value=id;addMode.value='select'}
function deleteConstraint(layerId:string,id:string){
  commit('Remove constraint',current=>({...current,layers:current.layers.map(layer=>layer.id===layerId?{...layer,constraints:layer.constraints.filter(c=>c.id!==id)}:layer)}))
  const next=findLayer(layerId)?.constraints[0];selectedConstraintId.value=next?.id??''
}
function deleteLayer(id:string){
  const index=project.value.layers.findIndex(layer=>layer.id===id);commit('Remove correction layer',current=>({...current,layers:current.layers.filter(layer=>layer.id!==id)}))
  const next=project.value.layers[Math.max(0,index-1)]??project.value.layers[0];selectedLayerId.value=next?.id??'';selectedConstraintId.value=next?.constraints[0]?.id??''
}
function duplicateLayer(layer:CorrectionLayer){
  const duplicate=structuredClone(layer);duplicate.id=crypto.randomUUID();duplicate.name=`${layer.name} copy`;duplicate.constraints=duplicate.constraints.map(c=>({...c,id:crypto.randomUUID()}));duplicate.activationHints=duplicate.activationHints.map(h=>({...h,id:crypto.randomUUID()}))
  commit('Duplicate correction layer',current=>({...current,layers:[...current.layers,duplicate]}));selectedLayerId.value=duplicate.id;selectedConstraintId.value=duplicate.constraints[0]?.id??''
}
function reorderLayer(id:string,direction:-1|1){
  const oldIndex=project.value.layers.findIndex(layer=>layer.id===id),newIndex=oldIndex+direction;if(oldIndex<0||newIndex<0||newIndex>=project.value.layers.length)return
  commit('Reorder correction layers',current=>{const layers=[...current.layers],[item]=layers.splice(oldIndex,1);layers.splice(newIndex,0,item);return {...current,layers}})
}
function renameLayer(id:string,event:Event){const name=(event.target as HTMLInputElement).value;updateLayer(id,'Rename correction layer',layer=>({...layer,name}))}
function toggleLayer(id:string,event:Event){const enabled=(event.target as HTMLInputElement).checked;updateLayer(id,'Toggle correction layer',layer=>({...layer,enabled}))}
function setStrength(id:string,event:Event){const strength=Number((event.target as HTMLInputElement).value)/100;updateLayer(id,'Change layer strength',layer=>({...layer,strength}))}
function onTargetColor(event:Event){
  if(!activeLayer.value||!selectedConstraint.value)return
  const value=(event.target as HTMLInputElement).value, rgb=[1,3,5].map(index=>parseInt(value.slice(index,index+2),16)/255),target=encodedRgbToLinear(rgb[0],rgb[1],rgb[2]),layerId=activeLayer.value.id,constraintId=selectedConstraint.value.id
  updateLayer(layerId,'Edit constraint target',layer=>({...layer,constraints:layer.constraints.map(item=>item.id===constraintId?{...item,target}:item)}))
}
function preserveColor(){
  if(!activeLayer.value||!selectedConstraint.value)return
  const id=selectedConstraint.value.id;updateLayer(activeLayer.value.id,'Preserve current source color',layer=>({...layer,constraints:layer.constraints.map(c=>c.id===id?{...c,target:{...c.source}}:c)}))
}
function setTransformMode(event:Event){if(activeLayer.value){const mode=(event.target as HTMLSelectElement).value as CorrectionLayer['transformConfig']['mode'];updateLayer(activeLayer.value.id,'Change transform model',layer=>({...layer,transformConfig:{...layer.transformConfig,mode}}))}}
function setRegularization(event:Event){if(activeLayer.value){const regularization=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,'Change transform regularization',layer=>({...layer,transformConfig:{...layer.transformConfig,regularization}}))}}
function setNonlinearRegularization(event:Event){if(activeLayer.value){const nonlinearRegularization=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,'Change nonlinear regularization',layer=>({...layer,transformConfig:{...layer.transformConfig,nonlinearRegularization}}))}}
function setTransformParameter(key:'interceptRegularizationWeight'|'adaptiveMinSpread'|'adaptiveMinConstraints'|'adaptiveAffineSpreadFraction'|'adaptiveConditionBoost'|'adaptiveMaxRegularizationBoost'|'nonlinearMaxConditionBoost'|'coefficientLimit',event:Event){if(activeLayer.value){const value=Number((event.target as HTMLInputElement).value),value2=key==='adaptiveMinConstraints'?Math.round(value):value;updateLayer(activeLayer.value.id,`Change transform ${key}`,layer=>({...layer,transformConfig:{...layer.transformConfig,[key]:value2}}))}}
function setTransformConditionLimit(key:'adaptiveAffineConditionLimit'|'adaptiveRootConditionLimit'|'nonlinearConditionScale',event:Event){if(activeLayer.value){const value=10**Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,`Change transform ${key}`,layer=>({...layer,transformConfig:{...layer.transformConfig,[key]:value}}))}}
function setActivationComponent(key:string,event:Event){if(activeLayer.value){const value=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,`Change activation ${key}`,layer=>({...layer,activationConfig:{...layer.activationConfig,[key]:value}}))}}
function setGamut(event:Event){const gamut=(event.target as HTMLSelectElement).value as Project['pipeline']['gamut'];commit('Change gamut mapper',current=>({...current,pipeline:{...current.pipeline,gamut}}))}
function setActivationPreset(event:Event){if(activeLayer.value){const preset=(event.target as HTMLSelectElement).value as CorrectionLayer['activationConfig']['preset'];updateLayer(activeLayer.value.id,'Change activation preset',layer=>({...layer,activationConfig:{...layer.activationConfig,preset}}))}}
function setActivationValue(key:'colorWeight'|'spatialWeight'|'contextWeight'|'edgeWeight'|'sharpness',event:Event){if(activeLayer.value){const value=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,`Change activation ${key}`,layer=>({...layer,activationConfig:{...layer.activationConfig,[key]:value,preset:'custom'}}))}}
function setActivationScale(key:'spatialScale'|'colorScale'|'contextScale'|'edgeScale'|'hintRadius'|'upsampleSigma',event:Event){if(activeLayer.value){const value=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,`Change activation ${key}`,layer=>({...layer,activationConfig:{...layer.activationConfig,[key]:value,preset:key==='hintRadius'||key==='upsampleSigma'?layer.activationConfig.preset:'custom'}}))}}
function setContextRadius(index:number,event:Event){if(activeLayer.value){const contextRadii=[...activeLayer.value.activationConfig.contextRadii] as [number,number,number],value=Number((event.target as HTMLInputElement).value);contextRadii[index]=value;updateLayer(activeLayer.value.id,'Change context scale',layer=>({...layer,activationConfig:{...layer.activationConfig,contextRadii}}))}}
function setAggregatorTemperature(event:Event){if(activeLayer.value){const temperature=Number((event.target as HTMLInputElement).value);updateLayer(activeLayer.value.id,'Change aggregator temperature',layer=>({...layer,activationAggregator:{...layer.activationAggregator,temperature}}))}}
function setAnalysisSize(event:Event){if(activeLayer.value){const value=Number((event.target as HTMLSelectElement).value) as 256|512|1024;updateLayer(activeLayer.value.id,'Change analysis resolution',layer=>({...layer,activationConfig:{...layer.activationConfig,analysisMaxDimension:value}}))}}
function setUpsampling(event:Event){if(activeLayer.value){const value=(event.target as HTMLSelectElement).value as 'bilinear'|'joint-bilateral';updateLayer(activeLayer.value.id,'Change activation upsampling',layer=>({...layer,activationConfig:{...layer.activationConfig,upsampling:value}}))}}
function setAggregator(event:Event){if(activeLayer.value){const type=(event.target as HTMLSelectElement).value as 'probabilistic-or'|'smooth-max';updateLayer(activeLayer.value.id,'Change activation aggregator',layer=>({...layer,activationAggregator:{...layer.activationAggregator,type}}))}}
function setCompositor(event:Event){const compositor=(event.target as HTMLSelectElement).value as Project['pipeline']['compositor'];commit('Change compositor',current=>({...current,pipeline:{...current.pipeline,compositor}}))}
function removeHint(layerId:string,hintId:string){updateLayer(layerId,'Remove activation hint',layer=>({...layer,activationHints:layer.activationHints.filter(h=>h.id!==hintId)}))}
function setConfidence(event:Event){if(!activeLayer.value||!selectedConstraint.value)return;const confidence=Number((event.target as HTMLInputElement).value)/100,id=selectedConstraint.value.id;updateLayer(activeLayer.value.id,'Change constraint confidence',layer=>({...layer,constraints:layer.constraints.map(c=>c.id===id?{...c,confidence}:c)}))}
function setHintStrength(layerId:string,hintId:string,event:Event){const strength=Number((event.target as HTMLInputElement).value)/100;updateLayer(layerId,'Change activation hint strength',layer=>({...layer,activationHints:layer.activationHints.map(h=>h.id===hintId?{...h,strength}:h)}))}
function setHintRadius(layerId:string,hintId:string,event:Event){const radius=Number((event.target as HTMLInputElement).value);updateLayer(layerId,'Change activation hint radius',layer=>({...layer,activationHints:layer.activationHints.map(h=>h.id===hintId?{...h,radius}:h)}))}
function moveConstraintToLayer(event:Event){
  if(!selectedConstraint.value||!activeLayer.value)return
  const targetId=(event.target as HTMLSelectElement).value;if(!targetId||targetId===activeLayer.value.id)return
  const sourceId=activeLayer.value.id,constraint=structuredClone(selectedConstraint.value)
  commit('Move constraint to layer',current=>({...current,layers:current.layers.map(layer=>layer.id===sourceId?{...layer,constraints:layer.constraints.filter(c=>c.id!==constraint.id)}:layer.id===targetId?{...layer,constraints:[...layer.constraints,constraint]}:layer)}))
  selectedLayerId.value=targetId;selectedConstraintId.value=constraint.id
}
function togglePreset(id:string){
  const next=selectedPresetIds.value.includes(id)?selectedPresetIds.value.filter(v=>v!==id):[...selectedPresetIds.value,id]
  selectedPresetIds.value=next.length?next:[id]
  commit('Change compare presets',current=>({...current,comparePresetIds:[...selectedPresetIds.value]}))
}
function changeZoom(amount:number){zoom.value=Math.max(0.4,Math.min(2.5,zoom.value+amount))}
function onWheel(event:WheelEvent){if(event.ctrlKey||event.metaKey){event.preventDefault();changeZoom(event.deltaY<0?0.1:-0.1)}}
function thumbnailData(resultId:string,layerId:string){return thumbnailMap.value[`${resultId}:${layerId}`]}
function thumbnailUrl(resultId:string,layerId:string){
  const data=thumbnailData(resultId,layerId)??thumbnailData(compareResults.value[0]?.id??'',layerId);if(!data)return ''
  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)return ''
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength),48,48),0,0);return canvas.toDataURL()
}
</script>

<template>
  <div class="editor-shell">
    <header class="topbar">
      <div class="brand-lockup"><div class="brand-mark"><Aperture :size="19" /></div><div><strong>prism</strong><span>PHOTO COLOR CORRECTION</span></div></div>
      <div class="topbar-file"><span class="eyebrow">WORKSPACE</span><strong>{{ project.image.name }}</strong><span class="dimension-pill">{{ dimensionsLabel }}</span></div>
      <div class="topbar-actions">
        <button class="icon-button" :disabled="!canUndo" title="Undo · Ctrl Z" @click="undo"><Undo2 :size="16" /></button>
        <button class="icon-button" :disabled="!canRedo" title="Redo · Ctrl Y" @click="redo"><Redo2 :size="16" /></button>
        <span class="action-divider"></span>
        <label class="button secondary"><FolderOpen :size="15" /> Open project<input type="file" accept=".json,.prism.json,application/json" @change="onProjectFile"></label>
        <button class="button secondary" :disabled="!width" @click="saveProject"><Save :size="15" /> Save project</button>
        <button class="button primary" :disabled="!correctedPixels" @click="exportPng"><ArrowDownToLine :size="15" /> Export</button>
      </div>
    </header>

    <div class="workspace-grid">
      <aside class="left-panel panel">
        <div class="panel-heading"><div><span class="eyebrow">EDIT STACK</span><h2>Corrections <span class="count-badge">{{ project.layers.length }}</span></h2></div><button class="icon-button add-layer" title="Create correction layer" @click="createNewLayer"><Plus :size="17" /></button></div>
        <label class="button import-button"><Upload :size="15" /> Import photo<input type="file" accept="image/*" @change="choosePhoto"></label>
        <div v-if="!project.layers.length" class="empty-layers"><div class="empty-icon"><Layers3 :size="22" /></div><strong>No correction layers</strong><p>Click a color in your photo to create a correction from an original-image sample.</p><button class="text-button" :disabled="!width" @click="addMode='new-layer'"><Plus :size="14" /> Start first correction</button></div>
        <div v-else class="layer-list">
          <article v-for="(layer,index) in project.layers" :key="layer.id" class="layer-card" :class="{active:selectedLayerId===layer.id,disabled:!layer.enabled}" @click="selectedLayerId=layer.id;selectedConstraintId=layer.constraints[0]?.id??''">
            <div class="layer-card-top"><button class="visibility-toggle" :title="layer.enabled?'Disable layer':'Enable layer'" @click.stop="commit('Toggle correction layer',current=>({...current,layers:current.layers.map(item=>item.id===layer.id?{...item,enabled:!item.enabled}:item)}))"><Eye v-if="layer.enabled" :size="15"/><EyeOff v-else :size="15"/></button>
              <input class="layer-name" :value="layer.name" aria-label="Layer name" @click.stop @change="renameLayer(layer.id,$event)" />
              <button class="mini-icon" title="Move layer up" :disabled="index===0" @click.stop="reorderLayer(layer.id,-1)"><ChevronUp :size="14"/></button><button class="mini-icon" title="Move layer down" :disabled="index===project.layers.length-1" @click.stop="reorderLayer(layer.id,1)"><ChevronDown :size="14"/></button>
            </div>
            <div class="layer-thumbline"><img v-if="thumbnailUrl('main',layer.id)" :src="thumbnailUrl('main',layer.id)" alt="Activation thumbnail"/><div v-else class="thumb-placeholder"><Sparkles :size="14"/></div><div class="layer-meta"><span>{{ layer.constraints.length }} constraint{{ layer.constraints.length===1?'':'s' }}</span><span>{{ layer.activationHints.length }} hints · {{ layer.transformConfig.mode }}</span></div><span class="layer-strength-value">{{ Math.round(layer.strength*100) }}%</span></div>
            <input class="strength-range" type="range" min="0" max="100" :value="Math.round(layer.strength*100)" :aria-label="`${layer.name} strength`" @click.stop @input="setStrength(layer.id,$event)" />
            <div class="constraint-list">
              <div v-for="(constraint,index) in layer.constraints" :key="constraint.id" class="constraint-row" :class="{selected:selectedConstraintId===constraint.id&&selectedLayerId===layer.id}" @click.stop="pickConstraint(layer.id,constraint.id)">
                <span class="constraint-index">{{ String(index+1).padStart(2,'0') }}</span><span class="source-swatch" :style="{background:rgbHex(constraint.source)}"></span><span class="constraint-label">{{ rgbHex(constraint.source).toUpperCase() }} <small>→</small> {{ rgbHex(constraint.target).toUpperCase() }}</span><button class="mini-icon delete-constraint" title="Remove constraint" @click.stop="deleteConstraint(layer.id,constraint.id)"><X :size="13"/></button>
              </div>
              <button class="add-constraint-row" @click.stop="selectedLayerId=layer.id;addMode='constraint'"><Plus :size="13"/> Add color constraint</button>
            </div>
            <div class="layer-card-actions"><button @click.stop="duplicateLayer(layer)"><Copy :size="12"/> Duplicate</button><button class="danger-text" @click.stop="deleteLayer(layer.id)"><Trash2 :size="12"/> Delete</button></div>
          </article>
        </div>
        <div class="left-footer"><div class="footer-title"><span class="status-dot" :class="{busy:isRendering}"></span> {{ isRendering?'Processing':'Ready' }}</div><span>{{ status }}</span><div v-if="errorMessage" class="error-message">{{ errorMessage }}</div></div>
      </aside>

      <main class="canvas-workspace">
        <div class="canvas-toolbar">
          <div class="tool-switcher">
            <button :class="{selected:addMode==='select'&&!panMode}" title="Select" @click="panMode=false;addMode='select'"><MousePointer2 :size="15"/></button>
            <button :class="{selected:panMode}" title="Pan the photo by dragging" @click="panMode=!panMode"><Move :size="14"/></button>
            <button :class="{selected:addMode==='constraint'}" :disabled="!activeLayer" title="Add a constraint to selected layer" @click="addMode=addMode==='constraint'?'select':'constraint'"><Plus :size="16"/><span class="tool-caption">Constraint</span></button>
            <button :class="{selected:addMode==='include'}" :disabled="!activeLayer" title="Include hint: click a region to strengthen activation" @click="addMode=addMode==='include'?'select':'include'"><span class="hint-symbol include">+</span></button>
            <button :class="{selected:addMode==='exclude'}" :disabled="!activeLayer" title="Exclude hint: click a region to suppress activation" @click="addMode=addMode==='exclude'?'select':'exclude'"><Minus :size="15"/></button>
          </div>
          <div class="tool-separator"></div>
          <label class="view-select-label"><ScanEye :size="15"/><select v-model="view" aria-label="Preview debug view"><option value="corrected">Corrected</option><option value="original">Original</option><option value="split">Before / after split</option><option value="difference">Difference</option><option value="seed">Selected seed field</option><option value="activation">Layer activation</option><option value="activation-overlay">Activation heatmap overlay</option><option value="dominant">Dominant layer</option><option value="contribution">Layer contribution</option><option value="total-correction">Total correction magnitude</option><option value="out-of-gamut">Out of gamut</option></select><ChevronDown :size="13"/></label>
          <div class="toolbar-spacer"></div>
          <button class="icon-button" title="Zoom out" @click="changeZoom(-0.1)"><Minus :size="15"/></button><span class="zoom-value">{{ Math.round(zoom*100) }}%</span><button class="icon-button" title="Zoom in" @click="changeZoom(0.1)"><Plus :size="15"/></button>
          <button class="compare-toggle" :class="{active:compareMode}" @click="compareMode=!compareMode"><ArrowLeftRight :size="14"/> Compare</button>
        </div>
        <div class="canvas-viewport" @wheel="onWheel">
          <div v-if="!width" class="canvas-empty">
            <div class="empty-photo-icon"><FileImage :size="30"/></div><span class="eyebrow">PRISM COLOR WORKSPACE</span><h1>Make precise corrections<br/>with fewer controls.</h1><p>Sample a color, describe what it should be, and let Prism infer where that correction belongs.</p>
            <label class="button primary"><Upload :size="15"/> Choose a photo<input type="file" accept="image/*" @change="choosePhoto"/></label>
            <span class="supported-format">Local processing · JPEG, PNG, WebP, AVIF</span>
          </div>
          <template v-else>
            <div class="stage-frame" :class="{panning:panMode}" :style="{aspectRatio:`${width}/${height}`,transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}" @click="onStageClick" @pointerdown="startPan" @pointermove="movePointer($event);movePan($event)" @pointerup="endPointer($event);endPan()">
              <PreviewCanvas :pixels="preview" :width="width" :height="height" :label="view+' photo view'" />
              <template v-for="layer in project.layers" :key="layer.id"><button v-for="(constraint,index) in layer.constraints" :key="constraint.id" class="constraint-marker" :class="{active:selectedConstraintId===constraint.id&&selectedLayerId===layer.id,muted:!layer.enabled}" :style="markerStyle(markerPosition(constraint.position))" :title="`Constraint ${index+1}: drag to resample original color`" @pointerdown="startConstraintDrag($event,constraint.id)" @click.stop="pickConstraint(layer.id,constraint.id)"><span>{{ String(index+1).padStart(2,'0') }}</span></button><span v-for="hint in layer.activationHints" :key="hint.id" class="hint-marker" :class="hint.type" :style="markerStyle(hint.position)" :title="`${hint.type} activation hint`">{{ hint.type==='include'?'+':'−' }}</span></template>
              <div v-if="addMode==='constraint'||addMode==='new-layer'" class="canvas-instruction"><MousePointer2 :size="13"/> Click the image to sample its original color</div>
              <div v-else-if="addMode==='include'||addMode==='exclude'" class="canvas-instruction" :class="addMode"><span class="hint-symbol" :class="addMode">{{ addMode==='include'?'+':'−' }}</span> Click to add {{ addMode }} hint</div>
            </div>
            <div v-if="compareMode" class="compare-grid">
              <article v-for="result in compareResults" :key="result.id" class="compare-card"><div class="compare-card-title"><span>{{ result.name }}</span><span>{{ result.processingMs.toFixed(0) }} ms</span></div><div class="compare-image" :style="{aspectRatio:`${width}/${height}`}" ><PreviewCanvas :pixels="result.corrected" :width="width" :height="height" :label="`${result.name} comparison result`"/></div><div class="compare-card-meta"><span>{{ (result.outOfGamutRate*100).toFixed(2) }}% out of gamut</span><span>{{ project.layers.length }} layers · shared user intent</span></div></article>
            </div>
          </template>
        </div>
        <footer class="canvas-footer"><div><span class="status-dot" :class="{busy:isRendering}"></span><span>{{ status }}</span></div><div class="footer-right"><span>LINEAR sRGB · OKLab activation</span><span class="gpu-pill">WEBGL2 PREVIEW</span></div></footer>
      </main>

      <aside class="right-panel panel">
        <div class="panel-heading inspector-heading"><div><span class="eyebrow">ALGORITHM INSPECTOR</span><h2>{{ activeLayer?.name??'Layer settings' }}</h2></div><button v-if="activeLayer" class="icon-button" title="Create layer copy" @click="duplicateLayer(activeLayer)"><Copy :size="15"/></button></div>
        <div v-if="!activeLayer" class="inspector-empty"><div class="empty-icon"><SlidersHorizontal :size="20"/></div><strong>Select a correction layer</strong><p>Activation and transform diagnostics appear here once a layer is selected.</p><button class="button secondary" :disabled="!width" @click="createNewLayer"><Plus :size="14"/> New layer</button></div>
        <template v-else>
          <div class="inspector-tabs"><button :class="{active:inspectorTab==='activation'}" @click="inspectorTab='activation'"><Sparkles :size="14"/> Activation</button><button :class="{active:inspectorTab==='transform'}" @click="inspectorTab='transform'"><SlidersHorizontal :size="14"/> Transform</button></div>
          <div class="inspector-scroll">
            <template v-if="inspectorTab==='activation'">
              <section class="inspector-section">
                <div class="section-title"><div><span class="eyebrow">ACTIVATION FIELD</span><h3>Where this correction applies</h3></div><span class="live-badge">LIVE</span></div>
                <div class="field-preview" :class="{empty:!activeLayer.constraints.length}"><div class="field-checker"></div><img v-if="thumbnailUrl('main',activeLayer.id)" :src="thumbnailUrl('main',activeLayer.id)" alt="Aggregated layer activation field"/><div v-else class="field-empty-label"><Sparkles :size="16"/> Add a color constraint to generate its activation field</div><div class="field-legend"><span><i class="legend-low"></i>LOW</span><span><i class="legend-high"></i>HIGH</span></div></div>
                <div class="field-note"><span class="info-dot">i</span><span>Target-independent · computed from original image context only</span></div>
              </section>
              <section class="inspector-section compact-section">
                <div class="section-title"><div><span class="eyebrow">SEED FIELDS</span><h3>Per-constraint evidence</h3></div><span class="section-count">{{ activeLayer.constraints.length }}</span></div>
                <button v-for="(constraint,index) in activeLayer.constraints" :key="constraint.id" class="seed-row" :class="{selected:selectedConstraintId===constraint.id}" @click="selectedConstraintId=constraint.id;view='seed'"><span class="seed-number">{{ String(index+1).padStart(2,'0') }}</span><img v-if="thumbnailUrl('main',`${activeLayer.id}:seed:${constraint.id}`)" :src="thumbnailUrl('main',`${activeLayer.id}:seed:${constraint.id}`)" alt=""/><span class="seed-color" :style="{background:rgbHex(constraint.source)}"></span><span class="seed-row-copy"><strong>{{ rgbHex(constraint.source).toUpperCase() }}</strong><small>original sample · confidence {{ Math.round(constraint.confidence*100) }}%</small></span><ScanEye :size="14"/></button>
                <div v-if="!activeLayer.constraints.length" class="inline-empty">No constraints yet. Use <b>+ Constraint</b> and click the photo.</div>
              </section>
              <section class="inspector-section controls-section">
                <div class="section-title"><div><span class="eyebrow">MODEL</span><h3>Gaussian feature distance</h3></div></div>
                <label class="control-row"><span>Feature preset</span><select :value="activeLayer.activationConfig.preset" @change="setActivationPreset"><option value="spatial-only">Spatial-only</option><option value="color-only">Color-only</option><option value="color+xy">Color + XY</option><option value="color+context">Color + context</option><option value="color+context+edge">Color + context + edge</option><option value="custom">Custom weights</option></select></label>
                <label class="control-row"><span>Seed aggregator</span><select :value="activeLayer.activationAggregator.type" @change="setAggregator"><option value="probabilistic-or">Probabilistic OR</option><option value="smooth-max">Smooth max</option></select></label>
                <div class="range-control"><div><span>Color cue</span><b>{{ activeLayer.activationConfig.colorWeight.toFixed(2) }}</b></div><input type="range" min="0" max="3" step="0.05" :value="activeLayer.activationConfig.colorWeight" @input="setActivationValue('colorWeight',$event)"/></div>
                <div class="range-control"><div><span>Spatial prior</span><b>{{ activeLayer.activationConfig.spatialWeight.toFixed(2) }}</b></div><input type="range" min="0" max="3" step="0.05" :value="activeLayer.activationConfig.spatialWeight" @input="setActivationValue('spatialWeight',$event)"/></div>
                <div class="range-control"><div><span>Multi-scale context</span><b>{{ activeLayer.activationConfig.contextWeight.toFixed(2) }}</b></div><input type="range" min="0" max="3" step="0.05" :value="activeLayer.activationConfig.contextWeight" @input="setActivationValue('contextWeight',$event)"/></div>
                <div class="range-control"><div><span>Edge / texture</span><b>{{ activeLayer.activationConfig.edgeWeight.toFixed(2) }}</b></div><input type="range" min="0" max="3" step="0.05" :value="activeLayer.activationConfig.edgeWeight" @input="setActivationValue('edgeWeight',$event)"/></div>
                <details class="advanced-controls"><summary>Advanced scales & kernel</summary>
                  <div class="range-control"><div><span>Color scale</span><b>{{ activeLayer.activationConfig.colorScale.toFixed(2) }}</b></div><input type="range" min="0.03" max="0.8" step="0.01" :value="activeLayer.activationConfig.colorScale" @input="setActivationScale('colorScale',$event)"/></div>
                  <div class="range-control"><div><span>Spatial scale</span><b>{{ activeLayer.activationConfig.spatialScale.toFixed(2) }}</b></div><input type="range" min="0.05" max="1" step="0.01" :value="activeLayer.activationConfig.spatialScale" @input="setActivationScale('spatialScale',$event)"/></div>
                  <div class="range-control"><div><span>Context scale</span><b>{{ activeLayer.activationConfig.contextScale.toFixed(2) }}</b></div><input type="range" min="0.05" max="1" step="0.01" :value="activeLayer.activationConfig.contextScale" @input="setActivationScale('contextScale',$event)"/></div>
                  <div class="range-control"><div><span>Edge scale</span><b>{{ activeLayer.activationConfig.edgeScale.toFixed(2) }}</b></div><input type="range" min="0.05" max="1" step="0.01" :value="activeLayer.activationConfig.edgeScale" @input="setActivationScale('edgeScale',$event)"/></div>
                  <div class="range-control"><div><span>Gaussian sharpness</span><b>{{ activeLayer.activationConfig.sharpness.toFixed(2) }}</b></div><input type="range" min="0.1" max="4" step="0.05" :value="activeLayer.activationConfig.sharpness" @input="setActivationValue('sharpness',$event)"/></div>
                  <div v-for="[key,label,value] in [['contextSmallWeight','Small-context weight',activeLayer.activationConfig.contextSmallWeight],['contextMediumWeight','Medium-context weight',activeLayer.activationConfig.contextMediumWeight],['contextLargeWeight','Large-context weight',activeLayer.activationConfig.contextLargeWeight],['contextVarianceWeight','Variance cue weight',activeLayer.activationConfig.contextVarianceWeight],['localContrastWeight','Local-contrast weight',activeLayer.activationConfig.localContrastWeight],['edgeTextureWeight','Edge-texture weight',activeLayer.activationConfig.edgeTextureWeight],['luminanceGradientWeight','Luminance-gradient weight',activeLayer.activationConfig.luminanceGradientWeight],['chromaGradientWeight','Chroma-gradient weight',activeLayer.activationConfig.chromaGradientWeight]]" :key="key" class="range-control"><div><span>{{ label }}</span><b>{{ Number(value).toFixed(2) }}</b></div><input type="range" min="0" max="2" step="0.02" :value="value" @input="setActivationComponent(String(key),$event)"/></div>
                  <div class="range-control"><div><span>Hint Gaussian sharpness</span><b>{{ activeLayer.activationConfig.hintSharpness.toFixed(2) }}</b></div><input type="range" min="0.1" max="4" step="0.05" :value="activeLayer.activationConfig.hintSharpness" @input="setActivationComponent('hintSharpness',$event)"/></div>
                  <div v-for="(radius,index) in activeLayer.activationConfig.contextRadii" :key="index" class="range-control"><div><span>{{ ['Small','Medium','Large'][index] }} context radius</span><b>{{ radius }} px</b></div><input type="range" min="1" max="96" step="1" :value="radius" @input="setContextRadius(index,$event)"/></div>
                  <div class="range-control"><div><span>Hint radius</span><b>{{ activeLayer.activationConfig.hintRadius.toFixed(2) }}</b></div><input type="range" min="0.02" max="0.35" step="0.01" :value="activeLayer.activationConfig.hintRadius" @input="setActivationScale('hintRadius',$event)"/></div>
                  <div class="range-control"><div><span>Upsample guide σ</span><b>{{ activeLayer.activationConfig.upsampleSigma.toFixed(2) }}</b></div><input type="range" min="0.02" max="0.3" step="0.01" :value="activeLayer.activationConfig.upsampleSigma" @input="setActivationScale('upsampleSigma',$event)"/></div>
                  <div v-if="activeLayer.activationAggregator.type==='smooth-max'" class="range-control"><div><span>Smooth-max temperature</span><b>{{ activeLayer.activationAggregator.temperature.toFixed(2) }}</b></div><input type="range" min="0.01" max="0.5" step="0.01" :value="activeLayer.activationAggregator.temperature" @input="setAggregatorTemperature"/></div>
                </details>
                <label class="control-row"><span>Analysis resolution</span><select :value="activeLayer.activationConfig.analysisMaxDimension" @change="setAnalysisSize"><option :value="256">256 px</option><option :value="512">512 px</option><option :value="1024">1024 px</option></select></label>
                <label class="control-row"><span>Field upsampling</span><select :value="activeLayer.activationConfig.upsampling" @change="setUpsampling"><option value="joint-bilateral">Joint bilateral</option><option value="bilinear">Bilinear</option></select></label>
              </section>
              <section class="inspector-section hints-section">
                <div class="section-title"><div><span class="eyebrow">SCOPE HINTS</span><h3>Lightweight include / exclude</h3></div></div>
                <div v-if="activeLayer.activationHints.length" class="hint-list"><div v-for="hint in activeLayer.activationHints" :key="hint.id" class="hint-row"><span class="hint-chip" :class="hint.type">{{ hint.type==='include'?'+':'−' }}</span><span>{{ hint.type }} · ({{ hint.position.x.toFixed(2) }}, {{ hint.position.y.toFixed(2) }})</span><b>{{ Math.round(hint.strength*100) }}%</b><button class="mini-icon" @click="removeHint(activeLayer.id,hint.id)"><X :size="13"/></button><input class="hint-range" type="range" min="0" max="100" :value="hint.strength*100" :aria-label="`${hint.type} hint strength`" @input="setHintStrength(activeLayer.id,hint.id,$event)"/><input class="hint-range radius" type="range" min="0.02" max="0.35" step="0.01" :value="hint.radius??activeLayer.activationConfig.hintRadius" :aria-label="`${hint.type} hint radius`" @input="setHintRadius(activeLayer.id,hint.id,$event)"/></div></div><div v-else class="hint-empty">Add a local correction hint without painting a mask.</div>
                <div class="hint-buttons"><button @click="addMode='include'"><Plus :size="13"/> Include here</button><button @click="addMode='exclude'"><Minus :size="13"/> Exclude here</button></div>
              </section>
            </template>
            <template v-else>
              <section class="inspector-section">
                <div class="section-title"><div><span class="eyebrow">SHARED COLOR TRANSFORM</span><h3>One transform per layer</h3></div><span class="live-badge">SOLVED</span></div>
                <div class="transform-equation"><span class="equation-main">T(c) = c + Δ(c)</span><span>Color constraints determine Δ. Activation controls where it applies.</span></div>
                <label class="control-row"><span>Transform model</span><select :value="activeLayer.transformConfig.mode" @change="setTransformMode"><option value="adaptive">Evidence-adaptive</option><option value="constant">Constant residual</option><option value="affine">Affine residual</option><option value="root-polynomial">Centered root-polynomial</option></select></label>
                <div class="range-control"><div><span>Ridge regularization</span><b>{{ activeLayer.transformConfig.regularization.toFixed(3) }}</b></div><input type="range" min="0.001" max="0.5" step="0.001" :value="activeLayer.transformConfig.regularization" @input="setRegularization"/></div>
                <div class="range-control"><div><span>Nonlinear regularization</span><b>{{ activeLayer.transformConfig.nonlinearRegularization.toFixed(2) }}</b></div><input type="range" min="0.01" max="2" step="0.01" :value="activeLayer.transformConfig.nonlinearRegularization" @input="setNonlinearRegularization"/></div>
                <details class="advanced-controls"><summary>Adaptive capacity & solver bounds</summary>
                  <div class="range-control"><div><span>Minimum source-color spread</span><b>{{ activeLayer.transformConfig.adaptiveMinSpread.toFixed(3) }}</b></div><input type="range" min="0.001" max="0.08" step="0.001" :value="activeLayer.transformConfig.adaptiveMinSpread" @input="setTransformParameter('adaptiveMinSpread',$event)"/></div>
                  <div class="range-control"><div><span>Minimum constraint count</span><b>{{ activeLayer.transformConfig.adaptiveMinConstraints }}</b></div><input type="range" min="3" max="12" step="1" :value="activeLayer.transformConfig.adaptiveMinConstraints" @input="setTransformParameter('adaptiveMinConstraints',$event)"/></div>
                  <div class="range-control"><div><span>Affine condition limit</span><b>{{ activeLayer.transformConfig.adaptiveAffineConditionLimit.toExponential(0) }}</b></div><input type="range" min="3" max="12" step="0.1" :value="Math.log10(activeLayer.transformConfig.adaptiveAffineConditionLimit)" @input="setTransformConditionLimit('adaptiveAffineConditionLimit',$event)"/></div>
                  <div class="range-control"><div><span>Root-polynomial condition limit</span><b>{{ activeLayer.transformConfig.adaptiveRootConditionLimit.toExponential(0) }}</b></div><input type="range" min="3" max="12" step="0.1" :value="Math.log10(activeLayer.transformConfig.adaptiveRootConditionLimit)" @input="setTransformConditionLimit('adaptiveRootConditionLimit',$event)"/></div>
                  <div class="range-control"><div><span>Affine spread fraction</span><b>{{ activeLayer.transformConfig.adaptiveAffineSpreadFraction.toFixed(2) }}</b></div><input type="range" min="0.01" max="1" step="0.01" :value="activeLayer.transformConfig.adaptiveAffineSpreadFraction" @input="setTransformParameter('adaptiveAffineSpreadFraction',$event)"/></div>
                  <div class="range-control"><div><span>Condition regularization boost</span><b>{{ activeLayer.transformConfig.adaptiveConditionBoost.toFixed(2) }}</b></div><input type="range" min="0.5" max="5" step="0.1" :value="activeLayer.transformConfig.adaptiveConditionBoost" @input="setTransformParameter('adaptiveConditionBoost',$event)"/></div>
                  <div class="range-control"><div><span>Max adaptive penalty boost</span><b>{{ activeLayer.transformConfig.adaptiveMaxRegularizationBoost.toFixed(0) }}</b></div><input type="range" min="1" max="80" step="1" :value="activeLayer.transformConfig.adaptiveMaxRegularizationBoost" @input="setTransformParameter('adaptiveMaxRegularizationBoost',$event)"/></div>
                  <div class="range-control"><div><span>Nonlinear condition scale</span><b>{{ activeLayer.transformConfig.nonlinearConditionScale.toExponential(0) }}</b></div><input type="range" min="2" max="6" step="0.1" :value="Math.log10(activeLayer.transformConfig.nonlinearConditionScale)" @input="setTransformConditionLimit('nonlinearConditionScale',$event)"/></div>
                  <div class="range-control"><div><span>Nonlinear maximum condition boost</span><b>{{ activeLayer.transformConfig.nonlinearMaxConditionBoost.toFixed(0) }}</b></div><input type="range" min="1" max="200" step="1" :value="activeLayer.transformConfig.nonlinearMaxConditionBoost" @input="setTransformParameter('nonlinearMaxConditionBoost',$event)"/></div>
                  <div class="range-control"><div><span>Intercept penalty weight</span><b>{{ activeLayer.transformConfig.interceptRegularizationWeight.toFixed(2) }}</b></div><input type="range" min="0.01" max="1" step="0.01" :value="activeLayer.transformConfig.interceptRegularizationWeight" @input="setTransformParameter('interceptRegularizationWeight',$event)"/></div>
                  <div class="range-control"><div><span>Coefficient limit</span><b>{{ activeLayer.transformConfig.coefficientLimit.toFixed(1) }}</b></div><input type="range" min="0.25" max="10" step="0.25" :value="activeLayer.transformConfig.coefficientLimit" @input="setTransformParameter('coefficientLimit',$event)"/></div>
                </details>
                <div class="transform-stat-grid"><div><span>CONSTRAINTS</span><strong>{{ layerDiagnostics?.constraintCount??activeLayer.constraints.length }}</strong></div><div><span>EFFECTIVE MODEL</span><strong>{{ layerDiagnostics?.effectiveMode??'pending' }}</strong></div><div><span>STABILITY</span><strong>{{ layerDiagnostics?layerDiagnostics.stable?'STABLE':'REGULARIZED':'pending' }}</strong></div></div>
                <div class="matrix-placeholder"><span class="eyebrow">SOLVER DIAGNOSTICS</span><div class="diagnostic-numbers"><div><span>CONDITION</span><b>{{ layerDiagnostics?layerDiagnostics.condition.toExponential(2):'—' }}</b></div><div><span>RESIDUAL NORM</span><b>{{ layerDiagnostics?.residualMagnitude.toFixed(4)??'—' }}</b></div><div><span>COLOR SPREAD</span><b>{{ layerDiagnostics?.colorSpread.toFixed(4)??'—' }}</b></div></div><div v-if="layerDiagnostics" class="coefficient-matrix"><div v-for="(row,index) in layerDiagnostics.coefficients" :key="index"><span>{{ ['ΔR','ΔG','ΔB'][index] }}</span><code v-for="(value,column) in row" :key="column">{{ value.toFixed(3) }}</code></div></div><p>Weighted ridge coefficients use this layer's source, target and confidence only.</p></div>
              </section>
              <section class="inspector-section compact-section">
                <div class="section-title"><div><span class="eyebrow">COLOR EVIDENCE</span><h3>Constraint targets</h3></div></div>
                <div v-for="(constraint,index) in activeLayer.constraints" :key="constraint.id" class="target-evidence-row" :class="{selected:selectedConstraintId===constraint.id}" @click="selectedConstraintId=constraint.id">
                  <span class="seed-number">{{ String(index+1).padStart(2,'0') }}</span><span class="source-swatch" :style="{background:rgbHex(constraint.source)}"></span><span class="constraint-label">{{ rgbHex(constraint.source).toUpperCase() }} → {{ rgbHex(constraint.target).toUpperCase() }}</span>
                  <select :value="activeLayer.id" aria-label="Move constraint to layer" @click.stop @change="moveConstraintToLayer"><option v-for="layer in project.layers" :key="layer.id" :value="layer.id">{{ layer.name }}</option></select>
                </div><div v-if="!activeLayer.constraints.length" class="inline-empty">Add constraints to solve a shared transform.</div>
              </section>
            </template>
            <section v-if="selectedConstraint" class="inspector-section target-section">
              <div class="section-title"><div><span class="eyebrow">SELECTED CONSTRAINT</span><h3>Source → target</h3></div><button class="mini-icon" title="Delete selected constraint" @click="deleteConstraint(activeLayer.id,selectedConstraint.id)"><Trash2 :size="14"/></button></div>
              <div class="color-pair"><label><span>ORIGINAL SOURCE</span><i :style="{background:rgbHex(selectedConstraint.source)}"></i><code>{{ rgbHex(selectedConstraint.source).toUpperCase() }}</code></label><span class="pair-arrow">→</span><label class="target-color-input"><span>CORRECTION TARGET</span><i :style="{background:rgbHex(selectedConstraint.target)}"></i><code>{{ rgbHex(selectedConstraint.target).toUpperCase() }}</code><input type="color" :value="rgbHex(selectedConstraint.target)" aria-label="Set constraint target color" @change="onTargetColor"/></label></div>
              <div class="target-actions"><button class="preserve-button" @click="preserveColor"><Check :size="13"/> Current color is correct</button><label class="confidence-control"><span>Confidence</span><input type="range" min="0" max="100" :value="selectedConstraint.confidence*100" @input="setConfidence"/><b>{{ Math.round(selectedConstraint.confidence*100) }}%</b></label></div>
              <div class="field-note"><span class="info-dot">i</span><span>Editing the target re-solves the transform only. The activation seed remains unchanged.</span></div>
            </section>
          </div>
          <div class="pipeline-footer"><span>COMPOSITOR</span><select :value="project.pipeline.compositor" @change="setCompositor"><option value="residual-add">Residual add · order independent</option><option value="sequential">Sequential</option><option value="normalized-mixture">Normalized mixture</option></select><span>GAMUT</span><select :value="project.pipeline.gamut" @change="setGamut"><option value="oklch-compress">OKLCH chroma compression</option><option value="hard-clip">Hard-clip baseline</option></select></div>
        </template>
      </aside>
    </div>

    <div v-if="compareMode" class="compare-dock"><div class="compare-dock-title"><div><span class="eyebrow">COMPARE MODE</span><strong>Same user intent · independent pipeline variants</strong></div><span class="variant-count">{{ selectedPresetIds.length }} variants</span></div><div class="preset-list"><button v-for="preset in experimentPresets" :key="preset.id" :class="{checked:selectedPresetIds.includes(preset.id)}" @click="togglePreset(preset.id)"><span class="preset-check"><Check v-if="selectedPresetIds.includes(preset.id)" :size="11"/></span>{{ preset.name }}</button></div><div class="baseline-hooks"><span>ARCHITECTURE HOOKS</span><span>Per-point independent</span><span class="hook-active">Shared correction layer</span><span>Joint per-pixel regression</span></div></div>
  </div>
</template>
