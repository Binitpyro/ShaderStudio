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

// Simple pseudo-random hash
fn hash13(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash33(p: vec3<f32>) -> vec3<f32> {
  var q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453123) * 2.0 - 1.0;
}

// 3D Gradient Noise
fn noise3D(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(dot(hash33(i + vec3<f32>(0.0, 0.0, 0.0)), f - vec3<f32>(0.0, 0.0, 0.0)),
          dot(hash33(i + vec3<f32>(1.0, 0.0, 0.0)), f - vec3<f32>(1.0, 0.0, 0.0)), u.x),
      mix(dot(hash33(i + vec3<f32>(0.0, 1.0, 0.0)), f - vec3<f32>(0.0, 1.0, 0.0)),
          dot(hash33(i + vec3<f32>(1.0, 1.0, 0.0)), f - vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
    mix(
      mix(dot(hash33(i + vec3<f32>(0.0, 0.0, 1.0)), f - vec3<f32>(0.0, 0.0, 1.0)),
          dot(hash33(i + vec3<f32>(1.0, 0.0, 1.0)), f - vec3<f32>(1.0, 0.0, 1.0)), u.x),
      mix(dot(hash33(i + vec3<f32>(0.0, 1.0, 1.0)), f - vec3<f32>(0.0, 1.0, 1.0)),
          dot(hash33(i + vec3<f32>(1.0, 1.0, 1.0)), f - vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z
  );
}

// Curl of potential vector field = divergence-free incompressible flow
fn curlNoise(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let dx = vec3<f32>(e, 0.0, 0.0);
  let dy = vec3<f32>(0.0, e, 0.0);
  let dz = vec3<f32>(0.0, 0.0, e);

  let n_x1 = noise3D(p + dx);
  let n_x2 = noise3D(p - dx);
  let n_y1 = noise3D(p + dy);
  let n_y2 = noise3D(p - dy);
  let n_z1 = noise3D(p + dz);
  let n_z2 = noise3D(p - dz);

  let x = (n_y1 - n_y2) - (n_z1 - n_z2);
  let y = (n_z1 - n_z2) - (n_x1 - n_x2);
  let z = (n_x1 - n_x2) - (n_y1 - n_y2);

  return normalize(vec3<f32>(x, y, z) / (2.0 * e));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (f32(index) >= params.particleCount) {
    return;
  }

  var p = particles[index];
  let dt = clamp(params.deltaTime, 0.001, 0.05);
  let speed = max(params.speed, 0.01);
  let scale = max(params.noiseScale, 0.1);

  // Compute turbulent curl force
  let noiseSamplePos = p.position * scale + vec3<f32>(0.0, params.time * 0.1, 0.0);
  let force = curlNoise(noiseSamplePos) * params.strength * 4.0;

  // Inward gentle spherical gravity to keep particles in view volume
  let distToCenter = length(p.position);
  let centerPull = -normalize(p.position) * max(distToCenter - 1.5, 0.0) * 2.0;

  p.velocity = p.velocity * params.damping + (force + centerPull) * dt * speed;
  p.position = p.position + p.velocity * dt * speed;
  p.life = p.life - dt * 0.1;

  // Re-seed if outside bounds or expired
  if (p.life <= 0.0 || distToCenter > 3.5 || params.reset > 0.5) {
    let seed = vec3<f32>(f32(index) * 0.13, f32(index) * 0.37, params.time);
    let randDir = hash33(seed);
    p.position = randDir * 1.5;
    p.velocity = vec3<f32>(0.0);
    p.life = 1.0 + hash13(seed) * 2.0;
  }

  particles[index] = p;
}
