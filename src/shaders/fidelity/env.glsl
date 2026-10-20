uniform sampler2D u_envMap;
uniform float u_envExposure;
vec3 envSample(vec3 d) {
  d = normalize(d);
  float v = 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.141592653589793;
  float u = fract(atan(d.x, -d.z) / 6.283185307179586 + 0.5);
  return texture(u_envMap, vec2(u, v)).rgb * u_envExposure;
}
