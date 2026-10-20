// Hemisphere SSAO in world space; each sample is projected back and compared against scene depth.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let c = sceneColor(in.uv);
  let px = vec2<i32>(in.pos.xy);
  let d = loadDepth(px);
  if (d >= 1.0) { return c; }
  let P = worldAt(in.uv, d);
  let N = normalAt(px, in.uv);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(N.y) > 0.99) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let T = normalize(cross(up, N));
  let B = cross(N, T);
  let count = i32(clamp(fx.ao.z, 4.0, 32.0));
  let radius = max(fx.ao.x, 0.01);
  let noise = ign(in.pos.xy);
  var occ = 0.0;
  for (var i = 0; i < count; i = i + 1) {
    let fi = (f32(i) + 0.5) / f32(count);
    let ang = (fi * 13.0 + noise) * 6.2831853;
    let z = sqrt(fi);
    let r = sqrt(1.0 - z * z);
    let dir = T * (cos(ang) * r) + B * (sin(ang) * r) + N * z;
    let sp = P + dir * radius * (0.15 + 0.85 * fi);
    let clip = fx.viewProj * vec4<f32>(sp, 1.0);
    let suv = vec2<f32>(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { continue; }
    let sd = loadDepth(vec2<i32>(suv * fx.size.xy));
    let sceneZ = linearZ(sd);
    let rangeOk = smoothstep(0.0, 1.0, radius / max(abs(linearZ(d) - sceneZ), 0.0001));
    if (sceneZ < clip.w - fx.ao.w) { occ = occ + rangeOk; }
  }
  let ao = clamp(1.0 - occ / f32(count) * fx.ao.y, 0.0, 1.0);
  return vec4<f32>(c.rgb * ao, c.a);
}
