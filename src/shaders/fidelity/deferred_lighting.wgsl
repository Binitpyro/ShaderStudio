// Deferred lighting (appended to common.wgsl). Bindings: colorTex = albedo, normalTex = world normal,
// depthTex = G-buffer depth (texture_depth_2d), auxTex = roughness/metallic, aux2Tex = motion.
// Background pixels (depth == 1) are discarded so the sky/skybox drawn earlier in the same pass shows through.
@fragment
fn fragment_main(in: VOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.pos.xy);
  let albedo = textureLoad(colorTex, px, 0);
  let nrm = textureLoad(normalTex, px, 0);
  let mat = textureLoad(auxTex, px, 0).xy;
  let d = loadDepth(px);
  let code = i32(fx.misc.x);
  if (code == 1) { return vec4<f32>(albedo.rgb, 1.0); }
  if (code == 2) { return vec4<f32>(nrm.xyz, 1.0); }
  if (code == 3) { return vec4<f32>(vec3<f32>(mat.x), 1.0); }
  if (code == 4) { return vec4<f32>(vec3<f32>(mat.y), 1.0); }
  if (code == 5) { return vec4<f32>(vec3<f32>(d), 1.0); }
  if (code == 6) { return vec4<f32>(textureLoad(aux2Tex, px, 0).xy * 10.0 + 0.5, 0.0, 1.0); }
  if (d >= 1.0) { discard; }

  let P = worldAt(in.uv, d);
  let N = normalize(nrm.xyz * 2.0 - 1.0);
  let V = normalize(fx.eye.xyz - P);
  let rough = clamp(mat.x, 0.04, 1.0);
  let metal = mat.y;
  let specColor = mix(vec3<f32>(0.04), albedo.rgb, metal);
  let diffColor = albedo.rgb * (1.0 - metal);
  let shininess = mix(256.0, 4.0, rough);

  var col = vec3<f32>(0.0);
  // Directional light
  let L = normalize(fx.lightDir.xyz);
  let ndl = max(dot(N, L), 0.0);
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), shininess) * ndl * (shininess + 8.0) / 25.0;
  col = col + (diffColor * ndl + specColor * spec) * fx.lightColor.rgb * fx.lightDir.w * dirShadow(P, N);
  // Point light (with cube shadow when enabled)
  if (fx.pointColor.w > 0.0) {
    let toL = fx.pointPos.xyz - P;
    let dist = length(toL);
    let Lp = toL / max(dist, 0.0001);
    let att = clamp(1.0 - dist / max(fx.pointPos.w, 0.1), 0.0, 1.0) / (1.0 + dist * dist * 0.1);
    let ndlp = max(dot(N, Lp), 0.0);
    let Hp = normalize(Lp + V);
    let sp = pow(max(dot(N, Hp), 0.0), shininess) * ndlp * (shininess + 8.0) / 25.0;
    col = col + (diffColor * ndlp + specColor * sp) * fx.pointColor.rgb * fx.pointColor.w * att * pointShadow(P, N);
  }
  // Hemisphere ambient
  let hemi = mix(vec3<f32>(0.10, 0.10, 0.12), vec3<f32>(0.22, 0.25, 0.30), N.y * 0.5 + 0.5);
  col = col + albedo.rgb * hemi * fx.lightColor.w;
  return vec4<f32>(col, 1.0);
}
