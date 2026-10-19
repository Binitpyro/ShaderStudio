struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct FXAAParams {
  subpix: f32,
  edgeThreshold: f32,
  edgeThresholdMin: f32,
  padding: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: FXAAParams;

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

fn rgb2luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let inverseVP = vec2<f32>(1.0 / 800.0, 1.0 / 600.0);
  let rgbM = textureSample(u_texture, u_sampler, texCoord).rgb;
  let lumaM = rgb2luma(rgbM);
  let lumaNW = rgb2luma(textureSample(u_texture, u_sampler, texCoord + vec2<f32>(-1.0, -1.0) * inverseVP).rgb);
  let lumaNE = rgb2luma(textureSample(u_texture, u_sampler, texCoord + vec2<f32>( 1.0, -1.0) * inverseVP).rgb);
  let lumaSW = rgb2luma(textureSample(u_texture, u_sampler, texCoord + vec2<f32>(-1.0,  1.0) * inverseVP).rgb);
  let lumaSE = rgb2luma(textureSample(u_texture, u_sampler, texCoord + vec2<f32>( 1.0,  1.0) * inverseVP).rgb);

  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  let lumaRange = lumaMax - lumaMin;

  if (lumaRange < max(params.edgeThresholdMin, lumaMax * params.edgeThreshold)) {
    return vec4<f32>(rgbM, 1.0);
  }

  var dir = vec2<f32>(
    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
     ((lumaNW + lumaSW) - (lumaNE + lumaSE))
  );

  let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * 0.125), 0.00001);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2<f32>(8.0), max(vec2<f32>(-8.0), dir * rcpDirMin)) * inverseVP;

  let rgbA = 0.5 * (
    textureSample(u_texture, u_sampler, texCoord + dir * (1.0 / 3.0 - 0.5)).rgb +
    textureSample(u_texture, u_sampler, texCoord + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    textureSample(u_texture, u_sampler, texCoord + dir * (0.0 / 3.0 - 0.5)).rgb +
    textureSample(u_texture, u_sampler, texCoord + dir * (3.0 / 3.0 - 0.5)).rgb
  );

  let lumaB = rgb2luma(rgbB);
  if (lumaB < lumaMin || lumaB > lumaMax) {
    return vec4<f32>(rgbA, 1.0);
  } else {
    return vec4<f32>(rgbB, 1.0);
  }
}
