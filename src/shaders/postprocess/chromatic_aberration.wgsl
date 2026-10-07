struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct ChromaticParams {
  offset: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ChromaticParams;

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
  let uv = texCoord;
  let dir = uv - vec2<f32>(0.5, 0.5);
  let dist = length(dir);
  let offsetVec = select(vec2<f32>(params.offset, 0.0), (dir / max(dist, 0.0001)) * params.offset, dist > 0.0001);

  let r = textureSample(u_texture, u_sampler, uv + offsetVec).r;
  let g = textureSample(u_texture, u_sampler, uv).g;
  let b = textureSample(u_texture, u_sampler, uv - offsetVec).b;
  let a = textureSample(u_texture, u_sampler, uv).a;

  return vec4<f32>(r, g, b, a);
}
