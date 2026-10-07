struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

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

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

@fragment
fn fragment_main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(u_texture, u_sampler, texCoord);
}
