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

  // Dynamic moving flock goal
  let t = params.time * 0.5;
  let goal = vec3<f32>(sin(t * 1.3) * 1.8, sin(t * 0.7) * 0.9, cos(t) * 1.8);
  let toGoal = goal - p.position;
  let goalDist = length(toGoal);
  let goalForce = normalize(toGoal) * min(goalDist, 3.0) * params.strength * 2.0;

  // Swarm pseudo-separation based on nearby sample in array
  let neighborIdx = (index + 7u) % u32(params.particleCount);
  let neighbor = particles[neighborIdx];
  let diff = p.position - neighbor.position;
  let dist = length(diff);
  var sepForce = vec3<f32>(0.0);
  if (dist > 0.001 && dist < 0.4) {
    sepForce = (diff / (dist * dist)) * 0.5;
  }

  // Centering pull
  let centerPull = -p.position * 0.2;

  let totalAcc = goalForce + sepForce + centerPull;
  p.velocity = p.velocity * params.damping + totalAcc * dt * params.speed;

  // Cap max velocity
  let velMag = length(p.velocity);
  if (velMag > 2.5) {
    p.velocity = (p.velocity / velMag) * 2.5;
  }

  p.position = p.position + p.velocity * dt * params.speed;

  if (length(p.position) > 4.5 || params.reset > 0.5) {
    let seed = vec3<f32>(f32(index) * 0.21, f32(index) * 0.73, params.time);
    p.position = hash33(seed) * 1.5;
    p.velocity = hash33(seed + 1.0) * 0.5;
    p.life = 1.0;
  }

  particles[index] = p;
}
