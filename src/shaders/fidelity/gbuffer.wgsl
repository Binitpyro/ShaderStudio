// G-buffer geometry pass: albedo (rgba8), world normal (rgba16f), roughness/metallic (rg8), motion (rg16f) + depth.
struct GU {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  prevMvp: mat4x4<f32>,
  albedo: vec4<f32>,
  eye: vec4<f32>,
  material: vec4<f32>, // roughness, metallic
};
@group(0) @binding(0) var<uniform> g: GU;

struct VO {
  @builtin(position) pos: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) cur: vec4<f32>,
  @location(2) prev: vec4<f32>,
};

struct GOut {
  @location(0) albedo: vec4<f32>,
  @location(1) normal: vec4<f32>,
  @location(2) material: vec2<f32>,
  @location(3) motion: vec2<f32>,
};

@vertex
fn vertex_main(@location(0) position: vec3<f32>) -> VO {
  var o: VO;
  let p = vec4<f32>(position, 1.0);
  o.cur = g.mvp * p;
  o.prev = g.prevMvp * p;
  o.pos = o.cur;
  o.wp = (g.model * p).xyz;
  return o;
}

@fragment
fn fragment_main(in: VO) -> GOut {
  var n = normalize(cross(dpdx(in.wp), dpdy(in.wp)));
  if (dot(n, g.eye.xyz - in.wp) < 0.0) { n = -n; }
  var o: GOut;
  o.albedo = vec4<f32>(g.albedo.rgb, 1.0);
  o.normal = vec4<f32>(n * 0.5 + 0.5, 1.0);
  o.material = g.material.xy;
  o.motion = (in.cur.xy / in.cur.w - in.prev.xy / in.prev.w) * 0.5;
  return o;
}
