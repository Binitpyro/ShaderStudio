// Depth-only shadow pass: vertex stage only (no fragment stage, no colour targets).
// Slots of 256 bytes are selected with a dynamic offset: slot 0 = directional light, 1..6 = point-light faces.
struct ShadowU {
  lightMVP: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> su: ShadowU;

@vertex
fn vertex_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return su.lightMVP * vec4<f32>(position, 1.0);
}
