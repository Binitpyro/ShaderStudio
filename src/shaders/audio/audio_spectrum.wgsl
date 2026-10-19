// Audio-Reactive Circular Spectrum Equalizer & Waveform Oscilloscope (WGSL)
// Samples row 0 for 512-bin FFT frequency and row 1 for time-domain waveform PCM.

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
  let uv = input.uv * 2.0 - vec2<f32>(1.0, 1.0);
  let dist = length(uv);
  let angle = atan2(uv.y, uv.x);
  let normAngle = (angle + 3.14159265) / (2.0 * 3.14159265);

  // 1. Sample Frequency Spectrum (Row 0, Y = 0.25)
  // Symmetric mirror spectrum from center
  let freqCoord = abs(normAngle - 0.5) * 2.0;
  let freqSample = textureSample(audioTexture, audioSampler, vec2<f32>(freqCoord, 0.25)).r;

  // 2. Sample Waveform Oscilloscope (Row 1, Y = 0.75)
  let waveSample = textureSample(audioTexture, audioSampler, vec2<f32>(normAngle, 0.75)).r;

  // 3. Circular Frequency Bars
  let baseRadius = 0.35 + uniforms.audio_bass * 0.12 + uniforms.audio_beat * 0.08;
  let barHeight = freqSample * 0.45;
  let targetRadius = baseRadius + barHeight;

  var color = vec3<f32>(0.02, 0.03, 0.06);

  // Frequency Bars rendering
  if (dist > baseRadius && dist < targetRadius) {
    let t = (dist - baseRadius) / max(0.01, barHeight);
    let barColor = mix(
      vec3<f32>(0.0, 0.8, 0.9), // Cyan at base
      vec3<f32>(1.0, 0.1, 0.6), // Magenta at peak
      t
    );
    color += barColor * (1.2 + uniforms.audio_beat * 0.5);
  }

  // 4. Center Oscilloscope Ring
  let ringDist = abs(dist - (0.2 + (waveSample - 0.5) * 0.25));
  let ringGlow = 0.006 / (ringDist + 0.005);
  let ringColor = vec3<f32>(0.3, 1.0, 0.5) * ringGlow;
  color += ringColor;

  // 5. Central Kick Pulse Glow
  let coreGlow = (1.0 - smoothstep(0.0, 0.25, dist)) * (uniforms.audio_bass * 1.5 + uniforms.audio_beat * 2.5);
  color += vec3<f32>(1.0, 0.9, 0.4) * coreGlow * 0.6;

  // Vignette
  let vig = 1.0 - smoothstep(0.8, 1.4, dist);
  color *= vig;

  return vec4<f32>(color, 1.0);
}
