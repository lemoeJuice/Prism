export interface StageSize { width:number; height:number }

export function fitStageToViewport(
  imageWidth:number,imageHeight:number,viewportWidth:number,viewportHeight:number,compareMode=false,
):StageSize{
  if(![imageWidth,imageHeight,viewportWidth,viewportHeight].every(Number.isFinite)||imageWidth<=0||imageHeight<=0)return {width:0,height:0}
  const ratio=imageWidth/imageHeight
  const maxWidth=Math.min(1100,Math.max(0,viewportWidth)),maxHeight=Math.max(0,viewportHeight)*(compareMode?0.68:1)
  const width=Math.min(maxWidth,maxHeight*ratio)
  return {width,height:width/ratio}
}
