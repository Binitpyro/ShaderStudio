struct RenderUniforms {
  mvp: mat4x4<f32>,
  pointSize: f32,
  blendMode: f32,
  padding1: f32,
  padding2: f32,
};

struct Particle {
  position: vec3<f32>,
  life: f32,
  velocity: vec3<f32>,
  mass: f32,
};

@group(0) @binding(0) var<uniform> renderUniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

const QUAD_POS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>(-1.0,  1.0)
);

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32
) -> VertexOutput {
  let p = particles[instance_index];
  let quadOffset = QUAD_POS[vertex_index % 6u];

  let speed = length(p.velocity);
  let speedNorm = clamp(speed * 0.5, 0.0, 1.0);

  // Velocity-reactive thermal gradient: Cyan -> Magenta -> Radiant Orange
  let coolColor = vec3<f32>(0.2, 0.65, 1.0);
  let midColor = vec3<f32>(0.75, 0.25, 0.95);
  let hotColor = vec3<f32>(1.0, 0.5, 0.15);
  let col = mix(coolColor, mix(midColor, hotColor, smoothstep(0.4, 0.85, speedNorm)), smoothstep(0.0, 0.4, speedNorm));

  var out: VertexOutput;
  let pSize = max(renderUniforms.pointSize * 0.012, 0.004);
  let worldPos = p.position + vec3<f32>(quadOffset * pSize, 0.0);
  out.position = renderUniforms.mvp * vec4<f32>(worldPos, 1.0);
  out.uv = quadOffset;
  out.color = vec4<f32>(col, clamp(p.life, 0.3, 1.0));
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let dist = length(in.uv);
  if (dist > 1.0) {
    discard;
  }
  let alpha = pow(1.0 - dist, 1.5) * in.color.a;
  return vec4<f32>(in.color.rgb, alpha);
}
