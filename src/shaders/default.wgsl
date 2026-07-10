struct Uniforms {
  mvp: mat4x4<f32>,
  color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.clip_position = uniforms.mvp * vec4<f32>(input.position, 1.0);
  return output;
}

@fragment
fn fragment_main(_input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(uniforms.color, 1.0);
}
