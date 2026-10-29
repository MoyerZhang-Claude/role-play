/**
 * 程序生成的纸张纹理：
 * - 背景：WebGL2 着色器一次性画到固定在最底层的画布上（窗口尺寸变化时重画）
 * - 表面颗粒：小块可平铺的噪点贴图（用于卡片、面板）
 */
import type { PaperParams } from './types'

export const FULLSCREEN_VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`

export const PAPER_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform float uSeed;
uniform vec3 uBase, uLight, uDark, uBurn;
uniform float uMottle, uFiber, uGrain, uEdge, uFoxing;
out vec4 o;
float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.62,1.18,-1.18,1.62); for(int i=0;i<6;i++){ v+=a*vnoise(p); p=m*p+3.1; a*=.5; } return v; }
float fbm3(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.62,1.18,-1.18,1.62); for(int i=0;i<3;i++){ v+=a*vnoise(p); p=m*p+1.7; a*=.5; } return v; }
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  vec2 p = frag / uDpr + uSeed*137.0;           // CSS 像素坐标
  // 大块斑驳 + 中尺度云纹
  float m1 = fbm(p*0.0022);
  float m2 = fbm(p*0.0085 + 11.3);
  float mot = mix(0.5, m1*0.65 + m2*0.35, uMottle);
  vec3 col = mix(uDark, uLight, smoothstep(0.28, 0.78, mot));
  col = mix(col, uBase, 0.35);
  // 纤维：横向拉伸的细噪声
  float f1 = fbm3(vec2(p.x*0.018, p.y*0.32));
  float f2 = vnoise(vec2(p.x*0.06 + p.y*0.01, p.y*1.1));
  float f3 = vnoise(vec2(p.x*0.9, p.y*0.035) + 5.0);
  col *= 1.0 - uFiber*((f1-0.5)*0.07 + (f2-0.5)*0.035 + smoothstep(0.82,1.0,f3)*0.025);
  // 颗粒
  float g = h21(floor(frag) + uSeed) - 0.5;
  float g2 = vnoise(p*0.9) - 0.5;
  col += (g*0.022 + g2*0.03) * uGrain;
  // 霉斑：少量淡褐色小点
  for (int i=0;i<12;i++){
    if (float(i) >= uFoxing) break;
    vec2 c = vec2(h21(vec2(float(i), uSeed)), h21(vec2(uSeed, float(i)*1.7)));
    c = (c*0.9+0.05)*uRes/uDpr;
    float r = 4.0 + 22.0*h21(vec2(float(i)*3.1, 2.0));
    float d = length(p - uSeed*137.0 - c);
    float n = fbm3((p - c)*0.08);
    float spot = smoothstep(r, r*0.15, d*(0.75+n*0.6));
    col = mix(col, uBurn*0.92, spot*0.16);
  }
  // 边缘焦黄（带噪声的椭圆暗角）
  vec2 q = uv*2.0 - 1.0;
  float d = length(q*vec2(0.86, 1.0));
  float en = fbm(p*0.006 + 40.0) - 0.5;
  float edge = smoothstep(0.78, 1.5, d + en*0.32);
  col = mix(col, uBurn, edge*uEdge);
  col *= 1.0 - edge*uEdge*0.18;
  o = vec4(col, 1.0);
}`

let gl: WebGL2RenderingContext | null = null
let prog: WebGLProgram | null = null
let current: PaperParams | null = null

function compile(g: WebGL2RenderingContext, type: number, src: string) {
  const s = g.createShader(type)!
  g.shaderSource(s, src)
  g.compileShader(s)
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader')
  return s
}

export function paintPaper(canvas: HTMLCanvasElement, params: PaperParams) {
  current = params
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(window.innerWidth * dpr)
  const h = Math.round(window.innerHeight * dpr)
  canvas.width = w
  canvas.height = h
  canvas.style.width = '100vw'
  canvas.style.height = '100vh'
  if (!gl) {
    gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false })
    if (!gl) {
      // 退化：纯色
      const c2 = canvas.getContext('2d')
      if (c2) {
        c2.fillStyle = `rgb(${params.base.join(',')})`
        c2.fillRect(0, 0, w, h)
      }
      return
    }
    prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, PAPER_FRAG))
    gl.linkProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  }
  const g = gl
  g.viewport(0, 0, w, h)
  g.useProgram(prog)
  const u = (n: string) => g.getUniformLocation(prog!, n)
  const c3 = (v: number[]) => v.map((x) => x / 255) as [number, number, number]
  g.uniform2f(u('uRes'), w, h)
  g.uniform1f(u('uDpr'), dpr)
  g.uniform1f(u('uSeed'), params.seed)
  g.uniform3f(u('uBase'), ...c3(params.base))
  g.uniform3f(u('uLight'), ...c3(params.light))
  g.uniform3f(u('uDark'), ...c3(params.dark))
  g.uniform3f(u('uBurn'), ...c3(params.burn))
  g.uniform1f(u('uMottle'), params.mottle)
  g.uniform1f(u('uFiber'), params.fiber)
  g.uniform1f(u('uGrain'), params.grain)
  g.uniform1f(u('uEdge'), params.edge)
  g.uniform1f(u('uFoxing'), params.foxing)
  g.drawArrays(g.TRIANGLES, 0, 3)
}

let resizeTimer = 0
export function watchPaper(canvas: HTMLCanvasElement) {
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => current && paintPaper(canvas, current), 120)
  })
}

/** 可平铺的颗粒贴图（用于表面材质），返回 data URL */
export function makeGrain(size = 192, strength = 26, seed = 7): string {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d')!
  const img = x.createImageData(size, size)
  let s = seed * 9301 + 49297
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  for (let i = 0; i < size * size; i++) {
    const v = rnd()
    const a = Math.round(Math.pow(v, 3) * strength)
    const dark = rnd() > 0.45
    img.data[i * 4] = dark ? 60 : 255
    img.data[i * 4 + 1] = dark ? 40 : 250
    img.data[i * 4 + 2] = dark ? 20 : 235
    img.data[i * 4 + 3] = a
  }
  x.putImageData(img, 0, 0)
  // 横向纤维
  x.globalAlpha = 0.05
  x.strokeStyle = '#3c2a1a'
  for (let i = 0; i < 26; i++) {
    const y = rnd() * size
    const len = 20 + rnd() * 60
    const x0 = rnd() * size
    x.lineWidth = 0.5 + rnd()
    x.beginPath()
    x.moveTo(x0, y)
    x.quadraticCurveTo(x0 + len / 2, y + (rnd() - 0.5) * 4, x0 + len, y + (rnd() - 0.5) * 3)
    x.stroke()
  }
  return c.toDataURL('image/png')
}
