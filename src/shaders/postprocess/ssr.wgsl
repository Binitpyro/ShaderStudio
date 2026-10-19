struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct SSRParams {
  maxSteps: f32,
  thickness: f32,
  falloff: f32,
  iblBlend: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SSRParams;
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

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let baseColor = textureSample(u_texture, u_sampler, texCoord);
  let depth = textureSample(u_depthTexture, u_sampler, texCoord).r;
  if (depth >= 1.0) {
    return baseColor;
  }

  let normRough = textureSample(u_normalTexture, u_sampler, texCoord);
  let roughness = normRough.a;
  if (roughness > 0.6) {
    return baseColor;
  }

  let normal = normalize(normRough.xyz * 2.0 - 1.0);
  let viewDir = normalize(vec3<f32>(texCoord.x * 2.0 - 1.0, (1.0 - texCoord.y) * 2.0 - 1.0, 1.0));
  let reflectDir = normalize(reflect(viewDir, normal));

  let steps = i32(clamp(params.maxSteps, 16.0, 128.0));
  var stepSize: f32 = 0.01;
  var currentUV = texCoord;
  var hit = false;
  var hitUV = texCoord;

  for (var i = 0; i < steps; i = i + 1) {
    currentUV = currentUV + reflectDir.xy * stepSize;
    if (currentUV.x < 0.0 || currentUV.x > 1.0 || currentUV.y < 0.0 || currentUV.y > 1.0) {
      break;
    }

    let sampledDepth = textureSample(u_depthTexture, u_sampler, currentUV).r;
    let expectedDepth = depth + reflectDir.z * f32(i) * stepSize;
    let diff = expectedDepth - sampledDepth;

    if (diff > 0.0 && diff < params.thickness) {
      hit = true;
      hitUV = currentUV;
      break;
    }
  }

  if (hit) {
    let edgeFade = smoothstep(vec2<f32>(0.0), vec2<f32>(0.1), hitUV) * smoothstep(vec2<f32>(0.0), vec2<f32>(0.1), 1.0 - hitUV);
    let vignette = edgeFade.x * edgeFade.y;
    let confidence = pow(vignette, params.falloff) * (1.0 - roughness / 0.6);

    let reflectedColor = textureSample(u_texture, u_sampler, hitUV);
    let blended = mix(baseColor.rgb, reflectedColor.rgb, confidence * (1.0 - params.iblBlend));
    return vec4<f32>(blended, baseColor.a);
  }

  return baseColor;
}
