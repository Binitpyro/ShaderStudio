// Forward-mode G-buffer debug view (albedo = scene colour, normal/depth derived from the depth buffer).
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.pos.xy);
  let code = i32(fx.misc.x);
  let c = sceneColor(in.uv);
  if (code == 1) { return vec4<f32>(c.rgb, 1.0); }
  if (code == 2) { return vec4<f32>(normalAt(px, in.uv) * 0.5 + 0.5, 1.0); }
  if (code == 3) { return vec4<f32>(vec3<f32>(0.5), 1.0); }
  if (code == 4) { return vec4<f32>(vec3<f32>(0.0), 1.0); }
  if (code == 5) { return vec4<f32>(vec3<f32>(loadDepth(px)), 1.0); }
  if (code == 6) { return vec4<f32>(0.5, 0.5, 0.0, 1.0); }
  return c;
}
