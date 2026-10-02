/**
 * WebGL layer. Displaces the illustration per pixel using the mask (R = sway, G = water, B = sky),
 * swaps the painted clouds for drifting ones, and adds water, cloud shadow and crest motion.
 *
 * Shader ported from the 田园四时 demo. Resolutions come from the art board (1536×1024), so the
 * shader works in art space and the canvas is scaled by CSS.
 */

export const VERTEX_SOURCE = `
attribute vec2 p;
varying vec2 uv;
void main(){ uv = vec2(p.x, -p.y) * .5 + .5; gl_Position = vec4(p, 0., 1.); }`

export const FRAGMENT_SOURCE = `
precision highp float;
varying vec2 uv;
uniform sampler2D base, mask, cloud, plate, cel;
uniform float coff, skyOn;
uniform vec3 sunS, moonS;
uniform float t, wind, rain, day, shade, ice, lull, foliage, snowy;
const float SKYH = 448., GAP = 640.;
const vec2 RES = vec2(1536., 1024.);
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return .55*n(p) + .3*n(p*2.03+7.1) + .15*n(p*4.01+3.7); }
float gustAt(float x, float tt){ return (.5 + .5 * (.6 * sin(x * .0045 - tt * 1.1) + .4 * sin(x * .011 - tt * 1.7 + 1.3))) * lull; }
void main(){
  vec2 px = uv * RES;
  vec3 m = texture2D(mask, uv).rgb;
  vec2 d = vec2(0.);
  float bend = gustAt(1330., t - .35) * 4.5 + sin(t * 1.7) * .6 * (.3 + lull);
  float leaf = (n(px * .06 + t * 2.2) - .5) * 2.4 * foliage * (.4 + .6 * lull);
  float isTree = clamp(smoothstep(.75, .95, m.r) + step(px.y, 640.) * step(1100., px.x), 0., 1.);
  float grass = gustAt(px.x, t) * 2.2 * (1. - .85 * snowy);
  float r = m.r * wind;
  d.x -= r * mix(grass, bend * mix(.55, 1., foliage) + leaf, isTree);
  d.y -= r * leaf * .35 * isTree;
  float w = m.g * (1. - ice * .92);
  float hx = 0., hy = 0., crest = 0.;
  if (w > .002) {
    float depth = clamp((px.y - 640.) / 384., 0., 1.);
    vec2 wp = vec2(px.x * .016, px.y * .075) / mix(.55, 1., depth);
    float drift = t * .32;
    float ruffle = .55 + .7 * gustAt(px.x, t);
    #define WAVE(p) (fbm((p) + vec2(-drift, t * .12)) + .55 * n((p) * 2.4 + vec2(-t * .85, t * .3)))
    float h0 = WAVE(wp);
    hx = WAVE(wp + vec2(.12, 0.)) - h0;
    hy = WAVE(wp + vec2(0., .12)) - h0;
    crest = n(wp * vec2(3.1, 2.2) + vec2(-t * .7, t * .25));
    float amp = w * ruffle * mix(.6, 1., depth);
    d.x += amp * (hx * 11. + rain * (n(px * .25 + t * 9.) - .5) * 5.);
    d.y += amp * hy * 4.5;
    hx *= amp; hy *= amp; crest = smoothstep(.78, .92, crest) * amp;
  }
  vec2 st = clamp((px + d) / RES, vec2(.5) / RES, 1. - vec2(.5) / RES);
  vec3 col = texture2D(base, st).rgb;
  float cross = clamp(abs(texture2D(mask, st).g - m.g) * 4. - .2, 0., 1.);
  col = mix(col, texture2D(base, uv).rgb, cross);
  if (px.y < SKYH && m.b > .002) {
    vec2 su = vec2(uv.x, px.y / SKYH);
    vec3 sky = texture2D(base, uv).rgb;
    if (skyOn > .5) { vec4 pl = texture2D(plate, su); sky = mix(sky, pl.rgb, pl.a); }
    vec4 ce = texture2D(cel, su);
    sky = mix(sky, ce.rgb, ce.a);
    if (skyOn > .5) {
      vec2 wob = (vec2(fbm(px * .005 + vec2(t * .03, 0.)), fbm(px * .005 + vec2(3.1, t * .025))) - .5) * 10.;
      float cx = mod(px.x - coff + wob.x, RES.x + GAP);
      float edge = smoothstep(0., 160., cx) * smoothstep(RES.x, RES.x - 160., cx);
      vec4 c1 = texture2D(cloud, vec2(min(cx, RES.x - 1.) / RES.x, clamp((px.y + wob.y) / SKYH, 0., 1.)));
      sky = mix(sky, c1.rgb, c1.a * edge);
    }
    col = mix(col, sky, m.b);
  }
  float wv = smoothstep(0., .3, m.g) * (1. - ice * .6);
  if (wv > .002) {
    bool pond = px.y > 755.;
    float k = pond ? 1.37 : 3.5;
    float ry = 368. - (px.y - (pond ? 770. : 645.)) * k + hy * 220.;
    float rx = px.x + hx * 320.;
    if (skyOn > .5 && ry > 0. && ry < SKYH) {
      float cx = mod(rx - coff, RES.x + GAP);
      float edge = smoothstep(0., 160., cx) * smoothstep(RES.x, RES.x - 160., cx);
      vec4 c1 = texture2D(cloud, vec2(min(cx, RES.x - 1.) / RES.x, ry / SKYH));
      col = mix(col, c1.rgb * .9, c1.a * edge * .32 * wv * (1. - rain * .6));
      vec4 ce = texture2D(cel, vec2(rx / RES.x, ry / SKYH));
      col += ce.rgb * ce.a * .5 * wv * (1. - rain * .7);
    }
    float sp = n(vec2(px.x * .09, px.y * .32) + vec2(-t * 1.4, t * .5));
    float glit = .18 + 2.6 * pow(sp, 5.);
    float dxs = rx - sunS.x, dys = ry - sunS.y;
    col += vec3(1., .9, .72) * exp(-dxs * dxs / 1800. - dys * dys / 14000.) * glit * sunS.z * wv;
    float dxm = rx - moonS.x, dym = ry - moonS.y;
    col += vec3(.85, .9, 1.) * exp(-dxm * dxm / 900. - dym * dym / 9000.) * glit * moonS.z * wv;
  }
  col *= 1. + (hy * 1.3 - hx * .35) * (1. - rain * .5);
  col += vec3(1., .98, .93) * crest * .09 * mix(.25, 1., day) * (1. - rain);
  float sh = smoothstep(.52, .78, fbm(px * vec2(.0018, .004) + vec2(-t * .018, t * .004)));
  col *= 1. - sh * shade * (1. - m.b) * smoothstep(300., 420., px.y);
  gl_FragColor = vec4(col, 1.);
}`

