struct Uniforms {
  mvp: mat4x4<f32>,
  time: f32,
  pulseSpeed: f32,
  fresnelPower: f32,
  iridescence: f32,
  color: vec3<f32>,
  roughness: f32,
  u_audio_bass: f32,
  u_audio_mid: f32,
  u_audio_treble: f32,
  u_audio_beat: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Audio-reactive procedural vertex breathing
  let pulse = sin(uniforms.time * uniforms.pulseSpeed * 2.0) * 0.04 * (1.0 + uniforms.u_audio_bass * 1.8);
  let displacedPos = input.position * (1.0 + pulse);

  output.clip_position = uniforms.mvp * vec4<f32>(displacedPos, 1.0);
  output.world_pos = displacedPos;
  output.uv = vec2<f32>(
    atan2(input.position.z, input.position.x) / 6.2831853 + 0.5,
    input.position.y * 0.5 + 0.5
  );
  return output;
}

// Inigo Quilez spectral rainbow palette
fn palette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Screen-space analytical surface normals with fallback
  let dX = dpdx(input.world_pos);
  let dY = dpdy(input.world_pos);
  let crossNorm = cross(dX, dY);
  var normal = select(vec3<f32>(0.0, 1.0, 0.0), normalize(crossNorm), length(crossNorm) > 1e-5);

  // Light & Camera view directions
  let viewDir = normalize(vec3<f32>(0.0, 2.0, 4.0) - input.world_pos);
  if (dot(normal, viewDir) < 0.0) {
    normal = -normal;
  }
  let lightDir = normalize(vec3<f32>(1.0, 2.0, 1.5));
  let halfVec = normalize(lightDir + viewDir);

  // View-dependent Fresnel rim glow
  let NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
  let fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), max(0.1, uniforms.fresnelPower));

  // Blinn-Phong specular highlight
  let NdotH = clamp(dot(normal, halfVec), 0.0, 1.0);
  let shininess = mix(128.0, 8.0, clamp(uniforms.roughness, 0.0, 1.0));
  let spec = pow(NdotH, shininess);

  // Thin-film chromatic wave interference modulated by audio mid-range
  let wavePhase = uniforms.time * uniforms.pulseSpeed * 0.5 + input.world_pos.y * 2.0;
  let thinFilm = pow(clamp(1.0 - NdotV, 0.0, 1.0), 2.0) + sin(wavePhase) * 0.15 + uniforms.u_audio_mid * 0.3;
  let iridescentCol = palette(thinFilm * uniforms.iridescence);

  // Diffuse wrap illumination with reliable ambient base
  let diff = max(0.25, dot(normal, lightDir) * 0.55 + 0.45);

  // Blend base color with chromatic iridescence and audio beat energy
  let base = uniforms.color * diff;
  let audioBoost = 1.0 + uniforms.u_audio_beat * 0.5;
  let rgb = (mix(base, iridescentCol, 0.65) + vec3<f32>(spec * 1.8) + iridescentCol * fresnel * 1.6) * audioBoost;

  return vec4<f32>(rgb, 1.0);
}
