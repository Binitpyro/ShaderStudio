fn luma(rgb: vec3<f32>) -> f32 { return dot(rgb, vec3<f32>(0.299, 0.587, 0.114)); }

@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let iv = fx.size.zw;
  let uv = in.uv;
  let m = sceneColor(uv);
  let lM = luma(m.rgb);
  let lNW = luma(sceneColor(uv + vec2<f32>(-1.0, -1.0) * iv).rgb);
  let lNE = luma(sceneColor(uv + vec2<f32>(1.0, -1.0) * iv).rgb);
  let lSW = luma(sceneColor(uv + vec2<f32>(-1.0, 1.0) * iv).rgb);
  let lSE = luma(sceneColor(uv + vec2<f32>(1.0, 1.0) * iv).rgb);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0833, lMax * 0.166)) { return m; }
  var dir = vec2<f32>(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  let reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.00001);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2<f32>(-8.0), vec2<f32>(8.0)) * iv;
  let a = 0.5 * (sceneColor(uv + dir * (1.0 / 3.0 - 0.5)).rgb + sceneColor(uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  let b = a * 0.5 + 0.25 * (sceneColor(uv + dir * -0.5).rgb + sceneColor(uv + dir * 0.5).rgb);
  let lB = luma(b);
  if (lB < lMin || lB > lMax) { return vec4<f32>(a, m.a); }
  return vec4<f32>(b, m.a);
}
