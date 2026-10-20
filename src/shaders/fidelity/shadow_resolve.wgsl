// Forward-mode shadow resolve: darkens the lit scene colour where the depth-reconstructed surface is shadowed.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let c = sceneColor(in.uv);
  let px = vec2<i32>(in.pos.xy);
  let d = loadDepth(px);
  if (d >= 1.0) { return c; }
  let P = worldAt(in.uv, d);
  let N = normalAt(px, in.uv);
  var dark = 0.0;
  if (fx.shadow.x > 0.5) {
    dark = dark + (1.0 - dirShadow(P, N)) * 0.65 * clamp(dot(N, fx.lightDir.xyz) * 2.0, 0.0, 1.0);
  }
  if (fx.shadow2.x > 0.5) {
    let toL = normalize(fx.pointPos.xyz - P);
    dark = dark + (1.0 - pointShadow(P, N)) * 0.5 * clamp(dot(N, toL) * 2.0, 0.0, 1.0);
  }
  return vec4<f32>(c.rgb * (1.0 - clamp(dark, 0.0, 0.85)), c.a);
}