export const ART_WIDTH = 1536
export const ART_HEIGHT = 1024

export type GlFrame = {
  /** Seconds since the scene started; the shader animates on its own from this. */
  time: number
  wind: number
  rain: number
  day: number
  ice: number
  /** Lull factor from windLull(), reused by the shader's gust envelope. */
  lull: number
  foliage: number
  snowy: number
  cloudOffset: number
  shade: number
  skyReady: boolean
  /** Sky position (art space) and reflection strength of the sun and the moon. */
  sun: { x: number; y: number; strength: number }
  moon: { x: number; y: number; strength: number }
}

export type GlTextures = {
  base: HTMLCanvasElement
  cloud: HTMLCanvasElement
  plate: HTMLCanvasElement
  celestial: HTMLCanvasElement
  /** Must have decoded before the first frame can run. */
  mask: HTMLImageElement
}

export type GlLayer = {
  readonly domElement: HTMLCanvasElement
  /** False once an upload threw (typically a tainted image); the scene stays on the still layers. */
  readonly ok: boolean
  /** The board is a fixed art space; the main canvas scales it with the cover-fit transform. */
  resize(): void
  /**
   * Upload only what changed; the caller passes the same keys for unchanged layers. Returns false
   * when this frame cannot be drawn live (mask still decoding, or the upload failed).
   */
  upload(textures: GlTextures, keys: { base: string; sky: string; celestial: string }): boolean
  draw(values: GlFrame): void
  dispose(): void
}

