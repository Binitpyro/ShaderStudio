// Gather depth of field: circle of confusion from linear depth, golden-spiral kernel, optional polygon bokeh.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let c = sceneColor(in.uv);
  let px = vec2<i32>(in.pos.xy);
  let z = linearZ(loadDepth(px));
  let coc = clamp(abs(z - fx.dof.x) / max(z, 0.001) * fx.dof.y * 100.0, 0.0, fx.dof.z);
  if (coc < 0.5) { return c; }
  var acc = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = 0; i < 32; i = i + 1) {
    let th = f32(i) * 2.3999632;
    var r = sqrt((f32(i) + 0.5) / 32.0) * coc;
    if (fx.dof.w > 0.5) {
      let n = select(6.0, 8.0, fx.dof.w > 1.5);
      let a = 3.14159265 / n;
      let m = th - floor(th / (2.0 * a)) * 2.0 * a - a;
      r = r * cos(a) / cos(m);
    }
    let s = sceneColor(in.uv + vec2<f32>(cos(th), sin(th)) * r * fx.size.zw);
    let w = 1.0 + pow(max(0.0, dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114)) - 0.7), 2.0) * 4.0;
    acc = acc + s * w;
    wsum = wsum + w;
  }
  return acc / max(wsum, 0.001);
}
