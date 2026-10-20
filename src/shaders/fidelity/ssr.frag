#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform sampler2D u_normalTexture;
uniform mat4 u_proj;
uniform mat4 u_invProj;
uniform mat4 u_view;
uniform mat4 u_invView;
uniform float u_maxSteps;
uniform float u_thickness;
uniform float u_falloff;
uniform float u_iblBlend;
//#include env
vec3 viewPos(vec2 uv, float d) {
  vec4 c = u_invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return c.xyz / c.w;
}
vec2 toUV(vec3 p) {
  vec4 c = u_proj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}
void main() {
  vec4 base = texture(u_texture, v_uv);
  float depth = texture(u_depthTexture, v_uv).r;
  vec4 nr = texture(u_normalTexture, v_uv);
  float rough = nr.a;
  if (depth >= 1.0 || rough > 0.6) { fragColor = base; return; }
  vec3 P = viewPos(v_uv, depth);
  vec3 N = normalize((u_view * vec4(nr.xyz * 2.0 - 1.0, 0.0)).xyz);
  vec3 R = normalize(reflect(normalize(P), N));
  float rf = 1.0 - rough / 0.6;
  int steps = int(clamp(u_maxSteps, 8.0, 128.0));
  float stepSize = 0.1;
  vec3 pos = P + R * 0.05;
  bool hit = false;
  vec2 hitUV = vec2(0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    pos += R * stepSize;
    vec2 uv = toUV(pos);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sd = texture(u_depthTexture, uv).r;
    if (sd >= 1.0) { stepSize *= 1.05; continue; }
    float surfZ = viewPos(uv, sd).z;
    float behind = surfZ - pos.z;  // view space looks down -z: the ray is behind the surface when this is > 0
    if (behind > 0.0 && behind < u_thickness + stepSize) {
      vec3 lo = pos - R * stepSize;
      vec3 hi = pos;
      for (int b = 0; b < 5; b++) {
        vec3 mid = (lo + hi) * 0.5;
        vec2 muv = toUV(mid);
        float mz = viewPos(muv, texture(u_depthTexture, muv).r).z;
        if (mz - mid.z > 0.0) hi = mid; else lo = mid;
      }
      hitUV = toUV(hi);
      hit = true;
      break;
    }
    stepSize *= 1.05;
  }
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, -normalize(P)), 0.0), 5.0);
  vec3 outc = base.rgb;
  if (hit) {
    vec2 e = smoothstep(vec2(0.0), vec2(0.1), hitUV) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - hitUV);
    float conf = pow(e.x * e.y, u_falloff) * rf;
    outc = mix(outc, texture(u_texture, hitUV).rgb, clamp(conf * (0.3 + fres), 0.0, 1.0));
  } else {
    vec3 wr = (u_invView * vec4(R, 0.0)).xyz;
    outc = mix(outc, envSample(wr), clamp(u_iblBlend * rf * (0.2 + fres), 0.0, 1.0));
  }
  fragColor = vec4(outc, base.a);
}