const compile = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const makeTexture = (gl: WebGLRenderingContext): WebGLTexture | null => {
  const texture = gl.createTexture()
  if (!texture) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

/** Build the WebGL layer, or return null when the browser cannot provide one. */
export function createGlLayer(): GlLayer | null {
  const domElement = document.createElement('canvas')
  const gl = domElement.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false })
  if (!gl) return null
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const names = ['base', 'mask', 'cloud', 'plate', 'cel'] as const
  const textures: Record<(typeof names)[number], WebGLTexture | null> = {
    base: null, mask: null, cloud: null, plate: null, cel: null,
  }
  names.forEach((name, unit) => {
    textures[name] = makeTexture(gl)
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, textures[name])
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
  })
  const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
  const u = {
    t: uniform('t'), wind: uniform('wind'), rain: uniform('rain'), day: uniform('day'),
    shade: uniform('shade'), ice: uniform('ice'), lull: uniform('lull'), foliage: uniform('foliage'),
    snowy: uniform('snowy'), coff: uniform('coff'), skyOn: uniform('skyOn'),
    sunS: uniform('sunS'), moonS: uniform('moonS'),
  }

  const put = (unit: number, target: WebGLTexture | null, image: TexImageSource): void => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  const uploaded = { base: '', sky: '', celestial: '' }
  let maskUploaded = false
  let dead = false
  const layer: GlLayer = {
    domElement,
    get ok() {
      return !dead
    },
    resize() {
      domElement.width = ART_WIDTH
      domElement.height = ART_HEIGHT
      gl.viewport(0, 0, ART_WIDTH, ART_HEIGHT)
    },
    upload(next, keys) {
      if (dead) return false
      try {
        if (!maskUploaded) {
          if (!(next.mask.complete && next.mask.naturalWidth > 0)) return false
          put(1, textures.mask, next.mask)
          maskUploaded = true
        }
        if (keys.base !== uploaded.base) {
          put(0, textures.base, next.base)
          uploaded.base = keys.base
        }
        if (keys.sky && keys.sky !== uploaded.sky) {
          put(2, textures.cloud, next.cloud)
          put(3, textures.plate, next.plate)
          uploaded.sky = keys.sky
        }
        if (keys.celestial !== uploaded.celestial) {
          put(4, textures.cel, next.celestial)
          uploaded.celestial = keys.celestial
        }
        return true
      } catch {
        // A cross-origin or file:// image taints the upload; stay on the still illustration from here on.
        dead = true
        return false
      }
    },
    draw(values) {
      gl.uniform1f(u.t, values.time)
      gl.uniform1f(u.wind, values.wind)
      gl.uniform1f(u.rain, values.rain)
      gl.uniform1f(u.lull, values.lull)
      gl.uniform1f(u.foliage, values.foliage)
      gl.uniform1f(u.snowy, values.snowy)
      gl.uniform1f(u.day, values.day)
      gl.uniform1f(u.ice, values.ice)
      gl.uniform1f(u.shade, values.shade)
      gl.uniform1f(u.coff, values.cloudOffset)
      gl.uniform1f(u.skyOn, values.skyReady && !!uploaded.sky ? 1 : 0)
      gl.uniform3f(u.sunS, values.sun.x, values.sun.y, values.sun.strength)
      gl.uniform3f(u.moonS, values.moon.x, values.moon.y, values.moon.strength)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    dispose() {
      dead = true
      for (const name of names) gl.deleteTexture(textures[name])
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
  return layer
}
