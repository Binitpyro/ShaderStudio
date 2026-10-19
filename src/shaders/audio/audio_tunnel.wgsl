// Raymarched Cyber Audio Tunnel (WGSL)
// Pulsates to bass energy, speed accelerates with mid frequencies, and flashes on kick beats.

struct Uniforms {
  mvp: mat4x4<f32>,
  time: f32,
  audio_bass: f32,
  audio_mid: f32,
  audio_treble: f32,
  audio_level: f32,
  audio_beat: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var audioTexture: texture_2d<f32>;
@group(0) @binding(2) var audioSampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4<f32>(input.position, 1.0);
  output.uv = input.position.xy * 0.5 + vec2<f32>(0.5, 0.5);
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = (input.uv * 2.0 - vec2<f32>(1.0, 1.0));
  let r = length(uv);
  let a = atan2(uv.y, uv.x);

  let speed = uniforms.time * (0.8 + uniforms.audio_mid * 1.5);
  let tunnelZ = 0.5 / max(0.01, r) + speed;
  let tunnelUv = vec2<f32>(a / 3.14159265 * 4.0, tunnelZ);

  // Sample audio texture along tunnel depth
  let audioVal = textureSample(audioTexture, audioSampler, vec2<f32>(fract(tunnelZ * 0.1), 0.25)).r;

  // Grid pattern
  let grid = abs(fract(tunnelUv) - 0.5);
  let line = smoothstep(0.04 + uniforms.audio_treble * 0.05, 0.0, min(grid.x, grid.y));

  // Neon Tunnel Colors
  let baseColor = mix(
    vec3<f32>(0.1, 0.0, 0.3),
    vec3<f32>(0.0, 0.8, 1.0),
    sin(tunnelZ * 0.5) * 0.5 + 0.5
  );

  let beatFlash = vec3<f32>(1.0, 0.3, 0.6) * uniforms.audio_beat * 1.8;
  let bassPulse = uniforms.audio_bass * 0.7;

  var color = baseColor * (0.2 + audioVal * 1.5) + line * (vec3<f32>(0.3, 0.9, 1.0) + beatFlash);
  color += vec3<f32>(0.8, 0.2, 0.9) * line * bassPulse;

  // Depth fog
  color *= smoothstep(0.0, 0.35, r);

  return vec4<f32>(color, 1.0);
}
