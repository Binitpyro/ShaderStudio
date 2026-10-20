// TAA resolve: the camera is Halton-jittered on the CPU; history is clamped to the 3x3 neighbourhood (YCoCg)
// and rejected when it is NaN/Inf or invalid (first frame / resize). Writes the output and the next history.
struct TAAOut {
  @location(0) color: vec4<f32>,
  @location(1) history: vec4<f32>,
};

fn toYCoCg(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(c, vec3<f32>(0.25, 0.5, 0.25)), dot(c, vec3<f32>(0.5, 0.0, -0.5)), dot(c, vec3<f32>(-0.25, 0.5, -0.25)));
}
fn fromYCoCg(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

@fragment
fn fragment_main(in: VOut) -> TAAOut {
  let cur = sceneColor(in.uv);
  var lo = toYCoCg(cur.rgb);
  var hi = lo;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let n = toYCoCg(sceneColor(in.uv + vec2<f32>(f32(x), f32(y)) * fx.size.zw).rgb);
      lo = min(lo, n);
      hi = max(hi, n);
    }
  }
  let h = textureSampleLevel(auxTex, smp, in.uv, 0.0).rgb;
  let finite = all(abs(h) < vec3<f32>(1.0e4));
  var w = 0.9;
  if (fx.shadow2.w < 0.5 || !finite) { w = 0.0; }
  let hc = fromYCoCg(clamp(toYCoCg(select(vec3<f32>(0.0), h, finite)), lo, hi));
  let col = mix(cur.rgb, hc, w);
  var o: TAAOut;
  o.color = vec4<f32>(col, cur.a);
  o.history = vec4<f32>(col, 1.0);
  return o;
}
