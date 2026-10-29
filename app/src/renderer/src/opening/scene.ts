/**
 * 开场动画「墨落成阵，汤成一滴」的实时渲染。
 * 一滴墨落在纸上晕开成法阵；四角卫星法阵里的药材化作光点飞入阵心；
 * 药汤熬成金色，跃起一滴，落下时揭开书斋。全程不出现文字。
 * 所有画面都是时间 t 的确定函数：任何帧率下结果一致，也方便跳过。
 */
import { FULLSCREEN_VERT, PAPER_FRAG } from '../theme/paper'
import type { PaperParams } from '../theme/types'
import { buildCircle, drawStroke, type CircleSpec } from './circle'
import { SAT_R } from './periphery'

export const T_EXIT = 4.85
export const EXIT_DUR = 0.78
const SKIP_DUR = 0.42
/** 药材光点：起飞时间与飞行时长 */
export const MOTE_T0 = 3.0
export const MOTE_GAP = 0.22
export const MOTE_FLY = 0.45
/** 金滴：跃起与落下 */
export const DROP_UP = 4.35
export const DROP_HIT = 4.85

const NOISE = `
float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.62,1.18,-1.18,1.62); for(int i=0;i<5;i++){ v+=a*vn(p); p=m*p+3.1; a*=.5; } return v; }
float ease(float x){ x = clamp(x,0.,1.); return 1. - (1.-x)*(1.-x)*(1.-x); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
`

const DOWN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy * 4.0 * uTexel;
  float a = 0.;
  for (int y=-1;y<=2;y++) for (int x=-1;x<=2;x++) a += texture(uSrc, uv + vec2(float(x),float(y))*uTexel).a;
  o = vec4(0,0,0,a/16.);
}`

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uDir; uniform vec2 uRes; out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float w[7] = float[](0.1964, 0.1748, 0.1232, 0.0688, 0.0304, 0.0106, 0.0029);
  float a = texture(uSrc, uv).a * w[0];
  for (int i=1;i<7;i++){ vec2 d = uDir*float(i)/uRes; a += (texture(uSrc, uv+d).a + texture(uSrc, uv-d).a) * w[i]; }
  o = vec4(0,0,0,a*1.15);
}`

