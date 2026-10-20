// World-space ray march against the depth buffer. Roughness/metalness come from the G-buffer in deferred mode.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let c = sceneColor(in.uv);
  let px = vec2<i32>(in.pos.xy);
  let d = loadDepth(px);
  if (d >= 1.0) { return c; }
  let P = worldAt(in.uv, d);
  let N = normalAt(px, in.uv);
  let V = normalize(P - fx.eye.xyz);
  var refl = 0.25;
  if (fx.shadow2.z > 0.5) {
    let m = textureLoad(auxTex, px, 0).xy;
    if (m.x > 0.85) { return c; }
    refl = clamp((1.0 - m.x) * 0.5 + m.y * 0.5, 0.0, 1.0);
  }
  let R = normalize(reflect(V, N));
  let fres = pow(1.0 - clamp(dot(N, -V), 0.0, 1.0), 3.0) * 0.8 + 0.2;
  let steps = i32(clamp(fx.ssr.x, 8.0, 128.0));
  let stepLen = 6.0 / f32(steps);
  var pos = P + N * 0.02;
  var hitUV = vec2<f32>(-1.0, -1.0);
  for (var i = 0; i < steps; i = i + 1) {
    pos = pos + R * stepLen * (1.0 + f32(i) * 0.03);
    let clip = fx.viewProj * vec4<f32>(pos, 1.0);
    if (clip.w <= 0.0) { break; }
    let suv = vec2<f32>(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { break; }
    let sd = loadDepth(vec2<i32>(suv * fx.size.xy));
    if (sd >= 1.0) { continue; }
    let diff = clip.w - linearZ(sd);
    if (diff > 0.0 && diff < fx.ssr.y * 10.0) { hitUV = suv; break; }
  }
  let skyDir = R.y * 0.5 + 0.5;
  let sky = mix(vec3<f32>(0.25, 0.27, 0.3), vec3<f32>(0.55, 0.7, 0.95), skyDir);
  if (hitUV.x < 0.0) {
    return vec4<f32>(mix(c.rgb, sky, fx.ssr.w * fres * refl), c.a);
  }
  let e = smoothstep(vec2<f32>(0.0), vec2<f32>(0.1), hitUV) * smoothstep(vec2<f32>(0.0), vec2<f32>(0.1), vec2<f32>(1.0) - hitUV);
  let conf = pow(e.x * e.y, max(fx.ssr.z, 0.01)) * fres * refl;
  let hc = sceneColor(hitUV).rgb;
  return vec4<f32>(mix(c.rgb, hc, conf * (1.0 - fx.ssr.w * 0.5)), c.a);
}
