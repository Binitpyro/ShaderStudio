// Analytic sky (Rayleigh/Mie-flavoured, Preetham-lite). u_sunDir points toward the sun.
uniform vec3 u_sunDir;
uniform vec3 u_skyParams; // x sunIntensity, y turbidity
vec3 skyColor(vec3 dir) {
  dir = normalize(dir);
  float sunH = u_sunDir.y;
  float cosT = dot(dir, u_sunDir);
  float up = max(dir.y, 0.0);
  float day = smoothstep(-0.15, 0.25, sunH);
  vec3 zenith = mix(vec3(0.01, 0.015, 0.04), vec3(0.12, 0.30, 0.75), day);
  vec3 horizon = mix(vec3(0.03, 0.03, 0.05), vec3(0.65, 0.78, 0.95), day);
  float dusk = exp(-abs(sunH) * 6.0) * smoothstep(-0.2, 0.0, sunH + 0.1);
  horizon = mix(horizon, vec3(1.0, 0.45, 0.15), dusk * 0.7);
  vec3 col = mix(horizon, zenith, pow(up, 0.45));
  float mie = pow(max(cosT, 0.0), 8.0) * 0.02 * u_skyParams.y * u_skyParams.x;
  col += vec3(1.0, 0.8, 0.6) * mie * day;
  float disc = smoothstep(0.9996, 0.9999, cosT) * u_skyParams.x * 20.0;
  col += vec3(1.0, 0.95, 0.85) * disc * step(0.0, dir.y + 0.02);
  if (dir.y < 0.0) col = mix(col, vec3(0.08, 0.08, 0.09) * (0.2 + day), smoothstep(0.0, -0.1, dir.y));
  return col;
}
