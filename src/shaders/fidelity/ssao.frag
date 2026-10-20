#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_depthTexture;
uniform sampler2D u_normalTexture;
uniform mat4 u_proj;
uniform mat4 u_invProj;
uniform mat4 u_view;
uniform vec2 u_resolution;
uniform float u_radius;
uniform float u_intensity;
uniform float u_sampleCount;
uniform float u_bias;
vec3 viewPos(vec2 uv, float d) {
  vec4 c = u_invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return c.xyz / c.w;
}
void main() {
  float d = texture(u_depthTexture, v_uv).r;
  if (d >= 1.0) { fragColor = vec4(1.0); return; }
  vec3 P = viewPos(v_uv, d);
  vec3 N = normalize((u_view * vec4(texture(u_normalTexture, v_uv).xyz * 2.0 - 1.0, 0.0)).xyz);
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 rv = vec3(cos(ang), sin(ang), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  vec3 B = cross(N, T);
  int n = int(clamp(u_sampleCount, 4.0, 64.0));
  float occ = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float h = (float(i) + 0.5) / float(n);
    float phi = float(i) * 2.39996323;
    float s = sqrt(1.0 - h * h);
    vec3 dir = T * cos(phi) * s + B * sin(phi) * s + N * h;
    vec3 S = P + dir * u_radius * mix(0.2, 1.0, h * h);
    vec4 clip = u_proj * vec4(S, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float surfZ = viewPos(suv, texture(u_depthTexture, suv).r).z;
    float range = smoothstep(0.0, 1.0, u_radius / max(abs(P.z - surfZ), 1e-4));
    occ += (surfZ >= S.z + u_bias ? 1.0 : 0.0) * range;
  }
  float ao = clamp(1.0 - occ / float(n) * u_intensity, 0.0, 1.0);
  fragColor = vec4(vec3(ao), 1.0);
}
