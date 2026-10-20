// Shadow sampling shared by forward and deferred lighting. Units: map 10, moments 11, cube 12.
uniform sampler2D u_shadowMap;
uniform sampler2D u_shadowMoments;
uniform samplerCube u_shadowCubeMap;
uniform mat4 u_lightVP;
uniform vec4 u_shadowParams;  // x bias, y normalBias, z texel, w mode (0 hard, 1 pcf, 2 vsm)
uniform vec4 u_pointLight;    // xyz position, w far
uniform vec2 u_pointParams;   // x near, y shadow-cube enabled
uniform float u_shadowEnabled;

float dirShadow(vec3 worldPos, vec3 N, vec3 L) {
  if (u_shadowEnabled < 0.5) return 1.0;
  vec4 lc = u_lightVP * vec4(worldPos + N * u_shadowParams.y, 1.0);
  vec3 s = lc.xyz / lc.w * 0.5 + 0.5;
  if (s.z > 1.0 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float ref = s.z - max(u_shadowParams.x * (1.0 - dot(N, L)), u_shadowParams.x * 0.1);
  float mode = u_shadowParams.w;
  if (mode > 1.5) {
    vec2 m = texture(u_shadowMoments, s.xy).rg;
    if (ref <= m.x) return 1.0;
    float var = max(m.y - m.x * m.x, 1e-5);
    float d = ref - m.x;
    return clamp((var / (var + d * d) - 0.2) / 0.8, 0.0, 1.0);
  }
  if (mode < 0.5) return texture(u_shadowMap, s.xy).r < ref ? 0.0 : 1.0;
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
    lit += texture(u_shadowMap, s.xy + vec2(float(x), float(y)) * u_shadowParams.z).r < ref ? 0.0 : 1.0;
  return lit / 9.0;
}

float pointShadow(vec3 worldPos) {
  if (u_pointParams.y < 0.5) return 1.0;
  vec3 d = worldPos - u_pointLight.xyz;
  float z = max(abs(d.x), max(abs(d.y), abs(d.z)));
  float n = u_pointParams.x;
  float f = u_pointLight.w;
  float ndc = (f + n) / (f - n) - (2.0 * f * n) / ((f - n) * z);
  float ref = ndc * 0.5 + 0.5 - u_shadowParams.x * 2.0;
  return texture(u_shadowCubeMap, d).r < ref ? 0.0 : 1.0;
}
