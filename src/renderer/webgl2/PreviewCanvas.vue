<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props=defineProps<{pixels:Uint8Array|Uint8ClampedArray|null;width:number;height:number;label?:string}>()
const canvas=ref<HTMLCanvasElement|null>(null)
let gl:WebGL2RenderingContext|null=null,program:WebGLProgram|null=null,texture:WebGLTexture|null=null,buffer:WebGLBuffer|null=null,contextLost=false
let fallback:CanvasRenderingContext2D|null=null
const vertex=`#version 300 es
in vec2 a_position; out vec2 v_uv;
void main(){v_uv=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`
const fragment=`#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_image; out vec4 outColor;
void main(){outColor=texture(u_image,vec2(v_uv.x,1.0-v_uv.y));}`
function compile(type:number,source:string){
  if(!gl)return null
  const shader=gl.createShader(type);if(!shader)return null
  gl.shaderSource(shader,source);gl.compileShader(shader)
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(shader));gl.deleteShader(shader);return null}
  return shader
}
function initialize(){
  const element=canvas.value;if(!element)return
  gl=element.getContext('webgl2',{alpha:false,antialias:false,premultipliedAlpha:false})
  if(gl){
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment)
    if(!vs||!fs)return
    program=gl.createProgram();if(!program)return
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program)
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(program));return}
    buffer=gl.createBuffer();texture=gl.createTexture();gl.bindBuffer(gl.ARRAY_BUFFER,buffer)
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
  }else fallback=element.getContext('2d')
  draw()
}
function draw(){
  const element=canvas.value,pixels=props.pixels
  if(!element||!pixels||!props.width||!props.height)return
  if(element.width!==props.width||element.height!==props.height){element.width=props.width;element.height=props.height}
  if(gl&&program&&texture&&buffer&&!contextLost){
    gl.viewport(0,0,element.width,element.height);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer)
    const location=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0)
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,props.width,props.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
    gl.uniform1i(gl.getUniformLocation(program,'u_image'),0);gl.drawArrays(gl.TRIANGLES,0,3)
  }else if(fallback){fallback.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.byteLength),props.width,props.height),0,0)}
}
onMounted(()=>{
  initialize();canvas.value?.addEventListener('webglcontextlost',onLost)
})
function onLost(event:Event){event.preventDefault();contextLost=true}
onBeforeUnmount(()=>{canvas.value?.removeEventListener('webglcontextlost',onLost);if(gl&&texture)gl.deleteTexture(texture);if(gl&&program)gl.deleteProgram(program);if(gl&&buffer)gl.deleteBuffer(buffer)})
watch(()=>[props.pixels,props.width,props.height],draw)
</script>
<template><canvas ref="canvas" class="preview-canvas" :aria-label="label ?? 'Photo preview'"></canvas></template>