const MAIN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uPaper, uLines, uGlow;
uniform vec2 uRes, uCenter, uShake;
uniform float uR, uT, uZoom, uExit;
uniform vec3 uInk, uGold, uGlowC, uTeal, uAmber;
out vec4 o;
${NOISE}
const float MOTE_T0 = ${MOTE_T0.toFixed(3)};
const float MOTE_GAP = ${MOTE_GAP.toFixed(3)};
const float MOTE_FLY = ${MOTE_FLY.toFixed(3)};
const float DROP_UP = ${DROP_UP.toFixed(3)};
const float DROP_HIT = ${DROP_HIT.toFixed(3)};
void main(){
  vec2 frag = gl_FragCoord.xy + uShake;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uCenter;
  vec2 fz = c + (frag - c) / uZoom;
  vec2 uvz = fz / uRes;
  vec2 p = (fz - c) / uR;
  float r = length(p);
  float ang = atan(p.x, p.y);
  float angN = fract(ang / 6.2831853 + 1.0);
  float t = uT;

  // 退场：已被揭开的区域直接透明，省掉其余计算
  float wipeD = 1e3;
  if (uExit > 0.0) {
    float e0 = ease(uExit);
    float maxR0 = length(uRes) / uR * 0.62 + 0.3;
    float wr0 = e0 * (maxR0 + 0.5) - 0.1;
    wipeD = r - wr0 + (vn(vec2(ang*3.5, t*1.5) + 2.0) - 0.5) * 0.3;
    if (wipeD < -0.2) { o = vec4(0.0); return; }
  }

  vec3 paper = texture(uPaper, clamp(uvz, 0.001, 0.999)).rgb;

  // 烛光：从黑暗里亮起
  float tl = ease(t / 0.75);
  float flick = 0.965 + 0.035 * sin(t*21.0 + sin(t*6.3)*2.3);
  vec2 lq = (fz - c) / uRes.y;
  float candle = exp(-dot(lq,lq)*2.4);
  float ign = ease((t - 2.62) / 0.9);
  float lit = tl * (0.36 + 0.7*candle*flick) + ign*0.16 + ease((t - 3.9)/0.9)*0.1;
  lit = min(lit, 1.06);
  vec3 col = paper * lit;
  col = mix(col, col*vec3(1.08,0.9,0.68), (1.0 - clamp(lit,0.,1.))*0.55);

  // 墨滴下落
  if (t > 0.42 && t < 0.99) {
    float tf = clamp((t - 0.42) / 0.55, 0., 1.);
    float y = mix(2.1, 0.0, tf*tf);
    vec2 d = p - vec2(0.0, y);
    float st = 1.0 + tf*tf*4.5;
    float dd = length(vec2(d.x, d.y / (d.y > 0. ? st : 1.3)));
    float drop = 1.0 - smoothstep(0.011, 0.019, dd);
    col = mix(col, uInk, drop*0.96);
  }

  // 药材落入的次数（0..4，平滑）
  float brew = 0.0;
  for (int i = 0; i < 4; i++) {
    float arr = MOTE_T0 + float(i)*MOTE_GAP + MOTE_FLY;
    brew += smoothstep(arr, arr + 0.28, t);
  }
  brew *= 0.25;

  // 墨池 → 药汤（只在阵心附近计算）
  float th = t - 0.97;
  if (th > 0.0 && r < 0.62) {
    float grow = ease(th / 0.8);
    float rad = 0.29*grow + 0.015;
    float n1 = fbm(p*6.5 + 3.1) - 0.5;
    float n2 = fbm(vec2(ang*2.2, r*18.0) + 9.0) - 0.5;
    float edge = rad * (1.0 + n1*0.42*(1.0 - grow*0.55) + n2*0.14);
    float pool = 1.0 - smoothstep(edge*0.9, edge, r);
    float tendril = smoothstep(0.58, 0.92, fbm(vec2(ang*7.0, r*2.6) + 7.0)) * (1.0 - smoothstep(edge, edge*1.45, r)) * grow;
    pool = max(pool, tendril*0.55);
    float rr = th*1.55;
    col *= 1.0 - exp(-pow((r - rr)*26.0, 2.0)) * (1.0 - smoothstep(0.0, 0.55, th)) * 0.22;
    if (pool > 0.001) {
      vec3 inkC = uInk * (0.8 + 0.4*fbm(p*12.0 + t*0.15));
      float pt = ease((t - 2.68) / 0.65);
      vec3 potion = inkC;
      if (pt > 0.0) {
        float sw = (t - 2.68) * (1.9 + brew*2.2);
        vec2 q = rot(sw * (1.4 - r*3.0)) * p;
        float f = fbm(q*5.5 + vec2(sw*0.25, -sw*0.1));
        float g = fbm(q*9.0 - sw*0.3 + f*1.7);
        vec3 teal = mix(uTeal*0.45, uTeal*1.25, f);
        teal = mix(teal, uAmber, smoothstep(0.5, 0.82, g));
        // 熬成：熔金
        vec3 gold = mix(uAmber*0.72, uGlowC*0.92, f);
        gold *= 0.82 + 0.3*g;
        gold = mix(gold, vec3(1.0, 0.95, 0.82), smoothstep(0.74, 0.93, g)*0.7);
        vec3 c1 = mix(teal, gold, smoothstep(0.0, 1.0, brew));
        c1 += uGlowC * smoothstep(0.74, 0.93, g) * (0.8 - brew*0.5);
        // 药材落入的涟漪
        for (int i = 0; i < 4; i++) {
          float tt = t - (MOTE_T0 + float(i)*MOTE_GAP + MOTE_FLY);
          if (tt > 0.0 && tt < 0.9) {
            float rr2 = 0.02 + tt*0.36;
            c1 += uGlowC * exp(-pow((r - rr2)*24.0, 2.0)) * (1.0 - tt/0.9) * (1.0 - tt/0.9) * 0.5;
          }
        }
        c1 *= 0.72 + 0.42*exp(-r*r*20.0) + brew*0.06;
        potion = mix(inkC, c1, pt);
      }
      col = mix(col, potion, pool);
    }
  } else if (th > 0.0 && th < 0.55) {
    float rr = th*1.55;
    col *= 1.0 - exp(-pow((r - rr)*26.0, 2.0)) * (1.0 - smoothstep(0.0, 0.55, th)) * 0.22;
  }
  col += uGlowC * brew * exp(-r*r*9.0) * 0.13 * (0.9 + 0.1*sin(t*6.0));

  // 线条 + 点亮
  vec4 L = texture(uLines, uvz);
  float G = texture(uGlow, uvz).a;
  float front = (t - 2.6) / 0.72;
  float delay = (1.0 - min(r, 1.0)) * 0.28 + max(0.0, r - 1.0) * 0.12;
  float fx = front - angN*0.82 - delay;
  float ig = smoothstep(0.0, 0.07, fx);
  float igFlash = exp(-fx*fx*90.0) * step(0.0, front);
  if (G > 0.002 && ig < 0.999) {
    float seep = G * 0.3 * (0.55 + 0.9*fbm(fz*0.045));
    col = mix(col, uInk, clamp(seep, 0., 1.) * (1.0 - ig) * smoothstep(1.0, 1.15, t));
  }
  vec3 lineC = mix(uInk, mix(uGold, uGlowC, 0.35), ig * L.g);
  col = mix(col, lineC, L.a);
  float pulse = 0.82 + 0.18*sin(t*3.2);
  col += uGlowC * G * (ig*0.95*pulse + igFlash*0.9);
  col += uGlowC * L.a * igFlash * 0.5;

  // 金滴：从药汤里跃起，落下
  if (t > DROP_UP - 0.05 && t < DROP_HIT + 0.02) {
    float s = clamp((t - DROP_UP) / (DROP_HIT - DROP_UP), 0.0, 1.0);
    float y = 4.0 * 0.55 * s * (1.0 - s);
    float vy = 0.55 * 4.0 * (1.0 - 2.0*s);
    vec2 d = p - vec2(0.0, y);
    float st = 1.0 + abs(vy)*0.35;
    float dd = length(vec2(d.x*st*0.9, d.y / st));
    // 药汤面上的影子：金滴越高越淡、越大
    float sh = 1.0 - smoothstep(0.0, 0.035 + y*0.06, length(p*vec2(1.0, 1.7)));
    col = mix(col, col*0.62, sh * 0.5 * (1.0 - y*1.2));
    float core = 1.0 - smoothstep(0.026, 0.036, dd);
    float rim = (1.0 - smoothstep(0.036, 0.048, dd)) - core;
    col = mix(col, uInk*0.55, rim*0.45);
    col = mix(col, vec3(1.0, 0.9, 0.62), core);
    col += vec3(1.0, 0.98, 0.9) * exp(-pow(length(d - vec2(-0.007, 0.009))*90.0, 2.0)) * 0.6 * core;
    col += uGlowC * exp(-dd*dd*120.0) * 0.18;
  }
  // 落下的一瞬：闪光与溅起的光环
  float hit = t - DROP_HIT;
  if (hit > -0.02) {
    col += uGlowC * exp(-r*r*6.0) * exp(-max(hit, 0.0)*7.0) * 0.9;
    float rr3 = max(hit, 0.0) * 2.6;
    col += uGlowC * exp(-pow((r - rr3)*16.0, 2.0)) * exp(-max(hit, 0.0)*3.0) * 0.8;
  }

  // 暗角
  vec2 vq = uv*2.0 - 1.0;
  col *= 1.0 - smoothstep(0.62, 1.55, length(vq*vec2(0.88, 1.0)))*0.32;

  // 退场：光环从阵心扩散，揭开下面的书斋
  float a = 1.0;
  if (uExit > 0.0) {
    float e = ease(uExit);
    float d = wipeD;
    a = smoothstep(-0.16, 0.0, d);
    float rim = exp(-d*d*70.0) * (1.0 - e*0.6);
    col += uGlowC * rim * 1.1;
    a = max(a, rim*0.8);
  }
  o = vec4(col * a, a);
}`

const PART_VERT = `#version 300 es
precision highp float;
in float aId;
uniform float uT, uR, uDpr, uExit, uZoom;
uniform vec2 uRes, uCenter;
uniform vec2 uSat[4];
out float vA; out vec3 vC; out float vK;
const float MOTE_T0 = ${MOTE_T0.toFixed(3)};
const float MOTE_GAP = ${MOTE_GAP.toFixed(3)};
const float MOTE_FLY = ${MOTE_FLY.toFixed(3)};
float h(float n){ return fract(sin(n*12.9898)*43758.5453); }
vec2 bez(vec2 a, vec2 b, vec2 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }
void main(){
  float id = aId;
  float r1 = h(id*1.17+0.3), r2 = h(id*2.31+1.7), r3 = h(id*3.77+2.9), r4 = h(id*5.03+4.1);
  vec2 pos = vec2(0.0); float size = 0.0; float a = 0.0; vec3 col = vec3(1.0); float kind = 0.0;
  if (id < 160.0) {
    // 浮尘
    vec2 base = vec2(r1, r2) * uRes;
    pos = base + vec2(sin(uT*0.4 + r3*6.28)*30.0, uT*(8.0 + r4*14.0)) * uDpr;
    pos = mod(pos, uRes);
    size = (1.5 + r3*2.5) * uDpr;
    float lt = clamp(uT/0.8, 0.0, 1.0);
    vec2 lq = (pos - uCenter)/uRes.y;
    a = lt * (0.18 + 0.3*exp(-dot(lq,lq)*3.0)) * (0.5 + 0.5*sin(uT*2.0 + r1*20.0));
    col = vec3(1.0, 0.92, 0.74);
  } else if (id < 480.0) {
    // 蒸汽
    float s0 = 3.0 + r1*1.7;
    float life = 1.3 + r2*0.6;
    float k = (uT - s0) / life;
    if (k > 0.0 && k < 1.0) {
      float x = (r3 - 0.5) * 0.36 + sin(k*5.0 + r4*6.28)*0.07*k;
      float y = 0.05 + k*(0.75 + r4*0.4);
      pos = uCenter + vec2(x, y) * uR;
      size = (16.0 + k*60.0*(0.6+r2)) * uDpr;
      a = sin(k*3.14159) * 0.055;
      col = mix(vec3(1.0, 0.94, 0.8), vec3(1.0, 0.9, 0.66), clamp((uT - 4.0)/0.6, 0.0, 1.0));
      kind = 1.0;
    }
  } else if (id < 860.0) {
    // 火星
    float s0 = 2.72 + r1*2.1;
    float life = 0.6 + r2*0.8;
    float k = (uT - s0) / life;
    if (k > 0.0 && k < 1.0) {
      float an = r3 * 6.2831853;
      vec2 start = vec2(sin(an), cos(an)) * (0.2 + r4*0.12);
      vec2 vel = vec2(sin(an)*0.25 + (r2-0.5)*0.3, 0.6 + r1*0.7);
      vec2 q = start + vel*k + vec2(sin(k*9.0 + r4*20.0)*0.02, -0.2*k*k);
      pos = uCenter + q * uR;
      size = (2.0 + r4*3.0) * uDpr;
      a = (1.0 - k) * (0.55 + 0.45*sin(uT*40.0 + r1*30.0));
      col = vec3(1.0, 0.82, 0.45);
      kind = 2.0;
    }
  } else {
    // 药材光点：从卫星法阵飞入阵心，带一条光尾
    float j = id - 860.0;
    int m = int(floor(j / 60.0));
    float k = mod(j, 60.0);
    float t0 = MOTE_T0 + float(m)*MOTE_GAP;
    float ht = uT - k*0.0042;
    float pr = (ht - t0) / MOTE_FLY;
    if (pr > 0.0 && pr < 1.0 && uT < t0 + MOTE_FLY + 0.3) {
      vec2 s = uSat[m];
      vec2 perp = normalize(vec2(-s.y, s.x));
      vec2 ctrl = s*0.45 + perp*0.55*(m % 2 == 0 ? 1.0 : -1.0);
      float e = pr*pr*(3.0 - 2.0*pr);
      vec2 q = bez(s, ctrl, vec2(0.0), e);
      pos = uCenter + q * uR;
      size = (k < 0.5 ? 13.0 : 8.0 - k*0.1) * uDpr;
      a = pow(1.0 - k/60.0, 1.5) * (k < 0.5 ? 1.0 : 0.42) * smoothstep(0.0, 0.08, pr);
      col = vec3(1.0, 0.9, 0.62);
      kind = 2.0;
    }
  }
  a *= 1.0 - uExit;
  pos = uCenter + (pos - uCenter) * uZoom;
  vec2 clip = pos / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = a > 0.001 ? size : 0.0;
  vA = a; vC = col; vK = kind;
}`

const PART_FRAG = `#version 300 es
precision highp float;
in float vA; in vec3 vC; in float vK; out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d)*2.0;
  float s = vK > 0.5 && vK < 1.5 ? exp(-r*r*3.0) : (1.0 - smoothstep(0.3, 1.0, r));
  float a = vA * s;
  o = vec4(vC * a, vK > 1.5 ? a*0.2 : a*0.7);
}`

const PARTICLES = 860 + 4 * 60

type GL = WebGL2RenderingContext

function compile(gl: GL, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error')
  return s
}

function program(gl: GL, vs: string, fs: string) {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error')
  const uni = new Map<string, WebGLUniformLocation | null>()
  return {
    p,
    u(name: string) {
      if (!uni.has(name)) uni.set(name, gl.getUniformLocation(p, name))
      return uni.get(name)!
    }
  }
}

function makeTex(gl: GL, w: number, h: number, filter: number = gl.LINEAR) {
  const t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

function makeFbo(gl: GL, tex: WebGLTexture) {
  const f = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, f)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return f
}

const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return 1 - (1 - c) * (1 - c) * (1 - c)
}

export interface SceneColors {
  ink: [number, number, number]
  gold: [number, number, number]
  glow: [number, number, number]
  rubric: [number, number, number]
}

export class OpeningScene {
  private gl: GL
  private W = 0
  private H = 0
  private dpr = 1
  private cx = 0
  private cy = 0 // 画布坐标（y 向下）
  private R = 0
  private lines: HTMLCanvasElement
  private lctx: CanvasRenderingContext2D
  private spec!: CircleSpec
  private progs!: Record<'paper' | 'down' | 'blur' | 'main' | 'part', ReturnType<typeof program>>
  private tex!: Record<'paper' | 'lines' | 'g1' | 'g2', WebGLTexture>
  private fbo!: Record<'paper' | 'g1' | 'g2', WebGLFramebuffer>
  private vao!: WebGLVertexArrayObject
  private pvao!: WebGLVertexArrayObject
  private splash: { a: number; d: number; s: number; delay: number }[] = []
  private satGL = new Float32Array(8)
  exitStart = T_EXIT
  exitDur = EXIT_DUR

  constructor(
    private canvas: HTMLCanvasElement,
    private paper: PaperParams,
    private colors: SceneColors
  ) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('WebGL2 不可用')
    this.gl = gl
    this.lines = document.createElement('canvas')
    this.lctx = this.lines.getContext('2d')!
    for (let i = 0; i < 22; i++) this.splash.push({ a: Math.random() * Math.PI * 2, d: 0.08 + Math.random() * 0.28, s: 0.004 + Math.random() * 0.01, delay: Math.random() * 0.05 })
    this.init()
    this.resize()
  }

  private init() {
    const gl = this.gl
    this.progs = {
      paper: program(gl, FULLSCREEN_VERT, PAPER_FRAG),
      down: program(gl, FULLSCREEN_VERT, DOWN_FRAG),
      blur: program(gl, FULLSCREEN_VERT, BLUR_FRAG),
      main: program(gl, FULLSCREEN_VERT, MAIN_FRAG),
      part: program(gl, PART_VERT, PART_FRAG)
    }
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    for (const k of ['paper', 'down', 'blur', 'main'] as const) {
      const loc = gl.getAttribLocation(this.progs[k].p, 'p')
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      }
    }
    this.pvao = gl.createVertexArray()!
    gl.bindVertexArray(this.pvao)
    const ids = new Float32Array(PARTICLES)
    for (let i = 0; i < ids.length; i++) ids[i] = i
    const pb = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, pb)
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW)
    const ploc = gl.getAttribLocation(this.progs.part.p, 'aId')
    gl.enableVertexAttribArray(ploc)
    gl.vertexAttribPointer(ploc, 1, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  resize() {
    const gl = this.gl
    this.dpr = window.devicePixelRatio || 1
    this.W = Math.round(window.innerWidth * this.dpr)
    this.H = Math.round(window.innerHeight * this.dpr)
    this.canvas.width = this.W
    this.canvas.height = this.H
    this.lines.width = this.W
    this.lines.height = this.H
    this.cx = this.W / 2
    this.cy = this.H * 0.48
    this.R = Math.min(this.W * 0.3, this.H * 0.315)
    // 四角卫星法阵的位置随窗口比例调整，尽量填满空白又不出界
    const hx = this.W / 2 / this.R
    const hy = Math.min(this.cy, this.H - this.cy) / this.R
    const layout = { sx: Math.max(1.2, Math.min(2.05, hx - 0.48)), sy: Math.max(0.55, Math.min(0.95, hy - 0.42)) }
    this.spec = buildCircle(11, layout)
    // 药材光点按顺时针顺序起飞：右上 → 右下 → 左下 → 左上（与卫星小阵画出的顺序一致）
    ;[1, 3, 2, 0].forEach((si, k) => {
      const [x, y] = this.spec.satellites[si]
      this.satGL[k * 2] = x
      this.satGL[k * 2 + 1] = -y
    })
    this.setupCaches()
    const qw = Math.max(1, Math.ceil(this.W / 4))
    const qh = Math.max(1, Math.ceil(this.H / 4))
    if (this.tex) for (const t of Object.values(this.tex)) gl.deleteTexture(t)
    if (this.fbo) for (const f of Object.values(this.fbo)) gl.deleteFramebuffer(f)
    this.tex = {
      paper: makeTex(gl, this.W, this.H),
      lines: makeTex(gl, this.W, this.H),
      g1: makeTex(gl, qw, qh),
      g2: makeTex(gl, qw, qh)
    }
    this.fbo = { paper: makeFbo(gl, this.tex.paper), g1: makeFbo(gl, this.tex.g1), g2: makeFbo(gl, this.tex.g2) }
    this.renderPaper()
    // 预热：提前让各缓存画布与纹理上传分配好显存，避免第一次用到时卡一帧
    for (const c of this.caches) {
      c.x.fillRect(0, 0, 1, 1)
      c.x.clearRect(0, 0, 2, 2)
      this.lctx.drawImage(c.cv, 0, 0)
    }
    this.lctx.clearRect(0, 0, this.W, this.H)
    this.upload(this.tex.lines, this.lines)
    gl.bindVertexArray(this.vao)
    this.blurGlow()
  }

  private renderPaper() {
    const gl = this.gl
    const P = this.progs.paper
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.paper)
    gl.viewport(0, 0, this.W, this.H)
    gl.useProgram(P.p)
    gl.bindVertexArray(this.vao)
    const p = this.paper
    const c3 = (v: number[]) => v.map((x) => x / 255) as [number, number, number]
    gl.uniform2f(P.u('uRes'), this.W, this.H)
    gl.uniform1f(P.u('uDpr'), this.dpr)
    gl.uniform1f(P.u('uSeed'), p.seed + 1.3)
    gl.uniform3f(P.u('uBase'), ...c3(p.base))
    gl.uniform3f(P.u('uLight'), ...c3(p.light))
    gl.uniform3f(P.u('uDark'), ...c3(p.dark))
    gl.uniform3f(P.u('uBurn'), ...c3(p.burn))
    gl.uniform1f(P.u('uMottle'), p.mottle)
    gl.uniform1f(P.u('uFiber'), p.fiber)
    gl.uniform1f(P.u('uGrain'), p.grain)
    gl.uniform1f(P.u('uEdge'), p.edge * 0.6)
    gl.uniform1f(P.u('uFoxing'), 4)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private upload(tex: WebGLTexture, src: HTMLCanvasElement) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  }

  private groupAngle(g: number, t: number, e: number) {
    if (g === 0) return 0.055 * Math.max(0, t - 1.6) + e * e * 0.9
    if (g === 1) return -0.035 * Math.max(0, t - 1.9) - e * e * 1.3
    if (g === 2) return 0.1 * Math.max(0, t - 2.2) + e * e * 1.8
    return 0
  }

  /**
   * 缓存：写完的笔画只画一次。
   * 0..2 = 三组旋转的环（以阵心为原点、不带旋转地存放），3 = 四周静止部分，
   * 4..7 = 四个卫星法阵的自转外环（以卫星中心为原点的小画布）。
   */
  private caches: { cv: HTMLCanvasElement; x: CanvasRenderingContext2D; ox: number; oy: number }[] = []
  private cached = new Uint8Array(0)
  private strokeSlot = new Int8Array(0)
  private lastT = 0

  private resetCaches() {
    for (const c of this.caches) {
      c.x.setTransform(1, 0, 0, 1, 0, 0)
      c.x.clearRect(0, 0, c.cv.width, c.cv.height)
    }
    this.cached.fill(0)
  }

  private setupCaches() {
    const mkc = (w: number, h: number, ox: number, oy: number) => {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const x = cv.getContext('2d')!
      x.lineCap = 'round'
      x.lineJoin = 'round'
      return { cv, x, ox, oy }
    }
    this.caches = []
    for (let g = 0; g < 4; g++) this.caches.push(mkc(this.W, this.H, this.cx, this.cy))
    const S = Math.ceil(SAT_R * this.R * 2.3 + 16 * this.dpr)
    for (let i = 0; i < 4; i++) this.caches.push(mkc(S, S, S / 2, S / 2))
    const strokes = this.spec.strokes
    this.cached = new Uint8Array(strokes.length)
    this.strokeSlot = new Int8Array(strokes.length)
    strokes.forEach((s, i) => {
      if (s.pivot && s.spin) {
        let best = 0
        let bd = Infinity
        this.spec.satellites.forEach(([sx, sy], k) => {
          const d = Math.hypot(sx - s.pivot![0], sy - s.pivot![1])
          if (d < bd) {
            bd = d
            best = k
          }
        })
        this.strokeSlot[i] = 4 + best
      } else this.strokeSlot[i] = s.group
    })
  }

  /** 把一笔画进对应的画布（位置相对该画布的原点） */
  private strokeInto(slot: number, s: (typeof this.spec.strokes)[number], p: number, x: CanvasRenderingContext2D) {
    const R = this.R
    x.lineWidth = s.width * this.dpr
    x.strokeStyle = `rgba(${this.colors.ink[0]},255,${this.colors.ink[2]},${s.alpha})`
    if (slot >= 4) {
      const [px, py] = this.spec.satellites[slot - 4]
      x.save()
      x.translate(-px * R, -py * R)
      const h = drawStroke(x, s, p, R)
      x.restore()
      return h ? ([h[0] - px * R, h[1] - py * R] as [number, number]) : null
    }
    return drawStroke(x, s, p, R)
  }

  private drawLines(t: number, e: number) {
    const x = this.lctx
    const [ir, , ib] = this.colors.ink
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, this.W, this.H)
    if (t < 0.96) return
    const strokes = this.spec.strokes
    // 1) 新写完的笔画画进缓存
    for (let i = 0; i < strokes.length; i++) {
      if (this.cached[i] || t < strokes[i].t1) continue
      const c = this.caches[this.strokeSlot[i]]
      c.x.setTransform(1, 0, 0, 1, c.ox, c.oy)
      this.strokeInto(this.strokeSlot[i], strokes[i], 1, c.x)
      this.cached[i] = 1
    }
    // 2) 合成：退场时整体放大
    const k = 1 + e * e * 0.45
    x.translate(this.cx, this.cy)
    x.scale(k, k)
    x.lineCap = 'round'
    x.lineJoin = 'round'
    x.globalAlpha = 1 - e * 0.3
    // 溅出的墨珠（G 通道 = 0：不会被点亮成金色）
    const th = t - 0.97
    for (const s of this.splash) {
      const kk = ease((th - s.delay) / 0.22)
      if (kk <= 0) continue
      const d = s.d * kk * this.R
      x.fillStyle = `rgba(${ir},0,${ib},${0.9 * (1 - Math.min(1, Math.max(0, th - 1.4) / 1.2))})`
      x.beginPath()
      x.arc(Math.sin(s.a) * d, -Math.cos(s.a) * d * 0.92, s.s * this.R * (1 - kk * 0.35), 0, Math.PI * 2)
      x.fill()
    }
    const heads: [number, number][] = []
    const live = (slot: number) => {
      for (let i = 0; i < strokes.length; i++) {
        if (this.strokeSlot[i] !== slot || this.cached[i]) continue
        const p = (t - strokes[i].t0) / (strokes[i].t1 - strokes[i].t0)
        if (p <= 0) continue
        const h = this.strokeInto(slot, strokes[i], ease(p), x)
        if (h) {
          const m = x.getTransform()
          heads.push([m.a * h[0] + m.c * h[1] + m.e, m.b * h[0] + m.d * h[1] + m.f])
        }
      }
    }
    for (let slot = 0; slot < 8; slot++) {
      const c = this.caches[slot]
      x.save()
      if (slot < 3) x.rotate(this.groupAngle(slot, t, e))
      else if (slot >= 4) {
        const [px, py] = this.spec.satellites[slot - 4]
        const spin = strokes.find((s, i) => this.strokeSlot[i] === slot)?.spin ?? 0
        x.translate(px * this.R, py * this.R)
        x.rotate(spin * Math.max(0, t - 1.8))
      }
      x.drawImage(c.cv, -c.ox, -c.oy)
      live(slot)
      x.restore()
    }
    // 笔尖的墨星（坐标已是画布像素）
    if (heads.length) {
      const scale = this.dpr
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.fillStyle = `rgba(${ir},255,${ib},0.9)`
      for (const [hx, hy] of heads) {
        x.beginPath()
        x.arc(hx, hy, 2.2 * scale, 0, Math.PI * 2)
        x.fill()
        x.globalAlpha = 0.5
        for (let q = 0; q < 3; q++) {
          const a = (t * 37 + q * 2.1 + hx) % (Math.PI * 2)
          x.beginPath()
          x.arc(hx + Math.cos(a) * 6 * scale, hy + Math.sin(a) * 6 * scale, 1 * scale, 0, Math.PI * 2)
          x.fill()
        }
        x.globalAlpha = 1
      }
    }
    x.globalAlpha = 1
  }

  render(t: number) {
    const gl = this.gl
    // 时间倒退（预热、跳帧检查）时清空笔画缓存，保证法阵仍是一笔一笔写出来的
    if (t < this.lastT - 1e-6) this.resetCaches()
    this.lastT = t
    const e = t > this.exitStart ? Math.min(1, (t - this.exitStart) / this.exitDur) : 0
    // 法阵与四周完全被揭开后不再重画线条
    const maxR = Math.hypot(this.W, this.H) / this.R * 0.62 + 0.3
    const swallowed = e > 0 && ease(e) * (maxR + 0.5) - 0.1 > 2.6
    if (!swallowed) {
      this.drawLines(t, e)
      this.upload(this.tex.lines, this.lines)
    }
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.vao)
    if (!swallowed) this.blurGlow()
    this.composite(t, e)
  }

  private blurGlow() {
    const gl = this.gl
    const qw = Math.ceil(this.W / 4)
    const qh = Math.ceil(this.H / 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.g1)
    gl.viewport(0, 0, qw, qh)
    gl.useProgram(this.progs.down.p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex.lines)
    gl.uniform1i(this.progs.down.u('uSrc'), 0)
    gl.uniform2f(this.progs.down.u('uTexel'), 1 / this.W, 1 / this.H)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const B = this.progs.blur
    gl.useProgram(B.p)
    gl.uniform2f(B.u('uRes'), qw, qh)
    gl.uniform1i(B.u('uSrc'), 0)
    for (const [src, dst, dir] of [
      [this.tex.g1, this.fbo.g2, [1.6, 0]],
      [this.tex.g2, this.fbo.g1, [0, 1.6]]
    ] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst)
      gl.bindTexture(gl.TEXTURE_2D, src)
      gl.uniform2f(B.u('uDir'), dir[0], dir[1])
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  private composite(t: number, e: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.W, this.H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const M = this.progs.main
    gl.useProgram(M.p)
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(M.u(name), unit)
    }
    bind(0, this.tex.paper, 'uPaper')
    bind(1, this.tex.lines, 'uLines')
    bind(2, this.tex.g1, 'uGlow')
    const cyGL = this.H - this.cy
    // 镜头：缓慢推近；金滴落下时轻微震动
    const zoom = 1 + 0.04 * ease(t / 5) + e * 0.06
    const sk = t > DROP_HIT ? Math.exp(-(t - DROP_HIT) * 16) : 0
    gl.uniform2f(M.u('uRes'), this.W, this.H)
    gl.uniform2f(M.u('uCenter'), this.cx, cyGL)
    gl.uniform2f(M.u('uShake'), Math.sin(t * 90) * 3 * sk * this.dpr, Math.cos(t * 77) * 3 * sk * this.dpr)
    gl.uniform1f(M.u('uR'), this.R)
    gl.uniform1f(M.u('uT'), t)
    gl.uniform1f(M.u('uZoom'), zoom)
    gl.uniform1f(M.u('uExit'), e)
    const c3 = (v: number[]) => v.map((x) => x / 255) as [number, number, number]
    gl.uniform3f(M.u('uInk'), ...c3(this.colors.ink))
    gl.uniform3f(M.u('uGold'), ...c3(this.colors.gold))
    gl.uniform3f(M.u('uGlowC'), ...c3(this.colors.glow))
    gl.uniform3f(M.u('uTeal'), 0.12, 0.34, 0.32)
    gl.uniform3f(M.u('uAmber'), 0.85, 0.58, 0.22)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 粒子
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const P = this.progs.part
    gl.useProgram(P.p)
    gl.bindVertexArray(this.pvao)
    gl.uniform1f(P.u('uT'), t)
    gl.uniform1f(P.u('uR'), this.R)
    gl.uniform1f(P.u('uDpr'), this.dpr)
    gl.uniform1f(P.u('uExit'), e)
    gl.uniform1f(P.u('uZoom'), zoom)
    gl.uniform2f(P.u('uRes'), this.W, this.H)
    gl.uniform2f(P.u('uCenter'), this.cx, cyGL)
    gl.uniform2fv(P.u('uSat'), this.satGL)
    gl.drawArrays(gl.POINTS, 0, PARTICLES)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
  }

  /** 跳过：从当前时刻开始快速退场 */
  skip(t: number) {
    if (t >= this.exitStart) return
    this.exitStart = t
    this.exitDur = SKIP_DUR
  }

  done(t: number) {
    return t >= this.exitStart + this.exitDur
  }

  /** 重播前：恢复时间轴并按当前窗口重新分配画布 */
  wake() {
    this.exitStart = T_EXIT
    this.exitDur = EXIT_DUR
    this.lastT = 0
    this.resize()
  }

  /**
   * 开场结束后：只释放显存，不销毁 WebGL 上下文。
   * 主动 loseContext() 会让显卡在下一帧交出一整帧空白（表现为进入书斋后白闪一下），
   * 所以画布与上下文一直留着，重播时直接复用。
   */
  sleep() {
    const gl = this.gl
    if (this.tex) for (const t of Object.values(this.tex)) gl.deleteTexture(t)
    if (this.fbo) for (const f of Object.values(this.fbo)) gl.deleteFramebuffer(f)
    this.caches = []
    this.lines.width = this.lines.height = 1
    this.canvas.width = this.canvas.height = 1
  }
}
