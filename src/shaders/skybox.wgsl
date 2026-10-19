struct SkyboxUniforms {
  camRight: vec4<f32>,
  camUp: vec4<f32>,
  camForward: vec4<f32>,
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: SkyboxUniforms;
@group(0) @binding(1) var envSampler: sampler;
@group(0) @binding(2) var envTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32(i32(vertex_index & 1u) * 4 - 1);
  let y = f32(i32(vertex_index & 2u) * 2 - 1);
  out.position = vec4<f32>(x, y, 1.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

const PI: f32 = 3.141592653589793;

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let rayDir = normalize(u.camForward.xyz + in.uv.x * u.camRight.xyz + in.uv.y * u.camUp.xyz);

  let phi = acos(clamp(rayDir.y, -1.0, 1.0));
  let v = phi / PI;

  let theta = atan2(rayDir.x, -rayDir.z) + u.params.x;
  var uCoord = (theta / (2.0 * PI)) + 0.5;
  uCoord = uCoord - floor(uCoord);

  let uv = vec2<f32>(uCoord, v);
  let blur = u.params.y;
  let exposure = u.params.z;

  var col: vec3<f32>;
  if (blur > 0.01) {
    let off = blur * 0.02;
    col = (
      textureSample(envTexture, envSampler, uv).rgb * 2.0 +
      textureSample(envTexture, envSampler, uv + vec2<f32>(off, 0.0)).rgb +
      textureSample(envTexture, envSampler, uv - vec2<f32>(off, 0.0)).rgb +
      textureSample(envTexture, envSampler, uv + vec2<f32>(0.0, off)).rgb +
      textureSample(envTexture, envSampler, uv - vec2<f32>(0.0, off)).rgb +
      textureSample(envTexture, envSampler, uv + vec2<f32>(off * 0.7, off * 0.7)).rgb +
      textureSample(envTexture, envSampler, uv - vec2<f32>(off * 0.7, off * 0.7)).rgb +
      textureSample(envTexture, envSampler, uv + vec2<f32>(-off * 0.7, off * 0.7)).rgb +
      textureSample(envTexture, envSampler, uv + vec2<f32>(off * 0.7, -off * 0.7)).rgb
    ) / 10.0;
  } else {
    col = textureSample(envTexture, envSampler, uv).rgb;
  }

  return vec4<f32>(col * exposure, 1.0);
}
