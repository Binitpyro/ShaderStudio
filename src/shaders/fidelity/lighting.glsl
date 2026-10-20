uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec3 u_camPos;
uniform vec4 u_pointColor;  // rgb * intensity, a = enabled

vec3 shade(vec3 albedo, vec3 P, vec3 N, float rough, float metal, float ao) {
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_camPos - P);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);
  float sh = dirShadow(P, N, L);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float specPow = mix(8.0, 128.0, 1.0 - rough);
  vec3 radiance = u_lightColor * u_lightIntensity * NdotL * sh;
  vec3 color = albedo * (1.0 - metal) * radiance + F0 * radiance * pow(max(dot(N, H), 0.0), specPow);
  if (u_pointColor.a > 0.5) {
    vec3 toL = u_pointLight.xyz - P;
    float dist = length(toL);
    float att = 1.0 / (1.0 + 0.09 * dist + 0.032 * dist * dist);
    float pl = max(dot(N, toL / max(dist, 1e-4)), 0.0) * att * pointShadow(P);
    color += albedo * (1.0 - metal) * u_pointColor.rgb * pl;
  }
  vec3 ambient = albedo * (0.1 + 0.25 * envSample(N));
  return color + ambient * ao;
}
