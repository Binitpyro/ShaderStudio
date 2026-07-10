import type { RenderStep } from "@/core/graphCompiler"

export interface PostProcessPass { type: "blur" | "vignette" | "custom"; shaderSource?: string; uniforms: Record<string, number | number[]> }

export function buildPostProcessChain(steps: RenderStep[]): PostProcessPass[] {
  const passes: PostProcessPass[] = []
  for (const step of steps) {
    if (step.type === "postprocess") passes.push({ type: "vignette", uniforms: { u_vignetteIntensity: 0.5, u_vignetteRadius: 0.8 } })
  }
  return passes
}

export class WebGPUPingPong {
  private device: GPUDevice | null = null
  private textures: [GPUTexture | null, GPUTexture | null] = [null, null]
  private views: [GPUTextureView | null, GPUTextureView | null] = [null, null]
  private width = 0
  private height = 0
  private current = 0

  constructor(device: GPUDevice) { this.device = device }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.destroy()
    this.createTargets()
  }

  private createTargets() {
    if (!this.device || this.width === 0 || this.height === 0) return
    for (let i = 0; i < 2; i++) {
      this.textures[i] = this.device.createTexture({
        size: [this.width, this.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.views[i] = this.textures[i]!.createView()
    }
  }

  destroy() { for (let i = 0; i < 2; i++) { this.textures[i]?.destroy(); this.textures[i] = null; this.views[i] = null } }
  getCurrent(): GPUTextureView | null { return this.views[this.current] }
  getNext(): GPUTextureView | null { return this.views[1 - this.current] }
  swap() { this.current = 1 - this.current }
  reset() { this.current = 0 }
}

export class WebGL2Framebuffer {
  private gl: WebGL2RenderingContext | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private texture: WebGLTexture | null = null
  private width = 0
  private height = 0

  constructor(gl: WebGL2RenderingContext) { this.gl = gl }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.destroy()
    this.createTarget()
  }

  private createTarget() {
    if (!this.gl || this.width === 0 || this.height === 0) return
    const gl = this.gl
    this.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) console.error("Framebuffer is not complete")
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  bind() { this.gl?.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer) }
  unbind() { this.gl?.bindFramebuffer(this.gl.FRAMEBUFFER, null) }
  getTexture(): WebGLTexture | null { return this.texture }
  destroy() { if (this.gl) { if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer); if (this.texture) this.gl.deleteTexture(this.texture) }; this.framebuffer = null; this.texture = null }
}

export const PASSTHROUGH_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() { v_texCoord = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }
`

export const VIGNETTE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_vignetteIntensity;
uniform float u_vignetteRadius;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_texture, v_texCoord);
  vec2 uv = v_texCoord * 2.0 - 1.0;
  float dist = length(uv);
  float vignette = smoothstep(u_vignetteRadius, u_vignetteRadius - 0.3, dist);
  vignette = mix(1.0, vignette, u_vignetteIntensity);
  fragColor = vec4(color.rgb * vignette, color.a);
}
`

export const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_blurAmount;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 texelSize = 1.0 / u_resolution * u_blurAmount;
  vec4 result = vec4(0.0);
  float weights[9] = float[](0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625);
  int idx = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize;
      result += texture(u_texture, v_texCoord + offset) * weights[idx];
      idx++;
    }
  }
  fragColor = result;
}
`
