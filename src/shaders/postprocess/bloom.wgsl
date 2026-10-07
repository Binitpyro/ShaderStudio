struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct BloomParams {
  threshold: f32,
  intensity: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BloomParams;

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
  
  // 5-tap cross sample for bloom halo
  let stepSize = 0.004;
  let offsets = array<vec2<f32>, 4>(
    vec2<f32>(-stepSize, 0.0),
    vec2<f32>( stepSize, 0.0),
    vec2<f32>(0.0, -stepSize),
    vec2<f32>(0.0,  stepSize)
  );

  var glow = max(baseColor.rgb - vec3<f32>(params.threshold), vec3<f32>(0.0));
  for (var i: i32 = 0; i < 4; i++) {
    let tap = textureSample(u_texture, u_sampler, texCoord + offsets[i]).rgb;
    glow += max(tap - vec3<f32>(params.threshold), vec3<f32>(0.0));
  }
  glow = (glow / 5.0) * params.intensity;

  return vec4<f32>(baseColor.rgb + glow, baseColor.a);
}
