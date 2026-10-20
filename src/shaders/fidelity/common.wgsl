// Shared header for every fidelity fullscreen pass (one bind-group layout for all of them).
// Float layout of `Fx` is mirrored by the FX_* offsets in src/adapters/webgpu.ts (196 floats).
struct Fx {
  lightDir: vec4<f32>,   // xyz = direction towards the light, w = intensity
  lightColor: vec4<f32>, // rgb, w = exposure
  invViewProj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  lightVP: mat4x4<f32>,
  faceVP: array<mat4x4<f32>, 6>,
  proj: vec4<f32>,       // near, far, -, -
  size: vec4<f32>,       // w, h, 1/w, 1/h
  pointPos: vec4<f32>,   // xyz, w = far
  pointColor: vec4<f32>, // rgb, w = intensity
  shadow: vec4<f32>,     // x = directional enabled, y = bias, z = normalBias, w = filter (0 pcf, 1 soft)
  shadow2: vec4<f32>,    // x = point enabled, y = map size, z = 1 when the normal target is a G-buffer, w = history valid
  ao: vec4<f32>,         // radius, intensity, sampleCount, bias
  ssr: vec4<f32>,        // maxSteps, thickness, falloff, iblBlend
  dof: vec4<f32>,        // focalDistance, aperture, maxBlur(px), bokeh (0 circle, 1 hex, 2 oct)
  misc: vec4<f32>,       // x = debug view code
  eye: vec4<f32>,
};

@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> fx: Fx;
@group(0) @binding(3) var depthTex: texture_depth_2d;
@group(0) @binding(4) var normalTex: texture_2d<f32>;
@group(0) @binding(5) var shadowTex: texture_depth_2d;
@group(0) @binding(6) var shadowCmp: sampler_comparison;
@group(0) @binding(7) var auxTex: texture_2d<f32>;   // TAA history, or G-buffer material
@group(0) @binding(8) var pointShadowTex: texture_depth_2d_array;
@group(0) @binding(9) var aux2Tex: texture_2d<f32>;  // G-buffer motion

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  var o: VOut;
  o.pos = vec4<f32>(p[i], 0.0, 1.0);
  o.uv = vec2<f32>(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}

fn loadDepth(px: vec2<i32>) -> f32 {
  let m = vec2<i32>(fx.size.xy) - vec2<i32>(1, 1);
  return textureLoad(depthTex, clamp(px, vec2<i32>(0, 0), m), 0);
}

fn worldAt(uv: vec2<f32>, d: f32) -> vec3<f32> {
  let w = fx.invViewProj * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  return w.xyz / w.w;
}

// Positive view-space distance for a [0,1] perspective depth value.
fn linearZ(d: f32) -> f32 {
  return fx.proj.x * fx.proj.y / (fx.proj.y - d * (fx.proj.y - fx.proj.x));
}

fn normalAt(px: vec2<i32>, uv: vec2<f32>) -> vec3<f32> {
  if (fx.shadow2.z > 0.5) {
    return normalize(textureLoad(normalTex, px, 0).xyz * 2.0 - 1.0);
  }
  // Forward mode: normal from depth derivatives (neighbour with the smaller depth step on each axis).
  let d0 = loadDepth(px);
  let p0 = worldAt(uv, d0);
  let dr = loadDepth(px + vec2<i32>(1, 0));
  let dl = loadDepth(px - vec2<i32>(1, 0));
  let dd = loadDepth(px + vec2<i32>(0, 1));
  let du = loadDepth(px - vec2<i32>(0, 1));
  var tx: vec3<f32>;
  if (abs(dr - d0) < abs(dl - d0)) { tx = worldAt(uv + vec2<f32>(fx.size.z, 0.0), dr) - p0; }
  else { tx = p0 - worldAt(uv - vec2<f32>(fx.size.z, 0.0), dl); }
  var ty: vec3<f32>;
  if (abs(dd - d0) < abs(du - d0)) { ty = worldAt(uv + vec2<f32>(0.0, fx.size.w), dd) - p0; }
  else { ty = p0 - worldAt(uv - vec2<f32>(0.0, fx.size.w), du); }
  var n = normalize(cross(tx, ty));
  if (dot(n, fx.eye.xyz - p0) < 0.0) { n = -n; }
  return n;
}

fn pcf(uv: vec2<f32>, depthRef: f32) -> f32 {
  let ts = 1.0 / max(fx.shadow2.y, 1.0);
  let r = select(1, 2, fx.shadow.w > 0.5);
  var s = 0.0;
  var n = 0.0;
  for (var y = -r; y <= r; y = y + 1) {
    for (var x = -r; x <= r; x = x + 1) {
      s = s + textureSampleCompareLevel(shadowTex, shadowCmp, uv + vec2<f32>(f32(x), f32(y)) * ts, depthRef);
      n = n + 1.0;
    }
  }
  return s / n;
}

// 1 = lit, 0 = fully shadowed (directional light).
fn dirShadow(P: vec3<f32>, N: vec3<f32>) -> f32 {
  if (fx.shadow.x < 0.5) { return 1.0; }
  let ndl = clamp(dot(N, fx.lightDir.xyz), 0.0, 1.0);
  let Pn = P + N * fx.shadow.z * (1.0 - ndl + 0.25);
  let lc = fx.lightVP * vec4<f32>(Pn, 1.0);
  let ndc = lc.xyz / lc.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) { return 1.0; }
  return pcf(uv, ndc.z - fx.shadow.y);
}

// Omnidirectional shadow: the six faces live in a 2d-array; the face is picked by the major axis of the offset.
fn pointShadow(P: vec3<f32>, N: vec3<f32>) -> f32 {
  if (fx.shadow2.x < 0.5) { return 1.0; }
  let v = P - fx.pointPos.xyz;
  let a = abs(v);
  var face = 0;
  if (a.x >= a.y && a.x >= a.z) { face = select(1, 0, v.x > 0.0); }
  else if (a.y >= a.z) { face = select(3, 2, v.y > 0.0); }
  else { face = select(5, 4, v.z > 0.0); }
  let Pn = P + N * fx.shadow.z * 2.0;
  let lc = fx.faceVP[face] * vec4<f32>(Pn, 1.0);
  let ndc = lc.xyz / lc.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) { return 1.0; }
  return textureSampleCompareLevel(pointShadowTex, shadowCmp, uv, face, ndc.z - fx.shadow.y * 2.0);
}

fn ign(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn sceneColor(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(colorTex, smp, uv, 0.0);
}
