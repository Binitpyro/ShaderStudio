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

fn hash33(p: vec3<f32>) -> vec3<f32> {
  var q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453123) * 2.0 - 1.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (f32(index) >= params.particleCount) {
    return;
  }

  var p = particles[index];
  let dt = clamp(params.deltaTime, 0.001, 0.05);
  let t = params.time * 0.8;

  // 3 rotating gravitational attractors
  let a1 = vec3<f32>(sin(t) * 1.2, cos(t * 0.7) * 0.6, cos(t) * 1.2);
  let a2 = vec3<f32>(sin(t + 2.09) * 1.2, sin(t * 1.2) * 0.6, cos(t + 2.09) * 1.2);
  let a3 = vec3<f32>(sin(t + 4.18) * 1.2, -cos(t * 0.9) * 0.6, cos(t + 4.18) * 1.2);

  var totalAcc = vec3<f32>(0.0);
  let eps = 0.15; // softening parameter to prevent infinite acceleration

  // Attractor 1
  let d1 = a1 - p.position;
  let distSq1 = dot(d1, d1) + eps;
  totalAcc += normalize(d1) * (params.strength * 3.5 / distSq1);

  // Attractor 2
  let d2 = a2 - p.position;
  let distSq2 = dot(d2, d2) + eps;
  totalAcc += normalize(d2) * (params.strength * 3.5 / distSq2);

  // Attractor 3
  let d3 = a3 - p.position;
  let distSq3 = dot(d3, d3) + eps;
  totalAcc += normalize(d3) * (params.strength * 3.5 / distSq3);

  p.velocity = p.velocity * params.damping + totalAcc * dt * params.speed;
  p.position = p.position + p.velocity * dt * params.speed;

  let distToCenter = length(p.position);
  if (distToCenter > 4.5 || params.reset > 0.5) {
    let seed = vec3<f32>(f32(index) * 0.17, f32(index) * 0.53, params.time);
    p.position = hash33(seed) * 2.0;
    p.velocity = cross(normalize(p.position), vec3<f32>(0.0, 1.0, 0.0)) * 0.5;
    p.life = 1.0;
  }

  particles[index] = p;
}
