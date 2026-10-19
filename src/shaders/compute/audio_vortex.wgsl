// Audio-Reactive GPU Particle Vortex Simulation (WGSL Compute)
// Rotational vortex driven by mid/high audio frequencies,
// outward explosive shockwaves triggered by kick beats!

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
  audioBass: f32,
  audioMid: f32,
  audioTreble: f32,
  audioBeat: f32,
};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x *= (x + 33.33);
  x *= (x + x);
  return fract(x);
}

fn hash31(p: f32) -> vec3<f32> {
  let x = hash11(p);
  let y = hash11(p + 19.19);
  let z = hash11(p + 37.37);
  return vec3<f32>(x, y, z) * 2.0 - vec3<f32>(1.0, 1.0, 1.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (f32(index) >= params.particleCount) {
    return;
  }

  var p = particles[index];

  if (params.reset > 0.5 || p.life <= 0.0) {
    let seed = f32(index) + params.time * 123.45;
    let dir = normalize(hash31(seed));
    let r = pow(hash11(seed + 5.0), 0.5) * 1.8;
    p.position = dir * r;
    p.velocity = cross(dir, vec3<f32>(0.0, 1.0, 0.0)) * 0.5;
    p.life = 1.0 + hash11(seed + 11.0) * 2.0;
    p.mass = 1.0;
    particles[index] = p;
    return;
  }

  let pos = p.position;
  let dist = length(pos);
  let dir = normalize(pos);

  // 1. Vortex Tangential Force (Angular speed boosted by mid/high frequencies)
  let up = vec3<f32>(0.0, 1.0, 0.0);
  let tangent = normalize(cross(up, pos));
  let vortexSpeed = (params.speed * 2.0 + params.audioMid * 3.5 + params.audioTreble * 2.0);
  let vortexForce = tangent * (vortexSpeed / max(0.2, dist));

  // 2. Inward Gravitational Pull toward Core
  let pullStrength = (params.strength * 1.5 + params.audioBass * 2.0);
  let pullForce = -dir * (pullStrength / max(0.4, dist * dist));

  // 3. Outward Explosive Shockwave on Kick Beats!
  let shockwave = dir * (params.audioBeat * 14.0 * max(0.0, 1.5 - dist));

  // Integrate Forces
  let totalAccel = vortexForce + pullForce + shockwave;
  p.velocity = (p.velocity + totalAccel * params.deltaTime) * params.damping;
  p.position += p.velocity * params.deltaTime;

  // Age particle
  p.life -= params.deltaTime * (0.3 + params.audioBeat * 0.4);

  particles[index] = p;
}
