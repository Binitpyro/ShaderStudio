struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct SSAOParams {
  radius: f32,
  intensity: f32,
  sampleCount: f32,
  bias: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SSAOParams;
@group(0) @binding(3) var u_depthTexture: texture_2d<f32>;
@group(0) @binding(4) var u_normalTexture: texture_2d<f32>;

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

fn ign(screenPos: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(screenPos, vec2<f32>(0.06711056, 0.00583715))));
}

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let baseColor = textureSample(u_texture, u_sampler, texCoord);
  let depth = textureSample(u_depthTexture, u_sampler, texCoord).r;
  if (depth >= 1.0) {
    return baseColor;
  }

  let normalSample = textureSample(u_normalTexture, u_sampler, texCoord).xyz;
  let normal = normalize(normalSample * 2.0 - 1.0);

  let noise = ign(texCoord * 1000.0);
  let angle = noise * 6.2831853;
  let cosA = cos(angle);
  let sinA = sin(angle);

  var occlusion = 0.0;
  let count = i32(clamp(params.sampleCount, 4.0, 32.0));
  let radius = params.radius * 0.05;

  for (var i = 0; i < count; i = i + 1) {
    let fi = f32(i) / f32(count);
    let sampleAngle = fi * 6.2831853 * 2.0;
    let dist = sqrt(fi) * radius;
    let rawOffset = vec2<f32>(cos(sampleAngle), sin(sampleAngle)) * dist;
    let rotOffset = vec2<f32>(rawOffset.x * cosA - rawOffset.y * sinA, rawOffset.x * sinA + rawOffset.y * cosA);
    let sampleUV = clamp(texCoord + rotOffset, vec2<f32>(0.0), vec2<f32>(1.0));

    let sampleDepth = textureSample(u_depthTexture, u_sampler, sampleUV).r;
    let depthDiff = depth - sampleDepth;
    if (depthDiff > params.bias && depthDiff < radius * 4.0) {
      occlusion = occlusion + (1.0 - smoothstep(0.0, radius * 4.0, depthDiff));
    }
  }

  let ao = clamp(1.0 - (occlusion / f32(count)) * params.intensity, 0.0, 1.0);
  return vec4<f32>(baseColor.rgb * ao, baseColor.a);
}
