import type { RenderStep } from "@/core/graphCompiler"

export type PostProcessPassType =
  | "passthrough"
  | "vignette"
  | "blur"
  | "chromatic_aberration"
  | "bloom"
  | "custom"

export interface PostProcessPass {
  nodeId?: string
  type: PostProcessPassType
  shaderSource?: string
  uniforms: Record<string, number | number[]>
}

export function buildPostProcessChain(steps: RenderStep[]): PostProcessPass[] {
  const passes: PostProcessPass[] = []
  for (const step of steps) {
    if (step.type === "postprocess") {
      const passType: PostProcessPassType = (step.pass === "passthrough" || !step.pass) ? "vignette" : step.pass
      const defaultUniforms = getDefaultPostProcessUniforms(passType)
      passes.push({
        nodeId: step.id || passType,
        type: passType,
        shaderSource: step.customSource,
        uniforms: { ...defaultUniforms, ...(step.uniforms || {}) },
      })
    }
  }
  return passes
}

export function getDefaultPostProcessUniforms(type: PostProcessPassType): Record<string, number | number[]> {
  switch (type) {
    case "vignette":
      return { u_vignetteIntensity: 0.5, u_vignetteRadius: 0.8 }
    case "blur":
      return { u_blurAmount: 2.0 }
    case "chromatic_aberration":
      return { u_aberrationOffset: 0.008 }
    case "bloom":
      return { u_bloomThreshold: 0.7, u_bloomIntensity: 0.5 }
    case "passthrough":
    case "custom":
    default:
      return {}
  }
}

export class WebGPUPingPong {
  private device: GPUDevice | null = null
  private format: GPUTextureFormat = "rgba8unorm"
  private textures: [GPUTexture | null, GPUTexture | null] = [null, null]
  private views: [GPUTextureView | null, GPUTextureView | null] = [null, null]
  private width = 0
  private height = 0
  private current = 0

  constructor(device: GPUDevice, format: GPUTextureFormat = "rgba8unorm") {
    this.device = device
    this.format = format
  }

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
        format: this.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.views[i] = this.textures[i]!.createView()
    }
  }

  destroy() {
    for (let i = 0; i < 2; i++) {
      this.textures[i]?.destroy()
      this.textures[i] = null
      this.views[i] = null
    }
  }

  getCurrent(): GPUTextureView | null {
    return this.views[this.current]
  }

  getNext(): GPUTextureView | null {
    return this.views[1 - this.current]
  }

  getCurrentTexture(): GPUTexture | null {
    return this.textures[this.current]
  }

  getNextTexture(): GPUTexture | null {
    return this.textures[1 - this.current]
  }

  swap() {
    this.current = 1 - this.current
  }

  reset() {
    this.current = 0
  }
}

export class WebGL2Framebuffer {
  private gl: WebGL2RenderingContext | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private texture: WebGLTexture | null = null
  private width = 0
  private height = 0

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }

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
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer is not complete")
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  bind() {
    this.gl?.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer)
  }

  unbind() {
    this.gl?.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  getTexture(): WebGLTexture | null {
    return this.texture
  }

  destroy() {
    if (this.gl) {
      if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer)
      if (this.texture) this.gl.deleteTexture(this.texture)
    }
    this.framebuffer = null
    this.texture = null
  }
}

export const PASSTHROUGH_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const PASSTHROUGH_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}
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

export const CHROMATIC_ABERRATION_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_aberrationOffset;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 uv = v_texCoord;
  vec2 dir = uv - vec2(0.5);
  float dist = length(dir);
  vec2 offset = (dist > 0.0001) ? (dir / dist) * u_aberrationOffset : vec2(u_aberrationOffset, 0.0);
  float r = texture(u_texture, uv + offset).r;
  float g = texture(u_texture, uv).g;
  float b = texture(u_texture, uv - offset).b;
  float a = texture(u_texture, uv).a;
  fragColor = vec4(r, g, b, a);
}
`

export const BLOOM_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_bloomThreshold;
uniform float u_bloomIntensity;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 baseColor = texture(u_texture, v_texCoord);
  float stepSize = 0.004;
  vec3 glow = max(baseColor.rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(-stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(0.0, -stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(0.0, stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow = (glow / 5.0) * u_bloomIntensity;
  fragColor = vec4(baseColor.rgb + glow, baseColor.a);
}
`

export const CUSTOM_WGSL_TEMPLATE = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.texCoord = pos[vertexIndex] * 0.5 + 0.5;
  out.texCoord.y = 1.0 - out.texCoord.y;
  return out;
}

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  // Sample input rendered frame
  let color = textureSample(u_texture, u_sampler, texCoord);
  // Example: Invert colors
  return vec4<f32>(1.0 - color.rgb, color.a);
}
`

export const CUSTOM_GLSL_TEMPLATE = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_texture, v_texCoord);
  // Example: Invert colors
  fragColor = vec4(1.0 - color.rgb, color.a);
}
`
