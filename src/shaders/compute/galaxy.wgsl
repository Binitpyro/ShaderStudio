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

  let rPlane = length(p.position.xz);
  let eps = 0.2;

  // Central supermassive core gravity
  let corePull = -normalize(vec3<f32>(p.position.x, 0.0, p.position.z)) * (params.strength * 4.0 / (rPlane + eps));
  // Flat disk vertical spring pull to keep galaxy flat
  let diskFlat = vec3<f32>(0.0, -p.position.y * 8.0, 0.0);

  // Tangential orbital velocity force (cross product with up vector)
  let tangent = normalize(vec3<f32>(-p.position.z, 0.0, p.position.x));
  let orbitalSpeed = sqrt(params.strength * 4.0 / max(rPlane, 0.3));
  let orbitForce = (tangent * orbitalSpeed - p.velocity) * 1.5;

  p.velocity = p.velocity * params.damping + (corePull + diskFlat + orbitForce) * dt * params.speed;
  p.position = p.position + p.velocity * dt * params.speed;

  if (rPlane > 4.0 || rPlane < 0.05 || params.reset > 0.5) {
    let seed = vec3<f32>(f32(index) * 0.19, f32(index) * 0.41, params.time);
    let rand = hash33(seed);

    // Initial spiral distribution
    let arm = f32(index % 2u) * 3.14159;
    let dist = pow(abs(rand.x), 0.7) * 2.5 + 0.2;
    let angle = dist * 2.0 + arm + rand.y * 0.3;

    p.position = vec3<f32>(cos(angle) * dist, rand.z * 0.15, sin(angle) * dist);
    let tang = vec3<f32>(-sin(angle), 0.0, cos(angle));
    let vOrbit = sqrt(params.strength * 4.0 / dist);
    p.velocity = tang * vOrbit;
    p.life = 1.0;
  }

  particles[index] = p;
}
