#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform sampler2D u_historyTexture;
uniform sampler2D u_motionTexture;
uniform vec2 u_resolution;
uniform float u_historyValid;
uniform float u_feedback;
vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYCoCg(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
void main() {
  vec4 cur = texture(u_texture, v_uv);
  if (u_historyValid < 0.5) { fragColor = cur; return; }
  vec2 texel = 1.0 / u_resolution;
  vec2 motion = (texture(u_motionTexture, v_uv).xy - 0.5) * 2.0;
  vec2 huv = v_uv - motion;
  vec3 hist = texture(u_historyTexture, huv).rgb;
  if (any(isnan(hist)) || any(isinf(hist))) hist = cur.rgb;  // reject poisoned history
  vec3 lo = toYCoCg(cur.rgb);
  vec3 hi = lo;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 n = toYCoCg(texture(u_texture, v_uv + vec2(float(x), float(y)) * texel).rgb);
    lo = min(lo, n);
    hi = max(hi, n);
  }
  hist = fromYCoCg(clamp(toYCoCg(hist), lo, hi));
  float w = clamp(u_feedback, 0.0, 0.98);
  if (huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) w = 0.0;
  vec3 col = mix(cur.rgb, hist, w);
  if (any(isnan(col)) || any(isinf(col))) col = cur.rgb;
  fragColor = vec4(col, cur.a);
}
