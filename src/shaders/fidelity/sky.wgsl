// Analytic atmosphere: single-scattering Rayleigh + Mie (Henyey-Greenstein) with Kasten-Young air mass.
// Driven by AtmosphereParams (sun direction from time of day / solar elevation, turbidity, sun intensity).
struct SkyU {
  camRight: vec4<f32>,
  camUp: vec4<f32>,
  camForward: vec4<f32>,
  sun: vec4<f32>,    // xyz = direction towards the sun, w = intensity
  params: vec4<f32>, // x = turbidity, y = exposure
};
@group(0) @binding(0) var<uniform> u: SkyU;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VOut {
  var o: VOut;
  let x = f32(i32(vi & 1u) * 4 - 1);
  let y = f32(i32(vi & 2u) * 2 - 1);
  o.position = vec4<f32>(x, y, 1.0, 1.0);
  o.uv = vec2<f32>(x, y);
  return o;
}

const PI: f32 = 3.141592653589793;

fn airMass(cosZenith: f32) -> f32 {
  let c = max(cosZenith, 0.0);
  return 1.0 / (c + 0.15 * pow(93.885 - degrees(acos(c)), -1.253));
}

@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let dir = normalize(u.camForward.xyz + in.uv.x * u.camRight.xyz + in.uv.y * u.camUp.xyz);
  let sunDir = normalize(u.sun.xyz);
  let betaR = vec3<f32>(5.8e-3, 13.5e-3, 33.1e-3);
  let betaM = vec3<f32>(21.0e-3) * u.params.x * 0.1;
  let mu = dot(dir, sunDir);
  let g = 0.76;
  let phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let phaseM = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  let viewAir = airMass(max(dir.y, 0.0)) * 8.0;
  let sunAir = airMass(max(sunDir.y, 0.0)) * 8.0;
  let ext = betaR + betaM;
  let sunTrans = exp(-ext * sunAir);
  let inscatter = (betaR * phaseR + betaM * phaseM) / max(ext, vec3<f32>(1.0e-5)) * (1.0 - exp(-ext * viewAir));
  var col = inscatter * sunTrans * u.sun.w * 18.0;

  // Sun disc and twilight floor
  let disc = smoothstep(0.9995, 0.99985, mu) * 40.0 * u.sun.w;
  col = col + sunTrans * disc * step(0.0, dir.y);
  col = col + vec3<f32>(0.01, 0.015, 0.03) * (1.0 - clamp(sunDir.y * 4.0, 0.0, 1.0));
  // Below the horizon fade to a dim ground tone
  let ground = vec3<f32>(0.08, 0.08, 0.09) * max(sunDir.y, 0.05);
  col = mix(col, ground, smoothstep(0.0, -0.08, dir.y));
  col = vec3<f32>(1.0) - exp(-col * u.params.y);
  return vec4<f32>(pow(col, vec3<f32>(1.0 / 2.2)), 1.0);
}
