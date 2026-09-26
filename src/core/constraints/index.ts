import { encodedRgbToLinear } from '../color'
import type { ColorConstraint, LinearRGB, Vec2 } from '../types'

export function sampleOriginalColor(data: Uint8ClampedArray, width: number, height: number, position: Vec2): LinearRGB {
  const x=Math.max(0,Math.min(width-1,Math.round(position.x*(width-1)))), y=Math.max(0,Math.min(height-1,Math.round(position.y*(height-1)))), i=(y*width+x)*4
  return encodedRgbToLinear(data[i]/255,data[i+1]/255,data[i+2]/255)
}
export function createConstraint(id:string,position:Vec2,source:LinearRGB):ColorConstraint {
  return {id,position:{x:position.x,y:position.y},source:{...source},target:{...source},confidence:1}
}
export function moveConstraint(constraint:ColorConstraint,position:Vec2,original:Uint8ClampedArray,width:number,height:number):ColorConstraint {
  const source=sampleOriginalColor(original,width,height,position)
  return {...constraint,position:{...position},source,target:{...constraint.target}}
}
