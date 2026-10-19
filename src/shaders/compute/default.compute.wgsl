struct Particle {
  position: vec3<f32>,
  life: f32,
  velocity: vec3<f32>,
  mass: f32,
};

struct SimParams {
  deltaTime: f32,
  time: f32,
  speed: f32,
  damping: f32,
  strength: f32,
  particleCount: f32,
  noiseScale: f32,
  reset: f32,
};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (f32(index) >= params.particleCount) {
    return;
  }

  var p = particles[index];
  let dt = clamp(params.deltaTime, 0.001, 0.05);

  // Custom simulation logic: Simple harmonic oscillator & orbital drift
  let angle = atan2(p.position.z, p.position.x) + params.speed * dt * 0.5;
  let radius = length(p.position.xz);
  let targetRadius = 1.5 + sin(params.time * 2.0 + f32(index) * 0.01) * 0.5;

  let rNew = mix(radius, targetRadius, dt * 2.0);
  p.position = vec3<f32>(cos(angle) * rNew, sin(params.time + radius * 3.0) * 0.3, sin(angle) * rNew);
  p.velocity = vec3<f32>(-sin(angle), 0.0, cos(angle)) * params.speed;

  particles[index] = p;
}
