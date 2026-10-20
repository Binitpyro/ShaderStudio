// Copies scene depth into a filterable r16float target so user-chain SSAO/SSR/DoF nodes can sample depth as .r.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(loadDepth(vec2<i32>(in.pos.xy)), 0.0, 0.0, 1.0);
}
